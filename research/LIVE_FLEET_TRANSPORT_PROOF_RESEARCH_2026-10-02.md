# Live fleet transport-proof research — 2026-10-02

Base source reviewed: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`  
Live state observed at `2026-10-02T06:27:57Z` from fresh Supabase project `jhriwwsryeqsvvvufkok`.

## Live symptom

The installed Browser is healthy but its four z.ai fleet agents are:
- `BOUND_UNVERIFIED`
- `transport_proof=null`
- `authority_effect=false`
- `automatic_retry_allowed=false`

Roles:
PLANNER, RESEARCHER, IMPLEMENTER, CRITIC.

The fleet contract is:
`TRANSPORT_PROOF_REQUIRED`

Therefore CONTROL + armed does not imply agent execution readiness.

## Existing source already contains the missing transition

Relevant source:
- `apps/metaengine-browser/src/devos-native-task-cycle.mjs`
- `apps/metaengine-browser/src/fleet-provisioner.mjs`
- `apps/metaengine-browser/src/fleet-runtime-bridge.mjs`
- transport admission / promotion SQL and routes
- tests `fleet-preconversation-transport-proof.test.mjs`
- `devos-root-transport-bootstrap-e2e.test.mjs`
- `devos-fleet-transport-proof-runtime.test.mjs`

The architecture deliberately splits proof into two stages.

### PRECONVERSATION_ROOT

A `BOUND_UNVERIFIED` worker may have a bounded proof that the exact tab/target/generation reached the canonical authenticated root.

This proof:
- remains `BOUND_UNVERIFIED`;
- carries no task authority;
- is not sufficient for scheduler/task admission;
- is useful only as a safe bootstrap intermediate.

### CONVERSATION

Task admission requires an `ACTIVE` worker with:
- `metaengine.browser.fleet-transport-proof.v1`;
- exact tab id;
- exact target id;
- exact generation epoch;
- canonical conversation URL + SHA-256;
- Agent surface SHA-256;
- finite proof timestamp;
- `authority_effect=false`.

A bare root or stale proof is rejected.

## Existing promotion geometry

`DevOsNativeTaskCycle.#promoteOneRestartTransport()` already implements a bounded recovery/promotion flow:

1. choose one exact eligible `BOUND_UNVERIFIED` Fleet-owned candidate;
2. acquire the existing server promotion lease;
3. fresh CAPTURE and exact target readback;
4. if necessary, under the lease, normalize only that Browser-owned tab to the canonical authenticated root;
5. persist bootstrap ambiguity before navigation effects;
6. prove the root as `PRECONVERSATION_ROOT`;
7. navigate through semantic controls to the Agent task surface;
8. obtain a canonical conversation URL;
9. compute Agent-surface evidence;
10. mark transport proven and promote the same exact incarnation to `ACTIVE`;
11. only after exact proof may task lease / mark-running / dispatch proceed.

The tests explicitly assert:
- promotion happens before task lease;
- root proof is not task admission;
- no model message is sent merely to prove the root;
- proof is revalidated before mark-running;
- wrong tab/target/generation is fenced;
- no blind retry.

## Key conclusion

The live `BOUND_UNVERIFIED` condition does **not** require a new transport architecture.

The next useful-work path should reuse the existing promotion lease + semantic bootstrap path. Building another transport proof plane would duplicate an already tested safety boundary.

## Why live agents remain unverified

The read-only heartbeat proves their current state but does not prove why the promotion cycle has not completed. Plausible source-level boundaries include:
- no DevOS cycle currently invoking restart transport promotion;
- promotion route/lease not reached;
- live installed version is older than the newest transport/bootstrap fixes;
- a semantic surface condition prevented root -> Agent task -> conversation proof;
- no work demand exists to trigger the bounded promotion path.

These are hypotheses only. Do not select one without live promotion telemetry/readback.

## Next evidence-first live plan

After the current Browser build is fully qualified and, only if an update is explicitly authorized:

1. install/upgrade to the exact qualified artifact;
2. read back heartbeat and fleet state;
3. run one bounded **promotion-only** DevOS cycle or existing readiness path;
4. require one agent to move from `BOUND_UNVERIFIED` -> PRECONVERSATION proof -> `ACTIVE` with exact conversation proof;
5. re-read durable fleet state;
6. only then admit one useful task;
7. prove Agent-origin result and accepted durable result;
8. do not fan out work until the single-agent path is proven.

## No-effect boundary

This research issued no:
- navigation;
- tab mutation;
- promotion lease;
- task lease;
- model message;
- task submission;
- Supervisor admission;
- Guardian/UAC effect.

It is a source/live-state analysis checkpoint only.
