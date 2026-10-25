# Native admission and Windows qualification continuation

Date: 2026-10-25. Source continuation; installed execution is not qualified by this document.

## Source and evidence boundary

- Frozen `.4594` package source: `602d4b07f755f7cd61a6da3af06985d4384b859a`, Draft PR [#1345](https://github.com/PatrickFrome/Compute/pull/1345).
- Published fixture follow-up and common base: `1871a23950b2b532a7e28d75d3faa92506bfa739`, `work/agent-count-fixture-followup-20261025`.
- Published native-readiness source integrated by merge ancestry: `cff3496e8510223f0b98d585a83bfc42d9f63c8d` and its metadata-only source-seal follow-up `4e5de5c7fb9d9e0fe34a83c839aab58fca4cdb8e`, Draft PR [#1347](https://github.com/PatrickFrome/Compute/pull/1347).
- Combined continuation: Draft PR [#1348](https://github.com/PatrickFrome/Compute/pull/1348). Its initial reviewed source was `8fb6be379b13e1f3bca0ce66f9ee5d1b3764d3cc`; integrating #1347 adds the published evidence and ancestry without changing that source code.
- Working branch: `work/windows-native-onboarding-diagnostics-20261025`.
- The native-readiness changes were preserved from a separately reviewed, stable file snapshot of the parallel working copy. That working copy was not modified. The shared bundled-onboarding test was merged with the new diagnostic consumer in this branch.
- The prepared successor package version is `0.7.0-dev.1269944506140.1`, selected by the ordinary read-only planner for functional parent `f8fb240ca74965227f901a4ade941a4c0e81deae`. Both package manifests now agree. This is not an installer receipt; the sole producer must still reserve and build the exact versioned head. The `.4594` identity stays consumed and cannot be reused for different bytes.

The supplied installation journal ended with `Recovery required`, `Native admission on hold`, a disabled Run button and a goal entered but not sent. These are historical observations. A fresh Desktop Commander process-read request in this continuation returned `MCP request timed out`; a later device listing reported `Offline` and last seen 35 minutes earlier, with no retained background calls. No installed goal, recovery replay, service restart, live PostgreSQL change or client installation was performed by this continuation.

## Defects addressed in source

### Late native seed capability

Previously, the Host mounted optional seed operations only if the protected operator profile existed during startup. Publishing the profile later left the running Host without `LIST_SEEDS`, `READ_SEED` and `SEED_GOAL`.

`native-coding-host-seed-binding.mjs` now binds the existing Host-owned dependencies once and permits readonly discovery to prepare a later profile. Concurrent discovery joins one preparation. Each request still passes the existing enrolled-device signature, timestamp, nonce, ADMIN and Host binding checks. `SEED_GOAL` cannot start preparation or automatically retry a lost write. A mounted service retains its original protected pins. Closure fences late preparation and late results; runtime composition reclaims optional capabilities that never reached the canonical authority.

Preparation reads fixed private pins and can prepare its private directory before cryptographic request verification; it does not dispatch a goal. This applies inside an already-created native authority: a missing main `native-coding-operator-v1.json` at Host startup is a different condition. Closure prevents publication and successful late responses, not a claim that an already-started SQL effect was physically cancelled.

### Optional IPC response and write ambiguity

A fully valid request to a known but unmounted optional operation now receives a correlated `REJECTED / UNSUPPORTED_ACTION` response. Malformed or foreign frames still receive no correlated response. Reuse of an outstanding write's request UUID cannot downgrade that write to a harmless read rejection. The implementation does not replay an uncertain Supervisor or native effect.

### Admission observation in the UI

The old effect cleanup could discard a slow valid mode read when a runtime status tick arrived. The observer now joins an in-flight read across ticks, fences older responses after an explicit fresh read, and rejects responses from an earlier mount. The actual submit callback is fenced across asynchronous Browser readiness and unmount/remount. The UI exposes a readonly admission check and fixed explanations for capability, timeout, verification and connection failures.

### Generated PostgreSQL schema privileges

The generated schema dump used `--no-acl`. After restore, a restricted SECURITY DEFINER function could regain PostgreSQL's default PUBLIC EXECUTE privilege, which the production Cognitive guard correctly rejects. The export now preserves ACLs. Export and restore verify the reviewed Cognitive privileges; a rolled-back negative control grants PUBLIC execution and proves that the production migration refuses it. This does not repair or relax any live database privileges.

RPC-count expectations use the reviewed `RPC_ALLOWLIST.length`, while the admission reader continues to verify the actual catalog and direct grants. Paging tests cover 65 permit contexts as 32 + 32 + 1 entries without losing the lookahead row. These generated contexts do not prove 65 installed agents.

## Safe failure diagnostics

The attached onboarding CLI preserves its public error code and adds a fixed operation stage and category. Only metadata created by the module reaches its serializer; raw driver messages, SQL, credential-bearing URLs, causes and forged public fields are excluded.

Example from the generated migration failure regression test:

```json
{
  "event": "attached_postgres_onboarding_failed",
  "code": "attached_onboarding_incomplete_review_required",
  "stage": "migration",
  "category": "cognitive_rpc_public_execution_requires_review"
}
```

The special category requires the exact Cognitive guard message and SQLSTATE `55000` during the migration phase. All other driver failures remain `unclassified`. The bundled integration test passes allowlisted stage/category fields to both its diagnostic and assertion text, so they survive into CI logs. Legacy receipts without the fields remain readable. Stages describe the current operation phase, not independent proof of a particular SQL instruction.

## Windows startup evidence

[Critical Audit run 40208669131](https://github.com/PatrickFrome/Compute/actions/runs/40208669131), job `121215002483`, recorded `PS_ENTER` at 231 ms and `ADD_TYPE_BEGIN` at 241 ms, then helper closure near 30,041 ms without `ADD_TYPE_END`, `NATIVE_RUN_ENTER` or READY. This localizes that observation to WinPS `Add-Type`; it does not identify its internal cause.

[Live Mechanics run 40208669135](https://github.com/PatrickFrome/Compute/actions/runs/40208669135), job `121215002366`, failed the first controller and boot read even in a serial diagnostic pass, while later native tests passed. Therefore parallelism and JavaScript event-loop contention are not established causes. Its advisory-capture failure was the deliberate predecessor negative control; the current implementation passed that test.

The first observed native controller and boot read in their respective tests now emit bounded phase labels. The boot trace distinguishes Add-Type, kernel telemetry, PID4 CIM, OS CIM, recheck and JSON output. Production source bytes and the 12-second boot / 30-second controller budgets are unchanged. There is no warmup, retry or timeout extension. The second boot read remains an independent uninstrumented read.

These labels describe instrumented test executions, not a guaranteed cold machine. Timing records explicitly do not establish native qualification or causal attribution. Windows startup failure remains open; phase observation alone does not qualify native execution.

The new instrumentation subsequently ran on integrated source `05ea407df6b6d95ec310cc13edcdb1b29f0a97e0`. [Critical Audit job 121235237262](https://github.com/PatrickFrome/Compute/actions/runs/40215358257/job/121235237262) ended with **5,975 PASS, 3 FAIL, 7 SKIP**. The first controller reached `ADD_TYPE_BEGIN` at 230 ms and closed at 30,028 ms; the first boot reader reached it at 248 ms and closed at 12,030 ms; the forced-output-window helper reached it at 249 ms and closed at 30,038 ms. None emitted `ADD_TYPE_END`. The exact bounded phase receipts are retained in `windows-native-phase-observation.json` beside the other evidence. This confirms the unresolved WinPS Add-Type boundary on that source, not its internal cause or a passing native launch. The prepared successor does not change these production helpers or budgets.

## Local verification

The combined worktree was checked with Node 24.22.1. Tests that need child processes used a scoped local execution permission; they did not contact installed services or a live database.

| Check | Result | Boundary |
| --- | --- | --- |
| Native goal routing and real private IPC fixtures | 75 PASS, 0 FAIL | Generated state and local child processes |
| Host authority, late seed binding and Host lifecycle | 51 PASS, 1 Windows SKIP, 0 FAIL | Real request signatures; generated SQL/OS fixtures |
| Admission observer and actual TSX submit callback | 11 PASS, 0 FAIL | Source callback execution, not a rendered Windows session |
| UI TypeScript | PASS | `tsc --noEmit --incremental false` |
| Attached onboarding and CLI diagnostic consumer | 24 PASS, 1 Windows SKIP, 0 FAIL | Includes an actual local CLI subprocess |
| Windows observation, controller refusal and related portable tests | 102 PASS, 10 Windows SKIP, 0 FAIL | Does not replace physical Windows execution |
| Schema restore plan and fixture lifecycle | 8 PASS, 0 FAIL | ACL/default ACL retained; existing data and connector exclusions retained |
| Syntax/source checks and whitespace | 239 source checks PASS | Source registration and `git diff --check` |

The listed test groups total **271 PASS, 12 Windows SKIP, 0 FAIL**. Separately, the attached-schema PG17 integration test was **SKIP** because its pinned archive and database environment were absent. The two remaining fixed RPC-count expectations in that test were updated without changing catalog admission. Opt-in physical PG17 tests must not be counted as PASS when their environment is absent.

After preparing the new version and integrating the metadata-only peer follow-up, this continuation also ran the complete ten-file historical/current-source preflight from `client-source-candidate-w73.yml`: **124 PASS, 0 FAIL, 0 SKIP**. This includes the eight current seal/identity tests, all 577 sealed paths, actual Git ancestry and the immutable W43-W73 manifests. Its actual local output is retained in `combined-source-seal-regressions.txt`; the eight-test subset is not counted a second time. The new preflight does not replace Windows runtime, installer or installed-work qualification.

## Published PostgreSQL evidence retained by ancestry

The parallel source commit `cff3496e8510223f0b98d585a83bfc42d9f63c8d` records an actual disposable Linux PostgreSQL **17.6** migration test and a two-cluster ACL restore experiment. Its records are retained unchanged under `evidence/audits/metaengine-20261025-native-admission/`:

- `pg17-migrations.json`: 19 migration groups, repeated application, SCRAM direct API checks and negative controls passed; `full_attached_onboarding` and `production_qualification` remain false.
- `pg17-acl-roundtrip.json`: the original source owner was absent in the target cluster; preserved ACLs passed the unchanged Cognitive guard, while a `--no-acl` negative control restored PUBLIC execution and was rejected. The record confirms cleanup of both disposable servers.
- `verification.json` and `focused-regressions.txt`: the peer's 256 passing tests and two Windows skips remain evidence of that source, not additional tests to add to this continuation's count.

This continuation independently checked the log digest, the recorded native-readiness file digests and all four Cognitive SQL digests. The only difference in the peer's source/test digest set is the intentional diagnostic-consumer addition to `attached-bundled-runtime.integration.test.mjs`; the native readiness production files and Cognitive SQL match. These retained Linux results strengthen the ACL diagnosis but are not a new Windows installed qualification or a rerun of the whole combined source.

## Exact-source CI feedback

The first checks associated with integrated head `05ea407df6b6d95ec310cc13edcdb1b29f0a97e0` exposed a separate Linux Shell workflow defect. [Shell job 121235210146](https://github.com/PatrickFrome/Compute/actions/runs/40215358263/job/121235210146) failed its real Electron `MAIN_PROCESS` ASAR test because its contract-suite step had no X server or `DISPLAY`. The Shell workflow checks merge compatibility; its receipt must not be promoted to exact-head native qualification.

The contract step now runs `xvfb-run -a npm test`, matching the virtual display already used by that workflow's renderer diagnostic. The same complete suite and real Electron main-process mode remain enabled. This is a workflow environment correction, with no new skip, timeout, retry or product sandbox change. Local YAML parsing and whitespace checks can verify the edit; actual Electron/Xvfb execution remains a CI requirement because those executables are absent in this local environment.

The same integrated head's [Ubuntu Current Source job](https://github.com/PatrickFrome/Compute/actions/runs/40215358060/job/121235206839) confirmed the stale current-source seal at the migration integration test. Its [Package Smoke job](https://github.com/PatrickFrome/Compute/actions/runs/40215358114/job/121236273362) correctly refused the already-reserved `.4594` identity, bound to frozen source `602d4b07f755f7cd61a6da3af06985d4384b859a`. The source-seal and unique-version updates below address those two concrete preflight failures without relaxing their checks.

The ordinary read-only identity planner first confirmed that `.4594` requires a new manifest version. After the display correction was published as `f8fb240ca74965227f901a4ade941a4c0e81deae`, the planner selected `0.7.0-dev.1269944506140.1` and observed no existing reservation for it. The exact planner output is retained in `evidence/audits/metaengine-20261025-native-admission/package-identity-plan.json`. This observation is not a lock or physical build authorization; the producer performs its existing serialized preflight again.

The successor updates the package/lock versions and the current identity record, appends the previous `.4593 -> .4594` transition unchanged and keeps `.4594` in the consumed-version list. Earlier source seals and the immutable W43-W73 manifests remain intact. The current seal had 20 stale reviewed source/test hashes from the follow-ups; those hashes and the four changed identity records are refreshed, and 16 reviewed source/test/workflow entries are added. The resulting seal covers 577 files and does not promote CI, installed, live or production qualification.

PR #1347 subsequently published its own metadata-only seal refresh as `4e5de5c7fb9d9e0fe34a83c839aab58fca4cdb8e`. This continuation integrates that commit by ancestry and retains its new receipts unchanged. All 571 paths in its current seal are present in the combined 577-path seal; the 11 differing hashes are the intentional diagnostic and new-identity changes. Its recorded 124 passing preflight tests belong to that peer source and are not added to this continuation's test count.

## Required next evidence

1. Read terminal CI for this exact source, including Windows native phase records and current PostgreSQL contracts. Parent checks are not inherited qualification.
2. Produce a fresh schema archive with ACL preservation and run the disposable Windows dump/restore/onboarding/Owner path. The previous archive made with `--no-acl` is invalid for this proof.
3. Let the sole Package Smoke producer reserve the prepared unique identity and build its normal installer for the final exact versioned head. Do not relabel or reuse `.4594` artifacts.
4. Restore working remote access, read the actual installed source/runtime and inspect the earlier ambiguous Supervisor wake. A successful native admission read must not erase that history.
5. Qualify the new package and only then measure an actual installed agent/CRITIC/checkpoint/successor/restart cycle. See [AUTONOMY_ACCEPTANCE.md](AUTONOMY_ACCEPTANCE.md). Development assistants, synthetic tests and an entered task are not installed autonomy evidence.

Hosted qualification quota errors seen in older workflows do not justify a hosted fallback. The target remains the existing own PostgreSQL and native Host path.
