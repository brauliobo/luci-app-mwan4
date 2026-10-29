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
const rules = new Function('baseclass', '_', read('htdocs/luci-static/resources/mwan4/rules.js'))(baseclass, identity);
const templates = new Function('baseclass', 'mwan4Rules', '_', read('htdocs/luci-static/resources/mwan4/templates.js'))(baseclass, rules, identity);

const ctx = {
	links:   [ { key: 'wan_tim', label: 'Tim' }, { key: 'wg_wan', label: 'Wg wan' } ],
	devices: [ { mac: 'aa:bb:cc:dd:ee:ff', name: 'Phone', ip: '192.168.1.20' } ]
};
const byId = Object.fromEntries(templates.ruleTemplates().map(template => [ template.id, template ]));
const clean = text => assert.ok(!/undefined|null|\[object/.test(text), `"${text}" must not leak internals`);

assert.deepEqual(Object.keys(byId), [ 'site-link', 'site-only', 'device-link', 'device-vpn', 'block', 'game', 'custom' ]);

const samples = {
	'site-link':   { what: 'YouTube.com', link: 'wan_tim' },
	'site-only':   { what: 'bank.example.com', link: 'wg_wan' },
	'device-link': { who: 'aa:bb:cc:dd:ee:ff', link: 'wan_tim' },
	'device-vpn':  { who: '192.168.1.20 aa-bb-cc-dd-ee-ff', link: 'wg_wan' },
	'block':       { what: 'ads.example.com' },
	'game':        { ports: '3074, 27015:27030', link: 'wan_tim' }
};

const expected = {
	'site-link':   { label: 'youtube.com via Tim', via: 'prefer:wan_tim', domain: [ 'youtube.com' ] },
	'site-only':   { label: 'bank.example.com via Wg wan', via: 'only:wg_wan', domain: [ 'bank.example.com' ] },
	'device-link': { label: 'Phone via Tim', via: 'prefer:wan_tim', src_mac: [ 'aa:bb:cc:dd:ee:ff' ] },
	'device-vpn':  { label: 'Phone +1 via Wg wan', via: 'only:wg_wan', src_ip: [ '192.168.1.20' ], src_mac: [ 'aa:bb:cc:dd:ee:ff' ] },
	'block':       { label: 'Block ads.example.com', via: 'blackhole', domain: [ 'ads.example.com' ] },
	'game':        { label: 'UDP port 3074,27015-27030 via Tim', via: 'prefer:wan_tim', proto: 'udp', dest_port: '3074,27015-27030' }
};

for (const [ id, values ] of Object.entries(samples)) {
	const template = byId[id];
	const draft = template.build(values, ctx);

	assert.deepEqual(Object.keys(draft).sort(), Object.keys(byId.custom.build({}, ctx)).sort(), `${id} builds a complete draft`);
	assert.deepEqual(Object.fromEntries(Object.keys(expected[id]).map(key => [ key, draft[key] ])), expected[id], `${id} draft`);
	assert.equal(draft.enabled, '1');
	assert.equal(rules.classifyEntries([].concat(draft.domain, draft.dest_ip, draft.src_ip, draft.src_mac).join(' ')).invalid.length, 0);
	assert.ok(draft.domain.length + draft.dest_ip.length + draft.src_ip.length + draft.src_mac.length || draft.dest_port, `${id} matches something`);
	assert.ok(draft.label, `${id} gets an automatic label`);
	assert.ok(rules.ruleFamilies(draft).length > 0);
	assert.ok(template.fields.length > 0 && template.fields.every(field => field.required && field.label && field.help && 'placeholder' in field));
	assert.deepEqual(template.fields.map(field => field.name).sort(), Object.keys(values).map(key => key == 'link' ? 'link' : key).sort(), `${id} fields`);
	assert.equal(templates.templateFor(draft, ctx), id, `${id} round trips`);
	assert.equal(templates.autoLabel(draft, ctx), draft.label);
	[ template.title, template.summary, draft.label ].forEach(clean);
}

assert.ok(byId['device-vpn'].fields.find(field => field.name == 'link').label.match(/VPN/), 'the device VPN template asks for a tunnel');
assert.deepEqual(byId.custom.fields.map(field => field.required), [ false, false, false ], 'a custom rule needs nothing');
assert.equal(byId.custom.build({}, ctx).label, '', 'a blank custom rule has no label');
assert.equal(byId.custom.build({}, ctx).via, 'default');
assert.deepEqual(byId.custom.build({ what: 'a.example.com', who: '10.0.0.5', link: 'wan_tim' }, ctx).src_ip, [ '10.0.0.5' ]);

// Generated labels
assert.equal(templates.autoLabel(byId['site-link'].build({ what: 'a.example.com b.example.com c.example.com', link: 'wan_tim' }, ctx), ctx),
	'a.example.com +2 via Tim');
assert.equal(byId['site-link'].build({ what: '203.0.113.0/24', link: 'wan_tim' }, ctx).dest_ip[0], '203.0.113.0/24');
assert.equal(byId['site-link'].build({ what: 'a.example.com', link: 'unknown' }, ctx).label, 'a.example.com via unknown', 'unknown links keep their key');
assert.equal(templates.autoLabel(byId.custom.build({ what: 'a.example.com', who: '10.0.0.5' }, ctx), ctx), 'a.example.com from 10.0.0.5 via normal routing');
assert.equal(templates.autoLabel({ ...byId.custom.build({}, ctx), domain: [ 'a.example.com' ], via: 'unreachable' }), 'Block a.example.com', 'ctx is optional');

// Saved drafts carry the generated strategy name instead of the preset
const saved = { ...byId['site-link'].build(samples['site-link'], ctx), via: 'wan_tim_first' };
assert.equal(templates.templateFor(saved, ctx), 'site-link', 'strategies generated by presets are recognised');
assert.equal(templates.autoLabel(saved, ctx), 'youtube.com via Tim');
assert.equal(templates.templateFor({ ...saved, via: 'wan_tim_only' }, ctx), 'site-only');
assert.equal(templates.templateFor({ ...saved, via: 'wan_gone_first' }, ctx), 'custom', 'a strategy of an unknown link is custom');
assert.equal(templates.templateFor({ ...saved, via: 'failover' }, ctx), 'custom', 'hand-made strategies are custom');
assert.equal(templates.templateFor({ ...saved, via: 'default' }, ctx), 'custom');

// Advanced options and mixed matches are custom rules
const base = byId['site-link'].build(samples['site-link'], ctx);

for (const advanced of [ { dscp: '46' }, { ipset: 'x' }, { sticky: '1' }, { logging: '1' }, { src_port: '5000' }, { local: '1' }, { src_iface: 'lan' },
	{ dest_port: '443' }, { proto: 'tcp' }, { src_mac: [ 'aa:bb:cc:dd:ee:ff' ] } ])
	assert.equal(templates.templateFor({ ...base, ...advanced }, ctx), 'custom', `${Object.keys(advanced)} makes a custom rule`);

assert.equal(templates.templateFor({ ...base, enabled: '0', name: 'x', label: 'My name' }, ctx), 'site-link', 'name and state do not matter');
assert.equal(templates.templateFor(byId.custom.build({}, ctx), ctx), 'custom');

// applyTemplate keeps what the template does not own
const advanced = { ...base, name: 'rule1', label: 'My rule', dscp: '46', logging: '1', enabled: '0', src_mac: [ 'aa:bb:cc:dd:ee:ff' ] };
const applied = templates.applyTemplate(advanced, 'block', { what: 'ads.example.com' }, ctx);

assert.equal(applied.name, 'rule1');
assert.equal(applied.label, 'My rule', 'a name set by the user is kept');
assert.equal(applied.enabled, '0');
assert.equal(applied.dscp, '46');
assert.equal(applied.logging, '1');
assert.deepEqual([ applied.via, applied.domain, applied.src_mac ], [ 'blackhole', [ 'ads.example.com' ], [] ]);
assert.equal(templates.applyTemplate(base, 'block', { what: 'ads.example.com' }, ctx).label, 'Block ads.example.com', 'an automatic label follows the template');
assert.deepEqual(templates.applyTemplate(advanced, 'custom', {}, ctx), advanced, 'custom leaves the draft alone');
assert.deepEqual(base.domain, [ 'youtube.com' ], 'the input draft is not mutated');

// Health profiles
const profiles = templates.healthProfiles();
const stabilityDefaults = /DEFAULTS\s*=\s*\{([^}]*)\}/.exec(read('htdocs/luci-static/resources/mwan4/stability.js'))[1];

assert.deepEqual(profiles.map(profile => profile.id), [ 'sensitive', 'balanced', 'tolerant' ]);
assert.equal(new Set(profiles.map(profile => JSON.stringify(profile.values))).size, 3, 'all profiles differ');
assert.equal(new Set(profiles.map(profile => profile.title)).size, 3);
assert.deepEqual(Object.fromEntries(stabilityDefaults.split(',').map(pair => pair.split(':').map(part => part.trim().replace(/'/g, '')))),
	{ flap_damping: '1', flap_threshold: '3', flap_window: '300', flap_holddown: '120', recovery_hold: '30', flush_grace: '10' });
for (const match of stabilityDefaults.matchAll(/(\w+):\s*'(\d+)'/g))
	if (match[1] in templates.HEALTH_DEFAULTS)
		assert.equal(templates.HEALTH_DEFAULTS[match[1]], match[2], `${match[1]} matches stability.js`);

for (const profile of profiles) {
	assert.deepEqual(Object.keys(profile.values).sort(), [ ...templates.HEALTH_KEYS ].sort());
	assert.equal(profile.detectSeconds, Number(profile.values.interval) * Number(profile.values.down));
	assert.equal(templates.profileFor(profile.values), profile.id, `${profile.id} classifies itself`);
	assert.equal(templates.profileFor(Object.fromEntries(Object.entries(profile.values).map(([ k, v ]) => [ k, Number(v) ]))), profile.id, 'numbers match strings');
	assert.ok(profile.summary.includes('about'), 'the summary states the detection time');
	clean(profile.summary);
	clean(profile.title);
}

const [ sensitive, balanced, tolerant ] = profiles;

assert.ok(sensitive.detectSeconds < balanced.detectSeconds && balanced.detectSeconds < tolerant.detectSeconds);
assert.ok(templates.recoverySeconds(sensitive.values) < templates.recoverySeconds(balanced.values));
assert.ok(templates.recoverySeconds(balanced.values) < templates.recoverySeconds(tolerant.values));
assert.deepEqual(balanced.values, templates.HEALTH_DEFAULTS, 'balanced is the package default');
assert.equal(templates.profileFor({}), 'balanced', 'an untouched link is balanced');
assert.equal(templates.profileFor(undefined), 'balanced');
assert.equal(templates.profileFor({ interval: '', down: null }), 'balanced', 'empty options are unset');
assert.equal(templates.profileFor({ interval: '7' }), 'custom');
assert.equal(templates.profileFor({ ...tolerant.values, down: '5' }), 'custom');
assert.equal(templates.profileFor({}, { flap_holddown: '300' }), 'custom', 'global overrides count as the link default');
assert.equal(templates.profileFor({ flap_holddown: '120' }, { flap_holddown: '300' }), 'balanced', 'link options win over globals');

assert.equal(templates.detectionSeconds({}), 50);
assert.equal(templates.detectionSeconds({ interval: '5', down: '3' }), 15);
assert.equal(templates.recoverySeconds({}), 80);
assert.equal(templates.recoverySeconds({ interval: '5', up: '2', recovery_hold: '0' }), 10);
assert.match(sensitive.summary, /about 15 s/);
assert.match(tolerant.summary, /about 1\.5 min/);

assert.deepEqual(templates.profileValues('balanced'), Object.fromEntries(templates.HEALTH_KEYS.map(key => [ key, null ])),
	'defaults are deleted, not written');
assert.deepEqual(templates.profileValues('sensitive'), {
	interval: '5', down: '3', up: '3', reliability: null, flap_damping: null, flap_threshold: null, flap_window: null, flap_holddown: '60', recovery_hold: '10'
});
assert.equal(templates.profileValues('tolerant').flap_window, '600');
assert.deepEqual(templates.profileValues('custom'), {}, 'custom has nothing to write');

for (const id of [ 'sensitive', 'balanced', 'tolerant' ]) {
	const stored = Object.fromEntries(Object.entries(templates.profileValues(id)).filter(([ , value ]) => value != null));

	assert.equal(templates.profileFor(stored), id, `${id} survives a write and read back`);
}

console.log('templates tests passed');
