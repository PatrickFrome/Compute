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

## Combined-source readback after `ae4a1f98` — 2026-10-27

This section updates the current disposition above without changing the result
or scope of any historical run. All seven worker PR heads remain the exact
sources in the stream table; their source merges are complete. The latest
published shared source in this readback is
`ae4a1f98d3fc5713ea580a2540f4850deeaa2a4d`.

### Runtime and UI contracts

[Runtime run 40426005616, attempt 1](https://github.com/PatrickFrome/Compute/actions/runs/40426005616)
completed **SUCCESS** at that exact shared source. The Windows job
`121932194836`, Ubuntu job `121932195075`, and real PostgreSQL checkpoint job
`121932195158` all succeeded. The Windows main group reports 724 tests,
714 passes, zero failures and ten explicit skips; its compatibility group
reports 150 passes and its normal UI loopback group reports nine passes.
This is component and disposable-runtime evidence at `ae4a1f98`, without
installed or final-package authority.

[W73 run 40426005678, attempt 1](https://github.com/PatrickFrome/Compute/actions/runs/40426005678)
retains an overall **FAILURE**. Its frozen UI/TypeScript/build/pack job
`121931815201` succeeded. Windows job `121931815617` physically exercised
the UI root/junction/harness controls: 21 passes, zero failures and eleven
explicitly permitted POSIX-only skips, with all seven required Windows cases
present. This repeats the corresponding successful Windows control group at
`99388179dc57e1b41ca66b220a22695b7caba1b8`.

The subsequent immutable-history/current-seal group reports 132 passes and
one failure. The exact failure is the stale current blob for
`.github/workflows/browser-windows-autonomous-soak-v1.yml`: actual
`09ecd3bac6f870989ef537d9039b532179dd2b12`, sealed
`1c2ba7134df52bf91c9529a8e04d05557b4c789e`. Full source groups after that gate
were skipped. The required source seal remains enforced and must be renewed
after the final source edits and actual fresh identity observation.

### Windows checkpoint qualification

[Checkpoint run 40425131479](https://github.com/PatrickFrome/Compute/actions/runs/40425131479)
at `926d0cb0e189f9f7367ab39afffa06c14aba84f8` and
[checkpoint run 40426005775](https://github.com/PatrickFrome/Compute/actions/runs/40426005775)
at `ae4a1f98d3fc5713ea580a2540f4850deeaa2a4d` are both **FAILURE**, attempt 1.
Their real Windows PG17 fixture groups each passed all fifteen tests with
zero failures, cancellations, skips or todos. The earlier component group
reports 219 passes, four failures, two cancellations and one historical BASE
skip; the later group reports 218 passes, five failures, two cancellations and
the same single skip.

The missing required case is the parent group
`unknown SQL intent, missing/replaced journals and changed physical/authority pins preserve HOLD`.
Its 25 sequential full Git/child fixtures share a 180-second parent timeout.
An inert Node reproduction produces the same late-subtest failure/cancellation
shape when that parent expires. The existing public TAP does not retain raw
failure types or durations, so this is a reproduced explanation, not a claim
that an unrecorded native diagnostic was observed. A bounded test-time budget
correction and safe scalar timing diagnostics require fresh CI before closure.

The independently downloaded `926d0cb0` artifact is `12700031303`, 15018 bytes,
ZIP SHA-256 `edc35e0ae79924ad04c06f6b36dd3c7d1bade1197457206aa6fb86da663951db`.
Its source facts verify separate fresh profiles, absent Owner descriptors
before and after both groups, unchanged source and `installed_keeper_used=false`.
The native receipt retains `SOURCE_COMPONENT_AND_DISPOSABLE_PG17_FIXTURES`
scope and false installed-autonomy, canonical-schema, production and authority
flags. Neither partial native success qualifies the failed full workflow.

### Independent predecessor and canonical schema inputs

[Predecessor run 40422171033, attempt 1](https://github.com/PatrickFrome/Compute/actions/runs/40422171033)
at `99388179dc57e1b41ca66b220a22695b7caba1b8` completed **SUCCESS**, including
clean-source verification and publication. Its actual artifact is
`12698623283`, 857955569 bytes, named
`metaengine-browser-predecessor-materialization-601532ca50db02aa9089783dde157a93f484adf2-99388179dc57e1b41ca66b220a22695b7caba1b8`.
GitHub reports digest
`sha256:871095fff4cb8b122c2ca94f85c4c7239981d80cdd4797c8065a147f1cd42c9e`.
The coordinator independently read the producer result and artifact metadata.
The connected downloader rejects this archive because it exceeds its 512 MiB
limit; the coordinator has not independently downloaded or hashed its full ZIP
bytes. The v2 native consumer must still authenticate the complete archive and
its manifest before using the independently qualified uninstaller descriptor.
Disposable materialization does not grant installed migration authority.

[Canonical run 40424096703, attempt 1](https://github.com/PatrickFrome/Compute/actions/runs/40424096703)
at `1c23be3a032ef736fbdf94c4fc8a9ad7630e002a` remains **FAILURE**. Twenty-five
source controls and pinned PG preparation succeeded, but native export failed
at `SOURCE_START` with `COMMAND/FAILED`; cleanup reported `SOURCE_STOP`
`COMMAND/FAILED` and workspace `ENOTEMPTY`. This was before SQL application;
the exact native startup cause is not established by that receipt. No canonical
schema artifact was published.

The reviewed startup correction uses a literal empty
`unix_socket_directories=` argument for Windows, the existing owned-control
runner with NUL stdio and explicit `postgres.exe`, and bounded failure-only
diagnostics. Its five-file patch is SHA-256
`90328eb719822abcdb9aff4abe2ed6ec4119b555187b7f14d21c195ec6425583`.
Portable source checks passed 42 tests with four pre-existing Windows-only
skips; twelve independent focused controls also passed. Those source results
do not substitute for a fresh native canonical export/restore result.

### Read-only identity observation

Observer runs [40424096635](https://github.com/PatrickFrome/Compute/actions/runs/40424096635)
and [40425131475](https://github.com/PatrickFrome/Compute/actions/runs/40425131475)
held with `OBSERVATION_API_UNAVAILABLE` after HTTP 500 on the first repository
artifact catalog page at `per_page=100`.
[Run 40426005650](https://github.com/PatrickFrome/Compute/actions/runs/40426005650)
at `ae4a1f98` obtained HTTP 200 with `per_page=30` and observed total count
17990, then held with `OBSERVATION_CATALOG_BOUND_EXCEEDED`: full enumeration
requires 600 pages, exceeding the existing 500-page cap. No later catalog page,
planner CLI invocation or candidate plan was claimed by that run.

Its independently retained archive is artifact `12700295237`, 5629 bytes,
ZIP SHA-256 `0da66dfdf929688a49c8bfaa0e2604d636ae0b5ec63152bff498d2b3141cca85`,
containing only `observation.json` and `status.json`. The narrow reviewed
650-page cap covers the observed catalog while retaining the 700-request,
12-minute and byte budgets, complete pagination, stable-count, unique-ID and
readback guards. A fresh actual observer success is still required. No package
version has been selected, reserved or built by these HOLD results; consumed
version `0.7.0-dev.1784381341133.1` remains unavailable for reuse.

### Reviewed corrections awaiting fresh combined-source CI

The source corrections below have been reviewed independently. Their local
source or inert-fixture results are not a native result for a new shared head.
No new run identity or successful installed effect is assigned to them here.

| Correction | Frozen patch SHA-256 | Preserved boundary |
| --- | --- | --- |
| Canonical owned PG startup and bounded failure diagnostics | `90328eb719822abcdb9aff4abe2ed6ec4119b555187b7f14d21c195ec6425583` | Canonical SQL, PG pins, DACL, success-manifest contract and cleanup/publication gates |
| Checkpoint negative-group budgets and safe TAP scalars | `5c1133313d438446c5d12d48df1e1bff910772a6d10586b2e3a4b172c38609a5` | All 25 negative assertions, required cases, isolated profiles and fail-closed outcome checks |
| Canonical workflow helper coverage | `d09c72db74b850244205c27460b95519220acbfa2c75589ec7131cef5738bd18` | Existing branch filters, permissions, toolchain, native execution, upload and source checks |

The checkpoint change gives the complete 25-control group a 600-second budget
and each individual control a 90-second budget. Its existing child-process
30-second timeout, outer suite 18-minute timeout and job 40-minute timeout
remain unchanged. Test bodies and assertions are retained byte-for-byte. Ten
local sanitizer controls passed; an independent review verified unchanged
outcomes when parsing the actual earlier failing component and successful
native TAP. New public diagnostics admit only bounded numeric durations and
closed failure-category values, excluding raw errors, paths, stacks and unknown
strings. An inert delayed child still times out and fails with the new limits.

The canonical workflow change adds exactly
`infra/client-state-runtime/owned-postgres-process.mjs` and
`infra/client-state-runtime/owned-postgres-process.test.mjs` to both existing
pull-request and push path lists. Removing those four added lines restores the
prior workflow byte-for-byte. This closes helper-only change coverage; it does
not weaken a check or extend native execution to pull requests.

### Remaining current gates

1. Pass the corrected checkpoint component group and canonical native
   export/restore on fresh exact sources. Preserve failed historical receipts.
2. Obtain a complete successful read-only artifact observation, verify its
   actual archive and plan, and bind a fresh identity without reusing `.178`.
3. Renew the current source seal and package/lock/header identity coherently,
   retain immutable W43–W73 history, and pass the complete final-source checks.
4. Produce the one fresh immutable candidate and separate sidecar, then execute
   the separately authorized native migration and soak gates against those exact
   artifacts. Prior worker or component results do not qualify that candidate.
5. Complete genuine installed autonomy, Critic/verification and automatic-update
   evidence under their actual authority. Existing installation, Owner and live
   database state are not qualified by this source audit.

The source-test isolation incident and its `NOT_DETERMINED` live-data effects
remain unchanged. This update grants no user-PC installation, existing PGDATA,
registry/service, package promotion or production authority.
