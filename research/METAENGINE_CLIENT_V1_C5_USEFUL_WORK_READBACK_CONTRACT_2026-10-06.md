# METAENGINE Client V1 C5 — Signed Useful-Work Readback Contract Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY / SOURCE CONTRACT ONLY**  
Branch: `work/client-v1-c5-useful-work-readback-contract-v1`  
Qualified implementation head before this report: `412cff6caab21106c704e321bf6ef1596fbd1350`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

Canonical C2 still requires a real end-to-end:

`repo checkout → isolated edit → real build/test → verified artifact → serial loop end-to-end`.

This checkpoint does not prove that event and does not bypass:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

Client-specific sequencing now is:

1. C4 Agent-origin proof contract exists.
2. C5 useful-work proof contract exists.
3. C5 reference repo/edit/test/artifact mechanics were exercised as SYNTHETIC.
4. C5 useful-work proof survives restart fail-closed.
5. C5 durable evidence is projected read-only in the product.
6. This checkpoint defines the future signed server/native **read path** for trusted useful-work evidence.
7. A trusted verifier **writer/ingest** path, actual migration, deployment and live Agent execution remain separate authority boundaries.

Client C5 LIVE useful work remains **NOT_PROVEN**.

## Scope

This slice defines a source-only readback contract across three existing trust zones:

`service-role-only Postgres RPC → device-authenticated Edge route → signed Native Client read method`.

It deliberately does **not** connect that readback to `main.mjs`.

It deliberately does **not** add:

- a migration;
- a Supabase function deployment;
- an Edge deployment;
- a trusted verifier event writer;
- a live route call;
- a live Client goal;
- a provider effect;
- roadmap promotion.

The whole branch diff from product-projection base
`12020209e0cb1d1b8fd50438e1f1acef0aaac6ba`
contains only:

- `.github/workflows/client-v1-c5-useful-work-readback-contract.yml`
- `apps/metaengine-browser/src/native-supervisor-client-base.mjs`
- `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/meta-routes.mjs`
- `apps/metaengine-browser/supabase/client-v1-c5-useful-work-readback-v1.sql`
- `apps/metaengine-browser/test/client-v1-c5-useful-work-readback-contract.test.mjs`

No file under:

- `supabase/migrations`
- `supabase/functions`
- `infra`

was changed by this slice.

## Supabase research and current platform constraint

The Supabase skill was read before implementation.

The current Supabase Data API security guidance states that database grants determine which roles can call functions through the Data API, and explicitly recommends minimum grants. For functions, access is controlled with `EXECUTE`; RLS does not protect function invocation itself.

Supabase also warns that `SECURITY DEFINER` functions run with the privileges of their owner and should not remain callable by broad roles unless that exposure is intentional.

Sources:

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0028_anon_security_definer_function_executable

Supabase is also moving new database objects toward explicit Data API grants rather than broad automatic exposure.

Applied decision:

The future readback function is explicitly:

- `SECURITY DEFINER`;
- read-only;
- revoked from `public`;
- revoked from `anon`;
- revoked from `authenticated`;
- executable only by `service_role`.

The device never receives the service-role credential. The existing Native Supervisor Edge uses its server-side service identity to call PostgREST RPC after device authentication.

## Critical trust finding: Agent result is not independent verification

The existing Client execution proof validates the Agent-origin result claim in:

`devos_fleet_task_h205f22.result_summary`.

That result is sufficient for:

- exact Agent-origin correlation;
- result digest validation;
- typed result claim;
- conversation-origin binding.

It is **not** sufficient to prove independent useful-work verification.

If C5 accepted fields such as:

- `artifact_verified`;
- `provenance_verified`;
- `independent_verifier`;
- `accepted`

directly from Agent/model-authored `result_summary`, the producer of the candidate would be able to author its own acceptance evidence.

Decision:

C5 acceptance is never read from the Agent result JSON.

A future trusted server verifier must emit a separate durable event:

`TASK_USEFUL_WORK_VERIFIED`

with:

- event authority effect false;
- proof contract `METAENGINE_USEFUL_WORK_VERIFIED_V1`;
- verifier origin `TRUSTED_SERVER_VERIFIER`;
- exact task/lease/baseline binding;
- exact result digest;
- exact result-claim digest;
- exact Agent-origin conversation digest;
- digest-only repo/edit/test/artifact/provenance/review facts.

This checkpoint defines only the reader for that future event. No event writer exists in this slice.

## PREPARE_ONLY SQL contract

Source-only SQL:

`apps/metaengine-browser/supabase/client-v1-c5-useful-work-readback-v1.sql`

Proposed function:

`public.client_v1_goal_useful_work_proof_v1(uuid, uuid)`

This file is intentionally outside `supabase/migrations`.

It contains an explicit instruction that the eventual migration must be created using:

`supabase migration new`

and must be reviewed/run under explicit live mutation authorization.

### Existing execution proof is the identity root

The proposed C5 read function first calls:

`public.client_v1_goal_execution_proof_v1(p_workspace_id, p_request_id)`.

It will not consider useful-work evidence unless the existing proof already establishes:

- request found;
- task state = `COMPLETED`;
- terminal = true;
- Agent-origin readback = true;
- accepted result readback = true;
- result claim valid;
- result origin-bound.

### Trusted verifier event binding

The reader then looks for:

`destruktion_meta.devos_fleet_event_h205f22`

where all of these match:

- workspace;
- task ID;
- point ID;
- baseline SHA;
- lease generation;
- event type `TASK_USEFUL_WORK_VERIFIED`;
- `authority_effect=false`;
- proof contract;
- trusted verifier origin;
- result SHA-256;
- result-claim SHA-256;
- Agent-origin conversation SHA-256.

No matching verifier event means:

`found=false`

and:

`client_c5_useful_work_verified=false`.

Missing evidence is not inferred from a successful Agent result.

## Useful-work event validation

The proposed reader validates digest-only evidence for:

### Repository

- repository identity SHA-256;
- checkout SHA equals exact goal baseline;
- source snapshot SHA-256;
- isolated workspace true;
- host repository not mounted;
- host Git directory not mounted;
- linked Git worktree not exposed as a security boundary;
- source snapshot read-only.

### Edit

- patch SHA-256;
- changed-file manifest SHA-256;
- positive file count;
- positive materialized edit-operation count;
- edit materialized;
- protected root unchanged;
- host repository unchanged.

### Verification

- command-contract SHA-256;
- pre-repair receipt SHA-256;
- pre-repair test observed;
- pre-repair exit code non-zero;
- post-repair receipt SHA-256;
- post-repair test observed;
- post-repair exit code zero;
- real build/test true;
- repair verified true.

### Artifact

- artifact SHA-256;
- positive byte count;
- artifact subject digest equals artifact digest;
- provenance SHA-256;
- independent verification receipt SHA-256;
- provenance verified;
- subject digest verified;
- artifact verified.

### Review

- review receipt SHA-256;
- independent verifier true;
- accepted true;
- accepted artifact digest equals exact artifact digest.

### Authorship / membrane flags

The verifier event must state:

- candidate authored = false;
- model authored = false;
- browser authored = false;
- raw patch included = false;
- raw logs included = false;
- model output included = false;
- page content included = false.

This makes the verifier event an independently-authored digest receipt rather than a copy of candidate output.

## Proposed readback output

Only after all checks pass does the SQL contract project:

- schema `metaengine.client-v1.useful-work-proof.v1`;
- evidence class `LIVE`;
- evidence origin `SIGNED_SUPERVISOR_READBACK`;
- exact request/task/plan/lease/result binding;
- digest-only repository/edit/test/artifact/review evidence;
- `serial_loop_end_to_end=true`;
- `user_goal_to_verified_artifact_readback=true`;
- `client_c5_useful_work_verified=true`.

It still returns:

- `canonical_c2_promotion_authorized=false`;
- `automatic_retry_allowed=false`;
- `scheduler_authority=false`;
- `browser_authority=false`;
- `release_authority=false`;
- `authority_effect=false`.

A signed Client C5 result is therefore evidence, not canonical promotion authority.

## Edge route

Modified:

`apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/meta-routes.mjs`

Proposed device-authenticated route:

`POST /v1/meta/client-goal-useful-work-proof`

Request contract:

`{ request_id }`

The route:

- forbids caller `workspace_id`;
- fixes workspace server-side;
- rejects extra caller fields;
- calls only `client_v1_goal_useful_work_proof_v1`;
- validates the returned proof again at the Edge membrane;
- preserves explicit absence;
- maps proof drift to a bounded conflict;
- exposes no submit/retry/promotion fallback.

### Defense in depth

Even though the SQL function is server-only, Edge validates:

- identity binding;
- LIVE classification;
- signed Supervisor origin;
- repository isolation facts;
- edit facts;
- failing/passing test facts;
- artifact/provenance facts;
- independent review;
- zero-authority fields.

A recursive membrane rejects raw keys such as:

- agent/tab/target IDs;
- repository/workspace paths;
- Git directory;
- patch/diff;
- stdout/stderr;
- artifact path;
- result summary;
- model output;
- page content.

A compromised or drifted service RPC response therefore cannot silently expand the device-facing payload.

## Native signed read method

Modified:

`apps/metaengine-browser/src/native-supervisor-client-base.mjs`

New method:

`clientGoalUsefulWorkProof({ request_id })`

It performs exactly one device-signed request to:

`/v1/meta/client-goal-useful-work-proof`.

It has no:

- retry loop;
- submit fallback;
- timer;
- mutation fallback.

## Intentional runtime non-wiring

`apps/metaengine-browser/src/main.mjs`

does **not** reference:

- `clientGoalUsefulWorkProof`;
- `client-goal-useful-work-proof`.

This is a required PREPARE_ONLY canary.

Reason:

The SQL source is not migrated or deployed and no trusted verifier writer exists. Wiring the main process now would create a runtime consumer for an intentionally unavailable authority path and would blur the evidence boundary.

The existing product continues projecting only the durable locally-normalized useful-work proof from prior checkpoints.

## Adversarial tests

New suite:

`apps/metaengine-browser/test/client-v1-c5-useful-work-readback-contract.test.mjs`

It proves:

1. SQL source is explicitly PREPARE_ONLY and outside migration history.
2. eventual migration generation is delegated to Supabase CLI.
3. function EXECUTE is revoked from public/anon/authenticated.
4. only service_role receives EXECUTE.
5. execution identity comes from existing execution proof.
6. useful-work acceptance comes from separate trusted verifier event.
7. event is bound to workspace/task/point/base/lease/result/claim/conversation.
8. function body owns no INSERT/UPDATE/DELETE/event emit.
9. successful projection is LIVE but canonical promotion remains false.
10. Edge fixes workspace server-side.
11. extra fields/workspace override are rejected before RPC.
12. absent evidence stays an explicit non-claim.
13. raw patch/log/model/page output from RPC is rejected.
14. forged evidence origin is rejected.
15. artifact subject drift is rejected.
16. non-independent review is rejected.
17. native method is one signed read with no retry/mutation fallback.
18. main process has no consumer before migration + writer exist.

The workflow also re-runs prior:

- useful-work proof tests;
- restart durability tests;
- product projection tests;
- execution-proof integrity tests;
- Agent-origin/result proof tests.

## CI history

### First run — fail-closed test defect found

Head:

`582b0aa54462537d3814be411112f6f922903ae1`

Run:

`37396754499`

Job:

`112054455065`

Result:

**FAILURE**

Test result:

- 64 tests;
- 63 pass;
- 1 fail.

The failure was a too-literal static regex for the SQL formatting of the trusted verifier predicate.

The implementation trust predicate was present and correct. The test was repaired to match the actual SQL expression without changing or weakening the contract.

This failed run is retained as evidence that CI was not reported green before correction.

### Corrected implementation run

Head:

`412cff6caab21106c704e321bf6ef1596fbd1350`

Run:

`37396831872`

Job:

`112054696829`

Conclusion:

**SUCCESS**

Tests:

- tests: **64**
- pass: **64**
- fail: **0**
- skipped: **0**

Additional gates:

- Edge parse: PASS;
- native client parse: PASS;
- exact head: PASS;
- whole-slice no-migration change: PASS;
- whole-slice no-function-deployment change: PASS;
- whole-slice no-infra change: PASS;
- source checkout unchanged: PASS.

## Why no Supabase advisors were run

No DDL was applied to a Supabase project.

The source SQL is not a migration and no deployment occurred.

Running security/performance advisors is mandatory **after an actual schema change**, but there is no live schema change to inspect in this checkpoint.

The eventual schema step must:

1. generate the migration using Supabase CLI;
2. inspect the generated migration;
3. apply only with explicit live authorization;
4. run security advisor;
5. run performance advisor;
6. verify exact function ACLs/readback;
7. only then allow a runtime consumer.

## Amplifier conclusion

The most important outcome of this slice is negative capability:

> The project now has a defined read path, but still has no trusted useful-work verifier writer.

That is intentional.

A read contract without a trusted writer cannot produce LIVE C5 evidence. This prevents Agent/model output, synthetic CI, or a device client from self-minting independent acceptance.

The next authority-bearing architecture problem is therefore not another UI or read endpoint. It is the provenance of the future `TASK_USEFUL_WORK_VERIFIED` writer.

That writer must independently verify the artifact/test/provenance chain and must not trust candidate-authored booleans.

## Non-claims

This checkpoint does not prove:

- the SQL function exists in the live database;
- the Edge route is deployed;
- a trusted verifier writer exists;
- a `TASK_USEFUL_WORK_VERIFIED` event exists;
- the Native Client consumes the new readback;
- a live Agent produced useful work;
- Client C5 LIVE completion;
- canonical C2 completion;
- R1/C1 completion;
- production promotion.

## Checkpoint

Signed useful-work readback source contract:
**EVIDENCE_READY / PREPARE_ONLY**.

Trusted verifier writer:
**NOT IMPLEMENTED / NOT AUTHORIZED**.

Actual Supabase migration:
**NOT CREATED**.

Live deployment:
**NOT PERFORMED**.

Client C5 LIVE:
**NOT_PROVEN**.

Canonical C2:
**NOT_PROVEN**.

Authority effect:
**false**.
