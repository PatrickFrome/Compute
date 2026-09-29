# C2.3 Checkpoint — DB Outage Lease Backoff

Captured: 2026-09-29
Frozen baseline: ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551
Stack base: C2 Edge evidence head 31042b5a3d5048c3eba2b86d0a0ab4d5401b8a08
Implementation head: b8704e82ac11403b2548ee8d3932a3c8ce027bb4
Draft PR: #1073

## Live defect

During the current Supabase/Postgres outage the Browser control plane repeatedly receives 502 from native-supervisor lease/state routes while Postgres is refusing connections.

The exact R109 scheduler has this healthy-path optimization:
- when batch transport is SUPPORTED, wait-batch itself is the idle wait;
- therefore the next scheduler delay is zero.

When the server returns an immediate failure instead of holding wait-batch, the same zero-delay rule creates a tight control-plane retry loop.

This is transport retry amplification, not Browser-effect replay, but it increases load during dependency failure and reduces recovery quality.

## IMPLEMENT

Changed only:
- apps/metaengine-browser/src/native-supervisor-client-base.mjs
- apps/metaengine-browser/test/native-supervisor-lease-retry-backoff.test.mjs

Repair:
- reuse existing lease_consecutive_failures;
- reuse the existing canonical scheduler timer;
- healthy SUPPORTED batch transport + zero failures => delay 0;
- failed lease cycles => deterministic bounded exponential cooldown:
  2s → 4s → 8s max under the default 2s supervisor interval;
- successful lease resets failures and restores delay 0;
- no second lease timer;
- no second scheduler;
- no DB authority change;
- no Browser effect replay;
- no permanent downgrade from wait-batch;
- existing transient batch→single fallback remains intact.

## VERIFY — current

Diff against C2 base:
- 2 commits
- 2 files
- source +31/-3
- test +59

Exact-head CI already green:
- Browser Live Control Recovery V1
- METAENGINE Browser Control Plane Fast Lane V1
- METAENGINE Browser Developer Emergency Update V1

Broad Critical Audit / full Browser Node regression and physical workflows are still running at checkpoint time.

## RESEARCH

Google Cloud and AWS reliability guidance agree on:
- do not immediately retry transient failures indefinitely;
- use truncated exponential backoff;
- cap retry intervals / attempts;
- add jitter when many clients may synchronize;
- do not blindly retry non-idempotent effects.

Client V1 decision:
- this bounded repair uses deterministic backoff because it modifies one existing local scheduler during release convergence;
- per-client jitter is deferred until multi-client scaling, where synchronized Browser clients become a real thundering-herd risk;
- effect retry semantics remain unchanged and fail-closed.

References:
- https://docs.cloud.google.com/iam/docs/retry-strategy
- https://docs.aws.amazon.com/wellarchitected/2022-03-31/framework/rel_mitigate_interaction_failure_limit_retries.html
- https://docs.cloud.google.com/storage/docs/retry-strategy

## STATUS

IMPLEMENTED = true
FOCUSED_CI = GREEN
FULL_REGRESSION = PENDING
LIVE_DEPLOYED = false
PROMOTION_AUTHORIZED = false
