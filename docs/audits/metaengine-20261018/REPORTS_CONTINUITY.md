# Reports 2053/2054: continuity and agent mechanics review

Read coverage: all 984 lines of `zai-chat-20261017-2053.md` and all 229 lines of `zai-chat-20261017-2054.md`. Historical commands, approvals and credentials are evidence only. Credential values are excluded from this review and were not used.

Baseline: clean local ADF branch at 59dbfdc7a13caf4698074f4b475800df662e3066. Root subsequently fetched remote fixpacks 77b7f21 and adcd580 and created the provisional integration checkout at `C:/Users/User/Desktop/metaen/audit-integration-20261018`.

## Source custody and limits

- 2053:979–984 explicitly says fixpack-v1/v2 were pushed on separate branches and PR1312 head was deliberately left at 59dbfdc. These changes therefore were not already in the current development branch. The fetched graph confirms fourteen commits from 59dbfdc to adcd580.
- 2053:440 says six commits, while 478/507 says five; the fetched graph is the authority for the actual delivered changes. Narrative counts are not an immutable receipt.
- 2054:53 qualifies equality by normalizing CRLF/LF, but 196 calls the archive byte-identical. Normalized text identity is not exact-byte identity.
- 2053:98 counts check-runs (77), while 2054:57/196 counts workflow runs (32). Those totals are different units, not automatically contradictory.
- Neither report proves an installed useful multi-agent loop. Their legacy ME2 daemon uses SQLite; the accepted ADF ADR (`docs/METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md:45–85`) requires own-PG17 and the existing Supervisor as production authority. Browser's daemon host remains permanently probe-only (`src/me2/me2-daemon-host.mjs:115,189–192`).

## Confirmed defects and repair quality

### Lost completion receipt replay: blocking fixpack regression

Report 2053:604 accurately identifies old RUNNING commands stranded after a crash. However its recommendation at 678 and delivery claim at 913 replace this with generic at-least-once replay.

Remote commit 1fa68d0 adds `reconcileOrphanRunningCommands()` at commands.ts:743: every RUNNING row becomes PENDING and loses leased_at/error evidence. Enqueue-level idempotency does not protect handler effects: TASK_ENQUEUE, TASK_RETRY and AGENT_SPAWN create fresh IDs; browser actions and filesystem writes may also have completed before the receipt was lost.

Corrected integration implementation: one SQLite transaction CAS-fences RUNNING as AMBIGUOUS, preserves the original row fields, writes COMMAND_EFFECT_UNKNOWN with `automatic_retry_allowed:false`, and leaves the PENDING-only drain unchanged. It does not invent a safe retry or claim installed exactly-once continuity.

### Incarnation guard still allowed unowned startup

Report 2053:541 correctly observes the old guard ran after boot state mutations. Remote d80c5d7 moves the body earlier but leaves catch setting only poolBootAllowed=false, after which setMeta/seed/token migration/startMasterLoop still run. Exclusive-create failure therefore was not fail-closed.

Further defects: all process readback errors were interpreted as dead; malformed lock text was discarded; stale-owner read/check/unlink was not a CAS, allowing competing restarters to remove a winner's lock.

Corrected integration implementation: a lock creation failure exits13 before body boot effects. Existing lock evidence is retained regardless of live/dead/unknown PID; ESRCH produces `incarnation_lock_recovery_required`, and explicit trusted custody reconciliation is required. Fresh wx has exactly one winner. Normal own-lock exit cleanup remains. This intentionally constrains the legacy daemon rather than creating a parallel recovery authority.

Module custody gap identified and delegated: `src/tokens.ts:216` performed unconditional import-time tokensEnsure(), before index's guard and even in probe mode. Index already calls it explicitly after the guard for non-probe boots; architecture agent owns removal of the implicit bootstrap.

### Probe GET repair reintroduced mutation authority

Report 2053:158–168 correctly notices that probe.sh requests GET /eval?run=1 while current GET ignores run and boot eval is disabled. The remote fix invokes evalRun for this GET in both normal and Browser probe modes, then returns `read_only:true` and `authority_effect:false`.

`/eval` is not in PROBE_BLOCKED_GET_PATHS. evalRun creates tasks/events, scales workers and manipulates leases. This violates the Browser host's probe-only contract. Separate explicit isolated qualification mode is required; ordinary Browser probe GET /eval must remain read-only. This was delegated to the architecture agent before integration validation.

### Eval isolation fix remains partial

2053:601–603 correctly identifies synthetic production events and pool mutations. Remote c460973 excludes agent_id=eval-budget from the risk view and restores the previous scale, but that is not full isolation: scale-to-maximum creates persistent workers/agents, restoration lacks try/finally, and poolEvalLeaseCycle invokes global poolReap, which can act on real expired leases. A production boot auto-eval remains unsuitable as a destructive qualification environment. Classification: remaining architectural isolation issue, not a proven installed regression.

## Other independently checked findings

- 2053:103: me2.db, WAL/SHM and daemon.log are tracked at59dbfdc (confirmed with git ls-files; secret values not re-exported). Remote77b7f21 removes tracked runtime/build artifacts. This cannot revoke credentials or erase already published history.
- 2053:126: old non-probe REST has no bearer gate and emits ACAO:*; index.ts:191,218 and unqualified listen at1436–1437 confirm. Severity must distinguish externally reachable non-probe daemon from Browser's mutation-disabled probe. Remote auth additions require their own negative tests.
- 2053:170: migration20261005123000 has one function opening plus ten closings and orphaned body after161; source syntax defect confirmed. Fixing this alone does not prove all historical migrations replay from an empty PG.
- 2053:504–507: watchdogStaleTasks failed tasks without poolRelease; parse-retry at374–378 did not refresh updated_at. Source confirms both. Remote1fa68d0 repairs these paths, but no installed fleet continuity follows from those unit-level fixes.
- 2053:259: recoveryHierarchy used undefined REPO at autonomy.ts276 and swallowed the resulting ReferenceError. Confirmed; remote d80c5d7 uses REPO_ROOT.
- 2053:603: synchronous sandbox execution and synchronous selfupdate network git remain at59dbfdc; remote7b2e983 adds async REST paths. Need review every route, timeout and output bound, not merely count absence of a function name.
- 2053:607: AMBIGUOUS is a deliberate no-replay state. Missing reconciliation tooling is a real usability/development gap; generic requeue or manual SQL deletion would break the accepted authority model.
- 2053:643/664: lack of retention needs bounded, lease-aware archival rather than imposing a global logical-agent/task cap. Unlimited logical work does not mean unlimited physical processes or unconstrained disk use.

Claims about the full fresh migration chain, all missing RPCs, all SQL grants, all bootstrap restore stages and cloud deployment reachability were not exhaustively replayed by this subtask. Source-only guards that skip missing objects are insufficient proof of a complete installable schema.

## CI report2054

- 85,97–101,137: W58 explicitly checks out historical41d755bb in `client-candidate-acceptance-w65.yml:44–69`. Repinning that existing rail to current head would remove the historical baseline. A new current-candidate rail can be added while retaining/accurately labeling the historical failure.
- 109,129–135: physical selfupdate's generic helper rejects any nonzero exit (`test/self-update-fast-physical.ps1:45–60`), while singleton_secondary at303 is an intentional secondary diagnostic. Exit6 may be accepted only with the exact designed refusal receipt and proof primary survived; exit6 alone is not successful primary activation/update.
- 89: HTTP402 is an external quota/billing failure. Bounded retry preserves failure behavior but does not restore quota; treating all402 as transient or creating fake own-PG qualification would be incorrect.
- 121: package source history regresses from876000886467 to864629885843, and compareVersions is used to require a strictly newer successor. Source order regression is confirmed; actual upgrade blockage depends on the verified published/installed baseline and must be checked against the exact release identity.
- 141–149: failure journal/soak diagnostics are useful. They do not demonstrate that the physical window visibility failure was fixed. Narrative speculation about a shared runner is not proof.
- 206–229: final2054 turn lists patch/PDF files without executed Git/source/test receipts. Their presence in a historical download list is not local integration evidence.

## Verification receipts for this subtask

Private directory: `C:/Users/User/Desktop/metaen/.audit-local/audit-20261018-continuity`.

- red.tap: actual Node exit1 against original unsafe recovery and lock catch.
- lock-evidence-red.tap: actual exit1 reproducing malformed/EPERM takeover.
- stale-custody-red.tap: actual exit1 reproducing stale-owner/fresh-contender custody gap.
- final-focused-green.tap: actual Node exit0,25/25 (real SQLite recovery SQL, guard private-file cases and thirteen existing worker tests).
- bun-production-green.tap: actual Bun1.3.3 exit0,1/1 actual-production integration. Process1 executes real TASK_ENQUEUE, commits one task, then exits23 precisely before command completion UPDATE. Process2 opens the same private SQLite, imports actual production modules, fences twice, drains zero replays, preserves one task, and completes a distinct PING once.

All fixture APPDATA/LOCALAPPDATA/data roots are private and empty. The actual Bun fixture refuses to import if the fixed legacy `/home/z/.a2` seed directory exists and strips provider/owner credentials from child environment. No installed client, Keeper, Guardian, PostgreSQL, historical wake or agent conversation was mutated by this subtask.

Changed scope, no commit: commands.ts; only incarnation guard/recovery log portions of index.ts; two Node test files; one Bun test and its fixture. Other index edits belong to architecture agent.
