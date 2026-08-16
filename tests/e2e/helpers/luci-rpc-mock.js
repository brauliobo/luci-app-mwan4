const fs = require('fs');
const path = require('path');

const overviewPath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/view/mwan4/network/overview.js');
const commonPath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/common.js');
const overviewModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/overview.js');
const diagnosticsModulePath = path.resolve(__dirname, '../../../htdocs/luci-static/resources/mwan4/diagnostics.js');
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
			{ '.type': 'route', '.name': 'route_wan_primary', interface: 'wan_primary' },
			{ '.type': 'strategy', '.name': 'failover', route: [ 'route_wan_primary' ] },
			{ '.type': 'rule', '.name': 'default_rule_v4', '.index': 0, family: [ 'ipv4' ], dest_ip: '0.0.0.0/0', use_strategy: 'failover' },
			{ '.type': 'rule', '.name': 'default_rule_v6', '.index': 1, family: [ 'ipv6' ], dest_ip: '::/0', use_strategy: 'failover' },
			{ '.type': 'globals', '.name': 'globals', mmx_mask: '0x3F00', source_routing: '0', loglevel: 'notice' }
		],
		network: [
			{ '.type': 'interface', '.name': 'wan_primary', proto: 'dhcp' },
			{ '.type': 'interface', '.name': 'wan_backup', proto: 'dhcp' }
		]
	};
}

function defaultStatus() {
	return {
		interfaces: {
			wan_primary: {
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
		diagnostics: {
			warnings: []
		}
	};
}

function defaultCounters() {
	return {
		counters: {
			mwan4_counter_rule_default_rule_v4: { packets: 4, bytes: 512 },
			mwan4_counter_strategy_failover: { packets: 4, bytes: 512 },
			mwan4_counter_iface_wan_primary: { packets: 4, bytes: 512 }
		}
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
				child.forEach(function(item) { appendChild(node, item); });
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

				if (key == 'click') {
					node.addEventListener('click', value);
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
			}
		};

		const rpc = {
			declare: function(spec) {
				return function() {
					let params = Array.from(arguments);
					state.rpcCalls.push({ object: spec.object, method: spec.method, params: params });

					if (spec.object == 'mwan4' && spec.method == 'status')
						return Promise.resolve(params[0] == 'counters' ? state.counters : state.status);
					if (spec.object == 'session' && spec.method == 'access') {
						let acl = params[1];
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
		const module = new Function('fs', 'poll', 'rpc', 'uci', 'ui', 'view', 'mwan4Common', 'mwan4Overview', 'L', 'E', '_', args.overviewSource)(fs, poll, rpc, uci, ui, view, common, overviewModule, L, E, translate);
		const root = document.getElementById('test-root');

		root.replaceChildren(module.render([
			null,
			null,
			state.status,
			state.operatorAccess,
			state.advancedAccess,
			state.diagnosticsAccess,
			state.counters,
			{ type: 'file' },
			{ type: 'file' },
			{ type: 'file' },
			{ type: 'file' },
			{ type: 'file' }
		]));

		window.__mwan4Mock = {
			getUci: function() { return state.uci; },
			rpcCalls: state.rpcCalls,
			runPoll: function() {
				return Promise.all(state.polls.map(function(fn) { return fn(); }));
			},
			setCounters: function(counters) { state.counters = counters; },
			setStatus: function(status) { state.status = status; },
			setUci: function(uciData) { state.uci = uciData; }
		};
	}, {
		overviewSource: fs.readFileSync(overviewPath, 'utf8'),
		overviewModuleSource: fs.readFileSync(overviewModulePath, 'utf8'),
		commonSource: fs.readFileSync(commonPath, 'utf8'),
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
				child.forEach(function(item) { appendChild(node, item); });
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

				if (key == 'click') {
					node.addEventListener('click', value);
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

		const rpc = {
			declare: function(spec) {
				return function() {
					let params = Array.from(arguments);
					state.rpcCalls.push({ object: spec.object, method: spec.method, params: params });

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
			addNotification: function(_, node) { document.body.appendChild(node); }
		};

		const view = {
			extend: function(definition) { return definition; }
		};

		const baseclass = {
			extend: function(definition) { return definition; }
		};

		const common = new Function('baseclass', 'L', 'E', '_', args.commonSource)(baseclass, L, E, translate);
		const diagnosticsModule = new Function('baseclass', 'mwan4Common', 'L', 'E', '_', args.diagnosticsModuleSource)(baseclass, common, L, E, translate);
		const module = new Function('rpc', 'ui', 'view', 'mwan4Common', 'mwan4Diagnostics', 'L', 'E', '_', args.diagnosticsSource)(rpc, ui, view, common, diagnosticsModule, L, E, translate);
		const root = document.getElementById('test-root');

		root.replaceChildren(module.render([
			state.diagnosticsAccess,
			state.operatorAccess,
			state.diagnostics.summary
		]));

		window.__mwan4Mock = {
			rpcCalls: state.rpcCalls
		};
	}, {
		diagnosticsSource: fs.readFileSync(diagnosticsPath, 'utf8'),
		diagnosticsModuleSource: fs.readFileSync(diagnosticsModulePath, 'utf8'),
		commonSource: fs.readFileSync(commonPath, 'utf8'),
		diagnostics: options.diagnostics || defaultDiagnostics(),
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
				child.forEach(function(item) { appendChild(node, item); });
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
		const module = new Function('rpc', 'view', 'mwan4Common', 'L', 'E', '_', args.statusSource)(rpc, view, common, L, E, translate);
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
		commonSource: fs.readFileSync(commonPath, 'utf8'),
		status: options.status || defaultStatus(),
		configAccess: options.configAccess,
		diagnosticsAccess: options.diagnosticsAccess
	});
}

module.exports = {
	defaultCounters,
	defaultDiagnostics,
	defaultStatus,
	defaultUci,
	renderDiagnostics,
	renderOverview,
	renderStatus
};
