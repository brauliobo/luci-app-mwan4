'use strict';
'require form';
'require uci';
'require view';
'require mwan4.stability as mwan4Stability';
/* global mwan4Stability */

function overviewDescription(text) {
	return E('span', [
		text,
		' ',
		E('a', { href: L.url('admin/network/mwan4/overview') }, [ _('Back to overview.') ])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('mwan4'), mwan4Stability.probe() ]);
	},

	render: function(data) {
		let m = new form.Map('mwan4', _('MultiWAN 4 - Strategies'),
			overviewDescription(_('Strategies combine paths for failover or load balancing: the lowest healthy metric wins, equal metrics are balanced by weight.')));
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
