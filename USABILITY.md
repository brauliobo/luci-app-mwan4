# Usability specification (ISO 9241-11)

ISO 9241-11 defines usability as the extent to which **specified users** can achieve **specified goals** in a **specified context of use** with **effectiveness**, **efficiency** and **satisfaction**. This file fixes those specifications so each UI change can be checked against them.

## Context of use

**Users**
- *Home or small-office owner* (primary): runs two or three uplinks plus a VPN or tunnel, knows what a domain, a device and an uplink are, does not know nftables, fwmarks or routing tables.
- *Network hobbyist or admin* (secondary): wants exact control (ports, DSCP, sets, health tuning) and reads the raw tabs.

**Environment**: LuCI in a desktop browser, usually opened because something is wrong ("why is my site not using the VPN?", "an uplink is down") or to add one rule. Sessions are short and infrequent, so nothing may rely on memory of previous visits.

**Equipment**: OpenWrt router with 2–10 WAN links and 10–60 rules; the page polls every few seconds.

## Goals (the tasks every release must keep easy)

| # | Task | Success means |
|---|------|---------------|
| T1 | Send a site or service through a chosen WAN link | Rule exists, matches the site and its subdomains, uses the chosen link |
| T2 | Keep a device on a chosen WAN link, or off one | Rule matches that device only |
| T3 | Send traffic through a VPN or tunnel and never leak it | Rule uses a path that stops when the tunnel is down |
| T4 | Find out where some traffic goes right now, and why | The matching rule, the link in use and the reason are shown |
| T5 | Understand why a rule does not work | Shadowing, down links, fail-closed effects and missing DNS control are named |
| T6 | Add or repair a WAN link | Link added with sensible health checks, state visible at once |
| T7 | Make failover calmer or more sensitive | One choice, no numbers needed |
| T8 | Review and reorder all rules | Every rule reads as a sentence, order is visible, filtering works |

## Measures

**Effectiveness**: share of tasks completed correctly without leaving the page. Target: T1–T8 completed by a first-time owner; no rule can be saved that matches nothing or everything unknowingly; every validation message names the field and the fix.

**Efficiency** (interaction counts, enforced by `tests/e2e/mwan4-usability.mock.spec.js`):
- T1 from the overview to a saved rule: at most 3 clicks and 2 typed fields (site, link) using a template.
- T2: at most 4 clicks and 1 typed field using a template and the device picker.
- T4: at most 1 click and 1 typed field from the overview.
- T7: 1 choice.
- Reading a rule needs no jargon lookup: each row has one plain sentence.

**Satisfaction** (cannot be measured by tests; use after a release):
- Ask users to run T1, T4 and T6, then fill in the 10 SUS items (System Usability Scale). Target mean score ≥ 80.
- Record free-text "what confused you".

## Principles applied

1. **Say it in a sentence.** Every rule, path and health setting has a plain-language description generated from its real configuration (`mwan4/explain.js`), used in lists, previews and the editor. The editor shows the sentence live while the user types.
2. **Show the consequence, not the mechanism.** "Stops if Tim is down" replaces "fails closed"; "Tim, then Str" replaces six chips; IPv4/IPv6 siblings of one link read as one link.
3. **Answer "where does this go?"** A route tester (`mwan4/routetest.js`) evaluates the saved rules in order against a destination, device, protocol and port with live link health.
4. **Prevent errors before saving.** Inline field messages, rule checks (shadowed, duplicate, down or missing link, no DNS control for domain rules) and a confirmation before destructive service actions.
5. **Start from the common case.** Templates for the frequent rules and health profiles (Sensitive, Balanced, Tolerant) replace blank forms and raw numbers; the raw fields stay visible for experts.
6. **One vocabulary** across overview, modals, raw tabs and help text:

| Use | Do not use | Meaning |
|-----|------------|---------|
| WAN link | interface, member, uplink | One internet connection (IPv4/IPv6 siblings shown together) |
| Routing rule | policy, traffic exception | Decides where matching traffic goes |
| Path | strategy, mode, route set | The ordered WAN links a rule uses |
| Use first / Use only / Balance | prefer / only / balanced | Path types: fall back, never fall back, share load |
| Stops if unavailable | fails closed | Traffic is dropped instead of leaking to another link |
| Uses normal routing if unavailable | falls back to main | Traffic then follows the router's default route |
| Health check | probe, track, SLA | How a link is tested |
| Check targets | track_ip | Addresses pinged to test a link |
| Hold | damping, held | Link kept out of use until it stays healthy |
| Link priority | route, member | One WAN link with an order and a weight inside a path (tab **Link priorities**) |
| Terms | | The glossary behind the **Terms** button (`mwan4Explain.glossary()`) |

7. **No hidden state.** Disclosure stays visible (no expanders); advanced fields are grouped under their own heading and describe themselves.

## Status

Every task has an owner in the UI. Interaction budgets are enforced by `tests/e2e/mwan4-usability.mock.spec.js`; the other rows are covered by the named tests.

| # | Where it is implemented | Enforced by |
|---|-------------------------|-------------|
| T1 | Overview, **Add routing rule** > template *Send a site through one link* (`mwan4/templates.js`, `mwan4/rulesui.js`); the saved rule reads as a sentence (`mwan4Explain.ruleSentence`) | `T1: a site through a chosen link takes at most 3 clicks and 2 fields before the preview` |
| T2 | Template *Make a device use a link* with the device picker (hostnames from `luci-rpc getHostHints`) | `T2: a device on a chosen link takes at most 4 clicks and 1 typed field using the device picker` |
| T3 | Templates *Keep a site on one link only (never leak)* and *Keep a device on a VPN or tunnel*; the path sentence says "stops if %s is unavailable" (`mwan4Explain.pathSummary`) | `tests/templates.test.js`, `tests/explain.test.js`, mock spec `Only preset creates a fail-closed strategy and reuses it for the next rule` |
| T4 | Overview command center footer **Test traffic** (`mwan4/routetest.js`): destination, device, protocol, port against the saved rules with live link health; **Connections** modal for live flows | `T4: where a typed domain goes takes 1 click and 1 field from the overview`, `tests/routetest.test.js` |
| T5 | Rule checks (`mwan4/rulecheck.js`): shadowed, duplicate, down or missing link, no DNS control; badge and **Needs attention** filter on the rules list | `tests/rulecheck.test.js`, mock spec `marks rules that cannot work with a badge and filters them as needing attention` |
| T6 | **Add WAN link** dialog (`mwan4/wanform.js`): free interfaces first, address family from the interface, health profile, state visible in the WAN links table | `T6: a new link saved up to the preview takes at most 4 clicks and 1 typed field`, `tests/wanform.test.js` |
| T7 | Health profiles *Sensitive*, *Balanced*, *Tolerant* in the WAN link dialog (`mwan4/templates.js`), also setting the hold times; Fine tuning keeps the numbers visible | `T7: calmer or more sensitive failover takes at most 3 clicks and no typing`, `T7 with stability settings: the profile also sets the hold times` |
| T8 | Overview **Routing rules**: one sentence per rule, drag or move buttons, locked default rows, search and filters | mock spec `lists rules in priority order ...`, `reorders rules with the move buttons and by dragging ...`, `searches and filters the rules ...` |

Vocabulary and discoverability (principles 6 and 7):
- The raw tabs (**WAN Links**, **Link priorities**, **Paths**, **Routing rules**, **Global settings**, **Advanced**, **MPTCP**, **Diagnostics**) open with a purpose line, a button back to the overview for the common task and a **Terms** button (`mwan4/guide.js`). Enforced by `tests/e2e/mwan4-rawtabs.mock.spec.js` and `tests/guide.test.js`.
- Every option of the raw tabs has a plain label, a description that says what an empty field means and a placeholder or default; retired words (strategy, member, track_ip, fails closed, probe, SLA, policy) are rejected by `tests/rawtabs.test.js` and `tests/i18n-copy.test.js`. Field texts shared by tabs live in `mwan4/fields.js` (health checks, marks, globals) and `mwan4/stability.js` (`fieldLabels()`, `fieldHelp()`), so the overview and the raw tabs cannot drift.
- Jargon that remains (Hold, Flaps, Check targets, DSCP, Sticky, Path) carries the glossary sentence as a tooltip (`mwan4Explain.termHint`).
- The runtime warning alert is plain language and does not link to the Diagnostics page it is shown on (`mwan4Common.renderRuntimeWarnings`).

## How to evaluate with users

Run this after each release that changes the overview or the raw tabs. It needs 5 or more people from the primary user group (home or small-office owners), a router with two WAN links and no pre-existing mwan4 rules, and the LuCI session already open on the overview. Do not demonstrate the page first.

1. **Brief** each person in one sentence per task and then stay quiet. Ask them to think aloud.
2. **Tasks** (about 15 minutes in total):
   - T1: "Make YouTube use the second internet connection."
   - T4: "Find out which connection `netflix.com` uses right now, and why."
   - T6: "Add the third internet connection (an interface that is not yet a WAN link) and make it calmer about short outages."
3. **Record per task**: completed correctly (yes, with help, no), time on task, clicks, typed fields, wrong turns, and any moment they open a raw tab, the **Terms** list or a tooltip. Compare clicks and typed fields with the budgets under Measures.
4. **Satisfaction**: after the tasks, each person answers the 10 SUS statements on a 1 to 5 scale. Convert odd items as (answer - 1) and even items as (5 - answer), add them up and multiply by 2.5. Target mean at or above 80.
5. **Free text**: ask "what confused you?" and write the answers down in the person's own words; map each to a row of the vocabulary table or to a missing glossary entry.
6. **Report**: completion rate per task, median time, SUS mean and range, and the list of confusing words. Feed the words back into the vocabulary table, `mwan4Explain.glossary()` and the field help.

## Baseline findings (before this work)

Observed on the live overview and modals before the redesign. They are kept as history: each one has an owner in the Status table above.

- Rules showed three rows of technical chips and `tim_first (ordered failover), fails closed`; six chips per rule for three links.
- No indication of the link a rule used *now*.
- No way to test a destination, and no warning for shadowed or ineffective rules.
- The WAN table listed IPv4 and IPv6 of one link as separate rows; "score", "reliability", "down 3 / up 3" were unexplained; target addresses overlapped the status column.
- The command center showed "7 modes" and "27 paths", duplicated *Open Diagnostics* buttons, and put *Stop* beside *Refresh* without confirmation.
- The rule editor required a name before anything else; *Enabled* sat inside "Extra match and logging"; expert fields (nft set, sticky) were as prominent as the site field; there was no live summary.
- Health tuning showed five numeric fields with no guidance.
- The overview was 5,500 px tall; the main task (rules) was below three panels.
- The raw tabs used older vocabulary (strategy, member, track_ip) and options without descriptions.
