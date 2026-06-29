'use strict';
'require form';
'require uci';
'require view';

function overviewDescription(text) {
	return E('span', [
		text,
		' ',
		E('a', { href: L.url('admin/network/mwan4/overview') }, [ _('Back to overview.') ])
	]);
}

function validatePositiveMark(section_id, value) {
	if (value == null || value == '')
		return true;

	return /^(0x[0-9a-fA-F]+|[1-9][0-9]*)$/.test(value)
		? true
		: _('Use a positive decimal value or hexadecimal value such as 0x3F00.');
}

return view.extend({
	render: function() {
		let m = new form.Map('mwan4', _('MultiWAN 4 - Global Settings'),
			overviewDescription(_('Global settings affect all WAN links, strategies, paths, and traffic policies.')));
		let s = m.section(form.NamedSection, 'globals', 'globals');
		let o;

		o = s.option(form.Value, 'mmx_mask', _('Firewall mark mask'));
		o.description = _('Bit mask used to keep mwan4 policy marks separate from other firewall marks. Use enough set bits for all interface IDs plus reserved fallback marks.');
		o.default = '0x3F00';
		o.placeholder = '0x3F00';
		o.validate = validatePositiveMark;
		o.rmempty = false;
		o.cfgvalue = function(section_id) {
			return uci.get('mwan4', section_id, 'mmx_mask') ||
				uci.get('mwan4', section_id, 'mwan4.mmx_mask') || '0x3F00';
		};
		o.write = function(section_id, value) {
			uci.set('mwan4', section_id, 'mmx_mask', value);
		};

		o = s.option(form.Flag, 'source_routing', _('Source routing'));
		o.description = _('Create source-based rules in addition to traffic policy marks.');
		o.default = '0';
		o.cfgvalue = function(section_id) {
			return uci.get('mwan4', section_id, 'source_routing') ||
				uci.get('mwan4', section_id, 'mwan4.source_routing') || '0';
		};
		o.write = function(section_id, value) {
			uci.set('mwan4', section_id, 'source_routing', value);
		};

		o = s.option(form.DynamicList, 'rt_table_lookup', _('Additional routing tables'));
		o.description = _('Extra routing tables mwan4 should inspect in addition to the main routing table.');
		o.datatype = 'or(uinteger,string)';
		o.placeholder = _('100 200 vpn');

		o = s.option(form.Flag, 'logging', _('Log matching traffic policies'));
		o.description = _('Enable logging for policies that also have per-policy logging enabled.');
		o.default = '0';

		o = s.option(form.ListValue, 'loglevel', _('Log level'));
		o.default = 'notice';
		[ 'debug', 'info', 'notice', 'warning', 'err' ].forEach(function(v) { o.value(v); });
		o.description = _('Syslog priority used for logged mwan4 policy matches and service messages.');

		return m.render();
	}
});
