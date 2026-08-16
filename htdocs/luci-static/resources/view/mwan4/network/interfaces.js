'use strict';
'require form';
'require fs';
'require uci';
'require view';

function overviewDescription(text) {
	return E('span', [
		text,
		' ',
		E('a', { href: L.url('admin/network/mwan4/overview') }, [ _('Back to overview.') ])
	]);
}

function validatePositiveInteger(section_id, value) {
	if (value == null || value == '')
		return true;

	return /^[1-9][0-9]*$/.test(value)
		? true
		: _('Use a positive integer, or leave this empty for automatic assignment.');
}

function validateFirewallMark(section_id, value) {
	if (value == null || value == '')
		return true;

	return /^(0x[0-9a-fA-F]+|[1-9][0-9]*)$/.test(value)
		? true
		: _('Use a positive decimal mark or hexadecimal mark such as 0x100.');
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.stat('/usr/bin/httping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/nping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/arping'), {}),
			L.resolveDefault(fs.stat('/usr/bin/nslookup'), {}),
			uci.load('network')
		]);
	},

	render: function(stats) {
		let m = new form.Map('mwan4', _('MultiWAN 4 - WAN Links'),
			overviewDescription(_('WAN links map OpenWrt network interfaces to health checks and SLA thresholds.')));
		let s = m.section(form.GridSection, 'interface');
		let o;

		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.description = _('Disabled links stay configured but are ignored by mwan4 routing and health checks.');

		o = s.option(form.ListValue, 'initial_state', _('Initial state'));
		o.description = _('Initial health state before the first health check result is available.');
		o.default = 'online';
		o.value('online', _('Online'));
		o.value('offline', _('Offline'));
		o.modalonly = true;

		o = s.option(form.DynamicList, 'family', _('Address families'));
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.default = 'ipv4';
		o.description = _('Select IPv4, IPv6, or both when this link has working connectivity for each family.');

		o = s.option(form.Value, 'id', _('Stable interface ID'));
		o.placeholder = _('automatic');
		o.validate = validatePositiveInteger;
		o.description = _('Keeps generated firewall marks and routing tables stable across section reordering.');
		o.modalonly = true;

		o = s.option(form.Value, 'table_id', _('Routing table ID'));
		o.placeholder = _('same as stable ID');
		o.validate = validatePositiveInteger;
		o.description = _('Optional Linux routing table ID. Leave empty to reuse the stable interface ID.');
		o.modalonly = true;

		o = s.option(form.Value, 'mark', _('Firewall mark'));
		o.placeholder = _('derived from mask');
		o.validate = validateFirewallMark;
		o.description = _('Optional fwmark for this interface. It must fit inside the global firewall mark mask.');
		o.modalonly = true;

		o = s.option(form.DynamicList, 'track_ip', _('Health check targets'));
		o.description = _('Hosts or addresses used to decide whether this WAN link is healthy.');
		o.datatype = 'host';

		o = s.option(form.ListValue, 'track_method', _('Health check method'));
		o.description = _('Probe method used for this WAN link health check.');
		o.default = 'ping';
		o.value('ping', _('ICMP ping'));
		if (stats[0].type == 'file') o.value('httping', _('HTTP probe'));
		if (stats[1].type == 'file') {
			o.value('nping-tcp', _('TCP probe'));
			o.value('nping-udp', _('UDP probe'));
			o.value('nping-icmp', _('ICMP nping probe'));
			o.value('nping-arp', _('ARP nping probe'));
		}
		if (stats[2].type == 'file') o.value('arping', _('ARP probe'));
		if (stats[3].type == 'file') o.value('nslookup', _('DNS probe'));
		o.modalonly = true;

		o = s.option(form.Flag, 'httping_ssl', _('HTTPS health checks'));
		o.depends('track_method', 'httping');
		o.description = _('Use HTTPS requests for httping probes.');
		o.modalonly = true;

		o = s.option(form.Value, 'reliability', _('Required successful health check targets'));
		o.description = _('Minimum number of targets that must pass before the WAN link is considered healthy.');
		o.datatype = 'range(1,100)';
		o.default = '1';

		o = s.option(form.Value, 'count', _('Probe count'));
		o.datatype = 'range(1,20)';
		o.default = '1';
		o.description = _('Probe attempts sent to each health check target during one check cycle.');
		o.modalonly = true;

		o = s.option(form.Value, 'size', _('Ping size'));
		o.datatype = 'range(1,65507)';
		o.default = '56';
		o.depends('track_method', 'ping');
		o.modalonly = true;

		o = s.option(form.Value, 'max_ttl', _('Max TTL'));
		o.datatype = 'range(1,255)';
		o.default = '60';
		o.depends('track_method', 'ping');
		o.description = _('Maximum hop count for ping health check probes.');
		o.modalonly = true;

		o = s.option(form.Flag, 'check_quality', _('Use latency/loss SLA thresholds'));
		o.default = '0';
		o.depends('track_method', 'ping');
		o.description = _('Enable SLA checks so high latency or packet loss can mark the link unhealthy.');
		o.modalonly = true;

		[ [ 'failure_latency', _('Failure latency (ms)'), '1000', 'uinteger' ],
		  [ 'failure_loss', _('Failure packet loss (%)'), '40', 'range(0,100)' ],
		  [ 'recovery_latency', _('Recovery latency (ms)'), '500', 'uinteger' ],
		  [ 'recovery_loss', _('Recovery packet loss (%)'), '10', 'range(0,100)' ] ].forEach(function(spec) {
			o = s.option(form.Value, spec[0], spec[1]);
			o.datatype = spec[3];
			o.default = spec[2];
			o.depends('check_quality', '1');
			o.description = _('Failure values take the link down; recovery values bring it back after conditions improve.');
			o.modalonly = true;
		});

		[ [ 'timeout', _('Probe timeout (seconds)'), '4' ],
		  [ 'interval', _('Healthy interval (seconds)'), '10' ],
		  [ 'failure_interval', _('Failure interval (seconds)'), '5' ],
		  [ 'recovery_interval', _('Recovery interval (seconds)'), '5' ],
		  [ 'down', _('Failures before down'), '5' ],
		  [ 'up', _('Successes before up'), '5' ] ].forEach(function(spec) {
			o = s.option(form.Value, spec[0], spec[1]);
			o.datatype = 'uinteger';
			o.default = spec[2];
			o.description = _('Tune probe timing carefully; lower values react faster but can flap unstable links.');
			o.modalonly = true;
		});

		o = s.option(form.Flag, 'keep_failure_interval', _('Keep failure interval while down'));
		o.description = _('Keep probing at the failure interval until the WAN link recovers.');
		o.default = '0';
		o.modalonly = true;

		return m.render();
	}
});
