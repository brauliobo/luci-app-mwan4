# MultiWAN 4 UI Roadmap

This backlog tracks UX, status-contract, and advanced-networking issues discovered while reviewing the overview UI and router runtime behavior.

## Completed In Current Redesign

- Merged the old `Live health` and `WAN links and SLA` areas into the `WAN workspace` on the overview.
- The WAN workspace now uses a compact matrix/table because WAN links are homogeneous and need side-by-side comparison. Avoid card layouts for the main WAN status surface.
- Missing health scores render as `Not measured`, and missing target latency/loss stay explicit instead of becoming fake `0%` values.
- Overview polling refreshes both the command center and merged WAN workspace, including the counter strip.
- Raw editor pages now live as LuCI navigation tabs instead of a collapsible advanced-link block on the overview.
- The Diagnostics page exposes `ownership`, `pbr`, and `mptcp` RPC buttons; the overview links only to Diagnostics, not to individual advanced diagnostic cards.
- Removed `details`/`summary` expanders from overview controls, diagnostics output, and modal sections.
- Added deterministic mocked Playwright coverage for the merged WAN workspace, missing metrics, advanced shortcuts staying out of the matrix, empty first-run state, and poll refresh behavior.
- Added first-class advanced Diagnostics surfaces for `mptcp`, `quality`, `probes`, `vrf`, `explain`, `counters`, `pbr`, and `tunnels`, plus a dedicated `MPTCP` LuCI tab backed by the diagnostics ACL.
- Kept PBR harmony and MPTCP workflow entry points out of the WAN workspace so the matrix remains focused on WAN health, SLA, and counters.

## Immediate UI Fixes

- Build a normalized WAN view model before rendering. Merge UCI interface sections, `mwan4.status().interfaces`, runtime targets, SLA config, helper availability, and available actions in one place.
- Fix metric/template spacing where label, value, and body run together in counter cards. Do not reuse command-center metric markup in contexts where CSS does not guarantee separation.
- Remove or reintegrate orphaned overview render helpers such as `renderSummary()` and unused global-settings presentation.
- Expand target metric placeholders beyond the current explicit `-` display into semantic states: unmeasured, unavailable, skipped, healthy, degraded, failed.

## Health And SLA Contract

- Stop deriving health percentage as `score * 10`; tracker max score is `down + up`, not always 10.
- Add backend fields for `score_current`, `score_max`, `score_percent`, `failed_checks`, `health_state`, and `last_update_age`.
- Return `null` for unmeasured latency and packet loss instead of mapping missing status files to `0`.
- Rename or augment `lost`; it is a failed-target/check counter, not packet-loss percent.
- Surface `track_method`, `quality_enabled`, `quality_supported`, `reliability`, `down`, `up`, failure thresholds, and recovery thresholds in status.
- Do not allow SLA quality mode for methods that cannot report latency/loss, or report a backend warning and ignore quality mode for those methods.
- Clear or mark stale target latency/loss when a target is skipped.
- Add explicit degraded/partial states for partial target failure, SLA gray-zone hysteresis, and dual-stack partial failure.

## WAN Links Redesign

- Keep each WAN matrix row scannable: name, enabled state, family chips, netifd/tracker state, score percent, targets, thresholds, and edit/up/down actions.
- Group IPv4 and IPv6 under the same WAN link when they are the same uplink, but keep family status separate.
- Show health targets as rows with columns for target, state, latency, packet loss, and threshold result.
- Show SLA config inline: method, required healthy targets, interval, timeout, down/up hysteresis, failure thresholds, and recovery thresholds.
- Add helper-missing warnings beside affected methods, not only in diagnostics.
- Let quick setup select IPv4, IPv6, or both; advanced page already supports multiple families.

## Advanced Tools Integration

- Replace the collapsed raw-editor link strip with contextual tools inside each section.
- Keep raw WAN sections, route tables, strategies, rules, globals, and diagnostics in LuCI tabs; do not reintroduce overview deep-link clusters.
- Routing mode should include effective path inspection: active, standby, offline, fallback, and why each path is selected or skipped.
- Traffic exceptions should include a route-decision simulator for source, destination, protocol, port, and family.
- Diagnostics should remain available, but the overview should summarize the same data with actionable fixes.
- Add copyable diagnostic commands only where they explain an observed issue.
- Add preset preview diffs before changing generated routes, strategies, or default rules.

## Effective Routing And Strategies

- Make strategy status first-class in the backend instead of parsing nft comments only.
- Report strategy family, selected routes, standby routes, offline routes, percent, metric, weight, last resort, fallback state, and missing-chain state.
- Show per-family effective routing in the overview: IPv4 selected WAN, IPv6 selected WAN, standby order, and fallback behavior.
- Expose rule counters and strategy counters as one backend summary so the UI does not duplicate counter summarization.
- Fix fallback visibility. Current structured strategy status omits all-offline fallback and last-resort entries.

## Advanced Networking Gaps

- Add MPTCP diagnostics: `ip mptcp endpoint show`, `ip mptcp limits show`, relevant sysctls, and per-WAN endpoint role.
- Add MPTCP UI concepts: disabled, signal endpoint, subflow endpoint, backup endpoint, and warnings when source/route alignment is unsafe.
- Add WireGuard/tunnel workflow beyond metadata. Show endpoint route, underlay strategy, recursion prevention, endpoint reachability, and data-plane reachability.
- Expand backend payloads for the new advanced LuCI surfaces so structured rows are populated consistently instead of relying on flexible diagnostic fallbacks.
- Generate or validate tunnel endpoint exemptions/host routes so endpoint traffic does not recurse into the tunnel.
- Add PBR overlap diagnostics for marks, masks, rule priorities, table IDs, and running `pbr` service state.
- Fix table ownership safety: teardown must flush only mwan4-owned tables, not every table ID below `iface_max`.
- Align ICMPv6 naming. UI uses `icmpv6`; backend accepts `ipv6-icmp`.
- Clarify source routing. Current UI copy suggests source-based rules, while backend mainly preserves source-specific route lines.
- Detect ECMP/multipath default routes and either support nexthop decomposition or warn clearly.

## Implementation Order

- Phase 1: Fix spacing/template rendering, health value semantics, ICMPv6 naming, and stale polling.
- Phase 2: Introduce normalized WAN view model and merge Live health with WAN links/SLA.
- Phase 3: Expand backend status contract for explicit health, SLA, per-family state, counters, and strategy selection.
- Phase 4: Redesign overview around WAN workspace, effective routing, traffic policy simulator, and contextual diagnostics.
- Phase 5: Add advanced MPTCP, tunnel, PBR collision, ECMP, and source-routing tooling.
