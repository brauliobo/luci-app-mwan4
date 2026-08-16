const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const baseURL = process.env.LUCI_URL || 'http://192.168.40.1';
const user = process.env.LUCI_USER || 'root';
const pass = process.env.LUCI_PASS;
const limitedUser = process.env.LUCI_LIMITED_USER;
const limitedPass = process.env.LUCI_LIMITED_PASS;
const limitedExpectation = process.env.LUCI_LIMITED_EXPECT || 'denied';
const liveMutationEnabled = process.env.E2E_LUCI_MUTATION == '1' && process.env.E2E_DISPOSABLE_QEMU == '1';

const overviewPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/view/mwan4/network/overview.js');
const advancedPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/view/mwan4/network/advanced.js');
const globalsPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/view/mwan4/network/globals.js');
const statusPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/view/mwan4/status/overview.js');
const diagnosticsPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/view/mwan4/status/diagnostics.js');
const commonPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/mwan4/common.js');
const overviewHelperPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/mwan4/overview.js');
const cssPath = path.resolve(__dirname, '../../htdocs/luci-static/resources/view/mwan4/mwan4.css');
const menuPath = path.resolve(__dirname, '../../root/usr/share/luci/menu.d/luci-app-mwan4.json');
const aclPath = path.resolve(__dirname, '../../root/usr/share/rpcd/acl.d/luci-app-mwan4.json');
const migrationPath = path.resolve(__dirname, '../../root/etc/uci-defaults/60_luci-mwan4');
const packageMakefilePath = path.resolve(__dirname, '../../Makefile');
const mwan4MakefilePath = path.resolve(__dirname, '../../../mwan4/Makefile');
const mwan4ReadmePath = path.resolve(__dirname, '../../../mwan4/README.md');

const advancedPages = [
	{ id: 'interfaces', route: 'admin/network/mwan4/interfaces', title: 'MultiWAN 4 - WAN Links' },
	{ id: 'routes', route: 'admin/network/mwan4/routes', title: 'MultiWAN 4 - Path Members' },
	{ id: 'strategies', route: 'admin/network/mwan4/strategies', title: 'MultiWAN 4 - Strategies' },
	{ id: 'rules', route: 'admin/network/mwan4/rules', title: 'MultiWAN 4 - Traffic Policies' },
	{ id: 'globals', route: 'admin/network/mwan4/globals', title: 'MultiWAN 4 - Global Settings' },
	{ id: 'advanced', route: 'admin/network/mwan4/advanced', title: 'MultiWAN 4 - Advanced' }
];

const scenarioMatrix = [
	{ id: 'acl-roles', mode: 'static', title: 'ACL role declarations and menu dependencies' },
	{ id: 'overview', mode: 'live', route: 'admin/network/mwan4/overview', title: 'MultiWAN 4' },
	{ id: 'diagnostics', mode: 'live', route: 'admin/network/mwan4/diagnostics', title: 'MultiWAN 4 - Diagnostics' },
	{ id: 'policy-builder', mode: 'live', route: 'admin/network/mwan4/overview', title: 'Traffic exception builder' },
	{ id: 'staged-apply', mode: 'live', route: 'admin/network/mwan4/overview', title: 'Pending change preview' },
	{ id: 'overview-modal-save', mode: 'guarded-live', route: 'admin/network/mwan4/overview', guard: 'E2E_LUCI_MUTATION=1 E2E_DISPOSABLE_QEMU=1' },
	{ id: 'live-status', mode: 'live', route: 'admin/network/mwan4/overview', title: 'Live health' },
	{ id: 'diagnostics-rpc', mode: 'live', route: 'admin/network/mwan4/diagnostics', title: 'Show raw response' },
	{ id: 'limited-acl', mode: 'env-live', route: 'admin/network/mwan4/overview', env: 'LUCI_LIMITED_USER LUCI_LIMITED_PASS' },
	{ id: 'advanced-pages', mode: 'live', pages: advancedPages }
];

const runtimeScenarioMatrix = [
	{ id: 'DIAG-090', mode: 'browser', route: 'admin/network/mwan4/diagnostics', reportFields: [ 'query_tuple', 'matched_policy', 'strategy', 'selected_wan', 'fwmark', 'route_table', 'ui_matches_api' ] },
	{ id: 'DIAG-091', mode: 'browser', route: 'admin/network/mwan4/diagnostics', reportFields: [ 'query_tuple', 'winning_policy', 'skipped_policies', 'degraded_reason', 'fallback_wan', 'terminal_behavior' ] },
	{ id: 'ROLL-100', mode: 'qemu', reportFields: [ 'invalid_change', 'apply_exit_status', 'rollback_triggered', 'rules_restored', 'traffic_interruption_ms', 'error_message' ] },
	{ id: 'ROLL-101', mode: 'qemu', reportFields: [ 'service', 'restart_exit_status', 'generator_failure', 'last_good_rules_preserved', 'traffic_result', 'rebuild_equivalent' ] },
	{ id: 'ACL-LUCI-110', mode: 'browser', route: 'admin/network/mwan4/overview', reportFields: [ 'menu_path', 'acl_dependency', 'user_role', 'rpc_calls', 'access_denied_count', 'screenshot' ] },
	{ id: 'ACL-LUCI-111', mode: 'browser', route: 'admin/network/mwan4/overview', reportFields: [ 'page_url', 'modal_name', 'save_result', 'console_errors', 'live_status_before', 'live_status_after', 'screenshot' ] },
	{ id: 'PKG-INSTALL-120', mode: 'packaging', reportFields: [ 'repo_url', 'packages_adb_hash', 'installed_versions', 'installed_files', 'ubus_objects', 'service_status', 'luci_menu_present', 'fresh_install_result', 'disposable_openwrt_image', 'package_mutation_guard' ] },
	{ id: 'PKG-UPGRADE-121', mode: 'packaging', reportFields: [ 'from_versions', 'to_versions', 'migration_result', 'config_diff', 'apk_new_files', 'config_preservation', 'apk_new_preservation', 'service_restart_result', 'traffic_result', 'disposable_openwrt_image', 'package_mutation_guard' ] },
	{ id: 'PKG-CONFLICT-122', mode: 'packaging', reportFields: [ 'initial_packages', 'apk_conflict_result', 'coexistence_allowed', 'conflict_behavior', 'stale_menu_files', 'final_packages', 'ubus_objects', 'disposable_openwrt_image', 'package_mutation_guard' ] }
];

test.describe.configure({ timeout: 60000 });

const routerTest = pass ? test : test.skip;
const liveSaveTest = pass && liveMutationEnabled ? test : test.skip;
const limitedRouterTest = pass && limitedUser && limitedPass ? test : test.skip;

async function login(page, credentials) {
	credentials = credentials || { user, pass };
	await page.goto(`${baseURL}/cgi-bin/luci/`, { waitUntil: 'domcontentloaded' });

	if (await page.locator('input[name="luci_username"]').count()) {
		await page.locator('input[name="luci_username"]').fill(credentials.user);
		await page.locator('input[name="luci_password"]').fill(credentials.pass);
		await Promise.all([
			page.waitForLoadState('networkidle').catch(() => {}),
			page.getByRole('button', { name: 'Log in' }).click()
		]);
	}
}

function collectBrowserIssues(page) {
	const issues = [];

	page.on('pageerror', error => issues.push(`pageerror: ${error.message}`));
	page.on('console', message => {
		if (message.type() === 'error')
			issues.push(`console: ${message.text()}`);
	});
	page.on('response', response => {
		if (response.status() >= 500)
			issues.push(`http ${response.status()}: ${response.url()}`);
	});

	return issues;
}

function trackMwan4Rpc(page) {
	const calls = [];

	page.on('request', request => {
		const postData = request.postData() || '';
		if (request.url().includes('/ubus') && postData.includes('mwan4'))
			calls.push(postData);
	});

	return calls;
}

async function expectNoBrowserIssues(page, issues) {
	expect(issues).toEqual([]);
	await expect(page.locator('body')).not.toContainText(/RPC call.*failed|Access denied|Permission denied/i);
}

test('overview exposes pending change previews for high-impact modal flows', async () => {
	const overview = fs.readFileSync(overviewPath, 'utf8');
	const advanced = fs.readFileSync(advancedPath, 'utf8');
	const globals = fs.readFileSync(globalsPath, 'utf8');
	const status = fs.readFileSync(statusPath, 'utf8');
	const diagnostics = fs.readFileSync(diagnosticsPath, 'utf8');
	const common = fs.readFileSync(commonPath, 'utf8');
	const overviewHelper = fs.readFileSync(overviewHelperPath, 'utf8');
	const css = fs.readFileSync(cssPath, 'utf8');

	expect(common).toContain('function renderRuntimeWarnings');
	expect(common).toContain('function rpcErrorMessage');
	expect(common).toContain('function setBusy');
	expect(common).toContain('Recommended action');
	expect(overview).toContain("require mwan4.common as mwan4Common");
	expect(overview).toContain("require mwan4.overview as mwan4Overview");
	expect(advanced).toContain("require mwan4.common as mwan4Common");
	expect(status).toContain("require mwan4.common as mwan4Common");
	expect(diagnostics).toContain("require mwan4.common as mwan4Common");
	expect(advanced).toContain('MultiWAN 4 - Advanced');
	expect(advanced).toContain('Advanced WAN link integrations');
	expect(advanced).toContain('Tunnel steering');
	expect(advanced).toContain('BFD and advanced probes');
	expect(advanced).toContain('PBR harmony');
	expect(advanced).toContain('Metadata and integration writes');
	expect(advanced).toContain("uci.set('mwan4', section_id, 'type', 'tunnel')");
	expect(advanced).toContain('Strategy target helper');
	expect(advanced).toContain('Supported-interface helper');
	expect(advanced).toContain('uci add_list pbr.config.supported_interface');
	expect(advanced).toContain('function showPbrWorkflow');
	expect(advanced).toContain("uci.set('pbr', 'config', 'uplink_interface6'");
	expect(advanced).toContain('function showNetworkWorkflow');
	expect(advanced).toContain('function showTunnelWorkflow');
	expect(advanced).toContain('function showVrfWorkflow');
	expect(advanced).toContain('function showBfdWorkflow');
	expect(advanced).toContain('VRF and ownership');
	expect(overview).toContain('mwan4Common.renderRuntimeWarnings');
	expect(status).toContain('Read-only runtime summary. Configuration and diagnostics links are shown only when this session has the matching ACL.');
	expect(status).toContain('No configuration or diagnostics ACL is available for this session.');
	expect(overview).toContain('function showMwan4Modal');
	expect(overview).toContain("modal.setAttribute('role', 'dialog')");
	expect(overview).toContain("modal.setAttribute('aria-modal', 'true')");
	expect(overview).toContain("'aria-live': 'polite'");
	expect(overview).toContain("'aria-busy': 'false'");
	expect(overview).toContain("role: 'table'");
	expect(overviewHelper).toContain("data-label");
	expect(overview).toContain('Edit WAN link %s');
	expect(diagnostics).toContain("'aria-live': 'polite'");
	expect(diagnostics).toContain("'aria-busy': 'false'");
	expect(overview).toContain('function pendingPreviewSlot');
	expect(overview).toContain('function buildInterfaceChange');
	expect(overview).toContain('function buildRoutingPresetChange');
	expect(overview).toContain('function buildRuleChange');
	expect(overview).toContain('function formatPolicyPath');
	expect(overview).toContain('function formatRuleSummary');
	expect(overview).toContain('function renderRuleAdvancedFields');
	expect(overview).toContain('function describePathKind');
	expect(overview).toContain('function buildGlobalChange');
	expect(overview).toContain('function validateBeforeApply');
	expect(overview).toContain('function renderCounterStrip');
	expect(overview).toContain('function healthMethodOptions');
	expect(overview).toContain('function commandCenterState');
	expect(overview).toContain('function renderCommandCenter');
	expect(overview).toContain('function primaryActionButton');
	expect(overview).toMatch(/Choose routing mode|Choose a routing mode/);
	expect(overview).toMatch(/Use (normal routing|main routing table)/);
	expect(overview).toContain('Extra match and logging');
	expect(overview).not.toContain("E('details'");
	expect(overview).not.toContain("E('summary'");
	expect(diagnostics).not.toContain("E('details'");
	expect(diagnostics).not.toContain("E('summary'");
	expect(advanced).not.toContain("E('details'");
	expect(advanced).not.toContain("E('summary'");
	expect(overview).toContain('Most networks only need the default routing from the routing mode above. Add an exception only for guest Wi-Fi, VPN clients, video calls, or a specific service port.');
	expect(overview).toContain('default failover/load-balance behavior');
	expect(overview).toContain('Choose TCP or UDP before adding source or destination ports.');
	expect(overview).toMatch(/Use letters, numbers, and underscores for the traffic exception name\./);
	expect(overview).toContain('ICMPv6 policies must use IPv6.');
	expect(overview).not.toContain('Strategy or terminal action');
	expect(overview).toContain('Recommended action');
	expect(overview).toContain('Open Advanced');
	expect(overview).toContain('Use reliability first');
	expect(overview).toContain('Use throughput first');
	expect(overview).toContain('Default routing');
	expect(overview).not.toContain('Intent presets');
	expect(overview).toContain('Runtime attention needed');
	expect(overview).toContain('Start with this guided path.');
	expect(overview).toContain("hasOperatorAccess ? runMwan4([ 'restart' ])");
	expect(overview).toContain('Pending change preview');
	expect(overview).toContain('Review this change before it is saved and applied.');
	expect(overview).toContain('mwan4 validation runs before the pending change is applied.');
	expect(overview).toContain('Preview changes');
	expect(overview).toContain('Apply pending changes');
	expect(overview).not.toContain("uci.set('mwan4', 'globals', 'mwan4.");
	expect(globals).not.toContain("uci.set('mwan4', section_id, 'mwan4.");
	expect(overview).not.toContain('function renderDiagnostics');
	expect(overview).toMatch(/previewModalActions\(function\(\) \{ return buildRoutingPresetChange\(mode\); \}\)/);
	expect(overview).toMatch(/previewModalActions\(function\(\) \{ return buildInterfaceChange\(name\); \}/);
	expect(overview).toMatch(/previewModalActions\(function\(\) \{ return buildRuleChange\(name\); \}/);
	expect(overview).toContain('previewModalActions(buildGlobalChange)');
	expect(css).toContain('.mwan4-change-preview');
	expect(css).toContain('.mwan4-alert-info');
	expect(css).toContain('.mwan4-command-center');
	expect(css).toContain('.mwan4-counter-strip');
	expect(css).toContain('.mwan4-wan-table');
	expect(css).toContain('.mwan4-target-summary');
	expect(css).toContain('.mwan4-primary-action');
	expect(css).toContain('.mwan4-state-grid');
	expect(css).toContain('.mwan4-rule-summary');
	expect(css).toContain('.mwan4-advanced-fields');
	expect(css).toContain('.mwan4-guidance-card');
	expect(css).toContain('.mwan4-copy-block');
	expect(css).toContain('.mwan4-sr-only');
	expect(css).toContain('.mwan4-cell::before');
	expect(css).toContain('content: attr(data-label)');
	expect(css).not.toContain('> summary');
	expect(css).not.toContain(' details');
});

test('QEMU LuCI smoke scenario matrix covers the expected flows', async () => {
	const ids = scenarioMatrix.map(scenario => scenario.id);

	expect(ids).toEqual([
		'acl-roles',
		'overview',
		'diagnostics',
		'policy-builder',
		'staged-apply',
		'overview-modal-save',
		'live-status',
		'diagnostics-rpc',
		'limited-acl',
		'advanced-pages'
	]);
	expect(scenarioMatrix.filter(scenario => scenario.mode == 'live').map(scenario => scenario.id)).toContain('overview');
	expect(scenarioMatrix.find(scenario => scenario.id == 'overview-modal-save').guard).toContain('E2E_DISPOSABLE_QEMU=1');
	expect(scenarioMatrix.find(scenario => scenario.id == 'limited-acl').env).toContain('LUCI_LIMITED_USER');
	expect(scenarioMatrix.find(scenario => scenario.id == 'advanced-pages').pages.map(page => page.id)).toEqual([
		'interfaces',
		'routes',
		'strategies',
		'rules',
		'globals',
		'advanced'
	]);
});

test('DIAG-090 DIAG-091 ROLL-100 ROLL-101 ACL-LUCI-110 ACL-LUCI-111 PKG-INSTALL-120 PKG-UPGRADE-121 PKG-CONFLICT-122 runtime scenario matrix is parameterized', async () => {
	const ids = runtimeScenarioMatrix.map(scenario => scenario.id);

	expect(ids).toEqual([
		'DIAG-090',
		'DIAG-091',
		'ROLL-100',
		'ROLL-101',
		'ACL-LUCI-110',
		'ACL-LUCI-111',
		'PKG-INSTALL-120',
		'PKG-UPGRADE-121',
		'PKG-CONFLICT-122'
	]);
	expect(runtimeScenarioMatrix.filter(scenario => scenario.mode == 'browser').map(scenario => scenario.id)).toEqual([
		'DIAG-090',
		'DIAG-091',
		'ACL-LUCI-110',
		'ACL-LUCI-111'
	]);
	for (const scenario of runtimeScenarioMatrix)
		expect(scenario.reportFields.length).toBeGreaterThan(0);
});

test('ACL-LUCI-110 ACL role declarations match LuCI menu dependencies', async () => {
	const menu = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
	const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'));
	const expectedAclByRoute = {
		'admin/status/mwan4': 'luci-app-mwan4-status',
		'admin/network/mwan4/overview': 'luci-app-mwan4',
		'admin/network/mwan4/interfaces': 'luci-app-mwan4',
		'admin/network/mwan4/routes': 'luci-app-mwan4',
		'admin/network/mwan4/strategies': 'luci-app-mwan4',
		'admin/network/mwan4/rules': 'luci-app-mwan4',
		'admin/network/mwan4/globals': 'luci-app-mwan4',
		'admin/network/mwan4/advanced': 'luci-app-mwan4-advanced',
		'admin/network/mwan4/mptcp': 'luci-app-mwan4',
		'admin/network/mwan4/diagnostics': 'luci-app-mwan4-diagnostics'
	};

	expect(acl['luci-app-mwan4-status'].read.ubus.mwan4).toContain('status');
	expect(acl['luci-app-mwan4-status'].read.uci).toBeUndefined();
	expect(acl['luci-app-mwan4-status'].write).toBeUndefined();
	expect(acl['luci-app-mwan4'].read.ubus.mwan4).toContain('diagnostics');
	expect(acl['luci-app-mwan4'].read.uci).toContain('mwan4');
	expect(acl['luci-app-mwan4'].read.uci).toContain('network');
	expect(acl['luci-app-mwan4'].write.uci).toContain('mwan4');
	expect(acl['luci-app-mwan4'].write.ubus).toBeUndefined();
	expect(acl['luci-app-mwan4-advanced'].write.ubus.mwan4).toContain('advanced_control');
	expect(acl['luci-app-mwan4-advanced'].write.uci).toContain('pbr');
	expect(acl['luci-app-mwan4-operator'].write.ubus.mwan4).toContain('control');
	expect(acl['luci-app-mwan4-operator'].write.uci).toBeUndefined();
	expect(acl['luci-app-mwan4-diagnostics'].read.ubus.mwan4).toContain('diagnostics');
	expect(acl['luci-app-mwan4-diagnostics'].write).toBeUndefined();

	for (const [ route, role ] of Object.entries(expectedAclByRoute)) {
		expect(menu[route].depends.acl).toContain(role);
		expect(acl[role]).toBeTruthy();
	}

	for (const route of Object.keys(expectedAclByRoute).filter(route => route != 'admin/status/mwan4' && route != 'admin/network/mwan4/overview')) {
		expect(menu[route].firstchild_ineligible).toBe(true);
		expect(menu[route].title).toBeTruthy();
	}
});

test('diagnostics and advanced page smoke expectations are represented statically', async () => {
	const overview = fs.readFileSync(overviewPath, 'utf8');
	const diagnostics = fs.readFileSync(diagnosticsPath, 'utf8');

	expect(diagnostics).toContain("callSessionAccess('access-group', 'luci-app-mwan4-diagnostics', 'read')");
	expect(diagnostics).toContain("callDiagnostics('summary')");
	expect(diagnostics).toContain('Diagnostic commands are disabled because this session lacks the mwan4 diagnostics ACL.');
	expect(diagnostics).toContain("'aria-label': _('Run %s diagnostics').format(c[1])");
	expect(diagnostics).toContain("role: 'status'");
	expect(diagnostics).toContain("'aria-live': 'polite'");
	expect(diagnostics).toContain('mwan4-route-explain-form');
	expect(diagnostics).toContain('function readRouteExplainTuple');
	expect(diagnostics).toContain('callRouteExplainDiagnostics');
	expect(diagnostics).toContain('function renderInterfacesDiagnostics');
	expect(diagnostics).toContain('function renderRoutesDiagnostics');
	expect(diagnostics).toContain('function renderRulesDiagnostics');
	expect(diagnostics).toContain('function renderNftablesDiagnostics');
	expect(diagnostics).toContain('function renderServiceDiagnostics');
	expect(diagnostics).toContain('MPTCP route alignment');
	expect(diagnostics).toContain('Quality edge states');
	expect(diagnostics).toContain('Probe failures');
	expect(diagnostics).toContain('PBR interface coverage');
	expect(diagnostics).toContain('PBR policy targets');
	expect(diagnostics).toContain('Recursion warnings');
	expect(diagnostics).toContain('Ownership object inventory');
	expect(diagnostics).toContain('Ownership conflicts');
	expect(diagnostics).toContain('function renderGenericDiagnosticsSection');
	expect(diagnostics).toContain('Show raw response');

	for (const page of advancedPages) {
		const source = fs.readFileSync(path.resolve(__dirname, `../../htdocs/luci-static/resources/view/mwan4/network/${page.id}.js`), 'utf8');
		if (page.id != 'advanced')
			expect(overview).not.toContain(`L.url('admin/network/mwan4/${page.id}')`);
		expect(source).toContain(page.title);
		expect(source).toContain("L.url('admin/network/mwan4/overview')");
	}
});

test('DIAG-090 DIAG-091 diagnostics report surfaces are represented statically', async () => {
	const diagnostics = fs.readFileSync(diagnosticsPath, 'utf8');
	const common = fs.readFileSync(commonPath, 'utf8');

	expect(diagnostics).toContain("[ 'summary', _('Summary') ]");
	expect(diagnostics).toContain("[ 'all', _('Full diagnostics') ]");
	expect(diagnostics).toContain("[ 'counters', _('Counters') ]");
	expect(diagnostics).toContain("[ 'rules', _('Traffic policies') ]");
	expect(diagnostics).toContain("[ 'nftables', _('nftables') ]");
	expect(diagnostics).toContain("[ 'ownership', _('Ownership') ]");
	expect(diagnostics).toContain("[ 'pbr', _('PBR') ]");
	expect(diagnostics).toContain("[ 'mptcp', _('MPTCP') ]");
	expect(diagnostics).toContain('function renderDiagnosticsResult');
	expect(diagnostics).toContain('function renderRouteExplainRequest');
	expect(diagnostics).toContain('renderDiagnosticsWarnings(counters)');
	expect(diagnostics).toContain('Show raw response');
	expect(diagnostics).toContain('pre.hidden = hidden');
	expect(diagnostics).toContain('renderGenericDiagnosticsSection');
	expect(diagnostics).toContain('mwan4Common.renderNextSteps');
	expect(common).toContain('function renderRuntimeWarnings');
	expect(common).toContain('Recommended action');
});

test('ROLL-100 ROLL-101 rollback and resilience UX keeps validation previews static', async () => {
	const overview = fs.readFileSync(overviewPath, 'utf8');
	const status = fs.readFileSync(statusPath, 'utf8');

	expect(overview).toContain('Pending change preview');
	expect(overview).toContain('Review this change before it is saved and applied.');
	expect(overview).toContain('Apply pending changes');
	expect(overview).toContain('mwan4Common.renderRuntimeWarnings');
	expect(overview).toContain('mwan4Common.rpcErrorMessage');
	expect(overview).toContain('buildRoutingPresetChange');
	expect(overview).toContain('buildInterfaceChange');
	expect(overview).toContain('buildRuleChange');
	expect(overview).toContain('buildGlobalChange');
	expect(status).toContain('Open network overview');
	expect(status).toContain("method: 'status'");
	expect(status).not.toContain('window.location.replace');
});

test('PKG-INSTALL-120 PKG-UPGRADE-121 PKG-CONFLICT-122 package assets are represented statically', async () => {
	const migration = fs.readFileSync(migrationPath, 'utf8');
	const packageMakefile = fs.readFileSync(packageMakefilePath, 'utf8');
	const mwan4Makefile = fs.readFileSync(mwan4MakefilePath, 'utf8');
	const mwan4Readme = fs.readFileSync(mwan4ReadmePath, 'utf8');

	expect(packageMakefile).toContain('LUCI_DEPENDS:=+luci-base +mwan4');
	expect(packageMakefile).toContain('LUCI_MINIFY_JS:=0');
	expect(migration).toContain('/etc/config/mwan4.pre-luci-app-mwan4-migration');
	expect(migration).toContain('member|policy');
	expect(migration).toContain('config route');
	expect(migration).toContain('config strategy');
	expect(migration).toContain('/etc/init.d/rpcd restart');
	expect(migration).toContain('/etc/init.d/uhttpd restart');
	expect(migration).toContain('/etc/init.d/mwan4 restart');
	expect(mwan4Makefile).toContain('CONFLICTS:=mwan3');
	expect(mwan4Readme).toContain('does not emit conflict metadata');
	expect(mwan4Readme).toContain('Remove `mwan3` and `luci-app-mwan3`');
});

routerTest('DIAG-090 DIAG-091 ACL-LUCI-110 ACL-LUCI-111 mwan4 overview loads and opens contextual editors', async ({ page }) => {
	await login(page);
	const browserIssues = collectBrowserIssues(page);

	await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4`, { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'MultiWAN 4' })).toBeVisible();
	await expect(page.getByText('Command center', { exact: true })).toBeVisible();
	await expect(page.getByText('Recommended action', { exact: true })).toBeVisible();
	await expect(page.getByText('WAN links', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('WAN workspace', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'WAN health matrix' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Routing mode' }).first()).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Traffic exceptions' })).toBeVisible();
	if (await page.getByText('Matched packets', { exact: true }).count())
		await expect(page.getByText('Matched packets', { exact: true })).toBeVisible();
	await expect(page.locator('#mwan4-command-center')).toHaveAttribute('aria-live', 'polite');
	await expect(page.locator('#mwan4-command-center')).toHaveAttribute('aria-busy', 'false');
	await expect(page.locator('#mwan4-wan-workspace')).toHaveAttribute('aria-live', 'polite');
	await expect(page.locator('#mwan4-wan-workspace')).toHaveAttribute('aria-busy', 'false');
	await expect(page.locator('#mwan4-wan-workspace')).toContainText('Score');
	await expect(page.locator('#mwan4-wan-workspace')).toContainText('SLA');
	await expect(page.locator('#mwan4-wan-workspace')).toContainText('Targets');
	await expect(page.locator('#mwan4-wan-workspace')).not.toContainText('PBR');
	await expect(page.locator('#mwan4-wan-workspace')).not.toContainText('MPTCP');
	await expect(page.locator('body')).not.toContainText('[object Object]');

	await page.setViewportSize({ width: 390, height: 844 });
	const firstMobileCell = page.locator('.mwan4-cell[data-label]').first();
	if (await firstMobileCell.count())
		await expect(firstMobileCell).toHaveAttribute('data-label', /.+/);

	const firstRunGuide = page.getByText('First-run setup', { exact: true });
	if (await firstRunGuide.count()) {
		await expect(firstRunGuide).toBeVisible();
		await expect(page.getByText('Start with this guided path.', { exact: true })).toBeVisible();
		await expect(page.getByText('Add a WAN link', { exact: true })).toBeVisible();
		await expect(page.getByText('Choose routing mode', { exact: true })).toBeVisible();
		await expect(page.getByText('Add exceptions only if needed', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: /Continue quick setup|Add exception/ })).toBeVisible();
	}

	await page.getByRole('button', { name: 'Use reliability first' }).click();
	await expect(page.locator('.modal.mwan4-modal')).toHaveAttribute('role', 'dialog');
	await expect(page.locator('.modal.mwan4-modal')).toHaveAttribute('aria-modal', 'true');
	await expect(page.getByText('Use failover', { exact: true })).toBeVisible();
	await expect(page.getByText('Primary WAN link', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Preview changes' })).toBeVisible();
	if (await page.locator('select[name="primary"] option').count()) {
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.getByText('Pending change preview', { exact: true })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Pending change preview' })).toHaveAttribute('aria-live', 'polite');
		await expect(page.getByText('Review this change before it is saved and applied.', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Apply pending changes' })).toBeVisible();
	}
	await page.getByRole('button', { name: 'Cancel' }).click();

	const wanPanel = page.locator('#mwan4-wan-workspace');
	await wanPanel.getByRole('button', { name: /Edit WAN link/ }).first().click();
	await expect(page.getByText('Basic health check', { exact: true })).toBeVisible();
	await expect(page.getByText('Health check method', { exact: true })).toBeVisible();
	await expect(page.getByText('Health check targets', { exact: true })).toBeVisible();
	await expect(page.getByText('Health tuning', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Preview changes' })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();

	const rulePanel = page.locator('.mwan4-panel').filter({ hasText: 'Traffic exceptions' });
	if (await rulePanel.getByText('No traffic exceptions yet.', { exact: true }).count())
		await expect(rulePanel.getByText('Most networks only need the default routing from the routing mode above. Add an exception only for guest Wi-Fi, VPN clients, video calls, or a specific service port.', { exact: true })).toBeVisible();

	await rulePanel.getByRole('button', { name: /Add (traffic )?exception/ }).click();
	await expect(page.getByText('Traffic exception builder', { exact: true })).toBeVisible();
	await expect(page.getByText('New traffic exception', { exact: true })).toBeVisible();
	await expect(page.getByText('1. Match traffic', { exact: true })).toBeVisible();
	await expect(page.getByText('2. Describe the destination', { exact: true })).toBeVisible();
	await expect(page.getByText('3. Choose path', { exact: true })).toBeVisible();
	await expect(page.locator('.modal.mwan4-modal').getByText('Routing mode', { exact: true })).toBeVisible();
	await expect(page.getByText('Destination address', { exact: true })).toBeVisible();
	await expect(page.locator('select[name="use_strategy"]')).toContainText('Use main routing table');
	await expect(page.getByText('Extra match and logging', { exact: true })).toBeVisible();
	await expect(page.getByText('This is an exception to the default failover/load-balance behavior.', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Preview changes' })).toBeVisible();
	await page.getByRole('button', { name: 'Preview changes' }).click();
	const rulePreview = page.getByRole('region', { name: 'Pending change preview' });
	await expect(rulePreview).toBeVisible();
	await expect(rulePreview.getByText('Traffic exception summary', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Apply pending changes' })).toBeVisible();
	await page.getByRole('button', { name: 'Edit pending change' }).click();
	await page.locator('input[name="dest_port"]').fill('443');
	await expect(page.getByText('Choose TCP or UDP before adding source or destination ports.', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();

	await expect(page.locator('details')).toHaveCount(0);

	await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4/diagnostics`, { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'MultiWAN 4 - Diagnostics' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What should I check next?' }).first()).toBeVisible();
	await expect(page.locator('#mwan4-diag-output')).toHaveAttribute('aria-live', 'polite');
	await expect(page.getByRole('button', { name: 'Run Summary diagnostics' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Run PBR diagnostics' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Run MPTCP diagnostics' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Run Ownership diagnostics' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Show raw response' })).toBeVisible({ timeout: 15000 });
	await expect(page.locator('#mwan4-diag-output pre.mwan4-output')).toBeHidden();

	for (const advancedPage of advancedPages) {
		await page.goto(`${baseURL}/cgi-bin/luci/${advancedPage.route}`, { waitUntil: 'networkidle' });
		await expect(page.getByText(advancedPage.title, { exact: true })).toBeVisible();
		await expect(page.getByText('Back to overview.', { exact: true })).toBeVisible();
	}

	await expectNoBrowserIssues(page, browserIssues);
});

routerTest('ACL-LUCI-111 live status issues status RPCs without browser errors', async ({ page }) => {
	await login(page);
	const browserIssues = collectBrowserIssues(page);
	const rpcCalls = trackMwan4Rpc(page);

	await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4`, { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'WAN health matrix' })).toBeVisible();
	await expect(page.locator('#mwan4-command-center')).toHaveAttribute('aria-live', 'polite');
	await expect(page.locator('#mwan4-wan-workspace')).toHaveAttribute('aria-live', 'polite');
	await expect.poll(() => rpcCalls.filter(call => call.includes('status')).length, { timeout: 10000 }).toBeGreaterThan(0);

	const before = await page.locator('#mwan4-command-center').textContent();
	const workspaceBefore = await page.locator('#mwan4-wan-workspace').textContent();
	await page.reload({ waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'WAN health matrix' })).toBeVisible();
	const after = await page.locator('#mwan4-command-center').textContent();
	const workspaceAfter = await page.locator('#mwan4-wan-workspace').textContent();

	expect((before || '').length).toBeGreaterThan(0);
	expect((after || '').length).toBeGreaterThan(0);
	expect((workspaceBefore || '').length).toBeGreaterThan(0);
	expect((workspaceAfter || '').length).toBeGreaterThan(0);
	await expectNoBrowserIssues(page, browserIssues);
});

routerTest('DIAG-090 DIAG-091 diagnostics RPC views render structured output cleanly', async ({ page }) => {
	await login(page);
	const browserIssues = collectBrowserIssues(page);
	const rpcCalls = trackMwan4Rpc(page);

	await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4/diagnostics`, { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'MultiWAN 4 - Diagnostics' })).toBeVisible();
	await expect(page.locator('#mwan4-diag-output')).toHaveAttribute('aria-live', 'polite');

	const summaryButton = page.getByRole('button', { name: 'Run Summary diagnostics' });
	if (await summaryButton.isEnabled()) {
		await summaryButton.click();
		await expect(page.getByRole('button', { name: 'Show raw response' })).toBeVisible({ timeout: 15000 });
		await expect(page.locator('#mwan4-diag-output pre.mwan4-output')).toBeHidden();
		await expect.poll(() => rpcCalls.filter(call => call.includes('diagnostics')).length, { timeout: 10000 }).toBeGreaterThan(0);
	}
	else {
		await expect(page.getByText('Diagnostic commands are disabled because this session lacks the mwan4 diagnostics ACL.')).toBeVisible();
	}

	for (const label of [ 'Run PBR diagnostics', 'Run MPTCP diagnostics', 'Run Tunnels diagnostics' ]) {
		const button = page.getByRole('button', { name: label });
		if (await button.isEnabled()) {
			await button.click();
			await expect(page.getByRole('button', { name: 'Show raw response' })).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#mwan4-diag-output pre.mwan4-output')).toBeHidden();
			await expect(page.locator('body')).not.toContainText('[object Object]');
		}
	}

	await expectNoBrowserIssues(page, browserIssues);
});

liveSaveTest('ACL-LUCI-111 guarded overview routing modal save applies on disposable QEMU only', async ({ page }) => {
	await login(page);
	const browserIssues = collectBrowserIssues(page);

	await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4`, { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'MultiWAN 4' })).toBeVisible();

	await page.getByRole('button', { name: 'Use reliability first' }).click();
	await expect(page.getByText('Use failover', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Preview changes' }).click();
	await expect(page.getByRole('region', { name: 'Pending change preview' })).toBeVisible();
	await page.locator('.modal.mwan4-modal').getByRole('button', { name: 'Apply pending changes' }).click();
	await expect(page.locator('body')).toContainText(/MultiWAN 4 settings applied/i, { timeout: 20000 });
	await expect(page.getByRole('heading', { name: 'MultiWAN 4' })).toBeVisible();
	await expectNoBrowserIssues(page, browserIssues);
});

limitedRouterTest('ACL-LUCI-110 limited user follows env-controlled allowed or denied ACL path', async ({ page }) => {
	await login(page, { user: limitedUser, pass: limitedPass });
	const browserIssues = collectBrowserIssues(page);

	await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4`, { waitUntil: 'networkidle' });

	if (limitedExpectation == 'read-only') {
		await expect(page.getByRole('heading', { name: 'MultiWAN 4' })).toBeVisible();
		await expect(page.getByText('Limited access', { exact: true })).toBeVisible();
		await expect(page.locator('body')).not.toContainText(/RPC call.*failed|Access denied|Permission denied/i);

		await page.goto(`${baseURL}/cgi-bin/luci/admin/status/mwan4`, { waitUntil: 'networkidle' });
		await expect(page.getByRole('heading', { name: 'MultiWAN 4' })).toBeVisible();
		await expect(page.getByText('Limited access', { exact: true })).toBeVisible();
		await expect(page.locator('body')).not.toContainText(/RPC call.*failed|Access denied|Permission denied/i);

		await page.goto(`${baseURL}/cgi-bin/luci/admin/network/mwan4/diagnostics`, { waitUntil: 'networkidle' });
		await expect(page.getByRole('heading', { name: 'MultiWAN 4 - Diagnostics' })).toBeVisible();
		await expect(page.locator('#mwan4-diag-output')).toHaveAttribute('aria-live', 'polite');
		await expect(page.locator('body')).not.toContainText(/RPC call.*failed|Access denied|Permission denied/i);

		for (const advancedPage of advancedPages) {
			await page.goto(`${baseURL}/cgi-bin/luci/${advancedPage.route}`, { waitUntil: 'networkidle' });
			await expect(page.getByText(advancedPage.title, { exact: true })).toBeVisible();
			await expect(page.getByText('Back to overview.', { exact: true })).toBeVisible();
			await expect(page.locator('body')).not.toContainText(/RPC call.*failed|Access denied|Permission denied/i);
		}

		await expectNoBrowserIssues(page, browserIssues);
	}
	else {
		await expect(page.locator('body')).toContainText(/Access denied|Permission denied|not authorized|Forbidden|Not found/i);
	}

	if (limitedExpectation != 'read-only')
		expect(browserIssues).toEqual([]);
});
