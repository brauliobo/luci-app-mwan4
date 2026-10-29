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
const routetest = new Function('baseclass', 'mwan4Rules', '_', read('htdocs/luci-static/resources/mwan4/routetest.js'))(baseclass, mwan4Rules, identity);

const emptyRule = { enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all', src_port: '', dest_port: '', dscp: '', ipset: '' };
const rule = (name, fields) => Object.assign({}, emptyRule, { name, label: name }, fields);

const routes = [
	{ '.name': 'tim_m1', interface: 'wan_tim', metric: '1' },
	{ '.name': 'tim6_m1', interface: 'wan_tim6', metric: '1' },
	{ '.name': 'str_m2', interface: 'wan_str', metric: '2' },
	{ '.name': 'str6_m2', interface: 'wan_str6', metric: '2' },
	{ '.name': 'str_m1', interface: 'wan_str', metric: '1' },
	{ '.name': 'str6_m1', interface: 'wan_str6', metric: '1' },
	{ '.name': 'tim_m2', interface: 'wan_tim', metric: '2' },
	{ '.name': 'tim6_m2', interface: 'wan_tim6', metric: '2' },
	{ '.name': 'wg_m1', interface: 'wg_vpn', metric: '1' }
];
const strategies = [
	{ '.name': 'tim_first', use_route: [ 'tim_m1', 'tim6_m1', 'str_m2', 'str6_m2' ], last_resort: 'unreachable' },
	{ '.name': 'str_first', use_route: [ 'str_m1', 'str6_m1', 'tim_m2', 'tim6_m2' ], last_resort: 'unreachable' },
	{ '.name': 'balanced', use_route: [ 'tim_m1', 'tim6_m1', 'str_m1', 'str6_m1' ], last_resort: 'default' },
	{ '.name': 'tim_only', use_route: [ 'tim_m1', 'tim6_m1' ], last_resort: 'default' },
	{ '.name': 'wg_wan_only', use_route: [ 'wg_m1' ] }
];
const iface = (state, family, extra) => Object.assign({ health_state: state, up: state == 'online', family: family }, extra);
const status = {
	interfaces: {
		wan_tim:  iface('offline', 'ipv4'), wan_tim6: iface('offline', 'ipv6'),
		wan_str:  iface('online', 'ipv4'),  wan_str6: iface('online', 'ipv6'),
		wg_vpn:   iface('online', 'ipv4')
	}
};
const allOnline = { interfaces: Object.assign({}, status.interfaces, { wan_tim: iface('online', 'ipv4'), wan_tim6: iface('online', 'ipv6') }) };
const wgDown = { interfaces: Object.assign({}, status.interfaces, { wg_vpn: iface('offline', 'ipv4') }) };

const rules = [
	rule('youtube', { domain: [ 'youtube.com', 'googlevideo.com' ], via: 'tim_first' }),
	rule('olery', { domain: [ 'olery.com' ], proto: 'tcp', dest_port: '443,8000-8100', via: 'str_first' }),
	rule('phone', { src_mac: [ 'AA:BB:CC:DD:EE:01' ], via: 'wg_wan_only' }),
	rule('lan-pc', { src_ip: [ '10.0.0.149' ], via: 'balanced' }),
	rule('old', { enabled: '0', domain: [ 'example.org' ], via: 'wg_wan_only' }),
	rule('ads', { domain: [ 'ads.example.net' ], via: 'blackhole' }),
	rule('default_rule_v4', { dest_ip: [ '0.0.0.0/0' ], via: 'tim_first' }),
	rule('default_rule_v6', { dest_ip: [ '::/0' ], via: 'tim_first' })
];
const ipRules = [
	rule('office', { dest_ip: [ '203.0.113.0/24', '2001:db8:1::/48' ], via: 'wg_wan_only' }),
	rule('icmp4', { proto: 'icmp', via: 'str_first' }),
	rule('default_rule_v4', { dest_ip: [ '0.0.0.0/0' ], via: 'tim_first' }),
	rule('default_rule_v6', { dest_ip: [ '::/0' ], via: 'tim_first' })
];
const run = (query, list, live) => routetest.evaluate(query, list || rules, strategies, routes, live === undefined ? status : live);
const noJunk = result => JSON.stringify([ result.text, result.steps.map(step => step.because) ]).match(/undefined|null|NaN|\[object/);

// matchDomain
assert.ok(routetest.matchDomain([ 'youtube.com' ], 'youtube.com'));
assert.ok(routetest.matchDomain([ 'youtube.com' ], 'WWW.YouTube.com.'), 'subdomains match, case and trailing dot ignored');
assert.ok(!routetest.matchDomain([ 'youtube.com' ], 'notyoutube.com'), 'a suffix without a dot is another domain');
assert.ok(!routetest.matchDomain([ 'www.youtube.com' ], 'youtube.com'), 'a parent is not matched by a subdomain entry');
assert.ok(routetest.matchDomain([ 'a.com', '*.b.org' ], 'x.b.org'));
assert.ok(!routetest.matchDomain([], 'a.com'));

// cidrContains
assert.ok(routetest.cidrContains('203.0.113.0/24', '203.0.113.7'));
assert.ok(!routetest.cidrContains('203.0.113.0/24', '203.0.114.7'));
assert.ok(routetest.cidrContains('203.0.113.7', '203.0.113.7'), 'a bare address is a /32');
assert.ok(!routetest.cidrContains('203.0.113.7', '203.0.113.8'));
assert.ok(routetest.cidrContains('0.0.0.0/0', '8.8.8.8'));
assert.ok(routetest.cidrContains('2001:db8::/32', '2001:db8:ffff::1'));
assert.ok(!routetest.cidrContains('2001:db8::/32', '2001:db9::1'));
assert.ok(routetest.cidrContains('::/0', '2606:4700:4700::1111'));
assert.ok(routetest.cidrContains('::1', '0:0:0:0:0:0:0:1'), 'a bare IPv6 address is a /128, expanded forms agree');
assert.ok(routetest.cidrContains('fe80::/10', 'febf::1') && !routetest.cidrContains('fe80::/10', 'fec0::1'));
assert.ok(!routetest.cidrContains('0.0.0.0/0', '2001:db8::1'), 'families never mix');
assert.ok(!routetest.cidrContains('::/0', '1.2.3.4'));
assert.ok(!routetest.cidrContains('garbage', '1.2.3.4') && !routetest.cidrContains('1.2.3.0/24', 'nope'));
assert.ok(routetest.cidrCovers('10.0.0.0/8', '10.1.0.0/16') && !routetest.cidrCovers('10.1.0.0/16', '10.0.0.0/8'));

// portMatches / portsCover
assert.ok(routetest.portMatches('443', 443) && routetest.portMatches('443', '443') && !routetest.portMatches('443', 80));
assert.ok(routetest.portMatches('1000-2000', 1000) && routetest.portMatches('1000-2000', 2000) && !routetest.portMatches('1000-2000', 2001));
assert.ok(routetest.portMatches('1000:2000', 1500), 'a colon range works like a dash range');
assert.ok(routetest.portMatches('80,443 8000-8100', 8050) && routetest.portMatches('80,443 8000-8100', 80) && !routetest.portMatches('80,443', 81));
assert.ok(routetest.portMatches('', 12345) && routetest.portMatches(undefined, 1), 'an empty spec matches every port');
assert.ok(routetest.portsCover('', '443') && routetest.portsCover('400-500', '443,450-460') && !routetest.portsCover('400-500', '443,501'));
assert.ok(!routetest.portsCover('443', '') && routetest.portsCover('', ''));

// outcomeLinks
assert.deepEqual(routetest.outcomeLinks('tim_first', strategies, routes, status), [ { metric: 2, links: [ 'wan_str', 'wan_str6' ] } ],
	'offline links are dropped and the next metric tier is used');
assert.deepEqual(routetest.outcomeLinks('tim_first', strategies, routes, allOnline).map(tier => tier.links), [ [ 'wan_tim', 'wan_tim6' ], [ 'wan_str', 'wan_str6' ] ],
	'tiers are ordered by metric');
assert.deepEqual(routetest.outcomeLinks('balanced', strategies, routes, allOnline).map(tier => tier.links), [ [ 'wan_tim', 'wan_tim6', 'wan_str', 'wan_str6' ] ],
	'equal metrics form one balanced tier');
assert.deepEqual(routetest.outcomeLinks('tim_first', strategies, routes, status, 'ipv6'), [ { metric: 2, links: [ 'wan_str6' ] } ], 'IPv6 only uses IPv6 links');
assert.deepEqual(routetest.outcomeLinks('wg_wan_only', strategies, routes, wgDown), [], 'no usable link');
assert.deepEqual(routetest.outcomeLinks('nope', strategies, routes, status), [], 'unknown path has no links');
const held = { interfaces: Object.assign({}, allOnline.interfaces, { wan_tim: iface('held', 'ipv4'), wan_tim6: iface('held', 'ipv6') }) };
assert.deepEqual(routetest.outcomeLinks('tim_first', strategies, routes, held).map(tier => tier.links), [ [ 'wan_str', 'wan_str6' ] ], 'a held link yields to a settled one');
const allHeld = { interfaces: { wan_tim: iface('held', 'ipv4'), wan_tim6: iface('held', 'ipv6'), wan_str: iface('held', 'ipv4'), wan_str6: iface('held', 'ipv6') } };
assert.deepEqual(routetest.outcomeLinks('tim_first', strategies, routes, allHeld)[0].links, [ 'wan_tim', 'wan_tim6' ], 'with every link held the holds are lifted');
const disabledLink = { interfaces: Object.assign({}, allOnline.interfaces, { wan_tim: { enabled: false, health_state: 'online' } }) };
assert.ok(routetest.outcomeLinks('tim_first', strategies, routes, disabledLink)[0].links.indexOf('wan_tim') < 0, 'a disabled link is dropped');
assert.equal(routetest.outcomeLinks('tim_first', strategies, routes, null)[0].links[0], 'wan_tim', 'without live status links count as usable');

// link: Tim is offline, Str takes over
let result = run({ destination: 'www.youtube.com', proto: 'tcp', port: '443' });
assert.equal(result.outcome, 'link');
assert.equal(result.matched.rule.name, 'youtube');
assert.equal(result.matched.index, 0);
assert.equal(result.path, 'tim_first');
assert.deepEqual(result.usable, [ 'wan_str', 'wan_str6' ]);
assert.equal(result.text, 'Matches rule "youtube" (#1) and goes through Str because Tim is offline.');
assert.deepEqual(result.steps.map(step => step.matched), [ true ]);
assert.ok(result.steps[0].because.indexOf('domain youtube.com matches') >= 0);

// link on the preferred path when everything is online, and both links down on a balanced strategy
result = run({ destination: 'youtube.com' }, rules, allOnline);
assert.equal(result.text, 'Matches rule "youtube" (#1) and goes through Tim.');
assert.deepEqual(result.usable, [ 'wan_tim', 'wan_tim6' ]);
result = run({ destination: 'example.com', source: { ip: '10.0.0.149', mac: 'aa:bb:cc:dd:ee:77' } }, rules, allOnline);
assert.equal(result.text, 'Matches rule "lan-pc" (#4) and is shared between Tim and Str.');

// ports, protocol, port ranges
result = run({ destination: 'olery.com', proto: 'tcp', port: '8050' });
assert.equal(result.matched.rule.name, 'olery');
assert.equal(result.text, 'Matches rule "olery" (#2) and goes through Str.');
result = run({ destination: 'olery.com', proto: 'tcp', port: '80' });
assert.equal(result.matched.rule.name, 'default_rule_v4', 'wrong port falls through to the default rule');
assert.ok(result.steps[1].because.indexOf('port 80 is not 443,8000-8100') >= 0, result.steps[1].because.join());
assert.equal(result.steps[1].matched, false);
result = run({ destination: 'olery.com', proto: 'udp', port: '443' });
assert.ok(result.steps[1].because.indexOf('protocol udp is not tcp') >= 0);
result = run({ destination: 'olery.com' });
assert.ok(result.steps[1].because.some(reason => /no protocol chosen/.test(reason)), 'an unchosen protocol does not match a TCP-only rule');
result = run({ destination: 'olery.com', proto: 'tcp' });
assert.ok(result.steps[1].because.some(reason => /no port chosen/.test(reason)));

// who: mac, ip, nothing chosen
result = run({ destination: 'example.com', source: { mac: 'aa:bb:cc:dd:ee:01' } });
assert.equal(result.matched.rule.name, 'phone');
assert.equal(result.text, 'Matches rule "phone" (#3) and goes through Wg vpn.');
result = run({ destination: 'example.com', source: { mac: 'aa:bb:cc:dd:ee:01' } }, rules, wgDown);
assert.equal(result.outcome, 'stops');
assert.equal(result.text, 'Matches rule "phone" (#3) and stops because Wg vpn is unavailable.');
assert.deepEqual(result.usable, []);
result = run({ destination: 'example.com', source: { mac: 'aa:bb:cc:dd:ee:99', ip: '10.0.0.77' } });
assert.equal(result.matched.rule.name, 'default_rule_v4');
assert.ok(result.steps[2].because[0].indexOf('MAC address aa:bb:cc:dd:ee:99 is not') == 0);
result = run({ destination: 'example.com' });
assert.ok(result.steps[2].because[0].indexOf('only for aa:bb:cc:dd:ee:01, no device chosen') == 0);
result = run({ destination: 'example.com', source: { ip: '10.0.0.5' } });
assert.equal(result.outcome, 'unknown', 'a MAC rule cannot be checked with only an IP address');
assert.equal(result.maybe.rule.name, 'phone');
assert.equal(result.text.indexOf('Cannot tell: rule "phone" (#3) depends on the MAC address of the device.'), 0, result.text);
assert.equal(result.ifNot.outcome, 'link', 'ifNot assumes the unknown rule does not apply');
assert.equal(result.ifNot.matched.rule.name, 'default_rule_v4');
assert.ok(result.text.indexOf(' Otherwise: Matches rule "default_rule_v4"') > 0);
result = run({ destination: 'example.com', source: { iface: 'guest', ip: '10.9.0.5', mac: 'aa:bb:cc:dd:ee:55' } }, [ rule('guest', { src_iface: 'guest', via: 'tim_first' }) ].concat(rules), allOnline);
assert.equal(result.matched.rule.name, 'guest');
result = run({ destination: 'example.com', source: { iface: 'lan', ip: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:55' } }, [ rule('guest', { src_iface: 'guest', via: 'tim_first' }) ].concat(rules), allOnline);
assert.equal(result.matched.rule.name, 'default_rule_v4');

// disabled rules are listed and skipped
result = run({ destination: 'example.org' });
assert.deepEqual(result.steps.filter(step => step.rule.name == 'old').map(step => [ step.matched, step.because ]), [ [ false, [ 'disabled' ] ] ]);
assert.equal(result.matched.rule.name, 'default_rule_v4');

// blocked
result = run({ destination: 'ads.example.net' });
assert.equal(result.outcome, 'blocked');
assert.equal(result.text, 'Matches rule "ads" (#6) and is blocked.');

// normal routing: default path and "uses normal routing if unavailable"
result = run({ destination: 'example.com' }, [ rule('direct', { domain: [ 'example.com' ], via: 'default' }) ]);
assert.equal(result.outcome, 'normal');
assert.equal(result.text, 'Matches rule "direct" (#1) and uses normal routing.');
result = run({ destination: 'example.com' }, [ rule('tim', { domain: [ 'example.com' ], via: 'tim_only' }) ]);
assert.equal(result.outcome, 'normal');
assert.equal(result.text, 'Matches rule "tim" (#1) and uses normal routing because no WAN link in the path is available.');
result = run({ destination: 'example.com' }, [ rule('other', { domain: [ 'example.org' ] }) ]);
assert.equal(result.outcome, 'normal');
assert.equal(result.matched, null);
assert.equal(result.text, 'No routing rule matches, so this traffic uses normal routing.');

// stops with several links
result = run({ destination: 'youtube.com' }, rules, { interfaces: Object.assign({}, status.interfaces, { wan_str: iface('offline', 'ipv4'), wan_str6: iface('offline', 'ipv6') }) });
assert.equal(result.outcome, 'stops');
assert.equal(result.text, 'Matches rule "youtube" (#1) and stops because Tim and Str are unavailable.');
result = run({ destination: 'youtube.com' }, rules, { interfaces: Object.assign({}, status.interfaces, { wan_tim: iface('held', 'ipv4'), wan_tim6: iface('held', 'ipv6') }) });
assert.equal(result.text, 'Matches rule "youtube" (#1) and goes through Str because Tim is on hold.');

// missing path
result = run({ destination: 'example.com' }, [ rule('lost', { domain: [ 'example.com' ], via: 'gone' }) ]);
assert.equal(result.outcome, 'unknown');
assert.equal(result.matched.rule.name, 'lost');
assert.equal(result.text, 'Matches rule "lost" (#1) and uses the path "gone", which does not exist.');

// IPv4 and IPv6 destinations
result = run({ destination: '203.0.113.7' }, ipRules, allOnline);
assert.equal(result.matched.rule.name, 'office');
assert.equal(result.text, 'Matches rule "office" (#1) and goes through Wg vpn.');
assert.ok(result.steps[0].because[0].indexOf('address 203.0.113.7 is in 203.0.113.0/24') == 0);
result = run({ destination: '2001:db8:1::5' }, ipRules, allOnline);
assert.equal(result.matched.rule.name, 'office', 'an IPv6 CIDR inside a mixed rule matches');
result = run({ destination: '2001:db8:2::5' }, ipRules);
assert.equal(result.matched.rule.name, 'default_rule_v6');
assert.deepEqual(result.usable, [ 'wan_str6' ], 'IPv6 traffic only considers the IPv6 links');
assert.equal(result.text, 'Matches rule "default_rule_v6" (#4) and goes through Str because Tim is offline.');
assert.ok(result.steps[2].because[0].indexOf('rule only covers IPv4') == 0, 'the IPv4 default rule is skipped for IPv6');
result = run({ destination: '198.51.100.9', proto: 'icmp' }, ipRules);
assert.equal(result.matched.rule.name, 'icmp4');
result = run({ destination: '2001:db8:2::5', proto: 'icmp' }, ipRules);
assert.equal(result.matched.rule.name, 'default_rule_v6', 'icmp rules are IPv4 only');
result = run({ destination: '198.51.100.9', proto: 'tcp' }, ipRules);
assert.equal(result.matched.rule.name, 'default_rule_v4');

// domain vs address: what cannot be known
result = run({ destination: 'example.com' }, [ rule('lan', { dest_ip: [ '203.0.113.0/24' ], via: 'wg_wan_only' }) ].concat(rules.slice(-2)));
assert.equal(result.outcome, 'unknown');
assert.equal(result.matched, null);
assert.equal(result.maybe.rule.name, 'lan');
assert.equal(result.steps.length, 1, 'evaluation stops at the unknown rule');
assert.deepEqual(result.steps[0], { rule: result.maybe.rule, index: 0, matched: 'unknown', because: [ 'depends on the address the domain resolves to' ] });
assert.equal(result.ifNot.matched.rule.name, 'default_rule_v4');
assert.equal(result.ifNot.steps[0].matched, 'unknown');
assert.equal(result.ifNot.outcome, 'link');
result = run({ destination: 'example.com' }, [ rule('set', { ipset: 'streaming', via: 'str_first' }) ]);
assert.equal(result.outcome, 'unknown');
assert.equal(result.ifNot.outcome, 'normal');
result = run({ destination: 'example.com' }, [ rule('a', { domain: [ 'example.org' ], via: 'tim_first' }) , rule('set', { ipset: 'streaming' }) ]);
assert.equal(result.steps[0].matched, false, 'a definite miss earlier is kept and evaluation reaches the unknown rule');
assert.equal(result.maybe.rule.name, 'set');
assert.ok(result.steps[1].because[0].indexOf('depends on the address the domain resolves to') == 0);
result = run({ destination: '203.0.113.7' });
assert.equal(result.outcome, 'unknown', 'a domain rule cannot be checked against an address');
assert.equal(result.maybe.rule.name, 'youtube');
assert.equal(result.ifNot.matched.rule.name, 'default_rule_v4', 'ifNot skips the domain rules and the device rules');
result = run({ destination: '203.0.113.7', source: { mac: 'aa:bb:cc:dd:ee:99' } }, [ rules[2] ].concat(rules.slice(-2)));
assert.equal(result.outcome, 'link');
assert.equal(result.matched.rule.name, 'default_rule_v4');
result = run({ destination: 'example.com', source: { ip: '10.0.0.149' } }, [ rule('hole', { dest_ip: [ '203.0.113.0/24' ] }), rule('dev', { src_ip: [ '10.0.0.0/24' ], via: 'tim_first' }) ]);
assert.equal(result.outcome, 'unknown', 'a definite later match is not trusted past an unknown rule');
assert.equal(result.ifNot.matched.rule.name, 'dev');
result = run({ destination: 'example.com' }, [ rule('hole', { dest_ip: [ '0.0.0.0/0', '::/0' ], via: 'tim_first' }) ]);
assert.equal(result.outcome, 'link', 'a /0 range covers whatever the domain resolves to');
result = run({ source: { mac: 'aa:bb:cc:dd:ee:01' } }, rules.slice(2, 3));
assert.equal(result.matched.rule.name, 'phone', 'a device-only rule matches without a destination');
result = run({}, rules.slice(0, 1));
assert.equal(result.outcome, 'unknown');
assert.equal(result.maybe.rule.name, 'youtube');
assert.ok(result.steps[0].because[0].indexOf('no destination given') == 0);

// DSCP and source port cannot be known
result = run({ destination: 'example.com' }, [ rule('voice', { dscp: '46', via: 'tim_first' }) ]);
assert.equal(result.outcome, 'unknown');
result = run({ destination: 'example.com', dscp: 46 }, [ rule('voice', { dscp: '46', via: 'tim_first' }) ]);
assert.equal(result.matched.rule.name, 'voice');
result = run({ destination: 'example.com', dscp: 10 }, [ rule('voice', { dscp: '46', via: 'tim_first' }) ]);
assert.equal(result.outcome, 'normal');
result = run({ destination: 'example.com', proto: 'tcp' }, [ rule('sp', { proto: 'tcp', src_port: '5000', via: 'tim_first' }) ]);
assert.equal(result.steps[0].because.indexOf('depends on the source port') >= 0, true);

// a rule with no restrictions matches everything and says why
result = run({ destination: 'example.com' }, [ rule('all', { via: 'default' }) ]);
assert.deepEqual(result.steps[0].because, [ 'no restrictions, matches all traffic' ]);

// local only changes router-originated traffic, never the LAN answer
result = run({ destination: 'example.com' }, [ rule('loc', { domain: [ 'example.com' ], local: '1', via: 'default' }) ]);
assert.equal(result.outcome, 'normal');

// input drafts may omit empty fields and use scalar lists
result = run({ destination: 'example.com' }, [ { name: 'bare', domain: 'example.com', via: 'default' } ]);
assert.equal(result.matched.rule.name, 'bare');
assert.equal(result.text, 'Matches rule "bare" (#1) and uses normal routing.');

// every text is readable
[ { destination: 'youtube.com' }, { destination: '203.0.113.7' }, { destination: '2001:db8::1' }, { destination: 'ads.example.net' },
	{}, { destination: 'olery.com', proto: 'tcp', port: '443' }, { destination: 'x.org', source: { ip: '1.1.1.1' } } ].forEach(query => {
	[ rules, ipRules, [] ].forEach(list => [ status, allOnline, null ].forEach(live => {
		let out = run(query, list, live);
		assert.ok(!noJunk(out), JSON.stringify(out.text));
		assert.ok(out.text.length > 10);
	}));
});

console.log('routetest tests passed');
