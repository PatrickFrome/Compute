# Exact pending-goal Owner custody bridge — source stage 2026-10-30

## Delivered boundary

This stage connects the actual prepared-goal main caller to the already-owned
Host ChildProcess and reserved own-PostgreSQL transaction. It establishes or
reads **custody only**. It does not activate the goal, enqueue a worker, mint an
execution permit, claim production qualification, or attest loaded runtime code.
The immutable admission still says `PENDING_ACTIVATION`, root `BLOCKED`, project
`PAUSED`, and zero permits. No installed PC, Windows VM, credentials, Guardian
installation, or security settings were changed by this source work.

## Actual caller and authority

`submitClientGoal` invokes the custody continuation only after its explicit user
goal has a durable successful pending admission. The continuation performs a
fresh signed `READ_PREPARED_GOAL_V1` and validates the exact journal selector.
It binds the existing main Guardian launcher, `readWindowsKernelProcessW60`,
`readVerifiedInstalledExecutableW68(app)`, and the same enrolled identity's
safeStorage-backed W74 writer. Nothing starts a generic goal on application
startup. No renderer callback or supplied Owner JSON chooses these producers.

`ESTABLISH_PENDING_OWNER_V1` and `READ_PENDING_OWNER_V1` accept **exactly**:

```
{ preparation_id, configuration_sha256, request_id, objective }
```

The existing enrolled-key signature, exact owned Host PID/instance and current
same-cluster ADMIN/device/pairing/workspace checks remain required. Project IDs,
paths, SQL, Owner JSON, grant epochs and Host generations are not accepted from
the renderer as authority inputs.

Main's private `withOwnerScope(mode, callback)` receives a typed facade, never a
SQL executor. WRITE exposes `readScope`, `prepareTransition`, a private current
Admin projection, and `assertOpen`. READ exposes `readScope`, `verifyTransition`,
the private projection and `assertOpen`; it has **no** preparation/write method.
The Admin projection is cached data from the authenticated locked Host scope,
not a fresh database-grant oracle. Host `readScope` and held SQL locks are the
authoritative revalidation boundary.

## Exact SQL scope

The Host reuses the workspace service's existing reserved SERIALIZABLE
transaction, current device/pairing/repository row locks and physical
root/stage/storage revalidation. It also takes the existing W74 device/client
advisory transaction lock. A fixed query joins the immutable pending ledger to
its exact project, root task and root project-task association using the signed
pending selector. It checks the saved configuration/preparation/receipt, exact
workspace/device/client/epoch/task-spec identity and nonrunnable states.

This path **does not execute** legacy W74's one-project `LIMIT 2` selection.
An unrelated same-device project cannot be selected and does not make the exact
pending project ambiguous.

Repeated scope reads are the **same SERIALIZABLE snapshot plus held-lock and
connection-liveness checks**, not new snapshots. Final confirmation opens a
separate, freshly signed READ operation and a genuinely new transaction after
WRITE's transaction has actually released. It never simulates that read with
cached rows from the write transaction.

## Bounded private phase protocol

Every phase binds schema, outer action/request UUID/request digest/signed-body
digest, exact Host instance/PID and sequence number. Both endpoints enforce
ordering and one-use correlation. Messages remain on the existing owned
ChildProcess channel; no new HTTP endpoint, generic SQL RPC or credential is
introduced. Private phase fields and callback return values are not exposed by
public status/renderer projections.

WRITE sequence:

1. Host locks and sends `LOCKED`.
2. Main `RECHECK_SCOPE` (initial exact scope).
3. Main `PREPARE_TRANSITION`; Host persists the immutable intent and acknowledges.
4. Three `RECHECK_SCOPE` barriers: before entering the W74 writer, inside its
   serialized identity mutation, and after temp sync/close before replacement.
5. Main `RELEASE` only after its callback/persistence completed.
6. Host revalidates and completes the actual transaction before outer success.
7. W74 opens an independent READ transaction for confirmation.

READ sequence: `LOCKED`, `RECHECK_SCOPE`, `VERIFY_TRANSITION`, `RELEASE`.
READ cannot emit `PREPARE_TRANSITION`. Invalid ordering, duplicate phases,
malformed ACK, wrong digest/action/Host/PID, and premature outer completion
fail closed. Phase bodies are bounded; no SQL or sealed Owner JSON travels in
these messages.

## Durable intent and exact recovery

The Host publishes no-overwrite
`native-coding-pending-owner-intent-v1.json` before the first seal. Its protected
binding contains the exact selector, preparation/admission digests, authenticated
device/client/key fingerprint/epoch and original Host generation. Its origin
records the original outer action/request/body digests. Transition hashes are
SHA-256 over a domain-separated **complete canonical sealed record**, not a
subset of identity fields. Existing intent never authorizes another write.

Typed records carry private schema-versioned `pending_custody` pins for exact
installed executable bytes, package-code manifest, release proof identity and
Guardian enrollment evidence, with `loaded_runtime_code_attested:false`.
Process incarnation/device key/project/epoch/generation remain in the original
record. READ requires all pins and the entire retained-record digest to match.
A different valid package/proof with the same source SHA cannot adopt the seal.
Legacy records lacking these pins HOLD; there is no migration/reseal fallback.

Lost seal/commit/release acknowledgement is UNKNOWN. Recovery reads the same
immutable selector, current locked authority and complete sealed digest; it
never increments generation or starts another goal. Another Host generation
remains read-only/HOLD in this slice. Restart adoption needs a later separately
reviewed transition, not this recovery operation.

## Lifetime and non-atomic outcomes

Main's existing initialization/shutdown barrier owns the operation and joins
native checks and queued persistence. The reserved adapter exposes a private
**failure-only** signal for that exact connection; a dead connection closes a
Host phase wait immediately. Normal commit does not abort this signal; retained
transaction operations are still fenced as finished. SQL callbacks and main
native/persistence callbacks are joined rather than abandoned on timeout,
disconnect or failure.

The identity writer revalidates asynchronously after temp flush/close, then
calls W74's synchronous local lifetime gate immediately before initiating
rename. Nevertheless remote SQL failure/abort can race that final local step.
Already-started rename may succeed after authority is lost. Such a seal is
unconfirmed and requires readback. **SQL locks and DPAPI/file replacement are
not an atomic distributed transaction.** No power-loss durability guarantee is
inferred from these tests.

Identity mutation/CAS remains per-instance cached state. The immutable Host
intent prevents duplicate pending-route transitions; it is not a global disk
CAS against unrelated identity writers in another main process. This stage is
bound to the existing exact owned-main/Host generation.

## Deliberately conservative caller behavior

If goal ADMIT acknowledgement is lost, submit reports reconciliation even when
its readback finds the pending goal. That path does **not** start Owner sealing.
Startup/latest does not manufacture a custody attempt; refresh invokes READ
only. If no prior Owner intent exists, READ holds. Similarly, missing authentic
Guardian, native kernel proof, signed W68 sidecars, or unavailable safeStorage
cannot be replaced by fixture evidence. A saved goal can therefore remain
pending for a later explicit, separately reviewed transition. There is no
silent automatic retry to "make progress" across this boundary.

Main returns only a small custody/HOLD result internally, with execution and
production false; submit/refresh keep the original safe pending-goal projection.
No sealed Owner record is returned to the renderer.

## Verification and limits

Final local run on this source draft:

- Browser/W74/identity/main/legacy-goal/owned-IPC/phase/source-runner: **211/211 PASS**.
- Host binding/workspace/reserved-connection/package/Windows registration: **88/88 PASS**.
- Real disposable PostgreSQL 17 combined suites: **24/24 PASS**, including the
  pending-goal bridge suite (**17/17**), pre-seal killed-connection suite (**4/4**),
  and workspace preparation suite (**3/3**).
- Reviewed source catalog: **255 files PASS**; `git diff --check` clean.

The existing postgres.js negative-timeout warning still appears in the deliberate
idle-timeout/reservation-reclamation test; it was not suppressed and the test
passes. These are local source/test results, not installed Windows proof or CI
publication results.


- Shared phase adversarial tests: correlation, separate READ capabilities,
  ordering/replay, malformed ACK, duplicate LOCKED, premature completion,
  cancellation and joined callbacks.
- Actual owned ChildProcess tests: success, timeout/disconnect while main native
  work is blocked, and lost RELEASE acknowledgement followed by READ only.
  These transport fixtures do **not** claim SQL or cryptographic authority.
- Actual PostgreSQL 17 pending-goal suite: real signatures/verifier, reserved
  transactions, durable identity files, exact project despite unrelated project,
  separate post-release transaction, current grant/pairing/repository/ledger/
  project/root locks, killed backend before seal, lost commit acknowledgement,
  exact package/proof/Guardian pin recovery, no replay, and unchanged anti-
  activation guards/zero permits. Its phase wire is in-process; all native/OS/
  safeStorage observations are explicitly generated **STAGING**, not installed
  Windows proof.
- Actual main function tests: real producer bindings, exact selector/signing,
  one explicit creation path, READ-only refresh, no creation on startup/latest
  or lost admission ACK, and no Owner-record leakage in public goal results.
- Packaging includes the new Host source closure; source catalog includes both
  new production modules. Existing legacy goal/identity tests remain applicable.

This is not an installed-client qualification or evidence that autonomous
execution is ready. W68 still lacks loaded-runtime-code attestation. Activation,
permits, real installed-native verification, and broader restart adoption remain
separate work.

## Integrator final readback

The integrator independently reran the frozen combined source: Browser/main/IPC
211/211, Host/adapter/package/registration88/88, actual disposable PG17 24/24,
all without skips. Logs: `/tmp/owner-bridge-parent-browser.log`,
`/tmp/owner-bridge-parent-host.log`, `/tmp/owner-bridge-parent-pg.log`.
Independent reviewers closed the recovery-pin and failure-only signal findings;
no remaining confirmed blocker in reviewed scope. Exact published Windows CI and
installed-native evidence remain separate from these local generated fixtures.
