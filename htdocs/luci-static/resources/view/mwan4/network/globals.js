'use strict';
'require form';
'require view';
'require mwan4.fields as mwan4Fields';
'require mwan4.guide as mwan4Guide';
'require mwan4.stability as mwan4Stability';
/* global mwan4Fields */
/* global mwan4Guide */
/* global mwan4Stability */

return view.extend({
	load: function() {
		return mwan4Stability.probe();
	},

	render: function(stabilitySupported) {
		let m = new form.Map('mwan4', _('MultiWAN 4 - Global settings'),
			mwan4Guide.intro(
				_('Global settings apply to every WAN link, path and routing rule.'),
				_('Most changes are easier on the overview: open Global settings in its top panel.')));
		let s = m.section(form.NamedSection, 'globals', 'globals');
		mwan4Fields.addGlobalOptions(s, form);

		if (stabilitySupported)
			mwan4Stability.addFormOptions(s, form, {}, false);

		return m.render();
	}
});
