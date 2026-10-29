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
		o.description = _('WAN link used by this path.');
		uci.sections('mwan4', 'interface').forEach(function(section) {
			o.value(section['.name']);
		});
		o.rmempty = false;

		o = s.option(form.Value, 'metric', _('Priority metric'));
		o.description = _('Lower metrics are preferred. Equal metrics are balanced by weight.');
		o.datatype = 'range(1,256)';
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'weight', _('Weight'));
		o.description = _('Relative share when multiple healthy paths have the same metric.');
		o.datatype = 'range(1,100)';
		o.default = '1';
		o.rmempty = false;

		return m.render();
	}
});
