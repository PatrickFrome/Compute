# FLEET FALSIFIER — autonomous dispatch V1

Status: **FALSIFIED / DO NOT CONVERGE WITHOUT FIXES**

## Task identity

- agent_id: `agent_c832d218-95be-40c9-930d-58db27524c67`
- role: `FALSIFIER`
- task_id: `aa72960c-18c9-41ff-afe5-239a0ae8471b`
- lease_generation: `1`
- base_sha: `724612235eb7ceb4534c13d126425b274d876394`
- source_branch: `work/devos-elastic-fleet-bootstrap-v1`
- target_branch: `work/fleet-falsifier-autonomous-dispatch-v1`

The target branch was created from the exact requested base. No production mutation, main merge, secret request, authority weakening, or page/model authorization was performed.

## Executed negative-test evidence

Test commit: `a05d457e826f4e2505edefd6c1a5c796bdb77e34`
CI workflow commit: `5ded7c443d201ac0c7001a2de5831fca1aae140e`
GitHub Actions run: `33314652805`
Job: `adversarial-negatives` / `99265719252`
Node: `v24.19.0`

Observed result: **5 tests, 2 pass, 3 fail**. The failing tests are deliberate fail-closed assertions: a failure means the current runtime violated the asserted safety invariant.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Ambiguous Enter in already-open `/c/...` conversation | **FAIL / FALSIFIED** | Dispatcher accepted an ambiguous submit because the unchanged post URL was already a conversation URL; test reported `Missing expected rejection`. |
| Stale agent generation | **PASS / FENCED** | Generation mismatch rejected before semantic actuation. |
| Concurrent duplicate supervisor cycles / heartbeats | **PASS / COALESCED** | Three concurrent `cycle()` calls produced one state heartbeat and one command poll. |
| Command replay after successful mutation + ambiguous result transport | **FAIL / FALSIFIED** | Same `command_id` mutation executed twice after result POST returned synthetic HTTP 503 (`2 !== 1`). |
| Owner-disabled ambiguous compensating fanout | **FAIL / FALSIFIED** | One unknown `createTab` effect caused 8 create attempts instead of stopping at one (`8 !== 1`). |

Existing source tests additionally cover physical webContents incarnation mismatch before dispatch and restart/tab-loss conversion to `LOST` with generation increment. Those guards were not weakened by this branch.

## Severity-ranked findings

### F1 — CRITICAL — mutating command replay after ambiguous receipt delivery

`NativeSupervisorClient.#runCommand()` performs the authority effect before durable proof that the command result was accepted. If the effect succeeds and result transport fails, the client records local failure only after the ambiguous boundary. On the next cycle, a server replay of the same `command_id` is executed again because there is no local durable replay tombstone / effect journal checked before actuation.

Reproduced: first `NEW_TAB` execution succeeded, result POST returned 503, next cycle received the same command, and the mutation executed a second time.

Smallest safe fix:
1. Persist a per-command pre-actuation journal record keyed by `command_id` with action, target binding and an explicit `EFFECT_PENDING` state before mutation.
2. After any ambiguous post-effect transport failure, fence the command as `EFFECT_UNKNOWN`; never re-actuate automatically.
3. On replay, reconcile/read back or only re-post the stored result; require a new command generation/id for a new authority effect.
4. Preserve exact target/incarnation/generation fencing and never infer retryability from HTTP failure alone.

### F2 — HIGH — stale conversation URL launders ambiguous Enter into transport proof

`fleet-task-dispatcher.mjs` currently computes effect proof as `stopObserved || postConversation || submit.effect_state startsWith PROVEN_`. When both pre- and post-submit URLs are the same existing ChatGPT `/c/...` URL, an `AMBIGUOUS_AFTER_ENTER` native result is still considered proven solely because `postConversation` is true.

Reproduced: unchanged existing conversation URL + ambiguous submit returned success instead of `fleet_task_send_effect_ambiguous` and could promote transport to ACTIVE.

Smallest safe fix:
1. Existing conversation membership must never be proof by itself.
2. Accept proof only from a submit-specific observable transition (for example STOP/generation transition tied to the same target incarnation), a newly created conversation transition, or an explicit lower-layer `PROVEN_*` effect proof.
3. For an already-open conversation with no new transition and ambiguous submit, return `AMBIGUOUS_AFTER_ENTER`, `automatic_retry_allowed=false`, and do not call `markTransportProven`.

### F3 — HIGH — owner gate can opt into blind compensating fanout after unknown create effect

`fleet.ambiguous_compensating_fanout` is an owner-development gate. Disabling it causes `PROVISIONING_AMBIGUOUS` agents to be ignored by slot counting and enables additional create/provision attempts. With an unknown `createTab` effect this violates the system-wide no-blind-retry contract.

Reproduced: desired fleet size 1, first create effect became unknown, but one reconcile produced 8 create attempts (the default burst limit).

Smallest safe fix:
1. Make the no-blind-retry invariant non-overridable for authority effects with ambiguous external outcome.
2. If experimental compensating capacity is needed, require evidence that the original create did not happen (exact tab/target reconciliation) before any replacement create.
3. Owner gates may relax development convenience limits, not effect-idempotency/fencing invariants.

### F4 — MEDIUM — live DB/GitHub drift and privilege hardening gap

Live Supabase contains `devos_fleet_*` RPCs that were not found in the source-branch GitHub index during this review. The DB-native lease implementation itself has strong fencing: `FOR UPDATE SKIP LOCKED`, exact lease binding, and unique partial indexes for one active task claim, one active task per agent, and one active MUTATING claim per `(workspace_id, point_id, base_sha)`. `devos_fleet_mark_running_v1` and `devos_fleet_complete_v1` also fence agent, lease generation, tab, target, agent generation epoch, state and lease expiry.

This means the concurrent MUTATING-claim race is currently fail-closed at the database uniqueness layer, but the uncommitted/live drift must be reconciled before convergence so GitHub review/CI actually covers the deployed contract.

Three public control tables currently have RLS disabled:
- `compute_fabric_a2_supervisor_actuation_lease_h205f22`
- `compute_fabric_a2_supervisor_mesh_instance_h205f22`
- `compute_fabric_development_gate_policy_h205f22`

The checked `anon`/`authenticated` roles did **not** have SELECT/INSERT/UPDATE/DELETE on these tables, so this review did not prove a direct REST data-mutation bypass. They did have `TRUNCATE`, `TRIGGER`, and `REFERENCES` privileges, which should be removed unless explicitly required, and RLS/ACL intent should be made explicit in a reviewed migration.

## Protected invariants observed

- Exact stale agent generation is rejected before dispatch actuation.
- Exact live `webContents` target incarnation is checked before semantic dispatch in the source dispatcher.
- Concurrent in-process supervisor cycles are coalesced by `#cyclePromise`; duplicate callers did not duplicate heartbeat or command polling in the negative test.
- Live DB task lease/mark-running/complete functions enforce exact task/agent/lease-generation/tab/target/agent-generation binding and lease freshness.
- Unique partial DB indexes close concurrent active MUTATING claims for the same `(workspace, point, base_sha)`.
- Page/model text was not granted authority by this work; no arbitrary eval was introduced.

## Convergence gate

Do not converge autonomous DB-native dispatch into a continuously mutating fleet until F1-F3 have passing regression tests. F1 is the highest-priority blocker because it can duplicate an already successful external mutation after an ambiguous receipt transport failure. F2 can falsely mark transport as proven. F3 deliberately bypasses the no-blind-retry invariant when a development owner gate is disabled.

After fixes, rerun this exact adversarial suite and require all tests green while retaining current exact DB lease/claim fencing.
