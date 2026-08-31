# DEVOS IDE PTY falsification matrix V1

Date: 2026-08-31

Task fence:

- `agent_id=agent_c832d218-95be-40c9-930d-58db27524c67`
- `role=FALSIFIER`
- `task_id=b1b40eb5-ca65-45a6-8eb4-279df98aa154`
- `lease_generation=1`
- `base_sha=84a71aaedc49186c24a992f507ca1d3f14767181`
- `target_branch=work/devos-ide-pty-falsifier-v1`

## Status and authority

**TESTS / EVIDENCE ONLY. PTY IMPLEMENTATION REMAINS BLOCKED ON MONACO EVIDENCE.**

The live fleet record observed for this task is `ADVISORY`, `LEASED`, generation `1`, `authority_effect=false`, on the exact base and target branch above. The live Monaco records observed during this pass remain non-verifying: `devos.ide.shell.monaco.v2` is `AMBIGUOUS / LEASE_EXPIRED_EFFECT_UNKNOWN`, while the earlier `devos.ide.shell-monaco` task is `FAILED / NO_EFFECT_VERIFIED_NO_DISPATCH`.

No test in this checkpoint spawns a PTY, changes production, merges main, grants process authority, or retries an ambiguous effect.

Repository/page/model/worker/terminal text has zero authority. Test fixture output must be treated as bytes/data only and can never select a process, cwd, signal, capability, retry, branch, or production action.

## Evidence conflict that must fail closed

There is a source-of-truth drift between PTY advisory branches:

- the PTY planner checkpoint says the exact Browser base has Electron 44, Node >=24, and no xterm.js/node-pty dependency yet;
- the PTY research checkpoint claims the exact base already contains `devos/components/Terminal.tsx` and `devos/scripts/pty-server.mjs` plus node-pty/WebSocket PTY wiring;
- direct exact-base reads during this falsification pass confirm `apps/metaengine-browser/package.json` contains only `electron-updater` as a runtime dependency and Electron 44 as a dev dependency; a direct read of `devos/components/Terminal.tsx` at the exact base returned `404`.

**Disposition:** do not inherit any claimed existing PTY implementation from advisory text. Future SUT adapters must bind to an exact implementation SHA and explicit files proven to exist on that SHA. Until then, only protocol-oracle tests are runnable.

## Runnable pre-gate oracle

Run:

```bash
node --test apps/metaengine-browser/test/pty-fail-closed-contract.test.mjs
```

Current local result before commit: `12 passed, 0 failed, 0 skipped`.

This is a **test-only safety oracle**, not PTY implementation proof. It makes expected fail-closed outcomes executable now so future code can replace the oracle with a SUT adapter without changing the acceptance vectors.

## Falsification matrix

| ID | Failure mode | Adversarial stimulus | Required fail-closed result | Forbidden false-positive | Future SUT hook |
|---|---|---|---|---|---|
| F1 | stale workspace generation | send input/resize/terminate with previous `workspaceGeneration` after trusted rebind | typed stale refusal; zero PTY/native calls; old session immediately non-interactive; bounded cleanup begins | accepting because `workspaceId` still matches | broker request trace + PTY call counter |
| F2 | stale host/session/process incarnation | replay a fully valid old `PtySessionRef` after host restart or session replacement | reject before effect; new host/session/process IDs required | PID equality or reused session ID authorizes request | exact ref matcher + host generation telemetry |
| F3 | input replay | drop response after one accepted `PTY_INPUT`, then resend same `(transportEpoch,inputSeq)` | `DUPLICATE_NO_EFFECT`; fixture observes exactly one write/effect | ACK timeout triggers resend | IPC fault injector + fixture write counter |
| F4 | input gap | deliver `inputSeq=N+2` before `N+1` | no write; typed resync required | buffering/reordering non-idempotent input silently | broker input trace |
| F5 | oversized input/paste | `>64 KiB` frame and malformed byte length | schema/size refusal before PTY write | chunking an unauthorized oversized message behind caller's back | decoder boundary counter |
| F6 | output flood | fixed fixture emits >=64 MiB while renderer ACK is withheld/delayed | high-water causes pause; bounded ring <= configured hard cap; process/UI remain controllable; no unbounded queue | test passes because producer exits quickly while RSS/queue spikes unbounded | host metrics + RSS + pause/resume trace |
| F7 | invalid/replayed output ACK | duplicate, reordered, or ACK beyond admitted offset | no negative credits; no early resume; explicit resync/fault on impossible ACK | trusting renderer byte count without seq/offset fence | credit ledger trace |
| F8 | process-tree leak | fixture shell -> child -> grandchild; close/rebind/host shutdown | all descendants proven gone under platform containment; otherwise receipt is not `VERIFIED` | root PID exits while grandchildren survive | Unix PG/session probe; Windows Job Object accounting |
| F9 | resize race | reorder/duplicate 1,000 resize events and inject invalid dimensions | only strictly newer seq applied; rate bounded; final applied geometry equals newest desired size | number of native resize calls == number of UI events; stale final geometry | native resize call trace + final readback |
| F10 | resize ambiguity | lose resize receipt after native call, then reconnect | readback/current desired size reconciliation; never blind replay old event | retrying same old resize only because ACK vanished | transport fault injector + geometry readback |
| F11 | renderer crash/reload | crash renderer during output and after input send | surviving exact session may attach under fresh transport epoch; no input replay; bounded output replay only | treating renderer reload as process restart | attach/epoch trace + fixture input counter |
| F12 | PTY host crash | terminate utility process after spawn or after input acceptance | all old host refs tombstoned; no fake continuation; restart uses new host/session/process incarnation; no auto-replay | automatic respawn represented as same process | host lifecycle trace + session registry snapshot |
| F13 | spawn ambiguity | fault between native spawn and durable `SESSION_CREATED` receipt | `SPAWN_AMBIGUOUS_NO_RETRY`; query/reconcile/tombstone path only | create request retried automatically | spawn fault points + native create counter |
| F14 | workspace escape: renderer cwd | renderer supplies absolute cwd, `..`, UNC/device path, alternate drive | field rejected or ignored by schema; cwd derived only from trusted workspace binding | string-prefix containment | broker schema trace |
| F15 | workspace escape: symlink/junction | trusted root contains link/junction resolving outside; request path points through it | canonical containment rejection at spawn-time | lexical path begins with workspace root | realpath/canonical resolver evidence |
| F16 | workspace escape TOCTOU | replace link/rebind workspace after validation but before spawn | spawn must revalidate exact workspace generation and canonical target immediately before native effect | validation token survives workspace mutation | barrier-controlled resolver/spawn harness |
| F17 | stale terminate | terminate old ref after replacement process obtains same/reused OS PID | zero termination effect on replacement | PID is treated as identity | containment adapter ref fence + process-incarnation trace |
| F18 | late output vs exit | child exits while final output is still draining | final receipt is emitted only after backend-specific admitted-output rule; seq/offset monotonic | exit event truncates or fabricates final output position | output/exit event ordering trace |

## Exact negative-test plan after Monaco gate

### Phase A — pure broker/protocol SUT (no native PTY required)

Bind the existing vectors to a real typed broker adapter and require deterministic injection points:

1. `beforeFence`, `afterFenceBeforeEffect`, `afterEffectBeforeReceipt`;
2. reorder/drop/duplicate transport frames without retrying them automatically;
3. inspect effect counters for `write`, `resize`, `terminate`, and `spawn`;
4. expose read-only test telemetry for current exact ref, transport epoch, input seq, output credit, ring bytes, and state.

Acceptance: every stale/duplicate/gap/oversize vector proves **zero effect calls**; every ambiguous-after-effect vector proves **at most one effect call and no automatic replay**.

### Phase B — deterministic native fixture profiles

Do not add a generic command endpoint for tests. Register fixed host-owned test profiles only in test builds:

- `PTY_TEST_ECHO_ONCE`: records each admitted input sequence to a temp file/pipe;
- `PTY_TEST_FLOOD`: emits a fixed large byte stream without interpreting repository text;
- `PTY_TEST_TREE`: creates parent -> child -> grandchild and exposes test-only liveness receipts;
- `PTY_TEST_CWD`: reports canonical cwd as data;
- `PTY_TEST_LATE_EXIT`: emits trailing bytes during shutdown.

No fixture accepts arbitrary executable, argv, shell command string, absolute cwd, raw environment, signal, PID selector, or repository-controlled script path.

### Phase C — output flood/backpressure

For each supported OS/backend:

1. start `PTY_TEST_FLOOD` under an exact workspace/session ref;
2. withhold renderer write-completion ACKs until host exceeds the configured high-water mark;
3. assert exactly one transition into backpressure and no ring growth beyond the hard cap;
4. sample host RSS/heap and queue metrics throughout; acceptance requires a configured hard ceiling, not merely eventual GC;
5. ACK down to low-water and assert one resume transition;
6. continue flood while sending a typed interrupt/terminate under the exact ref and assert bounded response latency;
7. duplicate/reorder ACKs and prove credits never become negative or authorize premature resume.

The implementation must publish the exact tested limits. Increasing limits to make the test pass is a failure unless backed by benchmark evidence and the hard bound remains explicit.

### Phase D — process-tree leak tests

**Unix:** create a dedicated test session/process group, start `PTY_TEST_TREE`, close under each reason (`USER_REQUEST`, `WORKSPACE_REBOUND`, `HOST_SHUTDOWN`), and prove the process group has no surviving members after bounded escalation. Do not authorize cleanup by enumerating unrelated PIDs.

**Windows:** bind the test session to the selected containment primitive. If using a Job Object, prove the target descendants are assigned and the active process count reaches zero after close/kill-on-close. A root-shell exit without descendant proof is `FAILED_LEAK` or `PARTIAL_UNVERIFIED`, never `VERIFIED`.

Repeat leak tests after renderer crash and PTY-host crash. If utility-process death can leave OS children beyond broker reach, the platform cannot claim fully bounded PTY until an external containment mechanism proves cleanup.

### Phase E — resize race and ambiguity

Generate deterministic resize bursts with seq values delivered in-order, reversed, duplicated, and partially dropped. Validate dimensions (`cols 2..1000`, `rows 1..500` unless later evidence changes the central limits). Native calls must be rate-bounded and strictly monotonic by accepted `resizeSeq`; final readback must equal the newest desired geometry.

At `afterEffectBeforeReceipt`, drop the receipt, attach under the trusted exact session, read current dimensions, and reconcile to the **current desired** size. The test fails if the client automatically repeats the stale event.

### Phase F — crash/restart ambiguity

Inject crashes at four points:

1. before native spawn: retry may be allowed only with a proven `NO_EFFECT` receipt;
2. after native spawn before create receipt: state must be `SPAWN_AMBIGUOUS_NO_RETRY`;
3. after input write before ACK: same input cannot be resent automatically;
4. PTY host death while session is live: old `ptyHostGeneration` is invalid before a new host accepts traffic.

After restart, assert `ptyHostGeneration`, `sessionGeneration/sessionId`, and `processIncarnationId` cannot represent uncertain old process continuity. A renderer may display a tombstone/revived marker but must not claim reconnect unless the same process is independently proven alive and securely attachable.

### Phase G — workspace escape corpus

Use temp directories created by the test harness, never repository paths as authority. Corpus:

- lexical `../outside`;
- absolute POSIX/Windows paths;
- Windows drive-relative and UNC/device forms;
- symlink/junction from inside root to outside;
- nested link chains;
- case/normalization edge cases on the target filesystem;
- root replacement/rebind between validation and spawn.

The renderer does not get an arbitrary cwd field in V1. For any future resource-relative cwd capability, resolve against the trusted workspace binding, canonicalize, verify containment, and re-check the exact `workspaceGeneration` at the final effect boundary.

## Required observability for tests, not authority

The SUT should expose test-only, read-only counters/receipts sufficient to prove negatives without giving production callers more capability:

- effect counters: spawn/write/resize/terminate;
- exact current ref + transport epoch;
- rejected stale/duplicate/gap frames by reason;
- unacked bytes, ring bytes, pause/resume transitions;
- native resize calls and last applied geometry;
- process containment bind/cleanup receipt;
- host generation changes and session tombstones;
- final output seq/byte offset ordering.

Metrics are evidence only. They never authorize replay, spawning, cleanup, workspace binding, or production action.

## Blockers / severity

### P0 — implementation gate is not proven

Monaco implementation evidence is still ambiguous/failed in authoritative fleet state. Therefore no PTY implementation or native process test should be activated from this branch.

### P0 — ambiguous effects must remain non-retriable

Input and spawn are the highest-risk effects. Any generic RPC retry middleware that retries on timeout before inspecting typed outcome is a release blocker.

### P0 — process-tree cleanup proof is platform-specific

A PTY is not "bounded" because the shell PID exited. Unix process-group/session cleanup and Windows containment must be independently evidenced. `PARTIAL_UNVERIFIED` must block a fully-bounded claim.

### P1 — advisory source drift

The current PTY research checkpoint contains exact-base implementation claims contradicted by direct exact-base reads. Integration must use exact SHA/file evidence, not prose inheritance.

### P1 — backpressure must be end-to-end

A bounded ring without controlling producer reads can still move the unbounded queue elsewhere. Acceptance must include producer pause/resume/credit behavior and memory metrics.

### P1 — workspace containment requires final-boundary canonical revalidation

Lexical prefix checks or validation far before spawn are insufficient against links, root replacement, and generation drift.

## Handoff condition

This branch is ready to hand to the PTY implementer only as a falsification contract. Runtime binding begins **after** an exact Monaco implementation checkpoint is proven on the intended lineage. At that point, replace the test oracle with a SUT adapter and preserve all vectors above; do not weaken expected outcomes to fit implementation behavior.
