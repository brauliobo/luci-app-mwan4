'use strict';
'require baseclass';

const MAC          = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;
const IPV4         = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const DOMAIN       = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const URL_SCHEME   = /^[a-z][a-z0-9+.-]*:\/\//i;
const PROTO_FAMILY = { icmp: 'ipv4', icmpv6: 'ipv6' };

function asList(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value : [ value ];
}

function isIPv4(token) {
	let m = IPV4.exec(token);

	return !!m && m.slice(1, 5).every(octet => Number(octet) <= 255) && (m[5] == null || Number(m[5]) <= 32);
}

function isIPv6(token) {
	let parts = token.split('/');
	let halves = parts[0].split('::');
	let groups = halves.flatMap(half => half ? half.split(':') : []);
	let groupsOk = halves.length == 2 ? groups.length < 8 : groups.length == 8;

	return parts.length <= 2 && /^[0-9a-f:]+$/i.test(parts[0]) && halves.length <= 2 && groupsOk &&
		groups.every(group => /^[0-9a-f]{1,4}$/i.test(group)) &&
		(parts.length == 1 || (/^\d{1,3}$/.test(parts[1]) && Number(parts[1]) <= 128));
}

function normalizeDomain(token) {
	let host = token.toLowerCase();

	if (URL_SCHEME.test(host))
		host = host.replace(URL_SCHEME, '').split(/[/?#]/)[0].replace(/^.*@/, '').replace(/:\d+$/, '');

	return host.replace(/^(\*\.|\.)/, '').replace(/\.$/, '');
}

function classifyToken(raw) {
	let token = raw.trim();
	let domain = normalizeDomain(token);

	if (MAC.test(token))
		return { kind: 'mac', value: token.toLowerCase().replace(/-/g, ':') };
	if (isIPv4(token) || isIPv6(token))
		return { kind: 'ip', value: token.toLowerCase() };

	return DOMAIN.test(domain) ? { kind: 'domain', value: domain } : { kind: 'invalid', value: token };
}

function splitEntries(text) {
	return String(text || '').split(/[\s,;]+/).filter(token => token != '');
}

function classifyEntries(text) {
	let out = { domain: [], ip: [], mac: [], invalid: [] };

	splitEntries(text).map(classifyToken).forEach(entry => {
		if (out[entry.kind].indexOf(entry.value) < 0)
			out[entry.kind].push(entry.value);
	});

	return out;
}

function isValidPortToken(token) {
	let parts = token.split(/[-:]/);
	let start = Number(parts[0]);
	let end = parts.length > 1 ? Number(parts[1]) : start;

	return /^\d+([-:]\d+)?$/.test(token) && start >= 1 && start <= 65535 && end >= start && end <= 65535;
}

function isValidPortList(value) {
	let tokens = splitEntries(value);

	return tokens.length > 0 && tokens.every(isValidPortToken);
}

function isValidDscp(value) {
	return /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 63;
}

function ipFamily(ip) {
	return ip.indexOf(':') >= 0 ? 'ipv6' : 'ipv4';
}

function ruleFamilies(rule) {
	return [ 'ipv4', 'ipv6' ].filter(family =>
		(!PROTO_FAMILY[rule.proto] || PROTO_FAMILY[rule.proto] == family) &&
		[ rule.dest_ip, rule.src_ip ].every(list => !list.length || list.some(ip => ipFamily(ip) == family)));
}

function sectionName(label, taken) {
	let base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').slice(0, 15).replace(/_+$/, '') || 'rule';
	let name = base;

	for (let i = 2; taken.indexOf(name) >= 0; i++)
		name = base.slice(0, 15 - String(i).length - 1).replace(/_+$/, '') + '_' + i;

	return name;
}

function ruleHits(counters, name) {
	let prefix = 'mwan4_counter_rule_' + name;
	let hits = { packets: 0, bytes: 0, found: false };

	Object.keys(counters || {}).filter(key => [ prefix + '_ipv4', prefix + '_ipv6' ].indexOf(key) >= 0).forEach(key => {
		hits.found = true;
		hits.packets += Number(counters[key].packets || 0);
		hits.bytes += Number(counters[key].bytes || 0);
	});

	return hits;
}

function strategyWans(strategy, routes) {
	let byName = {};
	let seen = {};

	routes.forEach(route => { byName[route['.name']] = route; });

	return asList(strategy && strategy.use_route).map((name, index) => ({ route: byName[name], index: index })).filter(item => item.route)
		.map(item => ({ name: item.route.interface, metric: Number(item.route.metric || 1), index: item.index }))
		.sort((a, b) => a.metric - b.metric || a.index - b.index)
		.filter(wan => wan.name && !seen[wan.name] && (seen[wan.name] = true));
}

function wanGroups(names, routes) {
	let metric = {};
	let groups = {};

	routes.forEach(route => { metric[route.interface] = Math.min(metric[route.interface] || Infinity, Number(route.metric || 1)); });
	names.forEach(name => {
		let base = /6$/.test(name) && names.indexOf(name.slice(0, -1)) >= 0 ? name.slice(0, -1) : name;

		(groups[base] = groups[base] || []).push(name);
	});

	return Object.keys(groups).map(base => groups[base].sort())
		.sort((a, b) => (metric[a[0]] || Infinity) - (metric[b[0]] || Infinity) || a[0].localeCompare(b[0]));
}

function presetPlan(kind, wan, groups) {
	let chosen = groups.find(group => group.indexOf(wan) >= 0);
	let ordered = kind == 'prefer' ? [ chosen ].concat(groups.filter(group => group !== chosen)) : [ chosen ];

	return {
		strategy: wan + (kind == 'prefer' ? '_first' : '_only'),
		routes:   ordered.flatMap((group, index) => group.map(name => ({ interface: name, metric: index + 1 })))
	};
}

function hostDevices(hints) {
	return Object.keys(hints || {}).map(mac => {
		let hint = hints[mac] || {};
		let ips = asList(hint.ipaddrs || hint.ipv4).concat(asList(hint.ip6addrs || hint.ipv6));

		return { mac: mac.toLowerCase(), name: hint.name || '', ip: ips[0] || '' };
	}).sort((a, b) => (a.name || a.ip || a.mac).localeCompare(b.name || b.ip || b.mac));
}

return baseclass.extend({
	asList:          asList,
	classifyEntries: classifyEntries,
	classifyToken:   classifyToken,
	hostDevices:     hostDevices,
	isIPv4:          isIPv4,
	isIPv6:          isIPv6,
	isValidDscp:     isValidDscp,
	isValidPortList: isValidPortList,
	presetPlan:      presetPlan,
	ruleFamilies:    ruleFamilies,
	ruleHits:        ruleHits,
	sectionName:     sectionName,
	strategyWans:    strategyWans,
	wanGroups:       wanGroups
});
