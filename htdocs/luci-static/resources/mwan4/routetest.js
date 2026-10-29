'use strict';
'require baseclass';
'require mwan4.rules as mwan4Rules';

/* global mwan4Rules */

/*
 * "Where would this traffic go?" Evaluates routing-rule drafts top to bottom like the backend (first match wins)
 * against a destination, protocol, port and device, using the live link health. Everything is pure.
 *
 * Match states are true, false or 'unknown'. Unknown is returned for what the browser cannot know: the domain behind
 * an address, the contents of an nft set, source ports and DSCP. Evaluation stops at the first unknown rule and
 * reports the outcome 'unknown'; `ifNot` then holds the result assuming that rule does not apply.
 * A domain query against a rule that matches only addresses is the exception: that rule is assumed not to apply
 * (a domain rarely resolves into a configured range) and listed in `assumptions`, so real configs stay testable.
 * `local` is ignored: it only adds router-originated traffic, never removes LAN traffic.
 */

const BUILTIN   = [ 'default', 'unreachable', 'blackhole' ];
const DEAD      = [ 'offline', 'disabled' ];
const LIST_KEYS = [ 'domain', 'dest_ip', 'src_ip', 'src_mac' ];
const TEXT_KEYS = [ 'src_iface', 'src_port', 'dest_port', 'dscp', 'ipset' ];

function asList(value) {
	return mwan4Rules.asList(value);
}

function normalizeRule(rule) {
	let out = Object.assign({}, rule, { proto: rule.proto || 'all', via: rule.via || 'default' });

	LIST_KEYS.forEach(key => { out[key] = asList(rule[key]); });
	TEXT_KEYS.forEach(key => { out[key] = rule[key] || ''; });

	return out;
}

function ruleName(rule) {
	return rule.label || rule.name;
}

function isEnabled(rule) {
	return rule.enabled != '0';
}

function isBuiltinPath(via) {
	return BUILTIN.indexOf(via) >= 0;
}

function bareHost(host) {
	return String(host || '').toLowerCase().replace(/^\*?\./, '').replace(/\.$/, '');
}

function domainHit(entries, host) {
	let name = bareHost(host);

	return asList(entries).map(bareHost).find(entry => name == entry || name.endsWith('.' + entry));
}

function matchDomain(entries, host) {
	return domainHit(entries, host) !== undefined;
}

function ipv4Value(addr) {
	return mwan4Rules.isIPv4(addr) ? addr.split('.').reduce((sum, octet) => sum * 256n + BigInt(octet), 0n) : null;
}

function ipv6Value(addr) {
	if (!mwan4Rules.isIPv6(addr))
		return null;

	let halves = addr.split('::');
	let head = halves[0] ? halves[0].split(':') : [];
	let tail = halves[1] ? halves[1].split(':') : [];
	let groups = head.concat(Array(8 - head.length - tail.length).fill('0'), tail);

	return groups.reduce((sum, group) => sum * 65536n + BigInt('0x' + group), 0n);
}

function parseAddress(text) {
	let [ addr, len ] = String(text).split('/');
	let bits = addr.indexOf(':') >= 0 ? 128 : 32;
	let value = bits == 128 ? ipv6Value(addr) : ipv4Value(addr);
	let prefix = len == null ? bits : /^\d{1,3}$/.test(len) ? Number(len) : -1;

	return value == null || prefix < 0 || prefix > bits ? null : { bits: bits, value: value, prefix: prefix };
}

function cidrCovers(outer, inner) {
	let a = parseAddress(outer);
	let b = parseAddress(inner);

	if (!a || !b || a.bits != b.bits || a.prefix > b.prefix)
		return false;

	let shift = BigInt(a.bits - a.prefix);

	return a.value >> shift == b.value >> shift;
}

function cidrContains(cidr, ip) {
	return cidrCovers(cidr, String(ip).split('/')[0]);
}

function portRanges(spec) {
	return asList(spec).join(',').split(/[\s,]+/).filter(token => token != '').map(token => {
		let [ low, high ] = token.split(/[-:]/).map(Number);

		return [ low, high == null ? low : high ];
	});
}

function portMatches(spec, port) {
	let ranges = portRanges(spec);

	return !ranges.length || ranges.some(([ low, high ]) => Number(port) >= low && Number(port) <= high);
}

function portsCover(outer, inner) {
	let wide = portRanges(outer);
	let narrow = portRanges(inner);

	return !wide.length || (narrow.length > 0 && narrow.every(([ low, high ]) => wide.some(([ a, b ]) => a <= low && high <= b)));
}

function stateWord(state) {
	return { offline: _('offline'), disabled: _('disabled'), held: _('on hold') }[state] || state;
}

function linkLabel(name) {
	let text = String(name).replace(/^wan_/, '').replace(/6$/, '').replace(/_/g, ' ');

	return text.charAt(0).toUpperCase() + text.slice(1);
}

function linkState(name, status) {
	let runtime = ((status || {}).interfaces || {})[name];

	if (!runtime)
		return 'unknown';

	return runtime.enabled === false || runtime.enabled == '0' ? 'disabled'
		: runtime.health_state || runtime.status || (runtime.up ? 'online' : 'unknown');
}

function familyMatches(name, status, family) {
	let runtime = ((status || {}).interfaces || {})[name] || {};

	return !family || !runtime.family || asList(runtime.family).indexOf(family) >= 0;
}

function strategyByName(name, strategies) {
	return (strategies || []).find(strategy => strategy['.name'] == name);
}

function candidateLinks(wans, status) {
	let alive = wans.filter(wan => DEAD.indexOf(linkState(wan.name, status)) < 0);
	let settled = alive.filter(wan => linkState(wan.name, status) != 'held');

	return settled.length ? settled : alive;
}

function strategyLinks(name, strategies, routes, status, family) {
	let strategy = strategyByName(name, strategies);

	return mwan4Rules.strategyWans(strategy, routes || []).filter(wan => familyMatches(wan.name, status, family));
}

function outcomeLinks(name, strategies, routes, status, family) {
	let tiers = [];

	candidateLinks(strategyLinks(name, strategies, routes, status, family), status).forEach(wan => {
		let tier = tiers[tiers.length - 1];

		if (tier && tier.metric == wan.metric)
			tier.links.push(wan.name);
		else
			tiers.push({ metric: wan.metric, links: [ wan.name ] });
	});

	return tiers;
}

function verdict(state, why) {
	return { state: state, why: asList(why) };
}

function combine(parts) {
	let state = parts.some(part => part.state === false) ? false : parts.some(part => part.state === 'unknown') ? 'unknown' : true;
	let because = parts.filter(part => part.state === state).flatMap(part => part.why);

	return { state: state, because: parts.length ? because : [ _('no restrictions, matches all traffic') ] };
}

function destinationOf(query) {
	let token = mwan4Rules.classifyToken(String(query.destination || ''));

	return token.kind == 'domain' || token.kind == 'ip' ? token : { kind: 'none', value: '' };
}

function unresolved(dest, subject) {
	if (dest.kind == 'none')
		return verdict('unknown', _('depends on the destination, which was not given'));

	return verdict('unknown', dest.kind == 'domain' ? _('depends on the address the domain resolves to') : subject);
}

function domainPart(rule, dest) {
	if (!rule.domain.length)
		return null;

	if (dest.kind != 'domain')
		return unresolved(dest, _('depends on the domain name, which an address does not tell'));

	let hit = domainHit(rule.domain, dest.value);

	return hit ? verdict(true, _('domain %s matches').format(hit)) : verdict(false, _('domain %s is not %s').format(dest.value, rule.domain.join(', ')));
}

function destIpPart(rule, dest) {
	if (!rule.dest_ip.length)
		return null;
	if (dest.kind == 'ip') {
		let hit = rule.dest_ip.find(cidr => cidrContains(cidr, dest.value));

		return hit ? verdict(true, _('address %s is in %s').format(dest.value, hit))
			: verdict(false, _('address %s is not in %s').format(dest.value, rule.dest_ip.join(', ')));
	}
	if (dest.kind == 'domain' && rule.dest_ip.some(cidr => /\/0$/.test(cidr)))
		return verdict(true, _('matches any address'));
	if (dest.kind == 'domain' && !rule.domain.length && !rule.ipset)
		return Object.assign(verdict(false, _('matches addresses, not names (assumed not to apply)')), { assumed: true });

	return unresolved(dest, '');
}

function ipsetPart(rule, dest) {
	return rule.ipset ? unresolved(dest, _('depends on the addresses in the set %s').format(rule.ipset)) : null;
}

function familyPart(rule, dest) {
	let families = mwan4Rules.ruleFamilies(rule);
	let family = dest.kind == 'ip' && dest.value.indexOf(':') >= 0 ? 'ipv6' : 'ipv4';

	if (dest.kind != 'ip' || families.indexOf(family) >= 0)
		return null;

	return verdict(false, _('rule only covers %s').format(families.map(name => name == 'ipv4' ? 'IPv4' : 'IPv6').join(', ') || _('nothing')));
}

function sourcePart(what, wanted, value, anySource, find) {
	if (!wanted.length)
		return null;
	if (!value)
		return anySource ? verdict('unknown', _('depends on the %s of the device').format(what))
			: verdict(false, _('only for %s, no device chosen').format(wanted.join(', ')));

	return find(wanted, String(value).toLowerCase())
		? verdict(true, _('%s %s matches').format(what, value))
		: verdict(false, _('%s %s is not %s').format(what, value, wanted.join(', ')));
}

function sourceParts(rule, source) {
	let any = !!(source.ip || source.mac || source.iface);

	return [
		sourcePart(_('IP address'), rule.src_ip, source.ip, any, (list, ip) => list.find(cidr => cidrContains(cidr, ip))),
		sourcePart(_('MAC address'), rule.src_mac.map(mac => mac.toLowerCase()), source.mac, any, (list, mac) => list.find(item => item == mac)),
		sourcePart(_('network'), rule.src_iface ? [ rule.src_iface ] : [], source.iface, any, (list, iface) => list.find(item => item == iface))
	];
}

function protoPart(rule, query) {
	let given = query.proto || 'all';

	if (rule.proto == 'all')
		return null;
	if (given == 'all')
		return verdict(false, _('only for %s, no protocol chosen').format(rule.proto));

	return given == rule.proto ? verdict(true, _('protocol %s matches').format(given)) : verdict(false, _('protocol %s is not %s').format(given, rule.proto));
}

function portPart(rule, query) {
	if (!rule.dest_port || [ 'tcp', 'udp' ].indexOf(rule.proto) < 0)
		return null;
	if (!query.port)
		return verdict(false, _('only for port %s, no port chosen').format(rule.dest_port));

	return portMatches(rule.dest_port, query.port) ? verdict(true, _('port %s matches').format(query.port))
		: verdict(false, _('port %s is not %s').format(query.port, rule.dest_port));
}

function srcPortPart(rule) {
	return rule.src_port && [ 'tcp', 'udp' ].indexOf(rule.proto) >= 0 ? verdict('unknown', _('depends on the source port')) : null;
}

function dscpPart(rule, query) {
	if (!rule.dscp)
		return null;
	if (!query.dscp)
		return verdict('unknown', _('depends on the DSCP marking of the packets'));

	return String(query.dscp) == rule.dscp ? verdict(true, _('DSCP %s matches').format(rule.dscp))
		: verdict(false, _('DSCP %s is not %s').format(query.dscp, rule.dscp));
}

function matchRule(rule, query, dest) {
	let source = query.source || {};
	let parts = [ familyPart(rule, dest), domainPart(rule, dest), destIpPart(rule, dest), ipsetPart(rule, dest), protoPart(rule, query),
		portPart(rule, query), srcPortPart(rule), dscpPart(rule, query) ].concat(sourceParts(rule, source));

	let result = combine(parts.filter(Boolean));

	result.assumed = parts.some(part => part && part.assumed) && combine(parts.filter(part => part && !part.assumed)).state !== false;

	return result;
}

function joinList(items) {
	return items.length > 1 ? _('%s and %s').format(items.slice(0, -1).join(', '), items[items.length - 1]) : items.join('');
}

function skippedText(strategyName, tier, ctx) {
	let wans = strategyLinks(strategyName, ctx.strategies, ctx.routes, ctx.status, ctx.family).filter(wan => wan.metric < tier.metric);
	let byWord = {};

	wans.forEach(wan => {
		let state = linkState(wan.name, ctx.status);
		let label = linkLabel(wan.name);
		let labels = byWord[stateWord(state)] = byWord[stateWord(state)] || [];

		if (labels.indexOf(label) < 0)
			labels.push(label);
	});

	return joinList(Object.keys(byWord).map(word => byWord[word].length > 1
		? _('%s are %s').format(joinList(byWord[word]), word) : _('%s is %s').format(byWord[word][0], word)));
}

function linkText(strategyName, tier, ctx) {
	let labels = tier.links.map(linkLabel).filter((label, index, all) => all.indexOf(label) == index);
	let skipped = skippedText(strategyName, tier, ctx);
	let verb = labels.length > 1 ? _('is shared between %s').format(joinList(labels)) : _('goes through %s').format(labels[0]);

	return skipped ? _('%s because %s').format(verb, skipped) : verb;
}

function stopsText(strategyName, ctx) {
	let wans = strategyLinks(strategyName, ctx.strategies, ctx.routes, ctx.status, ctx.family);
	let labels = wans.map(wan => linkLabel(wan.name)).filter((label, index, all) => all.indexOf(label) == index);

	if (!labels.length)
		return _('stops because the path has no WAN links');

	return (labels.length > 1 ? _('stops because %s are unavailable') : _('stops because %s is unavailable')).format(joinList(labels));
}

function pathOutcome(via, ctx) {
	let strategy = strategyByName(via, ctx.strategies);
	let tiers = outcomeLinks(via, ctx.strategies, ctx.routes, ctx.status, ctx.family);
	let lastResort = (strategy || {}).last_resort || 'unreachable';

	if (via == 'default')
		return { outcome: 'normal', usable: [], how: _('uses normal routing') };
	if (via == 'unreachable' || via == 'blackhole')
		return { outcome: 'blocked', usable: [], how: _('is blocked') };
	if (!strategy)
		return { outcome: 'unknown', usable: [], how: _('uses the path "%s", which does not exist').format(via) };
	if (tiers.length)
		return { outcome: 'link', usable: tiers[0].links, how: linkText(via, tiers[0], ctx) };
	if (lastResort == 'default')
		return { outcome: 'normal', usable: [], how: _('uses normal routing because no WAN link in the path is available') };

	return { outcome: 'stops', usable: [], how: stopsText(via, ctx) };
}

function step(rules, index, matched, because) {
	return { rule: rules[index], index: index, matched: matched, because: because };
}

function walk(rules, query, dest, stopAtUnknown) {
	let steps = [];
	let assumptions = [];

	for (let index = 0; index < rules.length; index++) {
		let rule = normalizeRule(rules[index]);
		let result = isEnabled(rule) ? matchRule(rule, query, dest) : { state: false, because: [ _('disabled') ] };

		steps.push(step(rules, index, result.state, result.because));
		if (result.assumed)
			assumptions.push({ rule: rules[index], index: index, entries: rule.dest_ip });
		if (result.state === true)
			return { steps: steps, assumptions: assumptions, hit: index };
		if (result.state === 'unknown' && stopAtUnknown)
			return { steps: steps, assumptions: assumptions, maybe: index };
	}

	return { steps: steps, assumptions: assumptions };
}

function assumptionText(assumptions) {
	let names = assumptions.map(item => ruleName(item.rule));
	let list = names.length > 3 ? _('%s and %d more').format(names.slice(0, 3).join(', '), names.length - 3) : joinList(names);

	return assumptions.length ? ' ' + _('Assumes the site does not resolve into the address ranges of: %s.').format(list) : '';
}

function describe(rules, found, ctx) {
	let rule = rules[found.hit];
	let path = pathOutcome(normalizeRule(rule).via, ctx);
	let text = _('Matches rule "%s" (#%d) and %s.').format(ruleName(rule), found.hit + 1, path.how);

	return { outcome: path.outcome, matched: { rule: rule, index: found.hit }, steps: found.steps, path: normalizeRule(rule).via,
		usable: path.usable, assumptions: found.assumptions, text: text + assumptionText(found.assumptions) };
}

function describeMaybe(rules, found) {
	let rule = rules[found.maybe];
	let reasons = found.steps[found.maybe].because.join(', ');

	return { outcome: 'unknown', matched: null, maybe: { rule: rule, index: found.maybe }, steps: found.steps, path: null, usable: [],
		assumptions: found.assumptions, text: _('Cannot tell: rule "%s" (#%d) %s.').format(ruleName(rule), found.maybe + 1, reasons) };
}

function decide(rules, query, ctx, stopAtUnknown) {
	let found = walk(rules, query, destinationOf(query), stopAtUnknown);

	if (found.hit != null)
		return describe(rules, found, ctx);
	if (found.maybe != null)
		return describeMaybe(rules, found);

	return { outcome: 'normal', matched: null, steps: found.steps, path: 'default', usable: [], assumptions: found.assumptions,
		text: _('No routing rule matches, so this traffic uses normal routing.') + assumptionText(found.assumptions) };
}

function lowerFirst(text) {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

function evaluate(query, rules, strategies, routes, status) {
	let dest = destinationOf(query);
	let ctx = { strategies: strategies, routes: routes, status: status, family: dest.kind == 'ip' ? (dest.value.indexOf(':') >= 0 ? 'ipv6' : 'ipv4') : null };
	let result = decide(rules, query, ctx, true);

	if (result.outcome != 'unknown' || !result.maybe)
		return result;

	result.ifNot = decide(rules, query, ctx, false);
	result.text = _('Most likely: %s Rule "%s" (#%d) could change this because it %s.').format(lowerFirst(result.ifNot.text),
		ruleName(result.maybe.rule), result.maybe.index + 1, result.steps[result.maybe.index].because.join(', '));

	return result;
}

return baseclass.extend({
	cidrContains:    cidrContains,
	cidrCovers:      cidrCovers,
	evaluate:        evaluate,
	isBuiltinPath:   isBuiltinPath,
	isEnabled:       isEnabled,
	linkLabel:       linkLabel,
	linkState:       linkState,
	matchDomain:     matchDomain,
	normalizeRule:   normalizeRule,
	outcomeLinks:    outcomeLinks,
	portMatches:     portMatches,
	portsCover:      portsCover,
	ruleName:        ruleName,
	strategyByName:  strategyByName,
	strategyLinks:   strategyLinks
});
