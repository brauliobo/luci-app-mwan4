#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const rules = new Function('baseclass', '_', read('htdocs/luci-static/resources/mwan4/rules.js'))({ extend: definition => definition }, text => text);
const kinds = text => Object.fromEntries(Object.entries(rules.classifyEntries(text)).filter(([ , values ]) => values.length));

assert.deepEqual(kinds('youtube.com\n203.0.113.0/24, Netflix.COM; 2001:db8::/32 youtube.com'), {
	domain: [ 'youtube.com', 'netflix.com' ],
	ip:     [ '203.0.113.0/24', '2001:db8::/32' ]
}, 'mixed input is classified into domains and IP/CIDR entries without duplicates');
assert.deepEqual(kinds('https://user@www.Example.org:8443/a/b?c=d\n*.example.net\n.example.io.'), {
	domain: [ 'www.example.org', 'example.net', 'example.io' ]
}, 'URLs, wildcard prefixes, and trailing dots are normalised to bare domains');
assert.deepEqual(kinds('AA-BB-CC-DD-EE-FF'), { mac: [ 'aa:bb:cc:dd:ee:ff' ] }, 'MAC addresses are normalised');

for (const bad of [ '999.1.1.1', '10.0.0.0/33', '1.2.3', 'localhost', 'a b!', '2001:db8:::1', '2001:db8::/129', 'ex ample.com', '-bad-.com', 'example.c', 'example.com:443', 'rm -rf /;' ])
	assert.ok(rules.classifyEntries(bad).invalid.length > 0, `${bad} must be rejected`);

for (const good of [ '0.0.0.0/0', '192.168.1.1', '::/0', '::1', 'fe80::1/64', '2001:db8:0:0:0:0:0:1', 'xn--bcher-kva.example' ])
	assert.equal(rules.classifyEntries(good).invalid.length, 0, `${good} must be accepted`);

assert.ok(rules.isValidPortList('443, 8000-9000 53:60'), 'port lists accept values and ranges');
for (const bad of [ '', '0', '70000', '9000-8000', 'http' ])
	assert.equal(rules.isValidPortList(bad), false, `port list ${bad} must be rejected`);
assert.deepEqual([ '1', '46', '63' ].map(rules.isValidDscp), [ true, true, true ]);
assert.deepEqual([ '0', '64', 'af41', '' ].map(rules.isValidDscp), [ false, false, false, false ]);

assert.deepEqual(rules.ruleFamilies({ proto: 'all', dest_ip: [], src_ip: [] }), [ 'ipv4', 'ipv6' ], 'domain-only rules are dual-stack');
assert.deepEqual(rules.ruleFamilies({ proto: 'all', dest_ip: [ '10.0.0.0/8' ], src_ip: [] }), [ 'ipv4' ]);
assert.deepEqual(rules.ruleFamilies({ proto: 'all', dest_ip: [ '10.0.0.0/8', '2001:db8::/32' ], src_ip: [ '192.168.1.2' ] }), [ 'ipv4' ],
	'every address list must have an entry for each emitted family');
assert.deepEqual(rules.ruleFamilies({ proto: 'icmpv6', dest_ip: [ '10.0.0.0/8' ], src_ip: [] }), []);
assert.deepEqual(rules.ruleFamilies({ proto: 'icmp', dest_ip: [], src_ip: [] }), [ 'ipv4' ]);

assert.equal(rules.sectionName('Work VPN', []), 'work_vpn');
assert.equal(rules.sectionName('A very long rule name for the tv', []), 'a_very_long_rul');
assert.equal(rules.sectionName('!!!', []), 'rule');
assert.equal(rules.sectionName('Work VPN', [ 'work_vpn' ]), 'work_vpn_2');
assert.equal(rules.sectionName('A very long rule name', [ 'a_very_long_rul', 'a_very_long_r_2' ]), 'a_very_long_r_3');
assert.ok(rules.sectionName('A very long rule name', [ 'a_very_long_rul' ]).length <= 15);

const routes = [
	{ '.name': 'r1', interface: 'wan_b', metric: '2' },
	{ '.name': 'r2', interface: 'wan_a', metric: '1' },
	{ '.name': 'r3', interface: 'wan_a6', metric: '1' },
	{ '.name': 'r4', interface: 'wan_a', metric: '3' }
];

assert.deepEqual(rules.strategyWans({ use_route: [ 'r1', 'r2', 'r3', 'r4', 'missing' ] }, routes).map(wan => wan.name), [ 'wan_a', 'wan_a6', 'wan_b' ],
	'strategy WANs are ordered by metric and deduplicated');
assert.deepEqual(rules.strategyWans(null, routes), []);
assert.deepEqual(rules.wanGroups([ 'wan_b', 'wan_a', 'wan_a6' ], routes), [ [ 'wan_a', 'wan_a6' ], [ 'wan_b' ] ], 'IPv6 siblings join their WAN and groups follow route metrics');
assert.deepEqual(rules.presetPlan('prefer', 'wan_b', [ [ 'wan_a', 'wan_a6' ], [ 'wan_b' ] ]), {
	strategy: 'wan_b_first',
	routes:   [ { interface: 'wan_b', metric: 1 }, { interface: 'wan_a', metric: 2 }, { interface: 'wan_a6', metric: 2 } ]
});
assert.deepEqual(rules.presetPlan('only', 'wan_a', [ [ 'wan_a', 'wan_a6' ], [ 'wan_b' ] ]), {
	strategy: 'wan_a_only',
	routes:   [ { interface: 'wan_a', metric: 1 }, { interface: 'wan_a6', metric: 1 } ]
});

const counters = { mwan4_counter_rule_tv_ipv4: { packets: 3, bytes: 30 }, mwan4_counter_rule_tv_ipv6: { packets: 2, bytes: 20 }, mwan4_counter_rule_tv2_ipv4: { packets: 9, bytes: 9 } };

assert.deepEqual(rules.ruleHits(counters, 'tv'), { packets: 5, bytes: 50, found: true });
assert.equal(rules.ruleHits(counters, 'none').found, false);

assert.deepEqual(rules.hostDevices({ 'AA:BB:CC:DD:EE:02': { name: 'laptop', ipv4: '192.168.1.3' }, 'aa:bb:cc:dd:ee:01': { ipaddrs: [ '192.168.1.2' ] } }), [
	{ mac: 'aa:bb:cc:dd:ee:01', name: '', ip: '192.168.1.2' },
	{ mac: 'aa:bb:cc:dd:ee:02', name: 'laptop', ip: '192.168.1.3' }
], 'host hints are normalised from both hint formats');

const rawRules = read('htdocs/luci-static/resources/view/mwan4/network/rules.js');

for (const option of [ 'label', 'enabled', 'domain', 'src_mac', 'dscp', 'local' ])
	assert.match(rawRules, new RegExp(`s\\.option\\(form\\.\\w+, '${option}'`), `raw Rules page must expose ${option}`);

console.log('rules helper expectations passed');
