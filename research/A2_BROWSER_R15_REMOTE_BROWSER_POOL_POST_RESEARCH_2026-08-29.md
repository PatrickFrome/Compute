# A2 Browser R15 — Remote Browser Pool — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R14 `3b92715ef9f3a9a087cdb495191d05f2a0c1f10f`

## Result

R15 implements a pure typed remote-browser pool state machine. It registers only explicit `REMOTE_BROWSER_NODE` descriptors, filters eligibility by health, context isolation, raw-engine non-exposure, capability fit and capacity, then issues one active lease per resource with exact node-epoch and process-incarnation binding.

The pool does not invoke browser, network, process or model APIs. Dispatch validation is routing-only and explicitly returns `authority_effect=false` and `actuation_eligible=false`; actual browser authority remains in the R8/R12 chain.

## Research re-check

Playwright's current isolation model confirms that BrowserContext-level session separation is the appropriate primitive for independent browser work and that clean isolation is safer than best-effort cleanup/reuse.

Browserbase's current production material independently emphasizes isolated browser sessions, clean execution state and horizontal concurrency as baseline requirements for browser-agent infrastructure. R15 encodes those properties as eligibility gates rather than performance preferences.

Playwright authentication guidance warns that saved browser state may contain credentials/cookies capable of impersonation. R15 therefore has no auth-state migration primitive and reports `auth_state_migration=false` in its snapshot.

## Failure semantics

A lease has a strict pre/post-effect boundary:
- node loss or expiry while `RESERVED` => terminal `NO_EFFECT`;
- node loss or expiry while `IN_FLIGHT` => terminal `AMBIGUOUS`;
- terminal leases are immutable;
- `automatic_retry_allowed=false` always.

This preserves R8's ambiguity semantics across node-level failures rather than treating remote infrastructure failover as a reason to repeat an external browser effect.

## Confirmed invariants

- `ONE_RESOURCE_ONE_ACTIVE_POOL_LEASE`.
- `POOL_LEASE_BINDS_EXACT_NODE_INCARNATION`.
- `UNISOLATED_NODE_IS_NEVER_ELIGIBLE`.
- `RAW_ENGINE_EXPOSED_NODE_IS_NEVER_ELIGIBLE`.
- `NODE_LOSS_AFTER_ACTUATION_START_IS_AMBIGUOUS`.
- `NODE_LOSS_BEFORE_ACTUATION_START_IS_NO_EFFECT`.
- `POOL_NEVER_AUTOMATICALLY_RETRIES_TERMINAL_LEASE`.
- `AUTH_STATE_IS_NEVER_AUTOMATICALLY_MIGRATED_BETWEEN_NODES`.
- `POOL_CONTROL_PLANE_HAS_ZERO_BROWSER_AUTHORITY`.

## R16 handoff

R16 should perform a deterministic two-stage decision: first filter out every executor that violates trust, capability, health, locality/privacy or exact-incarnation requirements; only then score the remaining eligible executors on policy-controlled factors such as locality, load and observed latency. A faster ineligible executor must never beat a slower eligible one.
