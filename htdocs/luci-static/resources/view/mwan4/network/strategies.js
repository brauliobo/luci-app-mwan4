'use strict';
'require form';
'require uci';
'require view';
'require mwan4.guide as mwan4Guide';
'require mwan4.stability as mwan4Stability';
/* global mwan4Guide */
/* global mwan4Stability */

return view.extend({
	load: function() {
		return Promise.all([ uci.load('mwan4'), mwan4Stability.probe() ]);
	},

	render: function(data) {
		let m = new form.Map('mwan4', _('MultiWAN 4 - Paths'),
			mwan4Guide.intro(
				_('A path is the list of link priorities a routing rule uses, and what happens when none of them is available.'),
				_('Most changes are easier on the overview: the routing rule editor builds and reuses paths for you.')));
		let s = m.section(form.GridSection, 'strategy');
		let o;

		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		o = s.option(form.DynamicList, 'use_route', _('Paths'));
		o.description = _('Paths this strategy may use when their WAN links are healthy. Path metric and weight decide priority and balancing.');
		uci.sections('mwan4', 'route').forEach(function(section) {
			o.value(section['.name']);
		});
		o.rmempty = false;

		o = s.option(form.ListValue, 'last_resort', _('When no path is usable'));
		o.description = _('Choose whether traffic should fail closed or use the main routing table when every path in this strategy is unhealthy or unavailable.');
		o.default = 'unreachable';
		o.value('unreachable', _('Fail closed (reject traffic)'));
		o.value('blackhole', _('Fail closed (drop traffic)'));
		o.value('default', _('Use main routing table'));
		o.modalonly = true;

		if (data[1])
			mwan4Stability.addQualityOptions(s, form);

		return m.render();
	}
});
