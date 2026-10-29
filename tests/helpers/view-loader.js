'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fakeForm } = require('./fake-form');

const resources = path.resolve(__dirname, '../../htdocs/luci-static/resources');

String.prototype.format = function(...values) {
	return this.replace(/%%|%[sd]/g, token => token == '%%' ? '%' : String(values.shift()));
};

/*
 * Loads a LuCI resource the way the browser does: its `require` lines are resolved against the real mwan4 modules,
 * LuCI's own modules are replaced by small stand-ins and the form module records what the tab declares.
 */
function createLoader(options) {
	options = options || {};

	const calls = [];
	const uciData = options.uci || {};
	const element = (tag, attrs, children) => ({ tag, attrs, children });
	const L = { resolveDefault: (promise, fallback) => Promise.resolve(promise).catch(() => fallback), url: (...parts) => '/' + parts.join('/'), resource: name => name };
	const baseclass = { extend: definition => definition };
	const cache = {};
	const find = (conf, sid) => (uciData[conf] || []).find(section => section['.name'] == sid);
	const form = fakeForm(element);
	const builtin = {
		baseclass,
		form,
		fs:   { stat: () => Promise.resolve({ type: 'file' }) },
		poll: { add: () => {} },
		ui:   { showModal: () => {}, hideModal: () => {}, addNotification: () => {} },
		view: { extend: definition => definition },
		uci:  {
			load:     () => Promise.resolve(),
			sections: (conf, type) => (uciData[conf] || []).filter(section => !type || section['.type'] == type),
			get:      (conf, sid, opt) => { const found = find(conf, sid); return !found ? null : opt == null ? found : found[opt]; },
			set:      () => {}
		},
		rpc:  {
			declare: spec => (...params) => { calls.push([ spec.object, spec.method, params ]); return Promise.resolve((options.rpc || {})[spec.object + '.' + spec.method] || {}); }
		}
	};

	global.document = { querySelector: () => ({}) };

	function load(file) {
		if (cache[file])
			return cache[file];

		const source = fs.readFileSync(path.join(resources, file), 'utf8');
		const deps = Array.from(source.matchAll(/^'require ([\w.]+)(?: as (\w+))?';$/gm));
		const values = deps.map(dep => builtin[dep[1]] || load(dep[1].replace(/^mwan4\./, 'mwan4/') + '.js'));
		const factory = new Function(...deps.map(dep => dep[2] || dep[1]), 'L', 'E', '_', source);

		return cache[file] = factory(...values, L, element, text => text);
	}

	return { load, form, calls };
}

module.exports = { createLoader };
