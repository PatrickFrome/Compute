# METAENGINE Client Wave 9 W52 — native verifier implementation and missing authority receipts

Request: `metaengine-client-wave9-w52-20261015-001`.
Branch: `work/metaengine-client-wave9-w52-20261015`.
Parent: W44 DRAFT #1275 at `56ba9d7ebedd3805e778cbee4fdcb46ce07e574d`.
Scope: strictly READ_ONLY SOURCE/STAGING. No installed Owner, Guardian, Gateway, PostgreSQL, Browser or DevFleet modifications.

## Implemented

`NativeSupervisorClient.getTrustedOperatorOwnerVerifier()` is now a real
native-class method. It uses the W52 bounded concrete evidence reader and
advertises no verifier when required protocols are absent.
`getTrustedOperatorOwnerProtocolGaps()` reveals only fixed required
capability *names*, never fields or credentials. The W44 canonical reader
already calls the method via native main. No renderer/HTTP input or new poller.

The W52 provider independently samples kernel PID, creation time and
incarnation twice; rejects copied/absent incarnation, stale/stale-Owner
observations, PID reuse, non-Owner Guardian status, unsigned/missing exact
EXE identity, generation changes, secret-store mismatch, own-PostgreSQL
postmaster restart between reads, and any synthetic fixture markers.
The W44 wrapper additionally samples Host Owner before/after the complete
read. The source tests use generated controlled fake callbacks and never
assert installed proof or true native Agent provenance.

## Critical discovered missing protocols — BLOCKED

The current production `initNativeSupervisor` supplies no native
`trustedNativeOwnerReaders`: there is **no** authenticated Host-owned
`readHostOwner()` with Owner generation/epoch/project, nor an Owner-bound
kernel `readKernelProcess(pid)` returning independent incarnation and birth.
The existing Browser realtime Chromium census is not an OS Host Owner
census; W27 has a callback-only OS hook. W52 intentionally does not
shell out or promote telemetry to Host authority.

The existing `BrowserGuardianMachineBootstrapLauncher.status()` +
`BrowserGuardianStatusObserver` actually perform the signed Guardian
challenge, but project **only** OWNER_BOUND/device boolean. They do not
return the Owner ID/generation/PID/birth/incarnation required by W44. The
native Guardian wire protocol must first expose a signed Owner-scoped
read-only receipt, verified with the existing identity, without invoking
`ensureOwnerBound()` or any enrollment mutation.

The existing protected local runtime verifies its bundle and owns a process,
but its bootstrap/descriptor does not expose a separate installed Browser
EXE signed-identity receipt or a Host-side `readSignedInstalledExecutable()`
which checks actual EXE bytes, pinned source and existing signature authority.
A checksum of arbitrary supplied fields, a caller flag or the source Git
checkout is not a substitute.

The local provider descriptor and authenticated own-PG DB API do not expose
`readOwnerSecretStore(owner,generation)` plus independent
`readOwnPostgresBirth(owner,epoch)` to this Browser main process. Their
private credentials intentionally never flow into the Browser. A distinct
**Owner-authorized native secret store** read with the existing authority,
and independently qualified own-PG `pg_postmaster_start_time()`, must be
implemented before the readback becomes available. No hosted/Supabase
fallback is permitted.

Finally the Gateway's `readInstalledSource` is optional; no independent
production native signed-installed-EXE producer is attached. The Gateway
must obtain a separate exact native receipt with generation and source
before/after its authenticated own-PG hop. Reusing the Client's unverified
callback or W44 source fixture would be circular and is prohibited.

**Result:** source method and bounded verifier exist, but all six required
production protocols remain absent; `getTrustedOperatorOwnerVerifier()`
returns null in the current installed-main constructor. Consequently W44
returns UNKNOWN, not HEALTHY/LIVE/READY. In particular this is not an
end-to-end physical implementation, not a native signed EXE verifier, and
not release/installation authority. Do not bypass with shape fixtures.

## Controlled source qualification

Run `node --test apps/metaengine-browser/test/native-owner-verifier-w52.test.mjs`.
The suite instantiates the actual NativeSupervisorClient and existing
Guardian observer and W44 production canonical reader; the cross-hop
positive case is generated SYNTHETIC/STAGING even when shape checks pass.
Windows and Ubuntu source CI is in `native-owner-verifier-w52.yml`.
Run evidence must be tied to the resulting exact SHA; no parent greens
establish W52 acceptance. Independent W57 critic owns the single living
roadmap; this branch does not edit it.
