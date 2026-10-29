# luci-app-mwan4

LuCI application for configuring and operating `mwan4`.

## Features

The UI speaks one vocabulary (see `USABILITY.md`): *WAN link*, *routing rule*, *path*, *health check*, *check targets*, *hold*. Every tab and dialog uses it, and the **Terms** button of the overview and of every raw tab lists the meanings.

- **Command center** on the overview: one status sentence ("Everything is working: all 2 WAN links are online."), the one action worth taking next, three metrics (WAN links, active rules, active connections) and a footer with the service controls (stopping asks for confirmation), **Test traffic**, **Terms**, **Global settings**, **Refresh** and, with the diagnostics ACL, **Diagnostics**. The runtime warning, when there is one, is plain language and tells what to try.
- **WAN links** table: IPv4 and IPv6 siblings of one connection are one row with an overall state, a pill per family, one plain health line ("All checks passing", "1 of 2 checks failing"), the check targets, flaps and availability when the backend reports them, and Edit, Up, Down and History for the whole link. **Add WAN link** offers only free network interfaces first and takes the IP family from the interface.
- **Health profiles** in the WAN link dialog: *Sensitive*, *Balanced* and *Tolerant* fill the numbers (check interval, failed checks before down, good checks before up, targets that must answer, and the hold times) and show a live sentence of what they mean. Editing a number switches to *Custom*; the numbers stay visible under **Fine tuning**.
- **Routing rules** list: every rule reads as a sentence ("Sends youtube.com from all devices through Backup first, then Primary"), shows the link used now, live hit and connection counts, a badge when it cannot work (shadowed, duplicate, link down or missing, no DNS control) and a **Needs attention** filter. Order is the UCI order: reorder by drag or move buttons; the generated default catch-alls stay last and locked. Search and filters keep their state across polls.
- **Templates and the rule editor**: **Add routing rule** starts from a template (send a site through a link, keep a site on one link only, make a device use a link, keep a device on a VPN, block a site, speed up a game or call, or a custom rule) that asks only for the one or two things it needs, with a live sentence. **Show all options** opens the full editor (what, who, which WAN links, then the advanced options grouped under Extra matching and Behaviour). Names and addresses in one rule are saved as two rules because the backend needs both to match. Section names (15 characters max) are derived from the rule name, which is kept as `label`.
- **Change default routing** is one dialog ("use one link first" or "share load", with the main link and a live sentence); quality limits of the default path sit on the *Everything else* rows.
- **Test traffic**: type a destination, optionally a device, protocol and port, and see the matching rule, the link it takes now and why, checked rule by rule in order. The rule editor has the same tester for the rule being edited.
- **Import from PBR** (shown only when the backend `pbr_import` RPC reports PBR policies and the session may write `mwan4`): dry-run preview with skipped policies and warnings called out, then apply.
- **Connection counting** (needs the backend `connections` rpcd method; the UI is hidden without it): a *Connections* column on the rules list (`active / new`, tooltip with the IPv4/IPv6 split), an *Active connections* column in the WAN links table, a metric in the command center, and a *Connections* section on Diagnostics. Each count opens one shared modal (plain table with rule/WAN link/path/family/protocol/search filters, bytes when conntrack accounting is on, auto-refresh every 3 seconds while open, truncation notice with *Show more* up to 1000 rows).
- **Unstable WAN handling** (needs the backend `link_history` rpcd method or the new per-interface status fields; the UI is hidden without them): the state chip shows `held: flapping|recovering` with a live countdown and `degraded (N)` for the paths that currently skip a WAN, the table gains *Flaps* and *Availability* columns that always state the span they cover, and *History* opens a **Link history** modal (inline SVG strip of the last 24 hours plus the transition list). The WAN editor has a stability section that shows the effective global default as placeholder, **Global settings** edits those defaults, and each path gets a *Quality* modal for `max_latency` / `max_loss`. A WAN with a single check target shows an inline warning.
- **Raw tabs** for experts: **WAN Links**, **Link priorities** (UCI `route`), **Paths** (UCI `strategy`), **Routing rules**, **Global settings**, **Advanced** and **MPTCP**. Each opens with a purpose line, a button back to the overview for the common task and **Terms**. Every option has a plain label, a description that says what an empty field means and a placeholder or default; the stability options use the same names and help as the overview (`mwan4/stability.js`). The `Advanced` tab keeps tunnel metadata, extra health check tools, explicit marks and tables, and the PBR, MPTCP, VRF and FRR/BFD workflows.
- Status dashboard under *Status > MultiWAN 4* for read-only sessions, with the same plain runtime warning.
- Diagnostics for summaries, WAN links, routes, routing rules, nftables, service state, counters, ownership, PBR, MPTCP, quality, health check tools, VRF, tunnels, and route-explain decisions. Raw RPC output stays hidden behind **Show raw response**.
- Migration helper for existing mwan4 configs that still use old `member` and `policy` section names.

## Tests

- `for t in tests/*.test.js; do node $t; done` runs the unit tests (explain, rules, templates, wanform, rulecheck, routetest, summary, stability, connections, guide, raw tabs, ACL contract, i18n and POT).
- `tests/e2e/*.mock.spec.js` run in Playwright against a mocked LuCI and rpcd (`tests/e2e/helpers/`), including the interaction budgets of `USABILITY.md` and a small test per raw tab. `tests/e2e/mwan4-overview.spec.js` targets a real router and is not part of the mocked run.

## ACL Roles

- `luci-app-mwan4-status`: read-only runtime status, connection list, and link history; no UCI, control RPC, or diagnostics access.
- `luci-app-mwan4`: core configuration pages for mwan4 and network UCI, plus the `pbr_import` ubus method (write scope only, because applying it rewrites `/etc/config/mwan4`).
- `luci-app-mwan4-operator`: constrained runtime controls such as restart, ifup/ifdown, and counter reset through the backend control RPC.
- `luci-app-mwan4-diagnostics`: read-only diagnostics RPC access with no shell execution or UCI reads. The read-level `connections` method is granted to the status, config, advanced, and diagnostics roles; the read-level `link_history` method to the status, config, and advanced roles.
- `luci-app-mwan4-advanced`: explicit advanced integration workflows for PBR, VRF, tunnels, FRR/BFD, and related UCI-backed metadata.

## Build

From the parent OpenWrt package repo:

```sh
./build-repo.sh
```

The package is staged into the OpenWrt SDK LuCI feed path and published as an APK with the rest of the local repo.

## Runtime Warning

The overview, status and Diagnostics pages display the `mwan4` RPC diagnostics warning if mwan4 has enabled links but no active service runtime, no health trackers, or no nftables chains. The warning says in plain words that MultiWAN 4 is not fully running and suggests restarting it, then opening Diagnostics (a link shown everywhere except on the Diagnostics page itself and for sessions without the diagnostics ACL).

## Packaging Notes

- JavaScript minification is disabled for this package because the SDK `jsmin` step can leave empty `*.js.o` files in the APK when it rejects modern LuCI JavaScript syntax.
- The install-time migration converts old `member` sections to `route` and old `policy` sections to `strategy` in `/etc/config/mwan4`. Before changing the live config it writes `/etc/config/mwan4.pre-luci-app-mwan4-migration`.
- The LuCI package depends only on `mwan4` and `luci-base`; optional probe helpers are documented in the `mwan4` package notes.

## Connection Counting Fields

The UI reads these backend fields and treats missing ones as unavailable:

- `mwan4 connections {rule, interface, strategy, family, proto, search, limit, offset}` returns `{ ok, total, truncated, accounting, items[] }`; a failed call or a reply without `items` hides all connection UI.
- `status counters` (and `status`) carry `rules.<name>.{new_connections,active_connections}` as `{ipv4,ipv6,total}`.
- `status` carries `interfaces.<wan>.active_connections` and `strategy_status.<family>.<strategy>.active_connections` as numbers.

## Unstable WAN Fields

All of these are read in `htdocs/luci-static/resources/mwan4/stability.js`, so a backend shape change is a one-file edit. Missing fields are treated as unavailable (the matrix shows `-`), never as zero.

- `mwan4 link_history {interface, since, limit}` returns `{ ok, interfaces: { <wan>: { events: [{ time, state, reason }], flaps, availability, held } } }`. A failed call or a reply without `interfaces` hides the History button. The modal asks for one interface with limit 200 and draws the last 24 hours itself.
- `status.interfaces.<wan>.held` is `{ active, reason (flapping|recovering), until, remaining }`; the countdown counts down from `remaining` on the browser clock, so router/browser clock skew does not matter.
- `status.interfaces.<wan>.flaps` is `{ count_window, total }`, `.availability` is `{ pct_1h, pct_24h }`, `.degraded_for` is a list of path (strategy) names.
- The stability UI is shown when `link_history` answers or any status interface carries `held`, `flaps`, or `availability`; the History button needs `link_history`.
- UCI options: `flap_damping`, `flap_threshold`, `flap_window`, `flap_holddown`, `recovery_hold`, `flush_grace` on `globals` (defaults) and `interface` (override, empty inherits), `max_latency` and `max_loss` on `strategy` (shown as *Paths*).
