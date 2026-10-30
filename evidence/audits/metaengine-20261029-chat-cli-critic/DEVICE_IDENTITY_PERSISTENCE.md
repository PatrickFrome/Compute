# Device identity persistence prerequisite — 2026-10-30

Scope: `SupervisorDeviceIdentity` state mutations and its W74 sealed Owner callback.
This does not connect production W74 custody, activate a goal, or grant authority.

## Reproduced defects

Against original source, the actual class lost a newly bound `device_id` when
`clearEnrollmentRequest()` was started while binding paused at rename. The shared
`.tmp` also allowed overlapping writers to consume each other's files. Actual W74
fixture reproduced an epoch transition racing a same-device approval which clears
Owner custody: stale cached CAS could resurrect a record that approval invalidated.

## Change contract

* One per-instance promise queue evaluates field mutations at execution time,
  rather than saving a spread of stale state before awaiting I/O.
* W74 expected-previous CAS, current device/client check, secureStorage encryption
  and state replacement run inside that same serialized transition.
* Every replacement exclusively creates a random sibling temp (`wx`, mode 0600),
  awaits complete handle write, file sync and close, then renames over the state.
  Only a successfully created owned temp is considered for cleanup. Existing
  unrelated `.tmp` files and exclusive-create collisions are not removed.
* In-memory state changes only after rename succeeds. Pre-rename failures preserve
  existing key, enrollment and sealed Owner bytes and leave subsequent operations
  available. Startup remains exclusive and never regenerates corrupt identities.
* Any thrown rename result is conservatively ambiguous. The instance rejects
  future ensure, snapshot, signing and writes; it does not silently retry or
  authorize against stale cached bytes. A fresh instance validates actual persisted
  bytes through the ordinary load/decrypt/key-consistency path. No automatic
  reconciliation or cross-resource transaction is claimed.

## Evidence

Isolated runner with existing test files:

```
node apps/metaengine-browser/scripts/run-isolated-tests.mjs \
  apps/metaengine-browser/test/supervisor-device-identity-concurrency.test.mjs \
  apps/metaengine-browser/test/host-owner-protected-identity-w74.test.mjs \
  apps/metaengine-browser/test/host-owner-genesis-custody-w74.test.mjs
```

30/30 PASS. Covers parallel ensure, cold reload, encryption unavailable, corrupt or
mismatched storage, initial competing creators, symlink/hardlink refusal, observed
identity disappearance, serialized enrollment preservation, W74 Owner preservation
and stale CAS rejection, injected write/sync/close failures, exclusive temp collision,
write/sync/close ordering, and a rename which replaces the file then loses its reply.
The latter validates a new instance's load and original-key signature, not a real
power outage or OS reboot. W74 uses marked STAGING fixtures, not installed evidence.

Additional identity delegation IPC test is blocked locally by `listen EPERM` on
its Unix socket; it is not counted as passing. No sandbox bypass attempted.

## Explicit limitations

This is **per-instance serialization**, not a cross-process/OS lock or atomic
multi-file/PG transaction. Multiple live writers of the same identity path remain
unsupported. A hostile process able to replace directory entries is not addressed
by a random temp name. Windows Electron secureStorage/DPAPI, installer paths and
process-restart behavior still require native CI/integration evidence. File sync
is awaited; directory-entry power-loss durability on Windows is **not claimed**.
No credentials, installed files, Guardian, database services or OS security policy
were changed. No branch, commit or publication performed by this worker.

## W67 uncertainty coverage and integrator checks

Guardian, Host Owner, private gateway and own-PG birth readers now check the
uncertainty fence before and after awaited callbacks. Five actual-class cases
first prove the generated capability path is reachable, then inject ambiguous
binding-clear persistence before or during reads; all return null and prevent
further provider calls. No old cached capability escapes a lost replacement ACK.

The preceding e93d0a85 passed Runtime/UI and native Windows PG65/65, but five
component cases failed due to cross-file singleton state: its workflow explicitly
disabled process isolation. The new actual identity fixture set the default
storage path, and later repeated cycle fixtures unintentionally shared a durable
journal. The exact two-file sequence reproduced five failures on Linux too.
Standard per-file process isolation passes all56; the workflow now uses that
mode, preserving every case, in-file race test, timeout and output limit. No
production journal transition, identity authority or safety check is relaxed.
Identity race tests are added to the mandatory Windows component lane.
Final exact-head CI remains required.
