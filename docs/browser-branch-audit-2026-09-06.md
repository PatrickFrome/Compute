# METAENGINE Browser branch audit — 2026-09-06

Status: source-only development audit. No production DDL, Edge deploy, Browser actuation, merge, release, or authority effect was performed by this audit.

## Authority baseline

Live-reverified integration points at the start of this audit:

- `main` = `0d1c074c7f513f25000d967761c7bb13912dacaa`.
- roadmap integration = `integration/metaengine-development-os-v1` @ `9df375038781219ea96885d22233cd9c9e96f969`.
- exact-green Browser candidate #342 = `af1888f79d7bbec3321e1893e5fc3d748cf73df3`.
- newer stacked #343 = `work/browser-brain-stream-clock-v1` @ `4b031cbd2ecd4b9d486d4d1fb23341988938d64d`.
- this audit/optimization slice = `work/browser-brain-cognition-fabric-v1`, stacked on #343.

Hard invariants remain unchanged:

1. DB lease is the sole remote command authority.
2. Existing-tab mutations require exact explicit `tab_id` and current WebContents/runtime generation proof.
3. URL/title/platform/focus/selected-tab state never grants mutation authority.
4. A physical effect that is ambiguous is never retried automatically.
5. Memory, event retention, agent observations, caches, subtargets, batches and concurrency remain bounded.
6. There is one production command scheduler. Advisory cognition must never create a second scheduler, hidden mutation queue or lease path.
7. Browser/agent/page/model data is evidence only and never grants authority.

## Complete lineage census used

The repository-native lineage auditor snapshot covered all 489 remote branches:

| Classification | Count |
|---|---:|
| BASE | 1 |
| CONTAINED | 175 |
| DIVERGED_HISTORY_ONLY | 9 |
| DIVERGED_NONAUTHORITY | 43 |
| DIVERGED_AUTHORITY | 261 |

The same snapshot identified 191 independent lineage tips and 154 authority lineage tips. The audit rule is therefore disposition/reconciliation, not bulk merge. `DIVERGED_AUTHORITY` is not permission to merge: a historical branch can reintroduce obsolete Browser, DB, extension, scheduler or release authority.

Live branch search additionally enumerated 226 Browser-named branches and the Supervisor/mesh families. Exact heads used for every selected port decision below were re-read from GitHub before mutation.

## Canonical Browser Brain stack

Preserve this stack as the execution foundation:

`#329 → #330 → #331 → #332 → #336 → #337 → #341 → #342 → #343 → cognition-fabric`

Mechanisms:

- #329: durable gap-safe cognitive ingest.
- #330: exact BrowserCell/runtime binding plus bounded causal memory.
- #331: O(1) same-cell causal predecessor bookkeeping.
- #332: pressure-aware fanout/admission.
- #336: persistent CDP physical effect path; no attach/detach per command.
- #337: effect-binding v2 runtime generation / document / URL / renderer / CDP fence immediately before effect dispatch.
- #341: source-only single-trigger Realtime command wake.
- #342: event-driven submit readback, exact mutation target, process/WebContents/CDP/subtarget visibility, bounded MessagePort deltas, continuous coordinator.
- #343: bounded cross-producer causal clock.
- cognition-fabric: live bounded advisory memory/cache/agent/evidence composition over the same coordinator and scheduler.

## Divergent lineage dispositions

### Contained / do not merge again

The #338 → #339 → #340 fanout line is graph-divergent but its core runtime modules are already byte-equivalent in #342. Re-merging it would add history without new behavior.

Older browser-brain/control-plane fusion branches are evidence references only when #342 contains their mechanism with stronger exact-target/runtime-generation contracts.

### r8–r16 / v0.8 fleet line: mine advisory primitives only

Large tips such as:

- `work/a2-browser-r16-adaptive-router`
- `work/a2-browser-v080-gpt-fleet-runtime`

contain valuable concepts:

- context compilation and role-specific bounded views;
- semantic action fingerprint/cache and singleflight planning;
- evidence blackboard and trust/taint propagation;
- same-point swarm proposals/critique/jury;
- hash-chained trace/replay evidence;
- provider/locality/trust/capability adaptive route scoring;
- agent lifecycle/incarnation concepts.

Do **not** port their execution half wholesale. Those histories also contain parallel agent/session schedulers, remote-pool lease state, extension authority, old typed-click/DB migrations and other execution surfaces superseded by the current DB-lease + exact-target + one-scheduler design.

The cognition-fabric ports the safe ideas in bounded zero-authority form:

- 128 BrowserCell compact fact sets, 16 facts/cell;
- 1024 semantic advisory plans, generation-scoped and time-bounded;
- 64 provider-neutral agent observations;
- 1024 evidence digests with bounded FIFO eviction;
- no raw DOM/network/page text/input retention;
- no execution payload in semantic cache;
- fresh caller revalidation required on every cache hit;
- causal gap disables cache reuse until canonical resync;
- agent routing is advisory and creates no assignment/lease/scheduler authority.

### `work/supervisor-rollover-atomic-bind-recovery-v1`: port continuity fix separately

This tip is only four unique commits but carries a real recovery improvement:

- validate successor conversation URL/tab before incrementing `supervisor_epoch` or clearing the durable rollover attempt;
- exact partial-bind transcript parser for `ROLLOVER_AMBIGUOUS` recovery.

Current Browser candidate still reports `SupervisorKeepalive 1.3.1`; the divergent slice is 1.3.2. It should be rebased as a separate continuity commit before production promotion. Do not bulk-merge its old baseline.

### `work/browser-fabric-update-trust-current-v1`: keep in release plane

The unique verifier composes typed TUF role receipts, provenance, transparency and platform-signature evidence. It is valuable immutable update-trust hardening but is not a Browser command hot-path mechanism. Rebase/review separately with release/provenance owners.

### `work/browser-guardian-session-one-attempt-journal-v1`: keep in host-resilience plane

The durable session-broker journal provides a strong one-attempt barrier and explicit `AMBIGUOUS`/positive readback transitions. It is Windows session-broker-specific rather than generic BrowserCell command authority. Preserve as an independent host-resilience slice; do not make it a second Browser command ledger.

### `work/browser-cell-isolation-pilot-current-v1`: evidence only

The two-cell physical isolation pilot is useful release evidence for independent BrowserCell effects. It adds no runtime authority and should remain an evidence workflow, not be merged as an execution path.

## Current visibility and concurrency model

The Browser Brain should claim exactly this boundary:

- every process returned by Electron `app.getAppMetrics()`;
- all Electron WebContents for the current application;
- exact tab ↔ WebContents indexes;
- renderer process incarnation where process metrics provide PID + creation time;
- persistent CDP root target per observed BrowserCell;
- bounded recursive Chromium subtargets (workers/iframes/etc.).

This is complete application-browser visibility, not OS-global omniscience.

Current bounded ceilings:

- 128 observed root BrowserCells;
- 256 Chromium subtargets per persistent root CDP session;
- local scheduler architecture: 128 reads / 32 independent-cell mutations;
- cognitive MessagePort: max 64 consumers, max batch 128, ACK window 1;
- end-to-end remote leased mutation batch remains 16 until Edge/source/live DB expose one matching batch-lease contract.

## Live database drift re-read during this audit

The live production schema still differs from the source candidate:

1. no fresh Supervisor was present;
2. no active actuation lease was present;
3. the sole command-table trigger remained `glm_pulse_command → glm_browser_pulse_notify_v1()`;
4. the live trigger function still used only `pg_notify`, with no `realtime.send`; #341 is therefore source-only;
5. live lease functions included single-command lease generations but no `lease_batch_v1` RPC expected by source Edge code;
6. live `h205f22_a2_browser_supervisor_bind_effect_v1` accepted the v1 binding schema only; source effect-binding v2 is not deployed;
7. historical command rows include `authority_effect=true`; the current meaning must be audited as a typed physical-effect contract before adding/removing constraints. Never restore obsolete `*_no_authority_ck` constraints blindly.

Production promotion remains blocked until source/live contracts are reconciled through the repository authority protocol.

## Performance audit

### Already removed artificial waits

- no CDP attach/detach per command;
- no `20 × 100 ms` ChatGPT submit readback poll loop;
- no coordinator timer;
- no per-delta full snapshot or local HTTP loop;
- one bounded MessagePort ACK window per consumer;
- semantic/CDP burst reuses the current pressure budget instead of recomputing resource pressure for every DOM/AX event;
- one existing command scheduler performs per-cell causal parallelism.

### Current highest-value latency hotspot

`native-browser-control.mjs` still resolves ordinary semantic targets with `Accessibility.getFullAXTree()` for each `SEMANTIC_FOCUS`, `SEMANTIC_TYPE` and `TYPED_CLICK` resolution.

Recommended next source slice:

`generation-scoped cached backendNodeId → Accessibility.getPartialAXTree(fetchRelatives:false) fresh narrow check → exact role/name match → existing runtime-generation fence → physical effect`

Rules:

- cache only target identity/fingerprints, never execution authority;
- invalidate on binding/document generation change;
- narrow read must freshly confirm the candidate;
- failure drops the candidate and falls back to one full-tree resolve;
- do not cache full capture/readback globally;
- retain the final effect-binding/runtime fence immediately before DOM/Input dispatch.

This removes repeated full AX-tree work from consecutive semantic actions without making stale cognition executable.

## Admission hardening follow-up

The execution layer already rejects existing-tab mutations without explicit exact `tab_id`. The command-lane classifier still has an old compatibility branch that serializes such an invalid mutation as `global:selected-tab` before execution rejects it. This cannot currently grant a physical effect, but it wastes a global barrier and weakens contract clarity.

Next scheduler cleanup should reject missing exact mutation `tab_id` at classification/admission, while preserving unknown actions as exclusive fail-closed controls.

## Release state

This audit produces a better source candidate, not a production release. Before promotion:

1. obtain fresh Supervisor evidence and an active actuation lease;
2. complete exact-head CI for the stacked candidate;
3. rebase/review the rollover 1.3.2 continuity fix;
4. explicitly audit live `authority_effect` semantics;
5. deploy/read back effect-binding v2 and single-trigger Realtime wake in the approved order;
6. resolve the absent live batch-lease contract before claiming 32 end-to-end remote mutations;
7. run DB security/performance advisors after DDL;
8. deploy/read back exact Edge source;
9. produce package/provenance/signature evidence and physical N→N+1 updater readback;
10. only then seal a new production semantic checkpoint.
