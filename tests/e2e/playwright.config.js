const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
	testDir: __dirname,
	testMatch: /.*\.spec\.js/,
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	use: {
		trace: 'retain-on-failure'
	}
});
