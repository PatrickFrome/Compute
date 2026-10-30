# Prepared user goal admission: nonrunnable source stage

2026-10-30. This is source qualification, not installed Windows evidence.
No production database, installed client, credential, Owner, execution permit,
release, or repository publication was changed by this implementation.

## Actual path

The explicit existing goal submission path now has a separately versioned
PREPARED_GOAL route (main, client-prepared-goal, durable goal journal and UI).
It consumes the **actual user-entered objective**, not a startup/default goal.
The native signed Host accepts:

- `ADMIT_PREPARED_GOAL_V1`: one explicit mutation attempt.
- `READ_PREPARED_GOAL_V1`: same-identity recovery; never retries the mutation.
- Exact input `{preparation_id, configuration_sha256, request_id, objective}`.
  No caller Owner epoch, device authority, path, profile or SQL is accepted.

The existing signed request verifier supplies current device/key/ADMIN epoch.
The existing workspace service rechecks the fixed protected stage, its durable
PREPARED receipt, current active pairing/grant, same-cluster managed repository
and physical root identity under the reserved serializable transaction. Fresh
admission also repeats native image/worktree/sandbox/PG observations. Readback
never performs cold setup or repeats physical admission work.

A no-overwrite protected `native-coding-pending-goal-intent-v1.json` binds the
four input fields and exact workspace preparation authorization **before** the
first possible SQL admission. A retained intent without SQL receipt means
READBACK_REQUIRED; absence is not retry authority. The Browser independently
persists its selected preparation/workspace/epoch and goal request before send.

Private `native_coding_pending_goal_v1(jsonb,jsonb,jsonb,boolean)` verifies
state_owner, serializable isolation and synchronous commit, rechecks current
grant/key/pairing/repository, and shares the existing goal UUID advisory lock.
One transaction inserts an initially **BLOCKED** root and **PAUSED** project,
links the root, records immutable input/configuration/preparation/receipt, and
appends the pending history event. It does not call enqueue-then-pause, seed
profile admission, or permit publication. Preparation has one project binding;
conflicting request, objective, configuration or authorization cannot reuse it.

## Fences and recovery

The additive private migration introduces no execution-ready state. A
role/target-independent guard prevents mutation or removal of the pending root,
its spec/role/lease identity or project identity/state. It rejects claims,
children/proposals, cross-project root/parent associations and generic enqueue
specs pointing at the pending project/root/request. Actual existing
`devos_fleet_enqueue_v1` is tested: it cannot create a READY pending child;
unrelated legacy enqueue remains functional. The claim fence runs before older
transport gates, so tests assert the exact pending-claim refusal reason rather
than accidentally relying on another gate.

The immutable ledger has no activation bypass, caller flag, environment switch,
permit or public grant. A later **separately reviewed activation version** must
compose current legitimate W74 custody with this same committed project/root;
it must not call the old seed helper to create a replacement project. Pending
is explicitly not running, not a successful native mount, and not autonomous
execution readiness. Existing v1/v2 profile contracts remain unchanged.

Reapplication refuses unknown function bodies/security metadata/owners/ACLs,
changed relation columns/constraints/RLS/policies/owners/table or column grants,
changed/disabled/column-limited triggers and either direction of partial install.
A missing ledger cannot be silently reconstructed while helper/fence objects
remain. Source hashes and explicit relation/function/trigger registration are
included in both runtime migration and fresh-schema plans.

No cross-store atomicity is claimed: the protected filesystem intent and PG
transaction have independent recovery. Lost commit acknowledgement is resolved
only by exact readback, never replay. Cancellation joins physical observation
and retains the no-retry intent. Concurrent requests create at most one project.
The existing Host lifecycle tracks/drains the new actions exactly as workspace
preparation. Private IPC classifies admission failures as WRITE_OUTCOME_UNKNOWN
and read failures as OPERATION_FAILED, without raw driver query/parameters.

## Executed tests

From the repository root, with a disposable locally owned PG17.11 cluster:

```sh
export METAENGINE_PG_TEST_BIN=/workspace/scratch/890aff2b00ca/pg17-test-tools/root/usr/lib/postgresql/17/bin
export METAENGINE_PG_TEST_DRIVER="$PWD/infra/client-state-runtime/node_modules/postgres/src/index.js"
node --test infra/client-state-runtime/native-coding-pending-goal.pg17.test.mjs
# 14/14, zero skips. /tmp/pending-goal-pg.log
node --test infra/client-state-runtime/native-coding-initial-goal-seed.integration.test.mjs
# 28/28, zero skips WITH new pending SQL installed before legacy v1/v2/repair tests.
# /tmp/pending-repair-regression.log
node --test infra/client-state-runtime/fresh-schema-pg17.integration.test.mjs
# 1/1, zero skips. /tmp/pending-fresh-schema.log
node --test apps/metaengine-browser/test/native-coding-host-ipc.test.mjs \
 infra/client-state-runtime/native-coding-host-seed-binding.test.mjs
# 56/56, zero skips. /tmp/pending-transport.log
node --test infra/client-state-runtime/local-runtime-migrations.test.mjs \
 infra/client-state-runtime/fresh-schema-plan.test.mjs \
 infra/client-state-runtime/fresh-schema-application-plan.test.mjs \
 infra/client-state-runtime/native-coding-host-seed-binding.test.mjs \
 infra/client-state-runtime/native-coding-workspace-preparation.test.mjs
# 39 PASS, 3 existing optional skips. /tmp/pending-registration.log
```

Fresh schema: 32 ordered baseline applications, 59 exact public RPC signatures,
42 empty application tables; the private pending functions create no new public
RPC. Candidate hash
`61bd83b5d2ab3b1301d91a2ac975c1f184f20e34fb0bd9c3c6e5bff535b475a8`.
The four pre-existing unresolved dependency declarations are unchanged.
All disposable clusters were stopped. Native keys and physical Windows readers
in these tests are generated fixtures, not installed scope observations.
Caller/journal/UI tests and final exact-head Windows qualification are maintained
by the integrator; this note does not substitute local Linux evidence for them.

## Still required

- Real current Owner/Guardian/kernel/installed-source custody bound to this exact
  project across Browser/own-PG process boundaries, preserving lock lifetime.
- Explicit versioned activation of the **same** project/root only after fresh
  independent authority/physical proof; execution permits remain absent now.
- Installed Windows preparation, admission and later activation acceptance.
- No claim of continuous autonomous operation, model execution or installed
  readiness follows from a pending-goal receipt or generated fixture tests.

## Combined integrator qualification

Final integrator reruns: actual native PG17 pending + existing initial-seed/repair
+ fresh schema 43/43; IPC/binding/migration/Windows-registration/package 109/109;
actual pending caller + legacy native-goal tests 95/95; full UI library 128/128.
Logs: `/tmp/pending-parent-pg.log`, `/tmp/pending-parent-transport-package.log`,
`/tmp/pending-parent-caller-final.log`, `/tmp/pending-parent-ui-final.log`.
Independent source reviews found and closed generic enqueue/association bypass,
partial-ledger recreation/column grants, post-ACK device rotation and late UI
sequence gaps. Main now fences complete device identity after signing and ACK;
late superseded UI success/error cannot overwrite a newer goal. These are
source/generated-environment results, not Owner activation or installed proof.
