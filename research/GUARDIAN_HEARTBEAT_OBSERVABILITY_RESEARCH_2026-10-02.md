# Guardian heartbeat observability research — 2026-10-02

## Scope

Research for PR #1089, source line `work/guardian-heartbeat-observation-v1`.
The objective is narrow: make local Guardian service / owner-device readback remotely observable without turning heartbeat into an admission authority, retry trigger, or second control plane.

## Findings from primary references

### 1. Liveness, readiness and authority must remain distinct

Kubernetes uses a dedicated Lease object for node heartbeat. The kubelet updates `spec.renewTime`; the control plane interprets that timestamp against a lease duration. Node status is a separate, richer status channel. This is a strong analogue for METAENGINE: a fresh Browser heartbeat proves transport liveness, while Guardian owner/device proof and Supervisor admission remain separate facts.

References:
- https://kubernetes.io/docs/concepts/architecture/leases/
- https://kubernetes.io/docs/reference/node/node-status/
- https://kubernetes.io/docs/reference/kubernetes-api/coordination/lease-v1/

Adoption:
- Guardian observation carries `observed_at` and `expires_at`.
- A positive state is fail-closed after its TTL; stale READY becomes HOLD.
- No positive Guardian observation automatically changes `continuous_service`, Supervisor admission, task leasing, or scheduler state.

### 2. Status needs an observed generation / freshness fence

Kubernetes conditions expose `lastProbeTime`, `lastTransitionTime`, `reason`, and `observedGeneration`. The controller's observed generation is explicitly separated from desired-object generation.

References:
- https://kubernetes.io/docs/concepts/workloads/pods/pod-condition/
- https://kubernetes.io/docs/reference/kubernetes-api/apps/deployment-v1/

Adoption:
- The local observer uses an observation generation to invalidate pre-activation reads.
- Explicit activation invalidates the previous generation before any bootstrap/owner effect.
- Late pre-activation READY cannot publish over the newer generation.
- Remote consumers must treat `expires_at` as a hard diagnostic freshness boundary.

Future authority gate:
- If Guardian status is ever used directly for admission, add a durable monotonic `observation_revision` / CAS check in the server-side state store; do not rely only on wall-clock ordering.

### 3. Partial multi-writer updates must preserve absent fields

RFC 7396 JSON Merge Patch provides a useful semantic model: members present in a patch modify the target, absent members leave target state untouched, while explicit null has special clearing semantics.

Reference:
- https://www.rfc-editor.org/rfc/rfc7396.html

METAENGINE already implements a related top-level plane merge for `/v1/state`: a writer that omits a plane must not erase another writer's plane. PR #1089 deliberately reuses the already-qualified `host_resilience` plane instead of adding a new top-level Edge field, because advancing the Edge source without deployed canary readback correctly fails R83 static-canary equivalence.

Adoption:
- Ordinary heartbeat and realtime observation push both carry Guardian under `host_resilience.guardian`.
- Both writers use the same pure merge helper.
- Edge source stays byte-identical to the qualified canary source.

Remaining limitation:
- Server merge is top-level plane granularity. Two in-flight writes to the same plane can still arrive out of order. Today Guardian is diagnostic-only, so this cannot grant admission. Before making it authoritative, use a server-checked monotonic revision / compare-and-swap.

### 4. Monotonic revisions are preferable to arrival-time trust

etcd attaches a cluster-wide revision to updates and supports transactions guarded by comparisons of revision/version/value. Revisions provide a logical ordering independent of request arrival timing.

References:
- https://etcd.io/docs/v3.7/learning/api/
- https://etcd.io/docs/v3.6/learning/api/

Adoption now:
- No new DB authority in this slice.
- Keep Guardian diagnostic-only and expose freshness metadata.

Implemented locally in this diagnostic slice:
- every accepted Guardian probe/result increments a process-local `observation_revision`;
- cached reads and generation invalidation do not increment it;
- a discarded late pre-activation read does not advance the revision.

Still deferred until admission consumes Guardian:
- persist the observation revision durably;
- accept update only when revision is newer than the stored revision;
- bind revision to exact device fingerprint / Browser incarnation;
- stale or duplicate writes become no-op readback, never an admission transition.

### 5. Owner/device proof should remain attestation, not connectivity

SPIFFE/SPIRE separates node attestation from workload attestation. Workload identity can be bound to local process/OS properties, while node identity is established independently. SPIFFE also recommends out-of-band caller authenticity for local workload endpoints.

References:
- https://spiffe.io/docs/latest/spire-about/spire-concepts/
- https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/
- https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_endpoint/

This maps closely to the current Guardian design:
- cloud ADMIN device identity is one input;
- native service binds owner SID/device challenge locally;
- an independent read-only owner/device proof confirms the effect;
- heartbeat merely transports the resulting diagnostic.

No proposal is made to replace the current Windows Guardian with SPIRE; the useful principle is the separation of node/device identity, local workload/user attestation, and authorization.

### 6. Zero-trust admission must not infer authorization from a healthy client

NIST SP 800-207 separates authentication and authorization at a policy decision/enforcement point and rejects implicit trust from network location or ownership alone.

References:
- https://csrc.nist.gov/pubs/sp/800/207/final
- https://csrc.nist.gov/pubs/sp/800/207/a/final

Adoption:
- ADMIN transport + Compute HEALTHY + fresh heartbeat do not imply continuous-service admission.
- Guardian READY remains insufficient on its own.
- Existing authoritative admission generation and useful-work gates stay closed until independently satisfied.

### 7. Health should be component-scoped to avoid correlated false action

AWS resilience guidance recommends observing component and fault-isolation boundaries, and warns that health checks coupled to shared dependencies can cause fleet-wide false replacement/action.

References:
- https://docs.aws.amazon.com/whitepapers/latest/availability-and-beyond-improving-resilience/reducing-mttd.html
- https://docs.aws.amazon.com/us_en/AWSEC2/latest/UserGuide/application-status-checks.html

Adoption:
- Guardian is its own diagnostic dimension under host resilience.
- Compute, Development Plane, Sentinel, Guardian, and Supervisor admission are reported separately.
- A failed Guardian observation does not auto-restart Browser, issue a ticket, elevate, or open admission.

## Code consequences in PR #1089

Implemented:
1. single-flight bounded Guardian observation shared by Settings and heartbeat;
2. 10 second freshness TTL with stale-positive fail-close;
3. activation-generation fencing;
4. Guardian nested into existing `host_resilience` in normal and realtime writers;
5. shared pure `mergeHostResilienceGuardianObservation()` helper so the two writers cannot accidentally use different merge rules;
6. no Edge/canary source change;
7. no scheduler/admission/retry authority.

CI found two useful defects:
- First candidate attempted to add a new Edge top-level plane; R83 static canary correctly rejected undeployed source drift. The change was reverted.
- The first host-plane implementation modified only realtime state push while the inherited heartbeat wrapper later overwrote `host_resilience`; this meant normal heartbeat would still lose Guardian. The shared helper now fixes both paths and the test is semantic rather than a fragile short source regex.

## Next research-backed gates

Do not implement these as authority changes until the current diagnostic slice is physically green:

1. **Server CAS** — only if Guardian becomes an admission input, reject out-of-order same-plane writes by exact device/incarnation + the now-exposed local observation revision.
2. **Independent live proof** — after installing a qualified build, read back one of:
   `ACTIVATION_REQUIRED`, `OWNER_ENROLLMENT_REQUIRED`, `READY`, `HOLD`, `AMBIGUOUS`, or stale.
3. **Restart continuity** — READY must survive Browser restart through a new independent probe; cached state is not continuity proof.
4. **Admission composition** — any future admission decision must conjunct authoritative generation, fresh ADMIN identity, exact Guardian owner/device proof, fresh Agent capacity, and useful result evidence. Heartbeat by itself remains non-authoritative.
