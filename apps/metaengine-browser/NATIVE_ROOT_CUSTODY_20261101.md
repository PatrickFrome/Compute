# Guardian native root/session custody: first integration stage

Base: `0e43a569ad52134bee65dea3182ee9a4c4bbc56f`, tree
`897948a6e65c980f560f97b71abaca96c91e4069`.
Integrated draft parent: `e6c72339ad4246018176407a971811c0dfceccf3`, tree
`58441b46100f2347b9588855d5c7a544a7d65a0d` (PR #1393).
Subsequently rebased without changing the existing max-macro fix onto
`6af8ba9b309fa4725f3d06ee4a94fe52ba1f1d09`, tree
`765077a6689f500f6eb97e63535f1bb38b2d6ced`. The detailed controlled MAIN producer
and protocol review checkpoint is in
[`GUARDIAN_CONTROLLED_MAIN_LAUNCH_CHECKPOINT_20261101.md`](../../docs/architecture/GUARDIAN_CONTROLLED_MAIN_LAUNCH_CHECKPOINT_20261101.md).

This stage mounts an actual native session producer in the existing Guardian SCM
worker. It does **not** qualify a release, attest loaded runtime/V8 code, authorize
MAIN, or change the existing Host Owner lineage. The native contract and receipts
explicitly retain `native_main_launch_implemented: false` and
`loaded_runtime_code_attested: false`.

## Producer and lifetime

`GuardianNativeRootSession::handleReadRequest` accepts only the actual connected
`OwnerEnrollmentPipe` after its bounded message read. It observes the pipe token
and process birth itself and reads the existing protected owner store itself.
Only an authenticated enrolled-device signed PROBE can acquire the namespace.
The device proof is checked again against the independently reread owner record.
Caller-created observation structs, paths, JSON receipts or `verified` flags
cannot construct this scope.

The SCM worker owns the noncopyable scope across requests. It retains:

- The original client process handle, full 100ns birth, SID and session.
- The exact WTS primary token and its real logon LUID, compared with the client's
  process token and with the current WTS token on every authenticated recheck.
- The original protected owner-record file and every ancestor handle, with no
  write/delete sharing, followed by independent protected-store readback.
- Every directory ancestor of the fixed installed path derived from that token's
  `LocalAppData`, then every file and directory in the code namespace.

The owner tuple remains SID, device-key fingerprint and enrollment evidence.
There is no invented owner epoch. Host W74 continues to own its own-PG lineage.

`GuardianInstalledNamespace` keeps original volume/file IDs, rejects reparses,
multiple hardlinks, case-sensitive directories and unsafe owner/DACLs, and hashes
each file through its original retained handle. The entire code tree must be
owned by SYSTEM/Administrators, without non-machine write/delete/owner-control
grants, including inherit-only grants for future children. Machine-owned ACLs
are required because directory handles alone cannot prevent planting a new DLL.
The producer never repairs permissions or moves installed data.

Every retained file also requires a current read-caching oplock
(`FSCTL_REQUEST_OPLOCK`, `OPLOCK_LEVEL_CACHE_READ`) on its original overlapped
handle. Only `ERROR_IO_PENDING` counts as a grant. This acquisition rejects a
preexisting writable user-mapped section, including one surviving closure of its
writer file handle. Future write-capable opens are denied by the retained
`FILE_SHARE_READ` handle. An oplock break permanently invalidates custody; it is
never acknowledged/rearmed into a fresh scope. Reads and oplock requests keep
their `OVERLAPPED`/event/buffer storage alive until cancellation completes.

Rechecks use the retained handles for identity, content, ACL and membership.
They use the existing W68 budgets of 100,000 entries, depth 48 and 12 GiB total, and
stop when the SCM stop event is signaled between hash reads. Unauthenticated
requests cannot trigger a namespace hash scan. Invalidated custody is discarded;
there is no automatic launch or retry. A separately authenticated installer
DISPATCH releases this observation lease before the existing installer journal
and actuator execute, so retained files do not prevent the intended update.

Receipts expose only current observations (`native_root_custody_held`, digests,
file count, reason). These fields cannot recreate or transfer the native scope.
The state `NATIVE_ROOT_NAMESPACE_HELD_AUTHENTICITY_UNQUALIFIED` is deliberately
narrower than an approved execution root.

## Existing signature primitive consumer

The native session calls `bindRetainedReleaseSignature` after capture and native
owner rechecks. The build contract is the compile-only
`METAENGINE_GUARDIAN_RELEASE_SIGNATURE_LINKED` definition plus linkage of the
existing `browser-guardian-release-signature.cpp` and the crypto/build stream's
reviewed static OpenSSL dependency. This patch does not set that definition or
change its trust root. The default build reports
`RELEASE_SIGNATURE_BUILD_UNAVAILABLE` and cannot manufacture a verified result.

When linked, the consumer reads the fixed W77 envelope through its retained
handle, decodes its exact canonical Base64 signature, and invokes the existing
private-construction `VerifiedReleaseSignatureV2` verifier. It compares the
signed EXE and SLSA sidecar digests with original retained files. It recreates the
entire canonical W68 package inventory (UTF-8 JSON, globally sorted slash paths,
exact field order and terminal newline) from the retained handles and compares
it byte-for-byte with the signed-digest-bound retained package-code sidecar.
The five existing W68 top-level exclusions remain exact; no new exclusions,
wildcard directories or unpacked `resources/app` code are accepted.
Signature binding currently refuses non-ASCII inventory names rather than
substituting Windows/C-locale folding for W68's ECMAScript Unicode lowercase
alias checks. Namespace observation itself supports Unicode. A mandatory
Windows case uses distinct `U+0130` and `i+U+0307` names and confirms this refusal;
exact Unicode folding parity is required to remove this conservative limitation.

`retained_release_signature_bound` is only a signature/file-binding observation.
Even a successful bind explicitly reports
`RELEASE_SIGNATURE_BOUND_FRESHNESS_AND_AUTHENTICODE_UNQUALIFIED`. It is not read
back as a capability and does not enable MAIN or Host Owner admission.

## Remaining producer/consumer contracts

1. **Release/code authenticity qualification:** crypto/build must supply its
   reviewed Windows static verifier build, with a real production-root positive.
   The original-handle consumer is implemented, but Authenticode signer binding
   and the existing active-release/freshness policy still need their native
   producers before an approved execution scope can be minted. Historical valid
   signatures or caller-selected publisher/build/hash values do not supply that
   policy. No substitute trust root has been introduced.
2. **Windows qualification of writer/mapping fences:** the source now requires
   the read oplock grant and retained restrictive share together, rather than
   treating a rehash or an advisory break event as proof. Two mandatory native
   negatives create a PAGE_READWRITE section and close its writer handle, with
   and without an active mapped view; either accepted capture fails the probe.
   These cases are not optional skips. The implementation cross-compiles, but
   actual Windows execution is pending before promotion to launch authority.
3. **Installed namespace producer:** a conventional owner-writable LocalAppData
   installation fails this custody gate. The installation stream must provide
   machine-protected code directories/files at the existing fixed location, or
   agree an equivalent existing architecture solution. User data remains mutable
   outside the held code namespace. No local permissions were changed.
4. **MAIN launch consumer:** use a distinct, explicitly signed MAIN launch intent
   bound to the held namespace/executable digest and native owner/session tuple,
   with its own effect identity in the existing durable write-ahead architecture.
   PROBE and installer tickets/effects are not launch permission. After the
   authenticity/mapping requirements are met: create suspended, verify actual
   child PID/full birth/SID/session/logon/image identity, bind retained ownership
   before resume, and retain it afterwards. Build an allowlisted environment
   without user-selected DLL/provider/Node/Electron injection. The current
   standalone Broker executor accepts caller paths and cannot supply this proof.
5. **Lifecycle integration:** this stage checks original process liveness before
   every request and fully validates before reporting custody; destruction of
   the worker drops all handles. The SCM stop stream must keep the borrowed stop
   event alive until the worker exits. The integrated draft already joins its
   worker; its independent stop/effect review remains external to this change.
   A future idle owner-exit wake-up should
   use the original process handle in the existing worker wait, without another
   scheduler or a PID-only reopen.

## Verification boundaries

The service and namespace probe cross-compile to Windows x86-64 with Zig 0.14.1,
`-std=c++20 -Wall -Wextra -Werror`. This is compile/link evidence only.

The new Windows runtime probe creates and removes only a disposable temp fixture
with machine-owned ACLs. It checks same-handle digests, live writers, writable
code ACLs, preexisting writable mapped sections, hardlinks/reparses, denied rename/delete/write while held, privileged
membership/ACL drift, cancellation, and handle release. Unsupported optional
filesystem operations and unavailable fixture privilege are explicit skips.
The existing Windows runtime workflow additionally compiles the mounted service
and runs its read-only self-test; a missing machine-owned fixture fails that
required hosted step rather than qualifying the platform.

Linux Node contract/lineage tests, Windows-target compile/link, and actual Windows
runtime results must be reported separately. No Windows execution or installation
has been performed in this Linux environment.

Cancellation is joined before releasing I/O storage. This is memory-safe, but an
underlying driver that never completes cancellation can keep that join pending;
these helpers alone do not establish bounded service STOP qualification.

Windows share-mode and DLL search behavior are documented in
[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
and [Dynamic-Link Library Security](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-security).
Read oplock grant rules and the asynchronous grant result are documented in
[Granting oplocks](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/granting-oplocks)
and [FSCTL_REQUEST_OPLOCK](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_request_oplock).
