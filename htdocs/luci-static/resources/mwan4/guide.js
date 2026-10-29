'use strict';
'require baseclass';
'require ui';
'require mwan4.common as mwan4Common';
'require mwan4.explain as mwan4Explain';

var E = mwan4Common.element;
/* global mwan4Common */
/* global mwan4Explain */

mwan4Common.addStylesheet();

function termEntries() {
	return Object.entries(mwan4Explain.glossary()).sort((a, b) => a[0].localeCompare(b[0]));
}

function termsList() {
	return E('dl', { class: 'mwan4-terms' }, termEntries().flatMap(entry => [ E('dt', [ entry[0] ]), E('dd', [ entry[1] ]) ]));
}

/* The body of the Terms modal; `close` is the closer of whichever modal system shows it. */
function termsContent(close) {
	return [
		termsList(),
		E('div', { class: 'right mwan4-modal-actions' }, [
			E('button', { type: 'button', class: 'btn cbi-button cbi-button-neutral', 'data-autofocus': '1', click: close }, [ _('Close') ])
		])
	];
}

function showTerms() {
	let opener = document.activeElement;
	let close = () => { ui.hideModal(); opener.focus(); };

	ui.showModal(_('Terms'), termsContent(close), 'mwan4-modal');

	let modal = document.querySelector('.modal.mwan4-modal');

	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-label', _('Terms'));
	modal.setAttribute('tabindex', '-1');
	modal.querySelector('[data-autofocus]').focus();
}

function termsButton() {
	return E('button', { type: 'button', class: 'btn cbi-button cbi-button-neutral mwan4-terms-button', click: showTerms }, [ _('Terms') ]);
}

/*
 * What a raw tab is for, which common task is easier on the overview, and a way back.
 * `hasOverview` is false for sessions that may open the page but not the overview.
 */
function intro(purpose, task, hasOverview) {
	return E('div', { class: 'mwan4-raw-intro' }, [
		E('p', { class: 'mwan4-raw-purpose' }, [ purpose ]),
		E('p', { class: 'mwan4-raw-links' }, [
			hasOverview === false ? null : E('span', [ task ]),
			hasOverview === false ? null : E('a', { class: 'btn cbi-button cbi-button-action mwan4-overview-link', href: L.url('admin/network/mwan4/overview') }, [ _('Go to the overview') ]),
			termsButton()
		])
	]);
}

return baseclass.extend({
	intro:        intro,
	showTerms:    showTerms,
	termsButton:  termsButton,
	termsContent: termsContent,
	termsList:    termsList
});
