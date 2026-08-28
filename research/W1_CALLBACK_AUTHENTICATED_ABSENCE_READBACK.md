# W1 Callback Authenticated Absence Readback

Status: v10 source-only trust-boundary refinement. No provider mutation or protected live execution is performed by this slice.

## Problem

v9 treated an absent Edge Function or absent AWS SSM document as a collection failure because the point-read failed before the v8 readiness evaluator could receive `present=false`.

A naive fix would map HTTP 404 or AWS `InvalidDocument` directly to absence. Current provider documentation shows that this is not sufficiently strong:

- Supabase documents the function-list, function-metadata and function-body Management API GET surfaces under `edge_functions:read`, but the point-read documentation does not specify a 404 response as an authenticated absence contract.
- AWS `DescribeDocument` documents `InvalidDocument` for a missing document, but the exception message explicitly also covers a document that is not available to the caller. Treating that exception as proof of nonexistence could therefore hide an authorization boundary problem.

v10 uses authenticated inventory-first discovery instead.

## Supabase design

Official Management API surfaces:

- `GET /v1/projects/{ref}/functions` — list all functions, requires `edge_functions:read` / `edge_functions_read`.
- `GET /v1/projects/{ref}/functions/{function_slug}` — retrieve function metadata, same read scope.
- `GET /v1/projects/{ref}/functions/{function_slug}/body` — retrieve function body, same read scope.

References:
- https://supabase.com/docs/reference/api/v1-list-all-functions
- https://supabase.com/docs/reference/api/v1-get-a-function
- https://supabase.com/docs/reference/api/v1-get-a-function-body

The protected workflow first requires a successful authenticated list response. If the exact slug `w1-execution-callback` is absent from that list, v10 normalizes the Edge surface to `present=false` and the v8 guard emits `EDGE_FUNCTION_ABSENT` / `NOT_READY`.

If the exact slug is present, metadata and body point-reads must also succeed. The inventory and metadata must agree on id/slug/status/version/verify_jwt. The deployed body must contain exactly one file named `index.ts`; any hidden additional file is rejected. The `index.ts` bytes must match the reviewed Git source exactly.

This removes `npx supabase functions download` from the trusted collector path and therefore removes package-manager/CLI execution from Edge source readback.

401/403/429/5xx/network failures are not converted into absence: `curl --fail-with-body` terminates the protected workflow.

## AWS design

AWS `ListDocuments` returns documents in the current account/Region and supports filters including `Owner=Self` and `Name`. The Name filter is prefix-based, so v10 performs an additional exact-name match locally.

References:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_ListDocuments.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DocumentKeyValuesFilter.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeDocument.html
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_DescribeDocumentPermission.html

For each reviewed W1 callback document, the protected workflow first performs a successful authenticated:

`ListDocuments(Owner=Self, Name=<expected-name-prefix>)`

The normalizer then requires either:

1. no exact expected name — normalize `present=false`, or
2. exactly one exact expected name, owned by the expected AWS account, `DocumentType=Command`, `DocumentVersion=1` — then require successful exact `DescribeDocument`, `GetDocument` and `DescribeDocumentPermission` readbacks.

A returned `NextToken` is rejected by the normalizer so incomplete inventory cannot prove absence.

The workflow does not catch or reinterpret `InvalidDocument`, AccessDenied, networking failures or other AWS errors. If a document disappears after inventory but before exact readback, the workflow fails closed rather than silently changing a present observation into absence.

`ssm:ListDocuments` is a List action without resource-level scoping in the AWS service authorization table, so the inline session boundary adds `ssm:ListDocuments` on `Resource="*"`. Exact Describe/Get/Permission actions remain restricted to the two reviewed document ARNs. The raw inventory is deleted before artifact upload.

No write action is introduced.

## v10 normalizer

`controller/w1/w1_callback_provider_readback_guard_v2.py` composes the inventory-first observations into the existing v8 readiness schema.

It always reports:
- `absence_requires_authenticated_inventory=true`
- `provider_error_treated_as_absence=false`
- `database_mutation_authorized=false`
- `edge_deployment_authorized=false`
- `aws_mutation_authorized=false`
- `send_command_authorized=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

Even a fully present and matching provider readback remains `READY_CANDIDATE_NON_AUTHORITY`; it is not W1 verification.

## Adversarial coverage

v10 tests cover:
- authenticated Edge inventory absence -> `NOT_READY`;
- absent Edge inventory cannot carry fabricated point-read detail;
- Edge inventory/metadata drift -> reject;
- exact Edge source body required;
- hidden extra Edge files -> reject;
- authenticated AWS owned inventory absence -> `NOT_READY`;
- AWS prefix collisions do not count as the expected document;
- AWS owner/type/version drift -> reject;
- incomplete/paginated inventory -> reject;
- an error payload such as `InvalidDocument` cannot be used as an absence witness;
- fully present synthetic path remains non-authority;
- protected workflow contains no npm/npx/Supabase CLI download and no provider mutation action.

## Current live truth before v10

Authoritative Supabase roadmap projection at 2026-08-28T06:18:49Z still reports W1 `READY`, `verified_checkpoint_id=null`, zero fresh claims, and stale claim 32 as cleanup debt with no authority effect.

Live Supabase callback DB tables/RPCs and the `w1-execution-callback` Edge Function are absent. Safety verifications, reboot receipts and backend bindings remain zero.

No protected AWS readback has yet been performed, so v10 makes no claim about live AWS document presence.
