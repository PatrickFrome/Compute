# DevOS Fleet Capacity Admission Plan G1

Status: PLANNING ONLY / branch-local evidence
Task: `94a52edc-8edd-4f5f-b8f3-3c81695748bd`
Planner: `agent_a127f504-0453-470d-9526-3e1762fa97b3`
Base SHA: `c77e991c76df372861b4ab68fc1d2086e31a80b7`
Target branch: `work/devos-fleet-capacity-admission-plan-g1`
Observed UTC: 2026-08-31 16:51
Production mutation: NONE
Browser UI actuation: NONE

## 1. Decision

The smallest dependency-safe fix is an **ACTIVE-only pre-lease admission gate in the existing `/v1/devos/cycle` caller path**, backed by the existing C5 Browser transport-promotion boundary, plus an ACTIVE-only post-lease readback fence in the Native Browser cycle.

Do **not** add a second scheduler, a second task queue, a new admission lease, a DB polling loop, or a retry queue. Keep `devos_fleet_lease_v1` as the only DevOS task scheduler. `BOUND_UNVERIFIED` agents remain valid physical capacity but are never valid lease consumers.

The exact order is:

`provision/revalidate -> C5 transport promotion -> ACTIVE admission snapshot -> existing devos_fleet scheduler -> exact lease readback -> PR #139 two-phase send -> transport proof -> mark RUNNING`

Continuity retirement from PR #140 is orthogonal and must happen without replaying a Browser effect. Restart/target drift always fences the old generation before any later DevOS effect.

## 2. Authoritative evidence re-read

### GitHub PR #138 — C5 promotion boundary

PR #138 (`work/c5-supervisor-lease-promotion-gate-v1`, head `fc7ed9d5e3b9033f9e4cc40bea62f5b8cddbcf70`) removes direct live promotion from the public fleet composition and admits transport promotion only through `promoteAgentFromSupervisor({agent_id, lease_id})`. The gate verifies an exact ACTIVE, unexpired, unreleased `BROWSER_CLIENT_ACTUATION` lease with effect key `fleet.transport-promotion:<agent_id>`, verified holder and target, then calls the trusted local Browser promotion path. No automatic retry is allowed.

This is the existing boundary that must establish `BOUND_UNVERIFIED -> ACTIVE`. DevOS must consume that lifecycle result rather than invent a second readiness authority.

### GitHub PR #139 — two-phase DevOS dispatch

PR #139 (`work/devos-native-two-phase-dispatch-v1`, head `3312dcb21457740d53e8a0afc623f86a44b70958`) correctly hardens the effect path: exact worker foreground selection, re-read of task/agent/tab/target/generation, renderable viewport, type without submit, revalidation, exactly one typed Send click, transport proof, and no blind retry.

However, its current `assertLiveLeaseBinding()` accepts both `BOUND_UNVERIFIED` and `ACTIVE`. More importantly, the Edge `/v1/devos/cycle` path already calls the DB scheduler before `#dispatchLease()` runs, so post-lease dispatch hardening cannot prevent lease consumption.

### GitHub PR #140 — continuity retirement

PR #140 (`work/supervisor-continuity-terminal-retirement-v2`, head `af07b55845371678a0a1d89d81c4ca4e82772603`) retires an exact confirmed terminal wake using current tab/generation evidence and `markCycleComplete()` without sending or retrying an effect. This must stay independent from task admission: clearing a stale supervisor wake may unblock a later scheduler cycle, but must never be interpreted as permission to replay a DevOS effect.

### Current Edge route / scheduler source

The installed `devos-routes.mjs` has a single scheduler source (`NATIVE_SUPERVISOR_HEARTBEAT`) and explicitly reports `second_scheduler_loop:false`. The defect is in candidate admission:

- `boundedAgents()` currently accepts `BOUND_UNVERIFIED` **or** `ACTIVE`.
- `fairIdleLeaseCandidates()` chooses from that set.
- each selected candidate calls the existing `devos_fleet_lease_v1(...)`.

The DB scheduler itself preserves exact physical identity by writing the caller-supplied agent/tab/target/agent-generation and increments `lease_generation`. It does not know Browser lifecycle state, so lifecycle admission belongs immediately before this scheduler call in the trusted Edge route.

`devos_fleet_lease_v1` is not executable by `anon` or `authenticated`; current execution is restricted to `service_role`/`postgres`, so hardening the trusted route preserves the single supported scheduler path without production DDL.

## 3. Live Supabase + Browser evidence

Read-only observation at `2026-08-31 16:51:11Z`:

- DevOS tasks: `READY=2`, `LEASED=4`, `RUNNING=1`, `RESULT_READY=1`, `AMBIGUOUS=42`, `FAILED=6`, `CANCELLED=6`, `COMPLETED=8`.
- Browser fleet: `ACTIVE=2`, `BOUND_UNVERIFIED=8`, `LOST=14`.
- This planner task was already `LEASED` with:
  - task `94a52edc-8edd-4f5f-b8f3-3c81695748bd`
  - agent `agent_a127f504-0453-470d-9526-3e1762fa97b3`
  - tab `tab_31306795-6232-4684-a203-fd883b0a2916`
  - target `webcontents:5`
  - agent generation `23`
  - lease generation `1`
- The exact live Browser agent had the same agent/tab/target/generation, but lifecycle was `BOUND_UNVERIFIED` and `transport_proof=null`.

A subsequent active-claim read observed six ACTIVE DB claims. Five of them were bound to Browser agents whose lifecycle was still `BOUND_UNVERIFIED`; all five matched the exact live tab/target/agent-generation. Therefore the failure is not stale identity selection: the scheduler is consuming leases for exact but **not transport-admitted** Browser incarnations.

This also explains the large `AMBIGUOUS` population: current lease expiry semantics intentionally fence expired LEASED/RUNNING tasks as `AMBIGUOUS` (`LEASE_EXPIRED_EFFECT_UNKNOWN`) and do not auto-requeue. That behavior is correct for no-blind-retry and must be preserved.

## 4. G1 admission contract

### 4.1 Physical capacity is not schedulable capacity

Keep these separate concepts:

- **physical capacity**: `PROVISIONING`, `REGISTERED`, `BOUND_UNVERIFIED`, `ACTIVE`; may influence elastic spawn/reconcile accounting so Browser does not over-spawn.
- **schedulable capacity**: only `ACTIVE` agents whose current transport proof is exactly bound to the current physical incarnation.

A `BOUND_UNVERIFIED` worker can satisfy warm-capacity accounting but contributes **zero** DevOS lease slots.

### 4.2 Exact admission witness

Before `fairIdleLeaseCandidates()` can see an agent, the current signed Native Supervisor cycle must contain an admission witness with all of:

- `agent_id` — exact normalized agent id;
- `role` — exact task scheduling role;
- `lifecycle_state === ACTIVE`;
- `tab_id` — exact current fleet-owned tab;
- `target_id` — exact current `webcontents:N` target incarnation;
- `generation_epoch` — exact current Browser agent generation;
- `transport_proof.schema === metaengine.browser.fleet-transport-proof.v1`;
- `transport_proof.tab_id === tab_id`;
- `transport_proof.target_id === target_id`;
- `transport_proof.generation_epoch === generation_epoch`;
- a bounded proof digest such as `conversation_url_sha256` if already present; never expose conversation content or page text;
- `automatic_retry_allowed === false`.

Missing proof, malformed proof, `BOUND_UNVERIFIED`, proof/target drift, or generation drift means **not admitted**. This is a no-effect rejection: do not call `devos_fleet_lease_v1` for that agent.

The Browser page/model/worker cannot author this witness. It is projected from the trusted Browser fleet state after C5 promotion.

### 4.3 C5 is the only promotion authority

`BOUND_UNVERIFIED -> ACTIVE` must occur only through the PR #138 C5 path:

1. supervisor obtains/holds the separate C5 actuation lease;
2. exact `agent_id`, `lease_id`, scope `BROWSER_CLIENT_ACTUATION`, effect key `fleet.transport-promotion:<agent_id>`, holder and target are verified;
3. trusted local Browser transport proof is revalidated against current tab/target/generation;
4. Browser fleet state becomes `ACTIVE` with exact transport proof;
5. only a later readback of that ACTIVE state can feed DevOS admission.

A DevOS task lease must never be used to bootstrap transport promotion. This avoids a circular dependency and preserves the existing C5 authority boundary.

## 5. Exact lease sequencing contract

### Phase A — continuity/restart fencing, no task effect

1. Apply PR #140 terminal wake retirement semantics independently.
2. Revalidate fleet target bindings and Browser generation.
3. Any closed/replaced/restarted target or generation change invalidates old ACTIVE evidence and returns the incarnation to a non-admitted state (`BOUND_UNVERIFIED`/LOST as appropriate).
4. No task effect is retried because of wake retirement or restart.

### Phase B — elastic capacity, no DevOS lease yet

5. Existing backlog-driven `FLEET_RECONCILE` may provision enough physical agents.
6. `BOUND_UNVERIFIED` agents remain physical capacity only. They cannot enter the scheduler candidate set.

### Phase C — C5 transport promotion

7. Promote eligible physical workers through PR #138 only.
8. Read back exact ACTIVE + transport proof from Browser state.

### Phase D — single DevOS scheduler admission

9. Native cycle sends a bounded fleet projection containing only data required for admission, including exact proof binding fields.
10. Edge normalizes and filters to ACTIVE + exact proof only.
11. Existing `fairIdleLeaseCandidates()` retains its current role fairness and busy-agent logic, but receives only admitted agents.
12. For each admitted candidate, call the same `devos_fleet_lease_v1` exactly as today. No other scheduler call/loop is introduced.
13. Seal the returned lease to the admitted incarnation before returning it:
    - returned `agent_id == admitted.agent_id`
    - returned `tab_id == admitted.tab_id`
    - returned `target_id == admitted.target_id`
    - returned `agent_generation_epoch == admitted.generation_epoch`
    - `task_id` is a valid UUID
    - `lease_generation >= 1`
    - lease is unexpired
    - `automatic_retry_allowed == false`

This yields the required exact tuple:

`(task_id, agent_id, tab_id, target_id, agent_generation_epoch, lease_generation)`.

### Phase E — post-lease readback and effect

14. Browser re-reads current fleet state after the scheduler response.
15. Tighten PR #139 `assertLiveLeaseBinding()` from `BOUND_UNVERIFIED | ACTIVE` to **ACTIVE only**, and require current transport proof to match the lease tab/target/agent-generation.
16. If any binding changed after lease issuance, stop before UI effect. Do not dispatch and do not request another lease for the same ambiguous generation.
17. If exact, execute PR #139 two-phase transport: foreground exact tab, capture/readiness, type without submit, revalidate exact binding, exactly one Send click, prove transport.
18. `devos_fleet_mark_running_v1` keeps the existing exact DB fence over task/agent/lease-generation/tab/target/agent-generation.

## 6. Minimal implementation touch points

This plan intentionally avoids production implementation on this branch. The later implementation slice should touch the smallest surfaces:

1. `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs`
   - replace `BOUND_UNVERIFIED | ACTIVE` candidate acceptance with ACTIVE-only exact transport-proof admission;
   - keep `fairIdleLeaseCandidates()` and `devos_fleet_lease_v1` unchanged as scheduler policy/source;
   - add exact lease-response seal.
2. `apps/metaengine-browser/src/devos-native-task-cycle-core.mjs` on the PR #139 lineage
   - include bounded transport-proof binding in the signed cycle projection;
   - require ACTIVE-only exact proof in `assertLiveLeaseBinding()` after lease readback.
3. Tests only around these contracts.

No DB migration is required for the first safe G1 slice. No new table, queue, claim type, polling loop, scheduler, or Browser UI path is justified.

## 7. Dependency / integration order

The dependency-safe convergence order is:

1. **PR #140 continuity retirement semantics** may land independently; it reduces stuck cycles and never grants task admission.
2. **PR #138 C5 promotion gate** must be available before ACTIVE-only admission is enabled, otherwise the fleet can fail closed with no way to promote workers.
3. **G1 admission implementation**: ACTIVE-only exact proof before the existing scheduler + exact lease response seal.
4. **PR #139 two-phase dispatch** stacked/rebased with G1 post-lease ACTIVE-only assertion. The two changes are complementary: G1 prevents bad lease consumption; #139 prevents ambiguous UI submission for admitted leases.
5. Only after exact Browser Shell / physical self-update E2E should release promotion be considered.

If sequencing forces #139 before G1, it remains safe with respect to duplicate UI effects but **not** with respect to lease capacity; therefore G1 remains a release blocker for autonomous dispatch.

## 8. Acceptance matrix

| ID | Input / event | Expected scheduler behavior | Expected effect behavior |
|---|---|---|---|
| G1-A01 | exact `BOUND_UNVERIFIED`, no transport proof | zero `devos_fleet_lease_v1` calls for agent | no UI effect |
| G1-A02 | `ACTIVE` but proof absent | zero scheduler calls | no UI effect |
| G1-A03 | `ACTIVE`, proof tab mismatch | zero scheduler calls | no UI effect |
| G1-A04 | `ACTIVE`, proof target mismatch | zero scheduler calls | no UI effect |
| G1-A05 | `ACTIVE`, proof generation mismatch | zero scheduler calls | no UI effect |
| G1-A06 | exact ACTIVE proof + READY role demand | exactly existing scheduler call; returned lease sealed to same agent/tab/target/generation | no UI effect until post-lease readback |
| G1-A07 | target replaced after lease, generation changes | no second lease for old incarnation; post-lease fence rejects | no Send; old lease may age to AMBIGUOUS |
| G1-A08 | C5 verifier unavailable / lease invalid / wrong effect key | agent remains non-ACTIVE and non-admitted | no promotion retry, no task effect |
| G1-A09 | terminal old supervisor wake blocks successor | #140 retires exact wake without scheduler duplication | no replayed wake/UI effect |
| G1-A10 | two admitted ACTIVE agents same role | retain existing fair-idle ordering and one scheduler source | independent exact leases only |
| G1-A11 | many `BOUND_UNVERIFIED` agents + backlog | may count toward physical capacity target; zero schedulable slots | no lease starvation by consumed BOUND leases |
| G1-A12 | lease response agent/tab/target/generation differs from admission witness | fail closed before Browser dispatch | no UI effect; no blind retry |
| G1-A13 | stale lease generation on mark-running/complete | existing DB fence returns fenced/409 semantics | no retry of ambiguous effect |
| G1-A14 | page/model/worker reports “ready” while Browser lifecycle is not ACTIVE | ignored as non-authoritative | no scheduler call / no effect |

## 9. Required tests for implementation branch

- Unit test `bounded/admitted agents`: BOUND_UNVERIFIED is excluded even when identity is exact.
- Unit tests for missing/mismatched proof tab, target and generation.
- Route test spies on `rpc`: rejected agents must produce **zero** calls to `devos_fleet_lease_v1`.
- Route test exact ACTIVE agent produces one normal `devos_fleet_lease_v1` call using current role fairness.
- Route test lease response mismatch fails closed before response is exposed to Browser.
- Native cycle test post-lease lifecycle downgrade ACTIVE -> BOUND_UNVERIFIED rejects before `SELECT_TAB`, `SEMANTIC_TYPE`, or `TYPED_CLICK`.
- Restart test generation N -> N+1 fences lease generation bound to N and never auto-redispatches it.
- PR #139 one-click-only and ambiguous-effect tests remain mandatory.
- PR #140 wake-retirement tests remain mandatory and must demonstrate zero task scheduler calls caused solely by retirement.
- Scheduler provenance assertion remains `scheduler_source=NATIVE_SUPERVISOR_HEARTBEAT`, `second_scheduler_loop=false`.

## 10. Release gates

G1 is acceptable for release only when all are proven on the integrated lineage:

- C5 promotion is fail-closed and exact-actuation-lease gated;
- BOUND_UNVERIFIED produces zero task lease attempts;
- exact ACTIVE proof can obtain a lease through the existing scheduler;
- full six-field task/incarnation/lease tuple survives pre-effect and post-effect readbacks;
- restart/target replacement causes generation fencing before any Send;
- lease expiry stays AMBIGUOUS/no-auto-requeue;
- PR #139 two-phase effect proof passes physical Browser E2E;
- PR #140 continuity retirement cannot duplicate task actuation;
- no production DDL or second scheduler has been introduced.

## 11. Explicit non-goals

- no production mutation from this planning branch;
- no Browser UI actuation;
- no self-approval of implementation or release evidence;
- no arbitrary evaluation of repository/page/model content;
- no auto-requeue of ambiguous leases;
- no scheduler redesign;
- no new C5 authority layer;
- no hidden retry after Enter/click/target replacement/restart.

## 12. Planner conclusion

The smallest safe change is not “make dispatch reject BOUND_UNVERIFIED” alone. That is too late because the DB lease has already been consumed. The correct boundary is **ACTIVE-only exact transport-proof admission immediately before the existing `devos_fleet_lease_v1` call**, followed by the same ACTIVE-only proof check after lease readback and before PR #139 performs any UI effect.

This reuses C5 to create ACTIVE authority, reuses the existing DevOS scheduler unchanged, preserves exact task/agent/tab/target/agent-generation/lease-generation fencing, and preserves restart ambiguity as fail-closed rather than retryable work.
