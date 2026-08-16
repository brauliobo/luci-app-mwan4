'use strict';
'require baseclass';

const FEATURE_LABELS = {
	advanced_probes: _('Advanced probe helpers'),
	bfd:             _('FRR BFD'),
	ipsec:           _('IPsec'),
	openvpn:         _('OpenVPN'),
	pbr:             _('PBR'),
	vrf:             _('VRF'),
	wireguard:       _('WireGuard')
};

function asArray(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value : [ value ];
}

function countItems(value) {
	if (Array.isArray(value))
		return value.length;
	if (value && typeof value == 'object')
		return Object.keys(value).length;
	return value ? 1 : 0;
}

function joinDisplayList(values, emptyLabel) {
	values = asArray(values).map(function(value) { return String(value || '').trim(); }).filter(function(value) { return value != ''; });
	return values.length ? values.join(', ') : emptyLabel;
}

function flagEnabled(value) {
	return value === true || value == '1' || value == 'true';
}

function sanitizeSectionName(value, fallback) {
	value = String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
	return value || fallback;
}

function resultErrors(result, fallback) {
	let errors = asArray((result || {}).errors).map(function(error) {
		return error && (error.message || error.code) ? (error.message || error.code) : String(error || '');
	}).filter(function(message) { return message != ''; });

	return errors.length ? errors.join('; ') : fallback;
}

function validationFailures(rows) {
	return asArray(rows).filter(function(row) { return row && row.ok === false; }).length;
}

function validationSummary(rows, emptyText) {
	rows = asArray(rows);
	if (!rows.length)
		return emptyText || _('No validation rows reported yet.');

	let failed = validationFailures(rows);
	return failed
		? _('%d validation check(s) need attention.').format(failed)
		: _('All reported validation checks passed.');
}

return baseclass.extend({
	FEATURE_LABELS:      FEATURE_LABELS,
	asArray:             asArray,
	countItems:          countItems,
	flagEnabled:         flagEnabled,
	joinDisplayList:     joinDisplayList,
	resultErrors:        resultErrors,
	sanitizeSectionName: sanitizeSectionName,
	validationFailures:  validationFailures,
	validationSummary:   validationSummary
});
