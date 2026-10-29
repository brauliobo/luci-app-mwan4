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

7. **No hidden state.** Disclosure stays visible (no expanders); advanced fields are grouped under their own heading and describe themselves.

## Baseline findings (before this work)

Observed on the live overview and modals:
- Rules show three rows of technical chips and `tim_first (ordered failover), fails closed`; six chips per rule for three links.
- No indication of the link a rule uses *now*.
- No way to test a destination, and no warning for shadowed or ineffective rules.
- WAN table: IPv4 and IPv6 of one link are separate rows; "score", "reliability", "down 3 / up 3" unexplained; target addresses overlap the status column.
- Command center: "7 modes", "27 paths", duplicated *Open Diagnostics* buttons, *Stop* beside *Refresh* without confirmation.
- Rule editor: the name is required before anything else; *Enabled* sits inside "Extra match and logging"; expert fields (nft set, sticky) are as prominent as the site field; no live summary.
- Health tuning shows five numeric fields with no guidance.
- The overview is 5,500 px tall; the main task (rules) is below three panels.
- The raw tabs use older vocabulary (strategy, member, track_ip).
