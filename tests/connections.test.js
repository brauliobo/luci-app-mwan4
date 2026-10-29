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

const calls = [];
const rpc = { declare: spec => (...args) => { calls.push([ spec.method, args ]); return Promise.resolve({}); } };
const connections = new Function('baseclass', 'rpc', 'mwan4Common', 'L', 'E', '_', read('htdocs/luci-static/resources/mwan4/connections.js'))(
	{ extend: definition => definition }, rpc, { formatBytes: String }, {}, () => null, text => text);

assert.deepEqual(connections.queryArgs({ rule: 'streaming', family: 'ipv6' }, 50),
	[ 'streaming', undefined, undefined, 'ipv6', undefined, undefined, 50, 0 ], 'filters map to positional rpc params, empty filters are undefined, never null: LuCI would send JSON null and ubus rejects the call');
assert.deepEqual(connections.queryArgs({}), [ undefined, undefined, undefined, undefined, undefined, undefined, 200, 0 ], 'the default limit is 200');

assert.equal(connections.probeTotal({ ok: true, total: 7, items: [] }), 7, 'a connections reply yields the total');
for (const bad of [ null, {}, { ok: false, items: [] }, { total: 3 }, { ok: true, total: 3, items: 'x' } ])
	assert.equal(connections.probeTotal(bad), null, `${JSON.stringify(bad)} marks connections unavailable`);

const counters = { rules: { streaming: { new_connections: { ipv4: 30, ipv6: 10, total: 40 }, active_connections: { ipv4: 2, ipv6: 1 } } } };
assert.deepEqual(connections.ruleStats('streaming', {}, counters), {
	active:  { ipv4: 2, ipv6: 1, total: 3 },
	created: { ipv4: 30, ipv6: 10, total: 40 }
}, 'rule stats keep the family split and derive a missing total');
assert.equal(connections.ruleStats('other', {}, counters), null, 'unknown rules have no stats');
assert.equal(connections.ruleStats('streaming', {}, {}), null, 'an old backend without per-rule fields has no stats');
assert.equal(connections.ruleStats('streaming', counters, {}).active.total, 3, 'stats are also read from the status reply');

const status = { interfaces: { wan: { active_connections: { ipv4: 5, ipv6: 0, total: 5 } }, lte: {} }, strategy_status: { ipv4: { failover: { active_connections: 4 } }, ipv6: { failover: { active_connections: 1 } } } };
assert.equal(connections.interfaceActive('wan', status), 5);
assert.equal(connections.interfaceActive('lte', status), null, 'missing interface counts stay unknown instead of 0');
assert.equal(connections.strategyActive('failover', status), 5, 'strategy counts sum both families');
assert.equal(connections.strategyActive('missing', status), null);

assert.deepEqual([ 45, 125, 7260, undefined ].map(connections.formatTtl), [ '45s', '2m 5s', '2h 1m', '-' ]);
assert.equal(connections.formatEndpoint('192.0.2.1', 443), '192.0.2.1:443');
assert.equal(connections.formatEndpoint('2001:db8::1', 443), '[2001:db8::1]:443', 'IPv6 endpoints with a port are bracketed');
assert.equal(connections.formatEndpoint('192.0.2.1', ''), '192.0.2.1', 'ICMP has no port');

const source = read('htdocs/luci-static/resources/mwan4/connections.js');

assert.match(source, /_\('Rule'\), _\('WAN link'\) \]/, 'the column says which WAN link carries the connection');
assert.match(source, /field\('interface', _\('WAN link'\), _\('Any WAN link'\)\)/, 'the interface filter is a WAN link filter');
assert.match(source, /field\('strategy', _\('Path'\), _\('Any path'\)\)/, 'the strategy filter is a path filter');
assert.ok(!/Via WAN|Any strategy|_\('Strategy'\)/.test(source), 'no strategy or Via WAN wording is left');

assert.match(read('htdocs/luci-static/resources/view/mwan4/network/rules.js'), /form\.DummyValue, 'rule_id'/, 'the raw Rules tab shows rule_id read-only');

console.log('connections tests passed');
