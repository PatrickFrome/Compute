# Guardian heartbeat observation checkpoint — 2026-10-02

## Durable continuation point

Runtime/research source before this checkpoint:
`10ee7fc77c56f805a3e1265e60e9c6e1fbd07d38`

Branch: `work/guardian-heartbeat-observation-v1`
Draft PR: #1089
Qualified parent: `4f66a5afc7d6dd6ab36262effac6ac199c9b68e1` (PR #1088)

Current reserved clean package identity:
`0.7.0-dev.36965151413.1`

No production promotion, admission override, automatic physical retry, live UAC, owner mutation, or release publication is authorized by this checkpoint.

## Live user-machine readback

Fresh Supabase project:
`jhriwwsryeqsvvvufkok`

Latest durable state observed at:
`2026-10-02 04:32:15.609473+00`

Installed user client:
- version: `0.7.0-dev.36908273822.1`
- ADMIN: true
- access tier: `ADMIN`
- Compute: `HEALTHY`
- Development Plane: `READY`
- Host Resilience: `ACTIVE`
- Supervisor keepalive: `PARKED`
- authoritative admission: `CLOSED`
- generation floor: `28`
- persisted `host_resilience.guardian`: **null**
- Guardian enrollment ticket rows: **0**

Interpretation: the current installed version predates PR #1089 and therefore cannot publish the new Guardian diagnostic into heartbeat. The null Guardian field is not proof that the Guardian service is absent or unbound. It is only proof that the currently installed heartbeat does not contain that diagnostic. Admission remains correctly fail-closed.

## CI evidence and defects found

### Parent qualification

Exact Guardian pipe parent `4f66a5af…` remains the last fully qualified runtime source:
- 10/10 triggered workflows SUCCESS
- Browser Node suite 3851/3851 PASS
- Package Smoke / Installed Chat / Runtime / Soak / Self Update physical gates SUCCESS

### First PR #1089 source

Head `3bf5583b52922e6a236eea7da333718d077b2f50`:
- Package Smoke #3117 SUCCESS
- physically produced `0.7.0-dev.36963586969.1`
- installer SHA-256:
  `62d01c10f5dfb9456036cb7f25edfccee449f87e4609d789e51a40e704e67b91`
- candidate artifact id: `11208958467`
- candidate artifact ZIP SHA-256:
  `069abc38d63c8d006b44b8651adcce61cf36db373709fa171f482890e1bfd967`
- evidence artifact id: `11208109247`
- evidence ZIP SHA-256:
  `ab9518c05e8e84d772dda641de55f5ba502fa994139600523cd2161410bd021e`

This artifact is **not promotable** because the exact-head full matrix was not green.

### R83 canary defect caught

Earlier head `a8801c33…` changed the Edge `/v1/state` schema to add a new top-level Guardian plane. R83 static-canary-equivalence correctly failed because deployed canary source had not been advanced/read back. The fix restored Edge source byte-for-byte and reused the already-qualified `host_resilience` plane. The canary gate was not weakened.

### Heartbeat overwrite defect caught

The first host-plane implementation updated the realtime writer only. Independent CI exposed that the inherited heartbeat wrapper replaced `host_resilience` after `nativeSupervisorState()`, which would discard the Guardian diagnostic on the ordinary heartbeat path.

Repair:
- exported pure `mergeHostResilienceGuardianObservation()`;
- normal heartbeat wrapper and realtime push now call the same helper;
- semantic test verifies the merge result;
- static wiring test verifies exactly two production merge sites.

### Test defect caught

The initial regression used a bounded source regex and failed despite the intended realtime code being present. It was replaced with:
- direct semantic helper assertions;
- exact count of production helper calls;
- broader wiring checks;
- unchanged Edge-source assertion.

### Package identity collision fence

`0.7.0-dev.36963586969.1` was already physically built on `3bf5583b…`.
Later source `c9207919…` started Package Smoke #3119 before version reservation advanced and therefore attempted to reuse the same package string with different source bytes.

Policy:
- all bytes from the later same-version attempt are collision-contaminated;
- they must never be promoted, renamed, or treated as equivalent;
- next clean source reserves `0.7.0-dev.36964688887.1`.

## Research checkpoint

Research note:
`research/GUARDIAN_HEARTBEAT_OBSERVABILITY_RESEARCH_2026-10-02.md`

Primary patterns adopted:
- Kubernetes Lease freshness: heartbeat time is liveness, not readiness/admission.
- Kubernetes conditions / observedGeneration: stale status must not survive generation change.
- RFC 7396-style absent-vs-present merge semantics: one partial writer must not erase another plane.
- etcd revisions/CAS: if Guardian ever becomes an authority input, server must reject out-of-order observation revisions.
- SPIFFE/SPIRE: device/node attestation and local workload/user attestation are separate proofs.
- NIST Zero Trust: ADMIN connectivity and machine ownership do not imply authorization.
- AWS health guidance: component-scoped health must not trigger correlated automatic action.

## Current runtime properties

PR #1089 remains intentionally diagnostic-only:
- one bounded Guardian read in flight;
- 10s observation TTL;
- stale READY -> HOLD;
- pre-activation generation invalidation;
- late old READY cannot overwrite activation result;
- no auto enrollment on heartbeat;
- no UAC on heartbeat;
- no Supervisor admission grant;
- no scheduler authority;
- no task lease authority;
- no automatic physical retry.

## Remaining gates

1. New exact-head CI for the clean reserved identity must be fully terminal green.
2. Package Smoke must produce one exact installer bound to that source and identity.
3. Installed Chat, Final Runtime, Autonomous Soak and Self Update must consume/verify the same source/artifact lineage.
4. Install the qualified build on the user machine.
5. Read `host_resilience.guardian` from live heartbeat and classify one of:
   - ACTIVATION_REQUIRED
   - OWNER_ENROLLMENT_REQUIRED
   - READY
   - HOLD
   - AMBIGUOUS
   - stale
6. If activation is explicitly initiated, use the existing one-attempt Guardian path only. After ambiguity, observe only.
7. READY must be independently reproved after Browser restart before it can contribute to any future admission composition.
8. Continuous Supervisor admission must remain CLOSED until its existing authoritative generation/useful-work gates are independently satisfied.

## Important future design boundary

Current server merge is top-level plane granularity. Two in-flight writes to the same `host_resilience` plane can theoretically arrive out of order. This is acceptable only because Guardian remains non-authoritative diagnostic evidence.

Before using Guardian heartbeat status as a direct admission condition, implement and prove a durable monotonic observation revision / server CAS bound to exact device fingerprint and Browser incarnation. Do not solve this by trusting arrival time.

## Delta after research checkpoint

- Added process-local `observation_revision` to Guardian diagnostics. It increments only when a probe/result is accepted; cached reads, invalidation, and discarded late reads do not advance it.
- Added semantic tests for monotonic revision behavior.
- Fixed the ordinary heartbeat overwrite path by routing both heartbeat and realtime host-resilience state through `mergeHostResilienceGuardianObservation()`.
- Previous reservation `0.7.0-dev.36964688887.1` was retired during rapid CI cancellation/queue churn. New clean reservation: `0.7.0-dev.36965151413.1`.
- This revision remains diagnostic-only. Durable server CAS is still required before Guardian heartbeat state can become an admission input.
