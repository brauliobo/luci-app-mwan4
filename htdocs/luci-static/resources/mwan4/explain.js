'use strict';
'require baseclass';

const MAX_LISTED = 3;
const PRESET     = /^(prefer|only):(.+)$/;
const PROTOCOLS  = { tcp: 'TCP', udp: 'UDP', icmp: 'ICMP', icmpv6: 'ICMPv6', esp: 'ESP' };
const LINK_STATE = { online: 'online', degraded: 'online', partial: 'online', held: 'held', offline: 'offline', disabled: 'disabled' };
const STATE_RANK = [ 'online', 'held', 'offline', 'disabled' ];
const QUALITY_METHODS = [ 'ping', 'httping' ];

function asList(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value : [ value ];
}

function ucfirst(text) {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function isOn(value) {
	return [ '1', 'yes', 'on', 'true', 'enabled' ].indexOf(String(value)) >= 0;
}

function joinList(items) {
	return items.length < 2 ? items.join('') : _('%s and %s').format(items.slice(0, -1).join(', '), items[items.length - 1]);
}

function summarize(items) {
	return items.length > MAX_LISTED ? joinList(items.slice(0, 2).concat(_('%d more').format(items.length - 2))) : joinList(items);
}

function duration(seconds) {
	let n = Number(seconds);

	if (n >= 3600 && n % 3600 == 0)
		return _('%d h').format(n / 3600);

	return n >= 60 && n % 60 == 0 ? _('%d min').format(n / 60) : _('%d s').format(n);
}

/* A trailing 6 after a letter or underscore is the IPv6 sibling of a link (wan_tim6, wan6), not part of its name. */
function isV6(name) {
	return /[a-z_]6$/i.test(name);
}

function familyName(name) {
	return isV6(name) ? 'IPv6' : 'IPv4';
}

function plainLabel(name) {
	return ucfirst(name.replace(/_/g, ' ').trim());
}

function linkLabel(name) {
	return plainLabel(name.replace(/^(wan|wg)_/, '').replace(/([a-z_])6$/i, '$1'));
}

function groupLinks(names) {
	let groups = new Map();
	let unique = names.filter((name, index) => names.indexOf(name) == index);

	unique.forEach(name => {
		let key = isV6(name) && unique.indexOf(name.slice(0, -1)) >= 0 ? name.slice(0, -1) : name;

		groups.set(key, (groups.get(key) || []).concat(name));
	});

	let links = Array.from(groups, ([ key, members ]) => ({
		key:     key,
		members: members.sort(),
		label:   members.every(isV6) ? _('%s (IPv6)').format(linkLabel(key)) : linkLabel(key)
	}));

	return links.map(link => links.filter(other => other.label == link.label).length > 1 ? Object.assign({}, link, { label: plainLabel(link.key) }) : link);
}

function memberState(name, status) {
	let iface = (status.interfaces || {})[name] || {};
	let state = LINK_STATE[iface.health_state || iface.status] || 'unknown';

	return state == 'online' && iface.held && iface.held.active ? 'held' : state;
}

function stateWord(state) {
	return {
		online:   _('online'),
		held:     _('on hold'),
		offline:  _('offline'),
		disabled: _('disabled'),
		unknown:  _('status unknown')
	}[state];
}

function linkState(group, status) {
	let states = group.members.map(name => memberState(name, status));
	let state = STATE_RANK.find(rank => states.indexOf(rank) >= 0) || 'unknown';
	let odd = group.members.map((name, index) => [ name, states[index] ]).filter(item => item[1] != state);

	return {
		state: state,
		text:  odd.length ? odd.map(item => '%s %s'.format(familyName(item[0]), stateWord(item[1]))).join(', ') : stateWord(state)
	};
}

function orderedNames(routes) {
	let metric = {};

	routes.filter(route => route.interface).forEach(route => {
		metric[route.interface] = Math.min(metric[route.interface] == null ? Infinity : metric[route.interface], Number(route.metric || 1));
	});

	return { names: Object.keys(metric).sort((a, b) => metric[a] - metric[b]), metric: metric };
}

function metricTiers(routes) {
	let ordered = orderedNames(routes);
	let tiers = [];

	groupLinks(ordered.names).forEach(group => {
		let metric = Math.min.apply(null, group.members.map(name => ordered.metric[name]));
		let last = tiers[tiers.length - 1];

		last && last.metric == metric ? last.groups.push(group) : tiers.push({ metric: metric, groups: [ group ] });
	});

	return tiers.map(tier => tier.groups);
}

function strategyTiers(strategy, routes) {
	let wanted = asList(strategy['use_route']);

	return metricTiers(routes.filter(route => wanted.indexOf(route['.name']) >= 0));
}

function presetStrategy(preset, strategies) {
	return strategies.find(strategy => strategy['.name'] == preset[2] + (preset[1] == 'prefer' ? '_first' : '_only'));
}

function derivedTiers(preset, routes) {
	let groups = groupLinks(orderedNames(routes).names);
	let chosen = groups.find(group => group.members.indexOf(preset[2]) >= 0) || groupLinks([ preset[2] ])[0];

	return [ [ chosen ] ].concat(preset[1] == 'prefer' ? groups.filter(group => group !== chosen).map(group => [ group ]) : []);
}

function failureClause(failure, subject) {
	let reason = subject ? _('%s is unavailable').format(subject) : _('none is available');

	return {
		stops:  _('stops if %s'),
		normal: _('uses normal routing if %s'),
		drops:  _('drops traffic if %s')
	}[failure].format(reason);
}

function tierLabel(tier) {
	return tier.length > 1 ? _('%s (balanced)').format(joinList(tier.map(group => group.label))) : tier[0].label;
}

function pathKind(tiers) {
	let count = tiers.reduce((sum, tier) => sum + tier.length, 0);

	return !count ? 'custom' : count == 1 ? 'only' : tiers.length == 1 ? 'balance' : 'first';
}

function pathPhrase(kind, tiers, via) {
	let labels = tiers.flat().map(group => group.label);

	switch (kind) {
	case 'only':    return _('only %s').format(labels[0]);
	case 'balance': return _('balanced across %s').format(joinList(labels));
	case 'first':   return [ _('%s first').format(tierLabel(tiers[0])) ].concat(tiers.slice(1).map(tier => _('then %s').format(tierLabel(tier)))).join(', ');
	}

	return _('path %s has no WAN links').format(via);
}

function pathResult(kind, tiers, failure, phrase, tail) {
	return {
		kind:    kind,
		links:   tiers.flat(),
		tiers:   tiers,
		failure: failure,
		phrase:  phrase,
		tail:    tail,
		text:    ucfirst(phrase) + (tail ? '; ' + tail : '')
	};
}

function fixedPath(via) {
	switch (via) {
	case 'default':     return pathResult('main', [], 'normal', _('normal routing (main table)'), '');
	case 'unreachable': return pathResult('stop', [], 'stops', _('blocked (rejected)'), '');
	case 'blackhole':   return pathResult('drop', [], 'drops', _('blocked (dropped)'), '');
	}
}

function pathSummary(via, strategies, routes) {
	if (fixedPath(via))
		return fixedPath(via);

	let preset = PRESET.exec(via);
	let saved = preset ? presetStrategy(preset, strategies) : strategies.find(item => item['.name'] == via);
	let tiers = preset && !saved ? derivedTiers(preset, routes) : strategyTiers(saved || {}, routes);
	let failure = { default: 'normal', blackhole: 'drops' }[(saved || {}).last_resort] || 'stops';
	let kind = pathKind(tiers);

	return pathResult(kind, tiers, failure, pathPhrase(kind, tiers, via), failureClause(failure, kind == 'only' ? tiers[0][0].label : null));
}

function nowFailure(failure) {
	return {
		stops:  _('Now: no link available — traffic stops'),
		normal: _('Now: no link available — normal routing'),
		drops:  _('Now: no link available — traffic is dropped')
	}[failure];
}

function skippedText(group, status) {
	return '%s is %s'.format(group.label, stateWord(linkState(group, status).state));
}

function nowVia(path, status) {
	if (path.kind == 'main')
		return { link: null, state: 'online', text: _('Now: normal routing') };
	if (path.kind == 'stop' || path.kind == 'drop')
		return { link: null, state: 'blocked', text: _('Now: blocked') };

	// a link on hold is still used when it is the last usable one
	for (let wanted of [ 'online', 'held' ]) {
		let index = path.tiers.findIndex(tier => tier.some(group => linkState(group, status).state == wanted));

		if (index < 0)
			continue;

		let used = path.tiers[index].filter(group => linkState(group, status).state == wanted);
		let skipped = path.tiers.slice(0, index + 1).flat().filter(group => used.indexOf(group) < 0);
		let name = used.length > 1 ? _('sharing %s').format(joinList(used.map(group => group.label))) : used[0].label;
		let note = skipped.length ? ' (%s)'.format(skipped.map(group => skippedText(group, status)).join(', ')) : '';

		return { link: used[0], state: wanted, text: _('Now: %s').format(name) + note };
	}

	return { link: null, state: 'offline', text: nowFailure(path.failure) };
}

function deviceText(mac, devices) {
	let device = devices.find(item => item.mac.toLowerCase() == mac.toLowerCase());
	let label = device && (device.name || device.ip);

	return label ? '%s (%s)'.format(label, mac) : mac;
}

function whatText(draft) {
	let entries = asList(draft.domain).concat(asList(draft.dest_ip));

	if (!entries.length)
		return draft.ipset ? _('addresses in set %s').format(draft.ipset) : _('everything');

	return summarize(entries);
}

function whoText(draft, devices) {
	let who = summarize(asList(draft.src_mac).map(mac => deviceText(mac, devices)).concat(asList(draft.src_ip))) || _('all devices');

	who = draft.src_iface ? _('%s on network %s').format(who, draft.src_iface) : who;

	return draft.local == '1' ? _('%s, including traffic from this router').format(who) : who;
}

function portText(single, plural, value) {
	let tokens = String(value).split(/[\s,;]+/).filter(token => token != '');

	return (tokens.length > 1 || /[-:]/.test(value) ? plural : single).format(tokens.join(', '));
}

function howText(draft) {
	let first = [
		PROTOCOLS[draft.proto],
		draft.dest_port ? portText(_('port %s'), _('ports %s'), draft.dest_port) : ''
	].filter(Boolean).join(' ');

	return [
		first,
		draft.src_port ? portText(_('source port %s'), _('source ports %s'), draft.src_port) : '',
		draft.dscp ? _('DSCP %s').format(draft.dscp) : ''
	].filter(Boolean).join(', ');
}

function flagList(draft) {
	return [
		draft.sticky == '1' ? _('keeps each device on one link for %s').format(duration(draft.timeout || 600)) : '',
		draft.logging == '1' ? _('logs matches') : '',
		draft.ipset && (asList(draft.domain).length || asList(draft.dest_ip).length) ? _('also matches set %s').format(draft.ipset) : ''
	].filter(Boolean);
}

function ruleParts(draft, ctx) {
	let path = pathSummary(draft.via, ctx.strategies, ctx.routes);

	return {
		what:  whatText(draft),
		who:   whoText(draft, ctx.devices),
		how:   howText(draft),
		via:   path.phrase + (path.tail ? '; ' + path.tail : ''),
		path:  path,
		flags: flagList(draft)
	};
}

function ruleSentence(draft, ctx) {
	let parts = ruleParts(draft, ctx);
	let blocked = parts.path.kind == 'stop' || parts.path.kind == 'drop';
	let head = (blocked ? _('Blocks %s from %s') : _('Sends %s from %s')).format(parts.what, parts.who);
	let how = parts.how ? ' ' + _('on %s').format(parts.how) : '';
	let end = blocked ? ' (%s)'.format(parts.path.kind == 'stop' ? _('rejected') : _('dropped')) : ' ' + _('through %s').format(parts.via);
	let flags = parts.flags.length ? ' (%s)'.format(parts.flags.join(', ')) : '';
	let sentence = head + how + end + flags;

	return draft.enabled == '0' ? _('Disabled: %s').format(sentence) : sentence;
}

function checkVerb(method) {
	return {
		ping:     _('Pings %s'),
		arping:   _('Sends ARP requests to %s'),
		httping:  _('Requests a web page from %s'),
		nslookup: _('Looks up DNS names on %s')
	}[method] || _('Checks %s');
}

function countText(kind, count) {
	if (kind == 'down')
		return count == 1 ? _('marked down after 1 failed check') : _('marked down after %d failed checks').format(count);

	return count == 1 ? _('up again after 1 good one') : _('up again after %d good ones').format(count);
}

function reliabilityText(reliability, targets) {
	if (targets < 2)
		return '';

	return reliability <= 1 ? _('any one target answering keeps it up')
		: reliability >= targets ? _('all %d targets must answer').format(targets)
		: _('at least %d of %d targets must answer').format(reliability, targets);
}

function qualityText(section) {
	return _('treated as degraded above %d ms or %d%% loss, and healthy again below %d ms and %d%%').format(
		section.failure_latency || 1000, section.failure_loss || 40, section.recovery_latency || 500, section.recovery_loss || 10);
}

function healthSentence(section) {
	let targets = asList(section.track_ip);
	let method = section.track_method || 'ping';

	if (!targets.length)
		return _('No check targets are set, so this link is not tested');

	return [
		_('%s every %s').format(checkVerb(method).format(joinList(targets)), duration(section.interval || 10)),
		_('%s and %s').format(countText('down', Number(section.down || 5)), countText('up', Number(section.up || 5))),
		reliabilityText(Number(section.reliability || 1), targets.length),
		isOn(section.check_quality) && QUALITY_METHODS.indexOf(method) >= 0 ? qualityText(section) : ''
	].filter(Boolean).join('; ');
}

const TARGET_UP   = [ 'up', 'online' ];
const TARGET_DOWN = [ 'down', 'offline', 'timeout', 'failed' ];

function targetState(status) {
	return TARGET_UP.indexOf(status) >= 0 ? { ok: true, text: _('answering') }
		: TARGET_DOWN.indexOf(status) >= 0 ? { ok: false, text: _('not answering') }
		: { ok: null, text: status == 'skipped' ? _('skipped') : _('not checked yet') };
}

/* members: [ { section, runtime } ] of one link (its IPv4 and IPv6 siblings): the plain state of its health checks. */
function healthLine(members) {
	let total = members.reduce((sum, member) => sum + asList(member.section.track_ip).length, 0);
	let results = members.flatMap(member => asList(member.runtime.track_ip)).map(target => targetState(target.status).ok);
	let passing = results.filter(ok => ok === true).length;
	let failing = results.filter(ok => ok === false).length;

	if (members.every(member => member.section.enabled == '0'))
		return _('Not tested while disabled');
	if (!total)
		return _('No check targets, so this link is not tested');
	if (failing)
		return _('%d of %d checks failing').format(failing, total);

	return !passing ? _('Waiting for the first check') : passing < total ? _('%d of %d checks passing').format(passing, total) : _('All checks passing');
}

/* Only when latency and loss limits are on; the recovery figures are in the sentence of healthSentence(). */
function limitsLine(section) {
	return isOn(section.check_quality) ? _('Limits: degraded above %d ms or %d%% loss').format(section.failure_latency || 1000, section.failure_loss || 40) : '';
}

function interfaceText(group, status) {
	let ups = group.members.map(name => !!((status.interfaces || {})[name] || {}).up);

	if (ups.every(Boolean))
		return _('Interface up');
	if (!ups.some(Boolean))
		return _('Interface down');

	return group.members.map((name, index) => _('%s interface %s').format(familyName(name), ups[index] ? _('up') : _('down'))).join(', ');
}

function glossary() {
	return {
		[_('WAN link')]:                         _('One internet connection. Its IPv4 and IPv6 addresses are shown together.'),
		[_('Routing rule')]:                     _('Decides which path matching traffic takes.'),
		[_('Path')]:                             _('The WAN links a rule uses, in order of preference.'),
		[_('Use first')]:                        _('Use the first link; move to the next one only when it is unavailable.'),
		[_('Use only')]:                         _('Use one link and never move traffic to another.'),
		[_('Balance')]:                          _('Share new connections across several links at the same time.'),
		[_('Stops if unavailable')]:             _('Traffic is blocked instead of leaking to another link.'),
		[_('Uses normal routing if unavailable')]: _('Traffic then follows the router default route.'),
		[_('Health check')]:                     _('How a link is tested to know whether it works.'),
		[_('Check target')]:                     _('An address that is pinged to test a link.'),
		[_('Hold')]:                             _('A link is kept out of use until it has stayed healthy for a while.'),
		[_('Flap')]:                             _('A link that keeps going up and down.'),
		[_('Failback hold')]:                    _('How long a recovered link must stay healthy before traffic returns to it.'),
		[_('Sticky session')]:                   _('Keeps a device on the same link for a while.'),
		[_('DSCP')]:                             _('A priority tag that some apps put on their traffic, such as calls or games.'),
		[_('Link priority')]:                    _('A WAN link with its order and share inside a path.'),
		[_('Weight')]:                           _('The share of new connections a link gets when links are balanced.'),
		[_('Firewall mark')]:                    _('A number the router puts on traffic to tell which link it must use.'),
		[_('Routing table')]:                    _('A list of routes the router looks up to pick a link; each link has its own.'),
		[_('Address family')]:                   _('IPv4 and IPv6 are the two kinds of internet address.')
	};
}

/* The one-sentence meaning of a glossary term, for title tooltips on the words that remain in the UI. */
function termHint(term) {
	return glossary()[term];
}

return baseclass.extend({
	familyName:     familyName,
	glossary:       glossary,
	groupLinks:     groupLinks,
	healthLine:     healthLine,
	healthSentence: healthSentence,
	interfaceText:  interfaceText,
	limitsLine:     limitsLine,
	linkLabel:      linkLabel,
	linkState:      linkState,
	nowVia:         nowVia,
	pathSummary:    pathSummary,
	ruleParts:      ruleParts,
	ruleSentence:   ruleSentence,
	stateWord:      stateWord,
	targetState:    targetState,
	termHint:       termHint
});
