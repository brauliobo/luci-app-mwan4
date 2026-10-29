const { test, expect } = require('@playwright/test');
const { defaultConnections, defaultCounters, defaultDiagnostics, defaultLinkHistory, defaultPbrPreview, defaultStatus, defaultUci, renderDiagnostics, renderOverview, renderStatus, stableStatus, withSiblingPair } = require('./helpers/luci-rpc-mock');

function uciWithRules() {
	const uci = defaultUci();
	const defaults = uci.mwan4.filter(function(section) { return /^default_rule_v[46]$/.test(section['.name']); });
	const rest = uci.mwan4.filter(function(section) { return defaults.indexOf(section) < 0; });

	uci.mwan4 = rest.concat([
		{ '.type': 'rule', '.name': 'streaming', label: 'Streaming', enabled: '1', domain: [ 'netflix.com', 'youtube.com' ], src_mac: [ 'aa:bb:cc:dd:ee:01' ], proto: 'tcp', dest_port: '443', use_strategy: 'failover', family: [ 'ipv4', 'ipv6' ] },
		{ '.type': 'rule', '.name': 'console', label: 'Gaming console', enabled: '0', src_ip: [ '192.168.1.50' ], dscp: '46', local: '1', use_strategy: 'default', family: [ 'ipv4' ] },
		{ '.type': 'rule', '.name': 'backups', enabled: '1', dest_ip: '198.51.100.7', use_strategy: 'unreachable', family: [ 'ipv4' ] }
	]).concat(defaults);
	uci.mwan4.forEach(function(section, index) { section['.index'] = index; });

	return uci;
}

async function openCustomRule(page) {
	await page.getByRole('button', { name: 'Add routing rule' }).first().click();
	await page.locator('.mwan4-template-choice[data-template="custom"]').click();
}

async function openTemplate(page, id) {
	await page.getByRole('button', { name: 'Add routing rule' }).first().click();
	await page.locator('.mwan4-template-choice[data-template="%s"]'.replace('%s', id)).click();
}

async function dragRuleOnto(page, source, target) {
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const targetRow = page.locator('[data-rule="%s"]'.replace('%s', target));
	const box = await targetRow.boundingBox();

	await page.locator('[data-rule="%s"]'.replace('%s', source)).dispatchEvent('dragstart', { dataTransfer });
	await targetRow.dispatchEvent('dragover', { dataTransfer, clientY: box.y + 2 });
	await targetRow.dispatchEvent('drop', { dataTransfer, clientY: box.y + 2 });
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
	test('puts the WAN links panel after the command center and the routing rules directly after it', async ({ page }) => {
		await renderOverview(page);

		const order = await page.evaluate(() => Array.from(document.querySelectorAll('.mwan4-app > *')).map(node => node.getAttribute('aria-labelledby')));

		expect(order).toEqual([ 'mwan4-command-title', 'mwan4-wan-workspace-title', 'mwan4-rules-title' ]);
		await expect(page.locator('.mwan4-app h3')).toHaveText([ 'WAN links', 'Routing rules' ]);
	});

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

		await expect(workspace.locator('h3')).toHaveText('WAN links');
		await expect(workspace).toContainText('Your internet connections and how they pass their health checks.');
		await expect(workspace).not.toContainText('WAN health matrix');
		await expect(row).toContainText('IPv4 online');
		await expect(row).toContainText('IPv6 degraded');
		await expect(row).toContainText('1 of 2 checks passing');
		await expect(row).toContainText('Limits: degraded above 1000 ms or 40% loss');
		await expect(row).toContainText('Interface up');
		await expect(row.locator('.mwan4-health-cell')).toHaveAttribute('title', /^Pings 1\.1\.1\.1 and 8\.8\.8\.8 every 10 s; marked down after 5 failed checks/);
		for (const jargon of [ 'netifd', 'unmeasured', 'Not measured', 'score', 'SLA', 'Probe', 'reliability' ])
			await expect(workspace).not.toContainText(jargon, { ignoreCase: true });
		await expect(missingTarget).toContainText('-');
		await expect(missingTarget).not.toContainText('0%');
		await expect(page.locator('body')).not.toContainText('[object Object]');
	});

	test('shows the IPv4 and IPv6 sections of one link as one row with one pill per family', async ({ page }) => {
		await renderOverview(page, withSiblingPair({ operatorAccess: true }));

		const rows = page.locator('#mwan4-wan-workspace .mwan4-wan-row');
		const pair = page.locator('[data-interface="wan_x"]');

		await expect(rows).toHaveCount(3);
		await expect(page.locator('[data-interface="wan_x6"]')).toHaveCount(0);
		await expect(pair).toHaveAttribute('data-members', 'wan_x wan_x6');
		await expect(pair.locator('.mwan4-wan-name strong')).toHaveText('X');
		await expect(pair.locator('.mwan4-wan-raw')).toHaveText('wan_x, wan_x6');
		await expect(pair.locator('.mwan4-state-chips .mwan4-pill')).toHaveText([ 'online' ]);
		await expect(pair.locator('.mwan4-family-pills .mwan4-pill')).toHaveText([ 'IPv4 online', 'IPv6 offline' ]);
		await expect(pair.locator('.mwan4-family-pills .mwan4-pill').nth(1)).toHaveClass(/mwan4-offline/);
		await expect(pair.locator('.mwan4-health-cell strong')).toHaveText('2 of 4 checks failing');
		await expect(pair.locator('.mwan4-target-group')).toHaveCount(2);
		await expect(pair.locator('.mwan4-target-family')).toHaveText([ 'IPv4', 'IPv6' ]);
		await expect(pair.locator('.mwan4-target-summary li')).toHaveCount(4);
		await expect(pair.locator('.cbi-button-edit')).toHaveText([ 'Edit IPv4', 'Edit IPv6' ]);
		await expect(pair.locator('.cbi-button-action')).toHaveText([ 'Up' ]);
		await expect(pair.locator('.mwan4-conn-family')).toHaveCount(2);
		await expect(page.locator('[data-interface="wan_primary"] .cbi-button-edit')).toHaveText([ 'Edit' ]);
		await expect(page.locator('[data-interface="wan_primary"] .mwan4-family-pills .mwan4-pill')).toHaveText([ 'IPv4 online', 'IPv6 online' ]);
		await expect(page.locator('[data-interface="wan_backup"] .mwan4-family-pills')).toHaveCount(0);
		await expect(page.locator('#mwan4-command-center')).toContainText('2/3 online');
	});

	test('edits, brings up and takes down every section of a link group', async ({ page }) => {
		await renderOverview(page, withSiblingPair({ operatorAccess: true }));

		const pair = page.locator('[data-interface="wan_x"]');
		const controls = () => page.evaluate(() => window.__mwan4Mock.rpcCalls.filter(call => call.object == 'mwan4' && call.method == 'control').map(call => call.params.join(':')));

		await pair.getByRole('button', { name: 'Edit WAN link wan_x6' }).click();
		await expect(page.locator('.modal h2')).toHaveText('WAN link: wan_x6');
		await page.getByRole('button', { name: 'Cancel' }).click();
		await pair.getByRole('button', { name: 'Take WAN link X down' }).click();
		await expect.poll(controls).toEqual([ 'ifdown:wan_x', 'ifdown:wan_x6' ]);
		await pair.getByRole('button', { name: 'Bring WAN link X up' }).click();
		await expect.poll(controls).toEqual([ 'ifdown:wan_x', 'ifdown:wan_x6', 'ifup:wan_x', 'ifup:wan_x6' ]);
	});

	test('shows one history modal per link with a panel for each section', async ({ page }) => {
		const history = defaultLinkHistory();

		history.interfaces.wan_x = { events: [ { time: Math.floor(Date.now() / 1000) - 60, state: 'online', reason: 'start' } ], flaps: { count_window: 0, window: 300, total: 0 } };
		history.interfaces.wan_x6 = { events: [ { time: Math.floor(Date.now() / 1000) - 60, state: 'offline', reason: 'tracker' } ], flaps: { count_window: 1, window: 300, total: 1 } };
		await renderOverview(page, withSiblingPair({ history: history }));
		await page.locator('[data-interface="wan_x"]').getByRole('button', { name: 'Show link history of WAN link X' }).click();

		await expect(page.locator('.modal h2')).toHaveText('Link history: X');
		await expect(page.locator('.modal .mwan4-link-history')).toHaveCount(2);
		await expect(page.locator('.modal .mwan4-history-heading')).toHaveText([ 'IPv4', 'IPv6' ]);
		await expect(page.locator('.modal .mwan4-link-history[data-interface="wan_x6"] .mwan4-history-row')).toContainText('offline');
	});

	test('lets long IPv6 check targets wrap inside their column without overlapping the neighbours', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await renderOverview(page, withSiblingPair());

		const boxes = await page.evaluate(() => {
			const rect = node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; };
			const cell = document.querySelector('[data-interface="wan_x"] .mwan4-targets-cell');
			const neighbour = cell.nextElementSibling;

			return {
				cell:      rect(cell),
				neighbour: rect(neighbour),
				inside:    Array.from(cell.querySelectorAll('li > span')).map(rect),
				overflow:  cell.scrollWidth > cell.clientWidth + 1
			};
		});

		expect(boxes.overflow).toBe(false);
		expect(boxes.cell.right).toBeLessThanOrEqual(boxes.neighbour.left + 1);
		for (const box of boxes.inside) {
			expect(box.left).toBeGreaterThanOrEqual(boxes.cell.left - 1);
			expect(box.right).toBeLessThanOrEqual(boxes.cell.right + 1);
		}
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

	test('keeps the command center to a status, one sentence, one action, three metrics and one footer', async ({ page }) => {
		await renderOverview(page, { operatorAccess: true });

		const workspace = page.locator('#mwan4-wan-workspace');
		const commandCenter = page.locator('#mwan4-command-center');

		await expect(workspace.locator('.mwan4-advanced-signals')).toHaveCount(0);
		await expect(workspace).not.toContainText('PBR');
		await expect(workspace).not.toContainText('MPTCP');
		await expect(workspace.getByRole('link')).toHaveCount(0);
		await expect(commandCenter.locator('h2')).toHaveText('MultiWAN 4');
		await expect(commandCenter.locator('.mwan4-pill').first()).toHaveText('Ready');
		await expect(commandCenter.locator('.mwan4-command-copy p')).toHaveText('Everything is working: all 2 WAN links are online.');
		await expect(commandCenter.locator('.mwan4-next-action button')).toHaveText('Add routing rule');
		await expect(commandCenter.locator('.mwan4-command-metric')).toHaveCount(3);
		await expect(commandCenter.locator('.mwan4-command-metric span')).toHaveText([ 'WAN links', 'Active rules', 'Active connections' ]);
		await expect(commandCenter).not.toContainText('modes');
		await expect(commandCenter).not.toContainText('Routing');
		await expect(commandCenter.getByRole('link', { name: 'Diagnostics', exact: true })).toHaveAttribute('href', /admin\/network\/mwan4\/diagnostics/);
		await expect(commandCenter.getByRole('link', { name: /Open (Advanced|Diagnostics)/ })).toHaveCount(0);
		await expect(commandCenter.locator('.mwan4-command-footer .mwan4-actions button')).toHaveText([ 'Test traffic', 'Global settings', 'Refresh' ]);
		await expect(commandCenter.locator('.mwan4-service-controls button')).toHaveText([ 'Start', 'Restart', 'Stop' ]);

		for (const name of [ 'Start', 'Restart', 'Stop' ])
			await expect(commandCenter.locator('.mwan4-service-controls button', { hasText: new RegExp('^%s$'.replace('%s', name)) })).toHaveAttribute('title', /\w+ \w+ \w+ \w+/);
	});

	test('counts active and disabled rules in the command center', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		const metric = page.locator('#mwan4-command-center .mwan4-command-metric').nth(1);

		await expect(metric).toContainText('Active rules');
		await expect(metric.locator('strong')).toHaveText('2');
		await expect(metric.locator('small')).toHaveText('1 disabled');
	});

	test('asks before stopping mwan4 and stops only after the confirmation', async ({ page }) => {
		await renderOverview(page, { operatorAccess: true });

		const controls = () => page.evaluate(() => window.__mwan4Mock.rpcCalls.filter(call => call.object == 'mwan4' && call.method == 'control').map(call => call.params[0]));

		await page.getByRole('button', { name: 'Stop MultiWAN 4 service' }).click();
		await expect(page.locator('.modal h2')).toHaveText('Stop mwan4?');
		await expect(page.locator('.modal')).toContainText('Stopping mwan4 removes all routing rules and failover until it is started again.');
		expect(await controls()).toEqual([]);

		await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.locator('.modal')).toHaveCount(0);
		expect(await controls()).toEqual([]);

		await page.getByRole('button', { name: 'Stop MultiWAN 4 service' }).click();
		await page.locator('.modal').getByRole('button', { name: 'Stop', exact: true }).click();
		await expect.poll(controls).toEqual([ 'stop' ]);
		await expect(page.locator('.modal')).toHaveCount(0);

		await page.getByRole('button', { name: 'Start MultiWAN 4 service', exact: true }).click();
		await expect.poll(controls).toEqual([ 'stop', 'start' ]);
	});

	test('tests traffic and opens global settings from the command center', async ({ page }) => {
		await renderOverview(page);
		await page.locator('#mwan4-command-center').getByRole('button', { name: 'Test traffic' }).click();
		await expect(page.locator('.modal h2')).toHaveText('Test traffic');
		await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
		await page.locator('#mwan4-command-center').getByRole('button', { name: 'Configure global MultiWAN settings' }).click();
		await expect(page.locator('.modal h2')).toHaveText('Global settings');
	});

	test('counts a link as online only when all its enabled IPv4 and IPv6 sections are health-online', async ({ page }) => {
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
		await expect(commandCenter).toContainText('1/3 online');
		await expect(commandCenter).toContainText('Degraded');
	});

	test('shows the Diagnostics link only with the diagnostics ACL and never an Advanced link', async ({ page }) => {
		await renderOverview(page, { advancedAccess: true });
		await expect(page.locator('#mwan4-command-center').getByRole('link', { name: 'Diagnostics' })).toBeVisible();
		await expect(page.getByRole('link', { name: /Advanced/ })).toHaveCount(0);

		await renderOverview(page, { diagnosticsAccess: false });
		await expect(page.locator('#mwan4-command-center').getByRole('link', { name: 'Diagnostics' })).toHaveCount(0);
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
		await expect(page.getByRole('link', { name: /Advanced/ })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Diagnostics' })).toHaveCount(0);

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

		await expect(page.locator('#mwan4-command-center')).toContainText('No WAN links are set up yet');
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
		await page.getByRole('button', { name: 'Change default routing' }).click();
		await page.getByLabel('Share load across all healthy links').check();
		await page.getByRole('button', { name: 'Preview changes' }).click();

		await expect(page.locator('.modal')).toContainText('Share load across all healthy links');
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
		await expect(page.locator('#mwan4-diag-output')).toContainText('Matched rule');
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
		await page.getByRole('button', { name: 'Run Routing rules diagnostics', exact: true }).click();
		await expect(page.locator('#mwan4-diag-output')).toContainText('Routing rule lookups');
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

		await expect(page.locator('.mwan4-rule-head [role="columnheader"]')).toHaveText([ 'Order', 'On', 'Rule', 'Goes through', 'Activity', 'Actions' ]);
		await expect(streaming).toContainText('Streaming');
		await expect(streaming.locator('.mwan4-rule-sentence')).toHaveText(
			'Sends netflix.com and youtube.com from living-room-tv (aa:bb:cc:dd:ee:01) on TCP port 443 through Primary first, then Backup; stops if none is available');
		await expect(streaming.locator('.mwan4-chip-domain, .mwan4-chip-ip')).toHaveCount(0);
		await expect(streaming.locator('.mwan4-via [data-wan]')).toHaveCount(2);
		await expect(streaming.locator('.mwan4-via [data-wan="wan_primary"]')).toHaveClass(/mwan4-online/);
		await expect(streaming.locator('.mwan4-via [data-wan="wan_backup"]')).toHaveClass(/mwan4-offline/);
		await expect(streaming.locator('.mwan4-via')).toContainText('\u2192');
		await expect(streaming.locator('.mwan4-now-via')).toHaveText('Now: Primary');
		await expect(streaming.locator('.mwan4-stops-note')).toHaveCount(0);
		await expect(streaming).not.toContainText('ordered failover');
		await expect(streaming.locator('[data-activity="hits"]')).toContainText('50');
		await expect(streaming.locator('.mwan4-rule-warning')).toContainText('dnsmasq-full with nftset support is missing');
		await expect(streaming.getByRole('button', { name: 'Duplicate routing rule Streaming' })).toBeVisible();
		await expect(page.locator('[data-rule="console"] .mwan4-rule-sentence')).toContainText('Disabled: Sends everything from 192.168.1.50, including traffic from this router');
		await expect(page.locator('[data-rule="console"] .mwan4-rule-sentence')).toContainText('DSCP 46');
		await expect(page.locator('[data-rule="console"] .mwan4-via')).toHaveCount(0);
		await expect(page.locator('[data-rule="console"] .mwan4-stops-note')).toHaveCount(0);
		await expect(page.locator('[data-rule="console"] .mwan4-rule-toggle')).not.toBeChecked();
		await expect(page.locator('[data-rule="backups"]')).toContainText('198.51.100.7');
		await expect(page.locator('[data-rule="backups"] .mwan4-stops-note')).toHaveCount(0);
		await expect(page.locator('[data-rule="backups"] [data-label="Goes through"]')).toContainText('Blocked (rejected)');
		await expect(page.locator('[data-rule="default_rule_v4"]')).toContainText('Everything else');
		await expect(page.locator('[data-rule="default_rule_v4"] [data-activity="hits"]')).toContainText('9');
		await expect(page.locator('[data-rule="default_rule_v4"] .mwan4-via [data-wan="wan_primary"]')).toHaveCount(1);
		await expect(page.locator('.mwan4-rule-badge')).toHaveCount(0);
		await expect(page.locator('#mwan4-rules-count')).toHaveText('3 of 3 rules');
		await expect(page.locator('details')).toHaveCount(0);
	});

	test('notes "Stops if unavailable" only on a path of a single link', async ({ page }) => {
		const uci = uciWithRules();

		uci.mwan4.push({ '.type': 'strategy', '.name': 'wan_primary_only', use_route: [ 'route_wan_primary' ], last_resort: 'unreachable' });
		uci.mwan4.push({ '.type': 'rule', '.name': 'locked', label: 'Locked', enabled: '1', domain: [ 'bank.example' ], use_strategy: 'wan_primary_only', family: [ 'ipv4' ] });
		await renderOverview(page, { uci });

		await expect(page.locator('[data-rule="locked"] .mwan4-stops-note')).toHaveText('Stops if unavailable');
		await expect(page.locator('[data-rule="streaming"] .mwan4-stops-note')).toHaveCount(0);
	});

	test('keeps the hit counters of the rules table fresh on poll', async ({ page }) => {
		const counters = defaultCounters();

		await renderOverview(page, { uci: uciWithRules(), counters });
		await expect(page.locator('[data-rule="streaming"] [data-activity="hits"]')).toContainText('-');

		counters.counters.mwan4_counter_rule_streaming_ipv4 = { packets: 7, bytes: 700 };
		await page.evaluate(function(next) {
			window.__mwan4Mock.setCounters(next);
			return window.__mwan4Mock.runPoll();
		}, counters);

		await expect(page.locator('[data-rule="streaming"] [data-activity="hits"]')).toContainText('7');
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

		await expect(page.locator('.mwan4-rules .mwan4-rule-row').nth(2)).toHaveAttribute('data-rule', 'streaming');
		await dragRuleOnto(page, 'streaming', 'console');
		await expect.poll(() => ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'default_rule_v4', 'default_rule_v6' ]);

		await expect(page.locator('.mwan4-rules .mwan4-rule-row').nth(3)).toHaveAttribute('data-rule', 'default_rule_v4');
		await expect(page.locator('.mwan4-rules .mwan4-rule-row').nth(4)).toHaveAttribute('data-rule', 'default_rule_v6');
	});

	test('classifies mixed domain and IP input in the What box and saves one rule per kind', async ({ page }) => {
		await renderOverview(page);
		await openCustomRule(page);

		await page.locator('.modal input[name="label"]').fill('Video sites');
		await page.locator('.modal textarea[name="what"]').fill('https://www.YouTube.com/watch?v=1\n203.0.113.0/24, youtu.be\n2001:db8::/32\nyoutu.be');

		const classified = page.locator('#mwan4-rule-classified');
		await expect(classified.locator('.mwan4-chip-domain')).toHaveText([ 'www.youtube.com', 'youtu.be' ]);
		await expect(classified.locator('.mwan4-chip-ip')).toHaveText([ '203.0.113.0/24', '2001:db8::/32' ]);

		const summary = page.locator('.modal .mwan4-rule-summary');
		await expect(summary).toContainText('This creates 2 rules: one for names, one for addresses');
		await expect(summary.locator('.mwan4-summary-sentence')).toContainText('Sends www.youtube.com and youtu.be');
		await expect(summary.locator('.mwan4-summary-sentence')).toContainText('Sends 203.0.113.0/24 and 2001:db8::/32');
		await expect(summary.locator('.mwan4-summary-sentence')).not.toContainText('youtu.be and 203.0.113.0/24');

		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('This creates 2 rules: one for names, one for addresses');
		await expect(page.locator('.modal')).toContainText('Video sites (addresses)');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const names = await ruleSection(page, 'video_sites');
		const addresses = await ruleSection(page, 'video_sites_ip');
		expect(names.label).toBe('Video sites');
		expect(names.domain).toEqual([ 'www.youtube.com', 'youtu.be' ]);
		expect(names.dest_ip).toBeNull();
		expect(names.family).toEqual([ 'ipv4', 'ipv6' ]);
		expect(names.enabled).toBe('1');
		expect(names.use_strategy).toBe('failover');
		expect(addresses.label).toBe('Video sites (addresses)');
		expect(addresses.domain).toBeNull();
		expect(addresses.dest_ip).toEqual([ '203.0.113.0/24', '2001:db8::/32' ]);
		expect(addresses.use_strategy).toBe('failover');
		expect(addresses.enabled).toBe('1');
		expect(await ruleOrder(page)).toEqual([ 'video_sites', 'video_sites_ip', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('splitting a saved rule that lists names and addresses keeps its place and flags it in the list', async ({ page }) => {
		const uci = uciWithRules();

		uci.mwan4.find(section => section['.name'] == 'streaming').dest_ip = [ '203.0.113.0/24' ];
		await renderOverview(page, { uci });

		const row = page.locator('[data-rule="streaming"]');
		await expect(row.locator('.mwan4-rule-badge')).toContainText('Needs attention');
		await expect(row.locator('.mwan4-rule-badge')).toHaveAttribute('title', /never matches/);
		await expect(row.locator('.mwan4-rule-sentence')).toContainText('Never matches');

		await row.getByRole('button', { name: 'Edit routing rule Streaming' }).click();
		await expect(page.locator('.modal .mwan4-summary-split')).toContainText('This creates 2 rules');
		await expect(page.locator('.modal .mwan4-summary-issues')).not.toContainText('never matches');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const order = await ruleOrder(page);
		expect(order.slice(0, 4)).toEqual([ 'streaming', 'streaming_ip', 'console', 'backups' ]);
		expect((await ruleSection(page, 'streaming')).domain).toEqual([ 'netflix.com', 'youtube.com' ]);
		expect((await ruleSection(page, 'streaming')).dest_ip).toBeNull();
		expect((await ruleSection(page, 'streaming_ip')).dest_ip).toEqual([ '203.0.113.0/24' ]);
		expect((await ruleSection(page, 'streaming_ip')).proto).toBe('tcp');
		expect((await ruleSection(page, 'streaming_ip')).src_mac).toEqual([ 'aa:bb:cc:dd:ee:01' ]);
		await expect(page.locator('[data-rule="streaming"] .mwan4-rule-badge')).toHaveCount(0);
	});

	test('answers what, who, and via with a Prefer preset that creates the strategy', async ({ page }) => {
		const uci = uciWithRules();

		await renderOverview(page, { uci });
		await openCustomRule(page);

		await expect(page.locator('.modal')).toContainText('1. What traffic?');
		await expect(page.locator('.modal')).toContainText('2. Who?');
		await expect(page.locator('.modal')).toContainText('3. Which WAN links?');
		await expect(page.locator('.modal details')).toHaveCount(0);
		await expect(page.locator('.modal')).toContainText('Advanced options');
		await expect(page.locator('.modal')).toContainText('Extra matching');
		await expect(page.locator('.modal')).toContainText('Behaviour');
		await expect(page.locator('.modal')).not.toContainText('Extra match and logging');
		await expect(page.locator('.modal > :first-child input[name="enabled"]')).toBeChecked();
		await expect(page.locator('.modal .mwan4-option-group').nth(0).locator('input[name="dscp"], input[name="src_port"], input[name="ipset"]')).toHaveCount(3);
		await expect(page.locator('.modal .mwan4-option-group').nth(1).locator('input[name="local"], input[name="sticky"], input[name="timeout"], input[name="logging"]')).toHaveCount(4);

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
		await expect(via.locator('optgroup').nth(0)).toHaveAttribute('label', 'Existing paths');
		await expect(via.locator('option[value="prefer:wan_backup"]')).toHaveText('Backup first, then Primary; stops if none is available');
		await expect(via.locator('option[value="failover"]')).not.toContainText('failover');
		await via.selectOption('prefer:wan_backup');
		await expect(page.locator('[data-via-live]')).toHaveText('Backup first, then Primary; stops if none is available. Now: Backup');
		await page.locator('.modal input[name="dscp"]').fill('46');
		await page.locator('.modal input[name="local"]').check();

		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('Backup first, then Primary; stops if none is available');
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
			await openTemplate(page, 'site-only');
			await page.locator('.modal input[name="label"]').fill(label);
			await page.locator('.modal input[name="what"]').fill('example.org');
			await page.locator('.modal select[name="link"]').selectOption('wan_primary');
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

		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('netflix.com\nyoutube.com');
		await expect(page.locator('.modal select[name="who_mode"]')).toHaveValue('devices');
		await expect(page.locator('.modal textarea[name="who"]')).toHaveValue('aa:bb:cc:dd:ee:01');

		await page.locator('.modal select[name="who_mode"]').selectOption('iface');
		await page.locator('.modal select[name="src_iface"]').selectOption('wan_backup');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('Network wan_backup');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'streaming');
		expect(rule.src_iface).toBe('wan_backup');
		expect(rule.src_mac).toBeNull();
		expect(rule.src_ip).toBeNull();
		expect(await ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('validates every field inline, focuses the first invalid one on save, and no longer demands a name', async ({ page }) => {
		await renderOverview(page);
		await openCustomRule(page);

		const error = name => page.locator('#mwan4-error-' + name);
		const modal = page.locator('.modal');

		await expect(modal.locator('[data-error-for]:not([hidden])')).toHaveCount(0);
		await expect(modal.locator('input[name="label"]')).toHaveAttribute('placeholder', 'Named automatically');
		await page.locator('.modal textarea[name="what"]').fill('example.com');
		await expect(modal.locator('[data-error-for]:not([hidden])')).toHaveCount(0);
		await expect(modal.locator('input[name="label"]')).toHaveAttribute('placeholder', 'example.com via failover');

		await page.locator('.modal textarea[name="what"]').fill('example.com\nnot a domain!\n999.1.1.1\n10.0.0.0/33');
		await expect(error('what')).toHaveText('Not a domain name or IP address: not, a, domain!, 999.1.1.1, 10.0.0.0/33');
		await expect(page.locator('.modal textarea[name="what"]')).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('.modal textarea[name="what"]')).toHaveAttribute('aria-describedby', /mwan4-error-what/);
		await expect(page.locator('#mwan4-rule-classified .mwan4-offline')).toHaveCount(5);

		await page.locator('.modal textarea[name="what"]').fill('aa:bb:cc:dd:ee:01');
		await expect(error('what')).toContainText('MAC addresses belong in Who');

		await page.locator('.modal textarea[name="what"]').fill('example.com');
		await expect(error('what')).toBeHidden();
		await page.locator('.modal input[name="dest_port"]').fill('443');
		await expect(error('proto')).toHaveText('Choose TCP or UDP before adding source or destination ports.');
		await page.locator('.modal select[name="proto"]').selectOption('udp');
		await expect(error('proto')).toBeHidden();
		await page.locator('.modal input[name="dest_port"]').fill('70000');
		await expect(error('dest_port')).toContainText('Use ports from 1-65535');
		await page.locator('.modal input[name="src_port"]').fill('x');
		await expect(error('src_port')).toContainText('Use source ports from 1-65535');
		await page.locator('.modal input[name="src_port"]').fill('');

		await page.locator('.modal input[name="dest_port"]').fill('');
		await page.locator('.modal input[name="dscp"]').fill('64');
		await expect(error('dscp')).toHaveText('Use a DSCP value from 1 to 63.');
		await page.locator('.modal input[name="dscp"]').fill('');
		await page.locator('.modal input[name="ipset"]').fill('bad name');
		await expect(error('ipset')).toContainText('Use a simple nft set name');
		await page.locator('.modal input[name="ipset"]').fill('');
		await page.locator('.modal input[name="sticky"]').check();
		await page.locator('.modal input[name="timeout"]').fill('0');
		await expect(error('timeout')).toHaveText('Use a positive number of seconds.');
		await page.locator('.modal input[name="timeout"]').fill('600');
		await page.locator('.modal input[name="sticky"]').uncheck();

		await page.locator('.modal select[name="who_mode"]').selectOption('devices');
		await expect(error('who')).toBeHidden();
		await page.locator('.modal textarea[name="who"]').fill('laptop.lan');
		await expect(error('who')).toContainText('Devices must be IP addresses, CIDR ranges, or MAC addresses: laptop.lan');
		await page.locator('.modal textarea[name="who"]').fill('AA-BB-CC-DD-EE-09');
		await expect(error('who')).toBeHidden();

		await page.locator('.modal select[name="who_mode"]').selectOption('all');
		await page.locator('.modal textarea[name="what"]').fill('');
		await page.locator('.modal select[name="proto"]').selectOption('all');
		await expect(error('what')).toContainText('Add at least one thing to match');

		await page.locator('.modal textarea[name="what"]').fill('198.51.100.0/24');
		await page.locator('.modal select[name="proto"]').selectOption('icmpv6');
		await expect(error('proto')).toContainText('do not share an IP family');

		await page.locator('.modal input[name="dscp"]').fill('99');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(modal.locator('[data-mwan4-preview]')).toBeHidden();
		await expect(page.locator('.modal select[name="proto"]')).toBeFocused();
		await expect(page.getByRole('button', { name: 'Apply pending changes' })).toHaveCount(0);

		await page.locator('.modal select[name="proto"]').selectOption('all');
		await page.locator('.modal input[name="dscp"]').fill('');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await page.getByRole('button', { name: 'Apply pending changes' }).click();
		expect((await ruleSection(page, '198_51_100_0_24')).family).toEqual([ 'ipv4' ]);
	});

	test('shows required fields late and fills an empty name with the suggestion on save', async ({ page }) => {
		await renderOverview(page);
		await openTemplate(page, 'site-link');

		const name = page.locator('.modal input[name="label"]');

		await expect(page.locator('#mwan4-error-what')).toBeHidden();
		await expect(page.locator('[data-summary="sentence"]')).toHaveText('Fill in the fields below to see what this rule does.');
		await page.locator('.modal input[name="what"]').fill('hbo.com');
		await page.locator('.modal input[name="what"]').fill('');
		await expect(page.locator('#mwan4-error-what')).toHaveText('Enter a site or address, for example youtube.com.');
		await page.locator('.modal input[name="what"]').fill('hbo.com');
		await expect(name).toHaveValue('');
		await expect(name).toHaveAttribute('placeholder', 'hbo.com via Primary');
		await expect(page.locator('[data-summary="sentence"]')).toHaveText('Sends hbo.com from all devices through Primary first, then Backup; stops if none is available');

		await page.getByRole('button', { name: 'Preview changes' }).click();
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'hbo_com_via_pri');

		expect(rule.label).toBe('hbo.com via Primary');
		expect(rule.use_strategy).toBe('wan_primary_first');
	});

	test('removes a rule from the editor after a preview', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Edit routing rule Gaming console' }).click();
		await page.getByRole('button', { name: 'Remove' }).click();
		await expect(page.locator('.modal')).toContainText('This will remove the routing rule');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		expect(await ruleOrder(page)).toEqual([ 'streaming', 'backups', 'default_rule_v4', 'default_rule_v6' ]);
	});

	test('searches and filters the rules, keeps the view across polls, and disables reordering while filtered', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		const rows = page.locator('.mwan4-rules .mwan4-rule-row');
		const search = page.getByRole('searchbox', { name: 'Search routing rules' });
		const filter = page.getByLabel('Show');

		await expect(page.locator('#mwan4-rules-count')).toHaveText('3 of 3 rules');
		await expect(page.locator('[data-rule="streaming"]')).toHaveAttribute('draggable', 'true');

		await search.fill('living-room');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0)).toHaveAttribute('data-rule', 'streaming');
		await expect(page.locator('#mwan4-rules-count')).toHaveText('1 of 3 rules');
		await expect(page.locator('[data-rule="streaming"]')).not.toHaveAttribute('draggable', 'true');
		await expect(page.locator('[data-rule="streaming"] .mwan4-drag-handle')).toHaveAttribute('title', 'Clear the search and filter to reorder rules');
		await expect(page.getByRole('button', { name: 'Move routing rule Streaming down' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Move routing rule Streaming down' })).toHaveAttribute('title', 'Clear the search and filter to reorder rules');

		await page.evaluate(() => window.__mwan4Mock.runPoll());
		await expect(search).toHaveValue('living-room');
		await expect(rows).toHaveCount(3);

		await search.fill('198.51');
		await expect(rows.nth(0)).toHaveAttribute('data-rule', 'backups');
		await search.fill('youtube tcp');
		await expect(rows.nth(0)).toHaveAttribute('data-rule', 'streaming');
		await search.fill('');
		await filter.selectOption('disabled');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0)).toHaveAttribute('data-rule', 'console');
		await filter.selectOption('active');
		await expect(rows.nth(0)).toHaveAttribute('data-rule', 'streaming');
		await expect(rows.nth(1)).toHaveAttribute('data-rule', 'backups');
		await expect(page.locator('#mwan4-rules-count')).toHaveText('2 of 3 rules');

		await search.fill('nothing like this');
		await expect(page.locator('.mwan4-rules')).toContainText('No routing rule matches.');
		await page.getByRole('button', { name: 'Clear search and filter' }).click();
		await expect(search).toHaveValue('');
		await expect(filter).toHaveValue('all');
		await expect(page.locator('#mwan4-rules-count')).toHaveText('3 of 3 rules');
		await expect(page.locator('[data-rule="streaming"]')).toHaveAttribute('draggable', 'true');
	});

	test('marks rules that cannot work with a badge and filters them as needing attention', async ({ page }) => {
		const status = defaultStatus();

		status.interfaces.wan_primary.health_state = 'offline';
		status.interfaces.wan_backup.health_state = 'offline';
		await renderOverview(page, { uci: uciWithRules(), status });

		const badge = page.locator('[data-rule="streaming"] .mwan4-rule-badge');

		await expect(page.locator('.mwan4-rule-badge')).toHaveCount(1);
		await expect(badge).toHaveText('Needs attention');
		await expect(badge).toHaveAttribute('title', /unavailable right now, so this rule stops/);
		await expect(badge).toHaveAttribute('aria-label', /^Needs attention: .*unavailable/);
		await expect(page.locator('[data-rule="streaming"] .mwan4-now-via')).toHaveText('Now: no link available — traffic stops');

		await page.getByLabel('Show').selectOption('attention');
		await expect(page.locator('.mwan4-rules .mwan4-rule-row')).toHaveCount(3);
		await expect(page.locator('#mwan4-rules-count')).toHaveText('1 of 3 rules');

		await badge.click();
		await expect(page.locator('.modal [data-summary="issues"] li.is-warning')).toContainText('unavailable right now');
	});

	test('duplicates a rule into a new, prefilled rule', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Duplicate routing rule Streaming' }).click();

		await expect(page.locator('.modal h2')).toContainText('Add routing rule');
		await expect(page.locator('.modal input[name="label"]')).toHaveValue('Copy of Streaming');
		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('netflix.com\nyoutube.com');
		await expect(page.locator('.modal [data-rule-connections]')).toHaveCount(0);

		await page.getByRole('button', { name: 'Preview changes' }).click();
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const copy = await ruleSection(page, 'copy_of_streami');

		expect(copy.label).toBe('Copy of Streaming');
		expect(copy.domain).toEqual([ 'netflix.com', 'youtube.com' ]);
		expect(copy.use_strategy).toBe('failover');
		expect(await ruleOrder(page)).toEqual([ 'streaming', 'console', 'backups', 'copy_of_streami', 'default_rule_v4', 'default_rule_v6' ]);
		expect((await ruleSection(page, 'streaming')).label).toBe('Streaming');
	});

	test('chooses a template, keeps typed values when switching to all options, and offers templates only for new rules', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Add routing rule' }).first().click();

		const choices = page.locator('.mwan4-template-choice');

		await expect(choices).toHaveCount(7);
		await expect(choices.first()).toContainText('Send a site through one link');
		await expect(choices.first()).toContainText('switches to another one only if it is unavailable');
		await expect(choices.last()).toContainText('Custom rule');
		await expect(page.locator('.modal')).not.toContainText('Strategy');

		await page.locator('.mwan4-template-choice[data-template="site-only"]').click();

		const editor = page.locator('.mwan4-rule-editor');
		const link = page.locator('.modal select[name="link"]');

		await expect(editor).toHaveAttribute('data-mode', 'simple');
		await expect(page.locator('.modal input[name="what"]')).toBeFocused();
		await expect(link.locator('option')).toHaveText([ 'Primary (online)', 'Backup (online)' ]);
		await expect(page.locator('.modal textarea, .modal input[name="dscp"], .modal select[name="proto"]')).toHaveCount(0);
		await expect(page.locator('.modal')).not.toContainText('Advanced options');
		await expect(page.getByRole('button', { name: 'Use a template' })).toHaveCount(0);

		await page.locator('.modal input[name="what"]').fill('bank.example.com');
		await link.selectOption('wan_backup');
		await page.locator('.modal input[name="label"]').fill('Bank');
		await expect(page.locator('[data-summary="sentence"]')).toHaveText('Sends bank.example.com from all devices through only Backup; stops if Backup is unavailable');

		await page.getByRole('button', { name: 'Show all options' }).click();
		await expect(editor).toHaveAttribute('data-mode', 'full');
		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('bank.example.com');
		await expect(page.locator('.modal select[name="use_strategy"]')).toHaveValue('only:wan_backup');
		await expect(page.locator('.modal input[name="label"]')).toHaveValue('Bank');
		await expect(page.getByRole('button', { name: 'Show all options' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Use a template' })).toBeVisible();

		await page.getByRole('button', { name: 'Use a template' }).click();
		await expect(page.locator('.mwan4-template-choice')).toHaveCount(7);
		await page.locator('.mwan4-template-choice[data-template="custom"]').click();
		await expect(editor).toHaveAttribute('data-mode', 'full');
		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('');
		await expect(page.locator('[data-summary="sentence"]')).toHaveText('Fill in the fields below to see what this rule does.');
	});

	test('opens a template-shaped rule in simple mode and a hand-made one in full mode', async ({ page }) => {
		const uci = uciWithRules();

		uci.mwan4.push(
			{ '.type': 'route', '.name': 'hbo_r1', interface: 'wan_backup', metric: '1' },
			{ '.type': 'route', '.name': 'hbo_r2', interface: 'wan_primary', metric: '2' },
			{ '.type': 'strategy', '.name': 'wan_backup_first', use_route: [ 'hbo_r1', 'hbo_r2' ], last_resort: 'unreachable' },
			{ '.type': 'rule', '.name': 'hbo', label: 'HBO', enabled: '1', domain: [ 'hbo.com' ], use_strategy: 'wan_backup_first', family: [ 'ipv4', 'ipv6' ] }
		);

		await renderOverview(page, { uci });
		await page.getByRole('button', { name: 'Edit routing rule HBO' }).click();

		await expect(page.locator('.mwan4-rule-editor')).toHaveAttribute('data-mode', 'simple');
		await expect(page.locator('.modal input[name="what"]')).toHaveValue('hbo.com');
		await expect(page.locator('.modal select[name="link"]')).toHaveValue('wan_backup');
		await expect(page.locator('.modal input[name="label"]')).toHaveValue('HBO');
		await expect(page.locator('[data-summary="sentence"]')).toHaveText('Sends hbo.com from all devices through Backup first, then Primary; stops if none is available');
		await expect(page.locator('.modal > h2 input[name="enabled"]')).toBeChecked();

		await page.locator('.modal select[name="link"]').selectOption('wan_primary');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('Primary first, then Backup');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();
		expect((await ruleSection(page, 'hbo')).use_strategy).toBe('wan_primary_first');
		expect((await ruleSection(page, 'hbo')).domain).toEqual([ 'hbo.com' ]);

		await page.getByRole('button', { name: 'Edit routing rule Streaming' }).click();
		await expect(page.locator('.mwan4-rule-editor')).toHaveAttribute('data-mode', 'full');
		await expect(page.getByRole('button', { name: 'Use a template' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Show all options' })).toHaveCount(0);
	});

	test('shows the rule check messages in the live summary and blocks saving on errors', async ({ page }) => {
		const uci = uciWithRules();

		uci.mwan4.push(
			{ '.type': 'strategy', '.name': 'empty_path', use_route: [], last_resort: 'unreachable' },
			{ '.type': 'rule', '.name': 'yt', '.index': 0, label: 'YouTube', enabled: '1', domain: [ 'youtube.com' ], use_strategy: 'failover', family: [ 'ipv4', 'ipv6' ] }
		);
		await renderOverview(page, { uci });
		await openCustomRule(page);

		const issues = page.locator('[data-summary="issues"]');

		await page.locator('.modal textarea[name="what"]').fill('www.youtube.com');
		await expect(issues.locator('li.is-warning')).toContainText('The rule "YouTube" above already matches');
		await expect(issues.locator('li.is-warning .mwan4-issue-kind')).toHaveText('Warning');
		await expect(page.locator('.modal select[name="use_strategy"]')).toHaveValue('failover');
		await expect(page.locator('[data-summary="now"]')).toHaveText('Now: Primary');

		await page.locator('.modal select[name="use_strategy"]').selectOption('empty_path');
		await expect(issues.locator('li.is-error')).toContainText('no enabled WAN links');
		await expect(page.locator('.modal select[name="use_strategy"]')).toHaveAttribute('aria-invalid', 'true');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal select[name="use_strategy"]')).toBeFocused();
		await expect(page.getByRole('button', { name: 'Apply pending changes' })).toHaveCount(0);

		await page.locator('.modal select[name="use_strategy"]').selectOption('only:wan_backup');
		await expect(issues.locator('li.is-error')).toHaveCount(0);
		await expect(issues.locator('li.is-info')).toContainText('Traffic stops while Backup is unavailable');
	});

	test('answers where traffic goes, with the deciding rule and the rules checked in order', async ({ page }) => {
		const uci = uciWithRules();

		uci.mwan4.push({ '.type': 'rule', '.name': 'tv', '.index': -1, label: 'TV', enabled: '1', domain: [ 'video.example.com' ], src_mac: [ 'aa:bb:cc:dd:ee:01' ],
			proto: 'tcp', dest_port: '443', use_strategy: 'failover', family: [ 'ipv4', 'ipv6' ] });
		await renderOverview(page, { uci });
		await page.getByRole('button', { name: 'Test traffic' }).click();

		const result = page.locator('#mwan4-test-result');
		const steps = result.locator('.mwan4-test-step');

		await expect(page.locator('.modal h2')).toHaveText('Test traffic');
		await expect(result).toContainText('Try');
		await expect(result.getByRole('button', { name: 'youtube.com' })).toBeVisible();
		await expect(result.getByRole('button', { name: '203.0.113.7' })).toBeVisible();
		await expect(page.locator('#mwan4-error-destination')).toBeHidden();

		await page.locator('.modal input[name="destination"]').fill('www.youtube.com');
		await expect(result.locator('.mwan4-test-sentence')).toContainText('Matches rule "Everything else (IPv4)" (#5) and goes through Primary');
		await expect(steps).toHaveCount(5);
		await expect(steps.nth(0)).toContainText('Skipped: domain www.youtube.com is not video.example.com');
		await expect(steps.nth(2)).toContainText('(disabled)');
		await expect(steps.nth(2)).toContainText('Skipped: disabled');
		await expect(steps.nth(4)).toContainText('Matches');
		await expect(result.locator('.mwan4-test-rule')).toContainText('Everything else (IPv4)');
		await expect(result.locator('.mwan4-test-rule button')).toHaveCount(0);

		await page.locator('.modal input[name="destination"]').fill('video.example.com');
		await page.locator('.modal select[name="device_pick"]').selectOption('aa:bb:cc:dd:ee:01');
		await expect(page.locator('.modal input[name="source"]')).toHaveValue('aa:bb:cc:dd:ee:01');
		await page.locator('.modal select[name="proto"]').selectOption('tcp');
		await page.locator('.modal input[name="port"]').fill('443');
		await expect(result.locator('.mwan4-test-sentence')).toContainText('Matches rule "TV" (#1) and goes through Primary');
		await expect(steps).toHaveCount(1);

		await page.evaluate(() => {
			const status = window.__mwan4Mock.getStatus();

			status.interfaces.wan_primary.health_state = 'offline';
			window.__mwan4Mock.setStatus(status);
			return window.__mwan4Mock.runPoll();
		});
		await expect(result.locator('.mwan4-test-sentence')).toContainText('goes through Backup because Primary is offline');

		await result.getByRole('button', { name: 'Open rule "TV"' }).click();
		await expect(page.locator('.modal h2')).toContainText('Routing rule: TV');
		await expect(page.locator('.modal input[name="label"]')).toHaveValue('TV');
	});

	test('says what is wrong with the tested destination, device and port', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Test traffic' }).click();
		await page.locator('.modal input[name="destination"]').fill('not a site!');
		await expect(page.locator('#mwan4-error-destination')).toHaveText('Not a domain name or IP address: not a site!');
		await page.locator('.modal input[name="destination"]').fill('198.51.100.7');
		await page.locator('.modal input[name="source"]').fill('tv');
		await expect(page.locator('#mwan4-error-source')).toHaveText('Use an IP address or a MAC address.');
		await page.locator('.modal input[name="source"]').fill('');
		await page.locator('.modal input[name="port"]').fill('99999');
		await expect(page.locator('#mwan4-error-port')).toHaveText('Use one port from 1 to 65535.');
		await page.locator('.modal input[name="port"]').fill('');
		await expect(page.locator('#mwan4-test-result .mwan4-test-sentence')).toContainText('Matches rule "backups" (#3) and is blocked');
	});

	test('tests a rule from its editor with the unsaved changes and returns to the editor', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'Edit routing rule Streaming' }).click();
		await page.locator('.modal textarea[name="what"]').fill('hbo.com');
		await page.getByRole('button', { name: 'Test this rule' }).click();

		await expect(page.locator('.modal h2')).toHaveText('Test traffic');
		await expect(page.locator('.modal input[name="destination"]')).toHaveValue('hbo.com');
		await expect(page.locator('.modal input[name="source"]')).toHaveValue('aa:bb:cc:dd:ee:01');
		await expect(page.locator('.modal select[name="proto"]')).toHaveValue('tcp');
		await expect(page.locator('.modal input[name="port"]')).toHaveValue('443');
		await expect(page.locator('#mwan4-test-result .mwan4-test-sentence')).toContainText('Matches rule "Streaming" (#1)');

		await page.getByRole('button', { name: 'Open rule "Streaming"' }).click();
		await expect(page.locator('.modal h2')).toContainText('Routing rule: Streaming');
		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('hbo.com');

		await page.getByRole('button', { name: 'Test this rule' }).click();
		await page.getByRole('button', { name: 'Back to the rule' }).click();
		await expect(page.locator('.modal textarea[name="what"]')).toHaveValue('hbo.com');
		expect((await ruleSection(page, 'streaming')).domain).toEqual([ 'netflix.com', 'youtube.com' ]);
	});

	test('changes the default routing with a radio choice, a main link and a live sentence', async ({ page }) => {
		await renderOverview(page);
		await expect(page.locator('#mwan4-routing-title, .mwan4-routing')).toHaveCount(0);
		await page.getByRole('button', { name: 'Change default routing' }).click();

		const modal = page.locator('.modal');
		const live = modal.locator('[data-routing-live]');

		await expect(modal.locator('h2')).toHaveText('Change default routing');
		await expect(modal.locator('input[name="routing_mode"]')).toHaveCount(2);
		await expect(modal.getByLabel('Use one link first, others as backup')).toBeChecked();
		await expect(modal.locator('select[name="primary"] option')).toHaveText([ 'Primary (online)', 'Backup (online)' ]);
		await expect(live).toHaveText('Traffic that no rule matches: Primary first, then Backup; stops if none is available.');

		await modal.locator('select[name="primary"]').selectOption('wan_backup');
		await expect(live).toHaveText('Traffic that no rule matches: Backup first, then Primary; stops if none is available.');

		await modal.getByLabel('Share load across all healthy links').check();
		await expect(modal.locator('select[name="primary"]')).toBeHidden();
		await expect(live).toHaveText('Traffic that no rule matches: Balanced across Primary and Backup; stops if none is available.');

		await modal.getByLabel('Use one link first, others as backup').check();
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(modal).toContainText('Backup first, then Primary');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const routes = await page.evaluate(() => window.__mwan4Mock.getUci().mwan4.filter(section => section['.type'] == 'route' && section.generated_by == 'luci-overview')
			.map(section => [ section.interface, section.metric ]));

		expect(routes).toEqual([ [ 'wan_backup', '1' ], [ 'wan_primary', '2' ] ]);
		expect((await ruleSection(page, 'default_rule_v4')).use_strategy).toBe('failover');
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
		await expect(modal).toContainText('Paths to create: wan_backup_first');

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

		const streaming = page.locator('[data-rule="streaming"] [data-activity="connections"]');

		await expect(page.locator('.mwan4-rule-head')).toContainText('Activity');
		await expect(streaming.getByRole('button')).toHaveText('3 / 40');
		await expect(streaming.getByRole('button')).toHaveAttribute('title', 'IPv4: 2 active / 30 new, IPv6: 1 active / 10 new');
		await expect(page.locator('[data-rule="console"] [data-activity="connections"]')).toHaveText('-');
		await expect(page.locator('[data-rule="default_rule_v4"] [data-activity="connections"]')).toHaveText('4 / 9');
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

	test('filters by rule, WAN link, path, family, protocol, and free text, with an empty state', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });
		await page.getByRole('button', { name: 'View all active connections' }).click();

		const modal = page.locator('.modal .mwan4-connections');
		const rows = modal.locator('.mwan4-conn-row');

		await expect(rows).toHaveCount(3);
		await expect(rows.nth(2)).toContainText('Default routing');
		await expect(modal.locator('.mwan4-conn-filters > label > span')).toHaveText([ 'Rule', 'WAN link', 'Path', 'Family', 'Protocol', 'Search' ]);
		await expect(modal.locator('select[name="strategy"] option').first()).toHaveText('Any path');
		await expect(modal).not.toContainText('Strategy');
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

		await expect(page.locator('.modal .mwan4-conn-table th')).toHaveText([ 'Protocol', 'Source', 'Destination', 'State', 'Rule', 'WAN link', 'TTL' ]);
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
		await openCustomRule(page);

		await expect(page.locator('.modal')).toContainText('Custom rule');
		await expect(page.locator('.modal [data-rule-connections]')).toHaveCount(0);
	});

	test('adds WAN, rule, and header entry points that open a pre-filtered modal', async ({ page }) => {
		await renderOverview(page, { uci: uciWithRules() });

		await expect(page.locator('#mwan4-wan-workspace th').filter({ hasText: 'Active connections' })).toHaveCount(1);
		await expect(page.locator('.mwan4-conn-metric')).toContainText('3');

		await page.locator('[data-interface="wan_backup"] .mwan4-conn-button').click();
		await expect(page.locator('.modal .mwan4-connections select[name="interface"]')).toHaveValue('wan_backup');
		await expect(page.locator('.modal .mwan4-conn-row')).toHaveCount(1);
		await page.getByRole('button', { name: 'Close' }).click();

		await page.locator('[data-rule="streaming"] .mwan4-conn-button').click();
		await expect(page.locator('.modal .mwan4-connections select[name="rule"]')).toHaveValue('streaming');
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
		await expect(page.locator('.mwan4-rule-head')).toContainText('Activity');
		await expect(page.locator('[data-activity="connections"]')).toHaveCount(0);
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
		await expect(section.locator('select[name="interface"] option')).toContainText([ 'Any WAN link', 'wan_backup', 'wan_primary' ]);

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

test.describe('mocked mwan4 WAN link dialog', () => {
	const stable = () => ({ status: stableStatus(), history: defaultLinkHistory() });
	const field = (page, name) => page.locator('.modal [name="%s"]'.replace('%s', name));

	test('names the health fields in plain words and keeps them visible under Fine tuning', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Edit WAN link wan_backup' }).click();

		const modal = page.locator('.modal');

		await expect(modal.locator('.mwan4-builder-title strong')).toHaveText([ 'Health check', 'Fine tuning (optional)' ]);
		await expect(modal.locator('.mwan4-advanced-fields label span')).toContainText([
			'Check every (seconds)', 'Failed checks before the link is marked down', 'Good checks before it is used again', 'Targets that must answer' ]);
		await expect(modal.locator('input[name="interval"]')).toBeVisible();
		await expect(modal).not.toContainText('Health tuning');
		await expect(modal).not.toContainText('SLA');
		await expect(modal.locator('details, summary')).toHaveCount(0);
		await expect(modal.locator('.mwan4-builder-section').first().locator('select').first()).toHaveAttribute('name', 'health_profile');
	});

	test('chooses a health profile that fills the numbers, and goes back to Custom when one is edited', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Edit WAN link wan_primary' }).click();

		const profile = field(page, 'health_profile');
		const live = page.locator('.modal [data-health-live]');

		await expect(profile.locator('option')).toHaveText([
			'Sensitive: notices an outage in about 15 s', 'Balanced: notices an outage in about 50 s', 'Tolerant: notices an outage in about 1.5 min', 'Custom' ]);
		await expect(profile).toHaveValue('balanced');
		await expect(live).toHaveText('Pings 1.1.1.1 and 8.8.8.8 every 10 s; marked down after 5 failed checks and up again after 5 good ones; any one target answering keeps it up'
			+ '; treated as degraded above 1000 ms or 40% loss, and healthy again below 500 ms and 10%');

		await profile.selectOption('tolerant');
		await expect(field(page, 'interval')).toHaveValue('15');
		await expect(field(page, 'down')).toHaveValue('6');
		await expect(field(page, 'up')).toHaveValue('6');
		await expect(field(page, 'reliability')).toHaveValue('');
		await expect(live).toContainText('every 15 s; marked down after 6 failed checks and up again after 6 good ones');

		await field(page, 'down').fill('4');
		await expect(profile).toHaveValue('custom');
		await expect(live).toContainText('marked down after 4 failed checks');

		await field(page, 'down').fill('6');
		await expect(profile).toHaveValue('tolerant');
		await profile.selectOption('sensitive');
		await expect(field(page, 'interval')).toHaveValue('5');
		await field(page, 'track_ip').fill('9.9.9.9');
		await expect(live).toContainText('Pings 9.9.9.9 every 5 s');
		await expect(profile).toHaveValue('sensitive');
		await profile.selectOption('custom');
		await expect(field(page, 'interval')).toHaveValue('5');
	});

	test('a profile also sets the stability fields and leaves them empty when they match the defaults', async ({ page }) => {
		await renderOverview(page, stable());
		await page.getByRole('button', { name: 'Edit WAN link wan_primary' }).click();

		const profile = field(page, 'health_profile');

		await expect(profile).toHaveValue('balanced');
		await profile.selectOption('tolerant');
		await expect(field(page, 'flap_threshold')).toHaveValue('2');
		await expect(field(page, 'flap_window')).toHaveValue('600');
		await expect(field(page, 'flap_holddown')).toHaveValue('300');
		await expect(field(page, 'recovery_hold')).toHaveValue('60');
		await expect(field(page, 'flap_damping')).toHaveValue('');

		await field(page, 'flap_window').fill('300');
		await expect(profile).toHaveValue('custom');
		await field(page, 'flap_window').fill('600');
		await expect(profile).toHaveValue('tolerant');
		await profile.selectOption('balanced');
		await expect(field(page, 'flap_holddown')).toHaveValue('');
		await expect(field(page, 'interval')).toHaveValue('');
		await expect(field(page, 'interval')).toHaveAttribute('placeholder', '10');
	});

	test('recognises the saved options as a profile', async ({ page }) => {
		await renderOverview(page, stable());
		await setUciOption(page, 'wan_backup', 'interval', '5');
		await setUciOption(page, 'wan_backup', 'down', '3');
		await setUciOption(page, 'wan_backup', 'up', '3');
		await setUciOption(page, 'wan_backup', 'flap_holddown', '60');
		await setUciOption(page, 'wan_backup', 'recovery_hold', '10');
		await page.getByRole('button', { name: 'Edit WAN link wan_backup' }).click();
		await expect(field(page, 'health_profile')).toHaveValue('sensitive');
		await page.getByRole('button', { name: 'Cancel' }).click();
		await setUciOption(page, 'wan_backup', 'down', '4');
		await page.getByRole('button', { name: 'Edit WAN link wan_backup' }).click();
		await expect(field(page, 'health_profile')).toHaveValue('custom');
	});

	test('adds a link from an unused interface: unused ones first, the family follows, two targets are filled in', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Add WAN link' }).click();

		const network = field(page, 'network');

		await expect(network.locator('option')).toHaveText([ 'wan_lte', 'wan_lte6', 'lan', 'wan_backup (already a WAN link)', 'wan_primary (already a WAN link)' ]);
		await expect(network).toHaveValue('wan_lte');
		await expect(field(page, 'family')).toHaveValue('ipv4');
		await expect(field(page, 'track_ip')).toHaveValue('1.1.1.1 8.8.8.8');
		await expect(page.locator('.modal [data-mwan4-single-target]')).toBeHidden();
		await expect(field(page, 'name')).toHaveAttribute('placeholder', 'Same as the network interface');
		await expect(field(page, 'health_profile')).toHaveValue('balanced');

		await network.selectOption('wan_lte6');
		await expect(field(page, 'family')).toHaveValue('ipv6');
		await network.selectOption('wan_lte');
		await expect(field(page, 'family')).toHaveValue('ipv4');

		await field(page, 'track_ip').fill('9.9.9.9');
		await expect(page.locator('.modal [data-mwan4-single-target]')).toBeVisible();
		await field(page, 'track_ip').fill('9.9.9.9 1.0.0.1');
		await expect(page.locator('.modal [data-mwan4-single-target]')).toBeHidden();

		await field(page, 'health_profile').selectOption('sensitive');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('.modal')).toContainText('wan_lte');
		await expect(page.locator('.modal')).toContainText('9.9.9.9, 1.0.0.1');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		expect(await uciSection(page, 'wan_lte')).toMatchObject({ '.type': 'interface', family: [ 'ipv4' ], track_ip: [ '9.9.9.9', '1.0.0.1' ], interval: '5', down: '3', up: '3', enabled: '1' });
	});

	test('an optional name overrides the interface name and a taken name is refused', async ({ page }) => {
		await renderOverview(page);
		await page.getByRole('button', { name: 'Add WAN link' }).click();
		await field(page, 'name').fill('wan_primary');
		await page.getByRole('button', { name: 'Preview changes' }).click();
		await expect(page.locator('body')).toContainText('A WAN link with that name already exists.');
		await expect(page.locator('.modal [data-mwan4-preview]')).toBeHidden();
	});
});

test.describe('mocked mwan4 unstable WAN handling', () => {
	const stable = () => ({ status: stableStatus(), history: defaultLinkHistory() });

	test('shows held and degraded chips with flap and availability columns', async ({ page }) => {
		await renderOverview(page, stable());

		const primary = page.locator('[data-interface="wan_primary"]');
		const backup = page.locator('[data-interface="wan_backup"]');

		await expect(page.locator('.mwan4-wan-table th')).toHaveText([ 'WAN link', 'State', 'Health', 'Flaps', 'Availability', 'Check targets', 'Active connections', 'Actions' ]);
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
		await page.clock.install({ time: new Date('2026-01-01T00:00:00') });
		await page.clock.pauseAt(new Date('2026-01-01T00:00:01'));
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
		await page.locator('[data-interface="wan_primary"]').getByRole('button', { name: 'Show link history of WAN link Primary' }).click();

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
		await page.locator('[data-interface="wan_backup"]').getByRole('button', { name: 'Show link history of WAN link Backup' }).click();
		await expect(page.locator('.modal .mwan4-conn-empty')).toHaveText('No state transitions recorded yet.');
		await expect(page.locator('.modal svg.mwan4-strip rect')).toHaveCount(1);
		await page.evaluate(() => window.__mwan4Mock.setHistory(null));
		await page.getByRole('button', { name: 'Close' }).click();
		await page.locator('[data-interface="wan_backup"]').getByRole('button', { name: 'Show link history of WAN link Backup' }).click();
		await expect(page.locator('.modal .mwan4-conn-notice')).toContainText('Link history is unavailable');
	});

	test('edits the stability fields of a WAN link with the effective global default as placeholder', async ({ page }) => {
		await renderOverview(page, stable());
		await setUciOption(page, 'globals', 'flap_window', '600');
		await page.getByRole('button', { name: 'Edit WAN link wan_primary' }).click();

		const modal = page.locator('.modal');

		await expect(modal.locator('.mwan4-stability-fields')).toContainText('Pause links that keep flipping');
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
		await expect(modal).toContainText('Flips that count as unstable 4');
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

	test('edits the quality limits of the default path and explains the latency and loss check requirement', async ({ page }) => {
		const quality = () => page.locator('[data-rule="default_rule_v4"]').getByRole('button', { name: /Edit quality limits of/ });

		await renderOverview(page, stable());
		await expect(page.locator('[data-rule="default_rule_v4"] .mwan4-actions')).toContainText('Quality limits');
		await quality().click();

		const modal = page.locator('.modal');

		await expect(modal).toContainText('Also check latency and packet loss');
		await expect(modal).toContainText('No latency/loss data from: wan_backup');
		await modal.locator('input[name="max_latency"]').fill('150');
		await modal.locator('input[name="max_loss"]').fill('5');
		await applyPending(page);

		expect(await uciSection(page, 'failover')).toMatchObject({ max_latency: '150', max_loss: '5' });

		await expect(quality()).toHaveAttribute('title', 'latency 150 ms, loss 5%');
		await quality().click();
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
		await expect(page.locator('.mwan4-held-chip, .mwan4-degraded-chip, [data-rule] .mwan4-actions button')).toHaveCount(0);

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
