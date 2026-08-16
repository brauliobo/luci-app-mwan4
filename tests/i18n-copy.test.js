#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const jsFiles = [
	'htdocs/luci-static/resources/mwan4/common.js',
	'htdocs/luci-static/resources/mwan4/advanced.js',
	'htdocs/luci-static/resources/mwan4/diagnostics.js',
	'htdocs/luci-static/resources/mwan4/overview.js',
	'htdocs/luci-static/resources/view/mwan4/network/globals.js',
	'htdocs/luci-static/resources/view/mwan4/network/advanced.js',
	'htdocs/luci-static/resources/view/mwan4/network/interfaces.js',
	'htdocs/luci-static/resources/view/mwan4/network/overview.js',
	'htdocs/luci-static/resources/view/mwan4/network/routes.js',
	'htdocs/luci-static/resources/view/mwan4/network/rules.js',
	'htdocs/luci-static/resources/view/mwan4/network/strategies.js',
	'htdocs/luci-static/resources/view/mwan4/status/diagnostics.js',
	'htdocs/luci-static/resources/view/mwan4/status/mptcp.js',
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
	'WAN workspace',
	'WAN health matrix',
	'Probe / SLA',
	'DNS probe',
	'Probe helper availability',
	'Health tuning',
	'Extra match and logging',
	'SLA',
	'PBR',
	'MPTCP',
	'MPTCP workflow',
	'MPTCP endpoint management',
	'MPTCP kernel/sysctl state',
	'Per-WAN MPTCP endpoint roles',
	'Quality',
	'Route explain',
	'Route explain tuple',
	'Explain tuple',
	'Requested tuple',
	'Destination address',
	'Probe and BFD visibility',
	'VRF visibility',
	'PBR harmony',
	'Provision WAN',
	'Configure tunnel',
	'Configure PBR',
	'Configure VRF',
	'Configure BFD',
	'Package readiness',
	'Packages',
	'Generate WireGuard key',
	'Apply endpoint exemptions',
	'Apply FRR/BFD',
	'PBR validation',
	'VRF live validation',
	'Endpoint exemptions',
	'Feature package map',
	'Configured BFD peers',
	'WireGuard public key',
	'Enable MPTCP configuration',
	'Reset nft counters',
	'Metadata and integration writes',
	'Strategy target helper',
	'Supported-interface helper',
	'Generated paths replaced',
	'Custom paths preserved',
	'Ingress interface',
	'DNS or nft set',
	'Strategy override',
	'WAN link diagnostics',
	'Route table snapshot',
	'Traffic policy routing',
	'nftables runtime',
	'Service state',
	'Generated nftables files',
	'Tracker instances',
	'Tunnel diagnostics',
	'MPTCP source-route alignment',
	'Ownership and cleanup',
	'Run Ownership',
	'Grouped counters',
	'Counter references',
	'MPTCP route alignment',
	'Quality edge states',
	'Probe failures',
	'PBR interface coverage',
	'PBR policy targets',
	'Recursion warnings',
	'Ownership object inventory',
	'Ownership conflicts',
	'Error output',
	'Backend reported this section as failed',
	'l3mdev routing rules',
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
	"_('Tracking method')",
	"_('Live health')",
	"_('WAN links and SLA')",
	"_('Live WAN health and SLA')",
	"_('Advanced health tuning')",
	"_('Advanced match and logging')",
	'Each card combines saved WAN/SLA settings'
])
	assert.equal(combined.includes(needle), false, `stale or ambiguous copy remains: ${needle}`);

for (const needle of [
	'MPTCP workflow',
	'PBR harmony',
	'Tunnel diagnostics',
	'Run MPTCP',
	'Run PBR'
])
	assert.equal(read('htdocs/luci-static/resources/view/mwan4/network/overview.js').includes(needle), false,
		`advanced diagnostic shortcut leaked into overview: ${needle}`);

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
	'msgid "WAN workspace"',
	'msgid "WAN health matrix"',
	'msgid "Probe / SLA"',
	'msgid "DNS probe"',
	'msgid "Probe helper availability"',
	'msgid "Health tuning"',
	'msgid "Extra match and logging"',
	'msgid "PBR"',
	'msgid "MPTCP"',
	'msgid "MPTCP workflow"',
	'msgid "MPTCP endpoint management"',
	'msgid "MPTCP kernel/sysctl state"',
	'msgid "Per-WAN MPTCP endpoint roles"',
	'msgid "Quality"',
	'msgid "Route explain"',
	'msgid "Route explain tuple"',
	'msgid "Explain tuple"',
	'msgid "Requested tuple"',
	'msgid "Destination address"',
	'msgid "Probe and BFD visibility"',
	'msgid "VRF visibility"',
	'msgid "PBR harmony"',
	'msgid "Provision WAN"',
	'msgid "Configure tunnel"',
	'msgid "Configure PBR"',
	'msgid "Configure VRF"',
	'msgid "Configure BFD"',
	'msgid "Package readiness"',
	'msgid "Packages"',
	'msgid "Generate WireGuard key"',
	'msgid "Apply endpoint exemptions"',
	'msgid "Apply FRR/BFD"',
	'msgid "PBR validation"',
	'msgid "VRF live validation"',
	'msgid "Endpoint exemptions"',
	'msgid "Feature package map"',
	'msgid "Configured BFD peers"',
	'msgid "WireGuard public key"',
	'msgid "Enable MPTCP configuration"',
	'msgid "Reset nft counters"',
	'msgid "Metadata and integration writes"',
	'msgid "Generated paths replaced"',
	'msgid "Custom paths preserved"',
	'msgid "Ingress interface"',
	'msgid "DNS or nft set"',
	'msgid "Strategy override"',
	'msgid "WAN link diagnostics"',
	'msgid "Route table snapshot"',
	'msgid "Traffic policy routing"',
	'msgid "nftables runtime"',
	'msgid "Service state"',
	'msgid "Generated nftables files"',
	'msgid "Tracker instances"',
	'msgid "Tunnel diagnostics"',
	'msgid "MPTCP source-route alignment"',
	'msgid "Ownership and cleanup"',
	'msgid "Run Ownership"',
	'msgid "Grouped counters"',
	'msgid "Counter references"',
	'msgid "MPTCP route alignment"',
	'msgid "Quality edge states"',
	'msgid "Probe failures"',
	'msgid "PBR interface coverage"',
	'msgid "PBR policy targets"',
	'msgid "Recursion warnings"',
	'msgid "Ownership object inventory"',
	'msgid "Ownership conflicts"',
	'msgid "Error output"',
	'msgid "Backend reported this section as failed"',
	'msgid "l3mdev routing rules"',
	'msgid "Fail closed (reject traffic)"',
	'msgid "Use main routing table"'
])
	assertContains(pot, needle, `POT is missing ${needle}`);

console.log('i18n and copy expectations passed');
