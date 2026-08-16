# luci-app-mwan4

LuCI application for configuring and operating `mwan4`.

## Features

- Status dashboard for mwan4 interfaces, tracking targets, active strategies, and connected networks.
- Overview warning when mwan4 is configured but service instances, health trackers, or nftables chains are inactive.
- Service actions: start, stop, restart, per-interface ifup, and per-interface ifdown.
- Diagnostics for summaries, WAN links, routes, traffic policies, nftables, service state, counters, ownership, PBR, MPTCP, quality/SLA, probes/BFD, VRF, tunnels, and route-explain decisions. Raw RPC output stays hidden behind **Show raw response**.
- UCI forms for globals, interfaces, routes, strategies, and rules.
- Migration helper for existing mwan4 configs that still use old `member` and `policy` section names.

## ACL Roles

- `luci-app-mwan4-status`: read-only runtime status; no UCI, control RPC, or diagnostics access.
- `luci-app-mwan4`: core configuration pages for mwan4 and network UCI.
- `luci-app-mwan4-operator`: constrained runtime controls such as restart, ifup/ifdown, and counter reset through the backend control RPC.
- `luci-app-mwan4-diagnostics`: read-only diagnostics RPC access with no shell execution or UCI reads.
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
