# Controlled MAIN launch: protocol review checkpoint

Status: **Direction reviewed: authentic connected-pipe observation first, then a
minimal existing-recovery PREPARE/ARM producer. No launch protocol expansion or
new process effect is implemented by this checkpoint.** The connected-pipe
implementation and its explicit prerequisites are recorded in
[`GUARDIAN_CONNECTED_PEER_CHECKPOINT_20261101.md`](GUARDIAN_CONNECTED_PEER_CHECKPOINT_20261101.md).
Per-stream publication approval remains pending.

Published parent: `6af8ba9b309fa4725f3d06ee4a94fe52ba1f1d09`, tree
`765077a6689f500f6eb97e63535f1bb38b2d6ced`. This includes the existing Windows
`(std::numeric_limits<std::uint64_t>::max)()` correction; do not duplicate/revert it.
Local retained-custody source rebased onto that parent:
`5b3007a42e4ba982983056115273a0f2297f7289`, tree
`7c8d2152a935e163e456d6eaccca9eedf0a90c62`.
Its pre-rebase source was `eaa049a2ee3ef96c1b67197528dd6b0356967eb9`; the original
stage1 patch/bundle remain preserved. Neither local source is in PR #1393 yet.

## Concrete permission producer

The post-install recovery purpose should replace the physical adapter of
**existing same-version runtime recovery**, rather than create a generic
MAIN-start API. The mandatory first-install purpose is separately specified in
[`GUARDIAN_CLEAN_MACHINE_BOOTSTRAP_CONTRACT_20261101.md`](GUARDIAN_CLEAN_MACHINE_BOOTSTRAP_CONTRACT_20261101.md);
recovery is not a substitute for clean-machine deployment/enrollment.

`runtime-recovery-transaction.mjs` already produces permission in its private
`dispatch()` closure: it reads the protected recovery journal, requires the same
PREPARED ticket, exact original Browser PID/full birth/image, unchanged
Owner/ASAR/runtime/own-PG pins, eligible original Host generation, verified
physical drain and the original gate epoch. It durably saves DISPATCH_INTENT
before calling its sole `adapter.requestRelaunch(ticket, origin_browser)`.
`main.mjs:startInstalledRuntimeRecovery()` closes over actual native app,
bootstrap, Host, gate and Sentinel objects. No renderer API exposes this adapter.
The previous adapter called `app.relaunch()` with the fixed existing recovery
selector and then `app.quit()`. The connected-peer checkpoint replaces that
effect with a fail-closed native prerequisite; no planned-quit callback, relaunch
or quit is reached while the native ARM producer is unavailable.

The proposed implementation replaces that adapter with the Guardian handshake.
The existing transaction, recovery ticket, policy, storm budget and scheduler
remain the producer. The ticket is the **runtime-recovery ticket**, never an
installer/enrollment ticket. This does not grant a task or goal effect.

The existing device signers are insufficient by themselves:

- `guardianOwnerChallenge()` / `guardianOwnerReadChallenge()` authenticate a
  read-only command/nonce, not a MAIN action.
- `guardianUpdateActuatorProof()` authenticates installer DISPATCH/OBSERVE.
- `signNativeCodingProof()` authenticates existing provider/job purposes.

The new fixed purpose must use the same **already loaded** P-256 key, with no
`ensure()`, enrollment, rotation, caller key, signing-key export or generic
`signMainLaunch(ownerJson)` method. The transaction should mint an opaque
module-private recovery scope only after its original durable DISPATCH_INTENT.
A WeakMap-backed one-use scope records the actual original transaction/pins,
ticket, gate and lifetime; only its real private adapter receives it. A new
loaded-identity signing method consumes that original scope, rechecks current
device/client/key state and signs the fixed canonical material. A copied JSON
object or caller-shaped receipt cannot be consumed as this scope. The actual
production composition is the existing `startInstalledRuntimeRecovery()` call,
not a newly injectable callback/provider.

## Goal/Owner admission is a separate producer

The real project/admin epoch producer exists in
`main.mjs:continuePreparedGoalOwnerCustody()` and the pending activation route:
owned Host `withPendingOwnerScope()` / `withPendingActivationScope()` hold the
actual own-PG scope, immutable prepared-goal selector and revalidated device/admin
epoch. W74 joins that with protected Owner/source/Guardian before/after reads.

At recovery dispatch that Host has already failed/drained. A fresh such scope is
not available, so the proposed first path binds the **existing native tuple**:
owner SID, device fingerprint, enrollment evidence, exact original client
PID/full 100ns birth/session and real logon LUID. Native Guardian independently
derives/checks those values from its original pipe/process/token/store handles.
There is no invented native Owner epoch or claim that cached project JSON is a
current own-PG grant. The existing recovery pins remain signed continuity data,
not native database authority.

The existing recovery PIN_KEYS do **not** contain source SHA. The new adapter
must read the existing real `readVerifiedInstalledExecutableW68(app)` source
proof as part of its private producer scope; do not invent a source field in a
cached v1 recovery receipt. At ARM, require equality, not merely signatures over
two datasets: held EXE SHA equals `origin_browser.executable_sha256`; held
`resources/app.asar` SHA equals the original recovery `binding.asar_sha256`;
held signed manifest package version equals `binding.package_version`; and held
manifest source/version/proof/package identity equals that original trusted
W68 source observation. Recheck these equalities after native PREPARE and before
signing/creating effects. A concurrent update or mixed old/new package is HOLD.

The successor must independently complete normal bootstrap and existing
goal/Owner admission. No SEED/ADMIT/ACTIVATE/worker permission is carried over by
the launch receipt. A future goal-bound MAIN purpose would have to mint its
separate scope **inside the live own-PG/W74 callback before RELEASE**; that is
outside this first same-version recovery purpose.

## Proposed fixed handshake

Use only the existing fixed Guardian pipe. Proposed separate request/result
schemas are `metaengine.browser-guardian.main-launch-request.v1` and
`metaengine.browser-guardian.main-launch-result.v1`, with a distinct canonical
domain `METAENGINE_GUARDIAN_MAIN_RECOVERY_LAUNCH_V1`. These are proposed names,
not implemented compatibility promises.

| Operation | Real producer/consumer and meaning |
| --- | --- |
| PREPARE | Loaded enrolled-device read purpose; native Guardian captures and qualifies its actual retained root/session, then creates a CNG nonce tied to that opaque lifetime. No process or durable launch permission. |
| ARM_AFTER_ORIGIN_EXIT | The original recovery transaction scope signs its one exact effect. Guardian consumes its own nonce, reserves the durable MAIN slot, creates a suspended child and returns an exact ARMED receipt. The permission explicitly allows one resume after that original process exits. |
| OBSERVE | Authenticated readback of that original ticket/effect; no directory creation, write, retry, alternate PID, root minting or process effect. |
| CANCEL | Exact owned effect cancellation by the still-authenticated origin or expected successor; never arbitrary process termination. Cleanup facts remain separate from effect absence. |

Signed ARM material must include operation, effect/ticket UUID, effect generation,
command UUID, nonce, native challenge, original PID/full birth, native tuple
digest, source SHA/version, retained EXE/package/namespace/proof digests and the
existing recovery binding/drain digest. All OS-derived fields must match the
native retained scope; wire values only constrain it. No path, URL, shell, argv,
environment, session selector or claimed `verified` field is accepted.
FILETIME and process incarnation values stay exact strings; no JS Number
conversion of 100ns timestamps is permitted.

Expensive namespace capture/hashing should move from ordinary stage1 PROBE to
explicit PREPARE. Existing loaded Owner PROBE has a 2-second read-only transport
and must not become a full-package scan or launch permission. Both PREPARE and
ARM use a fixed-purpose client and original socket-close ownership, with finite
timeouts and no retries. Existing installer/client schemas stay separate.

### Authenticating the response before origin quit

P-256 authenticates the request, not an ARMED response. A fixed pipe name and
FIRST_PIPE_INSTANCE do not authenticate the connected server, including gaps
between instances. Before planned quit, the client must kernel-bind the **actual
connected pipe** with `GetNamedPipeServerProcessId` to the machine-verified SCM
Guardian process, retaining its full birth/image identity across the exchange,
and check the full nonce/effect/child receipt. Without this, an unprivileged
preempting pipe server could forge ARMED and make the origin quit.

The current `net.Socket` transport has no mounted native server-peer producer.
Do not accept a PID, service status JSON, arbitrary HANDLE, `peer_verified` flag
or a second connection's identity in its place. The proposed producer is a narrow
in-process native client module in the existing Guardian component/package. It
owns CreateFile on the fixed pipe and its original SCM/process/file handles,
checks the existing fixed machine service location/identity and connected-peer
PID/birth before/after I/O, and exposes only fixed-purpose request methods to the
private Main composition. Its exact module bytes must be covered by the existing
signed package inventory; no caller-selected module/pipe/provider path or new
key/service/root. The crypto/build owner must include this exact native artifact
in the reviewed package. This interface is part of the requested review, not an
already available producer. Until mounted and qualified, no ARMED receipt may
cause `runtimeRecoveryPlannedQuit` or `app.quit()`; the original Main stays alive.

## Singleton and retained ownership

`main-entry.mjs` takes the real Electron singleton before runtime admission.
Resuming a second normal EXE beside the old Main can activate the old window and
exit successfully; that is not a new MAIN. Do not add a singleton bypass.

For the recovery purpose, native Guardian creates the child suspended, persists
its exact identity and ARMED_WAIT_ORIGIN_EXIT, and replies while the old Main is
alive. Only then does the private adapter mark planned quit and call existing
`app.quit()`. Guardian observes exit through the **original retained process
handle**, rechecks its owned intent, current owner/logon/code prerequisites and
original stop admission, and performs at most one resume. No PID-only liveness
sample substitutes for the retained exit signal. A concurrent unrelated primary
winning the singleton is a failed/unconfirmed successor, never READY or a retry.

The Main lease must own its retained namespace independently of the read-only
`GuardianNativeRootSession::state_`. Resetting an observation after origin death,
a new PROBE, or installer DISPATCH must not release an active Main namespace.
After a valid ARM, origin death has the explicit signed after-exit meaning;
before valid ARM, it only invalidates preparation. Any lost ARM response remains
an unresolved original effect, not permission for another effect UUID.

An expected successor's existing signed PROBE can authenticate its actual held
PID/birth/session/logon/Job and associate it with the owned child. This does not
manufacture launch permission or a Host epoch. Existing recovery
`acknowledgeSuccessor()` additionally requires that exact controlled-child
readback, then its normal fresh Host/PG/bootstrap checks before CONFIRMED.
The recovery selector remains correlation data, not authority by itself.

The adapter/controller cancellation path needs a concrete CANCEL-and-join fence
before an ordinary user quit. Set `runtimeRecoveryPlannedQuit` only after the
exact ARMED receipt, not merely before a potentially failed native request.
The final cancellation/resume race must be ordered in the original service-owned
state machine. No guessed absence or timeout response can erase a retained ARM.

## Fixed native executor

The only target is the EXE held by the qualified installed scope. Cwd is its
immutable installed directory. The only argv besides the quoted EXE is the
existing `--metaengine-runtime-recovery=<exact-ticket-uuid>` selector; no debug,
smoke, RunAsNode, installer, no-sandbox or singleton-bypass arguments.

Build a fresh environment allowlist using native Windows/system-directory,
retained token profile and KnownFolder values: SystemRoot/WINDIR, a System32-only
PATH, USERPROFILE, APPDATA, LOCALAPPDATA and the required token-owned TEMP/TMP.
Do not inherit user PATH or Node/Electron/OpenSSL/provider/compatibility overrides.
Machine-protected code namespace and supported loader policy are mandatory.
Do not globally change Electron fuses: existing RunAsNode sidecars are separate.

Use STARTUPINFOEX + CREATE_SUSPENDED + `PROC_THREAD_ATTRIBUTE_JOB_LIST` to assign
the preconfigured service-owned KILL_ON_JOB_CLOSE Job **at process creation**.
Create-then-assign has an orphaned suspended-child crash window. Require explicit
machine-owned process/initial-thread security descriptors; a same-user process
must not resume or inject before Guardian's checks. No service/job/token handles
are inherited/exported, and there is no breakaway fallback.

Before resume, through original handles: verify child PID/full birth, token SID,
session and AuthenticationId, current exact WTS logon, actual image path and held
EXE file ID/hash, complete namespace/oplocks, protected owner tuple, exact Job
membership/limits, code policy and stop admission. `ResumeThread` returning
exactly 1 is the sole expected transition; other results do not permit another
resume. This is not full loaded-code/V8 attestation.

## Durable effect and stop integration

Use the existing machine-secure Guardian root and write-ahead architecture with
a separate MAIN profile and one durable active slot. The installer journal is
not a MAIN permission. Keep exact original signed bytes/receipts.

Persist and read back CREATE_INTENT before atomic Job creation, then
CREATED_SUSPENDED/ARMED_WAIT_ORIGIN_EXIT with exact identity before the ARM reply,
then RESUME_INTENT before ResumeThread. Each new physical stage obtains its own
admission from the **original** service context. An unresolved active slot fences
new UUIDs too. Crashes/write failures after a barrier are reconcile-only; never
create/resume again from an unknown result. Record separately process creation,
never-resumed status, confirmed termination and actual resume.

The existing worker wait set must include a borrowed synchronization handle for
pending origin exit/owned child completion; waiting until another pipe request
is insufficient. The existing stop owner must add this wake-up without freeing
pending pipe I/O early. There is no new scheduler, service or retry loop.
Namespace release requires confirmed zero active processes in the retained Job,
not only exit of its Main PID.

This MAIN wait/drain rule must **not** become a blanket installer wait. The stop
owner identified a separate existing defect: `launchInstaller()` returns
DISPATCHED and closes original process/thread handles, including some ambiguous
suspended cleanup outcomes; the service currently owns only worker completion.
The current installer is fresh-only and does not itself stop Guardian; an
existing different service makes bootstrap HOLD. The deadlock risk is for a
future replacement/handoff that stops Guardian, not a demonstrated current
cycle. Waiting synchronously for that installer's exit during Guardian STOP
would then deadlock. Installer custody must use its own
authenticated original-handle transfer/recipient contract in the existing
Owner/WTS/broker architecture before the service can release it. A JSON ACK or
PID reopen is not a transfer. This checkpoint does not claim that such a native
recipient is already mounted. MAIN and installer permissions/slots are distinct;
owner5755 owns `GuardianScmEffectOwner`, `launchInstaller()` and shutdown changes.
For future replacement the release condition is exact terminal completion OR
physically checked transfer of original handles to an already running approved
owner before SCM STOP; neither `bootstrap.ready` nor Browser successor JSON is
that acknowledgment.

Read-only source trace found **no already mounted installer-handle recipient**:
the native emergency controller exchanges dispatch/observe JSON only;
`self-update-runtime-v8.mjs` calls `prepareInstallerHandoff` before
`quitAndInstall`; `browser-sentinel.mjs:prepareInstallerHandoff` releases its
worker; `installer.nsh` / `installer-shutdown.ps1` implement a fresh-only
file/process-use gate, not an authenticated transfer; the existing BrokerLease
deliberately keeps its last Job handle in Guardian. Existing successor/old-parent
handoff receipts are not original Windows HANDLE ownership. The existing NSIS
installer is a possible recipient for a **new, separately reviewed** exact-child
transfer consumer, but parent PID/JSON ACK or a PowerShell helper cannot stand in
for it. Until such a real receiver exists, new installer dispatch must remain
HANDOFF_REQUIRED and already-created uncertain effects must retain custody.

Before resume, STOP/cancel cleans only the exact owned never-resumed child and
joins completion. After resume, normal STOP must use the actual existing Main
graceful-drain path and retain ownership until completion. Crash kill-on-close
behavior and own-PG crash/data continuity need physical qualification; do not
silently turn normal STOP into an unqualified destructive kill or claim STOPPED
while its owned work remains. This lifecycle contract requires owner5755 review.

## Shared sections for Guardian stop owner5755

Line anchors below refer to local `5b3007a4`; function names are stable review
anchors. The stream must apply its own status/OBSERVE-order corrections first.

| File/section | Proposed custody-stream change | Stop-owner boundary |
| --- | --- | --- |
| `browser-guardian-scm-service.cpp:updateActuatorWorker` (199/219/221) | Fixed MAIN routing/serialization and borrowed lease wake input, while preserving the original context construction. | No replacement of status/control code or new admission owner. |
| `service.cpp:waitOverlapped/connectPipe` (111/125) | Request narrow borrowed origin/child synchronization input. | Implementation of pending-I/O cancellation/join and wait ordering belongs to owner5755. |
| `service.cpp:serviceMain` (227) | Request owned lease stop/drain hook. | STOP latch, status transitions and worker/handle teardown remain owner5755's changes. |
| `actuator.cpp:GuardianNativeRootSession::State` (1282) | Separate observation scope from retained ControlledMainLease. | Do not edit installer state/effect ownership. |
| `actuator.cpp:GuardianNativeRootSession::handleReadRequest` (1396) | Keep legacy PROBE cheap; route explicit native MAIN preparation into the sealed producer. | Preserve the original service admission reference. |
| New `browser-guardian-main-launch-*.hpp/.cpp` | Private purpose parser, owned scope/lease, MAIN WAL, fixed executor and separate result serializer. | No edits to legacy `handleGuardianUpdateActuatorRequest` (1060), installer `launchInstaller` (874), or legacy OBSERVE ordering. |
| `browser-guardian-installed-namespace.*` | Private borrowed original-EXE/code-policy access for the controlled lease only. | No public `launch(path, verified)`/JSON capability conversion. |

## Prerequisites and review decision

Actual static crypto linkage/provenance, production-root signature positive,
same-handle Authenticode signer binding, active release/freshness policy,
machine-protected installed code and actual Windows mapped-writer/Job/DACL/
singleton/stop/data-continuity tests remain mandatory. Missing prerequisites
return a typed HOLD before effect creation; no runtime/build flag supplies them
as authority. Cold first install must use the separately reviewed original
installer-owned bootstrap producer from the mandatory clean-machine contract;
it must not depend on a preexisting recovery producer or silently reuse this
post-install purpose.

Requested review checkpoint: approve/adjust the concrete existing recovery
producer, after-origin-exit ARM semantics, separate lease/WAL and the narrow
owner5755 interfaces and native connected-server peer producer above before request schemas, signer methods or production
dispatch are changed. This document alone is not approval or qualification.

Primary API references: [atomic Job creation](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812),
[CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw),
[thread access](https://learn.microsoft.com/en-us/windows/win32/procthread/thread-security-and-access-rights),
[ResumeThread](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-resumethread),
[connected pipe server PID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid).
