# METAENGINE Unified Command & Continuity Plane V1

Status: ACCEPTED ROADMAP / SOURCE PARTIALLY IMPLEMENTED / INSTALLED CONTINUITY UNQUALIFIED
Date: 2026-10-15 (current audit; historical checkpoints retained below)
Scope: PatrickFrome/Compute / METAENGINE Client + own PostgreSQL + Windows Host

## Architectural adoption — Autonomous Development Fabric V1 (2026-10-17)

**ACCEPTED DESIGN / FIRST SOURCE SLICE IN PROGRESS / INSTALLED-LIVE UNQUALIFIED.**
The binding architecture decision record is
[`docs/METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md`](../../docs/METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md).
This is one ADR beneath the existing canonical Level-1 roadmap, **not a
replacement roadmap**.

The development center of gravity changes to a durable, authenticated,
independently verified Goal → PG17 claim/lease → worktree edit/tests → Critic →
checkpoint → continued task after restart. The existing Supervisor remains
the sole physical scheduler, with Host/Guardian custody unchanged. Logical
tasks/agents and their future task-bound mailboxes outlive physical Browser
tabs; finite provider slots never become a global limit on durable work.
No Supabase, cloud execution, second scheduler, automatic replay of
AMBIGUOUS effects, or agent-controlled trust promotion.

**First vertical source implementation:** distinguish KNOWN vs UNKNOWN own-DB
task demand in the existing Fleet governor. Missing/malformed backlog must not
be converted into a zero-load retirement/provisioning effect. A physical
FLEET_RECONCILE is permitted only for KNOWN demand; large logical backlog
remains independent of physical tab capacity. This is advisory projection and
gating, **not** an implemented logical-agent registry or a new authority.

**Next evidence gates:** (1) exact installed Owner/Guardian/PG17; (2) one real
bounded serial coding loop with independent Critic and restart readback;
(3) durable logical-agent/session binding and causal mailboxes; (4) browser/UI
lifecycle independence and measured elastic fleet; (5) governed RSI rollout.
Source/unit tests alone do not qualify installed autonomous execution.

Canonical development base at adoption: `2bc3f3c13a75ed9708d657ae37db5cac610cc13f`
Adoption branch: `work/unified-command-continuity-p0-v1`

## Binding goal — continuous autonomous agent development

METAENGINE must continuously develop the assigned goal through coordinating, communicating chat agents that can create further agents and subgoals, preserve context, independently verify results and continue after a chat, worker or Host restart. There is **no fixed product-wide ceiling** on agents, children, task count or recursion depth. Growth follows the work; it is not a manually launched sequence of fixed-size waves.

**The owner's 2026-10-15 request for 10 slots applies ONLY to the external DevFleet development wave. It is not a METAENGINE capacity policy.** Account for each execution backend's available resources independently, with queued logical work and dynamic allocation, without converting one backend's current capacity into an engine-wide agent limit. Per-request page/batch sizes are transport bounds, not graph-size limits. Explicit owner-set project policies remain possible and must not be silently overwritten.

## Current local checkpoint — 2026-10-15 / operational repair and installed acceptance

**Local development checkout:** `C:/Users/User/Desktop/metaen/client-operational-repair-20261015`, based on `86e2187a9d96e21c92badfcc9d0b06410fc0e522` from `work/client-artifact-cardinality-repair-20261015` ([Draft #1311](https://github.com/PatrickFrome/Compute/pull/1311)), test identity `0.7.0-dev.1107139874561.1`. This source includes the earlier `4835901` recovery diagnostics and the subsequent capability/fixture repairs. The owner's current direction is to continue development locally in `metaen`; this checkpoint does not claim publication of the local follow-up or qualify changed source under the baseline's reserved package identity.

The next acceptance target remains **one useful autonomous coding loop, independently verified and continued once after restart**, followed by sustained coordination, communication and recursive child work. Source regressions, generated fixtures and external DevFleet occupancy remain separate evidence from that installed result.

| Evidence bound to the current baseline | Observed result | Remaining acceptance |
|---|---|---|
| Candidate source identity | Local Git contains `86e2187` and confirms `4835901` is its ancestor | Verify changes and record their new local source identity before attributing results to them |
| Windows package qualification, readback at 2026-10-15 20:27 UTC (23:27 Moscow) | Normal installation and first-run steps passed; the real Owner-backed step was still running | Terminal Owner/PG17/GUI and overall workflow outcome; an in-progress step is not PASS |
| Local installed Browser | Version remains `0.7.0-dev.37781000059.1`; the current candidate is not confirmed installed locally | Exact installed payload, ordinary window, protected Owner/Host/PG health and stable execution readiness |
| Interrupted-start recovery | Source preserves a finite startup recovery category and health-failure witness | Resolve the historical `STARTING` record through independently verified child custody; an absent PID alone does not permit lock removal |
| Authenticated autonomous development | No installed W30 lease → real edit/tests → W39 independent critic → checkpoint → restart continuation receipt established | Complete and read back one useful loop on the same installed source and authority chain |

**Concrete production wiring gaps confirmed in this source:**

- `apps/metaengine-browser/src/supervisor-device-identity.mjs` defines `bindHostOwnerGenesisW74`, but the production Browser/runtime modules contain no caller. The existing genesis implementation and its fixture tests therefore do not establish default installed Owner initialization.
- `apps/metaengine-browser/src/final-runtime-activation.mjs` and `apps/metaengine-browser/src/host-agent-remote-composition.mjs` each construct `createHostPrivateCustodyW76({identity})`. In `host-private-custody-w76.mjs`, `readExistingGatewaySecret`, `readExistingOwnPostgresBirth` and `readExistingProtectedBackupRoot` all default to `null`; these production calls supply none of them. The corresponding credential, PostgreSQL and backup readers consequently return no trusted evidence. A successful ordinary launch would not close this separate Owner/context integration gap.

### Ordered local work from this checkpoint

1. Complete the current Owner/API/Edge diagnosis with disposable native fixtures and preserve exact terminal evidence. Qualify the candidate's actual installed payload and visible startup before reporting local installation success.
2. Implement and verify interrupted-start custody/reconciliation without replaying ambiguous task effects or stopping attached PostgreSQL. Historical records with incomplete child custody remain explicit recovery blockers.
3. Connect W74 initialization and W76 private readers to the existing authenticated Host/Guardian, own-PostgreSQL and protected credential/backup capabilities. Require matching Owner incarnation, generation, source and independent readback; retain UNKNOWN when those capabilities are unavailable.
4. Run an authenticated goal through the existing Supervisor/W30 executor, real code edit/tests, W39 independent verification and own-PG checkpoint; restart and prove the next admitted task executes once.
5. Extend the verified loop to communicating roles and recursive logical work under actual backend resource admission. Complete same-source package, restore/rollback and sustained-run evidence before marking installed continuity or R1/C1/C2 VERIFIED.

The following checkpoints are retained as historical evidence. Their older heads, in-progress statuses and package identities do not describe the current local candidate.

## Historical checkpoint — 2026-10-15 / candidate, recovery and autonomy re-baseline

The next acceptance target is **one productive autonomous coding loop followed by a verified continuation after restart**, then sustained coordinating/communicating/recursive agents. DevFleet waves are external development capacity; they do not satisfy that target or impose a METAENGINE-wide ceiling. Existing owner-set project policies remain authoritative. The unbounded-default migration applies to new projects only; logical queues may exceed available physical execution slots.

**Reviewed source baseline:** [Draft #1309](https://github.com/PatrickFrome/Compute/pull/1309), `765b4e063a3d468311889d3d5bf8698f36e17589`, test identity `0.7.0-dev.1028947361258.1`, descended from [#1308](https://github.com/PatrickFrome/Compute/pull/1308) `49d050ff127e22ca27fbe3514324ba99832afb24`. PR descriptions contain historical heads; current GitHub `head_sha` is the source identity. The present recovery/roadmap follow-up is SOURCE ONLY and does not rebuild or qualify that reserved package identity against changed source.

| Evidence on baseline `765b4e0` | Observed result | Remaining acceptance |
|---|---|---|
| W71 existing worker / disposable PG17; W80 fixed sandbox edit / PG17 | SUCCESS: [W71](https://github.com/PatrickFrome/Compute/actions/runs/38773827425), [W80](https://github.com/PatrickFrome/Compute/actions/runs/38773827625) | Authenticated production P-256 device, W30 lease and W39 independent critic; useful next-task continuation |
| W37 canonical context; R97 source UI; release-proof reader source | SUCCESS: [context](https://github.com/PatrickFrome/Compute/actions/runs/38773827544), [R97](https://github.com/PatrickFrome/Compute/actions/runs/38773827839), [proof source](https://github.com/PatrickFrome/Compute/actions/runs/38773827792) | Same installed Owner/source/proof/cursor identity; genuine signer/custody readback |
| [Windows Package Smoke](https://github.com/PatrickFrome/Compute/actions/runs/38773827846) | Terminal FAILURE at installed Owner-backed disposable PG17: `edge_readiness_timeout`; identity, staged PG17/grants, R97, NSIS and basic installed payload steps passed | Fix and requalify actual Edge readiness; journal restart, Guardian and sealed qualification were SKIPPED and remain unproven |
| [Native Windows ACL](https://github.com/PatrickFrome/Compute/actions/runs/38773827503) | SUCCESS | This source/fixture result does not attest the installed Owner's backup root |
| [SelfUpdate](https://github.com/PatrickFrome/Compute/actions/runs/38773827479), final activation, installed-chat and autonomous-soak workflows | FAILURE | Separate independent defects from downstream package/Owner failures before repair; no all-green installed claim |
| Current-source qualification and W59/W66 integration | IN_PROGRESS at audit | Terminal exact-head jobs; no inheritance of parent greens |
| [Client State Runtime Contracts](https://github.com/PatrickFrome/Compute/actions/runs/38773827333) | CANCELLED | A complete exact-head runtime result; cancellation is not PASS |
| Local installed Browser | File version `0.7.0-dev.37781000059.1`; newer candidate installation is unconfirmed | Fresh protected Owner/Host/PG readback and stable ordinary window before installed acceptance |
| DevFleet Direct connector | Read-only probe returned UNAVAILABLE / HTTP 404 | Restore native endpoint before claiming current slot occupancy or a new dispatch |

**Recovery development begun:** a pinned attached Host left in `STARTING` lacks the child-custody evidence required for automatic orphan quarantine. This follow-up preserves a fixed `local_runtime_host_startup_recovery_required` category across the existing private IPC, instead of losing it as generic `start_failed`. Exact lock/status PID and bundle binding are required even for this diagnosis. Arbitrary child error text and extra fields stay private. Regression fixtures retain lock/status bytes, perform no process/port probes on incomplete custody, preserve ambiguity fences and never admit READY. This is diagnostic progress toward P2, not completed recovery or live readiness.

The newly terminal package log also exposed a diagnostic loss in readiness: startup discarded the last finite API/Edge health failure, and Host's FAILED write reset an already observed failure to null. The follow-up retains and awaits that finite witness on terminal timeout/mismatch, preserves it in FAILED status, and lets the disposable installed-bundle test print only the validated category. Genuine causes such as connection refusal, invalid response and missing capability attestation can now be distinguished without emitting private stderr or changing deadlines/readiness admission. Regressions reproduced an empty failure-event list and an overwritten null status before the fixes. This does not yet identify or repair the physical CI Edge timeout's underlying cause.

### Ordered work from this checkpoint

1. Use the terminal `765b4e0` Owner failure and the preserved finite startup-health witness to diagnose `edge_readiness_timeout` in a new isolated native fixture. Prove real Edge/API capability admission, then freeze a fresh source/version for package/Owner/GUI qualification. Do not replace the failed run with a filtered test, earlier EXE or a reused version.
2. Complete interrupted-start custody and incident recovery: bind a durable startup phase to the exact owner nonce/instance/source, record child ownership before admitting recovery, independently verify process incarnation and endpoint absence, serialize the successor and preserve ambiguous outcomes. Historical STARTING records without this proof remain blocked; never remove their lock merely because the PID is absent.
3. Wire authentic default Host/Guardian/private Gateway/own-PG/backup producers and genuine release signer/SLSA inputs. Optional callbacks, staging keys and generated profiles cannot substitute for installed authority.
4. Run one authenticated goal through existing admission and W30 lease, real bounded code edit/tests, W39 independent verification and own-PG checkpoint. Restart the admitted executor/Host and prove the actual next task runs once.
5. Extend that loop to communicating roles, recursive child creation and durable logical queues beyond one backend's physical capacity; measure useful verified completions and recovery rather than open chats. Keep one scheduler and own PostgreSQL authority.
6. Qualify a uniquely identified package, restore/rollback and installed UI/Owner/Guardian on one final SHA; only then evaluate sustained autonomy and P5 canary promotion. R1/C1/C2 remain SOURCE/STAGING until their independent LIVE exit evidence is complete.

## Historical checkpoint — 2026-10-15 / direct critical closure (#1308)

**Current source work:** [Draft #1308](https://github.com/PatrickFrome/Compute/pull/1308), `work/metaengine-critical-closure-20261015`, based on W73 #1303 `9e8ebcd09b46d0e8f5a09e9a0471d15a190baeea`, with ancestry of latest W74 #1304 `5473a8e2d073687520591c25d2280a5809299695`, W76 #1306 `e44e69c3b80c63d6d9bead473b4c621b3bd4145e`, and W77 #1307 `f3ecdadaebaf412ac6b5ff470139326fce49a3a1`. All Wave12 published source parents remain ancestors. The immutable W43/W51/W59/W66/W73 ledgers are historical; `client-critical-closure.manifest.json` seals the current reviewed source. Wave13 prepares ten distinct external DevFleet assignments in `DEVFLEET_WAVE13_AUTONOMY_10.json`. Native read-only preflights returned UNAVAILABLE / HTTP 404 then 429 on 2026-10-15; **none of those new tasks has been sent or confirmed running**. No tab IDs, receipt or completion status is inferred, and no ambiguous historical send is retried. No parallel scheduler is introduced into METAENGINE.

Confirmed defects repaired directly:

- **Unbounded logical growth by default:** the original project registry defaulted to depth 8, 256 tasks and 8 children, despite already supporting NULL as unbounded. A separate source-pinned own-PG migration now makes only NEW projects unbounded by default. Existing rows and owner policies/generations are preserved. Spawn still admits READY logical tasks through the existing authority without allocating a lease. The real-PG regression now constructs 283 tasks, depth 10 and 272 unleased queued researchers with only six physical fixture agents, then reads the entire graph across bounded pages. This regression still requires native CI execution; no installed DB was migrated.
- **Owner genesis:** PostgreSQL rejects `SELECT ... FOR SHARE` on a persistent table in a READ ONLY transaction (`25006`). Keep row/advisory locking on the serializable generation transition; use an ordinary SELECT for read-only snapshots. Normalize the verified `int8` epoch before the independent post-commit comparison. Both Guardian samples must agree on schema, ownership/device binding and native postcheck. Fix recursive negative fixtures and the real-PG fixture's missing required postcheck. Creation's post-commit fence now compares device ID, client ID and key fingerprint as well as epoch, process and source: a meaningful new negative first reproduced an old Owner returned after same-epoch rebind, then passed with the fence. Retain a written-but-unqualified record without automatic rewrite. Focused Owner/protected-identity/deadline group: **10 PASS**.
- **Transport regression coverage:** the old tests assumed a hosted default or env-only READY. Generated private profiles now exercise the actual awaited local bootstrap and endpoint pin, with a narrowly scoped health double; no installed Owner/DB is opened. Meta signing accepts only the canonical pinned runtime path. The retired cloud/local fallback console refuses construction without probes or authority switching. Heartbeat units cover the actual `/v1/heartbeat` wrapper separately from full `/v1/state` publication. Untrusted page markers remain unable to settle ambiguous sends.
- **W80 restart/concurrency:** replace the process-local attempted-effect Set with an exclusive, flushed single-use marker inside the already verified disposable locked Git worktree metadata. The marker is never removed after an unknown outcome. Independent workers, different effect IDs and source reset cannot repeat this fixed repair in the same worktree. This is SOURCE/STAGING, not the production W30/W39 effect ledger. Canonicalize generated Windows fixture paths before signing their worktree digest.
- **Windows native qualification:** the W73 Windows runtime failure was `host_agent_request_timeout:BACKUP_ACL_READBACK`, not evidence that all ACL negatives were broken. Native readback previously launched four cold PowerShell processes. Two independent native samples now each enforce the full required SID/rights/owner/inheritance policy; the IPC deadline covers both bounded samples, while every other operation retains its original short bounds. Guardian compiled and its real OS 100ns probe passed on W73; the workflow then failed cleanliness because MSVC wrote `.obj` files into source. Stage both build and probe intermediates outside the source tree. Fix W80's pre-chown container Git read with an exact-workspace `safe.directory` override, never `*`.
- **One current CI train:** run the complete Browser suite on Ubuntu/Windows, complete Client runtime, immutable ancestor seals and current source seal, additional backup/coding/critic guards, and frozen ME2 tests/typecheck/build/pack. Avoid rerunning the same slow Windows native ACL suite in later source-only steps. Keep W59 physical PG complement, W74 real-PG, W75 native compiler, W80 physical loop, current Windows ACL and packaged R97/SelfUpdate as independent required evidence. Filtered, skipped, cancelled or parent checks are never current success.

Verification at this checkpoint:

- Original integrated Browser baseline: **5,124 PASS / 77 FAIL / 24 SKIP**. After the first repairs: **5,190 PASS / 14 FAIL / 24 SKIP**; twelve failures require Unix sockets forbidden by this execution environment, and the remaining two heartbeat/rollover fixture mismatches were then repaired and passed in the focused group.
- Focused Owner/identity/heartbeat/deadline/rollover/ambiguity group: **16 PASS, 0 FAIL, 0 SKIP**. W80 worker tests: **6 PASS**, including independent-worker and fresh-worker replay negatives. Browser parse/source check: **190 PASS**.
- Full Browser at local checkpoint `df42ab195224ed603cc76221051382914b59285c`: **5,194 PASS / 13 FAIL / 24 SKIP**. Twelve are Unix-socket EPERM restrictions of this execution environment; the thirteenth was the historical workflow guard's exact-condition expectation and is now repaired. Focused actual workflow/Owner/rollover follow-up: **23 PASS / 0 FAIL / 0 SKIP**. Client at that checkpoint: **551 PASS / 1 socket EPERM FAIL / 19 SKIP**. These are not all-green results or final-head native qualification.
- ME2 at that checkpoint: **29 Observatory + 12 primary-view tests PASS**, TypeScript, production build and frozen-lock pack PASS. Added migration plan tests **3 PASS**; source bundle, startup manifest and grant tests **40 PASS**. Separate PostgreSQL **17.5 WASM STAGING** experiment physically executes the new defaults migration, transaction rollback, existing-policy preservation, optional explicit bounds and private marker EXECUTE denial; PASS. It does not prove native restart or the full 283-task integration regression.
- Separate generated PGlite experiment: actual PostgreSQL **17.5** SQL engine reproduces old `25006` and verifies repaired creation, idempotency, ambiguous-project refusal and text-form `int8`. This is explicitly a WASM STAGING experiment, **not** native PostgreSQL 17.6, postmaster restart, installed Owner or Windows evidence. The native Docker PG17 gate remains mandatory.
- Published **baseline** W73 run `38680311447`: Linux source and ME2 SUCCESS; Windows source FAILED at native ACL IPC timeout. W74 `38680311235` FAILED real genesis; W75 `38680311618` compiled/probed successfully then FAILED source cleanliness; W80 `38680311485` FAILED generated-path/Git ownership; full SelfUpdate `38680311304` FAILED historical transport units. These are prior-source failure evidence, not outcomes for this closure SHA. New exact-head CI receipts are still required.
- First published closure `a49df8e38034da12fc29f3ac2402f5a4da1f3edc`: full local Browser **5,196 PASS / 12 socket EPERM FAIL / 24 SKIP**, Client **551 PASS / 1 socket EPERM FAIL / 19 SKIP**, current seal/ancestry/CI/plan **16 PASS**, and ME2 **41 tests + typecheck/build/pack PASS**. GitHub current-source run `38737309211`: Ubuntu and ME2 SUCCESS; Windows still running at readback. W75 `38737309239` native Guardian compile/100ns/cleanliness SUCCESS. W74 Windows/Ubuntu source SUCCESS; real-PG still pending. These successes are bound to that first head, never inherited by a later commit.
- Fresh Windows CI exposed additional **generated-fixture** defects: canonicalize W78's `RUNNER~1` temporary root before supplying private paths (keep production alias rejection and add an alias negative); set committed `*.mjs text eol=lf` attributes in W56's generated repository before linked-worktree checkout (keep exact pre/postimage checks); give `pg_ctl` non-piped stdio as well as `-l` because Windows descendants can retain the parent's pipe after exit code 0 (keep exit-status, owned PID/birth/PGDATA/port and independent SQL readbacks). The growth fixture now uses the canonical IMPLEMENTER agent for admitted CODER children rather than weakening role admission. W78 focused **5 PASS**, W80+W64 focused **7 PASS**. Re-run the actual native fixtures on the follow-up published head; the first-head failures remain red historical evidence.
- W74's Docker restart fixture also reused the old ephemeral published port and could wait indefinitely on a stale endpoint. Re-observe readiness and localhost port on the exact generated container after restart, with bounded Docker probes; do not infer stable identity from an old endpoint. This follows [Docker's ephemeral-port lifecycle contract](https://github.com/moby/moby/blob/master/api/docs/v1.24.md), not an installed Owner proof. Its native follow-up remains required.
- Follow-up published `88d96a2f2f66a75282842f0626687dd9b2bd468a`: W80 `38738782785` Linux job `116434792819` and Windows job `116434793320` **SUCCESS**. Actual native Linux PG17 readback includes 283 logical tasks, depth 10, six fixture agents, 272 READY/unleased researchers, paginated graph traversal, independent verifier, ordered/rollback-safe history, plus W48/W56 physical red→green/critic/postmaster-restart fixtures. W74 `38738784181` real Docker PG17 job `116434924340` and both source OS jobs **SUCCESS**. This closes the prior fixture failures on that head; it does not establish installed/live P-256/W30/W39 execution or qualify later source by ancestry. The final same-epoch identity fence above requires its own published-head CI.

**Remaining release blockers:** authentic default Host Owner/private Gateway/own-PG/backup custody is not established by optional callbacks or generated fixtures; W77 needs the genuine existing release signer and independently verified SLSA sidecars; W80's generated Ed25519 fixture is not an authenticated live P-256 device/W30 lease/W39 critic chain. Complete current Windows native ACL both-event and privileged reparse negatives, real PG17 restart/restore/C2, R97 packaged UI and signed unique-version package gates before installed/LIVE acceptance. Main merge, installation/release and mutation of live PGDATA/Vault/Owner/ACL remain outside this source-only closure. W53 and historical `.59` ambiguous effects remain unreplayed. Never reuse burned versions `0.7.0-dev.842024784850.1` or `0.7.0-dev.37781000062.1`.

### Research applied to the current architecture — 2026-10-15

These are design references, not a claim that a third-party framework proves METAENGINE's implementation. No new framework/service, credential or scheduler is added.

| Primary analogue | Relevant verified pattern | METAENGINE decision |
|---|---|---|
| [OpenHands SDK architecture](https://github.com/OpenHands/docs/blob/main/sdk/arch/overview.mdx) | Separate agent, typed tool/executor and workspace; isolated remote execution is distinct from agent reasoning. | Keep the existing DevelopmentPlane and bound task/worktree capabilities; a model or page cannot attest its own Host identity. |
| [Temporal activity definition](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/activities/activity-definition.mdx) and [LangGraph durable functional API](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/functional-api.mdx) | Durable observation of completion does not imply one physical execution. A started but unfinished operation may execute again; stable receiver-side idempotency/result reconciliation is needed. | Preserve the own-PG ledger as sole authority; bind a stable effect identity before dispatch, retain ambiguous state across restart and never turn timeout into retry permission. The W80 file fence covers only its disposable fixture. |
| [VS Code extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host) and [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/) | UI, browser and Node/workspace hosts have distinct capabilities; isolate untrusted content and validate IPC senders. | Keep privileged OS/DB work inside the existing trusted Host composition. Typed zero-input readback does not expose credentials, arbitrary SQL, shell, or raw Electron IPC to pages. |
| [SLSA artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts) | Verify artifact digest, signature, recognized builder and canonical source against preconfigured trust. | Preserve W68 independent exact-byte/native-signature/SLSA fences; generated JSON or a new test key cannot replace the real release root. |
| [SWE-agent CLI](https://swe-agent.com/latest/usage/cli/) | Its official documentation now identifies SWE-agent as maintenance-only and points to mini-swe-agent. Historic benchmark success is not evidence of current suitability. | Compare current implementations before adoption; do not add another agent runtime or grant a general shell to fix a narrow missing capability. |

### Historical W81 readback — superseded by the current closure candidate

**SOURCE/STAGING IN PROGRESS; installed Owner, signed package, autonomous Agent and LIVE effects remain UNKNOWN/BLOCKED.** This single living roadmap now follows W66 #1291 exact published source `61534c1228b81b063b48082c3cdbcbfd2921fe63`, not the older W59 candidate. Independent GitHub compare establishes W72 #1293 exact `e0a2180e3b1d177d9d7d8c608a2060a5100060dc` is a TRUE W66 ancestor (ahead 97/behind 0). W66's manifest enumerates 27 integrated PR parents and 100 protected current source/test/workflow blobs; this is source assembly evidence, **not** terminal same-head CI, a final W73→W78 ledger, or installed proof. W81 starts from a separate clean clone of W66 without touching dirty user trees. W72's earlier W59 + W65 merge remains historical provenance, not the present top-level checkpoint.

- **W63 source sync proven on its own head** #1286 `6a124ad0032a5beaa583de978d9bf37b4be35f34`: W55 run `38668631525`, Windows job `116206245138` SUCCESS and Ubuntu job `116206245089` SUCCESS; W50 run `38668631262`, Windows `116206244074` and Ubuntu `116206244236` both SUCCESS. Not integrated SHA qualification.
- **W61 PostgreSQL proved on own head** #1285 `00140a57964aacbddea6a5cf4811774bb1196b14`: run `38668692032` job `116206428052` actual Host capacity/PG17 SUCCESS, job `116206427765` real two-cluster PG17 dump/restore SUCCESS. Old cap3!=1 and stdio timeout are not currently unresolved at W61 head. No production PGDATA mutation.
- **W64 PostgreSQL lifecycle proved on own head** #1288 `30e9641ba13b56cb3a18be9b6f93dc92db4df116`: run `38669118621`, physical PG17 restart job `116207770610` and Windows source job `116207771035` SUCCESS. Authenticated C2 goal admission, real W30 lease claim, W39 independent critic/checkpoint must still be closed by W71; READONLY worker and fixture STAGING are not physical C2 agents.
- **W65 historical Windows ACL red remains red:** W58 pinned historical source PUSH `38668762680`/`116206639624` and PR `38668767134`/`116206653774` FAILED 21pass/23fail. WinPS5.1 and Security module import succeeded; wrong to call that green or fix it by simply switching shells. W72 qualifies repaired *current* source, not the pinned W58 historical tree; Linux unsupported is never Windows success. Full inheritance/broad SID/UNC/ADS/junction/reparse/TOCTOU/Owner/restore negatives remain mandatory.
- **Historical W59 candidate is stale, not current:** W59 `83e1d60d` lagged W61 by 14 commits, W64 by 2 and W62 by 2. W66 `61534c12` subsequently integrated the published final Wave10 and Wave11 source ancestry and regenerated 27-parent/100-blob current manifest; this does not retroactively repair W59 SelfUpdate `38670177954`/`116211217591` FAILED or C4 `38670177772`/`116211213757` FAILED. W66 exact integrated Windows/ME2 workflow `38674461246` (Windows `116224759842`, Ubuntu `116224759544`, ME2 `116224759855`) was QUEUED, not PASS, at W81 readback. Parent-source green is nontransitive.
- **Current Windows ACL terminal proof still pending:** W72 #1293 exact PUSH run `38673705297` Windows `116222394597` remained QUEUED at W81 readback; exact PR run `38673708204` Windows `116222404126` had advanced to IN_PROGRESS, not SUCCESS. Ubuntu jobs were still QUEUED. Neither event is final. Historical W65 21/23 FAIL remains red. Local W72 53 PASS / 2 privileged-symlink SKIP is genuine Windows STAGING, not those missing symlink executions, CI or installed proof. W81 adds a physically executed Windows hardlink/single-link file-ID negative (without changing ACL policy), plus independent TAP execution critic: any skip, omission, failure, duplicate or Linux-only run is BLOCKED, even if ordinary Node exit is zero. TAP itself remains untrusted until independently matched to GitHub exact HEAD/event/job.
- **Current source/acceptance gaps:** W67 #1292 latest `0752bf4f3e317db9f4caeb40d7b10e2f7edc3e66` is **diverged** from W66 `61534c12` (2 commits ahead of shared `bfd7f663`, W66 68 commits on its side): W73 must integrate and requalify exact latest code. W67 itself documents unavailable authentic installed Host genesis/private Gateway/PG birth binding; native Guardian 100ns birth on source does not prove an installed Owner. W68 #1294 `73501c8e` provides source-verifier, not an installed Authenticode/SLSA signer. W69 #1295 `3b31239a` is source R97/UI, not unique signed NSIS or immutable package. W71 #1296 `457e6d88` reaches existing read-only DevelopmentPlane, not authenticated edit-capable Agent → W30 claim → independent W39 result/critic → durable restart continuation. New Wave12 W74–W80 actual published refs and W73→W78 final single SHA/ancestry/complete terminal CI remain **UNVERIFIED** at this checkpoint, not inferred from task descriptions. W82 CI queue/applicability cannot promote skipped parent checks to GREEN. Separate installed Owner/Agent readback required. No main merge, install, release, live ACL, production DB, credentials or installed Browser effects authorized.
- **Evidence discipline:** W53 and historical `.59` AMBIGUOUS/UNKNOWN receipts are unreplayed. No cloud/Supabase fallback, no optimistic SOURCE→INSTALLED/LIVE promotion, no artificial self-attestation. Exact W72 SHA must be read externally after publication; no fabricated check outcome.

## Binding owner directive — own DB only

**SUPABASE IS PROHIBITED** for this architecture and all new execution paths. Do not call Supabase cloud, REST, Realtime, Edge Functions, SDK or hosted Postgres; do not use its credentials, tokens, schema authority or infrastructure. This includes an implicit fallback on failures. The only durable transactional state store is METAENGINE's own self-hosted PostgreSQL 17 (localhost on a single-host deployment, or explicitly operated METAENGINE-owned PostgreSQL for federated deployments). GitHub remains an optional source/CI repository, never a task/effect DB. No dependency on ChatGPT being open.

Legacy SQL files and the path `apps/metaengine-browser/supabase` are historical implementation naming, not permission to connect to Supabase. Existing functions may be reused after independent provenance review and qualification under own Postgres. Remove or rename obsolete Supabase-oriented transport through explicit, tested migrations rather than deleting active code blindly. No future new runtime behavior may require a hosted provider.

## End-state and layers

`GPT chat (ephemeral operator) → own authenticated Gateway → own PostgreSQL intent/claim/event/effect/checkpoint ledger ↔ METAENGINE Client/Supervisor → Agent Fleet → verified result → continuation`

In parallel: `Windows Host Agent + Guardian` provide trusted process/database/package recovery. `Causal Observatory` serves identical projections to GPT and UI. Physical authority remains in the existing typed leased executor; no second scheduler, effect queue, autonomous retry channel or shadow DB.

1. **GPT chat**: temporary observer/coordinator/operator; one context call to recover; multiple chats resolve to one durable project/run identity. Chat is not a heartbeat, storage engine or always-running worker.
2. **Gateway**: authenticated typed tools for `context`, `inspect`, `submit_goal`, `control`, `run_status`, `events`, `qualify`, `emergency_stop`. Begin read-only; mutation routes require separate signed identity, capability, idempotency key and generation. No raw SQL/shell/eval/CDP. Native own HTTPS/MCP transport can be added without changing underlying authority.
3. **Client**: one Supervisor/scheduler, demand-driven Fleet, bounded BrowserCells, exact session/process/target fencing, Brain/Memory, Development Plane, evidence and artifact registries.
4. **Own PostgreSQL**: authoritative per-task owner partition/epoch, transactional leases, append-only event/effect/continuity, durable receipt/checkpoint, ordered cursor. Realtime wake is advisory, not authority. On multi-host deployment use a self-operated transport and explicit single-writer partition ownership; never dual-master local/remote SQL.
5. **Host**: Guardian, host-owned credentials, Windows services, self-update with exact artifact/proof/restart/rollback; no task planning or model/page authority.

## Cross-cutting invariants

- Every response carries schema version, source identity, observed_at, freshness, proof, explicit unknowns and authority_effect=false for all observation APIs.
- `HEALTHY` is NOT equivalent to live PID/socket, available DB, succeeded unit test or a model claim. Unknown, stale, conflicting, or absent independent evidence fails closed.
- All intent/effect/readback operations bind project_id/run_id/task_id/lease_generation/device_id/process_incarnation/source_sha/event_seq where applicable.
- Unknown network outcome after dispatch → AMBIGUOUS; never blindly retry. Follow exact reconciliation evidence and separate authorized generation.
- Zero trust for page/model/worker/memory text. Credentials, raw DOM, sensitive page contents, private SQL connection strings and arbitrary path/shell arguments must never appear in operator snapshots.
- METAENGINE has no fixed engine-wide agent/task/depth ceiling. Backend resource accounting, admission and transport batch bounds never become a graph-size limit; logical agents/tasks outlive tabs/sessions and use dynamically available execution backends. Emergency-stop preempts new admissions. The external DevFleet wave alone uses ten slots.
- Progress = verified useful completions, failure recovery and quality/cost, never a count of open tabs or agents.
- Independent CRITIC/FALSIFIER receives artifact/evidence locators, independently reads proof, and cannot grant itself effect authority.
- Own-DB status must be proven by live readback. Historical source names, legacy cloud references and CI mocks are not production evidence.

## Milestones / sequencing

| Stage | Work | Acceptance evidence | State |
|---|---|---|---|
| P0 — Truth Plane | Trusted read-only unified snapshot: own-Postgres readback, explicit UNKNOWN for missing Client/Supervisor/Fleet/Host/Source/Continuity; bounded API, freshness and identity; no secret leak | Core falsification tests; protected loopback HTTP; negative auth/origin/method checks; no DB mutations | IN_PROGRESS |
| P1 — Operator Gateway | Compact goal-level API & read-only inspect/events/run-status, then signed admit/control via existing authority; multi-chat idempotency | One chat reconnects by run_id; collision fences; no duplicate effects | READ_ONLY_SOURCE / ADMISSION_PARTIAL |
| P2 — Execution Continuity | Attest installed Owner, PostgreSQL/Guardian, reconcile WAKE_AMBIGUOUS, recover real task lease and restart | Physical Windows `Goal → ADMITTED → agent → artifact → critic → verified checkpoint` + restart | BLOCKED_ON_LIVE_EVIDENCE |
| P3 — Fleet Coordination | Unbounded durable agent/task graph, recursive spawning, role scheduling, communication, dependencies, verifier and handoff; backend-specific resource accounting | Coordinated recursive growth beyond local backend capacity, crash/lost-ack/child-failure recovery, no duplicate scheduler/effect | SOURCE_PARTIAL / CONTINUOUS_PRODUCTION_LOOP_UNQUALIFIED |
| P4 — Observatory/UI | One canonical snapshot + cursor-based deltas for Now/Missions/Fleet/Brain/Develop/System/Evidence, causality drill-down | UI and GPT agree on identical run_id, event_seq and proof identity | SOURCE_TESTED / PACKAGED_NATIVE_PENDING |
| P5 — Self-improvement & verified promotion | Baseline→candidate→isolated eval→independent critic→bounded rollout→rollback; durable learning | Measured quality/speed improvement without unverified promotion | SOURCE_PARTIAL / VERIFIED_PROMOTION_BLOCKED |

## P0 slice 1: own local DB context endpoint

Implement a pure source-typed `operator-unified-snapshot-core.mjs` and authenticated `GET /operator/v1/context` on the existing loopback local PostgreSQL API. On this slice the DB facet uses the real existing catalog/capability SQL readback; all unconnected facets are `UNKNOWN` rather than inferred from PID, local files, or project memories. The endpoint grants no action authority. Do not expose an external port or MCP prematurely. Subsequent P0 slices will add signed Host/Owner evidence and consistent read-only task/fleet query projections, each with independent tests.

## Release gates / progress rule

Stage completion requires exact commit + source/tree identity, unit/falsification tests, own PostgreSQL disposable DB tests, Windows packaged UI/Owner/Guardian E2E where applicable, explicit adverse evidence cases, then independent live readback. Commit/PR is implementation, not installation. Installed version is not `READY` until exact EXE bytes and physical startup/effect proof are confirmed. No production DB migration/OS update until independent backup equality, role/ACL, permissions and no-unknown-effect gates are met.

## Historical immediate sequence — 2026-10-12 (superseded above)

1. P0 slice 1 implementation + focused tests + local API regressions (no live owner alteration).
2. P0 slice 2 source-backed task/fleet/session and host/guardian observation adapters, with bounded data/sensitivity and freshness checks.
3. P1 read-only external Operator Gateway with authenticated identity and safe transport (self-operated, no hosted backend).
4. Resolve currently unproven installed Admin/Owner and backup compatibility before task/effect testing.
5. Physical one-goal/multi-agent rollout and continuation.

This is a living roadmap. Update this single file on every relevant architecture review or milestone completion. Record exact test receipts and remaining blockers; do not create competing roadmap authorities.

## Implementation checkpoint — 2026-10-12 / P0 slice 1

- Implemented source: `infra/client-state-runtime/operator-unified-snapshot-core.mjs`, its falsification tests, and `GET /operator/v1/context` under the **existing own PostgreSQL** loopback API.
- No new SQL tables, cloud service, scheduler, external listener, raw SQL interface, or effect authority. Client/Supervisor/Fleet/Host/Source/Continuity remain UNKNOWN in this slice.
- Focused unit/HTTP-security contract: 22/22 PASS. Browser source structural gate: 190/190 PASS. Full Windows physical installed E2E: NOT RUN; no release/installation proof.
- **Discovered release-critical legacy drift:** `apps/metaengine-browser/src/native-supervisor-endpoints.mjs` still defines a hosted cloud-first default when `METAENGINE_STATE_PROVIDER` is absent; `bootstrapPersistentLocalProvider()` returns `NO_OWNER_CONFIG` when no owner file exists. Therefore merely shipping this P0 endpoint does NOT yet make the entire Browser strictly own-DB-only. This is a blocking migration requirement, not an accepted fallback.
- **Mandatory before P1 promotion or installed release:** remove the hosted default/fallback and fail closed on missing/mismatched local owner configuration, while preserving offline diagnostic boot; prove no external Supabase request in a Windows dirty-profile/absent-owner negative test. Do not silently substitute a guessed localhost port or bypass owner identity proof.
- This checkpoint is SOURCE-QUALIFIED only; no production DB migration, Windows Guardian mutation, installed update, or live agent effect was executed.

## Implementation checkpoint — 2026-10-12 / P0 slice 2, Truth Plane hardening (partial)

- Branch: `work/devfleet-p0-truth-v1`, independent isolated checkout from exact slice-1 base `6deab07107faeccd12c7e753ff8f02a785c673d7`.
- Existing protected `GET /operator/v1/context` is retained; no new listener, task database, scheduler or mutation route.
- Database readback no longer fabricates `observed_at` using the HTTP clock. It makes one bounded, fixed `SELECT` for PostgreSQL clock/startup/database identity inside the existing capability-RPC transaction and qualifies contradictory, missing or malformed readback as `UNVERIFIED`. Stale DB time is `STALE`, partial catalog is `DEGRADED`. `AVAILABLE` remains DB-only, not Owner/Client/Fleet/Guardian HEALTHY.
- Pure snapshot reducer now rejects non-DB positive claims without Owner/heartbeat; requires process incarnation for Client/Host, signed-proof flag and epoch for Supervisor, lease generation for Fleet, exact source SHA for Source, ordered event sequence for Continuity. Contradictory owners become `AMBIGUOUS`. These *minimum shape gates are not cryptographic attestation*; no untrusted caller can supply them to the protected endpoint.
- Default endpoint still emits `UNKNOWN` for Client, Supervisor, Fleet, Host, Source and Continuity. Their real signed Owner/Guardian/native/session/checkpoint readback adapters are **NOT IMPLEMENTED**. This slice is intentionally **PARTIAL / NOT RELEASE READY**; do not infer deployment readiness from hermetic tests.
- Falsification coverage: absent/duplicate/corrupt database witness, incomplete catalog, stale clock, missing Owner/heartbeat, stale heartbeat, contradictory Owner, absent signed supervisor flag, corrupt SHA/event_seq/lease generation, private data non-disclosure; protected endpoint missing witness case.
- Release blockers persist: legacy cloud-first default without exact Owner config (PR #1184 addresses a different branch but requires independently proven absent-Owner behavior), real Windows Owner/PostgreSQL/Guardian test, independent live source/continuity attestation, installed-package proof and own DB recovery exercise. No installed client/production DB/Guardian mutated.
- Focused evidence on isolated Windows checkout, Node v24.19.0: `node --test operator-unified-snapshot-core.test.mjs operator-truth-readback.test.mjs db-api.test.mjs` = **27/27 PASS** after repairing a test-harness assertion (first run 26/27); `node --check` for the three runtime modules and `git diff --check` PASS. Exact released/live Owner readback remains untested.
## P0 slice 2 — Host/Browser process incarnation (source branch checkpoint)

Branch: `work/fleet-p0-host-truth-v1`, stacked on P0 slice 1 head `6deab07107faeccd12c7e753ff8f02a785c673d7`.
An independent, explicit read-only Host-observation reducer was added with Browser PID/creation/incarnation fencing, Guardian status, split-channel heartbeat, OS process inventory, bounded freshness, strict allowlist/redaction and no possible Host `READY` promotion. The existing loopback `GET /operator/v1/context` gains an optional trusted in-process Host readback callback; the standalone CLI deliberately leaves it disconnected (`UNKNOWN`) until independently reviewed, wired and physically attested. No new API route, SQL, local process inspection side-effect, Supabase client, installed-client mutation or scheduler authority.
Adversarial source tests cover PID reuse, stale heartbeat, absent Guardian, metadata redaction and runtime-probe-only. **These tests are added but not executed by this distributed Chat role**; exact replay is required from an isolated checkout and is not live host evidence.
Next: the coordinator independently validates the new branch, then connects a trusted read-only Owner/Guardian adapter only after exact process-incarnation/heartbeat provenance verification. The legacy cloud-first Browser fallback remains a separate release blocker.


## W2/P0 — Owner-scoped own-Postgres ledger truth (2026-10-13, source qualification)

- Independent implementation branch `work/roadmap-w2-own-pg-truth-20261013`, stacked on PR #1191 exact head `fff5c2147d83445457f47e9e3503e2bab0161292`; do not merge/release before review.
- `infra/client-state-runtime/operator-own-pg-fleet-truth.mjs` adds fixed parameterized, bounded read-only SQL for project, task/claim/lease and ordered event cursor from existing own PostgreSQL. One repeatable-read, read-only snapshot with scoped trusted Owner identity; no new schema/effects/planner/listener.
- Existing protected operator context now optionally consumes an **in-process** trusted Owner adapter. No Owner adapter and no proven ledger privileges means explicit `UNKNOWN`, not fabricated fleet readiness. Contradictory active claims / lease generations / event cursors fail closed. Limited counts and `after_seq/next_seq/through_seq` only; raw task specs, event content, credentials and SQL are excluded from projections.
- Focused W2 + protected HTTP + existing DB API/Host/context falsification tests: 38/38 PASS on Windows Node v24.19.0 (exact source SHA at first qualification: 85e37b1b5d23e851e15add35471e9e65a91837d4). Real PostgreSQL RLS/grant proof, live Owner binding and installed Host/Guardian effects remain necessary gates. This is **SOURCE-QUALIFIED, NOT INSTALLED/READY**. No production migration, Browser/Guardian mutation, Supabase connection or main update.

### W1/W2/W3 source convergence checkpoint — 2026-10-13

- Isolated integration branch `work/roadmap-truth-gateway-convergence-20261013` combines exact W1 Host PID/incarnation witness PR #1206 (`1b5e4382`), own PostgreSQL fleet/continuity witness W2 PR #1207 (`438e4aa5`) and read-only Operator Gateway W3 PR #1202 (`27c82179`), based on W2 source and with the separate six-source CI catalog repair PR #1209 (`913dc3f4`). Original seven worker PRs remain DRAFT; no main merge.
- Combined `infra/client-state-runtime` tests include `operator-trusted-host-readback.test.mjs`, own-PG ledger tests, `operator-readonly-gateway.test.mjs`, and `operator-truth-convergence.test.mjs`: Host process evidence does **not** grant trusted project Owner authority; no automatically started Gateway; missing Guardian or OS evidence remains UNKNOWN. These are candidate tests, not installed proof.
- Real Owner/Guardian process inventory and signed native epoch, own-PG read-only role/grants, run-ID / cursor evidence and authenticated in-process adapter plumbing remain **unproven and intentionally unwired**. Neither HTTP 200 nor a structurally claimed `verified` flag is enough to make any plane ACTIVE. Gateway observer hooks remain null and return UNKNOWN without a trusted source. This branch performs no migrations, writes, external listener binding, ChatGPT sends, Browser/Guardian/DevFleet reinstall, or Supabase effects.
- Downstream W4 Supervisor lease PR #1208 and W5 DAG SQL PR #1204 require disposable PostgreSQL 17 concurrency/fencing tests, packaging/source-pin qualification and critic approval before inclusion in a live release. W6 UI #1203 must not synthesize a live state before the W3 bridge is physically attested. W7 critic #1205 does not itself authorize promotion.
- CI evidence must be checked at the **exact integration SHA**. Upstream source-targeted tests are not combined installed-runtime acceptance; keep all candidate PRs DRAFT and main unchanged.


### W6 Causal Observatory staging on unified P0/P1 readback — 2026-10-13

- W6 PR #1203 source (`198fca65e55bbbef9107dc76351bfcf37baa73e9`) has been staged in the separate branch `work/roadmap-observatory-convergence-20261013` on top of W1/W2/W3 combined source #1210 (`e26afc2ba82c8ddcfefe5b5b8618829390f91ccf`). Seven Now/Missions/Fleet/Brain/Develop/System/Evidence perspectives consume ONE canonical operator context and run-scoped monotonic cursor.
- The ME2 renderer has **no** new arbitrary HTTP, credentials, web worker, token transport or local-storage authority. Its `window.metaengineOperator.readContext()` remains intentionally UNBOUND until the trusted native Owner bridge can be wired and physically qualified. No fallback to daemon health or old UI is allowed; missing readback shows UNKNOWN.
- `apps/me2-ui/package.json` now declares `test:operator-observatory` to exercise the pure W6 reducer and negative source/cursor/proof/secret tests. Source staging is not Next/TypeScript build or installed-client acceptance until exact-head CI reports prove it.
- No installed Browser, Guardian, DevFleet, real PostgreSQL changes, migrations, Supabase effects or main merge. Independent reviewer and signed installed Owner/PG/Gateway+bridge readback remain release gates.


### W7 independent critic / no-hosted-fallback source convergence — 2026-10-13

- Staged the exact local-only source transport contract from PR #1198 (`31a3aea3656daa3b19165a5aa8da5919f2597d67`): bootstrap and native supervisor endpoints may not silently adopt hosted HTTP or Supabase fallback without an attested local Owner. This modifies SOURCE CANDIDATES only; installed packages remain unchanged.
- Staged W7 independent evaluator source + 29-case falsification suite from PR #1205 (`ef8a2907aca5b6af349eba0f1c38ffe415301d89`) on top of W1/W2/W3/W6 source-only convergence #1212. Canonical client-state test script includes the critic. Promotion outcomes are capped at REVIEW_REQUIRED, never authority to merge, install, execute SQL or roll back a live system.
- No true independent signed critic receipt, physical P0 Owner/native/Guardian proof, PG17 ACL, signed artifact/rollback witness, or installed no-egress capture has been collected. Exact-head CI must pass before this candidate may advance. No main merge, DevFleet reinstall, live Browser/Guardian/DB mutation or hosted provider.


## W49 Independent Candidate Acceptance — 2026-10-15 / Wave 8

- Branch `work/roadmap-unified-w1-w7-source-20261013` combines the **seven independent roadmap implementation lanes** into one isolated source tree. W1+W2+W3 Truth+Gateway from draft #1210; W6 Causal Observatory from #1212; W7 independent critic + local-only Supervisor policy from #1213; durable journal-fence tests from #1214; P0 no-hosted capsule cleanup from #1215; W4 boot/restart lease + ambiguous native receipt source and W5 bounded DAG/admission from draft #1211. This is a **candidate source integration**, never installed runtime qualification.
- W5 uses the **same existing leased executor**, not a second scheduler. Its new SQL guard is present only as a candidate own-PG migration in the existing local catalog. W4 Supervisor CAS SQL remains unregistered for automatic migrations pending verified PG17 schema, ACL, dual-process crash/lease fencing and signed native receipt tests. No live database operations.
- **Critical invariant:** UNKNOWN owner/Guardian/runtime -> UNKNOWN rather than ACTIVE; source-plane proofs do not confer effect permission. W5 OPEN cannot settle W4 WAKE_AMBIGUOUS; only independent native receipt identity and readback can. C4 goal-journal disk ambiguity fences same-incarnation writes until restart readback. The agent access capsule never advertises hosted cloud or reserve command authority.
- W6 renderer's native context bridge remains unbound, W3 Gateway in-process adapter readbacks remain opt-in null, and W7 promotion evaluator never performs deployments. Dedicated source/CI tests are necessary but not sufficient for installed, network/DB/GUI or signed real-agent production E2E.
- Do **not** merge main, apply SQL to working own PostgreSQL, start another scheduler, install Browser/Guardian/DevFleet, or use Supabase/hosted transport. Exact-head CI, independent critic and disposable PG17/Windows proof are required before candidate promotion.

### 2026-10-14 W6 wave-2: canonical Observatory cursor resync (source-only)

- Branch `work/metaengine-wave2-w6-resync-20261014`, based on independently checked #1216 source head `881eb2e29882419921978910ec6c3f184f197801`; prior W6 #1203 head `198fca65e55bbbef9107dc76351bfcf37baa73e9` and W10 conformance #1225 head `3035e0fb246b9081b3010894d83eb470d95fd472` were read independently. The W10 code is not silently imported into W6.
- New pure `apps/me2-ui/src/lib/operator-observatory-resync.mjs` + focused tests drive all **seven** panels from one canonical `metaengine.operator.context.v1`. Strict monotonic contiguous cursor, exact run/Owner ID/Owner epoch/source SHA/proof fingerprint plus co-located fresh Source AND Continuity readbacks with the same run/Owner/source watermark, expiry and private-data redaction. Gap, rollback, equal-seq equivocation, Owner/source/run rollover => `RESYNC_REQUIRED` with no positive plane; missing authority-bound source evidence stays `UNKNOWN`. Expiry hides all positives while retaining last high-water across transport failure.
- Renderer navigation/UI only: explicit click initiates **one** trusted bridge `readContext()` and never grants reset by itself; a fresh owner/source/previous-cursor-bound read-only resync witness must accompany the same full canonical context. It is a future schema precondition, not a claim that a native witness exists. No arbitrary renderer fetch, token/localStorage, daemon health substitution, SQL, scheduler or effect channel.
- Focused validation: isolated authorized Windows temporary test directory only, Node 24.19.0, `node --test operator-observatory.test.mjs operator-observatory-resync.test.mjs` => **29/29 PASS**, 0 fail, 0 skip; source was copied from GitHub exact post-implementation blobs, not from installed Browser/Guardian/DevFleet. A path-scoped Ubuntu/Node24 free Actions workflow independently replays the tests. CI and TS/packaged UI results must be evaluated on exact final SHA; this checkpoint does NOT mean installed Owner/PG/native readback is attested.
- Current #1216 W3 unconnected readContext, and #1225 W10 confirms actual run identity lacks co-located 40-hex source SHA and 64-hex proof. Current P0 contexts also do not supply Owner epoch or `context.resync` bound reset proof. Thus installed UI must remain `UNKNOWN`; explicit reconciliation cannot succeed without a genuine trusted W3/W2/Source witness. No cloud/Supabase/hosted transport, installed software, live DB, or main changes.


### W43 one-source Client convergence checkpoint — 2026-10-15 (SOURCE CANDIDATE / DRAFT)

- Isolated full checkout `work/metaengine-client-wave8-w43-20261015`, source base #1266 W37; native Owner/Gateway/own-PG truth, W38 local-only contracts, W29/W23 seven-view UI, W39 completion evidence, W40 package closure, W42 independent critic, W41 BrowserCell observation, W26 ambiguous wake and W30 leased DAG claim path are combined by ancestry-preserving merge commits. #1216 and #1221 remain ancestors; all upstream PRs remain DRAFT. See `client-source-candidate-w43.manifest.json` for independently pinned nine PR heads and exact protected Git blob identities. The actual final review SHA is the GitHub PR head, not a self-referential source-file claim.
- Resolution of native/packaging overlap kept the stricter W38 missing-Owner and forged-READY restrictions, while preserving W40 positive attested-Owner regression fixtures as separate W40 source tests. W37+W39+W42 client-state test registry was unioned, not overwritten. W41 shares the real native `main.mjs` process with the W37 read-only context bridge; W30 reuses the existing leased executor.
- Acceptance remains REVIEW_REQUIRED. Hermetic tests, source blob identity and CI cannot prove installed Host/Guardian process incarnation, live own-PG grants and postmaster continuity, native signed receipts, package signature/version reservation, rollback or physical Windows installation. W46 owns package version; W43 does not reserve, publish, install or release a candidate. Absent authority stays UNKNOWN, unresolved effects AMBIGUOUS and never automatically retried; no Supabase or hosted fallback, additional executor or production database mutation is permitted.

**Disposition: BLOCKED; SOURCE critic DRAFT, not R1/C1/C2 acceptance.** This is an append-only checkpoint to the SINGLE living roadmap, fetched from branch work/roadmap-no-cloud-capsule-20261013 at cbb3d51ce0dae092fb8d4bb79905ea6560883e2d. W49 is isolated on work/metaengine-client-wave8-w49-20261015, based on W42 #1265 exact 37ce5d8407a1c1fa9702aa3aeb05133131f7a11a. No main merge, runtime/installed/PG mutation, Supabase/cloud, second scheduler or effect authority. No tracked AGENTS.md appeared in checked source.

**Exact ref readback:** main b26f2d4693e7bab3648e0930b7a9e2c75baef58e; integration/compute-unified-v1 a23b647220c6bdeaa4340f804575dc2009e434cb; Draft #1216 881eb2e29882419921978910ec6c3f184f197801; Draft #1221 85a11b2aa8777f5981a6cd5c4ed30de877417875. The living-roadmap branch is NOT main.

**W43 as observed locally:** work/metaengine-client-wave8-w43-20261015 HEAD 18fe7189bb66b2deb4fd0a3388cc862456d6a994; git merge-base --is-ancestor returned TRUE for all nine pinned parents below. But W43 was DIRTY: two modified native provider tests and untracked client-source-candidate-w43.manifest.json and client-source-candidate-w43.test.mjs. At inspection the W43 branch/PR was NOT present in GitHub readback and no exact-head integration CI existed. This is NOT a frozen or accepted candidate; re-read after W43 publishes its final source.

| PR | Re-read exact HEAD | Positive exact-head check(s) | Failed/missing release gates |
|---|---|---|---|
| #1248 W30 | ff9dab18d88a4d656fa91c5cc86f3392fde3f023 | Fleet DAG Claims success | Client State Runtime Contracts failed; Windows Package Smoke cancelled |
| #1257 W26 | 6498c1596432ea9d9987f343c92505b273d1ac11 | no green Client contracts in returned runs | Client State Runtime Contracts, Windows Package Smoke failed |
| #1262 W29 | 11c6f0e754d160f4d2c042da86c2cb88e4495298 | W29 UI, W23 TypeScript, Observatory resync passed | Windows Package Smoke failed |
| #1263 W39 | ee39b256e2b54f5dfddf4bff021977c0185fb744 | Bound Agent Completion Source passed | Client State Runtime Contracts, Windows Package Smoke failed; PR body cited older source SHA |
| #1264 W40 | ea1703cb6c4d0d15f1c7cd4cb4faf22ec2ac959d | W40 source and W24 provenance, Client contracts passed | Windows Package Smoke and Self Update E2E failed; no W46 distinct signed candidate |
| #1265 W42 | 37ce5d8407a1c1fa9702aa3aeb05133131f7a11a | Client State Runtime Contracts passed | Windows Package Smoke failed; critic never grants READY |
| #1266 W37 | 2557acd2ee11464c6f3f63b2e3b22bba74df142f | W37 context, W28 Gateway, W25 hermetic PG, W35 native tests passed | Client contracts, Windows Package Smoke, Self Update E2E failed; native Owner still unbound |
| #1267 W38 | 2e9018d14cfe55256ddc5a94693ff0a288b90318 | Client State Runtime Contracts/local fixes passed | Windows Package Smoke, Self Update E2E failed |
| #1268 W41 | 33f97db8d03fb57c4a78fa2e5abcb08509725551 | W41 BrowserCell source and some other source gates passed | Client State Runtime Contracts, Windows Package Smoke failed |

**Actual source falsification:** W42 operator-cross-plane-integration-critic.mjs derives the seven views from the real W6 reducer but its inputs are untrusted source shapes, not cryptographic Owner/PG proof. W37's source readme explicitly reports the native Owner adapter unwired and own-PG SQL injections hermetic. W40's closure function is SOURCE-only and performs no signing or installer execution. W39's fixed project snapshot uses SELECT FOR SHARE: do not wrongly require a READ ONLY PostgreSQL transaction for that particular fixed function. These concrete source constraints invalidate any claimed installed/LIVE acceptance.

**New W49 code:** infra/client-state-runtime/client-candidate-acceptance-w49.mjs and corresponding .test.mjs, registered in the existing client test script. Pure independent critic reuses the actual W42 reducer; exact parent SHA/branch re-read, one immutable candidate/head/tree, checks at ONE identical integrated SHA, generated-only PG17 owner ACL + concurrency/restart, unique signed EXE, owner-only archive/readback/pg_restore --list + actual disposable data-equal restore, rollback and native Agent-origin fences. No remote write, SQL/shell, scheduler, install or effect authority. SYNTHETIC and STAGING receipts cannot claim LIVE, even if verified=true is present; real provider proof remains UNKNOWN. It returns only BLOCKED or REVIEW_REQUIRED and explicitly marks canonical R1/C1/C2, installed and LIVE unproven.

**Windows Node v24.19.0 focused evidence:** W49 + W42 + cross-plane critic 84/84 PASS, after discovering and fixing the first W49 UNKNOWN/W42-missing fail-open test (initial 30/31 W49, then 31/31). This is SOURCE hermetic success only. No actual disposable PostgreSQL server, signed installer, archive restore, backup/rollback exercise or native LIVE run was executed by W49. W49 GitHub exact-head CI requires a fresh post-push readback.

| Evidence level | Current decision | Missing evidence |
|---|---|---|
| SOURCE | W49 tests pass; W43 includes nine ancestors but remains dirty | Clean immutable W43 SHA/tree, resolved assembly conflicts and independent critic readback |
| CI | Disparate parent green tests; several required checks FAIL | ONE frozen integrated W43/W46 SHA with Client contracts, ME2, Windows Package Smoke and Self Update checks green |
| STAGING | Only explicitly SYNTHETIC/STAGING shapes tested by W49 | Actual own-PG17 role/RLS/grants/concurrency/restart, backup/pg_restore data equality, rollback |
| INSTALLED | UNKNOWN | Exact signed EXE bytes/source/manifest, native Owner/Guardian/PG birth+epoch, no-hosted egress |
| LIVE | UNKNOWN / NOT ACCEPTED | Real native Provider/Agent origin, verified Owner lease/effect receipt, checkpoint/restart, independent critic |

### Ordered independent P0–P5 exit gates

1. **P0 Truth:** W44 native actual Owner/Host/Guardian getTrustedBinding; enforce PID+birth/run/epoch/SHA/cursor/proof identity through authenticated Gateway, explicit UNKNOWN on missing witness and no-cloud/no-egress negative checks.
2. **P1 Frozen source:** W43 clean tree/parent ledger, committed/pushed Draft PR; all tests on exact freeze SHA including Client State Runtime Contracts, ME2 and Windows Package Smoke; re-read branch after any drift. One existing executor only.
3. **P2 Own PG17 continuity:** W45 uniquely disposable real PG17 ACL/RLS/SELECT/EXECUTE and fixed-function transaction semantics, concurrent CAS, lost ACK, postmaster restart, event order, lease transfer, emergency stop and slot return; no installed PGDATA.
4. **P3 Productive loop:** W48 isolated temporary Git repo failing test to bounded source change to passing build/test to exact Git+artifact digests, independent critic and own-PG checkpoint/restart readback; preserve STAGING/SYNTHETIC origin until genuine native Agent proof.
5. **P4 Backup and package:** W47 owner-only custom archive from generated fixtures, digest, independent pg_restore --list AND actual disposable restore/data equality, ambiguous old request fenced, rollback preservation. W46 uniquely unreserved version, frozen exact source/lock/SHA/EXE and real Windows package CI; unsigned or reserved package blocks promotion.
6. **P5 Independent live acceptance:** verified physical Owner/Guardian/PG installed readback, signed binary, real native Agent origin, no unknown effects, actual rollback rehearsal and independent receipt/checkpoint validation. Only a separately authorized Host can install or promote; W49 never does.

**Independent W49 outcome: BLOCKED.** Parent branch ancestry, 84 hermetic tests and agent-slot counts are not substitutes for canonical C1/C2/R1, own PG17 and installed/LIVE evidence. Preserve AMBIGUOUS/no-retry and UNKNOWN when witness absent.


## W57 Wave 9 independent acceptance re-baseline — 2026-10-15 (SOURCE / CI / STAGING ONLY)

This section **supersedes the outdated W49 statement that W43 was dirty/unpublished**, but preserves that statement as a correctly dated historical observation. No competing roadmap was created. W57 runs from independent critic #1272, **not from the integrated W43 tree**; PR #1273 includes W43's own single-source roadmap checkpoint in its ancestry. Changes here do not import W43 implementation, grant acceptance, or constitute a W51/W54 final-candidate test.

**Current independent ref checks**: main `b26f2d4693e7bab3648e0930b7a9e2c75baef58e`; `integration/compute-unified-v1` `a23b647220c6bdeaa4340f804575dc2009e434cb`. W49 critic #1272 `241f1ed06dc6063e95806e6965c7a17a8bd91cfa`; frozen W43 #1273 `b24e240b3a273a9622a3983a1029faa53d6a6576`. GitHub comparison W49...W43 returns **DIVERGED**, common merge base `37ce5d8407a1c1fa9702aa3aeb05133131f7a11a`, 120 ahead/1 behind (relative W49→W43); W43 green does not automatically include the W49 independent critic. No `integration/client` branch resolved in branch search. Applicable root and `infra/client-state-runtime/AGENTS.md` were 404/not tracked at W49; do not infer instructions from non-existent files.

| Draft PR | Exact inspected head (2026-10-15) | Mandatory disposition |
|---|---|---|
| #1269 W45 | `8628b9dd35e1e918d045e45fd0b6d405d30786d8` | Real PG17 CI fails; inspect Host-cap predicate (below). |
| #1270 W46 | `8f2515719a009a0cec05fbbf84a6857ba1ece34a` | Frozen/reserved `0.7.0-dev.842024784850.1`; **NOT** a reusable version; no NSIS EXE/signed SLSA proof. |
| #1271 W47 | `f0935e0b5027304cdc2ba20d2cc58b14dfd67ab1` | Backup source tests != successful physical dump/restore and row/role equality for final candidate. |
| #1272 W49 | `241f1ed06dc6063e95806e6965c7a17a8bd91cfa` | Critic parent and historical living-roadmap checkpoint. |
| #1273 W43 | `b24e240b3a273a9622a3983a1029faa53d6a6576` | **FROZEN SOURCE; broad native/UI CI green**; Windows packaging/install still not qualified. |
| #1274 W48 | `67d67a0b7eca53d3a8bf42550affdd99404ccae7` | Disposable own-PG loop CI fails before test, checkout ownership. |
| #1275 W44 | `56ba9d7ebedd3805e778cbee4fdcb46ce07e574d` | Native context SOURCE integration only; real Owner/Guardian issuer and same-incarnation physical proof absent. |
| #1276 W50 | `adde7d726dd7272aaa84806add559aaaba371482` | Linux Git/source-sync green, **Windows real disposable worktree fails**. |

**Run/job evidence, not aggregate-green inference**:

- W43 frozen source `38647300436`: Windows job `116137229806` SUCCESS, Ubuntu `116137229954` SUCCESS, frozen ME2 job `116137229877` SUCCESS; W43 Client State Runtime Contracts `38647300484`: Windows `116137229797` SUCCESS, Linux `116137230198` SUCCESS, checkpoint-postgres `116137230093` SUCCESS; seven-view W23 UI `38647300202`/job `116137228675` SUCCESS. These checks are **all at W43 SHA**, proving useful SOURCE/CI convergence.
- That same W43 SHA **fails** Windows Package Smoke `38647300583`/job `116137737877` (duplicate physical build reservation refusal; SLSA job `116139048540` SKIPPED), Self Update E2E `38647300470` FAILURE and several broad Windows/legacy gates. Therefore W43 ≠ signed/installable package.
- W46 Windows Smoke `38647016017`/job `116136324941` FAILURE at R97 visual `ui1_admin_connection_masquerades_as_execution_ready`; SLSA `116137756197` SKIPPED. SelfUpdate `38647015839`/job `116136260716` FAILURE (contract tests; e.g. Invalid URL vs expected bounded native transport error and WAKE_AMBIGUOUS vs ACTIVE). No EXE digest/receipt was independently read.
- W45 real Linux disposable PG17 `38648123268`/job `116139963347` FAILURE: assertion **HOST 2-slot capacity is strict under concurrent claims**, observed `actual: 3`, `expected: 1`. The successful W26 CAS subtest **does not** qualify Host-cap. Windows PG qualification was explicit SKIP/UNKNOWN.
- W48 disposable PG17 `38647532328`/job `116138001129` FAILURE **before tests**, unprivileged postgres sees Git dubious ownership at `/__w/Compute/Compute`. Its Windows source job `116138000759` SUCCESS; restart/durable next-task checkpoint remains NOT PROVEN.
- W50 current source sync `38648999503`: Ubuntu job `116142863505` SUCCESS; Windows job `116142863934` FAILURE, actual `UNSYNCED` versus expected `SYNCED_SOURCE` in disposable actual Git worktree. Cached `origin` is not current GitHub head proof. W55 owns fix; do not relax dirty, stale, wrong-upstream, moved-head or path gates.
- W47 CI Client contracts `38647801119` FAILURE; package `38647801125` FAILURE. Local source backup tests and a generated custom-archive design do not establish verified final own-PG dump/restore, grants/data equality or rollback.
- W51 **no published PR/head observed yet**; W52–W56 **no published integrated successor pins established here**; W54 distinct signed package **NOT PRESENT**. Recheck actual PRs/ancestry and exact fresh CI when present; never adopt unrelated source greens.

| Level | Independent decision as of this checkpoint | Concrete exit evidence still required |
|---|---|---|
| **SOURCE** | W43 frozen/green for its own source; W49 and W45/W47/W48/W50 are separate DRAFT heads; final **single W51→W54 SHA UNKNOWN** | W51 manifest proving true ancestry or reviewed exact cherry-pick/blob ledger for all required changes (including W44/50 and W45/47/48); W54 one distinct package-source freeze and immutable current ref readback |
| **CI** | W43 combined Client/ME2/W23 source checks SUCCESS, Windows packaging/self-update FAIL; W45 PG/W48 PG/W50 Windows FAIL | Required tests and Windows NSIS/Self Update **all on the same final W54 source SHA**, with workflow+job IDs, artifact bytes/hash, no skipped mandatory gate |
| **STAGING** | W45 actual PostgreSQL Host-cap negative is RED; W48 PG restart fixture never ran; W47 restore equality not demonstrated; synthetic worker only | Disposable generated PG17 role/RLS/SELECT/EXECUTE, Host cap and concurrent CAS, stop/slot return, actual postmaster restart; separate generated `pg_dump -Fc`, digest, `pg_restore --list`, actual `pg_restore`, row+role/grant equality and rollback artifact equality; red→green serial Git edit, independent critic, **durable own-PG checkpoint and next-task lease** |
| **INSTALLED** | **UNKNOWN** | Physically read current signed EXE+SLSA manifest/bytes/source+version, native Host/Guardian/Owner and PG incarnation/grants/credential binding, no hosted fallback, rollback and no unknown effects |
| **LIVE** | **UNKNOWN / NOT ACCEPTED** | True native Agent issuer origin (not a UI boolean or synthetic worker), authenticated Owner scoped effect, independent critique, persisted checkpoint/restart and physical readback |

**Legacy hosted/Supabase CI disposition**: `.github/workflows/client-v1-supabase-edge-live-probe.yml` still contains literal external Supabase health/enrollment endpoints; W43's legacy `Client V1 Supabase Edge Live Probe` `38647300231` is FAILURE. Under this roadmap's own-PG-only directive it is **OBSOLETE/NOT_APPLICABLE to new installed acceptance**, not GREEN. Never request old hosted secrets, contact that service, delete mandatory security regressions, or count it as a passed own-PG test. Replacement qualification is own-disposable-PG17 transaction/grant/ACL/RLS/restart/effect-continuity + local signed Owner/Gateway/no-egress negatives; separately review and scope CI workflow applicability with a non-hosted implementation, retaining no-hosted-fallback tests. No production migration or real `PGDATA` access.

**W57 independent critic scope**: `infra/client-state-runtime/client-candidate-acceptance-w57.mjs` and its focused adversarial suite enforce a **single claimed final SHA** through parent ledger, same-SHA CI job readback, Windows/Linux source sync, Host cap/PG restart, actual dump/restore/data equality, independent staging serial critic/checkpoint, unique signed/SLSA installer and honest legacy-probe replacement. They deliberately label plausible inputs `CLAIM_CONSISTENT_NOT_ATTESTED`: no user-provided receipt, `verified:true`, model text or CI JSON can manufacture physical origin. W57 outputs at most `REVIEW_REQUIRED`, never READY, LIVE, can_install, can_merge, promotion/effect authority or automatic retry. W57 exact-head CI must be read from its PR after publication.

**Next gates (order):** W53 repair and re-run Host cap; W55 Windows real Git/source/provider; W56 disposable PG17 runner ownership then real serial restart/lease readback; W52 verified native context; W47 end-to-end actual generated backup/restore equality; W51 integrate complete source and repeat same-SHA contracts; W54 fix UI/installer SelfUpdate on **new** source version, then package/receipt; W57 re-read one final SHA and independently falsify all gates. Preserve `AMBIGUOUS` and no-retry. **C2 / R1 / C1 remain BLOCKED, physical installed/LIVE unproven.**


### W57 follow-up readback — 2026-10-15 / W54 first repair PR and W57 negative CI

- **New #1278 W54 first-cut SOURCE repair has published:** exact `81547445a6ea2fa4336847cbd05425106f123e84`, directly based on W43 `b24e240b3a273a9622a3983a1029faa53d6a6576`. Diff consists of the fail-closed top-bar/work-badge projection, offline local-only native endpoints contract negatives, source tests, scoped CI and parent ledger. This is **NOT** W51 integrated source, a frozen new package version or an installer; no W51 integration is visible in #1278 ancestry. W54 itself explicitly states that the source cut is partial and that old 60/5015 SelfUpdate failures, R97 physical screenshot and NSIS/SLSA are still open. At inspection W54-specific source CI `38660780143`, SelfUpdate `38660780026`, Windows Package Smoke `38660780137` were pending/in-progress; do not claim PASS. #1278 is not the final W54 artifact requested for package acceptance.
- **W57 independent critic CI caught a real fail-open bug** in the new reducer: first Ubuntu job `116181097189` of run `38660739099` executed **73 tests, 72 PASS / 1 FAIL**, with empty-evidence input incorrectly returning `REVIEW_REQUIRED`. Root cause: `UNKNOWN` was compared by **status value**, accidentally exempting all unknown gates instead of only installed/native categories. W57 patched its own source to gate on **name plus state**, and added primitive/null inputs as explicit negative tests. This is not a test relaxation. New W57 head after these changes was `ca992b1b8d62808e5fcb8ecccca802dc3bedcd9e`, exact-head workflow `38660807467` queued at that observation. Its final check remains independent; no PASS is inferred.


## W65 Wave 10 independent acceptance checkpoint — 2026-10-15 (DRAFT / BLOCKED)

**Historical checkpoints above remain date-stamped evidence, not current acceptance.** W57 #1277 `4759fc07bcd52de9ef255a7509db51b1c8a6d7d4` is this W65 branch's direct source base. One living roadmap path only. Independent re-read: main `b26f2d4693e7bab3648e0930b7a9e2c75baef58e`, integration/compute-unified-v1 `a23b647220c6bdeaa4340f804575dc2009e434cb`, W51 #1279 `42f81c858b9c18e163d2dfac6db79de076f5699d`. No tracked root/applicable `AGENTS.md` in this pinned full checkout. W65 #1289 has **no final W59→W62 exact source artifact at this checkpoint**. Source-review pins actually re-read: #1278 `415e4255e45aac2b78f092646190bef4418ac6d1`; #1280 `582b25b0e42480d648a9ede3abfbcc31633401ce`; #1281 `08f1192eb9e1a4dd1a060f11219ff2a75dd203db`; #1282 `b88f595192e5f40c7b462a85efe37ff441d5a52f`; #1283 W58 `41d755bb9ecd53bd509163f9219473c32d7439b6`; later #1284 W62 `6a0994953a58082865c6633a10acfc152105bd41`, #1285 W61 `bb6cd167321a3764d40f525f38cb079f5136f589`, #1286 W63 `3331c7433980ba45af07e575226d37c0332875c7`. Distinct branches/green checks are not a joined source ledger.

### Current raw GitHub CI/job readback (never inherit a parent green)

- W51 integrated `38663079067`: Windows Client contracts job `116188651160` SUCCESS; Ubuntu `116188651324` SUCCESS; checkpoint-postgres `116188651420` SUCCESS.
- **Same W51 source is NOT qualified:** integrated source workflow `38663078981` Windows `116188647803` FAILURE; frozen ME2 `116188647722` FAILURE; Ubuntu `116188647478` SUCCESS. Actual Windows Git/source-sync negative tests remain RED, and ME2 topbar types are incompatible. Separate W51 PG `38663079012`: Linux real PG17 job `116188648795` FAILURE; Windows unsupported job `116188648496` SUCCESS **only for UNKNOWN declaration** (not PG17 proof). These are not blanket GREEN.
- **W58 actual GitHub push** `38662323713` at `41d755bb9ecd53bd509163f9219473c32d7439b6`: native Windows ACL job `116186248131` FAILURE and Ubuntu `116186247852` SUCCESS (Ubuntu is explicitly unsupported for NTFS DACL). Original Windows step invoked Node fixtures under PowerShell 7 `pwsh`; child Windows PowerShell 5.1 `Get-Acl/Set-Acl` autoload returned `CouldNotAutoloadMatchingModule` for `Microsoft.PowerShell.Security`. This is **not** installed ACL evidence; W65's independent CI probes a native Windows PowerShell shell with exact historical W58 checkout, without modifying W58 production Host authority. This probe cannot replace absent W58 *current push AND PR exact-head* evidence.
- W58 upgrade/restore fixtures additionally FAIL multiple negative assertions with `actual: undefined` for `restore_verified` or archive verification. Suspected premature fail-closed path/realpath fixture incompatibility needs discriminating Windows reason/path readback; do not weaken archive path, reparse, Owner, TOCTOU, grants or restore negatives. W61 owns physical generated two-cluster data-equal restore; W65 owns independent qualification only.
- W56 #1280 staging real PG had `pg_ctl` lifecycle timeouts under PG17; W64 owns worker/admission and postmaster lifecycle. W63 owns actual Windows sync. W60 owns six native Host producers and Owner-backed root, W61 own-PG birth/cap/restore, W59 final integration, W62 final new package version/immutable Windows artifact. **None of their published parent results can be accepted as W59→W62 exact final SHA.**

| Acceptance layer | W65 independent disposition | Actual missing witness |
| --- | --- | --- |
| **SOURCE** | W51 contracts green on one SHA, other mandatory source gates RED; W65 independent test-only branch separate | One real W59 assembly plus W62 distinct source SHA, manifest/ancestry and exact current GitHub sync |
| **CI** | Windows W58 actual PUSH red; W51 Windows/ME2/PG red; W65 own exact-head CI independently required | Same final SHA **push and PR** Windows ACL + Ubuntu explicit-unknown job, source sync Windows, ME2, PG17, Windows PackageSmoke and SelfUpdate with terminal job IDs |
| **STAGING** | Missing authoritative Host-cap, real PG17 generated restore equality, C2 admission/checkpoint/restart | Two disposable PG17 clusters, real dump/list/restore/digests/row+grant equality, rollback, bounded synthetic C2 executor+critic/next-lease |
| **INSTALLED** | **UNKNOWN / BLOCKED** | Signed unique NSIS bytes and SLSA/provenance, six genuine Host/Guardian/Owner/PG producers, protected root, OS ACL, verified native process birth/signature |
| **LIVE** | **UNKNOWN / NOT ACCEPTED** | Physical installed Owner/Guardian and native Agent issuer, authenticated lease/effects, durable independent critic/checkpoint and live restart readback |

**New W65 falsifier:** `infra/client-state-runtime/client-candidate-acceptance-w65.mjs` with adversarial suite and own push/PR workflow. Untrusted snapshots must be `completed/success` with positive actual run+job IDs, consistent job run/head SHA, current exact GitHub ref and both **push AND pull_request** event evidence for Windows native ACL. Stale `QUEUED`, in-progress, skipped Windows, Ubuntu-only, parent-green, duplicate runs, moved HEAD, missing PG/ME2/package or forged installed/LIVE flags remain **BLOCKED**. Even a coherent synthetic fixture is only `REVIEW_REQUIRED / CLAIM_CONSISTENT_NOT_ATTESTED`, never authentic installed/physical/mergable/live proof. Do not turn user input or CI wrapper JSON into GitHub/Owner attestation.

### P0–P5 falsifiable exit order (Wave 10 update)
1. **P0 authentic Owner:** W60 six real producers via existing authenticated Host/Guardian protocol + W61 actual readOwnPostgresBirth; independent before/after PID+creationTime/Owner/epoch/signature/secret/root readback. Null-capable factory, forged boolean and Guardian-only liveness are NOT installed authority.
2. **P1 one final SOURCE:** W59 integrate exact published W57/W58/W60–W64 code and parent blob ledger; W62 distinct never-reused source/package lock; exact HEAD current GitHub clean source and Windows-managed worktree. No W46 version `0.7.0-dev.842024784850.1` reuse.
3. **P2 Windows ACL and generated PG:** Native Windows NTFS Owner-only root/archive readback with inheritance/broad principals/UNC/ADS/junction/reparse/TOCTOU negatives on **current final head** for both push and PR; two new generated PG17 clusters and real cap/concurrency/CAS/read-only vs FOR SHARE semantics, grants/RLS, full data-equal restore/rollback. Ubuntu unsupported ≠ Windows PASS.
4. **P3 C2 staging:** real authenticated goal admission through existing worker/W30 lease/W39 result+independent critic, red→green bounded Git edit, durable own-PG checkpoint, immediate physical restart and actual next-task lease; no fixture row treated as production lease.
5. **P4 unique Windows package:** one new immutable source-version/lock SHA, frozen ME2/R97 tests, actual NSIS EXE bytes/digest, signature and SLSA, successful same-final-SHA PackageSmoke/SelfUpdate/rollback, not skipped or ancestor-only green.
6. **P5 installed/LIVE independent acceptance:** verified physical native Host/Guardian/Owner/PG source+birth+lease and actual Agent origin; reconcile ambiguous effects without automatic retry; separate authorized installation required. Until all exits, **R1/C1/C2 SOURCE/STAGING are not installed/LIVE, C2 remains BLOCKED.** Hosted Supabase probes remain obsolete/not-applicable, **not green**, no hosted secrets or fallback. W53 and historical .59 AMBIGUOUS/UNKNOWN must not be replayed.


### W65 independent newer Wave10 ref qualification — 2026-10-15, later readback (still BLOCKED)

Newly published **DRAFT** #1287 W59 `8ec70b6fafb1689be0ba2075f0e54e6c505d5106` is a true descendant of W51 `42f81c858b9c18e163d2dfac6db79de076f5699d` (Git compare: AHEAD 44, BEHIND 0). W59's own source ledger reports actual two-parent inclusion of W57 `4759fc07...` and W58 `41d755bb...`, but **W60–W64 changes were not imported in its first published assembly**, full integrated source gates require current exact-head terminal CI, and package identity/version remains W62-owned. Independently compared #1287 W59 vs #1284 W62 `6d8e8edda321ffe185f4b613f9a787bc2294f8e8`: **DIVERGED** (W59→W62 ahead 2, behind 43, common ancestor `953e194c9f0235f191b23711a3ddf1b1978dccfc`). This is **NOT** one qualified final W59→W62 source SHA or same-SHA installer.

Further actual heads independently re-read at this checkpoint: #1285 W61 `7d246704509b1d99a788242c64a51e1c30454586` (claims generated typed JSONB Host-cap fixture + two-cluster restore, own-PG birth still depends on authentic Host), #1286 W63 `6a124ad0032a5beaa583de978d9bf37b4be35f34` (Windows Git fixture), #1288 W64 `a5f3cc47b3b32d52a52c73e281a72142587ad7af` (PG pipe/inheritance lifecycle corrected at a prior exact SHA, latest job queued), #1290 W60 `b4701788dd41273386b7593d26b13ee59ed2f9e4` (six read methods composition source; authentic Owner custody, Guardian issuer, release signer/secret and independent birth still fail CLOSED). W62's own PR says Windows Bun source typing CI SUCCESS at previous SHA but **57 SelfUpdate failures**, current physical R97/NSIS/SLSA and distinct package freeze are still blocked. These distinct PR heads/earlier greens **cannot be promoted as integrated final SHA evidence**. C2 STAGING/SYNTHETIC and genuine native installed Agent origin remain separate.

W65 local generated Windows regression reproduction at **pinned historical W58** `41d755bb9ecd53bd509163f9219473c32d7439b6` using native WindowsPowerShell 5.1 instead of the originally failing inherited `pwsh` context: **29 upgrade/restore tests: 28 PASS, 1 symlink-privilege SKIP, 0 FAIL**; **15 native ACL/Host IPC tests: 14 PASS, 1 symlink-privilege SKIP, 0 FAIL**. Independent W65 exact local current-source helper/falsifier: **36/36 PASS, 0 SKIP**. These reproduce a *Windows fixture environment* issue but are not GitHub push+PR terminal proof, no signed/installed Owner proof and no real PG17 restore. W65 current-head GitHub workflow `38668467063` with Windows native ACL job `116205721437`, Windows critic `116205721527`, Ubuntu critic `116205721193` was **QUEUED** at this observation; mandatory final decision remains **BLOCKED pending actual terminal exact-head push and PR receipts**, and run state must be re-read before promotion.


## ADF-1 current Windows CI and native readback follow-up — 2026-10-17

This is a continuation of the accepted Autonomous Development Fabric V1 ADR.
Current published source inspected: PR #1312,
`716f3b576b4643ff771912827df1a902a8865bf1`, directly above #1311.
These terminal receipts qualify only that SHA, never an untested successor.

| Exact-head CI | Terminal result | Scope |
| --- | --- | --- |
| [Package Smoke 39016558468](https://github.com/PatrickFrome/Compute/actions/runs/39016558468) | SUCCESS | Isolated Windows package/Owner fixture, not user installation or production signer |
| [Final Runtime Activation 39016558501](https://github.com/PatrickFrome/Compute/actions/runs/39016558501) | SUCCESS | Disposable own-PG17 Owner consumer |
| [Shell First 39016558515](https://github.com/PatrickFrome/Compute/actions/runs/39016558515) | SUCCESS | Isolated Owner/profile lifecycle |
| [W60 39016558503](https://github.com/PatrickFrome/Compute/actions/runs/39016558503) | FAILURE | Windows kernel probe timed out twice; Ubuntu source passed |
| [W67 39016558552](https://github.com/PatrickFrome/Compute/actions/runs/39016558552) | FAILURE | Same two Windows native probes |
| [Installed Chat 39016558522](https://github.com/PatrickFrome/Compute/actions/runs/39016558522) | FAILURE | Legacy hosted enrollment qualifier returned HTTP 402 |
| [Windows Soak 39016558480](https://github.com/PatrickFrome/Compute/actions/runs/39016558480) | FAILURE | Installed no-Owner consumer did not prove stable visible UI; seeded/source jobs passed |

W72 current native Windows ACL and R97 Visual are terminal SUCCESS at that SHA;
historical W58/W65 failures remain separate evidence, not a replacement for
current native gates. Full Self Update and integrated source are still RED.
The historical Installed Chat hosted route is obsolete for own-PG acceptance:
do not contact/retry it or request its secrets/payment. Replacement must retain
real installed Chat/preconnect/enrollment checks under existing local authority.

Follow-up SOURCE implementation, based on unpublished contract repair
`74b9e6cf907e51b69cc8ee2c9a27a4ae05505e41`:
- Fixed native read commands explicitly end their OWN child's stdin pipe.
  Existing pinned Windows executable/environment, 15s deadline, exact typed
  absence errors, source fences and fail-closed null semantics are unchanged.
- W60 physical failure diagnostics identify only fixed interpreter/read/result
  stages and error categories. Raw stdout/stderr, executable paths and credentials
  are never printed. A diagnostic read never replaces the original failed proof.
- The default execution regression and real disposable child/private HMAC IPC
  tests are registered in both existing W60/W67 CI workflows; no new scheduler.
- Local Windows W60/protocol/regression suite: 37/37 PASS. W67/W74/W75/W76
  custody/100ns/anti-forgery regressions: 21/21 PASS. Source syntax checks: 190 PASS.
  Local success does not establish the runner-specific cause or terminal CI repair.

ADF-1 / R1 / C1 / C2 remain BLOCKED for installed/live acceptance. Next: obtain
exact successor Windows W60/W67 terminal receipts; replace legacy Installed Chat
and no-Owner soak consumers using genuine disposable local Owner composition;
then qualify a distinct immutable package and one real Critic-verified coding
task with durable restart. No installed Browser/Guardian/PG mutation, effect
replay, production signing, package-version reuse or main merge is authorized
by these source receipts.
