'use strict';
'require baseclass';

// LuCI's dom.append renders null array elements as the text "null": drop empty children.
function element(tag, attrs, children) {
	let compact = value => Array.isArray(value) ? value.filter(child => child != null && child !== false) : value;

	return E(tag, compact(attrs), compact(children));
}

function addStylesheet() {
	if (document.querySelector('link[data-mwan4-style="1"]'))
		return;

	document.querySelector('head').appendChild(E('link', {
		'data-mwan4-style': '1',
		rel:                 'stylesheet',
		type:                'text/css',
		href:                L.resource('view/mwan4/mwan4.css')
	}));
}

function statusClass(status, up) {
	if (status == 'online')
		return 'mwan4-online';
	if (status == 'offline' || status == 'down' || up === false)
		return 'mwan4-offline';
	if (status == 'disabled' || status == 'unknown')
		return 'mwan4-muted';
	return 'mwan4-warning';
}

function formatDisplayValue(value, fallback) {
	if (value == null || value === '')
		return fallback || _('Not available');

	if (Array.isArray(value)) {
		let list = value.map(function(item) {
			return formatDisplayValue(item, '');
		}).filter(function(item) {
			return item != '';
		});

		return list.join(', ') || fallback || _('Not available');
	}

	if (typeof value == 'object') {
		let keys = Object.keys(value).sort();

		if (value.message)
			return formatDisplayValue(value.message, fallback);
		if (value.name)
			return formatDisplayValue(value.name, fallback);
		if (value.interface && value.status)
			return _('%s (%s)').format(value.interface, value.status);

		return keys.map(function(key) {
			return _('%s: %s').format(key, formatDisplayValue(value[key], _('not set')));
		}).join(', ') || fallback || _('Not available');
	}

	return String(value);
}

function formatBytes(bytes) {
	let units = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
	let unit = 0;

	for (; bytes >= 1024 && unit < units.length - 1; unit++)
		bytes /= 1024;

	return '%s %s'.format(unit ? bytes.toFixed(1) : bytes, units[unit]);
}

function renderPill(text, cls) {
	return E('span', { class: 'mwan4-pill %s'.format(cls || 'mwan4-muted') }, [ formatDisplayValue(text, _('unknown')) ]);
}

function diagnosticsData(input) {
	return (input || {}).diagnostics || input || {};
}

function renderNextSteps(input) {
	let diagnostics = diagnosticsData(input);
	let steps = diagnostics.next_steps || [];

	if (!steps.length)
		return E('div');

	return E('div', { class: 'mwan4-next-steps' }, [
		E('h3', [ _('What should I check next?') ]),
		E('ol', steps.map(function(step) {
			return E('li', [
				E('strong', [ formatDisplayValue(step.title || step.id, _('Next check')) ]),
				step.detail ? E('span', [ formatDisplayValue(step.detail) ]) : '',
				step.command ? E('code', [ step.command ]) : ''
			]);
		}))
	]);
}

function setBusy(node, busy) {
	if (!node)
		return;

	node.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function warningAdvice(canOpenDiagnostics, onDiagnostics) {
	if (onDiagnostics)
		return _('Try restarting MultiWAN 4. If this message stays, run Full diagnostics below.');

	return canOpenDiagnostics
		? _('Try restarting MultiWAN 4. If this message stays, open Diagnostics.')
		: _('Try restarting MultiWAN 4. If this message stays, ask an administrator who can open Diagnostics.');
}

function warningMore(canOpenDiagnostics, onDiagnostics) {
	if (onDiagnostics)
		return _('Run Full diagnostics to see the other warnings.');

	return canOpenDiagnostics ? _('Open Diagnostics to see the other warnings.') : _('Ask an administrator who can open Diagnostics for the other warnings.');
}

function renderWarningItem(warning) {
	let message = formatDisplayValue(warning && warning.message ? warning.message : warning && warning.code ? warning.code : warning, _('Runtime warning'));
	let action = warning && warning.action ? formatDisplayValue(warning.action) : null;
	let check = warning && warning.check ? formatDisplayValue(warning.check) : null;

	return E('li', [
		E('span', [ message ]),
		action ? E('small', [ _('What to do: %s').format(action) ]) : '',
		check ? E('small', [ _('How to check: %s').format(check) ]) : ''
	]);
}

/* options.diagnosticsAccess: may the session open Diagnostics; options.link: false drops the link; options.here: the page is Diagnostics. */
function renderRuntimeWarnings(status, options) {
	options = options || {};

	let warnings = diagnosticsData(status).warnings || [];
	let canOpenDiagnostics = options.diagnosticsAccess !== false;
	let showLink = canOpenDiagnostics && options.link !== false && !options.here;

	if (!Array.isArray(warnings))
		warnings = warnings ? [ warnings ] : [];

	if (!warnings.length)
		return E('div');

	let visibleWarnings = warnings.slice(0, 3);

	return E('div', { class: 'mwan4-alert mwan4-alert-warning mwan4-runtime-warning', role: 'alert', 'aria-live': 'polite' }, [
		E('div', { class: 'mwan4-alert-heading' }, [
			E('strong', [ _('MultiWAN 4 needs attention') ]),
			E('span', [ _('%d warning(s)').format(warnings.length) ])
		]),
		E('p', [ _('MultiWAN 4 is set up but is not fully running, so failover and routing rules may not be applied.') ]),
		E('ul', visibleWarnings.map(renderWarningItem).concat(warnings.length > visibleWarnings.length ? [
			E('li', { class: 'mwan4-muted-line' }, [ warningMore(canOpenDiagnostics, options.here) ])
		] : [])),
		E('p', { class: 'mwan4-alert-action' }, [ warningAdvice(canOpenDiagnostics, options.here) ]),
		showLink ? E('p', { class: 'mwan4-alert-action' }, [
			E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open Diagnostics') ])
		]) : ''
	]);
}

function renderAclNotice(hasAccess, message) {
	if (hasAccess)
		return E('div');

	return E('div', { class: 'mwan4-alert mwan4-alert-info mwan4-alert-compact' }, [
		E('strong', [ _('Limited access') ]),
		E('p', [ message || _('This session can view mwan4 status but does not have permission for these controls.') ])
	]);
}

function rpcErrorMessage(result, fallback) {
	let errors = result && result.errors;

	if (!Array.isArray(errors))
		errors = errors ? [ errors ] : [];

	if (errors.length)
		return errors.map(function(error) {
			return error.message || error.code || fallback || _('RPC request failed');
		}).join('; ');

	if (result && result.ok === false)
		return fallback || _('RPC request failed');

	return null;
}

return baseclass.extend({
	element:         element,
	addStylesheet:         addStylesheet,
	formatBytes:           formatBytes,
	formatDisplayValue:    formatDisplayValue,
	renderAclNotice:       renderAclNotice,
	renderNextSteps:       renderNextSteps,
	renderPill:            renderPill,
	renderRuntimeWarnings: renderRuntimeWarnings,
	rpcErrorMessage:       rpcErrorMessage,
	setBusy:               setBusy,
	statusClass:           statusClass
});
