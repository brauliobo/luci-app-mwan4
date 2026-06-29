#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const jsFiles = [
	'htdocs/luci-static/resources/mwan4/common.js',
	'htdocs/luci-static/resources/view/mwan4/network/globals.js',
	'htdocs/luci-static/resources/view/mwan4/network/interfaces.js',
	'htdocs/luci-static/resources/view/mwan4/network/overview.js',
	'htdocs/luci-static/resources/view/mwan4/network/routes.js',
	'htdocs/luci-static/resources/view/mwan4/network/rules.js',
	'htdocs/luci-static/resources/view/mwan4/network/strategies.js',
	'htdocs/luci-static/resources/view/mwan4/status/diagnostics.js',
	'htdocs/luci-static/resources/view/mwan4/status/overview.js'
];

function read(file) {
	return fs.readFileSync(path.join(root, file), 'utf8');
}

function assertContains(source, needle, message) {
	assert.ok(source.includes(needle), message || `expected copy: ${needle}`);
}

const menu = read('root/usr/share/luci/menu.d/luci-app-mwan4.json');
const pot = read('po/templates/mwan4.pot');
const combined = jsFiles.map(read).join('\n') + '\n' + menu;

for (const needle of [
	'WAN link',
	'WAN Links',
	'Traffic policies',
	'traffic policy',
	'Policy path',
	'Health check',
	'health check',
	'SLA',
	'Fail closed (reject traffic)',
	'Fail closed (drop traffic)',
	'main routing table'
])
	assertContains(combined, needle);

for (const needle of [
	"_('MultiWAN 4 - Interfaces')",
	"_('MultiWAN 4 - Routes')",
	"_('MultiWAN 4 - Rules')",
	"_('Traffic rules')",
	"_('No policy rules yet.')",
	"_('Add policy rule')",
	"_('Policy rule: %s')",
	"_('Reject traffic')",
	"_('Drop traffic')",
	"_('No tracking targets')",
	"_('Tracking targets')",
	"_('Tracking method')"
])
	assert.equal(combined.includes(needle), false, `stale or ambiguous copy remains: ${needle}`);

for (const pattern of [
	/policy rules/i,
	/traffic rules/i,
	/terminal action/i,
	/default route/i,
	/mwan4 interfaces/i,
	/no active route/i
])
	assert.doesNotMatch(combined, pattern, `non-canonical terminology matched ${pattern}`);

for (const pattern of [
	/E\('li', \[ v \]\)/,
	/\[object Object\]/
])
	assert.doesNotMatch(combined, pattern, `unsafe raw object output matched ${pattern}`);

for (const needle of [
	'msgid "WAN link"',
	'msgid "Traffic policies"',
	'msgid "Policy path"',
	'msgid "Fail closed (reject traffic)"',
	'msgid "Use main routing table"'
])
	assertContains(pot, needle, `POT is missing ${needle}`);

console.log('i18n and copy expectations passed');
