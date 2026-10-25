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
  `readExecution` (or a private `ledger` with `reserve`, `advance`, `read`).
* `signedRequest(path,{payload})`: the existing authenticated device HTTP path.
* `observerOptions`: packaged Electron `app`, `resourcesPath`, the absolute
  `cliPath`, the absolute protected `gitExecutable`, and protected sandbox
  receipt pins by provider/agent/role, or a role map of `{path,sha256}`.
* `runnerOptions`: absolute `executablePath`, pinned
  `expectedExecutableSha256`, `codexHome`, `gitExecutable`, `journalRoot`, and
  a separate protected `workerTempRoot`.
* `resultIndexRoot`: a protected sibling of the execution journal, outside
  the model worktree. `physicalSlotBudget` defaults to two.

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

This implementation is `LOCAL_OPERATOR_QA`. Source tests, a sandbox canary,
process launch, or a RESULT_READY receipt do not prove useful work, independent
acceptance, production release qualification, or restart continuation. Those
remain properties of the complete installed W30 goal/critic/checkpoint/next
cycle path. Logical work belongs to W30; simultaneous native processes remain
bounded by the physical pool.
