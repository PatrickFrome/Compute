# A2 Compute Browser — B6 MULTI_BROWSER_POOL — Research + Architecture Plan

Status: RESEARCH + CODE PLAN (read-only toward upstream; no promotion; `authority_effect=false` for perception, durable `authority_effect=true` only for the Action Receipt contract, never derived from page data).
Date: 2026-08-29 (project timezone)
Branch: `work/a2-compute-browser-b4-parity`

Parent milestone: B5_COMPUTE_BROWSER_PRIMARY (completed)
Dependency: B5 local compute bridge + HTTP bridge

## B6 definition (from canonical addendum)

> `B6_MULTI_BROWSER_POOL` | scheduler over multiple local/remote browser-compute nodes

## Problem

B5 established the compute browser as the primary local executor with extension as compatibility node. A single compute browser instance is a single point of failure and capacity limit. B6 introduces a scheduler that can distribute work across multiple browser-compute nodes (local and eventually remote).

## Architecture

```text
METAENGINE SUPERVISOR
        |
DURABLE TASK / ACTION GRAPH
        |
ACTION ARBITER + LEASE
        |
A2 BROWSER PROTOCOL
    |            |             |
    |            |             +-- Remote Browser Node (B6)
    |            +-- Chrome Extension adapter (B5 compatibility)
    +-- A2 Compute Browser (B5 primary)
           |
           +-- Browser Node Registry (B6)
           |     |
           |     +-- Local Node (this instance)
           |     +-- Remote Nodes (future)
           |
           +-- Scheduler
           |     |
           |     +-- Health Monitor
           |     +-- Assignment Policy
           |
           +-- Browser Process Supervisor
           +-- ...
```

## Semantic Slice

The smallest B6 slice: **Local Node Registry + Health Probe + First-Available Assignment**

1. `BrowserNode` identity: stable `node_id`, `endpoint`, `capabilities`, `health`
2. `NodeRegistry`: register/deregister nodes, track health, assign targets
3. Health probe: uses existing `runtime.health` over HTTP bridge
4. Assignment policy: first healthy node with matching capability

## Invariants

- `NODE_IDENTITY_IS_STABLE`: node_id never changes for same physical browser node
- `HEALTH_IS_EPHEMERAL`: health status can change, never cached indefinitely
- `ASSIGNMENT_IS_FALLIBLE`: if no healthy node matches, actuation fails closed
- `LOCAL_NODE_IS_ALWAYS_REGISTERED`: the local compute browser auto-registers on startup
- `REMOTE_NODES_REQUIRE_AUTH`: future remote nodes must authenticate (not in this slice)

## Implementation Plan

1. `browser-shared/node-registry.mjs`: shared node identity + registry interfaces
2. `browser-compute/src/node-registry.mjs`: local implementation with health probes
3. `browser-compute/src/cli.mjs`: auto-register local node on startup
4. Tests: node registration, health probe, assignment, fail-closed on no healthy nodes

## Non-claims

- No remote transport in this slice
- No cross-node target migration
- No persistent node registry (in-memory only)
- No supervisor integration for node discovery
