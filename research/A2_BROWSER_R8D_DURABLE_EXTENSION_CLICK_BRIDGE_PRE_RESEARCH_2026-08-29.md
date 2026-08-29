# A2 Browser R8D — Durable Extension CLICK Bridge — Pre-Implementation Research

Date: 2026-08-29
Parent VERIFIED: R8C `fd1204431d09c2e837b82b9429e1ffad9cdfff58`

## Problem

R8A/R8B provide an append-only durable action lifecycle and a pre-effect fence. R8C provides a real staged-MV3 typed CLICK executor with `COMMITTED | NO_EFFECT | AMBIGUOUS` behavior and real Chromium physical-effect evidence. The remaining R8 gap is to connect those two planes without making the MV3 service worker a second durable authority brain or weakening the signed supervisor command boundary.

Required lifecycle:

```text
DurableActionFence
  -> durable pre-effect seal
  -> fresh authority
  -> one typed remote command
  -> signed supervisor/device transport
  -> local CONTROL + armed lease gate
  -> A2_OPERATOR_TYPED_CLICK_V1
  -> typed result
  -> durable terminal graph receipt
```

## Primary-source findings

### Manifest V3 lifecycle

Extension service workers are terminable and global variables are not durable state. A crash/restart-safe action journal must therefore remain outside the service worker. MV3 is the effect executor, not the durable source of truth.

### Chromium privilege separation

Chromium's browser process brokers privileged operations for less-trusted renderer/page content. A2 should preserve the same direction: page-derived semantic data is input only; authority and durable intent stay in a trusted external/control plane.

### Native Messaging

Chrome Native Messaging would add a host manifest, an OS installation surface, a new process/protocol and `nativeMessaging` permission. It is a valid future transport but unnecessary for this slice because A2 already has a signed, nonce-fenced supervisor transport to the installed extension.

### Existing A2 transport

The canonical runtime packages `supervisor-device-transport.js` and `supervisor-authority.js`. Requests authored against the legacy supervisor URL are transparently remapped to active `a2-browser-supervisor-v4`, signed by the enrolled P-256 device identity and nonce-fenced server-side. Commands are leased only when their required supervisor mode / armed state is satisfied.

The command table/RPC accepts bounded typed actions generically; no schema migration is necessary for `TYPED_CLICK`. The active Edge function must classify `TYPED_CLICK` as an authority action so result metadata cannot accidentally report a physical actuation command as non-authority.

## Options

### A — External durable brain + existing signed supervisor command plane

Security: high. Reliability: high. TCB increase: small. Complexity: moderate. Observability: high. Testability: high.

The external adapter converts one R8B actuator invocation into one bounded `TYPED_CLICK` command. The installed extension, after existing server lease + local CONTROL gate, invokes the already-verified `A2_OPERATOR_TYPED_CLICK_V1` function directly. The extension does not persist graph state and does not retry.

### B — Persist R8 graph inside MV3 storage

Rejected. It creates dual authoritative journals, weaker persistence semantics than the already-proven fsync/hash-chain store, and exposes correctness to service-worker termination/restart races.

### C — Add Native Messaging host now

Rejected for R8D. It expands permissions, installation complexity, process TCB and supply chain without solving a gap the signed supervisor transport already solves.

### D — External runtime drives CDP directly

Rejected. It bypasses the extension compatibility/authority surface, duplicates R8C live revalidation and broadens privileged browser control.

## Decision

Implement option A.

## New invariants

- `MV3_IS_EXECUTOR_NOT_DURABLE_BRAIN`.
- `DURABLE_SEAL_PRECEDES_REMOTE_ACTUATOR_ENQUEUE`.
- `ONE_FENCE_INVOCATION_ONE_TYPED_CLICK_COMMAND`.
- `REMOTE_TRANSPORT_NEVER_RETRIES_PHYSICAL_ACTION`.
- `TYPED_CLICK_REQUIRES_SIGNED_COMMAND_LEASE_AND_LOCAL_CONTROL`.
- `TYPED_CLICK_REQUIRES_ARMED_STATE`.
- `PAGE_DATA_HAS_ZERO_AUTHORITY`.
- `ACTION_ID_IS_CORRELATION_NOT_PAGE_IDEMPOTENCY`.
- `MALFORMED_OR_MISMATCHED_REMOTE_OUTCOME_BECOMES_AMBIGUOUS`.
- `NO_EFFECT_REQUIRES_PHYSICAL_DISPATCH_STARTED_FALSE`.
- `COMMITTED_OR_AMBIGUOUS_REQUIRES_PHYSICAL_DISPATCH_STARTED_TRUE`.
- `NO_AUTOMATIC_RETRY_AFTER_AMBIGUOUS_EFFECT`.

## Minimal semantic slice

1. Add a dependency-free shared `ExtensionTypedClickActuatorV1` adapter. It accepts an injected one-shot command transport and strictly validates action correlation and outcome consistency.
2. Add `TYPED_CLICK` to the canonical packaged supervisor authority executor. It requires local `CONTROL`, `armed=true`, and invokes the already-verified `globalThis.A2_OPERATOR_TYPED_CLICK_V1` exactly once.
3. Classify `TYPED_CLICK` as authority-bearing in the active signed Edge supervisor.
4. Add adversarial adapter/extension tests and an end-to-end real Chromium durable graph canary proving `seal -> one click -> terminal durable receipt` with no harness `Input.*` dispatch.
5. Preserve R8A/R8B/R8C regressions, deterministic evidence and provenance.

## Explicit non-claims

R8D does not claim page-level exactly-once behavior, general OOPIF actuation, generic remote CDP, arbitrary browser operations, distributed durability, or any new authority from page content. It does not make the extension a durable journal.