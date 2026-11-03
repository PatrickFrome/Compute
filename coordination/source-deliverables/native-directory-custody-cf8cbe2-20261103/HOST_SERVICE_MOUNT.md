# Recovery directory custody: source interface and mount requirements

Status: **HOLD**. The default Host does not mount recovery. This change adds
internal Win32 mechanics and an original-request prerequisite; it does not add
an authenticated native issuer or make backup, restore or selector registration
reachable. Windows build and execution are **NOT RUN**.

## Existing authority and the new prerequisite

`native-coding-recovery-directory-lifetime.mjs` resolves the exact original job,
server dispatch and recovery phase from their existing private registries. It
compares the six original server binding fields, signal, retained deadline and
phase token before invoking their original synchronous vetoes. Public lifetime
factories, copied records, native-looking JSON and caller callbacks do not supply
custody. `beginOriginalRecoveryDirectoryCustody` then calls the existing fixed
`native_recovery_original_directory_custody_required` refusal. The producer waits
for it before connecting a source pool or performing filesystem/native effects.

`owned-protected-backup-root.mjs` remains read-only. Without an original sealed
registration it refuses before REGISTERING, encryption, identity-store writes or
`mkdir`. Even a sealed READY selector remains an observation; it cannot bypass
the producer's native custody refusal. Existing recovery vetoes remain required.

## Internal native mechanics

`native/browser-guardian-scm/recovery-directory-handles.hpp/.cpp` is compiled in
the existing static original-Main source-set. It has no NAPI entry, arbitrary
path acquisition, separate helper executable, signing key, wire permit or
positive authorization export. Its binding strings are correlation only.

The interface consumes borrowed original handles, duplicates and compares the
exact native opens, and strengthens their sharing with `ReOpenFile` on the
original object. It records volume/file/birth identity and checks reparse and
case-sensitive state. A retained direct child is required to keep each
directory nonempty: restrictive sharing alone does not exclude an
attribute-only empty-directory junction conversion. Raw native identity is
diagnostic; it is not an admitted replacement for the existing JavaScript
filesystem-identity digest.

The sole creation primitive uses a literal `protected-backup-root-v1` leaf and
exclusive `NtCreateFile(FILE_CREATE)` relative to an original retained parent.
It retains that same returned child; it does not mkdir then reopen, adopt a
collision, repair an orphan or select another parent. The new child remains
unanchored and unusable until the original issuer supplies an original direct
child anchor. This primitive itself performs creation, so only an authenticated
native issuer may call it after acquiring all required parent custody. The
current JavaScript selector does not call it.

Operation tickets and exact process/Job worker tickets track original joins.
Revocation prevents new work; cancellation, timeout and a callback-shaped claim
do not prove completion. Worker transfer duplicates the held opens into the
original process and compares the duplicate back. Unknown or abandoned work
retains/quarantines handles rather than reporting a drained operation. These
mechanics do not prove that a production worker or every descendant received
custody before it could act.

## Required production mount

The following work is still required before either fixed HOLD may be removed:

1. Extend the existing authenticated original-Main/native Host path with a
   private issuer that resolves the original request/job, current W74 Owner,
   original Host process and W76 own-PG birth. Do not accept caller paths,
   numeric handles, helper path/hash pairs, proof callbacks or JSON as admission.
   The issuer must own the original namespace handles and their acquisition
   provenance, rather than opening names after a final JavaScript check.
2. Retain the backup root, PGDATA and complete necessary parent chains before
   the first effect. For registration, also retain identity-store mutation
   ancestry and original state parent before REGISTERING or temporary identity
   files. Pin ACL/security state through the effect interval. The native
   mechanics do not issue ACL/Owner authority or prove ancestry completeness.
3. For creation, obtain missing fixed parents relative to retained originals,
   return and retain the same new objects, and publish the existing encrypted
   registration only under that custody. A crash, pending REGISTERING or
   orphan/collision remains HOLD; no automatic adoption or trust-root repair.
4. Pass custody to every effectful worker before resume, through the original
   runner/controller registry and original Job. Retain copies across helper or
   Host death and descendant lifetime. The present prepared runner inherits
   only its three stdio handles; this change does not implement that handoff.
   Do not duplicate a helper-owned Job into a surviving Host: an extra Job
   handle can defeat `KILL_ON_JOB_CLOSE` when the helper dies. The eventual
   issuer must preserve the original Job owner's crash behavior, for example
   by co-locating these mechanics with that owner and qualifying the handoff.
5. Bind cancellation, expiry and Owner/Host replacement to immediate revoke.
   Release only after the original processes/Jobs, pipes, SQL operations,
   filesystem completions and phase/send callbacks physically join. Request
   finish or cancellation must not destroy the cleanup owner. Unknown settlement
   stays quarantined and blocks retry; a late callback cannot reopen admission.
6. Supply a fixed `runtime-host.mjs` recovery composition with actual W76
   Owner/own-PG providers, protected connection data, tool pins and keeper
   vetoes. Its current optional `createRecoveryService` hook is unmounted in
   production. Import the composition through the reviewed Host source closure.
7. Resolve prepared native artifacts through the existing authenticated package
   registry in a Host-accessible layout. The current installed Node resolver
   expects a source/native-dist layout, while Electron packages the helper in
   resources and its manifest in ASAR. Do not invent a third native-tool trust
   component or treat explicit helper paths and hashes as authenticated origin.
8. Qualify the static Windows build and real kernel/filesystem behavior,
   including directory sharing, attribute/reparse changes, live PostgreSQL
   compatibility, process inheritance and all crash/join paths. Linux modeled
   tests cannot qualify these properties.

## Evidence boundaries

The Linux C++ model compiles the actual native mechanics with a deliberately
simulated Win32 object boundary. It independently models opens, share conflicts,
path replacement and relative creation. Its result is
`SYNTHETIC_NATIVE_MECHANICS`, `windows_native_execution: NOT_RUN`,
`physical_authority: false`, `authority_effect: false`. Request and producer
tests separately check original-registry refusal and zero effects after final
path observations. No real database, installed directory or service is used.

Primary API references:

- [ReOpenFile: reopen the same filesystem object with different sharing](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile)
- [CompareObjectHandles: compare underlying kernel objects](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-compareobjecthandles)
- [FSCTL_SET_REPARSE_POINT access and nonempty-directory restrictions](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165)
- [NtCreateFile: names relative to a directory handle](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
