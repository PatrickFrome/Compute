# Native preparation: authority and composition gap

Source inspection: 2026-10-30, base
`39aa72059b2e58592747200b97883cb8c427e774`.
This is an implementation handoff, **not** an installed readiness receipt.
No installed/user preparation operation, credential, profile, selector or Owner
was created. No native PC operation or production database mutation was performed.
Disposable generated PG fixtures and source-only preparation records were created
and torn down by the qualification tests below.

## Implemented source slice: durable workspace preparation only

The separately versioned workspace stage is now implemented in source. It does
**not** resolve the legacy seed-profile/Owner bootstrap cycle described below.
Actual main's `ensureNativeCodingRuntimeMounted` invokes
`prepareNativeWorkspaceFromStage` after reading existing operator configuration
and creating the owned Host capability, before reading execution permits.
Missing stage **and no retained preparation state** is a no-op. A present stage
must produce a verified `PREPARED` response or the mount fails. Even successful
preparation still passes through the existing protected-permit gate; no permits
means no mounted execution backend.

- Fixed stage: `native-coding-workspace-stage-v1.json`, schema
  `metaengine.native-coding.workspace-stage.v1`. Exact fields: preparation UUID,
  workspace UUID, repository ID, repository/managed roots and physical identity
  pins, expected user SID, artifact, PG incarnation, independent writer/critic
  roster with worktree/sandbox pins, expiry. Authority fields are forbidden.
- Signed operations: `PREPARE_WORKSPACE_V1` and read-only
  `READ_WORKSPACE_PREPARATION_V1`, input exactly
  `{preparation_id, configuration_sha256}`. Device/key/current grant epoch are
  derived by the existing authenticated verifier, never accepted in that input.
- Host checks the actual own-PG provisioned repository row and current device,
  scopes and pairing. Share locks on device, pairing and repository remain held
  through receipt publication. Fixed SQL reads use finite timeouts; physical PG
  reads use that same transaction, avoiding a second-pool-slot deadlock.
- Fixed records are `native-coding-workspace-dispatch-intent-v1.json` (main),
  `native-coding-workspace-preparation-intent-v1.json` and
  `native-coding-workspace-preparation-receipt-v1.json` (Host). They are
  no-overwrite, fsynced and protected-file read back. Interrupted/partial files
  are holds, not repair/retry permission. Main's dispatch intent fences replay
  even if a later Host says NOT_STARTED. Removing the stage cannot remove a
  retained intent/receipt hold.
- Host intent binds input digest, independently current device/key/grant epoch,
  exact repository scope and state directory physical identity. A stored
  receipt does not preserve a revoked grant: every readback rechecks current
  grant, exact staged input and directory/root identities. It describes prior
  preparation, not newly observed execution or current Owner qualification.
- Cold image preparation occurs only on a fresh authorized write before Host
  intent/physical observation. Read-only recovery does not call it. Existing
  physical observers check installed bytes, PG process, user SID, per-agent
  worktree and sandbox pins; their adapter supplies no Owner epoch.
- Host seed binding tracks active operations. Runtime finalization closes and
  drains that binding before ending SQL or releasing ownership. Main tracks
  this operation inside its existing mount/drain lifetime.

Actual consumer remaining: a reviewed versioned initial-goal admission and
Owner activation path must consume this preparation identity and reauthorize
current scope. No existing v1/v2 seed profile consumer accepts this receipt.
No profile registration, selector publication, project, permit, credential or
execution authority is created by the implemented stage.

Source files: `apps/metaengine-browser/src/native-coding-workspace-preparation.mjs`,
`infra/client-state-runtime/native-coding-workspace-preparation.mjs`, existing
main, seed binding, device request/IPC contracts and runtime-host finalization.
The workspace modules and private transaction adapter are included by explicit
source-check registration and verified runtime-bundle import closure.

Tests are generated source qualification, not installed Windows evidence.
The new native PG17 test uses an actual disposable cluster, actual existing
provision/grant functions, real enrolled-device signing and current-device
verification, and proves that concurrent pairing revocation waits for the
publication transaction, then prevents a new signed readback. Physical
Windows/ACL/source/sandbox observations in that test are explicitly generated.

## Why a startup call to the existing helpers is not sufficient

`native-coding-seed-profile-preparation.mjs` can register an exact profile under
`state_owner` and read it back. `native-coding-seed-operator-publication.mjs`
can publish the fixed selector after profile and native physical checks.
Neither helper proves possession of the current enrolled caller's key or
independently establishes the profile's Owner epoch.

The authenticated device reader in `native-coding-device-request.mjs` exists
only inside the verified request's AsyncLocalStorage lifetime. Calling it at
runtime-host startup fails closed. Passing a substitute device object, using
state_owner as caller identity, or treating protected JSON as an Owner would
change the authority boundary.

`LIST_SEEDS` and `READ_SEED` remain read-only discovery/readback operations.
Adding registration or selector publication as a side effect of either is not
a legitimate preparation transition.

## Existing independent source candidates

| Source | What it actually establishes | Remaining composition constraint |
| --- | --- | --- |
| `SupervisorDeviceIdentity.readTrustedHostOwnerIncarnationW74()` | Calls the privately bound W74 custody reader; nullable when unbound | `bindHostOwnerGenesisW74` and `establishHostOwnerW74` have no non-test composition callers in the inspected source |
| `host-owner-genesis-custody-w74.mjs` | Joins current enrolled identity, authenticated ADMIN epoch, independent Guardian client incarnation, kernel birth, signed installed source, sealed Owner record and exact own-PG project | Requires a real private transaction closure and existing project scope; it is not a zero-input bootstrap |
| `host-private-custody-w76.mjs` | Rechecks the existing W74 custody twice and binds identity across the reads | Does not create W74 custody or provide a replacement trust source |
| `SupervisorDeviceIdentity.readHostOwnerIncarnation()` / `HostAgentRuntime.OWNER_NATIVE_READBACK` | Existing authenticated Host-agent IPC joins private Owner custody, native kernel and separate Guardian evidence | Host-agent process identity alone deliberately returns no Owner binding |
| `own-postgres-birth-w61.mjs` | Uses the existing own-PG transaction to check postmaster birth and exact project/device/client/admin epoch | Requires an independently trusted Owner reader first; cannot be used to create that reader from a project row |
| `runtime-host.mjs` ownership lock | Exclusive physical runtime ownership through PID and nonce | Not an Owner project/epoch credential |

W74's `W74_OWNER_SCOPE_READ_SQL` selects `project_run_h205f22` by current
`device_id`, `client_id`, `admin_grant_epoch`, with `LIMIT 2`, and accepts exactly
one row. Its sealed Owner epoch equals the current authenticated ADMIN epoch.
The profile's workspace must additionally be tied to that independent project
scope; a caller-selected workspace or arbitrary positive epoch cannot do so.

The current `native_coding_seed_profile_v1` validator checks `owner_epoch > 0`,
current project-device grant, device key fingerprint, PG system identifier,
profile schema, roster, worktree/sandbox policy and expiry. A positive
`owner_epoch` here is **not** independent current Owner-incarnation verification.
Do not describe it as one.

## Process boundary that prevents a trivial W74 wiring patch

Actual main has sources for enrolled identity/safeStorage, Guardian evidence,
native kernel and `readVerifiedInstalledExecutableW68(app)`. The independent
private own-PG transaction lives in runtime-host/db-api instead. The db-api
transaction is not a public capability and its W61 adapter itself requires the
trusted Owner reader.

W74 creation holds an own-PG advisory transaction lock and project row share
lock while performing the sealed-record generation transition. Replacing its
transaction callback with separate per-query RPC calls would drop that atomic
lifetime. Sending an Owner JSON object in an otherwise valid device-signed
request would prove the sender, not the asserted Owner incarnation. Neither is
an acceptable adapter.

## Feasible next implementation stages

1. Design a narrow existing-channel Owner-custody protocol that preserves the
   actual SQL transaction/lock lifetime, independent Guardian/kernel/source
   qualification and existing protected sealed-record custody across the
   Browser/own-PG process boundary. Reuse existing identity, keys and roots;
   no new privileged service, arbitrary SQL endpoint or credential source.
2. Establish how the existing project scope is obtained before the first seed.
   W74 currently needs an existing unique project; native initial-goal seed is
   what creates a project. This dependency must be resolved explicitly rather
   than by fabricating a row or treating seed configuration as Owner authority.
3. Only with a real current Owner/workspace producer, add a separate signed
   `PREPARE_SEED_PROFILE` operation and read-only preparation readback. A fixed
   staged protected profile file plus exact profile ID/hash is a candidate
   input contract, not a new trust root. No arbitrary path/profile JSON/SQL on
   the request. Match current Owner, device key and ADMIN epoch; preserve all
   existing profile and physical checks.
4. Persist immutable preparation intent before the first possible write. An
   unknown SQL commit or selector move must fence all subsequent mutation;
   same-identity reads may resolve the outcome, but must never automatically
   resume registration or publication. Drain started native work before
   releasing SQL/Host custody, including cancellation and shutdown races.
5. Wire the actual native main local-QA caller to the explicit operation, not
   read-only catalog discovery. Validate actual packaging and signed transport
   reachability in source tests, then separately qualify installed Windows.

Do not ship a permanently blocked writer or an unbound optional authority
callback as a completed lifecycle. Until the independent producer is composed,
`OWNER_BINDING_UNVERIFIED` must precede any intent, SQL or selector write.

## Required tests for that future transition

- Real enrolled-key signing and existing verifier; changed/revoked grant or key,
  wrong Host generation, stale signature and nonce replay rejected.
- Missing, stale, conflicting, changed or revoked Owner/project/workspace
  rejected before writes; no substitution by ADMIN grant, ACL presence or SID.
- Exact staged schema and immutable profile digest, changed protected file,
  existing conflicting selector, revoked/expired SQL profile.
- Fresh independent worktree/CLI/sandbox/installed image/PG observations and
  before/after source rechecks; no production-qualified claims from fixtures.
- Lost SQL commit reply, lost native selector move reply, restart, concurrent
  callers, same immutable readback, absence not treated as replay permission.
- Shutdown/cancellation joins physical operations and closes owned resources;
  actual default caller exercised rather than helper-only injection coverage.

## Current disposition

Automatic legacy profile PREPARE/selector publication remains unimplemented.
Its exact blocker is missing default independent Owner/project custody, not a
permission checkbox. The distinct workspace preparation slice above is now
implemented; existing registered profile/selector semantics remain unchanged.

## Versioned alternative: workspace preparation before project Owner

**Full lifecycle proposal only; project/Owner activation is not implemented.**
The separate workspace-preparation slice above is the sole implemented part.
Break the cycle
by separating three meanings, rather than renaming the v1/v2 Owner epoch:

- **Preparation authorization:** existing authenticated ADMIN device grant,
  explicitly authorized coordination workspace/repository and a derived grant
  epoch. It allows registering immutable configuration, not executing agents.
- **Project admission:** one goal is durably associated with one preparation and
  one own-PG project, initially not runnable.
- **Project Owner incarnation:** existing W74 evidence joins that resulting
  project with actual Guardian/kernel/source/DPAPI custody. Only then can the
  execution activation path bind permits and release runnable work.

### Authoritative workspace input already present in source

Use the existing
`public.compute_fabric_a2_managed_project_repository_h205f22` row as the
**candidate explicit repository/workspace authorization**, not a profile claim:

- `supabase/migrations/20261009194157_managed_project_admission_v1.sql` defines
  its key `(coordination_workspace_id,device_id,client_id)`, current
  `admin_grant_epoch`, `repo_id`, `repo_root`, `managed_root`. Its provision
  function locks/checks the active ADMIN device, scopes and pairing; conflicting
  roots are rejected. Table access is revoked from public application roles.
- `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/managed-project-routes.mjs`
  injects verified device identity and epoch, requires the configured server
  coordination workspace and invokes that exact provision RPC.
- `.../a2-browser-native-supervisor-v1/index.ts` constructs those routes with its
  fixed `WORKSPACE_ID`; that constant is a routing boundary, not alone a grant.
- `apps/metaengine-browser/src/main.mjs` constructs the real provisioner;
  `managed-task-project-host.mjs` calls it using the separately configured,
  protected `managed-task-projects-v1/repository.json` read by
  `managed-task-project-repository.mjs`. The configuration helper explicitly
  selects roots and does not itself provision DB authority.

Require an **already provisioned row in the actual owned cluster**, exact
current device/client/epoch and approved roots. Check its contents and physical
root identity before and after preparation. Missing/mismatching scope means
`WORKSPACE_AUTHORIZATION_REQUIRED`; do not automatically provision it from the
staged profile. This existing row authorizes managed repository scope, **not**
Owner incarnation, native execution or arbitrary worktrees. Reusing it for a new
native preparation contract needs explicit semantic review. Configuration
consent/provisioning is still an upstream prerequisite if it has never occurred.

### Proposed wire and state contract

New `workspace-preparation.v1` is separate from seed-profile v1/v2. Do not pass
it to the old profile validator, silently upgrade old profiles, copy a staged
`owner_epoch`, or derive Owner proof from a grant epoch. Reject all authority
fields in the staged configuration (`owner_epoch`, device, grant epoch, verified
flags). It contains only exact reviewed setup identity/configuration and pins.

1. Native main reads a fixed staged configuration under the existing protected
   operator path and signs `PREPARE_WORKSPACE_V1` with exact
   `{preparation_id,configuration_sha256}`. No caller SQL, path, profile,
   device/key/epoch override. The Host resolves the fixed file and its workspace
   selector, verifies digest/schema, then derives identity, key fingerprint and
   `preparation_grant_epoch` from the existing signed request verifier/current
   SQL grant. No new root, credential or enrollment.
2. Host locks the current device/grant and already provisioned repository row;
   captures a canonical scope digest including approved roots and epoch; checks
   actual installed image/CLI, PG incarnation, worktree identities and separate
   writer/critic sandbox receipts. Store immutable preparation configuration
   and derived authorization together. A configuration's identity or digest
   cannot be reused for a conflicting authorization generation. Lifecycle states
   are `PREPARED`, `PROJECT_BOUND`, `REVOKED`; none claims an Owner or permits
   execution. Current grant/root/expiry checks remain necessary on every use.
3. Signed `ADMIT_PREPARED_GOAL_V1` carries one immutable goal request identity,
   preparation selector and objective. In **one serializable own-PG transaction**
   lock preparation, recheck device/workspace grant and environment stop policy,
   create exactly one project/root-task binding and goal receipt, and transition
   preparation to `PROJECT_BOUND`. Reuse current request collision semantics
   shared with other goal kinds. Do not create executable permits here.
4. The root task needs a versioned non-runnable state, e.g. proposed
   `OWNER_PENDING`, and project remains `PAUSED`. Existing `BLOCKED` is treated
   as terminal by some result code and must not be repurposed. Existing PAUSED
   alone is not proof that every scheduler claim route is fenced. A migration
   plus audit of all claim/refill/reconcile/resume paths must ensure no generic
   route can promote `OWNER_PENDING` or dispatch its chat/CLI root. This remains
   the existing task/project scheduler, not a second scheduler.
5. Now the project exists. Compose W74 using its real current sources and that
   exact committed project binding. Its current device-only `LIMIT 2` discovery
   is ambiguous with multiple projects; add a versioned private resolver bound
   to the committed preparation/goal receipt, not a renderer-selected project.
   Recheck project/device/current grant and scope under existing transaction
   locks, then establish/read the sealed Owner. The cross-process SQL/DPAPI
   lifetime protocol described above is still required: a new prep schema does
   **not** make this missing composition disappear.
6. An explicit activation transition independently verifies that current Owner
   incarnation, immutable preparation/project binding, current grant and fresh
   physical scope still agree. Atomically bind execution permits to the actual
   Owner generation/epoch and release the existing root task/project. Adapt
   downstream permit/commit consumers by version, with no v1/v2 reinterpretation.
   Until activation is confirmed, UI reports `OWNER_PENDING`, not “running.”

No cross-store transaction is claimed between PG and DPAPI. Each effect has a
retained immutable intent and read-only recovery: unknown preparation commit,
goal commit, Owner seal or activation commit blocks automatic mutation/replay.
An exact successful readback may establish the preceding committed state; the
next transition is a distinct authorized operation, never an implicit retry of
an uncertain one. SQL project binding and goal receipt are atomic; the later
Owner seal is explicitly a separate recoverable step.

### Negative/transition matrix required before implementation acceptance

| Case | Required result |
| --- | --- |
| Caller supplies any epoch/device/Owner/authority field or arbitrary file/SQL | Reject exact schema before effects |
| Signature invalid/stale/replayed; grant revoked, pairing inactive, scopes removed | Reject, no preparation/project/permit writes |
| Workspace only exists in JSON or server constant; repository row absent/wrong cluster | Workspace authorization required |
| Existing repository row has old epoch, different device/client/roots, changed physical identity | Reject; no auto-refresh/reprovision |
| Stage changed during read, stale CLI/EXE/ASAR/PG, unsafe worktree, invalid critic sandbox | Reject; old v1/v2 path unchanged |
| Lost preparation/goal commit reply; restart/concurrent identical or conflicting requests | Same immutable readback; no automatic redispatch or second project |
| Goal admission succeeded but W74 unavailable/unsigned source/Guardian absent | Retain non-runnable project/root, zero execution permits |
| Multiple projects match old W74 discovery | Reject ambiguity; versioned exact committed binding required |
| Grant/Owner generation/root changed between custody and activation | Reject activation; retain pending state |
| Generic resume/refill/claim/reconcile sees OWNER_PENDING | Cannot activate or dispatch, including chat-led root |
| Lost DPAPI seal/activation reply or teardown mid-operation | Join owned work; retained unknown identity; read-only recovery |
| Ordinary v1/v2 profile operations | Existing semantics and refusal behavior unchanged |

### Still-proposed project/Owner activation decisions

Reuse of the existing managed repository authorization for the separately
versioned workspace-only stage above was reviewed and implemented. It is not a
proposal awaiting its first code. The non-runnable admission state, exact W74
project binding, custody bridge and later activation in this section remain
proposals requiring implementation and review. No default bootstrap,
installation or autonomous development completion is claimed.


## Reserved transaction lifetime and error boundary (implemented)

`infra/client-state-runtime/native-coding-preparation-transaction.mjs` uses the
installed postgres.js 3.4.7 supported `reserve/release` API (README:1255–1267),
`debug(connection,query,params,types)` (README:999), and `onclose(connId)`
(types/index.d.ts:121). Actual `runtime-host.mjs` attaches the monitor to the
owned native pool and supplies its private transaction closure to seed binding.
Existing debug/onclose callbacks are composed; no query parameters are logged
or retained by the monitor. A generated BEGIN-comment UUID correlates exactly
one reservation; it contains no key, device identity, staged input or authority.

This avoids the driver's `begin` Promise.race with onclose
(src/index.js:243–245), whose still-running body can subsequently attempt
rollback (267–271) after disconnect. No dependency was modified and no unhandled
error was suppressed. Fixed explicit BEGIN/COMMIT/ROLLBACK remain on one
reserved connection; a closed transaction never reconnects or retries. Every
operation fences closed/finished scopes. The callback is joined even when a
server timeout occurs during physical observation. A known-closed slot is
reclaimed by the driver, not released twice; a failed unconfirmed rollback
quarantines that reservation for pool teardown and rejects new transactions.
A COMMIT failure is unknown, never replay permission.

Postgres.js debug may put enumerable query/parameters on driver errors. The
adapter replaces driver errors with fixed safe errors, without a raw cause;
private IPC independently emits only fixed failure reasons. Sentinel-secret
unit and real-process transport tests verify this boundary. Driver error
classification remains internal. The code does not claim the driver itself
retains no parameters.

Before Host intent and receipt writes, same-transaction current-grant/liveness
queries recheck that the SHARE locks still exist. Finite statement, lock and
idle-in-transaction timeouts remain enabled. Cold image preparation cannot
silently continue writing after idle termination. Main/Host durable intent
records retain ambiguous outcomes for immutable read-only recovery.

## Source qualification executed 2026-10-30

Commands run from the repository root; logs are local `/tmp` artifacts, not
published installer evidence:

```sh
node --test infra/client-state-runtime/native-coding-preparation-transaction.test.mjs \
 infra/client-state-runtime/native-coding-workspace-preparation.test.mjs \
 infra/client-state-runtime/native-coding-host-seed-binding.test.mjs \
 infra/client-state-runtime/native-host-startup-lifecycle.test.mjs \
 apps/metaengine-browser/test/native-coding-workspace-preparation.test.mjs \
 apps/metaengine-browser/test/client-native-coding-goal.test.mjs
# /tmp/preparation-final-focused.log: 111/111 PASS

node --test apps/metaengine-browser/test/native-coding-host-ipc.test.mjs \
 apps/metaengine-browser/test/source-check-runner.test.mjs \
 infra/client-state-runtime/windows-qualification-registration.test.mjs
# /tmp/preparation-transport.log: 48/48 PASS

METAENGINE_PG_TEST_BIN=/workspace/scratch/890aff2b00ca/pg17-test-tools/root/usr/lib/postgresql/17/bin \
METAENGINE_PG_TEST_DRIVER="$PWD/infra/client-state-runtime/node_modules/postgres/src/index.js" \
 node --test infra/client-state-runtime/native-coding-workspace-preparation.pg17.test.mjs
# /tmp/preparation-pg17.log: 3/3 PASS, PG17.11, disposable cluster stopped

node --test infra/client-state-runtime/package-runtime-resources.test.mjs \
 infra/client-state-runtime/runtime-host.test.mjs
# /tmp/preparation-packaging.log: 66 PASS, 1 existing Windows-only DACL SKIP, 0 FAIL
```

Native PG evidence includes existing provision/grant SQL, wrong epoch/absent
repository refusal, shared grant/repository lock lifecycle and pairing
revocation, real server idle-transaction termination before Host intent, and
closed reservation reclamation in a max:1 pool for a distinct transaction.
The driver emitted a TimeoutNegativeWarning during the intentionally killed
connection scenario; it was not suppressed and did not cause async rejection
or test failure. These tests do not substitute for Windows ACL, DPAPI, actual
installed artifact/Guardian/kernel evidence: those physical observations are
explicitly generated fixtures. No installer or installed client was tested.

## Integrator final verification

The final adapter also preserves known connection-loss state after sanitizing a
rollback error; it does not poison later independent scopes merely because the
safe error omits the original driver code. A regression proves no retry of the
original transaction and a successful distinct transaction afterward.

Integrator rerun: 112/112 focused lifecycle tests and 3/3 actual PG17 tests
(`/tmp/preparation-parent-focused-final.log`, `/tmp/preparation-parent-pg17-final.log`).
Actual IPC/catalog/registration/package/runtime serial aggregate: 114 pass,
one existing Windows DACL skip (`/tmp/preparation-parent-transport-package-serial.log`).
An earlier concurrent aggregate had one child-startup timeout; unchanged isolated
IPC passed 41/41 and the complete serial rerun passed without increasing deadlines
or skipping the case. Source syntax catalog: 252 passed. These source and generated
physical-adapter results do not close installed Windows/bootstrap acceptance.

## Windows aggregate fixture correction

Published 8145a690 passed Windows Source (519 pass, one baseline skip) and its
native PG17 group (51/51), but the separate full Windows Runtime job failed nine
new preparation cases in readNativeWorkspaceStage, before their business checks:
readNativeCodingProtectedJson rejected physical_path_invalid. The new fixture
used raw os.tmpdir/mkdtemp paths, unlike existing native fixtures that resolve
the newly generated directory first. Windows temp roots may contain 8.3 aliases.

All three new preparation fixtures now resolve only their freshly created temp
root before creating or reading protected files. Production path identity/alias,
ACL and hardlink refusals are unchanged; no skip or timeout was added. Local
stage tests 18/18 and actual PG17 3/3 pass. The new exact-head Windows aggregate
must confirm this correction; its result is not inferred from local tests or the
previous component lane.
