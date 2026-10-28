'use strict';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';
'require mwan4.common as mwan4Common';
'require mwan4.connections as mwan4Connections';
'require mwan4.linkhistory as mwan4LinkHistory';
'require mwan4.overview as mwan4Overview';
'require mwan4.rules as mwan4Rules';
'require mwan4.stability as mwan4Stability';

var E = mwan4Common.element;
/* global mwan4Common */
/* global mwan4Connections */
/* global mwan4LinkHistory */
/* global mwan4Overview */
/* global mwan4Rules */
/* global mwan4Stability */

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
let knownDevices = [];
let pbrPreview = {};
let hasAdvancedAccess = false;
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
	let target = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]');

	(target || modal).focus();
}

function showMwan4Modal(title, nodes) {
	modalReturnFocus = document.activeElement;
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

function renderServiceActions() {
	if (!hasOperatorAccess)
		return null;

	return E('div', { class: 'mwan4-service-controls' }, [
		E('button', { class: 'btn cbi-button cbi-button-action', 'aria-label': _('Refresh MultiWAN 4 runtime'), 'aria-busy': 'false', click: function(ev) { return runMwan4([ 'restart' ], eventButton(ev)); } }, [ _('Refresh runtime') ]),
		E('span', { class: 'mwan4-muted-line' }, [ _('Service') ]),
		E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-label': _('Start MultiWAN 4 service'), 'aria-busy': 'false', click: function(ev) { return runMwan4([ 'start' ], eventButton(ev)); } }, [ _('Start') ]),
		E('button', { class: 'btn cbi-button cbi-button-reset', 'aria-label': _('Stop MultiWAN 4 service'), 'aria-busy': 'false', click: function(ev) { return runMwan4([ 'stop' ], eventButton(ev)); } }, [ _('Stop') ])
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

function showHistoryModal(name) {
	showMwan4Modal(_('Link history: %s').format(name), [
		E('div', { class: 'mwan4-modal-grid' }, [ mwan4LinkHistory.renderPanel({ interface: name }) ]),
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

function modalCheck(label, name, checked) {
	return E('label', { class: 'mwan4-modal-check' }, [
		E('input', { type: 'checkbox', name: name, checked: checked ? 'checked' : null }),
		E('span', [ label ])
	]);
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
	modal.querySelectorAll('.mwan4-modal-grid input, .mwan4-modal-grid select, .mwan4-modal-grid textarea').forEach(function(node) {
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

function enabledInterfaceNames() {
	return configuredEnabledInterfaceNames();
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

function liveInterfaceCounts(status) {
	let interfaces = (status || {}).interfaces || {};
	let names = Object.keys(interfaces).filter(function(name) {
		return interfaces[name].enabled !== false && interfaces[name].enabled != '0';
	});
	let online = names.filter(function(name) {
		let runtime = interfaces[name];
		let state = runtime.health_state != null ? runtime.health_state : runtime.status;

		return state == 'online';
	}).length;

	return {
		names:   names,
		online:  online,
		total:   names.length,
		offline: Math.max(0, names.length - online)
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

function buildRoutingPresetChange(mode) {
	let modal = document.querySelector('.modal');
	let names = enabledInterfaceNames();
	let strategy = mode == 'failover' ? 'failover' : 'balanced';
	let generatedCount = overviewGeneratedRoutes().length;
	let customCount = uci.sections('mwan4', 'route').length - generatedCount;
	if (!names.length) {
		ui.addNotification(null, E('p', [ _('Enable at least one WAN link first.') ]), 'warning');
		return;
	}

	if (mode == 'failover') {
		let primary = modalValue(modal, 'primary') || names[0];
			names.sort(function(a, b) {
				if (a == primary)
					return -1;
				if (b == primary)
					return 1;
				return String(a).localeCompare(String(b));
			});
	}

	return {
		summary: mode == 'failover'
			? _('This will replace generated paths with a primary WAN link failover order.')
			: _('This will replace generated paths with equal-priority load balancing.'),
		items:   [
			[ _('Routing preset'), mode == 'failover' ? _('Reliability first') : _('Throughput first') ],
			[ _('Strategy'), formatPolicyPath(strategy) ],
			[ _('WAN order'), names.join(mode == 'failover' ? ' -> ' : ' + ') ],
			[ _('Generated paths replaced'), String(generatedCount) ],
			[ _('Custom paths preserved'), String(customCount) ],
			[ _('Default routing'), _('IPv4 and IPv6 default traffic will use %s.').format(formatPolicyPath(strategy)) ]
		],
		apply:   function() {
			return commitRoutingPreset(mode, names.slice());
		}
	};
}

function commitRoutingPreset(mode, names) {
	let routes = [];
	let stamp = Date.now();
	let strategy = mode == 'failover' ? 'failover' : 'balanced';

	resetGeneratedRouting();

	if (mode == 'failover') {
		names.forEach(function(name, index) {
			let route = sanitizeName('ui_%s_m%d_%d'.format(name, index + 1, stamp), 'route_%d_%d'.format(index + 1, stamp));
			routes.push(addPresetRoute(route, name, index + 1));
		});
	}
	else {
		names.forEach(function(name) {
			let route = sanitizeName('ui_%s_m1_%d'.format(name, stamp), 'route_' + name + '_' + stamp);
			routes.push(addPresetRoute(route, name, 1));
		});
	}

	writePresetStrategy(strategy, routes);
}

function showRoutingModal(mode) {
	let names = enabledInterfaceNames();
	let title = mode == 'failover' ? _('Use failover') : _('Use load balancing');

	showMwan4Modal(title, [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('strong', [ mode == 'failover' ? _('Reliability-first routing') : _('Throughput-first routing') ]),
				E('span', [ mode == 'failover'
					? _('mwan4 will prefer the primary WAN link and move down the list when health checks fail.')
					: _('mwan4 will use equal-priority paths across all enabled healthy WAN links.') ])
			]),
			mode == 'failover'
				? modalSelect(_('Primary WAN link'), 'primary', names, names[0], null)
				: E('div', { class: 'mwan4-route-preview' }, [ names.join(' + ') || _('No enabled WAN links') ]),
			pendingPreviewSlot()
		]),
		previewModalActions(function() { return buildRoutingPresetChange(mode); })
	]);
}

function isValidNftSetName(value) {
	return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value || '');
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

function describePathKind(path) {
	let strategy = uci.get('mwan4', path) || {};
	let routes = asArray(strategy.use_route);
	let metrics = [];

	if (path == 'default')
		return _('main routing table');
	if (path == 'unreachable')
		return _('fail closed (reject traffic)');
	if (path == 'blackhole')
		return _('fail closed (drop traffic)');
	if (path == 'failover')
		return _('failover strategy');
	if (path == 'balanced')
		return _('load-balancing strategy');

	routes.forEach(function(routeName) {
		let route = uci.get('mwan4', routeName) || {};
		if (route.metric != null && route.metric !== '')
			metrics.push(String(route.metric));
	});

	if (routes.length > 1 && metrics.length == routes.length) {
		let first = metrics[0];
		let equal = metrics.every(function(metric) { return metric == first; });
		return equal ? _('load-balancing strategy') : _('failover strategy');
	}

	return _('custom strategy');
}

function formatPolicyPath(path) {
	path = path || 'default';

	if (path == 'default')
		return _('Use main routing table');
	if (path == 'unreachable')
		return _('Fail closed (reject traffic)');
	if (path == 'blackhole')
		return _('Fail closed (drop traffic)');

	return _('%s (%s)').format(describePathKind(path), path);
}

function ruleWans(strategyName) {
	return mwan4Rules.strategyWans(uci.get('mwan4', strategyName), uci.sections('mwan4', 'route'));
}

function wanChoices() {
	return mwan4Rules.wanGroups(configuredEnabledInterfaceNames(), uci.sections('mwan4', 'route'));
}

function formatVia(via) {
	let preset = String(via || '').split(':');
	let wans = ruleWans(via).map(function(wan) { return wan.name; });

	if (preset[0] == 'prefer')
		return _('Prefer %s, fall back to others').format(preset[1]);
	if (preset[0] == 'only')
		return _('Only %s, never leak').format(preset[1]);

	return wans.length ? _('%s: %s').format(via, wans.join(' > ')) : formatPolicyPath(via);
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
		return _('Interface %s').format(draft.src_iface);

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
		draft.sticky == '1' ? _('Sticky source sessions for %ss').format(draft.timeout || '600') : null,
		draft.logging == '1' ? _('Log matches') : null,
		draft.ipset ? _('DNS/IP set %s').format(draft.ipset) : null
	].filter(Boolean);
}

function formatRuleOptions(draft) {
	return ruleOptionList(draft).join(', ') || _('No advanced options');
}

function emptyRuleDraft() {
	let strategyNames = strategies().map(function(section) { return section['.name']; });

	return {
		name: null, label: '', enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all',
		src_port: '', dest_port: '', dscp: '', local: '0', ipset: '', via: strategyNames[0] || 'default',
		sticky: '0', timeout: '600', logging: '0'
	};
}

function ruleDraftFromSection(name) {
	let rule = uci.get('mwan4', name) || {};
	let draft = emptyRuleDraft();

	return Object.assign(draft, {
		name:      name,
		label:     rule.label || name,
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

function ruleDraftFromModal(name) {
	let modal = document.querySelector('.modal');
	let mode = modalValue(modal, 'who_mode');
	let what = mwan4Rules.classifyEntries(modalValue(modal, 'what'));
	let who = mwan4Rules.classifyEntries(modalValue(modal, 'who'));
	let devices = mode == 'devices';

	return {
		name:      name,
		label:     modalValue(modal, 'label'),
		enabled:   modalValue(modal, 'enabled'),
		domain:    what.domain,
		dest_ip:   what.ip,
		src_ip:    devices ? who.ip : [],
		src_mac:   devices ? who.mac : [],
		src_iface: mode == 'iface' ? modalValue(modal, 'src_iface') : '',
		proto:     modalValue(modal, 'proto') || 'all',
		src_port:  modalValue(modal, 'src_port'),
		dest_port: modalValue(modal, 'dest_port'),
		dscp:      modalValue(modal, 'dscp'),
		local:     modalValue(modal, 'local'),
		ipset:     modalValue(modal, 'ipset'),
		via:       modalValue(modal, 'use_strategy') || 'default',
		sticky:    modalValue(modal, 'sticky'),
		timeout:   modalValue(modal, 'timeout') || '600',
		logging:   modalValue(modal, 'logging')
	};
}

function ruleMatchesAnything(draft) {
	return draft.domain.length || draft.dest_ip.length || draft.src_ip.length || draft.src_mac.length || draft.src_iface ||
		draft.proto != 'all' || draft.src_port || draft.dest_port || draft.dscp || draft.ipset;
}

function ruleProblem(modal) {
	let mode = modalValue(modal, 'who_mode');
	let what = mwan4Rules.classifyEntries(modalValue(modal, 'what'));
	let who = mwan4Rules.classifyEntries(modalValue(modal, 'who'));
	let draft = ruleDraftFromModal(null);
	let badWho = who.invalid.concat(who.domain);

	if (!draft.label)
		return _('Give the rule a name.');
	if (what.invalid.length)
		return _('Not a domain name or IP address: %s').format(what.invalid.join(', '));
	if (what.mac.length)
		return _('MAC addresses belong in Who, not in What.');
	if (mode == 'devices' && badWho.length)
		return _('Devices must be IP addresses, CIDR ranges, or MAC addresses: %s').format(badWho.join(', '));
	if (mode == 'devices' && !draft.src_ip.length && !draft.src_mac.length)
		return _('Pick or enter at least one device.');
	if (mode == 'iface' && !draft.src_iface)
		return _('Choose a network interface.');
	if ((draft.src_port || draft.dest_port) && [ 'tcp', 'udp' ].indexOf(draft.proto) == -1)
		return _('Choose TCP or UDP before adding source or destination ports.');
	if (draft.src_port && !mwan4Rules.isValidPortList(draft.src_port))
		return _('Use source ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.');
	if (draft.dest_port && !mwan4Rules.isValidPortList(draft.dest_port))
		return _('Use ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.');
	if (draft.dscp && !mwan4Rules.isValidDscp(draft.dscp))
		return _('Use a DSCP value from 1 to 63.');
	if (draft.ipset && !isValidNftSetName(draft.ipset))
		return _('Use a simple nft set name with letters, numbers, dots, dashes, or underscores.');
	if (draft.sticky == '1' && (!/^\d+$/.test(draft.timeout) || Number(draft.timeout) < 1))
		return _('Use a positive sticky timeout in seconds.');
	if (!mwan4Rules.ruleFamilies(draft).length)
		return _('The protocol and addresses do not share an IP family (IPv4 or IPv6).');
	if (!ruleMatchesAnything(draft))
		return _('Add at least one thing to match, otherwise the rule would catch all traffic.');

	return null;
}

function validateRuleModal(modal, show) {
	let message = ruleProblem(modal);
	let node = byId('mwan4-rule-validation');

	if (show && node) {
		node.textContent = message || '';
		node.style.display = message ? '' : 'none';
	}

	return message == null;
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
		who.value = (who.value.trim() + '\n' + select.value).trim();

	select.value = '';
	who.dispatchEvent(new Event('input'));
}

function bindRuleModal() {
	let modal = document.querySelector('.modal');
	let refresh = function(show) {
		syncWhoMode(modal);
		showClassified(modal);
		validateRuleModal(modal, show);
	};

	[ 'label', 'what', 'who_mode', 'who', 'src_iface', 'proto', 'src_port', 'dest_port', 'dscp', 'ipset', 'sticky', 'timeout' ].forEach(function(name) {
		let node = modal.querySelector('[name="%s"]'.format(name));

		[ 'input', 'change' ].forEach(function(type) { node.addEventListener(type, function() { refresh(true); }); });
	});

	modal.querySelector('[name="device_pick"]')?.addEventListener('change', function(ev) { addKnownDevice(modal, ev.currentTarget); });
	refresh(false);
}

function ruleChangeItems(draft) {
	return [
		[ _('Rule'), draft.label ],
		[ _('What'), describeWhat(draft) ],
		[ _('Protocol and ports'), describeTransport(draft) ],
		[ _('Who'), describeWho(draft) ],
		[ _('Via'), formatVia(draft.via) ],
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

function addRuleSection(label) {
	let sid = mwan4Rules.sectionName(label, uci.sections('mwan4').map(function(section) { return section['.name']; }));

	uci.add('mwan4', 'rule', sid);

	return sid;
}

function writeRuleDraft(draft) {
	let sid = draft.name || addRuleSection(draft.label);
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
	keepDefaultsLast();
}

function buildRuleChange(name) {
	let modal = document.querySelector('.modal');

	if (!validateRuleModal(modal, true))
		return;

	let draft = ruleDraftFromModal(name);

	return {
		summary: name
			? _('This will update the routing rule before it is saved and applied.')
			: _('This will add a routing rule before it is saved and applied.'),
		items:   ruleChangeItems(draft),
		apply:   function() { return writeRuleDraft(draft); }
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

function renderWhatStep(draft) {
	return renderRuleStep(_('1. What traffic?'), _('Domains and IP addresses are detected automatically, so list them together.'), [
		modalTextarea(_('Domains and addresses'), 'what', draft.domain.concat(draft.dest_ip).join('\n'),
			{ placeholder: 'youtube.com\n203.0.113.0/24\n2001:db8::/32' },
			_('One entry per line. A domain also matches its subdomains. Leave empty to match every destination.')),
		E('div', { id: 'mwan4-rule-classified', class: 'mwan4-chips', 'aria-live': 'polite' }),
		E('div', { class: 'mwan4-modal-columns' }, [
			modalSelect(_('Protocol'), 'proto', [ 'all', 'tcp', 'udp', 'icmp', 'icmpv6', 'esp' ].map(function(proto) { return [ proto, protocolLabel(proto) ]; }), draft.proto, null),
			modalInput(_('Destination ports'), 'dest_port', draft.dest_port, { placeholder: _('443 or 1000-2000') }, _('Requires TCP or UDP. Supports single values, ranges, and comma-separated lists.'))
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

	return renderRuleStep(_('2. Who?'), _('Apply the rule to everyone, to specific LAN devices, or to a whole network interface.'), [
		modalSelect(_('Applies to'), 'who_mode', [ [ 'all', _('All devices') ], [ 'devices', _('Selected devices') ], [ 'iface', _('A network interface') ] ], mode, null),
		E('div', { class: 'mwan4-modal-grid', 'data-who-mode': 'devices' }, [
			renderDevicePicker(),
			modalTextarea(_('Devices'), 'who', draft.src_mac.concat(draft.src_ip).join('\n'),
				{ rows: '3', placeholder: 'aa:bb:cc:dd:ee:ff\n192.168.1.20' }, _('One MAC address, IP address, or CIDR range per line.'))
		]),
		E('div', { 'data-who-mode': 'iface' }, [
			modalSelect(_('Traffic coming from'), 'src_iface', networkNames(), draft.src_iface, null, _('Limit matches to traffic entering from this network interface.'))
		])
	]);
}

function viaOptionGroups(selected) {
	let choices = wanChoices();
	let presets = [].concat.apply([], choices.map(function(group) {
		return [ [ 'prefer:' + group[0], formatVia('prefer:' + group[0]) ], [ 'only:' + group[0], formatVia('only:' + group[0]) ] ];
	}));
	let existing = strategies().map(function(section) { return [ section['.name'], formatVia(section['.name']) ]; });
	let other = [ 'default', 'unreachable', 'blackhole' ].map(function(path) { return [ path, formatPolicyPath(path) ]; });

	return [ [ _('Existing strategies'), existing ], [ _('Quick presets'), presets ], [ _('Other'), other ] ].filter(function(group) {
		return group[1].length;
	}).map(function(group) {
		return E('optgroup', { label: group[0] }, optionList(group[1], selected));
	});
}

function renderViaStep(draft) {
	return renderRuleStep(_('3. Via which WAN links?'), _('Pick a saved strategy or a one-click preset; presets create the strategy for you.'), [
		E('label', { class: 'mwan4-modal-field' }, [
			E('span', [ _('Send matching traffic via') ]),
			E('select', { name: 'use_strategy', 'aria-describedby': 'mwan4-via-help' }, viaOptionGroups(draft.via)),
			E('small', { id: 'mwan4-via-help', class: 'mwan4-modal-help' }, [
				_('Prefer keeps the other WAN links as backups. Only fails closed instead of leaking traffic to another WAN link.')
			])
		])
	]);
}

function renderRuleOptions(draft) {
	return E('section', { class: 'mwan4-builder-section mwan4-advanced-fields' }, [
		E('div', { class: 'mwan4-builder-title' }, [
			E('strong', [ _('Extra match and logging') ]),
			E('span', [ _('Optional DSCP, source port, router traffic, sticky-session, and logging fields stay visible so the rule is reviewable at a glance.') ])
		]),
		E('div', { class: 'mwan4-modal-columns' }, [
			modalInput(_('DSCP value'), 'dscp', draft.dscp, { type: 'number', min: '1', max: '63' }, _('Match packets marked with this DSCP class (1-63).')),
			modalInput(_('Source port'), 'src_port', draft.src_port, { placeholder: _('Any') }, _('Requires TCP or UDP. Supports single values, ranges, and lists.')),
			modalInput(_('DNS or nft set'), 'ipset', draft.ipset, { placeholder: _('optional set name') }, _('Expert field for dnsmasq or nftables sets that already exist.')),
			modalInput(_('Sticky timeout seconds'), 'timeout', draft.timeout, { type: 'number', min: '1' }, _('Used only when sticky source sessions are enabled.')),
			modalCheck(_('Enabled'), 'enabled', draft.enabled == '1'),
			modalCheck(_('Also route traffic from this router'), 'local', draft.local == '1'),
			modalCheck(_('Sticky source sessions'), 'sticky', draft.sticky == '1'),
			modalCheck(_('Log matches'), 'logging', draft.logging == '1')
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

function showRuleModal(name) {
	let draft = name ? ruleDraftFromSection(name) : emptyRuleDraft();

	showMwan4Modal(name ? _('Routing rule: %s').format(draft.label) : _('Add routing rule'), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('span', { class: 'mwan4-eyebrow' }, [ _('Routing rule builder') ]),
				E('strong', [ name ? draft.label : _('New routing rule') ]),
				E('span', [ _('Rules run from top to bottom: the first match decides which WAN links carry the traffic.') ])
			]),
			name ? renderRuleLiveConnections(name) : null,
			modalInput(_('Rule name'), 'label', draft.label, { placeholder: _('Work VPN') }, _('A readable name; mwan4 derives its short internal name automatically.')),
			renderWhatStep(draft),
			renderWhoStep(draft),
			renderViaStep(draft),
			renderRuleOptions(draft),
			E('div', { id: 'mwan4-rule-validation', class: 'mwan4-rule-validation', role: 'alert', 'aria-live': 'polite', 'aria-atomic': 'true', style: 'display:none' }),
			pendingPreviewSlot()
		]),
		previewModalActions(function() { return buildRuleChange(name); }, name ? function() { return showRuleRemovalPreview(name); } : null)
	]);

	bindRuleModal();
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
		summary: _('This will update the quality limits of this strategy before they are written to mwan4.'),
		items:   [
			[ _('Strategy'), name ],
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

	showMwan4Modal(_('Strategy quality: %s').format(name), [
		E('div', { class: 'mwan4-modal-grid' }, [
			E('div', { class: 'mwan4-modal-title' }, [
				E('strong', [ name ]),
				E('span', [ _('A WAN link above a limit is skipped by this strategy only; it stays online elsewhere. If every link exceeds the limits, the least bad one is kept.') ])
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
	let cls = 'btn cbi-button %s mwan4-primary-action'.format(action.buttonClass || 'cbi-button-apply');
	let attrs = { class: cls, 'aria-label': action.ariaLabel || action.label };

	if (action.href) {
		attrs.href = action.href;
		return E('a', attrs, [ action.label ]);
	}

	attrs.click = action.click;
	attrs['aria-busy'] = 'false';
	return E('button', attrs, [ action.label ]);
}

function commandCenterState(status, progress) {
	let live = liveInterfaceCounts(status);
	let warnings = runtimeWarnings(status);

	if (!progress.hasLinks) {
		return {
			action:       { label: _('Add first WAN link'), buttonClass: 'cbi-button-add', click: function() { return showInterfaceModal(null); } },
			currentBody:  _('mwan4 needs at least one tracked network interface before it can judge health or route traffic.'),
			currentTitle: _('No WAN links configured'),
			nextBody:     _('Select an existing network interface, choose an address family, and set health check targets.'),
			nextTitle:    _('Add the first WAN link'),
			pillClass:    'mwan4-warning',
			riskBody:     _('Traffic follows the main routing table until a WAN link and routing mode are configured.'),
			riskTitle:    _('No failover yet'),
			statusLabel:  _('Setup needed'),
			summary:      _('No WAN links are configured, so MultiWAN decisions have not started.'),
			tone:         'setup'
		};
	}

	if (!progress.enabledLinkCount) {
		return {
			action:       { label: _('Review WAN links'), buttonClass: 'cbi-button-edit', click: function() { return scrollToSection('mwan4-wan-workspace'); } },
			currentBody:  _('Configured WAN links exist, but each one is disabled in mwan4.'),
			currentTitle: _('All WAN links disabled'),
			nextBody:     _('Enable the link that should carry traffic, then verify health checks.'),
			nextTitle:    _('Enable a WAN link'),
			pillClass:    'mwan4-warning',
			riskBody:     _('Disabled links cannot carry failover or policy-routed traffic.'),
			riskTitle:    _('No usable path'),
			statusLabel:  _('Setup needed'),
			summary:      _('mwan4 has link definitions, but none are enabled for routing decisions.'),
			tone:         'setup'
		};
	}

	if (!progress.hasRouting) {
		return {
			action:       { label: _('Configure failover'), buttonClass: 'cbi-button-apply', click: function() { return showRoutingModal('failover'); } },
			currentBody:  _('WAN health can be tracked, but no generated strategy tells traffic which path to use.'),
			currentTitle: _('Routing mode not configured'),
			nextBody:     _('Start with reliability-first failover. You can switch to load balancing or custom paths later.'),
			nextTitle:    _('Choose routing mode'),
			pillClass:    'mwan4-warning',
			riskBody:     _('Traffic may continue to follow the main routing table instead of a mwan4 default policy.'),
			riskTitle:    _('Policy not active'),
			statusLabel:  _('Routing needed'),
			summary:      _('WAN links are configured; the next step is choosing how healthy links should carry traffic.'),
			tone:         'setup'
		};
	}

	if (!progress.hasRules) {
		return {
			action:       { label: _('Create default policy'), buttonClass: 'cbi-button-apply', click: function() { return showRoutingModal('failover'); } },
			currentBody:  _('Paths and strategies exist, but no generated default policy selects one yet.'),
			currentTitle: _('Default policy missing'),
			nextBody:     _('Reapply a routing preset to create generated IPv4 and IPv6 default policies.'),
			nextTitle:    _('Create default policies'),
			pillClass:    'mwan4-warning',
			riskBody:     _('Without a matching default policy, traffic can bypass the prepared strategies.'),
			riskTitle:    _('Traffic may bypass mwan4'),
			statusLabel:  _('Default policy needed'),
			summary:      _('Routing pieces are present, but traffic still needs a generated default policy that points at a strategy.'),
			tone:         'setup'
		};
	}

	if (warnings.length) {
		return {
			action:       hasOperatorAccess
				? { label: _('Restart mwan4'), buttonClass: 'cbi-button-action', click: function(ev) { return hasOperatorAccess ? runMwan4([ 'restart' ], eventButton(ev)) : null; } }
				: { label: _('Open Diagnostics'), buttonClass: 'cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') },
			currentBody:  _('Saved mwan4 configuration exists, but runtime checks report missing or stale service state.'),
			currentTitle: _('Runtime incomplete'),
			nextBody:     hasOperatorAccess
				? _('Restart the service from LuCI, then re-check health and diagnostics.')
				: _('Open diagnostics or ask an operator to restart mwan4; this session cannot run service controls.'),
			nextTitle:    hasOperatorAccess ? _('Restart mwan4') : _('Check diagnostics'),
			pillClass:    'mwan4-warning',
			riskBody:     _('Failover strategies, generated defaults, and routing rules may not be fully enforced until the runtime warning is cleared.'),
			riskTitle:    _('Policy enforcement at risk'),
			statusLabel:  _('Runtime attention needed'),
			summary:      _('Configuration is present, but the running mwan4 service needs attention before the policy can be trusted.'),
			tone:         'warning'
		};
	}

	if (!live.total) {
		return {
			action:       hasOperatorAccess
				? { label: _('Restart mwan4'), buttonClass: 'cbi-button-action', click: function(ev) { return hasOperatorAccess ? runMwan4([ 'restart' ], eventButton(ev)) : null; } }
				: { label: _('Open Diagnostics'), buttonClass: 'cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') },
			currentBody:  _('mwan4 is configured, but LuCI has not received per-link runtime health data yet.'),
			currentTitle: _('Waiting for live data'),
			nextBody:     hasOperatorAccess
				? _('Restart mwan4 if health cards stay empty after the next refresh.')
				: _('Use diagnostics to confirm whether the service and trackers are running.'),
			nextTitle:    hasOperatorAccess ? _('Refresh runtime state') : _('Check diagnostics'),
			pillClass:    'mwan4-warning',
			riskBody:     _('The saved policy may be correct, but current enforcement cannot be confirmed from this page yet.'),
			riskTitle:    _('Unknown runtime state'),
			statusLabel:  _('Runtime pending'),
			summary:      _('Configuration is complete; live health data is still catching up.'),
			tone:         'warning'
		};
	}

	if (live.offline) {
		return {
			action:       { label: _('Review WAN links'), buttonClass: 'cbi-button-edit', click: function() { return scrollToSection('mwan4-wan-workspace'); } },
			currentBody:  _('%d of %d runtime WAN links are online.').format(live.online, live.total),
			currentTitle: _('Link risk detected'),
			nextBody:     _('Inspect the offline WAN link, health check targets, and SLA thresholds before changing routing rules.'),
			nextTitle:    _('Review unhealthy links'),
			pillClass:    'mwan4-warning',
			riskBody:     _('mwan4 should avoid unhealthy links, but available capacity and redundancy are reduced.'),
			riskTitle:    _('Reduced redundancy'),
			statusLabel:  _('Degraded'),
			summary:      _('Policy is active, but at least one WAN link is not currently healthy.'),
			tone:         'warning'
		};
	}

	return {
		action:       { label: _('Monitor WAN workspace'), buttonClass: 'cbi-button-neutral', click: function() { return scrollToSection('mwan4-wan-workspace'); } },
		currentBody:  _('%d of %d runtime WAN links are online.').format(live.online, live.total),
		currentTitle: _('Policy running'),
		nextBody:     _('Watch the WAN workspace, or add routing rules only for traffic that needs a special path.'),
		nextTitle:    _('Monitor and refine'),
		pillClass:    'mwan4-online',
		riskBody:     _('No runtime warnings are reported. Keep an eye on health checks after WAN or firewall changes.'),
		riskTitle:    _('Low immediate risk'),
		statusLabel:  _('Ready'),
		summary:      _('mwan4 has WAN links, routing defaults, optional routing rules, and clean runtime status.'),
		tone:         'ready'
	};
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

function renderCommandCenter(status, progress) {
	let state = commandCenterState(status, progress);
	let live = liveInterfaceCounts(status);
	let linkValue = live.total
		? _('%d/%d online').format(live.online, live.total)
		: _('%d configured').format(progress.linkCount);

	return E('section', { id: 'mwan4-command-center', class: 'mwan4-command-center is-%s'.format(state.tone), role: 'region', 'aria-labelledby': 'mwan4-command-title', 'aria-live': 'polite', 'aria-busy': 'false' }, [
		E('div', { class: 'mwan4-command-main' }, [
			E('div', { class: 'mwan4-command-copy' }, [
				E('span', { class: 'mwan4-eyebrow' }, [ _('Command center') ]),
				E('div', { class: 'mwan4-command-title' }, [
					E('h2', { id: 'mwan4-command-title' }, [ _('MultiWAN 4') ]),
					renderPill(state.statusLabel, state.pillClass)
				]),
				E('p', [ state.summary ])
			]),
			E('div', { class: 'mwan4-next-action' }, [
				E('span', { class: 'mwan4-eyebrow' }, [ _('Recommended action') ]),
				E('strong', [ state.nextTitle ]),
				primaryActionButton(state.action)
			])
		]),
		E('div', { class: 'mwan4-state-grid mwan4-compact-metrics%s'.format(connectionsEnabled() ? ' has-connections' : '') }, [
			renderCommandMetric(_('WAN links'), linkValue, _('%d enabled').format(progress.enabledLinkCount)),
			renderCommandMetric(_('Routing'), _('%d modes').format(progress.strategyCount), _('%d paths').format(progress.routeCount)),
			renderCommandMetric(_('Routing rules'), String(progress.userRuleCount), progress.ruleCount ? _('%d including defaults').format(progress.ruleCount) : _('Default routing not set')),
			renderConnectionsMetric()
		]),
		E('div', { class: 'mwan4-command-footer' }, [
			E('div', { class: 'mwan4-command-notices' }, [
				mwan4Common.renderRuntimeWarnings(status, { diagnosticsAccess: hasDiagnosticsAccess }),
				mwan4Common.renderAclNotice(hasOperatorAccess,
					_('Service start, stop, restart, and per-WAN-link controls are hidden because this session lacks the mwan4 operator ACL.'))
			]),
			E('div', { class: 'mwan4-actions' }, [
				E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Configure global MultiWAN settings'), click: showGlobalsModal }, [ _('Global settings') ]),
				hasAdvancedAccess ? E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/advanced') }, [ _('Open Advanced') ]) : '',
				hasDiagnosticsAccess ? E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open Diagnostics') ]) : ''
			]),
			renderServiceActions()
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
			? E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-label': _('Continue quick setup'), click: function() { return showRoutingModal('failover'); } }, [ _('Continue quick setup') ])
			: E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add routing rule'), click: function() { return showRuleModal(null); } }, [ _('Add rule') ]);
	let actions = [ primaryAction ];

	if (progress.hasLinks && !progress.hasRouting)
		actions.push(E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Configure load-balancing routing'), click: function() { return showRoutingModal('balanced'); } }, [ _('Configure load balancing') ]));

	return E('section', { class: 'mwan4-first-run', 'aria-labelledby': 'mwan4-first-run-title' }, [
		E('div', { class: 'mwan4-first-run-copy' }, [
			E('span', { class: 'mwan4-eyebrow' }, [ _('First-run setup') ]),
			E('h3', { id: 'mwan4-first-run-title' }, [ _('Build a working MultiWAN setup') ]),
			E('strong', { class: 'mwan4-guide-next' }, [ _('Start with this guided path.') ]),
			E('p', [ _('Work from left to right: add tracked WAN links, choose a routing mode, then add routing rules only for traffic that needs a special path.') ]),
			E('div', { class: 'mwan4-first-run-actions' }, actions)
		]),
		E('ol', { class: 'mwan4-setup-steps' }, [
			renderSetupStep(progress.hasLinks, !progress.hasLinks,
				_('Add a WAN link'),
				_('Pick an existing network interface and set health check targets.')),
			renderSetupStep(progress.hasRouting, progress.hasLinks && !progress.hasRouting,
				_('Choose routing mode'),
				_('Create a failover or load-balancing strategy from the overview presets.')),
			renderSetupStep(progress.hasRouting, false,
				_('Add routing rules only if needed'),
				_('Optional: route guest Wi-Fi, VPN clients, video calls, or a service through a special path.'))
		])
	]);
}

function roundedMetric(value) {
	if (value == null || value === '')
		return null;

	let number = Number(value);
	return isNaN(number) ? null : Math.round(number);
}

function metricText(value, suffix) {
	let number = roundedMetric(value);

	if (number == null)
		return _('Not measured');

	return suffix ? _('%d%s').format(number, suffix) : String(number);
}

function configuredRuntimeFamilies(section, runtime) {
	let runtimeFamilies = Object.keys((runtime || {}).families || {});

	if (runtimeFamilies.length)
		return runtimeFamilies;

	let families = asArray(section.family);
	return families.length ? families : [ 'ipv4' ];
}

function renderFamilyStatePills(section, runtime) {
	let families = configuredRuntimeFamilies(section, runtime);
	let runtimeFamilies = (runtime || {}).families || {};

	return E('div', { class: 'mwan4-family-pills', 'aria-label': _('Per-family health') }, families.map(function(family) {
		let item = runtimeFamilies[family] || {};
		let state = item.health_state || item.status || (item.up ? 'online' : 'unknown');

		return renderPill('%s: %s'.format(familyLabel(family), state), statusClass(state, item.up));
	}));
}

function targetRows(section, runtime) {
	let targets = asArray(runtime.track_ip);

	if (!targets.length)
		targets = asArray(section.track_ip).map(function(ip) {
			return { ip: ip, status: _('configured') };
		});

	return targets;
}

function renderTargetSummary(section, runtime) {
	let targets = targetRows(section, runtime);
	let rows = [];

	if (!targets.length)
		return E('span', { class: 'mwan4-muted-line' }, [ _('No targets') ]);

	targets.slice(0, 3).forEach(function(target) {
		if (!target || typeof target != 'object')
			target = { ip: target, status: _('configured') };

		rows.push(E('li', [
			E('span', [ formatDisplayValue(target.ip, '-') ]),
			E('span', [ formatDisplayValue(target.status, _('unknown')) ]),
			E('span', [ target.latency != null ? _('%d ms').format(target.latency) : '-' ]),
			E('span', [ target.packetloss != null ? _('%d%%').format(target.packetloss) : '-' ])
		]));
	});

	if (targets.length > rows.length)
		rows.push(E('li', { class: 'mwan4-muted-line' }, [ _('+%d more').format(targets.length - rows.length) ]));

	return E('ul', { class: 'mwan4-target-summary' }, rows);
}

function renderStateChips(runtime, state) {
	let held = stabilityEnabled() ? mwan4Stability.heldInfo(runtime) : null;

	return E('div', { class: 'mwan4-state-chips' }, [
		held && state == 'held' ? null : renderPill(state, statusClass(state, runtime.up)),
		held ? mwan4Stability.renderHeldChip(held) : null,
		stabilityEnabled() ? mwan4Stability.renderDegradedChip(mwan4Stability.degradedStrategies(runtime)) : null
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

function renderWanActions(name) {
	let actions = [
		E('button', { class: 'btn cbi-button cbi-button-edit mwan4-compact-button', 'aria-label': _('Edit WAN link %s').format(name), click: function() { return showInterfaceModal(name); } }, [ _('Edit') ])
	];

	if (hasOperatorAccess) {
		actions.splice(1, 0,
			E('button', { class: 'btn cbi-button cbi-button-action mwan4-compact-button', 'aria-label': _('Bring WAN link %s up').format(name), 'aria-busy': 'false', click: function(ev) { return runMwan4([ 'ifup', name ], eventButton(ev)); } }, [ _('Up') ]),
			E('button', { class: 'btn cbi-button cbi-button-reset mwan4-compact-button', 'aria-label': _('Take WAN link %s down').format(name), 'aria-busy': 'false', click: function(ev) { return runMwan4([ 'ifdown', name ], eventButton(ev)); } }, [ _('Down') ])
		);
	}

	if (live.history)
		actions.push(E('button', { class: 'btn cbi-button cbi-button-neutral mwan4-compact-button', 'aria-label': _('Show link history of WAN link %s').format(name), click: function() { return showHistoryModal(name); } }, [ _('History') ]));

	return E('div', { class: 'mwan4-actions mwan4-wan-actions' }, actions);
}

function renderWanRow(section, status) {
	let name = section['.name'];
	let runtime = (status.interfaces || {})[name] || {};
	let enabled = section.enabled != '0';
	let method = runtime.track_method || section.track_method || 'ping';
	let state = runtime.health_state || runtime.status || (runtime.up ? 'online' : enabled ? 'unknown' : 'disabled');
	let score = metricText(runtime.score_percent, '%');
	let failures = runtime.failed_checks == null
		? _('failed checks not measured')
		: _('%d failed checks, %d failed target(s)').format(runtime.failed_checks, Number(runtime.failed_targets || 0));
	let quality = section.check_quality == '1';
	let sla = quality
		? _('fail %sms/%s%%, recover %sms/%s%%').format(section.failure_latency || '1000', section.failure_loss || '40', section.recovery_latency || '500', section.recovery_loss || '10')
		: _('Availability-only health checks; latency/loss SLA is not enforced.');

	return E('tr', { class: 'mwan4-wan-row', 'data-interface': name }, [
		E('td', [
			E('div', { class: 'mwan4-wan-name' }, [
				E('strong', [ name ]),
				E('small', [ enabled ? _('Enabled') : _('Disabled') ]),
				renderFamilyStatePills(section, runtime)
			])
		]),
		E('td', [
			renderStateChips(runtime, state),
			E('small', [ formatDisplayValue(runtime.tracking || runtime.status, _('unknown')), runtime.up ? _(' / netifd up') : _(' / netifd down') ])
		]),
		stabilityEnabled() ? renderFlapsCell(runtime) : null,
		stabilityEnabled() ? renderAvailabilityCell(runtime) : null,
		E('td', [
			E('strong', [ score ]),
			E('small', [ runtime.score_current == null ? _('unmeasured') : _('%s/%s score').format(runtime.score_current, runtime.score_max || '10') ]),
			E('small', [ failures ])
		]),
		E('td', [
			E('strong', [ method ]),
			E('small', [ _('down %s / up %s, reliability %s').format(section.down || '5', section.up || '5', section.reliability || '1') ]),
			E('small', [ quality ? _('SLA: %s').format(sla) : _('SLA: availability only') ])
		]),
		E('td', [
			renderTargetSummary(section, runtime),
			mwan4Stability.singleTarget(asArray(section.track_ip)) ? E('small', { class: 'mwan4-single-target-warning' }, [ _('Single health check target: add a second one.') ]) : null
		]),
		connectionsEnabled() ? E('td', [ mwan4Connections.renderCountButton(_('View active connections of WAN link %s').format(name), mwan4Connections.interfaceActive(name, status), { interface: name }, showConnectionsModal) ]) : null,
		E('td', [
			renderWanActions(name)
		])
	]);
}

function renderWanWorkspace(status, counters) {
	let sections = mwanInterfaces();

	if (!sections.length)
		return E('div', { class: 'mwan4-wan-workspace-body' }, [
			renderEmptyState(
				_('No WAN links configured.'),
				_('Add each internet uplink once, then mwan4 can track health, SLA state, and strategy paths from one workspace.'),
				[ E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add WAN link'), click: function() { return showInterfaceModal(null); } }, [ _('Add WAN link') ]) ]
			)
		]);

	return E('div', { class: 'mwan4-wan-workspace-body' }, [
		E('div', { class: 'mwan4-workspace-toolbar' }, [
			E('span', { class: 'mwan4-muted-line' }, [ _('Compare saved WAN/SLA settings with live tracker state. Missing measurements stay explicit.') ]),
			E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add WAN link'), click: function() { return showInterfaceModal(null); } }, [ _('Add WAN link') ])
		]),
		E('div', { class: 'mwan4-wan-table-wrap' }, [
			E('table', { class: 'table mwan4-wan-table' }, [
				E('tr', [
					E('th', [ _('WAN') ]),
					E('th', [ _('State') ]),
					stabilityEnabled() ? E('th', { title: _('Online to offline transitions in the recent window, and in all recorded history') }, [ _('Flaps') ]) : null,
					stabilityEnabled() ? E('th', { title: _('Share of recorded time the link was online. Shows the span actually recorded while it is shorter than 24 hours.') }, [ _('Availability') ]) : null,
					E('th', [ _('Score') ]),
					E('th', [ _('Probe / SLA') ]),
					E('th', [ _('Targets') ]),
					connectionsEnabled() ? E('th', [ _('Active connections') ]) : null,
					E('th', [ _('Actions') ])
				])
			].concat(sections.map(function(section) {
				return renderWanRow(section, status || {});
			})))
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
		renderCommandMetric(_('Rule counters'), String(summary.rules), _('Open Diagnostics for raw counters')),
		renderCommandMetric(_('Path counters'), String(summary.strategies + summary.interfaces), _('%d bytes matched').format(summary.bytes))
	]);
}

function renderStrategyConnections() {
	if (!connectionsEnabled())
		return [];

	return strategies().map(function(section) {
		let name = section['.name'];
		let active = mwan4Connections.strategyActive(name, live.status);

		return active == null ? null : mwan4Connections.countButton(_('View active connections of strategy %s').format(name), _('%s: %d').format(name, active), null, { strategy: name }, showConnectionsModal);
	}).filter(Boolean);
}

function renderStrategyQuality() {
	return strategies().map(function(section) {
		let name = section['.name'];

		return E('button', {
			class:        'btn cbi-button cbi-button-neutral mwan4-compact-button',
			title:        strategyLimits(section),
			'aria-label': _('Edit quality limits of strategy %s').format(name),
			click:        function() { return showStrategyModal(name); }
		}, [ _('Quality: %s').format(name) ]);
	});
}

function renderRouting() {
	let strategyNames = strategies().map(function(section) { return section['.name']; });
	let routes = uci.sections('mwan4', 'route');
	let nodes = [];

	if (!strategyNames.length && !routes.length)
		nodes.push(renderEmptyState(
			_('No routing mode configured.'),
			_('Choose a preset after at least one WAN link exists. Presets create paths, a strategy, and default routing for you.'),
			[
				E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-label': _('Configure failover routing'), click: function() { return showRoutingModal('failover'); } }, [ _('Configure failover') ]),
				E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Configure load-balancing routing'), click: function() { return showRoutingModal('balanced'); } }, [ _('Configure load balancing') ])
			]
		));

	nodes.push(E('div', { class: 'mwan4-mode-grid' }, [
		E('div', { class: 'mwan4-mode' }, [
			E('h3', [ _('Reliability first') ]),
			E('div', { class: 'mwan4-route-preview' }, [ _('Use one primary WAN link and fail over when health checks fail.') ]),
			E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-label': _('Use reliability first'), click: function() { return showRoutingModal('failover'); } }, [ _('Use reliability first') ])
		]),
		E('div', { class: 'mwan4-mode' }, [
			E('h3', [ _('Throughput first') ]),
			E('div', { class: 'mwan4-route-preview' }, [ _('Balance traffic across healthy WAN links with equal priority.') ]),
			E('button', { class: 'btn cbi-button cbi-button-apply', 'aria-label': _('Use throughput first'), click: function() { return showRoutingModal('balanced'); } }, [ _('Use throughput first') ])
		]),
		E('div', { class: 'mwan4-mode' }, [
			E('h3', [ _('Custom strategy') ]),
			E('div', { class: 'mwan4-route-preview' }, [ _('Tune path weights, priorities, SLA behavior, and reject/drop handling manually.') ]),
			E('small', { class: 'mwan4-muted-line' }, [ _('Use the Strategies tab when manual path weighting is needed.') ])
		]),
		E('div', { class: 'mwan4-mode mwan4-mode-current' }, [
			E('h3', [ _('Current routing') ]),
			E('div', { class: 'mwan4-route-preview' }, [
				_('%d strategies, %d paths').format(strategyNames.length, routes.length),
				E('br'),
				strategyNames.map(formatPolicyPath).join(', ') || _('No strategies')
			]),
			E('div', { id: 'mwan4-strategy-connections', class: 'mwan4-chips mwan4-strategy-connections' }, renderStrategyConnections()),
			stabilityEnabled() ? E('div', { class: 'mwan4-chips mwan4-strategy-quality' }, renderStrategyQuality()) : null
		])
	]));

	return E('div', { class: 'mwan4-routing' }, nodes);
}

function wanChip(name, status) {
	let runtime = ((status || {}).interfaces || {})[name] || {};
	let state = runtime.health_state != null ? runtime.health_state : runtime.status || 'unknown';

	return E('span', { class: 'mwan4-chip mwan4-chip-wan %s'.format(statusClass(state, runtime.up)), 'data-wan': name, title: '%s: %s'.format(name, state) }, [ name ]);
}

function renderVia(via, status) {
	let wans = ruleWans(via);
	let ordered = wans.some(function(wan) { return wan.metric != wans[0].metric; });
	let strategy = uci.get('mwan4', via) || {};
	let nodes = [];

	if (!wans.length)
		return [ E('strong', [ formatPolicyPath(via) ]) ];

	wans.forEach(function(wan, index) {
		if (index)
			nodes.push(E('span', { class: 'mwan4-via-sep', 'aria-hidden': 'true' }, [ ordered ? '>' : '+' ]));
		nodes.push(wanChip(wan.name, status));
	});

	return [
		E('div', { class: 'mwan4-chips mwan4-via' }, nodes),
		E('small', [ _('%s (%s)').format(via, ordered ? _('ordered failover') : _('balanced')), strategy.last_resort == 'unreachable' || strategy.last_resort == 'blackhole' ? _(', fails closed') : '' ])
	];
}

function renderRuleConnections(name, label) {
	return tableCell(_('Connections'), [ mwan4Connections.renderRuleButton(name, label, mwan4Connections.ruleStats(name, live.status, live.counters), showConnectionsModal) ]);
}

function renderDefaultRuleConnections(name) {
	return tableCell(_('Connections'), [ mwan4Connections.renderRuleSummary(mwan4Connections.ruleStats(name, live.status, live.counters)) ]);
}

function renderHits(counters, name) {
	let hits = mwan4Rules.ruleHits((counters || {}).counters, name);

	if (!hits.found)
		return [ E('span', { class: 'mwan4-muted-line' }, [ '-' ]) ];

	return [ E('strong', { title: _('%d bytes').format(hits.bytes) }, [ String(hits.packets) ]), E('small', [ formatBytes(hits.bytes) ]) ];
}

function ruleWarnings(status, name) {
	return runtimeWarnings(status).filter(function(warning) { return warning && warning.rule == name; }).map(function(warning) {
		return E('small', { class: 'mwan4-rule-warning' }, [ formatDisplayValue(warning.message || warning.code, _('Runtime warning')) ]);
	});
}

function renderRuleMatch(draft, status) {
	let what = chipList(draft.domain, 'mwan4-chip-domain', 4).concat(chipList(draft.dest_ip, 'mwan4-chip-ip', 4));
	let transport = draft.proto != 'all' || draft.dest_port || draft.src_port ? describeTransport(draft) : null;
	let scope = [ describeWho(draft), transport, ruleOptionList(draft).join(', ') ].filter(Boolean);

	return [
		E('div', { class: 'mwan4-chips', title: describeWhat(draft) }, what.length ? what : [ E('span', { class: 'mwan4-muted-line' }, [ _('Any destination') ]) ]),
		E('small', [ scope.join(' / ') ])
	].concat(ruleWarnings(status, draft.name));
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
		disabled:     disabled ? 'disabled' : null,
		click:        function() { return moveRuleStep(name, step); }
	}, [ step < 0 ? '^' : 'v' ]);
}

function renderRuleRow(rule, index, total, status, counters) {
	let name = rule['.name'];
	let draft = ruleDraftFromSection(name);
	let attrs = Object.assign({
		class:        'mwan4-row mwan4-rule-row%s'.format(draft.enabled == '0' ? ' is-disabled' : ''),
		role:         'row',
		draggable:    'true',
		'data-rule':  name
	}, ruleDragHandlers(name));

	return E('div', attrs, [
		tableCell(_('Order'), [
			E('span', { class: 'mwan4-drag-handle', 'aria-hidden': 'true', title: _('Drag to reorder') }, [ '::' ]),
			E('span', { class: 'mwan4-rule-index' }, [ String(index + 1) ]),
			moveButton(name, draft.label, -1, index == 0),
			moveButton(name, draft.label, 1, index == total - 1)
		], { class: 'mwan4-rule-order' }),
		tableCell(_('Enabled'), [
			E('input', { type: 'checkbox', class: 'mwan4-rule-toggle', checked: draft.enabled == '1' ? 'checked' : null, 'aria-label': _('Enable routing rule %s').format(draft.label),
				change: function(ev) { return toggleRule(name, ev.currentTarget.checked); } })
		]),
		tableCell(_('Rule'), [ E('strong', [ draft.label ]), E('small', [ draft.label != name ? name : formatRuleSummaryFamily(rule) ]) ]),
		tableCell(_('Match'), renderRuleMatch(draft, status)),
		tableCell(_('Via'), renderVia(draft.via, status)),
		tableCell(_('Hits'), renderHits(counters, name)),
		connectionsEnabled() ? renderRuleConnections(name, draft.label) : null,
		tableCell(_('Actions'), [
			E('button', { class: 'btn cbi-button cbi-button-edit', 'aria-label': _('Edit routing rule %s').format(draft.label), click: function() { return showRuleModal(name); } }, [ _('Edit') ])
		], { class: 'mwan4-actions' })
	]);
}

function formatRuleSummaryFamily(rule) {
	return asArray(rule.family).map(familyLabel).join(' + ');
}

function renderDefaultRuleRow(rule, status, counters) {
	let name = rule['.name'];
	let family = asArray(rule.family)[0] || (rule.dest_ip == '::/0' ? 'ipv6' : 'ipv4');

	return E('div', { class: 'mwan4-row mwan4-rule-row is-default', role: 'row', 'data-rule': name }, [
		tableCell(_('Order'), [ E('span', { class: 'mwan4-rule-index', title: _('Default routing always stays last') }, [ '=' ]) ], { class: 'mwan4-rule-order' }),
		tableCell(_('Enabled'), []),
		tableCell(_('Rule'), [ E('strong', [ _('Everything else') ]), E('small', [ familyLabel(family) ]) ]),
		tableCell(_('Match'), [ E('span', { class: 'mwan4-muted-line' }, [ _('All traffic no rule above matched') ]) ]),
		tableCell(_('Via'), renderVia(rule.use_strategy || 'default', status)),
		tableCell(_('Hits'), renderHits(counters, name)),
		connectionsEnabled() ? renderDefaultRuleConnections(name) : null,
		tableCell(_('Actions'), [])
	]);
}

function trafficRules() {
	return rules().filter(function(rule) { return !isGeneratedDefaultRule(rule); });
}

function renderRules(status, counters) {
	let movable = trafficRules();
	let labels = [ _('Order'), _('Enabled'), _('Rule'), _('Match'), _('Via'), _('Hits') ].concat(connectionsEnabled() ? [ _('Connections') ] : [], [ _('Actions') ]);
	let nodes = [ tableHeader(labels, 'mwan4-rule-head') ];

	if (!movable.length)
		nodes.unshift(renderEmptyState(
			_('No routing rules yet.'),
			_('All traffic follows the default routing below. Add a rule to send a site, a device, or a whole network through specific WAN links.'),
			[ E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add routing rule'), click: function() { return showRuleModal(null); } }, [ _('Add rule') ]) ]
		));

	movable.forEach(function(rule, index) { nodes.push(renderRuleRow(rule, index, movable.length, status, counters)); });
	rules().filter(isGeneratedDefaultRule).forEach(function(rule) { nodes.push(renderDefaultRuleRow(rule, status, counters)); });

	return E('div', { class: 'mwan4-table mwan4-rules%s'.format(connectionsEnabled() ? ' has-connections' : ''), role: 'table', 'aria-label': _('Routing rules') }, nodes);
}

function renderRulesPanel(status, counters) {
	return E('section', { class: 'mwan4-panel', 'aria-labelledby': 'mwan4-rules-title' }, [
		E('div', { class: 'mwan4-panel-heading' }, [
			E('div', [ E('span', { class: 'mwan4-eyebrow' }, [ _('Evaluated top to bottom') ]), E('h3', { id: 'mwan4-rules-title' }, [ _('Routing rules') ]) ]),
			E('div', { class: 'mwan4-actions mwan4-rules-actions' }, [
				canImportPbr() ? E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Import routing rules from PBR'), 'aria-busy': 'false', click: function(ev) { return openPbrImport(eventButton(ev)); } }, [ _('Import from PBR') ]) : '',
				E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add routing rule'), click: function() { return showRuleModal(null); } }, [ _('Add rule') ])
			])
		]),
		E('div', { id: 'mwan4-rules-body' }, [ renderRules(status, counters) ])
	]);
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
				E('tr', [ E('th', [ _('PBR policy') ]), E('th', [ _('Result') ]), E('th', [ _('Rule') ]), E('th', [ _('Via') ]) ])
			].concat(policies.map(renderImportRow))),
			renderImportList(_('WAN links to create:'), preview.interfaces),
			renderImportList(_('Strategies to create:'), preview.strategies),
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

function renderGlobalSettings() {
	let section = getGlobalSection();
	let mask = globalValue(section, 'mwan4.mmx_mask', 'mmx_mask', '0x3F00');
	let sourceRouting = globalValue(section, 'mwan4.source_routing', 'source_routing', '0') == '1';
	let lookupTables = asArray(section.rt_table_lookup).join(', ') || _('Default tables');

	return E('div', { class: 'mwan4-mode-grid' }, [
		E('div', { class: 'mwan4-mode' }, [
			E('h3', [ _('Firewall marks') ]),
			E('div', { class: 'mwan4-route-preview' }, [ mask ])
		]),
		E('div', { class: 'mwan4-mode' }, [
			E('h3', [ _('Routing lookup') ]),
			E('div', { class: 'mwan4-route-preview' }, [
				sourceRouting ? _('Source routing enabled') : _('Standard policy routing'),
				E('br'),
				lookupTables
			])
		]),
		E('div', { class: 'mwan4-mode' }, [
			E('h3', [ _('Logging') ]),
			E('div', { class: 'mwan4-route-preview' }, [
				section.logging == '1' ? _('Rule logging enabled') : _('Rule logging off'),
				E('br'),
				section.loglevel || 'notice'
			]),
			E('button', { class: 'btn cbi-button cbi-button-edit', 'aria-label': _('Configure global MultiWAN settings'), click: showGlobalsModal }, [ _('Configure') ])
		])
	]);
}

function renderApp(status, counters) {
	let progress = setupProgress();
	let nodes = [
		renderCommandCenter(status, progress)
	];

	if (progress.needsGuide)
		nodes.push(renderFirstRunGuide(progress));

		nodes.push(
		E('section', { id: 'mwan4-wan-workspace', class: 'mwan4-panel mwan4-wan-workspace', 'aria-labelledby': 'mwan4-wan-workspace-title', 'aria-live': 'polite', 'aria-busy': 'false' }, [
			E('div', { class: 'mwan4-panel-heading' }, [
				E('div', [
					E('span', { class: 'mwan4-eyebrow' }, [ _('WAN workspace') ]),
					E('h3', { id: 'mwan4-wan-workspace-title' }, [ _('WAN health matrix') ])
				]),
				hasDiagnosticsAccess ? E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open Diagnostics') ]) : ''
			]),
			renderWanWorkspace(status, counters)
		]),
		E('section', { class: 'mwan4-panel', 'aria-labelledby': 'mwan4-routing-title' }, [
			E('h3', { id: 'mwan4-routing-title' }, [ _('Routing mode') ]),
			renderRouting()
		]),
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
		hasAdvancedAccess = !!data[4];
		hasDiagnosticsAccess = !!data[5];
		let counters = data[6] || {};
		probeHelpers = {
			httping:  helperAvailable(data[7]),
			nping:    helperAvailable(data[8]),
			arping:   helperAvailable(data[9]),
			nslookup: helperAvailable(data[10])
		};
		knownDevices = mwan4Rules.hostDevices(data[11]);
		pbrPreview = data[12] || {};
		hasConfigWrite = !!data[13];
		setLive(status, counters, data[14], data[15]);

		poll.add(function() {
			let commandCenter = byId('mwan4-command-center');
			let wanWorkspace = byId('mwan4-wan-workspace');
			let rulesBody = byId('mwan4-rules-body');

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
					wanWorkspace.replaceChildren(
						E('div', { class: 'mwan4-panel-heading' }, [
							E('div', [
								E('span', { class: 'mwan4-eyebrow' }, [ _('WAN workspace') ]),
								E('h3', { id: 'mwan4-wan-workspace-title' }, [ _('WAN health matrix') ])
							]),
							hasDiagnosticsAccess ? E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open Diagnostics') ]) : ''
						]),
						renderWanWorkspace(result || {}, counterResult)
					);
				if (rulesBody && !dragRule)
					rulesBody.replaceChildren(renderRules(result, counterResult));
				if (byId('mwan4-strategy-connections'))
					byId('mwan4-strategy-connections').replaceChildren.apply(byId('mwan4-strategy-connections'), renderStrategyConnections());
				refreshRuleLiveConnections();
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
