'use strict';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';
'require mwan4.common as mwan4Common';
'require mwan4.connections as mwan4Connections';
'require mwan4.explain as mwan4Explain';
'require mwan4.linkhistory as mwan4LinkHistory';
'require mwan4.overview as mwan4Overview';
'require mwan4.routetest as mwan4Routetest';
'require mwan4.rules as mwan4Rules';
'require mwan4.rulesui as mwan4Rulesui';
'require mwan4.stability as mwan4Stability';
'require mwan4.summary as mwan4Summary';
'require mwan4.templates as mwan4Templates';

var E = mwan4Common.element;
/* global mwan4Common */
/* global mwan4Connections */
/* global mwan4Explain */
/* global mwan4LinkHistory */
/* global mwan4Overview */
/* global mwan4Routetest */
/* global mwan4Rules */
/* global mwan4Rulesui */
/* global mwan4Stability */
/* global mwan4Summary */
/* global mwan4Templates */

const callStatus = rpc.declare({
	object: 'mwan4',
	method: 'status',
	params: [ 'section', 'interface' ],
	expect: { }
});

const callValidate = rpc.declare({
	object: 'mwan4',
	method: 'validate',
	params: [ 'section' ],
	expect: { }
});

const callSessionAccess = rpc.declare({
	object: 'session',
	method: 'access',
	params: [ 'scope', 'object', 'function' ],
	expect: { access: false }
});

const callControl = rpc.declare({
	object: 'mwan4',
	method: 'control',
	params: [ 'action', 'interface' ],
	expect: { }
});

const callPbrImport = rpc.declare({
	object: 'mwan4',
	method: 'pbr_import',
	params: [ 'apply' ],
	expect: { }
});

const callHostHints = rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints',
	expect: { }
});

let live = { status: {}, counters: {}, total: null, history: false };
let hasOperatorAccess = false;
let hasConfigWrite = false;
let dragRule = null;
let ruleView = { query: '', filter: 'all' };
let ruleCount = { shown: 0, total: 0 };
let ruleEditor = null;
let modalOpen = false;
let modalRefresh = null;
let testerBack = null;
let testerTouched = false;
let knownDevices = [];
let pbrPreview = {};
let hasDiagnosticsAccess = false;
let modalReturnFocus = null;
let probeHelpers = { httping: false, nping: false, arping: false, nslookup: false };

mwan4Common.addStylesheet();

const formatBytes        = mwan4Common.formatBytes;
const formatDisplayValue = mwan4Common.formatDisplayValue;
const renderPill         = mwan4Common.renderPill;
const setBusy            = mwan4Common.setBusy;
const statusClass        = mwan4Common.statusClass;
const asArray        = mwan4Overview.asArray;
const byId           = mwan4Overview.byId;
const eventButton    = mwan4Overview.eventButton;
const optionList     = mwan4Overview.optionList;
const sanitizeName   = mwan4Overview.sanitizeName;
const tableCell      = mwan4Overview.tableCell;
const tableHeader    = mwan4Overview.tableHeader;
const withBusy       = mwan4Overview.withBusy;
const withButtonBusy = mwan4Overview.withButtonBusy;

function focusModal(modal) {
	let target = modal.querySelector('[data-autofocus]') ||
		modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]');

	(target || modal).focus();
}

function showMwan4Modal(title, nodes) {
	if (!modalOpen)
		modalReturnFocus = document.activeElement;

	modalOpen = true;
	modalRefresh = null;
	ui.showModal(title, nodes, 'mwan4-modal');

	let modal = document.querySelector('.modal.mwan4-modal');
	if (!modal)
		return null;

	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-label', title);
	modal.setAttribute('tabindex', '-1');
	window.setTimeout(function() { focusModal(modal); }, 0);

	return modal;
}

function modalValue(modal, name) {
	let node = modal.querySelector('[name="%s"]'.format(name));
	if (!node)
		return null;
	return node.type == 'checkbox' ? (node.checked ? '1' : '0') : node.value.trim();
}

function serviceButton(label, cls, aria, tip, click) {
	return E('button', { class: 'btn cbi-button %s'.format(cls), title: tip, 'aria-label': aria, 'aria-busy': 'false', click: click }, [ label ]);
}

function renderServiceActions() {
	if (!hasOperatorAccess)
		return null;

	let run = function(action) { return function(ev) { return runMwan4([ action ], eventButton(ev)); }; };

	return E('div', { class: 'mwan4-service-controls', role: 'group', 'aria-label': _('Service') }, [
		E('span', { class: 'mwan4-muted-line' }, [ _('Service') ]),
		serviceButton(_('Start'), 'cbi-button-apply', _('Start MultiWAN 4 service'), _('Start mwan4 so routing rules and failover apply again.'), run('start')),
		serviceButton(_('Restart'), 'cbi-button-action', _('Restart MultiWAN 4 service'), _('Load the saved settings again. Connections may pause for a moment.'), run('restart')),
		serviceButton(_('Stop'), 'cbi-button-reset', _('Stop MultiWAN 4 service'), _('Stop mwan4 and remove its routing rules and failover.'), showStopConfirmation)
	]);
}

function showStopConfirmation() {
	showMwan4Modal(_('Stop mwan4?'), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('p', [ _('Stopping mwan4 removes all routing rules and failover until it is started again.') ])
		]),
		E('div', { class: 'right mwan4-modal-actions' }, [
			E('button', { class: 'btn cbi-button cbi-button-neutral', 'data-autofocus': '1', click: closeModal }, [ _('Cancel') ]),
			E('button', { class: 'btn cbi-button cbi-button-negative', 'aria-busy': 'false', click: function(ev) { return runMwan4([ 'stop' ], eventButton(ev)).then(closeModal); } }, [ _('Stop') ])
		])
	]);
}

function runMwan4(args, button) {
	if (!hasOperatorAccess)
		return Promise.resolve();

	return withButtonBusy(button, function() { return callControl(args[0], args[1] || null); }).then(function(result) {
		let message = mwan4Common.rpcErrorMessage(result, _('Control request failed'));
		if (message)
			throw new Error(message);
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Control failed: %s').format(e.message || e) ]), 'danger');
	});
}

function reloadOverview() {
	let root = byId('mwan4-app');

	uci.unload([ 'mwan4', 'network' ]);

	return Promise.all([
		uci.load('mwan4'),
		uci.load('network'),
		L.resolveDefault(callStatus(), {}),
		L.resolveDefault(callStatus('counters'), {}),
		L.resolveDefault(callPbrImport(false), {}),
		mwan4Connections.probe(),
		mwan4Stability.probe()
	]).then(function(data) {
		pbrPreview = data[4] || {};
		setLive(data[2], data[3], data[5], data[6]);

		if (root)
			root.replaceChildren(renderApp(data[2] || {}, data[3] || {}));
	});
}

function saveApplyRestart() {
	return withBusy(byId('mwan4-app'), function() { return uci.save()
		.then(function() { return uci.apply(10); })
		.then(function() { return hasOperatorAccess ? runMwan4([ 'restart' ]) : null; })
		.then(function() {
			ui.addNotification(null, E('p', [ hasOperatorAccess
				? _('MultiWAN 4 settings applied and service restarted.')
				: _('MultiWAN 4 settings applied. Service restart is hidden by this session ACL.') ]), hasOperatorAccess ? 'info' : 'warning');
		})
		.then(reloadOverview);
	});
}

function closeModal() {
	let target = modalReturnFocus;

	modalReturnFocus = null;
	modalOpen = false;
	modalRefresh = null;
	ruleEditor = null;
	ui.hideModal();

	if (target && document.documentElement.contains(target))
		window.setTimeout(function() { target.focus(); }, 0);
}

function setLive(status, counters, total, history) {
	live = { status: status || {}, counters: counters || {}, total: total, history: history == null ? live.history : !!history };
}

function stabilityEnabled() {
	return mwan4Stability.supported(live.history, live.status);
}

function showHistoryModal(group) {
	let panels = group.members.map(function(name) {
		return E('div', { class: 'mwan4-history-member' }, [
			group.members.length > 1 ? E('h4', { class: 'mwan4-history-heading' }, [ mwan4Explain.familyName(name) ]) : null,
			mwan4LinkHistory.renderPanel({ interface: name })
		]);
	});

	showMwan4Modal(_('Link history: %s').format(group.label), [
		E('div', { class: 'mwan4-modal-grid' }, panels),
		E('div', { class: 'right mwan4-modal-actions' }, [ E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Close') ]) ])
	]);
}

function connectionsEnabled() {
	return live.total != null;
}

function connectionChoices() {
	return {
		rule:      trafficRules().map(function(rule) { return [ rule['.name'], rule.label || rule['.name'] ]; }),
		interface: mwanInterfaces().map(function(section) { return [ section['.name'], section['.name'] ]; }),
		strategy:  strategies().map(function(section) { return [ section['.name'], section['.name'] ]; })
	};
}

function showConnectionsModal(filters) {
	showMwan4Modal(_('Connections'), [
		E('div', { class: 'mwan4-modal-grid' }, [ mwan4Connections.renderPanel({ filters: filters, choices: connectionChoices() }) ]),
		E('div', { class: 'right mwan4-modal-actions' }, [ E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Close') ]) ])
	]);
}

function validationProblemText(result) {
	let errors = result && result.errors;

	if (!Array.isArray(errors))
		errors = errors ? [ errors ] : [];

	if (!errors.length)
		return null;

	return errors.map(function(error) {
		return error.message || error.code || _('Configuration validation failed');
	}).join('; ');
}

function validateBeforeApply() {
	return L.resolveDefault(callValidate('config'), {}).then(function(result) {
		let message = validationProblemText(result);

		if (message)
			throw new Error(message);

		return result;
	});
}

function networkNames() {
	return uci.sections('network', 'interface').map(function(section) {
		return section['.name'];
	}).sort();
}

function helperAvailable(stat) {
	return stat && stat.type == 'file';
}

function healthMethodOptions(selected) {
	let values = [ [ 'ping', _('ICMP ping') ] ];
	let seen = { ping: true };

	function add(value, label, available) {
		if (!available && value != selected)
			return;

		seen[value] = true;
		values.push([ value, available ? label : _('%s (helper missing)').format(label) ]);
	}

	add('httping', _('HTTP probe'), probeHelpers.httping);
	add('nping-tcp', _('TCP probe'), probeHelpers.nping);
	add('nping-udp', _('UDP probe'), probeHelpers.nping);
	add('nping-icmp', _('ICMP nping probe'), probeHelpers.nping);
	add('nping-arp', _('ARP nping probe'), probeHelpers.nping);
	add('nslookup', _('DNS probe'), probeHelpers.nslookup);
	add('arping', _('ARP probe'), probeHelpers.arping);

	if (selected && !seen[selected])
		values.push([ selected, _('%s (custom)').format(selected) ]);

	return values;
}

function mwanInterfaces() {
	return uci.sections('mwan4', 'interface').sort(function(a, b) {
		return String(a['.name'] || '').localeCompare(String(b['.name'] || ''));
	});
}

function strategies() {
	return uci.sections('mwan4', 'strategy').sort(function(a, b) {
		return String(a['.name'] || '').localeCompare(String(b['.name'] || ''));
	});
}

function rules() {
	return uci.sections('mwan4', 'rule').sort(function(a, b) {
		return (a['.index'] || 0) - (b['.index'] || 0);
	});
}

function isGeneratedDefaultRule(rule) {
	let name = rule && rule['.name'];
	let dest = rule && rule.dest_ip;

	return name == 'default_rule_v4' || name == 'default_rule_v6' ||
		((dest == '0.0.0.0/0' || dest == '::/0') && !rule.src_ip && !rule.src_iface && !rule.src_port && !rule.dest_port && !rule.ipset);
}

function setList(conf, sid, opt, values) {
	values = asArray(values).map(function(v) { return String(v || '').trim(); }).filter(function(v) { return v != ''; });
	uci.set(conf, sid, opt, values.length ? values : null);
}

function splitTokens(value) {
	return (value || '').split(/[,\s]+/).map(function(v) { return v.trim(); }).filter(function(v) { return v != ''; });
}

function configuredEnabledInterfaceNames() {
	return mwanInterfaces().filter(function(section) {
		return section.enabled != '0';
	}).map(function(section) {
		return section['.name'];
	});
}

function modalInput(label, name, value, attrs, help) {
	let helpId = help ? 'mwan4-%s-help'.format(sanitizeName(name, 'field')) : null;
	attrs = Object.assign({}, attrs || {});
	attrs.name = name;
	attrs.value = value || '';
	if (helpId)
		attrs['aria-describedby'] = helpId;
	let nodes = [
		E('span', [ label ]),
		E('input', attrs)
	];

	if (help)
		nodes.push(E('small', { id: helpId, class: 'mwan4-modal-help' }, [ help ]));

	return E('label', { class: 'mwan4-modal-field' }, nodes);
}

function modalSelect(label, name, values, selected, emptyLabel, help) {
	let helpId = help ? 'mwan4-%s-help'.format(sanitizeName(name, 'field')) : null;
	let attrs = { name: name };

	if (helpId)
		attrs['aria-describedby'] = helpId;

	let nodes = [
		E('span', [ label ]),
		E('select', attrs, optionList(values, selected, emptyLabel))
	];

	if (help)
		nodes.push(E('small', { id: helpId, class: 'mwan4-modal-help' }, [ help ]));

	return E('label', { class: 'mwan4-modal-field' }, nodes);
}

function modalCheck(label, name, checked, help) {
	let check = E('label', { class: 'mwan4-modal-check' }, [
		E('input', { type: 'checkbox', name: name, checked: checked ? 'checked' : null }),
		E('span', [ label ])
	]);

	return help ? E('div', { class: 'mwan4-modal-check-field' }, [ check, E('small', { class: 'mwan4-modal-help' }, [ help ]) ]) : check;
}

function stabilityField(name, values, globals, inherit) {
	let fallback = mwan4Stability.effectiveDefault(name, globals);
	let label = mwan4Stability.fieldLabels()[name];
	let help = '%s %s'.format(mwan4Stability.fieldHelp()[name], inherit);

	if (name == 'flap_damping')
		return modalSelect(label, name, [ [ '1', _('On') ], [ '0', _('Off') ] ], values[name], _('Use default (%s)').format(fallback == '1' ? _('on') : _('off')), help);

	return modalInput(label, name, values[name], { type: 'number', min: String(mwan4Stability.MINIMUMS[name]), placeholder: fallback }, help);
}

function stabilitySection(title, body, values, globals, inherit) {
	return E('section', { class: 'mwan4-builder-section mwan4-stability-fields' }, [
		E('div', { class: 'mwan4-builder-title' }, [ E('strong', [ title ]), E('span', [ body ]) ]),
		E('div', { class: 'mwan4-modal-columns' }, mwan4Stability.STABILITY.map(function(name) { return stabilityField(name, values, globals, inherit); }))
	]);
}

function stabilityDraft(modal) {
	return Object.fromEntries(mwan4Stability.STABILITY.map(function(name) { return [ name, modalValue(modal, name) || '' ]; }));
}

function writeStability(sid, values) {
	mwan4Stability.STABILITY.forEach(function(name) { uci.set('mwan4', sid, name, values[name] || null); });
}

function singleTargetWarning(targets) {
	return E('small', { class: 'mwan4-modal-warning', role: 'status', 'data-mwan4-single-target': '1', hidden: mwan4Stability.singleTarget(targets) ? null : 'hidden' }, [
		_('Single health check target: one lost probe can take this WAN link offline. Add a second target.')
	]);
}

function bindSingleTargetWarning(modal) {
	let input = modal && modal.querySelector('[name="track_ip"]');
	let warning = modal && modal.querySelector('[data-mwan4-single-target]');

	if (input && warning)
		input.addEventListener('input', function() { warning.hidden = !mwan4Stability.singleTarget(splitTokens(input.value)); });
}

function pendingPreviewSlot() {
	return E('div', { class: 'mwan4-change-preview-slot', 'data-mwan4-preview': '1', 'aria-live': 'polite', hidden: 'hidden' });
}

function renderPreviewDetail(label, value) {
	return [
		E('dt', [ label ]),
		E('dd', Array.isArray(value) ? value : [ value || _('Not set') ])
	];
}

function renderPendingChangePreview(change) {
	let details = [];

	change.items.forEach(function(item) {
		details = details.concat(renderPreviewDetail(item[0], item[1]));
	});

	return E('div', { class: 'mwan4-change-preview', role: 'region', 'aria-label': _('Pending change preview'), 'aria-live': 'polite', tabindex: '-1' }, [
		E('div', { class: 'mwan4-change-preview-title' }, [
			E('strong', [ _('Pending change preview') ]),
			E('span', [ change.summary ])
		]),
		E('dl', details),
		E('p', { class: 'mwan4-change-preview-note' }, [ _('Review this change before it is saved and applied.') ]),
		E('p', { class: 'mwan4-change-preview-note' }, [ _('mwan4 validation runs before the pending change is applied.') ]),
		E('p', { class: 'mwan4-change-preview-note' }, [ _('Settings are not written until you apply these pending changes.') ])
	]);
}

function setModalFieldsDisabled(modal, disabled) {
	modal.querySelectorAll('.mwan4-modal-grid input, .mwan4-modal-grid select, .mwan4-modal-grid textarea, .mwan4-editor-tools button, .mwan4-title-enabled input').forEach(function(node) {
		node.disabled = disabled;
	});
}

function setModalActions(modal, actions) {
	let node = modal.querySelector('.mwan4-modal-actions');
	if (node)
		node.replaceChildren.apply(node, actions);
}

function previewModalActionNodes(changeFn, removeFn) {
	let actions = [
		E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Cancel') ]),
		E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-busy': 'false', click: function() {
			let change = changeFn();
			if (change)
				return showPendingChangePreview(change, changeFn, removeFn);
		} }, [ _('Preview changes') ])
	];

	if (removeFn)
		actions.unshift(E('button', { class: 'btn cbi-button cbi-button-remove', click: removeFn }, [ _('Remove') ]));

	return actions;
}

function previewModalActions(changeFn, removeFn) {
	return E('div', { class: 'right mwan4-modal-actions' }, previewModalActionNodes(changeFn, removeFn));
}

function commitPendingChange(change) {
	closeModal();
	return Promise.resolve(change.apply()).then(validateBeforeApply).then(saveApplyRestart).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Change was not applied: %s').format(e.message || e) ]), 'danger');
		throw e;
	});
}

function showPendingChangePreview(change, changeFn, removeFn) {
	let modal = document.querySelector('.modal');
	let slot = modal ? modal.querySelector('[data-mwan4-preview]') : null;

	if (!modal || !slot)
		return commitPendingChange(change);

	slot.replaceChildren(renderPendingChangePreview(change));
	slot.hidden = false;
	setModalFieldsDisabled(modal, true);
	setModalActions(modal, [
		E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Cancel') ]),
		E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Edit pending change'), click: function() {
			slot.hidden = true;
			slot.replaceChildren();
			setModalFieldsDisabled(modal, false);
			setModalActions(modal, previewModalActionNodes(changeFn, removeFn));
		} }, [ _('Edit') ]),
		E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-busy': 'false', click: function() {
			return commitPendingChange(change);
		} }, [ _('Apply pending changes') ])
	]);

	slot.scrollIntoView({ block: 'nearest' });
	let preview = slot.querySelector('.mwan4-change-preview');
	if (preview)
		preview.focus();
}

function interfaceDraftFromModal(name) {
	let modal = document.querySelector('.modal');
	let selected = modalValue(modal, 'network') || networkNames()[0] || 'wan';
	let trackIps = splitTokens(modalValue(modal, 'track_ip'));
	let family = modalValue(modal, 'family') || 'ipv4';
	let families = family == 'dual' ? [ 'ipv4', 'ipv6' ] : [ family ];

	return {
		name:             name || sanitizeName(modalValue(modal, 'name'), selected),
		network:          selected,
		enabled:          name ? modalValue(modal, 'enabled') : '1',
		family:           families,
		track_method:     modalValue(modal, 'track_method') || 'ping',
		track_ip:         trackIps.length ? trackIps : [ '1.1.1.1', '8.8.8.8' ],
		reliability:      modalValue(modal, 'reliability') || '1',
		interval:         modalValue(modal, 'interval') || '10',
		down:             modalValue(modal, 'down') || '5',
		up:               modalValue(modal, 'up') || '5',
		check_quality:    modalValue(modal, 'check_quality'),
		failure_latency:  modalValue(modal, 'failure_latency') || '1000',
		failure_loss:     modalValue(modal, 'failure_loss') || '40',
		recovery_latency: modalValue(modal, 'recovery_latency') || '500',
		recovery_loss:    modalValue(modal, 'recovery_loss') || '10',
		stability:        stabilityEnabled() ? stabilityDraft(modal) : null
	};
}

function writeInterfaceDraft(draft, existingName) {
	let sid = existingName || draft.name;

	if (!existingName) {
		uci.add('mwan4', 'interface', sid);
		uci.set('mwan4', sid, 'count', '1');
		uci.set('mwan4', sid, 'timeout', '4');
	}

	uci.set('mwan4', sid, 'enabled', draft.enabled);
	setList('mwan4', sid, 'family', draft.family && draft.family.length ? draft.family : [ 'ipv4' ]);
	setList('mwan4', sid, 'track_ip', draft.track_ip);
	uci.set('mwan4', sid, 'track_method', draft.track_method || 'ping');
	uci.set('mwan4', sid, 'reliability', draft.reliability || '1');
	uci.set('mwan4', sid, 'interval', draft.interval || '10');
	uci.set('mwan4', sid, 'down', draft.down || '5');
	uci.set('mwan4', sid, 'up', draft.up || '5');
	uci.set('mwan4', sid, 'check_quality', draft.check_quality);
	uci.set('mwan4', sid, 'failure_latency', draft.failure_latency || '1000');
	uci.set('mwan4', sid, 'failure_loss', draft.failure_loss || '40');
	uci.set('mwan4', sid, 'recovery_latency', draft.recovery_latency || '500');
	uci.set('mwan4', sid, 'recovery_loss', draft.recovery_loss || '10');

	if (draft.stability)
		writeStability(sid, draft.stability);
}

function buildInterfaceChange(name) {
	let draft = interfaceDraftFromModal(name);
	let sla = draft.check_quality == '1'
		? _('Latency %sms / loss %s%%').format(draft.failure_latency, draft.failure_loss)
		: _('Availability only');

	if (!name && uci.get('mwan4', draft.name)) {
		ui.addNotification(null, E('p', [ _('A WAN link with that name already exists.') ]), 'warning');
		return;
	}

	return {
		summary: name
			? _('This will update WAN link health checks before it is written to mwan4.')
			: _('This will add a tracked WAN link before it is written to mwan4.'),
		items:   [
			[ _('WAN link'), draft.name ],
			[ _('Network interface'), name ? draft.name : draft.network ],
			[ _('Address families'), draft.family.join(', ') ],
			[ _('Health check'), '%s: %s'.format(draft.track_method, draft.track_ip.join(', ')) ],
			[ _('SLA'), sla ],
			draft.stability ? [ _('Stability'), mwan4Stability.summary(draft.stability) ] : null,
			[ _('State'), draft.enabled == '1' ? _('Enabled') : _('Disabled') ]
		].filter(Boolean),
		apply:   function() {
			return writeInterfaceDraft(draft, name);
		}
	};
}

function buildInterfaceRemovalChange(name) {
	let routes = uci.sections('mwan4', 'route').filter(function(route) {
		return asArray(route.interface).indexOf(name) > -1 || route.interface == name;
	}).map(function(route) {
		return route['.name'];
	});

	return {
		summary: _('This will remove the WAN link and generated paths that reference it.'),
		items:   [
			[ _('WAN link'), name ],
			[ _('Path references'), routes.length ? routes.join(', ') : _('None') ]
		],
		apply:   function() {
			uci.remove('mwan4', name);
			routes.forEach(function(route) {
				uci.remove('mwan4', route);
			});
		}
	};

}

function showInterfaceRemovalPreview(name) {
	let change = buildInterfaceRemovalChange(name);

	return showPendingChangePreview(change, function() { return buildInterfaceChange(name); }, function() { return showInterfaceRemovalPreview(name); });
}

function showInterfaceModal(name) {
	let section = name ? uci.get('mwan4', name) : null;
	let families = asArray(section?.family);
	let familyChoice = families.includes('ipv4') && families.includes('ipv6') ? 'dual' : (families.includes('ipv6') ? 'ipv6' : 'ipv4');
	let title = name ? _('WAN link: %s').format(name) : _('Add WAN link');
	let fields = [
		name ? E('div', { class: 'mwan4-modal-title' }, [
			E('strong', [ name ]),
			E('span', [ _('Health checks decide when this WAN link can carry traffic.') ])
		]) : E('div', { class: 'mwan4-modal-title' }, [
			E('strong', [ _('New WAN link') ]),
			E('span', [ _('Pick an existing network interface and mwan4 will run health checks against it.') ])
		])
	];

	if (name)
		fields.push(modalCheck(_('Enabled'), 'enabled', section.enabled != '0'));
	else {
		fields.push(modalInput(_('Name'), 'name', '', { placeholder: _('wan_backup') }));
		fields.push(modalSelect(_('Network interface'), 'network', networkNames(), networkNames()[0], null));
	}

	fields.push(
		E('section', { class: 'mwan4-builder-section' }, [
			E('div', { class: 'mwan4-builder-title' }, [
				E('strong', [ _('Basic health check') ]),
				E('span', [ _('Most links only need an address family and two reliable targets.') ])
			]),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalSelect(_('Address family'), 'family', [
					[ 'ipv4', _('IPv4') ],
					[ 'ipv6', _('IPv6') ],
					[ 'dual', _('IPv4 + IPv6') ]
				], familyChoice, null),
				modalSelect(_('Health check method'), 'track_method', healthMethodOptions(section?.track_method || 'ping'), section?.track_method || 'ping', null)
			]),
			modalInput(_('Health check targets'), 'track_ip', asArray(section?.track_ip).join(' ') || '1.1.1.1 8.8.8.8', { placeholder: _('1.1.1.1 8.8.8.8') }),
			singleTargetWarning(asArray(section?.track_ip))
		]),
		E('section', { class: 'mwan4-builder-section mwan4-advanced-fields' }, [
			E('div', { class: 'mwan4-builder-title' }, [
				E('strong', [ _('Health tuning') ]),
				E('span', [ _('Set hysteresis and optional latency/loss thresholds for this WAN link.') ])
			]),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalInput(_('Required healthy targets'), 'reliability', section?.reliability || '1', { type: 'number', min: '1' }),
				modalInput(_('Healthy interval (seconds)'), 'interval', section?.interval || '10', { type: 'number', min: '1' }),
				modalInput(_('Failures before down'), 'down', section?.down || '5', { type: 'number', min: '1' }),
				modalInput(_('Successes before up'), 'up', section?.up || '5', { type: 'number', min: '1' })
			]),
			modalCheck(_('Use latency/loss SLA thresholds'), 'check_quality', section?.check_quality == '1'),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalInput(_('Failure latency (ms)'), 'failure_latency', section?.failure_latency || '1000', { type: 'number', min: '1' }),
				modalInput(_('Failure packet loss (%)'), 'failure_loss', section?.failure_loss || '40', { type: 'number', min: '0', max: '100' }),
				modalInput(_('Recovery latency (ms)'), 'recovery_latency', section?.recovery_latency || '500', { type: 'number', min: '1' }),
				modalInput(_('Recovery packet loss (%)'), 'recovery_loss', section?.recovery_loss || '10', { type: 'number', min: '0', max: '100' })
			])
		])
	);

	if (stabilityEnabled())
		fields.push(stabilitySection(_('Stability'), _('Hold back unstable WAN links so short flaps do not move or drop healthy connections.'), section || {}, getGlobalSection(), _('Empty inherits the global default.')));

	fields.push(pendingPreviewSlot());

	bindSingleTargetWarning(showMwan4Modal(title, [
		E('div', { class: 'mwan4-modal-grid' }, fields),
		previewModalActions(function() { return buildInterfaceChange(name); }, name ? function() { return showInterfaceRemovalPreview(name); } : null)
	]));
}

function setupProgress() {
	let links = mwanInterfaces();
	let routeSections = uci.sections('mwan4', 'route');
	let strategySections = strategies();
	let ruleSections = rules();
	let userRules = trafficRules();
	let hasLinks = links.length > 0;
	let hasRouting = strategySections.length > 0 || routeSections.length > 0;

	return {
		enabledLinkCount: links.filter(function(section) { return section.enabled != '0'; }).length,
		userRuleCount:    userRules.length,
		activeRuleCount:  userRules.filter(function(rule) { return rule.enabled != '0'; }).length,
		hasLinks:         hasLinks,
		hasRouting:       hasRouting,
		hasRules:         ruleSections.length > 0,
		linkCount:        links.length,
		needsGuide:       !hasLinks || !hasRouting,
		routeCount:       routeSections.length,
		ruleCount:        ruleSections.length,
		strategyCount:    strategySections.length
	};
}

function runtimeWarnings(status) {
	let diagnostics = (status || {}).diagnostics || {};
	let warnings = diagnostics.warnings || [];

	return Array.isArray(warnings) ? warnings : [];
}

function runtimeState(runtime) {
	return runtime.health_state != null ? runtime.health_state : runtime.status;
}

/* A link is online when every one of its enabled IPv4 and IPv6 sections is. */
function liveInterfaceCounts(status) {
	let interfaces = (status || {}).interfaces || {};
	let names = Object.keys(interfaces).filter(function(name) {
		return interfaces[name].enabled !== false && interfaces[name].enabled != '0';
	});
	let links = mwan4Explain.groupLinks(names);
	let online = links.filter(function(link) {
		return link.members.every(function(name) { return runtimeState(interfaces[name]) == 'online'; });
	}).length;

	return {
		names:   names,
		online:  online,
		total:   links.length,
		offline: links.length - online
	};
}

function scrollToSection(id) {
	let node = byId(id);

	if (node)
		node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderEmptyState(title, body, actions) {
	return E('div', { class: 'mwan4-empty-state' }, [
		E('div', { class: 'mwan4-empty-copy' }, [
			E('strong', [ title ]),
			E('span', [ body ])
		]),
		E('div', { class: 'mwan4-empty-actions' }, actions || [])
	]);
}

function isOverviewGeneratedRoute(section) {
	let name = section && section['.name'] || '';
	return section && (section.generated_by == 'luci-overview' || /^ui_.*_m[0-9]+_[0-9]+$/.test(name));
}

function overviewGeneratedRoutes() {
	return uci.sections('mwan4', 'route').filter(isOverviewGeneratedRoute);
}

function resetGeneratedRouting() {
	uci.sections('mwan4', 'route').forEach(function(section) {
		if (isOverviewGeneratedRoute(section))
			uci.remove('mwan4', section['.name']);
	});
}

function ensureSection(type, name) {
	if (!uci.get('mwan4', name))
		uci.add('mwan4', type, name);
	return name;
}

function setDefaultRules(strategy) {
	let families = {
		default_rule_v4: [ 'ipv4', '0.0.0.0/0' ],
		default_rule_v6: [ 'ipv6', '::/0' ]
	};

	for (let name in families) {
		ensureSection('rule', name);
		uci.set('mwan4', name, 'family', [ families[name][0] ]);
		uci.set('mwan4', name, 'dest_ip', families[name][1]);
		uci.set('mwan4', name, 'use_strategy', strategy);
	}
}

function addPresetRoute(route, name, metric) {
	uci.add('mwan4', 'route', route);
	uci.set('mwan4', route, 'interface', name);
	uci.set('mwan4', route, 'metric', String(metric));
	uci.set('mwan4', route, 'weight', '1');
	uci.set('mwan4', route, 'generated_by', 'luci-overview');

	return route;
}

function writePresetStrategy(strategy, routes) {
	ensureSection('strategy', strategy);
	uci.set('mwan4', strategy, 'use_route', routes);
	uci.set('mwan4', strategy, 'last_resort', 'unreachable');
	setDefaultRules(strategy);
}

function routingModes() {
	return [
		[ 'failover', _('Use one link first, others as backup'), _('Traffic uses the main link and moves to the next one only when it is unavailable.') ],
		[ 'balanced', _('Share load across all healthy links'), _('New connections are spread across every healthy link.') ]
	];
}

function currentRoutingMode() {
	return (rules().find(isGeneratedDefaultRule) || {}).use_strategy == 'balanced' ? 'balanced' : 'failover';
}

function routingDraftFromModal() {
	let modal = document.querySelector('.modal');
	let checked = modal.querySelector('[name="routing_mode"]:checked');

	return { mode: checked ? checked.value : 'failover', primary: modalValue(modal, 'primary') || (wanChoices()[0] || [])[0] };
}

function routingSentence(draft) {
	return _('Traffic that no rule matches: %s.').format(mwan4Rulesui.defaultPath(draft.mode, draft.primary, wanChoices()).text);
}

function buildRoutingPresetChange() {
	let draft = routingDraftFromModal();
	let plan = mwan4Rulesui.defaultRoutes(draft.mode, draft.primary, wanChoices());
	let generatedCount = overviewGeneratedRoutes().length;

	if (!plan.length) {
		ui.addNotification(null, E('p', [ _('Enable at least one WAN link first.') ]), 'warning');
		return;
	}

	return {
		summary: _('This will replace the generated default path. Your own rules are kept.'),
		items:   [
			[ _('Default routing'), routingModes().find(function(item) { return item[0] == draft.mode; })[1] ],
			[ _('Path'), mwan4Rulesui.defaultPath(draft.mode, draft.primary, wanChoices()).text ],
			[ _('Generated paths replaced'), String(generatedCount) ],
			[ _('Custom paths preserved'), String(uci.sections('mwan4', 'route').length - generatedCount) ],
			[ _('Applies to'), _('IPv4 and IPv6 traffic that no rule matches') ]
		],
		apply:   function() {
			return commitRoutingPreset(draft.mode, plan);
		}
	};
}

function commitRoutingPreset(mode, plan) {
	let stamp = Date.now();

	resetGeneratedRouting();

	let routes = plan.map(function(item, index) {
		return addPresetRoute(sanitizeName('ui_%s_m%d_%d'.format(item.interface, item.metric, stamp), 'route_%d_%d'.format(index + 1, stamp)), item.interface, item.metric);
	});

	writePresetStrategy(mode == 'failover' ? 'failover' : 'balanced', routes);
}

function routingChoice(mode, checked) {
	return E('label', { class: 'mwan4-radio-choice' }, [
		E('input', { type: 'radio', name: 'routing_mode', value: mode[0], checked: checked ? 'checked' : null }),
		E('span', [ E('strong', [ mode[1] ]), E('small', [ mode[2] ]) ])
	]);
}

/* mode: the radio that starts selected. The primary link only matters, and is only shown, while one link is used first. */
function showRoutingModal(mode) {
	let primary = modalSelect(_('Main link'), 'primary', mwan4Rulesui.linkChoices(ruleContext()), (wanChoices()[0] || [])[0], null);
	let live = E('p', { class: 'mwan4-routing-live', 'data-routing-live': '1', 'aria-live': 'polite' });
	let grid = E('div', { class: 'mwan4-modal-grid' }, [
		E('div', { class: 'mwan4-modal-title' }, [
			E('strong', [ _('How should traffic that no rule matches leave?') ]),
			E('span', [ _('This replaces the generated default path. Your own rules are kept.') ])
		]),
		E('div', { class: 'mwan4-radio-list', role: 'radiogroup', 'aria-label': _('Default routing') }, routingModes().map(function(item) { return routingChoice(item, item[0] == mode); })),
		primary,
		live,
		pendingPreviewSlot()
	]);
	let refresh = function() {
		primary.hidden = routingDraftFromModal().mode != 'failover';
		live.textContent = routingSentence(routingDraftFromModal());
	};

	showMwan4Modal(_('Change default routing'), [ grid, previewModalActions(buildRoutingPresetChange) ]);
	grid.addEventListener('change', refresh);
	modalRefresh = refresh;
	refresh();
}

function familyLabel(family) {
	return family == 'ipv6' ? _('IPv6') : _('IPv4');
}

function protocolLabel(proto) {
	let labels = {
		all:    _('Any protocol'),
		tcp:    _('TCP'),
		udp:    _('UDP'),
		icmp:   _('ICMP'),
		icmpv6: _('ICMPv6'),
		esp:    _('ESP')
	};

	return labels[proto || 'all'] || proto;
}

function wanChoices() {
	return mwan4Rules.wanGroups(configuredEnabledInterfaceNames(), uci.sections('mwan4', 'route'));
}

function deviceName(mac) {
	let device = knownDevices.find(function(item) { return item.mac == mac; });

	return device && device.name ? '%s (%s)'.format(device.name, mac) : mac;
}

function describeWhat(draft) {
	return draft.domain.concat(draft.dest_ip).join(', ') || _('Any destination');
}

function describeWho(draft) {
	if (draft.src_iface)
		return _('Network %s').format(draft.src_iface);

	return draft.src_mac.map(deviceName).concat(draft.src_ip).join(', ') || _('All devices');
}

function describeTransport(draft) {
	return [
		draft.proto != 'all' ? protocolLabel(draft.proto) : null,
		draft.src_port ? _('source port %s').format(draft.src_port) : null,
		draft.dest_port ? _('port %s').format(draft.dest_port) : null
	].filter(Boolean).join(' ') || _('Any protocol');
}

function ruleOptionList(draft) {
	return [
		draft.dscp ? _('DSCP %s').format(draft.dscp) : null,
		draft.local == '1' ? _('Includes router traffic') : null,
		draft.sticky == '1' ? _('Keeps each device on one link for %ss').format(draft.timeout || '600') : null,
		draft.logging == '1' ? _('Log matches') : null,
		draft.ipset ? _('DNS/IP set %s').format(draft.ipset) : null
	].filter(Boolean);
}

function formatRuleOptions(draft) {
	return ruleOptionList(draft).join(', ') || _('No advanced options');
}

function blankRuleDraft() {
	return {
		name: null, label: '', enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all',
		src_port: '', dest_port: '', dscp: '', local: '0', ipset: '', via: 'default', sticky: '0', timeout: '600', logging: '0'
	};
}

function emptyRuleDraft() {
	let current = rules().find(isGeneratedDefaultRule);

	return Object.assign(blankRuleDraft(), { via: (current || {}).use_strategy || (strategies()[0] || {})['.name'] || 'default' });
}

function ruleDraft(rule) {
	return Object.assign(blankRuleDraft(), {
		name:      rule['.name'],
		label:     rule.label || rule['.name'],
		enabled:   rule.enabled == '0' ? '0' : '1',
		domain:    asArray(rule.domain),
		dest_ip:   asArray(rule.dest_ip),
		src_ip:    asArray(rule.src_ip),
		src_mac:   asArray(rule.src_mac),
		src_iface: rule.src_iface || '',
		proto:     rule.proto || 'all',
		src_port:  rule.src_port || '',
		dest_port: rule.dest_port || '',
		dscp:      rule.dscp || '',
		local:     rule.local == '1' ? '1' : '0',
		ipset:     rule.ipset || '',
		via:       rule.use_strategy || 'default',
		sticky:    rule.sticky || '0',
		timeout:   rule.timeout || '600',
		logging:   rule.logging || '0'
	});
}

function ruleDraftFromSection(name) {
	return ruleDraft(uci.get('mwan4', name) || { '.name': name });
}

function defaultRuleFamily(rule) {
	return asArray(rule.family)[0] || (rule.dest_ip == '::/0' ? 'ipv6' : 'ipv4');
}

function ruleDrafts() {
	return rules().map(function(rule) {
		let draft = ruleDraft(rule);

		return isGeneratedDefaultRule(rule)
			? Object.assign(draft, { generated: true, label: _('Everything else (%s)').format(familyLabel(defaultRuleFamily(rule))) })
			: draft;
	});
}

function isDefaultDraft(draft) {
	return draft.generated === true;
}

function linkGroups() {
	return mwan4Explain.groupLinks(wanChoices().flat());
}

function ruleContext(status) {
	return {
		devices:    knownDevices,
		strategies: strategies(),
		routes:     uci.sections('mwan4', 'route'),
		interfaces: mwanInterfaces(),
		status:     status || live.status,
		links:      linkGroups()
	};
}

function ruleCheckContext(name, ctx, drafts) {
	return Object.assign({}, ctx, mwan4Rulesui.placement(drafts || ruleDrafts(), name, isDefaultDraft));
}

function templateById(id) {
	return mwan4Templates.ruleTemplates().find(function(template) { return template.id == id; });
}

function ruleLabel(draft, ctx) {
	return draft.label || mwan4Templates.autoLabel(draft, ctx);
}

function setIfChanged(node, key, build) {
	if (node.getAttribute('data-sig') === key)
		return;

	node.setAttribute('data-sig', key);
	node.replaceChildren.apply(node, build().filter(function(child) { return child != null; }));
}

function withError(field, name) {
	let id = 'mwan4-error-%s'.format(name);
	let control = field.querySelector('input, select, textarea');

	control.setAttribute('aria-describedby', [ control.getAttribute('aria-describedby'), id ].filter(Boolean).join(' '));
	field.appendChild(E('small', { id: id, class: 'mwan4-field-error', 'data-error-for': name, hidden: 'hidden' }));

	return field;
}

function showFieldErrors(root, errors) {
	root.querySelectorAll('[data-error-for]').forEach(function(slot) {
		let found = errors.find(function(error) { return error.field == slot.getAttribute('data-error-for'); });
		let control = slot.parentNode.querySelector('input, select, textarea');

		slot.textContent = found ? found.message : '';
		slot.hidden = !(found && found.message);
		control.setAttribute('aria-invalid', found ? 'true' : 'false');
	});

	root.querySelectorAll('[data-flag-for]').forEach(function(control) {
		let flagged = errors.some(function(error) { return error.field == control.getAttribute('data-flag-for') && !error.message; });

		control.setAttribute('aria-invalid', flagged ? 'true' : 'false');
	});
}

function chip(text, cls) {
	return E('span', { class: 'mwan4-chip %s'.format(cls || '') }, [ text ]);
}

function chipList(values, cls, limit) {
	let more = values.length > limit ? [ chip(_('+%d more').format(values.length - limit), 'mwan4-muted') ] : [];

	return values.slice(0, limit).map(function(value) { return chip(value, cls); }).concat(more);
}

function showClassified(modal) {
	let node = byId('mwan4-rule-classified');
	let what = mwan4Rules.classifyEntries(modalValue(modal, 'what'));

	if (node)
		node.replaceChildren.apply(node, chipList(what.domain, 'mwan4-chip-domain', 50)
			.concat(chipList(what.ip, 'mwan4-chip-ip', 50), chipList(what.mac.concat(what.invalid), 'mwan4-offline', 50)));
}

function syncWhoMode(modal) {
	let mode = modalValue(modal, 'who_mode');

	modal.querySelectorAll('[data-who-mode]').forEach(function(node) {
		node.hidden = node.getAttribute('data-who-mode') != mode;
	});
}

function addKnownDevice(modal, select) {
	let who = modal.querySelector('[name="who"]');
	let entries = mwan4Rules.classifyEntries(who.value);

	if (select.value && entries.mac.concat(entries.ip).indexOf(select.value) < 0)
		who.value = (who.value.trim() + (who.tagName == 'TEXTAREA' ? '\n' : ', ') + select.value).replace(/^[\n,\s]+/, '');

	select.value = '';
	who.dispatchEvent(new Event('input', { bubbles: true }));
}

function simpleFormValues(modal) {
	return {
		what:  modalValue(modal, 'what') || '',
		who:   modalValue(modal, 'who') || '',
		ports: modalValue(modal, 'dest_port') || '',
		link:  modalValue(modal, 'link') || ''
	};
}

function fullFormValues(modal) {
	let values = Object.fromEntries([ 'what', 'who', 'src_iface', 'proto', 'src_port', 'dest_port', 'dscp', 'ipset', 'sticky', 'timeout' ]
		.map(function(name) { return [ name, modalValue(modal, name) || '' ]; }));

	return Object.assign(values, { mode: modalValue(modal, 'who_mode') });
}

function simpleDraft(modal) {
	let base = Object.assign({}, ruleEditor.base, { label: '' });

	return mwan4Templates.applyTemplate(base, ruleEditor.template, simpleFormValues(modal), ruleContext());
}

function fullDraft(modal) {
	let values = fullFormValues(modal);
	let mode = values.mode;
	let what = mwan4Rules.classifyEntries(values.what);
	let who = mwan4Rules.classifyEntries(values.who);
	let devices = mode == 'devices';

	return {
		domain:    what.domain,
		dest_ip:   what.ip,
		src_ip:    devices ? who.ip : [],
		src_mac:   devices ? who.mac : [],
		src_iface: mode == 'iface' ? values.src_iface : '',
		proto:     values.proto || 'all',
		src_port:  values.src_port,
		dest_port: values.dest_port,
		dscp:      values.dscp,
		local:     modalValue(modal, 'local'),
		ipset:     values.ipset,
		via:       modalValue(modal, 'use_strategy') || 'default',
		sticky:    values.sticky,
		timeout:   values.timeout || '600',
		logging:   modalValue(modal, 'logging')
	};
}

function ruleDraftFromModal(name) {
	let modal = document.querySelector('.modal');
	let draft = ruleEditor.mode == 'simple' ? simpleDraft(modal) : fullDraft(modal);

	return Object.assign(draft, { name: name, label: modalValue(modal, 'label'), enabled: modalValue(modal, 'enabled') });
}

function ruleFieldProblems(modal) {
	return ruleEditor.mode == 'simple'
		? mwan4Rulesui.simpleProblems(templateById(ruleEditor.template), simpleFormValues(modal))
		: mwan4Rulesui.problems(fullFormValues(modal));
}

function issueField(issue) {
	return issue.field == 'via' ? (ruleEditor.mode == 'simple' ? 'link' : 'use_strategy') : issue.field;
}

function issueKind(severity) {
	return { error: _('Error'), warning: _('Warning'), info: _('Note') }[severity];
}

function renderIssue(issue) {
	return E('li', { class: 'is-%s'.format(issue.severity) }, [ E('strong', { class: 'mwan4-issue-kind' }, [ issueKind(issue.severity) ]), ' ', issue.message ]);
}

function shownFieldProblems(problems) {
	return problems.filter(function(problem) { return ruleEditor.submitted || !problem.incomplete || ruleEditor.touched.has(problem.field); });
}

function refreshRuleSummary(modal, draft, ctx, issues) {
	let path = mwan4Explain.pathSummary(draft.via, ctx.strategies, ctx.routes);
	let now = mwan4Explain.nowVia(path, ctx.status).text;
	let empty = mwan4Rulesui.matchesNothing(draft);
	let set = function(key, text) { modal.querySelector('[data-summary="%s"]'.format(key)).textContent = text; };

	set('sentence', empty ? _('Fill in the fields below to see what this rule does.') : mwan4Rulesui.sentence(draft, ctx));
	set('now', empty ? '' : now);
	set('split', mwan4Rulesui.isMixed(draft) ? mwan4Rulesui.splitNote() : '');
	setIfChanged(modal.querySelector('[data-summary="issues"]'), JSON.stringify(issues), function() { return issues.map(renderIssue); });

	let live = modal.querySelector('[data-via-live]');

	if (live)
		live.textContent = '%s. %s'.format(path.text, now);
}

/* Recomputes everything the editor shows from the form: summary, inline messages, name suggestion. Returns whether saving is blocked. */
function refreshRuleEditor() {
	let modal = document.querySelector('.modal');

	if (!modal || !ruleEditor || !modal.querySelector('.mwan4-rule-editor'))
		return { blocked: false };

	let ctx = ruleContext();
	let draft = ruleDraftFromModal(ruleEditor.name);
	let fields = ruleFieldProblems(modal);
	let issues = mwan4Rulesui.draftIssues(Object.assign({}, draft, { label: ruleLabel(draft, ctx) }), ruleCheckContext(ruleEditor.name, ctx));
	let blocking = issues.filter(function(issue) { return issue.severity == 'error'; });

	if (ruleEditor.mode == 'full') {
		syncWhoMode(modal);
		showClassified(modal);
	}

	showFieldErrors(modal, shownFieldProblems(fields).concat(blocking.map(function(issue) { return { field: issueField(issue), message: '' }; })));
	refreshRuleSummary(modal, draft, ctx, issues);
	modal.querySelector('[name="label"]').placeholder = mwan4Templates.autoLabel(draft, ctx) || _('Named automatically');

	return { blocked: fields.length > 0 || blocking.length > 0 };
}

function validateRuleModal(modal, submit) {
	if (submit)
		ruleEditor.submitted = true;

	let blocked = refreshRuleEditor().blocked;

	if (blocked && submit)
		modal.querySelector('[aria-invalid="true"]')?.focus();

	return !blocked;
}

function ruleChangeItems(draft) {
	let ctx = ruleContext();

	return [
		[ _('Rule'), draft.label ],
		[ _('Summary'), mwan4Explain.ruleSentence(draft, ctx) ],
		[ _('What'), describeWhat(draft) ],
		[ _('Protocol and ports'), describeTransport(draft) ],
		[ _('Who'), describeWho(draft) ],
		[ _('Goes through'), mwan4Explain.pathSummary(draft.via, ctx.strategies, ctx.routes).text ],
		[ _('Advanced options'), formatRuleOptions(draft) ],
		[ _('State'), draft.enabled == '1' ? _('Enabled') : _('Disabled') ]
	];
}

function ensureViaStrategy(via) {
	let preset = via.split(':');

	if (preset.length < 2)
		return via;

	let plan = mwan4Rules.presetPlan(preset[0], preset[1], wanChoices());

	if (uci.get('mwan4', plan.strategy))
		return plan.strategy;

	let routes = plan.routes.map(function(item, index) {
		let route = sanitizeName('%s_r%d'.format(plan.strategy, index + 1), 'route_%d'.format(index + 1));

		uci.add('mwan4', 'route', route);
		setOptions(route, { interface: item.interface, metric: String(item.metric), weight: '1', generated_by: 'luci-rule' });

		return route;
	});

	uci.add('mwan4', 'strategy', plan.strategy);
	setOptions(plan.strategy, { use_route: routes, last_resort: 'unreachable' });

	return plan.strategy;
}

function setOptions(sid, options) {
	Object.keys(options).forEach(function(key) { uci.set('mwan4', sid, key, options[key]); });
}

function keepDefaultsLast() {
	let all = rules();
	let user = all.filter(function(rule) { return !isGeneratedDefaultRule(rule); });
	let last = user[user.length - 1];

	if (last)
		all.filter(isGeneratedDefaultRule).reverse().forEach(function(rule) { uci.move('mwan4', rule['.name'], last['.name'], true); });
}

function ruleSectionNames() {
	return uci.sections('mwan4').map(function(section) { return section['.name']; });
}

function addRuleSection(base) {
	let sid = mwan4Rules.sectionName(base, ruleSectionNames());

	uci.add('mwan4', 'rule', sid);

	return sid;
}

function writeRuleDraft(draft, sid) {
	let strategy = ensureViaStrategy(draft.via);

	setOptions(sid, {
		label:        draft.label,
		enabled:      draft.enabled,
		family:       mwan4Rules.ruleFamilies(draft),
		proto:        draft.proto,
		src_iface:    draft.src_iface,
		src_port:     draft.src_port,
		dest_port:    draft.dest_port,
		dscp:         draft.dscp,
		local:        draft.local == '1' ? '1' : null,
		ipset:        draft.ipset,
		use_strategy: strategy,
		sticky:       draft.sticky,
		timeout:      draft.sticky == '1' ? draft.timeout : null,
		logging:      draft.logging
	});
	[ 'domain', 'dest_ip', 'src_ip', 'src_mac' ].forEach(function(option) { setList('mwan4', sid, option, draft[option]); });
}

function writeRuleDrafts(parts) {
	let first = parts[0].name || addRuleSection(parts[0].label);

	writeRuleDraft(parts[0], first);
	parts.slice(1).forEach(function(part) {
		let sid = addRuleSection(mwan4Rulesui.siblingName(first, ruleSectionNames()));

		writeRuleDraft(part, sid);
		uci.move('mwan4', sid, first, true);
	});
	keepDefaultsLast();
}

function buildRuleChange(name) {
	let modal = document.querySelector('.modal');

	if (!validateRuleModal(modal, true))
		return;

	let ctx = ruleContext();
	let parts = mwan4Rulesui.splitMixed(ruleDraftFromModal(name)).map(function(part) { return Object.assign(part, { label: ruleLabel(part, ctx) }); });

	return {
		summary: name
			? _('This will update the routing rule before it is saved and applied.')
			: _('This will add a routing rule before it is saved and applied.'),
		items:   parts.length > 1 ? [ [ _('Rules'), mwan4Rulesui.splitNote() ] ].concat(parts.flatMap(ruleChangeItems)) : ruleChangeItems(parts[0]),
		apply:   function() { return writeRuleDrafts(parts); }
	};
}

function buildRuleRemovalChange(name) {
	let draft = ruleDraftFromSection(name);

	return {
		summary: _('This will remove the routing rule after you apply the pending change.'),
		items:   ruleChangeItems(draft),
		apply:   function() { uci.remove('mwan4', name); }
	};
}

function showRuleRemovalPreview(name) {
	let change = buildRuleRemovalChange(name);

	return showPendingChangePreview(change, function() { return buildRuleChange(name); }, function() { return showRuleRemovalPreview(name); });
}

function modalTextarea(label, name, value, attrs, help) {
	let helpId = 'mwan4-%s-help'.format(name);

	return E('label', { class: 'mwan4-modal-field' }, [
		E('span', [ label ]),
		E('textarea', Object.assign({ name: name, rows: '4', 'aria-describedby': helpId }, attrs), [ value ]),
		E('small', { id: helpId, class: 'mwan4-modal-help' }, [ help ])
	]);
}

function renderRuleStep(title, description, children) {
	return E('section', { class: 'mwan4-builder-section' }, [
		E('div', { class: 'mwan4-builder-title' }, [ E('strong', [ title ]), E('span', [ description ]) ]),
		E('div', { class: 'mwan4-modal-grid' }, children)
	]);
}

function protocolChoices() {
	return [ 'all', 'tcp', 'udp', 'icmp', 'icmpv6', 'esp' ].map(function(proto) { return [ proto, protocolLabel(proto) ]; });
}

function renderWhatStep(draft) {
	return renderRuleStep(_('1. What traffic?'), _('Domains and IP addresses are detected automatically. Listing both creates one rule for each kind.'), [
		withError(modalTextarea(_('Domains and addresses'), 'what', draft.domain.concat(draft.dest_ip).join('\n'),
			{ placeholder: 'youtube.com\n203.0.113.0/24\n2001:db8::/32', 'data-autofocus': '1' },
			_('One entry per line. A site name such as youtube.com also covers its subdomains. Leave empty to match every destination.')), 'what'),
		E('div', { id: 'mwan4-rule-classified', class: 'mwan4-chips', 'aria-live': 'polite' }),
		E('div', { class: 'mwan4-modal-columns' }, [
			withError(modalSelect(_('Protocol'), 'proto', protocolChoices(), draft.proto, null,
				_('Leave on Any protocol unless the rule is only for one kind of traffic, such as web (TCP) or calls (UDP).')), 'proto'),
			withError(modalInput(_('Destination ports'), 'dest_port', draft.dest_port, { placeholder: _('443 or 1000-2000') },
				_('Needs TCP or UDP. Use one port, a range such as 1000-2000, or a list separated by commas.')), 'dest_port')
		])
	]);
}

function deviceLabel(device) {
	return [ device.name, device.ip, device.mac ].filter(Boolean).join(' / ');
}

function renderDevicePicker() {
	if (!knownDevices.length)
		return E('small', { class: 'mwan4-modal-help' }, [ _('No DHCP leases or ARP neighbors were found; enter addresses manually.') ]);

	return modalSelect(_('Add a known device'), 'device_pick',
		knownDevices.map(function(device) { return [ device.mac || device.ip, deviceLabel(device) ]; }), '', _('Choose a device'));
}

function renderWhoStep(draft) {
	let mode = draft.src_iface ? 'iface' : draft.src_ip.length || draft.src_mac.length ? 'devices' : 'all';

	return renderRuleStep(_('2. Who?'), _('Apply the rule to everyone, to specific LAN devices, or to a whole network.'), [
		modalSelect(_('Applies to'), 'who_mode', [ [ 'all', _('All devices') ], [ 'devices', _('Selected devices') ], [ 'iface', _('A network') ] ], mode, null),
		E('div', { class: 'mwan4-modal-grid', 'data-who-mode': 'devices' }, [
			renderDevicePicker(),
			withError(modalTextarea(_('Devices'), 'who', draft.src_mac.concat(draft.src_ip).join('\n'),
				{ rows: '3', placeholder: 'aa:bb:cc:dd:ee:ff\n192.168.1.20' }, _('One MAC address, IP address, or CIDR range per line.')), 'who')
		]),
		E('div', { 'data-who-mode': 'iface' }, [
			withError(modalSelect(_('Traffic coming from'), 'src_iface', networkNames(), draft.src_iface, null,
				_('Only traffic that enters the router from this network.')), 'src_iface')
		])
	]);
}

function viaOptionGroups(selected) {
	return mwan4Rulesui.viaGroups(ruleContext()).map(function(group) {
		return E('optgroup', { label: group[0] }, group[1].map(function(item) {
			return E('option', { value: item[0], title: item[2] || null, selected: item[0] == selected ? 'selected' : null }, [ item[1] ]);
		}));
	});
}

function renderViaStep(draft) {
	return renderRuleStep(_('3. Which WAN links?'), _('Pick the path this traffic takes. Quick presets create the path for you.'), [
		E('label', { class: 'mwan4-modal-field' }, [
			E('span', [ _('Send matching traffic through') ]),
			E('select', { name: 'use_strategy', 'data-flag-for': 'use_strategy', 'aria-describedby': 'mwan4-via-help mwan4-via-live' }, viaOptionGroups(draft.via)),
			E('small', { id: 'mwan4-via-help', class: 'mwan4-modal-help' }, [
				_('"First" keeps the other WAN links as backups. "Only" never moves traffic to another link: it stops instead of leaking.')
			]),
			E('small', { id: 'mwan4-via-live', class: 'mwan4-via-live', 'data-via-live': '1' })
		])
	]);
}

function renderRuleOptions(draft) {
	return E('section', { class: 'mwan4-builder-section mwan4-advanced-fields' }, [
		E('div', { class: 'mwan4-builder-title' }, [
			E('strong', [ _('Advanced options') ]),
			E('span', [ _('Most rules do not need these. They narrow what the rule matches or change how it behaves.') ])
		]),
		E('div', { class: 'mwan4-option-group' }, [
			E('strong', [ _('Extra matching') ]),
			E('div', { class: 'mwan4-modal-columns' }, [
				withError(modalInput(_('DSCP value'), 'dscp', draft.dscp, { type: 'number', min: '1', max: '63' },
					_('A priority tag that some apps put on their traffic, such as calls or games (1-63).')), 'dscp'),
				withError(modalInput(_('Source port'), 'src_port', draft.src_port, { placeholder: _('Any') },
					_('Needs TCP or UDP. The port the device sends from; usually left empty.')), 'src_port'),
				withError(modalInput(_('DNS or nft set'), 'ipset', draft.ipset, { placeholder: _('optional set name') },
					_('For experts: the name of a set that already exists in dnsmasq or nftables; its addresses are matched too.')), 'ipset')
			])
		]),
		E('div', { class: 'mwan4-option-group' }, [
			E('strong', [ _('Behaviour') ]),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalCheck(_('Also route traffic from this router'), 'local', draft.local == '1', _('Includes traffic the router sends itself, such as updates and DNS.')),
				modalCheck(_('Keep each device on the same link (sticky)'), 'sticky', draft.sticky == '1',
					_('New connections from a device follow its earlier ones instead of being spread out.')),
				withError(modalInput(_('Keep for (seconds)'), 'timeout', draft.timeout, { type: 'number', min: '1' }, _('Only used while "sticky" is on.')), 'timeout'),
				modalCheck(_('Log matches'), 'logging', draft.logging == '1', _('Writes a line to the system log for every new connection this rule matches.'))
			])
		])
	]);
}

function ruleConnectionNodes(name) {
	let stats = mwan4Connections.ruleStats(name, live.status, live.counters);

	if (!connectionsEnabled())
		return [];

	return [
		E('span', { class: 'mwan4-rule-connections-count' }, [ stats
			? _('%d active, %d new since the ruleset was loaded').format(stats.active.total, stats.created.total)
			: _('No connections counted for this rule yet.') ]),
		E('button', { class: 'btn cbi-button cbi-button-neutral mwan4-compact-button', click: function() { return showConnectionsModal({ rule: name }); } }, [ _('View connections') ])
	];
}

function renderRuleLiveConnections(name) {
	return E('div', { class: 'mwan4-rule-connections', 'data-rule-connections': name }, ruleConnectionNodes(name));
}

function refreshRuleLiveConnections() {
	let node = document.querySelector('.modal [data-rule-connections]');

	if (node)
		node.replaceChildren.apply(node, ruleConnectionNodes(node.getAttribute('data-rule-connections')));
}

function renderTemplateField(field, values, ctx) {
	let input = mwan4Rulesui.INPUT_OF[field.name];

	if (field.name == 'link')
		return withError(modalSelect(field.label, 'link', mwan4Rulesui.linkChoices(ctx), values.link, null, field.help), 'link');

	let text = withError(modalInput(field.label, input, values[field.name], { placeholder: field.placeholder, autocomplete: 'off' }, field.help), input);

	return field.name == 'who' ? E('div', { class: 'mwan4-modal-grid' }, [ renderDevicePicker(), text ]) : text;
}

function renderSimpleFields(template, draft, ctx) {
	let values = mwan4Rulesui.simpleValues(draft, ctx);
	let nodes = template.fields.map(function(field) { return renderTemplateField(field, values, ctx); });

	nodes[0].querySelector('input, select, textarea').setAttribute('data-autofocus', '1');

	return [ E('div', { class: 'mwan4-simple-fields mwan4-modal-grid' }, nodes) ];
}

function renderFullFields(draft) {
	return [ renderWhatStep(draft), renderWhoStep(draft), renderViaStep(draft), renderRuleOptions(draft) ];
}

function editorButton(label, aria, click) {
	return E('button', { class: 'btn cbi-button cbi-button-neutral mwan4-compact-button mwan4-link-button', type: 'button', 'aria-label': aria || null, click: click }, [ label ]);
}

function editorTools(state) {
	return E('div', { class: 'mwan4-editor-tools' }, [
		state.mode == 'simple' ? editorButton(_('Show all options'), null, function() { return switchRuleEditor('full'); }) : null,
		state.mode == 'full' && state.isNew ? editorButton(_('Use a template'), null, showTemplateChooser) : null,
		editorButton(_('Test this rule'), null, testCurrentRule)
	]);
}

function editorIntro(state) {
	let template = templateById(state.template);

	return E('div', { class: 'mwan4-modal-title' }, [
		E('strong', [ state.mode == 'simple' ? template.title : state.isNew ? _('Custom rule') : _('Routing rule') ]),
		E('span', [ state.mode == 'simple' ? template.summary : _('Rules run from top to bottom: the first match decides which WAN link carries the traffic.') ]),
		editorTools(state)
	]);
}

function renderEditorSummary() {
	return E('div', { class: 'mwan4-rule-summary', 'aria-live': 'polite' }, [
		E('strong', { class: 'mwan4-summary-sentence', 'data-summary': 'sentence' }),
		E('span', { class: 'mwan4-summary-now', 'data-summary': 'now' }),
		E('span', { class: 'mwan4-summary-split', 'data-summary': 'split' }),
		E('ul', { class: 'mwan4-summary-issues', 'data-summary': 'issues' })
	]);
}

function initialRuleName(draft, ctx) {
	return draft.label == mwan4Templates.autoLabel(draft, ctx) ? '' : draft.label;
}

function renderRuleEditor(state) {
	let ctx = ruleContext();
	let draft = state.base;
	let title = state.isNew ? _('Add routing rule') : _('Routing rule: %s').format(draft.label);

	ruleEditor = Object.assign({ submitted: false, touched: new Set() }, state);

	let grid = E('div', { class: 'mwan4-modal-grid mwan4-rule-editor', 'data-mode': state.mode }, [
		editorIntro(state),
		renderEditorSummary(),
		state.name ? renderRuleLiveConnections(state.name) : null,
		modalInput(_('Rule name (optional)'), 'label', initialRuleName(draft, ctx), { placeholder: _('Named automatically') },
			_('Leave empty and the rule is named for you, for example "youtube.com via Tim".'))
	].concat(state.mode == 'simple' ? renderSimpleFields(templateById(state.template), draft, ctx) : renderFullFields(draft), [ pendingPreviewSlot() ]));
	let modal = showMwan4Modal(title, [ grid, previewModalActions(function() { return buildRuleChange(state.name); }, state.name ? function() { return showRuleRemovalPreview(state.name); } : null) ]);
	let toggle = modalCheck(_('Enabled'), 'enabled', draft.enabled == '1');

	toggle.classList.add('mwan4-title-enabled');
	modal.firstElementChild.classList.add('mwan4-modal-heading');
	modal.firstElementChild.appendChild(toggle);
	bindRuleEditor(grid, toggle);
}

function bindRuleEditor(grid, toggle) {
	let touch = function(ev) {
		if (ev.target.name)
			ruleEditor.touched.add(ev.target.name);

		refreshRuleEditor();
	};

	[ 'input', 'change' ].forEach(function(type) { grid.addEventListener(type, touch); toggle.addEventListener(type, touch); });
	grid.querySelector('[name="device_pick"]')?.addEventListener('change', function(ev) { addKnownDevice(grid, ev.currentTarget); });
	modalRefresh = refreshRuleEditor;
	refreshRuleEditor();
}

function switchRuleEditor(mode) {
	let state = ruleEditor;

	renderRuleEditor({ name: state.name, isNew: state.isNew, template: state.template, mode: mode, base: ruleDraftFromModal(state.name) });
}

function showTemplateChooser() {
	let choices = mwan4Templates.ruleTemplates().map(function(template) {
		return E('button', { class: 'mwan4-template-choice', type: 'button', 'data-template': template.id,
			click: function() { return showRuleModal(null, { template: template.id }); } }, [
			E('strong', [ template.title ]),
			E('span', [ template.summary ])
		]);
	});

	choices[0].setAttribute('data-autofocus', '1');
	showMwan4Modal(_('Add routing rule'), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('strong', [ _('What do you want to do?') ]),
				E('span', [ _('Pick the closest match. You can change every detail afterwards.') ])
			]),
			E('div', { class: 'mwan4-template-list' }, choices)
		]),
		E('div', { class: 'right mwan4-modal-actions' }, [ E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Cancel') ]) ])
	]);
}

/* name: the rule to edit; opts.draft starts a new rule from a copy; opts.template starts a new rule from a template. */
function showRuleModal(name, opts) {
	opts = opts || {};

	if (!name && !opts.draft && !opts.template)
		return showTemplateChooser();

	let ctx = ruleContext();
	let draft = opts.draft || (name ? ruleDraftFromSection(name) : emptyRuleDraft());
	let template = opts.template || mwan4Templates.templateFor(draft, ctx);

	renderRuleEditor({ name: name || null, isNew: !name, template: template, mode: template == 'custom' ? 'full' : 'simple', base: draft });
}

function duplicateRule(name) {
	return showRuleModal(null, { draft: mwan4Rulesui.copyOf(ruleDraftFromSection(name)) });
}

function testCurrentRule() {
	let state = ruleEditor;
	let draft = ruleDraftFromModal(state.name);

	draft.label = ruleLabel(draft, ruleContext()) || _('New rule');
	showTesterModal(mwan4Rulesui.testPrefill(draft), { draft: draft, parts: mwan4Rulesui.splitMixed(draft), state: state });
}

function testerRules(override) {
	return override ? mwan4Rulesui.withDrafts(ruleDrafts(), override.parts, isDefaultDraft) : ruleDrafts();
}

function testerValues(modal) {
	return Object.fromEntries([ 'destination', 'source', 'proto', 'port' ].map(function(name) { return [ name, modalValue(modal, name) || '' ]; }));
}

function ruleOpenButton(rule, override) {
	let own = override && override.parts.indexOf(rule) >= 0;
	let open = own
		? function() { return renderRuleEditor(Object.assign({}, override.state, { base: override.draft })); }
		: function() { return showRuleModal(rule.name); };

	return rule.generated ? E('strong', [ rule.label ]) : editorButton(_('Open rule "%s"').format(rule.label), null, open);
}

function renderTestStep(step) {
	return E('li', { class: 'mwan4-test-step is-%s%s'.format(step.state, step.enabled ? '' : ' is-disabled') }, [
		E('span', { class: 'mwan4-test-num' }, [ '#%d'.format(step.index + 1) ]),
		E('strong', [ step.name ]),
		step.enabled ? null : E('small', { class: 'mwan4-muted-line' }, [ _('(disabled)') ]),
		E('span', { class: 'mwan4-test-state' }, [ step.text ])
	]);
}

function renderTestAnswer(result, override) {
	let deciding = mwan4Rulesui.decidingRule(result);
	let note = mwan4Rulesui.assumptionNote(result);

	return [
		E('p', { class: 'mwan4-test-sentence is-%s'.format(result.outcome) }, [ result.text ]),
		deciding ? E('p', { class: 'mwan4-test-rule' }, [ ruleOpenButton(deciding, override) ]) : null,
		E('strong', { class: 'mwan4-test-heading' }, [ _('Rules checked, in order') ]),
		E('ol', { class: 'mwan4-test-steps' }, mwan4Rulesui.examined(result).map(renderTestStep)),
		note ? E('p', { class: 'mwan4-muted-line' }, [ note ]) : null
	];
}

function testerHint() {
	let example = function(text) { return editorButton(text, null, function() { return fillTester(text); }); };

	return [ E('p', { class: 'mwan4-muted-line' }, [ _('Type a site or an address to see which rule decides and which WAN link carries it. Try') ]),
		E('p', [ example('youtube.com'), ' ', example('203.0.113.7') ]) ];
}

function fillTester(destination) {
	let input = document.querySelector('.modal [name="destination"]');

	input.value = destination;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.focus();
}

function refreshTester() {
	let modal = document.querySelector('.modal');
	let result = modal && modal.querySelector('#mwan4-test-result');

	if (!result)
		return;

	let values = testerValues(modal);
	let problems = mwan4Rulesui.testProblems(values);
	let shown = problems.filter(function(problem) { return !problem.incomplete || testerTouched; });

	showFieldErrors(modal, shown);

	if (problems.length)
		return setIfChanged(result, 'hint:' + problems[0].message, testerHint);

	let override = testerBack;
	let found = mwan4Routetest.evaluate(mwan4Rulesui.testQuery(values), testerRules(override), strategies(), uci.sections('mwan4', 'route'), live.status);

	setIfChanged(result, JSON.stringify([ found.text, mwan4Rulesui.examined(found).map(function(step) { return step.text; }) ]), function() { return renderTestAnswer(found, override); });
}

function showTesterModal(prefill, back) {
	prefill = prefill || {};
	testerBack = back || null;
	testerTouched = !!prefill.destination;

	let grid = E('div', { class: 'mwan4-modal-grid mwan4-tester' }, [
		E('div', { class: 'mwan4-modal-title' }, [
			E('strong', [ _('Where does this traffic go?') ]),
			E('span', [ back ? _('Uses your saved rules and your unsaved changes to this rule, with the current link status.')
				: _('Uses your saved rules and the current link status. Nothing is changed.') ])
		]),
		withError(modalInput(_('Site or address'), 'destination', prefill.destination, { placeholder: 'youtube.com', autocomplete: 'off', 'data-autofocus': '1' },
			_('A site name such as youtube.com, or an IP address.')), 'destination'),
		E('div', { class: 'mwan4-modal-columns' }, [
			knownDevices.length ? modalSelect(_('Known device'), 'device_pick',
				knownDevices.map(function(device) { return [ device.mac || device.ip, deviceLabel(device) ]; }), '', _('Any device'), _('Pick one, or type an address.')) : null,
			withError(modalInput(_('Device address'), 'source', prefill.source, { placeholder: _('Any device') }, _('Optional. An IP address or a MAC address.')), 'source')
		]),
		E('div', { class: 'mwan4-modal-columns' }, [
			modalSelect(_('Protocol'), 'proto', protocolChoices(), prefill.proto || 'all', null),
			withError(modalInput(_('Port'), 'port', prefill.port, { placeholder: _('443') }, _('Optional. Matters only for rules that name a port.')), 'port')
		]),
		E('div', { id: 'mwan4-test-result', class: 'mwan4-test-result', 'aria-live': 'polite' })
	]);

	showMwan4Modal(_('Test traffic'), [
		grid,
		E('div', { class: 'right mwan4-modal-actions' }, [
			back ? E('button', { class: 'btn cbi-button cbi-button-action', click: function() { return renderRuleEditor(Object.assign({}, back.state, { base: back.draft })); } }, [ _('Back to the rule') ]) : null,
			E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Close') ])
		])
	]);

	grid.addEventListener('input', function() { testerTouched = true; refreshTester(); });
	grid.addEventListener('change', function(ev) {
		if (ev.target.name == 'device_pick' && ev.target.value) {
			grid.querySelector('[name="source"]').value = ev.target.value;
			ev.target.value = '';
		}

		testerTouched = true;
		refreshTester();
	});
	modalRefresh = refreshTester;
	refreshTester();
}

function showDefaultRoutingChoice() {
	showRoutingModal(currentRoutingMode());
}

function pathText(name) {
	return mwan4Explain.pathSummary(name, strategies(), uci.sections('mwan4', 'route')).text;
}

function strategyLimits(section) {
	let limits = [ section.max_latency ? _('latency %s ms').format(section.max_latency) : null, section.max_loss ? _('loss %s%%').format(section.max_loss) : null ].filter(Boolean);

	return limits.length ? limits.join(', ') : _('no limits');
}

function strategyQualityGaps(name) {
	let interfaces = asArray(uci.get('mwan4', name, 'use_route')).map(function(route) { return uci.get('mwan4', route, 'interface'); });

	return mwanInterfaces().filter(function(section) {
		return section.check_quality != '1' && interfaces.some(function(value) { return asArray(value).includes(section['.name']); });
	}).map(function(section) { return section['.name']; });
}

function buildStrategyChange(name) {
	let modal = document.querySelector('.modal');
	let draft = { max_latency: modalValue(modal, 'max_latency'), max_loss: modalValue(modal, 'max_loss') };

	return {
		summary: _('This will update the quality limits of this path before they are written to mwan4.'),
		items:   [
			[ _('Path'), pathText(name) ],
			[ _('Limits'), strategyLimits(draft) ]
		],
		apply:   function() {
			Object.keys(draft).forEach(function(option) { uci.set('mwan4', name, option, draft[option] || null); });
		}
	};
}

function showStrategyModal(name) {
	let section = uci.get('mwan4', name) || {};
	let gaps = strategyQualityGaps(name);

	showMwan4Modal(_('Quality limits: %s').format(pathText(name)), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('strong', [ name ]),
				E('span', [ _('A WAN link above a limit is skipped by this path only; it stays online elsewhere. If every link exceeds the limits, the least bad one is kept.') ])
			]),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalInput(_('Maximum latency (ms)'), 'max_latency', section.max_latency, { type: 'number', min: '1', placeholder: _('no limit') }),
				modalInput(_('Maximum packet loss (%)'), 'max_loss', section.max_loss, { type: 'number', min: '0', max: '100', placeholder: _('no limit') })
			]),
			E('small', { class: 'mwan4-modal-help' }, [ mwan4Stability.qualityNote() ]),
			gaps.length ? E('small', { class: 'mwan4-modal-warning', role: 'status' }, [ _('No latency/loss data from: %s').format(gaps.join(', ')) ]) : null,
			pendingPreviewSlot()
		]),
		previewModalActions(function() { return buildStrategyChange(name); })
	]);
}

function getGlobalSection() {
	return uci.get('mwan4', 'globals') || {};
}

function ensureGlobalSection() {
	ensureSection('globals', 'globals');
	return getGlobalSection();
}

function globalValue(section, dotted, plain, fallback) {
	return section[dotted] || section[plain] || fallback;
}

function globalDraftFromModal() {
	let modal = document.querySelector('.modal');

	return {
		mmx_mask:        modalValue(modal, 'mmx_mask') || '0x3F00',
		source_routing:  modalValue(modal, 'source_routing'),
		rt_table_lookup: splitTokens(modalValue(modal, 'rt_table_lookup')),
		logging:         modalValue(modal, 'logging'),
		loglevel:        modalValue(modal, 'loglevel') || 'notice',
		stability:       stabilityEnabled() ? stabilityDraft(modal) : null
	};
}

function writeGlobalDraft(draft) {
	ensureGlobalSection();
	uci.set('mwan4', 'globals', 'mmx_mask', draft.mmx_mask);
	uci.set('mwan4', 'globals', 'source_routing', draft.source_routing);
	setList('mwan4', 'globals', 'rt_table_lookup', draft.rt_table_lookup);
	uci.set('mwan4', 'globals', 'logging', draft.logging);
	uci.set('mwan4', 'globals', 'loglevel', draft.loglevel);

	if (draft.stability)
		writeStability('globals', draft.stability);
}

function buildGlobalChange() {
	let draft = globalDraftFromModal();

	return {
		summary: _('This will update global firewall and routing behavior before it is written to mwan4.'),
		items:   [
			[ _('Firewall mark mask'), draft.mmx_mask ],
			[ _('Source routing'), draft.source_routing == '1' ? _('Enabled') : _('Disabled') ],
			[ _('Additional tables'), draft.rt_table_lookup.length ? draft.rt_table_lookup.join(', ') : _('Default tables') ],
			[ _('Logging'), draft.logging == '1' ? draft.loglevel : _('Off') ],
			draft.stability ? [ _('Stability defaults'), mwan4Stability.summary(draft.stability) ] : null
		].filter(Boolean),
		apply:   function() {
			return writeGlobalDraft(draft);
		}
	};
}

function showGlobalsModal() {
	let section = getGlobalSection();

	showMwan4Modal(_('Global settings'), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('strong', [ _('Firewall and routing behavior') ]),
				E('span', [ _('These settings affect every strategy, path, generated default, and routing rule.') ])
			]),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalInput(_('Firewall mark mask'), 'mmx_mask', globalValue(section, 'mwan4.mmx_mask', 'mmx_mask', '0x3F00'), { placeholder: '0x3F00' }),
				modalSelect(_('Log level'), 'loglevel', [ 'debug', 'info', 'notice', 'warning', 'err' ], section.loglevel || 'notice', null)
			]),
			modalInput(_('Additional routing tables'), 'rt_table_lookup', asArray(section.rt_table_lookup).join(' '), { placeholder: _('100 200 vpn') }),
			E('div', { class: 'mwan4-modal-columns' }, [
				modalCheck(_('Enable source routing'), 'source_routing', globalValue(section, 'mwan4.source_routing', 'source_routing', '0') == '1'),
				modalCheck(_('Log matching rules'), 'logging', section.logging == '1')
			]),
			stabilityEnabled() ? stabilitySection(_('Link stability defaults'), _('Defaults for every WAN link; a WAN link can override each value.'), section, {}, _('Empty uses the built-in default.')) : null,
			pendingPreviewSlot()
		]),
		previewModalActions(buildGlobalChange)
	]);
}

function primaryActionButton(action) {
	return E('button', { class: 'btn cbi-button %s mwan4-primary-action'.format(action.button), 'aria-busy': 'false', click: action.click }, [ action.label ]);
}

function commandActions() {
	return {
		addLink:       function() { return showInterfaceModal(null); },
		addRule:       function() { return showRuleModal(null); },
		chooseRouting: showDefaultRoutingChoice,
		refresh:       function(ev) { return withButtonBusy(eventButton(ev), reloadOverview); },
		restart:       function(ev) { return runMwan4([ 'restart' ], eventButton(ev)); },
		reviewLinks:   function() { return scrollToSection('mwan4-wan-workspace'); }
	};
}

function commandCenterState(status, progress) {
	let state = mwan4Summary.commandState(progress, liveInterfaceCounts(status), runtimeWarnings(status).length, hasOperatorAccess);

	return Object.assign({}, state, { action: Object.assign({}, state.action, { click: commandActions()[state.action.id] }) });
}

function renderCommandMetric(label, value, body) {
	return E('div', { class: 'mwan4-command-metric' }, [
		E('span', [ label ]),
		E('strong', [ value ]),
		E('small', [ body ])
	]);
}

function renderConnectionsMetric() {
	if (!connectionsEnabled())
		return null;

	return E('button', { class: 'mwan4-command-metric mwan4-conn-metric', 'aria-label': _('View all active connections'), click: function() { return showConnectionsModal({}); } }, [
		E('span', [ _('Active connections') ]),
		E('strong', [ String(live.total) ]),
		E('small', [ _('Open the live connection list') ])
	]);
}

function commandNotices(status) {
	let notices = [
		mwan4Common.renderRuntimeWarnings(status, { diagnosticsAccess: hasDiagnosticsAccess, link: false }),
		mwan4Common.renderAclNotice(hasOperatorAccess, _('Service start, stop, restart, and per-WAN-link controls are hidden because this session lacks the mwan4 operator ACL.'))
	].filter(function(node) { return node.childNodes.length; });

	return notices.length ? E('div', { class: 'mwan4-command-notices' }, notices) : null;
}

function renderCommandCenter(status, progress) {
	let state = commandCenterState(status, progress);
	let counts = liveInterfaceCounts(status);
	let configured = mwan4Explain.groupLinks(mwanInterfaces().map(function(section) { return section['.name']; })).length;
	let linkValue = counts.total ? _('%d/%d online').format(counts.online, counts.total) : _('%d configured').format(configured);

	return E('section', { id: 'mwan4-command-center', class: 'mwan4-command-center is-%s'.format(state.tone), role: 'region', 'aria-labelledby': 'mwan4-command-title', 'aria-live': 'polite', 'aria-busy': 'false' }, [
		E('div', { class: 'mwan4-command-main' }, [
			E('div', { class: 'mwan4-command-copy' }, [
				E('div', { class: 'mwan4-command-title' }, [
					E('h2', { id: 'mwan4-command-title' }, [ _('MultiWAN 4') ]),
					renderPill(state.label, state.pill)
				]),
				E('p', [ state.summary ])
			]),
			E('div', { class: 'mwan4-next-action' }, [ primaryActionButton(state.action) ])
		]),
		E('div', { class: 'mwan4-state-grid mwan4-compact-metrics%s'.format(connectionsEnabled() ? ' has-connections' : '') }, [
			renderCommandMetric(_('WAN links'), linkValue, _('%d enabled').format(mwan4Explain.groupLinks(configuredEnabledInterfaceNames()).length)),
			renderCommandMetric(_('Active rules'), String(progress.activeRuleCount), _('%d disabled').format(progress.userRuleCount - progress.activeRuleCount)),
			renderConnectionsMetric()
		]),
		E('div', { class: 'mwan4-command-footer' }, [
			commandNotices(status),
			renderServiceActions(),
			E('div', { class: 'mwan4-actions' }, [
				E('button', { class: 'btn cbi-button cbi-button-neutral', click: function() { return showTesterModal(); } }, [ _('Test traffic') ]),
				E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Configure global MultiWAN settings'), click: showGlobalsModal }, [ _('Global settings') ]),
				E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-busy': 'false', click: commandActions().refresh }, [ _('Refresh') ]),
				hasDiagnosticsAccess ? E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Diagnostics') ]) : null
			])
		])
	]);
}

function renderSetupStep(done, current, title, body) {
	let cls = 'mwan4-setup-step';

	if (done)
		cls += ' is-done';
	else if (current)
		cls += ' is-current';
	else
		cls += ' is-disabled';

	return E('li', { class: cls }, [
		E('strong', [ title ]),
		E('span', [ body ]),
		E('small', { class: 'mwan4-step-status' }, [ done ? _('Done') : current ? _('Next') : _('Waiting') ])
	]);
}

function renderFirstRunGuide(progress) {
	let primaryAction = !progress.hasLinks
		? E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Continue quick setup'), click: function() { return showInterfaceModal(null); } }, [ _('Continue quick setup') ])
		: !progress.hasRouting
			? E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-label': _('Continue quick setup'), click: showDefaultRoutingChoice }, [ _('Continue quick setup') ])
			: E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add routing rule'), click: function() { return showRuleModal(null); } }, [ _('Add rule') ]);

	return E('section', { class: 'mwan4-first-run', 'aria-labelledby': 'mwan4-first-run-title' }, [
		E('div', { class: 'mwan4-first-run-copy' }, [
			E('span', { class: 'mwan4-eyebrow' }, [ _('First-run setup') ]),
			E('h3', { id: 'mwan4-first-run-title' }, [ _('Set up MultiWAN in three steps') ]),
			E('strong', { class: 'mwan4-guide-next' }, [ _('Start with this guided path.') ]),
			E('p', [ _('Add your internet connections, choose how traffic leaves by default, then add rules only for traffic that needs a special WAN link.') ]),
			E('div', { class: 'mwan4-first-run-actions' }, [ primaryAction ])
		]),
		E('ol', { class: 'mwan4-setup-steps' }, [
			renderSetupStep(progress.hasLinks, !progress.hasLinks,
				_('Add a WAN link'),
				_('Pick a network interface and two addresses to test it with.')),
			renderSetupStep(progress.hasRouting, progress.hasLinks && !progress.hasRouting,
				_('Choose default routing'),
				_('Use one link first with the others as backup, or share load across all links.')),
			renderSetupStep(progress.hasRouting, false,
				_('Add routing rules only if needed'),
				_('Optional: send a site, a device or a game through a chosen WAN link.'))
		])
	]);
}

function configuredRuntimeFamilies(section, runtime) {
	let runtimeFamilies = Object.keys((runtime || {}).families || {});

	if (runtimeFamilies.length)
		return runtimeFamilies;

	let families = asArray(section.family);
	return families.length ? families : [ 'ipv4' ];
}

const LINK_CHIP = { online: 'mwan4-online', held: 'mwan4-warning', offline: 'mwan4-offline', disabled: 'mwan4-muted', unknown: 'mwan4-muted' };

function linkMembers(group, status) {
	return group.members.map(function(name) {
		return { name: name, section: uci.get('mwan4', name) || {}, runtime: (status.interfaces || {})[name] || {} };
	});
}

function familyStates(members) {
	let seen = {};

	members.forEach(function(member) {
		configuredRuntimeFamilies(member.section, member.runtime).forEach(function(family) {
			let item = (member.runtime.families || {})[family] || member.runtime;

			seen[family] = seen[family] || { family: family, up: item.up, state: item.health_state || item.status || (item.up ? 'online' : 'unknown') };
		});
	});

	return Object.keys(seen).sort().map(function(family) { return seen[family]; });
}

function renderFamilyStatePills(members) {
	let states = familyStates(members);

	if (states.length < 2)
		return null;

	return E('div', { class: 'mwan4-family-pills', 'aria-label': _('Per-family health') }, states.map(function(item) {
		return renderPill('%s %s'.format(familyLabel(item.family), item.state), statusClass(item.state, item.up));
	}));
}

function wanEnabledText(members) {
	let on = members.filter(function(member) { return member.section.enabled != '0'; }).length;

	return on == members.length ? _('Enabled') : on ? _('Partly enabled') : _('Disabled');
}

function renderWanName(group, members) {
	return E('div', { class: 'mwan4-wan-name' }, [
		E('strong', [ group.label ]),
		E('small', [ wanEnabledText(members) ]),
		E('small', { class: 'mwan4-wan-raw' }, [ group.members.join(', ') ])
	]);
}

function targetRows(member) {
	let targets = asArray(member.runtime.track_ip);

	return targets.length ? targets : asArray(member.section.track_ip).map(function(ip) { return { ip: ip, status: 'configured' }; });
}

function renderTarget(target) {
	if (!target || typeof target != 'object')
		target = { ip: target, status: 'configured' };

	let state = mwan4Explain.targetState(target.status);

	return E('li', [
		E('span', { class: 'mwan4-target-ip' }, [ formatDisplayValue(target.ip, '-') ]),
		E('span', { class: 'mwan4-target-state%s'.format(state.ok === false ? ' is-bad' : '') }, [ state.text ]),
		E('span', [ target.latency != null ? _('%d ms').format(target.latency) : '-' ]),
		E('span', [ target.packetloss != null ? _('%d%% loss').format(target.packetloss) : '-' ])
	]);
}

function renderTargetList(member, titled) {
	let targets = targetRows(member);

	if (!targets.length)
		return E('span', { class: 'mwan4-muted-line' }, [ _('No targets') ]);

	return E('div', { class: 'mwan4-target-group' }, [
		titled ? E('small', { class: 'mwan4-target-family' }, [ mwan4Explain.familyName(member.name) ]) : null,
		E('ul', { class: 'mwan4-target-summary' }, targets.slice(0, 3).map(renderTarget).concat(targets.length > 3
			? [ E('li', { class: 'mwan4-muted-line' }, [ _('+%d more').format(targets.length - 3) ]) ] : []))
	]);
}

function renderTargetCell(members) {
	return E('td', { class: 'mwan4-targets-cell' }, members.map(function(member) { return renderTargetList(member, members.length > 1); }).concat([
		members.some(function(member) { return mwan4Stability.singleTarget(asArray(member.section.track_ip)); })
			? E('small', { class: 'mwan4-single-target-warning' }, [ _('Single health check target: add a second one.') ]) : null
	]));
}

function renderStateChips(members, state) {
	let held = stabilityEnabled() ? members.map(function(member) { return mwan4Stability.heldInfo(member.runtime); }).find(Boolean) : null;
	let degraded = stabilityEnabled() ? members.flatMap(function(member) { return mwan4Stability.degradedStrategies(member.runtime); }) : [];

	return E('div', { class: 'mwan4-state-chips' }, [
		held && state.state == 'held' ? null : renderPill(state.text, state.cls),
		held ? mwan4Stability.renderHeldChip(held) : null,
		stabilityEnabled() ? mwan4Stability.renderDegradedChip(degraded.filter(function(name, index) { return degraded.indexOf(name) == index; })) : null
	]);
}

function overallState(group, members, status) {
	let state = mwan4Explain.linkState(group, status).state;
	let degraded = state == 'online' && members.some(function(member) { return member.runtime.health_state == 'degraded'; });

	return { state: state, text: degraded ? _('degraded') : mwan4Explain.stateWord(state), cls: degraded ? 'mwan4-warning' : LINK_CHIP[state] };
}

function renderWanState(group, members, status) {
	return E('td', [
		renderStateChips(members, overallState(group, members, status)),
		renderFamilyStatePills(members),
		E('small', [ mwan4Explain.interfaceText(group, status) ])
	]);
}

function renderWanHealth(members) {
	return E('td', { class: 'mwan4-health-cell', title: mwan4Explain.healthSentence(members[0].section) }, [
		E('strong', [ mwan4Explain.healthLine(members) ]),
		E('small', [ mwan4Explain.limitsLine(members[0].section) ])
	]);
}

function renderFlapsCell(runtime) {
	let flaps = mwan4Stability.flapInfo(runtime);

	return E('td', { class: 'mwan4-flaps-cell' }, flaps
		? [ E('strong', [ String(flaps.recent) ]), E('small', [ flaps.window == null ? _('%d total').format(flaps.total) : _('last %s, %d total').format(mwan4Stability.formatSpan(flaps.window), flaps.total) ]) ]
		: [ E('span', { class: 'mwan4-muted-line' }, [ '-' ]) ]);
}

function renderAvailabilityCell(runtime) {
	let availability = mwan4Stability.availabilityInfo(runtime);
	let spans = availability ? mwan4Stability.availabilitySpans(availability) : null;
	let daily = availability && availability.h24 != null;

	return E('td', { class: 'mwan4-availability-cell', title: availability ? mwan4Stability.availabilityText(availability) : null }, availability
		? [ E('strong', [ mwan4Stability.formatPct(daily ? availability.h24 : availability.h1) ]), E('small', [ daily ? spans.h24 : spans.h1 ]) ]
		: [ E('span', { class: 'mwan4-muted-line' }, [ '-' ]) ]);
}

function stabilityRuntime(members) {
	return (members.find(function(member) { return mwan4Stability.flapInfo(member.runtime) || mwan4Stability.availabilityInfo(member.runtime); }) || members[0]).runtime;
}

function renderConnectionCell(group, status) {
	let button = function(name) {
		return mwan4Connections.renderCountButton(_('View active connections of WAN link %s').format(name), mwan4Connections.interfaceActive(name, status), { interface: name }, showConnectionsModal);
	};

	return E('td', group.members.length > 1
		? group.members.map(function(name) { return E('div', { class: 'mwan4-conn-family' }, [ E('small', [ mwan4Explain.familyName(name) ]), button(name) ]); })
		: [ button(group.members[0]) ]);
}

function runMwan4Each(action, names, button) {
	return withButtonBusy(button, function() {
		return names.reduce(function(chain, name) { return chain.then(function() { return runMwan4([ action, name ]); }); }, Promise.resolve());
	});
}

function wanButton(cls, label, aria, click) {
	return E('button', { class: 'btn cbi-button %s mwan4-compact-button'.format(cls), 'aria-label': aria, 'aria-busy': 'false', click: click }, [ label ]);
}

function renderWanActions(group) {
	let pair = group.members.length > 1;
	let actions = group.members.map(function(name) {
		return wanButton('cbi-button-edit', pair ? _('Edit %s').format(mwan4Explain.familyName(name)) : _('Edit'), _('Edit WAN link %s').format(name), function() { return showInterfaceModal(name); });
	});

	if (hasOperatorAccess)
		actions.push(
			wanButton('cbi-button-action', _('Up'), _('Bring WAN link %s up').format(group.label), function(ev) { return runMwan4Each('ifup', group.members, eventButton(ev)); }),
			wanButton('cbi-button-reset', _('Down'), _('Take WAN link %s down').format(group.label), function(ev) { return runMwan4Each('ifdown', group.members, eventButton(ev)); })
		);

	if (live.history)
		actions.push(wanButton('cbi-button-neutral', _('History'), _('Show link history of WAN link %s').format(group.label), function() { return showHistoryModal(group); }));

	return E('div', { class: 'mwan4-actions mwan4-wan-actions' }, actions);
}

function renderWanRow(group, status) {
	let members = linkMembers(group, status);

	return E('tr', { class: 'mwan4-wan-row', 'data-interface': group.members[0], 'data-members': group.members.join(' ') }, [
		E('td', [ renderWanName(group, members) ]),
		renderWanState(group, members, status),
		renderWanHealth(members),
		stabilityEnabled() ? renderFlapsCell(stabilityRuntime(members)) : null,
		stabilityEnabled() ? renderAvailabilityCell(stabilityRuntime(members)) : null,
		renderTargetCell(members),
		connectionsEnabled() ? renderConnectionCell(group, status) : null,
		E('td', [ renderWanActions(group) ])
	]);
}

function renderWanWorkspace(status, counters) {
	let groups = mwan4Explain.groupLinks(mwanInterfaces().map(function(section) { return section['.name']; }));

	if (!groups.length)
		return E('div', { class: 'mwan4-wan-workspace-body' }, [
			renderEmptyState(
				_('No WAN links configured.'),
				_('Add each internet connection once, then mwan4 tests it and moves traffic away when it fails.'),
				[ E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add WAN link'), click: function() { return showInterfaceModal(null); } }, [ _('Add WAN link') ]) ]
			)
		]);

	return E('div', { class: 'mwan4-wan-workspace-body' }, [
		E('div', { class: 'mwan4-workspace-toolbar' }, [
			E('span', { class: 'mwan4-muted-line' }, [ _('Your internet connections and how they pass their health checks. IPv4 and IPv6 of one link are shown together.') ]),
			E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add WAN link'), click: function() { return showInterfaceModal(null); } }, [ _('Add WAN link') ])
		]),
		E('div', { class: 'mwan4-wan-table-wrap' }, [
			E('table', { class: 'table mwan4-wan-table' }, [
				E('tr', [
					E('th', [ _('WAN link') ]),
					E('th', [ _('State') ]),
					E('th', [ _('Health') ]),
					stabilityEnabled() ? E('th', { title: _('Online to offline transitions in the recent window, and in all recorded history') }, [ _('Flaps') ]) : null,
					stabilityEnabled() ? E('th', { title: _('Share of recorded time the link was online. Shows the span actually recorded while it is shorter than 24 hours.') }, [ _('Availability') ]) : null,
					E('th', [ _('Check targets') ]),
					connectionsEnabled() ? E('th', [ _('Active connections') ]) : null,
					E('th', [ _('Actions') ])
				])
			].concat(groups.map(function(group) { return renderWanRow(group, status || {}); })))
		]),
		renderCounterStrip(counters)
	]);
}

function summarizeCounters(result) {
	let counters = (result || {}).counters || {};
	let names = Object.keys(counters);
	let summary = { total: names.length, packets: 0, bytes: 0, rules: 0, strategies: 0, interfaces: 0 };

	names.forEach(function(name) {
		let counter = counters[name] || {};
		summary.packets += Number(counter.packets || 0);
		summary.bytes += Number(counter.bytes || 0);

		if (name.indexOf('_counter_rule_') > -1)
			summary.rules++;
		else if (name.indexOf('_counter_strategy_') > -1)
			summary.strategies++;
		else if (name.indexOf('_counter_iface_') > -1)
			summary.interfaces++;
	});

	return summary;
}

function renderCounterStrip(counters) {
	let summary = summarizeCounters(counters);

	if (!summary.total)
		return E('div', { class: 'mwan4-counter-strip', hidden: 'hidden', 'aria-hidden': 'true' });

	return E('div', { class: 'mwan4-counter-strip', role: 'region', 'aria-label': _('Policy counter summary') }, [
		renderCommandMetric(_('Matched packets'), String(summary.packets), _('%d counter(s)').format(summary.total)),
		renderCommandMetric(_('Rule counters'), String(summary.rules), _('Raw counters are in Diagnostics')),
		renderCommandMetric(_('Path counters'), String(summary.strategies + summary.interfaces), _('%d bytes matched').format(summary.bytes))
	]);
}

function linkChip(group, status) {
	let state = mwan4Explain.linkState(group, status);

	return E('span', { class: 'mwan4-chip mwan4-chip-wan %s'.format(LINK_CHIP[state.state]), 'data-wan': group.key, title: '%s: %s'.format(group.label, state.text) }, [
		group.label,
		E('span', { class: 'mwan4-sr-only' }, [ ': ' + state.text ])
	]);
}

function pathChips(path, status) {
	let nodes = [];

	path.tiers.forEach(function(tier, index) {
		if (index)
			nodes.push(E('span', { class: 'mwan4-via-sep', 'aria-hidden': 'true' }, [ '→' ]));

		tier.forEach(function(group, position) {
			if (position)
				nodes.push(E('span', { class: 'mwan4-via-sep', 'aria-hidden': 'true' }, [ '+' ]));

			nodes.push(linkChip(group, status));
		});
	});

	return nodes;
}

function renderGoesThrough(path, status) {
	return [
		path.links.length ? E('div', { class: 'mwan4-chips mwan4-via' }, pathChips(path, status)) : E('strong', [ path.text ]),
		E('small', { class: 'mwan4-now-via' }, [ mwan4Explain.nowVia(path, status).text ]),
		path.kind == 'only' && path.failure == 'stops' ? E('small', { class: 'mwan4-stops-note' }, [ _('Stops if unavailable') ]) : null
	];
}

function renderRuleConnections(name, label) {
	return mwan4Connections.renderRuleButton(name, label, mwan4Connections.ruleStats(name, live.status, live.counters), showConnectionsModal);
}

function renderDefaultRuleConnections(name) {
	return mwan4Connections.renderRuleSummary(mwan4Connections.ruleStats(name, live.status, live.counters));
}

function renderHits(counters, name) {
	let hits = mwan4Rules.ruleHits((counters || {}).counters, name);

	if (!hits.found)
		return [ E('span', { class: 'mwan4-muted-line' }, [ '-' ]) ];

	return [ E('strong', { title: _('%d bytes').format(hits.bytes) }, [ String(hits.packets) ]), E('small', [ formatBytes(hits.bytes) ]) ];
}

function activityLine(label, key, nodes) {
	return E('div', { class: 'mwan4-activity-line' }, [
		E('span', { class: 'mwan4-activity-label' }, [ label ]),
		E('div', { class: 'mwan4-activity-value', 'data-activity': key }, nodes)
	]);
}

function renderActivity(name, counters, connections) {
	return tableCell(_('Activity'), [
		activityLine(_('Hits'), 'hits', renderHits(counters, name)),
		connectionsEnabled() ? activityLine(_('Connections'), 'connections', [ connections ]) : null
	]);
}

function ruleWarnings(status, name) {
	return runtimeWarnings(status).filter(function(warning) { return warning && warning.rule == name; }).map(function(warning) {
		return E('small', { class: 'mwan4-rule-warning' }, [ formatDisplayValue(warning.message || warning.code, _('Runtime warning')) ]);
	});
}

function ruleBadge(entry) {
	let found = mwan4Rulesui.attention(entry.issues);
	let text = found.map(function(issue) { return issue.message; }).join(' ');

	if (!found.length)
		return null;

	return E('button', {
		class:        'mwan4-rule-badge is-%s'.format(found.some(function(issue) { return issue.severity == 'error'; }) ? 'error' : 'warning'),
		type:         'button',
		title:        text,
		'aria-label': _('Needs attention: %s').format(text),
		click:        function() { return showRuleModal(entry.draft.name); }
	}, [ _('Needs attention') ]);
}

function dropAfter(ev) {
	let box = ev.currentTarget.getBoundingClientRect();

	return ev.clientY > box.top + box.height / 2;
}

function markDropTarget(row, after) {
	row.classList.toggle('is-drop-before', after === false);
	row.classList.toggle('is-drop-after', after === true);
}

function moveRule(name, target, after) {
	if (name == target)
		return Promise.resolve();

	return commitPendingChange({ apply: function() {
		uci.move('mwan4', name, target, after);
		keepDefaultsLast();
	} });
}

function moveRuleStep(name, step) {
	let movable = trafficRules();
	let target = movable[movable.findIndex(function(rule) { return rule['.name'] == name; }) + step];

	return target ? moveRule(name, target['.name'], step > 0) : Promise.resolve();
}

function toggleRule(name, enabled) {
	return commitPendingChange({ apply: function() { uci.set('mwan4', name, 'enabled', enabled ? '1' : '0'); } });
}

function ruleDragHandlers(name) {
	return {
		dragstart: function(ev) {
			dragRule = name;
			ev.dataTransfer.setData('text/plain', name);
			ev.dataTransfer.effectAllowed = 'move';
		},
		dragover:  function(ev) {
			if (dragRule && dragRule != name) {
				ev.preventDefault();
				markDropTarget(ev.currentTarget, dropAfter(ev));
			}
		},
		dragleave: function(ev) { markDropTarget(ev.currentTarget, null); },
		dragend:   function() { dragRule = null; },
		drop:      function(ev) {
			let moved = dragRule;
			let after = dropAfter(ev);

			ev.preventDefault();
			dragRule = null;
			markDropTarget(ev.currentTarget, null);

			return moved ? moveRule(moved, name, after) : null;
		}
	};
}

function moveButton(name, label, step, disabled) {
	return E('button', {
		class:        'btn cbi-button cbi-button-neutral mwan4-compact-button mwan4-move',
		'aria-label': step < 0 ? _('Move routing rule %s up').format(label) : _('Move routing rule %s down').format(label),
		title:        mwan4Rulesui.isFiltered(ruleView) ? _('Clear the search and filter to reorder rules') : null,
		disabled:     disabled || mwan4Rulesui.isFiltered(ruleView) ? 'disabled' : null,
		click:        function() { return moveRuleStep(name, step); }
	}, [ step < 0 ? '^' : 'v' ]);
}

function renderRuleRow(entry, total, status, counters) {
	let draft = entry.draft;
	let name = draft.name;
	let reorder = !mwan4Rulesui.isFiltered(ruleView);
	let attrs = Object.assign({
		class:        'mwan4-row mwan4-rule-row%s'.format(draft.enabled == '0' ? ' is-disabled' : ''),
		role:         'row',
		draggable:    reorder ? 'true' : null,
		'data-rule':  name
	}, reorder ? ruleDragHandlers(name) : {});

	return E('div', attrs, [
		tableCell(_('Order'), [
			E('span', { class: 'mwan4-drag-handle', 'aria-hidden': 'true', title: reorder ? _('Drag to reorder') : _('Clear the search and filter to reorder rules') }, [ '::' ]),
			E('span', { class: 'mwan4-rule-index' }, [ String(entry.index + 1) ]),
			moveButton(name, draft.label, -1, entry.index == 0),
			moveButton(name, draft.label, 1, entry.index == total - 1)
		], { class: 'mwan4-rule-order' }),
		tableCell(_('On'), [
			E('input', { type: 'checkbox', class: 'mwan4-rule-toggle', checked: draft.enabled == '1' ? 'checked' : null, 'aria-label': _('Enable routing rule %s').format(draft.label),
				change: function(ev) { return toggleRule(name, ev.currentTarget.checked); } })
		]),
		tableCell(_('Rule'), [ E('div', { class: 'mwan4-rule-title' }, [ E('strong', [ draft.label ]), ruleBadge(entry) ]),
			E('small', { class: 'mwan4-rule-sentence' }, [ entry.sentence ]) ].concat(ruleWarnings(status, name))),
		tableCell(_('Goes through'), renderGoesThrough(entry.path, status)),
		renderActivity(name, counters, renderRuleConnections(name, draft.label)),
		tableCell(_('Actions'), [
			E('button', { class: 'btn cbi-button cbi-button-edit', 'aria-label': _('Edit routing rule %s').format(draft.label), click: function() { return showRuleModal(name); } }, [ _('Edit') ]),
			E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Duplicate routing rule %s').format(draft.label), click: function() { return duplicateRule(name); } }, [ _('Duplicate') ])
		], { class: 'mwan4-actions' })
	]);
}

function qualityButton(strategy) {
	let section = uci.get('mwan4', strategy) || {};

	return E('button', {
		class:        'btn cbi-button cbi-button-neutral mwan4-compact-button',
		title:        strategyLimits(section),
		'aria-label': _('Edit quality limits of %s').format(pathText(strategy)),
		click:        function() { return showStrategyModal(strategy); }
	}, [ _('Quality limits') ]);
}

function renderDefaultRuleRow(rule, status, counters) {
	let name = rule['.name'];
	let ctx = ruleContext(status);

	return E('div', { class: 'mwan4-row mwan4-rule-row is-default', role: 'row', 'data-rule': name }, [
		tableCell(_('Order'), [ E('span', { class: 'mwan4-rule-index', title: _('Default routing always stays last') }, [ '=' ]) ], { class: 'mwan4-rule-order' }),
		tableCell(_('On'), []),
		tableCell(_('Rule'), [ E('strong', [ _('Everything else') ]), E('small', { class: 'mwan4-rule-sentence' }, [
			_('Traffic that no rule above matches (%s)').format(familyLabel(defaultRuleFamily(rule))) ]) ]),
		tableCell(_('Goes through'), renderGoesThrough(mwan4Explain.pathSummary(rule.use_strategy || 'default', ctx.strategies, ctx.routes), status)),
		renderActivity(name, counters, renderDefaultRuleConnections(name)),
		tableCell(_('Actions'), stabilityEnabled() ? [ qualityButton(rule.use_strategy) ] : [], { class: 'mwan4-actions' })
	]);
}

function trafficRules() {
	return rules().filter(function(rule) { return !isGeneratedDefaultRule(rule); });
}

function ruleEntries(status) {
	let ctx = ruleContext(status);
	let drafts = ruleDrafts();

	return drafts.filter(function(draft) { return !isDefaultDraft(draft); }).map(function(draft, index) {
		let sentence = mwan4Rulesui.listSentence(draft, ctx);

		return {
			draft:    draft,
			index:    index,
			sentence: sentence,
			issues:   mwan4Rulesui.issues(draft, ruleCheckContext(draft.name, ctx, drafts)),
			path:     mwan4Explain.pathSummary(draft.via, ctx.strategies, ctx.routes),
			text:     mwan4Rulesui.searchText(draft, sentence, knownDevices)
		};
	});
}

function ruleCountText(shown, total) {
	return _('%d of %d rules').format(shown, total);
}

function syncRulesCount() {
	let node = byId('mwan4-rules-count');
	let text = ruleCountText(ruleCount.shown, ruleCount.total);

	if (node && node.textContent != text)
		node.textContent = text;
}

function clearRuleView() {
	ruleView = { query: '', filter: 'all' };
	document.querySelectorAll('.mwan4-rules-toolbar [name="rule_search"], .mwan4-rules-toolbar [name="rule_filter"]').forEach(function(node) {
		node.value = node.name == 'rule_search' ? '' : 'all';
	});
	refreshRules();
}

function renderRules(status, counters) {
	let entries = ruleEntries(status);
	let shown = entries.filter(function(entry) { return mwan4Rulesui.visible(entry, ruleView); });
	let nodes = [ tableHeader([ _('Order'), _('On'), _('Rule'), _('Goes through'), _('Activity'), _('Actions') ], 'mwan4-rule-head') ];

	ruleCount = { shown: shown.length, total: entries.length };

	if (!entries.length)
		nodes.unshift(renderEmptyState(
			_('No routing rules yet.'),
			_('All traffic follows the default routing below. Add a rule to send a site, a device, or a whole network through specific WAN links.'),
			[ E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add routing rule'), click: function() { return showRuleModal(null); } }, [ _('Add rule') ]) ]
		));
	else if (!shown.length)
		nodes.unshift(renderEmptyState(
			_('No routing rule matches.'),
			_('Change the search or the filter to see more rules.'),
			[ E('button', { class: 'btn cbi-button cbi-button-neutral', click: clearRuleView }, [ _('Clear search and filter') ]) ]
		));

	shown.forEach(function(entry) { nodes.push(renderRuleRow(entry, entries.length, status, counters)); });
	rules().filter(isGeneratedDefaultRule).forEach(function(rule) { nodes.push(renderDefaultRuleRow(rule, status, counters)); });

	return E('div', { class: 'mwan4-table mwan4-rules%s'.format(connectionsEnabled() ? ' has-connections' : ''), role: 'table', 'aria-label': _('Routing rules') }, nodes);
}

function refreshRules() {
	let body = byId('mwan4-rules-body');

	if (body)
		body.replaceChildren(renderRules(live.status, live.counters));

	syncRulesCount();
}

function ruleFilterChoices() {
	return [ [ 'all', _('All') ], [ 'active', _('Active') ], [ 'disabled', _('Disabled') ], [ 'attention', _('Needs attention') ] ];
}

function renderRulesToolbar() {
	let onChange = function(key) { return function(ev) { ruleView[key] = ev.currentTarget.value; refreshRules(); }; };

	return E('div', { class: 'mwan4-rules-toolbar', role: 'search' }, [
		E('label', { class: 'mwan4-rules-search' }, [
			E('span', { class: 'mwan4-sr-only' }, [ _('Search routing rules') ]),
			E('input', { type: 'search', name: 'rule_search', value: ruleView.query, placeholder: _('Search rules, sites or devices'), input: onChange('query') })
		]),
		E('label', { class: 'mwan4-rules-filter' }, [
			E('span', [ _('Show') ]),
			E('select', { name: 'rule_filter', change: onChange('filter') }, optionList(ruleFilterChoices(), ruleView.filter))
		]),
		E('span', { id: 'mwan4-rules-count', class: 'mwan4-muted-line', 'aria-live': 'polite' }),
		E('div', { class: 'mwan4-actions mwan4-rules-actions' }, [
			E('button', { class: 'btn cbi-button cbi-button-neutral', click: showDefaultRoutingChoice }, [ _('Change default routing') ]),
			canImportPbr() ? E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Import routing rules from PBR'), 'aria-busy': 'false', click: function(ev) { return openPbrImport(eventButton(ev)); } }, [ _('Import from PBR') ]) : null,
			E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add routing rule'), click: function() { return showRuleModal(null); } }, [ _('Add rule') ])
		])
	]);
}

function renderRulesPanel(status, counters) {
	let panel = E('section', { class: 'mwan4-panel', 'aria-labelledby': 'mwan4-rules-title' }, [
		E('div', { class: 'mwan4-panel-heading' }, [
			E('div', [ E('span', { class: 'mwan4-eyebrow' }, [ _('Evaluated top to bottom') ]), E('h3', { id: 'mwan4-rules-title' }, [ _('Routing rules') ]) ])
		]),
		renderRulesToolbar(),
		E('div', { id: 'mwan4-rules-body' }, [ renderRules(status, counters) ])
	]);

	panel.querySelector('#mwan4-rules-count').textContent = ruleCountText(ruleCount.shown, ruleCount.total);

	return panel;
}

function pbrPolicies(preview) {
	return asArray((preview || {}).policies);
}

function canImportPbr() {
	return hasConfigWrite && pbrPolicies(pbrPreview).length > 0;
}

function renderImportResult(policy) {
	let skipped = policy.action == 'skip';
	let exists = !skipped && !!uci.get('mwan4', policy.rule);

	return [
		renderPill(skipped ? _('Skipped') : exists ? _('Update') : _('Import'), skipped ? 'mwan4-warning' : 'mwan4-online'),
		skipped && policy.reason ? E('small', [ formatDisplayValue(policy.reason) ]) : ''
	];
}

function renderImportRow(policy) {
	return E('tr', { 'data-pbr-section': policy.pbr_section || policy.name }, [
		E('td', [ E('strong', [ formatDisplayValue(policy.name, policy.pbr_section) ]), E('small', [ formatDisplayValue(policy.summary, '') ]) ]),
		E('td', renderImportResult(policy)),
		E('td', [ formatDisplayValue(policy.rule, '-') ]),
		E('td', [ formatDisplayValue(policy.strategy || policy.target, '-') ])
	]);
}

function renderImportList(title, items) {
	return asArray(items).length ? E('p', { class: 'mwan4-import-created' }, [ E('strong', [ title ]), ' ', asArray(items).map(function(item) { return formatDisplayValue(item); }).join(', ') ]) : '';
}

function renderImportWarnings(warnings) {
	if (!asArray(warnings).length)
		return '';

	return E('div', { class: 'mwan4-alert mwan4-alert-warning mwan4-import-warnings', role: 'alert' }, [
		E('strong', [ _('Not everything can be imported') ]),
		E('ul', asArray(warnings).map(function(warning) { return E('li', [ formatDisplayValue(warning) ]); }))
	]);
}

function showPbrImportModal(preview) {
	let policies = pbrPolicies(preview);
	let importable = policies.filter(function(policy) { return policy.action != 'skip'; });

	showMwan4Modal(_('Import routing rules from PBR'), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('strong', [ _('Dry-run preview') ]),
				E('span', [ _('Nothing is written until you confirm. PBR itself is not changed or stopped; rules keep the PBR order and go before the default routing.') ])
			]),
			E('table', { class: 'table mwan4-import-table' }, [
				E('tr', [ E('th', [ _('PBR policy') ]), E('th', [ _('Result') ]), E('th', [ _('Rule') ]), E('th', [ _('Path') ]) ])
			].concat(policies.map(renderImportRow))),
			renderImportList(_('WAN links to create:'), preview.interfaces),
			renderImportList(_('Paths to create:'), preview.strategies),
			renderImportWarnings(preview.warnings)
		]),
		E('div', { class: 'right mwan4-modal-actions' }, [
			E('button', { class: 'btn cbi-button cbi-button-neutral', click: closeModal }, [ _('Cancel') ]),
			E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-busy': 'false', disabled: importable.length ? null : 'disabled',
				click: function(ev) { return applyPbrImport(eventButton(ev)); } }, [ _('Import %d rule(s)').format(importable.length) ])
		])
	]);
}

function openPbrImport(button) {
	return withButtonBusy(button, function() { return callPbrImport(false); }).then(function(preview) {
		pbrPreview = preview || {};
		showPbrImportModal(pbrPreview);
	});
}

function applyPbrImport(button) {
	return withButtonBusy(button, function() { return callPbrImport(true); }).then(function(result) {
		let message = mwan4Common.rpcErrorMessage(result, _('PBR import failed'));

		if (message)
			throw new Error(message);

		closeModal();
		ui.addNotification(null, E('p', [ _('Imported %d PBR rule(s) into MultiWAN 4.').format(pbrPolicies(result).filter(function(policy) { return policy.action != 'skip'; }).length) ]), 'info');

		return (hasOperatorAccess ? runMwan4([ 'restart' ]) : Promise.resolve()).then(reloadOverview);
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('PBR import failed: %s').format(e.message || e) ]), 'danger');
	});
}

function renderWanPanel(status, counters) {
	return [
		E('div', { class: 'mwan4-panel-heading' }, [ E('h3', { id: 'mwan4-wan-workspace-title' }, [ _('WAN links') ]) ]),
		renderWanWorkspace(status, counters)
	];
}

function renderApp(status, counters) {
	let progress = setupProgress();
	let nodes = [
		renderCommandCenter(status, progress)
	];

	if (progress.needsGuide)
		nodes.push(renderFirstRunGuide(progress));

	nodes.push(
		E('section', { id: 'mwan4-wan-workspace', class: 'mwan4-panel mwan4-wan-workspace', 'aria-labelledby': 'mwan4-wan-workspace-title', 'aria-live': 'polite', 'aria-busy': 'false' },
			renderWanPanel(status, counters)),
		renderRulesPanel(status, counters)
	);

	return E('div', { class: 'mwan4-app' }, nodes);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('mwan4'),
			uci.load('network'),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-operator', 'write'), false),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-advanced', 'write'), false),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-diagnostics', 'read'), false),
			L.resolveDefault(callStatus('counters'), {}),
			L.resolveDefault(fs.stat('/usr/bin/httping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/nping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/arping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/nslookup'), {}),
			L.resolveDefault(callHostHints(), {}),
			L.resolveDefault(callPbrImport(false), {}),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4', 'write'), false),
			mwan4Connections.probe(),
			mwan4Stability.probe()
		]);
	},

	render: function(data) {
		let status = data[2] || {};
		hasOperatorAccess = !!data[3];
		hasDiagnosticsAccess = !!data[4];
		let counters = data[5] || {};
		probeHelpers = {
			httping:  helperAvailable(data[6]),
			nping:    helperAvailable(data[7]),
			arping:   helperAvailable(data[8]),
			nslookup: helperAvailable(data[9])
		};
		knownDevices = mwan4Rules.hostDevices(data[10]);
		pbrPreview = data[11] || {};
		hasConfigWrite = !!data[12];
		setLive(status, counters, data[13], data[14]);

		poll.add(function() {
			let commandCenter = byId('mwan4-command-center');
			let wanWorkspace = byId('mwan4-wan-workspace');

			setBusy(commandCenter, true);
			setBusy(wanWorkspace, true);

			return Promise.all([
				L.resolveDefault(callStatus(), {}),
				L.resolveDefault(callStatus('counters'), {}),
				mwan4Connections.probe()
			]).then(function(results) {
				let result = results[0] || {};
				let counterResult = results[1] || {};

				setLive(result, counterResult, results[2]);

				if (commandCenter)
					commandCenter.replaceWith(renderCommandCenter(result || {}, setupProgress()));
				if (wanWorkspace)
					wanWorkspace.replaceChildren.apply(wanWorkspace, renderWanPanel(result || {}, counterResult));
				if (!dragRule)
					refreshRules();
				refreshRuleLiveConnections();
				if (modalRefresh)
					modalRefresh();
				setBusy(byId('mwan4-wan-workspace'), false);
			});
		});

		return E('div', { id: 'mwan4-app', 'aria-busy': 'false' }, [
			renderApp(status, counters)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
