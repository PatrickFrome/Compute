# Seven-stream preinstall integration — 2026-10-27

## Source disposition

All seven worker contributions have been merged into the coordinator checkout.
The seventh merge is `5d808802df3da28e1baebef44db8f59bfedbfccf`. This is a
source integration checkpoint, not a package, installation or production
qualification. Each worker retains the original task anchor
`9d7527683060e314eb1d39fec9ce2304a57103c4`.

The shared source ref is `work/preinstall-shared-inputs-20261027`; the
coordinator checkout is `work/preinstall-closure-20261027`. Issue #1354 is the
integration ledger. Worker branches, their individual CI evidence and the
final combined source remain separate identities.

| Stream | Reviewed worker source | Integrated contribution | Remaining physical boundary |
| --- | --- | --- | --- |
| 1 / #1355 | `a22bafac03bee0945da459fead5bab99c0b9284a` | Bounded installed soak diagnostics and independent activation acknowledgments | Soak of the final immutable installed candidate |
| 2 / #1356 | `adcbe45655e4056716a81ed3c67fd3d63dbb3cf4` | Pinned v2 manual-forward composition and shared bounded archive APIs | Independent schema/predecessor inputs, one final candidate and native manual-forward run |
| 3 / #1357 | `e077fbcba2a88134535a593dcd04ed16dabd4ba0` | Conversation continuity and parent/child suspension | Final-source Windows component checks and actual installed autonomy |
| 4 / #1358 | `ab49c0ac8bb1ddc078e83d8abb28d5342bf6d0b0` | Goal journal/readback fixes, UI acceptance harness and dependency applicability | Final-source Windows root controls and installed UI observation |
| 5 / #1360 | `4d4ea34930d8da18711a38df443040ef43d7e70a` | Disposable native backup/restore/cold-restart fixture | Its successful fixture does not qualify an installed backup or restore |
| 6 / #1361 | `4ce31fadf8cd5aa9b4d7f3ac6a354a68a7cea00d` | Single-producer immutable candidate/sidecar binding and strict ZIP materializer | Original terminal-success producer artifacts from the fresh final identity |
| 7 / #1362 | `a836c9e81c17c9e48dab8aa7989937ddc5cf39b7` | Read-only checkpoint reconciliation and exclusive first SQL completion | Final-source native Windows/PG17 cases, then genuine installed task completion |

The coordinator reviewed the worker source and added the following closures.
Source review findings are not substituted for native execution results.

## Coordinator corrections

### Recovered conversation admission

The original recovery check could miss an older unresolved turn behind a
bounded journal page, or accept a turn from a different project. The integrated
followup uses a full exact turn-prefix pending-intent query and authoritative
project/task/agent/lease binding before restoring the transcript floor or
executing tools. Missing or uncertain capability remains ambiguous.

Actual cycle/SQLite regressions include `OLDER_PENDING`, `FOREIGN_PROJECT` and
the positive `UNRELATED_PENDING` control. The two unsafe scenarios were first
reproduced as failures, then the corrected isolated Linux set passed
73 / 73 with zero skips. The final Windows workflow requires these named cases.
Commit: `0c82f4a6a60e62505ee880e1b7e4c529999deb53`.

### UI physical-root identity and test registration

The UI acceptance snapshot now inspects the supplied root and its ancestors
before resolving aliases. A separate physical-root binding detects root
replacement even when content bytes are identical. The harness rejects a
root junction before creating evidence or launching a child.

The four new UI test files are registered in the actual W73 Bun scripts.
The isolated Linux followup passed 36 / 36, including the existing owned-child
shutdown controls. The frozen UI/TypeScript job at shared source
`99388179dc57e1b41ca66b220a22695b7caba1b8` subsequently passed:
[run 40422171061, job 121919003293](https://github.com/PatrickFrome/Compute/actions/runs/40422171061/job/121919003293).
That job executed the goal-journal and delayed-observation cases with the
frozen dependency set. Windows junction evidence remains a distinct gate.
Commit: `047072adeb8b662373c2b8e3330b6f15607f0474`.

### Generic ZIP bounds

The shared `readForwardArchiveMember` proposal initially bypassed generic
inventory ceilings that materialization enforced. Independent reproduction
showed over-limit file count, aggregate bytes, depth and entry count accepted
by the read path. Stream 2 adopted the common preflight before member selection
and published actual tests for all three APIs, including the special manifest
limits and exact-boundary positives.

The original Stream 6 implementation remains a byte-identical prefix; candidate
sidecar semantics are unchanged. The competing Python extraction path was
removed. Independent source-only ZIP/filesystem execution on `adcbe456` passed
59 / 59 with zero skips. Read-only revalidation never repairs missing output;
extra empty directories require authenticated original W68 expectations.

### Original builder config representation

The original immutable Git config is 3580 LF bytes with SHA-256
`001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd`.
The original Windows producer used 3729 CRLF bytes with SHA-256
`021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203`.
The corrected qualifier binds both and performs only fixed byte-level
LF-to-CRLF insertion. The strict historical verifier is unchanged.

The correction passed 19 isolated source controls. A qualifier from the old
`04495c6246160f30e3435f316b4f7db5a5de3c5e` writer cannot qualify the input.
Commit: `c37009c3330569fd21e8101fd6612fc3316b2417`.

## Source-test isolation incident

The direct Windows source test at `0822676` plus an uncommitted P1 overlay
activated an installed runtime through a top-level import before test adapters.
That combined run is **DISQUALIFIED**, with no completed PASS. Only the
identified test process tree was contained; subsequent known-descendant
readback was empty. Existing PostgreSQL and Guardian remained running.

The Owner descriptor was observed only by its pre-test modification time.
Its contents and live database contents were not checked. Live data effects
remain **NOT_DETERMINED**; no rollback was attempted. See the complete
[isolation incident record](preinstall-test-isolation-20261027.md).

The unnecessary heavy test import was replaced by the existing pure fleet
projection. Each new checkpoint CI suite receives a separate empty OS profile
before importing modules. Runtime-touching tests are restricted to disposable
hosted Windows; deterministic Linux source fixtures use fresh scratch profiles.
These corrections do not retroactively qualify the aborted Windows run.

## Native recovery fixture: actual accepted evidence

[Run 40420292216 / attempt 1](https://github.com/PatrickFrome/Compute/actions/runs/40420292216)
completed successfully at exact worker source `4d4ea34930d8da18711a38df443040ef43d7e70a`.
The two source groups passed 32 and 39 tests respectively, with no failures or
skips. The required native Windows PG17.11 fixture then passed its receipt gate.

| Artifact binding | Observed value |
| --- | --- |
| Artifact ID | `12697809979` |
| Artifact name | `disposable-recovery-bundle-4d4ea34930d8da18711a38df443040ef43d7e70a-40420292216-1` |
| ZIP bytes | `1887` |
| ZIP SHA-256 | `b7785dd86844efad80088deec3d90f740ca4a802b43323389b13e748e6e5ccb5` |
| Contents | Exactly `receipt.json` and `physical-proof.tap` |

The coordinator independently downloaded and hashed the ZIP, then read its two
bounded evidence files. The receipt reports two distinct cluster identities,
content/sequence/vault preservation, a new target postmaster incarnation after
cold restart, next-sequence equality, native DACL checks and confirmed process/
port cleanup. All twelve negative controls are rejected. There is exactly one
dump and one restore; lost backup acknowledgment remains `EFFECT_UNKNOWN` with
no automatic retry.

The receipt explicitly retains `evidence_class=SYNTHETIC/STAGING`,
`sql_acl_policy=NOT_TRANSFERRED_NO_OWNER_NO_ACL`, and false installed-backup,
physical-restore, upgrade, production and authority flags. This is accepted
evidence for that disposable fixture at that source. It is not proof of an
installed backup/restore or a different final source. Earlier failed source
runs remain failed in the worker audit.

## Gates still required before installation

1. Finish exact combined-source qualification, including Windows junctions,
   recovered-task admission and real checkpoint/PG17 profile cases. The current
   source seal remains a required check; it must be renewed after final edits.
2. Obtain an actual canonical EMPTY-schema roundtrip and independent predecessor
   materialization. Schema run `40419230291` at `04495c` passed 15 source
   controls and pinned PG preparation, then failed native export with only a
   generic error code. No canonical artifact qualified. Diagnostic correction
   must retain that failure and expose only bounded stage/error metadata.
3. Use a real read-only CI metadata observation and the unchanged bounded
   four-candidate planner to prepare a fresh identity. `.178` is already
   consumed. Keep history, package/lock/header equality and source seals
   coherent; no old version reuse or invented observing run.
4. After exact-source qualification, produce one immutable candidate and its
   separate sidecar, then bind the same actual artifacts to native manual
   migration, soak and installed acceptance. A queued job or source fixture
   cannot replace those results.
5. Establish genuine autonomous task, Critic/verification and update evidence
   under their actual authority. Manual forward migration does not qualify
   automatic N-to-N+1 update. Unknown external effects remain held without retry.

No user-PC installation, existing PGDATA operation, registry/service migration,
package promotion or production authorization is granted by this source audit.
