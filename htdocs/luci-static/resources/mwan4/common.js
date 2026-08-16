'use strict';
'require baseclass';

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

function renderRuntimeWarnings(status, options) {
	let diagnostics = diagnosticsData(status);
	let warnings = diagnostics.warnings || [];
	let canOpenDiagnostics = !options || options.diagnosticsAccess !== false;

	if (!Array.isArray(warnings))
		warnings = warnings ? [ warnings ] : [];

	let visibleWarnings = warnings.slice(0, 3);

	if (!warnings.length)
		return E('div');

	return E('div', { class: 'mwan4-alert mwan4-alert-warning mwan4-runtime-warning', role: 'alert', 'aria-live': 'polite' }, [
		E('div', { class: 'mwan4-alert-heading' }, [
			E('strong', [ _('Runtime attention needed') ]),
			E('span', [ _('%d warning(s)').format(warnings.length) ])
		]),
		E('p', [ _('mwan4 is configured but runtime state is incomplete. Failover strategies and traffic policies may not be enforced.') ]),
		E('ul', visibleWarnings.map(function(warning) {
			let message = formatDisplayValue(warning && warning.message ? warning.message : warning && warning.code ? warning.code : warning, _('Runtime warning'));
			let action = warning && warning.action ? formatDisplayValue(warning.action) : null;
			let check = warning && warning.check ? formatDisplayValue(warning.check) : null;

			return E('li', [
				E('span', [ message ]),
				action ? E('small', [ _('Action: %s').format(action) ]) : '',
				check ? E('small', [ _('Check: %s').format(check) ]) : ''
			]);
		}).concat(warnings.length > visibleWarnings.length ? [
			E('li', { class: 'mwan4-muted-line' }, [ _('Open Diagnostics to inspect the remaining warning details.') ])
		] : [])),
		E('p', { class: 'mwan4-alert-action' }, [ canOpenDiagnostics
			? _('Recommended action: restart mwan4, then check Diagnostics if the warning remains.')
			: _('Recommended action: restart mwan4, then ask an administrator with diagnostics access to inspect remaining warnings.') ]),
		canOpenDiagnostics ? E('p', { class: 'mwan4-alert-action' }, [
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
	addStylesheet:         addStylesheet,
	formatDisplayValue:    formatDisplayValue,
	renderAclNotice:       renderAclNotice,
	renderNextSteps:       renderNextSteps,
	renderPill:            renderPill,
	renderRuntimeWarnings: renderRuntimeWarnings,
	rpcErrorMessage:       rpcErrorMessage,
	setBusy:               setBusy,
	statusClass:           statusClass
});
