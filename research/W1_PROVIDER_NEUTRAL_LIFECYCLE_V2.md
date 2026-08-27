# W1 Provider-Neutral Lifecycle V2

Status: PREPARED / NON-AUTHORITY / MB1 V2 PAIR-ACK PENDING

Macroblock: `dce58a3b-2f67-47e0-ae0d-9b3825ff53cd`  
Plan SHA-256: `27da9d34d07d827cb4c14854d90ebb1032654ff217cec2651e3e492a1bb41af5`

## Why this exists

The previous W1 STEP08 path was specialized for an AWS EC2 host that was never provisioned. Forensic readback showed no real EC2 instance, account, IAM role, or worker identity to restore. The old macroblock was therefore preserved as `ABANDONED` rather than completed or rewritten.

The user explicitly authorized generating a new solution or selecting another provider. MB1 V2 preserves the roadmap order `W1 -> (T1 || A1) -> C1` while changing only the provider lifecycle evidence adapter.

## Provider research recheck — 2026-08-25

### GitHub Codespaces

Current GitHub documentation states that a codespace can be stopped and restarted without losing saved project changes. The `/workspaces` directory is the durable project filesystem surface. GitHub also exposes REST lifecycle operations for codespaces.

Implication: Codespaces is a viable candidate only if an authenticated lifecycle rail is available and the run can independently prove:

- the same codespace/provider object before and after;
- a provider-observed stop/start boundary;
- a changed Linux `boot_id`;
- a changed runtime/session identity;
- an identical durable sentinel hash;
- post-resume W1 safety/H1-H13 predicates.

A saved Git checkout alone is not persistence proof.

### Vercel Sandbox

Current Vercel Sandbox documentation describes persistent named sandboxes. Stopping a persistent sandbox snapshots its filesystem; obtaining the same named sandbox later resumes from the saved filesystem in a new compute session.

Implication: the durable sandbox name can serve as provider-object identity, while the resumed compute session must be distinct. This maps directly to the MB1 V2 lifecycle predicates, subject to authenticated provider readback and cost/quota policy.

### Existing W1 contracts

`worker/native_linux/host_observation_collector.py` and `worker/native_linux/admission_contract.py` are already provider-neutral for Linux host safety. They deliberately cannot assert persistence, reboot, provider identity, admission, or W1 verification.

`public.h205f22_w1_admission_candidate_readback_v1` is only partly provider-neutral. Its backend-binding and pre/post Linux-probe checks are generic, but the lifecycle receipt validator is AWS-specific: it requires an AWS signed IID and CloudTrail `RebootInstances` request semantics. Therefore V2 must be additive rather than silently reinterpreting v1.

## Prepared lifecycle oracle

`controller/w1/provider_neutral_lifecycle_guard.py` validates only structural and causal consistency for:

- `GITHUB_CODESPACES + STOP_RESUME`
- `VERCEL_SANDBOX + STOP_RESUME`
- `AWS_EC2 + REBOOT`

Required invariants:

1. pre/post provider object ID is identical;
2. provider/runtime session ID changes;
3. Linux kernel `boot_id` changes;
4. durable sentinel SHA-256 is identical;
5. `pre < request <= completion < post` chronology;
6. provider/action pair is allow-listed;
7. provider readback digest is structurally valid;
8. all authority/canonical/W1 claims in input are explicitly false.

Even on success the oracle emits:

- `input_provenance_verified=false`
- `provider_identity_verified=false`
- `provider_action_verified=false`
- `persisted_readback_verified=false`
- `persistent_worker_proof=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

This is intentional. Real W1 promotion still requires authenticated provider readback, persisted Supabase receipts, post-resume Linux safety verification, and supervisor verification.

## Additive DB path required after pair reseal

Do not mutate the existing AWS v1 receipt semantics. After MB1 V2 is pair-ACKed, implement an additive provider-lifecycle receipt/readback contract with provider-specific validators. AWS may delegate to the existing signed-IID validator; Codespaces and Vercel must bind to authenticated provider APIs/OIDC rather than pretending to have AWS-style signed instance identity.

## Cost and safety

Provider reuse is preferred. Creation of a new resource is permitted only when it is demonstrably within included/free quota or after the macroblock enters `PAID_RESOURCE_OR_BUDGET_REQUIRED`. No lifecycle mutation is performed by this research/contract step.
