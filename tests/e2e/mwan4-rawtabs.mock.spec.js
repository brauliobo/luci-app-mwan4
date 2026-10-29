const { test, expect } = require('@playwright/test');
const { defaultDiagnostics, defaultLinkHistory, renderDiagnostics } = require('./helpers/luci-rpc-mock');
const { renderRawTab } = require('./helpers/raw-tab');

const TABS = [
	{ tab: 'interfaces', title: 'MultiWAN 4 - WAN Links', purpose: /WAN links are the internet connections/, task: 'add a WAN link or change how it is tested there' },
	{ tab: 'routes', title: 'MultiWAN 4 - Link priorities', purpose: /A link priority puts one WAN link into a path/, task: 'choose the links of a routing rule' },
	{ tab: 'strategies', title: 'MultiWAN 4 - Paths', purpose: /A path is the list of link priorities/, task: 'builds and reuses paths for you' },
	{ tab: 'rules', title: 'MultiWAN 4 - Routing rules', purpose: /Routing rules are checked from top to bottom/, task: 'add or change routing rules there' },
	{ tab: 'globals', title: 'MultiWAN 4 - Global settings', purpose: /Global settings apply to every WAN link/, task: 'open Global settings' },
	{ tab: 'advanced', title: 'MultiWAN 4 - Advanced', purpose: /Advanced settings cover tunnels/, task: 'keep this page for tunnels and integrations' },
	{ tab: 'mptcp', title: 'MultiWAN 4 - MPTCP', purpose: /MPTCP lets one connection use several WAN links/, task: 'MPTCP settings are only here' }
];

async function strayText(page) {
	return page.evaluate(() => /\bundefined\b|\bnull\b|\[object Object\]|NaN/.test(document.body.innerText) ? document.body.innerText : '');
}

test.describe('raw configuration tabs speak the overview vocabulary', () => {
	for (const { tab, title, purpose, task } of TABS) {
		test(`${tab}: heading, purpose line, way back to the overview and Terms`, async ({ page }) => {
			await renderRawTab(page, tab, { rpc: { 'mwan4.link_history': defaultLinkHistory() } });

			await expect(page.locator('.cbi-map h2')).toHaveText(title);
			await expect(page.locator('.mwan4-raw-purpose')).toHaveText(purpose);
			await expect(page.locator('.mwan4-raw-links span')).toContainText('Most changes are easier on the overview');
			await expect(page.locator('.mwan4-raw-links span')).toContainText(task);

			const back = page.getByRole('link', { name: 'Go to the overview' });

			await expect(back).toBeVisible();
			await expect(back).toHaveAttribute('href', '/cgi-bin/luci/admin/network/mwan4/overview');
			await expect(page.locator('details, summary')).toHaveCount(0);
			expect(await strayText(page)).toBe('');
		});
	}

	test('Terms opens a sorted list of plain-language meanings and returns focus to the button', async ({ page }) => {
		await renderRawTab(page, 'rules');

		const button = page.getByRole('button', { name: 'Terms', exact: true });

		await button.focus();
		await button.click();

		const modal = page.locator('.modal.mwan4-modal');
		const terms = await modal.locator('dt').allInnerTexts();

		await expect(modal).toHaveAttribute('role', 'dialog');
		await expect(modal).toHaveAttribute('aria-modal', 'true');
		expect(terms).toContain('Path');
		expect(terms).toContain('Stops if unavailable');
		expect(terms).toEqual([ ...terms ].sort((a, b) => a.localeCompare(b)));
		expect(await modal.locator('dd').count()).toBe(terms.length);
		await expect(modal.getByRole('button', { name: 'Close' })).toBeFocused();

		await modal.getByRole('button', { name: 'Close' }).click();
		await expect(modal).toHaveCount(0);
		await expect(button).toBeFocused();
	});

	test('diagnostics: purpose line and way back appear only for sessions that may open the overview', async ({ page }) => {
		await renderDiagnostics(page, { configAccess: true });
		await expect(page.locator('.mwan4-raw-purpose')).toContainText('Diagnostics show what the router is really doing');
		await expect(page.getByRole('link', { name: 'Go to the overview' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Terms', exact: true })).toBeVisible();
		expect(await strayText(page)).toBe('');

		await renderDiagnostics(page, { configAccess: false });
		await expect(page.locator('.mwan4-raw-purpose')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Go to the overview' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Terms', exact: true })).toBeVisible();
	});
});
