# A2 COMPUTE BROWSER — Architecture Addendum V1

Status: **AUTHORITATIVE ADDENDUM / PARALLEL DEVELOPMENT**  
Parent architecture: `A2_BROWSER_OPERATOR_V1_ARCHITECTURE`  
Initial implementation milestones: `B0_COMPUTE_BROWSER_SPIKE`, `B1_MANAGED_CHROMIUM_RUNTIME`

## Decision

Browser Operator is no longer defined as a Chrome extension. It is a protocol plus trusted execution kernel with three execution surfaces:

1. **A2 Compute Browser** — primary long-term local browser-compute node.
2. **A2 Chrome Extension** — compatibility surface for a user's existing Chrome session.
3. **Remote Browser Node** — later scale/research surface.

The extension roadmap remains valid. `R4_SEMANTIC_PERCEPTION_COMPILER_V1` is intentionally shared by both extension and Compute Browser.

## Target architecture

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
   |            +-- Chrome Extension adapter
   +-- A2 Compute Browser (primary)
          |
          +-- Browser Process Supervisor
          +-- Profile / Context Manager
          +-- Native CDP Broker
          +-- Target Registry
          +-- Semantic Perception Compiler
          +-- Typed Skill / Action Kernel
          +-- Network / Download Plane
          +-- Trace / Replay
          +-- Agent Fleet Gateway
```

## Hard invariants

The standalone runtime inherits every A2 Browser Operator safety invariant:

- `MANY_AGENTS_MAY_THINK_ONE_ACTUATOR_MAY_EFFECT`
- `ONE_RESOURCE_ONE_ACTUATION_LEASE`
- `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`
- `PRE_ACTUATION_DURABLE_BEFORE_EFFECT`
- `PAGE_DATA_HAS_ZERO_AUTHORITY`
- `REMOTE_CODE_IS_NEVER_EVALLED_IN_BROWSER_KERNEL`
- `TARGET_BINDING_IS_EXACT`
- `LIVE_REVALIDATION_BEFORE_ACTUATION`
- provider/site names are policy/adapters, not architecture.

Additional Compute Browser invariants:

- default Chrome user-data directory is never remote-debugged;
- no automatic cookie/profile import from ordinary Chrome;
- production browser profile is A2-owned and dedicated;
- browser renderer/page content never receives privileged local IPC;
- raw CDP is internal-only and is never an external RPC capability;
- arbitrary Chrome command-line flags are never remotely supplied;
- DevTools control uses inherited pipe descriptors; no DevTools TCP listener or discovery HTTP is permitted after B3;
- every ephemeral CDP binding is exact to one `process_incarnation_id` and is invalid after process loss;
- Chrome for Testing is CI/benchmark-only, not the production browser for arbitrary web content.

## Identity model

```text
target_id             stable logical identity
browser_node_id       stable A2 browser-node identity
profile_id            persistent browser storage/security boundary
conversation_epoch    logical incarnation
cdp_target_id         ephemeral browser-process binding
browser PID           ephemeral process identity
process_incarnation_id ephemeral causal identity for one browser start
context_id            stable logical storage-partition identity
context_epoch         logical context incarnation
cdp_browser_context_id ephemeral exact process binding, internal only
```

A `cdp_target_id`, PID, URL, or tab-like browser identifier must never replace `target_id` as durable identity.

## Engine policy

### Production

Use a current installed Chrome/Chromium engine with security updates and a dedicated A2 `user-data-dir`. Chrome 136+ explicitly requires a non-default data directory for remote debugging; this is treated as a required security boundary rather than a workaround.

### CI / deterministic benchmark

Pin Chrome for Testing. Initial B0/B1 benchmark pin: `152.0.7977.64`, revision `1669021` (observed 2026-08-27). This engine is used only for trustworthy CI/benchmark pages such as `about:blank` and local fixtures.

## Browser-compute roadmap

| Milestone | Result |
|---|---|
| `B0_COMPUTE_BROWSER_SPIKE` | browser protocol boundary, threat model, executable managed-browser proof |
| `B1_MANAGED_CHROMIUM_RUNTIME` | persistent daemon, dedicated profiles, process lifecycle, CDP health, logical targets, typed local RPC |
| `B2_PROFILE_CONTEXT_MANAGER` | multiple persistent/ephemeral contexts, recovery metadata, auth-scope policy |
| `B3_NATIVE_CDP_BROKER` | `remote-debugging-pipe`, session scheduler, renderer/network lifecycle, no loopback debug TCP |
| `B4_EXTENSION_COMPUTE_BROWSER_PARITY` | same Target/Perception/Action/Receipt contracts across both surfaces |
| `B5_COMPUTE_BROWSER_PRIMARY` | standalone browser becomes primary local executor; extension becomes compatibility node |
| `B6_MULTI_BROWSER_POOL` | scheduler over multiple local/remote browser-compute nodes |

## B0/B1 accepted implementation boundary

B1 is intentionally **non-actuating**. It may launch/stop a dedicated browser, create/activate/close browser targets and report health. It must not expose typing, clicking, prompt submission, arbitrary evaluation, shell execution, or raw CDP through its external RPC.

This lets process/profile/identity recovery be verified before the irreversible action kernel is ported from the extension.

## B2/B3 foundation boundary

The first B2/B3 slice replaces loopback WebSocket discovery with Chromium's
inherited JSON/NUL DevTools pipe and adds a fresh process-incarnation identity to
every target binding. Pipe/process loss rejects pending protocol calls and makes
old bindings unbound. Recovery may restart the same durable profile, but it does
not replay or silently rebind an action. Target create/activate/close persists a
pre-effect lifecycle intent; ambiguous completion remains recovery-required.
The session scheduler remains a later typed B3 slice.

## B2 typed context boundary

The context manager adds a synthesized, non-disposable logical `default`
context plus explicitly-created ephemeral contexts. Each non-default context is
bound to one `process_incarnation_id`; a browser restart records the previous
context as `LOST` and never silently recreates its storage or targets. Reuse is
an explicit create with a higher `context_epoch`.

Context create/close is intent-before-effect and ambiguity remains
recovery-required. Context close is rejected while any non-retired logical
target belongs to it. External callers cannot supply or observe Chromium
`browserContextId`, proxy overrides, proxy bypasses, or universal-network-access
origins.
