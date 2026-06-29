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

function isValidPortToken(token) {
	let parts = token.split(/[-:]/);
	let start = Number(parts[0]);
	let end = parts.length > 1 ? Number(parts[1]) : start;

	return /^\d+([-:]\d+)?$/.test(token) && start >= 1 && start <= 65535 && end >= start && end <= 65535;
}

function validatePortList(section_id, value) {
	let tokens = (value || '').split(/[\s,]+/).filter(function(token) { return token != ''; });

	if (!tokens.length)
		return true;

	return tokens.every(isValidPortToken)
		? true
		: _('Use ports from 1-65535, ranges such as 1000-2000, or comma-separated lists.');
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('mwan4'),
			uci.load('network')
		]);
	},

	render: function() {
		let m = new form.Map('mwan4', _('MultiWAN 4 - Traffic Policies'),
			overviewDescription(_('Traffic policies are evaluated from top to bottom and choose a policy path, the main routing table, or a fail-closed action for matching traffic.')));
		let s = m.section(form.GridSection, 'rule');
		let o;

		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		s.sortable = true;

		o = s.option(form.DynamicList, 'family', _('Address families'));
		o.description = _('IPv4 and IPv6 traffic policies are evaluated separately. Add both only for equivalent dual-stack matches.');
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.default = 'ipv4';
		o.modalonly = true;

		o = s.option(form.Value, 'proto', _('Protocol'));
		o.description = _('Choose TCP or UDP before matching source or destination ports.');
		o.default = 'all';
		o.value('all');
		o.value('tcp');
		o.value('udp');
		o.value('icmp');
		o.value('icmpv6');
		o.value('esp');

		o = s.option(form.Value, 'src_ip', _('Source address'));
		o.placeholder = _('Any');
		o.description = _('Optional CIDR, single IP, or host address to match as the traffic source.');
		o.datatype = 'ipaddr';

		o = s.option(form.ListValue, 'src_iface', _('Ingress interface'));
		o.description = _('Optional network interface where matching traffic enters the router.');
		o.value('', _('Any interface'));
		uci.sections('network', 'interface').forEach(function(section) {
			o.value(section['.name']);
		});
		o.modalonly = true;

		o = s.option(form.Value, 'src_port', _('Source ports'));
		o.placeholder = _('443 or 1000-2000');
		o.validate = validatePortList;
		o.description = _('Ports support single values, ranges, and comma-separated lists.');
		o.depends('proto', 'tcp');
		o.depends('proto', 'udp');
		o.modalonly = true;

		o = s.option(form.Value, 'dest_ip', _('Destination address'));
		o.placeholder = _('Any or 203.0.113.0/24');
		o.description = _('Use 0.0.0.0/0 or ::/0 only when you really want a catch-all traffic policy.');
		o.datatype = 'ipaddr';

		o = s.option(form.Value, 'dest_port', _('Destination ports'));
		o.placeholder = _('443 or 1000-2000');
		o.validate = validatePortList;
		o.description = _('Ports support single values, ranges, and comma-separated lists.');
		o.depends('proto', 'tcp');
		o.depends('proto', 'udp');

		o = s.option(form.Value, 'ipset', _('DNS or nft set'));
		o.placeholder = _('optional set name');
		o.description = _('Optional nft set containing destination domains or addresses.');
		o.modalonly = true;

		o = s.option(form.ListValue, 'use_strategy', _('Policy path'));
		o.description = _('Choose a mwan4 policy path, the main routing table, or a fail-closed action.');
		uci.sections('mwan4', 'strategy').forEach(function(section) {
			o.value(section['.name'], _('Policy path: %s').format(section['.name']));
		});
		o.value('default', _('Use main routing table'));
		o.value('unreachable', _('Fail closed (reject traffic)'));
		o.value('blackhole', _('Fail closed (drop traffic)'));
		o.rmempty = false;

		o = s.option(form.Flag, 'sticky', _('Sticky source sessions'));
		o.description = _('Keep matching flows on the same policy path for the timeout period.');
		o.default = '0';
		o.modalonly = true;

		o = s.option(form.Value, 'timeout', _('Sticky timeout seconds'));
		o.datatype = 'range(1,1000000)';
		o.default = '600';
		o.description = _('How long a sticky source mapping is kept after the last match.');
		o.depends('sticky', '1');
		o.modalonly = true;

		o = s.option(form.Flag, 'logging', _('Log matches'));
		o.default = '0';
		o.description = _('Write policy matches to the system log when global logging permits it.');
		o.modalonly = true;

		return m.render();
	}
});
