'use strict';
'require form';
'require rpc';
'require ui';
'require uci';
'require view';
'require mwan4.common as mwan4Common';
'require mwan4.advanced as mwan4Advanced';
'require mwan4.fields as mwan4Fields';
'require mwan4.guide as mwan4Guide';

var E = mwan4Common.element;
/* global mwan4Common */
/* global mwan4Advanced */
/* global mwan4Fields */
/* global mwan4Guide */

const callDiagnostics = rpc.declare({
	object: 'mwan4',
	method: 'diagnostics',
	params: [ 'section' ],
	expect: { }
});

const callCapabilities = rpc.declare({
	object: 'mwan4',
	method: 'capabilities',
	expect: { }
});

const callAdvancedControl = rpc.declare({
	object: 'mwan4',
	method: 'advanced_control',
	params: [ 'action', 'interface', 'feature' ],
	expect: { }
});

const callSessionAccess = rpc.declare({
	object: 'session',
	method: 'access',
	params: [ 'scope', 'object', 'function' ],
	expect: { access: false }
});

let hasAdvancedAccess = false;
let supportedAdvancedActions = {};

mwan4Common.addStylesheet();

const formatDisplayValue = mwan4Common.formatDisplayValue;
const renderPill         = mwan4Common.renderPill;
const setBusy            = mwan4Common.setBusy;
const FEATURE_LABELS      = mwan4Advanced.FEATURE_LABELS;
const asArray             = mwan4Advanced.asArray;
const countItems          = mwan4Advanced.countItems;
const flagEnabled         = mwan4Advanced.flagEnabled;
const joinDisplayList     = mwan4Advanced.joinDisplayList;
const resultErrors        = mwan4Advanced.resultErrors;
const sanitizeSectionName = mwan4Advanced.sanitizeSectionName;
const validationFailures  = mwan4Advanced.validationFailures;
const validationSummary   = mwan4Advanced.validationSummary;

function diagnosticsPayload(result, section) {
	let diagnostics = (result || {}).diagnostics || result || {};
	return section ? diagnostics[section] || {} : diagnostics;
}

function validatePort(section_id, value) {
	if (value == null || value == '')
		return true;

	return /^([1-9][0-9]{0,4})$/.test(value) && Number(value) <= 65535
		? true
		: _('Use a TCP/UDP port from 1 to 65535.');
}

function strategyNames() {
	return uci.sections('mwan4', 'strategy').map(function(section) {
		return section['.name'];
	}).sort();
}

function validateStrategyReference(section_id, value) {
	if (value == null || value == '')
		return true;

	return strategyNames().indexOf(value) >= 0
		? true
		: _('Choose an existing path, or leave this empty until the path exists.');
}

function enabledMwanInterfaces(family) {
	return uci.sections('mwan4', 'interface').filter(function(section) {
		let families = asArray(section.family);

		return section.enabled != '0' && (!family || !families.length || families.indexOf(family) >= 0);
	}).map(function(section) {
		return section['.name'];
	}).sort();
}

function missingPbrSupportedInterfaces(config) {
	let supported = asArray(config.supported_interfaces);
	return enabledMwanInterfaces().filter(function(name) {
		return supported.indexOf(name) < 0;
	});
}

function shellSingleQuote(value) {
	return String(value || '').replace(/'/g, "'\"'\"'");
}

function setList(config, section, option, values) {
	values = asArray(values).map(function(value) { return String(value || '').trim(); }).filter(function(value) { return value != ''; });
	uci.set(config, section, option, values.length ? values : null);
}

function ensureSection(config, type, name) {
	if (!uci.get(config, name))
		uci.add(config, type, name);
}

function workflowValue(name) {
	let modal = document.querySelector('.modal');
	let node = modal ? modal.querySelector('[name="%s"]'.format(name)) : null;

	if (!node)
		return '';
	if (node.type == 'checkbox')
		return node.checked ? '1' : '0';

	return String(node.value || '').trim();
}

function workflowInput(label, name, value, attrs, help) {
	attrs = Object.assign({}, attrs || {});
	attrs.name = name;
	attrs.value = value || '';

	return E('label', { class: 'mwan4-modal-field' }, [
		E('span', [ label ]),
		E('input', attrs),
		help ? E('small', { class: 'mwan4-modal-help' }, [ help ]) : ''
	]);
}

function workflowSelect(label, name, values, selected, help) {
	return E('label', { class: 'mwan4-modal-field' }, [
		E('span', [ label ]),
		E('select', { name: name }, values.map(function(item) {
			let value = Array.isArray(item) ? item[0] : item;
			let text = Array.isArray(item) ? item[1] : item;
			return E('option', { value: value, selected: value == selected ? 'selected' : null }, [ text ]);
		})),
		help ? E('small', { class: 'mwan4-modal-help' }, [ help ]) : ''
	]);
}

function workflowCheck(label, name, checked, help) {
	return E('label', { class: 'mwan4-modal-check' }, [
		E('input', { type: 'checkbox', name: name, checked: checked ? 'checked' : null }),
		E('span', [ label ]),
		help ? E('small', { class: 'mwan4-modal-help' }, [ help ]) : ''
	]);
}

function workflowGroup(transports, fields) {
	return E('div', { class: 'mwan4-modal-grid', 'data-transports': transports.join(' ') }, fields);
}

function bindTransportGroups(modal) {
	let select = modal ? modal.querySelector('[name="transport"]') : null;
	if (!select)
		return;

	function update() {
		let transport = select.value || 'tunnel';
		modal.querySelectorAll('[data-transports]').forEach(function(group) {
			let allowed = String(group.getAttribute('data-transports') || '').split(/[ \t]+/);
			let visible = allowed.indexOf(transport) >= 0;

			group.hidden = !visible;
			group.querySelectorAll('input, select, textarea').forEach(function(field) {
				field.disabled = !visible;
			});
		});
	}

	select.addEventListener('change', update);
	update();
}

function saveWorkflow(configs, writer, successMessage, button) {
	if (button)
		button.disabled = true;

	try {
		writer();
	} catch (e) {
		if (button)
			button.disabled = false;
		ui.addNotification(null, E('p', [ e.message || e ]), 'danger');
		return Promise.resolve();
	}

	return uci.save().then(function() {
		return uci.apply(10);
	}).then(function() {
		ui.hideModal();
		ui.addNotification(null, E('p', [ successMessage ]), 'info');
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Configuration workflow failed: %s').format(e.message || e) ]), 'danger');
	}).then(function() {
		if (button)
			button.disabled = false;
	});
}

function setButtonBusy(button, busy) {
	if (!button)
		return;
	button.disabled = !!busy;
	setBusy(button, busy);
}

function showWireGuardKeypair(result) {
	ui.showModal(_('Generated WireGuard keypair'), [
		E('p', [ _('Copy the private key into the WireGuard tunnel workflow and send the public key to the peer. LuCI does not store these keys automatically.') ]),
		E('label', { class: 'mwan4-modal-field' }, [
			E('span', [ _('WireGuard private key') ]),
			E('textarea', { readonly: 'readonly', rows: '3' }, [ result.private_key || '' ])
		]),
		E('label', { class: 'mwan4-modal-field' }, [
			E('span', [ _('WireGuard public key') ]),
			E('textarea', { readonly: 'readonly', rows: '3' }, [ result.public_key || '' ])
		]),
		E('div', { class: 'right' }, [
			E('button', { class: 'btn cbi-button cbi-button-action', click: ui.hideModal }, [ _('Close') ])
		])
	], 'mwan4-modal');
}

function runControl(action, iface, feature, button, successMessage) {
	if (!hasAdvancedAccess || !supportedAdvancedActions[action]) {
		ui.addNotification(null, E('p', [ _('This action requires the luci-app-mwan4 advanced ACL and backend support for the requested action.') ]), 'warning');
		return Promise.resolve();
	}

	setButtonBusy(button, true);

	return callAdvancedControl(action, iface || undefined, feature || undefined).then(function(result) {
		if (result && result.ok === false)
			throw new Error(resultErrors(result, _('Control action failed.')));

		if (action == 'wireguard_keygen')
			showWireGuardKeypair(result || {});
		else
			ui.addNotification(null, E('p', [ successMessage || _('Control action completed.') ]), 'info');

		return result;
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Control action failed: %s').format(e.message || e) ]), 'danger');
	}).then(function() {
		setButtonBusy(button, false);
	});
}

function controlButton(label, action, iface, feature, successMessage, cls) {
	return E('button', {
		class:       'btn cbi-button ' + (cls || 'cbi-button-action'),
		'aria-busy': 'false',
		disabled:    hasAdvancedAccess && supportedAdvancedActions[action] ? null : 'disabled',
		click:       function(ev) { return runControl(action, iface, feature, ev.currentTarget, successMessage); }
	}, [ label ]);
}

function showWorkflowModal(title, description, fields, applyLabel, applyFn) {
	let returnFocus = document.activeElement;
	let close = function() {
		ui.hideModal();
		if (returnFocus && document.documentElement.contains(returnFocus))
			window.setTimeout(function() { returnFocus.focus(); }, 0);
	};

	ui.showModal(title, [
		E('p', [ description ]),
		E('div', { class: 'mwan4-modal-grid' }, fields),
		E('div', { class: 'right' }, [
			E('button', { class: 'btn cbi-button cbi-button-neutral', click: close }, [ _('Cancel') ]),
			' ',
			E('button', { class: 'btn cbi-button cbi-button-action', click: function(ev) { return applyFn(ev.currentTarget); } }, [ applyLabel ])
		])
	], 'mwan4-modal');

	let modal = document.querySelector('.modal.mwan4-modal');
	if (modal) {
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-label', title);
		modal.setAttribute('tabindex', '-1');
		window.setTimeout(function() { modal.focus(); }, 0);
	}

	return modal;
}

function pbrSupportedInterfaceCommands(missing) {
	return missing.map(function(name) {
		return "uci add_list pbr.config.supported_interface='%s'".format(shellSingleQuote(name));
	});
}

function networkInterfaceNames() {
	return uci.sections('network', 'interface').map(function(section) {
		return section['.name'];
	}).filter(function(name) { return !!name; }).sort();
}

function deviceNames() {
	let names = {};

	uci.sections('network', 'interface').forEach(function(section) {
		if (section.device)
			names[section.device] = true;
		if (section.ifname)
			names[section.ifname] = true;
	});

	uci.sections('mwan4', 'interface').forEach(function(section) {
		if (section.device)
			names[section.device] = true;
	});

	return Object.keys(names).sort();
}

function mwanInterfaceOptions() {
	return uci.sections('mwan4', 'interface').map(function(section) {
		return section['.name'];
	}).sort();
}

function pbrStrategyTargetOptions() {
	return strategyNames().map(function(name) {
		return [ 'mwan4_strategy_' + name, _('MultiWAN 4 path: %s').format(name) ];
	});
}

function showNetworkWorkflow() {
	let devices = deviceNames();
	showWorkflowModal(_('Provision WAN network'),
		_('Create netifd WAN interface sections and matching mwan4 tracking sections. Existing sections with the same names are updated.'), [
			workflowInput(_('Base name'), 'name', 'wan_new', { placeholder: 'wan_primary' }, _('Dual-stack mode creates base IPv4 and base6 IPv6 sections.')),
			workflowSelect(_('Address families'), 'family', [
				[ 'ipv4', _('IPv4 only') ],
				[ 'ipv6', _('IPv6 only') ],
				[ 'dual', _('IPv4 + IPv6') ]
			], 'ipv4'),
			workflowInput(_('Device'), 'device', devices[0] || '', { placeholder: 'eth1' }),
			workflowSelect(_('IPv4 protocol'), 'proto4', [ 'dhcp', 'static', 'pppoe' ], 'dhcp'),
			workflowInput(_('IPv4 address'), 'ipaddr', '', { placeholder: '198.51.100.2' }),
			workflowInput(_('IPv4 netmask'), 'netmask', '', { placeholder: '255.255.255.0' }),
			workflowInput(_('IPv4 gateway'), 'gateway', '', { placeholder: '198.51.100.1' }),
			workflowSelect(_('IPv6 protocol'), 'proto6', [ 'dhcpv6', 'static' ], 'dhcpv6'),
			workflowInput(_('IPv6 address'), 'ip6addr', '', { placeholder: '2001:db8:10::2/64' }),
			workflowInput(_('IPv6 gateway'), 'ip6gw', '', { placeholder: '2001:db8:10::1' }),
			workflowInput(_('Route metric'), 'metric', '10', { type: 'number', min: '1' }),
			workflowInput(_('Track targets'), 'track_ip', '1.1.1.1 8.8.8.8', { placeholder: '1.1.1.1 8.8.8.8' })
		], _('Apply network workflow'), function(button) {
			return saveWorkflow([ 'network', 'mwan4' ], function() {
				let base = sanitizeSectionName(workflowValue('name'), 'wan_new');
				let family = workflowValue('family') || 'ipv4';
				let device = workflowValue('device');
				let metric = workflowValue('metric') || '10';
				let targets = workflowValue('track_ip').split(/[ \t]+/).filter(function(value) { return value != ''; });

				if (!device)
					throw new Error(_('Device is required.'));

				if (family == 'ipv4' || family == 'dual') {
					ensureSection('network', 'interface', base);
					uci.set('network', base, 'device', device);
					uci.set('network', base, 'proto', workflowValue('proto4') || 'dhcp');
					uci.set('network', base, 'metric', metric);
					uci.set('network', base, 'ipaddr', workflowValue('ipaddr') || null);
					uci.set('network', base, 'netmask', workflowValue('netmask') || null);
					uci.set('network', base, 'gateway', workflowValue('gateway') || null);

					ensureSection('mwan4', 'interface', base);
					uci.set('mwan4', base, 'enabled', '1');
					setList('mwan4', base, 'family', [ 'ipv4' ]);
					setList('mwan4', base, 'track_ip', targets.length ? targets : [ '1.1.1.1', '8.8.8.8' ]);
				}

				if (family == 'ipv6' || family == 'dual') {
					let name6 = family == 'dual' ? base + '6' : base;
					ensureSection('network', 'interface', name6);
					uci.set('network', name6, 'device', device);
					uci.set('network', name6, 'proto', workflowValue('proto6') || 'dhcpv6');
					uci.set('network', name6, 'metric', String(Number(metric) + (family == 'dual' ? 1 : 0)));
					uci.set('network', name6, 'ip6addr', workflowValue('ip6addr') || null);
					uci.set('network', name6, 'ip6gw', workflowValue('ip6gw') || null);

					ensureSection('mwan4', 'interface', name6);
					uci.set('mwan4', name6, 'enabled', '1');
					setList('mwan4', name6, 'family', [ 'ipv6' ]);
					setList('mwan4', name6, 'track_ip', targets.length ? targets : [ '2606:4700:4700::1111' ]);
				}
			}, _('Network and mwan4 WAN sections were updated.'), button);
		});
}

function showTunnelWorkflow() {
	let strategies = strategyNames();
	let modal = showWorkflowModal(_('Configure tunnel workflow'),
		_('Create tunnel metadata in mwan4 and, when possible, create the matching netifd or daemon UCI section. Secrets and peer keys must be supplied by the operator.'), [
			workflowInput(_('Tunnel interface'), 'name', 'wg_wan', { placeholder: 'wg_wan' }),
			workflowSelect(_('Transport'), 'transport', [ 'wireguard', 'gre', 'ipip', 'sit', 'openvpn', 'ipsec', 'tunnel' ], 'wireguard'),
			workflowInput(_('Endpoint host'), 'endpoint_host', '', { placeholder: '198.51.100.10' }),
			workflowInput(_('Endpoint port'), 'endpoint_port', '', { placeholder: '51820' }),
			workflowInput(_('Local endpoint/source'), 'local_endpoint', '', { placeholder: '198.51.100.2' }),
			workflowSelect(_('Path for the tunnel endpoint'), 'underlay_strategy', strategies.length ? strategies : [ '' ], strategies[0] || ''),
			workflowGroup([ 'wireguard' ], [
				workflowInput(_('WireGuard private key'), 'private_key', '', { type: 'password', autocomplete: 'new-password' }),
				workflowInput(_('WireGuard peer public key'), 'public_key', '', { placeholder: _('peer public key') }),
				workflowInput(_('Tunnel addresses'), 'addresses', '', { placeholder: '10.10.10.2/32 fd00:10::2/128' }),
				workflowInput(_('Allowed IPs'), 'allowed_ips', '0.0.0.0/0 ::/0', { placeholder: '0.0.0.0/0 ::/0' })
			]),
			workflowGroup([ 'openvpn' ], [
				workflowInput(_('OpenVPN config path'), 'openvpn_config', '/etc/openvpn/client.conf', { placeholder: '/etc/openvpn/client.conf' })
			]),
			workflowGroup([ 'ipsec' ], [
				workflowInput(_('IPsec gateway'), 'ipsec_gateway', '', { placeholder: '198.51.100.10' }, _('Defaults to the endpoint host when left empty.'))
			]),
			workflowGroup([ 'gre', 'ipip', 'sit' ], [
				workflowInput(_('GRE/IPIP/SIT endpoint'), 'peeraddr', '', { placeholder: '198.51.100.10' }, _('Defaults to the endpoint host when left empty.'))
			])
		], _('Apply tunnel workflow'), function(button) {
			return saveWorkflow([ 'network', 'openvpn', 'ipsec', 'mwan4' ], function() {
				let name = sanitizeSectionName(workflowValue('name'), 'tunnel_wan');
				let transport = workflowValue('transport') || 'tunnel';
				let endpoint = workflowValue('endpoint_host');
				let endpointPort = workflowValue('endpoint_port');
				let local = workflowValue('local_endpoint');

				ensureSection('mwan4', 'interface', name);
				uci.set('mwan4', name, 'enabled', '1');
				uci.set('mwan4', name, 'type', 'tunnel');
				uci.set('mwan4', name, 'transport_type', transport);
				uci.set('mwan4', name, 'endpoint_host', endpoint || null);
				uci.set('mwan4', name, 'endpoint_port', endpointPort || null);
				uci.set('mwan4', name, 'local_endpoint', local || null);
				uci.set('mwan4', name, 'underlay_strategy', workflowValue('underlay_strategy') || null);
				uci.set('mwan4', name, 'prevent_recursion', '1');

				if (transport == 'wireguard') {
					let addresses = workflowValue('addresses').split(/[ \t]+/).filter(function(value) { return value != ''; });
					let allowed = workflowValue('allowed_ips').split(/[ \t]+/).filter(function(value) { return value != ''; });
					ensureSection('network', 'interface', name);
					uci.set('network', name, 'proto', 'wireguard');
					uci.set('network', name, 'private_key', workflowValue('private_key') || null);
					setList('network', name, 'addresses', addresses);
					let peer = 'wg_' + name;
					ensureSection('network', 'wireguard_' + name, peer);
					uci.set('network', peer, 'public_key', workflowValue('public_key') || null);
					uci.set('network', peer, 'endpoint_host', endpoint || null);
					uci.set('network', peer, 'endpoint_port', endpointPort || null);
					uci.set('network', peer, 'route_allowed_ips', '0');
					setList('network', peer, 'allowed_ips', allowed);
				} else if (transport == 'gre' || transport == 'ipip' || transport == 'sit') {
					ensureSection('network', 'interface', name);
					uci.set('network', name, 'proto', transport);
					uci.set('network', name, 'peeraddr', workflowValue('peeraddr') || endpoint || null);
					uci.set('network', name, 'ipaddr', local || null);
				} else if (transport == 'openvpn') {
					ensureSection('openvpn', 'openvpn', name);
					uci.set('openvpn', name, 'enabled', '1');
					uci.set('openvpn', name, 'config', workflowValue('openvpn_config') || null);
				} else if (transport == 'ipsec') {
					ensureSection('ipsec', 'remote', name);
					uci.set('ipsec', name, 'enabled', '1');
					uci.set('ipsec', name, 'gateway', workflowValue('ipsec_gateway') || endpoint || null);
					uci.set('ipsec', name, 'local_sourceip', local || null);
				}
			}, _('Tunnel metadata and external UCI sections were updated.'), button);
		});

	bindTransportGroups(modal);
}

function showPbrWorkflow() {
	let interfaces = mwanInterfaceOptions();
	let enabledInterfaces = enabledMwanInterfaces();
	let targets = pbrStrategyTargetOptions();
	showWorkflowModal(_('Configure PBR harmony'),
		_('Update luci-app-pbr configuration so PBR can target MultiWAN 4 paths without mark or interface drift.'), [
			workflowCheck(_('Enable PBR'), 'enabled', true),
			workflowSelect(_('IPv4 uplink'), 'uplink_interface', interfaces.length ? interfaces : [ '' ], interfaces[0] || ''),
			workflowSelect(_('IPv6 uplink'), 'uplink_interface6', interfaces.length ? interfaces : [ '' ], interfaces.find(function(name) { return /6$/.test(name); }) || interfaces[0] || ''),
			workflowCheck(_('Add all enabled mwan4 WAN links to supported_interface'), 'supported_all', true),
			workflowSelect(_('PBR policy target'), 'policy_target', targets.length ? targets : [ [ '', _('Create a path first') ] ], targets[0] ? targets[0][0] : ''),
			workflowInput(_('Policy name'), 'policy_name', 'mwan4_policy', { placeholder: 'work_vpn' }),
			workflowInput(_('Source address'), 'src_addr', '', { placeholder: '192.168.1.0/24' }),
			workflowInput(_('Destination address/domain'), 'dest_addr', '', { placeholder: 'example.com or 203.0.113.0/24' }),
			workflowSelect(_('Protocol'), 'proto', [ 'all', 'tcp', 'udp', 'icmp', 'icmpv6' ], 'all'),
			workflowInput(_('Source port'), 'src_port', '', { placeholder: _('any') }),
			workflowInput(_('Destination port'), 'dest_port', '', { placeholder: '443' })
		], _('Apply PBR workflow'), function(button) {
			return saveWorkflow([ 'pbr' ], function() {
				let uplink = workflowValue('uplink_interface');
				let uplink6 = workflowValue('uplink_interface6');
				let target = workflowValue('policy_target');
				let policy = sanitizeSectionName(workflowValue('policy_name'), 'mwan4_policy');

				if (!target)
					throw new Error(_('Create a path before applying a PBR policy target.'));

				ensureSection('pbr', 'pbr', 'config');
				uci.set('pbr', 'config', 'enabled', workflowValue('enabled'));
				uci.set('pbr', 'config', 'uplink_interface', uplink || null);
				uci.set('pbr', 'config', 'uplink_interface6', uplink6 || null);


				if (workflowValue('supported_all') == '1')
					setList('pbr', 'config', 'supported_interface', enabledInterfaces);

				ensureSection('pbr', 'policy', policy);
				uci.set('pbr', policy, 'name', policy);
				uci.set('pbr', policy, 'interface', target || null);
				uci.set('pbr', policy, 'src_addr', workflowValue('src_addr') || null);
				uci.set('pbr', policy, 'dest_addr', workflowValue('dest_addr') || null);
				uci.set('pbr', policy, 'proto', workflowValue('proto') || 'all');
				uci.set('pbr', policy, 'src_port', workflowValue('src_port') || null);
				uci.set('pbr', policy, 'dest_port', workflowValue('dest_port') || null);
			}, _('PBR configuration was updated.'), button);
		});
}

function showVrfWorkflow() {
	let devices = deviceNames();
	let interfaces = mwanInterfaceOptions();
	showWorkflowModal(_('Configure VRF domain'),
		_('Create a netifd VRF device, optional member device binding, and matching mwan4 table/mark ownership metadata.'), [
			workflowInput(_('VRF name'), 'vrf', 'vrf_wan', { placeholder: 'vrf_wan' }),
			workflowInput(_('Routing table'), 'table', '100', { type: 'number', min: '1' }),
			workflowSelect(_('Member device'), 'device', devices.length ? devices : [ '' ], devices[0] || ''),
			workflowSelect(_('mwan4 WAN link'), 'mwan', interfaces.length ? interfaces : [ '' ], interfaces[0] || ''),
			workflowInput(_('Firewall mark'), 'mark', '', { placeholder: '0x700' })
		], _('Apply VRF workflow'), function(button) {
			return saveWorkflow([ 'network', 'mwan4' ], function() {
				let vrf = sanitizeSectionName(workflowValue('vrf'), 'vrf_wan');
				let table = workflowValue('table') || '100';
				let device = workflowValue('device');
				let mwan = workflowValue('mwan');

				ensureSection('network', 'device', vrf);
				uci.set('network', vrf, 'type', 'vrf');
				uci.set('network', vrf, 'name', vrf);
				uci.set('network', vrf, 'table', table);

				if (device) {
					let member = sanitizeSectionName(device + '_vrf', 'vrf_member');
					ensureSection('network', 'device', member);
					uci.set('network', member, 'name', device);
					uci.set('network', member, 'master', vrf);
				}

				if (mwan) {
					ensureSection('mwan4', 'interface', mwan);
					uci.set('mwan4', mwan, 'table_id', table);
					uci.set('mwan4', mwan, 'mark', workflowValue('mark') || null);
				}
			}, _('VRF and mwan4 ownership metadata were updated.'), button);
		});
}

function showBfdWorkflow() {
	let interfaces = mwanInterfaceOptions();
	showWorkflowModal(_('Configure BFD visibility'),
		_('Enable FRR BFD daemon UCI state and attach BFD peer metadata to a mwan4 WAN link for diagnostics correlation.'), [
			workflowSelect(_('mwan4 WAN link'), 'mwan', interfaces.length ? interfaces : [ '' ], interfaces[0] || ''),
			workflowInput(_('BFD peer'), 'peer', '', { placeholder: '10.64.10.1' }),
			workflowInput(_('Minimum RX interval'), 'min_rx', '300', { type: 'number', min: '50' }),
			workflowInput(_('Minimum TX interval'), 'min_tx', '300', { type: 'number', min: '50' }),
			workflowInput(_('Detect multiplier'), 'multiplier', '3', { type: 'number', min: '1' })
		], _('Apply BFD workflow'), function(button) {
			return saveWorkflow([ 'frr', 'mwan4' ], function() {
				let mwan = workflowValue('mwan');
				let peer = workflowValue('peer');
				if (!peer)
					throw new Error(_('BFD peer is required.'));

				ensureSection('frr', 'bfdd', 'bfdd');
				uci.set('frr', 'bfdd', 'enabled', '1');
				ensureSection('frr', 'zebra', 'zebra');
				uci.set('frr', 'zebra', 'enabled', '1');

				if (mwan) {
					ensureSection('mwan4', 'interface', mwan);
					uci.set('mwan4', mwan, 'bfd_peer', peer);
					uci.set('mwan4', mwan, 'bfd_min_rx', workflowValue('min_rx') || '300');
					uci.set('mwan4', mwan, 'bfd_min_tx', workflowValue('min_tx') || '300');
					uci.set('mwan4', mwan, 'bfd_multiplier', workflowValue('multiplier') || '3');
				}
			}, _('FRR BFD and mwan4 BFD metadata were updated.'), button);
		});
}

function renderGuidanceCard(title, body, commands) {
	let nodes = [
		E('strong', [ title ]),
		E('p', Array.isArray(body) ? body : [ body ])
	];

	if (commands && commands.length)
		nodes.push(E('pre', { class: 'mwan4-copy-block', tabindex: '0' }, [ commands.join('\n') ]));

	return E('div', { class: 'mwan4-guidance-card' }, nodes);
}

function renderMetric(label, value, body, cls) {
	return E('div', { class: 'mwan4-insight-card' }, [
		E('span', [ label ]),
		E('strong', [ value ]),
		body ? E('small', [ body ]) : '',
		cls ? renderPill(value, cls) : ''
	]);
}

function renderIntegrationPanel(title, eyebrow, summary, metrics, actions, guidance) {
	return E('section', { class: 'mwan4-diag-section mwan4-advanced-surface' }, [
		E('div', { class: 'mwan4-surface-heading' }, [
			E('span', { class: 'mwan4-eyebrow' }, [ eyebrow ]),
			E('h3', [ title ]),
			E('p', [ summary ])
		]),
		E('div', { class: 'mwan4-insight-grid' }, metrics),
		guidance && guidance.length ? E('div', { class: 'mwan4-guidance-grid' }, guidance) : '',
		E('div', { class: 'mwan4-actions' }, actions)
	]);
}

function warningCount(section) {
	return countItems(asArray((section || {}).warnings));
}

function featureData(packages, feature) {
	return ((packages || {}).features || {})[feature] || { ready: false, packages: [] };
}

function capabilityFeatureKeys(capabilities, packages) {
	let features = {};
	Object.keys(((capabilities || {}).packages || {}).features || {}).forEach(function(feature) { features[feature] = true; });
	Object.keys((packages || {}).features || {}).forEach(function(feature) { features[feature] = true; });
	asArray(((capabilities || {}).advanced_control || {}).features).forEach(function(feature) { features[feature] = true; });
	return Object.keys(features).sort();
}

function renderFeatureCard(packages, feature) {
	let data = featureData(packages, feature);
	let names = asArray(data.packages).map(function(pkg) { return pkg.name || pkg.package || pkg; });
	return renderGuidanceCard(FEATURE_LABELS[feature] || feature,
		data.ready
			? _('Installed packages: %s').format(joinDisplayList(names, _('None reported')))
			: _('Missing one or more packages: %s').format(joinDisplayList(names, _('No package list reported'))));
}

function renderPackageReadiness(packages, capabilities) {
	let features = capabilityFeatureKeys(capabilities, packages);
	let ready = features.filter(function(feature) { return featureData(packages, feature).ready; }).length;
	let canInstall = hasAdvancedAccess && supportedAdvancedActions.install_feature;

	return renderIntegrationPanel(_('Package readiness'), _('Packages'),
		_('Install only allowlisted feature bundles needed by advanced workflows. Package names are fixed by mwan4 backend controls.'), [
			renderMetric(_('Package manager'), formatDisplayValue((packages || {}).manager, _('Not detected')), _('apk or opkg detected by backend diagnostics')),
			renderMetric(_('Ready features'), _('%d / %d').format(ready, features.length), _('Feature bundles with all packages installed')),
			renderMetric(_('Missing packages'), String(countItems((packages || {}).missing)), _('Packages needed by configured advanced workflows'))
		], features.map(function(feature) {
			return E('button', {
				class:       'btn cbi-button cbi-button-neutral',
				'aria-busy': 'false',
				disabled:    canInstall ? null : 'disabled',
				click:       function(ev) {
					return runControl('install_feature', null, feature, ev.currentTarget,
						_('Feature packages were installed. Run diagnostics again to refresh package readiness.'));
				}
			}, [ _('Install %s').format(FEATURE_LABELS[feature] || feature) ]);
		}), features.map(function(feature) { return renderFeatureCard(packages, feature); }));
}

function renderAdvancedStatus(result, capabilities) {
	let diagnostics = diagnosticsPayload(result);
	let tunnels = diagnostics.tunnels || {};
	let mptcp = diagnostics.mptcp || {};
	let pbr = diagnostics.pbr || {};
	let packages = diagnostics.packages || {};
	let probes = diagnostics.probes || {};
	let bfd = probes.bfd || {};
	let bfdValidation = asArray(bfd.configured).map(function(row) {
		return Object.assign({}, row, {
			ok:     row.live_match !== false,
			action: _('Reload FRR after configuring BFD, then verify the peer is reachable on the selected WAN.')
		});
	});
	let vrf = diagnostics.vrf || {};
	let ownership = diagnostics.ownership || {};
	let quality = diagnostics.quality || {};
	let pbrConfig = pbr.config || {};
	let pbrEnabled = flagEnabled(pbrConfig.enabled);
	let pbrMissingSupported = pbrEnabled ? missingPbrSupportedInterfaces(pbrConfig) : [];
	let probeSummary = probes.summary || {};
	let qualitySummary = quality.summary || {};

	return E('div', { class: 'mwan4-advanced-overview' }, [
		renderPackageReadiness(packages, capabilities),
		renderIntegrationPanel(_('Tunnel steering'), _('Tunnels'),
			_('Configure tunnel metadata on WAN links so mwan4 can keep tunnel endpoints on physical underlays and warn about recursion.'), [
				renderMetric(_('Configured tunnels'), String(countItems(tunnels.interfaces)), _('Interfaces carrying tunnel metadata')),
				renderMetric(_('Endpoint warnings'), String(warningCount(tunnels)), _('Underlay recursion or endpoint route warnings')),
				renderMetric(_('Tunnel endpoint paths'), String(strategyNames().length), _('Paths available for tunnel endpoint traffic'))
			], [
				E('button', { class: 'btn cbi-button cbi-button-action', click: showTunnelWorkflow }, [ _('Configure tunnel') ]),
				controlButton(_('Generate WireGuard key'), 'wireguard_keygen', null, null, null, 'cbi-button-neutral'),
				controlButton(_('Apply endpoint exemptions'), 'apply_tunnel_exemptions', null, null, _('Tunnel endpoint host-route exemptions were applied.'), 'cbi-button-action'),
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open tunnel diagnostics') ])
			], [
				renderGuidanceCard(_('Metadata and integration writes'), _('Choosing a tunnel transport writes type=tunnel plus transport_type in mwan4, and the workflow writes only the external UCI section needed by that selected transport.')),
				renderGuidanceCard(_('Underlay validation'), _('The tunnel endpoint path field accepts existing paths so diagnostics can check endpoint recursion against physical WAN links.')),
				renderGuidanceCard(_('Endpoint exemptions'), _('Host-route exemptions are applied only for numeric tunnel endpoints with a resolved physical underlay WAN.'))
			]),
		renderIntegrationPanel(_('MPTCP'), _('Multipath TCP'),
			_('MPTCP endpoints and subflow limits are kernel/iproute2 state. Use this workspace to align mwan4 source routing and verify the live MPTCP state.'), [
				renderMetric(_('Kernel state'), mptcp.available ? _('Available') : _('Not reported'), _('MPTCP support detected by diagnostics')),
				renderMetric(_('Endpoints'), String(countItems(mptcp.endpoint_details || mptcp.endpoints)), _('signal, subflow, backup, and fullmesh roles')),
				renderMetric(_('Warnings'), String(warningCount(mptcp)), _('Endpoint or kernel issues'))
			], [
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/mptcp') }, [ _('Open MPTCP') ]),
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open MPTCP diagnostics') ])
			]),
		renderIntegrationPanel(_('BFD and advanced probes'), _('Health'),
			_('Configure mwan4 probe helpers and SLA thresholds below. BFD sessions are owned by FRR, while mwan4 diagnostics correlates fast failure signals with probe health.'), [
				renderMetric(_('Probe targets'), String(probeSummary.targets || 0), _('Live targets sampled by mwan4 trackers')),
				renderMetric(_('BFD sessions'), String(bfd.session_count || countItems(bfd.sessions)), bfd.available ? _('FRR BFD readback is available') : _('FRR vtysh is not available')),
				renderMetric(_('Probe warnings'), String(warningCount(probes) + warningCount(quality) + warningCount(bfd)), _('Missing helpers, BFD sessions, or unhealthy targets'))
			], [
				E('button', { class: 'btn cbi-button cbi-button-action', click: showBfdWorkflow }, [ _('Configure BFD') ]),
				controlButton(_('Apply FRR/BFD'), 'apply_bfd', null, null, _('FRR was reloaded for BFD state.'), 'cbi-button-action'),
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open probe diagnostics') ])
			], [
				renderGuidanceCard(_('BFD validation'), validationSummary(bfdValidation, _('No configured BFD metadata reported yet.')))
			]),
			renderIntegrationPanel(_('VRF and ownership'), _('Routing domains'),
			_('Keep mwan4 table IDs and marks explicit before combining VRFs, source routing, and generated routing rules.'), [
				renderMetric(_('VRF devices'), String(countItems(vrf.devices)), _('VRF links reported by iproute2')),
				renderMetric(_('Owned tables'), String(countItems(ownership.tables)), _('Routing tables owned by mwan4')),
				renderMetric(_('Validation failures'), String(validationFailures(vrf.validation)), _('VRF live checks that need attention'))
			], [
				E('button', { class: 'btn cbi-button cbi-button-action', click: showNetworkWorkflow }, [ _('Provision WAN') ]),
				E('button', { class: 'btn cbi-button cbi-button-action', click: showVrfWorkflow }, [ _('Configure VRF') ]),
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open ownership diagnostics') ])
			], [
				renderGuidanceCard(_('VRF live validation'), validationSummary(vrf.validation, _('No VRF validation rows reported yet.')))
			]),
			renderIntegrationPanel(_('PBR harmony'), _('PBR'),
			_('PBR is configured by luci-app-pbr, but mwan4 can verify marks, rule priorities, IPv6 uplinks, and supported-interface coverage.'), [
				renderMetric(_('PBR service'), pbr.service_running ? _('Running') : _('Not running'), _('Runtime state reported by service ubus')),
				renderMetric(_('IPv6 uplink'), formatDisplayValue(pbrConfig.uplink_interface6, _('Not configured')), _('PBR IPv6 policy routing target')),
				renderMetric(_('PBR warnings'), String(warningCount(pbr)), _('Mark, table, or uplink conflicts'))
			], [
				E('button', { class: 'btn cbi-button cbi-button-action', click: showPbrWorkflow }, [ _('Configure PBR') ]),
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/services/pbr') }, [ _('Open PBR') ]),
				E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open PBR diagnostics') ])
			], [
				renderGuidanceCard(_('Path target helper'), strategyNames().length
					? _('PBR policy targets must use MultiWAN 4 path names: %s. WAN links themselves are uplinks, not policy targets.').format(joinDisplayList(strategyNames().map(function(name) { return 'mwan4_strategy_' + name; }), _('No paths configured')))
					: _('Create a path before wiring PBR policies to a MultiWAN 4 target.')),
				renderGuidanceCard(_('PBR validation'), validationSummary(pbr.validation, _('No PBR validation rows reported yet.'))),
				renderGuidanceCard(_('Supported-interface helper'), pbrEnabled
					? (pbrMissingSupported.length
						? _('PBR supported_interface is missing enabled mwan4 WAN links: %s. Review in luci-app-pbr before applying any copied commands.').format(pbrMissingSupported.join(', '))
						: _('PBR supported_interface covers enabled mwan4 WAN links reported by diagnostics.'))
					: _('PBR is not enabled; open luci-app-pbr before adding supported-interface coverage.'),
					pbrSupportedInterfaceCommands(pbrMissingSupported))
			])
	]);
}

function addTunnelOptions(s) {
	let o = s.option(form.ListValue, 'transport_type', _('Link type'));

	o.value('', _('Physical WAN'));
	o.value('tunnel', _('Generic tunnel'));
	o.value('gre', _('GRE'));
	o.value('ipip', _('IPIP'));
	o.value('sit', _('SIT'));
	o.value('wireguard', _('WireGuard'));
	o.value('openvpn', _('OpenVPN'));
	o.value('ipsec', _('IPsec'));
	o.description = _('Tells MultiWAN 4 whether this WAN link is a tunnel, so diagnostics can explain the tunnel and the connection under it. Choosing a tunnel type also marks the link as a tunnel. If left on Physical WAN, the link is treated as a normal connection.');
	o.rmempty = false;
	o.cfgvalue = function(section_id) {
		return uci.get('mwan4', section_id, 'transport_type') ||
			(uci.get('mwan4', section_id, 'type') == 'tunnel' ? 'tunnel' : '');
	};
	o.write = function(section_id, value) {
		if (value) {
			uci.set('mwan4', section_id, 'type', 'tunnel');
			uci.set('mwan4', section_id, 'transport_type', value);
		} else {
			uci.set('mwan4', section_id, 'type', null);
			uci.set('mwan4', section_id, 'transport_type', null);
		}
	};

	o = s.option(form.Value, 'underlay_strategy', _('Path for the tunnel endpoint'));
	o.placeholder = _('a path over regular WAN links');
	strategyNames().forEach(function(strategy) { o.value(strategy); });
	o.validate = validateStrategyReference;
	o.description = _('The path that carries the packets of the tunnel itself to its remote end. Choose a path over regular WAN links, never one through the tunnel. If left empty, diagnostics cannot check where the tunnel endpoint is routed.');

	o = s.option(form.Value, 'endpoint_host', _('Tunnel endpoint host'));
	o.placeholder = '198.51.100.10';
	o.datatype = 'host';
	o.description = _('Remote address or name of the tunnel, used to check that the tunnel does not route its own packets through itself. If left empty, the endpoint cannot be checked.');
	o.modalonly = true;

	o = s.option(form.Value, 'endpoint_port', _('Tunnel endpoint port'));
	o.placeholder = '51820';
	o.validate = validatePort;
	o.description = _('Remote port of the tunnel, for example 51820 for WireGuard. If left empty, only the host is checked.');
	o.modalonly = true;

	o = s.option(form.Value, 'local_endpoint', _('Local tunnel address'));
	o.placeholder = _('optional source address');
	o.datatype = 'ipaddr';
	o.description = _('Address this router uses as the start of the tunnel. If left empty, the router picks it.');
	o.modalonly = true;

	[ [ 'endpoint_fail_mode', _('When the tunnel endpoint cannot be reached'), _('Hold tunnel traffic') ],
	  [ 'data_fail_mode', _('When the tunnel stops carrying data'), _('Hold data traffic') ] ].forEach(function(spec) {
		o = s.option(form.ListValue, spec[0], spec[1]);
		o.value('', _('Use the default'));
		o.value('hold', spec[2]);
		o.value('fail_open', _('Let traffic use another path'));
		o.value('fail_closed', _('Stop the traffic'));
		o.description = _('A note diagnostics shows about what should happen then. It does not change routing by itself. If left on Use the default, no particular behaviour is noted.');
		o.modalonly = true;
	});

	o = s.option(form.Flag, 'prevent_recursion', _('Warn about tunnel loops'));
	o.description = _('Warn when the tunnel endpoint would be routed through the tunnel itself. On by default.');
	o.default = '1';
	o.modalonly = true;
}

function addInterfaceAdvancedSection(m, helpers) {
	let s = m.section(form.GridSection, 'interface', _('Advanced WAN link settings'));

	s.addremove = false;
	s.anonymous = false;
	s.nodescriptions = true;
	s.description = _('Use these fields for tunnels, extra health check tools, latency and loss limits, and fixed marks and routing tables.');

	addTunnelOptions(s);
	mwan4Fields.addHealthOptions(s, form, helpers, [ 'track_method', 'track_ip', 'check_quality' ]);
	mwan4Fields.addIdentityOptions(s, form, [ 'table_id' ]);
}

function addGlobalAdvancedSection(m) {
	let s = m.section(form.NamedSection, 'globals', 'globals', _('Global advanced settings'));

	s.description = _('These settings apply to every WAN link, routing rule and hand-over to PBR or VRF routing domains.');
	mwan4Fields.addGlobalOptions(s, form, _('Keep it separate from the PBR fw_mask.'));
}

return view.extend({
	load: function() {
		return Promise.all([
			mwan4Fields.loadHelpers(),
			uci.load('mwan4'),
			L.resolveDefault(uci.load('network'), null),
			L.resolveDefault(uci.load('pbr'), null),
			L.resolveDefault(uci.load('frr'), null),
			L.resolveDefault(uci.load('openvpn'), null),
			L.resolveDefault(uci.load('ipsec'), null),
			L.resolveDefault(callDiagnostics('all'), {}),
			L.resolveDefault(callCapabilities(), {}),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-advanced', 'write'), false)
		]);
	},

	render: function(data) {
		let diagnostics = data[7] || {};
		let capabilities = data[8] || {};
		hasAdvancedAccess = !!data[9];
		supportedAdvancedActions = {};
		asArray(((capabilities || {}).advanced_control || {}).actions).forEach(function(action) {
			supportedAdvancedActions[action] = true;
		});
		let m = new form.Map('mwan4', _('MultiWAN 4 - Advanced'), E('div', [
			mwan4Guide.intro(
				_('Advanced settings cover tunnels, extra health-check tools and the hand-over to PBR, MPTCP, VRF and FRR/BFD setups.'),
				_('Most changes are easier on the overview: add WAN links and routing rules there, and keep this page for tunnels and integrations.')),
			renderAdvancedStatus(diagnostics, capabilities)
		]));

		addInterfaceAdvancedSection(m, data[0]);
		addGlobalAdvancedSection(m);

		return m.render();
	}
});
