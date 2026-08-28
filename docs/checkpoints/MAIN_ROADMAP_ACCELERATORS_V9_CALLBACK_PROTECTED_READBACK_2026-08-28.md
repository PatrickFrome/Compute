# MAIN ROADMAP ACCELERATORS V9 — W1 PROTECTED CALLBACK READBACK CHECKPOINT

Date: 2026-08-28
Branch: `work/main-roadmap-accelerators-v9`
Verified semantic source SHA: `a7c72a3c62ba34771a9e48397789be17be1ccd10`
Verified semantic source tree: `5268334c109c15fd56be6282b863142f7078b027`
Base checkpoint: `09d0794828b91e75b5306cbf4aac8ae6816cc637`

## Implemented boundary

v9 adds a protected, read-only provider collection contract around the v8 non-authority readiness evaluator:

- `controller/w1/w1_callback_provider_readback_guard.py`
- `controller/w1/w1_callback_db_readback.sql`
- `tests/test_w1_callback_provider_readback_guard.py`
- `.github/workflows/w1-callback-protected-readback.yml`
- `research/W1_CALLBACK_PROTECTED_READBACK.md`

The normalizer recomputes reviewed Git blob identities, validates Postgres privilege readback, validates exact Supabase Edge deployment/source identity, validates exact AWS SSM document identity and sharing posture, then invokes the v8 readiness guard. It cannot grant provider mutation or W1 authority.

## GitHub OIDC hardening

Repository identity is pinned to:
- repository: `PatrickFrome/Compute`
- repository ID: `1341371143`
- repository owner ID: `20597814`
- protected Environment: `w1-callback-readback`
- protected ref: `refs/heads/main`
- audience: `sts.amazonaws.com`

Before AWS STS, the protected job requests an actual GitHub OIDC token, never prints it, decodes its claims locally, requires the exact audience/subject/repository/repository-ID/owner-ID/environment/ref context, and deletes the temporary token response. The expected subject is supplied by the protected Environment as `W1_AWS_OIDC_SUB` rather than guessed in source.

The AWS inline session boundary permits only:
- `ssm:DescribeDocument`
- `ssm:GetDocument`
- `ssm:DescribeDocumentPermission`

for the two exact W1 callback documents. It contains no `SendCommand`, `StartSession`, reboot, document mutation or database mutation.

## Exact CI evidence

Final exact GitHub Actions run for the verified semantic source:
- workflow: `W1 Callback Protected Readback`
- run: `33147438133`
- head SHA: `a7c72a3c62ba34771a9e48397789be17be1ccd10`
- contract job: `98771472378` — `success`
- protected-readback job: `98771496623` — `skipped`
- overall conclusion: `success`

The skipped protected job is intentional on push: the green result proves the source/contract path only and does not claim live OIDC/AWS/Supabase credential execution.

## Live read-only Supabase truth

Authoritative readback at `2026-08-28T06:18:49.329982+00:00` shows:
- `W1_PERSISTENT_LINUX_WORKER_SAFETY` effective status = `READY`;
- `verified_checkpoint_id = null`;
- W1 remains the next mainline milestone;
- roadmap definition integrity = true;
- fresh active claim count = `0`;
- stale persisted claim `32` remains cleanup debt only;
- stale rows have `authority_effect=false`;
- no active supervisor directives;
- callback key table absent;
- callback receipt table absent;
- callback RPC count = `0`;
- Linux safety verifications = `0`;
- reboot receipts = `0`;
- backend bindings = `0`.

The raw milestone row still physically stores an older `IN_PROGRESS` value, but lease-truth v2 authoritative projections correctly yield W1 `READY`; the stale physical row is not treated as authority.

A live Supabase Edge list also shows no `w1-execution-callback` deployment. Therefore live callback readiness is conclusively `NOT_READY` from Supabase surfaces alone. No protected AWS readback was run in v9.

## Advisor post-audit

Security advisors observed at `2026-08-28T06:19:17.339Z` show no callback-specific new finding. Pre-existing WARNs remain for public/authenticated execution of `public.coordination_read_barrier_h205f22()` as SECURITY DEFINER and leaked-password protection being disabled; existing RLS-enabled/no-policy INFO findings also remain.

Performance advisors observed at `2026-08-28T06:20:10.691Z` remain pre-existing unused-index INFO findings. No index is removed without workload evidence.

## Research conclusions

Current provider documentation supports the next bounded improvement:
- Supabase exposes function metadata and function body through separate read-only Management API GET endpoints requiring `edge_functions:read` / `edge_functions_read`; no package-manager/CLI execution is needed for source readback.
- AWS `DescribeDocument` and `DescribeDocumentPermission` return `InvalidDocument` with HTTP 400 when the named SSM document does not exist.

That means authenticated provider-level absence can be normalized as explicit `present=false` / `NOT_READY`, while authorization, network and other failures must continue to fail closed.

## Authority statement

No callback DDL was applied. No Edge function was deployed. No AWS document was created or modified. No SSM `SendCommand`, session, reboot, host admission or W1 verification occurred.

Current truth:

`W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`

`W1 VERIFIED = false`

`callback_ingress_live_readiness = NOT_READY`

## Next bounded slice

v10 must:
1. normalize authenticated Edge absence and exact AWS `InvalidDocument` into non-authority `NOT_READY` rather than collection failure;
2. distinguish absence from 401/403/429/5xx/network/provider failures, which remain hard failures;
3. replace `npx supabase functions download` with direct read-only Management API function-body retrieval;
4. reject hidden extra Edge deployment files;
5. preserve every non-authority and no-mutation invariant.