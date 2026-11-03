# Guardian first run and enrollment source review

The source baseline is `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`, tree
`2dbe253e97379532f6f4b52ef7edf26109a9266d`. Its source transfer at public commit
`accb28e72c87c059e780efb8e6681886b33e9b4f` contains three ordered archive parts;
the joined archive SHA256 is
`4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
The archive and tree were verified before edits. Earlier incremental patches
must not be applied to this snapshot again.

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
  Status discovery cannot call `ensure()` to create a device key. The original
  pending read remains held across observer deadlines until its actual joined
  transport promise settles; a refresh cannot open a second read in that interval.
* Restart admission checks the first run journal before starting the normal Host
  for the fixed fresh-provider layout. Owner publication alone cannot hide a
  pending or unknown install result. The check is a veto only: terminal journal
  bytes do not replace the existing package, Host, PostgreSQL or health checks,
  and never prove Guardian readiness. Missing or damaged evidence is preserved
  for review rather than repaired or replayed.

Neither change supplies the missing first owner producer, registers a new trust
root, consumes a real ticket, creates production credentials, launches Main or
changes a database.

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
