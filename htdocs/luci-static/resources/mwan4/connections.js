'use strict';
'require baseclass';
'require rpc';
'require mwan4.common as mwan4Common';
/* global mwan4Common */

const PAGE         = 200;
const MAX_LIMIT    = 1000;
const REFRESH_MS   = 3000;
const SEARCH_DELAY = 300;
const FAMILIES     = [ [ 'ipv4', 'IPv4' ], [ 'ipv6', 'IPv6' ] ];
const PROTOCOLS    = [ 'tcp', 'udp', 'icmp', 'icmpv6' ];

const callConnections = rpc.declare({
	object: 'mwan4',
	method: 'connections',
	params: [ 'rule', 'interface', 'strategy', 'family', 'proto', 'search', 'limit', 'offset' ],
	expect: { }
});

function queryArgs(filters, limit) {
	let args = [ 'rule', 'interface', 'strategy', 'family', 'proto', 'search' ].map(name => (filters || {})[name] || null);

	return args.concat([ limit || PAGE, 0 ]);
}

function query(filters, limit) {
	return callConnections.apply(null, queryArgs(filters, limit));
}

function probeTotal(result) {
	return result && result.ok !== false && Array.isArray(result.items) ? Number(result.total || 0) : null;
}

function probe() {
	return L.resolveDefault(query({}, 1), null).then(probeTotal);
}

function split(entry, key) {
	let value = (entry || {})[key] || {};
	let v4 = Number(value.ipv4 || 0);
	let v6 = Number(value.ipv6 || 0);

	return { ipv4: v4, ipv6: v6, total: Number(value.total != null ? value.total : v4 + v6) };
}

function ruleStats(name, status, counters) {
	let entry = [ counters, status ].map(source => ((source || {}).rules || {})[name]).find(Boolean);

	return entry && (entry.active_connections || entry.new_connections)
		? { active: split(entry, 'active_connections'), created: split(entry, 'new_connections') }
		: null;
}

function interfaceActive(name, status) {
	let value = (((status || {}).interfaces || {})[name] || {}).active_connections;

	return value == null ? null : Number(value.total);
}

function strategyActive(name, status) {
	let values = [ 'ipv4', 'ipv6' ].map(family => (((status || {}).strategy_status || {})[family] || {})[name])
		.map(entry => (entry || {}).active_connections).filter(value => value != null);

	return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
}

function splitTitle(stats) {
	return _('IPv4: %d active / %d new, IPv6: %d active / %d new')
		.format(stats.active.ipv4, stats.created.ipv4, stats.active.ipv6, stats.created.ipv6);
}

function formatTtl(seconds) {
	let value = Number(seconds);
	let hours = Math.floor(value / 3600);
	let minutes = Math.floor(value % 3600 / 60);

	return !(value >= 0) ? '-' : hours ? _('%dh %dm').format(hours, minutes) : minutes ? _('%dm %ds').format(minutes, value % 60) : _('%ds').format(value);
}

function formatEndpoint(address, port) {
	let host = port && String(address).indexOf(':') >= 0 ? '[%s]'.format(address) : address;

	return port ? '%s:%s'.format(host, port) : host || '-';
}

function countButton(label, text, title, filters, open) {
	return E('button', {
		class:        'btn cbi-button cbi-button-neutral mwan4-compact-button mwan4-conn-button',
		title:        title || null,
		'aria-label': label,
		click:        function() { return open(filters); }
	}, [ text ]);
}

function ruleCountText(stats) {
	return '%d / %d'.format(stats.active.total, stats.created.total);
}

function renderRuleSummary(stats) {
	return stats ? E('span', { class: 'mwan4-conn-summary-text', title: splitTitle(stats) }, [ ruleCountText(stats) ]) : E('span', { class: 'mwan4-muted-line' }, [ '-' ]);
}

function renderRuleButton(name, label, stats, open) {
	if (!stats)
		return renderRuleSummary(stats);

	return countButton(
		_('View connections of routing rule %s: %d active, %d new').format(label, stats.active.total, stats.created.total),
		ruleCountText(stats), splitTitle(stats), { rule: name }, open);
}

function renderCountButton(label, value, filters, open) {
	if (value == null)
		return E('span', { class: 'mwan4-muted-line' }, [ '-' ]);

	return countButton(label, String(value), null, filters, open);
}

function renderRow(item, accounting) {
	let cells = [
		E('td', [ E('strong', [ String(item.proto || '').toUpperCase() ]), E('small', [ item.family == 'ipv6' ? _('IPv6') : _('IPv4') ]) ]),
		E('td', [ formatEndpoint(item.src, item.sport) ]),
		E('td', [ formatEndpoint(item.dst, item.dport) ]),
		E('td', [ item.state || '-' ]),
		E('td', item.rule ? [ item.rule_label || item.rule ] : [ E('span', { class: 'mwan4-muted-line' }, [ _('Default routing') ]) ]),
		E('td', [ item.interface || '-' ])
	];

	if (accounting)
		cells.push(E('td', { title: _('%d packets').format(item.packets || 0) }, [ mwan4Common.formatBytes(Number(item.bytes || 0)) ]));

	return E('tr', { class: 'mwan4-conn-row' }, cells.concat([ E('td', [ formatTtl(item.timeout) ]) ]));
}

function renderHead(accounting) {
	let labels = [ _('Protocol'), _('Source'), _('Destination'), _('State'), _('Rule'), _('Via WAN') ];

	return E('tr', labels.concat(accounting ? [ _('Bytes') ] : [], [ _('TTL') ]).map(label => E('th', [ label ])));
}

function optionNodes(entries, current, anyLabel) {
	let all = Object.keys(entries).sort().map(value => [ value, entries[value] ]);

	if (current && !entries[current])
		all.push([ current, current ]);

	return [ E('option', { value: '' }, [ anyLabel ]) ].concat(all.map(entry =>
		E('option', { value: entry[0], selected: entry[0] == current ? 'selected' : null }, [ entry[1] ])));
}

function selectField(label, name, anyLabel, onChange) {
	let select = E('select', { name: name, 'aria-label': label, change: onChange });

	return { select: select, node: E('label', { class: 'mwan4-modal-field' }, [ E('span', [ label ]), select ]), anyLabel: anyLabel };
}

function staticEntries(list) {
	return Object.fromEntries(list.map(entry => Array.isArray(entry) ? entry : [ entry, entry.toUpperCase() ]));
}

function renderPanel(options) {
	options = options || {};

	let filters = Object.assign({}, options.filters);
	let limit = PAGE;
	let generation = 0;
	let entries = { rule: {}, interface: {}, strategy: {}, family: staticEntries(FAMILIES), proto: staticEntries(PROTOCOLS) };
	let fields = {};
	let searchTimer;
	let search = E('input', { type: 'search', name: 'search', value: filters.search || '', placeholder: _('Address, port, or rule'), 'aria-label': _('Search connections') });
	let summary = E('strong', { class: 'mwan4-conn-total', 'aria-live': 'polite' });
	let table = E('table', { class: 'table mwan4-conn-table' });
	let empty = E('p', { class: 'mwan4-conn-empty', hidden: 'hidden' }, [ _('No connections match these filters.') ]);
	let notice = E('p', { class: 'mwan4-conn-notice', role: 'status', hidden: 'hidden' });
	let more = E('button', { class: 'btn cbi-button cbi-button-neutral', hidden: 'hidden', click: function() { limit = Math.min(limit + PAGE, MAX_LIMIT); return refresh(); } }, [ _('Show more') ]);
	let root;

	function remember(kind, value, label) {
		if (value)
			entries[kind][value] = label || value;
	}

	function syncField(name) {
		let item = fields[name];
		let signature = JSON.stringify([ entries[name], filters[name] ]);

		if (item.signature == signature)
			return;

		item.signature = signature;
		item.select.replaceChildren.apply(item.select, optionNodes(entries[name], filters[name], item.anyLabel));
		item.select.value = filters[name] || '';
	}

	function syncFields() {
		Object.keys(fields).forEach(syncField);
	}

	function setFilter(name, value) {
		filters[name] = value;
		limit = PAGE;

		return refresh();
	}

	function field(name, label, anyLabel) {
		fields[name] = selectField(label, name, anyLabel, ev => setFilter(name, ev.currentTarget.value));

		return fields[name].node;
	}

	function show(result) {
		if (probeTotal(result) == null)
			return failed(new Error(result.error || result.message || _('unexpected response')));

		let items = result.items || [];

		items.forEach(item => {
			remember('rule', item.rule, item.rule_label);
			remember('interface', item.interface);
			remember('strategy', item.strategy);
		});
		syncFields();

		summary.textContent = _('%d active connection(s)').format(result.total || 0);
		table.replaceChildren.apply(table, [ renderHead(result.accounting) ].concat(items.map(item => renderRow(item, result.accounting))));
		empty.hidden = items.length > 0;
		table.hidden = !items.length;
		notice.hidden = !result.truncated;
		notice.textContent = _('Showing the first %d of %d connections. Narrow the filters or show more.').format(items.length, result.total || 0);
		more.hidden = !result.truncated || limit >= MAX_LIMIT;
	}

	function failed(error) {
		notice.hidden = false;
		notice.textContent = _('Connections are unavailable: %s').format(error.message || error);
	}

	function refresh() {
		let current = ++generation;

		return query(filters, limit).then(result => { if (current == generation) show(result); }, failed);
	}

	function schedule() {
		window.setTimeout(function() {
			if (root.isConnected)
				refresh().then(schedule);
		}, options.interval || REFRESH_MS);
	}

	Object.keys(options.choices || {}).forEach(kind => (options.choices[kind] || []).forEach(entry => remember(kind, entry[0], entry[1])));

	search.addEventListener('input', function() {
		window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(function() { setFilter('search', search.value.trim()); }, SEARCH_DELAY);
	});

	root = E('div', { class: 'mwan4-connections', 'aria-busy': 'false' }, [
		E('div', { class: 'mwan4-conn-filters' }, [
			field('rule', _('Rule'), _('Any rule')),
			field('interface', _('WAN'), _('Any WAN')),
			field('strategy', _('Strategy'), _('Any strategy')),
			field('family', _('Family'), _('IPv4 and IPv6')),
			field('proto', _('Protocol'), _('Any protocol')),
			E('label', { class: 'mwan4-modal-field' }, [ E('span', [ _('Search') ]), search ])
		]),
		E('div', { class: 'mwan4-conn-summary' }, [ summary, more ]),
		notice,
		E('div', { class: 'mwan4-wan-table-wrap' }, [ table ]),
		empty
	]);

	syncFields();
	refresh().then(schedule);

	return root;
}

return baseclass.extend({
	countButton:       countButton,
	formatEndpoint:    formatEndpoint,
	formatTtl:         formatTtl,
	interfaceActive:   interfaceActive,
	probe:             probe,
	probeTotal:        probeTotal,
	query:             query,
	queryArgs:         queryArgs,
	renderCountButton: renderCountButton,
	renderPanel:       renderPanel,
	renderRuleButton:  renderRuleButton,
	renderRuleSummary: renderRuleSummary,
	ruleStats:         ruleStats,
	strategyActive:    strategyActive
});
