'use strict';
'require rpc';
'require ui';
'require view';
'require mwan4.common as mwan4Common';
'require mwan4.connections as mwan4Connections';
'require mwan4.diagnostics as mwan4Diagnostics';
/* global mwan4Common */
/* global mwan4Connections */
/* global mwan4Diagnostics */

const callDiagnostics = rpc.declare({
	object: 'mwan4',
	method: 'diagnostics',
	params: [ 'section', 'interface' ],
	expect: { }
});

const callControl = rpc.declare({
	object: 'mwan4',
	method: 'control',
	params: [ 'action' ],
	expect: { }
});

const callRouteExplainDiagnostics = rpc.declare({
	object: 'mwan4',
	method: 'diagnostics',
	params: [ 'section', 'interface', 'family', 'src_ip', 'dest_ip', 'proto', 'src_port', 'dest_port', 'src_iface', 'ipset', 'strategy' ],
	expect: { }
});

const callSessionAccess = rpc.declare({
	object: 'session',
	method: 'access',
	params: [ 'scope', 'object', 'function' ],
	expect: { access: false }
});

let hasDiagnosticsAccess = false;
let hasCounterResetAccess = false;

mwan4Common.addStylesheet();

const formatDisplayValue = mwan4Common.formatDisplayValue;
const setBusy            = mwan4Common.setBusy;
const asArray               = mwan4Diagnostics.asArray;
const boolText              = mwan4Diagnostics.boolText;
const countItems            = mwan4Diagnostics.countItems;
const diagnosticIssueRows   = mwan4Diagnostics.diagnosticIssueRows;
const familyRows            = mwan4Diagnostics.familyRows;
const firstValue            = mwan4Diagnostics.firstValue;
const joinList              = mwan4Diagnostics.joinList;
const objectEntries         = mwan4Diagnostics.objectEntries;
const renderAdvancedSurface = mwan4Diagnostics.renderAdvancedSurface;
const renderInsightCard     = mwan4Diagnostics.renderInsightCard;
const renderInsightGrid     = mwan4Diagnostics.renderInsightGrid;
const renderKeyValues       = mwan4Diagnostics.renderKeyValues;
const renderRecordsTable    = mwan4Diagnostics.renderRecordsTable;
const renderWorkflowSteps   = mwan4Diagnostics.renderWorkflowSteps;
const warningRows           = mwan4Diagnostics.warningRows;

function eventButton(ev) {
	return ev && ev.currentTarget ? ev.currentTarget : null;
}

function setButtonBusy(button, busy) {
	if (!button)
		return;

	button.disabled = !!busy;
	setBusy(button, busy);
}

function hasDiagnosticData(value) {
	if (value == null || value === '')
		return false;
	if (Array.isArray(value))
		return value.length > 0;
	if (typeof value == 'object')
		return Object.keys(value).length > 0;
	return true;
}

function namedRows(value, nameKey) {
	if (Array.isArray(value))
		return value;

	return objectEntries(value, nameKey);
}

function routeText(value) {
	if (value && typeof value == 'object' && !Array.isArray(value))
		return firstValue(value, [ 'raw', 'route', 'device', 'table' ], _('No route'));

	return formatDisplayValue(value, _('No route'));
}

function routeExplainInput(label, name, value, attrs) {
	attrs = Object.assign({
		type:     'text',
		name:     name,
		value:    value || '',
		disabled: hasDiagnosticsAccess ? null : 'disabled'
	}, attrs || {});

	return E('label', { class: 'mwan4-modal-field' }, [
		E('span', [ label ]),
		E('input', attrs)
	]);
}

function routeExplainSelect(label, name, options, selected) {
	return E('label', { class: 'mwan4-modal-field' }, [
		E('span', [ label ]),
		E('select', { name: name, disabled: hasDiagnosticsAccess ? null : 'disabled' }, options.map(function(option) {
			return E('option', { value: option[0], selected: selected == option[0] ? 'selected' : null }, [ option[1] ]);
		}))
	]);
}

function routeExplainFieldValue(name) {
	let form  = document.getElementById('mwan4-route-explain-form');
	let field = form ? form.querySelector('[name="' + name + '"]') : null;

	return field ? String(field.value || '').trim() : '';
}

function routeExplainEndpoint(address, port) {
	if (address && port)
		return address + ':' + port;
	if (address)
		return address;
	if (port)
		return '*:' + port;
	return '*';
}

function routeExplainTupleLabel(tuple) {
	tuple = tuple || {};

	let family = tuple.family || 'any-family';
	let proto  = tuple.proto || 'any-protocol';
	let source = routeExplainEndpoint(tuple.src_ip, tuple.src_port);
	let dest   = routeExplainEndpoint(tuple.dest_ip, tuple.dest_port);

	return family + ' ' + proto + ' ' + source + ' -> ' + dest;
}

function readRouteExplainTuple() {
	let tuple = {};

	[ 'family', 'proto', 'src_ip', 'src_port', 'dest_ip', 'dest_port', 'src_iface', 'ipset', 'strategy' ].forEach(function(name) {
		let value = routeExplainFieldValue(name);
		if (value)
			tuple[name] = value;
	});

	if (tuple.proto)
		tuple.proto = tuple.proto.toLowerCase();

	tuple.query_tuple = routeExplainTupleLabel(tuple);

	return tuple;
}

function renderDiagnosticsWarnings(data) {
	let warnings = diagnosticIssueRows(data);

	if (!warnings.length)
		return E('div');

	return E('div', { class: 'mwan4-alert mwan4-alert-warning mwan4-alert-compact', role: 'alert' }, [
		E('strong', [ _('Attention needed') ]),
		E('ul', warnings.slice(0, 8).map(function(warning) {
			return E('li', [ E('strong', [ warning.severity + ': ' ]), formatDisplayValue(warning.message) ]);
		}))
	]);
}

function renderRouteExplainRequest(tuple) {
	tuple = tuple || {};

	return renderKeyValues(_('Requested tuple'), [
		[ _('Query tuple'), tuple.query_tuple || routeExplainTupleLabel(tuple) ],
		[ _('Family'), tuple.family || _('Any family') ],
		[ _('Protocol'), tuple.proto || _('Any protocol') ],
		[ _('Source address'), tuple.src_ip || _('Any source') ],
		[ _('Source port'), tuple.src_port || _('Any source port') ],
		[ _('Ingress interface'), tuple.src_iface || _('Any ingress') ],
		[ _('Destination address'), tuple.dest_ip || _('Any destination') ],
		[ _('Destination port'), tuple.dest_port || _('Any destination port') ],
		[ _('DNS or nft set'), tuple.ipset || _('No set') ],
		[ _('Strategy override'), tuple.strategy || _('Matched policy strategy') ]
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

function counterItems(counters) {
	counters = counters || {};
	return counters.items || counters.counters || counters.raw || {};
}

function counterGroup(name, counter) {
	let type = counter && (counter.group || counter.type || counter.kind);

	if (type)
		return type;
	if (name.indexOf('_counter_rule_') > -1)
		return 'rules';
	if (name.indexOf('_counter_strategy_') > -1)
		return 'strategies';
	if (name.indexOf('_counter_iface_') > -1)
		return 'interfaces';
	if (name.indexOf('pbr') > -1)
		return 'pbr';
	if (name.indexOf('tunnel') > -1)
		return 'tunnels';

	return 'other';
}

function groupedCounterSummary(counters) {
	let items = counterItems(counters);
	let names = Object.keys(items).sort();
	let groups = {};
	let providedSummary = counters.summary || {};
	let summary = { total: names.length, packets: 0, bytes: 0 };

	names.forEach(function(name) {
		let counter = items[name] || {};
		let group = counterGroup(name, counter);

		groups[group] = groups[group] || { count: 0, packets: 0, bytes: 0 };
		groups[group].count++;
		groups[group].packets += Number(counter.packets || 0);
		groups[group].bytes += Number(counter.bytes || 0);
		summary.packets += Number(counter.packets || 0);
		summary.bytes += Number(counter.bytes || 0);
	});

	summary = Object.assign(summary, providedSummary);

	return { groups: groups, items: items, names: names, summary: summary };
}

function counterReferenceRows(references) {
	references = references || {};
	return Object.keys(references).sort().map(function(name) {
		return {
			counter:    name,
			references: asArray(references[name])
		};
	});
}

function renderGroupedCounters(counters) {
	counters = counters || {};
	let grouped = groupedCounterSummary(counters);
	let groups = Object.keys(grouped.groups).sort();
	let references = counterReferenceRows(counters.references);
	let missingReferences = asArray(counters.missing_references);
	let rows = grouped.names.slice(0, 25).map(function(name) {
		let counter = grouped.items[name] || {};
		return E('tr', [
			E('td', [ counterGroup(name, counter) ]),
			E('td', [ name ]),
			E('td', [ String(counter.packets || 0) ]),
			E('td', [ String(counter.bytes || 0) ])
		]);
	});

	if (grouped.names.length > rows.length)
		rows.push(E('tr', [
			E('td', { colspan: 4 }, [ _('%d more counter(s) hidden; open Raw RPC response for the full list.').format(grouped.names.length - rows.length) ])
		]));

	return renderAdvancedSurface(_('Grouped counters'), _('Counters'), _('Counters are grouped by rules, strategies, WAN links, PBR, tunnels, and other runtime owners so policy hits are easier to audit.'), [
		renderDiagnosticsWarnings(counters),
		renderInsightGrid([
			[ _('Total counters'), String(grouped.summary.total || grouped.names.length), _('All reported counter objects') ],
			[ _('Packets'), String(grouped.summary.packets || 0), _('Matched packets across groups') ],
			[ _('Bytes'), String(grouped.summary.bytes || 0), _('Matched bytes across groups') ],
			[ _('Counter references'), String(grouped.summary.referenced || references.length), _('nft rules that reference named counters') ]
		]),
		E('div', { class: 'mwan4-actions' }, [
			E('button', {
				class:       'btn cbi-button cbi-button-reset',
				'aria-busy': 'false',
				disabled:    hasCounterResetAccess ? null : 'disabled',
				click:       function(ev) { return resetCounters(eventButton(ev)); }
			}, [ _('Reset nft counters') ])
		]),
		missingReferences.length ? E('div', { class: 'mwan4-alert mwan4-alert-warning mwan4-alert-compact', role: 'alert' }, [
			E('strong', [ _('Missing counter definitions') ]),
			E('p', [ _('Some nft rules reference counters that were not reported by nft list counters.') ]),
			E('code', [ missingReferences.map(function(item) { return formatDisplayValue(item); }).join(', ') ])
		]) : '',
		groups.length ? E('div', { class: 'mwan4-counter-groups' }, groups.map(function(group) {
			let item = grouped.groups[group];
			return renderInsightCard(group, _('%d counter(s)').format(item.count), _('%d packets / %d bytes').format(item.packets, item.bytes));
		})) : E('p', [ _('No mwan4 counters reported. Generate traffic that should match a traffic policy, then run Counters again.') ]),
		grouped.names.length ? E('table', { class: 'table mwan4-counter-table mwan4-diag-table' }, [
			E('tr', [ E('th', [ _('Group') ]), E('th', [ _('Counter') ]), E('th', [ _('Packets') ]), E('th', [ _('Bytes') ]) ])
		].concat(rows)) : '',
		renderRecordsTable(_('Counter references'), [
			[ _('Counter'), 'counter' ],
			[ _('References'), function(row) { return _('%d rule reference(s)').format(row.references.length); } ],
			[ _('Chains'), function(row) { return joinList(row.references.map(function(ref) { return ref.chain; }), _('No chain')); } ]
		], references, _('No nft rule counter references were reported.'))
	]);
}

function resetCounters(button) {
	if (!hasCounterResetAccess)
		return Promise.resolve();

	setButtonBusy(button, true);

	return callControl('reset_counters').then(function(result) {
		if (result && result.ok === false)
			throw new Error((result.errors || []).map(function(error) { return error.message || error.code; }).join('; ') || _('Counter reset failed'));

		ui.addNotification(null, E('p', [ _('nft counters were reset. Running Counters again...') ]), 'info');
		return run('counters', null);
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Counter reset failed: %s').format(e.message || e) ]), 'danger');
	}).then(function() {
		setButtonBusy(button, false);
	});
}

function renderMptcpDiagnostics(mptcp) {
	mptcp = mptcp || {};
	let endpoints = firstValue(mptcp, [ 'endpoint_details', 'endpoints', 'endpoint', 'per_wan', 'interfaces' ], []);
	let limits = mptcp.limits_detail || {};
	let sysctls = mptcp.sysctls || mptcp.sysctl || {};
	let limitRows = objectEntries(limits, 'limit');
	let alignmentRows = firstValue(mptcp, [ 'source_routes', 'route_alignment', 'alignment', 'routes' ], []);

	return renderAdvancedSurface(_('MPTCP workflow'), _('MPTCP'), _('Validate kernel support, endpoint roles, subflow limits, and source-route alignment before expecting multipath sessions to use every WAN.'), [
		renderDiagnosticsWarnings(mptcp),
		renderInsightGrid([
			[ _('Kernel state'), mptcp.available === false ? _('Unavailable') : firstValue(mptcp, [ 'enabled', 'kernel_enabled', 'state', 'status' ], _('Unknown')), _('MPTCP must be enabled before endpoints matter') ],
			[ _('Enabled'), mptcp.enabled_bool == null ? firstValue(mptcp, [ 'enabled', 'kernel_enabled' ], _('Unknown')) : boolText(mptcp.enabled_bool), _('Kernel net.mptcp.enabled value') ],
			[ _('Endpoint roles'), _('%d endpoint(s)').format(countItems(endpoints)), _('signal, subflow, backup, and fullmesh flags') ],
			[ _('Subflow limit'), firstValue(limits, [ 'subflows', 'subflow', 'subflow_limit' ], sysctls['net.mptcp.subflows'] || sysctls['net.mptcp.subflow'] || _('Not reported')), _('Maximum additional subflows') ]
		]),
		renderRecordsTable(_('WAN endpoint roles'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'device', 'interface', 'wan', 'name', 'dev' ], _('Unknown WAN')); } ],
			[ _('Address'), function(row) { return firstValue(row, [ 'address', 'addr', 'ip', 'endpoint' ], _('Not reported')); } ],
			[ _('Role'), function(row) { return joinList(asArray(firstValue(row, [ 'flags', 'roles', 'role', 'mode' ], [])), _('No role flags')); } ],
			[ _('ID'), function(row) { return firstValue(row, [ 'id', 'endpoint_id' ], _('Not reported')); } ]
		], endpoints, _('No MPTCP endpoints were reported.')),
		renderRecordsTable(_('MPTCP limits'), [
			[ _('Limit'), function(row) { return firstValue(row, [ 'limit', 'name' ], _('Unnamed limit')); } ],
			[ _('Value'), function(row) { return firstValue(row, [ 'value' ], _('Not reported')); } ]
		], limitRows, _('No MPTCP limits were reported.')),
		renderRecordsTable(_('MPTCP route alignment'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'wan', 'device', 'name' ], _('Unknown WAN')); } ],
			[ _('Source address'), function(row) { return firstValue(row, [ 'source', 'src', 'address', 'addr' ], _('Not reported')); } ],
			[ _('Route table'), function(row) { return firstValue(row, [ 'table', 'table_id', 'rt_table' ], _('Not reported')); } ],
			[ _('Result'), function(row) { return row.ok === false ? _('Needs attention') : firstValue(row, [ 'result', 'status', 'state' ], _('OK')); } ]
		], alignmentRows, _('No MPTCP source-route alignment rows were reported.')),
		renderWorkflowSteps(_('MPTCP source-route alignment'), [
			[ _('1. Kernel'), _('Confirm MPTCP is enabled and the path manager exposes endpoint state.') ],
			[ _('2. Endpoint role'), _('Each WAN should show the intended signal, subflow, or backup role.') ],
			[ _('3. Route alignment'), _('Enable mwan4 source routing on the Advanced page and verify endpoint source addresses leave through their owning WAN.') ]
		])
	]);
}

function renderQualityDiagnostics(quality) {
	quality = quality || {};
	let policies = firstValue(quality, [ 'interfaces', 'policies', 'links', 'items' ], []);
	let decisions = firstValue(quality, [ 'decisions', 'states', 'results', 'edge_states' ], []);
	let summary = quality.summary || {};

	return renderAdvancedSurface(_('Quality policy'), _('SLA'), _('Show how latency, packet loss, hysteresis, and degraded states influence route selection.'), [
		renderDiagnosticsWarnings(quality),
		renderInsightGrid([
			[ _('SLA policies'), String(summary.interfaces || countItems(policies)), _('WAN links with quality configuration') ],
			[ _('Enabled'), String(summary.enabled || 0), _('Links currently enforcing latency/loss thresholds') ],
			[ _('Unsupported'), String(summary.unsupported || 0), _('Links using helpers that cannot measure SLA values') ]
		]),
		renderRecordsTable(_('Quality decisions'), [
			[ _('Policy'), function(row) { return firstValue(row, [ 'policy', 'interface', 'name', 'wan' ], _('Unnamed policy')); } ],
			[ _('Method'), function(row) { return firstValue(row, [ 'track_method', 'method' ], _('Not reported')); } ],
			[ _('Failure threshold'), function(row) { return _('%sms / %s%%').format(firstValue(row, [ 'failure_latency' ], _('not set')), firstValue(row, [ 'failure_loss' ], _('not set'))); } ],
			[ _('Recovery threshold'), function(row) { return _('%sms / %s%%').format(firstValue(row, [ 'recovery_latency' ], _('not set')), firstValue(row, [ 'recovery_loss' ], _('not set'))); } ]
		], policies, _('No quality policy rows were reported.')),
		renderRecordsTable(_('Quality edge states'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'wan', 'name', 'policy' ], _('Unknown WAN')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'state', 'status', 'health_state', 'decision' ], _('Unknown')); } ],
			[ _('Reason'), function(row) { return firstValue(row, [ 'reason', 'message', 'check' ], _('No reason reported')); } ],
			[ _('Sample'), function(row) { return firstValue(row, [ 'sample', 'latency', 'packetloss', 'value' ], _('Not measured')); } ]
		], decisions, _('No quality edge states were reported.'))
	]);
}

function renderProbeDiagnostics(probes) {
	probes = probes || {};
	let rows = [];
	let summary = probes.summary || {};
	let bfd = probes.bfd || {};
	let bfdRows = firstValue(bfd, [ 'sessions', 'peers', 'items' ], []);
	let bfdConfiguredRows = firstValue(bfd, [ 'configured' ], []);
	let helperRows = namedRows(firstValue(probes, [ 'helpers', 'helper_availability', 'methods' ], {}), 'method');
	let failureRows = firstValue(probes, [ 'failures', 'failed', 'down_targets', 'edge_states' ], []);

	Object.keys(probes.interfaces || {}).sort().forEach(function(iface) {
		let item = probes.interfaces[iface] || {};
		Object.keys(item.families || {}).sort().forEach(function(family) {
			asArray((item.families[family] || {}).targets).forEach(function(target) {
				let row = Object.assign({}, target || {});
				row.interface = iface;
				row.family = family;
				rows.push(row);
			});
		});
	});

	if (!rows.length)
		rows = firstValue(probes, [ 'probes', 'targets', 'bfd', 'items' ], []);

	return renderAdvancedSurface(_('Probe and BFD visibility'), _('Probes'), _('Inspect active health probes, optional helper availability, BFD sessions, and target-level failures.'), [
		renderDiagnosticsWarnings(probes),
		renderInsightGrid([
			[ _('Probe targets'), String(summary.targets || countItems(rows)), _('Configured targets and live probe rows') ],
			[ _('Measured'), String(summary.measured || 0), _('Targets reporting latency or packet loss') ],
			[ _('BFD sessions'), String(bfd.session_count || countItems(bfdRows)), bfd.available ? _('FRR BFD visibility through vtysh') : _('FRR vtysh not available') ],
			[ _('Down'), String(summary.down || 0), _('Targets currently failing') ]
		]),
		renderRecordsTable(_('Probe helper availability'), [
			[ _('Method'), 'method' ],
			[ _('Helper'), function(row) { return firstValue(row, [ 'helper' ], _('Built in')); } ],
			[ _('Available'), function(row) { return boolText(row.available); } ],
			[ _('SLA metrics'), function(row) { return boolText(row.quality_supported); } ]
		], helperRows, _('No probe helper availability data was reported.')),
		renderRecordsTable(_('Probe state'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'wan', 'name' ], _('Unknown WAN')); } ],
			[ _('Family'), function(row) { return firstValue(row, [ 'family' ], _('Any family')); } ],
			[ _('Target'), function(row) { return firstValue(row, [ 'target', 'ip', 'address', 'peer' ], _('Unknown target')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'status', 'state', 'health_state' ], _('Unknown')); } ],
			[ _('Latency / loss'), function(row) { return _('%s ms / %s%%').format(firstValue(row, [ 'latency' ], _('not measured')), firstValue(row, [ 'packetloss', 'loss' ], _('not measured'))); } ]
		], rows, _('No probe rows were reported.')),
		renderRecordsTable(_('Probe failures'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'wan', 'name' ], _('Unknown WAN')); } ],
			[ _('Target'), function(row) { return firstValue(row, [ 'target', 'ip', 'address', 'peer' ], _('Unknown target')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'state', 'status', 'health_state' ], _('Unknown')); } ],
			[ _('Reason'), function(row) { return firstValue(row, [ 'reason', 'message', 'check' ], _('No reason reported')); } ]
		], failureRows, _('No probe failure rows were reported.')),
		renderRecordsTable(_('BFD sessions'), [
			[ _('Peer'), function(row) { return firstValue(row, [ 'peer', 'address', 'remote' ], _('Unknown peer')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'state', 'status' ], _('Unknown')); } ],
			[ _('Interface'), function(row) { return firstValue(row, [ 'interface', 'device', 'dev' ], _('Not bound')); } ],
			[ _('VRF'), function(row) { return firstValue(row, [ 'vrf' ], _('Default VRF')); } ]
		], bfdRows, bfd.available ? _('No BFD sessions were reported.') : _('FRR vtysh is not available, so BFD sessions cannot be read.')),
		renderRecordsTable(_('Configured BFD peers'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'wan', 'name' ], _('Unknown WAN')); } ],
			[ _('Peer'), function(row) { return firstValue(row, [ 'peer', 'address', 'remote' ], _('Unknown peer')); } ],
			[ _('Device'), function(row) { return firstValue(row, [ 'device', 'dev' ], _('Not reported')); } ],
			[ _('Live match'), function(row) { return boolText(row.live_match); } ]
		], bfdConfiguredRows, _('No mwan4 BFD metadata rows were reported.'))
	]);
}

function renderVrfDiagnostics(vrf) {
	vrf = vrf || {};
	let rows = firstValue(vrf, [ 'devices', 'vrfs', 'items' ], []);
	let interfaces = objectEntries(vrf.interfaces, 'interface');
	let ruleRows = familyRows(vrf.rules, function(family, line) { return { family: family, rule: line }; });
	let l3mdevRows = familyRows(vrf.l3mdev_rules, function(family, line) { return { family: family, rule: line }; });
	let tableRows = [];

	Object.keys(vrf.tables || {}).sort().forEach(function(name) {
		let table = vrf.tables[name] || {};
		[ 'ipv4', 'ipv6' ].forEach(function(family) {
			asArray(table[family]).forEach(function(route) {
				tableRows.push({ vrf: name, table: table.table, family: family, route: route });
			});
		});
	});

	return renderAdvancedSurface(_('VRF visibility'), _('VRF'), _('Correlate VRF devices, table ownership, routing rules, and BFD/probe placement for segmented WAN designs.'), [
		renderDiagnosticsWarnings(vrf),
		renderInsightGrid([
			[ _('VRFs'), String(countItems(rows)), _('Reported VRF devices or table bindings') ],
			[ _('Rules'), String(countItems(ruleRows)), _('Routing rules attached to VRF tables') ],
			[ _('l3mdev rules'), String(countItems(l3mdevRows)), vrf.l3mdev_rule ? _('Kernel VRF lookup rules are present') : _('Kernel VRF lookup rule is missing') ]
		]),
		renderRecordsTable(_('VRF and table map'), [
			[ _('VRF'), function(row) { return firstValue(row, [ 'vrf', 'name', 'device' ], _('Default table')); } ],
			[ _('Table'), function(row) { return firstValue(row, [ 'table', 'table_id', 'rt_table' ], _('Not reported')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'status', 'state', 'raw' ], _('Reported')); } ]
		], rows, _('No VRF rows were reported.')),
		renderRecordsTable(_('VRF interface bindings'), [
			[ _('Interface'), 'interface' ],
			[ _('Device'), function(row) { return firstValue(row, [ 'device' ], _('Not reported')); } ],
			[ _('Master'), function(row) { return firstValue(row, [ 'master' ], _('No VRF master')); } ],
			[ _('Table'), function(row) { return firstValue(row, [ 'table' ], _('Not reported')); } ]
		], interfaces, _('No VRF interface bindings were reported.')),
		renderRecordsTable(_('VRF live validation'), [
			[ _('Check'), function(row) { return firstValue(row, [ 'check', 'name' ], _('Unnamed check')); } ],
			[ _('Expected'), function(row) { return firstValue(row, [ 'expected' ], _('Not reported')); } ],
			[ _('Observed'), function(row) { return firstValue(row, [ 'observed' ], _('Not reported')); } ],
			[ _('Result'), function(row) { return row.ok ? _('OK') : _('Needs attention'); } ]
		], vrf.validation, _('No VRF validation rows were reported.')),
		renderRecordsTable(_('l3mdev routing rules'), [
			[ _('Family'), 'family' ],
			[ _('Rule'), 'rule' ]
		], l3mdevRows, _('No l3mdev routing rules were reported.')),
		renderRecordsTable(_('VRF table routes'), [
			[ _('VRF'), 'vrf' ],
			[ _('Table'), function(row) { return firstValue(row, [ 'table' ], _('Not reported')); } ],
			[ _('Family'), 'family' ],
			[ _('Route'), 'route' ]
		], tableRows, _('No VRF table routes were reported.')),
		renderRecordsTable(_('VRF routing rules'), [
			[ _('Family'), 'family' ],
			[ _('Rule'), 'rule' ]
		], ruleRows, _('No VRF routing rules were reported.'))
	]);
}

function renderExplainDiagnostics(explain) {
	explain = explain || {};
	let decision = explain.decision || {};
	let selected = decision.selected || {};
	let matched = explain.matched_rule || {};
	let skipped = firstValue(explain, [ 'rules', 'skipped_policies', 'skipped', 'trace', 'steps' ], []);
	let matchedName = matched.rule || firstValue(explain, [ 'matched_policy', 'winning_policy', 'policy' ], null);
	let selectedWan = selected.interface || firstValue(decision, [ 'interface', 'wan', 'fallback_wan' ], null);
	let mark = selected.mark || decision.mark || firstValue(explain, [ 'fwmark', 'mark', 'mark_mask' ], null);
	let table = selected.table_id || selected.table || firstValue(explain, [ 'route_table', 'table', 'rt_table' ], null);

	return renderAdvancedSurface(_('Route decision explain'), _('Explain'), _('Show the tuple, matched policy, selected WAN, firewall mark, route table, and fallback behavior for a policy decision.'), [
		renderDiagnosticsWarnings(explain),
		renderInsightGrid([
			[ _('Matched policy'), matchedName || _('No policy matched'), _('The first policy that accepted the tuple') ],
			[ _('Selected WAN'), selectedWan || _('Not selected'), _('Effective WAN after health and fallback checks') ],
			[ _('Firewall mark'), mark || _('Not reported'), _('Mark used before route-table lookup') ],
			[ _('Route table'), table || _('Not reported'), _('Table selected for matching packets') ]
		]),
		renderKeyValues(_('Decision tuple'), [
			[ _('Query tuple'), routeExplainTupleLabel(explain.input || explain) ],
			[ _('Strategy'), decision.strategy || matched.use_strategy || firstValue(explain, [ 'strategy', 'use_strategy', 'path' ], _('Not reported')) ],
			[ _('Decision type'), firstValue(decision, [ 'type', 'status', 'selection' ], _('Not reported')) ],
			[ _('Terminal behavior'), firstValue(decision, [ 'status', 'fallback', 'last_resort' ], _('Not reported')) ]
		]),
		renderRecordsTable(_('Skipped policies and trace'), [
			[ _('Policy'), function(row) { return firstValue(row, [ 'rule', 'policy', 'name', 'id' ], _('Unnamed step')); } ],
			[ _('Strategy'), function(row) { return firstValue(row, [ 'use_strategy', 'strategy' ], _('Not reported')); } ],
			[ _('Result'), function(row) { return row.matched ? _('Matched') : firstValue(row, [ 'result', 'decision', 'status' ], _('Skipped')); } ]
		], skipped, _('No skipped-policy trace was reported.'))
	]);
}

function renderPbrDiagnostics(pbr) {
	pbr = pbr || {};
	let config = pbr.config || {};
	let ruleRows = familyRows(pbr.rules, function(family, line) { return { family: family, rule: line }; });
	let coverageRows = namedRows(firstValue(pbr, [ 'interface_coverage', 'interfaces', 'coverage' ], []), 'interface');
	let targetRows = firstValue(pbr, [ 'targets', 'policies', 'policy_targets' ], []);

	if (!coverageRows.length) {
		asArray(firstValue(config, [ 'supported_interfaces', 'supported_interface' ], [])).forEach(function(name) {
			coverageRows.push({ interface: name, state: _('Supported'), source: _('pbr supported_interface') });
		});
		asArray(firstValue(pbr, [ 'missing_supported_interfaces', 'missing_interfaces' ], [])).forEach(function(name) {
			coverageRows.push({ interface: name, state: _('Missing'), source: _('mwan4 enabled WAN') });
		});
	}

	return renderAdvancedSurface(_('PBR harmony'), _('PBR'), _('Confirm mwan4 and PBR agree on marks, masks, rule priorities, table IDs, service state, and IPv6 uplink coverage.'), [
		renderDiagnosticsWarnings(pbr),
		renderInsightGrid([
			[ _('PBR service'), pbr.service_running ? _('Running') : _('Not running'), _('Runtime state of the pbr service') ],
			[ _('Mark mask'), firstValue(config, [ 'fw_mask' ], _('Not reported')), _('Mask overlap between mwan4 and PBR') ],
			[ _('Rule priority'), firstValue(config, [ 'ip_rules_priority' ], _('Not reported')), _('Relative order of policy routing rules') ],
			[ _('IPv6 coverage'), config.ipv6_enabled ? firstValue(config, [ 'uplink_interface6' ], _('Missing uplink')) : _('Disabled'), _('Whether marked IPv6 has a matching route table') ]
		]),
		renderRecordsTable(_('PBR routing rules'), [
			[ _('Family'), 'family' ],
			[ _('Rule'), 'rule' ]
		], ruleRows, _('No PBR routing rules were reported.')),
		renderRecordsTable(_('PBR interface coverage'), [
			[ _('Interface'), function(row) { return firstValue(row, [ 'interface', 'name', 'wan' ], _('Unknown interface')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'state', 'status', 'result' ], _('Reported')); } ],
			[ _('Source'), function(row) { return firstValue(row, [ 'source', 'reason' ], _('Not reported')); } ]
		], coverageRows, _('No PBR supported-interface coverage rows were reported.')),
		renderRecordsTable(_('PBR policy targets'), [
			[ _('Policy'), function(row) { return firstValue(row, [ 'policy', 'name', 'section' ], _('Unnamed policy')); } ],
			[ _('Target'), function(row) { return firstValue(row, [ 'target', 'interface', 'gateway' ], _('Not reported')); } ],
			[ _('Result'), function(row) { return row.ok === false ? _('Needs attention') : firstValue(row, [ 'result', 'status' ], _('OK')); } ]
		], targetRows, _('No PBR policy target rows were reported.')),
		renderRecordsTable(_('PBR validation'), [
			[ _('Check'), function(row) { return firstValue(row, [ 'check', 'name' ], _('Unnamed check')); } ],
			[ _('Expected'), function(row) { return firstValue(row, [ 'expected' ], _('Not reported')); } ],
			[ _('Observed'), function(row) { return firstValue(row, [ 'observed' ], _('Not reported')); } ],
			[ _('Result'), function(row) { return row.ok ? _('OK') : _('Needs attention'); } ]
		], pbr.validation, _('No PBR validation rows were reported.')),
		renderRecordsTable(_('PBR warnings'), [
			[ _('Check'), function(row) { return firstValue(row, [ 'code', 'check', 'name' ], _('Unnamed check')); } ],
			[ _('Interface'), function(row) { return firstValue(row, [ 'interface', 'family' ], _('Not interface-specific')); } ],
			[ _('Message'), function(row) { return firstValue(row, [ 'message' ], _('No message')); } ]
		], warningRows(pbr), _('No PBR harmony warnings were reported.'))
	]);
}

function renderPackagesDiagnostics(packages) {
	packages = packages || {};
	let rows = [];

	Object.keys(packages.features || {}).sort().forEach(function(feature) {
		asArray((packages.features[feature] || {}).packages).forEach(function(pkg) {
			rows.push(Object.assign({ feature: feature, ready: (packages.features[feature] || {}).ready }, pkg || {}));
		});
	});

	return renderAdvancedSurface(_('Package readiness'), _('Packages'), _('Verify optional package bundles needed for advanced probes, WireGuard, tunnels, PBR, VRF, and FRR/BFD.'), [
		renderDiagnosticsWarnings(packages),
		renderInsightGrid([
			[ _('Package manager'), firstValue(packages, [ 'manager' ], _('Not detected')), _('Backend package tool used for readiness checks') ],
			[ _('Feature bundles'), String(countItems(packages.features)), _('Allowlisted install groups known to mwan4') ],
			[ _('Missing packages'), String(countItems(packages.missing)), _('Packages not installed yet') ]
		]),
		renderRecordsTable(_('Feature package map'), [
			[ _('Feature'), function(row) { return firstValue(row, [ 'feature' ], _('Unknown feature')); } ],
			[ _('Package'), function(row) { return firstValue(row, [ 'name', 'package' ], _('Unknown package')); } ],
			[ _('Installed'), function(row) { return boolText(row.installed); } ],
			[ _('Version'), function(row) { return firstValue(row, [ 'version' ], _('Not installed')); } ]
		], rows, _('No package readiness rows were reported.'))
	]);
}

function renderTunnelDiagnostics(tunnels) {
	tunnels = tunnels || {};
	let rows = firstValue(tunnels, [ 'interfaces', 'tunnels', 'items' ], []);
	let endpointRows = namedRows(firstValue(tunnels.endpoints || {}, [ 'interfaces', 'items', 'routes' ], []), 'interface');
	let recursionRows = objectEntries((tunnels.recursion || {}).graph, 'interface');
	let recursionWarningRows = asArray((tunnels.recursion || {}).warnings).map(function(warning) {
		return warning && typeof warning == 'object' ? warning : { message: warning };
	});

	return renderAdvancedSurface(_('Tunnel diagnostics'), _('Tunnels'), _('Show tunnel metadata, endpoint underlay routes, recursion risk, policy strategy, and data-plane reachability.'), [
		renderDiagnosticsWarnings(tunnels),
		renderInsightGrid([
			[ _('Tunnels'), String(countItems(rows)), _('Detected tunnel interfaces or metadata rows') ],
			[ _('Endpoint routes'), String(countItems(endpointRows)), _('Host routes or exemptions for remote endpoints') ],
			[ _('Recursion warnings'), String(countItems((tunnels.recursion || {}).warnings)), _('Whether endpoint traffic can loop into the tunnel') ]
		]),
		renderRecordsTable(_('Tunnel path checks'), [
			[ _('Tunnel'), function(row) { return firstValue(row, [ 'tunnel', 'name', 'interface' ], _('Unnamed tunnel')); } ],
			[ _('Endpoint'), function(row) { return firstValue(row, [ 'endpoint', 'remote', 'peer' ], _('Not reported')); } ],
			[ _('Underlay'), function(row) { return firstValue(row, [ 'underlay_strategy', 'underlay', 'wan', 'strategy', 'route' ], _('Not reported')); } ],
			[ _('Underlay WANs'), function(row) { return joinList(asArray(firstValue(row, [ 'underlay_interfaces' ], [])), _('Not reported')); } ],
			[ _('State'), function(row) { return firstValue(row, [ 'status', 'state', 'reachability' ], _('Unknown')); } ]
		], rows, _('No tunnel rows were reported.')),
		renderRecordsTable(_('Endpoint route checks'), [
			[ _('Tunnel'), 'interface' ],
			[ _('Endpoint'), function(row) { return firstValue(row, [ 'endpoint' ], _('Not reported')); } ],
			[ _('Route'), function(row) { return routeText(row.route); } ]
		], endpointRows, _('No endpoint route rows were reported.')),
		renderRecordsTable(_('Recursion graph'), [
			[ _('Tunnel'), 'interface' ],
			[ _('Underlay interfaces'), function(row) { return joinList(asArray(row.value), _('No underlay interfaces')); } ]
		], recursionRows, _('No recursion graph was reported.')),
		renderRecordsTable(_('Recursion warnings'), [
			[ _('Tunnel'), function(row) { return firstValue(row, [ 'tunnel', 'interface', 'name' ], _('Unknown tunnel')); } ],
			[ _('Endpoint'), function(row) { return firstValue(row, [ 'endpoint', 'remote', 'peer' ], _('Not reported')); } ],
			[ _('Message'), function(row) { return firstValue(row, [ 'message', 'reason', 'check' ], _('No message')); } ]
		], recursionWarningRows, _('No tunnel recursion warnings were reported.'))
	]);
}

function renderOwnershipDiagnostics(ownership) {
	ownership = ownership || {};
	let rows = firstValue(ownership, [ 'interfaces', 'owners', 'items' ], []);
	let objectRows = [];
	let conflictRows = firstValue(ownership, [ 'conflicts', 'foreign', 'stale', 'orphans' ], []);

	[ 'tables', 'marks', 'rule_prefs', 'chains', 'counters', 'rules' ].forEach(function(kind) {
		asArray(ownership[kind]).forEach(function(item) {
			objectRows.push({ kind: kind, object: item });
		});
	});

	return renderAdvancedSurface(_('Ownership diagnostics'), _('Ownership'), _('Audit which routing tables, rules, chains, and counters are owned by mwan4 before cleanup or coexistence changes.'), [
		renderDiagnosticsWarnings(ownership),
		renderInsightGrid([
			[ _('Owned tables'), joinList(asArray(ownership.tables), _('None')), _('Routing table IDs reserved by mwan4') ],
			[ _('Owned marks'), joinList(asArray(ownership.marks), _('None')), _('Firewall marks reserved by mwan4') ],
			[ _('Rule priorities'), joinList(asArray(ownership.rule_prefs), _('None')), _('ip rule preferences reserved by mwan4') ]
		]),
		renderRecordsTable(_('Owned runtime objects'), [
			[ _('WAN link'), function(row) { return firstValue(row, [ 'interface', 'name' ], _('Unnamed interface')); } ],
			[ _('ID'), function(row) { return firstValue(row, [ 'id' ], _('Not reported')); } ],
			[ _('Table'), function(row) { return firstValue(row, [ 'table_id', 'table' ], _('Not reported')); } ],
			[ _('Mark'), function(row) { return firstValue(row, [ 'mark' ], _('Not reported')); } ]
		], rows, _('No ownership rows were reported.')),
		renderRecordsTable(_('Ownership object inventory'), [
			[ _('Kind'), function(row) { return firstValue(row, [ 'kind' ], _('Object')); } ],
			[ _('Object'), function(row) { return formatDisplayValue(firstValue(row, [ 'object', 'value' ], row)); } ]
		], objectRows, _('No ownership object inventory was reported.')),
		renderRecordsTable(_('Ownership conflicts'), [
			[ _('Object'), function(row) { return firstValue(row, [ 'object', 'name', 'value' ], _('Unknown object')); } ],
			[ _('Owner'), function(row) { return firstValue(row, [ 'owner', 'source' ], _('Unknown owner')); } ],
			[ _('Message'), function(row) { return firstValue(row, [ 'message', 'reason', 'check' ], _('No message')); } ]
		], conflictRows, _('No ownership conflicts were reported.'))
	]);
}

function renderInterfacesDiagnostics(interfaces) {
	interfaces = interfaces || {};
	let rows = objectEntries(interfaces, 'interface').map(function(row) {
		return Object.assign({ interface: row.interface }, row.value || {});
	});
	let trackingRows = [];

	rows.forEach(function(row) {
		Object.keys(row.tracking || {}).sort().forEach(function(family) {
			trackingRows.push(Object.assign({ interface: row.interface, family: family }, row.tracking[family] || {}));
		});
	});

	return renderAdvancedSurface(_('WAN link diagnostics'), _('WAN links'), _('Show configured WAN metadata, tracking status, route-table ownership, and tunnel classification for each mwan4 interface.'), [
		renderDiagnosticsWarnings(interfaces),
		renderInsightGrid([
			[ _('WAN links'), String(countItems(rows)), _('Configured mwan4 interface sections') ],
			[ _('Enabled'), String(rows.filter(function(row) { return row.enabled; }).length), _('Links enabled for policy routing') ],
			[ _('Tunnel metadata'), String(rows.filter(function(row) { return row.tunnel; }).length), _('Links classified as tunnel transports') ]
		]),
		renderRecordsTable(_('WAN link ownership'), [
			[ _('WAN link'), 'interface' ],
			[ _('Enabled'), function(row) { return boolText(row.enabled); } ],
			[ _('Families'), function(row) { return joinList(row.families); } ],
			[ _('Table'), function(row) { return firstValue(row, [ 'table_id' ], _('Not reported')); } ],
			[ _('Mark'), function(row) { return firstValue(row, [ 'mark' ], _('Not reported')); } ],
			[ _('Track targets'), function(row) { return joinList(row.track_ip, _('None')); } ]
		], rows, _('No WAN link diagnostics were reported.')),
		renderRecordsTable(_('Tracker state'), [
			[ _('WAN link'), 'interface' ],
			[ _('Family'), 'family' ],
			[ _('Tracker'), function(row) { return firstValue(row, [ 'tracking' ], _('Unknown')); } ],
			[ _('Hotplug'), function(row) { return firstValue(row, [ 'hotplug' ], _('Unknown')); } ],
			[ _('Status'), function(row) { return firstValue(row, [ 'status' ], _('Unknown')); } ]
		], trackingRows, _('No tracker rows were reported.'))
	]);
}

function renderRoutesDiagnostics(routes) {
	routes = routes || {};
	let rows = familyRows({ ipv4: routes.ipv4, ipv6: routes.ipv6 }, function(family, route) { return { family: family, route: route }; });

	return renderAdvancedSurface(_('Route table snapshot'), _('Routes'), _('Show route lines copied or inspected by mwan4 before policy route generation.'), [
		renderDiagnosticsWarnings(routes),
		renderInsightGrid([
			[ _('IPv4 routes'), String(countItems(routes.ipv4)), _('Routes reported by ip -4 route') ],
			[ _('IPv6 routes'), String(countItems(routes.ipv6)), _('Routes reported by ip -6 route') ],
			[ _('Warnings'), String(countItems(routes.warnings)), _('ECMP or source-specific route notes') ]
		]),
		renderRecordsTable(_('Route lines'), [
			[ _('Family'), 'family' ],
			[ _('Route'), 'route' ]
		], rows, _('No route lines were reported.'))
	]);
}

function renderRulesDiagnostics(rules) {
	rules = rules || {};
	let rows = familyRows({ ipv4: rules.ipv4, ipv6: rules.ipv6 }, function(family, rule) { return { family: family, rule: rule }; });

	return renderAdvancedSurface(_('Traffic policy routing'), _('Rules'), _('Show live ip rule lines that steer marked traffic into mwan4-owned routing tables.'), [
		renderDiagnosticsWarnings(rules),
		renderInsightGrid([
			[ _('IPv4 rules'), String(countItems(rules.ipv4)), _('Traffic policies for IPv4') ],
			[ _('IPv6 rules'), String(countItems(rules.ipv6)), _('Traffic policies for IPv6') ],
			[ _('Total'), String(countItems(rows)), _('All reported rules') ]
		]),
		renderRecordsTable(_('Routing rule lines'), [
			[ _('Family'), 'family' ],
			[ _('Rule'), 'rule' ]
		], rows, _('No policy routing rules were reported.'))
	]);
}

function renderNftablesDiagnostics(nftables) {
	nftables = nftables || {};
	let chainRows = objectEntries(nftables.chains, 'chain').map(function(row) {
		return { chain: row.chain, present: row.value };
	});
	let fileRows = objectEntries(nftables.files, 'target').map(function(row) {
		return Object.assign({ target: row.target }, row.value || {});
	});

	return renderAdvancedSurface(_('nftables runtime'), _('nftables'), _('Verify generated mwan4 nftables chains and installed rule files before debugging policy hits.'), [
		renderDiagnosticsWarnings(nftables),
		renderInsightGrid([
			[ _('Table'), firstValue(nftables, [ 'table' ], _('Not reported')), _('nftables table inspected by mwan4') ],
			[ _('Ready'), boolText(nftables.ready), _('Required chains are present') ],
			[ _('Generated files'), String(countItems(fileRows)), _('mwan4 nft include files') ]
		]),
		renderRecordsTable(_('Chain state'), [
			[ _('Chain'), 'chain' ],
			[ _('Present'), function(row) { return boolText(row.present); } ]
		], chainRows, _('No chain state was reported.')),
		renderRecordsTable(_('Generated nftables files'), [
			[ _('Target'), 'target' ],
			[ _('Path'), function(row) { return firstValue(row, [ 'path' ], _('Not reported')); } ],
			[ _('Installed'), function(row) { return boolText(row.exists); } ]
		], fileRows, _('No generated nftables files were reported.'))
	]);
}

function renderServiceDiagnostics(service) {
	service = service || {};
	let trackers = service.tracker_instances || {};
	let rows = [];

	asArray(trackers.expected).forEach(function(name) {
		rows.push({ tracker: name, state: asArray(trackers.running).indexOf(name) >= 0 ? _('Running') : _('Missing') });
	});

	return renderAdvancedSurface(_('Service state'), _('Service'), _('Show mwan4 service instances and tracker process coverage reported by procd.'), [
		renderDiagnosticsWarnings(service),
		renderInsightGrid([
			[ _('Service'), service.running ? _('Running') : _('Not running'), _('Any mwan4 procd instance is active') ],
			[ _('Instances'), String(service.instances_running || 0), _('Running procd instances') ],
			[ _('Trackers'), _('%d / %d').format(service.trackers_running || 0, countItems(trackers.expected)), _('Running health-check trackers') ]
		]),
		renderRecordsTable(_('Service instances'), [
			[ _('Instance'), 'instance' ]
		], asArray(service.instances).map(function(name) { return { instance: name }; }), _('No service instances were reported.')),
		renderRecordsTable(_('Tracker instances'), [
			[ _('Tracker'), 'tracker' ],
			[ _('State'), 'state' ]
		], rows, _('No tracker instances were expected.'))
	]);
}

function renderRawDiagnostics(output) {
	let rawId = 'mwan4-raw-' + Math.floor(Math.random() * 1000000);
	let pre = E('pre', { id: rawId, class: 'mwan4-output', hidden: 'hidden' }, [ JSON.stringify(output, null, '\t') || _('No output') ]);

	return E('div', { class: 'mwan4-raw' }, [
		E('button', {
			type:        'button',
			class:       'btn cbi-button cbi-button-neutral',
			'aria-controls': rawId,
			'aria-expanded': 'false',
			click:       function(ev) {
				let button = eventButton(ev);
				let hidden = !pre.hidden;
				pre.hidden = hidden;
				button.setAttribute('aria-expanded', hidden ? 'false' : 'true');
				button.textContent = hidden ? _('Show raw response') : _('Hide raw response');
			}
		}, [ _('Show raw response') ]),
		pre
	]);
}

function scalarRows(section) {
	if (section == null)
		return [];
	if (Array.isArray(section))
		return section.map(function(value, index) { return { name: String(index + 1), value: value }; });
	if (typeof section != 'object')
		return [ { name: _('Value'), value: section } ];

	return Object.keys(section).sort().map(function(key) {
		let value = section[key];
		return {
			name:  key,
			value: value && typeof value == 'object' ? formatDisplayValue(value) : value
		};
	});
}

function renderGenericDiagnosticsSection(section, payload) {
	return renderAdvancedSurface(section, _('Details'), _('This diagnostic section is shown as structured key/value rows. Open the raw response only when support needs the original RPC payload.'), [
		renderDiagnosticsWarnings(payload),
		renderRecordsTable(_('Reported values'), [
			[ _('Field'), 'name' ],
			[ _('Value'), function(row) { return firstValue(row, [ 'value' ], _('Not reported')); } ]
		], scalarRows(payload), _('No values were reported.'))
	]);
}

function renderDiagnosticsResult(result, requestedSection, routeExplainRequest) {
	let errors = diagnosticIssueRows(result);
	let output = result?.diagnostics || result || {};
	let nodes = [];
	let rendered = {};
	let renderedDirectSection = false;
	let renderers = {
		counters:  renderGroupedCounters,
		explain:   renderExplainDiagnostics,
		interfaces: renderInterfacesDiagnostics,
		mptcp:     renderMptcpDiagnostics,
		nftables:  renderNftablesDiagnostics,
		ownership: renderOwnershipDiagnostics,
		packages:  renderPackagesDiagnostics,
		pbr:       renderPbrDiagnostics,
		probes:    renderProbeDiagnostics,
		quality:   renderQualityDiagnostics,
		routes:    renderRoutesDiagnostics,
		rules:     renderRulesDiagnostics,
		service:   renderServiceDiagnostics,
		tunnels:   renderTunnelDiagnostics,
		vrf:       renderVrfDiagnostics
	};

	function sectionPayload(section) {
		if (output && output[section] != null)
			return output[section];
		if (requestedSection == section)
			return output;
		return null;
	}

	function pushSection(section) {
		let payload = sectionPayload(section);

		if (!renderers[section] || !hasDiagnosticData(payload))
			return;

		nodes.push(renderers[section](payload));
		rendered[section] = true;
		if (requestedSection == section && (!output || output[section] == null))
			renderedDirectSection = true;
	}

	if (requestedSection == 'explain' && routeExplainRequest)
		nodes.push(renderRouteExplainRequest(routeExplainRequest));

	if (errors.length)
		nodes.push(E('div', { class: 'mwan4-alert mwan4-alert-warning', role: 'alert' }, errors.map(function(error) {
			return E('p', [ E('strong', [ error.severity + ': ' ]), error.message || _('Diagnostic error') ]);
		})));

	if (output.summary && (!requestedSection || requestedSection == 'summary' || requestedSection == 'all'))
		nodes.push(renderSummary(output.summary));

	[ 'packages', 'interfaces', 'routes', 'rules', 'nftables', 'service', 'mptcp', 'quality', 'probes', 'vrf', 'explain', 'tunnels', 'pbr', 'counters', 'ownership' ].forEach(pushSection);

	if (!renderedDirectSection)
		Object.keys(output).sort().forEach(function(section) {
			if (section == 'summary' || rendered[section])
				return;

			nodes.push(renderGenericDiagnosticsSection(section, output[section]));
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
			node.replaceChildren(renderDiagnosticsResult(result, section));
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Diagnostics failed: %s').format(e.message || e) ]), 'danger');
	}).then(function() {
		let node = document.getElementById('mwan4-diag-output');
		setButtonBusy(button, false);
		if (node)
			setBusy(node, false);
	});
}

function runRouteExplain(button) {
	if (!hasDiagnosticsAccess)
		return Promise.resolve();

	let tuple = readRouteExplainTuple();
	let node  = document.getElementById('mwan4-diag-output');

	setButtonBusy(button, true);

	if (node) {
		setBusy(node, true);
		node.replaceChildren(E('p', [ _('Explaining route choice for %s...').format(tuple.query_tuple) ]));
	}

	return callRouteExplainDiagnostics(
		'explain',
		null,
		tuple.family || null,
		tuple.src_ip || null,
		tuple.dest_ip || null,
		tuple.proto || null,
		tuple.src_port || null,
		tuple.dest_port || null,
		tuple.src_iface || null,
		tuple.ipset || null,
		tuple.strategy || null
	).then(function(result) {
		let node = document.getElementById('mwan4-diag-output');
		if (node)
			node.replaceChildren(renderDiagnosticsResult(result, 'explain', tuple));
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ _('Route explain failed: %s').format(e.message || e) ]), 'danger');
	}).then(function() {
		let node = document.getElementById('mwan4-diag-output');
		setButtonBusy(button, false);
		if (node)
			setBusy(node, false);
	});
}

function workflowAction(label, section) {
	return E('button', {
		class:       'btn cbi-button cbi-button-neutral',
		'aria-busy': 'false',
		disabled:    hasDiagnosticsAccess ? null : 'disabled',
		click:       function(ev) { return run(section, eventButton(ev)); }
	}, [ label ]);
}

function renderRouteExplainForm() {
	return E('div', { id: 'mwan4-route-explain-form', class: 'mwan4-route-explain-form', role: 'group', 'aria-label': _('Route explain tuple') }, [
		E('div', { class: 'mwan4-modal-columns' }, [
			routeExplainSelect(_('Family'), 'family', [
				[ '', _('Any family') ],
				[ 'ipv4', _('IPv4') ],
				[ 'ipv6', _('IPv6') ]
			], 'ipv4'),
			routeExplainSelect(_('Protocol'), 'proto', [
				[ '', _('Any protocol') ],
				[ 'tcp', _('TCP') ],
				[ 'udp', _('UDP') ],
				[ 'icmp', _('ICMP') ],
				[ 'icmpv6', _('ICMPv6') ]
			], 'tcp'),
			routeExplainInput(_('Source address'), 'src_ip', '', { placeholder: '192.0.2.10' }),
			routeExplainInput(_('Destination address'), 'dest_ip', '', { placeholder: '1.1.1.1' }),
			routeExplainInput(_('Source port'), 'src_port', '', { placeholder: _('Any source port') }),
			routeExplainInput(_('Destination port'), 'dest_port', '443', { placeholder: '443' }),
			routeExplainInput(_('Ingress interface'), 'src_iface', '', { placeholder: 'lan' }),
			routeExplainInput(_('DNS or nft set'), 'ipset', '', { placeholder: 'streaming' }),
			routeExplainInput(_('Strategy override'), 'strategy', '', { placeholder: 'failover' })
		]),
		E('div', { class: 'mwan4-actions' }, [
			E('button', {
				type:        'button',
				class:       'btn cbi-button cbi-button-action',
				'aria-busy': 'false',
				disabled:    hasDiagnosticsAccess ? null : 'disabled',
				click:       function(ev) { return runRouteExplain(eventButton(ev)); }
			}, [ _('Explain tuple') ])
		])
	]);
}

function renderWorkflowCard(title, body, actions, extra) {
	let nodes = [
		E('strong', [ title ]),
		E('p', [ body ])
	];

	if (extra)
		nodes.push(extra);

	nodes.push(E('div', { class: 'mwan4-actions' }, actions));

	return E('div', { class: 'mwan4-workflow-card' }, nodes);
}

function summaryChoices(summary) {
	let names = (((summary || {}).diagnostics || {}).summary) || {};
	let pair = function(name) { return [ name, name ]; };

	return { interface: asArray(names.interfaces).map(pair), strategy: asArray(names.strategies).map(pair) };
}

function renderConnections(summary) {
	return E('div', { id: 'mwan4-diag-connections', class: 'mwan4-next-steps mwan4-diag-connections' }, [
		E('h3', [ _('Connections') ]),
		E('p', [ _('Live conntrack entries attributed to mwan4 routing rules and WAN links. The list refreshes while this page is open.') ]),
		mwan4Connections.renderPanel({ choices: summaryChoices(summary) })
	]);
}

function renderAdvancedWorkflows() {
	return E('div', { class: 'mwan4-advanced-workflows' }, [
		renderWorkflowCard(_('Package readiness'), _('Check optional package bundles for advanced probes, WireGuard, tunnels, PBR, VRF, and FRR/BFD before applying workflows.'), [
			workflowAction(_('Run Packages'), 'packages')
		]),
		renderWorkflowCard(_('MPTCP workflow'), _('Check endpoint roles, subflow limits, backup flags, and whether source routing keeps each subflow on the intended WAN.'), [
			workflowAction(_('Run MPTCP'), 'mptcp')
		]),
		renderWorkflowCard(_('Quality and route explain'), _('Inspect latency/loss policy decisions, then explain the route choice for a representative traffic tuple.'), [
			workflowAction(_('Run Quality'), 'quality')
		], renderRouteExplainForm()),
		renderWorkflowCard(_('Tunnels and underlay'), _('Review tunnel metadata, endpoint routes, recursion risk, underlay strategy, and data-plane reachability.'), [
			workflowAction(_('Run Tunnels'), 'tunnels')
		]),
		renderWorkflowCard(_('Ownership and cleanup'), _('Audit routing table, rule, chain, and counter ownership before cleanup or coexistence changes.'), [
			workflowAction(_('Run Ownership'), 'ownership')
		]),
		renderWorkflowCard(_('VRF, BFD, and probes'), _('Correlate VRF table bindings, BFD sessions, probe helpers, targets, and per-WAN probe state.'), [
			workflowAction(_('Run VRF'), 'vrf'),
			workflowAction(_('Run Probes'), 'probes')
		]),
		renderWorkflowCard(_('PBR harmony'), _('Compare mark masks, route-table IDs, rule priorities, service state, and IPv6 uplink coverage between mwan4 and PBR.'), [
			workflowAction(_('Run PBR'), 'pbr')
		]),
		renderWorkflowCard(_('Grouped counters'), _('Group rule, strategy, WAN, PBR, and tunnel counters so hit counts line up with the policy decision path.'), [
			workflowAction(_('Run Counters'), 'counters')
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-diagnostics', 'read'), false),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-operator', 'write'), false)
		]).then(function(access) {
			return Promise.all([
				access[0],
				access[1],
				access[0] ? L.resolveDefault(callDiagnostics('summary'), {}) : {},
				access[0] ? mwan4Connections.probe() : null
			]);
		});
	},

	render: function(data) {
		let commands = [
			[ 'summary', _('Summary') ],
			[ 'all', _('Full diagnostics') ],
			[ 'packages', _('Packages') ],
			[ 'mptcp', _('MPTCP') ],
			[ 'quality', _('Quality') ],
			[ 'probes', _('Probes') ],
			[ 'vrf', _('VRF') ],
			[ 'explain', _('Route explain') ],
			[ 'counters', _('Counters') ],
			[ 'interfaces', _('WAN links') ],
			[ 'routes', _('Paths') ],
			[ 'rules', _('Traffic policies') ],
			[ 'nftables', _('nftables') ],
			[ 'service', _('Service') ],
			[ 'tunnels', _('Tunnels') ],
			[ 'ownership', _('Ownership') ],
			[ 'pbr', _('PBR') ]
		];

		hasDiagnosticsAccess = !!data[0];
		hasCounterResetAccess = !!data[1];
		let initialResult = data[2] || null;

		return E('div', { class: 'cbi-map' }, [
			E('h2', [ _('MultiWAN 4 - Diagnostics') ]),
			E('div', { class: 'cbi-section' }, [
				mwan4Common.renderAclNotice(hasDiagnosticsAccess,
					_('Diagnostic commands are disabled because this session lacks the mwan4 diagnostics ACL.')),
				E('div', { class: 'mwan4-next-steps' }, [
					E('h3', [ _('What should I check next?') ]),
					E('p', [ _('Run Summary first, then use the advanced workflows below for MPTCP, route decisions, tunnels, ownership, probes, VRF, counters, or PBR harmony.') ])
				]),
				renderAdvancedWorkflows(),
				hasDiagnosticsAccess && data[3] != null ? renderConnections(initialResult) : null,
				E('div', { class: 'mwan4-actions' }, commands.map(function(c) {
					return E('button', {
						class:       'btn cbi-button cbi-button-action',
						'aria-busy': 'false',
						'aria-label': _('Run %s diagnostics').format(c[1]),
						disabled:    hasDiagnosticsAccess ? null : 'disabled',
						click:       function(ev) { return c[0] == 'explain' ? runRouteExplain(eventButton(ev)) : run(c[0], eventButton(ev)); }
					}, [ c[1] ]);
				})),
				E('div', { id: 'mwan4-diag-output', class: 'mwan4-diag-result', role: 'status', 'aria-live': 'polite', 'aria-busy': 'false', tabindex: '0' }, [
					hasDiagnosticsAccess && initialResult ? renderDiagnosticsResult(initialResult, 'summary') : E('p', [ _('Diagnostic commands are disabled for this session.') ])
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
