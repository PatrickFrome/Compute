# C4.6 — Proof reconciliation research

Date: 2026-09-30. Implementation parent: `a798561cc462d7a625177e98f18bab47f42b82fa`.

## Temporal: recover the current durable state

Primary source: https://docs.temporal.io/workflow-execution

Temporal describes recovery against recorded event history and identifies each execution by namespace, workflow ID and run ID. Its recorded state, rather than an old successful observation, determines where an execution resumes.

Applied inference for METAENGINE: a Client proof is a projection of one exact task/lease snapshot. When progress changes lease generation, terminal state or result digests, the previous proof cannot describe the current execution. Retain the existing DevOS scheduler and effect journal; invalidate the projection instead of replaying external z.ai effects. Sequential readbacks can race; an inconsistent pair is omitted until a subsequent bounded read observes a matching pair.

## GitHub: separate contracts from operator-started live qualification

Primary sources:

- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request

GitHub documents that `workflow_dispatch` requires workflow registration on the default branch. It also supports the `labeled` pull-request activity. A workflow existing only in the current Client stack must not assume it is already manually dispatchable from the repository default branch.

Applied decision: PR contract checks remain automatic. Signed/live qualification runs only through explicit dispatch or the exact PR label `client-v1:signed-canary`; physical Agent qualification uses `client-v1:physical-agent`. Both check out the PR head SHA, rather than the synthetic PR merge SHA. Enrollment approval remains mandatory. Synchronizing a manifest never automatically starts an approval timer.

## Supabase: preserve custom authentication and immutable deployment binding

Primary sources:

- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/function-configuration
- https://supabase.com/changelog

The markdown changelog endpoint was attempted but the web reader rejected its content type; the HTML changelog and current function configuration/auth documentation were consulted instead. No new Supabase client package or auth convention is introduced.

The existing canary implements P-256 device signatures, nonce replay fencing and enrollment. Preserve its existing `verify_jwt=false` setting and custom authentication. Rebind its complete remote import closure to one immutable source commit; read deployed source back and compare every file byte. Refresh the qualification manifest using actual deployed version/EZBR readback, including the stable rollback target.

## Result

Use the existing request ledger, task leases, Agent-origin events and typed result claims. Add no model API, geometric actuation, task scheduler or execution authority. The proof join remains read-only, and physical success remains conditional on an actual ACTIVE transport-proven z.ai Agent.
