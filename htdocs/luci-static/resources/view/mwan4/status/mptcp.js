'use strict';
'require form';
'require rpc';
'require uci';
'require view';
'require mwan4.common as mwan4Common';

var E = mwan4Common.element;
/* global mwan4Common */

const callDiagnostics = rpc.declare({
	object: 'mwan4',
	method: 'diagnostics',
	params: [ 'section', 'interface' ],
	expect: { }
});

const callSessionAccess = rpc.declare({
	object: 'session',
	method: 'access',
	params: [ 'scope', 'object', 'function' ],
	expect: { access: false }
});

mwan4Common.addStylesheet();

const formatDisplayValue = mwan4Common.formatDisplayValue;

function overviewDescription(text) {
	return E('span', [
		text,
		' ',
		E('a', { href: L.url('admin/network/mwan4/overview') }, [ _('Back to overview.') ])
	]);
}

function asArray(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value : [ value ];
}

function firstValue(object, keys, fallback) {
	object = object || {};

	for (let i = 0; i < keys.length; i++) {
		let value = object[keys[i]];
		if (value != null && value !== '')
			return value;
	}

	return fallback;
}

function countItems(value) {
	if (Array.isArray(value))
		return value.length;
	if (value && typeof value == 'object')
		return Object.keys(value).length;
	return value ? 1 : 0;
}

function normalizeRecords(value, nameKey) {
	if (Array.isArray(value))
		return value.map(function(item) {
			return item && typeof item == 'object' ? item : { value: item };
		});

	if (value && typeof value == 'object')
		return Object.keys(value).sort().map(function(name) {
			let item = value[name];
			if (item && typeof item == 'object') {
				let copy = Object.assign({}, item);
				if (copy[nameKey || 'name'] == null)
					copy[nameKey || 'name'] = name;
				return copy;
			}

			let copy = { value: item };
			copy[nameKey || 'name'] = name;
			return copy;
		});

	return [];
}

function mptcpPayload(result) {
	let output = (result || {}).diagnostics || result || {};
	return output.mptcp || output;
}

function validateEndpointId(section_id, value) {
	if (value == null || value == '')
		return _('Use a stable endpoint ID from 1 to 255 so mwan4 can remove only endpoints it created.');

	return /^([1-9][0-9]{0,2})$/.test(value) && Number(value) <= 255
		? true
		: _('Use a stable endpoint ID from 1 to 255.');
}

function validateMptcpLimit(section_id, value) {
	if (value == null || value == '')
		return true;

	return /^[0-9]+$/.test(value) && Number(value) <= 65535
		? true
		: _('Use a value from 0 to 65535.');
}

function renderInsightCard(title, value, body) {
	return E('div', { class: 'mwan4-insight-card' }, [
		E('span', [ title ]),
		E('strong', [ formatDisplayValue(value) ]),
		body ? E('small', [ body ]) : ''
	]);
}

function renderTable(title, columns, rows, emptyText) {
	rows = normalizeRecords(rows).slice(0, 25);

	return E('div', { class: 'mwan4-table-card' }, [
		E('h4', [ title ]),
		rows.length ? E('table', { class: 'table mwan4-diag-table' }, [
			E('tr', columns.map(function(column) {
				return E('th', [ column[0] ]);
			}))
		].concat(rows.map(function(row) {
			return E('tr', columns.map(function(column) {
				let value = typeof column[1] == 'function' ? column[1](row) : row[column[1]];
				return E('td', [ formatDisplayValue(value) ]);
			}));
		}))) : E('p', { class: 'mwan4-muted-line' }, [ emptyText ])
	]);
}

function renderWarnings(data) {
	let warnings = asArray(firstValue(data, [ 'warnings', 'warning', 'unsafe_routes', 'conflicts' ], []));

	if (!warnings.length)
		return E('div');

	return E('div', { class: 'mwan4-alert mwan4-alert-warning mwan4-alert-compact', role: 'alert' }, [
		E('strong', [ _('MPTCP attention needed') ]),
		E('ul', warnings.map(function(warning) {
			return E('li', [ formatDisplayValue(warning && warning.message ? warning.message : warning) ]);
		}))
	]);
}

function renderMptcpWorkflow(data) {
	data = data || {};
	let endpoints = firstValue(data, [ 'endpoint_details', 'endpoints', 'endpoint', 'per_wan', 'interfaces' ], []);
	let limits = data.limits_detail || {};
	let sysctls = data.sysctls || data.sysctl || {};
	let config = data.config || {};

	return E('div', { class: 'mwan4-diag-result' }, [
		renderWarnings(data),
		E('section', { class: 'mwan4-diag-section mwan4-advanced-surface' }, [
			E('div', { class: 'mwan4-surface-heading' }, [
				E('span', { class: 'mwan4-eyebrow' }, [ _('MPTCP') ]),
				E('h3', [ _('MPTCP endpoint management') ]),
				E('p', [ _('Use this page to manage mwan4-owned MPTCP kernel/sysctl state, subflow limits, and per-WAN endpoint role definitions without storing secrets.') ]),
				E('p', [ _('Settings are stored in /etc/config/mwan4; LuCI does not write sysctl or iproute2 state directly. The mwan4 service applies them on save/apply and removes only endpoint IDs it previously created.') ])
			]),
			E('div', { class: 'mwan4-insight-grid' }, [
				renderInsightCard(_('Kernel state'), data.available === false ? _('Unavailable') : firstValue(data, [ 'enabled', 'kernel_enabled', 'state', 'status' ], _('Unknown')), _('MPTCP must be enabled before endpoints matter.')),
				renderInsightCard(_('Enabled'), data.enabled_bool ? _('Yes') : _('No'), _('Kernel net.mptcp.enabled value.')),
				renderInsightCard(_('Configured endpoints'), _('%d endpoint(s)').format(countItems(config.endpoints)), _('mwan4-owned endpoint definitions saved in UCI.')),
				renderInsightCard(_('Live endpoint roles'), _('%d endpoint(s)').format(countItems(endpoints)), _('signal, subflow, backup, and fullmesh flags.')),
				renderInsightCard(_('Subflow limit'), firstValue(limits, [ 'subflows', 'subflow', 'subflow_limit' ], sysctls['net.mptcp.subflows'] || _('Not reported')), _('Maximum additional subflows.'))
			]),
			renderTable(_('Configured MPTCP endpoints'), [
				[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'wan', 'name' ], _('Unknown WAN')); } ],
				[ _('Address'), function(row) { return firstValue(row, [ 'address', 'addr', 'ip' ], _('Auto from WAN')); } ],
				[ _('Role'), function(row) { return asArray(firstValue(row, [ 'flags', 'roles', 'role', 'mode' ], [])).map(function(role) { return formatDisplayValue(role); }).join(', ') || _('No role flags'); } ],
				[ _('ID'), function(row) { return firstValue(row, [ 'id', 'endpoint_id' ], _('Not set')); } ]
			], config.endpoints, _('No mwan4-owned MPTCP endpoints are configured.')),
			renderTable(_('Live MPTCP endpoint roles'), [
				[ _('WAN link'), function(row) { return firstValue(row, [ 'device', 'interface', 'wan', 'name', 'dev' ], _('Unknown WAN')); } ],
				[ _('Address'), function(row) { return firstValue(row, [ 'address', 'addr', 'ip', 'endpoint' ], _('Not reported')); } ],
				[ _('Role'), function(row) { return asArray(firstValue(row, [ 'flags', 'roles', 'role', 'mode' ], [])).map(function(role) { return formatDisplayValue(role); }).join(', ') || _('No role flags'); } ],
				[ _('ID'), function(row) { return firstValue(row, [ 'id', 'endpoint_id' ], _('Not reported')); } ]
			], endpoints, _('No MPTCP endpoints were reported.')),
			renderTable(_('MPTCP limits'), [
				[ _('Limit'), function(row) { return firstValue(row, [ 'name' ], _('Unnamed limit')); } ],
				[ _('Value'), function(row) { return firstValue(row, [ 'value' ], _('Not reported')); } ]
			], normalizeRecords(limits), _('No MPTCP limits were reported.')),
			E('div', { class: 'mwan4-workflow' }, [
				E('h4', [ _('MPTCP source-route alignment') ]),
				E('ol', [
					E('li', [ E('strong', [ _('1. Kernel') ]), E('span', [ _('Enable kernel MPTCP and set limits here, then apply mwan4 so the service writes sysctl/iproute2 state.') ]) ]),
					E('li', [ E('strong', [ _('2. Endpoint role') ]), E('span', [ _('Declare one endpoint per WAN source address and choose signal, subflow, backup, or fullmesh roles.') ]) ]),
					E('li', [ E('strong', [ _('3. Route alignment') ]), E('span', [ _('Enable source routing on the Advanced page and verify endpoint source addresses leave through their owning WAN.') ]) ])
				])
			])
		])
	]);
}

function renderRawToggle(output) {
	let rawId = 'mwan4-mptcp-raw-' + Math.floor(Math.random() * 1000000);
	let pre = E('pre', { id: rawId, class: 'mwan4-output', hidden: 'hidden' }, [ JSON.stringify(output, null, '\t') || _('No output') ]);

	return E('div', { class: 'mwan4-raw' }, [
		E('button', {
			type:        'button',
			class:       'btn cbi-button cbi-button-neutral',
			'aria-controls': rawId,
			'aria-expanded': 'false',
			click:       function(ev) {
				let button = ev && ev.currentTarget ? ev.currentTarget : null;
				let hidden = !pre.hidden;
				pre.hidden = hidden;
				if (button) {
					button.setAttribute('aria-expanded', hidden ? 'false' : 'true');
					button.textContent = hidden ? _('Show raw response') : _('Hide raw response');
				}
			}
		}, [ _('Show raw response') ]),
		pre
	]);
}

function renderMptcpResult(result) {
	let errors = result?.errors || [];
	let nodes = [];

	if (errors.length)
		nodes.push(E('div', { class: 'mwan4-alert mwan4-alert-warning', role: 'alert' }, errors.map(function(error) {
			return E('p', [ error.message || error.code || _('MPTCP diagnostic error') ]);
		})));

	nodes.push(renderMptcpWorkflow(mptcpPayload(result)));
	nodes.push(renderRawToggle((result || {}).diagnostics || result || {}));

	return E('div', nodes);
}

function enableMptcpConfig(button) {
	if (button)
		button.disabled = true;

	if (!uci.get('mwan4', 'mptcp'))
		uci.add('mwan4', 'mptcp', 'mptcp');

	uci.set('mwan4', 'mptcp', 'enabled', '1');

	return uci.save().then(function() {
		return uci.apply(10);
	}).then(function() {
		window.location.reload();
	}).catch(function(e) {
		if (button)
			button.disabled = false;
		throw e;
	});
}

function renderMptcpBootstrap(hasConfigAccess) {
	if (uci.get('mwan4', 'mptcp'))
		return '';

	return E('div', { class: 'mwan4-alert mwan4-alert-compact' }, [
		E('strong', [ _('MPTCP is not configured by mwan4 yet') ]),
		E('p', [ _('Open this workflow explicitly before mwan4 writes net.mptcp.enabled or creates kernel endpoint state. Visiting this page does not create a disabled config section.') ]),
		E('button', {
			class:       'btn cbi-button cbi-button-action',
			'aria-busy': 'false',
			disabled:    hasConfigAccess ? null : 'disabled',
			click:       function(ev) { return enableMptcpConfig(ev.currentTarget); }
		}, [ _('Enable MPTCP configuration') ])
	]);
}

function addMptcpKernelSection(m) {
	let s = m.section(form.NamedSection, 'mptcp', 'mptcp', _('MPTCP kernel/sysctl state'));
	let o;

	s.description = _('mwan4 applies these values during service reload. Leave limits empty to keep the current kernel defaults.');

	o = s.option(form.Flag, 'enabled', _('Enable kernel MPTCP'));
	o.description = _('Writes net.mptcp.enabled through the mwan4 backend when configuration is applied.');
	o.default = '0';

	o = s.option(form.Value, 'add_addr_accepted', _('Accepted ADD_ADDR limit'));
	o.description = _('Maximum peer-announced addresses accepted by the kernel MPTCP path manager.');
	o.placeholder = _('kernel default');
	o.validate = validateMptcpLimit;
	o.modalonly = true;

	o = s.option(form.Value, 'subflows', _('Additional subflow limit'));
	o.description = _('Maximum additional subflows the kernel path manager may create.');
	o.placeholder = _('kernel default');
	o.validate = validateMptcpLimit;
}

function addMptcpEndpointSection(m) {
	let s = m.section(form.GridSection, 'mptcp_endpoint', _('Per-WAN MPTCP endpoint roles'));
	let o;

	s.addremove = true;
	s.anonymous = false;
	s.nodescriptions = true;
	s.description = _('Declare mwan4-owned endpoints only. Each endpoint needs a stable ID so mwan4 can remove the endpoint it created without flushing external MPTCP state.');

	o = s.option(form.Flag, 'enabled', _('Enabled'));
	o.default = '1';

	o = s.option(form.ListValue, 'interface', _('WAN link'));
	uci.sections('mwan4', 'interface').forEach(function(section) {
		o.value(section['.name']);
	});
	o.rmempty = false;
	o.description = _('WAN link whose source address and device should own this endpoint.');

	o = s.option(form.ListValue, 'family', _('Address family'));
	o.value('', _('Auto from WAN'));
	o.value('ipv4', _('IPv4'));
	o.value('ipv6', _('IPv6'));
	o.description = _('Select the family used when the endpoint address is derived from the WAN link.');

	o = s.option(form.Value, 'address', _('Endpoint address'));
	o.datatype = 'ipaddr';
	o.placeholder = _('auto from WAN source address');
	o.description = _('Leave empty to use the live source address of the selected WAN link.');

	o = s.option(form.Value, 'id', _('Endpoint ID'));
	o.validate = validateEndpointId;
	o.placeholder = '10';
	o.rmempty = false;
	o.description = _('Stable MPTCP endpoint ID. Required for safe mwan4 ownership and cleanup.');

	o = s.option(form.DynamicList, 'flag', _('Endpoint role'));
	o.value('signal', _('Signal address'));
	o.value('subflow', _('Create subflows'));
	o.value('backup', _('Backup path'));
	o.value('fullmesh', _('Full mesh'));
	o.rmempty = false;
	o.description = _('Choose one or more kernel endpoint flags for this WAN.');

	o = s.option(form.Value, 'port', _('Signal port'));
	o.validate = function(section_id, value) {
		if (value == null || value == '')
			return true;
		return /^([1-9][0-9]{0,4})$/.test(value) && Number(value) <= 65535
			? true
			: _('Use a TCP port from 1 to 65535.');
	};
	o.modalonly = true;
	o.description = _('Optional MPTCP signal port. Most endpoint definitions should leave this empty.');
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4', 'write'), false),
			uci.load('mwan4'),
			L.resolveDefault(callDiagnostics('mptcp'), {})
		]);
	},

	render: function(data) {
		let hasConfigAccess = !!data[0];

		let m = new form.Map('mwan4', _('MultiWAN 4 - MPTCP'), E('div', [
			overviewDescription(_('Manage MPTCP kernel state, limits, and per-WAN endpoint roles from mwan4-owned configuration.')),
			mwan4Common.renderAclNotice(hasConfigAccess,
				_('MPTCP management is disabled because this session lacks the mwan4 configuration ACL.')),
			renderMptcpBootstrap(hasConfigAccess),
			renderMptcpResult(data[2] || {})
		]));

		addMptcpKernelSection(m);
		addMptcpEndpointSection(m);

		return m.render();
	}
});
