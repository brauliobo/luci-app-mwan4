const { test, expect } = require('@playwright/test');
const { renderOverview } = require('./helpers/luci-rpc-mock');

/*
 * Interaction budgets from USABILITY.md. A click is one click; a field is one value typed or chosen
 * (fill or selectOption). Opening the modal's Preview step is the last counted interaction; applying is not counted.
 */
function counter() {
	const used = { clicks: 0, fields: 0 };

	return {
		used,
		click:  async locator => { used.clicks++; await locator.click(); },
		fill:   async (locator, value) => { used.fields++; await locator.fill(value); },
		choose: async (locator, value) => { used.fields++; await locator.selectOption(value); }
	};
}

async function ruleSection(page, name) {
	return page.evaluate(sid => window.__mwan4Mock.getUci().mwan4.find(section => section['.name'] == sid), name);
}

async function strayText(page) {
	return page.evaluate(() => {
		const nodes = Array.from(document.querySelectorAll('body *')).filter(node =>
			Array.from(node.childNodes).some(child => child.nodeType == 3 && /^(null|undefined|false)+$/.test(child.textContent.trim())));

		return nodes.map(node => node.className || node.tagName).concat(/\bundefined\b|\bnull\b|\[object Object\]|NaN/.test(document.body.innerText) ? [ document.body.innerText ] : []);
	});
}

test.describe('interaction budgets (ISO 9241-11 efficiency)', () => {
	test('T1: a site through a chosen link takes at most 3 clicks and 2 fields before the preview', async ({ page }) => {
		const step = counter();

		await renderOverview(page);
		await step.click(page.getByRole('button', { name: 'Add routing rule' }).first());
		await step.click(page.locator('.mwan4-template-choice[data-template="site-link"]'));
		await step.fill(page.locator('.modal input[name="what"]'), 'youtube.com');
		await step.choose(page.locator('.modal select[name="link"]'), 'wan_backup');
		await step.click(page.getByRole('button', { name: 'Preview changes' }));

		expect(step.used.clicks).toBeLessThanOrEqual(3);
		expect(step.used.fields).toBeLessThanOrEqual(2);
		await expect(page.locator('.modal')).toContainText('Backup first, then Primary');
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'youtube_com_via');

		expect(rule.label).toBe('youtube.com via Backup');
		expect(rule.domain).toEqual([ 'youtube.com' ]);
		expect(rule.use_strategy).toBe('wan_backup_first');
	});

	test('T2: a device on a chosen link takes at most 4 clicks and 1 typed field using the device picker', async ({ page }) => {
		const step = counter();

		await renderOverview(page);
		await step.click(page.getByRole('button', { name: 'Add routing rule' }).first());
		await step.click(page.locator('.mwan4-template-choice[data-template="device-link"]'));
		await step.choose(page.locator('.modal select[name="device_pick"]'), 'aa:bb:cc:dd:ee:01');
		await step.click(page.getByRole('button', { name: 'Preview changes' }));

		expect(step.used.clicks).toBeLessThanOrEqual(4);
		expect(step.used.fields).toBeLessThanOrEqual(1);
		await page.getByRole('button', { name: 'Apply pending changes' }).click();

		const rule = await ruleSection(page, 'living_room_tv');

		expect(rule.src_mac).toEqual([ 'aa:bb:cc:dd:ee:01' ]);
		expect(rule.domain).toBeNull();
		expect(rule.use_strategy).toBe('wan_primary_first');
	});

	test('T4: where a typed domain goes takes 1 click and 1 field from the overview', async ({ page }) => {
		const step = counter();

		await renderOverview(page);
		await step.click(page.getByRole('button', { name: 'Test traffic' }));
		await step.fill(page.locator('.modal input[name="destination"]'), 'youtube.com');

		expect(step.used.clicks).toBeLessThanOrEqual(1);
		expect(step.used.fields).toBeLessThanOrEqual(1);
		await expect(page.locator('#mwan4-test-result .mwan4-test-sentence')).toContainText('Matches rule "Everything else (IPv4)" (#1)');
		await expect(page.locator('#mwan4-test-result .mwan4-test-steps li')).toHaveCount(1);
	});
});

test.describe('no raw null or undefined reaches the screen', () => {
	test('the overview, the template chooser, both editors and the tester render clean text', async ({ page }) => {
		await renderOverview(page);
		expect(await strayText(page)).toEqual([]);

		await page.getByRole('button', { name: 'Add routing rule' }).first().click();
		expect(await strayText(page)).toEqual([]);
		await expect(page.locator('details')).toHaveCount(0);

		await page.locator('.mwan4-template-choice[data-template="game"]').click();
		await expect(page.locator('.mwan4-rule-editor')).toHaveAttribute('data-mode', 'simple');
		expect(await strayText(page)).toEqual([]);
		await page.locator('.modal input[name="dest_port"]').fill('3074');
		await page.getByRole('button', { name: 'Show all options' }).click();
		await expect(page.locator('.mwan4-rule-editor')).toHaveAttribute('data-mode', 'full');
		expect(await strayText(page)).toEqual([]);
		await expect(page.locator('details')).toHaveCount(0);
		await page.getByRole('button', { name: 'Cancel' }).click();

		await page.getByRole('button', { name: 'Test traffic' }).click();
		expect(await strayText(page)).toEqual([]);
		await page.locator('.modal input[name="destination"]').fill('203.0.113.7');
		await expect(page.locator('#mwan4-test-result .mwan4-test-sentence')).toBeVisible();
		expect(await strayText(page)).toEqual([]);
		await expect(page.locator('details')).toHaveCount(0);
	});

	test('an editor opened on a rule with an unknown path and a missing device still renders clean text', async ({ page }) => {
		const uci = {
			mwan4: [
				{ '.type': 'interface', '.name': 'wan_a', enabled: '1', family: [ 'ipv4' ] },
				{ '.type': 'route', '.name': 'r_a', interface: 'wan_a', metric: '1' },
				{ '.type': 'strategy', '.name': 'a_only', use_route: [ 'r_a' ], last_resort: 'unreachable' },
				{ '.type': 'rule', '.name': 'odd', '.index': 0, label: 'Odd', domain: [ 'odd.example.com' ], src_mac: [ 'aa:bb:cc:dd:ee:77' ], use_strategy: 'gone' },
				{ '.type': 'rule', '.name': 'default_rule_v4', '.index': 1, family: [ 'ipv4' ], dest_ip: '0.0.0.0/0', use_strategy: 'a_only' }
			],
			network: []
		};

		await renderOverview(page, { uci, status: { interfaces: {} } });
		expect(await strayText(page)).toEqual([]);
		await expect(page.locator('[data-rule="odd"] .mwan4-rule-badge')).toHaveCount(1);
		await page.getByRole('button', { name: 'Edit routing rule Odd' }).click();
		expect(await strayText(page)).toEqual([]);
		await page.getByRole('button', { name: 'Test this rule' }).click();
		expect(await strayText(page)).toEqual([]);
	});
});
