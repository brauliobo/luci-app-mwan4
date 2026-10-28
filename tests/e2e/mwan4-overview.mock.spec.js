const { test, expect } = require('@playwright/test');
const { defaultConnections, defaultCounters, defaultDiagnostics, defaultLinkHistory, defaultPbrPreview, defaultStatus, defaultUci, renderDiagnostics, renderOverview, renderStatus, stableStatus } = require('./helpers/luci-rpc-mock');

function uciWithRules() {
	const uci = defaultUci();
	const defaults = uci.mwan4.filter(function(section) { return /^default_rule_v[46]$/.test(section['.name']); });
	const rest = uci.mwan4.filter(function(section) { return defaults.indexOf(section) < 0; });

	uci.mwan4 = rest.concat([
		{ '.type': 'rule', '.name': 'streaming', label: 'Streaming', enabled: '1', domain: [ 'netflix.com', 'youtube.com' ], dest_ip: [ '203.0.113.0/24' ], src_mac: [ 'aa:bb:cc:dd:ee:01' ], proto: 'tcp', dest_port: '443', use_strategy: 'failover', family: [ 'ipv4', 'ipv6' ] },
		{ '.type': 'rule', '.name': 'console', label: 'Gaming console', enabled: '0', src_ip: [ '192.168.1.50' ], dscp: '46', local: '1', use_strategy: 'default', family: [ 'ipv4' ] },
		{ '.type': 'rule', '.name': 'backups', enabled: '1', dest_ip: '198.51.100.7', use_strategy: 'unreachable', family: [ 'ipv4' ] }
	]).concat(defaults);
	uci.mwan4.forEach(function(section, index) { section['.index'] = index; });

	return uci;
}

async function ruleOrder(page) {
	return page.evaluate(function() {
		return window.__mwan4Mock.getUci().mwan4.filter(function(section) { return section['.type'] == 'rule'; }).map(function(section) { return section['.name']; });
	});
}

async function ruleSection(page, name) {
	return page.evaluate(function(sid) {
		return window.__mwan4Mock.getUci().mwan4.find(function(section) { return section['.name'] == sid; });
	}, name);
}

test.describe('mocked mwan4 overview workspace', () => {
	test('renders live WAN and SLA data without turning missing metrics into zeroes', async ({ page }) => {
		const status = defaultStatus();
		status.interfaces.wan_primary = {
			status: 'degraded',
			up: true,
			tracking: 'tracking',
			track_method: 'ping',
			score_percent: null,
			score_current: null,
			score_max: 10,
			failed_checks: null,
			failed_targets: 1,
			families: {
				ipv4: { status: 'online', health_state: 'online', up: true },
				ipv6: { status: 'degraded', health_state: 'degraded', up: true }
			},
			track_ip: [
				{ ip: '1.1.1.1', status: 'online', latency: 22, packetloss: 0 },
				{ ip: '8.8.8.8', status: 'unknown' }
			]
		};

		await renderOverview(page, { status });

		const workspace = page.locator('#mwan4-wan-workspace');
		const row = workspace.locator('[data-interface="wan_primary"]');
		const missingTarget = row.locator('.mwan4-target-summary li').filter({ hasText: '8.8.8.8' });

		await expect(workspace).toContainText('WAN workspace');
		await expect(workspace).toContainText('WAN health matrix');
		await expect(workspace).toContainText('Compare saved WAN/SLA settings with live tracker state. Missing measurements stay explicit.');
		await expect(row).toContainText('IPv4: online');
		await expect(row).toContainText('IPv6: degraded');
		await expect(row).toContainText('Not measured');
		await expect(row).toContainText('unmeasured');
		await expect(row).toContainText('SLA: fail 1000ms/40%, recover 500ms/10%');
		await expect(missingTarget).toContainText('-');
		await expect(missingTarget).not.toContainText('0%');
		await expect(page.locator('body')).not.toContainText('[object Object]');
	});

	test('never renders empty children as the text null or undefined', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		const stray = await page.evaluate(function() {
			return Array.from(document.querySelectorAll('body *')).filter(function(node) {
				return Array.from(node.childNodes).some(function(child) { return child.nodeType == 3 && /^(null|undefined|false)+$/.test(child.textContent.trim()); });
			}).map(function(node) { return node.className || node.tagName; });
		});

		expect(stray).toEqual([]);
	});

	test('moves advanced diagnostics shortcuts out of the compact WAN workspace', async ({ page }) => {
		await renderOverview(page);

		const workspace = page.locator('#mwan4-wan-workspace');
		const commandCenter = page.locator('#mwan4-command-center');

		await expect(workspace.locator('.mwan4-advanced-signals')).toHaveCount(0);
		await expect(workspace).not.toContainText('PBR');
		await expect(workspace).not.toContainText('MPTCP');
		await expect(commandCenter.getByRole('link', { name: 'Open Advanced' })).toHaveAttribute('href', /admin\/network\/mwan4\/advanced/);
		await expect(commandCenter.getByRole('link', { name: 'Open Diagnostics' })).toHaveAttribute('href', /admin\/network\/mwan4\/diagnostics/);
	});

	test('counts only enabled health-online runtime interface sections as WAN links', async ({ page }) => {
		const status = defaultStatus();
		status.interfaces = {
			wan_vivo: { enabled: true, health_state: 'online', status: 'online', up: true },
			wan_vivo6: { enabled: true, status: 'online', up: true },
			wan_tim: { enabled: true, health_state: 'offline', status: 'offline', up: true },
			wan_tim6: { enabled: true, health_state: 'degraded', status: 'online', up: true },
			wan_str: { enabled: true, health_state: 'offline', status: 'online', up: true },
			wan_str6: { enabled: true, status: 'offline', up: true },
			wan_disabled: { enabled: false, health_state: 'online', status: 'online', up: true }
		};

		await renderOverview(page, { status });

		const commandCenter = page.locator('#mwan4-command-center');
		await expect(commandCenter).toContainText('2/6 online');
		await expect(commandCenter).toContainText('Degraded');
	});

	test('hides advanced workspace link without the advanced ACL', async ({ page }) => {
		await renderOverview(page, { advancedAccess: false });

		const commandCenter = page.locator('#mwan4-command-center');

		await expect(commandCenter.getByRole('link', { name: 'Open Advanced' })).toHaveCount(0);
		await expect(commandCenter.getByRole('link', { name: 'Open Diagnostics' })).toBeVisible();
	});

	test('gates status, config, operator, diagnostics, and advanced surfaces by mocked ACL role', async ({ page }) => {
		await renderStatus(page, { configAccess: false, diagnosticsAccess: false });
		await expect(page.getByRole('heading', { name: 'MultiWAN 4' })).toBeVisible();
		await expect(page.getByText('Read-only runtime summary. Configuration and diagnostics links are shown only when this session has the matching ACL.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Open network overview' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Open diagnostics' })).toHaveCount(0);
		await expect(page.getByText('No configuration or diagnostics ACL is available for this session.')).toBeVisible();

		await renderStatus(page, { configAccess: true, diagnosticsAccess: true });
		await expect(page.getByRole('link', { name: 'Open network overview' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Open diagnostics' })).toBeVisible();

		await renderOverview(page, { operatorAccess: false, advancedAccess: false, diagnosticsAccess: false });
		await expect(page.getByRole('button', { name: 'Edit WAN link wan_primary' })).toBeVisible();
		await expect(page.getByRole('button', { name: /Bring WAN link/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /Take WAN link/ })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Open Advanced' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Open Diagnostics' })).toHaveCount(0);

		await renderDiagnostics(page, { diagnosticsAccess: false, operatorAccess: true });
		await expect(page.getByRole('button', { name: 'Run Summary diagnostics' })).toBeDisabled();
		await expect(page.getByText('Diagnostic commands are disabled for this session.')).toBeVisible();

		await renderDiagnostics(page, { diagnosticsAccess: true, operatorAccess: false });
		await page.getByRole('button', { name: 'Run Counters', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Reset nft counters' })).toBeDisabled();
		const calls = await page.evaluate(function() { return window.__mwan4Mock.rpcCalls; });
		expect(calls.some(function(call) { return call.object == 'mwan4' && call.method == 'control'; })).toBeFalsy();
	});

	test('keeps empty WAN workspace focused on first setup only', async ({ page }) => {
		await renderOverview(page, {
			uci: { mwan4: [], network: [] },
			status: { interfaces: {}, diagnostics: { warnings: [] } },
			counters: { counters: {} }
		});

		const workspace = page.locator('#mwan4-wan-workspace');

		await expect(page.locator('#mwan4-command-center')).toContainText('No WAN links are configured');
		await expect(workspace).toContainText('No WAN links configured.');
		await expect(workspace).not.toContainText('PBR');
		await expect(workspace).not.toContainText('MPTCP');
		await expect(workspace).not.toContainText('Tunnel diagnostics');
	});

	test('poll refresh updates command center, WAN workspace, and counter strip', async ({ page }) => {
		const status = defaultStatus();
		const counters = { counters: {} };

		await renderOverview(page, { status, counters });
		await expect(page.locator('#mwan4-command-center')).toContainText('Ready');
		await expect(page.locator('.mwan4-counter-strip')).toBeHidden();

		status.interfaces.wan_backup = {
			status: 'offline',
			up: false,
			tracking: 'failed',
			track_method: 'httping',
			score_percent: 30,
			score_current: 3,
			score_max: 10,
			failed_checks: 2,
			failed_targets: 1,
			families: {
				ipv4: { status: 'offline', health_state: 'offline', up: false }
			},
			track_ip: [ { ip: '9.9.9.9', status: 'timeout', latency: null, packetloss: null } ]
		};

		await page.evaluate(function(next) {
			window.__mwan4Mock.setStatus(next.status);
			window.__mwan4Mock.setCounters(next.counters);
			return window.__mwan4Mock.runPoll();
		}, { status: status, counters: defaultCounters() });

		await expect(page.locator('#mwan4-command-center')).toContainText('Degraded');
		await expect(page.locator('#mwan4-wan-workspace [data-interface="wan_backup"]')).toContainText('offline');
		await expect(page.locator('#mwan4-wan-workspace')).toContainText('Matched packets');
		await expect(page.locator('#mwan4-wan-workspace')).toContainText('Path counters');
	});

	test('poll refresh follows health transitions while carrier remains up', async ({ page }) => {
		const status = defaultStatus();
		status.interfaces.wan_primary.enabled = true;
		status.interfaces.wan_primary.health_state = 'online';
		status.interfaces.wan_backup.enabled = true;
		status.interfaces.wan_backup.health_state = 'online';

		await renderOverview(page, { status });
		await expect(page.locator('#mwan4-command-center')).toContainText('2/2 online');

		status.interfaces.wan_backup.health_state = 'offline';
		status.interfaces.wan_backup.status = 'offline';
		expect(status.interfaces.wan_backup.up).toBe(true);

		await page.evaluate(function(nextStatus) {
			window.__mwan4Mock.setStatus(nextStatus);
			return window.__mwan4Mock.runPoll();
		}, status);

		const commandCenter = page.locator('#mwan4-command-center');
		await expect(commandCenter).toContainText('1/2 online');
		await expect(commandCenter).toContainText('Degraded');
	});

	test('writes dual-stack family selection from the compact WAN editor', async ({ page }) => {
		await renderOverview(page);

		await page.getByRole('button', { name: 'Edit WAN link wan_backup' }).click();
		await page.locator('.modal select[name="family"]').selectOption('dual');
		await page.getByRole('button', { name: 'Preview changes' }).click();

		await expect(page.locator('.modal')).toContainText('Address families');
		await expect(page.locator('.modal')).toContainText('ipv4, ipv6');

		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const uci = await page.evaluate(function() { return window.__mwan4Mock.getUci(); });
		const wanBackup = uci.mwan4.find(function(section) { return section['.name'] == 'wan_backup'; });

		expect(wanBackup.family).toEqual([ 'ipv4', 'ipv6' ]);
	});

	test('routing presets preserve custom paths and replace only generated paths', async ({ page }) => {
		const uci = defaultUci();
		uci.mwan4.push(
			{ '.type': 'route', '.name': 'custom_vpn_path', interface: 'wan_primary', metric: '50', weight: '1' },
			{ '.type': 'route', '.name': 'ui_wan_old_m1_1234', interface: 'wan_backup', metric: '1', weight: '1' }
		);

		await renderOverview(page, { uci });
		await page.getByRole('button', { name: 'Use throughput first' }).click();
		await page.getByRole('button', { name: 'Preview changes' }).click();

		await expect(page.locator('.modal')).toContainText('Generated paths replaced');
		await expect(page.locator('.modal')).toContainText('Custom paths preserved');

		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const result = await page.evaluate(function() { return window.__mwan4Mock.getUci(); });
		const routes = result.mwan4.filter(function(section) { return section['.type'] == 'route'; });

		expect(routes.some(function(route) { return route['.name'] == 'custom_vpn_path'; })).toBeTruthy();
		expect(routes.some(function(route) { return route['.name'] == 'ui_wan_old_m1_1234'; })).toBeFalsy();
		expect(routes.filter(function(route) { return route.generated_by == 'luci-overview'; }).length).toBeGreaterThan(0);
	});

	test('runs route explain with a real traffic tuple from diagnostics', async ({ page }) => {
		await renderDiagnostics(page);

		await expect(page.getByRole('group', { name: 'Route explain tuple' })).toBeVisible();
		await page.locator('#mwan4-route-explain-form input[name="src_ip"]').fill('192.0.2.10');
		await page.locator('#mwan4-route-explain-form input[name="dest_ip"]').fill('1.1.1.1');
		await page.locator('#mwan4-route-explain-form input[name="dest_port"]').fill('443');
		await page.locator('#mwan4-route-explain-form input[name="src_iface"]').fill('lan');
		await page.locator('#mwan4-route-explain-form input[name="ipset"]').fill('streaming');
		await page.locator('#mwan4-route-explain-form input[name="strategy"]').fill('failover');
		await page.getByRole('button', { name: 'Explain tuple' }).click();

		await expect(page.locator('#mwan4-diag-output')).toContainText('Requested tuple');
		await expect(page.locator('#mwan4-diag-output')).toContainText('ipv4 tcp 192.0.2.10 -> 1.1.1.1:443');
		await expect(page.locator('#mwan4-diag-output')).toContainText('Matched policy');
		await expect(page.locator('#mwan4-diag-output')).toContainText('speed_test');
		await expect(page.locator('#mwan4-diag-output')).toContainText('Ingress interface');
		await expect(page.locator('#mwan4-diag-output')).toContainText('streaming');
		await expect(page.locator('#mwan4-diag-output pre.mwan4-output')).toBeHidden();
		await page.getByRole('button', { name: 'Show raw response' }).click();
		await expect(page.locator('#mwan4-diag-output pre.mwan4-output')).toBeVisible();

		const calls = await page.evaluate(function() { return window.__mwan4Mock.rpcCalls; });
		const explainCall = calls.find(function(call) { return call.object == 'mwan4' && call.method == 'diagnostics' && call.params[0] == 'explain'; });

		expect(explainCall.params.slice(2, 11)).toEqual([ 'ipv4', '192.0.2.10', '1.1.1.1', 'tcp', null, '443', 'lan', 'streaming', 'failover' ]);
	});

	test('resets grouped counters through constrained control rpc', async ({ page }) => {
		const diagnostics = defaultDiagnostics();
		diagnostics.counters = {
			diagnostics: {
				counters: {
					items: {
						mwan4_counter_rule_default_rule_v4_ipv4: { packets: 12, bytes: 3456 }
					},
					summary: { total: 1, packets: 12, bytes: 3456 },
					references: {}
				}
			}
		};

		await renderDiagnostics(page, { diagnostics, operatorAccess: true });
		await page.getByRole('button', { name: 'Run Counters', exact: true }).click();

		await expect(page.locator('#mwan4-diag-output')).toContainText('Reset nft counters');
		await page.getByRole('button', { name: 'Reset nft counters' }).click();

		const calls = await page.evaluate(function() { return window.__mwan4Mock.rpcCalls; });
		const resetCall = calls.find(function(call) { return call.object == 'mwan4' && call.method == 'control' && call.params[0] == 'reset_counters'; });
		const counterRefresh = calls.filter(function(call) { return call.object == 'mwan4' && call.method == 'diagnostics' && call.params[0] == 'counters'; });

		expect(resetCall).toBeTruthy();
		expect(counterRefresh.length).toBeGreaterThanOrEqual(2);
	});

	test('renders package readiness and validation diagnostics as typed panels', async ({ page }) => {
		await renderDiagnostics(page);

		await page.getByRole('button', { name: 'Run Packages', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Package readiness');
		await expect(page.locator('#mwan4-diag-output')).toContainText('Feature package map');
		await expect(page.locator('#mwan4-diag-output')).toContainText('kmod-wireguard');

		await page.getByRole('button', { name: 'Run PBR', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('PBR validation');
		await expect(page.locator('#mwan4-diag-output')).toContainText('mark mask separation');

		await page.getByRole('button', { name: 'Run WAN links diagnostics', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('WAN link diagnostics');
		await page.getByRole('button', { name: 'Run Paths diagnostics', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Route table snapshot');
		await page.getByRole('button', { name: 'Run Traffic policies diagnostics', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Traffic policy routing');
		await page.getByRole('button', { name: 'Run nftables diagnostics', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('nftables runtime');
		await page.getByRole('button', { name: 'Run Service diagnostics', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Service state');
		await page.getByRole('button', { name: 'Run MPTCP', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('MPTCP route alignment');
		await page.getByRole('button', { name: 'Run Quality', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Quality edge states');
		await expect(page.locator('#mwan4-diag-output')).toContainText('wan_backup helper cannot report latency/loss quality');
		await page.getByRole('button', { name: 'Run Probes', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Probe failures');
		await page.getByRole('button', { name: 'Run VRF', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('VRF table routes');
		await page.getByRole('button', { name: 'Run Tunnels', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Recursion warnings');
		await page.getByRole('button', { name: 'Run Ownership', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Ownership object inventory');
		await page.getByRole('button', { name: 'Run Counters', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Missing counter definitions');
	});
});

test.describe('mocked mwan4 routing rules', () => {
	test('lists rules in priority order with chips, live via health, hit counters, and a locked default', async ({ page }) => {
		const status = defaultStatus();
		const counters = defaultCounters();

		status.interfaces.wan_backup.health_state = 'offline';
		counters.counters.mwan4_counter_rule_streaming_ipv4 = { packets: 42, bytes: 4096 };
		counters.counters.mwan4_counter_rule_streaming_ipv6 = { packets: 8, bytes: 1024 };
		status.diagnostics.warnings = [ { rule: 'streaming', message: 'dnsmasq-full with nftset support is missing' } ];

		await renderOverview(page, { uci: uciWithRules(), status, counters });

		const rows = page.locator('.mwan4-rules .mwan4-rule-row');
		const streaming = page.locator('[data-rule="streaming"]');

		await expect(page.getByRole('heading', { name: 'Routing rules' })).toBeVisible();
		await expect(rows).toHaveCount(5);
		await expect(rows.nth(0)).toHaveAttribute('data-rule', 'streaming');
		await expect(rows.nth(2)).toHaveAttribute('data-rule', 'backups');
		await expect(rows.nth(3)).toHaveAttribute('data-rule', 'default_rule_v4');
		await expect(rows.nth(4)).toHaveAttribute('data-rule', 'default_rule_v6');
		await expect(rows.nth(3)).not.toHaveAttribute('draggable', 'true');
		await expect(rows.nth(3).getByRole('button')).toHaveCount(0);
		await expect(rows.nth(3).getByRole('checkbox')).toHaveCount(0);

		await expect(streaming).toContainText('Streaming');
		await expect(streaming.locator('.mwan4-chip-domain')).toHaveText([ 'netflix.com', 'youtube.com' ]);
		await expect(streaming.locator('.mwan4-chip-ip')).toHaveText([ '203.0.113.0/24' ]);
		await expect(streaming).toContainText('living-room-tv (aa:bb:cc:dd:ee:01)');
		await expect(streaming).toContainText('TCP port 443');
		await expect(streaming.locator('.mwan4-via [data-wan="wan_primary"]')).toHaveClass(/mwan4-online/);
		await expect(streaming.locator('.mwan4-via [data-wan="wan_backup"]')).toHaveClass(/mwan4-offline/);
		await expect(streaming.locator('.mwan4-via')).toContainText('>');
		await expect(streaming).toContainText('ordered failover');
		await expect(streaming.locator('.mwan4-cell[data-label="Hits"]')).toContainText('50');
		await expect(streaming.locator('.mwan4-rule-warning')).toContainText('dnsmasq-full with nftset support is missing');
		await expect(page.locator('[data-rule="console"]')).toContainText('192.168.1.50');
		await expect(page.locator('[data-rule="console"]')).toContainText('DSCP 46');
		await expect(page.locator('[data-rule="console"]')).toContainText('Includes router traffic');
		await expect(page.locator('[data-rule="console"] .mwan4-rule-toggle')).not.toBeChecked();
		await expect(page.locator('[data-rule="backups"]')).toContainText('198.51.100.7');
		await expect(page.locator('[data-rule="default_rule_v4"]')).toContainText('Everything else');
		await expect(page.locator('[data-rule="default_rule_v4"] .mwan4-cell[data-label="Hits"]')).toContainText('9');
		await expect(page.locator('[data-rule="default_rule_v4"] .mwan4-via')).toContainText('wan_primary');
		await expect(page.locator('details')).toHaveCount(0);
	});

	test('keeps the hit counters of the rules table fresh on poll', async ({ page }) => {
		const counters = defaultCounters();

		await renderOverview(page, { uci: uciWithRules(), counters });
		await expect(page.locator('[data-rule="streaming"] .mwan4-cell[data-label="Hits"]')).toContainText('-');

		counters.counters.mwan4_counter_rule_streaming_ipv4 = { packets: 7, bytes: 700 };
		await page.evaluate(function(next) {
			window.__mwan4Mock.setCounters(next);
			return window.__mwan4Mock.runPoll();
		}, counters);

		await expect(page.locator('[data-rule="streaming"] .mwan4-cell[data-label="Hits"]')).toContainText('7');
	});

	test('shows the empty state with the default routing only', async ({ page }) => {
		await renderOverview(page);

		await expect(page.locator('.mwan4-rules')).toContainText('No routing rules yet.');
		await expect(page.locator('.mwan4-rules .mwan4-rule-row')).toHaveCount(2);
		await expect(page.getByRole('button', { name: 'Add routing rule' }).first()).toBeVisible();
	});

	test('toggles a rule from the table and keeps the order', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		await page.locator('[data-rule="console"] .mwan4-rule-toggle').check();
		await expect.poll(async () => (await ruleSection(page, 'console')).enabled).toBe('1');

		await page.locator('[data-rule="streaming"] .mwan4-rule-toggle').uncheck();
		await expect.poll(async () => (await ruleSection(page, 'streaming')).enabled).toBe('0');
		expect(await ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'default_rule_v4', 'default_rule_v6' ]);

		const calls = await page.evaluate(function() { return window.__mwan4Mock.rpcCalls; });
		expect(calls.filter(function(call) { return call.method == 'validate'; }).length).toBe(2);
	});

	test('reorders rules with the move buttons and by dragging, defaults always stay last', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		await expect(page.getByRole('button', { name: 'Move routing rule Streaming up' })).toBeDisabled();
		await page.getByRole('button', { name: 'Move routing rule Streaming down' }).click();
		await expect.poll(() => ruleOrder(page)).toEqual([ 'console', 'streaming', 'backups', 'default_rule_v4', 'default_rule_v6' ]);

		await page.getByRole('button', { name: 'Move routing rule backups down' }).waitFor({ state: 'attached' });
		await expect(page.getByRole('button', { name: 'Move routing rule backups down' })).toBeDisabled();
		await page.getByRole('button', { name: 'Move routing rule backups up' }).click();
		await expect.poll(() => ruleOrder(page)).toEqual([ 'console', 'backups', 'streaming', 'default_rule_v4', 'default_rule_v6' ]);

		await page.locator('[data-rule="streaming"]').dragTo(page.locator('[data-rule="console"]'), { targetPosition: { x: 40, y: 2 } });
		await expect.poll(() => ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'default_rule_v4', 'default_rule_v6' ]);

		await expect(page.locator('.mwan4-rules .mwan4-rule-row').nth(3)).toHaveAttribute('data-rule', 'default_rule_v4');
		await expect(page.locator('.mwan4-rules .mwan4-rule-row').nth(4)).toHaveAttribute('data-rule', 'default_rule_v6');
	});

	test('classifies mixed domain and IP input in the What box and writes separate UCI options', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Add routing rule' }).first().click();

		await page.locator('.modal input[name="label"]').fill('Video sites');
		await page.locator('.modal textarea[name="what"]').fill('https://www.YouTube.com/watch?v=1\n203.0.113.0/24, youtu.be\n2001:db8::/32\nyoutu.be');

		const classified = page.locator('#mwan4-rule-classified');
		await expect(classified.locator('.mwan4-chip-domain')).toHaveText([ 'www.youtube.com', 'youtu.be' ]);
		await expect(classified.locator('.mwan4-chip-ip')).toHaveText([ '203.0.113.0/24', '2001:db8::/32' ]);

		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('www.youtube.com, youtu.be, 203.0.113.0/24, 2001:db8::/32');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'video_sites');
		expect(rule.label).toBe('Video sites');
		expect(rule.domain).toEqual([ 'www.youtube.com', 'youtu.be' ]);
		expect(rule.dest_ip).toEqual([ '203.0.113.0/24', '2001:db8::/32' ]);
		expect(rule.family).toEqual([ 'ipv4', 'ipv6' ]);
		expect(rule.enabled).toBe('1');
		expect(rule.use_strategy).toBe('failover');
		expect(rule.src_ip).toBeNull();
		expect(await ruleOrder(page)).toEqual([ 'video_sites', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('answers what, who, and via with a Prefer preset that creates the strategy', async ({ page }) => {
		const uci = uciWithRules();

		await renderOverview(page, { uci });
		await page.getByRole('button', { name: 'Add routing rule' }).first().click();

		await expect(page.locator('.modal')).toContainText('1. What traffic?');
		await expect(page.locator('.modal')).toContainText('2. Who?');
		await expect(page.locator('.modal')).toContainText('3. Via which WAN links?');
		await expect(page.locator('.modal details')).toHaveCount(0);
		await expect(page.locator('.modal')).toContainText('Extra match and logging');

		await page.locator('.modal input[name="label"]').fill('A very long rule name for the living room tv');
		await page.locator('.modal textarea[name="what"]').fill('hbo.com');
		await page.locator('.modal select[name="proto"]').selectOption('tcp');
		await page.locator('.modal input[name="dest_port"]').fill('443, 8443');

		await expect(page.locator('.modal [data-who-mode="devices"]')).toBeHidden();
		await page.locator('.modal select[name="who_mode"]').selectOption('devices');
		await expect(page.locator('.modal [data-who-mode="devices"]')).toBeVisible();
		await page.locator('.modal select[name="device_pick"]').selectOption('aa:bb:cc:dd:ee:01');
		await page.locator('.modal select[name="device_pick"]').selectOption('aa:bb:cc:dd:ee:02');
		await page.locator('.modal textarea[name="who"]').fill((await page.locator('.modal textarea[name="who"]').inputValue()) + '\n192.168.1.99');
		await expect(page.locator('.modal select[name="device_pick"]')).toContainText('living-room-tv / 192.168.1.20 / aa:bb:cc:dd:ee:01');

		const via = page.locator('.modal select[name="use_strategy"]');
		await expect(via.locator('optgroup')).toHaveCount(3);
		await via.selectOption('prefer:wan_backup');
		await page.locator('.modal input[name="dscp"]').fill('46');
		await page.locator('.modal input[name="local"]').check();

		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('Prefer wan_backup, fall back to others');
		await expect(page.locator('.modal')).toContainText('living-room-tv (aa:bb:cc:dd:ee:01)');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'a_very_long_rul');
		const strategy = await ruleSection(page, 'wan_backup_first');
		const routes = await page.evaluate(function(names) {
			return window.__mwan4Mock.getUci().mwan4.filter(function(section) { return names.indexOf(section['.name']) >= 0; });
		}, strategy.use_route);

		expect('a_very_long_rul'.length).toBeLessThanOrEqual(15);
		expect(rule.label).toBe('A very long rule name for the living room tv');
		expect(rule.domain).toEqual([ 'hbo.com' ]);
		expect(rule.proto).toBe('tcp');
		expect(rule.dest_port).toBe('443, 8443');
		expect(rule.src_mac).toEqual([ 'aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02' ]);
		expect(rule.src_ip).toEqual([ '192.168.1.99' ]);
		expect(rule.dscp).toBe('46');
		expect(rule.local).toBe('1');
		expect(rule.use_strategy).toBe('wan_backup_first');
		expect(strategy.last_resort).toBe('unreachable');
		expect(routes.map(function(route) { return [ route.interface, route.metric ]; })).toEqual([ [ 'wan_backup', '1' ], [ 'wan_primary', '2' ] ]);
		expect(await ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'a_very_long_rul', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('Only preset creates a fail-closed strategy and reuses it for the next rule', async ({ page }) => {
		await renderOverview(page);

		for (const label of [ 'Tunnel one', 'Tunnel two' ]) {
			await page.getByRole('button', { name: 'Add routing rule' }).first().click();
			await page.locator('.modal input[name="label"]').fill(label);
			await page.locator('.modal textarea[name="what"]').fill('example.org');
			await page.locator('.modal select[name="use_strategy"]').selectOption('only:wan_primary');
			await page.getByRole('button', { name: 'Preview changes' }).click();
			await page.getByRole('button', { name: 'Apply pending changes' }).click();
		}

		const uci = await page.evaluate(function() { return window.__mwan4Mock.getUci(); });
		const strategies = uci.mwan4.filter(function(section) { return section['.type'] == 'strategy' && section['.name'] == 'wan_primary_only'; });

		expect(strategies).toHaveLength(1);
		expect(strategies[0].last_resort).toBe('unreachable');
		expect(uci.mwan4.filter(function(section) { return section.generated_by == 'luci-rule'; }).map(function(route) { return route.interface; })).toEqual([ 'wan_primary' ]);
		expect(await ruleOrder(page)).toEqual([ 'tunnel_one', 'tunnel_two', 'default_rule_v4', 'default_rule_v6' ]);
		expect((await ruleSection(page, 'tunnel_two')).use_strategy).toBe('wan_primary_only');
	});

	test('edits an existing rule and picks an interface as the source', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Edit routing rule Streaming' }).click();

		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('netflix.com\nyoutube.com\n203.0.113.0/24');
		await expect(page.locator('.modal select[name="who_mode"]')).toHaveValue('devices');
		await expect(page.locator('.modal textarea[name="who"]')).toHaveValue('aa:bb:cc:dd:ee:01');

		await page.locator('.modal select[name="who_mode"]').selectOption('iface');
		await page.locator('.modal select[name="src_iface"]').selectOption('wan_backup');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('Interface wan_backup');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'streaming');
		expect(rule.src_iface).toBe('wan_backup');
		expect(rule.src_mac).toBeNull();
		expect(rule.src_ip).toBeNull();
		expect(await ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('validates domains, addresses, MACs, ports, and DSCP inline', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Add routing rule' }).first().click();

		const problem = page.locator('#mwan4-rule-validation');

		await expect(problem).toBeHidden();
		await page.locator('.modal textarea[name="what"]').fill('example.com');
		await expect(problem).toHaveText('Give the rule a name.');

		await page.locator('.modal input[name="label"]').fill('Checks');
		await page.locator('.modal textarea[name="what"]').fill('example.com\nnot a domain!\n999.1.1.1\n10.0.0.0/33');
		await expect(problem).toContainText('Not a domain name or IP address: not, a, domain!, 999.1.1.1, 10.0.0.0/33');
		await expect(page.locator('#mwan4-rule-classified .mwan4-offline')).toHaveCount(5);

		await page.locator('.modal textarea[name="what"]').fill('aa:bb:cc:dd:ee:01');
		await expect(problem).toContainText('MAC addresses belong in Who');

		await page.locator('.modal textarea[name="what"]').fill('example.com');
		await page.locator('.modal input[name="dest_port"]').fill('443');
		await expect(problem).toContainText('Choose TCP or UDP before adding source or destination ports.');
		await page.locator('.modal select[name="proto"]').selectOption('udp');
		await page.locator('.modal input[name="dest_port"]').fill('70000');
		await expect(problem).toContainText('Use ports from 1-65535');

		await page.locator('.modal input[name="dest_port"]').fill('');
		await page.locator('.modal input[name="dscp"]').fill('64');
		await expect(problem).toContainText('Use a DSCP value from 1 to 63.');
		await page.locator('.modal input[name="dscp"]').fill('');

		await page.locator('.modal select[name="who_mode"]').selectOption('devices');
		await page.locator('.modal textarea[name="who"]').fill('laptop.lan');
		await expect(problem).toContainText('Devices must be IP addresses, CIDR ranges, or MAC addresses: laptop.lan');
		await page.locator('.modal textarea[name="who"]').fill('AA-BB-CC-DD-EE-09');
		await expect(problem).toBeHidden();

		await page.locator('.modal select[name="who_mode"]').selectOption('all');
		await page.locator('.modal textarea[name="what"]').fill('');
		await page.locator('.modal select[name="proto"]').selectOption('all');
		await expect(problem).toContainText('Add at least one thing to match');

		await page.locator('.modal textarea[name="what"]').fill('198.51.100.0/24');
		await page.locator('.modal select[name="proto"]').selectOption('icmpv6');
		await expect(problem).toContainText('do not share an IP family');

		await page.locator('.modal select[name="proto"]').selectOption('all');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await page.getByRole('button', { name: 'Apply pending changes' }).click();
		expect((await ruleSection(page, 'checks')).family).toEqual([ 'ipv4' ]);
	});

	test('removes a rule from the editor after a preview', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Edit routing rule Gaming console' }).click();
		await page.getByRole('button', { name: 'Remove' }).click();
		await expect(page.locator('.modal')).toContainText('This will remove the routing rule');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		expect(await ruleOrder(page)).toEqual([ 'streaming', 'backups', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('hides Import from PBR unless pbr_import reports policies and the session can write', async ({ page }) => {
		await renderOverview(page);
		await expect(page.getByRole('button', { name: 'Import routing rules from PBR' })).toHaveCount(0);

		await renderOverview(page, { pbrPreview: defaultPbrPreview(), configWrite: false });
		await expect(page.getByRole('button', { name: 'Import routing rules from PBR' })).toHaveCount(0);

		await renderOverview(page, { pbrPreview: defaultPbrPreview() });
		await expect(page.getByRole('button', { name: 'Import routing rules from PBR' })).toBeVisible();
	});

	test('previews the PBR import as a dry run and applies it on confirm', async ({ page }) => {
		await renderOverview(page, { pbrPreview: defaultPbrPreview() });
		await page.getByRole('button', { name: 'Import routing rules from PBR' }).click();

		const modal = page.locator('.modal');
		await expect(modal).toContainText('Dry-run preview');
		await expect(modal.locator('tr[data-pbr-section="cfg1"]')).toContainText('youtube');
		await expect(modal.locator('tr[data-pbr-section="cfg1"]')).toContainText('pbr_youtube');
		await expect(modal.locator('tr[data-pbr-section="cfg1"]')).toContainText('wan_backup_first');
		await expect(modal.locator('tr[data-pbr-section="cfg1"]')).toContainText('Import');
		await expect(modal.locator('tr[data-pbr-section="cfg2"]')).toContainText('Skipped');
		await expect(modal.locator('tr[data-pbr-section="cfg2"]')).toContainText('dns_policy is not supported');
		await expect(modal.locator('.mwan4-import-warnings')).toContainText('20-discord-chrome.sh was not imported');
		await expect(modal).toContainText('Strategies to create: wan_backup_first');

		let calls = await page.evaluate(function() { return window.__mwan4Mock.rpcCalls; });
		expect(calls.filter(function(call) { return call.method == 'pbr_import'; }).map(function(call) { return call.params[0]; })).toEqual([ false ]);
		expect(await ruleOrder(page)).toEqual([ 'default_rule_v4', 'default_rule_v6' ]);

		await modal.getByRole('button', { name: 'Import 1 rule(s)' }).click();
		await expect(page.locator('.mwan4-rules [data-rule="pbr_youtube"]')).toContainText('youtube');

		calls = await page.evaluate(function() { return window.__mwan4Mock.rpcCalls; });
		expect(calls.filter(function(call) { return call.method == 'pbr_import'; }).map(function(call) { return call.params[0]; })).toContain(true);
		expect(await ruleOrder(page)).toEqual([ 'pbr_youtube', 'default_rule_v4', 'default_rule_v6' ]);
		await expect(page.locator('.modal')).toHaveCount(0);
	});
});

function collectErrors(page) {
	const errors = [];

	page.on('pageerror', error => errors.push(error.message));
	page.on('console', message => message.type() == 'error' && errors.push(message.text()));

	return errors;
}

function manyConnections(count) {
	const connections = defaultConnections();

	connections.items = Array.from({ length: count }, (_, index) => Object.assign({}, connections.items[0], { sport: 1000 + index }));

	return connections;
}

const rpcCount = (page, method) => page.evaluate(name => window.__mwan4Mock.rpcCalls.filter(call => call.method == name).length, method);
const lastConnectionsCall = page => page.evaluate(() => window.__mwan4Mock.rpcCalls.filter(call => call.method == 'connections').pop().params);

test.describe('mocked mwan4 connection counting', () => {
	test('shows active and new connections per rule and keeps the generated default row read-only', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		const streaming = page.locator('[data-rule="streaming"] .mwan4-cell[data-label="Connections"]');

		await expect(page.locator('.mwan4-rule-head')).toContainText('Connections');
		await expect(streaming.getByRole('button')).toHaveText('3 / 40');
		await expect(streaming.getByRole('button')).toHaveAttribute('title', 'IPv4: 2 active / 30 new, IPv6: 1 active / 10 new');
		await expect(page.locator('[data-rule="console"] .mwan4-cell[data-label="Connections"]')).toHaveText('-');
		await expect(page.locator('[data-rule="default_rule_v4"] .mwan4-cell[data-label="Connections"]')).toHaveText('4 / 9');
		await expect(page.locator('[data-rule="default_rule_v4"]').getByRole('button')).toHaveCount(0);
	});

	test('opens the connections modal filtered to a rule and lists its flows', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.locator('[data-rule="streaming"] .mwan4-conn-button').click();

		const modal = page.locator('.modal .mwan4-connections');
		const rows = modal.locator('.mwan4-conn-row');

		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('TCP');
		await expect(rows.first()).toContainText('192.168.1.30:51000');
		await expect(rows.first()).toContainText('203.0.113.10:443');
		await expect(rows.first()).toContainText('ESTABLISHED');
		await expect(rows.first()).toContainText('Streaming');
		await expect(rows.first()).toContainText('wan_primary');
		await expect(rows.first()).toContainText('146.5 KB');
		await expect(rows.first()).toContainText('2h 0m');
		await expect(modal.locator('select[name="rule"]')).toHaveValue('streaming');
		await expect(modal.locator('.mwan4-conn-total')).toHaveText('1 active connection(s)');
		await expect(page.locator('.modal details')).toHaveCount(0);
		expect((await lastConnectionsCall(page)).slice(0, 6)).toEqual([ 'streaming', null, null, null, null, null ]);

		await page.getByRole('button', { name: 'Close' }).click();
		await expect(page.locator('.modal')).toHaveCount(0);
	});

	test('filters by rule, WAN, strategy, family, protocol, and free text, with an empty state', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'View all active connections' }).click();

		const modal = page.locator('.modal .mwan4-connections');
		const rows = modal.locator('.mwan4-conn-row');

		await expect(rows).toHaveCount(3);
		await expect(rows.nth(2)).toContainText('Default routing');
		await modal.locator('select[name="interface"]').selectOption('wan_backup');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('UDP');
		await modal.locator('select[name="interface"]').selectOption('');
		await modal.locator('select[name="strategy"]').selectOption('failover');
		await expect(rows).toHaveCount(2);
		await modal.locator('select[name="family"]').selectOption('ipv6');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('[2001:db8:ffff::10]:443');
		await modal.locator('select[name="family"]').selectOption('');
		await modal.locator('select[name="proto"]').selectOption('udp');
		await expect(modal.locator('.mwan4-conn-empty')).toBeVisible();
		await modal.locator('select[name="strategy"]').selectOption('');
		await expect(rows).toHaveCount(1);
		await modal.locator('select[name="proto"]').selectOption('');
		await modal.locator('select[name="rule"]').selectOption('backups');
		await expect(rows).toHaveCount(1);
		await modal.locator('select[name="rule"]').selectOption('');
		await modal.locator('input[name="search"]').fill('203.0.113');
		await expect(rows).toHaveCount(1);
		await expect(modal.locator('.mwan4-conn-empty')).toBeHidden();
		await modal.locator('input[name="search"]').fill('no-such-flow');
		await expect(rows).toHaveCount(0);
		await expect(modal.locator('.mwan4-conn-empty')).toBeVisible();
		await expect(modal.locator('.mwan4-conn-empty')).toHaveText('No connections match these filters.');
	});

	test('hides the bytes column without accounting', async ({ page }) => {
		const connections = defaultConnections();

		connections.accounting = false;
		await renderOverview(page, { uci: uciWithRules(), connections });
		await page.getByRole('button', { name: 'View all active connections' }).click();

		await expect(page.locator('.modal .mwan4-conn-table th')).toHaveText([ 'Protocol', 'Source', 'Destination', 'State', 'Rule', 'Via WAN', 'TTL' ]);
	});

	test('refreshes while open and stops polling after close', async ({ page }) => {
		await page.clock.install();
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'View all active connections' }).click();

		const rows = page.locator('.modal .mwan4-conn-row');

		await expect(rows).toHaveCount(3);
		await page.evaluate(() => {
			const next = { ok: true, accounting: true, items: [ { family: 'ipv4', proto: 'tcp', src: '192.168.1.99', sport: 1, dst: '203.0.113.99', dport: 80, state: 'SYN_SENT', timeout: 30, packets: 1, bytes: 60, rule: 'streaming', rule_label: 'Streaming', interface: 'wan_primary', strategy: 'failover' } ] };

			window.__mwan4Mock.setConnections(next);
		});
		await page.clock.runFor(3100);
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('SYN_SENT');

		await page.getByRole('button', { name: 'Close' }).click();
		await page.clock.runFor(1000);

		const before = await rpcCount(page, 'connections');

		await page.clock.runFor(10000);
		expect(await rpcCount(page, 'connections')).toBe(before);
	});

	test('shows a truncation notice and loads more rows on demand', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules(), connections: manyConnections(250) });
		await page.getByRole('button', { name: 'View all active connections' }).click();

		const modal = page.locator('.modal .mwan4-connections');

		await expect(modal.locator('.mwan4-conn-row')).toHaveCount(200);
		await expect(modal.locator('.mwan4-conn-notice')).toContainText('Showing the first 200 of 250 connections');
		await modal.getByRole('button', { name: 'Show more' }).click();
		await expect(modal.locator('.mwan4-conn-row')).toHaveCount(250);
		await expect(modal.locator('.mwan4-conn-notice')).toBeHidden();
		expect((await lastConnectionsCall(page))[6]).toBe(400);
	});

	test('shows live counts and View connections in the rule editor', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Edit routing rule Streaming' }).click();

		const live = page.locator('.modal [data-rule-connections="streaming"]');

		await expect(live).toContainText('3 active, 40 new since the ruleset was loaded');

		const counters = defaultCounters();

		counters.rules.streaming.active_connections = { ipv4: 5, ipv6: 0, total: 5 };
		await page.evaluate(next => {
			window.__mwan4Mock.setCounters(next);
			return window.__mwan4Mock.runPoll();
		}, counters);
		await expect(live).toContainText('5 active, 40 new');

		await live.getByRole('button', { name: 'View connections' }).click();
		await expect(page.locator('.modal .mwan4-connections select[name="rule"]')).toHaveValue('streaming');
		await expect(page.locator('.modal .mwan4-conn-row')).toHaveCount(1);
	});

	test('does not offer connections while adding a new rule', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Add routing rule' }).first().click();

		await expect(page.locator('.modal [data-rule-connections]')).toHaveCount(0);
	});

	test('adds WAN, strategy, and header entry points that open a pre-filtered modal', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		await expect(page.locator('#mwan4-wan-workspace th').filter({ hasText: 'Active connections' })).toHaveCount(1);
		await expect(page.locator('.mwan4-conn-metric')).toContainText('3');
		await expect(page.locator('.mwan4-strategy-connections')).toContainText('failover: 5');

		await page.locator('[data-interface="wan_backup"] .mwan4-conn-button').click();
		await expect(page.locator('.modal .mwan4-connections select[name="interface"]')).toHaveValue('wan_backup');
		await expect(page.locator('.modal .mwan4-conn-row')).toHaveCount(1);
		await page.getByRole('button', { name: 'Close' }).click();

		await page.getByRole('button', { name: 'View active connections of strategy failover' }).click();
		await expect(page.locator('.modal .mwan4-connections select[name="strategy"]')).toHaveValue('failover');
		await expect(page.locator('.modal .mwan4-conn-row')).toHaveCount(2);
		await page.getByRole('button', { name: 'Close' }).click();

		await page.locator('.mwan4-conn-metric').click();
		await expect(page.locator('.modal .mwan4-conn-row')).toHaveCount(3);
	});

	test('updates the counts on poll', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		const status = defaultStatus();
		const counters = defaultCounters();

		status.interfaces.wan_backup.active_connections = { ipv4: 9, ipv6: 0, total: 9 };
		counters.rules.streaming.new_connections = { ipv4: 31, ipv6: 10, total: 41 };
		await page.evaluate(next => {
			window.__mwan4Mock.setStatus(next.status);
			window.__mwan4Mock.setCounters(next.counters);
			return window.__mwan4Mock.runPoll();
		}, { status, counters });

		await expect(page.locator('[data-interface="wan_backup"] .mwan4-conn-button')).toHaveText('9');
		await expect(page.locator('[data-rule="streaming"] .mwan4-conn-button')).toHaveText('3 / 41');
	});

	test('degrades to the previous UI against a backend without the connections method', async ({ page }) => {
		const errors = collectErrors(page);

		await renderOverview(page, { uci: uciWithRules(), connections: null });
		await page.evaluate(() => window.__mwan4Mock.runPoll());

		await expect(page.locator('[data-rule="streaming"]')).toBeVisible();
		await expect(page.locator('.mwan4-rule-head')).not.toContainText('Connections');
		await expect(page.locator('.mwan4-conn-button, .mwan4-conn-metric, .mwan4-strategy-connections button')).toHaveCount(0);
		await expect(page.locator('#mwan4-wan-workspace')).not.toContainText('Active connections');

		await page.getByRole('button', { name: 'Edit routing rule Streaming' }).click();
		await expect(page.locator('.modal [data-rule-connections]')).toBeEmpty();
		expect(errors).toEqual([]);
	});

	test('shows a Connections section on the diagnostics page and hides it without the method', async ({ page }) => {
		await renderDiagnostics(page);

		const section = page.locator('#mwan4-diag-connections');

		await expect(section.getByRole('heading', { name: 'Connections' })).toBeVisible();
		await expect(section.locator('.mwan4-conn-row')).toHaveCount(3);
		await section.locator('select[name="interface"]').selectOption('wan_backup');
		await expect(section.locator('.mwan4-conn-row')).toHaveCount(1);
		await expect(section.locator('select[name="interface"] option')).toContainText([ 'Any WAN', 'wan_backup', 'wan_primary' ]);

		await renderDiagnostics(page, { connections: null });
		await expect(page.locator('#mwan4-diag-connections')).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'MultiWAN 4 - Diagnostics' })).toBeVisible();

		await renderDiagnostics(page, { diagnosticsAccess: false });
		await expect(page.locator('#mwan4-diag-connections')).toHaveCount(0);
	});
});

const setUciOption = (page, section, option, value) => page.evaluate(([ sid, name, v ]) => {
	window.__mwan4Mock.getUci().mwan4.find(item => item['.name'] == sid)[name] = v;
}, [ section, option, value ]);
const uciSection = (page, name) => page.evaluate(sid => window.__mwan4Mock.getUci().mwan4.find(item => item['.name'] == sid), name);

async function applyPending(page) {
	await page.getByRole('button', { name: 'Preview changes' }).click();
	await page.getByRole('button', { name: 'Apply pending changes' }).click();
}

test.describe('mocked mwan4 unstable WAN handling', () => {
	const stable = () => ({ status: stableStatus(), history: defaultLinkHistory() });

	test('shows held and degraded chips with flap and availability columns', async ({ page }) => {
		await renderOverview(page, stable());

		const primary = page.locator('[data-interface="wan_primary"]');
		const backup = page.locator('[data-interface="wan_backup"]');

		await expect(page.locator('.mwan4-wan-table th')).toContainText([ 'State', 'Flaps', 'Availability', 'Score' ]);
		await expect(primary.locator('.mwan4-held-chip')).toContainText('held: flapping');
		await expect(primary.locator('.mwan4-held-chip')).toContainText(/1m \d+s/);
		await expect(primary.locator('.mwan4-state-chips .mwan4-pill')).toHaveCount(1);
		await expect(primary.locator('.mwan4-flaps-cell strong')).toHaveText('3');
		await expect(primary.locator('.mwan4-flaps-cell small')).toHaveText('last 5m, 9 total');
		await expect(primary.locator('.mwan4-availability-cell strong')).toHaveText('99.2%');
		await expect(primary.locator('.mwan4-availability-cell small')).toHaveText('last 4h 35m');
		await expect(primary.locator('.mwan4-availability-cell')).toHaveAttribute('title', '99.2% over the last 4h 35m, 91.3% over the last hour');
		await expect(backup.locator('.mwan4-held-chip')).toHaveCount(0);
		await expect(backup.locator('.mwan4-degraded-chip')).toHaveText('degraded (2)');
		await expect(backup.locator('.mwan4-degraded-chip')).toHaveAttribute('title', 'Skipped by: failover, streaming');
		await expect(backup.locator('.mwan4-availability-cell strong')).toHaveText('100%');
		await expect(backup.locator('.mwan4-availability-cell small')).toHaveText('last 24 hours');
	});

	test('counts the hold down live between polls', async ({ page }) => {
		await page.clock.install();
		await renderOverview(page, stable());

		const countdown = page.locator('[data-interface="wan_primary"] .mwan4-countdown');

		await expect(countdown).toHaveText('1m 30s');
		await page.clock.runFor(2100);
		await expect(countdown).toHaveText('1m 28s');
		await page.clock.runFor(100000);
		await expect(countdown).toHaveText('0s');
	});

	test('opens the link history with a 24 hour strip and refreshes while open', async ({ page }) => {
		await page.clock.install();
		await renderOverview(page, stable());
		await page.locator('[data-interface="wan_primary"]').getByRole('button', { name: 'Show link history of WAN link wan_primary' }).click();

		const modal = page.locator('.modal .mwan4-link-history');
		const rows = modal.locator('.mwan4-history-row');

		await expect(rows).toHaveCount(5);
		await expect(rows.first()).toContainText('held');
		await expect(rows.first()).toContainText('flapping');
		await expect(rows.last()).toContainText('start');
		await expect(modal.locator('.mwan4-history-summary')).toContainText('Flaps: 3 in the last 5m, 9 total');
		await expect(modal.locator('.mwan4-history-summary')).toContainText('Availability: 99.2% over the last 4h 35m, 91.3% over the last hour');
		await expect(modal.locator('.mwan4-strip-legend .mwan4-pill')).toHaveText([ 'Online', 'Held', 'Offline', 'No data' ]);
		await expect(modal.getByText(/Nothing was recorded before/)).toBeVisible();
		await expect(modal.locator('.mwan4-history-summary .mwan4-held-chip')).toContainText('held: flapping');
		await expect(modal.locator('svg.mwan4-strip')).toHaveAttribute('role', 'img');
		await expect(modal.locator('svg.mwan4-strip rect')).toHaveCount(6);
		await expect(modal.locator('svg.mwan4-strip rect.mwan4-offline')).toHaveCount(2);
		await expect(modal.locator('svg.mwan4-strip rect.mwan4-warning')).toHaveCount(1);
		await expect(page.locator('.modal details, .modal summary')).toHaveCount(0);

		await page.evaluate(() => {
			const next = JSON.parse(JSON.stringify(window.__mwan4Mock.getHistory()));

			next.interfaces.wan_primary.events.push({ time: Math.floor(Date.now() / 1000), state: 'online', reason: 'holddown' });
			window.__mwan4Mock.setHistory(next);
		});
		await page.clock.runFor(5100);
		await expect(rows).toHaveCount(6);
		await expect(rows.first()).toContainText('holddown');

		await page.getByRole('button', { name: 'Close' }).click();
		await page.clock.runFor(1000);

		const before = await rpcCount(page, 'link_history');

		await page.clock.runFor(20000);
		expect(await rpcCount(page, 'link_history')).toBe(before);
	});

	test('shows an empty history and keeps working when the history call fails', async ({ page }) => {
		await renderOverview(page, stable());
		await page.locator('[data-interface="wan_backup"]').getByRole('button', { name: 'Show link history of WAN link wan_backup' }).click();
		await expect(page.locator('.modal .mwan4-conn-empty')).toHaveText('No state transitions recorded yet.');
		await expect(page.locator('.modal svg.mwan4-strip rect')).toHaveCount(1);
		await page.evaluate(() => window.__mwan4Mock.setHistory(null));
		await page.getByRole('button', { name: 'Close' }).click();
		await page.locator('[data-interface="wan_backup"]').getByRole('button', { name: 'Show link history of WAN link wan_backup' }).click();
		await expect(page.locator('.modal .mwan4-conn-notice')).toContainText('Link history is unavailable');
	});

	test('edits the stability fields of a WAN link with the effective global default as placeholder', async ({ page }) => {
		await renderOverview(page, stable());
		await setUciOption(page, 'globals', 'flap_window', '600');
		await page.getByRole('button', { name: 'Edit WAN link wan_primary' }).click();

		const modal = page.locator('.modal');

		await expect(modal.locator('.mwan4-stability-fields')).toContainText('Flap damping');
		await expect(modal.locator('input[name="flap_threshold"]')).toHaveAttribute('placeholder', '3');
		await expect(modal.locator('input[name="flap_window"]')).toHaveAttribute('placeholder', '600');
		await expect(modal.locator('input[name="flap_holddown"]')).toHaveAttribute('placeholder', '120');
		await expect(modal.locator('input[name="recovery_hold"]')).toHaveAttribute('placeholder', '30');
		await expect(modal.locator('input[name="flush_grace"]')).toHaveAttribute('placeholder', '10');
		await expect(modal.locator('select[name="flap_damping"] option').first()).toHaveText('Use default (on)');
		await expect(modal.locator('input[name="flap_threshold"]')).toHaveAttribute('min', '2');

		await modal.locator('select[name="flap_damping"]').selectOption('0');
		await modal.locator('input[name="flap_threshold"]').fill('4');
		await modal.locator('input[name="flush_grace"]').fill('0');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(modal).toContainText('Flap threshold 4');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const section = await uciSection(page, 'wan_primary');

		expect(section).toMatchObject({ flap_damping: '0', flap_threshold: '4', flush_grace: '0' });
		expect(section.flap_window).toBeFalsy();
		expect(section.recovery_hold).toBeFalsy();
	});

	test('warns about a single health check target in the matrix and while editing', async ({ page }) => {
		await renderOverview(page, stable());
		await expect(page.locator('[data-interface="wan_backup"] .mwan4-single-target-warning')).toBeVisible();
		await expect(page.locator('[data-interface="wan_primary"] .mwan4-single-target-warning')).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit WAN link wan_backup' }).click();

		const warning = page.locator('.modal [data-mwan4-single-target]');

		await expect(warning).toBeVisible();
		await page.locator('.modal input[name="track_ip"]').fill('9.9.9.9 1.1.1.1');
		await expect(warning).toBeHidden();
		await page.locator('.modal input[name="track_ip"]').fill('9.9.9.9');
		await expect(warning).toBeVisible();
	});

	test('edits strategy quality limits and explains the check_quality requirement', async ({ page }) => {
		await renderOverview(page, stable());
		await page.getByRole('button', { name: 'Edit quality limits of strategy failover' }).click();

		const modal = page.locator('.modal');

		await expect(modal).toContainText('check_quality');
		await expect(modal).toContainText('No latency/loss data from: wan_backup');
		await modal.locator('input[name="max_latency"]').fill('150');
		await modal.locator('input[name="max_loss"]').fill('5');
		await applyPending(page);

		expect(await uciSection(page, 'failover')).toMatchObject({ max_latency: '150', max_loss: '5' });

		await expect(page.getByRole('button', { name: 'Edit quality limits of strategy failover' })).toHaveAttribute('title', 'latency 150 ms, loss 5%');
		await page.getByRole('button', { name: 'Edit quality limits of strategy failover' }).click();
		await page.locator('.modal input[name="max_latency"]').fill('');
		await applyPending(page);
		expect((await uciSection(page, 'failover')).max_latency).toBeFalsy();
	});

	test('edits the global stability defaults', async ({ page }) => {
		await renderOverview(page, stable());
		await page.getByRole('button', { name: 'Configure global MultiWAN settings' }).click();

		const modal = page.locator('.modal');

		await expect(modal.locator('input[name="flap_holddown"]')).toHaveAttribute('placeholder', '120');
		await expect(modal.locator('select[name="flap_damping"] option').first()).toHaveText('Use default (on)');
		await modal.locator('input[name="recovery_hold"]').fill('45');
		await applyPending(page);

		expect(await uciSection(page, 'globals')).toMatchObject({ recovery_hold: '45' });
	});

	test('hides every stability surface against a backend without the new methods and fields', async ({ page }) => {
		const errors = collectErrors(page);

		await renderOverview(page);
		await page.evaluate(() => window.__mwan4Mock.runPoll());

		const workspace = page.locator('#mwan4-wan-workspace');

		await expect(workspace.locator('[data-interface="wan_primary"]')).toBeVisible();
		await expect(workspace.locator('th')).not.toContainText([ 'Flaps' ]);
		await expect(workspace.getByRole('button', { name: /link history/ })).toHaveCount(0);
		await expect(page.locator('.mwan4-held-chip, .mwan4-degraded-chip, .mwan4-strategy-quality button')).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit WAN link wan_primary' }).click();
		await expect(page.locator('.modal .mwan4-stability-fields')).toHaveCount(0);
		await page.getByRole('button', { name: 'Cancel' }).click();
		await page.getByRole('button', { name: 'Configure global MultiWAN settings' }).click();
		await expect(page.locator('.modal .mwan4-stability-fields')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('shows the columns from status fields alone and offers no history without link_history', async ({ page }) => {
		await renderOverview(page, { status: stableStatus() });

		await expect(page.locator('.mwan4-wan-table th')).toContainText([ 'Flaps', 'Availability' ]);
		await expect(page.locator('[data-interface="wan_primary"] .mwan4-held-chip')).toBeVisible();
		await expect(page.getByRole('button', { name: /link history/ })).toHaveCount(0);
	});

	test('stability data follows the poll', async ({ page }) => {
		await renderOverview(page, stable());
		await page.evaluate(() => {
			const status = JSON.parse(JSON.stringify(window.__mwan4Mock.getStatus()));

			status.interfaces.wan_primary.held = { active: false };
			status.interfaces.wan_primary.health_state = 'online';
			status.interfaces.wan_primary.flaps = { count_window: 0, window: 300, total: 10 };
			window.__mwan4Mock.setStatus(status);

			return window.__mwan4Mock.runPoll();
		});

		const primary = page.locator('[data-interface="wan_primary"]');

		await expect(primary.locator('.mwan4-held-chip')).toHaveCount(0);
		await expect(primary.locator('.mwan4-state-chips .mwan4-pill')).toHaveText('online');
		await expect(primary.locator('.mwan4-flaps-cell strong')).toHaveText('0');
		await expect(primary.locator('.mwan4-flaps-cell small')).toHaveText('last 5m, 10 total');
	});
});
