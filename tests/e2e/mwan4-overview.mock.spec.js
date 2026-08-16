const { test, expect } = require('@playwright/test');
const { defaultCounters, defaultDiagnostics, defaultStatus, defaultUci, renderDiagnostics, renderOverview, renderStatus } = require('./helpers/luci-rpc-mock');

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
