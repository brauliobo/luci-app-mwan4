'use strict';
'require baseclass';
'require mwan4.common as mwan4Common';
'require mwan4.stability as mwan4Stability';
/* global mwan4Common */
/* global mwan4Stability */

const REFRESH_MS = 5000;
const SPAN       = 86400;
const MIN_WIDTH  = 0.4;
const SVG_NS     = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, children) {
	let node = document.createElementNS(SVG_NS, tag);

	Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key]));
	(children || []).forEach(child => node.appendChild(child));

	return node;
}

function formatTime(epoch) {
	return new Date(epoch * 1000).toLocaleString();
}

function segmentNode(segment) {
	return svg('rect', {
		class:  'mwan4-strip-segment %s'.format(mwan4Common.statusClass(segment.state)),
		x:      segment.from * 100,
		y:      0,
		width:  Math.max(MIN_WIDTH, (segment.to - segment.from) * 100),
		height: 10
	}, [ svg('title', {}, [ document.createTextNode(segment.state) ]) ]);
}

function renderStrip(list, now) {
	return E('div', { class: 'mwan4-strip-wrap' }, [
		svg('svg', { class: 'mwan4-strip', viewBox: '0 0 100 10', preserveAspectRatio: 'none', role: 'img', 'aria-label': _('Link state over the last 24 hours') },
			mwan4Stability.strip(list, now, SPAN).map(segmentNode)),
		E('div', { class: 'mwan4-strip-scale' }, [ E('small', [ _('24 hours ago') ]), E('small', [ _('now') ]) ])
	]);
}

function renderEvent(event) {
	return E('tr', { class: 'mwan4-history-row' }, [
		E('td', [ formatTime(event.time) ]),
		E('td', [ mwan4Common.renderPill(event.state, mwan4Common.statusClass(event.state)) ]),
		E('td', [ mwan4Stability.reasonLabel(event.reason) || '-' ])
	]);
}

function renderEvents(list) {
	return E('table', { class: 'table mwan4-history-table' }, [
		E('tr', [ _('Time'), _('State'), _('Reason') ].map(label => E('th', [ label ])))
	].concat(list.slice().reverse().map(renderEvent)));
}

function renderSummary(entry) {
	let flaps = mwan4Stability.flapInfo(entry);
	let availability = mwan4Stability.availabilityInfo(entry);
	let held = mwan4Stability.heldInfo(entry);

	return [
		E('span', { title: flaps ? mwan4Stability.flapsTitle(flaps) : null }, [ flaps ? _('Flaps: %d in window / %d total').format(flaps.window, flaps.total) : _('Flaps: -') ]),
		E('span', [ availability
			? _('Availability: %s (1h %s)').format(mwan4Stability.formatPct(availability.h24), mwan4Stability.formatPct(availability.h1))
			: _('Availability: -') ]),
		held ? mwan4Stability.renderHeldChip(held) : E('span', { class: 'mwan4-muted-line' }, [ _('Not held') ])
	];
}

function renderPanel(options) {
	let name = options.interface;
	let interval = options.interval || REFRESH_MS;
	let notice = E('p', { class: 'mwan4-conn-notice', role: 'status', hidden: 'hidden' });
	let summary = E('div', { class: 'mwan4-history-summary', 'aria-live': 'polite' });
	let body = E('div', { class: 'mwan4-history-body' });
	let root = E('div', { class: 'mwan4-link-history', 'data-interface': name, 'aria-busy': 'false' }, [ summary, notice, body ]);

	function show(result) {
		if (!mwan4Stability.isHistory(result))
			return failed(new Error((result || {}).error || (result || {}).message || _('unexpected response')));

		let entry = mwan4Stability.historyEntry(result, name);
		let list = mwan4Stability.events(entry);

		notice.hidden = true;
		summary.replaceChildren.apply(summary, renderSummary(entry));
		body.replaceChildren(renderStrip(list, Date.now() / 1000), list.length ? E('div', { class: 'mwan4-wan-table-wrap mwan4-history-list' }, [ renderEvents(list) ]) : E('p', { class: 'mwan4-conn-empty' }, [ _('No state transitions recorded yet.') ]));
	}

	function failed(error) {
		notice.hidden = false;
		notice.textContent = _('Link history is unavailable: %s').format(error.message || error);
	}

	function refresh() {
		return mwan4Stability.queryHistory(name).then(show, failed);
	}

	function schedule() {
		window.setTimeout(function() {
			if (root.isConnected)
				refresh().then(schedule);
		}, interval);
	}

	refresh().then(schedule);

	return root;
}

return baseclass.extend({
	formatTime:  formatTime,
	renderPanel: renderPanel,
	renderStrip: renderStrip
});
