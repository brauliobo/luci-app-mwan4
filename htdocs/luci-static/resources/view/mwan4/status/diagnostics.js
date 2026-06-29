'use strict';
'require rpc';
'require ui';
'require view';
'require mwan4.common as mwan4Common';
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

let hasDiagnosticsAccess = false;

mwan4Common.addStylesheet();

const formatDisplayValue = mwan4Common.formatDisplayValue;
const setBusy            = mwan4Common.setBusy;

function eventButton(ev) {
	return ev && ev.currentTarget ? ev.currentTarget : null;
}

function setButtonBusy(button, busy) {
	if (!button)
		return;

	button.disabled = !!busy;
	setBusy(button, busy);
}

function boolText(value) {
	return value ? _('Yes') : _('No');
}

function joinList(value, empty) {
	return Array.isArray(value) && value.length ? value.map(function(item) {
		return formatDisplayValue(item, _('Unknown item'));
	}).join(', ') : empty || _('None');
}

function renderKeyValues(title, rows) {
	let children = [];

	rows.forEach(function(row) {
		children.push(E('strong', [ row[0] ]));
		children.push(E('span', [ formatDisplayValue(row[1]) ]));
	});

	return E('div', { class: 'mwan4-card' }, [
		E('h3', [ title ]),
		E('div', { class: 'mwan4-kv' }, children)
	]);
}

function renderStatusSummary(status) {
	status = status || {};
	let nft = status.nft || {};

	return E('div', [
		mwan4Common.renderRuntimeWarnings({ diagnostics: status }),
		mwan4Common.renderNextSteps({ diagnostics: status }),
		E('div', { class: 'mwan4-grid' }, [
			renderKeyValues(_('Runtime state'), [
				[ _('Configured'), boolText(status.configured) ],
				[ _('Service running'), boolText(status.service_running) ],
				[ _('Trackers'), _('%d / %d').format(status.trackers_running || 0, status.trackers_expected || 0) ],
				[ _('nftables'), status.nft_chains ? _('Chains present') : _('Chains missing') ]
			]),
			renderKeyValues(_('Configured WAN links'), [
				[ _('Enabled'), joinList(status.enabled_interfaces) ],
				[ _('Health checks'), joinList(status.tracking_interfaces) ]
			]),
			renderKeyValues(_('nft chains'), [
				[ _('Prerouting'), boolText(nft.prerouting) ],
				[ _('Output'), boolText(nft.output) ],
				[ _('IPv4 rules'), boolText(nft.rules_ipv4) ],
				[ _('IPv6 rules'), boolText(nft.rules_ipv6) ]
			])
		])
	]);
}

function renderSummary(summary) {
	summary = summary || {};

	return E('div', { class: 'mwan4-diag-section' }, [
		E('h3', [ _('Summary') ]),
		E('div', { class: 'mwan4-grid' }, [
			renderKeyValues(_('Configuration'), [
				[ _('Contract'), String(summary.version || 0) ],
				[ _('Mark mask'), summary.mmx_mask || _('Not available') ],
				[ _('IPv6 disabled'), boolText(summary.no_ipv6) ],
				[ _('Source routing'), boolText(summary.source_routing) ]
			]),
			renderKeyValues(_('Inventory'), [
				[ _('WAN links'), joinList(summary.interfaces) ],
				[ _('Enabled'), joinList(summary.enabled_interfaces) ],
				[ _('Strategies'), joinList(summary.strategies) ]
			])
		]),
		renderStatusSummary(summary.status)
	]);
}

function renderCounters(counters) {
	counters = counters || {};
	let summary = counters.summary || {};
	let items = counters.items || {};
	let names = Object.keys(items).sort();
	let rows = names.slice(0, 25).map(function(name) {
		let counter = items[name] || {};
		return E('tr', [
			E('td', [ name ]),
			E('td', [ String(counter.packets || 0) ]),
			E('td', [ String(counter.bytes || 0) ])
		]);
	});

	if (names.length > rows.length)
		rows.push(E('tr', [
			E('td', { colspan: 3 }, [ _('%d more counter(s) hidden; open Raw RPC response for the full list.').format(names.length - rows.length) ])
		]));

	return E('div', { class: 'mwan4-diag-section' }, [
		E('h3', [ _('Counters') ]),
		E('div', { class: 'mwan4-grid' }, [
			renderKeyValues(_('Counter totals'), [
				[ _('Total'), String(summary.total || 0) ],
				[ _('Packets'), String(summary.packets || 0) ],
				[ _('Bytes'), String(summary.bytes || 0) ]
			]),
			renderKeyValues(_('Counter types'), [
				[ _('Traffic policies'), String(summary.rules || 0) ],
				[ _('Strategies'), String(summary.strategies || 0) ],
				[ _('WAN links'), String(summary.interfaces || 0) ],
				[ _('Other'), String(summary.other || 0) ]
			])
		]),
		names.length ? E('table', { class: 'table mwan4-counter-table' }, [
			E('tr', [ E('th', [ _('Counter') ]), E('th', [ _('Packets') ]), E('th', [ _('Bytes') ]) ])
		].concat(rows)) : E('p', [ _('No mwan4 counters reported. Generate traffic that should match a traffic policy, then run Counters again.') ])
	]);
}

function renderRawDiagnostics(output) {
	return E('details', { class: 'mwan4-raw' }, [
		E('summary', [ _('Raw RPC response') ]),
		E('pre', { class: 'mwan4-output' }, [ JSON.stringify(output, null, '\t') || _('No output') ])
	]);
}

function renderDiagnosticsResult(result) {
	let errors = result?.errors || [];
	let output = result?.diagnostics || result || {};
	let nodes = [];

	if (errors.length)
		nodes.push(E('div', { class: 'mwan4-alert mwan4-alert-warning', role: 'alert' }, errors.map(function(error) {
			return E('p', [ error.message || error.code || _('Diagnostic error') ]);
		})));

	if (output.summary)
		nodes.push(renderSummary(output.summary));
	if (output.counters)
		nodes.push(renderCounters(output.counters));

	Object.keys(output).sort().forEach(function(section) {
		if (section == 'summary' || section == 'counters')
			return;

		nodes.push(E('details', { class: 'mwan4-diag-section' }, [
			E('summary', [ section ]),
			E('pre', { class: 'mwan4-output' }, [ JSON.stringify(output[section], null, '\t') || _('No output') ])
		]));
	});

	if (!nodes.length)
		nodes.push(E('p', [ _('No diagnostics output returned.') ]));

	nodes.push(renderRawDiagnostics(output));

	return E('div', { class: 'mwan4-diag-result' }, nodes);
}

function run(section, button) {
	if (!hasDiagnosticsAccess)
		return Promise.resolve();

	setButtonBusy(button, true);

	let node = document.getElementById('mwan4-diag-output');
	if (node) {
		setBusy(node, true);
		node.replaceChildren(E('p', [ _('Running %s diagnostics...').format(section) ]));
	}

	return callDiagnostics(section).then(function(result) {
		let node = document.getElementById('mwan4-diag-output');
		if (node)
			node.replaceChildren(renderDiagnosticsResult(result));
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Diagnostics failed: %s').format(e.message || e) ]), 'danger');
	}).then(function() {
		let node = document.getElementById('mwan4-diag-output');
		setButtonBusy(button, false);
		if (node)
			setBusy(node, false);
	});
}

return view.extend({
	load: function() {
		return L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-diagnostics', 'read'), false).then(function(access) {
			return Promise.all([
				access,
				access ? L.resolveDefault(callDiagnostics('summary'), {}) : {}
			]);
		});
	},

	render: function(data) {
		let commands = [
			[ 'summary', _('Summary') ],
			[ 'all', _('Full diagnostics') ],
			[ 'counters', _('Counters') ],
			[ 'interfaces', _('WAN links') ],
			[ 'routes', _('Paths') ],
			[ 'rules', _('Traffic policies') ],
			[ 'nftables', _('nftables') ],
			[ 'service', _('Service') ],
			[ 'tunnels', _('Tunnels') ]
		];

		hasDiagnosticsAccess = !!data[0];
		let initialResult = data[1] || null;

		return E('div', { class: 'cbi-map' }, [
			E('h2', [ _('MultiWAN 4 - Diagnostics') ]),
			E('div', { class: 'cbi-section' }, [
				mwan4Common.renderAclNotice(hasDiagnosticsAccess,
					_('Diagnostic commands are disabled because this session lacks the mwan4 diagnostics ACL.')),
				E('div', { class: 'mwan4-next-steps' }, [
					E('h3', [ _('What should I check next?') ]),
					E('p', [ _('Run Summary first, then inspect counters or nftables when runtime warnings remain.') ])
				]),
				E('div', { class: 'mwan4-actions' }, commands.map(function(c) {
					return E('button', {
						class:       'btn cbi-button cbi-button-action',
						'aria-busy': 'false',
						'aria-label': _('Run %s diagnostics').format(c[1]),
						disabled:    hasDiagnosticsAccess ? null : 'disabled',
						click:       function(ev) { return run(c[0], eventButton(ev)); }
					}, [ c[1] ]);
				})),
				E('div', { id: 'mwan4-diag-output', class: 'mwan4-diag-result', role: 'status', 'aria-live': 'polite', 'aria-busy': 'false', tabindex: '0' }, [
					hasDiagnosticsAccess && initialResult ? renderDiagnosticsResult(initialResult) : E('p', [ _('Diagnostic commands are disabled for this session.') ])
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
