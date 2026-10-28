'use strict';
'require baseclass';
'require mwan4.common as mwan4Common';

var E = mwan4Common.element;
/* global mwan4Common */

const formatDisplayValue = mwan4Common.formatDisplayValue;

function boolText(value) {
	return value ? _('Yes') : _('No');
}

function asArray(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value : [ value ];
}

function joinList(value, empty) {
	return Array.isArray(value) && value.length ? value.map(function(item) {
		return formatDisplayValue(item, _('Unknown item'));
	}).join(', ') : empty || _('None');
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

function objectEntries(value, nameKey) {
	if (!value || typeof value != 'object' || Array.isArray(value))
		return [];

	return Object.keys(value).sort().map(function(name) {
		let item = value[name];
		if (item && typeof item == 'object' && !Array.isArray(item)) {
			let copy = Object.assign({}, item);
			copy[nameKey || 'name'] = copy[nameKey || 'name'] || name;
			return copy;
		}

		let copy = { value: item };
		copy[nameKey || 'name'] = name;
		return copy;
	});
}

function familyRows(value, rowFn) {
	let rows = [];
	value = value || {};

	[ 'ipv4', 'ipv6' ].forEach(function(family) {
		asArray(value[family]).forEach(function(item) {
			rows.push(rowFn(family, item));
		});
	});

	return rows;
}

function warningRows(value) {
	return asArray(firstValue(value || {}, [ 'warnings', 'warning', 'conflicts', 'collisions' ], [])).map(function(warning) {
		return warning && typeof warning == 'object' ? warning : { message: warning };
	});
}

function issueMessage(value) {
	if (value == null || value === false || value === '')
		return null;

	if (value && typeof value == 'object' && !Array.isArray(value))
		return firstValue(value, [ 'message', 'error', 'reason', 'code', 'check', 'observed', 'value' ], formatDisplayValue(value));

	return formatDisplayValue(value);
}

function appendIssueRows(rows, severity, value) {
	if (value == null || value === false || value === '')
		return;

	if (Array.isArray(value)) {
		value.forEach(function(item) { appendIssueRows(rows, severity, item); });
		return;
	}

	if (typeof value == 'object' && !Array.isArray(value) && value.message == null && value.error == null && value.reason == null && value.code == null) {
		Object.keys(value).sort().forEach(function(name) {
			let message = issueMessage(value[name]);
			if (message)
				rows.push({ severity: severity, message: name + ': ' + message });
		});
		return;
	}

	let message = issueMessage(value);
	if (message)
		rows.push({ severity: severity, message: message });
}

function diagnosticIssueRows(value) {
	let rows = [];

	if (!value || typeof value != 'object')
		return rows;

	if (value.ok === false)
		appendIssueRows(rows, _('Error'), firstValue(value, [ 'message', 'reason', 'status' ], _('Backend reported this section as failed')));

	appendIssueRows(rows, _('Error'), value.errors);
	appendIssueRows(rows, _('Error'), value.error);
	appendIssueRows(rows, _('Error output'), value.stderr);
	appendIssueRows(rows, _('Failure'), value.failures);
	appendIssueRows(rows, _('Warning'), value.warnings);
	appendIssueRows(rows, _('Warning'), value.warning);
	appendIssueRows(rows, _('Conflict'), value.conflicts);
	appendIssueRows(rows, _('Collision'), value.collisions);
	appendIssueRows(rows, _('Unsupported'), value.unsupported);

	return rows;
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

function renderInsightCard(title, value, body) {
	return E('div', { class: 'mwan4-insight-card' }, [
		E('span', [ title ]),
		E('strong', [ formatDisplayValue(value) ]),
		body ? E('small', [ body ]) : ''
	]);
}

function renderInsightGrid(cards) {
	return E('div', { class: 'mwan4-insight-grid' }, cards.map(function(card) {
		return renderInsightCard(card[0], card[1], card[2]);
	}));
}

function renderRecordsTable(title, columns, rows, emptyText) {
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
		}))) : E('p', { class: 'mwan4-muted-line' }, [ emptyText || _('No records reported by this diagnostic section.') ])
	]);
}

function renderAdvancedSurface(title, eyebrow, description, children) {
	return E('section', { class: 'mwan4-diag-section mwan4-advanced-surface' }, [
		E('div', { class: 'mwan4-surface-heading' }, [
			E('span', { class: 'mwan4-eyebrow' }, [ eyebrow ]),
			E('h3', [ title ]),
			description ? E('p', [ description ]) : ''
		])
	].concat(children || []));
}

function renderWorkflowSteps(title, steps) {
	return E('div', { class: 'mwan4-workflow' }, [
		E('h4', [ title ]),
		E('ol', steps.map(function(step) {
			return E('li', [
				E('strong', [ step[0] ]),
				E('span', [ step[1] ])
			]);
		}))
	]);
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

return baseclass.extend({
	asArray:               asArray,
	boolText:              boolText,
	countItems:            countItems,
	diagnosticIssueRows:  diagnosticIssueRows,
	familyRows:            familyRows,
	firstValue:            firstValue,
	joinList:              joinList,
	normalizeRecords:      normalizeRecords,
	objectEntries:         objectEntries,
	renderAdvancedSurface: renderAdvancedSurface,
	renderInsightCard:     renderInsightCard,
	renderInsightGrid:     renderInsightGrid,
	renderKeyValues:       renderKeyValues,
	renderRecordsTable:    renderRecordsTable,
	renderWorkflowSteps:   renderWorkflowSteps,
	warningRows:           warningRows
});
