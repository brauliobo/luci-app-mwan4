'use strict';
'require baseclass';
'require mwan4.explain as mwan4Explain';
'require mwan4.routetest as mwan4Routetest';
'require mwan4.rulecheck as mwan4Rulecheck';
'require mwan4.rules as mwan4Rules';
'require mwan4.templates as mwan4Templates';

/* global mwan4Explain, mwan4Routetest, mwan4Rulecheck, mwan4Rules, mwan4Templates */

/*
 * Pure logic behind the routing rules area: list search and filter, inline field validation, rule checks for drafts that
 * still use a quick preset, the traffic tester query and its readable result. No DOM, uci or rpc, so it is unit-tested in node.
 * Drafts are the plain objects of overview.js (name, label, enabled, domain, dest_ip, ..., via).
 */

const PRESET   = /^(prefer|only):(.+)$/;
const INPUT_OF = { what: 'what', who: 'who', ports: 'dest_port', link: 'link' };

function asList(value) {
	return mwan4Rules.asList(value);
}

function isValidNftSetName(value) {
	return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value || '');
}

function matchesAnything(rule) {
	return [ rule.domain, rule.dest_ip, rule.src_ip, rule.src_mac ].some(list => list.length) ||
		!!(rule.src_iface || rule.src_port || rule.dest_port || rule.dscp || rule.ipset) || rule.proto != 'all';
}

function matchesNothing(rule) {
	return !matchesAnything(rule);
}

function ruleShape(raw, what, who) {
	let devices = raw.mode == 'devices';

	return {
		domain: what.domain, dest_ip: what.ip, src_ip: devices ? who.ip : [], src_mac: devices ? who.mac : [],
		src_iface: raw.mode == 'iface' ? raw.src_iface : '', proto: raw.proto || 'all',
		src_port: raw.src_port, dest_port: raw.dest_port, dscp: raw.dscp, ipset: raw.ipset
	};
}

/* [ failed, field, message, incomplete ]: incomplete means "not finished yet" rather than "wrong", so it is shown late */
function checks(raw) {
	let what = mwan4Rules.classifyEntries(raw.what);
	let who = mwan4Rules.classifyEntries(raw.who);
	let rule = ruleShape(raw, what, who);
	let badWho = who.invalid.concat(who.domain);
	let needsPorts = (raw.src_port || raw.dest_port) && [ 'tcp', 'udp' ].indexOf(rule.proto) < 0;

	return [
		[ what.invalid.length, 'what', _('Not a domain name or IP address: %s').format(what.invalid.join(', ')) ],
		[ what.mac.length, 'what', _('MAC addresses belong in Who, not in What.') ],
		[ raw.mode == 'devices' && badWho.length, 'who', _('Devices must be IP addresses, CIDR ranges, or MAC addresses: %s').format(badWho.join(', ')) ],
		[ raw.mode == 'devices' && !rule.src_ip.length && !rule.src_mac.length, 'who', _('Pick or enter at least one device.'), true ],
		[ raw.mode == 'iface' && !rule.src_iface, 'src_iface', _('Choose a network.'), true ],
		[ needsPorts, 'proto', _('Choose TCP or UDP before adding source or destination ports.') ],
		[ raw.src_port && !mwan4Rules.isValidPortList(raw.src_port), 'src_port',
			_('Use source ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.') ],
		[ raw.dest_port && !mwan4Rules.isValidPortList(raw.dest_port), 'dest_port',
			_('Use ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.') ],
		[ raw.dscp && !mwan4Rules.isValidDscp(raw.dscp), 'dscp', _('Use a DSCP value from 1 to 63.') ],
		[ raw.ipset && !isValidNftSetName(raw.ipset), 'ipset', _('Use a simple nft set name with letters, numbers, dots, dashes, or underscores.') ],
		[ raw.sticky == '1' && !(/^\d+$/.test(raw.timeout) && Number(raw.timeout) >= 1), 'timeout', _('Use a positive number of seconds.') ],
		[ !mwan4Rules.ruleFamilies(rule).length, 'proto', _('The protocol and addresses do not share an IP family (IPv4 or IPv6).') ],
		[ !matchesAnything(rule), raw.anchor || 'what', _('Add at least one thing to match, otherwise the rule would catch all traffic.'), true ]
	];
}

function firstPerField(list) {
	return list.filter((item, index) => list.findIndex(other => other.field == item.field) == index);
}

function asProblems(list) {
	return list.filter(item => item[0]).map(item => ({ field: item[1], message: item[2], incomplete: !!item[3] }));
}

/* raw: the values typed into the full editor (what, who, mode, src_iface, proto, src_port, dest_port, dscp, ipset, sticky, timeout) */
function problems(raw) {
	return firstPerField(asProblems(checks(raw)));
}

const REQUIRED = {
	what:  () => _('Enter a site or address, for example youtube.com.'),
	who:   () => _('Pick or enter at least one device.'),
	ports: () => _('Enter at least one port, for example 3074 or 27015-27030.'),
	link:  () => _('Choose a WAN link.')
};

function missing(template, values) {
	return template.fields.filter(field => field.required && !String(values[field.name] || '').trim())
		.map(field => ({ field: INPUT_OF[field.name], message: REQUIRED[field.name](), incomplete: true }));
}

/* The template fields are mapped onto the same raw values as the full editor so both modes share one set of checks. */
function simpleProblems(template, values) {
	let built = template.build(values, {});
	let raw = {
		what: values.what, who: values.who, mode: String(values.who || '').trim() ? 'devices' : 'all', proto: built.proto,
		dest_port: built.dest_port, anchor: INPUT_OF[template.fields[0].name]
	};

	return firstPerField(missing(template, values).concat(problems(raw)));
}

function simpleValues(draft, ctx) {
	let links = ctx.links || [];

	return {
		what:  draft.domain.concat(draft.dest_ip).join(', '),
		who:   draft.src_mac.concat(draft.src_ip).join(', '),
		ports: draft.dest_port,
		link:  mwan4Templates.presetOf(draft.via, ctx).link || (links[0] || {}).key || ''
	};
}

function groupMembers(ctx) {
	return (ctx.links || []).map(link => link.members);
}

/* A draft may still say "prefer:wan_tim"; rule checks and the tester need the strategy that saving would create. */
function resolveVia(via, ctx) {
	let preset = PRESET.exec(via || '');
	let groups = groupMembers(ctx);
	let plan = preset && groups.some(group => group.indexOf(preset[2]) >= 0) ? mwan4Rules.presetPlan(preset[1], preset[2], groups) : null;
	let strategies = ctx.strategies || [];
	let routes = ctx.routes || [];

	if (!plan)
		return { via: via, strategies: strategies, routes: routes };
	if (strategies.some(strategy => strategy['.name'] == plan.strategy))
		return { via: plan.strategy, strategies: strategies, routes: routes };

	let names = plan.routes.map((route, index) => '%s_r%d'.format(plan.strategy, index + 1));

	return {
		via:        plan.strategy,
		strategies: strategies.concat({ '.name': plan.strategy, use_route: names, last_resort: 'unreachable' }),
		routes:     routes.concat(plan.routes.map((route, index) => ({ '.name': names[index], interface: route.interface, metric: String(route.metric) })))
	};
}

/* ctx: { rules (without the checked rule), position, strategies, routes, interfaces, status, links, dnsEnforced } */
function issues(draft, ctx) {
	let path = resolveVia(draft.via, ctx);

	return mwan4Rulecheck.check(Object.assign({}, draft, { via: path.via }), Object.assign({}, ctx, { strategies: path.strategies, routes: path.routes }));
}

function attention(list) {
	return list.filter(item => item.severity != 'info');
}

/* Where a draft sits among the saved ones: everything except itself, and its index (a new rule goes before the defaults). */
function placement(drafts, name, isDefault) {
	let index = name == null ? -1 : drafts.findIndex(item => item.name == name);
	let before = drafts.findIndex(isDefault);
	let at = index >= 0 ? index : before < 0 ? drafts.length : before;

	return { rules: drafts.filter((item, position) => position != index), position: at };
}

function withDraft(drafts, draft, isDefault) {
	let index = draft.name == null ? -1 : drafts.findIndex(item => item.name == draft.name);
	let before = drafts.findIndex(isDefault);
	let at = before < 0 ? drafts.length : before;

	return index >= 0 ? drafts.map((item, position) => position == index ? draft : item) : drafts.slice(0, at).concat(draft, drafts.slice(at));
}

function copyOf(draft) {
	let copy = Object.assign({}, draft, { name: null, label: _('Copy of %s').format(draft.label) });

	[ 'domain', 'dest_ip', 'src_ip', 'src_mac' ].forEach(key => { copy[key] = asList(draft[key]).slice(); });

	return copy;
}

function deviceNames(draft, devices) {
	return draft.src_mac.concat(draft.src_ip).map(entry => devices.find(device => device.mac == String(entry).toLowerCase() || device.ip == entry))
		.filter(Boolean).flatMap(device => [ device.name, device.ip, device.mac ]);
}

function searchText(draft, sentence, devices) {
	return [ draft.label, draft.name, sentence ].concat(draft.domain, draft.dest_ip, draft.src_ip, draft.src_mac, deviceNames(draft, devices || []))
		.filter(Boolean).join(' ').toLowerCase();
}

/* entry: { draft, text (searchText), issues }; view: { query, filter } */
function visible(entry, view) {
	let words = String(view.query || '').toLowerCase().split(/\s+/).filter(Boolean);
	let enabled = mwan4Routetest.isEnabled(entry.draft);
	let byFilter = { all: true, active: enabled, disabled: !enabled, attention: attention(entry.issues).length > 0 };

	return byFilter[view.filter || 'all'] && words.every(word => entry.text.indexOf(word) >= 0);
}

function isFiltered(view) {
	return String(view.query || '').trim() != '' || (view.filter || 'all') != 'all';
}

function viaText(via, ctx) {
	return mwan4Explain.pathSummary(via, ctx.strategies, ctx.routes).text;
}

/* [ [ group label, [ [ value, text, strategy name ] ] ] ] with the saved values unchanged so saving needs no mapping */
function viaGroups(ctx) {
	let existing = (ctx.strategies || []).map(strategy => [ strategy['.name'], viaText(strategy['.name'], ctx), strategy['.name'] ]);
	let presets = (ctx.links || []).flatMap(link => [ 'prefer', 'only' ].map(kind => '%s:%s'.format(kind, link.key)))
		.map(value => [ value, viaText(value, ctx), '' ]);
	let other = [ 'default', 'unreachable', 'blackhole' ].map(value => [ value, viaText(value, ctx), '' ]);

	return [ [ _('Existing paths'), existing ], [ _('Quick presets'), presets ], [ _('Other'), other ] ].filter(group => group[1].length);
}

function linkChoices(ctx) {
	return (ctx.links || []).map(link => [ link.key, '%s (%s)'.format(link.label, mwan4Explain.linkState(link, ctx.status || {}).text) ]);
}

function testProblems(values) {
	let destination = mwan4Rules.classifyToken(String(values.destination || ''));
	let source = String(values.source || '').trim();
	let port = String(values.port || '').trim();
	let list = [
		[ !String(values.destination || '').trim(), 'destination', _('Enter a site such as youtube.com or an IP address.'), true ],
		[ String(values.destination || '').trim() && destination.kind != 'domain' && destination.kind != 'ip', 'destination',
			_('Not a domain name or IP address: %s').format(String(values.destination).trim()) ],
		[ source && [ 'ip', 'mac' ].indexOf(mwan4Rules.classifyToken(source).kind) < 0, 'source', _('Use an IP address or a MAC address.') ],
		[ port && !(mwan4Rules.isValidPortList(port) && /^\d+$/.test(port)), 'port', _('Use one port from 1 to 65535.') ]
	];

	return asProblems(list);
}

function testQuery(values) {
	let source = mwan4Rules.classifyToken(String(values.source || ''));

	return {
		destination: String(values.destination || '').trim(),
		proto:       values.proto || 'all',
		port:        String(values.port || '').trim(),
		source:      { ip: source.kind == 'ip' ? source.value : '', mac: source.kind == 'mac' ? source.value : '', iface: '' }
	};
}

/* Prefill for "Test this rule": the first site or address without its prefix, the first device, and the protocol and port it names. */
function testPrefill(draft) {
	let destination = draft.domain.concat(draft.dest_ip).filter(entry => !/\/0$/.test(entry))[0] || '';
	let tcpOrUdp = [ 'tcp', 'udp' ].indexOf(draft.proto) >= 0;

	return {
		destination: destination.split('/')[0],
		source:      draft.src_mac.concat(draft.src_ip)[0] || '',
		proto:       draft.proto,
		port:        tcpOrUdp ? String(draft.dest_port).split(/[\s,;]+/)[0].split(/[-:]/)[0] : ''
	};
}

function stepText(step) {
	let because = step.because.join(', ');

	return step.matched === true ? _('Matches') : step.matched === 'unknown' ? _('Cannot tell: %s').format(because) : _('Skipped: %s').format(because);
}

function examined(result) {
	return result.steps.map(step => ({
		index:   step.index,
		name:    mwan4Routetest.ruleName(step.rule),
		rule:    step.rule,
		enabled: mwan4Routetest.isEnabled(step.rule),
		state:   step.matched === true ? 'match' : step.matched === 'unknown' ? 'unknown' : 'skipped',
		text:    stepText(step)
	}));
}

/* The assumption sentence, unless the evaluator's own text already names the assumed rules. */
function assumptionNote(result) {
	let names = (result.assumptions || []).map(item => mwan4Routetest.ruleName(item.rule));
	let stated = names.every(name => result.text.indexOf(name) >= 0);

	return names.length && !stated ? _('Assumed not to apply, because they only match IP addresses: %s.').format(names.join(', ')) : '';
}

/* The rule worth opening from a result: the one that matched, or the one that makes the answer uncertain. */
function decidingRule(result) {
	return (result.matched || result.maybe || {}).rule || null;
}

return baseclass.extend({
	INPUT_OF:          INPUT_OF,
	assumptionNote:    assumptionNote,
	attention:         attention,
	copyOf:            copyOf,
	decidingRule:      decidingRule,
	examined:          examined,
	isFiltered:        isFiltered,
	issues:            issues,
	linkChoices:       linkChoices,
	matchesNothing:    matchesNothing,
	placement:         placement,
	problems:          problems,
	resolveVia:        resolveVia,
	searchText:        searchText,
	simpleProblems:    simpleProblems,
	simpleValues:      simpleValues,
	testPrefill:       testPrefill,
	testProblems:      testProblems,
	testQuery:         testQuery,
	viaGroups:         viaGroups,
	visible:           visible,
	withDraft:         withDraft
});
