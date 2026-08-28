# MAIN ROADMAP ACCELERATORS V7 — W1 CALLBACK SSM PROVISIONING CHECKPOINT

Date: 2026-08-28
Branch: `work/main-roadmap-accelerators-v7`
Verified semantic source SHA: `04c32f4bcfc18b8002f957a846f9bea30c77686c`
Verified semantic source tree: `a92b576aa3a73a37f47a43e7717322fb404a0ed4`
Base checkpoint: `4b765c78f3d218cd594d762c8f46f7460633f177`

## Implemented source boundary

This slice adds create-once, readback-first source contracts for the two W1 callback-authentication SSM Command documents:

1. `Metaengine-W1-Callback-Key-Enroll-H205F22`
2. `Metaengine-W1-Execution-Marker-H205F22`

Added:
- `controller/w1/aws_ssm_callback_document_provision_guard.py`
- `tests/test_w1_aws_ssm_callback_document_provision_guard.py`
- `.github/workflows/w1-aws-ssm-callback-documents-provision-contract.yml`
- `research/W1_CALLBACK_DOCUMENT_PROVISIONING.md`

The provisioning guard is offline/non-authority. It builds and validates the only accepted create-once contract but does not call AWS.

## Provisioning invariants

The source contract requires:
- account-owned SSM `Command` document;
- repository-reviewed semantic JSON;
- `/AWS::EC2::Instance` target type;
- document version `1`;
- latest version `1`;
- default version `1`;
- `Active` readback state;
- AWS `Sha256` document hash metadata;
- exact GetDocument semantic-content equality with repository source;
- callback-key enrollment remains parameterless;
- execution-marker parameters remain exactly the reviewed five non-secret `ENV_VAR` parameters with strict patterns;
- no compatibility fallback to raw `{{parameter}}` shell substitution.

The generated provisioning policy template contains only:
- `ssm:CreateDocument` for the exact document ARN with exact request tags and `ssm:DocumentType=Command`;
- `ssm:DescribeDocument` / `ssm:GetDocument` for the same ARN.

It does not contain document update/default-version mutation, delete, permission sharing/resource-policy mutation, `SendCommand`, or `StartSession` authority.

A verified synthetic/caller-supplied AWS response receipt remains explicitly non-authority:
- `document_provisioned=false`;
- `document_provisioned_authoritatively_verified=false`;
- `runtime_execution_authority=false`;
- `provider_identity_verified=false`;
- `persistent_worker_proof=false`;
- `worker_admitted=false`;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`.

## Research basis

Research was refreshed against current AWS documentation for:
- Systems Manager `CreateDocument`, `DescribeDocument`, and `GetDocument`;
- Systems Manager IAM resource/condition support, including request tags, tag keys and `ssm:DocumentType`;
- document parameters with `interpolationType=ENV_VAR`, `allowedPattern`, and the SSM Agent 3.3.2746.0 compatibility boundary;
- `SendCommand` exact document-version/hash semantics for the later, separate runtime boundary.

The compatibility decision remains fail-closed: an old agent must fail rather than reintroduce raw shell parameter substitution.

## Exact CI evidence

Two early runs failed only in the workflow's own non-authority self-audit:
- run `33141489629` on `ad7d65d15bc26f05a44e59bb8b1b405ed5e9df7c` — compile and fail-closed contract tests passed; self-audit searched its own forbidden-literal list;
- run `33141525777` on `ece6e57dac2d822946736f47cc08bc541f95cc2e` — compile and contract tests again passed; self-audit marker literal was still self-referential.

Neither failed run is counted as green.

Final exact run:
- run `33141552572`;
- job `98753289684`;
- head SHA `04c32f4bcfc18b8002f957a846f9bea30c77686c`;
- conclusion `success`.

Successful steps include exact source identity, guard compilation, fail-closed callback provisioning/callback-auth contracts, and non-authority workflow proof.

## Live readback after the source slice

Read-only Supabase inspection at `2026-08-28T04:22:50.497128Z` showed:
- W1 next mainline remains `READY`, not VERIFIED;
- canonical First Real Linux Worker remains `PLANNED`;
- fresh active roadmap claim count remains `0`;
- stale persisted claim `32` remains cleanup debt with `stale_rows_authority_effect=false`;
- supervisor active claims/directives remain empty;
- callback key table: absent;
- callback receipt table: absent;
- callback key registration RPC: absent;
- callback receipt recording RPC: absent;
- Linux safety verifications: `0`;
- backend bindings: `0`;
- reboot receipts: `0`;
- admitted non-revoked cpu-local workers: `0`.

Therefore this slice produced no live AWS or Supabase authority effect.

No AWS `CreateDocument`, `SendCommand`, `StartSession`, reboot, or worker admission was performed. No callback DDL was applied and no callback Edge function was deployed.

## Advisor post-audit

No callback-specific new live finding exists because no DDL/deploy was applied.

Pre-existing security findings remain, notably:
- public anon execution of `public.coordination_read_barrier_h205f22()` as SECURITY DEFINER;
- authenticated execution of the same SECURITY DEFINER function;
- leaked-password protection disabled;
- pre-existing RLS-enabled/no-policy INFO notices.

Performance advisors remain pre-existing unused-index INFO findings. No index is removed without workload proof.

## Current truth

`W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`

`W1 VERIFIED = false`

This checkpoint proves source-contract readiness for create-once callback SSM document provisioning only. It does not prove that either document exists in AWS, that a callback key is enrolled on a persistent host, that a signed callback was accepted, or that the worker survived a provider reboot.

## Next bounded slice

Build a callback-ingress readiness/readback guard that separates three independent readiness surfaces:
1. Supabase callback persistence objects and grants;
2. deployed Edge callback source/config identity;
3. AWS callback documents/readback identity.

That readiness guard must remain non-authority and must report `NOT_READY` until trusted live readback proves every surface. Provider mutation remains outside the guard.