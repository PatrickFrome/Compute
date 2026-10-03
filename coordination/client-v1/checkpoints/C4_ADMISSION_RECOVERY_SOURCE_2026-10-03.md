# Client admission recovery source checkpoint — 2026-10-03

## Installed evidence and qualified source

The installed Browser remains `0.7.0-dev.37103459439.1`, exact source
`5048c82701f5836370c15000df74d9a12119d34a`. The delivered installer and its
SLSA/Build Identity V3 evidence remain the installed qualification baseline.
No installed ASAR, service, ACL, enrollment or admission flag was altered.

Authoritative admission is CLOSED at floor 28, the Supervisor is PARKED and
four Agent sessions are BOUND_UNVERIFIED. Guardian is Running but the installed
service binary differs from the packaged binary and its owner pipe returns EPERM.
The baseline contains no primary Client resume API or existing-service replacement.

Qualified source repairs:

- `9dd45174f8fe38d3677d8dc0b04a8ad68f38fded`, source run `37133195328`:
  Windows 4013 PASS; Linux 4011 PASS and two Windows-only skips. Result receipt
  wording no longer implies independent CRITIC acceptance.
- `c31de39a9aad097e7a8356d746a596a33d63c5a9`, source run `37134004542`:
  Windows 4022 PASS; Linux 4020 PASS and two Windows-only skips. Exact RPC
  method membership, strict method types and bounded Client observation owners.
- Both runs passed 16 SLSA/topology checks per OS and existing installer
  consumer verification, without producing a replacement installer.

## New source implementation

The primary Client exposes only `admissionRecoveryStatus` and `resumeAdmission`
through dedicated IPC. Mutation requires the exact Browser-owned WebContents,
main frame, frame origin and packaged primary root. Legacy/remote/subframe
documents cannot use this action. The generic shell and loopback method surfaces
are not widened.

An explicit operator request must contain only confirmation and a strict integer
generation floor. The native readback must be fresh, PAUSED and connected to an
enrolled ADMIN device with CONTROL_PLANE scope. Projected work, raw authoritative
runtime, durable local floor and requested floor must agree exactly.

PENDING is atomically stored and flushed before the first signed request. The
only effect is the existing Native Supervisor admission route and SQL CAS. The
whole owner call, including response parsing, has a 15-second abort/deadline.
Missing/malformed replies, timeouts and unknown errors persist AMBIGUOUS.
An exact generation-mismatch 409 is the only recognized no-effect exception.
Neither a restart nor a status refresh replays an ambiguous request.

The owner receipt does not change execution readiness. Confirmation requires an
independent authoritative OPEN with all admission flags, matching floors and an
accepted heartbeat later than the attempt. A durable monotonic OPEN heartbeat
prevents an older CLOSED observation from enabling another request. A later
fresh pause can accept a new explicit intent, including at the same generation.

The Runtime UI provides Resume queued work, explains that queued tasks may begin,
blocks duplicate/ambiguous requests and retains the existing observation-owned
execution badge. Guardian readiness and verified Agent origin remain separate.

## Verification and reproducibility

133 recovery checks passed: type/confirmation/floor/authority rejection,
pre-effect persistence, restart, storage corruption/failure, simultaneous calls,
owner ambiguity, stalled response body, late receipts, exact no-effect response,
independent OPEN and heartbeat replay, primary-frame identity/origin.
Existing transport/readiness/RPC checks passed in the combined 186-check run.

A test-only RSI evaluator repair uses controlled timers and performance time.
The original 20/140 ms bounds are preserved; an overdue 141 ms candidate is rejected.
This addresses a repeat local parallel-suite timing failure, not a runtime change.

The source qualification workflow now also builds the frozen standalone UI on
Linux and Windows, using the existing Bun 1.3.3/bun.lock contract in isolated
staging. Its permissions remain read-only and it has no installer producer.
Full regression and exact-head qualification are the next terminal record.

Implementation `eb6141421f10fdc556d8cbe29c22aabdcbd961c4`, run `37149802584`:
Windows 4162 regression checks PASS, Linux 4160 PASS with two Windows-only
skips, 16 SLSA/topology checks PASS on each OS, frozen UI builds PASS on both OS.
The terminal run was nevertheless FAILED: the source-only scanner matched its
own embedded forbidden strings. Its step exclusion now uses anchored YAML step
lines, rather than an unanchored string split. The exact extracted scanner passes
locally and rejects an injected privileged UI job in isolated scratch storage.
The following exact-source run must pass every job before qualification is claimed.

The local full parallel run passed 4155/4156 checks but hit a separate existing
short rollover fixture failure; that same source's complete CI regression passed
on both OS. This local result is retained rather than reported as a full pass.

## Remaining physical acceptance

Reserve a fresh package version/Build Identity before the next physical installer.
The consumed baseline identity must not be rebuilt. After full qualification and
installation, observe this API on the installed process and its real signed CAS.

Guardian requires a separately qualified existing-service maintenance protocol:
exact old/new service identity, privileged transaction, restart/rollback ambiguity
and positive SCM/pipe owner readback. EPERM remains HOLD; first-install activation
cannot replace the existing service.

C4 useful-work/C5 remain open: real assistant-message origin, positive terminal
generation evidence, correlated task/result digest, independent CRITIC acceptance,
durable VERIFIED readback and restart recovery must still be observed.
