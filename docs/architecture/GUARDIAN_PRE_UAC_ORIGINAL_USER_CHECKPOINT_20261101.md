# Pre-UAC original user: retained native observation checkpoint

Status: **implemented source checkpoint; no qualified UAC dispatch, installation
handoff or first-MAIN launch**. Reviewed baseline:
`5031ecf8cb4b1d8450eb86a778e04e769cb5b7c8`, tree
`43520eaac2e0d35be73ef0de8c23872e801d0f4c`. The additions described below are
the small native phase following
[the noncyclic first-MAIN design](GUARDIAN_FRESH_MAIN_NONCYCLIC_AUTHORITY_20261101.md).
They introduce no service, trust root, credential, project/task permission or
full launch state machine.

## Actual original-user producer

The separate
[install-origin coordinator](../../apps/metaengine-browser/native/browser-guardian-scm/browser-guardian-install-origin-coordinator.cpp)
is built with an `asInvoker` manifest. Its zero-argument entry captures its own
original process and primary token before considering elevation; it never
infers an installer identity from a parent PID, environment, JSON or argv.

[GuardianOriginalInstallUser](../../apps/metaengine-browser/native/browser-guardian-scm/browser-guardian-original-install-user.cpp)
retains original process/token handles and exact OS-derived PID, full 100ns birth,
image path, SID, session, AuthenticationId, primary TokenId and ModifiedId.
Rechecks compare the retained token with the process's current primary token and
retain the original process incarnation. Elevated, session-zero, service,
restricted, unsupported integrity and impersonating contexts are refused.
Cancellation invalidates the current observation without racing a closed or
recycled cancellation handle. A failed observation hides current identity facts;
retained handles remain owned until joined close.

`asInvoker` does not force an elevated caller to become unelevated. Such a start
remains `TARGET_USER_BINDING_REQUIRED`; it cannot reconstruct a missing pre-UAC
user. Credential UAC can select a different administrator, so the elevated
bootstrap's SID/profile is not the intended user's identity. The original
unelevated principal must remain bound independently. Cross-account process or
token-query denial is HOLD, with no privilege enablement, credentials or
substitution of another token.

These are **SOURCE_ONLY identity observations**. An image path and token tuple
are not release qualification, loaded-code attestation or installation consent.

## Native observation link, with no release authorization

[GuardianInstallOriginLink](../../apps/metaengine-browser/native/browser-guardian-scm/browser-guardian-install-origin-link.cpp)
generates a CNG 32-byte challenge. The inner bootstrap's separate
`--observe-install-origin <64 lowercase hex characters>` route uses only that
bounded routing value. Its temporary pipe is local, message type, single instance
and first-instance-only, using the existing native pipe implementation. No
wire PID, SID, session, path or `verified` field supplies authority.

The [80-byte frame](../../apps/metaengine-browser/native/browser-guardian-scm/browser-guardian-install-origin-wire.hpp)
contains a fixed domain/version/role, zeroed reserved bytes and the challenge.
The ordering/cancellation fence permits one completed transport claim; it is not
an effect-admission object.

The inner reads a complete bounded message before capturing its actual pipe
client process/primary token and Identification-level message token. It reverts
the original thread before returning. The coordinator's private reciprocal
consumer binds the actual connected server to an original native process handle,
checking full birth/image/liveness and the original connection before and after
the exchange. It does not reopen a process from a wire PID.

**That reciprocal consumer is currently reachable only through the compile-time
mechanics test friend.** Production `requestElevation()` unconditionally returns
`INSTALL_RELEASE_SIGNING_AND_PROVENANCE_UNAVAILABLE` before creating an elevated
process. No production `ShellExecuteEx` dispatch or release-authenticated paired
installation scope is implemented. Possession of a routing nonce, native object
or kernel-bound observation does not bypass this gate.

The inner prints and flushes its HOLD diagnostic, then
`waitForOriginalCoordinatorClose()` retains its original process/token/pipe while
the coordinator performs its post-reply checks. It posts a bounded read on that
same connection. EOF clears the binding; cancellation/deadline/error terminates
the observation after joining pending I/O. This is neither an ACK nor transfer
of custody to SCM. The route returns exit 2 and never calls `installEmbedded()`.

## I/O and lifetime corrections included in this phase

- The client explicitly requests `FILE_WRITE_ATTRIBUTES` and selects message
  read mode. It cannot accept an 80-byte prefix of an oversized reply. The mask
  still excludes generic-write/pipe-instance-creation authority. Windows clients
  start in byte-read mode even for message pipes; see
  [Microsoft's pipe mode contract](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-type-read-and-wait-modes).
- Cancellation signals the original event without waiting for the operation
  mutex. Every pending operation keeps its original pipe, frame, event and
  `OVERLAPPED` storage through terminal kernel completion. A premature event wake
  or failed completion query cannot free pending storage. The shared join helper
  also retains ownership beyond a timeout when completion is unresolved;
  therefore the 15-second operation deadline is not a guaranteed total cleanup
  time. [CancelIoEx requests cancellation rather than proving completion](https://learn.microsoft.com/en-us/windows/win32/fileio/canceling-pending-i-o-operations).
- Win32 errors are captured before diagnostic string allocation; cancellation,
  malformed frames and CNG failures receive explicit error classifications.
  Impersonation exception paths attempt revert, and SID conversion memory has
  RAII ownership. Revert failure remains a distinct refusal.

The owning server never disconnects/reconnects its captured instance. Duplicating
a server handle alone would not distinguish an unobserved same-process
reconnection. The private ownership contract and terminal link lifecycle must
remain intact; no reconnect or retry restores a consumed/cancelled link.

## Preserved bootstrap and build boundaries

[The build script](../../apps/metaengine-browser/scripts/build-guardian-machine-bootstrap.ps1)
preserves the existing inner executable name, `requireAdministrator` manifest,
v1 bootstrap binding and embedded resources 201/202/203 for Guardian,
configurator and native manifest. Its hash changes with the new code and is
recomputed. The asInvoker coordinator and its source-only staging metadata are
separate artifacts. Their metadata explicitly reports UAC dispatch and SCM
custody transfer as unimplemented.

The existing no-argument/`--install` inner path is separate from the new
observation route. This checkpoint neither routes the new coordinator into that
effect nor converts its old bootstrap result into first-user/MAIN authority.
No native module-load gate, existing Owner/device predicate or recovery gate is
relaxed.

## NSIS integration remains unimplemented

The repository pins
[electron-builder/app-builder-lib 26.15.7](../../apps/metaengine-browser/package-lock.json).
The exact official
[app-builder-lib distribution](https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.7.tgz)
was inspected against the lockfile integrity value. In its current per-user
installer configuration, `installer.nsi` requests user execution level; this
does **not** mean assisted installation cannot elevate later. Its assisted/UAC
paths remain relevant. `preInit` executes before `initMultiUser`; `customInit`
executes afterwards. A requireAdministrator helper cannot retroactively capture
the original user after that transition.

The future minimal integration is an identity-only rendezvous in `preInit`,
guarded against `BUILD_UNINSTALLER` and UAC inner instances. Before installed
resources exist, its verified native helper must be an exact embedded installer
payload rather than a lookup under `$INSTDIR`. The original helper must stay
alive through a genuine authenticated native handoff; an exit-2 snapshot or
saved JSON cannot replace its retained process/token ownership.

Opening, previewing or cancelling the welcome UI must not dispatch UAC, mutate
SCM, stop a client, provision PG or create a durable installation intent. Existing
[customCheckAppRunning](../../apps/metaengine-browser/build/installer.nsh) remains
in the committed install section. The actual consent/release/fresh-state gates
must precede later elevation/deployment. Current `runAfterFinish` is not replaced
by this checkpoint; a future qualified first-MAIN integration must replace it
without falling back from HOLD to ordinary unqualified MAIN launch.

## Evidence and remaining acceptance

| Lane | Evidence at this checkpoint | Limit |
| --- | --- | --- |
| Portable production C++ wire/fence | 12 cases executed and passed on Linux | Framing/order/cancellation only; no Windows identity or install scope |
| Affected Guardian/recovery and installer regression suite | 357 PASS, 0 FAIL, 10 SKIP; source checks 277 PASS | Disposable profile; unavailable Windows/Electron/NSIS lanes remain explicit SKIP, not qualification |
| Original-user native probe | 16 Windows cases implemented; cross-compilation evidence | Actual Windows execution not performed in this phase; eligible-user positives explicitly skip when no real unelevated interactive token exists |
| Origin-link native probe | 19 Windows cases implemented, including oversize frames, actual pending I/O cancellation, premature event wake and terminal EOF/cancel | Actual Windows execution not performed in this phase; conditional positives require the actual eligible original user |
| Native core/inner/outer build | Windows-target cross-compilation checks | Actual MSVC build, PE execution-level manifest readback and Windows execution remain pending; cross-compilation is not that qualification |

Sources: [portable tests](../../apps/metaengine-browser/test/browser-guardian-install-origin-wire.test.mjs),
[original-user probe](../../apps/metaengine-browser/test/native/browser-guardian-original-install-user-probe.cpp),
[origin-link probe](../../apps/metaengine-browser/test/native/browser-guardian-install-origin-link-probe.cpp).
Windows SKIP is not a positive kernel/OTS/UAC result. No UAC, SCM mutation, first
MAIN, service handoff or real installation was exercised by these tests.

The real protected release signer, immutable verified artifact handoff and
authenticated detached-sidecar placement are still missing, as reported by
[W77](../../apps/metaengine-browser/scripts/release-proof-producer-w77.mjs).
No test key, editable manifest, callback or boolean can replace them. Remaining
implementation includes NSIS original-user lifetime integration, qualified UAC
dispatch, authenticated existing-SCM custody handoff, first-MAIN creation and
the separate bounded first-Owner issuer. The native module-load rail also stays
HOLD. Follow the separate
[clean-machine contract](GUARDIAN_CLEAN_MACHINE_BOOTSTRAP_CONTRACT_20261101.md)
and [first-MAIN authority design](GUARDIAN_FRESH_MAIN_NONCYCLIC_AUTHORITY_20261101.md);
this phase claims neither installer readiness nor full V8 attestation.
