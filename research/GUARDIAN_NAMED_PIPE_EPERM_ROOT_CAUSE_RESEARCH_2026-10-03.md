# METAENGINE Browser — Guardian Named-Pipe EPERM Root-Cause Research

Date: 2026-10-03
Plane: analysis only
Authority effect: false
Live mutation performed: none

## Live symptom

Fresh live Browser readback shows Guardian in:

- state: `HOLD`
- reason: `GUARDIAN_OWNER_OBSERVATION_FAILED`
- transport error: `guardian_update_actuator_pipe_error:connect EPERM \\.\pipe\METAENGINEBrowserGuardianUpdateV1`

The installed Browser remains otherwise alive and heartbeating. This note does not treat Guardian HOLD as proof that the SCM service is absent.

## Repository contract

The Guardian SCM pipe intentionally grants authenticated users only this exact client mask:

`FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE`

The DACL deliberately omits `FILE_APPEND_DATA / FILE_CREATE_PIPE_INSTANCE`.

That is a sound anti-squatting boundary: Microsoft documents that `FILE_APPEND_DATA` and `FILE_CREATE_PIPE_INSTANCE` share the same access bit for named pipes, so granting `FILE_GENERIC_WRITE` also grants pipe-instance creation capability.

Repository server:
- `native/browser-guardian-scm/browser-guardian-owner-enrollment-observer.cpp`

Repository client:
- `src/browser-guardian-update-actuator-client.mjs`
- uses Node `net.createConnection('\\\\.\\pipe\\METAENGINEBrowserGuardianUpdateV1')`

## External implementation evidence

libuv Windows pipe client:
https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c

The current `open_named_pipe()` path first calls `CreateFileW` with:

`GENERIC_READ | GENERIC_WRITE`

If that gets `ERROR_ACCESS_DENIED`, libuv only falls back to:
- `GENERIC_READ | FILE_WRITE_ATTRIBUTES`, then
- `GENERIC_WRITE | FILE_READ_ATTRIBUTES`.

Microsoft named-pipe access documentation:
https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights

Microsoft documents:
- `FILE_GENERIC_READ` includes additional rights beyond data/attributes, including reading extended attributes and the DACL;
- `FILE_GENERIC_WRITE` includes append/create-instance access;
- to avoid unintentionally granting create-instance authority, use individual rights rather than `FILE_GENERIC_WRITE`.

## Root cause

The current server ACL and Node/libuv client are contract-incompatible.

The server requires a least-privilege client that opens the pipe with the exact specific mask.

Node `net.createConnection` delegates to libuv, which requests generic rights. Those generic rights expand to rights intentionally omitted by the Guardian DACL. Windows therefore denies the connection before any Guardian owner challenge can run.

This exactly matches the live `connect EPERM` symptom.

This is not an owner-enrollment cryptographic failure and not evidence that the service should weaken its owner proof. The failure occurs earlier at the Windows object access check.

## Unsafe repair

Do NOT fix this by granting Authenticated Users `GENERIC_WRITE` on the service pipe.

That would reintroduce the exact `FILE_CREATE_PIPE_INSTANCE` capability the DACL intentionally excludes, weakening the named-pipe anti-squatting boundary.

Do not reinterpret EPERM as pipe absence and do not auto-enroll/retry.

## Safe repair options

### Option A — fixed native exact-rights client helper

Add a small packaged native client that:
- opens only the fixed Guardian pipe name;
- calls `CreateFileW` with the exact specific access mask already exported by the native contract;
- no caller-supplied pipe path;
- no shell;
- no arbitrary process target;
- bounded wire size and deadline;
- writes one request and reads one response;
- returns the response over stdout or an inherited bounded pipe;
- exposes zero installer/process authority.

Browser invokes only the fixed packaged helper by exact packaged path.

Pros:
- preserves current DACL;
- minimal change to SCM service;
- directly matches documented Windows access semantics.

Risk:
- introduces a fixed helper process and its packaging/identity must be fenced.

### Option B — native Node/Electron addon

Expose one N-API function that performs the exact `CreateFileW` access-mask open and bounded request/response.

Pros:
- no helper child process;
- preserves DACL.

Risk:
- higher build/ABI/package complexity for Electron/Node; more likely to destabilize current convergence line.

### Option C — dynamic per-user generic DACL

Have the service discover an exact user/logon SID and grant that SID generic duplex access.

Rejected as the default design:
- `GENERIC_WRITE` still maps to create-instance access;
- adds session/SID policy complexity;
- weakens the current explicit invariant.

## Recommended successor

Option A is the smallest security-preserving repair.

Implementation boundaries for a future source-only branch:

1. native helper source under `native/browser-guardian-pipe-client/`;
2. fixed pipe literal compiled into helper;
3. exact specific access mask, no GENERIC_WRITE;
4. fixed maximum request/response bytes;
5. explicit timeout;
6. no caller-supplied executable/path/URL/shell;
7. helper binary hash included in Build Identity;
8. package smoke verifies helper is present and executable;
9. JS client uses helper only on Windows and maps absence/failure fail-closed;
10. contract test proves the service DACL still omits `FILE_CREATE_PIPE_INSTANCE`;
11. physical test proves a standard Node/libuv connection is denied while the exact-rights helper succeeds.

## Qualification sequence

Do not modify the active physical candidate for this repair.

After the current physical candidate reaches terminal state:

1. fork a source-only Guardian repair branch from the qualified source;
2. implement the helper and tests;
3. run native Windows source qualification;
4. prove package staging includes the helper;
5. reserve a fresh package version;
6. perform one physical attempt;
7. after installation, require live readback `guardian.ready=true` with exact owner/device binding before claiming the issue closed.

## Security invariant retained

The repair must preserve:

- remote pipe clients rejected;
- first pipe instance semantics;
- Authenticated Users cannot create pipe instances;
- owner challenge before any update effect;
- native write-ahead effect barrier;
- no arbitrary shell/process execution;
- no automatic retry of ambiguous native effects.
