'use strict';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';
'require mwan4.common as mwan4Common';
'require mwan4.overview as mwan4Overview';
/* global mwan4Common */
/* global mwan4Overview */

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

let hasOperatorAccess = false;
let hasAdvancedAccess = false;
let hasDiagnosticsAccess = false;
let modalReturnFocus = null;
let probeHelpers = { httping: false, nping: false, arping: false, nslookup: false };

mwan4Common.addStylesheet();

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

function saveApplyRestart() {
	let root = byId('mwan4-app');

	return withBusy(root, function() { return uci.save()
		.then(function() { return uci.apply(10); })
		.then(function() { return hasOperatorAccess ? runMwan4([ 'restart' ]) : null; })
		.then(function() {
			ui.addNotification(null, E('p', [ hasOperatorAccess
				? _('MultiWAN 4 settings applied and service restarted.')
				: _('MultiWAN 4 settings applied. Service restart is hidden by this session ACL.') ]), hasOperatorAccess ? 'info' : 'warning');
			uci.unload([ 'mwan4', 'network' ]);
			return Promise.all([ uci.load('mwan4'), uci.load('network'), L.resolveDefault(callStatus(), {}) ]);
		})
		.then(function(data) {
			if (root)
				root.replaceChildren(renderApp(data[2] || {}));
		});
	});
}

function closeModal() {
	let target = modalReturnFocus;

	modalReturnFocus = null;
	ui.hideModal();

	if (target && document.documentElement.contains(target))
		window.setTimeout(function() { target.focus(); }, 0);
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

function trafficExceptions() {
	return rules().filter(function(rule) {
		return !isGeneratedDefaultRule(rule);
	});
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
		recovery_loss:    modalValue(modal, 'recovery_loss') || '10'
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
			[ _('State'), draft.enabled == '1' ? _('Enabled') : _('Disabled') ]
		],
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
			modalInput(_('Health check targets'), 'track_ip', asArray(section?.track_ip).join(' ') || '1.1.1.1 8.8.8.8', { placeholder: _('1.1.1.1 8.8.8.8') })
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
		]),
		pendingPreviewSlot()
	);

	showMwan4Modal(title, [
		E('div', { class: 'mwan4-modal-grid' }, fields),
		previewModalActions(function() { return buildInterfaceChange(name); }, name ? function() { return showInterfaceRemovalPreview(name); } : null)
	]);
}

function enabledInterfaceNames() {
	return configuredEnabledInterfaceNames();
}

function setupProgress() {
	let links = mwanInterfaces();
	let routeSections = uci.sections('mwan4', 'route');
	let strategySections = strategies();
	let ruleSections = rules();
	let exceptionSections = trafficExceptions();
	let hasLinks = links.length > 0;
	let hasRouting = strategySections.length > 0 || routeSections.length > 0;

	return {
		enabledLinkCount: links.filter(function(section) { return section.enabled != '0'; }).length,
		exceptionCount:    exceptionSections.length,
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

function isValidPortToken(token) {
	let parts = token.split(/[-:]/);
	let start = Number(parts[0]);
	let end = parts.length > 1 ? Number(parts[1]) : start;

	return /^\d+([-:]\d+)?$/.test(token) && start >= 1 && start <= 65535 && end >= start && end <= 65535;
}

function isValidPortList(value) {
	let tokens = (value || '').split(/[\s,]+/).filter(function(token) { return token != ''; });
	return tokens.length > 0 && tokens.every(isValidPortToken);
}

function isValidPolicyName(value) {
	return /^[A-Za-z0-9_]+$/.test(value || '');
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

function policyPathOptions(strategyNames) {
	let options = strategyNames.map(function(name) {
		return [ name, formatPolicyPath(name) ];
	});

	return options.concat([
		[ 'default', formatPolicyPath('default') ],
		[ 'unreachable', formatPolicyPath('unreachable') ],
		[ 'blackhole', formatPolicyPath('blackhole') ]
	]);
}

function showRuleValidation(message) {
	let node = byId('mwan4-rule-validation');
	if (!node)
		return;

	node.textContent = message || '';
	node.style.display = message ? '' : 'none';
}

function validateRuleDraft(modal, show) {
	let family = modalValue(modal, 'family') || 'ipv4';
	let nameNode = modal.querySelector('[name="name"]');
	let policyName = nameNode ? modalValue(modal, 'name') : '';
	let proto = modalValue(modal, 'proto') || 'all';
	let srcPort = modalValue(modal, 'src_port');
	let destPort = modalValue(modal, 'dest_port');
	let ipset = modalValue(modal, 'ipset');
	let sticky = modalValue(modal, 'sticky');
	let timeout = modalValue(modal, 'timeout');
	let message = null;

	if (policyName && !isValidPolicyName(policyName))
		message = _('Use letters, numbers, and underscores for the traffic exception name.');
	else if (policyName.length > 15)
		message = _('Keep traffic exception names 15 characters or less so mwan4 can build nftables rule names.');
	else if (proto == 'icmpv6' && family != 'ipv6')
		message = _('ICMPv6 policies must use IPv6.');
	else if (proto == 'icmp' && family != 'ipv4')
		message = _('ICMP policies must use IPv4.');
	else if ((srcPort || destPort) && [ 'tcp', 'udp' ].indexOf(proto) == -1)
		message = _('Choose TCP or UDP before adding source or destination ports.');
	else if (srcPort && !isValidPortList(srcPort))
		message = _('Use source ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.');
	else if (destPort && !isValidPortList(destPort))
		message = _('Use ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.');
	else if (ipset && !isValidNftSetName(ipset))
		message = _('Use a simple nft set name with letters, numbers, dots, dashes, or underscores.');
	else if (sticky == '1' && (!/^\d+$/.test(timeout || '') || Number(timeout) < 1))
		message = _('Use a positive sticky timeout in seconds.');

	if (show)
		showRuleValidation(message);

	return message == null;
}

function bindRuleValidation() {
	let modal = document.querySelector('.modal');
	if (!modal)
		return;

	[ 'name', 'family', 'proto', 'src_port', 'dest_port', 'ipset', 'sticky', 'timeout' ].forEach(function(name) {
		let node = modal.querySelector('[name="%s"]'.format(name));
		if (node) {
			node.addEventListener('input', function() { validateRuleDraft(modal, true); });
			node.addEventListener('change', function() { validateRuleDraft(modal, true); });
		}
	});

	validateRuleDraft(modal, true);
}

function ruleDraftFromModal(name) {
	let modal = document.querySelector('.modal');
	let family = modalValue(modal, 'family') || 'ipv4';
	let draft = {
		name:         name || sanitizeName(modalValue(modal, 'name'), 'rule_%d'.format(rules().length + 1)),
		family:       family,
		proto:        modalValue(modal, 'proto') || 'all',
		src_ip:       modalValue(modal, 'src_ip'),
		src_iface:    modalValue(modal, 'src_iface'),
		src_port:     modalValue(modal, 'src_port'),
		dest_ip:      modalValue(modal, 'dest_ip'),
		dest_port:    modalValue(modal, 'dest_port'),
		ipset:        modalValue(modal, 'ipset'),
		use_strategy: modalValue(modal, 'use_strategy') || 'default',
		sticky:       modalValue(modal, 'sticky'),
		timeout:      modalValue(modal, 'timeout') || '600',
		logging:      modalValue(modal, 'logging')
	};

	return draft;
}

function ruleDraftFromSection(name) {
	let rule = uci.get('mwan4', name) || {};

	return {
		name:         name,
		family:       asArray(rule.family)[0] || 'ipv4',
		proto:        rule.proto || 'all',
		src_ip:       rule.src_ip,
		src_iface:    rule.src_iface,
		src_port:     rule.src_port,
		dest_ip:      rule.dest_ip,
		dest_port:    rule.dest_port,
		ipset:        rule.ipset,
		use_strategy: rule.use_strategy || 'default',
		sticky:       rule.sticky,
		timeout:      rule.timeout || '600',
		logging:      rule.logging
	};
}

function formatRuleMatch(draft) {
	return [
		familyLabel(draft.family),
		protocolLabel(draft.proto),
		draft.src_iface ? _('from interface %s').format(draft.src_iface) : null,
		draft.src_ip ? _('from source %s').format(draft.src_ip) : null,
		draft.src_port ? _('source port %s').format(draft.src_port) : null
	].filter(function(v) { return v; }).join(' / ') || _('Any traffic');
}

function formatRuleDestination(draft) {
	return [
		draft.dest_ip || _('Any destination'),
		draft.dest_port ? _('port %s').format(draft.dest_port) : null,
		draft.ipset ? _('DNS/IP set %s').format(draft.ipset) : null
	].filter(function(v) { return v; }).join(' / ');
}

function formatRuleSummary(draft) {
	return _('%s -> %s; Routing mode: %s.').format(
		formatRuleMatch(draft),
		formatRuleDestination(draft),
		formatPolicyPath(draft.use_strategy)
	);
}

function formatRuleOptions(draft) {
	let options = [];

	if (draft.sticky == '1')
		options.push(_('Sticky source sessions for %ss').format(draft.timeout || '600'));
	if (draft.logging == '1')
		options.push(_('Log matches'));

	return options.join(', ') || _('No advanced options');
}

function writeRuleDraft(draft, existingName) {
	let sid = existingName || draft.name;

	if (!existingName)
		uci.add('mwan4', 'rule', sid);

	uci.set('mwan4', sid, 'family', [ draft.family || 'ipv4' ]);
	uci.set('mwan4', sid, 'proto', draft.proto || 'all');
	uci.set('mwan4', sid, 'src_ip', draft.src_ip);
	uci.set('mwan4', sid, 'src_iface', draft.src_iface);
	uci.set('mwan4', sid, 'src_port', draft.src_port);
	uci.set('mwan4', sid, 'dest_ip', draft.dest_ip);
	uci.set('mwan4', sid, 'dest_port', draft.dest_port);
	uci.set('mwan4', sid, 'ipset', draft.ipset);
	uci.set('mwan4', sid, 'use_strategy', draft.use_strategy || 'default');
	uci.set('mwan4', sid, 'sticky', draft.sticky);
	uci.set('mwan4', sid, 'timeout', draft.sticky == '1' ? draft.timeout || '600' : null);
	uci.set('mwan4', sid, 'logging', draft.logging);
}

function buildRuleChange(name) {
	let modal = document.querySelector('.modal');
	let draft;

	if (!validateRuleDraft(modal, true))
		return;

	draft = ruleDraftFromModal(name);

	if (!name && uci.get('mwan4', draft.name)) {
		ui.addNotification(null, E('p', [ _('A traffic exception with that name already exists.') ]), 'warning');
		return;
	}

	return {
		summary: name
		? _('This will update the traffic exception before it is saved and applied.')
		: _('This will add a traffic exception before it is saved and applied.'),
		items:   [
			[ _('Policy'), draft.name ],
			[ _('Traffic exception summary'), formatRuleSummary(draft) ],
			[ _('Traffic match'), formatRuleMatch(draft) ],
			[ _('Destination'), formatRuleDestination(draft) ],
			[ _('Routing mode'), formatPolicyPath(draft.use_strategy) ],
			[ _('Advanced options'), formatRuleOptions(draft) ]
		],
		apply:   function() {
			return writeRuleDraft(draft, name);
		}
	};
}

function buildRuleRemovalChange(name) {
	let draft = ruleDraftFromSection(name);

	return {
		summary: _('This will remove the traffic exception after you apply the pending change.'),
		items:   [
			[ _('Policy'), draft.name ],
			[ _('Traffic exception summary'), formatRuleSummary(draft) ],
			[ _('Traffic match'), formatRuleMatch(draft) ],
			[ _('Destination'), formatRuleDestination(draft) ],
			[ _('Current routing mode'), formatPolicyPath(draft.use_strategy) ]
		],
		apply:   function() {
			uci.remove('mwan4', name);
		}
	};
}

function showRuleRemovalPreview(name) {
	let change = buildRuleRemovalChange(name);

	return showPendingChangePreview(change, function() { return buildRuleChange(name); }, function() { return showRuleRemovalPreview(name); });
}

function renderRuleBuilderSection(title, description, children) {
	return E('section', { class: 'mwan4-builder-section' }, [
		E('div', { class: 'mwan4-builder-title' }, [
			E('strong', [ title ]),
			E('span', [ description ])
		]),
		E('div', { class: 'mwan4-modal-columns' }, children)
	]);
}

function renderRuleSummaryCard(draft) {
	return E('div', { class: 'mwan4-rule-summary' }, [
		E('strong', [ _('Traffic exception summary') ]),
		E('span', [ draft
			? formatRuleSummary(draft)
			: _('This is an exception to the default failover/load-balance behavior.') ])
	]);
}

function renderRuleAdvancedFields(rule) {
	return E('section', { class: 'mwan4-builder-section mwan4-advanced-fields' }, [
		E('div', { class: 'mwan4-builder-title' }, [
			E('strong', [ _('Extra match and logging') ]),
			E('span', [ _('Optional source, nft set, sticky-session, and logging fields stay visible so the rule is reviewable at a glance.') ])
		]),
		E('div', { class: 'mwan4-modal-columns' }, [
			modalInput(_('Source address'), 'src_ip', rule?.src_ip || '', { placeholder: _('Any') }, _('Optional CIDR, single IP, or host address.')),
			modalInput(_('Source port'), 'src_port', rule?.src_port || '', { placeholder: _('Any') }, _('Requires TCP or UDP. Supports single values, ranges, and lists.')),
			modalInput(_('DNS or nft set'), 'ipset', rule?.ipset || '', { placeholder: _('optional set name') }, _('Expert field for dnsmasq or nftables sets that already exist.')),
			modalInput(_('Sticky timeout seconds'), 'timeout', rule?.timeout || '600', { type: 'number', min: '1' }, _('Used only when sticky source sessions are enabled.')),
			modalCheck(_('Sticky source sessions'), 'sticky', rule?.sticky == '1'),
			modalCheck(_('Log matches'), 'logging', rule?.logging == '1')
		])
	]);
}

function showRuleModal(name) {
	let rule = name ? uci.get('mwan4', name) : null;
	let currentDraft = name ? ruleDraftFromSection(name) : null;
	let title = name ? _('Traffic exception: %s').format(name) : _('Add traffic exception');
	let family = asArray(rule?.family).includes('ipv6') ? 'ipv6' : 'ipv4';
	let strategyNames = strategies().map(function(s) { return s['.name']; });
	let pathHelp = strategyNames.length
		? _('A routing mode uses a saved mwan4 strategy. Use presets for common failover or load-balance behavior.')
		: _('No routing modes yet. Use Routing mode first, or choose the main routing table or a fail-closed action.');
	let fields = [
		E('div', { class: 'mwan4-modal-title' }, [
			E('span', { class: 'mwan4-eyebrow' }, [ _('Traffic exception builder') ]),
			E('strong', [ name || _('New traffic exception') ]),
			E('span', [ _('Describe the traffic exception and choose how it should be routed.') ])
		]),
		renderRuleSummaryCard(currentDraft),
		E('div', { class: 'mwan4-builder-steps' }, [
			E('div', { class: 'mwan4-builder-step' }, [
				E('strong', [ _('1. Match traffic') ]),
				E('span', [ _('Start with the source, protocol, or ingress interface.') ])
			]),
			E('div', { class: 'mwan4-builder-step' }, [
				E('strong', [ _('2. Describe the destination') ]),
				E('span', [ _('Narrow by destination address or service port when needed.') ])
			]),
			E('div', { class: 'mwan4-builder-step' }, [
				E('strong', [ _('3. Choose path') ]),
				E('span', [ _('Send matching traffic through a routing mode, the main routing table, or a fail-closed action.') ])
			])
		])
	];

	if (!name)
		fields.push(modalInput(_('Traffic exception name'), 'name', '', { placeholder: _('work_vpn') }, _('Use letters, numbers, and underscores for the traffic exception name.')));

	fields.push(
		renderRuleBuilderSection(_('Traffic match'), _('Choose who or what this traffic exception applies to. Leave fields empty for any source.'), [
			modalSelect(_('Address family'), 'family', [ [ 'ipv4', _('IPv4') ], [ 'ipv6', _('IPv6') ] ], family, null, _('IPv4 and IPv6 policies are evaluated separately.')),
			modalSelect(_('Protocol'), 'proto', [ 'all', 'tcp', 'udp', 'icmp', 'icmpv6', 'esp' ], rule?.proto || 'all', null, _('Pick TCP or UDP before matching ports.')),
			modalSelect(_('Traffic coming from'), 'src_iface', networkNames(), rule?.src_iface || '', _('Any interface'), _('Limit matches to traffic entering from this network interface.'))
		]),
		renderRuleBuilderSection(_('Destination match'), _('Add only the destination constraints you need. Empty fields keep the destination broad.'), [
			modalInput(_('Destination address'), 'dest_ip', rule?.dest_ip || '', { placeholder: _('Any or 203.0.113.0/24') }, _('Leave empty for any destination, or enter a CIDR, single IP, or host address.')),
			modalInput(_('Destination port'), 'dest_port', rule?.dest_port || '', { placeholder: _('443 or 1000-2000') }, _('Requires TCP or UDP. Supports single values, ranges, and comma-separated lists.'))
		]),
		renderRuleBuilderSection(_('Routing mode'), _('Decide what happens when all match conditions are true.'), [
			modalSelect(_('Choose routing mode'), 'use_strategy', policyPathOptions(strategyNames), rule?.use_strategy || 'default', null, pathHelp)
		]),
		renderRuleAdvancedFields(rule),
		E('div', { id: 'mwan4-rule-validation', class: 'mwan4-rule-validation', role: 'alert', 'aria-live': 'polite', 'aria-atomic': 'true', style: 'display:none' }),
		pendingPreviewSlot()
	);

	showMwan4Modal(title, [
		E('div', { class: 'mwan4-modal-grid' }, fields),
		previewModalActions(function() { return buildRuleChange(name); }, name ? function() { return showRuleRemovalPreview(name); } : null)
	]);

	bindRuleValidation();
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
		loglevel:        modalValue(modal, 'loglevel') || 'notice'
	};
}

function writeGlobalDraft(draft) {
	ensureGlobalSection();
	uci.set('mwan4', 'globals', 'mmx_mask', draft.mmx_mask);
	uci.set('mwan4', 'globals', 'source_routing', draft.source_routing);
	setList('mwan4', 'globals', 'rt_table_lookup', draft.rt_table_lookup);
	uci.set('mwan4', 'globals', 'logging', draft.logging);
	uci.set('mwan4', 'globals', 'loglevel', draft.loglevel);
}

function buildGlobalChange() {
	let draft = globalDraftFromModal();

	return {
		summary: _('This will update global firewall and routing behavior before it is written to mwan4.'),
		items:   [
			[ _('Firewall mark mask'), draft.mmx_mask ],
			[ _('Source routing'), draft.source_routing == '1' ? _('Enabled') : _('Disabled') ],
			[ _('Additional tables'), draft.rt_table_lookup.length ? draft.rt_table_lookup.join(', ') : _('Default tables') ],
			[ _('Logging'), draft.logging == '1' ? draft.loglevel : _('Off') ]
		],
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
				E('span', [ _('These settings affect every strategy, path, generated default, and traffic exception.') ])
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
			riskBody:     _('Failover strategies, generated defaults, and exceptions may not be fully enforced until the runtime warning is cleared.'),
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
			nextBody:     _('Inspect the offline WAN link, health check targets, and SLA thresholds before changing traffic exceptions.'),
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
		nextBody:     _('Watch the WAN workspace, or add traffic exceptions only for traffic that needs a special path.'),
		nextTitle:    _('Monitor and refine'),
		pillClass:    'mwan4-online',
		riskBody:     _('No runtime warnings are reported. Keep an eye on health checks after WAN or firewall changes.'),
		riskTitle:    _('Low immediate risk'),
		statusLabel:  _('Ready'),
		summary:      _('mwan4 has WAN links, routing defaults, optional exceptions, and clean runtime status.'),
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
		E('div', { class: 'mwan4-state-grid mwan4-compact-metrics' }, [
			renderCommandMetric(_('WAN links'), linkValue, _('%d enabled').format(progress.enabledLinkCount)),
			renderCommandMetric(_('Routing'), _('%d modes').format(progress.strategyCount), _('%d paths').format(progress.routeCount)),
			renderCommandMetric(_('Exceptions'), String(progress.exceptionCount), progress.ruleCount ? _('%d total rules').format(progress.ruleCount) : _('Default routing not set'))
		]),
		E('div', { class: 'mwan4-command-footer' }, [
			E('div', { class: 'mwan4-command-notices' }, [
				mwan4Common.renderRuntimeWarnings(status, { diagnosticsAccess: hasDiagnosticsAccess }),
				mwan4Common.renderAclNotice(hasOperatorAccess,
					_('Service start, stop, restart, and per-WAN-link controls are hidden because this session lacks the mwan4 operator ACL.'))
			]),
			E('div', { class: 'mwan4-actions' }, [
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
			: E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add traffic exception'), click: function() { return showRuleModal(null); } }, [ _('Add exception') ]);
	let actions = [ primaryAction ];

	if (progress.hasLinks && !progress.hasRouting)
		actions.push(E('button', { class: 'btn cbi-button cbi-button-neutral', 'aria-label': _('Configure load-balancing routing'), click: function() { return showRoutingModal('balanced'); } }, [ _('Configure load balancing') ]));

	return E('section', { class: 'mwan4-first-run', 'aria-labelledby': 'mwan4-first-run-title' }, [
		E('div', { class: 'mwan4-first-run-copy' }, [
			E('span', { class: 'mwan4-eyebrow' }, [ _('First-run setup') ]),
			E('h3', { id: 'mwan4-first-run-title' }, [ _('Build a working MultiWAN setup') ]),
			E('strong', { class: 'mwan4-guide-next' }, [ _('Start with this guided path.') ]),
			E('p', [ _('Work from left to right: add tracked WAN links, choose a routing mode, then add traffic exceptions only for traffic that needs a special path.') ]),
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
				_('Add exceptions only if needed'),
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

	return E('div', { class: 'mwan4-actions mwan4-wan-actions' }, actions);
}

function renderWanRow(section, status) {
	let name = section['.name'];
	let runtime = (status.interfaces || {})[name] || {};
	let enabled = section.enabled != '0';
	let method = runtime.track_method || section.track_method || 'ping';
	let state = runtime.health_state || runtime.status || (runtime.up ? 'online' : enabled ? 'unknown' : 'disabled');
	let score = metricText(runtime.score_percent, '%');
	let failed = runtime.failed_checks == null ? _('Not measured') : String(runtime.failed_checks);
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
			renderPill(state, statusClass(state, runtime.up)),
			E('small', [ formatDisplayValue(runtime.tracking || runtime.status, _('unknown')), runtime.up ? _(' / netifd up') : _(' / netifd down') ])
		]),
		E('td', [
			E('strong', [ score ]),
			E('small', [ runtime.score_current == null ? _('unmeasured') : _('%s/%s score').format(runtime.score_current, runtime.score_max || '10') ]),
			E('small', [ _('%s failed, %d target(s)').format(failed, Number(runtime.failed_targets || 0)) ])
		]),
		E('td', [
			E('strong', [ method ]),
			E('small', [ _('down %s / up %s, reliability %s').format(section.down || '5', section.up || '5', section.reliability || '1') ]),
			E('small', [ quality ? _('SLA: %s').format(sla) : _('SLA: availability only') ])
		]),
		E('td', [ renderTargetSummary(section, runtime) ]),
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
					E('th', [ _('Score') ]),
					E('th', [ _('Probe / SLA') ]),
					E('th', [ _('Targets') ]),
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
			])
		])
	]));

	return E('div', { class: 'mwan4-routing' }, nodes);
}

function renderRules() {
	let allRules = rules();
	let defaultRules = allRules.filter(isGeneratedDefaultRule);
	let rows = allRules.filter(function(rule) { return !isGeneratedDefaultRule(rule); });
	let nodes;

	function defaultPolicySummary() {
		if (!defaultRules.length)
			return E('div');

		return E('div', { class: 'mwan4-alert mwan4-alert-info mwan4-alert-compact' }, [
			E('strong', [ _('Default routing') ]),
			E('p', [ defaultRules.map(function(rule) {
				return _('%s uses %s').format(rule.dest_ip || rule['.name'], formatPolicyPath(rule.use_strategy));
			}).join('; ') ])
		]);
	}

	if (!rows.length)
		return E('div', { class: 'mwan4-table mwan4-rules', role: 'region', 'aria-label': _('Traffic exceptions') }, [
			defaultPolicySummary(),
			renderEmptyState(
				_('No traffic exceptions yet.'),
				_('Most networks only need the default routing from the routing mode above. Add an exception only for guest Wi-Fi, VPN clients, video calls, or a specific service port.'),
				[ E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add traffic exception'), click: function() { return showRuleModal(null); } }, [ _('Add exception') ]) ]
			)
		]);

	nodes = [ defaultPolicySummary(), tableHeader([ _('Traffic exception'), _('Traffic'), _('Destination'), _('Routing mode'), _('Actions') ]) ];

	rows.forEach(function(rule) {
		let name = rule['.name'];
		let draft = ruleDraftFromSection(name);

		nodes.push(E('div', { class: 'mwan4-row', role: 'row' }, [
			tableCell(_('Traffic exception'), [
				E('strong', [ name ]),
				E('small', [ formatRuleSummary(draft) ])
			]),
			tableCell(_('Traffic'), [
				E('strong', [ formatRuleMatch(draft) ]),
				E('small', [ formatRuleOptions(draft) ])
			]),
			tableCell(_('Destination'), [
				E('strong', [ formatRuleDestination(draft) ]),
				E('small', [ draft.logging == '1' ? _('Logging enabled') : _('No logging') ])
			]),
			tableCell(_('Routing mode'), [
				E('strong', [ formatPolicyPath(draft.use_strategy) ]),
				E('small', [ describePathKind(draft.use_strategy) ])
			]),
			tableCell(_('Actions'), [
				E('button', { class: 'btn cbi-button cbi-button-edit', 'aria-label': _('Edit traffic exception %s').format(name), click: function() { return showRuleModal(name); } }, [ _('Edit') ])
			], { class: 'mwan4-actions' })
		]));
	});

	nodes.push(
		E('div', { class: 'mwan4-toolbar' }, [
			E('button', { class: 'btn cbi-button cbi-button-add', 'aria-label': _('Add traffic exception'), click: function() { return showRuleModal(null); } }, [ _('Add exception') ])
		])
	);

	return E('div', { class: 'mwan4-table mwan4-rules', role: 'table', 'aria-label': _('Traffic exceptions') }, nodes);
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
		E('section', { class: 'mwan4-panel', 'aria-labelledby': 'mwan4-rules-title' }, [
			E('h3', { id: 'mwan4-rules-title' }, [ _('Traffic exceptions') ]),
			renderRules()
		])
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
			L.resolveDefault(fs.stat('/usr/bin/nslookup'), {})
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

		poll.add(function() {
			let commandCenter = byId('mwan4-command-center');
			let wanWorkspace = byId('mwan4-wan-workspace');

			setBusy(commandCenter, true);
			setBusy(wanWorkspace, true);

			return Promise.all([
				L.resolveDefault(callStatus(), {}),
				L.resolveDefault(callStatus('counters'), {})
			]).then(function(results) {
				let result = results[0] || {};
				let counterResult = results[1] || {};

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
