# Private native coding runtime

`src/native-coding-runtime.mjs` composes the existing W30 heartbeat, a private
Runtime Host capability, the enrolled device issuer, the durable PG execution
ledger, and the bounded Codex CLI process runner. It creates no scheduler or
poller and reads no database credentials in Browser. It uses the existing CLI
ChatGPT login; these modules make no model calls during construction or tests.

Native main supplies `createNativeCodingRuntime` with:

* `identity`: the existing enrolled device signing capability.
* `ownPostgres`: the private owned-Host IPC capability, exposing `readScope`,
  `readLease`, `registerProvider`, `reserveExecution`, `advanceExecution`, and
  `readExecution` (or a private `ledger` with `reserve`, `advance`, `read`),
  plus `reconcileProject` and read-only `readProjectCheckpoint` for acceptance.
* `signedRequest(path,{payload})`: the existing authenticated device HTTP path.
* `observerOptions`: packaged Electron `app`, `resourcesPath`, the absolute
  `cliPath`, the absolute protected `gitExecutable`, and protected sandbox
  receipt pins by provider/agent/role, or a role map of `{path,sha256}`.
* `runnerOptions`: absolute `executablePath`, pinned
  `expectedExecutableSha256`, `codexHome`, `gitExecutable`, `journalRoot`, and
  a separate protected `workerTempRoot`.
* `resultIndexRoot`: a protected sibling of the execution journal, outside
  the model worktree. `physicalSlotBudget` defaults to observed CPU/memory
  capacity. The former fixed two-worker ceiling is removed.

`observeProviders()` starts one bounded background preparation/refresh pass and
immediately returns only registered, unexpired provider snapshots. The pass
prepares the installed byte evidence and registers canonical envelope hashes
through the private Host; it creates no timer. `dispatchLease(lease)` returns immediately while the one
bounded process executes. `observeLease(lease)` collects its result and sends
the existing W30 completion once. `completeFromTrustedCommand` accepts only a
lease selector and reads the private result; caller-supplied result data is
not used. `close()` aborts and joins known jobs without starting replacements.

The full installed-resource verifier and EXE/ASAR/CLI byte hashes run once in
`prepareInstalledImage()`, before any issuer observation timestamp. Every
`readInstalledImage()` checks the current kernel image and the complete
physical inventory: file/directory entries, volume/file IDs, birth/modified/
change times, lengths and link counts. A changed path, added or replaced file,
or failed preparation permanently invalidates this runtime incarnation. The
prepared evidence stays in private memory; no stored readiness JSON substitutes
for that readback. This stat guard assumes the protected installed files and
native host remain outside the worker's write authority.

The worker registry owns the actual suspended handle. A JSON process claim
cannot register a worker. Its native PID/birth/SID/image and pre-resume Job
binding are re-read before the enrolled device signs the job. The private PG
ATTEMPTED transaction registers that exact envelope before W30 acknowledges
RUNNING and before native resume. A Job Object bounds lifetime and descendants;
the separate pinned current-boot sandbox canary proves the observed write
boundary. Canary receipts bind their exact worktree and CLI and cannot be
relabelled for another repository or boot.

An independent Critic lease resolves the writer's protected, fsynced receipt
through a private immutable index. It binds the writer run, result digest,
Git artifact digest, source HEAD, agent and native process incarnation. The
Critic uses its own read-only process; it does not publish an author pointer.

Unknown barrier, registration or W30 outcomes remain fenced. Completion is
never POSTed twice. A lost completion ACK can release its occupied slot only
after the private Host returns the exact registered receipt and matching W30
task state/summary. Removing an ambiguous provider from the roster cannot
clear its fence. Restart observation only reads the durable ledger; it never
replays a process.

The existing project reconcile stage creates a typed native CRITIC task from
a registered writer result. `observeProjectCheckpoints` starts one background
Host acceptance pass and returns immediately. Historical job signatures and
ledger scopes retain their original native Host/process births; acceptance
separately reads today's installed image, PG identity and exact Git artifact.
The Host registers a canonical checkpoint, advances both historical executions
and completes the verified pair in one synchronous serializable transaction.
Direct `ADVANCE_EXECUTION` to CHECKPOINTED remains forbidden. After a lost ACK,
retained selectors keep reading the checkpoint even if the completed tasks
disappear from the public reconcile sweep. Only acknowledged cache entries can
be retired; unresolved writes are never evicted to make space.

The worktree remains `CHECKPOINTED_PENDING_COMMIT`. Acceptance does not grant a
successor lease: preserved Git commit and new base/permit admission are separate
remaining steps. Agent-visible messages, peer overview, child admission and
client/computer tool execution also require an installed trial.

This implementation is `LOCAL_OPERATOR_QA`. Source tests, a sandbox canary,
process launch, or a RESULT_READY receipt do not prove useful work, independent
acceptance, production release qualification, or restart continuation. Those
remain properties of the complete installed W30 goal/critic/checkpoint/next
cycle path. Logical work belongs to W30; simultaneous native processes remain
bounded by the physical pool.

Agent-count revision (2026-10-25): there is no native roster ceiling at 64,
no fixed two-worker mount and no browser fleet/tab-count ceiling. Legacy
elastic count ceilings are ignored. The private own-PG scope is read through
cursor pages; signed service witnesses rotate byte-bounded admission windows.
Message/page budgets bound one transfer, not the registry or cumulative runs.
The existing W30 queue retains work while current physical resources are busy.
Permit/device/sandbox checks, independent Critic and ambiguous-effect custody
remain required. A large generated roster is not proof of installed model work
or automatic creation of new independently sandboxed worktrees.

## Prepared callback custody (source-only, not mounted)

The optional **private** `preparedCustodyFactory` injection composes
`createNativeCodingPreparedCustodyAdapter` with the runtime's original runner,
permit and ledger boundary. Main does not supply it by default; the production
bridge's `requireNativeRunCallbackPublication` gate remains closed. This seam
is not an IPC option, readiness flag or substitute for native qualification.

The adapter registers the exact runner handle and frozen descriptor, derives
its MCP binding from the same captured permit, and passes the original journal
to `prepareAgentRunCustody`. Its only reservation path is
`reservePreparedExecution(scope, token, directOwnerCallback)`. The callback must
be `createLoadedNativeRunOwnerCallback` on that original ticket, never the
standalone `readLoadedNativeRunOwner` diagnostic or a global physical drain.
The existing client owns the fixed Owner cycles, actual send/callback joins,
COMMIT/readback ACK and exact terminal validation.

After reservation, bridge preflight receives a private single-use
`takePreparedCustody` closure. The current default bridge does not consume it:
it still refuses at the unqualified publication gate. A future qualified
composition must consume this original custody rather than reopen the journal.
All claim/reserve/preflight work is retained before bridge registration. Quit,
cancellation, UNKNOWN/readback and preflight failure fence the original local
preparation and abandon its token or join its transferred facet. Callback drain
is separate from native worker settlement; an adapter drain reports only
`local_work_joined` and `physical_settlement: NOT_ATTESTED`.

Focused checks (use the disposable-profile runner):

```sh
node scripts/run-isolated-tests.mjs test/native-coding-prepared-custody-adapter.test.mjs test/native-coding-prepared-custody-ipc.test.mjs test/native-coding-runtime.test.mjs
```

These tests include generated lifecycle/Owner/SQL fixtures. Even the joined
real IPC/journal tests do not establish genuine Windows Owner observations,
directory durability, mandatory PG/cross-generation anchors or release proof.
Those remain prerequisites to mounting this path in Main and Host.
