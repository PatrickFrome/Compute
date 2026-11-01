# Cold setup direct continuation — 2026-11-01

## Exact recovered inputs

Main/Host local input: 423dcdd9f9798da87a0ea05356a5787999d856df, tree 7da174bfce4a6f2758458c950335f32a549f759f.
Cold setup published parent: a91281b846a9cdb5eb38da7e8cd6475098ad7468.
Reconstructed composition tree: ff3f79ec76bac8a65c44b01052340a248bc2d330, local merge ed3fb583a.
Recovered five-file incomplete checkpoint tree: 6e5269413c96c9431ebd9fd782607b7745664848, local commit 02e6ef99b. Tree equality was independently checked against the producer checkpoint, not inferred from filenames.

## Implemented successors

- fdfd81659: both original resource owners receive close even if one throws; invalid async close is retained and joined, followed by physical HOLD.
- afcd75991: ADMIN repository preparation uses the signed original request and existing current ADMIN operation, durable RESERVE/TERMINAL SQL, fixed worktree plans, exact readback and no retry after lost RESERVE. Added SQL source registration and exact function-body hashes. Binding validation precedes CLAIM/local job registration.
- d40ea0fed: original Windows Job controller-backed Git executor with pinned private tools, immutable argv, original deadline/Owner veto before birth and resume, original result/error/job identity for resource joins, cancellation and persistent unconfirmed cleanup. Added candidate migration inventory and mandatory named Windows outcomes.
- a28927f62: isolated consent fixture explicitly includes its canonical tools boundary; no production consent/authentication logic changed.

## Executed evidence

- Materializer: 25 PASS, including two reproduced red-to-green close failures.
- ADMIN producer generated contract tests: 8 PASS.
- Native Git executor generated controller tests: 9 PASS; related runtime/settlement group: 48 PASS total. Generated observations are NOT Windows qualification.
- Actual disposable PostgreSQL 17.11 plus signed device request and actual Git: 45 PASS, 0 SKIP. Includes new ADMIN worktree preparation, retained readback after restart, immutable history, and rejection of widened ACL/partial schema. Native Owner/resource observations in older cases remain generated fixtures.
- Actual disposable fresh-schema PostgreSQL 17.11 candidate qualification: PASS. Output explicitly production_qualified=false; existing unresolved dependencies/automatic population limitations remain. This does not prove a fully functioning fresh installed client.
- Source check: 281 PASS.
- Related Host/lifecycle/package-resource suite: 76 PASS, 1 Windows skip.
- Migration/source-closure tests: 13 PASS.
- Windows qualification registration: 21 PASS; actionlint of modified workflow passed.
- Full infra pass before the final consent fixture correction: 1032 PASS, 3 FAIL, 31 SKIP out of1066. Two FAILs were the outdated consent fixture and then passed6/6 focused tests. Remaining Unix IPC failure was listen EPERM in this cloud environment, not proved to be a production defect. An escalation attempt could not initialize its sandbox; no socket/ACL policy was changed. Do NOT call the full suite green.

## Remaining release blockers and boundaries

1. The default runtime-host setup service still has no genuine first-setup Main/Owner continuation mounted. The new native executor is implemented and tested but must be composed through the authentic existing original request/custody path, not optional fake callbacks or `verified` flags. Do not enable RUNNING/prepared/runtime-ready merely because a module exists.
2. Original pending Main/Host callback lifetime must survive asynchronous verification and child readiness without being reconstructed from packet JSON. The initial short setup ACK is not that capability.
3. Default Host now observes the original setup resource stage before owned runtime/PG stop, then joins the original full operation afterwards. Pending/failed joins preserve HOLD and prevent SQL-pool disposal/ownership release. Generated ordering and actual Host regression tests passed (80 PASS/1 Windows skip in the related group); real Windows PG-dependent shutdown still needs qualification.
4. Native Windows execution of the new adapter and its real helper/descendant/output cancellation cases remains NOT RUN here. Generated controller fixtures do not close this gate.
5. First install origin/SCM/Owner enrollment, applied Codex policy equivalence, release signing and final unified installer remain separate open work. No production signer service is currently available according to the user.
6. No client installation, main merge, release version reservation, new key, security setting change or production admission was performed.

This checkpoint is source progress, not installation readiness. Draft publication requires explicit coordinator approval of the composed local Main/Host source; no inherited CI result qualifies the new composition.

## Node-safe composition correction

The final explicit installed-tools suite caught a real composition regression: importing the setup materializer through the managed-project adapter brought the Electron Main tools adapter into the standalone Node Host source closure. Corrected by extracting the unchanged project core and fixed Git plan/capability logic into managed-task-project-runtime-core.mjs. Browser/development compatibility exports remain in the original module; Host and native executor import the Node-safe core. The original strict catalog and Electron exception remain narrow. No test assertion was relaxed to admit the Main adapter into Host.

Verification: installed tools15/15, related materializer/Git/packaging97/97, Main/private-tools49/49, source/registration28/28. Generated Main process interception now fails before importing any fixture if its child_process interception becomes stale. Source checks282. Full infra at prior b7c57ff completed1070 tests:1038PASS1FAIL31SKIP; only Unix socket EPERM remained. Its npm wrapper later encountered a registry network denial; no registry retry was performed. Subsequent native-tools/setup checks were direct local Node tests, not a claimed successful npm wrapper.
