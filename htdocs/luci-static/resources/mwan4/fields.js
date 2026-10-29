'use strict';
'require baseclass';
'require fs';
'require mwan4.explain as mwan4Explain';

/* global mwan4Explain */

/*
 * Option definitions the WAN Links, Advanced and Global settings tabs have in common, so a field reads the same
 * wherever it appears. Labels that also exist on the overview (health checks) are kept identical to it.
 */

const HELPERS = [ [ 'httping', '/usr/bin/httping' ], [ 'nping', '/usr/bin/nping' ], [ 'arping', '/usr/bin/arping' ], [ 'nslookup', '/usr/bin/nslookup' ] ];

function loadHelpers() {
	return Promise.all(HELPERS.map(helper => L.resolveDefault(fs.stat(helper[1]), {}))).then(stats =>
		Object.fromEntries(HELPERS.map((helper, index) => [ helper[0], stats[index].type == 'file' ])));
}

function validatePositiveInteger(section_id, value) {
	return !value || /^[1-9][0-9]*$/.test(value) ? true : _('Use a positive whole number, or leave this empty for automatic assignment.');
}

function validateFirewallMark(section_id, value) {
	return !value || /^(0x[0-9a-fA-F]+|[1-9][0-9]*)$/.test(value) ? true : _('Use a positive decimal mark or hexadecimal mark such as 0x100.');
}

/* Adds a text field; `spec` is [ name, label, help, datatype, default, placeholder ]. */
function addValue(section, form, spec, columns) {
	let o = section.option(form.Value, spec[0], spec[1]);

	o.description = spec[2];
	o.datatype = spec[3];
	o.default = spec[4];
	o.placeholder = spec[5] || spec[4];
	o.modalonly = columns.indexOf(spec[0]) < 0;

	return o;
}

function addIdentityOptions(section, form, columns) {
	let o = addValue(section, form, [ 'id', _('Stable ID'),
		_('A number that keeps the firewall mark and routing table of this link the same when links are added or reordered. If left empty, one is assigned automatically.'),
		null, null, _('automatic') ], columns);

	o.validate = validatePositiveInteger;

	o = addValue(section, form, [ 'table_id', _('Routing table'),
		_('The routing table that holds the routes of this link. If left empty, the stable ID is used.'), null, null, _('same as stable ID') ], columns);
	o.validate = validatePositiveInteger;

	o = addValue(section, form, [ 'mark', _('Firewall mark'),
		_('A number the router puts on the traffic of this link to tell which link it must use. It must fit inside the global firewall mark mask. If left empty, it is worked out from the mask and the stable ID.'),
		null, null, _('derived from mask') ], columns);
	o.validate = validateFirewallMark;
}

function addMethodOptions(section, form, helpers, columns) {
	let labels = mwan4Explain.methodLabels();
	let o = section.option(form.DynamicList, 'track_ip', _('Health check targets'));

	o.description = _('Addresses used to test this WAN link. Use at least two: with a single target one lost reply can mark the link down. If left empty, the link is not tested.');
	o.datatype = 'host';
	o.placeholder = '1.1.1.1';
	o.modalonly = columns.indexOf('track_ip') < 0;

	o = section.option(form.ListValue, 'track_method', _('Health check method'));
	o.description = _('How each target is tested. Methods other than ping need extra tools and are listed only when installed. Ping by default.');
	o.default = 'ping';
	o.value('ping', labels.ping);
	[ [ 'httping', 'httping' ], [ 'nping-tcp', 'nping' ], [ 'nping-udp', 'nping' ], [ 'nping-icmp', 'nping' ], [ 'nping-arp', 'nping' ],
	  [ 'arping', 'arping' ], [ 'nslookup', 'nslookup' ] ].filter(method => helpers[method[1]]).forEach(method => o.value(method[0], labels[method[0]]));
	o.modalonly = columns.indexOf('track_method') < 0;

	o = section.option(form.Flag, 'httping_ssl', _('Use HTTPS for web page requests'));
	o.description = _('Make web page requests use HTTPS instead of HTTP. Off by default.');
	o.depends('track_method', 'httping');
	o.modalonly = true;
}

function addTuningOptions(section, form, columns) {
	[ [ 'reliability', _('Targets that must answer'), _('How many targets must answer for the link to count as healthy; 1 means any one is enough. If left empty, 1 is used.'), 'range(1,100)', '1' ],
	  [ 'count', _('Tries per target'), _('How many tries are sent to each target in one round of checks. If left empty, 1 is used.'), 'range(1,20)', '1' ],
	  [ 'size', _('Ping size (bytes)'), _('Size of each ping packet. If left empty, 56 bytes are used.'), 'range(1,65507)', '56' ],
	  [ 'max_ttl', _('Ping hop limit'), _('How many routers a ping may cross before it is dropped. If left empty, 60 is used.'), 'range(1,255)', '60' ],
	  [ 'timeout', _('Wait for an answer (seconds)'), _('How long one try waits for an answer before it counts as lost. If left empty, 4 seconds are used.'), 'uinteger', '4' ],
	  [ 'interval', _('Check every (seconds)'), _('Time between two rounds of checks while the link is healthy. Low values notice problems sooner but may mark a shaky link down too eagerly. If left empty, 10 seconds are used.'), 'uinteger', '10' ],
	  [ 'failure_interval', _('Check every (seconds) after a failure'), _('Time between rounds right after a check fails, to confirm quickly whether the link is down. If left empty, 5 seconds are used.'), 'uinteger', '5' ],
	  [ 'recovery_interval', _('Check every (seconds) while recovering'), _('Time between rounds while a down link is tested for recovery. If left empty, 5 seconds are used.'), 'uinteger', '5' ],
	  [ 'down', _('Failed checks before the link is marked down'), _('How many failed checks in a row mark the link down. High values tolerate short glitches but react later. If left empty, 5 is used.'), 'uinteger', '5' ],
	  [ 'up', _('Good checks before it is used again'), _('How many good checks in a row bring a down link back. If left empty, 5 is used.'), 'uinteger', '5' ]
	].forEach(spec => {
		let o = addValue(section, form, spec, columns);

		if (spec[0] == 'size' || spec[0] == 'max_ttl')
			o.depends('track_method', 'ping');
	});

	let o = section.option(form.Flag, 'keep_failure_interval', _('Keep checking quickly while down'));

	o.description = _('Keep using the faster interval after a failure until the link recovers, instead of slowing down. Off by default.');
	o.default = '0';
	o.modalonly = true;
}

function addQualityOptions(section, form, columns) {
	let o = section.option(form.Flag, 'check_quality', _('Also check latency and packet loss'));

	o.description = _('Besides answering, a link is marked degraded when replies are slow or lost, using the limits below. Needs the Ping method. Off by default.');
	o.default = '0';
	o.depends('track_method', 'ping');
	o.modalonly = columns.indexOf('check_quality') < 0;

	[ [ 'failure_latency', _('Degraded above (ms)'), _('Reply time above which the link counts as degraded. If left empty, 1000 ms is used.'), 'uinteger', '1000' ],
	  [ 'failure_loss', _('Degraded above (% packet loss)'), _('Share of lost replies above which the link counts as degraded. If left empty, 40 % is used.'), 'range(0,100)', '40' ],
	  [ 'recovery_latency', _('Healthy again below (ms)'), _('Reply time the link must stay under to count as healthy again. If left empty, 500 ms is used.'), 'uinteger', '500' ],
	  [ 'recovery_loss', _('Healthy again below (% packet loss)'), _('Share of lost replies the link must stay under to count as healthy again. If left empty, 10 % is used.'), 'range(0,100)', '10' ]
	].forEach(spec => addValue(section, form, spec, []).depends('check_quality', '1'));
}

/* Every health check field of a WAN link. `columns` names the ones shown in the table; the rest open in the edit dialog. */
function addHealthOptions(section, form, helpers, columns) {
	addMethodOptions(section, form, helpers, columns);
	addTuningOptions(section, form, columns);
	addQualityOptions(section, form, columns);
}

function addGlobalOptions(section, form, markNote) {
	let o = section.option(form.Value, 'mmx_mask', _('Firewall mark mask'));

	o.description = _('The bits of the firewall mark MultiWAN 4 may use, so its marks never clash with other software. Use enough set bits for every WAN link plus the reserved marks. If left empty, 0x3F00 is used.');
	if (markNote)
		o.description += ' ' + markNote;
	o.default = '0x3F00';
	o.placeholder = '0x3F00';
	o.validate = validateFirewallMark;
	o.rmempty = false;

	o = section.option(form.Flag, 'source_routing', _('Source routing (by source address)'));
	o.description = _('Also route by the source address of the traffic, not only by its firewall mark. Turn it on for MPTCP or VRF-style setups. Off by default.');
	o.default = '0';

	o = section.option(form.DynamicList, 'rt_table_lookup', _('Additional routing tables'));
	o.description = _('Extra routing tables to look in, besides the main one, when working out where traffic goes, for example the table of a VPN. If left empty, only the main table is used.');
	o.datatype = 'or(uinteger,string)';
	o.placeholder = _('100 200 vpn');

	o = section.option(form.Flag, 'logging', _('Log matching rules'));
	o.description = _('Write a log line when traffic matches a routing rule that has Log matches turned on. Off by default.');
	o.default = '0';

	o = section.option(form.ListValue, 'loglevel', _('Log level'));
	o.description = _('How important the log lines of MultiWAN 4 are marked in the system log. notice by default.');
	o.default = 'notice';
	[ 'debug', 'info', 'notice', 'warning', 'err' ].forEach(level => o.value(level));
}

return baseclass.extend({
	addGlobalOptions:        addGlobalOptions,
	addHealthOptions:        addHealthOptions,
	addIdentityOptions:      addIdentityOptions,
	loadHelpers:             loadHelpers,
	validateFirewallMark:    validateFirewallMark,
	validatePositiveInteger: validatePositiveInteger
});
