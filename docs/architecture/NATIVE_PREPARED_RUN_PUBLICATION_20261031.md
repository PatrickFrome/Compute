# Native prepared-run and own-PG publication closure

Status: PARTIALLY IMPLEMENTED / DEFAULT EXECUTION GATE CLOSED / NOT INSTALL QUALIFIED.
Date: 2026-11-01.
Subordinate to `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md` and its existing audit closure register. This is not another scheduler, trust root, enrollment flow or release authority.

## Historical read-only compatibility correction — 2026-11-01

`017f4eb0` applied the installed execution path guard too broadly: retained
receipt reads and original execution history could fail when current CLI/Git,
canary or artifact changed. The correction keeps the existing producers and
wire selectors and separates those reads from new execution admission:

- A saved client goal refresh performs authenticated `READ_SEED` and project
  observation without calling or joining `onAdmitted`/execution mount. Explicit
  new submission and its immediate ACK readback retain that callback.
- Cold seed service discovery, `READ_SEED` and `LIST_SEEDS` read the original
  protected v1 profile/current device and canonical SQL receipts without
  image/tool preparation, creating an intent directory or writing another
  rejection file. New SEED still prepares current execution and rechecks the
  original request, device and active profile before any journal/SQL mutation.
- The existing protected receipt reader uses the original protected v1 operator
  and retained journal path, verifies state/journal/run physical identities,
  root/run/file ACLs and original receipt/result/launch/process integrity, then
  rechecks the descriptor and roots. It does not require current tools, Codex
  home, canary or execution layout and never moves/deletes/adopts the history.
- `READ_PRIOR_EXECUTION` reuses the own-PG registry/device/project authority in
  its original repeatable-read read-only transaction. It permits a finite
  expired original permit for history only, while still requiring the current
  unrevoked ADMIN grant/epoch/key/profile/scopes, project binding and actual
  cluster identity. Live admission/lease expiry rules remain unchanged.
- RESERVED/ATTEMPTED/AMBIGUOUS/FAILED stay HOLD before current physical reads.
  Completed original registration, scope, canonical receipt and job signature
  at its recorded instant are checked first. If current tools/artifact are
  unavailable, the response remains `HOLD/HISTORICAL_RESULT_RECORDED` with
  `receipt_sha256:null`, unchanged original execution and no capacity resolution,
  replay or new effect. A missing historical authority or corrupt signature
  cannot use that fallback as a trust upgrade. Existing full current physical
  verification can still produce its previous readback result.

Independent backup ACL/archive/upgrade verification stays callable before
migration without importing the execution/tool/canary/migration stack. Its
existing authenticity/Owner/restore checks and effect barrier are not weakened;
source tests do not claim an actual backup or automated migration ordering.
The v1 operator/bundle readers remain intact for recovery. No new mandatory
historical producer, renderer mode/path, bootstrap file or packaging schema is
introduced by this correction.

CLI/Git layout from `017f4eb0` is provisional. The package/bootstrap owners are
converging on the actual package/ASAR-bound `loadInstalledNativeTools()` producer;
this correction does not fix a final relative layout or alter a global verifier
schema. New fresh-install execution still requires its complete qualified
inventory and the existing native Owner/publication gates. GLM remains excluded.

The packaged-tools owner confirmed the complete payload's internal paths as
`git/ucrt64/bin/git.exe` and `codex/bin/codex.exe`; these trees must not be
flattened. The consumer API can remain
`loadInstalledNativeTools().paths.gitExecutable/codexExecutable`, while its exact
package root, pinned inventory/digest and ASAR binding require one agreed
producer/loader contract. Static PE/DLL dependency resolution is packaging
evidence only. Optional Git Credential Manager use requires its supported .NET
Framework 4.7.2 baseline; mandatory startup and real Windows execution remain
separate unqualified checks.

The worktree observer now removes external case-insensitive `GIT_*` overrides
before setting its own fixed `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=NUL`
on Windows (`/dev/null` for Linux tests), and `GIT_TERMINAL_PROMPT=0`.
It therefore cannot re-enable another installation's Git config through the
sanitizer. This does not qualify inherited PATH or optional credential helpers.

Current Linux/Node 24.19.0 verification: Browser/Codex/goal/controller selection
1,288 PASS / 24 SKIP / 0 FAIL; Host/native plus backup/bundle/upgrade selection
468 PASS / 27 SKIP / 0 FAIL; source checks 276 PASS. Causal red-to-green tests
cover retained receipt and goal/seed reads without current tools, changed image,
preserved UNKNOWN, original signature rejection, Git configuration isolation,
abort during the original SQL read and between seed directory/ACL phases.
Original request/close checks occur after those awaits before starting the next
phase. Generated authority/ACL/SQL observations and real local filesystem/IPC
checks do not qualify Windows, new disposable PG17, actual installed backup or
backup-before-migration ordering, hosted CI or clean-machine installation.

## Mandatory clean-machine acceptance — 2026-11-01

The installer must deploy a self-contained METAENGINE on a demonstrably clean
Windows machine. Existing user PostgreSQL/Guardian/services, machine PATH
Node/Git/Codex/runtime tools and a previous userData/profile are not prerequisites
or clean-install evidence. Existing unrelated installations must not be modified.
The installer owns its paths, service identities, ports, payload verification,
protected configuration, own PostgreSQL17 roles/schema/migrations or validated
restore, authenticated enrollment, component binding, health and rollback.
External GPT/Codex login and Windows UAC remain legitimate user steps; failed
login cannot be labelled successful automatic authorization. GLM is excluded.

Main and Host now consume the same `validateNativeCodingInstalledPathScope`
refusal boundary for the existing v1 protected operator descriptor. CLI/Git must
be strict descendants of `resources/client-state-runtime`; codex_home,
journal/temp/result roots and role/provider canary receipt paths must be strict
descendants of that owned Host's private state directory. Installed resources
and mutable state roots must not overlap. Main checks before creating the
execution capability or preparing the workspace; Host checks each fresh
execution descriptor, including live publication's final callback read. The
historical readers above use the original protected scope independently.
Missing/external execution paths
remain HOLD, with the fixed Main diagnostic
`INSTALLED_DEPENDENCY_SCOPE_UNBOUND`. No PATH search, adoption or auto-relocation
occurs. Existing retained receipts are not rewritten to fit new roots.

The native PG observation also requires the actual postmaster executable path
to equal `client-state-runtime/runtime/postgresql/bin/postgres.exe` for that
Host's configured bundle, alongside its existing PG17/system identifier/own
data directory/port/process-birth checks. A same-name preinstalled postgres.exe
serving the correct generated own-cluster fixture was previously accepted;
the added negative now rejects it before downstream native scope work.

This check proves placement syntax only. Physical identity, reparse/hardlink
refusal, installed inventory hashes, payload role/version, protected ACLs,
current PG/native Owner incarnation and release/loaded-code proof remain the
existing producers' responsibility. It does not publish readiness or open the
default execution gate.

Required producer contracts and remaining implementation work:

- **Installer/package inventory:** agree the existing package/bootstrap owners'
  pinned tools inventory/loader with the original runtime bundle and release
  bindings. The original `offline-runtime-bundle.mjs` `selectedFile` allowlist
  accepts source/Node/Deno/PostgreSQL/cache/license material; merely copying
  Git/Codex beneath its root will be refused. The earlier placement boundary
  must consume the final authentic package root without flattening the confirmed
  inner paths. Payload component/role, digest, version, license, dependencies
  and ASAR/release bindings require qualification. Guardian stays in its
  existing verified installer-owned native payload and lifecycle. No packaging
  schema or bootstrap file is changed by this historical correction.
- **Materializer/startup ordering:** produce the protected v1 operator and
  private mutable directories as part of authenticated installer onboarding.
  `runtime-host.mjs` selects full native authority only when the operator exists
  at Host startup. Publish before that startup, or use the existing controlled
  stop/drain/restart and bind a new exact incarnation after materialization.
  Repeated Main mount attempts alone do not change an already-started Host's
  authority. Never adopt a previous profile to hide a failed cold start.
- **Policy/runtime environment:** derive helper lookup from verified installed
  payloads plus explicitly required Windows OS facilities. Current
  `codexCliEnvironment`, observer Git and Host launch still inherit PATH; that
  is an open producer/consumer integration blocker. Probe and actual run must
  consume the same deterministic environment contract. A passing test with
  hosted-runner tools must not qualify a clean machine.
- **Real acceptance:** record absence of METAENGINE service/config/data before
  installation and prove that no preinstalled development tools satisfy
  dependencies. Test installed-owned services, ports and postmaster/native
  identities; empty-profile login and authenticated enrollment; health;
  rollback/failure preservation; and GPT/Codex goal → worker → independent
  critic → durable checkpoint. Packaging/unit proofs are separate from actual
  clean-Windows installation proof.

All changes here are source/staging only. No credentials, services, OS policy,
existing user PostgreSQL/Guardian or real installed profiles were changed.
Actual installation/service/credential effects require concrete action-time
approval and the existing trust chain; this document creates no new root.

Linux source verification for this update: related Browser/Codex/Main selections
report 1,255 PASS / 24 SKIP / zero failures; the Host selection reports
381 PASS / 27 SKIP / zero failures. Source checks report 276 PASS. The real
clean-Windows installation and unavailable disposable-PG/Windows cases are
not qualified by these generated placement/process fixtures.

## Production composition source update — 2026-11-01

Based on `0e43a569ad52134bee65dea3182ee9a4c4bbc56f` (tree
`897948a6e65c980f560f97b71abaca96c91e4069`). Main now supplies the existing
direct `createLoadedNativeRunOwnerCallback` to the default runtime. The callback
captures the original mount barrier, Host and enrolled identity; every original
RESERVE/PUBLISH/AGENT cycle still performs fresh W74/W68/kernel reads on its
passed transaction. The standalone `readRunOwner` remains a separate diagnostic
and is never called recursively from publication.

The runtime now composes `createNativeCodingPreparedCustodyAdapter` by default.
The production bridge consumes its single-use `takePreparedCustody` closure and
uses that exact original facet. A failed/malformed handoff cannot reclaim a new
journal through `openAgentRunCustody`. Revocation, late callbacks and failed
cleanup remain owned through the existing runtime/adapter drain.

This is source wiring, not native producer evidence or installed readiness.
`requireNativeRunCallbackPublication` still refuses every default provider or
execution admission before preparation, reservation, broker or worker effects.
Direct null/SOURCE_ONLY observations cannot open that gate. Generated lifecycle
and actual IPC fixtures verify the wiring, not loaded Windows code, native trust
or PostgreSQL durability. Qualification still requires the producers below.

Producer/consumer contracts for the parallel work:

- Native Guardian/custody must extend the existing W74/W68/private lifetime
  producers and their original-phase verification. The consumer is Main's direct
  transaction callback; a public JSON `verified` field or a replayed seal is not
  its replacement. Current SOURCE_ONLY schemas deliberately cannot authorize
  loaded-code execution; producer and validators require coordinated review.
- Publication qualification must establish the existing own-PG initial anchor,
  per-intent fence, bound database incarnation and storage settings before
  changing the closed gate. File fsync or a directory/descriptor alone does not
  qualify it. Retain HOLD on missing/unknown history.
- Materialization must produce the existing protected operator paths, permits
  and sandbox pins before mount; it cannot select an alternate custody path.
  Probe/run policy equality remains the policy producer's responsibility.
- Historical settlement consumes original persisted receipts and physical
  custody. Runtime drain/local callback join does not release unknown capacity,
  authorize replay or turn history into a new prepared handle.

Acceptance is GPT/Codex. GLM is excluded from current requirements and blockers
by the user's 2026-11-01 instruction; no legacy routing cleanup is implied.

Validation of this update on Linux/Node 24.19.0: the related Browser/Codex
selection reports 1,156 PASS, 24 SKIP, zero failures; the Host native-coding
selection reports 373 PASS, 27 SKIP, zero failures. Source checks report
`source_checks_passed:276`; syntax and whitespace checks pass. Regression tests
first reproduced the absent default claim/direct Main callback and ignored
prepared bridge handoff. Missing ASAR dependencies were installed from the
existing lockfile with scripts disabled, then its packaged-source test passed.
Windows and disposable PG17 cases are among the skipped tests: no Windows,
new real-PG, installer or loaded-code qualification is claimed by these runs.

## Historical source checkpoint — 2026-10-31 15:25 UTC

Source `55cb3b34d92e7e992f33b6ee9e9478825fc4afd9` adds the private prepared
runtime adapter and registers both SQL protections through the existing atomic
upgrade pipeline. Joined actual AgentTools effects, original transaction
cancellation, mandatory inert anchors, retained task identity, authenticated API
ACL compatibility and canonical pre-provision OWNER_ONLY setup are now tested.
The six integrated real-PG suites passed 211/211 on Linux and 211/211 on Windows.
The existing canonical
exporter independently restores the new empty schema and verifies catalogue/ACL
equality plus the NEW-onboarding SQL sequence and SCRAM reconnect.

Default Main/Host mounting is still closed. Presence-only migration inventory
cannot serve as installed-schema attestation; a read-only installed-only check
must be bound to the actual private PG incarnation. Existing release/Owner
proofs, physical worker continuity and installed acceptance remain required.
See the [checkpoint review](../../evidence/public/prepared-run-composition-20261031/REVIEW.md)
for exact scopes, older Windows results and the Linux socket restriction.

## Historical source checkpoint — 2026-10-31 07:28 UTC

Functional source `fc216b1d40593f5bc8638d3a64de640cb3682bf6` implements the inert
claim, original reservation/publication composition, private settlement-gated
custody promotion and PUBLISH/AGENT Owner phase routing. Agent effects and final
Owner recheck share the actual monitored transaction; phase failure invalidates
the original request before its COMMIT guard. Windows focused selections passed
111/111 real-PG and 253/253 component tests on an identical committed tree.

See the [exact checkpoint review](../../evidence/public/prepared-run-composition-20261031/REVIEW.md).
Joined actual AgentTools composition proof, default Main/runtime wiring and the
durable pre-effect/cross-generation fences remain required. Default execution is
still closed. The earlier checkpoints below are retained as history, not current
publication or readiness claims.

## Historical reproducible baseline

- Public Draft #1392 source: `c434cb3cad724abded54f2ff4569d5382440d823`.
- Cancellation repair: `035d3f66acb72d05c57c1656621a8e2d6cf1adac` (local, not published at this checkpoint).
- Its tree `370f37c8af86b595c9d523cc4511325f4da22dcc` was tested on Windows as `216dd8ccd0d53284f595da92357746a6f1ad05e1`: 88 passed, zero failures/skips, including real disposable PostgreSQL 17.
- Linux publication/lifetime/real-PG selection: 76 passed; related Host/Owner selection: 66; workflow registration: 18. These selections overlap and are not a single total.
- Full earlier matching Browser code on Windows: 7,464 passed, 25 skipped. This does not qualify later edits or an installer.
- Current-source GitHub run 41166546082: Ubuntu and ME2 succeeded; Windows cancelled while running the Browser suite. Cancellation is not a pass. Cause and hanging-test evidence are under investigation.

## Implementation readback — 2026-10-31 05:18 UTC

Steps 1–2 are now used by the existing executor/runtime wrapper, not a separate executor. Step 5 has bounded 6/6/3 phase contracts and actual original RESERVE transport; PUBLISH/AGENT composition remains pending. The direct Main callback reuses existing W74/W68/kernel custody without nested IPC. Later steps, initial publication and inert BOUND handoff remain open.

Final functional tree `c93cbefc524f2153c0083f37a67c1626a31f0c10` has 325 affected Windows tests passing (one platform skip), 318 affected Linux tests passing (seven platform skips). These do not qualify a full suite or installer. See the [source review](../../evidence/public/prepared-run-owner-20261031/REVIEW.md) for exact checkpoints, earlier failed evidence and remaining gates.

## The actual ordering defect

The lease executor currently reserves before the runner creates its immutable attempt and callback HEADER. Initial callback publication requires those bytes, a BOUND journal and the original in-memory RESERVED object within the original physical RESERVE request. Returning RESERVE first loses that request's lifetime. Reopening another ticket or reconstructing its JSON cannot restore custody.

The standalone Owner reader is single-use. Publication takes six fresh snapshots across its write transaction and separate committed readback. Calling the standalone IPC read from inside the original callback can wait on its own undrained physical request. The fix is an additive transaction-bound repeatable read facet, not a second nested request.

## Ordered implementation

1. **Inert preparation in the existing runner.** Validate the original lease, executable, worktree and critic policy; create the exclusive attempt directory and HEADER. Return a private instance-owned, single-use handle and a read-only descriptor. No model call, broker, child process or W30 write. Clone caller input. Existing prior/EEXIST evidence stays readback-only.
2. **Revalidate before consuming preparation.** Reject JSON/foreign/reused/fenced handles and concurrent consumption. Recheck cancellation, the original expiry ceiling, physical paths and immutable attempt bytes. Abandon fences the handle without deleting evidence. Preserve one implementation for `run()` and `runPrepared()`.
3. **Bind the journal without enabling dispatch.** Claim the existing single writer and produce BOUND independently of the dispatch-capable bridge. A descriptor, path or boolean must not become an execution capability.
4. **Keep initial publication inside actual RESERVE.** After its existing COMMIT, retain the exact returned RESERVED object, publish initial root and independently read committed bytes before the same request returns. Lost COMMIT/ACK is UNKNOWN; no repeat reserve or worker launch.
5. **Fresh Owner reads on the original physical ticket.** Bind every read to actual action, request ID and digest, Host instance/PID, original deadline and bounded monotonically increasing read cycle. Fixed budgets: RESERVE six; publication six; effect recheck three. One active cycle at a time. Reuse the existing W74/W68/kernel readers and passed SQL transaction. Do not invent body hashes for actions that have no signed body, refresh the sealed Owner timestamp, or use nested IPC/global drain.
6. **Promote only after matching response and physical settlement.** Retain custody privately. The Main client may consume it only after both are confirmed. Preserve suspended-worker order: ATTEMPTED COMMIT, W30 RUNNING acknowledgement, bridge bind, then resume.
7. **Require the durable root before effects.** Existing SQL permits absent publication on both sides of an execution transition; that is insufficient for this mode. Enforce the exact initial anchor before job/ATTEMPTED and per-intent publish/readback/handoff before each callback effect.
8. **Fence prior generations durably.** An unresolved native execution must block a fresh generation/run for the same task, for IMPLEMENTER and CRITIC. Per-run callback deduplication and the IMPLEMENTER worktree fence alone do not establish this property. Keep the rule in existing authoritative claim/reserve paths.

## Durability contract: fail-stop, not reconstructed history

An own-PG durable execution/intent fence may replace the requirement for literal Windows directory-entry durability for the narrow no-replay property. It does **not** prove that directory entries survive power loss. Preserve `DIRECTORY_DURABILITY_UNQUALIFIED` and state that losing local evidence causes HOLD.

Required PG conditions include the real database identity and storage, `fsync=on`, `full_page_writes=on` and synchronous commit of the actual fence. No silent reset, old-snapshot promotion or new empty database may erase uncertainty about effects. PG does not replace physical worker custody, watchdog, Owner/source proof or release signing.

A latest cursor/hash commits to a prefix but cannot reconstruct all lost intents. Until durable per-intent/outcome history exists, directory loss cannot become UNSENT, full cleanup, released capacity or replay permission. Existing unknown worker effects retain their physical custody and require reconciliation.

## Mandatory negative and end-to-end evidence

- Delete the callback directory before reserve, after initial COMMIT, before ATTEMPTED, after ATTEMPTED/before resume, after resume, before/after each intent and after effect COMMIT/before ACK. Assert no duplicate spawn, resume or effect.
- Repeat with restarted Main/Host and same PG; same and new generations/run IDs; IMPLEMENTER and CRITIC; two competing Hosts; copied/foreign/recreated prefixes.
- Lose write/readback/settlement ACKs independently. No opaque-handle recreation or successful retry after UNKNOWN.
- Change Owner/control/permit/Host/PG identity during every read cycle. Abort while native work remains pending; await the original work without freeing its physical slot.
- Verify bounded cycles, sequence replay, foreign frames, concurrent cycles, stale request deadlines, callback drain and fresh original SQL transaction custody.
- Run actual Windows and disposable PG17 integration, then the full suite on the final source. Generated contract fixtures alone do not qualify the default composition.

## Installer gates remain separate

First-run materialization and CLI/home/auth selection; probe/run policy equivalence; historical settlement; existing protected release signer and sidecar placement; a new unique package identity; clean install and upgrade with retained own-PG data; restart/backup/restore/rollback; real goal → worker → independent critic → durable checkpoint → next task using GPT/Codex. GLM is excluded from current acceptance. The minimal UI must explain setup, READY/RUNNING/HOLD and recovery truthfully. Cosmetic expansion waits until this path works.

No stage in this document changes the default gate to ready or claims an installer was built, signed or installed.
