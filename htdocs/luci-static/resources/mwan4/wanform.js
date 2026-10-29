'use strict';
'require baseclass';
'require mwan4.templates as mwan4Templates';

/* global mwan4Templates */

/*
 * Pure logic behind the WAN link dialog: which network interfaces can still become a WAN link, which IP family a
 * new link starts with, and what choosing a health profile writes into the fields.
 */

const V6_PROTOCOLS = [ 'dhcpv6', '6in4', '6to4', '6rd', 'map', 'dslite' ];
const HIDDEN       = [ 'loopback' ];

function isUsed(name, used) {
	return used.indexOf(name) >= 0;
}

/* [ [ network name, label ] ]: interfaces with a WAN-like protocol first, then static ones such as the LAN, then those that already are a WAN link. */
function interfaceChoices(networks, used) {
	let rank = section => isUsed(section['.name'], used) ? 2 : section.proto == 'static' ? 1 : 0;
	let sections = networks.filter(section => HIDDEN.indexOf(section['.name']) < 0).sort((a, b) => rank(a) - rank(b) || a['.name'].localeCompare(b['.name']));

	return sections.map(section => [ section['.name'], isUsed(section['.name'], used) ? _('%s (already a WAN link)').format(section['.name']) : section['.name'] ]);
}

function familyFor(name, networks) {
	let section = networks.find(item => item['.name'] == name) || {};

	return V6_PROTOCOLS.indexOf(section.proto) >= 0 || /[a-z_]6$/i.test(name) ? 'ipv6' : 'ipv4';
}

/*
 * What to put in the form fields when a profile is chosen. A value that equals the package default is emptied so the link keeps
 * following the defaults, unless a global setting changes that default: then the default is written out to stay what the profile says.
 */
function profileFill(id, globals, keys) {
	let values = mwan4Templates.profileValues(id, keys);

	return Object.fromEntries(Object.keys(values).map(name => {
		let overridden = values[name] == null && globals && globals[name] && globals[name] != mwan4Templates.HEALTH_DEFAULTS[name];

		return [ name, overridden ? mwan4Templates.HEALTH_DEFAULTS[name] : values[name] == null ? '' : values[name] ];
	}));
}

return baseclass.extend({
	familyFor:        familyFor,
	interfaceChoices: interfaceChoices,
	profileFill:      profileFill
});
