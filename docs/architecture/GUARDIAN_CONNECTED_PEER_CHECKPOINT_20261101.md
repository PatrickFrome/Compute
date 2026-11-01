# Connected pipe: implementation checkpoint before launch protocol expansion

First installation uses the independent installation authority described in
[`GUARDIAN_FRESH_MAIN_NONCYCLIC_AUTHORITY_20261101.md`](GUARDIAN_FRESH_MAIN_NONCYCLIC_AUTHORITY_20261101.md).
This observer/loader is not a prerequisite for its own first-Main launch.

This source checkpoint follows the reviewed direction in
[`GUARDIAN_CONTROLLED_MAIN_LAUNCH_CHECKPOINT_20261101.md`](GUARDIAN_CONTROLLED_MAIN_LAUNCH_CHECKPOINT_20261101.md).
It adds the native client observation producer and closes the old recovery quit
path. It does not add PREPARE/ARM, create a process, install a service, create a
key, or qualify full loaded-code/V8 attestation. Publication remains coordinated
with the parent stream. Published native base is
`6af8ba9b309fa4725f3d06ee4a94fe52ba1f1d09`; this phase starts at local
`251e1ab5882942d0fe74df960b521f10c7e303a0`.

## Native producer and actual boundaries

`browser-guardian-connected-peer.*` has a zero-argument production factory. Its
original `CreateFileW` opens the fixed existing pipe inside the calling Main,
with an explicit mask excluding pipe-instance creation and
`SECURITY_IDENTIFICATION`. It retains that client pipe, its actual server process
handle, full FILETIME birth and image path, original SCM/service handles and
captured code namespaces. Recheck never reconnects or replaces these scopes.
Kernel rechecks include the original connection, client PID, retained server
PID/birth/liveness/image and a connected-pipe peek; the same pipe name, server
PID and birth cannot revive a disconnected original handle.

The SCM observation requires the actual RUNNING own-process service PID,
LocalSystem/session zero, fixed quoted no-argument ImagePath and the existing
machine slot. Same-handle hashing and the stage1 retained namespace fences apply
to that slot. The actual calling process must have the fixed installed Main
path; its retained signed W68 package must contain the exact Guardian bytes and
source/version/staging-manifest-derived slot. Caller JSON/hash/PID/path/handles
cannot mint a production scope. The test-only friend is compile guarded.

Any failed observation clears the current qualification fields. Even if all
these observations complete, the result stays HOLD with launch admission
UNAVAILABLE: loaded-image provenance, Authenticode signer binding and active
release/rollback policy are separate real prerequisites. Static release crypto
linkage is also deliberately unavailable in the default build until supplied by
its existing owner. Reopened on-disk bytes are not described as proof of the
server's already loaded code. Normal-user token/SCM access denial remains a typed
HOLD; no privilege or security-descriptor changes are attempted.

The existing Owner observer now uses
`OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, ...)`. This still queries
the original impersonated **thread** token; TRUE changes only the access-check
context and permits a SecurityIdentification token to be read. It does not use
the server primary token as the client. The client grants identification only.
The actual completed-message, impersonation/revert, SID/session/full-birth test
is in the Windows probe. See [Microsoft's OpenThreadToken contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openthreadtoken).

## In-process bridge and module-load prerequisite

The N-API wrapper binds an opaque type-tagged native owner, not a serialized
snapshot. Async work retains the native scope independently of JS GC. The core
and its cancellation event are published before OPEN is queued. Both close and
pending-OPEN revocation set that original event immediately, before joined
cleanup is queued; cancellation cannot wait behind the hashing work it cancels.
Snapshots are cached observations and grant no authority. Environment teardown
memory ownership is tested; a bounded Worker/environment termination time is
explicitly UNQUALIFIED because Node can run cleanup hooks after active work.

The build script uses four hash-pinned official Node 24.0.0 headers and their
license, Node-API v9, static CRT, and stable exports from the already running host
executable. It introduces no Node runtime/library discovery or DLL provider
search. Packaging stages this `.node` and provenance separately from the existing
two-binary Guardian manifest. Build-host compilers/headers are not installed-PC
dependencies. A staging manifest is compilation evidence, not runtime authority.

**The production JS loader stops before requiring the native module.** W68
inventory verification alone does not hold an immutable namespace across loading
`.node` from per-user LocalAppData. A later native rejection cannot undo native
code already executed. The fixed loader therefore returns
`GUARDIAN_CONNECTED_PEER_NATIVE_LOAD_CUSTODY_UNAVAILABLE`, without accepting a
path, verifier callback, environment override or claimed flag.

The missing producer belongs to the existing native machine bootstrap/Guardian
chain: deploy the exact authenticated module plus required DLL closure into an
owned immutable slot, establish original creation/handle/ancestor custody before
exposure, preserve it across loading into the actual Main, and bind its bytes to
the same approved package/source. Changing ACLs after an attacker could have
retained a writable section is insufficient. No new service/key/root or
preinstalled Guardian may stand in for this producer. The fresh-bootstrap owner
must include this contract in the mandatory clean-machine path. Current source
does not claim it exists.

## Mounted recovery fence and next protocol boundary

The real recovery adapter still checks its original ticket/PID/full birth/image
before observation, but it now refuses unqualified peer/launch prerequisites
before the Sentinel planned-quit callback, `app.relaunch()` or `app.quit()`.
There is no fallback. Existing durable DISPATCH_INTENT handling preserves an
unresolved effect and prohibits replay. A regression reproduced the old
app-shaped Node caller reaching relaunch/quit; the new path refuses it with all
three callbacks untouched. Model transaction adapters remain explicitly test
fixtures, not an alternate production mount.

The next phase must connect the real loaded identity and existing recovery
transaction to the reviewed purpose-bound PREPARE/ARM contract. It must also own
the suspended successor/Job and the one-use transfer after original Main exit;
the old live capability cannot silently survive that exit. Neither this observer
nor source/SCM JSON is an ARMED receipt. Existing service/actuator routing,
`GuardianScmEffectOwner`, original stop admission, OBSERVE order and installer
ownership are unchanged in this phase. Installer handoff and MAIN custody stay
separate; there is no blanket installer shutdown wait.

## Verification boundaries

- The Windows probe has 15 mechanics-only cases: original PID/full birth,
  caller-close ownership, invalid/nonpipe/server-end/disconnected handles,
  substitution and same-name/same-process reconnection, actual server exit,
  cancellation before OPEN/no retry, close and original Identification-token
  readback. It uses disposable pipes and its own child Job, no production
  service, credentials or OS security mutation. Fixture success cannot qualify
  Guardian source or grant launch authority.
- Actual Node N-API ownership is exercised with the unchanged wrapper and an
  explicitly synthetic core. Saturated-pool cancellation was reproduced red
  when immediate cancellation was removed, then green with the fix. This is not
  Windows or Electron attestation.
- Windows target cross-compilation is compile/link evidence only. The existing
  exact-head Windows workflow now builds/runs the original-pipe probe, builds
  and refreshes the native artifact with vendored pins, and checks host N-API
  exports without opening the production pipe. Its runtime results are pending
  until this exact source is published and that workflow runs. Previous base CI
  success is not inherited.
- Actual clean Windows installation, protected native module loading, loaded
  server provenance, production-root positive signature, active release policy,
  PREPARE/ARM and suspended singleton/Job/stop/data continuity remain open.
