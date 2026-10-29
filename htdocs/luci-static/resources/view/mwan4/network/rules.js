'use strict';
'require form';
'require uci';
'require view';
'require mwan4.guide as mwan4Guide';
/* global mwan4Guide */

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
		let m = new form.Map('mwan4', _('MultiWAN 4 - Routing rules'),
			mwan4Guide.intro(
				_('Routing rules are checked from top to bottom; the first one that matches decides which path the traffic takes.'),
				_('Most changes are easier on the overview: add or change routing rules there.')));
		let s = m.section(form.GridSection, 'rule');
		let o;

		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		s.sortable = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;
		o.description = _('Turn off to keep the rule but stop using it. On by default.');

		o = s.option(form.Value, 'label', _('Rule name'));
		o.placeholder = _('Readable display name');
		o.description = _('The name shown on the overview. If left empty, the internal name of the rule is shown.');

		o = s.option(form.DummyValue, 'rule_id', _('Rule ID'));
		o.default = '-';
		o.description = _('Set by MultiWAN 4 to count the connections of this rule; it never changes while the rule exists. Do not edit.');

		o = s.option(form.DynamicList, 'family', _('Address families'));
		o.description = _('IPv4, IPv6 or both. A rule is checked separately for each, so add both only for a rule meant for both. New rules start as IPv4; if left empty, the rule applies to both.');
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.default = 'ipv4';
		o.modalonly = true;

		o = s.option(form.Value, 'proto', _('Protocol'));
		o.description = _('Which kind of traffic matches. Choose TCP or UDP to match ports. All protocols by default.');
		o.default = 'all';
		o.value('all');
		o.value('tcp');
		o.value('udp');
		o.value('icmp');
		o.value('icmpv6');
		o.value('esp');

		o = s.option(form.DynamicList, 'src_ip', _('Source addresses'));
		o.placeholder = _('Any');
		o.description = _('Only traffic from these addresses or networks (CIDR) matches. If left empty, traffic from any address matches.');
		o.datatype = 'ipaddr';

		o = s.option(form.DynamicList, 'src_mac', _('Source devices (MAC addresses)'));
		o.placeholder = 'aa:bb:cc:dd:ee:ff';
		o.description = _('Only traffic from these devices matches. If left empty, any device matches.');
		o.datatype = 'macaddr';
		o.modalonly = true;

		o = s.option(form.ListValue, 'src_iface', _('Incoming network'));
		o.description = _('Only traffic that enters the router from this network matches. If left empty, traffic from any network matches.');
		o.value('', _('Any network'));
		uci.sections('network', 'interface').forEach(function(section) {
			o.value(section['.name']);
		});
		o.modalonly = true;

		o = s.option(form.Value, 'src_port', _('Source ports'));
		o.placeholder = _('443 or 1000-2000');
		o.validate = validatePortList;
		o.description = _('Only traffic from these source ports matches: single ports, ranges or comma-separated lists. Needs TCP or UDP. If left empty, any source port matches.');
		o.depends('proto', 'tcp');
		o.depends('proto', 'udp');
		o.modalonly = true;

		o = s.option(form.DynamicList, 'dest_ip', _('Destination addresses'));
		o.placeholder = _('Any or 203.0.113.0/24');
		o.description = _('Only traffic going to these addresses or networks matches. If left empty, any destination matches. Use 0.0.0.0/0 or ::/0 only for a catch-all rule.');
		o.datatype = 'ipaddr';

		o = s.option(form.DynamicList, 'domain', _('Destination domains'));
		o.placeholder = _('example.com');
		o.description = _('Traffic to these domains and their subdomains matches. The router learns their addresses from DNS, which needs dnsmasq-full. If left empty, domains are not used.');
		o.datatype = 'hostname';
		o.modalonly = true;

		o = s.option(form.Value, 'dest_port', _('Destination ports'));
		o.placeholder = _('443 or 1000-2000');
		o.validate = validatePortList;
		o.description = _('Only traffic going to these ports matches: single ports, ranges or comma-separated lists. Needs TCP or UDP. If left empty, any port matches.');
		o.depends('proto', 'tcp');
		o.depends('proto', 'udp');

		o = s.option(form.Value, 'dscp', _('DSCP value'));
		o.datatype = 'range(1,63)';
		o.placeholder = _('Any');
		o.description = _('Only traffic tagged with this DSCP priority (1-63) matches, such as calls or games. If left empty, the tag is ignored.');
		o.modalonly = true;

		o = s.option(form.Value, 'ipset', _('DNS or nft set'));
		o.placeholder = _('optional set name');
		o.description = _('Name of an nft set whose addresses match. Most rules do not need it; destination domains are easier. If left empty, no set is used.');
		o.modalonly = true;

		o = s.option(form.ListValue, 'use_strategy', _('Path'));
		o.description = _('Where matching traffic goes: one of your paths, normal routing, or blocked. Required.');
		uci.sections('mwan4', 'strategy').forEach(function(section) {
			o.value(section['.name'], _('Path: %s').format(section['.name']));
		});
		o.value('default', _('Normal routing (main table)'));
		o.value('unreachable', _('Block the traffic (rejected)'));
		o.value('blackhole', _('Block the traffic (dropped silently)'));
		o.rmempty = false;

		o = s.option(form.Flag, 'sticky', _('Sticky sessions (keep a device on one link)'));
		o.description = _('Keep the new connections of a device on the link it used before, for the time below. Off by default.');
		o.default = '0';
		o.modalonly = true;

		o = s.option(form.Value, 'timeout', _('Keep a device on its link for (seconds)'));
		o.datatype = 'range(1,1000000)';
		o.default = '600';
		o.description = _('How long a device stays on its link after its last matching connection. 600 seconds by default.');
		o.depends('sticky', '1');
		o.modalonly = true;

		o = s.option(form.Flag, 'local', _('Include router traffic'));
		o.default = '0';
		o.description = _('Also apply the rule to traffic the router itself sends, such as its own updates. Off by default, so only forwarded traffic matches.');
		o.modalonly = true;

		o = s.option(form.Flag, 'logging', _('Log matches'));
		o.default = '0';
		o.description = _('Write a log line for each match. Needs Log matching rules in Global settings. Off by default.');
		o.modalonly = true;

		return m.render();
	}
});
