# MAIN ROADMAP ACCELERATORS V5 — W1 EXECUTION MARKER CORRELATION PREP

Date: 2026-08-28
Branch: `work/main-roadmap-accelerators-v5`
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
Status at seal: **READY — NOT VERIFIED**

## Starting point

- Starting checkpoint head: `069e0bf6c5c1afcbfc70292a63f211a049c8aa96`
- Main baseline during this cycle: `0d1c074c7f513f25000d967761c7bb13912dacaa`
- No force-push, merge, provider mutation, reboot, Edge deployment, Supabase evidence ingestion, worker admission, or canonical checkpoint promotion was performed in this cycle.

## Semantic slice

Implemented `W1_EXECUTION_MARKER_CORRELATION` as a non-authoritative preparation layer for the first genuine W1 execution proof.

### New controller

`controller/w1/w1_execution_marker_guard.py`

It cross-binds:

1. already-reviewed strict SSM package-provisioning provenance;
2. exact successful SSM execution invocation;
3. one canonical bounded stdout marker;
4. an independently authenticated callback attesting the exact same marker body.

AWS `GetCommandInvocation` has no separate provider `InvocationId`, so the contract deliberately uses:

`invocation_key_sha256 = sha256(canonical({command_id, instance_id, plugin_name}))`

The successful output is only:

`W1_EXECUTION_MARKER_CORRELATED_CANDIDATE_UNINGESTED`

and explicitly preserves:

- `database_persistence_verified=false`
- `host_safety_verified=false`
- `reboot_completion_proven=false`
- `persistent_worker_proof=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

### Prepared persistence plane — NOT APPLIED LIVE

`supabase/prep/w1_execution_marker_receipt_v1.sql`

Defines, but does not apply:

- append-only execution marker receipt table;
- RLS;
- service-role-only select/insert and RPC execute;
- `SECURITY INVOKER` functions only;
- evidence hashing;
- idempotency conflict detection;
- separate DB-write and independent persisted-readback receipts.

It contains no worker admission, enrollment update, roadmap mutation, checkpoint seal, or W1 promotion path.

## Tests / CI

Initial semantic source CI:

- source: `6e0636ac6297d41b59c82341481cc15902d30dd9`
- run: `33129587976`
- result: SUCCESS
- 24 tests passed, including adversarial marker/callback/persistence-boundary tests.

Research-sealed exact source:

- source: `be2b32e7332632ed6b69d0de51944db47422811d`
- tree: `89b9e37fe8472c4a4106dd0db9b19ecf26fed282`
- run: `33129689349`
- result: SUCCESS

The CI workflow has `contents: read`, pinned checkout, no OIDC, no cloud transport, and no database runtime mutation.

## Deep research decisions

Full record: `research/W1_EXECUTION_MARKER_CORRELATION.md`.

Key decisions:

1. Do not invent an AWS `InvocationId`; use exact command/instance/plugin tuple hash.
2. Keep marker to one canonical stdout line under 4096 bytes because SSM output is bounded/truncated.
3. Keep eventual-consistency retries in the observation workflow, not the deterministic correlation guard.
4. Plain HTTP callback reachability is not worker authenticity.
5. Future callback ingress must use a concrete cryptographic scheme such as enrollment-bound worker signature or verified signed provider identity.
6. Supabase service-role/secret credentials must never be delivered to the worker.
7. Edge Function, if used, should remain a bounded signature-validation/RPC ingress rather than proof authority.
8. A single successful execution cannot establish persistence across reboot.

Official research references:

- AWS GetCommandInvocation: https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html
- AWS SendCommand: https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_SendCommand.html
- AWS EC2 IID verification: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/verify-signature.html
- AWS region certificates: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/regions-certs.html
- Supabase Edge auth: https://supabase.com/docs/guides/functions/auth
- Supabase Edge secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase Edge limits: https://supabase.com/docs/guides/functions/limits

## Supabase advisors

Advisors were run after the semantic slice. Since the persistence SQL was not applied, there were no execution-marker-specific advisor findings.

Current project-wide security warnings remain independent backlog:

- public `SECURITY DEFINER` `public.coordination_read_barrier_h205f22()` executable by anon:
  https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- the same function executable by authenticated:
  https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- leaked-password protection disabled:
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- numerous `RLS enabled / no policy` INFO findings in intentionally closed/private surfaces:
  https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Performance advisor reported existing `unused_index` INFO backlog only. No indexes were removed without workload evidence:

https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Live post-step readback

Observed at `2026-08-28T00:26:20.99807+00:00`:

- W1 effective status: `READY`
- next mainline: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
- roadmap definition integrity: `true`
- roadmap drift: `false`
- fresh active claims: `0`
- stale persisted active claims: `1` (existing cleanup debt)
- supervisor active claims: `0`
- evidence-ready claims: `0`
- live execution-marker table exists: `false`
- live record function exists: `false`
- live readback function exists: `false`

This proves the prepared SQL was **not** applied live and the semantic slice did not mutate authoritative roadmap/evidence state.

## Exact next sequence

1. Run the already-prepared read-only W1 readiness workflow only through its explicit protected gate (`PREFLIGHT_W1_SSM_SAFETY_READINESS`).
2. After a real readiness PASS, implement/research the exact execution-marker SSM document and one concrete cryptographic callback-auth scheme.
3. Run adversarial tests and protected contract CI again.
4. Execute one real marker cycle under the appropriate live execution gate.
5. Persist the exact correlation receipt and perform independent persisted readback.
6. Correlate pre/post worker heartbeat witness with an independently observed provider reboot receipt.
7. Only then consider W1 `EVIDENCE_READY`; `VERIFIED` still requires supervisor acceptance and actual live evidence.

## Nonclaims at this checkpoint

- no real readiness dispatch was performed;
- no `SendCommand` was executed;
- no SSM document was created or updated;
- no callback endpoint was deployed;
- no Supabase DDL from the PREP file was applied;
- no execution evidence was ingested;
- no EC2 reboot occurred;
- no worker was admitted;
- no persistent worker proof exists;
- W1 is **not VERIFIED**.
