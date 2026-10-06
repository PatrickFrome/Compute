# Live cross-project audit — 2026-10-06

This document is an **audit snapshot, not authority**. Mutable facts must be refreshed before future mutations.

## GitHub product frontier

Repository: `PatrickFrome/Compute`

Latest physically qualified Client/UI candidate observed during the audit:

- PR: **#1135**
- title: `Client V1: converge primary ME2 UI on ChatGPT runtime`
- state: open draft, mergeable
- base: `work/client-v1-live-development-candidate-v1`
- base SHA: `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a`
- head: `work/client-v1-chatgpt-ui-convergence-v1`
- exact head SHA: `be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c`
- exact package: `0.7.0-dev.37493000001.1`
- installer SHA-256: `81504d8e433704629d350eecadd29ffb30883f0250310bc8d69399840b09884a`

PR #1135 records terminal SUCCESS for the exact-head source/regression, Package Smoke, installed Chat, Autonomous Soak, Self Update E2E, and Final Runtime Activation.

Its own explicit non-claims remain important:
- real LIVE Agent useful work: **NOT_PROVEN**
- production release: **NOT_PROVEN**
- canonical C2: **NOT_PROVEN**
- promotion authority: **false**

The package identity is frozen. A code change requires a fresh monotonic package reservation.

## Live Supabase frontier

Connected project observed:

- project ref: `jhriwwsryeqsvvvufkok`
- region: `eu-central-1`
- status: `ACTIVE_HEALTHY`

Current roadmap authority row observed:

- authority key: `METAENGINE_CLIENT_V1`
- roadmap: `metaengine-client-v1`
- active milestone: `C4_TYPED_PRODUCT_CONTROL`
- integration line: `work/client-v1-c4-typed-goal-bridge-v1`
- baseline SHA: `1fde1e53549eafefd6c28b50cdcd384e86d14512`
- alignment epoch: `3`
- updated: `2026-09-29T14:11:27Z`

This authority metadata is materially behind the current GitHub Client V1 candidate. Treat this as **live metadata drift / not-yet-promoted authority**, not as permission to rewrite it blindly.

Latest operational audit checkpoint observed:

- kind: `R1_STEP09B_LIVE_DEPLOYED_VERIFIED`
- source SHA: `448ef89c62db825a66312468a2e447f0e2eaff4c`
- evidence state: `EVIDENCE_READY`
- canonical checkpoint: false
- production R2: not proven
- production R3: blocked by R2

This checkpoint is a current R1 continuity audit surface, not the current Client/UI source authority.

## Live Browser/Supervisor readback

Latest Browser state observed:

- client: `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9`
- last seen: `2026-10-06T16:41:20Z`
- installed extension version: `0.7.0-dev.37416000001.1`
- runtime: `native-electron-supervisor-v1`
- supervisor/operator mode: `CONTROL`
- armed: true
- ordering: `NATIVE_TYPED_COMMAND_LANES_V1`

The installed Browser is therefore older than the physically qualified PR #1135 package.

Fleet snapshot observed four ChatGPT/OpenAI agents:
- PLANNER
- RESEARCHER
- IMPLEMENTER
- CRITIC

All four were `BOUND_UNVERIFIED` at the readback.

Task counts observed:
- READY: 1
- FENCED: 8

Active trusted actuation lease observed:
- **none**

Recent Supervisor mesh entries were `LOST`.

## Edge/migration state observed

Active Edge functions included:
- `a2-browser-native-supervisor-v14-canary` version 29
- `a2-browser-native-supervisor-v1` version 11
- `metaengine-client-installed-qualification-h205f22` version 8
- `a2-chat-bridge-remote` version 2
- `a2-browser-native-supervisor-v11-rollback-snapshot` version 1

The live migration ledger already includes fresh-project Client V1, ChatGPT-only, workspace convergence, Computer Authority Plane V1/V2, proof convergence, and R1 continuity convergence migrations through 2026-10-05.

## Cross-project conclusion

The old ChatGPT Project files from August/early September are no longer suitable as current-state inputs.

The actual development topology now has at least three distinct current frontiers which must not be collapsed:

1. **Latest physically qualified source/package frontier** — PR #1135 @ `be5e84a...`.
2. **Live installed/runtime frontier** — Browser `0.7.0-dev.37416000001.1`.
3. **Live Supabase authority/checkpoint frontier** — older Client roadmap authority plus newer independent continuity/runtime migrations and audit evidence.

This is exactly why future chats must begin with live reconciliation rather than a historical capsule.

## Recommended operating architecture

- Project files: router/instructions only.
- GitHub PR/issue: durable development-session handoff.
- GitHub exact refs + CI: source/evidence truth.
- Supabase: live runtime/control-plane truth.
- Fresh Project chat: disposable reasoning/execution worker.

Do not try to make a Project file mirror every live state transition.
