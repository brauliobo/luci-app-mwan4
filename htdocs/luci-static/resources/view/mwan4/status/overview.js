'use strict';
'require rpc';
'require view';
'require mwan4.common as mwan4Common';
'require mwan4.guide as mwan4Guide';

var E = mwan4Common.element;
/* global mwan4Common */
/* global mwan4Guide */

const callStatus = rpc.declare({
	object: 'mwan4',
	method: 'status',
	expect: { }
});

const callSessionAccess = rpc.declare({
	object: 'session',
	method: 'access',
	params: [ 'scope', 'object', 'function' ],
	expect: { access: false }
});

mwan4Common.addStylesheet();

function countObject(value) {
	return value && typeof value == 'object' ? Object.keys(value).length : 0;
}

function statusCard(label, value, body) {
	return E('div', { class: 'mwan4-insight-card' }, [
		E('span', [ label ]),
		E('strong', [ value ]),
		body ? E('small', [ body ]) : ''
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4', 'read'), false),
			L.resolveDefault(callSessionAccess('access-group', 'luci-app-mwan4-diagnostics', 'read'), false)
		]);
	},

	render: function(data) {
		let status = data[0] || {};
		let interfaces = status.interfaces || {};
		let diagnostics = status.diagnostics || {};
		let hasConfigAccess = !!data[1];
		let hasDiagnosticsAccess = !!data[2];
		let actions = [];

		if (hasConfigAccess)
			actions.push(E('a', { class: 'btn cbi-button cbi-button-apply', href: L.url('admin/network/mwan4/overview') }, [ _('Open the overview') ]));
		if (hasDiagnosticsAccess)
			actions.push(E('a', { class: 'btn cbi-button cbi-button-neutral', href: L.url('admin/network/mwan4/diagnostics') }, [ _('Open diagnostics') ]));

		return E('div', { class: 'cbi-map' }, [
			E('h2', [ _('MultiWAN 4') ]),
			E('div', { class: 'cbi-section' }, [
				E('p', [ _('A read-only summary of MultiWAN 4. The buttons below appear only if this account may open those pages.') ]),
				mwan4Common.renderRuntimeWarnings(status, { diagnosticsAccess: hasDiagnosticsAccess }),
				mwan4Common.renderNextSteps(status),
				E('div', { class: 'mwan4-state-grid mwan4-compact-metrics' }, [
					statusCard(_('WAN links'), String(countObject(interfaces)), _('Internet connections MultiWAN 4 knows about')),
					statusCard(_('Service'), diagnostics.service_running ? _('Running') : _('Not running'), _('Whether MultiWAN 4 is running right now')),
					statusCard(_('Health checks running'), _('%d / %d').format(diagnostics.trackers_running || 0, diagnostics.trackers_expected || 0), _('Processes that test the WAN links'))
				]),
				E('div', { class: 'mwan4-actions' }, (actions.length ? actions : [ E('span', { class: 'mwan4-muted-line' }, [ _('This account cannot open the overview or diagnostics.') ]) ]).concat([ mwan4Guide.termsButton() ]))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
