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

const explain = new Function('baseclass', '_', read('htdocs/luci-static/resources/mwan4/explain.js'))({ extend: definition => definition }, text => text);

const route = (name, wan, metric) => ({ '.name': name, interface: wan, metric: String(metric) });
const routes = [
	route('r_tim', 'wan_tim', 1), route('r_tim6', 'wan_tim6', 1), route('r_str', 'wan_str', 2), route('r_str6', 'wan_str6', 2),
	route('r_viv', 'wan_vivo', 3), route('b_tim', 'wan_tim', 1), route('b_str', 'wan_str', 1), route('r_wg', 'wg_vpnu_usmi', 1),
	route('m_tim', 'wan_tim', 1), route('m_str', 'wan_str', 2), route('m_viv', 'wan_vivo', 1), route('v6only', 'wan_x6', 1),
	route('f_str', 'wan_str', 1), route('f_str6', 'wan_str6', 1), route('f_tim', 'wan_tim', 2), route('f_tim6', 'wan_tim6', 2), route('f_viv', 'wan_vivo', 3)
];
const strategies = [
	{ '.name': 'failover', use_route: [ 'f_tim', 'f_viv', 'f_tim6', 'f_str', 'f_str6' ] },
	{ '.name': 'balanced', use_route: [ 'b_tim', 'b_str' ], last_resort: 'default' },
	{ '.name': 'mixed', use_route: [ 'm_tim', 'm_str', 'm_viv' ] },
	{ '.name': 'tunnel', use_route: 'r_wg', last_resort: 'blackhole' },
	{ '.name': 'tim_only', use_route: [ 'r_tim', 'r_tim6' ], last_resort: 'default' },
	{ '.name': 'empty', use_route: [] },
	{ '.name': 'v6', use_route: [ 'v6only' ] }
];
const devices = [ { mac: 'aa:bb:cc:dd:ee:01', name: 'Living-room TV', ip: '192.168.1.20' }, { mac: 'aa:bb:cc:dd:ee:02', name: '', ip: '192.168.1.21' } ];
const ctx = { devices: devices, strategies: strategies, routes: routes };
const draft = (extra) => Object.assign({
	label: '', enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all', src_port: '', dest_port: '',
	dscp: '', local: '0', ipset: '', via: 'failover', sticky: '0', timeout: '600', logging: '0'
}, extra);
const outputs = [];
const TEXT_KEYS = [ 'text', 'phrase', 'tail', 'via', 'what', 'who', 'how', 'flags', 'label', 'link', 'links', 'tiers', 'path' ];
const texts = value => typeof value == 'string' ? [ value ] : Array.isArray(value) ? value.flatMap(texts)
	: value && typeof value == 'object' ? Object.entries(value).filter(([ key ]) => TEXT_KEYS.indexOf(key) >= 0).flatMap(([ , item ]) => texts(item)) : [];
const keep = value => { outputs.push(...texts(value)); return value; };

// labels and siblings
assert.equal(explain.linkLabel('wan_tim'), 'Tim');
assert.equal(explain.linkLabel('wan_tim6'), 'Tim');
assert.equal(explain.linkLabel('wg_vpnu_usmi'), 'Vpnu usmi');
assert.equal(explain.linkLabel('wan2'), 'Wan2', 'a digit after a digit is part of the name');
assert.equal(explain.linkLabel('wan6'), 'Wan');
assert.deepEqual(explain.groupLinks([ 'wan_tim', 'wan_str', 'wan_tim6', 'wan_str6', 'wan_vivo' ]), [
	{ key: 'wan_tim', label: 'Tim', members: [ 'wan_tim', 'wan_tim6' ] },
	{ key: 'wan_str', label: 'Str', members: [ 'wan_str', 'wan_str6' ] },
	{ key: 'wan_vivo', label: 'Vivo', members: [ 'wan_vivo' ] }
], 'siblings collapse and first appearance order is kept');
assert.deepEqual(explain.groupLinks([ 'wan_tim6', 'wan_tim' ])[0].members, [ 'wan_tim', 'wan_tim6' ], 'order of input does not split a pair');
assert.deepEqual(explain.groupLinks([ 'wan_x6' ]), [ { key: 'wan_x6', label: 'X (IPv6)', members: [ 'wan_x6' ] } ], 'an IPv6-only link says so');
assert.deepEqual(explain.groupLinks([ 'wan_a', 'wg_a', 'wan_a' ]).map(group => group.label), [ 'Wan a', 'Wg a' ], 'equal labels fall back to the full name');

// state
const up = { status: 'online', up: true };
const status = { interfaces: {
	wan_tim: up, wan_tim6: { health_state: 'offline' }, wan_str: up, wan_str6: up, wan_vivo: { health_state: 'offline' },
	wan_held: { health_state: 'online', held: { active: true, reason: 'flapping', remaining: 60 } }, wan_off: { health_state: 'disabled' }
} };
const group = names => explain.groupLinks(names)[0];
assert.deepEqual(explain.linkState(group([ 'wan_str', 'wan_str6' ]), status), { state: 'online', text: 'online' });
assert.deepEqual(explain.linkState(group([ 'wan_tim', 'wan_tim6' ]), status), { state: 'online', text: 'IPv6 offline' });
assert.deepEqual(explain.linkState(group([ 'wan_vivo' ]), status), { state: 'offline', text: 'offline' });
assert.deepEqual(explain.linkState(group([ 'wan_held' ]), status), { state: 'held', text: 'on hold' });
assert.deepEqual(explain.linkState(group([ 'wan_off' ]), status), { state: 'disabled', text: 'disabled' });
assert.deepEqual(explain.linkState(group([ 'wan_new' ]), status), { state: 'unknown', text: 'status unknown' });
assert.deepEqual(explain.linkState(group([ 'wan_tim' ]), {}), { state: 'unknown', text: 'status unknown' }, 'no status yet');
assert.equal(explain.linkState(group([ 'wan_tim', 'wan_tim6' ]), { interfaces: { wan_tim: { health_state: 'offline' }, wan_tim6: { health_state: 'online' } } }).text, 'IPv4 offline');
assert.equal(explain.linkState(group([ 'wan_x6' ]), { interfaces: { wan_x6: { health_state: 'offline' } } }).text, 'offline', 'a lone IPv6 link is just offline');
assert.equal(explain.linkState(group([ 'wan_tim', 'wan_tim6' ]), { interfaces: { wan_tim: { health_state: 'held' }, wan_tim6: { health_state: 'offline' } } }).state, 'held');

// paths
const summary = via => keep(explain.pathSummary(via, strategies, routes));
let p = summary('failover');
assert.equal(p.kind, 'first');
assert.equal(p.failure, 'stops');
assert.equal(p.text, 'Str first, then Tim, then Vivo; stops if none is available');
assert.deepEqual(p.links.map(link => link.key), [ 'wan_str', 'wan_tim', 'wan_vivo' ], 'metric order with siblings collapsed');
p = summary('balanced');
assert.deepEqual([ p.kind, p.failure ], [ 'balance', 'normal' ]);
assert.equal(p.text, 'Balanced across Tim and Str; uses normal routing if none is available');
p = summary('mixed');
assert.equal(p.kind, 'first');
assert.equal(p.text, 'Tim and Vivo (balanced) first, then Str; stops if none is available');
p = summary('tunnel');
assert.deepEqual([ p.kind, p.failure ], [ 'only', 'drops' ]);
assert.equal(p.text, 'Only Vpnu usmi; drops traffic if Vpnu usmi is unavailable');
p = summary('tim_only');
assert.equal(p.kind, 'only', 'IPv4 and IPv6 of one link are one link');
assert.equal(p.text, 'Only Tim; uses normal routing if Tim is unavailable');
assert.equal(summary('v6').text, 'Only X (IPv6); stops if X (IPv6) is unavailable');
p = summary('default');
assert.deepEqual([ p.kind, p.failure, p.text ], [ 'main', 'normal', 'Normal routing (main table)' ]);
assert.deepEqual(p.links, []);
p = summary('unreachable');
assert.deepEqual([ p.kind, p.failure, p.text ], [ 'stop', 'stops', 'Blocked (rejected)' ]);
p = summary('blackhole');
assert.deepEqual([ p.kind, p.failure, p.text ], [ 'drop', 'drops', 'Blocked (dropped)' ]);
p = summary('empty');
assert.deepEqual([ p.kind, p.failure ], [ 'custom', 'stops' ]);
assert.equal(p.text, 'Path empty has no WAN links; stops if none is available');
assert.equal(summary('nope').kind, 'custom', 'an unknown path is reported, not thrown');

p = summary('prefer:wan_str');
assert.equal(p.kind, 'first');
assert.equal(p.text, 'Str first, then Tim, then Vivo, then Vpnu usmi, then X (IPv6); stops if none is available', 'preset without a saved path derives it from the routes');
p = summary('only:wan_tim6');
assert.equal(p.text, 'Only Tim; stops if Tim is unavailable', 'any sibling selects the whole link');
assert.equal(summary('only:wan_new').text, 'Only New; stops if New is unavailable');
assert.equal(explain.pathSummary('prefer:wan_tim', [ { '.name': 'wan_tim_first', use_route: [ 'r_tim', 'r_str' ], last_resort: 'default' } ], routes).text,
	'Tim first, then Str; uses normal routing if none is available', 'a saved preset path wins');

// nowVia
const now = (via, st) => keep(explain.nowVia(explain.pathSummary(via, strategies, routes), st));
const allUp = { interfaces: { wan_tim: up, wan_tim6: up, wan_str: up, wan_str6: up, wan_vivo: up, wg_vpnu_usmi: up } };
const off = name => ({ health_state: 'offline', name })
let n = now('failover', allUp);
assert.deepEqual([ n.link.key, n.state, n.text ], [ 'wan_str', 'online', 'Now: Str' ]);
n = now('failover', { interfaces: Object.assign({}, allUp.interfaces, { wan_str: off(), wan_str6: off() }) });
assert.deepEqual([ n.link.key, n.text ], [ 'wan_tim', 'Now: Tim (Str is offline)' ]);
n = now('failover', { interfaces: Object.assign({}, allUp.interfaces, { wan_str: off(), wan_str6: off(), wan_tim: off(), wan_tim6: { health_state: 'held' } }) });
assert.equal(n.text, 'Now: Vivo (Str is offline, Tim is on hold)', 'a skipped link is described by its best member');
n = now('balanced', allUp);
assert.deepEqual([ n.link.key, n.text ], [ 'wan_tim', 'Now: sharing Tim and Str' ]);
n = now('balanced', { interfaces: Object.assign({}, allUp.interfaces, { wan_str: off(), wan_str6: off() }) });
assert.equal(n.text, 'Now: Tim (Str is offline)');
n = now('tunnel', { interfaces: {} });
assert.deepEqual([ n.link, n.state, n.text ], [ null, 'offline', 'Now: no link available — traffic is dropped' ]);
assert.equal(now('tim_only', { interfaces: {} }).text, 'Now: no link available — normal routing');
assert.equal(now('failover', { interfaces: {} }).text, 'Now: no link available — traffic stops');
n = now('tim_only', { interfaces: { wan_tim: { health_state: 'held' }, wan_tim6: { health_state: 'held' } } });
assert.deepEqual([ n.state, n.text ], [ 'held', 'Now: Tim' ], 'the last usable link stays in use while on hold');
n = now('failover', { interfaces: { wan_tim: { health_state: 'held' }, wan_str: off(), wan_vivo: off() } });
assert.equal(n.text, 'Now: Tim (Str is offline)', 'a held link is chosen only when no link is online');
n = now('failover', { interfaces: { wan_tim: { held: { active: true }, health_state: 'online' }, wan_str: off(), wan_vivo: up } });
assert.equal(n.text, 'Now: Vivo (Str is offline, Tim is on hold)');
assert.deepEqual([ now('default', allUp).link, now('default', allUp).text ], [ null, 'Now: normal routing' ]);
assert.equal(now('unreachable', allUp).text, 'Now: blocked');

// rule sentences
const sentence = (extra) => keep(explain.ruleSentence(draft(extra), ctx));
assert.equal(sentence({ domain: [ 'youtube.com', 'googlevideo.com', 'ytimg.com', 'yt.be' ] }),
	'Sends youtube.com, googlevideo.com and 2 more from all devices through Str first, then Tim, then Vivo; stops if none is available');
assert.equal(sentence({ domain: [ 'a.com', 'b.com', 'c.com' ], via: 'prefer:wan_tim' }).slice(0, 38), 'Sends a.com, b.com and c.com from all ', 'three entries are all listed');
assert.equal(sentence({ domain: [ 'a.com' ], dest_ip: [ '203.0.113.0/24' ], via: 'default' }),
	'Sends a.com and 203.0.113.0/24 from all devices through normal routing (main table)');
assert.equal(sentence({ src_mac: [ 'AA:BB:CC:DD:EE:01' ], proto: 'tcp', dest_port: '443', via: 'tunnel' }),
	'Sends everything from Living-room TV (AA:BB:CC:DD:EE:01) on TCP port 443 through only Vpnu usmi; drops traffic if Vpnu usmi is unavailable');
assert.match(sentence({ src_mac: [ 'aa:bb:cc:dd:ee:02' ] }), /from 192\.168\.1\.21 \(aa:bb:cc:dd:ee:02\) through/, 'unnamed device shows its address');
assert.match(sentence({ src_mac: [ 'aa:bb:cc:dd:ee:99' ] }), /from aa:bb:cc:dd:ee:99 through/, 'unknown device shows the MAC');
assert.match(sentence({ src_mac: [ 'aa:bb:cc:dd:ee:99' ], src_ip: [ '10.0.0.5' ] }), /from aa:bb:cc:dd:ee:99 and 10\.0\.0\.5 through/);
assert.match(sentence({ src_iface: 'guest' }), /^Sends everything from all devices on network guest through/);
assert.match(sentence({ local: '1' }), /from all devices, including traffic from this router through/);
assert.match(sentence({ proto: 'udp', dest_port: '80 443', src_port: '1000-2000', dscp: '46' }), / on UDP ports 80, 443, source ports 1000-2000, DSCP 46 through/);
assert.match(sentence({ proto: 'icmp' }), / on ICMP through/);
assert.match(sentence({ dest_port: '8000-9000' }), / on ports 8000-9000 through/);
assert.match(sentence({ sticky: '1', timeout: '600', logging: '1', ipset: 'mine', domain: [ 'a.com' ] }),
	/\(keeps each device on one link for 10 min, logs matches, also matches set mine\)$/);
assert.match(sentence({ sticky: '1', timeout: '45' }), /for 45 s\)$/);
assert.match(sentence({ sticky: '1', timeout: '7200' }), /for 2 h\)$/);
assert.match(sentence({ ipset: 'mine' }), /^Sends addresses in set mine from/);
assert.equal(sentence({ enabled: '0', domain: [ 'a.com' ], via: 'unreachable' }), 'Disabled: Blocks a.com from all devices (rejected)');
assert.equal(sentence({ via: 'blackhole' }), 'Blocks everything from all devices (dropped)');
assert.equal(sentence({}), 'Sends everything from all devices through Str first, then Tim, then Vivo; stops if none is available', 'an empty rule matches everything');
assert.equal(sentence({ via: 'nope' }), 'Sends everything from all devices through path nope has no WAN links; stops if none is available');

const parts = keep(explain.ruleParts(draft({ domain: [ 'a.com' ], proto: 'tcp', dest_port: '443', local: '1', logging: '1', via: 'balanced' }), ctx));
assert.deepEqual([ parts.what, parts.who, parts.how, parts.via, parts.flags ], [
	'a.com', 'all devices, including traffic from this router', 'TCP port 443',
	'balanced across Tim and Str; uses normal routing if none is available', [ 'logs matches' ]
]);
assert.equal(parts.path.kind, 'balance');
assert.equal(keep(explain.ruleParts(draft({}), ctx)).how, '', 'no protocol or port gives an empty part');

// health
const health = section => keep(explain.healthSentence(section));
assert.equal(health({ track_ip: [ '1.1.1.1', '8.8.8.8' ], interval: '5', down: '3', up: '3', reliability: '1' }),
	'Pings 1.1.1.1 and 8.8.8.8 every 5 s; marked down after 3 failed checks and up again after 3 good ones; any one target answering keeps it up');
assert.equal(health({ track_ip: '1.1.1.1' }), 'Pings 1.1.1.1 every 10 s; marked down after 5 failed checks and up again after 5 good ones', 'defaults, single target');
assert.match(health({ track_ip: [ 'a.com', 'b.com', 'c.com' ], reliability: '2', down: '1', up: '1' }), /after 1 failed check and up again after 1 good one; at least 2 of 3 targets must answer$/);
assert.match(health({ track_ip: [ '1.1.1.1', '8.8.8.8' ], reliability: '5' }), /all 2 targets must answer$/);
assert.match(health({ track_ip: [ '1.1.1.1' ], track_method: 'nslookup', interval: '60' }), /^Looks up DNS names on 1\.1\.1\.1 every 1 min;/);
assert.match(health({ track_ip: [ '192.168.1.1' ], track_method: 'arping' }), /^Sends ARP requests to 192\.168\.1\.1 every 10 s/);
assert.ok(!/degraded/.test(health({ track_ip: [ '1.1.1.1' ], check_quality: '0', failure_latency: '900' })), 'quality limits only with check_quality');
assert.ok(!/degraded/.test(health({ track_ip: [ '1.1.1.1' ], track_method: 'arping', check_quality: '1' })), 'quality needs a method that measures it');
assert.match(health({ track_ip: [ '1.1.1.1' ], check_quality: '1' }), /; treated as degraded above 1000 ms or 40% loss, and healthy again below 500 ms and 10%$/);
assert.match(health({ track_ip: [ '1.1.1.1' ], check_quality: '1', failure_latency: '300', failure_loss: '20', recovery_latency: '100', recovery_loss: '2' }),
	/above 300 ms or 20% loss, and healthy again below 100 ms and 2%$/);
assert.equal(health({}), 'No check targets are set, so this link is not tested');

// glossary
const terms = explain.glossary();
for (const term of [ 'WAN link', 'Routing rule', 'Path', 'Use first', 'Use only', 'Balance', 'Stops if unavailable', 'Uses normal routing if unavailable',
	'Health check', 'Check target', 'Hold', 'Flap', 'Failback hold', 'Sticky session', 'DSCP' ])
	assert.ok(terms[term] && terms[term].length > 10 && terms[term].length < 120, `glossary has a short definition for ${term}`);
outputs.push(...Object.entries(terms).flat());

// vocabulary
assert.ok(outputs.length > 30);
for (const out of outputs) {
	for (const bad of [ 'undefined', 'null', '[object', 'NaN', 'fails closed', 'strategy', 'member', 'interface' ])
		assert.ok(out.indexOf(bad) < 0, `"${bad}" must not appear in ${out}`);
}

console.log('explain tests passed');
