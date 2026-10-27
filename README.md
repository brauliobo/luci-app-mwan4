# luci-app-mwan4

LuCI application for configuring and operating `mwan4`.

## Features

- Status dashboard for mwan4 interfaces, tracking targets, active strategies, and connected networks.
- Overview warning when mwan4 is configured but service instances, health trackers, or nftables chains are inactive.
- Service actions: start, stop, restart, per-interface ifup, and per-interface ifdown.
- Diagnostics for summaries, WAN links, routes, traffic policies, nftables, service state, counters, ownership, PBR, MPTCP, quality/SLA, probes/BFD, VRF, tunnels, and route-explain decisions. Raw RPC output stays hidden behind **Show raw response**.
- Overview **Routing rules** list: priority is the UCI order (reorder by drag or the move buttons; the generated default catch-alls stay last and locked), per-rule enable toggle, match chips, the strategy shown as ordered WAN chips coloured by live health, and live hit counters.
- One rule modal with three questions: **What** (domains and IP/CIDR in one box, auto-classified into `domain`/`dest_ip`, plus protocol and ports), **Who** (all devices, DHCP/ARP devices by MAC/IP into `src_mac`/`src_ip`, or an interface into `src_iface`) and **Via** (an existing strategy or a one-click "Prefer WAN, fall back to others" / "Only WAN, never leak" preset that creates the strategy). DSCP, router traffic, sticky sessions, logging, and the nft set stay visible as compact fields. Section names (15 characters max) are derived from the rule name, which is kept as `label`.
- **Import from PBR** (shown only when the backend `pbr_import` RPC reports PBR policies and the session may write `mwan4`): dry-run preview with skipped policies and warnings called out, then apply.
- **Connection counting** (needs the backend `connections` rpcd method; the UI is hidden without it): a *Connections* column on the rules list (`active / new`, tooltip with the IPv4/IPv6 split), an *Active connections* column in the WAN workspace, per-strategy chips in the routing panel, a header stat, and a *Connections* section on Diagnostics. Each count opens one shared modal (plain table with rule/WAN/strategy/family/protocol/search filters, bytes when conntrack accounting is on, auto-refresh every 3 seconds while open, truncation notice with *Show more* up to 1000 rows). The rule editor shows live counts and a *View connections* button.
- UCI forms for globals, interfaces, routes, strategies, and rules (the raw Rules tab also exposes label, enabled, domain, source MAC, DSCP, and router traffic).
- Migration helper for existing mwan4 configs that still use old `member` and `policy` section names.

## ACL Roles

- `luci-app-mwan4-status`: read-only runtime status and connection list; no UCI, control RPC, or diagnostics access.
- `luci-app-mwan4`: core configuration pages for mwan4 and network UCI, plus the `pbr_import` ubus method (write scope only, because applying it rewrites `/etc/config/mwan4`).
- `luci-app-mwan4-operator`: constrained runtime controls such as restart, ifup/ifdown, and counter reset through the backend control RPC.
- `luci-app-mwan4-diagnostics`: read-only diagnostics RPC access with no shell execution or UCI reads. The read-level `connections` method is granted to the status, config, advanced, and diagnostics roles.
- `luci-app-mwan4-advanced`: explicit advanced integration workflows for PBR, VRF, tunnels, FRR/BFD, and related UCI-backed metadata.

## Build

From the parent OpenWrt package repo:

```sh
./build-repo.sh
```

The package is staged into the OpenWrt SDK LuCI feed path and published as an APK with the rest of the local repo.

## Runtime Warning

The overview and status pages display the `mwan4` RPC diagnostics warning if mwan4 has enabled links but no active service runtime, no health trackers, or no nftables chains. The warning recommends starting or restarting mwan4 from LuCI or running `/etc/init.d/mwan4 restart`, then checking `mwan4 status` and `nft list table inet fw4`.

## Packaging Notes

- JavaScript minification is disabled for this package because the SDK `jsmin` step can leave empty `*.js.o` files in the APK when it rejects modern LuCI JavaScript syntax.
- The install-time migration converts old `member` sections to `route` and old `policy` sections to `strategy` in `/etc/config/mwan4`. Before changing the live config it writes `/etc/config/mwan4.pre-luci-app-mwan4-migration`.
- The LuCI package depends only on `mwan4` and `luci-base`; optional probe helpers are documented in the `mwan4` package notes.

## Connection Counting Fields

The UI reads these backend fields and treats missing ones as unavailable:

- `mwan4 connections {rule, interface, strategy, family, proto, search, limit, offset}` returns `{ ok, total, truncated, accounting, items[] }`; a failed call or a reply without `items` hides all connection UI.
- `status counters` (and `status`) carry `rules.<name>.{new_connections,active_connections}` as `{ipv4,ipv6,total}`.
- `status` carries `interfaces.<wan>.active_connections` and `strategy_status.<family>.<strategy>.active_connections` as numbers.
