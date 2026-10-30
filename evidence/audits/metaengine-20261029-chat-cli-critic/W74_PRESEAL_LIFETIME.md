# W74 pre-seal lifetime prerequisite — 2026-10-30

## Scope and status

This is a correction to the **existing W74 custody implementation and actual
SupervisorDeviceIdentity persistence queue**, not a pending-goal bridge or
activation implementation. No new IPC operation, renderer field, SQL procedure,
key, trust root, installed-client change, or execution permission is introduced.
W68 still reports `loaded_runtime_code_attested: false`.

## Reproduced defect

The previous W74 implementation checked native authority and project scope,
then awaited sealed-state/old-process reads before calling `writeSealed` without
rechecking either lifetime or current evidence. Calling `close()`, revoking the
source proof, or changing the observed Admin epoch during that await could still
write a new sealed record. Its later checks returned null, but that did not undo
the write. `close()` did not return a drain promise. In addition, the actual
identity write waits on a separate persistence queue, so a gate checked only
before queue admission is insufficient.

The four new `pre-seal .* invalidation` regressions were run against a disposable
copy of the original HEAD W74 source. All four failed: close/source/epoch cases
wrote one record when zero was required, and the old module ignored the new
private Host-lifetime refusal gate. No tracked source was swapped for this
baseline experiment.

## Repair

- Every native await is followed by a lifetime check. A private synchronous
  `assertLifetime` callback is refusal-only; it does not replace Guardian,
  native kernel, installed-source, SQL, or identity checks.
- After native/source reads, the current Admin and enrolled device must still
  agree with their entry identities and epoch.
- Before a new seal, W74 repeats native/source/current-identity checks, then
  rereads its scope on the **same locked transaction**. This is the same
  SERIALIZABLE snapshot plus held-lock/liveness verification, not a fresh SQL
  snapshot. Only the separate post-transaction scope read is independent.
  A dead reservation
  cannot silently reconnect through the reserved transaction adapter.
- The W74 writer passes a private `assertCurrent` closure to the actual
  SupervisorDeviceIdentity writer. That closure is awaited **inside** the
  existing serialized persistence mutation, immediately before encryption.
  Waiting behind an unrelated identity write cannot preserve stale authority.
- W74 also supplies a private pre-replacement guard to identity persistence.
  After the temporary file has been synced and closed, it rechecks expected
  current state/previous sealed record and native/current-scope evidence. Only
  then does the writer invoke W74's private **synchronous** lifetime gate and
  initiate rename, without an intervening await. This final synchronous check
  closes the continuation gap after the asynchronous guard resolves. Close,
  grant change, or Host loss during temp write/sync prevents replacement and
  cleans up only this operation's own temp file. Ordinary identity mutations
  retain their existing behavior.
- `close()` closes immediately and returns a promise joining already-started
  native work and queued persistence. `drain()` exposes the current join.
  Accidentally asynchronous lifetime gates are refused regardless of successful
  resolution, and their work/rejections are observed and joined, not discarded.
  Identity unbinding retains its closed W74 binding until the join settles;
  rebinding cannot overlap its drain.
- Final sealed readback also checks lifetime. Closure or SQL loss after a seal
  has begun may leave a record but cannot return a confirmed Owner. The final
  cancellation boundary is initiation of rename, not completion. No rollback
  of that record, implicit generation increment, or automatic resend is added.
  PostgreSQL and safeStorage are **not** a cross-resource atomic transaction.

## Verification

Focused Browser run: **50/50 PASS** across:

- `host-owner-genesis-custody-w74.test.mjs`
- `host-owner-protected-identity-w74.test.mjs`
- `supervisor-device-identity-concurrency.test.mjs`

Includes close/source/epoch/Host invalidation; SQL scope change during native
checks; joined close with queued calls; late close after an already-started seal;
Admin/device changes during evidence; real disposable identity files blocked
behind a preceding rename; queued close/grant/Host refusal; and successful
rename with a lost acknowledgement preserving an unconfirmed record and fencing
all further writes on that identity instance. Tests also cover actual temp-file
sync blocked across close/grant/Host change (zero replacements), closure after
rename has started (joined, unconfirmed outcome), and resolved/rejected/delayed
invalid asynchronous lifetime gates (no seal or unhandled rejection). A
microtask-close regression schedules closure between async guard completion
and rename: it passes with the final synchronous gate. Removing only that gate
in a disposable copy reproduces one replacement instead of the required zero.
External grant/source observations remain sampled, with the SQL scope protected
by held locks; the synchronous gate does not make filesystem and SQL atomic.

Real PostgreSQL 17 run: **4/4 PASS** (suite plus three scenarios) in
`infra/client-state-runtime/host-owner-preseal-w74.pg17.test.mjs`:

1. Actual project `FOR SHARE` and W74 advisory transaction locks block competing
   project update and lock acquisition during the pre-seal native await.
2. `pg_terminate_backend` before seal joins the outstanding callback, refuses
   late scope SQL, and performs zero sealed writes.
3. Killing the connection after the mock seal returns null/unconfirmed, retains
   exactly one record, joins the seal callback, and does not replay the failed
   transaction. A separate explicit transaction can use a fresh backend.

PG test setup is disposable and uses the actual reserved transaction adapter.
All native, Guardian, source, and secureStorage evidence in these tests is
**generated STAGING**, not installed Windows verification. The test does not
claim current-grant/pairing locks or exact pending-goal scope integration.

## Remaining bridge work / exact boundary

The proposed `ESTABLISH_PENDING_OWNER_V1` / `READ_PENDING_OWNER_V1` protocol is
**not implemented** here. W74's current one-project `LIMIT 2` query remains the
legacy scope selection. It must not be mounted as an exact pending-goal route.
There are still no production `bindHostOwnerGenesisW74` / `establishHostOwnerW74`
callers for that pending-goal path.

Required next work is a typed Host transaction interface over the existing owned
ChildProcess: exact immutable pending-ledger selector; current signed
Admin/device/pairing/repository and exact project/root locks; bounded correlated
phase sequence bound to action/request/body digest/Host generation; durable
immutable transition intent; actual main Guardian/kernel/W68/safeStorage
composition; and read-only same-transition recovery. The Host must keep the
reserved transaction through the seal and revalidate before release. Final
confirmation must use a **genuine separate, freshly authenticated transaction**
after release, not a cached-scope simulation of W74's post-commit read.

Until that interface, caller, and recovery are tested end-to-end, the saved goal
remains `PENDING_ACTIVATION`, root `BLOCKED`, project `PAUSED`, with no permits or
execution-readiness claim. Missing real Guardian or signed release sidecars
continues to refuse custody. On-disk W68 proof is not loaded-code attestation.

Provider composition must also keep current-Admin reads on the owned reserved
scope or otherwise avoid acquiring another connection from a saturated pool
while holding that scope. The current method remains private/DI-only; this is a
requirement for the future real Host composition, not a claim of deployed
max-pool deadlock.

## Integrator readback

The integrator independently reran the final source after the synchronous gate:
50/50 identity/W74 tests and 4/4 actual disposable PG17 checks, no skips. Logs:
`/tmp/w74-parent-final2.log` and `/tmp/w74-parent-pg17-final2.log`. Mandatory Windows
registration checks pass 9/9; native PG pre-seal cases are now included in that
lane. These results preserve all staging/installed/cross-resource limitations above.
