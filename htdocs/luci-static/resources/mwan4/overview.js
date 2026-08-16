'use strict';
'require baseclass';
'require mwan4.common as mwan4Common';
/* global mwan4Common */

const formatDisplayValue = mwan4Common.formatDisplayValue;
const setBusy            = mwan4Common.setBusy;

function asArray(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value : [ value ];
}

function byId(id) {
	return document.getElementById(id);
}

function eventButton(ev) {
	return ev && ev.currentTarget ? ev.currentTarget : null;
}

function withBusyState(node, setter, taskFn) {
	setter(node, true);

	return Promise.resolve().then(taskFn).then(function(result) {
		setter(node, false);
		return result;
	}, function(e) {
		setter(node, false);
		throw e;
	});
}

function withBusy(node, taskFn) {
	return withBusyState(node, setBusy, taskFn);
}

function setButtonBusy(button, busy) {
	if (!button)
		return;

	button.disabled = !!busy;
	setBusy(button, busy);
}

function withButtonBusy(button, taskFn) {
	return withBusyState(button, setButtonBusy, taskFn);
}

function tableHeader(labels, extraClass) {
	let cls = 'mwan4-row mwan4-head';
	if (extraClass)
		cls += ' ' + extraClass;

	return E('div', { class: cls, role: 'row' }, labels.map(function(label) {
		return E('span', { role: 'columnheader' }, [ label ]);
	}));
}

function tableCell(label, children, attrs) {
	attrs = attrs || {};
	attrs.class = attrs.class ? '%s mwan4-cell'.format(attrs.class) : 'mwan4-cell';
	attrs.role = 'cell';
	attrs['data-label'] = label;

	return E('div', attrs, children);
}

function sanitizeName(value, fallback) {
	value = (value || '').trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
	return value || fallback;
}

function optionList(values, selected, emptyLabel) {
	let out = [];
	if (emptyLabel)
		out.push(E('option', { value: '' }, [ emptyLabel ]));
	values.forEach(function(v) {
		let value = Array.isArray(v) ? v[0] : v;
		let label = Array.isArray(v) ? v[1] : v;
		out.push(E('option', { value: value, selected: value == selected ? 'selected' : null }, [ formatDisplayValue(label, _('Unnamed option')) ]));
	});
	return out;
}

return baseclass.extend({
	asArray:        asArray,
	byId:           byId,
	eventButton:    eventButton,
	optionList:     optionList,
	sanitizeName:   sanitizeName,
	tableCell:      tableCell,
	tableHeader:    tableHeader,
	withBusy:       withBusy,
	withButtonBusy: withButtonBusy,
});
