#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../htdocs/luci-static/resources/mwan4');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

String.prototype.format = function(...values) {
	return this.replace(/%%|%[sd]/g, token => token == '%%' ? '%' : String(values.shift()));
};

const baseclass = { extend: definition => definition };
const identity = text => text;
const mwan4Rules = new Function('baseclass', '_', read('rules.js'))(baseclass, identity);
const mwan4Templates = new Function('baseclass', 'mwan4Rules', '_', read('templates.js'))(baseclass, mwan4Rules, identity);
const wanform = new Function('baseclass', 'mwan4Templates', '_', read('wanform.js'))(baseclass, mwan4Templates, identity);

const networks = [ 'lan', 'loopback', 'wan', 'wan6', 'wan_tim', 'lte' ].map(name => ({ '.name': name, proto: name == 'wan6' ? 'dhcpv6' : name == 'lan' ? 'static' : 'dhcp' }));

// interfaces that can still become a WAN link come first
assert.deepEqual(wanform.interfaceChoices(networks, [ 'wan_tim' ]),
	[ [ 'lte', 'lte' ], [ 'wan', 'wan' ], [ 'wan6', 'wan6' ], [ 'lan', 'lan' ], [ 'wan_tim', 'wan_tim (already a WAN link)' ] ], 'static interfaces such as the LAN come after the others');
assert.deepEqual(wanform.interfaceChoices(networks, [ 'wan', 'lan' ]).map(item => item[0]), [ 'lte', 'wan_tim', 'wan6', 'lan', 'wan' ], 'used interfaces sink to the end');
assert.deepEqual(wanform.interfaceChoices([], []), []);
assert.ok(wanform.interfaceChoices(networks, []).every(item => item[0] != 'loopback'), 'the loopback is never a WAN link');

// the family follows the interface
assert.equal(wanform.familyFor('wan', networks), 'ipv4');
assert.equal(wanform.familyFor('wan6', networks), 'ipv6', 'a dhcpv6 interface is IPv6');
assert.equal(wanform.familyFor('wan_tim6', []), 'ipv6', 'a trailing 6 in the name is IPv6');
assert.equal(wanform.familyFor('lte', networks), 'ipv4');
assert.equal(wanform.familyFor('tun', [ { '.name': 'tun', proto: '6in4' } ]), 'ipv6');
assert.equal(wanform.familyFor('ip6tnl', []), 'ipv4', 'a 6 inside the name is not a family');

// what choosing a profile fills in
const all = mwan4Templates.HEALTH_KEYS;
const base = all.slice(0, 4);

assert.deepEqual(wanform.profileFill('balanced', {}), Object.fromEntries(all.map(key => [ key, '' ])), 'the defaults are emptied');
assert.deepEqual(wanform.profileFill('sensitive', {}), {
	interval: '5', down: '3', up: '3', reliability: '', flap_damping: '', flap_threshold: '', flap_window: '', flap_holddown: '60', recovery_hold: '10'
});
assert.equal(wanform.profileFill('tolerant', {}).flap_window, '600');
assert.deepEqual(Object.keys(wanform.profileFill('sensitive', {}, base)), base, 'a form without stability fields only fills the base fields');
assert.deepEqual(wanform.profileFill('balanced', { flap_holddown: '300' }, all).flap_holddown, '120', 'a changed global default is written out so the profile still holds');
assert.equal(wanform.profileFill('balanced', { flap_holddown: '120' }).flap_holddown, '', 'a global equal to the default needs nothing');
assert.deepEqual(wanform.profileFill('custom', {}), {}, 'custom fills nothing');

// the fields tell which profile they spell
const filled = id => Object.assign({}, wanform.profileFill(id, {}));

for (const id of [ 'sensitive', 'balanced', 'tolerant' ])
	assert.equal(mwan4Templates.profileFor(filled(id), {}), id, `${id} is recognised from its own fields`);
assert.equal(mwan4Templates.profileFor(Object.assign(filled('sensitive'), { down: '4' }), {}), 'custom', 'editing one field makes it custom');
assert.equal(mwan4Templates.profileFor(wanform.profileFill('sensitive', {}, base), {}, base), 'sensitive', 'the base fields alone are enough without stability');
assert.equal(mwan4Templates.profileFor(wanform.profileFill('sensitive', {}, base), {}), 'custom', 'but they cannot name a profile that also needs the stability fields');
assert.equal(mwan4Templates.profileFor(wanform.profileFill('balanced', { flap_holddown: '300' }, all), { flap_holddown: '300' }), 'balanced', 'written-out defaults keep the profile');

// the select shows each profile with its plain summary
assert.deepEqual(mwan4Templates.profileOptions(), [
	[ 'sensitive', 'Sensitive: notices an outage in about 15 s' ],
	[ 'balanced', 'Balanced: notices an outage in about 50 s' ],
	[ 'tolerant', 'Tolerant: notices an outage in about 1.5 min' ],
	[ 'custom', 'Custom' ]
]);
assert.deepEqual(mwan4Templates.profileValues('sensitive', base), { interval: '5', down: '3', up: '3', reliability: null }, 'keys limit what is returned');

console.log('wanform tests passed');
