'use strict';
'require form';
'require uci';
'require view';
'require mwan4.guide as mwan4Guide';
/* global mwan4Guide */

return view.extend({
	load: function() {
		return uci.load('mwan4');
	},

	render: function() {
		let m = new form.Map('mwan4', _('MultiWAN 4 - Link priorities'),
			mwan4Guide.intro(
				_('A link priority puts one WAN link into a path, with an order (priority) and a share of the traffic (weight).'),
				_('Most changes are easier on the overview: choose the links of a routing rule and their order there.')));
		let s = m.section(form.GridSection, 'route');
		let o;

		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		o = s.option(form.ListValue, 'interface', _('WAN link'));
		o.description = _('The WAN link this entry belongs to. A link needs an entry here before a path can use it. Required.');
		uci.sections('mwan4', 'interface').forEach(function(section) {
			o.value(section['.name']);
		});
		o.rmempty = false;

		o = s.option(form.Value, 'metric', _('Priority (lower is used first)'));
		o.description = _('Links with a lower number are used first; links with the same number share the traffic by weight. 1 by default.');
		o.datatype = 'range(1,256)';
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'weight', _('Weight'));
		o.description = _('Share of new connections this link gets among links with the same priority: weight 3 gets three times as many as weight 1. 1 by default.');
		o.datatype = 'range(1,100)';
		o.default = '1';
		o.rmempty = false;

		return m.render();
	}
});
