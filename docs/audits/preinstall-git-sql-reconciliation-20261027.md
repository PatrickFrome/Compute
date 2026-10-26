# Pre-install Git-to-SQL checkpoint reconciliation — 2026-10-27

## Scope and disposition

Stream 7, [#1362](https://github.com/PatrickFrome/Compute/issues/1362).
Development base: `9d7527683060e314eb1d39fec9ce2304a57103c4`.
Branch: `work/preinstall-reconciliation-20261027`.
PR target: `work/preinstall-closure-20261027`.

The source repair closes the process-crash interval after durable Git completion
and before the first protected SQL-finalize intent, for checkpoints prepared by
the new journal-provenance contract. Source/component and native disposable PG17
proof are available. Shared private IPC integration remains a coordinator
dependency; Windows/installed qualification is not established. The coordinator
owns acceptance, integration, resealing and any installer production.

The two implementation files are
`apps/metaengine-browser/src/native-coding-project-commits.mjs` and
`infra/client-state-runtime/native-coding-host-commit-service.mjs`. Their focused
tests, the matching native Host integration expectation and six explicitly named
checkpoint-reconciliation fixture/test files are the remaining code changes.
No Stream 3 goal/autonomous-project module, shared IPC/authority entrypoint, SQL
migration, package/version, seal, producer or installer policy was modified.

## Independently reproduced defect

The baseline Host and observer were extracted with `git show` at the exact base.
Only relative import specifiers were resolved to equivalent absolute module URLs
to load those snapshots outside the checkout; their unchanged dependencies came
from the base checkout. The first reproduction preceded Host source edits.

A real disposable repository and locked managed worktree were created. A child
ran the actual Host FINISH. Test-only interception stopped it immediately before
`fs.open(sql-finalize/<checkpoint>/intent.json, 'wx')`, after the Git completion
file, exact ref and final index existed. The parent killed that exact child with
`SIGKILL`, then independently read the ref, commit/tree and index before starting
another Host/observer process with the same generated authority and SQL fixture.

Observed baseline result:

| Observation | Result |
| --- | --- |
| Initial Git update-ref calls | 1 |
| SQL finalization dispatches / committed effects | 0 / 0 |
| Restart Host state | `PENDING_COMMIT`, `git_readback.state=COMMITTED` |
| Restart observer | `READBACK_REQUIRED`, no FINISH dispatch |
| SQL intent | Absent at the crash barrier and after readback |

This reproduced the correct existing HOLD, not a repeated Git operation. The
initial one-case run passed 1/0/0. After adding the complete test matrix, its
separate baseline rerun passed 1/0/9: the nine current-code top-level cases were
explicitly skipped in baseline mode.

## Versioned contract for Stream 3

### Request and capability

The new private Host method is `RECONCILE_FINISH_CHECKPOINT`. Its exact input is:

```js
{ project_id, checkpoint_sha256 }
```

No caller receipt, path, Git argument, SQL, retry mode or proof token is accepted.
The Browser method is optional
`ownPostgres.reconcileFinishCheckpoint(query)`. Until the coordinator supplies
that private capability, the observer retains HOLD. This does not add a public
RPC or renderer permission.

The existing read operation can return:

```js
{
  schema: 'metaengine.native-coding.host-commit-service.v1',
  project_id, checkpoint_id, checkpoint_sha256,
  state: 'GIT_COMMITTED_SQL_NOT_ATTEMPTED',
  git_readback: /* independently verified existing COMMITTED Git receipt */,
  reconciliation: {
    schema: 'metaengine.native-coding.checkpoint-reconciliation.v1',
    state: 'FIRST_SQL_FINALIZATION_ELIGIBLE',
    operation: 'RECONCILE_FINISH_CHECKPOINT',
    project_id, checkpoint_id, checkpoint_sha256,
    writer_task_id, writer_lease_generation,
    critic_task_id, critic_lease_generation,
    git_receipt_sha256, operator_sha256, sql_journal_identity_sha256,
    sql_intent_state: 'ABSENT', sql_commit_state: 'ABSENT',
    physical_git_readback_verified: true, current_authority_verified: true,
    observation_only: true, git_effect_allowed: false, sql_retry_allowed: false,
    successor_admitted: false, production_qualified: false,
    automatic_retry_allowed: false, authority_effect: false
  },
  successor_admitted: false, production_qualified: false,
  automatic_retry_allowed: false, authority_effect: false
}
```

This is an observation, not a reusable write capability. The observer validates
the version, operation, complete receipt and its digest, checkpoint/task/lease
selectors, absence assertions and all negative authority flags. A bare
`PENDING_COMMIT + COMMITTED` remains HOLD. Normal FINISH and SQL reconciliation
have separate local attempt latches, so a lost normal FINISH ACK can be followed
by the distinct first-SQL transition. Once reconciliation is attempted, that
observer neither resends it nor falls back to ordinary FINISH.

### Preconditions rechecked by Host

1. Canonical checkpoint columns/digest and current operator registry are exact.
   Existing device, permit, profile, project, root-idle and SQL commit gates
   still apply. Current Host identity is checked across the read/write boundary;
   a valid new process after restart is not required to impersonate the old one.
2. The protected journal anchor, described below, matches physical directories.
3. Physical Git readback validates the pinned executable; managed root, Git and
   common directory identities; locked worktree and exact symbolic/ref target;
   protected Git intent, plan, ref-intent and completion; commit bytes/OID,
   top tree and reviewed-path tree/blob bytes; protected reviewed index and
   identical raw live-index bytes; reviewed worktree content and clean status.
4. A successfully read authoritative SQL record is exactly absent (`null`), and
   the protected SQL intent file is absent. Invalid/falsey JSON, inaccessible
   storage or SQL, missing provenance and mismatched receipts never mean absence.
5. Only the live winner of exclusive `wx` intent creation may dispatch SQL.
   The intent is synced before the effect. Its content, directory identities,
   physical Git and current authority are rechecked after admission. The existing
   serializable transaction and `synchronous_commit=on` remain in force.

The separate operation executes no COMMIT_CHECKPOINT, RECONCILE_COMMIT,
update-ref, write-tree, read-tree, update-index or writable hash-object command.
Ordinary FINISH also takes this SQL-only path when a protected completion file
already exists, including a mixed ordinary-FINISH/reconciliation race.

### Durable provenance and compatibility boundary

Before its first Git effect, ordinary FINISH writes the protected anchor:

```text
<stateDirectory>/native-coding-checkpoint-reconciliation-<checkpoint_sha256>.json
schema: metaengine.native-coding.checkpoint-reconciliation-journal.v1
```

It binds project/checkpoint/operator identity and the physical identities of
the state directory, journal root, SQL root/checkpoint directory, Git
root/checkpoint directory and empty-hooks directory. The anchor is outside the
journal. READ and reconciliation cannot create it or recreate missing journals.
Existing ancestors are checked for aliases before directory creation/ACL work.

This detects journal deletion/replacement across process restarts. A historical
completed Git receipt **without a pre-Git anchor stays HOLD**: the new code does
not retrospectively invent evidence that a previous SQL attempt never occurred.
An existing intent also stays HOLD when SQL has no row, including a crash after
intent sync and before the SQL call. This deliberate loss of liveness preserves
the no-retry boundary.

File sync is required on all platforms; POSIX additionally syncs the newly
created intent/anchor file's containing directory. The tests prove process-crash
behavior. They do not prove machine power-loss durability or Windows directory
durability.

### Read-only details discovered during review

The baseline journal reader called mkdir/protectStorage, and its Git reader
invoked write-tree. The new read path uses neither. It sets
`diff.autoRefreshIndex=false`: `GIT_OPTIONAL_LOCKS=0` alone did not prevent Git's
diff auto-refresh from rewriting a live index after equal-content mtime changes.
For that case, a nonquiet binary diff with empty output proves equal content
without the stat-only false failure of `diff --quiet`.

Independent review also reproduced ordinary FINISH invoking write-tree after
the completed-Git crash. The completed-receipt fast path removed that command;
the revised component/native races assert no additional Git write commands.
Reviewed blob corruption under the original OID is separately detected. This
does not claim a full integrity scan of unrelated objects in the repository.

## Evidence matrix

All final candidate success rows below used Node v24.22.1 and the measured
source hashes in the next section. Baseline rows use the explicit BASE snapshots.
No user repository, Owner, PGDATA, Guardian or registry was used.

| Suite | PASS | FAIL | SKIP | Meaning |
| --- | ---: | ---: | ---: | --- |
| Baseline focused observer + Host | 17 | 0 | 0 | Original contract before edits |
| Separate baseline crash rerun | 1 | 0 | 9 | Exact base snapshots; current-code cases excluded |
| Final focused Browser/runtime/IPC/Host/checkpoint/capability group | 108 | 0 | 0 | Source regression and structural contracts |
| New component crash/reconciliation suite | 36 | 0 | 1 | Real Git/children; SQL/authority/ACL are generated fixtures |
| New native reconciliation suite | 9 | 0 | 0 | Eight acceptance cases plus containing test; actual PG17 transactions |
| Existing native Host integration | 4 | 0 | 0 | Actual SQL/Git/permit rotation, successor lease and policy continuation |
| Existing native profile integration, candidate | 0 | 2 | 0 | Fails before commit Host creation on Linux; see below |
| Same profile integration, base Host/observer | 0 | 2 | 0 | Independently reproduces the same pre-existing platform restriction |

The 108 + 36 + 9 + 4 successful checks total **157 PASS** without counting the
historical baseline runs again. The one component skip is the separately
executed baseline case; it does not conceal missing native PG execution.

### Native effect ledger

PostgreSQL 17.11 (`server_version_num=170011`) was built privately from the
official source archive, with pgcrypto, and executed as a non-root fixture user.
Each native Host invocation used a new child and its own database connection.
The database's actual data_directory and system identifier were verified.

| Native case | Post-crash Git writes | SQL dispatches | Host committed finalizations | New successors |
| --- | ---: | ---: | ---: | ---: |
| Observer recovery, repeated selectors, second restart | 0 | 1 | 1 | 1 |
| Two reconciliation Host processes at the intent barrier | 0 | 1 | 1 | 1 |
| Mixed ordinary FINISH / reconciliation intent race | 0 | 1 | 1 | 1 |
| Kill after synced intent, before SQL | 0 | 0 | 0 | 0 |
| Actual SQL COMMIT followed by killed ACK | 0 | 1 | 1 | 1 |
| Actual SQL COMMIT followed by lost ACK | 0 | 1 | 1 | 1 |
| Mismatched authoritative SQL receipt | 0 | 0 | 0 | 0 |
| Existing conflicting successor | 0 | 1 refused transaction | 0 | 0 |

The conflict control preserves the original colliding task, rolls back the
transaction, retains the checkpoint fence/intent and never invokes SQL again.
The mismatched-receipt control's deliberately inserted negative fixture row is
not counted as a Host finalization.
Successful cases independently count one commit row/history event and one
successor task/history event. This is not just a function-call counter.
Every cluster shutdown uses its exact newly created PGDATA and verifies
`postmaster.pid` absence. No broad process kill or pre-existing service is used.

The component suite adds 25 negative controls: existing/falsey/malformed SQL
intent, missing/replaced anchors and journals, foreign ref, changed clean index,
worktree bytes, commit bytes, validly compressed corrupt reviewed blob, protected
Git completion, checkpoint/operator/Host/artifact/workspace identity, unknown
SQL readback and conflicting SQL successor receipt. All retain HOLD without
repeating the original physical effect. Initial READ and equal-content mtime
readback also assert filesystem/index preservation.

### Profile integration limitation, observed on base and candidate

`native-coding-host-commit-profile.integration.test.mjs` supplies a real Linux
`/tmp/...` worktree to SEED_GOAL. The unchanged
`20261025110000_native_coding_initial_goal_seed_v1.sql` profile validator requires
a Windows drive path (`^[A-Za-z]:\\\\`). It rejects the seed with
`native_coding_seed_agent_invalid` before constructing the commit Host. The
unchanged fixture fails identically with base Host/observer bytes and candidate
bytes: 0 PASS / 2 FAIL / 0 SKIP in each run. This is an observed platform
prerequisite, not a passing profile proof and not a new reconciliation failure.
No migration/path-policy fence was weakened. Disposable Windows profile/installed
proof remains required from the coordinator.

The existing ordinary native Host negative initially asserted the old later
`native_coding_git_commit_checkpoint_git_changed` error. Its focused expectation
now checks the earlier exact
`native_coding_host_commit_git_readback_reviewed_bytes_changed` refusal and
confirms that no journal directory was initialized. The actual safety condition
and zero-effect assertions are stronger.

## Source and evidence identities

| Item | SHA-256 |
| --- | --- |
| Host implementation | `55f30a1b905bff48916b5ab4e01694188f96572980a2d6cbd413546cf5a4a1b8` |
| Observer implementation | `f110d0569b80d57c9f531b3ddf5b1d31a86d080f9ada1f3895c797a2c54604c9` |
| Final focused TAP | `65d13148a3d321db9d3c0a9259c767240d109db2ca403165e7526832f6383b5d` |
| Component TAP | `68c05b363dfe4c3ea4e7c97d55db9f6632fde959775f96d09869f2ca202ccd9f` |
| Baseline crash rerun TAP | `0e68c5593d7e60673136732fd3fbfc5ffb8d54c927384453e98eec7d3971a013` |
| Frozen native reconciliation receipt | `77bbc388ec061496cb44aa0b1b1e07182e6f4e212a47ecd1e435bb2ee1236c3f` |
| Existing Host native regression TAP | `f11583b55946631abfa56dde52336d37adc9be3331f05bcfcb0ecfc1e5b41a2e` |
| Base profile failure TAP | `b60427256b1d7145b6974f52d0e4500ae888eed3098a7d835014726640f53bb1` |
| PG/toolchain acquisition provenance | `4328a308496c8adf44432bc95de0df20e3d4fbda3f4715e08668074411ccb35b` |
| PostgreSQL 17.11 official source archive | `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979` |
| Existing commit/rotation SQL migration | `cebb07fd4c04230b1b5b5400a6dfa3d819da0812c230c34efc16e5eff127134f` |

The frozen native receipt records system identifier `7701115743928596585` and
the exact Host/observer hashes. These are worktree-source-bound receipts, not a
claim that BASE contains this repair. The final PR/issue handoff records the
published HEAD and the final committed-source run separately, avoiding a
self-referential commit hash in this file.

Native acquisition used
`https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2` and its
published checksum. The JS postgres driver is the existing lockfile version
3.4.7, verified against lockfile integrity. Build prerequisites were extracted
privately; no system PostgreSQL package/service was installed.

## Reproduction commands

Run from the repository root with a new disposable TMPDIR. The observed local
fixture parent was `/workspace/scratch/a671392e7070/reconciliation-tmp`.

```sh
TMPDIR=/workspace/scratch/a671392e7070/reconciliation-tmp \
node --test --test-isolation=none --test-reporter=tap \
  apps/metaengine-browser/test/native-coding-project-commits.test.mjs \
  apps/metaengine-browser/test/native-coding-runtime.test.mjs \
  apps/metaengine-browser/test/native-coding-host-ipc.test.mjs \
  infra/client-state-runtime/native-coding-host-commit-service.test.mjs \
  infra/client-state-runtime/native-coding-checkpoint-verifier.test.mjs \
  infra/client-state-runtime/native-coding-checkpoint-authority.test.mjs \
  infra/client-state-runtime/native-coding-host-capabilities.test.mjs

TMPDIR=/workspace/scratch/a671392e7070/disposable-test-tmp \
node --test --test-reporter=tap \
  infra/client-state-runtime/native-coding-checkpoint-reconciliation.test.mjs
```

For baseline mode, set `METAENGINE_RECONCILIATION_BASELINE=1` and
`METAENGINE_RECONCILIATION_BASE_SERVICE` / `METAENGINE_RECONCILIATION_BASE_OBSERVER`
to the separately loaded base snapshots. The corresponding current-source cases
are explicitly skipped, as reported above.

The exact disposable Linux native runner shape was:

```sh
runuser -u nobody -- env -i \
  PATH=/usr/bin:/bin \
  LD_LIBRARY_PATH=/tmp/metaengine-reconciliation-pg17-6hropsiq/postgres/lib \
  TMPDIR=/tmp/metaengine-reconciliation-pg17-6hropsiq/tmp \
  METAENGINE_PG_TEST_BASE=/tmp/metaengine-reconciliation-pg17-6hropsiq/tmp \
  METAENGINE_PG_TEST_BIN=/tmp/metaengine-reconciliation-pg17-6hropsiq/postgres/bin \
  METAENGINE_PG_TEST_DRIVER=/tmp/metaengine-reconciliation-pg17-6hropsiq/driver/postgres/src/index.js \
  METAENGINE_REQUIRE_RECONCILIATION_PG17=1 \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --test-isolation=none --test-reporter=tap \
  /tmp/metaengine-reconciliation-pg17-6hropsiq/source/infra/client-state-runtime/native-coding-checkpoint-reconciliation.integration.test.mjs \
  /tmp/metaengine-reconciliation-pg17-6hropsiq/source/infra/client-state-runtime/native-coding-host-commit.integration.test.mjs
```

Source was copied into that newly created fixture tree because shared workspace
ancestors are not traversable by the non-root database identity. Shared directory
permissions were not changed. Final committed runs additionally set
`METAENGINE_RECONCILIATION_SOURCE_SHA` to the exact tested SHA; the receipt also
records source-file digests. Requiring PG17 makes missing prerequisites FAIL
instead of a passing skip. With no native configuration, the standalone native
test explicitly reports `NATIVE_DISPOSABLE_PG17_NOT_CONFIGURED`.

## Coordinator-owned integration still required

The exact dependency was published in
[#1354](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6429169532)
and the API proposal in
[#1357](https://github.com/PatrickFrome/Compute/issues/1357#issuecomment-6429169891).
The concrete minimal shared-file diff is in
[#1354, follow-up](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6429439669).
The extra Git-reader file request was subsequently withdrawn because this repair
uses an in-scope read-only verifier.

| Shared file | Minimal required change |
| --- | --- |
| `infra/client-state-runtime/native-coding-host-authority.mjs` | Optionally delegate RECONCILE_FINISH_CHECKPOINT through existing exact-selector/lifecycle validation when commitService implements it |
| `infra/client-state-runtime/native-coding-host-ipc.mjs` | Add optional action and write classification; validate exact commit selectors before generic optional signed-device validation |
| `apps/metaengine-browser/src/native-coding-host-ipc-client.mjs` | Add write classification, exact selector branch and reconcileFinishCheckpoint method |
| `infra/client-state-runtime/native-coding-host-capabilities.test.mjs` | Optional mount, absence and lifecycle/selector controls |
| `apps/metaengine-browser/test/native-coding-host-ipc.test.mjs` | Selector-only roundtrip, absent-capability correlated refusal and lost-ACK UNKNOWN |

No runtime entrypoint change or public RPC is needed. After integration,
Stream 3 must exercise its own end-to-end useful-goal harness through the actual
private channel. The coordinator must reseal the integrated source, retain
reservation/producer fences and provide the single immutable installer for
disposable Windows acceptance. This branch does not reserve a version or rebuild
the consumed `.178` identity.

Native PG17 receipts explicitly retain `generated_authority_callbacks=true`,
`installed_keeper_used=false`, `windows_acl_qualified=false`,
`installed_autonomy_proven=false`, `production_qualified=false` and
`authority_effect=false`. They do not establish real provider/Critic execution,
Windows ACLs, installed restart continuity or production readiness.
