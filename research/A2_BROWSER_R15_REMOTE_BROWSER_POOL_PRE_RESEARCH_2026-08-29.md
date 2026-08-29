# A2 Browser R15 — Remote Browser Pool — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R14 `3b92715ef9f3a9a087cdb495191d05f2a0c1f10f`
Roadmap milestone: `R15_REMOTE_BROWSER_POOL`

## Goal

Build a typed pool/lease control plane over browser nodes without exposing raw CDP or creating a second browser protocol.

## Research findings

Playwright uses isolated BrowserContexts as the fundamental unit for independent sessions: cookies, local/session storage and related state are separated even when contexts share a browser process. Its guidance warns that cleanup-based reuse is weaker than fresh isolation.

Browserbase's production architecture similarly treats isolated browser sessions and clean execution environments as prerequisites for scale. Its current infrastructure material emphasizes warm/parallel fleets, observability and isolation rather than a shared mutable browser.

Playwright authentication guidance explicitly warns that persisted browser state may contain sensitive cookies and headers capable of impersonating a user. R15 therefore never automatically copies session/auth state between pool nodes.

The existing A2 Compute Browser already owns typed RPC, context management, process-incarnation identity and internal CDP transport. R15 must schedule these typed nodes rather than exposing another remote-debugging interface.

## Architecture decision

R15 is a pure pool state machine. It has no browser/network actuator callback.

An eligible node must declare:
- exact node id and monotonically increasing node epoch;
- exact process incarnation id;
- `REMOTE_BROWSER_NODE` surface;
- `HEALTHY` state;
- explicit capability set;
- `context_isolation=true`;
- `raw_engine_exposed=false`;
- bounded lease capacity.

A resource may have at most one active actuation lease. A lease binds exact node epoch + process incarnation. Dispatch validation checks that binding but returns routing eligibility only; browser authority remains upstream R8/R12.

If a node/lease disappears before actuation start, the lease terminates `NO_EFFECT`. If uncertainty occurs after actuation start, the lease terminates `AMBIGUOUS`. Neither state is automatically retried.

## Invariants

- `ONE_RESOURCE_ONE_ACTIVE_POOL_LEASE`.
- `POOL_LEASE_BINDS_EXACT_NODE_INCARNATION`.
- `UNISOLATED_NODE_IS_NEVER_ELIGIBLE`.
- `RAW_ENGINE_EXPOSED_NODE_IS_NEVER_ELIGIBLE`.
- `NODE_LOSS_AFTER_ACTUATION_START_IS_AMBIGUOUS`.
- `NODE_LOSS_BEFORE_ACTUATION_START_IS_NO_EFFECT`.
- `POOL_NEVER_AUTOMATICALLY_RETRIES_TERMINAL_LEASE`.
- `AUTH_STATE_IS_NEVER_AUTOMATICALLY_MIGRATED_BETWEEN_NODES`.
- `POOL_CONTROL_PLANE_HAS_ZERO_BROWSER_AUTHORITY`.
