const fs = require('fs');
const path = require('path');
const { fakeForm } = require('../../helpers/fake-form');
const { defaultUci } = require('./luci-rpc-mock');

const resources = path.resolve(__dirname, '../../../htdocs/luci-static/resources');
const tabPaths = {
	interfaces: 'view/mwan4/network/interfaces.js',
	routes:     'view/mwan4/network/routes.js',
	strategies: 'view/mwan4/network/strategies.js',
	rules:      'view/mwan4/network/rules.js',
	globals:    'view/mwan4/network/globals.js',
	advanced:   'view/mwan4/network/advanced.js',
	mptcp:      'view/mwan4/status/mptcp.js'
};

function moduleSources() {
	const sources = {};

	fs.readdirSync(path.join(resources, 'mwan4')).forEach(file => {
		sources['mwan4.' + file.replace(/\.js$/, '')] = fs.readFileSync(path.join(resources, 'mwan4', file), 'utf8');
	});
	Object.keys(tabPaths).forEach(tab => { sources['tab.' + tab] = fs.readFileSync(path.join(resources, tabPaths[tab]), 'utf8'); });

	return sources;
}

/*
 * Loads one raw configuration tab with a recording stand-in for LuCI's form module and resolves its `require`
 * lines against the real mwan4 resource modules, so the page shows exactly the labels and help the router would.
 */
async function renderRawTab(page, tab, options) {
	options = options || {};

	await page.setContent('<!doctype html><html><head></head><body><main id="test-root"></main></body></html>');
	await page.evaluate(async function(args) {
		const state = { uci: args.uci, rpcCalls: [] };
		const translate = text => text;

		String.prototype.format = String.prototype.format || function(...values) {
			return this.replace(/%%|%[sd]/g, token => token == '%%' ? '%' : String(values.shift()));
		};

		const baseclass = { extend: definition => definition };
		const L = {
			resource: resourcePath => '/luci-static/resources/' + resourcePath,
			resolveDefault: (value, fallback) => Promise.resolve(value).catch(() => fallback),
			url: (...parts) => '/cgi-bin/luci/' + parts.join('/')
		};
		// like LuCI's E(), an empty array item is drawn as the text "null" unless mwan4Common.element removes it
		function append(node, child) {
			if (child == null || child === false)
				return;
			if (Array.isArray(child))
				child.forEach(item => item == null || item === false ? node.append(String(item)) : append(node, item));
			else
				node.append(child);
		}

		function baseE(tag, attrs, children) {
			if (attrs == null || attrs instanceof Node || Array.isArray(attrs) || typeof attrs != 'object')
				[ attrs, children ] = [ {}, attrs ];

			let node = document.createElement(tag);

			Object.entries(attrs).filter(entry => entry[1] != null && entry[1] !== false).forEach(([ key, value ]) => {
				if (typeof value == 'function')
					node.addEventListener(key, value);
				else if (key == 'value')
					node.value = value;
				else
					node.setAttribute(key, value === true ? key : String(value));
			});
			append(node, children);

			return node;
		}

		const cache = {};
		const find = (conf, sid) => (state.uci[conf] || []).find(item => item['.name'] == sid);
		const element = () => load('mwan4.common').element;
		const builtin = {
			baseclass: baseclass,
			fs: { stat: () => Promise.resolve({ type: 'file' }) },
			poll: { add: () => {} },
			view: { extend: definition => definition },
			ui: {
				addNotification: (_, node) => document.body.appendChild(node),
				hideModal: () => document.querySelectorAll('.modal').forEach(node => node.remove()),
				showModal(title, nodes, cls) {
					this.hideModal();
					document.body.appendChild(element()('div', { class: 'modal ' + (cls || '') }, [ element()('h2', [ title ]), nodes ]));
				}
			},
			uci: {
				load: () => Promise.resolve(),
				unload: () => {},
				sections: (conf, type) => (state.uci[conf] || []).filter(item => !type || item['.type'] == type),
				get: (conf, sid, opt) => { let found = find(conf, sid); return !found ? null : opt == null ? found : found[opt]; },
				set: (conf, sid, opt, value) => { find(conf, sid)[opt] = value; }
			},
			rpc: {
				declare: spec => (...params) => {
					state.rpcCalls.push({ object: spec.object, method: spec.method, params: params });

					return Promise.resolve(spec.object == 'session' ? args.access : args.rpc[spec.object + '.' + spec.method] || {});
				}
			}
		};

		function load(name) {
			if (cache[name])
				return cache[name];

			let source = args.sources[name];
			let deps = Array.from(source.matchAll(/^'require ([\w.]+)(?: as (\w+))?';$/gm));
			let values = deps.map(dep => builtin[dep[1]] || load(dep[1]));
			let factory = new Function(...deps.map(dep => dep[2] || dep[1]), 'L', 'E', '_', source);

			return cache[name] = factory(...values, L, baseE, translate);
		}

		builtin.form = new Function('return (' + args.fakeForm + ')')()(element());

		const module = load('tab.' + args.tab);
		const node = await module.render(await module.load());

		document.getElementById('test-root').replaceChildren(node);
		window.__mwan4Mock = { rpcCalls: state.rpcCalls, getUci: () => state.uci };
	}, {
		tab:      tab,
		sources:  moduleSources(),
		fakeForm: fakeForm.toString(),
		uci:      options.uci || defaultUci(),
		access:   options.access == null ? true : options.access,
		rpc:      options.rpc || {}
	});
}

module.exports = { renderRawTab, tabPaths };
