#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./helpers/view-loader');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'htdocs/luci-static/resources', file), 'utf8');
const menu = JSON.parse(fs.readFileSync(path.join(root, 'root/usr/share/luci/menu.d/luci-app-mwan4.json'), 'utf8'));

const TABS = {
	interfaces: 'view/mwan4/network/interfaces.js',
	routes:     'view/mwan4/network/routes.js',
	strategies: 'view/mwan4/network/strategies.js',
	rules:      'view/mwan4/network/rules.js',
	globals:    'view/mwan4/network/globals.js',
	advanced:   'view/mwan4/network/advanced.js',
	mptcp:      'view/mwan4/status/mptcp.js'
};

// words the vocabulary table of USABILITY.md retires from everything a person reads in a raw tab
const RETIRED = [ /strateg/i, /\bmember/i, /track_ip/, /fail(s|ed)?[ -]closed/i, /\bSLA\b/, /\bprobe/i, /\bpolic(y|ies)\b/i, /\buplink/i, /\bmwan4\b/ ];
const EMPTY_OR_DEFAULT = /left (empty|on)|by default|Required|Do not edit|inherits|built-in default/i;

const uci = {
	mwan4:   [ { '.type': 'interface', '.name': 'wan_a' }, { '.type': 'route', '.name': 'route_a' }, { '.type': 'strategy', '.name': 'failover' } ],
	network: [ { '.type': 'interface', '.name': 'lan' } ]
};
const rpc = { 'mwan4.link_history': { ok: true, interfaces: {} } };

async function declared(tab) {
	const loader = createLoader({ uci, rpc });
	const view = loader.load(TABS[tab]);

	await view.render(await view.load());

	return loader.form.maps.map(map => ({
		map,
		options: map.sections.flatMap(section => section.options)
	}));
}

function texts(entry) {
	return [ entry.map.title, ...entry.map.sections.flatMap(section => [ section.title, section.description ]),
		...entry.options.flatMap(option => [ option.title, option.description, option.placeholder, ...option.choices.map(choice => choice[1]) ]) ]
		.filter(text => typeof text == 'string');
}

(async () => {
	const all = {};

	for (const tab of Object.keys(TABS))
		all[tab] = await declared(tab);

	for (const [ tab, maps ] of Object.entries(all)) {
		for (const entry of maps) {
			assert.ok(entry.options.length, `${tab} declares options`);

			for (const text of texts(entry))
				for (const pattern of RETIRED)
					assert.doesNotMatch(text, pattern, `${tab}: retired wording ${pattern} in "${text}"`);

			for (const option of entry.options) {
				const where = `${tab}.${option.name}`;
				const description = typeof option.description == 'string' ? option.description : '';

				assert.ok(option.title && typeof option.title == 'string', `${where} has a label`);
				assert.ok(option.description, `${where} has a description`);

				if (option.cls == 'DummyValue')
					continue;

				assert.match(description, EMPTY_OR_DEFAULT, `${where} says what happens when it is left empty or at its default`);

				if (option.cls == 'Value' || option.cls == 'DynamicList')
					assert.ok(option.placeholder || option.default != null || option.choices.length, `${where} shows its effective default or an example`);
			}
		}
	}

	// the heading of every tab is the title of its menu entry
	for (const tab of [ 'interfaces', 'routes', 'strategies', 'rules', 'globals', 'advanced' ])
		assert.equal(all[tab][0].map.title, `MultiWAN 4 - ${menu['admin/network/mwan4/' + tab].title}`, `${tab} heading follows its menu title`);

	// stability fields read the same everywhere because one function supplies them
	const overview = read('view/mwan4/network/overview.js');
	const stability = createLoader({}).load('mwan4/stability.js');
	const labels = stability.fieldLabels();
	const help = stability.fieldHelp();

	assert.match(overview, /mwan4Stability\.fieldLabels\(\)\[name\]/, 'the overview takes its stability labels from stability.js');
	assert.match(overview, /mwan4Stability\.fieldHelp\(\)\[name\]/, 'the overview takes its stability help from stability.js');

	for (const tab of [ 'interfaces', 'globals' ])
		for (const name of stability.STABILITY) {
			const option = all[tab].flatMap(entry => entry.options).find(item => item.name == name);

			assert.equal(option.title, labels[name], `${tab}.${name} uses the shared label`);
			assert.ok(option.description.startsWith(help[name]), `${tab}.${name} uses the shared help`);
		}

	assert.match(labels.flap_damping, /^Pause links/, 'plain label instead of "Flap damping"');
	assert.match(help.recovery_hold, /^Wait this long after a link recovers before using it again/);
	assert.match(help.flap_damping, /^Keep a link out of use after repeated up\/down flips/);

	// health check labels that the overview dialog also shows are identical in the raw tabs
	for (const name of [ 'interval', 'down', 'up', 'reliability', 'track_ip', 'track_method', 'check_quality', 'failure_latency', 'failure_loss', 'recovery_latency', 'recovery_loss' ]) {
		const titles = [ 'interfaces', 'advanced' ].map(tab => all[tab].flatMap(entry => entry.options).find(item => item.name == name).title);

		assert.equal(titles[0], titles[1], `${name} reads the same on WAN Links and Advanced`);
		assert.ok(overview.includes(`_('${titles[0]}')`), `the overview uses the label "${titles[0]}"`);
	}

	// every choice of a path ends in a sentence that is also used on the overview
	const lastResort = all.strategies[0].options.find(option => option.name == 'last_resort');

	assert.deepEqual(lastResort.choices.map(choice => choice[0]), [ 'unreachable', 'blackhole', 'default' ]);
	assert.deepEqual(all.rules[0].options.find(option => option.name == 'use_strategy').choices.map(choice => choice[0]),
		[ 'failover', 'default', 'unreachable', 'blackhole' ]);

	console.log('raw tab expectations passed');
})();
