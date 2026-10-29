const fs = require('fs');
const path = require('path');

const overviewPath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/view/mwan4/network/overview.js');
const commonPath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/common.js');
const rulesModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/rules.js');
const overviewModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/overview.js');
const connectionsModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/connections.js');
const linkHistoryModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/linkhistory.js');
const explainModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/explain.js');
const routetestModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/routetest.js');
const summaryModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/summary.js');
const wanformModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/wanform.js');
const rulecheckModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/rulecheck.js');
const rulesuiModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/rulesui.js');
const templatesModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/templates.js');
const stabilityModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/stability.js');
const diagnosticsModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/diagnostics.js');
const guideModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/guide.js');
const diagnosticsPath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/view/mwan4/status/diagnostics.js');
const statusPath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/view/mwan4/status/overview.js');

function defaultUci() {
	return {
		mwan4: [
			{
				'.type': 'interface',
				'.name': 'wan_primary',
				'.index': 0,
				enabled: '1',
				family: [ 'ipv4', 'ipv6' ],
				track_method: 'ping',
				track_ip: [ '1.1.1.1', '8.8.8.8' ],
				reliability: '1',
				interval: '10',
				down: '5',
				up: '5',
				check_quality: '1',
				failure_latency: '1000',
				failure_loss: '40',
				recovery_latency: '500',
				recovery_loss: '10'
			},
			{
				'.type': 'interface',
				'.name': 'wan_backup',
				'.index': 1,
				enabled: '1',
				family: [ 'ipv4' ],
				track_method: 'httping',
				track_ip: [ '9.9.9.9' ],
				reliability: '1',
				interval: '10',
				down: '5',
				up: '5',
				check_quality: '0'
			},
			{ '.type': 'route', '.name': 'route_wan_primary', interface: 'wan_primary', metric: '1' },
			{ '.type': 'route', '.name': 'route_wan_backup', interface: 'wan_backup', metric: '2' },
			{ '.type': 'strategy', '.name': 'failover', use_route: [ 'route_wan_primary', 'route_wan_backup' ], last_resort: 'unreachable' },
			{ '.type': 'rule', '.name': 'default_rule_v4', '.index': 0, family: [ 'ipv4' ], dest_ip: '0.0.0.0/0', use_strategy: 'failover' },
			{ '.type': 'rule', '.name': 'default_rule_v6', '.index': 1, family: [ 'ipv6' ], dest_ip: '::/0', use_strategy: 'failover' },
			{ '.type': 'globals', '.name': 'globals', mmx_mask: '0x3F00', source_routing: '0', loglevel: 'notice' }
		],
		network: [
			{ '.type': 'interface', '.name': 'loopback', proto: 'static' },
			{ '.type': 'interface', '.name': 'lan', proto: 'static' },
			{ '.type': 'interface', '.name': 'wan_primary', proto: 'dhcp' },
			{ '.type': 'interface', '.name': 'wan_backup', proto: 'dhcp' },
			{ '.type': 'interface', '.name': 'wan_lte', proto: 'dhcp' },
			{ '.type': 'interface', '.name': 'wan_lte6', proto: 'dhcpv6' }
		]
	};
}

function defaultConnections() {
	return {
		ok:         true,
		accounting: true,
		items:      [
			{ family: 'ipv4', proto: 'tcp', src: '192.168.1.30', sport: 51000, dst: '203.0.113.10', dport: 443, state: 'ESTABLISHED', timeout: 7200, packets: 120, bytes: 150000, rule: 'streaming', rule_label: 'Streaming', interface: 'wan_primary', strategy: 'failover' },
			{ family: 'ipv4', proto: 'udp', src: '192.168.1.20', sport: 40000, dst: '198.51.100.7', dport: 53, state: 'UNREPLIED', timeout: 25, packets: 2, bytes: 180, rule: 'backups', rule_label: 'backups', interface: 'wan_backup', strategy: '' },
			{ family: 'ipv6', proto: 'tcp', src: '2001:db8::30', sport: 52000, dst: '2001:db8:ffff::10', dport: 443, state: 'ESTABLISHED', timeout: 90, packets: 40, bytes: 8000, rule: '', rule_label: '', interface: 'wan_primary', strategy: 'failover' }
		]
	};
}

function defaultLinkHistory() {
	const NOW = Math.floor(Date.now() / 1000);

	return {
		ok:         true,
		interfaces: {
			wan_primary: {
				events:       [
					{ time: NOW - 16500, state: 'online', reason: 'start' },
					{ time: NOW - 7200, state: 'offline', reason: 'tracker' },
					{ time: NOW - 7100, state: 'online', reason: 'tracker' },
					{ time: NOW - 600, state: 'offline', reason: 'tracker' },
					{ time: NOW - 560, state: 'held', reason: 'flapping' }
				],
				flaps:        { count_window: 3, window: 300, total: 9 },
				availability: { pct_1h: 91.3, observed_1h: 3600, pct_24h: 99.2, observed_24h: 16500 },
				held:         { active: true, reason: 'flapping', until: NOW + 90, remaining: 90 }
			},
			wan_backup: { events: [], flaps: { count_window: 0, window: 300, total: 0 }, availability: { pct_1h: 100, observed_1h: 3600, pct_24h: 100, observed_24h: 86400 }, held: { active: false } }
		}
	};
}

function stableStatus() {
	const NOW = Math.floor(Date.now() / 1000);
	let status = defaultStatus();
	let primary = status.interfaces.wan_primary;
	let backup = status.interfaces.wan_backup;

	Object.assign(primary, { health_state: 'held', flaps: { count_window: 3, window: 300, total: 9 }, availability: { pct_1h: 91.3, observed_1h: 3600, pct_24h: 99.2, observed_24h: 16500 }, degraded_for: [], held: { active: true, reason: 'flapping', until: NOW + 90, remaining: 90 } });
	Object.assign(backup, { flaps: { count_window: 0, window: 300, total: 0 }, availability: { pct_1h: 100, observed_1h: 3600, pct_24h: 100, observed_24h: 86400 }, held: { active: false }, degraded_for: [ 'failover', 'streaming' ] });

	return status;
}

function defaultStatus() {
	return {
		interfaces: {
			wan_primary: {
				active_connections: { ipv4: 5, ipv6: 0, total: 5 },
				status: 'online',
				up: true,
				tracking: 'tracking',
				track_method: 'ping',
				score_percent: 90,
				score_current: 9,
				score_max: 10,
				failed_checks: 0,
				failed_targets: 0,
				families: {
					ipv4: { status: 'online', health_state: 'online', up: true },
					ipv6: { status: 'online', health_state: 'online', up: true }
				},
				track_ip: [
					{ ip: '1.1.1.1', status: 'online', latency: 21, packetloss: 0 },
					{ ip: '8.8.8.8', status: 'online', latency: 24, packetloss: 0 }
				]
			},
			wan_backup: {
				active_connections: { ipv4: 2, ipv6: 0, total: 2 },
				status: 'online',
				up: true,
				tracking: 'tracking',
				track_method: 'httping',
				score_percent: 80,
				score_current: 8,
				score_max: 10,
				failed_checks: 0,
				failed_targets: 0,
				families: {
					ipv4: { status: 'online', health_state: 'online', up: true }
				},
				track_ip: [
					{ ip: '9.9.9.9', status: 'online', latency: 35, packetloss: 0 }
				]
			}
		},
		strategies: {
			ipv4: { failover: [ { interface: 'wan_primary', percent: 100 } ] },
			ipv6: { failover: [ { interface: 'wan_primary', percent: 100 } ] }
		},
		strategy_status: {
			ipv4: { failover: { exists: true, active_connections: 4 } },
			ipv6: { failover: { exists: true, active_connections: 1 } }
		},
		diagnostics: {
			warnings: []
		}
	};
}

/* A dual-stack link configured as two sections, wan_x (IPv4, online) and wan_x6 (IPv6, offline), next to the two default links. */
function withSiblingPair(options) {
	const uci = (options && options.uci) || defaultUci();
	const status = (options && options.status) || defaultStatus();
	const section = (name, family, targets) => ({
		'.type': 'interface', '.name': name, enabled: '1', family: [ family ], track_method: 'ping', track_ip: targets, reliability: '1', interval: '10', down: '5', up: '5', check_quality: '0'
	});
	const runtime = (family, state, targets) => ({
		active_connections: { ipv4: family == 'ipv4' ? 3 : 0, ipv6: 0, total: family == 'ipv4' ? 3 : 0 },
		status: state, health_state: state, up: true, tracking: 'tracking', track_method: 'ping', score_percent: state == 'online' ? 100 : 0, score_current: 10, score_max: 10,
		failed_checks: state == 'online' ? 0 : 3, failed_targets: state == 'online' ? 0 : 2, families: { [family]: { status: state, health_state: state, up: true } },
		track_ip: targets.map(ip => ({ ip: ip, status: state == 'online' ? 'up' : 'down', latency: state == 'online' ? 18 : null, packetloss: state == 'online' ? 0 : 100 }))
	});
	const v4 = [ '1.1.1.1', '9.9.9.9' ];
	const v6 = [ '2606:4700:4700::1111', '2001:4860:4860:0:0:0:0:8888' ];

	uci.mwan4.splice(uci.mwan4.findIndex(item => item['.type'] == 'route'), 0, section('wan_x', 'ipv4', v4), section('wan_x6', 'ipv6', v6));
	uci.mwan4.forEach((item, index) => { item['.index'] = index; });
	status.interfaces.wan_x = runtime('ipv4', 'online', v4);
	status.interfaces.wan_x6 = runtime('ipv6', 'offline', v6);

	return Object.assign({}, options, { uci: uci, status: status });
}

function defaultCounters() {
	return {
		counters: {
			mwan4_counter_rule_default_rule_v4: { packets: 4, bytes: 512 },
			mwan4_counter_rule_default_rule_v4_ipv4: { packets: 9, bytes: 2048 },
			mwan4_counter_strategy_failover: { packets: 4, bytes: 512 },
			mwan4_counter_iface_wan_primary: { packets: 4, bytes: 512 }
		},
		rules: {
			streaming: {
				new_connections:    { ipv4: 30, ipv6: 10, total: 40 },
				active_connections: { ipv4: 2, ipv6: 1, total: 3 }
			},
			default_rule_v4: {
				new_connections:    { ipv4: 9, ipv6: 0, total: 9 },
				active_connections: { ipv4: 4, ipv6: 0, total: 4 }
			}
		}
	};
}

function defaultHostHints() {
	return {
		'aa:bb:cc:dd:ee:01': { name: 'living-room-tv', ipaddrs: [ '192.168.1.20' ] },
		'aa:bb:cc:dd:ee:02': { name: 'laptop', ipaddrs: [ '192.168.1.30' ] }
	};
}

function defaultPbrPreview() {
	return {
		ok: true,
		applied: false,
		policies: [
			{ pbr_section: 'cfg1', name: 'youtube', rule: 'pbr_youtube', action: 'import', reason: '', target: 'wan_backup', strategy: 'wan_backup_first', summary: 'youtube.com -> wan_backup' },
			{ pbr_section: 'cfg2', name: 'dns trick', rule: '', action: 'skip', reason: 'dns_policy is not supported', target: '', strategy: '', summary: '' }
		],
		interfaces: [],
		strategies: [ 'wan_backup_first' ],
		warnings: [ 'config include /etc/pbr.d/20-discord-chrome.sh was not imported' ]
	};
}

function defaultDiagnostics() {
	return {
		summary: {
			diagnostics: {
				summary: {
					version: 1,
					interfaces: [ 'wan_primary', 'wan_backup' ],
					strategies: [ 'failover' ],
					status: { configured: true, service_running: true, diagnostics: { warnings: [] } }
				}
			}
		},
		interfaces: {
			diagnostics: {
				interfaces: {
					wan_primary: { enabled: true, families: [ 'ipv4', 'ipv6' ], id: 1, table_id: 1, mark: '0x100', track_ip: [ '1.1.1.1' ], tracking: { ipv4: { status: 'online', tracking: 'active', hotplug: 'online' } } }
				}
			}
		},
		routes: {
			diagnostics: {
				routes: { ipv4: [ 'default via 192.0.2.1 dev eth1' ], ipv6: [], warnings: [] }
			}
		},
		rules: {
			diagnostics: {
				rules: { ipv4: [ '2001: from all fwmark 0x100/0x3f00 lookup 1' ], ipv6: [] }
			}
		},
		nftables: {
			diagnostics: {
				nftables: { table: 'fw4', ready: true, chains: { prerouting: true, output: true }, files: { dynamic: { path: '/usr/share/nftables.d/ruleset-post/10-mwan4.nft', exists: true } } }
			}
		},
		service: {
			diagnostics: {
				service: { running: true, instances_running: 3, trackers_running: 1, instances: [ 'instance1', 'track_wan_primary_ipv4' ], tracker_instances: { expected: [ 'track_wan_primary_ipv4' ], running: [ 'track_wan_primary_ipv4' ], missing: [] } }
			}
		},
		explain: {
			diagnostics: {
				explain: {
					input: { family: 'ipv4', proto: 'tcp', src_ip: '192.0.2.10', dest_ip: '1.1.1.1', dest_port: '443' },
					matched_rule: { rule: 'speed_test', matched: true, use_strategy: 'failover' },
					decision: { type: 'strategy', strategy: 'failover', selected: { interface: 'wan_primary', mark: '0x100', table_id: '1' } },
					rules: [ { rule: 'guest_wifi', matched: false, use_strategy: 'balanced' }, { rule: 'speed_test', matched: true, use_strategy: 'failover' } ]
				}
			}
		},
		quality: {
			diagnostics: {
				quality: {
					summary: { interfaces: 2, enabled: 1, unsupported: 1 },
					interfaces: [
						{ interface: 'wan_primary', track_method: 'ping', failure_latency: '1000', failure_loss: '40', recovery_latency: '500', recovery_loss: '10' },
						{ interface: 'wan_backup', track_method: 'httping', failure_latency: 'not set', failure_loss: 'not set', recovery_latency: 'not set', recovery_loss: 'not set' }
					],
					decisions: [ { interface: 'wan_primary', state: 'degraded', reason: 'packet loss above failure threshold', sample: '65%' } ],
					warnings: [ { message: 'wan_backup helper cannot report latency/loss quality' } ]
				}
			}
		},
		probes: {
			diagnostics: {
				probes: {
					summary: { targets: 3, measured: 2, down: 1 },
					helpers: {
						ping: { helper: 'builtin', available: true, quality_supported: true },
						nslookup: { helper: '/usr/bin/nslookup', available: true, quality_supported: false }
					},
					interfaces: {
						wan_primary: { families: { ipv4: { targets: [ { target: '1.1.1.1', status: 'online', latency: 21, packetloss: 0 } ] } } },
						wan_backup: { families: { ipv4: { targets: [ { target: '9.9.9.9', status: 'timeout' } ] } } }
					},
					failures: [ { interface: 'wan_backup', target: '9.9.9.9', state: 'timeout', reason: 'probe timeout' } ],
					bfd: {
						available: true,
						sessions: [ { peer: '198.51.100.1', state: 'up', interface: 'wan_primary', vrf: 'default' } ],
						configured: [ { interface: 'wan_primary', peer: '198.51.100.1', device: 'eth1', live_match: true } ]
					}
				}
			}
		},
		vrf: {
			diagnostics: {
				vrf: {
					devices: [ { vrf: 'vrf_wan', table: '1001', state: 'up' } ],
					interfaces: { wan_primary: { device: 'eth1', master: 'vrf_wan', table: '1001' } },
					l3mdev_rule: true,
					l3mdev_rules: { ipv4: [ '1000: from all lookup [l3mdev-table]' ], ipv6: [] },
					tables: { vrf_wan: { table: '1001', ipv4: [ 'default via 192.0.2.1 dev eth1' ], ipv6: [] } },
					validation: [ { check: 'l3mdev rule', expected: 'present', observed: 'present', ok: true } ]
				}
			}
		},
		pbr: {
			diagnostics: {
				pbr: {
					config: { enabled: true, ipv6_enabled: true, fw_mask: '0xff0000', uplink_interface: 'wan_primary', uplink_interface6: 'wan_primary6', supported_interfaces: [ 'wan_primary', 'wan_primary6' ], ip_rules_priority: 30000 },
					interface_coverage: { wan_primary: { state: 'supported', source: 'pbr supported_interface' }, wan_backup: { state: 'missing', source: 'mwan4 enabled WAN' } },
					targets: [ { policy: 'speed_test', target: 'mwan4_strategy_failover', result: 'OK' } ],
					validation: [ { check: 'mark mask separation', expected: 'separate masks', observed: '0xff0000', ok: true } ],
					service_running: true,
					rules: { ipv4: [ '30000: from all fwmark 0x10000/0xff0000 lookup pbr_wan' ], ipv6: [] },
					warnings: []
				}
			}
		},
		packages: {
			diagnostics: {
				packages: {
					manager: 'apk',
					features: {
						wireguard: { ready: false, packages: [ { name: 'wireguard-tools', installed: true, version: 'wireguard-tools-1' }, { name: 'kmod-wireguard', installed: false } ] },
						pbr: { ready: true, packages: [ { name: 'pbr', installed: true, version: 'pbr-1.2.3-r72' }, { name: 'luci-app-pbr', installed: true, version: 'luci-app-pbr-1.2.3-r72' } ] }
					},
					missing: [ { feature: 'wireguard', package: 'kmod-wireguard' } ],
					warnings: []
				}
			}
		},
		counters: {
			diagnostics: {
				counters: {
					items: {
						mwan4_counter_rule_default_rule_v4_ipv4: { packets: 12, bytes: 3456 },
						mwan4_counter_strategy_failover: { packets: 12, bytes: 3456 },
						mwan4_counter_iface_wan_primary: { packets: 12, bytes: 3456 }
					},
					summary: { total: 3, packets: 36, bytes: 10368, referenced: 2 },
					references: { mwan4_counter_rule_default_rule_v4_ipv4: [ { chain: 'mwan4_rules_ipv4' } ] },
					missing_references: [ { counter: 'mwan4_counter_missing', chain: 'mwan4_rules_ipv4' } ],
					warnings: [ { message: 'one referenced counter was not reported by nft list counters' } ]
				}
			}
		},
		ownership: {
			diagnostics: {
				ownership: {
					tables: [ '1', '2' ],
					marks: [ '0x100', '0x200' ],
					rule_prefs: [ '2001', '2002' ],
					chains: [ 'mwan4_rules_ipv4' ],
					counters: [ 'mwan4_counter_rule_default_rule_v4_ipv4' ],
					interfaces: { wan_primary: { id: 1, table_id: 1, mark: '0x100' } },
					conflicts: [ { object: 'table 1', owner: 'mwan4', message: 'no conflict' } ]
				}
			}
		},
		mptcp: {
			diagnostics: {
				mptcp: {
					available: true,
					enabled: '1',
					enabled_bool: true,
					endpoint_details: [ { address: '192.0.2.20', id: '1', device: 'wan_primary', flags: [ 'signal', 'subflow' ] } ],
					limits_detail: { subflows: '2', add_addr_accepted: '8' },
					route_alignment: [ { interface: 'wan_primary', source: '192.0.2.20', table: '1', result: 'OK' } ],
					warnings: []
				}
			}
		},
		tunnels: {
			diagnostics: {
					tunnels: {
					interfaces: { wg0: { interface: 'wg0', transport_type: 'wireguard', endpoint: '198.51.100.10', underlay_strategy: 'wan_only', underlay_interfaces: [ 'wan_primary' ] } },
					endpoints: { interfaces: { wg0: { interface: 'wg0', endpoint: '198.51.100.10', route: { raw: '198.51.100.10 via 10.64.10.1 dev eth1' } } } },
					recursion: { graph: { wg0: [ 'wan_primary' ] }, warnings: [ { tunnel: 'wg0', endpoint: '198.51.100.10', message: 'endpoint leaves through wan_primary' } ] },
					warnings: []
				}
			}
		}
	};
}

async function renderOverview(page, options) {
	options = options || {};

	await page.setContent('<!doctype html><html><head></head><body><main id="test-root"></main></body></html>');
	await page.evaluate(function(args) {
		const state = {
			uci: args.uci,
			status: args.status,
			counters: args.counters,
			operatorAccess: !!args.operatorAccess,
			advancedAccess: !!args.advancedAccess,
			diagnosticsAccess: !!args.diagnosticsAccess,
			configWrite: !!args.configWrite,
			connections: args.connections,
			history: args.history,
			hostHints: args.hostHints,
			pbrPreview: args.pbrPreview,
			rpcCalls: [],
			polls: []
		};

		if (!String.prototype.format) {
			String.prototype.format = function() {
				let values = arguments;
				let index = 0;

				return String(this).replace(/%%|%[sd]/g, function(token) {
					if (token == '%%')
						return '%';

					return String(values[index++]);
				});
			};
		}

		function translate(text) {
			return text;
		}

		function appendChild(node, child) {
			if (child == null || child === false)
				return;

			if (Array.isArray(child)) {
				// real LuCI dom.append stringifies null/undefined/false array items
				child.forEach(function(item) { item == null || item === false ? node.appendChild(document.createTextNode(String(item))) : appendChild(node, item); });
				return;

			}

			if (child instanceof Node) {
				node.appendChild(child);
				return;
			}

			node.appendChild(document.createTextNode(String(child)));
		}

		function E(tag, attrs, children) {
			if (attrs == null || attrs instanceof Node || Array.isArray(attrs) || typeof attrs != 'object') {
				children = attrs;
				attrs = {};
			}

			let node = document.createElement(tag);

			Object.keys(attrs || {}).forEach(function(key) {
				let value = attrs[key];
				if (value == null || value === false)
					return;

				if (typeof value == 'function') {
					node.addEventListener(key, value);
					return;
				}

				if (key == 'class') {
					node.className = value;
					return;
				}

				if (key == 'checked' || key == 'selected' || key == 'disabled' || key == 'hidden')
					node[key] = true;

				if (key == 'value')
					node.value = value;

				node.setAttribute(key, value === true ? key : String(value));
			});

			appendChild(node, children);
			return node;
		}

		function sectionList(conf) {
			return state.uci[conf] || [];
		}

		function findSection(conf, sid) {
			return sectionList(conf).find(function(section) {
				return section['.name'] == sid;
			}) || null;
		}

		const L = {
			resource: function(resourcePath) { return '/luci-static/resources/' + resourcePath; },
			resolveDefault: function(value, fallback) {
				return Promise.resolve(value).catch(function() { return fallback; });
			},
			url: function() { return '/cgi-bin/luci/' + Array.from(arguments).join('/'); }
		};

		const uci = {
			load: function() { return Promise.resolve(); },
			unload: function() {},
			save: function() { return Promise.resolve(); },
			apply: function() { return Promise.resolve(); },
			sections: function(conf, type) {
				return sectionList(conf).filter(function(section) {
					return !type || section['.type'] == type;
				});
			},
			get: function(conf, sid, opt) {
				let section = findSection(conf, sid);
				if (!section)
					return null;

				return opt == null ? section : section[opt];
			},
			add: function(conf, type, sid) {
				state.uci[conf] = state.uci[conf] || [];
				state.uci[conf].push({ '.type': type, '.name': sid, '.index': state.uci[conf].length });
				return sid;
			},
			set: function(conf, sid, opt, value) {
				let section = findSection(conf, sid);
				if (section)
					section[opt] = value;
			},
			remove: function(conf, sid) {
				state.uci[conf] = sectionList(conf).filter(function(section) {
					return section['.name'] != sid;
				});
			},
			move: function(conf, sid1, sid2, after) {
				let moved = findSection(conf, sid1);
				let rest = sectionList(conf).filter(function(section) { return section !== moved; });
				let target = rest.findIndex(function(section) { return section['.name'] == sid2; });

				rest.splice(target + (after ? 1 : 0), 0, moved);
				rest.forEach(function(section, index) { section['.index'] = index; });
				state.uci[conf] = rest;
				return true;
			}
		};

		function applyPbrImport() {
			state.pbrPreview.policies.filter(function(policy) { return policy.action == 'import'; }).forEach(function(policy) {
				uci.add('mwan4', 'rule', policy.rule);
				uci.set('mwan4', policy.rule, 'label', policy.name);
				uci.set('mwan4', policy.rule, 'use_strategy', policy.strategy);
				uci.move('mwan4', policy.rule, 'default_rule_v4', false);
			});

			return Object.assign({}, state.pbrPreview, { applied: true });
		}


		function queryConnections(state, params) {
			let wanted = { rule: params[0], interface: params[1], strategy: params[2], family: params[3], proto: params[4] };
			let search = String(params[5] || '').toLowerCase();
			let offset = params[7] || 0;
			let items = state.connections.items.filter(function(item) {
				return Object.keys(wanted).every(function(key) { return !wanted[key] || item[key] == wanted[key]; }) &&
					(!search || JSON.stringify(item).toLowerCase().indexOf(search) >= 0);
			});
			let page = items.slice(offset, offset + (params[6] || 200));

			return { ok: true, accounting: state.connections.accounting !== false, total: items.length, truncated: offset + page.length < items.length, items: page };
		}

		function connectionsRpc(state, params) {
			return state.connections ? Promise.resolve(queryConnections(state, params)) : Promise.reject(new Error('Method not found'));
		}

		function historyRpc(state, params) {
			if (!state.history)
				return Promise.reject(new Error('Method not found'));

			let interfaces = Object.fromEntries(Object.keys(state.history.interfaces).filter(function(name) { return !params[0] || params[0] == name; }).map(function(name) { return [ name, state.history.interfaces[name] ]; }));

			return Promise.resolve({ ok: true, interfaces: interfaces });
		}

		const rpc = {
			declare: function(spec) {
				return function() {
					let params = Array.from(arguments);
					state.rpcCalls.push({ object: spec.object, method: spec.method, params: params });

					if (spec.object == 'mwan4' && spec.method == 'connections')
						return connectionsRpc(state, params);
					if (spec.object == 'mwan4' && spec.method == 'link_history')
						return historyRpc(state, params);
					if (spec.object == 'mwan4' && spec.method == 'status')
						return Promise.resolve(params[0] == 'counters' ? state.counters : state.status);
					if (spec.object == 'luci-rpc' && spec.method == 'getHostHints')
						return Promise.resolve(state.hostHints);
					if (spec.object == 'mwan4' && spec.method == 'pbr_import')
						return Promise.resolve(params[0] ? applyPbrImport() : state.pbrPreview);
					if (spec.object == 'session' && spec.method == 'access') {
						let acl = params[1];
						if (acl == 'luci-app-mwan4')
							return Promise.resolve(state.configWrite);
						if (acl == 'luci-app-mwan4-operator')
							return Promise.resolve(state.operatorAccess);
						if (acl == 'luci-app-mwan4-advanced')
							return Promise.resolve(state.advancedAccess);
						if (acl == 'luci-app-mwan4-diagnostics')
							return Promise.resolve(state.diagnosticsAccess);
						return Promise.resolve(true);
					}

					return Promise.resolve({});
				};
			}
		};

		const poll = {
			add: function(fn) { state.polls.push(fn); }
		};

		const fs = {
			stat: function() { return Promise.resolve({ type: 'file' }); }
		};

		const ui = {
			addNotification: function(_, node) { document.body.appendChild(node); },
			hideModal: function() {
				document.querySelectorAll('.modal').forEach(function(node) { node.remove(); });
			},
			showModal: function(title, nodes, cls) {
				this.hideModal();
				document.body.appendChild(E('div', { class: 'modal ' + (cls || '') }, [
					E('h2', [ title ]),
					nodes
				]));
			}
		};

		const view = {
			extend: function(definition) { return definition; }
		};

		const baseclass = {
			extend: function(definition) { return definition; }
		};

		const common = new Function('baseclass', 'L', 'E', '_', args.commonSource)(baseclass, L, E, translate);
		const overviewModule = new Function('baseclass', 'mwan4Common', 'L', 'E', '_', args.overviewModuleSource)(baseclass, common, L, E, translate);
		const rulesModule = new Function('baseclass', 'L', 'E', '_', args.rulesModuleSource)(baseclass, L, E, translate);
		const connectionsModule = new Function('baseclass', 'rpc', 'mwan4Common', 'L', 'E', '_', args.connectionsModuleSource)(baseclass, rpc, common, L, E, translate);
		const explainModule = new Function('baseclass', '_', args.explainModuleSource)(baseclass, translate);
		const routetestModule = new Function('baseclass', 'mwan4Explain', 'mwan4Rules', '_', args.routetestModuleSource)(baseclass, explainModule, rulesModule, translate);
		const rulecheckModule = new Function('baseclass', 'mwan4Explain', 'mwan4Routetest', '_', args.rulecheckModuleSource)(baseclass, explainModule, routetestModule, translate);
		const templatesModule = new Function('baseclass', 'mwan4Rules', '_', args.templatesModuleSource)(baseclass, rulesModule, translate);
		const rulesuiModule = new Function('baseclass', 'mwan4Explain', 'mwan4Routetest', 'mwan4Rulecheck', 'mwan4Rules', 'mwan4Templates', '_', args.rulesuiModuleSource)(
			baseclass, explainModule, routetestModule, rulecheckModule, rulesModule, templatesModule, translate);
		const stabilityModule = new Function('baseclass', 'rpc', 'mwan4Common', 'mwan4Connections', 'L', 'E', '_', args.stabilityModuleSource)(baseclass, rpc, common, connectionsModule, L, E, translate);
		const linkHistoryModule = new Function('baseclass', 'mwan4Common', 'mwan4Stability', 'L', 'E', '_', args.linkHistoryModuleSource)(baseclass, common, stabilityModule, L, E, translate);
		const summaryModule = new Function('baseclass', '_', args.summaryModuleSource)(baseclass, translate);
		const wanformModule = new Function('baseclass', 'mwan4Templates', '_', args.wanformModuleSource)(baseclass, templatesModule, translate);
		const guideModule = new Function('baseclass', 'ui', 'mwan4Common', 'mwan4Explain', 'L', 'E', '_', args.guideModuleSource)(baseclass, ui, common, explainModule, L, E, translate);
		const modules = {
			mwan4Common: common, mwan4Connections: connectionsModule, mwan4Explain: explainModule, mwan4Guide: guideModule, mwan4LinkHistory: linkHistoryModule, mwan4Overview: overviewModule,
			mwan4Routetest: routetestModule, mwan4Rules: rulesModule, mwan4Rulesui: rulesuiModule, mwan4Stability: stabilityModule, mwan4Summary: summaryModule,
			mwan4Templates: templatesModule, mwan4Wanform: wanformModule
		};
		const names = Object.keys(modules);
		const module = new Function('fs', 'poll', 'rpc', 'uci', 'ui', 'view', ...names, 'L', 'E', '_', args.overviewSource)(
			fs, poll, rpc, uci, ui, view, ...names.map(name => modules[name]), L, E, translate);
		const root = document.getElementById('test-root');

		root.replaceChildren(module.render([
			null,
			null,
			state.status,
			state.operatorAccess,
			state.diagnosticsAccess,
			state.counters,
			{ type: 'file' },
			{ type: 'file' },
			{ type: 'file' },
			{ type: 'file' },
			state.hostHints,
			state.pbrPreview,
			state.configWrite,
			state.connections ? state.connections.items.length : null,
			!!state.history
		]));

		window.__mwan4Mock = {
			getUci: function() { return state.uci; },
			rpcCalls: state.rpcCalls,
			runPoll: function() {
				return Promise.all(state.polls.map(function(fn) { return fn(); }));
			},
			setConnections: function(connections) { state.connections = connections; },
			setCounters: function(counters) { state.counters = counters; },
			getHistory: function() { return state.history; },
			getStatus: function() { return state.status; },
			setHistory: function(history) { state.history = history; },
			setStatus: function(status) { state.status = status; },
			setUci: function(uciData) { state.uci = uciData; }
		};
	}, {
		overviewSource: fs.readFileSync(overviewPath, 'utf8'),
		overviewModuleSource: fs.readFileSync(overviewModulePath, 'utf8'),
		guideModuleSource: fs.readFileSync(guideModulePath, 'utf8'),
		connectionsModuleSource: fs.readFileSync(connectionsModulePath, 'utf8'),
		connections: options.connections === undefined ? defaultConnections() : options.connections,
		history: options.history || null,
		linkHistoryModuleSource: fs.readFileSync(linkHistoryModulePath, 'utf8'),
		stabilityModuleSource: fs.readFileSync(stabilityModulePath, 'utf8'),
		rulesModuleSource: fs.readFileSync(rulesModulePath, 'utf8'),
		explainModuleSource: fs.readFileSync(explainModulePath, 'utf8'),
		routetestModuleSource: fs.readFileSync(routetestModulePath, 'utf8'),
		rulecheckModuleSource: fs.readFileSync(rulecheckModulePath, 'utf8'),
		rulesuiModuleSource: fs.readFileSync(rulesuiModulePath, 'utf8'),
		summaryModuleSource: fs.readFileSync(summaryModulePath, 'utf8'),
		wanformModuleSource: fs.readFileSync(wanformModulePath, 'utf8'),
		templatesModuleSource: fs.readFileSync(templatesModulePath, 'utf8'),
		commonSource: fs.readFileSync(commonPath, 'utf8'),
		hostHints: options.hostHints || defaultHostHints(),
		pbrPreview: options.pbrPreview || { policies: [] },
		configWrite: options.configWrite == null ? true : options.configWrite,
		uci: options.uci || defaultUci(),
		status: options.status || defaultStatus(),
		counters: options.counters || defaultCounters(),
		operatorAccess: options.operatorAccess,
		advancedAccess: options.advancedAccess == null ? true : options.advancedAccess,
		diagnosticsAccess: options.diagnosticsAccess == null ? true : options.diagnosticsAccess
	});
}

async function renderDiagnostics(page, options) {
	options = options || {};

	await page.setContent('<!doctype html><html><head></head><body><main id="test-root"></main></body></html>');
	await page.evaluate(function(args) {
		const state = {
			diagnostics: args.diagnostics,
			diagnosticsAccess: !!args.diagnosticsAccess,
			operatorAccess: !!args.operatorAccess,
			configAccess: !!args.configAccess,
			connections: args.connections,
			rpcCalls: []
		};

		if (!String.prototype.format) {
			String.prototype.format = function() {
				let values = arguments;
				let index = 0;

				return String(this).replace(/%%|%[sd]/g, function(token) {
					if (token == '%%')
						return '%';

					return String(values[index++]);
				});
			};
		}

		function translate(text) {
			return text;
		}

		function appendChild(node, child) {
			if (child == null || child === false)
				return;

			if (Array.isArray(child)) {
				// real LuCI dom.append stringifies null/undefined/false array items
				child.forEach(function(item) { item == null || item === false ? node.appendChild(document.createTextNode(String(item))) : appendChild(node, item); });
				return;
			}

			if (child instanceof Node) {
				node.appendChild(child);
				return;
			}

			node.appendChild(document.createTextNode(String(child)));
		}

		function E(tag, attrs, children) {
			if (attrs == null || attrs instanceof Node || Array.isArray(attrs) || typeof attrs != 'object') {
				children = attrs;
				attrs = {};
			}

			let node = document.createElement(tag);

			Object.keys(attrs || {}).forEach(function(key) {
				let value = attrs[key];
				if (value == null || value === false)
					return;

				if (typeof value == 'function') {
					node.addEventListener(key, value);
					return;
				}

				if (key == 'class') {
					node.className = value;
					return;
				}

				if (key == 'checked' || key == 'selected' || key == 'disabled' || key == 'hidden')
					node[key] = true;

				if (key == 'value')
					node.value = value;

				node.setAttribute(key, value === true ? key : String(value));
			});

			appendChild(node, children);
			return node;
		}

		const L = {
			resource: function(resourcePath) { return '/luci-static/resources/' + resourcePath; },
			resolveDefault: function(value, fallback) {
				return Promise.resolve(value).catch(function() { return fallback; });
			},
			url: function() { return '/cgi-bin/luci/' + Array.from(arguments).join('/'); }
		};


		function queryConnections(state, params) {
			let wanted = { rule: params[0], interface: params[1], strategy: params[2], family: params[3], proto: params[4] };
			let search = String(params[5] || '').toLowerCase();
			let offset = params[7] || 0;
			let items = state.connections.items.filter(function(item) {
				return Object.keys(wanted).every(function(key) { return !wanted[key] || item[key] == wanted[key]; }) &&
					(!search || JSON.stringify(item).toLowerCase().indexOf(search) >= 0);
			});
			let page = items.slice(offset, offset + (params[6] || 200));

			return { ok: true, accounting: state.connections.accounting !== false, total: items.length, truncated: offset + page.length < items.length, items: page };
		}

		function connectionsRpc(state, params) {
			return state.connections ? Promise.resolve(queryConnections(state, params)) : Promise.reject(new Error('Method not found'));
		}

		const rpc = {
			declare: function(spec) {
				return function() {
					let params = Array.from(arguments);
					state.rpcCalls.push({ object: spec.object, method: spec.method, params: params });

					if (spec.object == 'mwan4' && spec.method == 'connections')
						return connectionsRpc(state, params);
					if (spec.object == 'session' && spec.method == 'access') {
						let acl = params[1];
						return Promise.resolve(acl == 'luci-app-mwan4-operator' ? state.operatorAccess : state.diagnosticsAccess);
					}

					if (spec.object == 'mwan4' && spec.method == 'control')
						return Promise.resolve({ ok: true, action: params[0], errors: [] });

					if (spec.object == 'mwan4' && spec.method == 'diagnostics') {
						let section = params[0] || 'summary';
						let result = JSON.parse(JSON.stringify(state.diagnostics[section] || {}));


					if (section == 'explain' && result.diagnostics && result.diagnostics.explain) {
						result.diagnostics.explain.input = {
							family:    params[2] || '',
							src_ip:    params[3] || '',
							dest_ip:   params[4] || '',
							proto:     params[5] || '',
							src_port:  params[6] || '',
							dest_port: params[7] || '',
							src_iface: params[8] || '',
							ipset:     params[9] || '',
							strategy:  params[10] || ''
						};
					}

					return Promise.resolve(result);
					}

					return Promise.resolve({});
				};
			}
		};

		const ui = {
			addNotification: function(_, node) { document.body.appendChild(node); },
			hideModal: function() {
				document.querySelectorAll('.modal').forEach(function(node) { node.remove(); });
			},
			showModal: function(title, nodes, cls) {
				this.hideModal();
				document.body.appendChild(E('div', { class: 'modal ' + (cls || '') }, [ E('h2', [ title ]), nodes ]));
			}
		};

		const view = {
			extend: function(definition) { return definition; }
		};

		const baseclass = {
			extend: function(definition) { return definition; }
		};

		const common = new Function('baseclass', 'L', 'E', '_', args.commonSource)(baseclass, L, E, translate);
		const explainModule = new Function('baseclass', '_', args.explainModuleSource)(baseclass, translate);
		const guideModule = new Function('baseclass', 'ui', 'mwan4Common', 'mwan4Explain', 'L', 'E', '_', args.guideModuleSource)(baseclass, ui, common, explainModule, L, E, translate);
		const diagnosticsModule = new Function('baseclass', 'mwan4Common', 'L', 'E', '_', args.diagnosticsModuleSource)(baseclass, common, L, E, translate);
		const connectionsModule = new Function('baseclass', 'rpc', 'mwan4Common', 'L', 'E', '_', args.connectionsModuleSource)(baseclass, rpc, common, L, E, translate);
		const module = new Function('rpc', 'ui', 'view', 'mwan4Common', 'mwan4Connections', 'mwan4Diagnostics', 'mwan4Guide', 'L', 'E', '_', args.diagnosticsSource)(
			rpc, ui, view, common, connectionsModule, diagnosticsModule, guideModule, L, E, translate);
		const root = document.getElementById('test-root');

		root.replaceChildren(module.render([
			state.diagnosticsAccess,
			state.operatorAccess,
			state.diagnostics.summary,
			state.connections ? state.connections.items.length : null,
			state.configAccess
		]));

		window.__mwan4Mock = {
			rpcCalls: state.rpcCalls
		};
	}, {
		diagnosticsSource: fs.readFileSync(diagnosticsPath, 'utf8'),
		diagnosticsModuleSource: fs.readFileSync(diagnosticsModulePath, 'utf8'),
		connectionsModuleSource: fs.readFileSync(connectionsModulePath, 'utf8'),
		explainModuleSource: fs.readFileSync(explainModulePath, 'utf8'),
		guideModuleSource: fs.readFileSync(guideModulePath, 'utf8'),
		connections: options.connections === undefined ? defaultConnections() : options.connections,
		commonSource: fs.readFileSync(commonPath, 'utf8'),
		diagnostics: options.diagnostics || defaultDiagnostics(),
		configAccess: options.configAccess == null ? true : options.configAccess,
		diagnosticsAccess: options.diagnosticsAccess == null ? true : options.diagnosticsAccess,
		operatorAccess: options.operatorAccess == null ? true : options.operatorAccess
	});
}

async function renderStatus(page, options) {
	options = options || {};

	await page.setContent('<!doctype html><html><head></head><body><main id="test-root"></main></body></html>');
	await page.evaluate(function(args) {
		const state = {
			status: args.status,
			configAccess: !!args.configAccess,
			diagnosticsAccess: !!args.diagnosticsAccess,
			rpcCalls: []
		};

		if (!String.prototype.format) {
			String.prototype.format = function() {
				let values = arguments;
				let index = 0;

				return String(this).replace(/%%|%[sd]/g, function(token) {
					if (token == '%%')
						return '%';

					return String(values[index++]);
				});
			};
		}

		function translate(text) {
			return text;
		}

		function appendChild(node, child) {
			if (child == null || child === false)
				return;

			if (Array.isArray(child)) {
				// real LuCI dom.append stringifies null/undefined/false array items
				child.forEach(function(item) { item == null || item === false ? node.appendChild(document.createTextNode(String(item))) : appendChild(node, item); });
				return;
			}

			if (child instanceof Node) {
				node.appendChild(child);
				return;
			}

			node.appendChild(document.createTextNode(String(child)));
		}

		function E(tag, attrs, children) {
			if (attrs == null || attrs instanceof Node || Array.isArray(attrs) || typeof attrs != 'object') {
				children = attrs;
				attrs = {};
			}

			let node = document.createElement(tag);

			Object.keys(attrs || {}).forEach(function(key) {
				let value = attrs[key];
				if (value == null || value === false)
					return;

				if (typeof value == 'function') {
					node.addEventListener(key, value);
					return;
				}

				if (key == 'class') {
					node.className = value;
					return;
				}

				node.setAttribute(key, value === true ? key : String(value));
			});

			appendChild(node, children);
			return node;
		}

		const L = {
			resource: function(resourcePath) { return '/luci-static/resources/' + resourcePath; },
			resolveDefault: function(value, fallback) {
				return Promise.resolve(value).catch(function() { return fallback; });
			},
			url: function() { return '/cgi-bin/luci/' + Array.from(arguments).join('/'); }
		};

		const rpc = {
			declare: function(spec) {
				return function() {
					let params = Array.from(arguments);
					state.rpcCalls.push({ object: spec.object, method: spec.method, params: params });

					if (spec.object == 'mwan4' && spec.method == 'status')
						return Promise.resolve(state.status);

					if (spec.object == 'session' && spec.method == 'access') {
						let acl = params[1];
						if (acl == 'luci-app-mwan4')
							return Promise.resolve(state.configAccess);
						if (acl == 'luci-app-mwan4-diagnostics')
							return Promise.resolve(state.diagnosticsAccess);
					}

					return Promise.resolve(false);
				};
			}
		};

		const view = {
			extend: function(definition) { return definition; }
		};

		const baseclass = {
			extend: function(definition) { return definition; }
		};

		const common = new Function('baseclass', 'L', 'E', '_', args.commonSource)(baseclass, L, E, translate);
		const ui = {
			hideModal: function() { document.querySelectorAll('.modal').forEach(function(node) { node.remove(); }); },
			showModal: function(title, nodes, cls) {
				this.hideModal();
				document.body.appendChild(E('div', { class: 'modal ' + (cls || '') }, [ E('h2', [ title ]), nodes ]));
			}
		};
		const explainModule = new Function('baseclass', '_', args.explainModuleSource)(baseclass, translate);
		const guideModule = new Function('baseclass', 'ui', 'mwan4Common', 'mwan4Explain', 'L', 'E', '_', args.guideModuleSource)(baseclass, ui, common, explainModule, L, E, translate);
		const module = new Function('rpc', 'view', 'mwan4Common', 'mwan4Guide', 'L', 'E', '_', args.statusSource)(rpc, view, common, guideModule, L, E, translate);
		const root = document.getElementById('test-root');

		root.replaceChildren(module.render([
			state.status,
			state.configAccess,
			state.diagnosticsAccess
		]));

		window.__mwan4Mock = {
			rpcCalls: state.rpcCalls
		};
	}, {
		statusSource: fs.readFileSync(statusPath, 'utf8'),
		explainModuleSource: fs.readFileSync(explainModulePath, 'utf8'),
		guideModuleSource: fs.readFileSync(guideModulePath, 'utf8'),
		commonSource: fs.readFileSync(commonPath, 'utf8'),
		status: options.status || defaultStatus(),
		configAccess: options.configAccess,
		diagnosticsAccess: options.diagnosticsAccess
	});
}

module.exports = {
	defaultConnections,
	defaultLinkHistory,
	defaultCounters,
	defaultDiagnostics,
	defaultHostHints,
	defaultPbrPreview,
	defaultStatus,
	defaultUci,
	renderDiagnostics,
	renderOverview,
	renderStatus,
	stableStatus,
	withSiblingPair
};
