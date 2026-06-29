#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readJSON(file) {
	return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function read(file) {
	return fs.readFileSync(path.join(root, file), 'utf8');
}

function keys(object) {
	return Object.keys(object || {}).sort();
}

function filePermissions(role, level) {
	return role?.[level]?.file || {};
}

function ubusPermissions(role, level, object) {
	return role?.[level]?.ubus?.[object] || [];
}

const acl = readJSON('root/usr/share/rpcd/acl.d/luci-app-mwan4.json');
const menu = readJSON('root/usr/share/luci/menu.d/luci-app-mwan4.json');
const statusView = read('htdocs/luci-static/resources/view/mwan4/status/overview.js');
const networkView = read('htdocs/luci-static/resources/view/mwan4/network/overview.js');
const diagnosticsView = read('htdocs/luci-static/resources/view/mwan4/status/diagnostics.js');
const commonView = read('htdocs/luci-static/resources/mwan4/common.js');

assert.deepEqual(keys(acl), [
	'luci-app-mwan4',
	'luci-app-mwan4-diagnostics',
	'luci-app-mwan4-operator',
	'luci-app-mwan4-status'
], 'ACL should expose separate status, config, operator, and diagnostics roles');

assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-status'], 'read', 'mwan4'), [ 'status' ],
	'status ACL should only grant mwan4 ubus status reads');
assert.equal(acl['luci-app-mwan4-status'].write, undefined,
	'status ACL must not grant write permissions');
assert.deepEqual(filePermissions(acl['luci-app-mwan4-status'], 'read'), {},
	'status ACL must not grant file exec permissions');

assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4'], 'read')), [
	'/usr/bin/arping',
	'/usr/bin/httping',
	'/usr/bin/nping'
], 'config ACL read file access should only list optional tracker binaries');
assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4'], 'write')), [],
	'config ACL must not grant service control exec permissions');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4'], 'read', 'mwan4'), [ 'capabilities', 'status', 'validate' ],
	'config ACL should read only status/capabilities/validation from mwan4 ubus');
assert.deepEqual(acl['luci-app-mwan4'].write?.uci, [ 'mwan4' ],
	'config ACL should write only mwan4 UCI');

assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4-operator'], 'write')), [],
	'operator ACL must not grant shell command exec permissions');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-operator'], 'read', 'mwan4'), [ 'capabilities', 'status' ],
	'operator ACL should have status readback for control refreshes');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-operator'], 'write', 'mwan4'), [ 'control' ],
	'operator ACL should grant only the constrained mwan4 control ubus method');

assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4-diagnostics'], 'read')), [],
	'diagnostics ACL must not grant shell command exec permissions');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-diagnostics'], 'read', 'mwan4'), [ 'capabilities', 'diagnostics' ],
	'diagnostics ACL should grant only the diagnostics rpcd contract methods');
assert.equal(acl['luci-app-mwan4-diagnostics'].write, undefined,
	'diagnostics ACL must not grant writes');
assert.equal(acl['luci-app-mwan4-diagnostics'].read?.uci, undefined,
	'diagnostics ACL must not grant UCI reads');

assert.equal(menu['admin/network/mwan4'].depends?.acl, undefined,
	'network parent must not impose an inherited ACL on split child routes');

for (const route of [
	'admin/network/mwan4/overview',
	'admin/network/mwan4/interfaces',
	'admin/network/mwan4/routes',
	'admin/network/mwan4/strategies',
	'admin/network/mwan4/rules',
	'admin/network/mwan4/globals',
	'admin/network/mwan4/diagnostics'
]) {
	assert.equal(menu[route].depends?.acl?.length, 1, `${route} should declare exactly one route ACL`);
}

assert.equal(menu['admin/status/mwan4'].depends?.acl?.[0], 'luci-app-mwan4-status',
	'status page should depend on read-only status ACL');
assert.equal(menu['admin/network/mwan4/overview'].depends?.acl?.[0], 'luci-app-mwan4',
	'overview page should remain available to config ACL users');
assert.equal(menu['admin/network/mwan4/diagnostics'].depends?.acl?.[0], 'luci-app-mwan4-diagnostics',
	'diagnostics page should use diagnostics ACL');

assert.match(statusView, /window\.location\.replace\(target\)/,
	'status view should redirect to the overview instead of rendering duplicate controls');
assert.doesNotMatch(statusView, /luci-app-mwan4-operator|method:\s*'control'/,
	'status redirect must not expose operator-only runtime controls');
assert.doesNotMatch(statusView, /fs\.exec_direct|\/usr\/sbin\/mwan4/,
	'status view must not execute mwan4 commands directly');
assert.match(networkView, /luci-app-mwan4-operator/,
	'network overview should explicitly check operator ACL before rendering controls');
assert.match(networkView, /method:\s*'control'/,
	'network overview should use mwan4 control ubus for runtime controls');
assert.doesNotMatch(networkView, /fs\.exec_direct|\/usr\/sbin\/mwan4/,
	'network overview must not execute mwan4 commands directly');
assert.match(networkView, /L\.resolveDefault\(callSessionAccess\('access-group', 'luci-app-mwan4-operator', 'write'\), false\)/,
	'network overview should treat missing operator checks as no access');
assert.match(networkView, /if \(hasOperatorAccess\) \{/,
	'network overview should gate interface controls on operator access');
assert.match(networkView, /if \(configuredLinks && hasOperatorAccess\)/,
	'network overview should gate empty-health restart controls on operator access');
assert.match(networkView, /hasOperatorAccess\s*\?\s*runMwan4\(\[ 'restart' \]\)/,
	'network overview should restart through control rpc only when operator access is present');
assert.match(networkView, /mwan4Common\.renderRuntimeWarnings/,
	'network overview should use shared runtime warning rendering');
assert.doesNotMatch(networkView, /function renderDiagnostics/,
	'network overview should not carry a duplicate runtime warning renderer');
assert.doesNotMatch(statusView, /mwan4Common\.renderRuntimeWarnings/,
	'status redirect should leave runtime warning rendering to the overview');
assert.match(diagnosticsView, /method:\s*'diagnostics'/,
	'diagnostics view should use the mwan4 diagnostics ubus method');
assert.match(diagnosticsView, /\[ 'counters', _\('Counters'\) \]/,
	'diagnostics view should expose the diagnostics counters section');
assert.match(diagnosticsView, /function renderDiagnosticsResult/,
	'diagnostics view should render diagnostics as structured guidance, not raw JSON only');
assert.match(diagnosticsView, /mwan4Common\.renderNextSteps/,
	'diagnostics view should use shared next-step troubleshooting guidance');
assert.match(diagnosticsView, /Raw RPC response/,
	'diagnostics view should keep raw RPC output available for support/debugging');
assert.match(diagnosticsView, /luci-app-mwan4-diagnostics/,
	'diagnostics view should explicitly check diagnostics ACL before enabling controls');
assert.doesNotMatch(diagnosticsView, /fs\.exec_direct|\/usr\/sbin\/mwan4/,
	'diagnostics view must not execute mwan4 commands directly');
assert.match(commonView, /function renderRuntimeWarnings/,
	'shared helper should own runtime warning rendering');
assert.match(commonView, /function renderNextSteps/,
	'shared helper should own status next-step rendering');
assert.match(commonView, /What should I check next\?/,
	'shared helper should label the troubleshooting flow');
assert.match(commonView, /warning\.check/,
	'shared runtime warning renderer should show backend check hints');

console.log('ACL security expectations passed');
