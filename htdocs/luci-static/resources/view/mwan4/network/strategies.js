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

		o = s.option(form.DynamicList, 'use_route', _('Link priorities'));
		o.description = _('The links this path may use, taken from the Link priorities tab. The lowest healthy priority wins; equal priorities share the traffic by weight. At least one is required.');
		uci.sections('mwan4', 'route').forEach(function(section) {
			o.value(section['.name']);
		});
		o.rmempty = false;

		o = s.option(form.ListValue, 'last_resort', _('When no link in the path is available'));
		o.description = _('What happens to the traffic of this path when every link in it is down or on hold. Stopping the traffic keeps it from leaking to another link; normal routing lets it follow the router default route. Stop the traffic (rejected) by default.');
		o.default = 'unreachable';
		o.value('unreachable', _('Stop the traffic (rejected)'));
		o.value('blackhole', _('Stop the traffic (dropped silently)'));
		o.value('default', _('Use normal routing'));
		o.modalonly = true;

		if (data[1])
			mwan4Stability.addQualityOptions(s, form);

		return m.render();
	}
});
