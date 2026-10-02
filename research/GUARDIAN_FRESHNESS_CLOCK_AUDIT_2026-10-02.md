# Guardian freshness clock audit — 2026-10-02

Base runtime source reviewed: `bf21d71b6dc674c376bd396487b5efc134d0a3e9`  
Runtime PR under qualification: #1090  
Analysis branch only: `analysis/guardian-freshness-clock-bf21d71b`

## Finding

The Guardian observer currently uses one injected wall-clock function (default `Date.now`) both to:
- measure TTL age; and
- render `observed_at` / `expires_at`.

Its freshness predicate is effectively:

```js
at - observedAtMs <= ttl
```

A backward system-clock adjustment makes the age negative. Negative age still satisfies `<= ttl`, so an old positive observation can remain classified as fresh until wall time catches back up.

This is not currently an admission bypass because Guardian heartbeat status is diagnostic-only and Supervisor admission remains independently closed. It is nevertheless the wrong primitive for proof freshness and should be corrected before this diagnostic is ever used as an authority input.

## Primary-source research

### Stable elapsed-time measurement should use a monotonic clock

W3C High Resolution Time defines `performance.now()` on a monotonic clock that does not decrease due to system clock adjustments or clock skew. It explicitly contrasts this with `Date.now()`, whose value can move backward or forward when the wall clock is adjusted.

References:
- https://www.w3.org/TR/hr-time-2/
- https://www.w3.org/TR/2026/WD-hr-time-3-20260225/

Design consequence:
- wall-clock time is useful for operator-readable timestamps;
- elapsed validity windows should not rely on wall-clock monotonicity.

### Lease-style validity is measured from a renewal observation

Kubernetes Lease models liveness with a holder identity, renewal time, lease duration and transition count. Lease validity is evaluated relative to the last observed renewal; coordinated leader election additionally uses optimistic concurrency/resource version to prevent concurrent stale ownership.

References:
- https://kubernetes.io/docs/reference/kubernetes-api/coordination/lease-v1/
- https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/

Design consequence:
- Guardian observation freshness should be a bounded lease-like local fact;
- observation revision identifies accepted transitions;
- future server-side authority must also fence stale/out-of-order revisions.

## Recommended local freshness model

Use two clocks with different purposes:

1. `monotonicNow()` — default `performance.now()` / equivalent process-local monotonic timer;
2. `wallNow()` — default `Date.now()` for serialized operator timestamps.

Store both when an observation is accepted:
- `observedMonotonicMs`
- `observedWallMs`

A current positive observation is fresh only if **both** conditions hold:

```
monotonic_age >= 0 && monotonic_age <= ttl
wall_age      >= 0 && wall_age      <= ttl
```

Why both:
- monotonic age rejects wall-clock rollback from extending validity;
- wall age makes a long system suspend fail closed even on platforms where a process-local monotonic timer might not advance exactly as expected through sleep;
- forward wall jumps fail closed and cause a new probe rather than extending proof;
- process restart clears the in-memory observer anyway, so monotonic timestamps never need cross-process meaning.

Do not add a permissive clock-skew grace to positive proof. A clock discontinuity should cause HOLD + refresh, not extend READY.

## Minimum regression set

A bounded successor should prove:
- backward wall-clock jump immediately invalidates current proof;
- forward wall-clock jump beyond TTL invalidates proof;
- monotonic age beyond TTL invalidates proof even if wall time appears unchanged;
- negative monotonic age fails closed;
- ordinary no-skew observation remains fresh for the original TTL;
- serialized `observed_at` and `expires_at` remain wall-clock timestamps;
- cached positive state is not made durable across process restart;
- local clock hardening does not alter Supervisor admission or trigger physical effects.

## Optional resume invalidation

Electron main process can additionally invalidate cached Guardian observation on an explicit OS resume event before publishing a new heartbeat. This is defense in depth, not a replacement for the dual-clock predicate.

Adopt only if the existing main-entry power/resume lifecycle already has a single owner. Do not introduce a second power-monitor loop solely for Guardian; reuse the existing lifecycle/event path or omit this optimization.

## Future distributed boundary

Even perfect local TTL measurement cannot prevent an older same-plane state write from arriving at the server after a newer one. The diagnostic already carries a process-local `observation_revision`.

Before Guardian becomes an admission input:
- persist an exact device/browser-incarnation binding;
- compare observation revision server-side;
- reject or no-op lower/equal stale revisions;
- retain server receive time as separate evidence;
- never infer authority from client wall-clock timestamps.

## Decision

Do not edit #1090 while its exact-head package/Windows matrix is running. If #1090 qualifies, implement clock rollback hardening as a separate successor with a new package identity. If #1090 fails for another reason first, fold the clock fix into the next source head only after consuming/retiring any already-built package identity.
