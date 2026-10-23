# Native Codex CLI worker

This module executes one already-issued task. It does not allocate tasks, poll a
queue, issue a lease, qualify a release, install a client, or accept its own work.
All receipts remain `LOCAL_OPERATOR_QA`, `production_qualified:false`, and
`useful_work_verified:false`. `RESULT_READY` means a physically observed candidate
is available for an independent Critic and authoritative own-PG acceptance.

CLI help was checked without a model call on `codex-cli 0.163.0-alpha.10.2`;
the host later updated independently, so that version is historical. Every run
pins the actual executable hash supplied by the native Host. The
`exec --ignore-user-config` option retains authentication
through `CODEX_HOME`. The runner neither reads nor copies authentication values;
its environment allowlist excludes API keys, database credentials, arbitrary
inherited variables, and Git overrides. No OpenAI SDK or API key is required by
this integration. Official reference:
<https://learn.chatgpt.com/docs/non-interactive-mode>.

## Files and trust boundaries

* `src/codex-cli-runner.mjs`: lease-bound execution, physical Git/artifact readback,
  durable local attempt journal, bounded JSONL, and independent Critic binding.
* `src/codex-cli-result-schema.mjs`: strict model result schema and host-side
  validation. Model-reported checks and follow-up tasks are advisory data.
* `src/codex-cli-windows-process-controller.mjs` and
  `scripts/codex-cli-job-runner.ps1`: shell-free launch with fixed argv, native
  suspended child, kill-on-close Job Object, native image/PID/birth/SID readback,
  explicit resume, timeout/cancellation, descendant termination and native job
  accounting. A Job Object controls lifetime and resources; it is not a sandbox.

`electron-builder.test.json` copies the PowerShell helper to the physical
`resources/native-coding/codex-cli-job-runner.ps1` file. Packaged code resolves
that path through `process.resourcesPath`; PowerShell never receives a path
inside `app.asar`. Development runs retain the source `scripts/` path. The next
installed payload qualification must include the external helper's exact hash.

The Windows sandbox is selected by explicit CLI configuration:
`windows.sandbox="elevated"`. Writer commands use `--sandbox workspace-write`;
Critic commands use `--sandbox read-only`. Additional writable roots are reset
and generated-command network access is disabled. Approval is `never`, so sandbox
denials cannot become interactive escalation. No bypass flag is accepted.
`--no-daemon` keeps the CLI harness out of a shared background app server that
would otherwise sit outside this job's lifetime boundary. The installed CLI's
`codex --no-daemon exec --help` parser was checked without invoking a model.
These flags alone do not prove that the OS sandbox works. The host's separately
observed sandbox canary, native issuer, installed artifact binding and own-PG
lease must all qualify before a real task is resumed.

The runner requires a locked, real Git worktree and a pinned CLI executable hash.
A writer starts from a clean exact lease HEAD. Source symlinks, paths escaping
the worktree, hardlinked changed files, changed-file/byte budget violations and
project-local `.codex/config.toml` are rejected. Git commands disable fsmonitor,
hooks, external diff, text conversion and global/system configuration. A managed
repository must explicitly configure required line-ending behavior locally;
the runner does not normalize a dirty tree to make it pass.

The private journal must be outside every agent workspace and protected by the
native host's Windows ACL policy. The runner creates mode-restricted files, but
POSIX mode bits are not a Windows ACL attestation. JSONL and stderr can contain
private task data and must not be published to GitHub or renderer-facing output.

## Host composition API

```js
const runner = createCodexCliRunner({
  executablePath, expectedExecutableSha256, codexHome, journalRoot,
  workerTempRoot, authorizeLease, processController,
  // Optional explicit model; absence uses the CLI's own default.
  model: null, timeoutMs: 600_000,
});
const receipt = await runner.run({
  lease: { task_id, agent_id, lease_generation, agent_generation_epoch, base_sha },
  role: 'IMPLEMENTER', worktreePath, prompt,
}, { signal });
```

`authorizeLease` is a private native callback, invoked at `BEFORE_ATTEMPT`,
`BEFORE_RESUME`, and `AFTER_EXECUTION`. It must perform fresh authoritative
readback, not accept a caller's approval flag. Its bounded return projection is:

```js
{
  authorized: true, trust_namespace: 'LOCAL_OPERATOR_QA',
  task_id, agent_id, lease_generation, agent_generation_epoch, base_sha, role,
  permit_id, owner_epoch, user_sid, workspace_id, project_id,
  worktree_path, expires_at,
}
```

`workerTempRoot` is a private Host-configured directory such as
`%LOCALAPPDATA%/METAENGINE/operator-qa-scratch`, outside the workspace, journal,
authentication and executable roots. Its existing DACL is verified rather than
rewritten; a fresh UUID child gets a native Owner-only DACL before launch.
Only that child becomes `TEMP`, `TMP` and `TMPDIR` in this job's environment.
Neither global Windows Temp nor a repository-controlled directory is used.
`temporary_path` and the native storage evidence digest are recorded and passed
to `BEFORE_RESUME` for the issuer's sandbox-scope binding. Production composition
uses the existing `private-windows-storage-acl.mjs` native functions; injected
storage adapters in unit tests are explicitly synthetic.

`BEFORE_RESUME` additionally receives `{ process, run_id }`. At this point the
actual worker is still suspended in the verified job and has received no prompt.
The callback must validate the private native Job proof and commit the own-PG
`RESERVED -> ATTEMPTED` transition **before returning**. Only then does the
runner fsync its local execution marker and resume the child. Failure or an
uncertain database acknowledgement preserves the attempted lease for readback.

The private permit's `expires_at` must not exceed the actual W30 lease expiry.
The runner fixes an absolute execution deadline at the earlier of that expiry
and its configured timeout, and a fresh pre-resume permit can only shorten it.
The C# helper checks this deadline before `ResumeThread` and enforces it with a
native watchdog that checks at intervals up to 100 ms, even if the Browser dies.
This is a bounded operating-system watchdog, not a hard real-time guarantee.
The original relative timeout cannot extend a shorter lease expiry.

The process controller API is:

```js
const handle = await processController.spawn({
  executablePath, expectedExecutableSha256, args, cwd, env, timeoutMs, deadlineAt, runId,
});
// handle.proof: actual suspended native process and job observation.
// handle.stdout / handle.stderr: readable streams.
await handle.resume(prompt, { deadlineAt }); // exactly once; may only shorten
await handle.completion;    // exit_code, reason, tree_cleanup_confirmed
await handle.terminate(reason);
```

The opaque `proof.job_id` is a host-generated UUID, with
`process_tree_control:'WINDOWS_JOB_OBJECT'` and `job_bound_before_resume:true` as
separate facts. The host should wrap `spawn` to retain the actual handle in its
private worker registry; an issuer must reread that registry and kernel birth,
not sign a renderer-supplied copy of this projection. `started_at` is a native
Windows timestamp; normalize it to ISO milliseconds when constructing the typed
issuer's `worker_process.created_at`, keeping `process_incarnation_id` exact.

## Independent Critic

The Critic receives a different task, lease and agent identity, starts a fresh
CLI process in read-only mode, and binds both the writer's structured response
and its physical artifact:

```js
await runner.run({
  lease: criticLease, role: 'CRITIC', worktreePath: criticWorktreePath, prompt,
  subject: {
    task_id: writer.task_id, lease_generation: writer.lease_generation,
    run_id: writer.run_id, result_sha256: writer.result_sha256,
    git_artifact_sha256: writer.git_after.artifact_sha256,
    source_head: writer.git_after.head,
  },
});
```

The subject must exist in this runner's durable writer journal. A separate
locked Critic worktree is allowed only when its HEAD, tracked patch and all
changed/untracked file hashes match exactly. Critic mutation invalidates the
result even when the model says `ACCEPT`. This is agent/process independence;
both agents may use the same model and provider, so it is not provider diversity.
The bounded artifact readback covers Git HEAD, tracked diff and changed/untracked
file bytes; ignored files are not represented as a complete filesystem snapshot.
The separately observed OS sandbox remains responsible for write isolation.

## Existing W30 integration

The single scheduler remains `POST /v1/devos/cycle` in
`supabase/a2-browser-native-supervisor-v1/devos-routes.mjs`; its sole lease call
is `public.devos_fleet_lease_v1`. Native coding consumes the returned lease.
It must not fabricate a Browser `webcontents:*` identity or conversation proof.
The host's native provider descriptor and additive native transport admission
must qualify a real `codex-cli:<provider_id>` target in a distinct QA namespace.

`native-coding-lease-executor.mjs` composes this runner with the own-PG ledger and
native issuer. Start an execution once into a bounded physical worker pool and
collect its result on the existing heartbeat. Awaiting an entire long CLI run
inside the sole heartbeat would starve freshness and other supervision. There
is no new periodic scheduler in the runner. Model-requested follow-up tasks must
go through existing project/admission APIs and resource limits.

An attempt is reserved exclusively by `(task_id, lease_generation, role)`, then
fsynced before any spawn. A second call reads the existing receipt and never
spawns again. A crash with only an attempt marker returns `AMBIGUOUS`; no retry,
resume-last, lease transfer, task reset, deletion or recovery write is inferred.
After process cancellation, malformed JSONL, missing terminal output, source
drift or an uncertain acknowledgement, physical effects are reconciled by the
host and own-PG before new work can be admitted.

Restart continuation is not proven by these source tests. It requires a real
installed-client goal, authoritative lease, useful source diff, independent
Critic, durable own-PG acceptance, physical Browser restart and the next distinct
cycle without replay. Logical agents may grow through admitted child tasks while
the number of concurrent OS workers stays bounded; a finite worker pool is not
proof of an infinitely concurrent fleet.

## Verification

Run `node --test test/codex-cli-runner.test.mjs` from this Browser directory.
Unit tests use an explicitly fake process controller and real disposable locked
Git worktrees; they do not invoke a model. Windows tests use real Node child
processes to verify native suspend/job/resume, argument transport and timeout
cleanup of a descendant. Their receipts are not installed autonomy evidence.
