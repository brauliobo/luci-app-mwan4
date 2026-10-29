#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/view-loader');

const guide = createLoader({}).load('mwan4/guide.js');
const explain = createLoader({}).load('mwan4/explain.js');
const flat = node => Array.isArray(node) ? node.flatMap(flat) : node == null || typeof node != 'object' ? [ node ] : [ node ].concat(flat(node.children));
const texts = node => flat(node).filter(item => typeof item == 'string');
const tags = (node, tag) => flat(node).filter(item => item && item.tag == tag);

// the Terms list shows every glossary entry, sorted, term then meaning
const entries = tags(guide.termsList(), 'dt').map(dt => dt.children[0]);
const glossary = explain.glossary();

assert.deepEqual(entries, Object.keys(glossary).sort((a, b) => a.localeCompare(b)));
assert.equal(tags(guide.termsList(), 'dd').length, entries.length);
assert.deepEqual(tags(guide.termsList(), 'dd').map(dd => dd.children[0]), entries.map(term => glossary[term]));

// every meaning is one short plain sentence
for (const meaning of Object.values(glossary))
	assert.ok(meaning.length < 120 && meaning.endsWith('.') && !/\b(strategy|member|fwmark)\b/i.test(meaning), `plain sentence: ${meaning}`);

// the intro names the purpose, links to the overview and offers Terms
const intro = guide.intro('Purpose.', 'Most changes are easier on the overview: do it there.');

assert.deepEqual(texts(intro).filter(text => text != ' '), [ 'Purpose.', 'Most changes are easier on the overview: do it there.', 'Go to the overview', 'Terms' ]);
assert.equal(tags(intro, 'a')[0].attrs.href, '/admin/network/mwan4/overview');
assert.match(tags(intro, 'a')[0].attrs.class, /\bbtn\b/, 'the link looks like a button');

// a session that cannot open the overview gets the purpose and Terms, but no dead link
const limited = guide.intro('Purpose.', 'Task.', false);

assert.equal(tags(limited, 'a').length, 0);
assert.deepEqual(texts(limited), [ 'Purpose.', 'Terms' ]);
assert.equal(tags(limited, 'details').length + tags(limited, 'summary').length, 0, 'no expanders');

// the shared body of the Terms modal closes through whichever modal system opened it
let closed = 0;
const content = guide.termsContent(() => closed++);
const close = tags(content, 'button')[0];

close.attrs.click();
assert.equal(closed, 1);
assert.equal(close.attrs['data-autofocus'], '1', 'focus lands on Close');

console.log('guide expectations passed');
