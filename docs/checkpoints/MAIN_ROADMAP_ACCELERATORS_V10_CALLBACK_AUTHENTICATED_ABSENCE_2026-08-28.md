# MAIN ROADMAP ACCELERATORS V10 — W1 CALLBACK AUTHENTICATED ABSENCE CHECKPOINT

Date: 2026-08-28
Branch: `work/main-roadmap-accelerators-v10`
Verified semantic source SHA: `d65af22cbf050e4e5f023d761774ea762ff3e82b`
Verified semantic source tree: `3efb3ea2c7de12d68a8b93ea461fee40a032c43a`
Base checkpoint: `fcbf05d2d302ee5415d261128b608a224366db22`

## Implemented boundary

v10 refines the v9 protected callback provider collector so authenticated provider-level absence becomes explicit non-authority `NOT_READY` instead of an ambiguous collection failure.

New source:
- `controller/w1/w1_callback_provider_readback_guard_v2.py`
- `tests/test_w1_callback_provider_readback_guard_v2.py`
- `.github/workflows/w1-callback-protected-readback-v2.yml`
- `research/W1_CALLBACK_AUTHENTICATED_ABSENCE_READBACK.md`

The design deliberately rejects the weaker shortcut of interpreting point-read 404 / AWS `InvalidDocument` as proof of absence. Provider documentation does not make those error surfaces strong enough to distinguish nonexistence from access/transport problems.

Instead v10 requires authenticated inventory-first discovery.

## Supabase Edge inventory contract

The protected collector first performs a successful read-only function inventory. If exact slug `w1-execution-callback` is absent from that authenticated list, Edge is normalized as `present=false` and the existing v8 readiness evaluator emits `EDGE_FUNCTION_ABSENT` / `NOT_READY`.

If present, inventory and point metadata must agree on identity/state/version/JWT posture, the read-only function-body endpoint must succeed, and the deployed file set must be exactly one `index.ts` whose bytes equal the reviewed Git source.

The v9 `npx supabase functions download` path is removed from v10. No npm/package-manager or Supabase CLI code executes inside the protected Edge readback zone.

## AWS inventory contract

For each reviewed callback document, v10 first uses authenticated `ssm:ListDocuments` filtered by `Owner=Self` and the expected Name prefix, then exact-matches the expected document name locally.

- no exact expected name -> `present=false` / non-authority `NOT_READY`;
- exactly one expected document -> require exact owner, `Command`, version 1, then successful exact `DescribeDocument`, `GetDocument`, and `DescribeDocumentPermission` validation;
- prefix collisions do not count as the reviewed document;
- any `NextToken` is rejected as incomplete inventory;
- provider errors are never converted into absence.

`ssm:ListDocuments` is a List action without resource-level restriction, so the inline session policy permits only that action on `Resource=*`; exact point-read actions remain restricted to the two reviewed SSM document ARNs.

No AWS mutation action was added.

## Fail-closed / adversarial coverage

v10 tests verify:
- authenticated Edge inventory absence -> `NOT_READY`;
- absent Edge inventory cannot carry fabricated detail payloads;
- inventory/metadata drift -> reject;
- hidden extra Edge file -> reject;
- exact deployed source bytes required;
- authenticated AWS owned-inventory absence -> `NOT_READY`;
- AWS prefix collision != expected document;
- owner/type/version drift -> reject;
- paginated/incomplete inventory -> reject;
- `InvalidDocument`-like error payload cannot be used as an absence witness;
- full synthetic present path remains non-authority;
- trusted workflow contains no npm/npx/CLI function download and no provider mutation action;
- transport/auth/provider command failures remain hard failures.

Every output keeps:
- `database_mutation_authorized=false`
- `edge_deployment_authorized=false`
- `aws_mutation_authorized=false`
- `send_command_authorized=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

## Exact CI evidence

Workflow: `W1 Callback Protected Readback V2`
Run: `33147874700`
Head SHA: `d65af22cbf050e4e5f023d761774ea762ff3e82b`
Overall conclusion: `success`

Jobs:
- `contract-tests` job `98772834427`: `success`
- `protected-readback` job `98772858407`: `skipped`

The skipped protected job is intentional for a push event. Therefore this checkpoint proves source and contract behavior only, not live protected AWS/OIDC/provider execution.

## Live Supabase post-readback

Authoritative projection observed at `2026-08-28T06:26:44.335573+00:00` still shows:
- W1 effective status = `READY`
- W1 `verified_checkpoint_id = null`
- W1 remains `next_mainline`
- roadmap definition integrity = true
- fresh active claims = 0
- stale persisted claim #32 remains cleanup debt only with no authority effect
- callback key table absent
- callback receipt table absent
- callback RPC count = 0
- safety verifications = 0
- reboot receipts = 0
- backend bindings = 0

A fresh live Edge inventory after the v10 source step still contains no `w1-execution-callback` function. No Edge deployment occurred.

## Advisor post-audit

Security advisor observed at `2026-08-28T06:27:06.745Z`: no callback-specific new finding. Pre-existing warnings remain for executable `public.coordination_read_barrier_h205f22()` SECURITY DEFINER exposure and leaked-password protection disabled, plus pre-existing RLS INFO findings.

Performance advisor observed at `2026-08-28T06:28:14.087Z`: only pre-existing unused-index INFO findings; no callback-specific regression. No index is removed without workload evidence.

## Authority statement

No callback DDL was applied. No Edge function was deployed. No AWS document was created, shared or modified. No protected callback workflow was manually dispatched. No AWS SSM command/session/reboot occurred. No host admission occurred.

Current truth:

`W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`

`W1 VERIFIED = false`

`callback_ingress_live_readiness = NOT_READY`

## Next bounded slice

Before any protected provider readback is dispatched, validate the credential-free GitHub Environment boundary itself:
1. exact Environment identity `w1-callback-readback`;
2. deployment branch policy restricts execution to `main`;
3. required reviewers / environment protection semantics are explicit and fail closed;
4. OIDC subject expectation is tied to the actual Environment deployment context;
5. no AWS/Supabase secret or credential is needed for the preflight;
6. only after that preflight can a later protected live readback be considered.