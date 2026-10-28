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
const baseclass = { extend: definition => definition };
const identity = text => text;
const connections = new Function('baseclass', 'rpc', 'mwan4Common', 'L', 'E', '_', read('htdocs/luci-static/resources/mwan4/connections.js'))(
	baseclass, rpc, { formatBytes: String, element: () => null }, {}, () => null, identity);
const L = { resolveDefault: (promise, fallback) => Promise.resolve(promise).catch(() => fallback) };
const E = (tag, attrs, children) => ({ tag, attrs, children });
const stability = new Function('baseclass', 'rpc', 'mwan4Common', 'mwan4Connections', 'L', 'E', '_', read('htdocs/luci-static/resources/mwan4/stability.js'))(
	baseclass, rpc, { element: E }, connections, L, E, identity);

const runtime = {
	held:         { active: true, reason: 'flapping', until: 1700000300, remaining: 120 },
	flaps:        { count_window: 3, total: 17 },
	availability: { pct_1h: 91.25, pct_24h: 99.97 },
	degraded_for: [ 'failover', 'streaming' ]
};

assert.deepEqual(stability.heldInfo(runtime), { reason: 'flapping', remaining: 120, until: 1700000300 });
assert.equal(stability.heldInfo({ held: { active: false } }), null, 'an inactive hold is not shown');
assert.equal(stability.heldInfo({}), null, 'an old backend has no hold');
assert.deepEqual(stability.flapInfo(runtime), { window: 3, total: 17 });
assert.equal(stability.flapInfo({}), null, 'missing flap counters stay unknown instead of 0');
assert.equal(stability.flapInfo({ flaps: 5 }), null, 'a malformed flap field is ignored');
assert.deepEqual(stability.availabilityInfo(runtime), { h1: 91.25, h24: 99.97 });
assert.deepEqual(stability.availabilityInfo({ availability: { pct_24h: 100 } }), { h1: null, h24: 100 });
assert.equal(stability.availabilityInfo({}), null);
assert.deepEqual(stability.degradedStrategies(runtime), [ 'failover', 'streaming' ]);
assert.deepEqual(stability.degradedStrategies({ degraded_for: 'x' }), [], 'a non-list degraded_for is ignored');

assert.equal(stability.formatPct(91.25), '91.3%');
assert.equal(stability.formatPct(100), '100%');
assert.equal(stability.formatPct(null), '-');

assert.equal(stability.hasStabilityData({ interfaces: { wan: runtime } }), true);
assert.equal(stability.hasStabilityData({ interfaces: { wan: { status: 'online' } } }), false, 'an old backend status carries no stability data');
assert.equal(stability.hasStabilityData(null), false);
assert.equal(stability.supported(true, {}), true, 'link_history alone enables the UI');
assert.equal(stability.supported(false, { interfaces: { wan: runtime } }), true, 'status fields alone enable the UI');
assert.equal(stability.supported(false, { interfaces: { wan: {} } }), false);

assert.equal(stability.isHistory({ ok: true, interfaces: {} }), true);
for (const bad of [ null, {}, { ok: false, interfaces: {} }, { ok: true } ])
	assert.equal(stability.isHistory(bad), false, `${JSON.stringify(bad)} is not a link_history reply`);

const history = { ok: true, interfaces: { wan: { events: [
	{ time: 300, state: 'offline', reason: 'tracker' }, { time: 100, state: 'online', reason: 'start' }, { time: 'x', state: 'bad' }
] } } };
assert.deepEqual(stability.events(stability.historyEntry(history, 'wan')).map(event => event.time), [ 100, 300 ], 'events are sorted and malformed ones dropped');
assert.deepEqual(stability.historyEntry(history, 'missing'), {}, 'an unknown interface has an empty history');
assert.deepEqual(stability.historyEntry(null, 'wan'), {});

const list = stability.events(history.interfaces.wan);
assert.deepEqual(stability.strip(list, 400, 200), [
	{ state: 'online', from: 0, to: 0.5 },
	{ state: 'offline', from: 0.5, to: 1 }
], 'the strip starts with the state in force at the window start and ends at now');
assert.deepEqual(stability.strip([], 1000, 100), [ { state: 'unknown', from: 0, to: 1 } ], 'no events render one unknown segment');
assert.equal(stability.strip(list, 50, 100).slice(-1)[0].to, 1, 'events ahead of the browser clock still fit the strip');

assert.equal(stability.remainingNow(120, 1000, 1000), 120);
assert.equal(stability.remainingNow(120, 1000, 31999), 90, 'the countdown floors elapsed time');
assert.equal(stability.remainingNow(10, 0, 60000), 0, 'the countdown never goes negative');

let intervals = 0;
global.window = { setInterval: () => ++intervals, clearInterval: () => {} };
const countdown = stability.renderCountdown(75);
assert.equal(countdown.attrs['data-mwan4-remaining'], 75);
assert.deepEqual(countdown.children, [ '1m 15s' ]);
stability.renderCountdown(5);
assert.equal(intervals, 1, 'a single shared ticker serves every countdown');
assert.equal(stability.renderCountdown(null), null, 'a hold without a remaining time has no countdown');

assert.equal(stability.reasonLabel('flapping'), 'flapping');
assert.equal(stability.reasonLabel('custom'), 'custom', 'unknown reasons are shown verbatim');
assert.equal(stability.singleTarget([ '1.1.1.1' ]), true);
assert.equal(stability.singleTarget([ '1.1.1.1', '8.8.8.8' ]), false);
assert.equal(stability.singleTarget([]), false, 'no targets is a different problem');

assert.equal(stability.effectiveDefault('flap_window', { flap_window: '600' }), '600', 'a global value is the effective default');
assert.equal(stability.effectiveDefault('flap_window', {}), '300', 'the built-in default applies without a global value');
assert.equal(stability.summary({ flap_window: '', flush_grace: '' }), 'Global defaults');
assert.match(stability.summary({ flap_window: '60' }), /Flap window \(seconds\) 60/);

const added = [];
const form = { Value: 'Value', ListValue: 'ListValue' };
const section = { option: (type, name, label) => { const o = { type, name, label, values: [] , value: (...v) => o.values.push(v) }; added.push(o); return o; } };
stability.addFormOptions(section, form, { flap_window: '600' }, true);
assert.deepEqual(added.map(o => o.name), [ 'flap_damping', 'flap_threshold', 'flap_window', 'flap_holddown', 'recovery_hold', 'flush_grace' ]);
assert.equal(added[0].type, 'ListValue');
assert.deepEqual(added[0].values.map(v => v[0]), [ '', '1', '0' ], 'flap damping can inherit, enable, or disable');
assert.equal(added[2].placeholder, '600', 'the raw tab shows the effective global default as placeholder');
assert.equal(added[1].datatype, 'min(2)', 'flap_threshold must be at least 2');
assert.ok(added.every(o => o.optional && o.modalonly), 'every stability option is optional');

added.length = 0;
stability.addQualityOptions(section, form);
assert.deepEqual(added.map(o => [ o.name, o.datatype ]), [ [ 'max_latency', 'min(1)' ], [ 'max_loss', 'range(0,100)' ] ]);
assert.match(added[0].description, /check_quality/, 'the quality fields explain the check_quality requirement');

(async () => {
	calls.length = 0;
	assert.equal(await stability.probe(), false, 'an empty reply is not a link_history backend');
	assert.deepEqual(calls[0], [ 'link_history', [ null, null, 1 ] ]);
	await stability.queryHistory('wan', 50);
	assert.deepEqual(calls[1], [ 'link_history', [ 'wan', null, 50 ] ]);

	for (const file of [ 'interfaces', 'strategies', 'globals' ])
		assert.match(read(`htdocs/luci-static/resources/view/mwan4/network/${file}.js`), /mwan4Stability\.(probe|addFormOptions|addQualityOptions)/, `the raw ${file} tab uses the stability helper`);
	assert.doesNotMatch(read('htdocs/luci-static/resources/view/mwan4/network/overview.js'), /<details|<summary|E\('details'|E\('summary'/, 'no expanders in the overview');

	console.log('stability tests passed');
})();
