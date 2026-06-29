'use strict';
'require view';
'require mwan4.common as mwan4Common';
/* global mwan4Common */

mwan4Common.addStylesheet();

return view.extend({
	render: function() {
		let target = L.url('admin/network/mwan4/overview');

		window.setTimeout(function() {
			window.location.replace(target);
		}, 0);

		return E('div', { class: 'cbi-map' }, [
			E('h2', [ _('MultiWAN 4') ]),
			E('div', { class: 'cbi-section mwan4-empty-state' }, [
				E('div', { class: 'mwan4-empty-copy' }, [
					E('strong', [ _('Monitoring moved to the MultiWAN 4 overview.') ]),
					E('span', [ _('The overview now combines setup guidance, live health, runtime warnings, and diagnostics links in one place.') ])
				]),
				E('div', { class: 'mwan4-empty-actions' }, [
					E('a', { class: 'btn cbi-button cbi-button-apply', href: target }, [ _('Open overview') ])
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
