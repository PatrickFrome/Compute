# METAENGINE cross-project audit — 2026-10-06

Status: read-only reconciliation completed before this document was written.

This is a dated audit record, not permanent authority.

## 1. Repository topology

Repository: `PatrickFrome/Compute`

Branch census observed through GitHub:

- total branches: **869**
- `work/*`: **732**
- `analysis/*`: 35
- `repair/*`: 31
- `me2/*`: 14
- `integration/*`: 11
- `fix/*`: 10
- `release/*`: 8
- remaining namespaces/root branches: smaller historical/support sets

Interpretation:

The branch graph is overwhelmingly a historical/stacked development ledger. "Latest branch" is not a meaningful authority rule. Wholesale reconciliation of `work/*` is unsafe and unnecessary.

Observed branch heads:

- `main` -> `b26f2d4693e7bab3648e0930b7a9e2c75baef58e`
- `integration/metaengine-development-os-v1` -> `b69f6629ddc696daf19c122f8c0a3e7a9be44f63`
- `work/client-v1-live-development-candidate-v1` -> `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a`
- `work/client-v1-chatgpt-ui-convergence-v1` -> `be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c`

The current Client V1 line is **not** a simple descendant of current `main` or current DevOS integration.

GitHub compare readback:

- `main -> Client #1132`: diverged; Client side ahead 4811, behind 460; merge base `acc7d60e...`
- DevOS integration -> Client #1132: diverged; Client side ahead 3029, behind 4; merge base `c32b62cc...`
- DevOS integration -> Client #1135: diverged; Client side ahead 3099, behind 4

Therefore neither `main` nor old DevOS integration may be mechanically treated as the current Client product base.

## 2. Active Client/C5 lineage

The recent Client line is a stacked evidence lineage.

Important containment checks against #1132 head `e2e8f20e...`:

- #1104 head `8c216ee0...` -> contained ancestor; #1132 is +308 commits
- #1116 head `b5689a91...` -> contained ancestor; #1132 is +167 commits
- #1118 head `acbdab77...` -> contained ancestor; #1132 is +114 commits
- #1119 head `f6162586...` -> contained ancestor; #1132 is +112 commits
- #1129 head `baeff488...` -> contained ancestor; #1132 is +42 commits
- #1131 head `20ea57fd...` -> contained ancestor; #1132 is +22 commits

The older PRs remain useful evidence checkpoints but are not separate source frontiers for new implementation unless a task explicitly targets their unique semantics.

### #1132 — hardened LIVE development candidate

- source: `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a`
- package: `0.7.0-dev.37416000001.1`
- exact installer SHA-256: `3895c6748eb7c84f2297c2a7e4f79801e6cba3e90447d68edc53fc2ef869cadb`
- state: open draft
- exact-head physical matrix: terminal SUCCESS
- useful-work real LIVE provider run: not proven
- production release/trust: not proven
- canonical C2 promotion: not authorized

This exact package is the live-installed version observed later in Supabase.

### #1133 / #1134

Both are closed, unmerged intermediate UI-convergence checkpoints on the same successor branch.

Classification: **SUPERSEDED_BY_1135**.

### #1135 — current physically qualified UI/product source frontier

- branch: `work/client-v1-chatgpt-ui-convergence-v1`
- source: `be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c`
- base: #1132 exact head
- ancestry: +70 commits, 0 behind
- package: `0.7.0-dev.37493000001.1`
- installer SHA-256: `81504d8e433704629d350eecadd29ffb30883f0250310bc8d69399840b09884a`
- state: open draft

Exact-head workflow readback returned 15 terminal-success workflows, including:

- Critical Audit
- Typed Workspaces
- R84 Desktop Convergence
- Meta Orchestrator
- Workspace Reincarnation
- C4 Goal Contracts
- LIVE Development Candidate Audit
- Shell
- Host Resilience
- Dirty Profile
- Installed Chat
- Final Runtime Activation
- Package Smoke
- Autonomous Soak
- Self Update E2E

The PR explicitly records:

- ChatGPT primary UI convergence: physically qualified
- deprecated dark workspace: removed / absence proven
- real LIVE Agent useful work: NOT_PROVEN
- production release: NOT_PROVEN
- canonical C2: NOT_PROVEN
- promotion authority: false

The package identity is frozen.

## 3. Live Supabase authority

Connected project:

`jhriwwsryeqsvvvufkok`

Current roadmap authority table contains one observed row:

- authority key: `METAENGINE_CLIENT_V1`
- roadmap: `metaengine-client-v1`
- milestone: `C4_TYPED_PRODUCT_CONTROL`
- integration line: `work/client-v1-c4-typed-goal-bridge-v1`
- baseline: `1fde1e53549eafefd6c28b50cdcd384e86d14512`
- epoch: 3
- last update: 2026-09-29

Classification: **LIVE authority metadata, but materially behind the current qualified Client source frontier**.

This is drift, not permission to overwrite the row.

## 4. Live runtime

Latest Browser supervisor readback during the audit:

- client: `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9`
- heartbeat: fresh at audit time
- installed version: `0.7.0-dev.37416000001.1`
- runtime: `native-electron-supervisor-v1`
- supervisor mode: CONTROL
- operator mode: CONTROL
- armed: true
- ordering: `NATIVE_TYPED_COMMAND_LANES_V1`
- compute state: HEALTHY
- compute available: true
- fleet version: 1.5.0
- fleet: 4 `BOUND_UNVERIFIED` agents, 0 ACTIVE

Task ledger:

- READY: 1
- FENCED: 8

Actuation leases:

- active unexpired: 0
- rows currently marked ACTIVE: 0

Supervisor mesh:

- LOST: 19
- newest observed LOST heartbeat: 2026-10-04T10:47:20Z

This prevents treating the healthy Browser heartbeat as current Supervisor actuation authority.

## 5. Live database / Edge evolution

The migration ledger is much newer than the roadmap authority baseline and includes, among other recent domains:

- Client V1 fresh-project bootstrap/security/device enrollment
- R83 physical evidence and reconciliation
- C4 goal submission/progress/result proof
- installed qualification authority
- workspace authority recovery
- Guardian enrollment ticket
- ChatGPT-only bridge/supervisor convergence
- workspace binding/reincarnation live convergence
- transport promotion admission fix
- Computer Authority Plane V1
- Computer Authority Plane V2 fast actions
- computer proof-contract convergence
- R1 continuity fresh-project convergence
- R1 STEP09B fresh-project convergence

Active Edge functions observed:

- `a2-browser-native-supervisor-v14-canary` v29
- `a2-browser-native-supervisor-v1` v11
- `metaengine-client-installed-qualification-h205f22` v8
- `a2-chat-bridge-remote` v2
- rollback snapshot of native supervisor v11

Therefore repository source, package, installed runtime, roadmap authority, DB migrations, and Edge deployment are independent frontiers.

## 6. Current reconciled frontier table

| Frontier | Current observed identity | Classification |
|---|---|---|
| Source/product | #1135 @ `be5e84a...` | PHYSICALLY_QUALIFIED |
| Package | `0.7.0-dev.37493000001.1` / installer `81504d8e...` | PHYSICALLY_QUALIFIED, NOT_PROMOTED |
| Installed Browser | `0.7.0-dev.37416000001.1` | LIVE / older than source package |
| Roadmap authority | C4 @ `1fde1e53...`, epoch 3 | LIVE / STALE_RELATIVE_TO_SOURCE |
| Browser useful-work fleet | 4 BOUND_UNVERIFIED | LIVE / NOT_READY |
| Actuation authority | no active lease | NOT_AUTHORIZED |
| Supervisor mesh | 19 LOST | NOT_FRESH |
| R1 continuity audit | newer independent audit/migrations exist | SEPARATE_CONTINUITY_FRONTIER |
| Chat Development OS | PR #1136 | SESSION/PROCESS WORK ONLY |

## 7. Operational conclusions

1. **Do not promote old Project files into context authority.**
2. **Do not bulk-merge the 732 work branches.**
3. **Treat #1103–#1131 primarily as contained evidence ancestry once their semantics are present in #1132/#1135.**
4. **Do not mutate frozen #1135 source under package 37493000001.1.**
5. **Do not infer LIVE useful work from the green #1135 matrix.**
6. **Do not issue live Browser effects without a fresh trusted actuation authority/lease.**
7. **Do not "fix" the stale roadmap authority row merely to make it match GitHub. Promotion must follow its own evidence/authority protocol.**
8. **Use fresh chats as workers; persist durable session continuity on GitHub.**

## 8. Next architecture step

The Chat Development OS should not contain a constantly edited `CURRENT_STATE.md`.

Instead every fresh chat should construct a temporary current-state envelope via `LIVE_PREFLIGHT_PROTOCOL.md`, then persist only the stable handoff/evidence relevant to its bounded objective.

This keeps the Project fast, avoids stale-context poisoning, and matches the actual multi-frontier architecture of METAENGINE.
