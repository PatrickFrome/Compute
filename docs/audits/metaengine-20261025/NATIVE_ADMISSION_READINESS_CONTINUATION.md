# Native admission readiness: continuation after installed 4594

Date: 2026-10-25. Branch: `work/native-admission-readiness-20261025`.

Canonical milestone: **C2 — First Serial Coding Loop**, with **R1** lifecycle and
readback requirements. This increment repairs the route from an explicit user
goal to existing native Host admission. Installed cooperative autonomy still
requires the physical run described in `AUTONOMY_ACCEPTANCE.md`.

The subsequent terminal CI analysis and cold native startup repair are tracked
in `NATIVE_COLD_START_QUALIFICATION.md`. The validation below records this
preceding admission increment; later source commits need their own qualification.

## Verified starting point

- Frozen QA candidate `.4594`: `602d4b07f755f7cd61a6da3af06985d4384b859a`,
  draft [PR #1345](https://github.com/PatrickFrome/Compute/pull/1345).
- Existing published follow-up included by ancestry:
  `1871a23950b2b532a7e28d75d3faa92506bfa739`,
  `work/agent-count-fixture-followup-20261025`. Its five fixes are retained.
- Live GitHub read of the frozen SHA: 80 checks, 62 success, 16 failure,
  two skipped. A produced artifact therefore does not establish complete
  candidate qualification.
- [Package Smoke 40208669264](https://github.com/PatrickFrome/Compute/actions/runs/40208669264)
  uploaded the candidate and subsequently failed at
  `Prove real installed Owner-backed UI on disposable attached PG17`;
  the SLSA verification job was skipped.
- The supplied Windows journal ends with the `.4594` window open, a goal entered,
  `Native admission on hold`, and a separate old Supervisor recovery warning.
  It contains no successful dispatch or model execution receipt for that goal.
- The connected Windows device was listed online, but the read-only Desktop
  Commander source/status request ended with `MCP request timed out`. Current
  Windows HEAD, dirty files, running processes and installed admission cause
  could not be independently re-read during this increment.

## Findings and repairs

| Finding | Repair and evidence boundary |
| --- | --- |
| Runtime observation ticks cancelled a slower goal-mode response while an in-flight flag suppressed its replacement. Cached HOLD could persist after recovery. | A readonly observer coalesces ticks, orders explicit reads, fences unmount/remount and replaces failed reads with HOLD. Behavioral tests exercise delayed promises and actual shipped submit callback. |
| The Browser submit path could finish its readiness read after the composer was unmounted and still send the goal. | The final effect checks both mounted state and the submission lifecycle sequence. Navigation, remount and concurrent-click tests execute the actual TSX callback via TypeScript AST extraction. |
| Optional seed operations were selected only at Host startup. A later protected seed-profile publication could leave the routes permanently unavailable for that Host. | An optional binding retains eager preparation and allows later LIST_SEEDS/READ_SEED discovery to prepare the service. Concurrent preparations join; SEED_GOAL never boots an unavailable service. Protected pins and existing signature/ADMIN/freshness checks still apply. |
| Late optional service creation could outlive terminal cleanup. | Host setup checks terminal state around asynchronous acquisition and releases capabilities that were never transferred to the canonical authority. Pending initialization and late replies are fenced. |
| A syntactically valid request for an unmounted optional IPC action was silently discarded, producing a 30-second discovery timeout and potentially UNKNOWN for an unattempted write. | The exact private channel returns a correlated REJECTED/UNSUPPORTED_ACTION before dispatch. Foreign and malformed frames remain rejected. A reused UUID belonging to an outstanding write retains UNKNOWN even when the colliding request is readonly. |
| All native mode failures collapsed into a generic label. | Bounded transport reasons distinguish unavailable capability, timeout, lost Host and failed verification. Raw error messages, paths, SQL and credentials are excluded. Check admission performs no goal submission or recovery mutation. |
| The generated schema fixture used pg_dump --no-acl, discarding reviewed function privileges before attached onboarding. | The schema-only dump preserves ACLs. Tests check the Cognitive RPC privileges before export and after restore, and exercise the unchanged production PUBLIC-EXECUTE rejection inside a rolled-back transaction. |
| Attached onboarding still expected 50 RPC names; native scope discovery expected a pre-pagination argument list. | Expected RPC count follows the current 52-entry allowlist. Scope tests cover 65 permits over 32/32/1 pages, the empty tail, scope binding and invalid selectors before SQL. |

The late-profile lifecycle defect is established in source and focused tests.
Its responsibility for the user's particular installed HOLD remains a hypothesis
until the Windows failure reason is read from that running instance.

## Validation

Validated on Linux with Node **24.22.1**, frozen UI dependencies installed by
Bun **1.3.3**, TypeScript **5.9.3**, and runtime `postgres` **3.4.7**.

- Final combined focused suite: **258 tests; 256 pass, zero fail, two skipped**.
  It covers actual child-process IPC, seed binding, signed requests, Host lifecycle,
  package source closure, prior scope/capacity repairs, migration/onboarding
  contracts, the readonly observer and the actual GoalComposer submit callback.
- The two skips require Windows credential/DACL behavior; they are not passed
  Windows checks.
- Full strict UI `tsc --noEmit --incremental false`: **PASS**.
- Normal registered Browser source checks: **239 PASS**.
- `git diff --check`: **PASS**.
- Existing migration integration on an actual disposable PostgreSQL **17.6**:
  **1 PASS, zero skips**; 19 migration groups, repeated application, SCRAM direct
  API and negative privilege/body/trigger controls. Other RPC bodies in this
  fixture remain explicitly synthetic.
- Physical two-cluster PostgreSQL **17.6** schema/ACL roundtrip: **PASS**.
  The actual Cognitive SQL functions restored under a different owner without requiring the original owner in the
  target cluster, with PUBLIC/anon/authenticated execution denied and
  service_role execution retained. The unchanged production guard accepted that
  restore. The same schema dumped with `--no-acl` restored PUBLIC execution and
  was rejected with `cognitive_direct_api_public_execution_requires_review`.
  Both disposable servers stopped and their ports closed after the experiment.
- Source and test file digests, commands and results are recorded in
  `evidence/audits/metaengine-20261025-native-admission/verification.json`.

Initial sandbox subprocess restrictions produced EPERM and incomplete nested
test output. Accepted counts above come from approved runs with functioning
child processes and loopback sockets; the restrictive runs are not counted.

Physical PostgreSQL schema/ACL roundtrip verification is recorded separately in
`pg17-acl-roundtrip.json`. The original source owner was absent from the target
cluster; no production roles or databases were used. The full attached installer
test still requires Windows and the exact newly built package.

## First remote CI and current source seal

Draft [PR #1347](https://github.com/PatrickFrome/Compute/pull/1347) contains the
functional repair commit `cff3496e8510223f0b98d585a83bfc42d9f63c8d`. Its full ME2
TypeScript/package workflow and checkpoint-PostgreSQL job passed. The first
[Ubuntu Current Source job](https://github.com/PatrickFrome/Compute/actions/runs/40215080496/job/121234361318)
stopped before the full suites because the current source manifest retained 14
older blob IDs, including two inherited from the fixture follow-up.

The follow-up updates only `current_tree_blobs`: 14 reviewed existing entries
and ten additional reviewed files, for **571 sealed paths**. Every other manifest
field, historical ledger, package transition, version and qualification flag is
unchanged. The source-seal assertions are unchanged. The complete ten-file
historical/current source CI preflight now passes **124/124**, without skips,
using the real Git ancestry. Details and full output are in
`source-seal-refresh.json` and `source-seal-regressions.txt` beside the other
verification receipts. New-HEAD CI remains a separate qualification gate.

## Remaining acceptance gates

1. Read the running Windows client/Host generation, native admission reason and
   original unknown Supervisor wake. Preserve its durable correlation records.
2. Qualify this source on Windows, including cold controller startup, capture,
   credential ACLs and attached onboarding with the preserved-ACL fixture.
3. Reserve a new unique package version for the accepted source, build through
   the normal producer and verify the resulting artifact. `.4594` remains frozen;
   this source branch does not reserve or reuse that version for a physical build.
4. Run the explicit JSONL-ledger task through the installed UI and observe actual
   worker execution, independent Critic acceptance, own-PG checkpoint/Git commit,
   peer communication, child admission and a subsequent continuation cycle.
5. Exercise controlled client restart and verify readback without replaying an
   uncertain earlier effect.

The main native operator descriptor must already have been present when its
Host started. Loading that entire native root after startup remains outside this
seed-only repair; the existing controlled Host restart is required in that case.
This increment does not install a client, change the user's PostgreSQL, merge
main, or establish production release or unlimited physical-concurrency proof.
