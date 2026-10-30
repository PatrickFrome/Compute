# Rejected-result repair verification — 2026-10-29

Scope: source implementation and disposable PostgreSQL qualification. No installed
Windows mutation, public API authority expansion, release, merge or publication
was performed by this worker. Windows VM work remains cancelled.

## Exact commands and results

Run from the repository root. The local PG tools and driver are test inputs, not
bundled installed identity evidence.

```sh
METAENGINE_PG_TEST_BIN=/workspace/scratch/890aff2b00ca/pg17-test-tools/root/usr/lib/postgresql/17/bin \
METAENGINE_PG_TEST_DRIVER="$PWD/infra/client-state-runtime/node_modules/postgres/src/index.js" \
node --test \
  infra/client-state-runtime/native-coding-initial-goal-seed.integration.test.mjs \
  infra/client-state-runtime/fresh-schema-pg17.integration.test.mjs
```

Final log: `/tmp/metaengine-repair-pg-qualified3.log`.
**29 PASS, 0 FAIL, 0 SKIP**: 28 counted tests in the initial-seed suite (one
outer test and 27 subtests), plus one fresh-schema PG17 qualification test.
Five successive REJECT pairs followed by a sixth accepted/committed pair are
assertions in one lifecycle subtest, not five separate top-level tests.
Disposable lifecycle receipt directory: `/tmp/native-coding-initial-seed-3HXdg4`.

Fresh native PG version_num 170011; **32 ordered applications**, repeat current
installer successful; 59 exact existing public RPC signatures, 41 empty
application tables. Candidate SHA256:
`f70a53c41f70b6e9fc35a1903cd4a5d79ddf75a633ea286ad61694c36b7fa187`.
The candidate receipt remains production_qualified=false and reports its
pre-existing unresolved baseline dependencies; this is not installed readiness.

```sh
node --test \
  infra/client-state-runtime/local-runtime-migrations.test.mjs \
  infra/client-state-runtime/fresh-schema-plan.test.mjs \
  infra/client-state-runtime/sql-checkout-byte-integrity.test.mjs \
  infra/client-state-runtime/package-runtime-resources.test.mjs \
  infra/client-state-runtime/native-coding-task-context.test.mjs \
  apps/metaengine-browser/test/autonomous-project-task-runtime.test.mjs
```

Final log: `/tmp/metaengine-repair-registration-final.log`.
Result: **128 PASS, 0 FAIL, 1 SKIP** (optional PG18 WASM
supplemental qualification; actual native PG17 ran above). Includes packaged
source closure, exact migration bytes/CRLF resistance, strict context validation
and canonical runtime obligation accounting.

## What the real database test proves

- Existing W30 leases/result registration and project admission are used.
- Old writer and critic remain RESULT_READY with immutable REJECT receipts;
  original worktree fences remain HELD; no old accepted checkpoint is invented.
- Same-base distinct protected pairs and exact independent critic pinning.
- A busy lowest-order critic does not starve a later eligible pair.
- Original objective, constraints and deliverable survive replacement unchanged.
- Five rejected pairs do not starve the bounded native admission sweep.
- Old obligations remain PENDING until accepted replacement commit; old native
  completion stays false even when derived obligation becomes RESOLVED.
- Paused project, stopped environment, revoked profile and absent usable critic
  cannot admit repair. Failed replacement blocks the parent and stays PENDING.
- Concurrent/repeated reconciliation creates one edge/replacement; late failure
  after enqueue rolls back task count, lineage and history in one transaction.
- Foreign/cyclic/receipt/generation spoofing, immutable UPDATE/DELETE, drifted
  table/check/trigger/function/RLS definitions are refused.
- Review/wake predecessor reapply then repair restores final consumers while
  preserving the live test lineage. Historical projection survives COMPLETED
  project state. No API INSERT/repair EXECUTE privilege is granted.
- Generated suspended-parent projection changes WAITING_CHILDREN to
  READY_TO_RESUME only after replacement commit. It does not prove a live browser
  checkpoint restoration.

## Explicit limitations

OS/job/sandbox/Git receipts in the SQL lifecycle are generated fixture witnesses.
No Codex/model calls, actual physical Git commit, Windows ACL checks, installed
browser restoration or long-running autonomous development is proven. Existing
native preflight still must prove root identity/cleanliness and process control.
A clean spare pair must already be authorized; this slice does not provision
unlimited physical roots, release rejected dirty custody or add a new scheduler.
Real process/DB death, lost Host commit ACK, restored UI conversation and sustained
provider/capacity recovery still need installed qualification. Duplicate SQL
reconciliation and installer reapplication are not equivalent to those tests.

## Integrator readback

The integrator independently reran the final native PG17 command: 29/29, no
skips (`/tmp/metaengine-repair-parent-pg-final.log`), and the registration command:
128 pass, one optional WASM skip (`/tmp/metaengine-repair-parent-registration-final.log`).
Browser runtime/history focused tests passed 78/78; all UI library tests passed
112/112. Whole UI ESLint and TypeScript noEmit passed. These results retain the
fixture/installed limitations above. The preceding published a10c8ea1 completed
all triggered Windows Source and Runtime Contracts CI successfully.

The final candidate digest above includes removal of six whitespace-only lines
in the new SQL file and the corresponding source manifest digest update. The
function bodies were unchanged; the integrator reran PG and registration tests
on those final bytes.
