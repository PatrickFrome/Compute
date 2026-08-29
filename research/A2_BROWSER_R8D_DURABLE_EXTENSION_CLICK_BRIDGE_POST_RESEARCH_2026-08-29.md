# A2 Browser R8D — Durable Extension Click Bridge — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R8C `fd1204431d09c2e837b82b9429e1ffad9cdfff58`
Initial R8D candidate: `baaeef497e944aeb0acaba5aa170b20fe8ac1cd7`
Initial R8D workflow: `33236278854` SUCCESS
Initial artifact: `9710011888`, digest `sha256:49df74c7fa70ad81571a03ae2856463019c867de8dde02323ad80a0328e6d459`

## Result

R8D closes the durable-brain -> MV3-executor boundary without moving the durable action graph into the Manifest V3 service worker.

The shared `ExtensionTypedClickActuatorV1` emits one `TYPED_CLICK` supervisor command per fence invocation, requires `CONTROL` and local `armed=true`, performs no retry, and normalizes only `COMMITTED`, `NO_EFFECT`, or `AMBIGUOUS` results. Transport or malformed-completion uncertainty is therefore handled by the outer R8B durable fence as terminal ambiguity rather than replay.

The canonical extension executor captures a fresh perception frame after the remote command has been leased, resolves a unique semantic target, and then invokes the already-verified R8C typed click executor. Remote payloads do not carry a perception timestamp or backend node id.

## Primary-source re-check

Chrome MV3 service workers remain event driven and must not be treated as the durable transaction log. Chrome alarms can wake extension work but can be delayed and are not an exactly-once effect scheduler. The R8 durable graph therefore remains outside the extension.

`chrome.debugger` remains a CDP transport, not a page transaction protocol. R8D preserves the R8C rule that an acknowledged press/release is not promoted into arbitrary page-level exactly-once semantics.

## Server authority hardening discovered after implementation

The first code candidate exposed a control-plane drift risk: extension-side `AUTHORITY_ACTIONS` contained `TYPED_CLICK`, while the production Edge function still held an older local action set and passed a boolean `p_authority_effect` into `h205f22_a2_browser_supervisor_complete_v4`.

Rather than merely duplicate the new action into another Edge allowlist, production was hardened so the database — which owns the authoritative command row — computes completion `authority_effect` from the persisted command action. The Edge-supplied boolean remains in the RPC ABI for compatibility but is no longer authoritative.

Migration `20260829054500_a2_browser_r8d_typed_click_server_authority.sql` also:

- adds `TYPED_CLICK` to the command-table action constraint;
- adds strict enqueue validation for platform and exactly `{action_id, role, accessible_name}` payload fields;
- assigns `TYPED_CLICK` action-budget cost 4;
- keeps `TYPED_CLICK` unavailable outside `CONTROL` through the existing lease policy;
- canonicalizes the stored completion receipt's top-level `authority_effect` from the persisted action.

## Live database canary

A disposable workspace/client canary was run against production Supabase after the migration.

Observed sequence:

1. enqueue `TYPED_CLICK` -> `PENDING`, `authority_effect=false`;
2. lease in `CONTROL` -> command leased, requested budget cost `4`;
3. complete successfully while deliberately passing `p_authority_effect=false` and a receipt containing `authority_effect=false`;
4. persisted command row -> `COMPLETED`, `authority_effect=true`;
5. persisted receipt -> `authority_effect=true`.

The canary rows were deleted after readback and zero canary rows remained.

This proves that final authority classification is server-owned rather than caller-declared.

## Confirmed invariants

- `MV3_IS_EXECUTOR_NOT_DURABLE_BRAIN`.
- `ONE_DURABLE_FENCE_INVOCATION_ONE_REMOTE_TYPED_CLICK`.
- `NO_AUTOMATIC_RETRY_AFTER_REMOTE_DISPATCH_UNCERTAINTY`.
- `CONTROL_AND_LOCAL_ARM_REQUIRED_FOR_REMOTE_TYPED_CLICK`.
- `FRESH_EXTENSION_PERCEPTION_AFTER_COMMAND_LEASE`.
- `REMOTE_PAYLOAD_CARRIES_NO_BACKEND_NODE_AUTHORITY`.
- `DATABASE_OWNS_FINAL_COMMAND_AUTHORITY_CLASSIFICATION`.
- `EDGE_CALLER_BOOLEAN_CANNOT_DOWNGRADE_TYPED_CLICK_AUTHORITY_EFFECT`.
- `TYPED_CLICK_COSTS_FOUR_BUDGET_UNITS`.
- `PAGE_EXACTLY_ONCE_SEMANTICS_NOT_CLAIMED`.

## Remaining R8 closure gate

Run the R8D exact-head workflow after this migration/post-research commit and retain artifact/provenance. If green, R8 can be promoted as authoritative with R9 as the next milestone. A physical R8C click has already been verified in real staged MV3; R8D adds the durable/signed command bridge and server-owned authority classification around that verified executor.
