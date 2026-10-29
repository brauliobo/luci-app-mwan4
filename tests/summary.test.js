#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

String.prototype.format = function(...values) {
	return this.replace(/%%|%[sd]/g, token => token == '%%' ? '%' : String(values.shift()));
};

const source = fs.readFileSync(path.resolve(__dirname, '../htdocs/luci-static/resources/mwan4/summary.js'), 'utf8');
const summary = new Function('baseclass', '_', source)({ extend: definition => definition }, text => text);

const ready = { hasLinks: true, enabledLinkCount: 2, hasRouting: true, hasRules: true };
const up = { online: 2, offline: 0, total: 2 };
const state = (progress, live, warnings, operator) => summary.commandState(Object.assign({}, ready, progress), live || up, warnings || 0, operator !== false);

// first run, one step at a time
assert.deepEqual([ state({ hasLinks: false }).action.id, state({ hasLinks: false }).label ], [ 'addLink', 'Setup needed' ]);
assert.equal(state({ enabledLinkCount: 0 }).action.id, 'reviewLinks');
assert.equal(state({ hasRouting: false }).action.id, 'chooseRouting');
assert.equal(state({ hasRouting: false }).label, 'Routing needed');
assert.equal(state({ hasRules: false }).action.id, 'chooseRouting');
assert.equal(state({ hasRules: false }).label, 'Default routing needed');
for (const progress of [ { hasLinks: false }, { enabledLinkCount: 0 }, { hasRouting: false }, { hasRules: false } ])
	assert.deepEqual([ state(progress).tone, state(progress).pill ], [ 'setup', 'mwan4-warning' ]);

// a working setup
let ok = state({});

assert.deepEqual([ ok.tone, ok.pill, ok.label, ok.action.id ], [ 'ready', 'mwan4-online', 'Ready', 'addRule' ]);
assert.equal(ok.summary, 'Everything is working: all 2 WAN links are online.');

// runtime problems rank above a healthy state, and the action depends on who may restart
assert.deepEqual([ state({}, up, 2).label, state({}, up, 2).action.id ], [ 'Needs attention', 'restart' ]);
assert.equal(state({}, up, 2, false).action.id, 'refresh');
assert.match(state({}, up, 2, false).summary, /Ask an operator/);
assert.deepEqual([ state({}, { online: 0, offline: 0, total: 0 }).label, state({}, { online: 0, offline: 0, total: 0 }).action.id ], [ 'Starting', 'restart' ]);
assert.equal(state({}, { online: 0, offline: 0, total: 0 }, 0, false).action.id, 'refresh');

let degraded = state({}, { online: 1, offline: 1, total: 2 });

assert.deepEqual([ degraded.label, degraded.tone, degraded.action.id ], [ 'Degraded', 'warning', 'reviewLinks' ]);
assert.equal(degraded.summary, '1 of 2 WAN links are not fully online, so there is less backup. Traffic avoids them.');
assert.equal(state({ hasLinks: false }, up, 3).label, 'Setup needed', 'setup comes before runtime warnings');

// plain words: none of the old technical vocabulary
for (const item of [ state({ hasLinks: false }), state({ enabledLinkCount: 0 }), state({ hasRouting: false }), state({ hasRules: false }), ok, degraded, state({}, up, 1), state({}, { total: 0 }) ])
	assert.ok(!/strateg|polic|generated|runtime|netifd|mode/i.test(item.summary + item.label + item.action.label), `jargon in "${item.summary}"`);

console.log('summary tests passed');
