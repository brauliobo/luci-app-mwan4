'use strict';
'require baseclass';
'require mwan4.rules as mwan4Rules';

/* global mwan4Rules */

/*
 * Pure data for the "start from the common case" UI: rule templates and WAN link health profiles.
 * Plain objects in, plain objects out; no DOM, uci or rpc, so everything here is unit-tested in node.
 */

const PRESET     = /^(prefer|only):(.+)$/;
const GENERATED  = /^(.+)_(first|only)$/;
const KIND       = { first: 'prefer', only: 'only' };
const OWNED      = [ 'domain', 'dest_ip', 'src_ip', 'src_mac', 'dest_port', 'proto', 'via' ];
const FAIL_CLOSED = [ 'blackhole', 'unreachable' ];

/* Template shape (what is matched, with which path kind) -> template id; anything else is a custom rule. */
const SHAPES = {
	'w/all/prefer':    'site-link',
	'w/all/only':      'site-only',
	'd/all/prefer':    'device-link',
	'd/all/only':      'device-vpn',
	'w/all/blackhole': 'block',
	'p/udp/prefer':    'game'
};

const HEALTH_KEYS = [ 'interval', 'down', 'up', 'reliability', 'flap_damping', 'flap_threshold', 'flap_window', 'flap_holddown', 'recovery_hold' ];
// Package defaults: tracker (interval, down, up, reliability) and stability.js DEFAULTS.
const HEALTH_DEFAULTS = {
	interval: '10', down: '5', up: '5', reliability: '1',
	flap_damping: '1', flap_threshold: '3', flap_window: '300', flap_holddown: '120', recovery_hold: '30'
};
const PROFILE_OVERRIDES = {
	sensitive: { interval: '5',  down: '3', up: '3', flap_holddown: '60',  recovery_hold: '10' },
	balanced:  { },
	tolerant:  { interval: '15', down: '6', up: '6', flap_threshold: '2', flap_window: '600', flap_holddown: '300', recovery_hold: '60' }
};

function text(value) {
	return mwan4Rules.asList(value).join(' ');
}

function blankDraft() {
	return {
		name: null, label: '', enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all',
		src_port: '', dest_port: '', dscp: '', local: '0', ipset: '', via: 'default', sticky: '0', timeout: '600', logging: '0'
	};
}

function fieldDefs() {
	return {
		what:  {
			label: _('Site or service'), placeholder: _('youtube.com'),
			help:  _('A domain such as youtube.com also covers its subdomains. IP addresses and networks work too.')
		},
		who:   {
			label: _('Device'), placeholder: _('192.168.1.20'),
			help:  _('The IP address or MAC address of the device. Leave empty for every device.')
		},
		link:  { label: _('WAN link'), placeholder: '', help: _('The internet connection or tunnel to use.') },
		ports: {
			label: _('Ports'), placeholder: _('3074, 27015-27030'),
			help:  _('Ports or ranges separated by commas, for example 3074 or 27015-27030.')
		}
	};
}

function templateSpecs() {
	return [
		{ id: 'site-link', goal: 'T1', fields: [ 'what', 'link' ], kind: 'prefer', title: _('Send a site through one link'),
			summary: _('The site uses this link first and switches to another one only if it is unavailable.') },
		{ id: 'site-only', goal: 'T3', fields: [ 'what', 'link' ], kind: 'only', title: _('Keep a site on one link only (never leak)'),
			summary: _('The site only ever uses this link; if the link is unavailable the traffic stops instead of leaking elsewhere.') },
		{ id: 'device-link', goal: 'T2', fields: [ 'who', 'link' ], kind: 'prefer', title: _('Make a device use a link'),
			summary: _('Everything from this device uses this link first and switches to another one only if it is unavailable.') },
		{ id: 'device-vpn', goal: 'T3', fields: [ 'who', 'link' ], kind: 'only', title: _('Keep a device on a VPN or tunnel'),
			summary: _('Everything from this device only uses this VPN or tunnel; if it is down the traffic stops instead of leaking.'),
			over: { link: { label: _('VPN or tunnel') } } },
		{ id: 'block', goal: 'T1', fields: [ 'what' ], kind: 'blackhole', title: _('Block a site'),
			summary: _('Traffic to the site is dropped, whatever link is up.'), over: { what: { label: _('Site to block') } } },
		{ id: 'game', goal: 'T1', fields: [ 'ports', 'link' ], kind: 'prefer', extra: { proto: 'udp' }, title: _('Speed up a game or call'),
			summary: _('Game and call traffic on these UDP ports uses the best link you pick first.') },
		{ id: 'custom', goal: null, fields: [ 'what', 'who', 'link' ], kind: 'prefer', optional: true, title: _('Custom rule'),
			summary: _('Start from a blank rule and set everything yourself.') }
	];
}

function templateField(spec, name) {
	return Object.assign({ name: name, required: !spec.optional }, fieldDefs()[name], (spec.over || { })[name]);
}

function ports(value) {
	return text(value).split(/[\s,;]+/).filter(Boolean).map(port => port.replace(':', '-')).join(',');
}

function matchFields(values) {
	let what = mwan4Rules.classifyEntries(text(values.what));
	let who = mwan4Rules.classifyEntries(text(values.who));

	return { domain: what.domain, dest_ip: what.ip, src_ip: who.ip, src_mac: who.mac, dest_port: ports(values.ports) };
}

function viaFor(kind, link) {
	return FAIL_CLOSED.indexOf(kind) >= 0 ? kind : link ? '%s:%s'.format(kind, link) : 'default';
}

/* A via is either a preset ('prefer:<link>') or the strategy a preset generated ('<link>_first', '<link>_only'). */
function presetOf(via, ctx) {
	let preset = PRESET.exec(via || '');
	let generated = GENERATED.exec(via || '');
	let known = link => (ctx.links || []).some(item => item.key == link);

	if (preset)
		return { kind: preset[1], link: preset[2] };

	return generated && known(generated[1]) ? { kind: KIND[generated[2]], link: generated[1] } : { kind: via, link: null };
}

function linkLabel(key, ctx) {
	let link = (ctx.links || []).find(item => item.key == key);

	return link ? link.label : key;
}

function listLabel(items) {
	return items.length > 1 ? _('%s +%d').format(items[0], items.length - 1) : items[0] || '';
}

function deviceLabel(entry, ctx) {
	let device = (ctx.devices || []).find(item => item.mac == entry || item.ip == entry);

	return device && device.name ? device.name : entry;
}

function portsLabel(draft) {
	if (!draft.dest_port)
		return '';

	return draft.proto == 'all' ? _('port %s').format(draft.dest_port) : _('%s port %s').format(draft.proto.toUpperCase(), draft.dest_port);
}

function subjectLabel(draft, ctx) {
	let target = [ listLabel(draft.domain.concat(draft.dest_ip)), portsLabel(draft) ].filter(Boolean).join(' ');
	let who = listLabel(draft.src_mac.concat(draft.src_ip).map(entry => deviceLabel(entry, ctx)));

	return target && who ? _('%s from %s').format(target, who) : target || who;
}

function autoLabel(draft, ctx) {
	let subject = subjectLabel(draft, ctx = ctx || { });
	let path = presetOf(draft.via, ctx);

	if (!subject)
		return '';
	if (FAIL_CLOSED.indexOf(draft.via) >= 0)
		return _('Block %s').format(subject);

	return draft.via == 'default' ? _('%s via normal routing').format(subject) : _('%s via %s').format(subject, linkLabel(path.link || draft.via, ctx));
}

function build(spec, values, ctx) {
	values = values || { };

	let draft = Object.assign(blankDraft(), matchFields(values), spec.extra, { via: viaFor(spec.kind, values.link) });

	draft.label = autoLabel(draft, ctx);

	return draft;
}

function ruleTemplates() {
	return templateSpecs().map(spec => ({
		id:      spec.id,
		title:   spec.title,
		summary: spec.summary,
		goal:    spec.goal,
		fields:  spec.fields.map(name => templateField(spec, name)),
		build:   (values, ctx) => build(spec, values, ctx)
	}));
}

function isAdvanced(draft) {
	return !!(draft.dscp || draft.ipset || draft.src_port || draft.src_iface) || draft.local == '1' || draft.sticky == '1' || draft.logging == '1';
}

function shapeOf(draft, ctx) {
	let what = draft.domain.length + draft.dest_ip.length > 0;
	let who = draft.src_ip.length + draft.src_mac.length > 0;
	let kind = presetOf(draft.via, ctx).kind;

	return '%s/%s/%s'.format([ what ? 'w' : '', who ? 'd' : '', draft.dest_port ? 'p' : '' ].join(''), draft.proto, kind);
}

function templateFor(draft, ctx) {
	return isAdvanced(draft) ? 'custom' : SHAPES[shapeOf(draft, ctx || { })] || 'custom';
}

function applyTemplate(draft, id, values, ctx) {
	let built = ruleTemplates().find(template => template.id == id).build(values, ctx);
	let owned = id == 'custom' ? { } : Object.fromEntries(OWNED.map(name => [ name, built[name] ]));
	let named = draft.label && draft.label != autoLabel(draft, ctx || { });

	return Object.assign({ }, draft, owned, { label: named ? draft.label : autoLabel(Object.assign({ }, draft, owned), ctx) });
}

function setValues(values) {
	let set = { };

	Object.keys(values || { }).filter(name => values[name] != null && values[name] !== '').forEach(name => { set[name] = String(values[name]); });

	return set;
}

function effective(values, globals) {
	return Object.assign({ }, HEALTH_DEFAULTS, setValues(globals), setValues(values));
}

function detectionSeconds(values) {
	let now = effective(values);

	return Number(now.interval) * Number(now.down);
}

function recoverySeconds(values) {
	let now = effective(values);

	return Number(now.interval) * Number(now.up) + Number(now.recovery_hold);
}

function formatDuration(seconds) {
	return seconds < 60 ? _('%d s').format(seconds) : _('%s min').format(Math.round(seconds / 6) / 10);
}

function profileSummary(id, values) {
	let detect = formatDuration(detectionSeconds(values));
	let recover = formatDuration(recoverySeconds(values));

	return {
		sensitive: _('Notices an outage in about %s and returns to the link after %s; may switch on short blips.'),
		balanced:  _('Notices an outage in about %s and returns after %s; ignores short blips. Right for most links.'),
		tolerant:  _('Notices an outage in about %s and waits %s before trusting the link again; best for unstable links.')
	}[id].format(detect, recover);
}

function healthProfiles() {
	return [ [ 'sensitive', _('Sensitive') ], [ 'balanced', _('Balanced') ], [ 'tolerant', _('Tolerant') ] ].map(item => {
		let values = Object.assign({ }, HEALTH_DEFAULTS, PROFILE_OVERRIDES[item[0]]);

		return { id: item[0], title: item[1], values: values, detectSeconds: detectionSeconds(values), recoverSeconds: recoverySeconds(values),
			summary: profileSummary(item[0], values) };
	});
}

function profileFor(values, globals) {
	let now = effective(values, globals);
	let profile = healthProfiles().find(item => HEALTH_KEYS.every(name => item.values[name] == now[name]));

	return profile ? profile.id : 'custom';
}

/*
 * An option equal to the package default is returned as null: callers delete it from the link instead of writing the default,
 * so an untouched link stays untouched and keeps following the global and package defaults.
 */
function profileValues(id) {
	let profile = healthProfiles().find(item => item.id == id);
	let values = profile ? profile.values : { };

	return Object.fromEntries(Object.keys(values).map(name => [ name, values[name] == HEALTH_DEFAULTS[name] ? null : values[name] ]));
}

return baseclass.extend({
	HEALTH_DEFAULTS:  HEALTH_DEFAULTS,
	HEALTH_KEYS:      HEALTH_KEYS,
	applyTemplate:    applyTemplate,
	autoLabel:        autoLabel,
	detectionSeconds: detectionSeconds,
	healthProfiles:   healthProfiles,
	presetOf:         presetOf,
	profileFor:       profileFor,
	profileValues:    profileValues,
	recoverySeconds:  recoverySeconds,
	ruleTemplates:    ruleTemplates,
	templateFor:      templateFor
});
