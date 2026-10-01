# Guardian UAC qualification — 2026-10-01

Exact source `5b585ae301cdc273f58d01963e54b5b6f539181d`, PR [#1087](https://github.com/PatrickFrome/Compute/pull/1087), version `0.7.0-dev.36832190273.1`. This checkpoint seals the CI-qualified development candidate; it does not promote production or claim installation on the user's machine. The qualified source branch is unchanged by this evidence commit.

## Changes and critical findings

The installed product now has fixed-byte elevated machine bootstrap, protected packaged binding, explicit SYSTEM / Runtime activation, native service readback and ticket-bound device owner enrollment. The continuation corrected stale reserved identity and API-name assertions while retaining exact equality and the API invocation ban. OS launch acknowledgement is bounded to 60 seconds; lost/throw/deadline replies remain AMBIGUOUS, opaque failure replies HOLD, and neither proves effect absence or starts an automatic retry. Concurrent activation requests share one launch. Research: [Electron shell API](https://www.electronjs.org/docs/latest/api/shell).

## Exact bytes and physical proof

The [immutable producer artifact](https://github.com/PatrickFrome/Compute/actions/runs/36891107338/artifacts/11176359667) contains installer, blockmap/config/provenance and the matching Guardian companion.

Installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36832190273.1-x64.exe`, **159808228 bytes**.

SHA-256: `963accf466c3a07c06b649d30458f04df9fcdb8ef8421800cac48b6910362391`.

Bootstrap: `METAENGINE-Guardian-Bootstrap-0.7.0-dev.36832190273.1-x64.exe`, 1283584 bytes, SHA-256 `5bfee389606413e8ede074687026bcb3a21346425ffe1e389a812fe4276b8055`.

Producer run `36891107338`, number `3107`, attempt `1`, terminal SUCCESS. [Package proof artifact](https://github.com/PatrickFrome/Compute/actions/runs/36891107338/artifacts/11176842870) was downloaded and its ZIP digest verified; source/version/manifest/service/bootstrap bindings agree. Physical Windows proof covers no-argument entry, exact machine copy, protected owner-store root, SCM Running, repeat observation only, policy/ancestor ACL drift HOLD, arbitrary path and embedded tamper rejection, and stopped-service HOLD. Normal UI/second instance and 190-second startup grace passed.

Installed Chat independently qualified nonce-bound GitHub OIDC → ADMIN_CONNECTED for the CI device. OIDC token was not exposed to Browser. Full Node suite: **3830/3830 PASS**, zero skipped. Self Update consumed the same installer, independently verified its SHA/config/blockmap and waited for this producer's terminal SUCCESS. Fast update baseline `0.7.0-dev.36806234662.1` passed. Resident baseline `0.7.0-dev.34759310781.1` upgraded: old Browser/Sentinel gone, new Browser/Sentinel started, matching executable SHA, no retry dialog.

## Terminal workflow matrix

| Workflow | Exact-head run | Result |
|---|---|---|
| METAENGINE Browser Cognitive Ingest V1 | [36891107434](https://github.com/PatrickFrome/Compute/actions/runs/36891107434) | SUCCESS |
| METAENGINE Browser Host Resilience Login Start V1 | [36891107801](https://github.com/PatrickFrome/Compute/actions/runs/36891107801) | SUCCESS |
| R83 Edge Canary Qualification V1 | [36891107615](https://github.com/PatrickFrome/Compute/actions/runs/36891107615) | SUCCESS |
| Client V1 Supabase Edge Live Probe | [36891107468](https://github.com/PatrickFrome/Compute/actions/runs/36891107468) | SUCCESS |
| Browser Meta Orchestrator V1 | [36891107442](https://github.com/PatrickFrome/Compute/actions/runs/36891107442) | SUCCESS |
| Client V1 C4 Goal Contracts | [36891107523](https://github.com/PatrickFrome/Compute/actions/runs/36891107523) | SUCCESS |
| Browser Typed Workspaces V1 | [36891107589](https://github.com/PatrickFrome/Compute/actions/runs/36891107589) | SUCCESS |
| ME2 Unified Gate (daemon boot+eval, UI deps+build+pack) | [36891107308](https://github.com/PatrickFrome/Compute/actions/runs/36891107308) | SUCCESS |
| R84 Desktop Convergence V1 | [36891107507](https://github.com/PatrickFrome/Compute/actions/runs/36891107507) | SUCCESS |
| METAENGINE Browser Control Plane Fast Lane V1 | [36891107494](https://github.com/PatrickFrome/Compute/actions/runs/36891107494) | SUCCESS |
| Browser Workspace Reincarnation V1 | [36891107456](https://github.com/PatrickFrome/Compute/actions/runs/36891107456) | SUCCESS |
| METAENGINE Browser Developer Emergency Update V1 | [36891107526](https://github.com/PatrickFrome/Compute/actions/runs/36891107526) | SUCCESS |
| METAENGINE Browser Guardian SCM Host V1 | [36891107598](https://github.com/PatrickFrome/Compute/actions/runs/36891107598) | SUCCESS |
| METAENGINE Browser Guardian SCM Recovery Policy V2 | [36891107306](https://github.com/PatrickFrome/Compute/actions/runs/36891107306) | SUCCESS |
| METAENGINE Browser Shell V1 | [36891107458](https://github.com/PatrickFrome/Compute/actions/runs/36891107458) | SUCCESS |
| METAENGINE Browser Critical Audit V1 | [36891107428](https://github.com/PatrickFrome/Compute/actions/runs/36891107428) | SUCCESS |
| METAENGINE Browser Shell-First Dirty Profile V1 | [36891107435](https://github.com/PatrickFrome/Compute/actions/runs/36891107435) | SUCCESS |
| Browser Windows Package Smoke | [36891107338](https://github.com/PatrickFrome/Compute/actions/runs/36891107338) | SUCCESS |
| METAENGINE Browser Windows Autonomous Soak V1 | [36891107612](https://github.com/PatrickFrome/Compute/actions/runs/36891107612) | SUCCESS |
| Browser Windows Installed Chat Qualification | [36891107525](https://github.com/PatrickFrome/Compute/actions/runs/36891107525) | SUCCESS |
| METAENGINE Browser Final Runtime Activation V1 | [36891107423](https://github.com/PatrickFrome/Compute/actions/runs/36891107423) | SUCCESS |
| METAENGINE Browser Self Update E2E | [36891107502](https://github.com/PatrickFrome/Compute/actions/runs/36891107502) | SUCCESS |

## Remaining live boundary

This is unsigned, unpublished development output (`promotion_authorized=false`). Physical bootstrap proof explicitly keeps owner enrollment, Guardian installer dispatch and user-machine qualification false. Existing backend stable v10 / canary v26 digests were independently read back unchanged; ticket rejection is live-qualified, but successful installed owner enrollment is a separate gate. The next bounded milestone is an approved device → real ticket → native durable owner CAS → independent read-only proof → restart continuity qualification using the existing authority rail. Emergency handoff remains blocked until that proof; no blind replay or manual DB identity repair is justified.

The user's Browser had no fresh heartbeat at the continuation's readback. This report's ADMIN_CONNECTED and upgrade evidence belong to controlled Windows CI, not that user's device.
