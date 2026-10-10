# Development verification prerequisites

`DevelopmentVerificationRuntime` materializes an exact committed Git input,
applies candidate file bytes, runs a host-owned verification catalog through an
injected executor, and records a host-generated receipt. It does not activate the
Development Plane worker, qualify an isolation provider, or grant promotion.

The shipped subprocess executor lives under `test/fixtures/` and executes reviewed
test code on the host. It is a test fixture, not a production security boundary.
Production composition must supply a separately qualified executor before routing
untrusted candidate build/test execution to this runtime. Existing Development
Plane prepare-only capability flags remain unchanged.

## Host composition

```js
const journal = createDevelopmentVerificationSqliteJournal({ filePath });
const runtime = new DevelopmentVerificationRuntime({
  repoRoot, repository, sourcePaths, editablePrefixes, snapshotRoot,
  catalog, executor, journal,
});
const receipt = await runtime.run({ idempotency_key, capsule, edits });
```

Import the class from `src/development-verification-runtime.mjs` and the journal
factory from `src/development-verification-sqlite-journal.mjs`. The host supplies
canonical absolute roots and existing private snapshot/journal directories.
`snapshotRoot` must be outside the source repository. Directory ACL provisioning
belongs to host lifecycle composition.

`sourcePaths` is an explicit file allowlist. Only normal executable/nonexecutable
Git blobs at `capsule.source.head` enter the snapshot. Dirty worktree bytes,
symlinks, submodules, path traversal, special files and ambiguous Windows paths
are rejected or excluded. The snapshot is capped at 64 MiB and 20,000 files.
Git replace refs are disabled; blob identities are independently recomputed.

`editablePrefixes` is a host-owned list such as `['src/']`. Candidate edits have
the shape `{ path, content_base64 }`; DELETE uses `content_base64: null` and binds
the digest of the original blob. CREATE/MODIFY bind the final bytes to existing
capsule component digests. Edits are capped at 4 MiB. The runtime never changes
the original checkout or commits candidate output.

`catalog` maps candidate verification IDs to trusted entries:
`{ executable, args, cwd: '.', timeout_ms: 30000 }`. All required IDs must exist.
Candidate/request data cannot supply a command, catalog entry or executable.
Catalog configuration and source/edit scopes are part of the idempotency binding.

## Executor contract

An injected executor has host-owned `executor_id` and `configuration_digest`
(`sha256:...`) plus four async methods:

| Method | Input | Required observation |
| --- | --- | --- |
| `createSession` | `session_key`, `snapshot_dir`, `snapshot_digest`, `output_limit_bytes` | `{ session_id }` |
| `runStep` | `session_key`, `session_id`, `step`, `output_limit_bytes` | `{ exit_code, timed_out, output_limit_exceeded, stdout, stderr }` |
| `stop` | `session_key`, `session_id` | `{ stopped: true, persistent_state_deleted: true }` |
| `recover` | `session_key` | `{ stopped: true, persistent_state_deleted: true }` |

The executor must be able to find and terminate a session by the deterministic
`session_key`, including a crash immediately after session creation and before
the returned session ID is persisted. It must enforce subprocess-tree lifetime,
fixed time/output budgets, isolation, network policy, private writable state and
environment/credential policy. The snapshot is input-only; the executor creates
its own writable copy. This runtime checks the physical input bytes before and
after every check and refuses snapshot mutation.

The runtime computes step pass from the executor's observed exit status, timeout
and output-limit status. Candidate-produced JSON is never accepted as a receipt.
Output bytes are digested, not retained in the journal. Passing requires every
required result and confirmed teardown. These are trusted-adapter observations,
not signed provider attestations. `isolation_qualification` explicitly remains
`NOT_ESTABLISHED_BY_THIS_RECEIPT`, and promotion/authority/retry flags remain false.

## Durable recovery

SQLite commits INTENT before materialization/session creation and STEP_INTENT
before each command. SESSION, STEP_RESULT and TERMINAL are append-only with
immutable schema triggers, unique reservations, canonical payload digests,
bounded rows/bytes, DELETE journaling and FULL synchronization. A foreign,
corrupt, truncated or over-capacity database fails closed. There is no repair or
in-memory fallback. The default capacity is 1,000 runs and 32 MiB.

A duplicate completed request returns its exact historical receipt. A duplicate
unfinished request refuses execution. Startup lifecycle can enumerate
`journal.unfinished()` and call `runtime.recover(run_id)` after the previous owner
process has exited. Active owners are never stopped by recovery. PID reuse is
conservatively treated as an active owner.

Recovery confirms executor teardown, removes the owned snapshot and records an
AMBIGUOUS receipt with the pending step ID. It never reruns a build/test after a
crash. An unconfirmed teardown also produces AMBIGUOUS. A terminal failure or
ambiguity cannot be replayed into success under the same request key.

FULL commits have been tested against actual process exit; power-loss durability
also depends on the filesystem and storage device. Production host lifecycle
must retain journal state and close its handle before removing its directory.

## Validation

Run from the repository root:

```powershell
node --test apps/metaengine-browser/test/development-verification-runtime.test.mjs apps/metaengine-browser/test/development-verification-sqlite-journal.test.mjs
```

The tests create real Git repositories, materialize file edits, build a module,
run independent Node tests, exercise negative outcomes/timeouts and kill a real
child process after BUILD. Recovery confirms that BUILD executes once and TEST
is never replayed. SQLite tests cover independent connections, transition rules,
false passing receipts, immutable history, capacity, corruption and foreign WAL
database preservation. They do not qualify production code isolation.

Positive fixture BUILD/TEST steps use the normal 30-second catalog budget so
Windows process startup under load is not confused with a failed check. The
dedicated hanging-test scenario still uses a 100-millisecond timeout and requires
the TEST receipt to report timeout after a successful BUILD. The crash child has
a 60-second outer envelope and must exit with the exact fixture crash status 73;
an outer timeout cannot satisfy the crash proof. These are fixture budgets, not
changes to production limits.

Existing `verification-sandbox-backend-binding.cjs` validates Vercel/Cloudflare
provider observations separately and keeps them unattested. A runtime receipt
must not be converted into an attested backend binding merely by copying fields.
The appropriate next integration is a host-owned isolated provider adapter with
physical qualification and trusted control-plane evidence, followed by deliberate
Development Plane composition and capability exposure.
