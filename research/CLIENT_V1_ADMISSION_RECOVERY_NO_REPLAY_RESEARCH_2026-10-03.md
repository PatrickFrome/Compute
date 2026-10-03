# METAENGINE Client V1 — Admission Recovery / No-Replay Research

Date: 2026-10-03
Line: `work/client-v1-admission-recovery-v1`
Authority: research/evidence only
Automatic effect retry authority: false

## Problem

The installed Client is healthy enough to read Browser/Compute state, but live execution is fenced by the authoritative DevOS workspace control plane.

Fresh Supabase readback on 2026-10-03:

- workspace: `2de9f84b-7c0a-4091-911c-894ff1d6eaf4`
- schema: `metaengine.devos.environment-state.v1`
- state: `CLOSED`
- generation floor: `28`
- refill: `false`
- supervisor admission: `false`
- authority present: `true`
- reset reason: `SIGNED_PROFILE_BOOTSTRAP_CLOSED`

This is not a reason to bypass the fence. The existing server contract already has the intended operator-gated transition:

`POST /v1/devos/resume-admission`

with:
- device authentication;
- `confirm=true`;
- exact generation-floor compare-and-swap through `devos_environment_resume_v1`;
- independent environment-state readback after the mutation;
- no automatic retry authority.

## Version skew found in the live Edge deployment

Current Supabase Edge deployment:
- function: `a2-browser-native-supervisor-v1`
- version: `10`
- active source imports `devos-routes.mjs` from exact Git commit
  `00d7c814213a97ac17504d5c598818bd99c588cb`.

That deployed route already contains `/v1/devos/resume-admission`, but does **not** contain the newer read-only:

`POST /v1/devos/environment-state`

The current Browser source at `c31de39a9aad097e7a8356d746a596a33d63c5a9` does contain that route.

This matters because safe ambiguity recovery needs a read-only, authenticated, exact authority readback which is independent from the effect response.

Do not emulate that readback through a scheduler cycle: `/v1/devos/cycle` can lease work once admission is open and is therefore not an observation-only reconciliation endpoint.

## Distributed-systems research

AWS Builders' Library documents the exact failure mode relevant here: if a mutating request times out, the caller cannot know whether the effect happened. Retrying blindly can duplicate effects; without a server-side idempotency token the caller must reconcile state before deciding what to do next.

Reference:
https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/

AWS Well-Architected likewise recommends caller-provided idempotency tokens for mutating APIs so repeated requests are semantically equivalent.

Reference:
https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_prevent_interaction_failure_idempotent.html

Temporal's durable-execution model makes the same distinction operationally: durable state survives crashes, while externally visible effects still require idempotent/effect-safe handling.

Reference:
https://docs.temporal.io/temporal

## P0 decision: durable intent + reconciliation, no automatic replay

The current `devos_environment_resume_v1` API has a generation CAS but no caller request-id/idempotency-token parameter.

Generation fencing prevents a stale generation from being resumed, but it does not prove that retransmitting the same request after a lost response is semantically a harmless duplicate while the floor remains unchanged.

Therefore P0 must use at-most-once client emission:

1. fresh authenticated environment-state read;
2. durable local recovery attempt record;
3. durable `SEND_INTENT_DURABLE` **before** the network effect;
4. at most one `resume-admission` request for that attempt;
5. receipt alone is not success;
6. fresh independent environment-state readback after a receipt;
7. if the response/readback is lost, persist `AMBIGUOUS`;
8. the next explicit user action performs readback-only reconciliation and never replays the prior effect;
9. if reconciliation proves the workspace stayed CLOSED at the same generation, mark `ABSENCE_CONFIRMED`;
10. only a later explicit user action may create a fresh attempt.

This deliberately prefers false-negative recovery friction over duplicate/ambiguous mutation.

## Current implementation

New journal:

`apps/metaengine-browser/src/client-admission-recovery-journal.mjs`

Schemas:
- `metaengine.client.admission-recovery-journal.v1`
- `metaengine.client.admission-recovery-attempt.v1`

Durable states:
- `PREPARED`
- `SEND_INTENT_DURABLE`
- `AMBIGUOUS`
- `RECEIPT_RECEIVED`
- `OPEN_CONFIRMED`
- `ABSENCE_CONFIRMED`
- `REJECTED`

Every attempt is:
- operator initiated;
- explicit-action only;
- automatic retry forbidden;
- authority-effect metadata false.

Native Client additions:
- `devosEnvironmentState()`
- `resumeDevosAdmission(expectedGenerationFloor)`

Both use the existing device-signed Native Supervisor transport. No new credential plane, scheduler or shell execution path is introduced.

Primary UI adds a typed `Resume execution` action only when readiness reports `WORKSPACE_EXECUTION_PAUSED`. The action is never scheduled from a timer. After each explicit action the UI re-reads the normal `workReadiness` projection.

## Fail-close boundaries

The implementation must continue to reject:

- untrusted renderer sender;
- non-ADMIN Client connection;
- missing/invalid authoritative generation floor;
- stale generation CAS;
- malformed resume receipt;
- missing independent post-effect readback;
- automatic retry after timeout/lost response;
- generic command exposure;
- Browser-side direct database/service-role mutation;
- scheduler-cycle use as a readback substitute.

## P1 research frontier: true idempotent resume V2

A later server contract can make recovery less conservative by adding a caller-generated `attempt_id`:

`devos_environment_resume_v2(workspace, expected_generation_floor, attempt_id)`

The server should atomically persist the idempotency record and the admission mutation in one transaction, bind the stored request parameters to the token, and return a semantically equivalent response for duplicates.

Only after such a server contract is physically proven should the Client be allowed to retransmit the same recovery request automatically.

P0 intentionally does not claim exactly-once delivery and does not fabricate that property client-side.
