# DEVOS IDE xterm.js + bounded PTY dependency plan V1

Date: 2026-08-31

Task fence:

- `agent_id=agent_51d8cebc-c716-493a-8f66-abcd9a8fb802`
- `role=PLANNER`
- `task_id=bd576238-04f0-4d07-aff3-7695744bc497`
- `lease_generation=1`
- `base_sha=84a71aaedc49186c24a992f507ca1d3f14767181`
- `target_branch=work/devos-ide-pty-plan-v1`

## 1. Scope and authority

This checkpoint is advisory planning only. It does not add xterm.js, node-pty, a shell/process capability, production authority, or any runtime mutation.

Repository/page/model/worker/web text is treated as untrusted data with zero authority. No repository text, terminal output, model response, web page, shell prompt, or PTY byte stream may grant capabilities, select a privileged executable, change workspace identity, relax a fence, authorize a retry, or promote production.

Hard invariants:

- no arbitrary `eval` / `Function` / dynamic code loading as a privileged IPC path;
- no renderer Node integration or raw `ipcRenderer`/`child_process`/`fs` exposure;
- no arbitrary renderer-supplied executable, command line, cwd, absolute path, environment, signal, PID, or process-tree selector;
- every process is bound to one exact workspace identity and workspace generation;
- PID is diagnostic only and is never process identity;
- input is a non-idempotent effect and is never blindly replayed after an ambiguous outcome;
- stale workspace/session/process/host generations fail closed;
- development PTY has zero direct production-promotion authority and receives no production credentials by default;
- no main merge or production promotion in this slice.

## 2. Authoritative planning observations

At planning time:

1. `integration/metaengine-development-os-v1` is exactly at the supplied base `84a71aaedc49186c24a992f507ca1d3f14767181`.
2. The exact-base Browser package has Electron `44.0.0`, Node `>=24`, and no xterm.js or node-pty dependency yet.
3. Exact-base IDE shell research already requires a host-issued workspace capability `{workspaceId, rootUri, generation, trustState}`, canonical containment, typed narrow IPC, restricted workspaces by default, and no raw filesystem/process authority in the renderer.
4. A prior DEVOS IDE backlog orders stages `MONACO -> XTERM_PTY -> TREE_SITTER -> LSP -> CODE_KNOWLEDGE_GRAPH -> R10` and defines `G_XTERM_PTY` as dependent on `G_MONACO`.
5. No authoritative Monaco implementation checkpoint was proven during this planning pass. Therefore PTY activation remains **BLOCKED_ADVISORY**. Absence of evidence is not treated as evidence of absence; implementation must re-probe before starting.
6. A separate workspace-manager branch demonstrates useful claim-bound worktree and no-blind-retry patterns, but it is not automatically assumed to be on the Monaco/PTTY integration lineage. Reuse requires an explicit lineage/diff probe.

## 3. Activation gate: `G_MONACO_IMPLEMENTED`

PTY implementation may start only when all of the following are proven on the intended integration lineage:

- Monaco shell/assets load locally without remote code/eval;
- host-issued workspace identity and workspace generation are implemented;
- document/resource identity is canonical and workspace-scoped;
- trusted-shell sender validation and typed preload/host bridge are present;
- save/write boundary retains conflict/ambiguous-effect rules;
- renderer remains sandboxed with `nodeIntegration:false` and `contextIsolation:true`;
- Monaco integration tests/build proof are green;
- an exact implementation commit/checkpoint is available for the PTY implementer to base/rebase onto.

Until then all points below are `BLOCKED_ADVISORY`; planning/docs/tests that do not instantiate a PTY are allowed.

## 4. Smallest target architecture

```text
Sandboxed DevOS IDE renderer
  Monaco + xterm.js UI only
          |
          | narrow typed terminal facade
          v
Trusted preload / main PTY broker
  - sender validation
  - schema/size validation
  - workspace/session fencing
  - quotas and policy
          |
          | typed MessagePort/IPC
          v
Dedicated Electron utility process: PTY Host
  - node-pty native module
  - host generation
  - session registry
  - raw-byte framing
  - output ring buffers
  - backpressure
  - exit receipts
  - process containment adapter
          |
          v
OS PTY
  Unix PTY / Windows ConPTY
          |
          v
Workspace-scoped interactive shell process tree
```

Why this shape:

- xterm.js remains a renderer-only terminal emulator; it never receives process authority.
- The Browser main process does not own native PTY state directly. A crash/leak-prone native addon is isolated in a utility process.
- The PTY host is a capability consumer, not a second scheduler or task authority.
- Workspace identity is inherited from the Monaco/workspace contract rather than duplicated.
- The process/session protocol is independently fuzzable and can be disabled without changing the rest of the IDE.

## 5. Exact identity model

### 5.1 Workspace reference

```ts
type WorkspaceRef = {
  workspaceId: string;          // opaque host-issued ID
  workspaceGeneration: number; // increments when binding/root incarnation changes
};
```

The renderer never supplies an absolute cwd. The PTY broker resolves cwd from the current trusted workspace binding and revalidates canonical containment at spawn time.

### 5.2 PTY session reference

```ts
type PtySessionRef = {
  workspaceId: string;
  workspaceGeneration: number;
  ptyHostGeneration: number;
  sessionId: string;            // opaque host-issued ID
  sessionGeneration: number;    // increments only on a new session incarnation
  processIncarnationId: string; // opaque random/monotonic host-issued process identity
};
```

`pid` may be returned for diagnostics, but no subsequent request is authorized by PID.

Every mutating request must carry the full current `PtySessionRef`. Missing or stale fields return a typed stale-fence refusal with no effect.

### 5.3 Transport epoch

Renderer attach/re-attach is separately identified by a `transportEpoch`. Transport replacement must not mutate process identity. A newly attached renderer proves the exact current session reference before it can send input or resize.

## 6. Session state machine

Minimum states:

```text
ALLOCATED
  -> SPAWNING
      -> RUNNING
      -> SPAWN_FAILED_NO_EFFECT
      -> SPAWN_AMBIGUOUS_NO_RETRY
RUNNING
  <-> BACKPRESSURED
  -> EXIT_SEEN
  -> ORPHANED_WORKSPACE
  -> HOST_LOST
EXIT_SEEN
  -> EXITED
ORPHANED_WORKSPACE
  -> EXITED
HOST_LOST
  -> terminal tombstone only; never auto-respawn
```

Rules:

- `SPAWN_AMBIGUOUS_NO_RETRY` cannot transition back to `SPAWNING` by replaying the same create request.
- `HOST_LOST` invalidates every old `ptyHostGeneration`; no input/resize/terminate request may target an old host generation.
- Workspace generation replacement makes all sessions on the previous generation non-interactive immediately and initiates bounded termination.
- A new terminal after crash/rebind always gets a new `sessionId/sessionGeneration/processIncarnationId`; it is never represented as continuation of an uncertain old process.

## 7. Typed protocol V1

All envelopes carry `schema`, `protocolVersion`, `requestId`, payload byte length, and explicit authority classification. Unknown message types/fields or oversized payloads fail closed.

### 7.1 Create

```ts
PTY_SESSION_CREATE {
  workspace: WorkspaceRef;
  profileId: string;          // host-owned allowlisted terminal profile
  cols: number;
  rows: number;
  envProfileId?: string;      // host-owned policy ID, not arbitrary env values
}
```

Response:

```ts
PTY_SESSION_CREATED {
  ref: PtySessionRef;
  pid: number;                // diagnostic only
  cwdResourceUri: string;     // canonical workspace projection, not raw authority
  startedAt: string;
  initialOutputSeq: number;
}
```

V1 intentionally has **no** renderer-supplied `executable`, `argv`, command string, shell flags, absolute cwd, uid/gid, inherited fd list, or raw environment object. `profileId` resolves inside trusted host configuration.

### 7.2 Input

```ts
PTY_INPUT {
  ref: PtySessionRef;
  transportEpoch: number;
  inputSeq: number;
  data: Uint8Array;
  source: 'LOCAL_TERMINAL_UI';
}
```

Rules:

- monotonic `inputSeq` per transport epoch;
- duplicate `inputSeq` is rejected as `DUPLICATE_NO_EFFECT` rather than replayed;
- a gap is rejected and requires typed re-attach/resync;
- the host validates current workspace/session/process/host fence before one call to PTY write;
- a response that is lost after the write is **ambiguous**; the renderer must not retry the same input automatically;
- an ACK means only that the host accepted/invoked the PTY write under the exact fence, not that the child shell executed the bytes;
- terminal/repository/model output can never synthesize an authorized input request by itself.

### 7.3 Output

```ts
PTY_OUTPUT {
  ref: PtySessionRef;
  transportEpoch: number;
  outputSeq: number;
  byteOffset: number;         // cumulative per-session raw-byte offset
  data: Uint8Array;
}
```

Output is transported as bytes, not implicitly decoded JS text. xterm.js receives `Uint8Array` directly. This avoids corrupting split multibyte UTF-8 sequences and keeps flow-control accounting in bytes.

### 7.4 Output ACK / backpressure

```ts
PTY_OUTPUT_ACK {
  ref: PtySessionRef;
  transportEpoch: number;
  ackOutputSeq: number;
  ackByteOffset: number;
}
```

The renderer sends the ACK only from the completion callback of `terminal.write(...)`, not when the message merely arrives.

Host tracks cumulative unacknowledged bytes and pauses node-pty reads when the high-water mark is crossed; it resumes only after the low-water mark is reached. Use `pty.pause()/resume()` for transport backpressure rather than injecting XON/XOFF bytes into the shell data stream.

Candidate V1 constants, centralized and test-tunable rather than scattered magic numbers:

- output frame target: `<= 32 KiB`;
- high-water unacked bytes: `1 MiB`;
- low-water unacked bytes: `256 KiB`;
- hard in-memory output ring per session: `4 MiB`;
- input frame maximum: `64 KiB`;
- max active sessions per workspace: `4`;
- max active sessions per PTY host: `16`.

These are initial safety defaults, not permanent product limits. An implementation may change them only with benchmark/failure evidence while preserving a hard bound.

### 7.5 Resize

```ts
PTY_RESIZE {
  ref: PtySessionRef;
  transportEpoch: number;
  resizeSeq: number;
  cols: number;
  rows: number;
  pixelWidth?: number;
  pixelHeight?: number;
}
```

Rules:

- positive integer validation and centralized hard maxima;
- renderer coalesces rapid FitAddon/layout updates and sends only the newest pending size;
- host applies only strictly newer `resizeSeq` for the current transport epoch;
- after an ambiguous response, reconnect/readback current host dimensions and send the **latest desired size**, not a blind replay of an old resize event;
- Windows ignores pixel dimensions when the PTY backend cannot use them; this must be explicit in the receipt, not silently treated as parity.

Suggested initial safety range: `cols 2..1000`, `rows 1..500`; resize application rate should be bounded (target <=20 host resize calls/sec with a guaranteed final flush).

### 7.6 Attach / renderer crash recovery

```ts
PTY_ATTACH {
  ref: PtySessionRef;
  previousTransportEpoch?: number;
  lastAckOutputSeq?: number;
  lastAckByteOffset?: number;
  desiredCols: number;
  desiredRows: number;
}
```

If the exact session is still alive in the same `ptyHostGeneration`, host creates a new transport epoch and replays missing output only if the requested offset remains inside the bounded ring.

If the ring no longer contains the gap, return `TRANSCRIPT_GAP`; do not fabricate terminal history. V1 may reset the xterm view and continue the live session with a visible gap marker. Full screen-state serialization is a later optional slice, not required for the first bounded PTY integration.

### 7.7 Terminate

```ts
PTY_TERMINATE {
  ref: PtySessionRef;
  reason: 'USER_REQUEST' | 'WORKSPACE_CLOSED' | 'WORKSPACE_REBOUND' | 'HOST_SHUTDOWN';
}
```

The renderer does not supply arbitrary signals. Host chooses a platform policy (graceful request where supported, bounded grace period, then tree cleanup). A stale reference has no effect.

### 7.8 Exit receipt

```ts
PTY_EXITED {
  ref: PtySessionRef;
  exitCode: number | null;
  signal: number | null;
  reason:
    | 'PROCESS_EXIT'
    | 'USER_TERMINATE'
    | 'WORKSPACE_CLOSED'
    | 'WORKSPACE_REBOUND'
    | 'SPAWN_FAILED'
    | 'BACKPRESSURE_FAULT'
    | 'PTY_HOST_LOST';
  finalOutputSeq: number;
  finalByteOffset: number;
  treeCleanup: 'VERIFIED' | 'PARTIAL_UNVERIFIED' | 'NOT_APPLICABLE';
  observedAt: string;
}
```

`finalOutputSeq/finalByteOffset` represent the final output observed and admitted by the PTY host before terminal finalization. The implementation must preserve backend-specific late-output behavior rather than assuming the child exit event is always the last data event.

## 8. Workspace binding and environment policy

### 8.1 CWD

- derive cwd from the current trusted workspace binding;
- re-resolve canonical path immediately before spawn;
- reject if workspace generation is stale/closed/replaced;
- do not use string-prefix containment;
- do not accept repository-provided absolute cwd;
- terminal session is invalidated when workspace generation changes.

### 8.2 Environment

node-pty children run with the permission level of their parent. Therefore cwd scoping alone is not a security boundary.

V1 requires a host-owned environment policy:

- explicit allowlist/minimal inheritance for shell compatibility (`PATH`, `HOME`/user profile, locale, `TERM`, required Windows system variables, etc.);
- inject only IDE-owned terminal metadata explicitly;
- strip supervisor/browser/update/database/GitHub/CI credentials and generic secret-bearing variables by default;
- repository files/settings and terminal output cannot add env vars;
- any future secret injection requires a separate explicit capability and is outside this slice.

## 9. PTY host process isolation

Use a dedicated Electron `utilityProcess` once Electron readiness is established. The PTY host owns node-pty and native handles. Main process owns only policy/fencing/routing.

Benefits:

- native PTY crash/hang is separated from the Browser main process;
- restart gives a new `ptyHostGeneration`, invalidating stale refs exactly;
- one PTY event loop owns node-pty, avoiding cross-worker thread-safety assumptions;
- renderer remains sandboxed and cannot load native modules.

The implementation must add a native-module packaging/ABI smoke for Electron 44 and the selected node-pty version. Do not assume a Node prebuild is valid inside the packaged Electron application.

## 10. Process-tree containment

A "bounded PTY" claim requires proving that closing a session/host does not leave an uncontrolled process tree.

Required adapter contract:

```ts
interface PtyProcessContainment {
  bind(ref: PtySessionRef, rootPid: number): Promise<ContainmentReceipt>;
  terminate(ref: PtySessionRef, policy: TerminationPolicy): Promise<TreeCleanupReceipt>;
}
```

Platform intent:

- Unix: prove process-group/session containment and bounded TERM -> KILL cleanup without targeting unrelated processes.
- Windows: prove ConPTY/process-tree cleanup. Prefer a verified Job Object with kill-on-close semantics if implementation evidence supports it; do not assume `node-pty.kill(signal)` provides Unix-like tree semantics because Windows signal behavior differs.

If full tree cleanup cannot be proven on a platform, exit receipts must say `PARTIAL_UNVERIFIED` and the slice must not be called fully bounded on that platform.

## 11. Crash recovery semantics

### Renderer crash / reload

- PTY host survives;
- renderer obtains current session refs from trusted broker;
- exact attach creates a new transport epoch;
- missing output is replayed only from bounded in-memory ring;
- no terminal input is replayed.

### PTY host crash

- main observes utility-process exit;
- increment `ptyHostGeneration` before accepting a new host;
- every old session becomes `HOST_LOST` / tombstoned;
- do not attach to an OS PID to impersonate the lost exact process incarnation;
- do not auto-respawn old shells;
- do not replay old input;
- best-effort process containment cleanup is reported separately.

### Browser/main restart

Persist a tiny metadata journal outside the workspace, not terminal transcript by default. The journal is sufficient to identify sessions that were not cleanly finalized and mark them `PTY_HOST_LOST` on restart. It must never authorize process reattachment or input replay.

### Spawn ambiguity

The create path should have a durable local spawn-intent record before the native effect. If the host crashes/transport is lost after spawn but before a trustworthy created receipt, mark `SPAWN_AMBIGUOUS_NO_RETRY`. A repeated UI action creates a **new** session identity; it does not replay the uncertain spawn request.

## 12. Terminal transcript privacy

V1 does not persist terminal output by default. Output ring buffers are in-memory, bounded, and destroyed on final session cleanup/host restart. This avoids accidentally durably storing secrets printed by developer tools.

A future persistent terminal feature must be separately designed with user-visible retention, redaction/encryption, quotas, and provenance. It is not required for crash-safe exact identity.

## 13. Dependency-ordered implementation slices

### P0 — Gate and lineage proof (`BLOCKED` now)

Dependencies: none.

Before code, prove `G_MONACO_IMPLEMENTED` and choose the exact Monaco integration SHA. Re-probe whether workspace-manager contracts are already integrated; never blindly cherry-pick a divergent manager.

Exit evidence: exact source SHA + Monaco tests/build + workspace capability contract.

### P1 — Typed PTY contracts and state-machine tests

Dependencies: P0.

Add only protocol schemas/types/validators/state machine. No xterm/node-pty spawn yet.

Must define exact fences, message sizes, stale/replay behavior, ambiguity states, exit receipts, quotas, and host generation.

Exit evidence: contract/property/negative tests.

### P2 — xterm renderer-only surface

Dependencies: P1.

Add local xterm.js assets/package and a terminal view that only talks to the typed preload facade. No Node APIs and no native module in renderer.

Lifecycle covers open/dispose, attach state, resize observation, output write callback ACK, and visible exit/gap state.

Exit evidence: renderer lifecycle tests + CSP/build proof.

### P3 — Dedicated PTY host + node-pty load smoke

Dependencies: P1. Can run in parallel with P2.

Add utility-process PTY host, host generation, allowlisted profile resolution, native node-pty load/ABI smoke, and fake-backend contract tests before real shell lifecycle tests.

Exit evidence: Electron 44 packaged/dev smoke on Windows plus Unix CI where available; no renderer/main native ownership.

### P4 — Workspace-bound spawn/exit lifecycle

Dependencies: P3 + Monaco workspace capability from P0.

Implement host-derived cwd, env policy, session/process incarnation, spawn-intent journal, process containment binding, exit receipts, stale workspace rejection, and bounded termination.

No xterm integration required to validate this slice.

Exit evidence: process lifecycle, stale generation, environment-secret exclusion, ambiguous spawn, process-tree cleanup tests.

### P5 — Input/output/resize/backpressure integration

Dependencies: P2 + P4.

Wire raw-byte output frames, `terminal.write` completion ACKs, pause/resume watermarks, monotonic one-shot input, resize coalescing/readback, and exact transport epochs.

Exit evidence: high-throughput flood tests, Unicode split-boundary tests, input replay negatives, resize stress tests, bounded-memory evidence.

### P6 — Renderer crash attach/replay

Dependencies: P5.

Add bounded output ring and attach protocol. Prove renderer reload can continue an alive exact session when the gap is present and fails visibly with `TRANSCRIPT_GAP` when it is not.

Exit evidence: renderer kill/reload failure-injection tests.

### P7 — PTY host/browser crash seal and parity matrix

Dependencies: P6.

Prove host crash creates a new host generation, old refs are unusable, no shell/input is auto-replayed, unclean sessions become tombstones, and process trees are cleaned or explicitly reported `PARTIAL_UNVERIFIED`.

Run Windows ConPTY and Unix PTY parity acceptance.

Exit evidence: branch-local checkpoint + exact CI jobs/artifacts for supported platforms.

### Dependency DAG

```text
G_MONACO_IMPLEMENTED
        |
        P1
       /  \
     P2    P3
       \    |
        \   P4
         \ /
          P5
          |
          P6
          |
          P7
```

## 14. Acceptance matrix

| ID | Requirement | Required evidence | Fail-closed expectation |
| --- | --- | --- | --- |
| A0 | Monaco dependency gate | exact Monaco SHA + green integration/build tests + workspace capability | PTY stays disabled/advisory |
| A1 | Renderer isolation | BrowserWindow/preload contract test; no Node/native imports in renderer | no PTY facade exposure on untrusted sender |
| A2 | Exact workspace binding | create with current `workspaceId+generation`; canonical cwd readback | stale/replaced generation refuses spawn/input |
| A3 | No arbitrary spawn API | protocol schema has host `profileId` only | executable/argv/cwd/env fields rejected |
| A4 | Secret-safe environment | fixture injects token/key vars into parent; child env probe | forbidden vars absent; no fallback to full `process.env` |
| A5 | Exact session/process identity | mutate each ref field independently | every stale field refuses effect; PID cannot substitute identity |
| A6 | Host-generation fencing | restart PTY host, reuse old ref | old ref rejected; new host never adopts old process identity |
| A7 | Spawn ambiguity | fault after native spawn boundary before created receipt | state `SPAWN_AMBIGUOUS_NO_RETRY`; same request not replayed |
| A8 | Input non-idempotence | duplicate/lost-response injection around one input frame | duplicate rejected; no automatic resend |
| A9 | Output byte integrity | split UTF-8/escape sequences across arbitrary frame boundaries | xterm receives exact byte stream in order |
| A10 | Output ACK semantics | delay xterm `write` completion callback | host in-flight accounting does not advance early |
| A11 | Backpressure | flood output (`yes`/generated bytes) while renderer slowed | host pauses/resumes; memory remains under configured hard bound |
| A12 | Backpressure recovery | renderer resumes after prolonged pause | ordered output continues without duplicate frames |
| A13 | Resize correctness | rapid 1k resize events; platform readback | bounded host resize rate; final dimensions equal latest request |
| A14 | Resize stale fence | resize after workspace/session/transport generation changes | no effect |
| A15 | Exit/output ordering | command emits tail output immediately before exit | exit receipt has final admitted output seq/offset and no later accepted frame for same incarnation |
| A16 | Renderer crash recovery | kill/reload renderer with PTY host alive | exact attach + bounded replay; no input replay |
| A17 | Transcript gap | produce >ring output while renderer absent | typed visible `TRANSCRIPT_GAP`; no fabricated history/unbounded memory |
| A18 | PTY host crash | kill utility process during active shell | new host generation; old sessions tombstoned; no auto-respawn |
| A19 | Browser restart | restart app with unfinalized metadata journal | old sessions shown lost/closed; no PID reattach or input replay |
| A20 | Workspace rebind/close | replace generation while process alive | input immediately refused; bounded termination begins |
| A21 | Unix tree cleanup | shell spawns nested child/grandchild, then terminate/host close | exact session tree gone; unrelated process survives |
| A22 | Windows ConPTY tree cleanup | nested PowerShell/cmd child tree then terminate/host close | tree cleanup `VERIFIED`, or slice explicitly remains partial/unbounded |
| A23 | ConPTY/Unix parity | same echo/Unicode/resize/exit fixture | typed protocol semantics match; platform exceptions explicit |
| A24 | Session quotas | attempt `limit+1` sessions and oversized frames | typed quota rejection before spawn/allocation |
| A25 | Native ABI/package | packaged Electron 44 launches PTY host and loads node-pty | packaging/ABI mismatch fails CI; no runtime fallback to unsafe spawn |
| A26 | PTY host lifecycle leak | terminate final Windows PTY and request utility-host shutdown | utility process exits within bounded test deadline; leaked native handles fail CI |
| A27 | Transcript privacy | inspect app state after normal/crash shutdown | terminal bytes not persisted by default |
| A28 | Production authority isolation | inspect child env/capabilities and privileged action routes | no supervisor/update/database/CI production credentials or promotion API |
| A29 | No duplicate scheduler | architecture/static contract review | PTY host only reacts to typed session requests; no task polling/dispatch loop |
| A30 | No arbitrary eval | static scan + protocol negative tests | no `eval`/`Function`/generic command RPC authority introduced |

## 15. Cross-platform parity expectations

Common semantic contract on Windows and Unix:

- same workspace/session/process/host fencing;
- same input sequence/replay rules;
- same raw output sequence and byte accounting;
- same ACK-driven host backpressure semantics;
- same terminal attach/transcript-gap behavior;
- same exit reason vocabulary;
- same no-auto-respawn crash policy;
- same environment/production credential policy.

Allowed explicit platform differences:

- ConPTY vs Unix PTY native backend;
- Windows signal/termination implementation;
- pixel resize metadata support;
- platform shell profile selection;
- process containment adapter internals.

Platform differences must be represented in typed receipts/capabilities, not inferred in renderer code from terminal output.

## 16. Dependency/reuse decisions

### Reuse

- Monaco/workspace host-issued identity and generation contract.
- existing trusted-shell sender validation and sandboxed preload pattern.
- existing Development Plane principle of narrow allowlisted capabilities and `arbitrary_eval:false`.
- existing no-blind-retry/ambiguous-effect patterns and exact incarnation fencing.
- workspace-manager tests/patterns only after explicit lineage comparison.

### Do not add

- a second generic privileged backend;
- renderer Node integration;
- generic `runCommand(string)` / `spawn(file,args,env,cwd)` IPC;
- task polling/scheduling inside PTY host;
- durable terminal transcript by default;
- automatic shell restoration after Browser/PTY-host crash;
- PID-based recovery;
- automatic replay of terminal keystrokes;
- terminal-output-driven capability escalation.

## 17. Current upstream research notes (non-authoritative inputs)

Retrieved 2026-08-31 for architecture comparison only; these sources do not override repository/DB authority:

- xterm.js current API provides asynchronous `terminal.write(data, callback)` and warns that synchronous write semantics are unreliable; use the callback as the renderer parse/write completion point for ACK accounting.
- xterm.js output buffering requires an application-level flow-control scheme when the producer can outrun the renderer.
- node-pty supports Linux/macOS and modern Windows through ConPTY; current typings expose raw-byte mode via `encoding:null`, resize, `pause()/resume()`, and exit events.
- node-pty warns that spawned processes run at the parent permission level, reinforcing the need for environment/credential isolation and process containment.
- node-pty is not thread-safe; keep ownership in one PTY utility-process event loop.
- current node-pty Windows code intentionally keeps reading briefly after the shell exit to flush late ConPTY output; final exit receipts must not assume exit callback and final data are trivially simultaneous.
- a 2026 upstream Windows issue reports native handles keeping Node alive after PTY kill in a beta line; therefore A26 is mandatory before version adoption.
- Electron recommends renderer sandbox/context isolation and provides `utilityProcess` for crash-prone/native Node components.

Reference URLs:

- https://github.com/xtermjs/xterm.js
- https://xtermjs.org/
- https://github.com/microsoft/node-pty
- https://www.electronjs.org/docs/latest/tutorial/process-model
- https://www.electronjs.org/docs/latest/api/utility-process
- https://www.electronjs.org/docs/latest/tutorial/security

## 18. Planner conclusion / handoff

The smallest safe PTY slice is **not** "add xterm + spawn shell". It is:

1. prove Monaco/workspace implementation lineage;
2. seal exact typed session/process/host contracts before native spawn;
3. mount xterm as renderer-only UI in parallel with an isolated PTY host;
4. bind every session to current workspace generation and host-owned shell/env profiles;
5. stream raw bytes with explicit sequence + xterm-completion ACK backpressure;
6. treat input as non-idempotent/no-retry;
7. emit explicit exit receipts and invalidate sessions across workspace/host generations;
8. recover renderer crashes through bounded in-memory replay, but never auto-respawn or replay input after PTY-host/Browser loss;
9. prove process-tree cleanup and Electron-44 native-module lifecycle on each supported platform before claiming the PTY is bounded.

Current status at this checkpoint: **PLAN_READY / IMPLEMENTATION_BLOCKED_ON_MONACO_EVIDENCE**.
