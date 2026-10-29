#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

String.prototype.format = function(...values) {
	return this.replace(/%%|%[sd]/g, token => token == '%%' ? '%' : String(values.shift()));
};

const baseclass = { extend: definition => definition };
const identity = text => text;
const mwan4Rules = new Function('baseclass', '_', read('htdocs/luci-static/resources/mwan4/rules.js'))(baseclass, identity);
const mwan4Routetest = new Function('baseclass', 'mwan4Rules', '_', read('htdocs/luci-static/resources/mwan4/routetest.js'))(baseclass, mwan4Rules, identity);
const rulecheck = new Function('baseclass', 'mwan4Routetest', '_', read('htdocs/luci-static/resources/mwan4/rulecheck.js'))(baseclass, mwan4Routetest, identity);

const emptyRule = { enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all', src_port: '', dest_port: '', dscp: '', ipset: '' };
const rule = (name, fields) => Object.assign({}, emptyRule, { name, label: name, via: 'default' }, fields);

const routes = [
	{ '.name': 'tim_m1', interface: 'wan_tim', metric: '1' },
	{ '.name': 'tim6_m1', interface: 'wan_tim6', metric: '1' },
	{ '.name': 'str_m2', interface: 'wan_str', metric: '2' },
	{ '.name': 'str_m1', interface: 'wan_str', metric: '1' },
	{ '.name': 'tim_m2', interface: 'wan_tim', metric: '2' },
	{ '.name': 'wg_m1', interface: 'wg_vpn', metric: '1' },
	{ '.name': 'off_m1', interface: 'wan_off', metric: '1' }
];
const strategies = [
	{ '.name': 'tim_first', use_route: [ 'tim_m1', 'tim6_m1', 'str_m2' ], last_resort: 'unreachable' },
	{ '.name': 'str_first', use_route: [ 'str_m1', 'tim_m2' ], last_resort: 'default' },
	{ '.name': 'tim_only', use_route: [ 'tim_m1', 'tim6_m1' ], last_resort: 'default' },
	{ '.name': 'wg_wan_only', use_route: [ 'wg_m1' ], last_resort: 'unreachable' },
	{ '.name': 'off_only', use_route: [ 'off_m1' ], last_resort: 'unreachable' },
	{ '.name': 'empty', use_route: [] }
];
const interfaces = [ 'wan_tim', 'wan_tim6', 'wan_str', 'wg_vpn' ].map(name => ({ '.name': name, enabled: '1' })).concat([ { '.name': 'wan_off', enabled: '0' } ]);
const link = (state, family) => ({ health_state: state, family: family });
const status = { interfaces: { wan_tim: link('offline', 'ipv4'), wan_tim6: link('offline', 'ipv6'), wan_str: link('online', 'ipv4'), wg_vpn: link('offline', 'ipv4') } };
const wgUp = { interfaces: Object.assign({}, status.interfaces, { wg_vpn: link('online', 'ipv4') }) };

const others = [
	rule('youtube', { domain: [ 'youtube.com' ] }),
	rule('olery', { domain: [ 'olery.com' ], proto: 'tcp', dest_port: '400-500', via: 'str_first' }),
	rule('phone', { src_mac: [ 'aa:bb:cc:dd:ee:01' ], via: 'wg_wan_only' }),
	rule('office', { dest_ip: [ '10.0.0.0/8' ], via: 'str_first' }),
	rule('old', { enabled: '0', domain: [ 'example.org' ] }),
	rule('default_rule_v4', { dest_ip: [ '0.0.0.0/0' ] }),
	rule('default_rule_v6', { dest_ip: [ '::/0' ] })
];
const check = (draft, fields) => rulecheck.check(Object.assign(rule('new', { via: 'default' }), draft), Object.assign(
	{ rules: others, position: others.length - 2, strategies, routes, status: wgUp, interfaces, dnsEnforced: true }, fields));
const codes = list => list.map(item => item.code);
const find = (list, code) => list.find(item => item.code == code);

// shadowed
let issues = check({ domain: [ 'www.youtube.com' ] }, { position: 3 });
assert.deepEqual(codes(issues), [ 'shadowed' ], 'a subdomain is covered by the parent domain above');
assert.equal(issues[0].severity, 'warning');
assert.equal(issues[0].field, 'what');
assert.ok(issues[0].message.indexOf('"youtube"') >= 0, 'names the earlier rule');
assert.ok(/Move this rule above it or narrow/.test(issues[0].message), 'tells what to do');
assert.deepEqual(codes(check({ domain: [ 'youtube.com' ], via: 'str_first' }, { position: 3 })), [ 'shadowed' ], 'same match with another path is shadowed too');
assert.deepEqual(codes(check({ domain: [ 'youtube.com' ] }, { position: 0 })), [], 'above the broader rule nothing is shadowed');
assert.deepEqual(codes(check({ domain: [ 'youtube.com' ] }, { position: 3, rules: others.map((r, i) => i ? r : rule('youtube', { domain: [ 'youtube.com' ], enabled: '0' })) })), [],
	'a disabled earlier rule does not shadow');
assert.deepEqual(codes(check({ domain: [ 'www.youtube.com' ] }, { position: 0, rules: [ rule('sub', { domain: [ 'www.youtube.com' ] }) ] })).filter(code => code == 'shadowed'), []);
assert.deepEqual(codes(check({ domain: [ 'youtube.com' ] }, { position: 1, rules: [ rule('sub', { domain: [ 'www.youtube.com' ] }) ] })), [], 'a narrower earlier rule does not cover the parent');
assert.deepEqual(codes(check({ domain: [ 'olery.com' ], proto: 'tcp', dest_port: '443' }, { position: 3 })), [ 'shadowed' ], 'a port inside an earlier range is covered');
assert.deepEqual(codes(check({ domain: [ 'olery.com' ], proto: 'tcp', dest_port: '443,600' }, { position: 3 })), [], 'a port outside the range is new');
assert.deepEqual(codes(check({ domain: [ 'olery.com' ], proto: 'tcp' }, { position: 3 })), [], 'no port is wider than a port range');
assert.deepEqual(codes(check({ domain: [ 'olery.com' ], proto: 'udp', dest_port: '443' }, { position: 3 })), [], 'another protocol is not covered');
assert.deepEqual(codes(check({ dest_ip: [ '10.1.0.0/16' ] }, { position: 4 })), [ 'shadowed' ], 'a subnet is covered by the CIDR above');
assert.deepEqual(codes(check({ dest_ip: [ '10.1.0.0/16', '192.168.0.0/24' ] }, { position: 4 })), [], 'one uncovered CIDR keeps the rule useful');
assert.deepEqual(codes(check({ dest_ip: [ '2001:db8::/32' ] }, { position: 4 })), [], 'IPv6 is not covered by an IPv4 range');
assert.deepEqual(codes(check({ domain: [ 'a.com' ], src_mac: [ 'AA:BB:CC:DD:EE:01' ] }, { position: 3 })).filter(code => code == 'shadowed'), [ 'shadowed' ],
	'a device rule with no site shadows the same device with a site');
assert.deepEqual(codes(check({ domain: [ 'a.com' ], src_mac: [ 'aa:bb:cc:dd:ee:02' ] }, { position: 3 })), [], 'another device is not covered');
assert.deepEqual(codes(check({ domain: [ 'a.com' ] }, { position: 3, rules: [ rule('phone', { src_mac: [ 'aa:bb:cc:dd:ee:01' ] }) ] })), [], 'a device rule does not shadow every device');
assert.deepEqual(codes(check({ domain: [ 'a.com' ] }, { position: 6 })), [], 'the default catch-alls only cover addresses');

// duplicate
issues = check({ domain: [ 'youtube.com' ], via: 'str_first' }, { position: 0 });
assert.deepEqual(codes(issues), [ 'duplicate' ]);
assert.ok(issues[0].message.indexOf('"youtube"') >= 0);
assert.equal(issues[0].field, 'via');
assert.deepEqual(codes(check({ domain: [ 'youtube.com' ] }, { position: 0 })), [], 'same match and same path is only redundant');
assert.deepEqual(codes(check({ domain: [ 'youtube.com' ], via: 'str_first' }, { position: 0, rules: [ others[0], others[1] ] })).filter(code => code == 'duplicate'), [ 'duplicate' ]);
assert.deepEqual(codes(check({ domain: [ 'youtube.com', 'x.com' ], via: 'str_first' }, { position: 0 })), [], 'a different set of sites is not a duplicate');

// pathEmpty / pathDown
issues = check({ domain: [ 'a.com' ], via: 'empty' }, { position: 0 });
assert.equal(find(issues, 'pathEmpty').severity, 'error');
assert.equal(find(issues, 'pathEmpty').field, 'via');
assert.ok(/no enabled WAN links/.test(find(issues, 'pathEmpty').message));
issues = check({ domain: [ 'a.com' ], via: 'off_only' }, { position: 0 });
assert.equal(find(issues, 'pathEmpty').severity, 'error', 'a path whose only link is disabled is empty');
assert.deepEqual(codes(check({ domain: [ 'a.com' ], via: 'gone' }, { position: 0 })), [ 'pathEmpty' ], 'a missing path is an error');
assert.deepEqual(codes(check({ domain: [ 'a.com' ], via: 'tim_first' }, { position: 0, routes: routes.map(r => Object.assign({}, r, { enabled: '0' })) })), [ 'pathEmpty' ]);
issues = check({ domain: [ 'a.com' ], via: 'wg_wan_only' }, { position: 0, status });
assert.equal(find(issues, 'pathDown').severity, 'warning');
assert.ok(/Wg vpn/.test(find(issues, 'pathDown').message) && /rule stops/.test(find(issues, 'pathDown').message), find(issues, 'pathDown').message);
issues = check({ domain: [ 'a.com' ], via: 'tim_only' }, { position: 0 });
assert.ok(/rule uses normal routing/.test(find(issues, 'pathDown').message), 'the effect follows the last resort');
assert.ok(/Tim/.test(find(issues, 'pathDown').message) && !/Tim and Tim/.test(find(issues, 'pathDown').message), 'IPv4 and IPv6 siblings read as one link');
assert.equal(find(check({ domain: [ 'a.com' ], via: 'tim_first' }, { position: 0 }), 'pathDown'), undefined, 'one usable link is enough');
assert.equal(find(check({ domain: [ 'a.com' ], via: 'wg_wan_only' }, { position: 0 }), 'pathDown'), undefined, 'a healthy tunnel is fine');
assert.equal(find(check({ domain: [ 'a.com' ], via: 'wg_wan_only' }, { position: 0, status: null }), 'pathDown'), undefined, 'without live status nothing is reported down');
assert.equal(find(check({ domain: [ 'a.com' ], via: 'default' }, { position: 0 }), 'pathDown'), undefined);

// stopsWhenDown
issues = check({ domain: [ 'a.com' ], via: 'wg_wan_only' }, { position: 0 });
assert.deepEqual(codes(issues), [ 'stopsWhenDown' ]);
assert.equal(issues[0].severity, 'info');
assert.equal(issues[0].message.indexOf('Traffic stops while Wg vpn is unavailable.'), 0);
assert.ok(/Traffic stops while Tim and Str are all unavailable/.test(find(check({ domain: [ 'a.com' ], via: 'tim_first' }, { position: 0 }), 'stopsWhenDown').message));
assert.equal(find(check({ domain: [ 'a.com' ], via: 'str_first' }, { position: 0 }), 'stopsWhenDown'), undefined, 'a path with normal routing as last resort does not stop');
assert.equal(find(check({ domain: [ 'a.com' ], via: 'default' }, { position: 0 }), 'stopsWhenDown'), undefined);
for (const via of [ 'blackhole', 'unreachable' ])
	assert.ok(/blocks matching traffic/.test(find(check({ domain: [ 'a.com' ], via }, { position: 0 }), 'stopsWhenDown').message), via);

// dnsNotEnforced
issues = check({ domain: [ 'a.com' ], via: 'default' }, { position: 0, dnsEnforced: false });
assert.deepEqual(codes(issues), [ 'dnsNotEnforced' ]);
assert.equal(issues[0].severity, 'warning');
assert.equal(issues[0].field, 'what');
assert.ok(/own DNS server or encrypted DNS/.test(issues[0].message));
assert.deepEqual(codes(check({ domain: [ 'a.com' ], via: 'default' }, { position: 0, dnsEnforced: null })), [], 'unknown DNS control is not reported');
assert.deepEqual(codes(check({ domain: [ 'a.com' ], via: 'default' }, { position: 0, dnsEnforced: true })), []);
assert.deepEqual(codes(check({ dest_ip: [ '9.9.9.0/24' ], via: 'default' }, { position: 0, dnsEnforced: false })), [], 'address rules do not depend on DNS');

// broad
issues = check({ via: 'tim_first' }, { position: 0 });
assert.ok(codes(issues).indexOf('broad') >= 0);
assert.equal(find(issues, 'broad').severity, 'warning');
assert.equal(find(issues, 'broad').field, 'what');
assert.ok(/youtube, olery, phone, office/.test(find(issues, 'broad').message), 'names the rules that become unreachable');
assert.ok(!/old|default_rule/.test(find(issues, 'broad').message), 'disabled rules and the default catch-alls are not listed');
assert.ok(!/never used:/.test(find(check({ via: 'tim_first' }, { position: others.length - 2 }), 'broad').message), 'only the defaults are below the last position');
assert.ok(find(check({ via: 'tim_first' }, { position: others.length - 2 }), 'broad'), 'still reported when nothing user-made is hidden');
assert.ok(find(check({ dest_ip: [ '0.0.0.0/0' ], via: 'tim_first' }, { position: 0 }), 'broad'), 'a /0 range is as broad as nothing');
assert.equal(find(check({ via: 'default' }, { position: 0 }), 'broad'), undefined, 'matching everything with normal routing is harmless');
assert.equal(find(check({ src_mac: [ 'aa:bb:cc:dd:ee:09' ] }, { position: 0 }), 'broad'), undefined, 'one device, every destination is fine');
assert.equal(find(check({ src_iface: 'lan' }, { position: 0 }), 'broad'), undefined);
assert.equal(find(check({ proto: 'udp' }, { position: 0 }), 'broad'), undefined);
assert.equal(find(check({ proto: 'tcp', dest_port: '443' }, { position: 0 }), 'broad'), undefined);
assert.equal(find(check({ domain: [ 'a.com' ] }, { position: 0 }), 'broad'), undefined);

// a disabled draft is not checked; severities are ordered
assert.deepEqual(check({ enabled: '0', via: 'empty' }, { position: 0 }), []);
issues = check({ domain: [ 'a.com' ], via: 'empty' }, { position: 0, dnsEnforced: false });
assert.deepEqual(codes(issues), [ 'pathEmpty', 'dnsNotEnforced' ], 'errors come first');

// no rules around, partial context
assert.deepEqual(codes(rulecheck.check(rule('solo', { domain: [ 'a.com' ], via: 'default' }), { strategies, routes })), []);
assert.deepEqual(codes(rulecheck.check(rule('solo', { domain: [ 'a.com' ], via: 'wg_wan_only' }), { rules: [], position: 0, strategies, routes })), [ 'stopsWhenDown' ],
	'missing status and interfaces are tolerated');

// every message is readable and names its field
const everything = [
	check({ domain: [ 'www.youtube.com' ] }, { position: 3, dnsEnforced: false }),
	check({ domain: [ 'youtube.com' ], via: 'str_first' }, { position: 0 }),
	check({ via: 'empty' }, { position: 0 }), check({ via: 'gone' }, { position: 0 }), check({ via: 'wg_wan_only' }, { position: 0, status }),
	check({ via: 'blackhole' }, { position: 0 }), check({ via: 'tim_only' }, { position: 0 }), check({ via: 'tim_first' }, { position: 0 })
].flat();
assert.ok(everything.length >= 8);
everything.forEach(item => {
	assert.ok(!/undefined|null|NaN|\[object/.test(item.message), item.message);
	assert.ok([ 'error', 'warning', 'info' ].indexOf(item.severity) >= 0 && item.message.length > 20 && item.code, JSON.stringify(item));
	assert.ok([ 'what', 'who', 'via', 'ports', 'name', null ].indexOf(item.field) >= 0);
});

console.log('rulecheck tests passed');
