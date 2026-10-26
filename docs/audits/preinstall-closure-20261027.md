# METAENGINE: pre-install closure, 2026-10-27

## Scope and baseline

This register covers the current Browser/client candidate and its source repairs:
PR #1350 / 601532ca, #1351 / bb671c00, #1352 / 3701d3cb,
and #1353 / 58fadfb3. The integration branch starts at
58fadfb354375ba8af4bd9249a459b5b2a8d9f46 and therefore includes the complete stack.
It does not treat old handoff checklists or hosted-Supabase workflows as current
local-runtime acceptance.

The user authorized reviewing the fixes/audits and closing pre-install steps
incrementally. The existing user installation, Owner, PostgreSQL, Guardian and
registry are not test fixtures. Current source work and generated disposable
tests do not authorize installation or production promotion.

Read-only PC observation at 2026-10-27 00:02 MSK found the .164 uninstall
registration executable version, no Browser process, and a running PostgreSQL
keeper plus Guardian. This is an inventory snapshot, not runtime qualification.

## Required stages and evidence

| Stage | Required result | Current status |
| --- | --- | --- |
| A. Audit reconciliation | Attribute each result to source, CI artifact or actual installation; preserve historical evidence | Reviewed current audit documents and PR stack |
| B. Source repairs | Accurate failure categories; native negatives actually run; preserved state is disjoint from replacement | Implemented and locally verified on Windows; exact-commit CI still required |
| C. Final source qualification | Exact integrated commit passes relevant Linux/Windows Browser, Runtime, W73/W66/W59, UI and native checks | Pending |
| D. Fresh package identity | Read-only live reservation observation, exclusive floor above .178, new manifests/history/seal | Pending; .178 must not be reused |
| E. One artifact producer | One terminal-success Windows Package Smoke for the exact commit/version | Pending |
| F. Installed consumers | Same immutable installer passes local Owner/UI, activation, dirty profile and autonomous soak | Pending |
| G. Existing-install transition | Full disposable Windows forward-migration proof, preserved keeper, exact payload/registry readback and unknown-effect fences | Pending |
| H. User-PC installation | Reviewable exact artifact, verified predecessor/backup and controlled transition | Not performed |
| I. Post-install acceptance | Real useful goal, independent Critic, checkpoint, successor cycle and physical restart continuity | Not performed |

Automatic self-update is a distinct unresolved transition. The current installer
is intentionally fresh-install-only. Its refusal of an existing installation
must remain a failure/HOLD, and a manual-forward migration test cannot be called
proof of autonomous N-to-N+1 updating.

## Completed repairs in this workstream

### Accurate process failure classification

Node 24 promisified execFile reports both its own timeout and explicit child.kill
with killed:true and no ETIMEDOUT code. The classifier previously labelled that
shape as a definite termination. It now preserves the unresolved origin as
session_soak_process_terminated_or_timed_out. An explicit ETIMEDOUT and an
output-limit error retain their separately established categories.
The child command, process lifecycle, 900000 ms deadline and failure gate are
unchanged. Tests execute real inert child processes for both observations.

### Direct pre-dispatch rejection message

A validated REJECTED_BEFORE_DISPATCH response is now reported as that rejection
before the missing-receipt check. The journal remains terminal FAILED, the old
request is not replayed, and no additional Host request is issued.

Windows regression evidence:
- Before repairs: 48 PASS / 2 FAIL / 0 SKIP; both newly strengthened cases failed
  for the observed wrong categories.
- After repairs: 51 PASS / 0 FAIL / 0 SKIP, including actual timeout and explicit
  termination controls, durable rejection and restart/no-replay checks.
- git diff --check: clean for this slice.
These results do not establish a new installer or installed autonomy.

## Existing candidate evidence

Candidate 601532ca / 0.7.0-dev.1784381341133.1:
- Package Smoke 40382079975: SUCCESS.
- Installed autonomous soak 40382080084: FAILED;
  installed_owner_consumer_session_soak_physical_failed. Inner cause unproven.
- Self Update 40382080162: FAILED;
  self_update_durable_successor_receipt_missing.
- .178 was consumed by artifact reservation 12678978941. It cannot be rebuilt
  for the later source stack or this branch.

Source 58fadfb3:
- Package Smoke 40399627262 failed PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED.
- Final Runtime and Dirty Profile dependents did not reach their installed
  qualification. These are not three independently established runtime defects.
- Parent/source test greens do not qualify a changed source commit.

## Audit reconciliation

- FULL_CODE_AUDIT.md is an earlier source snapshot. Its first-run/Prisma/skill
  gaps must be read alongside the later documents, not counted as fresh findings.
- FRESH_PROVIDER_INTEGRATION.md implements the reviewed baseline, native consent,
  first-owner and parent continuation; installed/native/continuous proofs remain.
- UI_DEPENDENCY_REFRESH.md records the initial two remaining Prisma findings.
  UI_PRISMA_ORPHAN_REMOVAL.md removes that unused chain; OFFLINE_BUILD_PRIVACY.md
  records the later completed offline build/pack. Cached applicability is not a
  new registry audit. No bulk audit transmission is part of this workstream.
- UI_RUNTIME_IMMUTABILITY.md and content-inventory tests must remain in the
  exact-source and artifact checks.
- The verified-skill-dispatch safe slice is advisory and zero-authority. Genuine
  approved capsules/evaluator credit remain external prerequisites, not data to
  invent during installer qualification.
- installer-controlled-quit-safety-20261026.md deliberately preserves existing
  installation state and requires separately qualified migration. Keep this gate.
- The local native-continuation CHECKPOINT last changed on 2026-10-25 12:30 MSK;
  its defects refer to earlier commits and require source comparison before reuse.

## Applicability and completion rules

Required local gates include Current Source Qualification, W66, the real PG17
W59 complement, Runtime Contracts, Critical Browser, relevant Live Mechanics,
and the exact one-producer local installed consumers. Frozen W43-W73 manifests
and consumed version history remain immutable.

Legacy Installed Chat, Supabase Edge Live Probe and hosted R83 canaries are not
proof of the owned-PG local runtime. Mark a genuinely inapplicable gate as such,
never as PASS. Production release signing/custody is required for production;
unsigned isolated QA cannot claim production readiness.

Unknown SQL, installer, process or publication effects stay fenced. No timeout
increase, fabricated receipt, automatic retry, legacy uninstaller or broad
process kill may substitute for a missing proof.

## Additional evidence reviewed in this workstream

The prior artifact observations are retained in
`evidence/audits/metaengine-20261027-preinstall/observed-prior-qualification.json`.
Both ZIP SHA-256 digests were independently verified before reading their JSON.
No installer or executable from either archive was executed.

- Autonomous soak artifact 12680557430 (run 40382080084) contains installed UI
  and daemon smoke PASS, with post-exit UI inventory verification. It reports
  zero of 72 second-instance activations and normal_ui_boot_verified=false.
  The phase-COMPLETE launch-progress record explicitly says qualification_proven=false;
  it is not an activation or installed-autonomy receipt. The inner failure
  reason remains unobserved in that artifact.
- Self-update artifact 12681395978 (run 40382080162) starts from
  0.7.0-dev.36806234662.1. It records verified metadata, full target download,
  persisted pre-install intent, singleton/sentinel release, and the installer
  handoff. It exports neither transaction nor pre-install/successor JSON, and
  does not retain the installer exit code or installed target image readback.
  Therefore exit 23 is a source-based hypothesis for this run, not an observed
  runtime fact. The failed-path diagnostics repair addresses this evidence gap.
- Final source runs for 58fadfb3 completed SUCCESS: Current Source Qualification
  40399627268, W66 40399627269, W59 40399627346, and Runtime Contracts
  40399627312. These results apply to 58fadfb3, not to our changed worktree.
- A broader focused Windows regression for our admission/journal/soak slice
  passed 76 tests, with zero failures and zero skips. Evidence:
  `admission-diagnostics-regression.log` in the private local audit directory.
- No ME2_UI_BIN override was present in Process/User/Machine environment during
  the read-only PC check. The known explicit Bun runtime incompatibility is
  retained as a separate limitation; the packaged default Node path still
  requires exact candidate validation.

## Requested additional DevFleet wave

The user requested six additional ordinary ChatGPT streams using GPT-6 Pro.
The installed standalone DevFleet 0.1.0-dev.15.20261014.1 was launched and its
local authenticated operator created six new owned tabs with request
meta-preinstall-20261027-six-gpt6pro-01. Existing ten tabs were retained.
Creation completed as CREATED, with no task message sent.

All six new page readbacks display `6 Pro`, but native model/input probes remain
unverified. Windows UI Automation on the sixth selected tab independently
observed model radio `6` selected, the `6 Pro` label, and the provider menu
messages `Достигнут лимит использования` and
`Заблокировано, открывает варианты доступа` at 2026-10-26T21:52:46Z.
No quota bypass, model substitution, or Send attempt was made.
The exact slot IDs, prepared distinct tasks and no-send status are recorded in
`docs/audits/preinstall-devfleet-wave-20261027.json`. This is a prepared wave,
not six active or completed workers. Resumption needs fresh per-tab readiness
and GPT-6 Pro proof, followed by one send for each durable task ID.

## Integrated local verification, 2026-10-27

The integration worktree is `work/preinstall-closure-20261027`, based on
58fadfb354375ba8af4bd9249a459b5b2a8d9f46. The results below apply to the reviewed
working-tree changes, before the functional commit. They do not transfer the
parent source's CI results or the old .178 package qualification to these files.

### Native PostgreSQL negative coverage

Windows Runtime Contracts now stages the existing SHA-256-pinned PostgreSQL
17.11 archive outside the checkout, executes pg_dump/pg_restore/psql version
readbacks and exports LOCAL_STATE_TEST_PG_BIN_DIR. It does not start a database.
The workflow consumes TAP and requires four explicit successful native guards;
missing, skipped, TODO or duplicate results cannot qualify those guards.
Linux results cannot claim Windows-native proof.

The actual Windows run verified all four required guards, including forbidden
production PGDATA, invalid digest before backup, connection retargeting, and
physical journal alias rejection. The isolated suite returned 17 PASS / 0 FAIL /
1 SKIP; the sole skip is the explicitly non-Windows execution test on Windows.
No installed Owner or PostgreSQL data was used. Workflow budget tests: 9 PASS.

### Failed self-update readback

The physical harness records the verified disposable baseline context before
update. On failure, a bounded, read-only collector exports allowlisted metadata
from fixed receipt paths plus current ASAR version/hash. It classifies observed
image continuity without claiming installer exit 23, successful installation,
retry permission or a durable successor. The wrapper retains and rethrows the
original ErrorRecord even when the diagnostic process fails. Existing deadlines,
fresh-install refusal and successful-update assertions remain unchanged.

Windows verification passed 43 tests without skips, including actual PowerShell
parsing, wrapper failure propagation, ASAR readback and the fresh-only helper
refusing an inert temporary nonempty directory. Frozen Browser dependencies were
installed only in this integration worktree with lifecycle scripts and registry
audits disabled. This was not a Browser installation or an automatic-update proof.

### Preserved paths during manual forward installation

All eight inputs whose bytes must survive are checked for physical separation:
keeper executable, PGDATA, old Owner/config/status/state, candidate root and
installer file. Existing ancestors must have stable realpath and filesystem
identity; junctions, symlinks, hardlink aliasing, containment and unknown identity
fail closed. The CLI repeats the check around qualification, retirement,
installer invocation, publication and readback. A late ambiguity retains the
pending effect state instead of recording completion.

The Windows policy suite passed 44 tests without skips. Full NSIS/registry/keeper
composition on a disposable Windows runner remains Stage G; policy tests do not
establish that installed transition. The diagnostics and preservation slices also
received independent source review without a material finding.

### Local evidence ledger

| Suite | PASS | FAIL | SKIP | Local log |
| --- | ---: | ---: | ---: | --- |
| Admission, journal and soak diagnostics | 76 | 0 | 0 | admission-diagnostics-regression.log |
| Runtime-contract workflow budgets | 9 | 0 | 0 | runtime-contract-budget.log |
| Native PG17 guards | 17 | 0 | 1 | native-guard-runtime/native-guards.tap |
| Self-update failure diagnostics and contracts | 43 | 0 | 0 | self-update-diagnostics-windows.log |
| Forward-install preserved-path policy | 44 | 0 | 0 | forward-preserved-paths-windows.log |
| Total, without double-counting earlier focused runs | 189 | 0 | 1 | Private local audit directory |

The pinned native archive SHA-256 is
6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3.
The local staging receipt explicitly records database_started=false and
installed_state_used=false. The one platform skip does not hide any of the four
required Windows native guards: all four were executed and verified.
