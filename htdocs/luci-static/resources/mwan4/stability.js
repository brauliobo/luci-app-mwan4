'use strict';
'require baseclass';
'require rpc';
'require mwan4.connections as mwan4Connections';
/* global mwan4Connections */

/*
 * Every backend field behind the unstable-WAN UI (held, flaps, availability, degraded_for, link_history)
 * is read here, so a change in the backend JSON shape stays a one-file edit.
 */

const DAY       = 86400;
const HISTORY   = 200;
const DEFAULTS  = { flap_damping: '1', flap_threshold: '3', flap_window: '300', flap_holddown: '120', recovery_hold: '30', flush_grace: '10' };
const STABILITY = [ 'flap_damping', 'flap_threshold', 'flap_window', 'flap_holddown', 'recovery_hold', 'flush_grace' ];
const MINIMUMS  = { flap_threshold: 2, flap_window: 30, flap_holddown: 0, recovery_hold: 0, flush_grace: 0 };

let ticker = null;

const callLinkHistory = rpc.declare({
	object: 'mwan4',
	method: 'link_history',
	params: [ 'interface', 'since', 'limit' ],
	expect: { }
});

function queryHistory(name, limit) {
	return callLinkHistory(name || null, null, limit || HISTORY);
}

function isHistory(result) {
	return !!result && result.ok !== false && !!result.interfaces && typeof result.interfaces == 'object';
}

function probe() {
	return L.resolveDefault(queryHistory(null, 1), null).then(isHistory);
}

function historyEntry(result, name) {
	return isHistory(result) ? result.interfaces[name] || {} : {};
}

function number(value) {
	return value == null || value === '' || isNaN(Number(value)) ? null : Number(value);
}

function heldInfo(entry) {
	let held = (entry || {}).held;

	return held && held.active ? { reason: held.reason || null, remaining: number(held.remaining), until: number(held.until) } : null;
}

function flapInfo(entry) {
	let flaps = (entry || {}).flaps;

	return flaps && typeof flaps == 'object' && number(flaps.total) != null
		? { window: number(flaps.count_window) || 0, total: number(flaps.total) }
		: null;
}

function availabilityInfo(entry) {
	let value = (entry || {}).availability;
	let h1 = value ? number(value.pct_1h) : null;
	let h24 = value ? number(value.pct_24h) : null;

	return h1 == null && h24 == null ? null : { h1: h1, h24: h24 };
}

function degradedStrategies(entry) {
	let list = (entry || {}).degraded_for;

	return Array.isArray(list) ? list : [];
}

function hasStabilityData(status) {
	return Object.values((status || {}).interfaces || {}).some(entry => !!(entry || {}).held || !!flapInfo(entry) || !!availabilityInfo(entry));
}

function supported(historyAvailable, status) {
	return !!historyAvailable || hasStabilityData(status);
}

function events(entry) {
	let list = (entry || {}).events;

	return (Array.isArray(list) ? list : []).map(event => ({ time: number(event.time), state: event.state || 'unknown', reason: event.reason || '' }))
		.filter(event => event.time != null).sort((a, b) => a.time - b.time);
}

function strip(list, now, span) {
	span = span || DAY;
	now = Math.max(now, list.length ? list[list.length - 1].time : 0);

	let start = now - span;
	let before = list.filter(event => event.time <= start).pop();
	let points = [ { time: start, state: before ? before.state : 'unknown' } ]
		.concat(list.filter(event => event.time > start).map(event => ({ time: event.time, state: event.state })));

	return points.map((point, index) => ({
		state: point.state,
		from:  (point.time - start) / span,
		to:    ((points[index + 1] || { time: now }).time - start) / span
	}));
}

function remainingNow(remaining, since, now) {
	return Math.max(0, remaining - Math.floor((now - since) / 1000));
}

function tick() {
	let nodes = document.querySelectorAll('[data-mwan4-remaining]');

	nodes.forEach(node => {
		node.textContent = mwan4Connections.formatTtl(remainingNow(Number(node.dataset.mwan4Remaining), Number(node.dataset.mwan4Since), Date.now()));
	});

	if (!nodes.length) {
		window.clearInterval(ticker);
		ticker = null;
	}
}

function renderCountdown(remaining) {
	if (remaining == null)
		return null;

	if (!ticker)
		ticker = window.setInterval(tick, 1000);

	return E('span', { class: 'mwan4-countdown', 'data-mwan4-remaining': remaining, 'data-mwan4-since': Date.now() }, [ mwan4Connections.formatTtl(remaining) ]);
}

function reasonLabel(reason) {
	return { flapping: _('flapping'), recovering: _('recovering') }[reason] || reason || '';
}

function renderHeldChip(held) {
	return E('span', { class: 'mwan4-pill mwan4-warning mwan4-held-chip', title: _('Held out of routing strategies until it stays healthy') }, [
		_('held: %s').format(reasonLabel(held.reason) || _('unknown')), held.remaining == null ? null : ' ', renderCountdown(held.remaining)
	]);
}

function renderDegradedChip(names) {
	return names.length
		? E('span', { class: 'mwan4-pill mwan4-warning mwan4-degraded-chip', title: _('Skipped by: %s').format(names.join(', ')) }, [ _('degraded (%d)').format(names.length) ])
		: null;
}

function formatPct(value) {
	return value == null ? '-' : '%s%%'.format(Math.round(value * 10) / 10);
}

function flapsTitle(flaps) {
	return _('%d flap(s) in the current window, %d since start').format(flaps.window, flaps.total);
}

function availabilityTitle(availability) {
	return _('Last hour: %s, last 24 hours: %s').format(formatPct(availability.h1), formatPct(availability.h24));
}

function singleTarget(targets) {
	return (targets || []).length == 1;
}

function effectiveDefault(name, globals) {
	return (globals || {})[name] || DEFAULTS[name];
}

function fieldLabels() {
	return {
		flap_damping:   _('Flap damping'),
		flap_threshold: _('Flap threshold'),
		flap_window:    _('Flap window (seconds)'),
		flap_holddown:  _('Flap hold-down (seconds)'),
		recovery_hold:  _('Failback hold (seconds)'),
		flush_grace:    _('Connection flush grace (seconds)')
	};
}

function fieldHelp() {
	return {
		flap_damping:   _('Keep a WAN out of routing strategies after repeated online/offline flips.'),
		flap_threshold: _('Online to offline transitions inside the window that suppress the WAN.'),
		flap_window:    _('Time span in which transitions are counted.'),
		flap_holddown:  _('Healthy time required before a suppressed WAN is used again.'),
		recovery_hold:  _('Healthy time required before a recovered WAN takes new connections (0 disables).'),
		flush_grace:    _('Wait this long before flushing the connections of a downed WAN, so healthy flows survive a short outage (0 flushes immediately).')
	};
}

function qualityNote() {
	return _('Latency and loss limits need "Use latency/loss SLA thresholds" (check_quality) enabled on the WAN links of this strategy.');
}

function summary(values) {
	let set = STABILITY.filter(name => values[name]).map(name => '%s %s'.format(fieldLabels()[name], values[name]));

	return set.length ? set.join(', ') : _('Global defaults');
}

function formOption(section, form, name, globals, modalonly) {
	let labels = fieldLabels();
	let o = section.option(name == 'flap_damping' ? form.ListValue : form.Value, name, labels[name]);

	o.description = fieldHelp()[name];
	o.modalonly = modalonly;
	o.optional = true;

	if (name == 'flap_damping') {
		o.value('', _('Use default (%s)').format(effectiveDefault(name, globals) == '1' ? _('on') : _('off')));
		o.value('1', _('On'));
		o.value('0', _('Off'));
	}
	else {
		o.datatype = 'min(%d)'.format(MINIMUMS[name]);
		o.placeholder = effectiveDefault(name, globals);
	}

	return o;
}

function addFormOptions(section, form, globals, modalonly) {
	STABILITY.forEach(name => formOption(section, form, name, globals, modalonly));
}

function addQualityOptions(section, form) {
	[ [ 'max_latency', _('Maximum latency (ms)'), 'min(1)' ], [ 'max_loss', _('Maximum packet loss (%)'), 'range(0,100)' ] ].forEach(spec => {
		let o = section.option(form.Value, spec[0], spec[1]);

		o.datatype = spec[2];
		o.optional = true;
		o.modalonly = true;
		o.placeholder = _('no limit');
		o.description = qualityNote();
	});
}

return baseclass.extend({
	DEFAULTS:             DEFAULTS,
	STABILITY:            STABILITY,
	MINIMUMS:             MINIMUMS,
	addFormOptions:       addFormOptions,
	addQualityOptions:    addQualityOptions,
	availabilityInfo:     availabilityInfo,
	availabilityTitle:    availabilityTitle,
	degradedStrategies:   degradedStrategies,
	effectiveDefault:     effectiveDefault,
	events:               events,
	fieldHelp:            fieldHelp,
	fieldLabels:          fieldLabels,
	flapInfo:             flapInfo,
	flapsTitle:           flapsTitle,
	formatPct:            formatPct,
	hasStabilityData:     hasStabilityData,
	heldInfo:             heldInfo,
	historyEntry:         historyEntry,
	isHistory:            isHistory,
	probe:                probe,
	qualityNote:          qualityNote,
	queryHistory:         queryHistory,
	reasonLabel:          reasonLabel,
	remainingNow:         remainingNow,
	renderCountdown:      renderCountdown,
	renderDegradedChip:   renderDegradedChip,
	renderHeldChip:       renderHeldChip,
	singleTarget:         singleTarget,
	strip:                strip,
	summary:              summary,
	supported:            supported
});
