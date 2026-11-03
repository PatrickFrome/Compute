# Guardian first run and enrollment source review

The source baseline is `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`, tree
`2dbe253e97379532f6f4b52ef7edf26109a9266d`. Its source transfer at public commit
`accb28e72c87c059e780efb8e6681886b33e9b4f` contains three ordered archive parts;
the joined archive SHA256 is
`4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
The archive and tree were verified before edits. Earlier incremental patches
must not be applied to this snapshot again.

The PR #1437 correction applies separately to its result tree
`2e00ee9976fcc939ee3021bf2cde31eccbb50f08` (local reconstructed verification
commit `f0bbb447b6dfd9d4cae05dac2b6572c302f54e0d`). It supersedes the earlier
terminal-journal accepting path. A cumulative patch may instead be applied
directly to the original source baseline above; do not apply both deltas.

## Remaining first owner boundary

First owner enrollment and an ORIGINAL Main launch remain HOLD. The original
install coordinator is a real zero argument native producer, but its existing
W77 package and `GuardianActivePolicyGenesis` authorize first policy publication,
not first Owner enrollment or a Main launch. A successful SCM start, bootstrap
process exit, `CONFIGURED` provider receipt or `DB_TICKET_CONSUMED` result cannot
extend that purpose.

| Existing owner | Actual source contract | Missing join |
| --- | --- | --- |
| Original install coordinator | `browser-guardian-install-origin-coordinator.cpp` captures its original unelevated process and primary token before one fixed package qualified elevation. `browser-guardian-active-policy-genesis-origin.inc.hpp` retains the original channel, package, cancellation and absolute deadline. | No existing signed first Owner setup purpose or native setup continuation is produced. Genesis is not an enrollment grant. |
| Fresh machine policy owner | `browser-guardian-active-policy-genesis-ownership.cpp` creates original roots/intent only under sealed Genesis and refuses existing roots. `browser-guardian-machine-bootstrap.cpp` ends fresh publication with `COMPLETE_NOT_READY` and `owner_enrolled:false`. | No Owner/device/PostgreSQL admission follows that policy publication. Existing roots require the separate upgrade/replacement protocol. |
| Fresh local PostgreSQL and device owner | `fresh-client-provider.mjs` owns native consent, fresh PG17, private credentials, first ADMIN/device approval and cleanup. `fresh-provider-native-device-identity.mjs` requires packaged ready Electron and its actual singleton. | This producer is reached from Browser `main-entry.mjs`; no install-origin authorized pre-Main setup process or continuous singleton handoff exists. Moving it into an ordinary Node client would change its authority. |
| Own runtime Host | `guardian-owner-consume.mjs` consumes an existing ticket with the exact current ADMIN/device and own reserved PostgreSQL backend. It returns `guardian_ready:false` and `native_bridge_authenticated:false`. | There is no independently authenticated installed native Guardian to Host bridge. Same SID, a challenge digest, device signature or an IPC JSON receipt cannot supply code authentication. |
| Native Guardian Owner | `browser-guardian-enrollment-ticket-client.cpp` returns `LOCAL_OWNER_BRIDGE_REQUIRED`; `ensureOwnerBound` holds before ticket issuance or a second enrollment probe. | No accepting native receipt capability is produced. Existing Owner challenge/readback stays a separate read only path. |
| ORIGINAL Main | `GuardianNativeRootSession` requires the existing durable Owner and enrolled device on the original pipe. Its launch authorization consumes the original service challenge and holds original requester/token/package objects. | This post-enrollment authority cannot create its own first Owner. The wire launch route is deliberately HOLD. |

The dependency cycle is therefore still real: ORIGINAL Main requires enrolled
Owner; first local ADMIN/device setup requires packaged Electron and singleton;
the only current setup entry is inside the Browser launch. A source-only status
projection must not turn that cycle into a successful enrollment claim.

## Changes in this patch

The patch repairs two independently actionable first run problems while keeping
the authority gap closed:

* Guardian status uses the existing loaded-only signer and fixed read transport.
  Status discovery cannot call `ensure()` to create a device key. Quiesce pauses
  new observations, revokes the original read generation and requests cancellation
  through its own AbortController. The same signal reaches the fixed pipe. Abort,
  destroy and diagnostic timeout are not cleanup: the original source promise
  remains held until the actual socket close is observed. A missing close keeps
  the operation pending and the fence held; it does not authorize activation.
* Recognized fresh-provider restart remains HOLD before starting the normal Host.
  The earlier PR #1437 terminal-JSON acceptance was insufficient: a terminal
  journal has no authenticated completion producer. The corrective patch removes
  that accepting path entirely. Canonical JSON, matching public fields, a stable
  file and even a legitimate current-user DACL cannot clear this veto. Journal,
  Owner and PGDATA bytes are preserved for review without repair or retry.

Neither change supplies the missing first owner producer, registers a new trust
root, consumes a real ticket, creates production credentials, launches Main or
changes a database.

## Journal authority and reviewed threat boundary

The fresh writer creates the private root and journal in
`infra/client-state-runtime/fresh-client-provider.mjs`. Its root is protected by
`protectOwnerOnlyWindowsDirectory`, and the journal uses `secureAttachedPrivateFile`
from `attached-postgres-onboarding.mjs`. The latter sets the current SID as file
owner and grants that SID `Read,Write,ReadPermissions,Delete`; SYSTEM receives
FullControl. The root DACL in `private-windows-storage-acl.mjs` grants the current
SID, SYSTEM and Administrators inheritable FullControl.

Those ACLs restrict other principals when correctly applied on Windows. They do
not identify the process which wrote a terminal record. Another process running
as the current SID can rewrite or replace the journal after the original install
exits, including recreating the same ACL. The terminal record contains public
observations and a public-key fingerprint, with no signed completion, retained
native receipt or original writer capability. Inode checks, canonical JSON and
an added owner/DACL check therefore cannot authenticate completion. The previous
acceptance incorrectly let attacker-created data remove a startup prohibition.
The relevant Windows access check uses the token SIDs and requested rights;
see [Microsoft's DACL access-check description](https://learn.microsoft.com/en-us/windows/win32/secauthz/how-dacls-control-access-to-an-object).

The correction denies every recognized raw `METAENGINE/client-first-run-v1`
layout claim independently of journal bytes, file replacement races or ACL
assertions. It does not read the journal for admission and accepts no caller
override. Attached and upgrade descriptors remain subject to their existing
admission routes; this scoped veto does not authenticate mutable descriptors or
claim to isolate arbitrary same-SID code. Genuine native completion and original
descriptor/process custody are still missing and remain HOLD.
Consequently even a previously completed installation in the reserved fresh
layout remains HOLD; this correction provides no migration or journal-based
reenablement route.

Adversarial tests create forged terminal records and replace files in temporary
current-user storage while the real bootstrap is invoked with inert Host effects.
They prove the denial path does not depend on the forged bytes; they are not
Windows DACL, native pipe or physical filesystem race qualification.

## Minimum interface still needed

The existing trust owners must jointly produce an original, non-reconstructible
native first owner setup scope. The current code has no such producer. Before
adding an accepting route, that scope must bind all of the following:

1. The original unelevated install process/primary token, original native channel,
   fixed existing-authority signed package and an explicit first owner setup
   purpose. A path, PID, JSON flag or policy Genesis object is insufficient.
2. The exact native setup process, its continuous singleton ownership or a
   physically joined singleton handoff, original lifetime/cancellation and a
   bounded non-renewed deadline. Failure/unknown completion retains the fence.
3. The existing protected Electron device identity and native consent producer,
   actual owned PG17 cluster/backend and current approved device/client/key/ADMIN
   epoch. The key remains inside its existing owner; no exported key or injected
   signer/transport/verifier is a substitute.
4. Original installed-code authentication between Guardian and the runtime Host,
   one challenge and one ticket consumption with current grant readback, then
   native durable Owner CAS/readback on the original worker. A DB-only receipt
   cannot mint this native capability. Unknown commit or response never retries.
5. A separate post-enrollment ORIGINAL Main authorization retaining the original
   requester/token/namespace and native worker/Job/I/O/barrier lifetime. Setup
   completion cannot directly resume Main.

An upgrade must preserve old Owner/device/PGDATA and use its existing original
upgrade authority. Fresh root absence is not an upgrade authorization; the
fresh Genesis path intentionally refuses already existing roots.

## Qualification limits

All changes and tests are source-only in an isolated Linux workspace. No
installer, service, Electron application or real PostgreSQL instance was started.
No production credentials or alternate trust root were created. Native models
use synthetic objects and do not prove Windows WTS/SCM/pipe/Job/ACL behavior,
DPAPI, singleton handoff, loaded-code custody, filesystem durability or a live
signed release. Windows compilation/linking and an authorized isolated Windows
qualification remain necessary. The launch source guard's
`wire_route_authenticates_then_launches` failure must remain visible until the
genuine route is implemented; removing the failure is not enrollment closure.
