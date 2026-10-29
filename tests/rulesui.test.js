#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/mwan4', file), 'utf8');

String.prototype.format = function(...values) {
	return this.replace(/%%|%[sd]/g, token => token == '%%' ? '%' : String(values.shift()));
};

const baseclass = { extend: definition => definition };
const identity = text => text;
const load = (file, names, deps) => new Function('baseclass', ...names, '_', read(file))(baseclass, ...names.map(name => deps[name]), identity);
const mwan4Rules = load('rules.js', [], {});
const mwan4Explain = load('explain.js', [], {});
const mwan4Routetest = load('routetest.js', [ 'mwan4Explain', 'mwan4Rules' ], { mwan4Explain, mwan4Rules });
const mwan4Rulecheck = load('rulecheck.js', [ 'mwan4Explain', 'mwan4Routetest' ], { mwan4Explain, mwan4Routetest });
const mwan4Templates = load('templates.js', [ 'mwan4Rules' ], { mwan4Rules });
const ui = load('rulesui.js', [ 'mwan4Explain', 'mwan4Routetest', 'mwan4Rulecheck', 'mwan4Rules', 'mwan4Templates' ],
	{ mwan4Explain, mwan4Routetest, mwan4Rulecheck, mwan4Rules, mwan4Templates });

const route = (name, wan, metric) => ({ '.name': name, interface: wan, metric: String(metric) });
const routes = [ route('t1', 'wan_tim', 1), route('t6', 'wan_tim6', 1), route('s1', 'wan_str', 2), route('w1', 'wg_vpn', 1) ];
const strategies = [
	{ '.name': 'tim_first', use_route: [ 't1', 't6', 's1' ], last_resort: 'unreachable' },
	{ '.name': 'wg_vpn_only', use_route: [ 'w1' ], last_resort: 'unreachable' }
];
const links = mwan4Explain.groupLinks([ 'wan_tim', 'wan_tim6', 'wan_str', 'wg_vpn' ]);
const devices = [ { mac: 'aa:bb:cc:dd:ee:01', name: 'Living-room TV', ip: '192.168.1.20' } ];
const online = state => ({ health_state: state });
const status = { interfaces: { wan_tim: online('online'), wan_tim6: online('online'), wan_str: online('offline'), wg_vpn: online('online') } };
const interfaces = [ 'wan_tim', 'wan_tim6', 'wan_str', 'wg_vpn' ].map(name => ({ '.name': name, enabled: '1' }));
const ctx = { strategies, routes, links, devices, status, interfaces, rules: [], position: 0 };
const draft = extra => Object.assign({
	name: null, label: '', enabled: '1', domain: [], dest_ip: [], src_ip: [], src_mac: [], src_iface: '', proto: 'all', src_port: '', dest_port: '',
	dscp: '', local: '0', ipset: '', via: 'default', sticky: '0', timeout: '600', logging: '0'
}, extra);
const raw = extra => Object.assign({ what: 'youtube.com', who: '', mode: 'all', src_iface: '', proto: 'all', src_port: '', dest_port: '', dscp: '', ipset: '', sticky: '0', timeout: '600' }, extra);
const fields = list => list.map(item => item.field);
const templates = Object.fromEntries(mwan4Templates.ruleTemplates().map(template => [ template.id, template ]));

// validation keeps every message of the old aggregated alert but attaches it to its field
assert.deepEqual(ui.problems(raw()), []);
assert.deepEqual(ui.problems(raw({ what: 'example.com\nnot a domain!' })).map(item => [ item.field, item.message ]),
	[ [ 'what', 'Not a domain name or IP address: not, a, domain!' ] ]);
assert.equal(ui.problems(raw({ what: 'aa:bb:cc:dd:ee:01' }))[0].message, 'MAC addresses belong in Who, not in What.');
assert.deepEqual(ui.problems(raw({ mode: 'devices', who: 'laptop.lan' })).map(item => [ item.field, item.incomplete ]), [ [ 'who', false ] ]);
assert.deepEqual(ui.problems(raw({ mode: 'devices', who: '' })).map(item => [ item.field, item.incomplete ]), [ [ 'who', true ] ], 'an empty device list is incomplete');
assert.equal(ui.problems(raw({ mode: 'devices', who: 'AA-BB-CC-DD-EE-09' })).length, 0);
assert.deepEqual(ui.problems(raw({ mode: 'iface', src_iface: '' })).map(item => [ item.field, item.incomplete ]), [ [ 'src_iface', true ] ]);
assert.deepEqual(fields(ui.problems(raw({ dest_port: '443' }))), [ 'proto' ], 'ports need TCP or UDP');
assert.deepEqual(fields(ui.problems(raw({ proto: 'udp', dest_port: '70000', src_port: '0' }))), [ 'src_port', 'dest_port' ]);
assert.deepEqual(fields(ui.problems(raw({ dscp: '64' }))), [ 'dscp' ]);
assert.deepEqual(fields(ui.problems(raw({ ipset: 'bad name' }))), [ 'ipset' ]);
assert.deepEqual(fields(ui.problems(raw({ sticky: '1', timeout: '0' }))), [ 'timeout' ]);
assert.deepEqual(fields(ui.problems(raw({ sticky: '0', timeout: '0' }))), [], 'the timeout only counts while sticky is on');
assert.deepEqual(ui.problems(raw({ what: '198.51.100.0/24', proto: 'icmpv6' })).map(item => item.field), [ 'proto' ], 'no shared IP family');
assert.deepEqual(ui.problems(raw({ what: '' })).map(item => [ item.field, item.incomplete ]), [ [ 'what', true ] ], 'a rule that matches all traffic is incomplete');
assert.deepEqual(ui.problems(raw({ what: '', anchor: 'link' })).map(item => item.field), [ 'link' ], 'the anchor moves the message to a visible field');
assert.deepEqual(ui.problems(raw({ what: '', proto: 'tcp' })), [], 'a protocol alone is something to match');
assert.equal(ui.problems(raw({ what: 'a.com', dest_port: '443' })).length, 1, 'one message per field');

assert.equal(ui.matchesNothing(draft()), true);
assert.equal(ui.matchesNothing(draft({ domain: [ 'a.com' ] })), false);
assert.equal(ui.matchesNothing(draft({ proto: 'udp' })), false, 'a protocol alone is something to match');

// simple mode shares the checks and names the missing fields
assert.deepEqual(ui.simpleProblems(templates['site-link'], { what: 'youtube.com', link: 'wan_tim' }), []);
assert.deepEqual(ui.simpleProblems(templates['site-link'], { what: '', link: 'wan_tim' }).map(item => [ item.field, item.message ]),
	[ [ 'what', 'Enter a site or address, for example youtube.com.' ] ], 'a missing site is reported once');
assert.deepEqual(fields(ui.simpleProblems(templates['site-link'], { what: 'youtube.com', link: '' })), [ 'link' ]);
assert.deepEqual(fields(ui.simpleProblems(templates['device-link'], { who: '', link: 'wan_tim' })), [ 'who' ]);
assert.deepEqual(ui.simpleProblems(templates['device-link'], { who: 'laptop.lan', link: 'wan_tim' }).map(item => item.field), [ 'who' ]);
assert.deepEqual(fields(ui.simpleProblems(templates.game, { ports: '', link: 'wan_tim' })), [ 'dest_port' ], 'ports are mapped to their input');
assert.deepEqual(fields(ui.simpleProblems(templates.game, { ports: '99999', link: 'wan_tim' })), [ 'dest_port' ]);
assert.deepEqual(fields(ui.simpleProblems(templates.block, { what: 'ads.example.com' })), [], 'block needs no link');
assert.deepEqual(fields(ui.simpleProblems(templates['site-link'], { what: 'not a domain!', link: 'wan_tim' })), [ 'what' ]);

assert.deepEqual(ui.simpleValues(draft({ domain: [ 'a.com' ], dest_ip: [ '10.0.0.0/8' ], via: 'wan_str_first' }), ctx),
	{ what: 'a.com, 10.0.0.0/8', who: '', ports: '', link: 'wan_str' }, 'the generated strategy gives back its link');
assert.equal(ui.simpleValues(draft({ via: 'prefer:wan_tim', src_mac: [ 'aa:bb:cc:dd:ee:01' ] }), ctx).who, 'aa:bb:cc:dd:ee:01');
assert.equal(ui.simpleValues(draft({ via: 'blackhole' }), ctx).link, 'wan_tim', 'no link falls back to the first one');
assert.equal(ui.simpleValues(draft({ via: 'blackhole' }), { links: [] }).link, '');

// presets are resolved like saving would
let resolved = ui.resolveVia('prefer:wan_str', ctx);
assert.equal(resolved.via, 'wan_str_first');
assert.deepEqual(resolved.routes.slice(routes.length).map(item => [ item.interface, item.metric ]),
	[ [ 'wan_str', '1' ], [ 'wan_tim', '2' ], [ 'wan_tim6', '2' ], [ 'wg_vpn', '3' ] ], 'the preferred link first, then the others');
assert.equal(ctx.strategies.length, 2, 'the input is not mutated');
assert.equal(ui.resolveVia('prefer:wan_tim', ctx).via, 'wan_tim_first');
assert.equal(ui.resolveVia('prefer:wan_tim', { ...ctx, strategies: strategies.concat({ '.name': 'wan_tim_first', use_route: [] }) }).strategies.length, 3, 'an existing strategy is reused');
assert.deepEqual(ui.resolveVia('only:wan_gone', ctx).via, 'only:wan_gone', 'an unknown link stays a preset');
assert.equal(ui.resolveVia('tim_first', ctx).via, 'tim_first');

// issues for a draft that still uses a preset do not complain about a missing path
const check = (extra, over) => ui.issues(draft(Object.assign({ domain: [ 'a.com' ] }, extra)), Object.assign({}, ctx, over));

assert.deepEqual(check({ via: 'prefer:wan_tim' }).filter(item => item.severity != 'info'), []);
assert.ok(check({ via: 'only:wan_str' }).some(item => item.code == 'pathDown'), 'a down link is reported through the preset');
assert.deepEqual(check({ via: 'tim_first' }).map(item => item.code), [], 'an ordinary failover path needs no note');
assert.deepEqual(check({ via: 'wg_vpn_only' }).map(item => item.code), ['stopsWhenDown']);
assert.ok(ui.attention(check({ via: 'only:wan_str' })).every(item => item.severity != 'info'));

// placement and drafts
const saved = [ draft({ name: 'a' }), draft({ name: 'b' }), draft({ name: 'default_rule_v4' }), draft({ name: 'default_rule_v6' }) ];
const isDefault = item => /^default_rule/.test(item.name);

assert.deepEqual(ui.placement(saved, 'b', isDefault), { rules: [ saved[0], saved[2], saved[3] ], position: 1 });
assert.deepEqual(ui.placement(saved, null, isDefault), { rules: saved, position: 2 }, 'a new rule goes before the defaults');
assert.equal(ui.placement(saved.slice(0, 2), null, isDefault).position, 2);
assert.deepEqual(ui.withDraft(saved, draft({ name: 'b', label: 'new' }), isDefault).map(item => item.label), [ '', 'new', '', '' ]);
assert.deepEqual(ui.withDraft(saved, draft({ name: null, label: 'fresh' }), isDefault).map(item => item.label), [ '', '', 'fresh', '', '' ]);
assert.equal(saved[1].label, '', 'saved drafts are not mutated');

// a rule listing names and addresses is split, because the backend ANDs them
const mixed = draft({ name: 'vid', label: 'Video', domain: [ 'a.com', 'b.com' ], dest_ip: [ '203.0.113.0/24' ], src_mac: [ 'aa:bb:cc:dd:ee:01' ], proto: 'tcp',
	dest_port: '443', via: 'tim_first', sticky: '1', ipset: 'vids' });
let parts = ui.splitMixed(mixed);

assert.equal(ui.isMixed(mixed), true);
assert.equal(ui.isMixed(draft({ domain: [ 'a.com' ] })), false);
assert.equal(ui.isMixed(draft({ dest_ip: [ '10.0.0.0/8' ] })), false);
assert.equal(parts.length, 2);
assert.deepEqual([ parts[0].name, parts[0].label, parts[0].domain, parts[0].dest_ip ], [ 'vid', 'Video', [ 'a.com', 'b.com' ], [] ], 'the first rule keeps the names');
assert.deepEqual([ parts[1].name, parts[1].label, parts[1].domain, parts[1].dest_ip ], [ null, 'Video (addresses)', [], [ '203.0.113.0/24' ] ], 'the second rule keeps the addresses');
for (const key of [ 'src_mac', 'proto', 'dest_port', 'via', 'sticky', 'ipset', 'enabled' ])
	assert.deepEqual(parts[1][key], parts[0][key], `${key} is the same in both rules`);
assert.equal(mixed.dest_ip.length, 1, 'the draft is not mutated');
assert.equal(ui.splitMixed(draft({ name: 'n', label: '', domain: [ 'a.com' ], dest_ip: [ '10.0.0.0/8' ] }))[1].label, '', 'an automatic name stays automatic');
const plain = draft({ domain: [ 'a.com' ] });
assert.deepEqual(ui.splitMixed(plain), [ plain ], 'other drafts are not split');
assert.equal(ui.splitNote(), 'This creates 2 rules: one for names, one for addresses');
assert.equal(ui.siblingName('video', [ 'video' ]), 'video_ip');
assert.equal(ui.siblingName('youtube_com_via', [ 'youtube_com_via' ]), 'youtube_com_ip', 'the suffix survives the length limit');
assert.equal(ui.siblingName('video', [ 'video', 'video_ip' ]), 'video_ip_2', 'a taken name gets a number');

const sentences = ui.sentence(draft({ label: 'Video', domain: [ 'a.com' ], dest_ip: [ '203.0.113.0/24' ], via: 'tim_first' }), ctx);

assert.ok(/Sends a\.com from all devices/.test(sentences) && /Sends 203\.0\.113\.0\/24 from all devices/.test(sentences), sentences);
assert.ok(!/a\.com and 203/.test(sentences) && !/a\.com, 203/.test(sentences), 'no sentence claims a union');
assert.equal(ui.sentence(plain, ctx), mwan4Explain.ruleSentence(plain, ctx), 'a plain draft keeps its sentence');
assert.match(ui.listSentence(mixed, ctx), /^Never matches: it lists both site names and addresses/);
assert.match(ui.listSentence(Object.assign({}, mixed, { enabled: '0' }), ctx), /^Disabled: Never matches/);
assert.equal(ui.listSentence(plain, ctx), mwan4Explain.ruleSentence(plain, ctx));

assert.deepEqual(ui.issues(mixed, ctx).map(item => item.code), [ 'mixedMatch' ], 'a saved rule with both kinds is flagged');
assert.deepEqual(ui.draftIssues(mixed, ctx).map(item => item.code), [], 'what saving would write is not flagged');
assert.deepEqual(ui.draftIssues(Object.assign({}, mixed, { via: 'wg_vpn_only' }), ctx).map(item => item.code), [ 'stopsWhenDown' ], 'identical notes of both rules are shown once');

const around = [ draft({ name: 'a' }), draft({ name: 'vid' }), draft({ name: 'c' }), draft({ name: 'default_rule_v4' }) ];

assert.deepEqual(ui.withDrafts(around, parts, isDefault).map(item => item.name), [ 'a', 'vid', null, 'c', 'default_rule_v4' ], 'the second rule follows the first');
assert.deepEqual(ui.withDrafts(around, [ draft({ name: null, label: 'one' }), draft({ name: null, label: 'two' }) ], isDefault).map(item => item.label),
	[ '', '', '', 'one', 'two', '' ], 'a new rule and its sibling go before the defaults');

const original = draft({ name: 'x', label: 'Video', domain: [ 'a.com' ], via: 'tim_first' });
const copy = ui.copyOf(original);

assert.deepEqual([ copy.name, copy.label, copy.via, copy.domain ], [ null, 'Copy of Video', 'tim_first', [ 'a.com' ] ]);
copy.domain.push('b.com');
assert.deepEqual(original.domain, [ 'a.com' ], 'the copy has its own lists');

// search and filter
const entry = (extra, issues) => {
	const item = draft(extra);
	return { draft: item, issues: issues || [], text: ui.searchText(item, 'Sends traffic through Tim first', devices) };
};
const youtube = entry({ name: 'yt', label: 'Video', domain: [ 'youtube.com' ], src_mac: [ 'aa:bb:cc:dd:ee:01' ] });
const off = entry({ name: 'off', label: 'Old', enabled: '0', dest_ip: [ '203.0.113.0/24' ] });
const warned = entry({ name: 'w', label: 'Warned' }, [ { severity: 'warning' } ]);
const noted = entry({ name: 'n', label: 'Noted' }, [ { severity: 'info' } ]);
const shown = (view, ...entries) => entries.filter(item => ui.visible(item, view)).map(item => item.draft.name);

assert.deepEqual(shown({ query: '', filter: 'all' }, youtube, off, warned, noted), [ 'yt', 'off', 'w', 'n' ]);
assert.deepEqual(shown({ query: 'VIDEO' }, youtube, off), [ 'yt' ], 'case is ignored and the filter defaults to all');
assert.deepEqual(shown({ query: 'youtube.com' }, youtube, off), [ 'yt' ], 'domains are searched');
assert.deepEqual(shown({ query: '203.0.113' }, youtube, off), [ 'off' ], 'addresses are searched');
assert.deepEqual(shown({ query: 'living-room' }, youtube, off), [ 'yt' ], 'device names are searched');
assert.deepEqual(shown({ query: '192.168.1.20' }, youtube, off), [ 'yt' ], 'device addresses are searched');
assert.deepEqual(shown({ query: 'tim first' }, youtube, off), [ 'yt', 'off' ], 'the sentence is searched and every word must match');
assert.deepEqual(shown({ query: 'old tim' }, youtube, off), [ 'off' ]);
assert.deepEqual(shown({ query: 'nothing here' }, youtube, off), []);
assert.deepEqual(shown({ query: '', filter: 'active' }, youtube, off), [ 'yt' ]);
assert.deepEqual(shown({ query: '', filter: 'disabled' }, youtube, off), [ 'off' ]);
assert.deepEqual(shown({ query: '', filter: 'attention' }, youtube, warned, noted), [ 'w' ], 'notes alone do not need attention');
assert.deepEqual(shown({ query: 'old', filter: 'active' }, youtube, off), [], 'search and filter combine');
assert.equal(ui.isFiltered({ query: '', filter: 'all' }), false);
assert.equal(ui.isFiltered({ query: ' ', filter: 'all' }), false);
assert.equal(ui.isFiltered({ query: 'x', filter: 'all' }), true);
assert.equal(ui.isFiltered({ query: '', filter: 'disabled' }), true);

// path choices
const groups = ui.viaGroups(ctx);

assert.deepEqual(groups.map(group => group[0]), [ 'Existing paths', 'Quick presets', 'Other' ]);
assert.deepEqual(groups[0][1].map(item => item[0]), [ 'tim_first', 'wg_vpn_only' ]);
assert.deepEqual(groups[1][1].map(item => item[0]), [ 'prefer:wan_tim', 'only:wan_tim', 'prefer:wan_str', 'only:wan_str', 'prefer:wg_vpn', 'only:wg_vpn' ]);
assert.deepEqual(groups[2][1].map(item => item[0]), [ 'default', 'unreachable', 'blackhole' ]);
assert.equal(groups[0][1][0][1], 'Tim first, then Str; stops if none is available', 'labels are sentences, not strategy names');
assert.equal(groups[1][1][1][1], 'Only Tim; stops if Tim is unavailable');
assert.equal(groups[0][1][0][2], 'tim_first', 'the strategy name stays available as a title');
assert.deepEqual(ui.viaGroups({ ...ctx, strategies: [] }).map(group => group[0]), [ 'Quick presets', 'Other' ], 'empty groups are dropped');
for (const item of groups.flatMap(group => group[1]))
	assert.ok(!/undefined|null|strategy|fail/i.test(item[1]), `"${item[1]}" avoids jargon`);

assert.deepEqual(ui.linkChoices(ctx), [ [ 'wan_tim', 'Tim (online)' ], [ 'wan_str', 'Str (offline)' ], [ 'wg_vpn', 'Vpn (online)' ] ]);
assert.deepEqual(ui.linkChoices({ links }), links.map(link => [ link.key, `${link.label} (status unknown)` ]), 'without live status the state is unknown');

// default routing plans
const groups3 = [ [ 'wan_tim', 'wan_tim6' ], [ 'wan_str' ], [ 'wg_vpn' ] ];

assert.deepEqual(ui.defaultRoutes('failover', 'wan_str', groups3).map(route => [ route.interface, route.metric ]),
	[ [ 'wan_str', 1 ], [ 'wan_tim', 2 ], [ 'wan_tim6', 2 ], [ 'wg_vpn', 3 ] ], 'the main link first, its IPv4 and IPv6 siblings share a level');
assert.deepEqual(ui.defaultRoutes('balanced', 'wan_str', groups3).map(route => [ route.interface, route.metric ]),
	[ [ 'wan_tim', 1 ], [ 'wan_tim6', 1 ], [ 'wan_str', 1 ], [ 'wg_vpn', 1 ] ], 'balancing puts every link on one level');
assert.deepEqual(ui.defaultRoutes('failover', 'wan_tim', []), [], 'no links, no routes');
assert.equal(ui.defaultPath('failover', 'wan_str', groups3).text, 'Str first, then Tim, then Vpn; stops if none is available');
assert.equal(ui.defaultPath('failover', 'wan_tim6', groups3).text, 'Tim first, then Str, then Vpn; stops if none is available', 'a sibling name picks its link');
assert.equal(ui.defaultPath('balanced', 'wan_tim', groups3).text, 'Balanced across Tim, Str and Vpn; stops if none is available');
assert.equal(ui.defaultPath('failover', 'wan_tim', []).kind, 'custom');

// traffic tester
assert.deepEqual(ui.testProblems({ destination: 'youtube.com' }), []);
assert.deepEqual(ui.testProblems({ destination: '203.0.113.7', source: '192.168.1.20', port: '443' }), []);
assert.deepEqual(ui.testProblems({ destination: '' }).map(item => [ item.field, item.incomplete ]), [ [ 'destination', true ] ]);
assert.deepEqual(ui.testProblems({ destination: 'not a domain!' }).map(item => [ item.field, item.incomplete ]), [ [ 'destination', false ] ]);
assert.deepEqual(fields(ui.testProblems({ destination: 'a.com', source: 'tv' })), [ 'source' ]);
assert.deepEqual(fields(ui.testProblems({ destination: 'a.com', port: '70000' })), [ 'port' ]);
assert.deepEqual(fields(ui.testProblems({ destination: 'a.com', port: '80-90' })), [ 'port' ], 'one port only');
assert.deepEqual(ui.testQuery({ destination: ' youtube.com ', source: 'AA-BB-CC-DD-EE-01', proto: 'tcp', port: ' 443 ' }),
	{ destination: 'youtube.com', proto: 'tcp', port: '443', source: { ip: '', mac: 'aa:bb:cc:dd:ee:01', iface: '' } });
assert.deepEqual(ui.testQuery({ destination: 'a.com', source: '192.168.1.20' }).source, { ip: '192.168.1.20', mac: '', iface: '' });
assert.equal(ui.testQuery({ destination: 'a.com' }).proto, 'all');
assert.deepEqual(ui.testPrefill(draft({ domain: [ 'a.com', 'b.com' ], src_ip: [ '10.0.0.5' ] })), { destination: 'a.com', source: '10.0.0.5', proto: 'all', port: '' });
assert.deepEqual(ui.testPrefill(draft({ dest_ip: [ '203.0.113.0/24' ], src_mac: [ 'aa:bb:cc:dd:ee:01' ] })),
	{ destination: '203.0.113.0', source: 'aa:bb:cc:dd:ee:01', proto: 'all', port: '' });
assert.deepEqual(ui.testPrefill(draft({ dest_ip: [ '0.0.0.0/0' ] })), { destination: '', source: '', proto: 'all', port: '' }, 'a catch-all has nothing to test');
assert.deepEqual(ui.testPrefill(draft({ domain: [ 'a.com' ], proto: 'tcp', dest_port: '27015-27030,3074' })).port, '27015', 'a port range starts at its first port');
assert.deepEqual(ui.testPrefill(draft({ domain: [ 'a.com' ], proto: 'udp', dest_port: '3074' })), { destination: 'a.com', source: '', proto: 'udp', port: '3074' });

const rules = [
	draft({ name: 'off', label: 'Old', enabled: '0', domain: [ 'youtube.com' ], via: 'tim_first' }),
	draft({ name: 'vpn', label: 'Work', domain: [ 'work.example.com' ], via: 'wg_vpn_only' }),
	draft({ name: 'yt', label: 'Video', domain: [ 'youtube.com' ], via: 'tim_first' }),
	draft({ name: 'default_rule_v4', label: 'Everything else (IPv4)', dest_ip: [ '0.0.0.0/0' ], via: 'tim_first' })
];
let result = mwan4Routetest.evaluate(ui.testQuery({ destination: 'www.youtube.com' }), rules, strategies, routes, status);
let rows = ui.examined(result);

assert.equal(result.matched.rule.name, 'yt');
assert.deepEqual(rows.map(row => [ row.index, row.name, row.state, row.enabled ]), [ [ 0, 'Old', 'skipped', false ], [ 1, 'Work', 'skipped', true ], [ 2, 'Video', 'match', true ] ]);
assert.equal(rows[0].text, 'Skipped: disabled');
assert.match(rows[1].text, /^Skipped: domain www\.youtube\.com is not work\.example\.com$/);
assert.equal(rows[2].text, 'Matches');
assert.equal(ui.decidingRule(result).name, 'yt');
assert.equal(ui.assumptionNote(result), '');

result = mwan4Routetest.evaluate(ui.testQuery({ destination: 'youtube.com' }), [ rules[1] ], strategies, routes, status);
assert.equal(ui.decidingRule(result), null, 'no rule decides when none matches');

result = mwan4Routetest.evaluate(ui.testQuery({ destination: 'youtube.com' }), [ draft({ name: 'net', label: 'Office', dest_ip: [ '10.0.0.0/8' ], via: 'tim_first' }), rules[2] ], strategies, routes, status);
assert.equal(ui.assumptionNote(result), '', 'an evaluator text that names the assumed rules is not repeated');
assert.equal(ui.assumptionNote({ ...result, text: 'Matches rule "Video" (#2).' }), 'Assumed not to apply, because they only match IP addresses: Office.');
assert.equal(ui.assumptionNote({ text: 'x', assumptions: [] }), '');
assert.equal(ui.assumptionNote({ text: 'x' }), '');

const unknown = mwan4Routetest.evaluate(ui.testQuery({ destination: '203.0.113.7' }), [ draft({ name: 'dom', label: 'Domain rule', domain: [ 'a.com' ], via: 'tim_first' }) ], strategies, routes, status);

assert.equal(ui.decidingRule(unknown).name, 'dom', 'the rule that makes the answer uncertain is worth opening');
assert.match(ui.examined(unknown)[0].text, /^Cannot tell: /);

console.log('rulesui tests passed');
