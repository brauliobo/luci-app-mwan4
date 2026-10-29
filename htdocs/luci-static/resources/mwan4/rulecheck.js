'use strict';
'require baseclass';
'require mwan4.routetest as mwan4Routetest';

/* global mwan4Routetest */

/*
 * Pre-save checks of one routing rule against the others. Each checker takes (rule, ctx) and returns a list of
 * issues { severity, field, code, message }; check() composes them, most severe first.
 *
 * "A covers B" means every packet B matches is also matched by A, so a rule placed after an enabled A never fires.
 * It is decided per field and stays conservative: when containment cannot be proven the rules are not related.
 */

const SEVERITY = { error: 0, warning: 1, info: 2 };

function issue(severity, field, code, message) {
	return { severity: severity, field: field, code: code, message: message };
}

function isDefaultRule(rule) {
	return /^default_rule_v[46]$/.test(rule.name);
}

function isCatchAllCidr(cidr) {
	return /\/0$/.test(cidr);
}

function listCovered(wide, narrow, covers) {
	return !wide.length || (narrow.length > 0 && narrow.every(item => wide.some(outer => covers(outer, item))));
}

function whatCovers(a, b) {
	return listCovered(a.domain, b.domain, (outer, inner) => mwan4Routetest.matchDomain([ outer ], inner)) &&
		listCovered(a.dest_ip, b.dest_ip, mwan4Routetest.cidrCovers) && (!a.ipset || a.ipset == b.ipset);
}

function whoCovers(a, b) {
	return listCovered(a.src_ip, b.src_ip, mwan4Routetest.cidrCovers) &&
		listCovered(a.src_mac, b.src_mac, (outer, inner) => outer.toLowerCase() == inner.toLowerCase()) &&
		(!a.src_iface || a.src_iface == b.src_iface);
}

function trafficCovers(a, b) {
	return (a.proto == 'all' || a.proto == b.proto) && mwan4Routetest.portsCover(a.dest_port, b.dest_port) &&
		mwan4Routetest.portsCover(a.src_port, b.src_port) && (!a.dscp || a.dscp == b.dscp);
}

function covers(a, b) {
	return mwan4Routetest.isEnabled(a) && whatCovers(a, b) && whoCovers(a, b) && trafficCovers(a, b);
}

function sameMatch(a, b) {
	return covers(a, b) && covers(b, a);
}

function withRules(ctx) {
	let rules = (ctx.rules || []).map(mwan4Routetest.normalizeRule);
	let position = ctx.position == null ? rules.length : ctx.position;

	return { before: rules.slice(0, position), after: rules.slice(position) };
}

function strategyLabel(name, ctx) {
	let strategy = mwan4Routetest.strategyByName(name, ctx.strategies);

	return (strategy && strategy.label) || name;
}

function linkEnabled(name, interfaces) {
	return !interfaces || interfaces.some(item => item['.name'] == name && item.enabled != '0');
}

function enabledRoutes(ctx) {
	return (ctx.routes || []).filter(route => route.enabled != '0' && linkEnabled(route.interface, ctx.interfaces));
}

function pathLinks(via, ctx) {
	let wans = mwan4Routetest.strategyLinks(via, ctx.strategies, enabledRoutes(ctx));

	return wans.map(wan => mwan4Routetest.linkLabel(wan.name)).filter((label, index, all) => all.indexOf(label) == index);
}

function joinLabels(labels) {
	return labels.length > 1 ? _('%s and %s').format(labels.slice(0, -1).join(', '), labels[labels.length - 1]) : labels.join('');
}

function lastResort(via, ctx) {
	return (mwan4Routetest.strategyByName(via, ctx.strategies) || {}).last_resort || 'unreachable';
}

function checkShadowed(rule, ctx) {
	let earlier = withRules(ctx).before.find(other => covers(other, rule));

	return !earlier ? [] : [ issue('warning', 'what', 'shadowed',
		_('The rule "%s" above already matches all of this traffic, so this rule is never used. Move this rule above it or narrow "%s".')
			.format(mwan4Routetest.ruleName(earlier), mwan4Routetest.ruleName(earlier))) ];
}

function checkDuplicate(rule, ctx) {
	let twin = withRules(ctx).after.find(other => !isDefaultRule(other) && other.via != rule.via && mwan4Routetest.isEnabled(other) && sameMatch(rule, other));

	return !twin ? [] : [ issue('warning', 'via', 'duplicate',
		_('The rule "%s" below matches the same traffic with another path, so it is never used. Delete one of the two rules or narrow one of them.')
			.format(mwan4Routetest.ruleName(twin))) ];
}

function checkPathLinks(rule, ctx) {
	let via = rule.via;
	let links = pathLinks(via, ctx);

	if (mwan4Routetest.isBuiltinPath(via))
		return [];
	if (!mwan4Routetest.strategyByName(via, ctx.strategies))
		return [ issue('error', 'via', 'pathEmpty', _('The path "%s" does not exist. Choose another path for this rule.').format(via)) ];
	if (!links.length)
		return [ issue('error', 'via', 'pathEmpty', _('The path "%s" has no enabled WAN links. Enable a WAN link in it or choose another path.')
			.format(strategyLabel(via, ctx))) ];

	return checkPathDown(rule, ctx);
}

function checkPathDown(rule, ctx) {
	let via = rule.via;
	let effect = lastResort(via, ctx) == 'default' ? _('uses normal routing') : _('stops');

	return mwan4Routetest.outcomeLinks(via, ctx.strategies, enabledRoutes(ctx), ctx.status).length ? [] : [ issue('warning', 'via', 'pathDown',
		_('All WAN links of the path "%s" (%s) are unavailable right now, so this rule %s. Bring a link back up or choose another path.')
			.format(strategyLabel(via, ctx), joinLabels(pathLinks(via, ctx)), effect)) ];
}

function checkStopsWhenDown(rule, ctx) {
	let via = rule.via;
	let links = pathLinks(via, ctx);

	if (via == 'unreachable' || via == 'blackhole')
		return [ issue('info', 'via', 'stopsWhenDown', _('This rule blocks matching traffic: nothing is sent through any WAN link. Choose a WAN link path if it should still get out.')) ];
	if (!links.length || lastResort(via, ctx) == 'default')
		return [];

	return [ issue('info', 'via', 'stopsWhenDown', (links.length > 1
		? _('Traffic stops while %s are all unavailable. Choose a path that uses normal routing if unavailable if it should keep flowing.')
		: _('Traffic stops while %s is unavailable. That suits a VPN or tunnel; otherwise choose a path that uses normal routing if unavailable.'))
		.format(joinLabels(links))) ];
}

function checkDnsEnforced(rule, ctx) {
	return rule.domain.length && ctx.dnsEnforced === false ? [ issue('warning', 'what', 'dnsNotEnforced',
		_('Devices that use their own DNS server or encrypted DNS are not matched by site names. Make the router the only DNS server for the LAN, or match by address instead.')) ] : [];
}

function matchesAllTraffic(rule) {
	return !rule.domain.length && !rule.ipset && !rule.src_ip.length && !rule.src_mac.length && !rule.src_iface && rule.proto == 'all' &&
		!rule.src_port && !rule.dest_port && !rule.dscp && rule.dest_ip.every(isCatchAllCidr);
}

function checkBroad(rule, ctx) {
	let hidden = withRules(ctx).after.filter(other => mwan4Routetest.isEnabled(other) && !isDefaultRule(other)).map(mwan4Routetest.ruleName);
	let path = strategyLabel(rule.via, ctx);

	if (!matchesAllTraffic(rule) || rule.via == 'default')
		return [];

	return [ issue('warning', 'what', 'broad', hidden.length
		? _('This rule sends all traffic from all devices through "%s", so the rules below it are never used: %s. Narrow it to a site or device, or move it to the end.')
			.format(path, hidden.join(', '))
		: _('This rule sends all traffic from all devices through "%s". Narrow it to a site or device unless that is intended.').format(path)) ];
}

const CHECKERS = [ checkShadowed, checkDuplicate, checkPathLinks, checkStopsWhenDown, checkDnsEnforced, checkBroad ];

function check(draft, ctx) {
	let rule = mwan4Routetest.normalizeRule(draft);

	if (!mwan4Routetest.isEnabled(rule))
		return [];

	return CHECKERS.flatMap(checker => checker(rule, ctx)).sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
}

return baseclass.extend({
	check:   check,
	covers:  covers
});
