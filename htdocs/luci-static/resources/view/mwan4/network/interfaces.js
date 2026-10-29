'use strict';
'require form';
'require uci';
'require view';
'require mwan4.fields as mwan4Fields';
'require mwan4.guide as mwan4Guide';
'require mwan4.stability as mwan4Stability';
/* global mwan4Fields */
/* global mwan4Guide */
/* global mwan4Stability */

return view.extend({
	load: function() {
		return Promise.all([
			mwan4Fields.loadHelpers(),
			uci.load('network'),
			uci.load('mwan4'),
			mwan4Stability.probe()
		]);
	},

	render: function(data) {
		let m = new form.Map('mwan4', _('MultiWAN 4 - WAN Links'),
			mwan4Guide.intro(
				_('WAN links are the internet connections MultiWAN 4 uses, each with the addresses it pings to test the connection.'),
				_('Most changes are easier on the overview: add a WAN link or change how it is tested there.')));
		let s = m.section(form.GridSection, 'interface');
		let o;

		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.description = _('Turn off to keep this WAN link configured but unused: paths skip it and it is not tested. On by default.');

		o = s.option(form.ListValue, 'initial_state', _('State before the first check'));
		o.description = _('What MultiWAN 4 assumes until the first health check finishes. Online uses the link at once; Offline keeps it out of use until a check passes. Online by default.');
		o.default = 'online';
		o.value('online', _('Online'));
		o.value('offline', _('Offline'));
		o.modalonly = true;

		o = s.option(form.DynamicList, 'family', _('Address families'));
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.default = 'ipv4';
		o.description = _('IPv4, IPv6 or both: the kinds of traffic this WAN link carries. Choose only what the link really connects. If left empty, IPv4 is used.');

		mwan4Fields.addIdentityOptions(s, form, []);
		mwan4Fields.addHealthOptions(s, form, data[0], [ 'track_ip', 'reliability' ]);

		if (data[3])
			mwan4Stability.addFormOptions(s, form, uci.get('mwan4', 'globals') || {}, true);

		return m.render();
	}
});
