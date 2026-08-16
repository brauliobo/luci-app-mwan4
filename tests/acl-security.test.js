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
const advancedView = read('htdocs/luci-static/resources/view/mwan4/network/advanced.js');
const interfacesView = read('htdocs/luci-static/resources/view/mwan4/network/interfaces.js');
const diagnosticsView = read('htdocs/luci-static/resources/view/mwan4/status/diagnostics.js');
const mptcpView = read('htdocs/luci-static/resources/view/mwan4/status/mptcp.js');
const commonView = read('htdocs/luci-static/resources/mwan4/common.js');
const diagnosticsHelper = read('htdocs/luci-static/resources/mwan4/diagnostics.js');

assert.deepEqual(keys(acl), [
	'luci-app-mwan4',
	'luci-app-mwan4-advanced',
	'luci-app-mwan4-diagnostics',
	'luci-app-mwan4-operator',
	'luci-app-mwan4-status'
], 'ACL should expose separate status, config, advanced, operator, and diagnostics roles');

assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-status'], 'read', 'mwan4'), [ 'status' ],
	'status ACL should only grant mwan4 ubus status reads');
assert.equal(acl['luci-app-mwan4-status'].write, undefined,
	'status ACL must not grant write permissions');
assert.deepEqual(filePermissions(acl['luci-app-mwan4-status'], 'read'), {},
	'status ACL must not grant file exec permissions');
assert.equal(acl['luci-app-mwan4-status'].read?.uci, undefined,
	'status ACL must not grant UCI reads');

assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4'], 'read')), [
	'/usr/bin/arping',
	'/usr/bin/httping',
	'/usr/bin/nping',
	'/usr/bin/nslookup'
], 'config ACL read file access should only list optional tracker binaries used by probe selectors');
assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4'], 'write')), [],
	'config ACL must not grant service control exec permissions');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4'], 'read', 'mwan4'), [ 'capabilities', 'diagnostics', 'status', 'validate' ],
	'config ACL should read status/capabilities/validation plus diagnostics needed by core config pages');
assert.deepEqual(acl['luci-app-mwan4'].read?.uci, [ 'mwan4', 'network' ],
	'config ACL should read only core mwan4 and netifd WAN configuration');
assert.deepEqual(acl['luci-app-mwan4'].write?.uci, [ 'mwan4', 'network' ],
	'config ACL should write only core mwan4 and netifd WAN configuration');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4'], 'write', 'mwan4'), [],
	'config ACL must not grant runtime control ubus methods');

assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4-advanced'], 'read')), [
	'/usr/bin/arping',
	'/usr/bin/httping',
	'/usr/bin/nping',
	'/usr/bin/nslookup'
], 'advanced ACL read file access should only list optional tracker binaries used by probe selectors');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-advanced'], 'read', 'mwan4'), [ 'capabilities', 'diagnostics', 'status', 'validate' ],
	'advanced ACL should read status/capabilities/validation/diagnostics for integration guidance');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-advanced'], 'write', 'mwan4'), [ 'advanced_control' ],
	'advanced ACL should grant only the constrained advanced_control ubus method');
assert.deepEqual(acl['luci-app-mwan4-advanced'].read?.uci, [ 'frr', 'ipsec', 'mwan4', 'network', 'openvpn', 'pbr' ],
	'advanced ACL should read external UCI packages managed by explicit Advanced workflows');
assert.deepEqual(acl['luci-app-mwan4-advanced'].write?.uci, [ 'frr', 'ipsec', 'mwan4', 'network', 'openvpn', 'pbr' ],
	'advanced ACL should write only the UCI packages managed by explicit Advanced workflows');

assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4-operator'], 'write')), [],
	'operator ACL must not grant shell command exec permissions');
assert.deepEqual(keys(filePermissions(acl['luci-app-mwan4-operator'], 'read')), [],
	'operator ACL must not grant read-side shell command exec permissions');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-operator'], 'read', 'mwan4'), [ 'capabilities', 'status' ],
	'operator ACL should have status readback for control refreshes');
assert.deepEqual(ubusPermissions(acl['luci-app-mwan4-operator'], 'write', 'mwan4'), [ 'control' ],
	'operator ACL should grant only the constrained mwan4 control ubus method');
assert.equal(acl['luci-app-mwan4-operator'].write?.uci, undefined,
	'operator ACL must not grant UCI writes');

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
	'admin/network/mwan4/advanced',
	'admin/network/mwan4/mptcp',
	'admin/network/mwan4/diagnostics'
]) {
	assert.equal(menu[route].depends?.acl?.length, 1, `${route} should declare exactly one route ACL`);
}

assert.equal(menu['admin/status/mwan4'].depends?.acl?.[0], 'luci-app-mwan4-status',
	'status page should depend on read-only status ACL');
assert.equal(menu['admin/network/mwan4/overview'].depends?.acl?.[0], 'luci-app-mwan4',
	'overview page should remain available to config ACL users');
assert.equal(menu['admin/network/mwan4/advanced'].depends?.acl?.[0], 'luci-app-mwan4-advanced',
	'advanced page should require the advanced integration ACL');
assert.equal(menu['admin/network/mwan4/mptcp'].depends?.acl?.[0], 'luci-app-mwan4',
	'MPTCP page should use the config ACL because it writes mwan4-owned UCI');
assert.equal(menu['admin/network/mwan4/diagnostics'].depends?.acl?.[0], 'luci-app-mwan4-diagnostics',
	'diagnostics page should use diagnostics ACL');

assert.match(statusView, /method:\s*'status'/,
	'status view should render read-only status data instead of redirecting to a config-gated route');
assert.match(statusView, /callSessionAccess\('access-group', 'luci-app-mwan4', 'read'\)/,
	'status view should check config ACL before linking to configuration pages');
assert.match(statusView, /callSessionAccess\('access-group', 'luci-app-mwan4-diagnostics', 'read'\)/,
	'status view should check diagnostics ACL before linking to diagnostics pages');
assert.doesNotMatch(statusView, /window\.location\.replace|luci-app-mwan4-operator|method:\s*'control'/,
	'status view must not redirect or expose operator-only runtime controls');
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
assert.match(networkView, /luci-app-mwan4-advanced/,
	'network overview should check advanced ACL before rendering the Advanced workspace link');
assert.match(networkView, /if \(hasOperatorAccess\) \{/,
	'network overview should gate interface controls on operator access');
assert.match(networkView, /hasOperatorAccess\s*\?\s*runMwan4\(\[ 'restart' \]\)/,
	'network overview should restart through control rpc only when operator access is present');
assert.match(networkView, /mwan4Common\.renderRuntimeWarnings/,
	'network overview should use shared runtime warning rendering');
assert.match(networkView, /fs\.stat\('\/usr\/bin\/nslookup'\)/,
	'network overview should discover the optional nslookup probe helper');
assert.match(networkView, /add\('nslookup', _\('DNS probe'\), probeHelpers\.nslookup\)/,
	'network overview should expose nslookup in contextual WAN link editing');
assert.match(networkView, /\[ 'dual', _\('IPv4 \+ IPv6'\) \]/,
	'network overview should support dual-stack WAN link editing in the compact modal');
assert.match(networkView, /draft\.family\.join\(', '\)/,
	'network overview should preview selected WAN address families before applying changes');
assert.doesNotMatch(networkView, /function renderDiagnostics/,
	'network overview should not carry a duplicate runtime warning renderer');
assert.doesNotMatch(networkView, /E\('details'|E\('summary'/,
	'network overview should not hide controls behind expandable details blocks');
assert.doesNotMatch(networkView, /PBR harmony|MPTCP workflow|Tunnel diagnostics|Run PBR|Run MPTCP/,
	'network overview should not reintroduce advanced PBR/MPTCP shortcut clutter into the WAN workspace');
assert.match(networkView, /Open Advanced/,
	'network overview should expose an Advanced workspace entry point outside the WAN matrix when allowed');
assert.match(advancedView, /method:\s*'diagnostics'/,
	'advanced view should use diagnostics readback for integration status strips');
assert.match(advancedView, /method:\s*'advanced_control'/,
	'advanced view should use constrained mwan4 advanced_control rpc for privileged advanced actions');
assert.doesNotMatch(advancedView, /method:\s*'control'/,
	'advanced view should not use the runtime control ubus method for integration actions');
assert.match(advancedView, /callSessionAccess\('access-group', 'luci-app-mwan4-advanced', 'write'\)/,
	'advanced view should explicitly check the advanced ACL before privileged advanced actions');
assert.match(advancedView, /Advanced WAN link integrations/,
	'advanced view should expose UCI-backed advanced interface controls');
assert.match(advancedView, /Package readiness/,
	'advanced view should expose package readiness for advanced workflow prerequisites');
assert.match(advancedView, /Install %s/,
	'advanced view should install only backend allowlisted feature bundles');
assert.match(advancedView, /Tunnel steering/,
	'advanced view should expose tunnel steering guidance');
assert.match(advancedView, /Generate WireGuard key/,
	'advanced view should expose constrained WireGuard key generation');
assert.match(advancedView, /Apply endpoint exemptions/,
	'advanced view should expose constrained tunnel endpoint exemption apply');
assert.match(advancedView, /BFD and advanced probes/,
	'advanced view should expose probe and BFD guidance');
assert.match(advancedView, /Apply FRR\/BFD/,
	'advanced view should expose constrained FRR\/BFD apply');
assert.match(advancedView, /fs\.stat\('\/usr\/bin\/nslookup'\)/,
	'advanced view should discover the optional nslookup probe helper');
assert.match(advancedView, /option\.value\('nslookup', _\('DNS probe'\)\)/,
	'advanced view should expose nslookup when the helper is available');
assert.match(advancedView, /PBR harmony/,
	'advanced view should expose PBR harmony guidance');
assert.match(advancedView, /Metadata and integration writes/,
	'advanced view should explain mwan4-owned tunnel metadata writes');
assert.match(advancedView, /uci\.set\('mwan4', section_id, 'type', 'tunnel'\)/,
	'advanced view should persist the canonical type=tunnel marker when a tunnel transport is selected');
assert.match(advancedView, /validateStrategyReference/,
	'advanced view should validate tunnel underlay strategy references');
assert.match(advancedView, /Strategy target helper/,
	'advanced view should expose PBR strategy target helper copy');
assert.match(advancedView, /Supported-interface helper/,
	'advanced view should expose PBR supported-interface guidance');
assert.match(advancedView, /uci add_list pbr\.config\.supported_interface/,
	'advanced view should keep copyable PBR supported-interface commands for auditability');
assert.match(advancedView, /function showNetworkWorkflow/,
	'advanced view should expose an explicit network provisioning workflow');
assert.match(advancedView, /function showTunnelWorkflow/,
	'advanced view should expose an explicit tunnel configuration workflow');
assert.match(advancedView, /function showPbrWorkflow/,
	'advanced view should expose an explicit PBR configuration workflow');
assert.match(advancedView, /function showVrfWorkflow/,
	'advanced view should expose an explicit VRF configuration workflow');
assert.match(advancedView, /function showBfdWorkflow/,
	'advanced view should expose an explicit BFD configuration workflow');
assert.match(advancedView, /uci\.load\('pbr'\)/,
	'advanced view should load PBR only under the expanded config ACL');
assert.match(advancedView, /uci\.set\('pbr', 'config', 'uplink_interface6'/,
	'advanced view should write PBR IPv6 uplink configuration from the explicit workflow');
assert.match(advancedView, /mwan4_strategy_/,
	'advanced view should write PBR policy targets as mwan4 strategy targets');
assert.match(advancedView, /uci\.set\('network', vrf, 'type', 'vrf'\)/,
	'advanced view should write VRF device configuration from the explicit workflow');
assert.match(advancedView, /uci\.set\('frr', 'bfdd', 'enabled', '1'\)/,
	'advanced view should enable FRR BFD from the explicit workflow');
assert.match(advancedView, /VRF and ownership/,
	'advanced view should expose VRF and ownership guidance');
assert.doesNotMatch(advancedView, /E\('details'|E\('summary'/,
	'advanced view should not use expandable details blocks');
assert.doesNotMatch(advancedView, /fs\.exec_direct|\/usr\/sbin\/mwan4|apk\s+(add|update)|opkg\s+(install|update)|wg\s+genkey|vtysh\s+-c|\/etc\/init\.d\/frr/,
	'advanced view must not execute mwan4, package manager, WireGuard, or FRR commands directly');
assert.match(interfacesView, /fs\.stat\('\/usr\/bin\/nslookup'\)/,
	'interfaces view should discover the optional nslookup probe helper');
assert.match(interfacesView, /o\.value\('nslookup', _\('DNS probe'\)\)/,
	'interfaces view should expose nslookup when the helper is available');
assert.match(statusView, /mwan4Common\.renderRuntimeWarnings/,
	'status view should reuse shared runtime warning rendering for read-only users');
assert.match(diagnosticsView, /method:\s*'diagnostics'/,
	'diagnostics view should use the mwan4 diagnostics ubus method');
assert.match(diagnosticsView, /\[ 'counters', _\('Counters'\) \]/,
	'diagnostics view should expose the diagnostics counters section');
assert.match(diagnosticsView, /\[ 'quality', _\('Quality'\) \]/,
	'diagnostics view should expose the quality diagnostics section');
assert.match(diagnosticsView, /\[ 'probes', _\('Probes'\) \]/,
	'diagnostics view should expose the probes diagnostics section');
assert.match(diagnosticsView, /\[ 'vrf', _\('VRF'\) \]/,
	'diagnostics view should expose the VRF diagnostics section');
assert.match(diagnosticsView, /\[ 'explain', _\('Route explain'\) \]/,
	'diagnostics view should expose the route explain diagnostics section');
assert.match(diagnosticsView, /\[ 'pbr', _\('PBR'\) \]/,
	'diagnostics view should expose the PBR diagnostics section');
assert.match(diagnosticsView, /\[ 'packages', _\('Packages'\) \]/,
	'diagnostics view should expose the package readiness diagnostics section');
assert.match(diagnosticsView, /\[ 'mptcp', _\('MPTCP'\) \]/,
	'diagnostics view should expose the MPTCP diagnostics section');
assert.match(diagnosticsView, /\[ 'ownership', _\('Ownership'\) \]/,
	'diagnostics view should expose the ownership diagnostics section');
assert.match(diagnosticsView, /function renderDiagnosticsResult/,
	'diagnostics view should render diagnostics as structured guidance, not raw JSON only');
assert.match(diagnosticsView, /function renderGroupedCounters/,
	'diagnostics view should render grouped counters, not only raw counter JSON');
assert.match(diagnosticsView, /Counter references/,
	'diagnostics view should render nft counter references read-only');
assert.match(diagnosticsView, /renderDiagnosticsWarnings\(counters\)/,
	'diagnostics view should surface counter edge error states before raw JSON');
assert.match(diagnosticsView, /function renderMptcpDiagnostics/,
	'diagnostics view should render an MPTCP workflow surface');
assert.match(diagnosticsView, /MPTCP source-route alignment/,
	'diagnostics view should surface MPTCP source-route alignment rows');
assert.match(diagnosticsView, /MPTCP route alignment/,
	'diagnostics view should render live MPTCP route-alignment records');
assert.match(diagnosticsView, /function renderExplainDiagnostics/,
	'diagnostics view should render route-decision explain output');
assert.match(diagnosticsView, /function renderPbrDiagnostics/,
	'diagnostics view should render PBR harmony output');
assert.match(diagnosticsView, /PBR interface coverage/,
	'diagnostics view should render PBR supported-interface coverage');
assert.match(diagnosticsView, /PBR policy targets/,
	'diagnostics view should render PBR policy target rows');
assert.match(diagnosticsView, /function renderPackagesDiagnostics/,
	'diagnostics view should render package readiness output');
assert.match(diagnosticsView, /function renderTunnelDiagnostics/,
	'diagnostics view should render tunnel diagnostics output');
assert.match(diagnosticsView, /Recursion warnings/,
	'diagnostics view should render tunnel recursion warning rows');
assert.match(diagnosticsView, /function renderInterfacesDiagnostics/,
	'diagnostics view should render WAN link diagnostics as typed output');
assert.match(diagnosticsView, /function renderRoutesDiagnostics/,
	'diagnostics view should render route diagnostics as typed output');
assert.match(diagnosticsView, /function renderRulesDiagnostics/,
	'diagnostics view should render policy rule diagnostics as typed output');
assert.match(diagnosticsView, /function renderNftablesDiagnostics/,
	'diagnostics view should render nftables diagnostics as typed output');
assert.match(diagnosticsView, /function renderServiceDiagnostics/,
	'diagnostics view should render service diagnostics as typed output');
assert.match(diagnosticsView, /Probe helper availability/,
	'diagnostics view should render probe helper availability');
assert.match(diagnosticsView, /Quality edge states/,
	'diagnostics view should render quality degraded and unsupported edge states');
assert.match(diagnosticsView, /Probe failures/,
	'diagnostics view should render target-level probe failures');
assert.match(diagnosticsView, /l3mdev routing rules/,
	'diagnostics view should render l3mdev rule details');
assert.match(diagnosticsView, /Ownership and cleanup/,
	'diagnostics view should include ownership in guided advanced workflows');
assert.match(diagnosticsView, /Ownership object inventory/,
	'diagnostics view should render non-interface ownership inventory');
assert.match(diagnosticsView, /Ownership conflicts/,
	'diagnostics view should render ownership conflict rows');
assert.match(diagnosticsHelper, /function diagnosticIssueRows/,
	'shared diagnostics helper should normalize section errors, warnings, and unsupported states');
assert.match(diagnosticsView, /mwan4Common\.renderNextSteps/,
	'diagnostics view should use shared next-step troubleshooting guidance');
assert.match(diagnosticsView, /Show raw response/,
	'diagnostics view should hide raw RPC output behind an explicit toggle');
assert.match(diagnosticsView, /renderGenericDiagnosticsSection/,
	'diagnostics view should render unknown diagnostics sections as structured rows instead of default JSON');
assert.doesNotMatch(diagnosticsView, /E\('details'|E\('summary'/,
	'diagnostics view should render diagnostic sections directly instead of expandable details blocks');
assert.match(diagnosticsView, /luci-app-mwan4-diagnostics/,
	'diagnostics view should explicitly check diagnostics ACL before enabling controls');
assert.match(diagnosticsView, /luci-app-mwan4-operator/,
	'diagnostics view should separately check operator ACL before enabling counter reset');
assert.match(diagnosticsView, /callControl\('reset_counters'\)/,
	'diagnostics view should reset counters only through constrained mwan4 control RPC');
assert.doesNotMatch(diagnosticsView, /fs\.exec_direct|\/usr\/sbin\/mwan4/,
	'diagnostics view must not execute mwan4 commands directly');
assert.match(mptcpView, /callDiagnostics\('mptcp'\)/,
	'MPTCP page should load the mptcp diagnostics section directly');
assert.match(mptcpView, /require form/,
	'MPTCP page should render writable UCI form controls');
assert.match(mptcpView, /require uci/,
	'MPTCP page should write only UCI-backed mwan4 configuration');
assert.match(mptcpView, /callSessionAccess\('access-group', 'luci-app-mwan4', 'write'\)/,
	'MPTCP page should explicitly check the writable mwan4 config ACL');
assert.doesNotMatch(mptcpView, /luci-app-mwan4-diagnostics/,
	'MPTCP management should not use the read-only diagnostics ACL');
assert.match(mptcpView, /MPTCP endpoint management/,
	'MPTCP page should render a first-class endpoint-management surface');
assert.match(mptcpView, /MPTCP kernel\/sysctl state/,
	'MPTCP page should expose kernel sysctl controls through mwan4 UCI');
assert.match(mptcpView, /Per-WAN MPTCP endpoint roles/,
	'MPTCP page should expose per-WAN endpoint role definitions');
assert.match(mptcpView, /Settings are stored in \/etc\/config\/mwan4/,
	'MPTCP page should explain that LuCI does not write external kernel state directly');
assert.match(mptcpView, /MPTCP source-route alignment/,
	'MPTCP page should surface route-alignment diagnostics');
assert.match(mptcpView, /Enable MPTCP configuration/,
	'MPTCP page should require an explicit user action before creating the mptcp config section');
assert.doesNotMatch(mptcpView, /uci\.set\('mwan4', 'mptcp', 'enabled', '0'\)/,
	'MPTCP page must not create a disabled config section while rendering');
assert.doesNotMatch(mptcpView, /method:\s*'control'|fs\.exec_direct|\/usr\/sbin\/mwan4/,
	'MPTCP page must not expose operator controls or shell execution');
assert.doesNotMatch(mptcpView, /E\('details'|E\('summary'/,
	'MPTCP page should not use expandable details blocks');
assert.match(commonView, /function renderRuntimeWarnings/,
	'shared helper should own runtime warning rendering');
assert.match(commonView, /function renderNextSteps/,
	'shared helper should own status next-step rendering');
assert.match(commonView, /What should I check next\?/,
	'shared helper should label the troubleshooting flow');
assert.match(commonView, /warning\.check/,
	'shared runtime warning renderer should show backend check hints');

console.log('ACL security expectations passed');
