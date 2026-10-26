# Fresh schema slice — review boundary

This source slice is **not** a ready installer, enrollment approval, Guardian proof,
or authority producer. `fresh-schema-application-plan.mjs` loads reviewed resources
and performs read-only catalogue verification. Only the owner-approved fresh
provider may execute its plan on its own identity-bound connection.

## Execution contract

1. The factory proves a newly owned PG17 cluster/database and actual
   `current_user = session_user = state_owner`; it reserves the connection.
2. Open **one transaction**, lock the same database advisory key as
   `local-runtime-migrations.mjs`, refuse every nonempty/partial application schema.
3. Execute `prerequisite_sql`, then ordered `statements[].sql` exactly.
4. Run existing `applyLocalRuntimeMigrations` using an adapter whose `begin`
   invokes its callback on the **same outer transaction**, with
   `expectedMigrationSourcesSha256 = plan.upgrade_sources_sha256`.
5. Execute `post_upgrade_acl_sql`, verify `verifyFreshSchemaCatalogue`, provision
   the existing direct API role with existing `provisionLocalApiLogin`, and verify
   its catalogue/grants as that role. Commit only if every step succeeds.
6. Keep runtime, device, Guardian and goal readiness separate. Failure rolls back
   schema/compatibility roles; process/cluster reconciliation remains the factory's
   responsibility. Never invoke this path on restored/attached databases.

The combined plan digest covers exact selected source spans, prerequisites, ACL
and the unchanged current-upgrade plan. Static literal URL exports make every
historical SQL input and each new resource discoverable for offline packaging.
`fresh-schema-statement-selection.json` must be packaged byte-exact with LF; add
its explicit root `.gitattributes` rule during shared-source integration.
The 52-RPC counts below describe base commit `4a1d907`; if reviewed upgrades add
RPCs, regenerate candidate signatures/source pins and requalify exact equality.
Never weaken catalogue equality to accept absent or extra signatures.

## Explicit source selection

`fresh-schema-statement-selection.json` lists exact original file SHA-256 values
and every omitted byte range with its own SHA-256 and reason. This is not a SQL
regex rewriter. Every included function body remains byte-for-byte canonical.

Only 17 top-level statements are omitted:

* Actuator migration `20260829192000`: statements 0 and 6 (`BEGIN` and `COMMIT`).
  The factory's outer transaction replaces precisely these two boundaries.
* Terminal freshness `20260902205500`: watchdog definition (2), historical
  supervisor/actuation data backfills (3–4).
* Reset generation `20260913163614`: historical workspace backfill (2), watchdog
  definition (8), reset definition and its grants (12–14).
* Reset supervisor fence `20260913165258`: historical backfill (1), reset rename,
  legacy grant, replacement and grants (7–11).
* Admin connectivity `20260930163000`: blanket existing-device ADMIN backfill (7).

The two watchdog definitions call missing historical maintenance/meta-refill
producers. The reset routines depend on missing historical peer-session/cursor
tables. None is in the current 52-RPC API list or reachable from its reviewed
function/trigger graph; there is no current native/browser runtime caller or
selected scheduler registration for them. Their omission is fresh-only: no
installed/upgraded function is dropped. The private legacy mesh-sync and resume
functions **are retained** because current allowed RPCs call them.

The bootstrap is intentionally replayed at step 18, after historical reset
sources, so final environment-state absence reads false/false rather than their
historical permissive defaults. The current upgrade runner is unchanged.

`realtime.send`/`realtime.messages` are intentionally optional accelerators: the
canonical cognitive acceptor catches their absence and retains durable latest
batch transport. No fake Realtime functions/tables are installed.

## Fresh-only ACL

The final ACL removes inherited PUBLIC/compatibility-role execution on all new
application functions and table/sequence rights. It installs deny-by-default
future function EXECUTE privileges. Existing direct API provisioning then grants
only its 52 exact RPC signatures and five table column maps. The private owner
retains ownership; neither approval nor raw device-enroll is granted to the API.
This is not a blanket revocation upgrade for any existing user database.

## Automatic population is still required

* Compatibility NOLOGIN roles, schemas and pgcrypto are real static prerequisites.
* A real selected workspace may receive a fenced false/false runtime-control row;
  this is configuration, not evidence that services or a project are ready.
* Signed browser enrollment uses the existing request producer, which creates a
  real PENDING request. The private exact request approval interface is
  `public.h205f22_a2_browser_device_enrollment_approve_v1(uuid)`; it is intentionally
  not in the HTTP RPC allowlist. The factory must establish explicit owner consent
  and bind the real signing key/request before invoking it. No public autoapprove
  or generated Owner row is introduced here.
* Existing `h205f22_a2_browser_device_activate_approved_v1` consumes that approval;
  actual device/ADMIN readback, Guardian redemption and original-key custody are
  separate required stages.
* Projects/tasks must originate from the user's actual goal through the existing
  goal/project procedures. A legitimate roadmap-authority and native seed-profile
  producer remains an integration prerequisite; fixture rows are not defaults.

## Qualification

Tests use factory-owned disposable native PG17 or explicitly supplemental PG18
WASM databases. They inject rollback after baseline, upgrades and ACL; verify the
transaction ID is unchanged; reject rerunning on nonempty state; verify all exact
RPC signatures/REST columns, absent legacy entrypoints and closed defaults;
verify upgrade rerun and direct-role admission; execute private approval/raw-enroll
and heartbeat denial probes; and check no effective nonallowlisted application
function is exposed. Empty application rows are a schema test, not the finished
product's data-population requirement. Actual native PG17 and installed Windows
first-run/Guardian acceptance remain separate release gates.
