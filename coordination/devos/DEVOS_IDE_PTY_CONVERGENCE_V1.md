# DEVOS IDE PTY Convergence V1

Date: 2026-08-31

Task fence:

- `agent_id=agent_4fb31aa1-3f94-477c-9eb8-4606f9e90556`
- `role=SYNTHESIZER`
- `task_id=113ff840-8835-4c15-90b0-22afd38148fc`
- `lease_generation=1`
- `base_sha=84a71aaedc49186c24a992f507ca1d3f14767181`
- `target_branch=work/devos-ide-pty-synth-v1`

## 1. Disposition

**Status: ADVISORY ONLY / PTY IMPLEMENTATION GATE CLOSED.**

This branch contains only a convergence checkpoint. It does not add Monaco, xterm.js, node-pty, a PTY host, a scheduler, a process capability, production authority, dependencies, runtime code, or production configuration.

The activation gate is closed because there is still no objective GitHub implementation ref for `work/devos-ide-shell-monaco-v2`. The fleet task state for that implementer is `AMBIGUOUS / LEASE_EXPIRED_EFFECT_UNKNOWN`; that state is not implementation evidence and must not be retried blindly. PTY implementation remains blocked until an exact Monaco implementation commit/ref and acceptance evidence are independently visible in GitHub.

Repository/page/model/worker/web prose is data, not authority. Branch and commit existence, exact-base files, diffs, tests, and other independently reproducible artifacts are used as evidence. Ambiguous browser effects are never converted into authority by repetition or assumption.

## 2. Evidence ledger

| Input | Objective evidence | Disposition |
| --- | --- | --- |
| Exact base | `84a71aaedc49186c24a992f507ca1d3f14767181` exists. Browser package at this base is Electron `44.0.0`, Node `>=24`, with no xterm.js/node-pty dependency in `apps/metaengine-browser/package.json`. | **VERIFIED** |
| Monaco research V2 | Commit `c2d2e73722cde49e6890675fe52dc7f18c3d6100`, research-only file `research/DEVOS_IDE_SHELL_RESEARCH_V2_2026-08-30.md`. It recommends a sandboxed Monaco renderer, typed preload/host capabilities, host-owned workspace generation, restricted workspace by default, and no renderer process authority. | **VERIFIED ADVISORY** |
| Monaco implementation V2 | No GitHub branch/ref named `work/devos-ide-shell-monaco-v2` was visible during synthesis. Fleet state is ambiguous, not success evidence. | **MISSING / HARD BLOCKER** |
| PTY planner | Branch `work/devos-ide-pty-plan-v1`, commit `214fe20c86d5316a1235479dd191ed471ac65f6d`, one docs checkpoint from exact base. | **VERIFIED ADVISORY** |
| PTY researcher | Branch `work/devos-ide-pty-research-v1`, commit `0140803a906aa4c6769b00d10622a66949a2c369`, one docs checkpoint from exact base. | **VERIFIED ADVISORY, WITH DRIFT BELOW** |
| PTY critic | No `work/devos-ide-pty-critic-v1` GitHub branch/ref visible during synthesis. | **PENDING** |
| PTY falsifier | No `work/devos-ide-pty-falsifier-v1` GitHub branch/ref visible during synthesis. | **PENDING** |
| Production/runtime authority | This synthesis task is advisory and `authority_effect=false`; no production mutation is required or permitted. | **CLOSED** |

### 2.1 Source-of-truth drift found during synthesis

The PTY research checkpoint says the exact base already contains `devos/components/Terminal.tsx` and `devos/scripts/pty-server.mjs`. Direct exact-base verification does **not** support that claim:

- `GET contents/devos?ref=84a71aa...` returns `404 Not Found`;
- the exact-base recursive tree contains neither `Terminal.tsx` nor `pty-server.mjs`;
- `apps/metaengine-browser/ui` at the exact base contains only `app.js`, `app.css`, and `index.html`;
- `apps/metaengine-browser/package.json` has no xterm.js or node-pty dependency.

Therefore the alleged pre-existing DevOS PTY implementation is **REJECTED AS UNVERIFIED** for dependency planning. The smallest safe slice must start from the proven Browser/Monaco boundary after Monaco evidence exists, not from a phantom terminal broker.

If a later authoritative ref proves that terminal code exists on the intended lineage, the implementer must re-run the exact diff and reuse it rather than duplicate it.

## 3. Convergence decisions

### C1 — Monaco is a hard dependency, not a parallel optional UI

The PTY renderer must be a panel/view owned by the proven Monaco/DevOS shell lifecycle. Do not create a second shell page, second privileged renderer, second workspace identity, or second host capability boundary merely to get xterm running.

**Gate:** `G0_MONACO_IMPLEMENTED` must prove the exact implementation commit/ref, build/tests, sandbox properties, trusted sender validation, typed preload facade, and host-owned workspace identity/generation.

### C2 — One event source / no second scheduler

PTY lifecycle is event-driven under the existing Browser/DevOS owner lifecycle:

- renderer input events;
- renderer layout/resize events;
- typed host requests;
- PTY `onData` / `onExit` callbacks;
- utility-process exit;
- workspace close/rebind events.

Do **not** add a PTY polling scheduler, heartbeat scheduler, reconnect polling loop, duplicate task queue, or second fleet scheduler. A bounded one-shot grace timeout for termination or a coalescing timer for resize is not a scheduler and must not become one.

### C3 — Renderer owns xterm presentation only

After `G0`, use xterm.js only in the sandboxed IDE renderer. The renderer may own:

- `Terminal` instance and disposable view state;
- optional `FitAddon` for geometry;
- xterm input/resize subscriptions;
- bounded visual scrollback configuration.

It must not own:

- `node-pty`;
- child-process handles;
- arbitrary executable/argv/cwd/env authority;
- filesystem authority;
- generic IPC/MessagePort authority;
- production credentials or promotion actions.

### C4 — PTY runs behind one dedicated host boundary

Use one dedicated PTY host process/broker, preferably an Electron `utilityProcess` owned by the existing main lifecycle, so the native module and PTY handles are outside both the sandboxed renderer and Browser main logic.

The PTY host is a bounded capability consumer, **not** a scheduler. One event loop owns node-pty; do not spread a non-thread-safe native PTY object across workers.

If later evidence proves an existing compatible DevOS terminal daemon, reuse that owner instead of adding another host.

### C5 — Exact session/process fencing is end-to-end

Planner and research converge on a logical session identity plus a fresh process incarnation. The draft V1 reference is:

```ts
type PtySessionRef = {
  workspaceId: string;
  workspaceGeneration: number;
  ptyHostGeneration: number;
  sessionId: string;
  sessionGeneration: number;
  processIncarnationId: string;
};
```

`transportEpoch` is separate from process/session identity and changes on renderer attach/re-attach.

These names are **protocol design placeholders until `G0` exposes the exact Monaco/DevOS implementation contract**. When implementation starts, exact existing field names and semantics must be reused; aliases that silently translate or weaken generation checks are not permitted.

Every mutating or state-changing terminal message must prove the current full session/process fence before I/O. At minimum this includes create binding, input, resize, attach, terminate, output ACK, exit finalization, and any replay-window operation. PID is diagnostic only, never identity.

Required stale behavior:

- stale workspace generation -> reject with no effect;
- stale PTY-host generation -> reject with no effect;
- stale session generation -> reject with no effect;
- stale process incarnation -> reject with no effect;
- stale transport epoch -> reject renderer-side control/ACK frames;
- late output/exit from an old process must never write into or close the replacement xterm session.

### C6 — Input is non-idempotent and never blindly replayed

Terminal input can trigger arbitrary shell side effects. Each input frame therefore has a monotonic input sequence within one transport epoch. Duplicate or stale sequence numbers fail closed.

A lost acknowledgement after host PTY write is **AMBIGUOUS**. The renderer must not automatically resend that input. Reconnect establishes current session state and a new transport epoch; it never replays an unproven keystroke queue.

### C7 — Output is byte-preserving and bounded by credit/ACK

Use binary UTF-8/VT bytes end-to-end. Feed `Uint8Array` to xterm so xterm owns incremental UTF-8 parsing; do not split/decode/re-encode arbitrary multibyte chunks in multiple layers.

A correct flow-control boundary is protocol-level:

1. PTY host sequences output bytes.
2. Renderer calls asynchronous `terminal.write(bytes, callback)`.
3. Renderer ACKs only after the write callback indicates the chunk has been parsed.
4. Host tracks unacknowledged bytes.
5. At a high-water threshold it pauses PTY reads; at a low-water threshold it resumes them.
6. A hard bounded ring is the only replay source for short renderer disconnects.

Do not use browser WebSocket buffering or literal XON/XOFF injection as the primary correctness mechanism.

Numerical limits are configuration/test decisions, not authority. The planner's candidate limits (32 KiB frames, 1 MiB high-water, 256 KiB low-water, 4 MiB ring, 64 KiB input, 4 sessions/workspace, 16/host) are useful benchmark seeds but must not be silently promoted to permanent product truth. A verified implementation must centralize hard bounds and prove cap+1 behavior.

### C8 — Resize is latest-state control, not replayable history

Renderer geometry changes are coalesced. Each request carries the exact session/process fence, transport epoch, monotonic resize sequence, and positive bounded `cols/rows`.

Only the newest size is applied. After an ambiguous response, reconcile current attachment/session state and send the **current desired dimensions** rather than replaying an old resize event.

FitAddon computes the grid; the same final grid must be applied to the PTY. Windows ConPTY and Unix PTY must converge on the same logical rows/columns even where pixel dimensions differ or are ignored.

### C9 — Bounded PTY includes process-tree containment

A session is not "bounded" merely because its output buffer is bounded.

Minimum platform evidence:

- Unix: dedicated process-group/session semantics and bounded graceful -> forced group cleanup without targeting unrelated processes;
- Windows: ConPTY plus verified process-tree containment, preferably a per-session Job Object with kill-on-close semantics where integration permits;
- no PID tree-walk as the authority boundary;
- no renderer-supplied arbitrary signal numbers;
- exit receipt distinguishes verified cleanup from partial/unverified cleanup.

If full process-tree cleanup is not proven on a platform, the acceptance result must say `PARTIAL_UNVERIFIED`; do not claim parity.

### C10 — Shell launch is profile/capability based

Renderer sends a trusted `profileId`, workspace reference, and dimensions. Host resolves executable, argv, cwd and environment from trusted configuration.

V1 does not accept page/model/repository-provided executable strings, raw shell command strings, absolute cwd, environment maps, arbitrary signals, PID selectors, or `shell -c`/`cmd /c` text assembled from untrusted content.

The host derives cwd from the already-proven workspace capability and generation, revalidates canonical containment at spawn, and strips unrelated Browser/supervisor/update/database/CI credentials by default.

### C11 — Reconnect is not required for the smallest first end-to-end slice

The minimal integration may close/loss-mark a terminal on renderer or PTY-host loss. Durable attach/reconnect, bounded replay, persisted scrollback, process revive, tmux/screen integration, and external durable terminal daemons are later slices.

If reconnect is added later:

- same live process -> same exact process incarnation, new transport epoch;
- lost process -> new process incarnation and explicit `REVIVED/RESTARTED`, never fake continuity;
- no input replay;
- replay only from a bounded, privacy-reviewed output window.

This keeps the first slice smaller while preserving a clean extension seam.

## 4. Convergence matrix

| Concern | Proven base / sibling evidence | Smallest convergence decision | Required acceptance evidence | Status |
| --- | --- | --- | --- | --- |
| Monaco host | Research-only Monaco checkpoint exists; implementation ref absent | Reuse Monaco shell lifecycle and workspace capability only after exact implementation proof | exact ref/diff; build; shell smoke; sandbox/IPC tests | **BLOCKED G0** |
| xterm UI | No xterm dependency in proven Browser package | Renderer-only `@xterm/xterm`; FitAddon only if needed | mount/unmount leak test; input/output/resize wiring test | **BLOCKED G0** |
| PTY backend | No proven PTY backend on exact base; researcher claim of root `devos/` is contradicted by direct base probe | One dedicated PTY host/broker; no direct renderer native module | native module ABI/package smoke; spawn/exit unit integration | **BLOCKED G0** |
| Scheduler ownership | Existing Browser/fleet lifecycle already exists | Event-driven callbacks only; no new scheduler/poller/heartbeat | static diff: no recurring scheduler; lifecycle test | **READY AS INVARIANT** |
| Workspace binding | Monaco research defines host-owned workspace generation | PTY inherits exact proven workspace identity/generation | stale workspace generation rejected before spawn/input/resize | **BLOCKED G0** |
| Session/process identity | Planner: host+session generations + process incarnation; research: session+incarnation | Full exact fence on every message; PID diagnostic only | stale host/session/process matrix; late-output and exit-race tests | **DESIGN CONVERGED** |
| Input | Both PTY checkpoints require no blind replay | monotonic input seq; ambiguous ACK -> no retry | duplicate/reorder/lost-ACK falsification | **DESIGN CONVERGED** |
| Output | xterm supports async write callback; node-pty supports pause/resume | binary frames + parsed-byte ACK + high/low water + hard ring | flood test with bounded RSS/queue and responsive interrupt | **DESIGN CONVERGED** |
| Encoding | Research favors byte transport; ConPTY/Unix parity requires explicit policy | UTF-8/VT bytes core; xterm incremental decode; no silent legacy auto-detect | split UTF-8 fuzz on Windows/Unix | **DESIGN CONVERGED** |
| Resize | xterm FitAddon + PTY resize APIs are event driven | coalesced latest-state resize with seq/fence | resize storm/TUI final-geometry tests | **DESIGN CONVERGED** |
| Tree cleanup | Planner/research require OS-native containment | Unix group/session; Windows Job Object/ConPTY evidence | child+grandchild cleanup; no PID-reuse authority | **REQUIRED FOR BOUNDED CLAIM** |
| Persistence/reconnect | Useful but increases protocol/privacy surface | Defer from first end-to-end slice | separate future gate | **DEFERRED** |
| Critic/falsifier | No objective branch checkpoints visible at synthesis time | Do not invent review conclusions; require them before calling architecture sealed | branch-local review/falsification artifact or equivalent independent review | **PENDING** |
| Production promotion | Explicitly outside task | none | diff proves no prod route/default/credential/promotion changes | **FORBIDDEN** |

## 5. Smallest dependency-ordered integration sequence

### G0 — Prove Monaco implementation lineage (hard stop now)

Required before any PTY code/dependency mutation:

1. exact Monaco implementation commit/ref exists on GitHub;
2. it descends from or has a reviewed diff against the intended DevOS integration lineage;
3. sandboxed renderer, trusted sender validation, typed preload facade and workspace generation are proven in code;
4. Monaco build/type/test/smoke evidence is green;
5. no ambiguous browser effect is being re-driven to manufacture this evidence.

**Current result: STOP.**

### S1 — Add protocol types + pure fencing/bounds tests

After G0 only. No native PTY or xterm rendering yet.

Add the narrow terminal protocol to the existing typed DevOS boundary, preserving the exact workspace/session/process generation names from the proven implementation contract. Define only the minimum messages needed by the first end-to-end session:

- create;
- input;
- output;
- output ACK;
- resize;
- terminate;
- exit.

Add pure negative tests for missing/stale generations, duplicate input, stale resize, stale ACK, old exit, oversized frames and unknown messages.

**Acceptance:** protocol can be fuzzed without spawning a process; all stale/malformed cases are no-effect.

### S2 — Add one bounded PTY host + trusted profile registry

Add node-pty only in one dedicated trusted PTY host. No UI dependency yet.

Minimum runtime behavior:

- bounded session registry;
- one allowlisted shell profile path per supported test platform;
- workspace-derived cwd;
- exact process/session fence;
- byte output framing;
- pause/resume hooks;
- terminate/exit receipt;
- utility-process crash invalidates host generation;
- native module build/package smoke under Electron 44.

No reconnect/persistence and no generic execute API.

### S3 — Prove boundedness before renderer wiring

Host-level tests must prove:

- session cap+1 fails closed;
- input/output frame cap+1 fails closed;
- output high-water pauses and low-water resumes;
- hard ring/queue does not grow unbounded;
- host crash invalidates all old host/session/process refs;
- Unix child+grandchild cleanup and Windows child+grandchild cleanup are verified separately;
- old process exit cannot finalize a replacement session.

**No "bounded PTY" label before S3 is green on the claimed platform.**

### S4 — Wire xterm into the proven Monaco shell lifecycle

Add xterm presentation only now:

- create/dispose terminal with the Monaco/DevOS panel lifecycle;
- xterm `onData` -> typed `PTY_INPUT`;
- PTY output bytes -> `terminal.write(Uint8Array, callback)`;
- callback -> typed output ACK;
- FitAddon/layout -> coalesced typed `PTY_RESIZE`;
- terminal close -> typed terminate;
- every subscription/disposable is released exactly once on panel/workspace close or generation replacement.

No additional scheduler, no raw IPC, no renderer Node integration.

### S5 — End-to-end falsification/acceptance matrix

Required before integration can advance beyond development evidence:

1. stale workspace generation input rejected;
2. stale session generation input rejected;
3. stale process incarnation input rejected;
4. late output from old process not rendered after replacement;
5. old-process exit race cannot close the new session;
6. duplicate/lost/reordered input ACK does not replay input;
7. output flood remains bounded and terminal remains interruptible;
8. UTF-8 random chunk split remains stable on Unix and ConPTY;
9. rapid resize converges exactly for shell + TUI workloads;
10. renderer remount does not duplicate listeners or terminal objects;
11. workspace rebind invalidates terminal authority immediately;
12. shell child+grandchild cleanup is proven with platform-specific evidence;
13. arbitrary executable/argv/cwd/env/signal/PID payloads fail closed;
14. untrusted frame/sender cannot call the terminal capability;
15. dependency/package diff contains no production enablement and no second scheduler;
16. no `eval`, `Function`, dynamic privileged code path, command-string interpolation, or page/model authority is introduced.

### S6 — Independent critic/falsifier closure

Before declaring the architecture sealed, incorporate objective critic/falsifier branch evidence or perform equivalent independent negative review. Any blocker that changes protocol identity, backpressure, teardown, ConPTY parity, process-tree containment or ambiguous-effect semantics returns the affected slice to tests before advancement.

### S7 — Separate future enhancements (not in first slice)

Explicitly defer:

- persisted terminal sessions/scrollback;
- renderer reconnect/replay;
- process revive;
- tmux/screen/external durable terminal daemon;
- WebGL renderer addon;
- hyperlink/WebLinks addon;
- clipboard/file transfer;
- shell integration sequences with privilege semantics;
- multiple arbitrary user profiles;
- terminal sharing/remote forwarding;
- debugger/task execution authority;
- terminal-issued production operations.

Each requires its own authority/privacy/reliability review.

## 6. Acceptance evidence package

A future implementation PR/checkpoint should attach an evidence manifest with exact SHAs and commands/results for:

- base and implementation lineage;
- package/dependency diff;
- type/syntax checks;
- protocol unit + fuzz/negative tests;
- PTY host integration tests;
- Electron packaged native-module smoke;
- Linux/macOS PTY matrix where supported;
- Windows ConPTY matrix;
- output flood/backpressure benchmark with peak memory and interaction latency;
- resize/TUI matrix;
- UTF-8 split-boundary fuzz;
- process-tree cleanup evidence;
- renderer mount/unmount leak counters;
- static checks showing no second scheduler, no production enablement, no generic execute bridge and no arbitrary eval;
- exact critic/falsifier dispositions.

The acceptance artifact must distinguish `VERIFIED`, `PARTIAL_UNVERIFIED`, and `NOT_TESTED` per platform. Missing platform proof is not parity.

## 7. Current synthesis verdict

**Architecture convergence:** sufficient for the smallest implementation order.

**Implementation authorization:** **NO-GO** because `G0_MONACO_IMPLEMENTED` is not proven.

**Review/falsification completeness:** **PENDING** because critic/falsifier Git refs were not visible during synthesis.

**Safe next action:** obtain objective Monaco implementation evidence and independent PTY critic/falsifier artifacts, then execute `S1 -> S2 -> S3 -> S4 -> S5 -> S6` on the exact reviewed lineage. Do not start by installing xterm.js/node-pty or creating a second terminal backend in parallel.

## 8. Advisory upstream facts used to resolve design conflicts

Current upstream documentation was consulted only as non-authoritative technical reference:

- xterm.js exposes renderer `onData`, `onResize`, asynchronous `write`, and `Uint8Array` writes; FitAddon computes terminal grid dimensions.
- node-pty supports Unix PTYs and Windows ConPTY, exposes `onData`, `onExit`, `write`, `resize`, `pause` and `resume`, warns that children inherit parent privileges, and warns the package is not thread-safe.
- Windows and Unix differ in teardown/process-tree mechanics, so parity is a behavior/test target rather than an assumption.

These facts can inform implementation and tests but cannot override the DevOS authority/fencing contracts or GitHub implementation evidence.