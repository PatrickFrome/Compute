# METAENGINE Client V1 — Idempotent Admission Resume V2 Research

Date: 2026-10-03
Plane: research only
Current P0 remains authoritative: durable local intent + no automatic replay.

## Why V2 exists

The current admission transition is generation-fenced but does not accept a caller request token. A lost response therefore leaves the caller unable to prove whether retransmitting the mutation is a duplicate or a new effect while the same generation floor is still current.

P0 deliberately resolves this by never replaying an ambiguous resume effect. That is the correct fail-closed behavior until the server provides a real idempotency contract.

## External design evidence

AWS Builders' Library, "Making retries safe with idempotent APIs":
https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/

Key design point: retries of side-effecting operations become safe when the caller supplies a unique request identifier and the service returns a semantically equivalent result for the same identifier. The identifier must represent the same intent, not merely the same resource.

Stripe API idempotent requests:
https://docs.stripe.com/api/idempotent_requests

Useful concrete pattern:
- caller generates the key;
- server stores the first result;
- repeat calls with the same key return the stored result;
- reusing the key with different request parameters is rejected;
- validation failures before execution do not consume the idempotency result.

AWS Well-Architected retry guidance:
https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html

Relevant rule: establish idempotency before enabling retries.

Temporal durable execution also derives stable activity/request identity so retries address the same durable execution rather than launching an unrelated second effect:
https://docs.temporal.io/nexus/standalone-activity

## Proposed server contract

Do not replace P0 until this is implemented and proven atomically.

Candidate RPC:

`public.devos_environment_resume_v2(
  p_workspace uuid,
  p_expected_generation_floor bigint,
  p_attempt_id uuid
) returns jsonb`

Required durable ledger key:

`(workspace_id, attempt_id)`

The ledger must persist at minimum:
- workspace_id
- attempt_id
- expected_generation_floor
- request_semantic_sha256
- state: STARTED | COMMITTED | REJECTED
- canonical result JSON
- created_at / completed_at
- authority_effect=false metadata

## Transactional semantics

One database transaction should:

1. validate workspace, floor and attempt ID;
2. lock/read any existing ledger row for the same key;
3. if existing request semantic hash differs, reject `idempotency_parameter_mismatch`;
4. if existing COMMITTED/REJECTED row exists, return its canonical semantic result without re-running the transition;
5. otherwise create the ledger record;
6. perform the exact generation-floor CAS that opens refill + supervisor admission;
7. store the canonical result in the same transaction;
8. commit.

The DB transaction, not the Edge function or Browser journal, is the atomic boundary.

## Response contract

Suggested response:

`metaengine.devos.environment-resume.v2`

Fields:
- attempt_id
- workspace_id
- requested_generation_floor
- observed_generation_floor
- resumed
- replayed
- canonical_disposition
- before / after bounded readback
- operator_initiated=true
- automatic_retry_allowed=<true only after V2 is fully qualified>
- authority_effect=false

A duplicate request may return `replayed=true`, but must be semantically equivalent to the original committed result.

## Browser behavior after V2 qualification

Only after physical server qualification:

- persist attempt_id before send;
- send the same attempt_id on retry;
- never generate a new attempt_id automatically for an ambiguous request;
- bounded retry/backoff may be enabled for transport errors only;
- parameter drift under the same attempt_id is fatal;
- fresh environment-state readback is still required before showing "execution resumed" in UI;
- generation drift still terminates the attempt instead of silently opening a newer generation.

## Tests required before adoption

Adversarial tests should include:
- response lost after DB commit, same attempt retry returns stored result;
- duplicate concurrent requests with same attempt ID produce one mutation;
- same attempt ID + changed generation is rejected;
- same attempt ID + changed workspace is rejected;
- stale generation first request produces a durable rejection and duplicate gives the same rejection;
- crash between ledger STARTED and mutation cannot create a second effect;
- transaction rollback leaves neither open admission nor a false COMMITTED ledger;
- exact readback after success;
- no automatic retry from UI timer;
- no generic Browser command or service-role credential exposure.

## Decision

Do not implement V2 on the current packaging-critical candidate.

The immediate blocker is converging the already-implemented P0 admission recovery into a physically qualified Browser build. V2 is a post-convergence reliability successor and must not create feature churn before that candidate is qualified.
