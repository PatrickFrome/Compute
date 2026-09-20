// METAENGINE Browser — Elastic Fleet Governor v1
//
// The fleet provisioner grows the ChatGPT worker fleet from server-authoritative
// backlog depth (READY + RUNNING) through the existing FLEET_RECONCILE loop.
// Before this module, growth was monotonic: nothing ever shrank the fleet, and
// surplus worker tabs persisted forever once demand disappeared.
//
// The governor turns the capacity plan into a true elastic policy:
//   - scale-up is immediate and demand-driven (unchanged semantics), bounded by
//     a live-agent ceiling that protects the shared 32-tab budget;
//   - scale-down is hysteresis-gated: only after a bounded run of consecutive
//     zero-demand cycles, and only by retiring surplus claim-INELIGIBLE agents.
//     ACTIVE agents carry transport proofs and may hold server-side leases, so
//     they are never auto-retired (they demote to BOUND_UNVERIFIED on restart
//     and become shrinkable then). PROVISIONING_AMBIGUOUS agents are fenced
//     no-retry evidence and are never silently retired either;
//   - the warm floor (warm_agents) is always preserved.
//
// Projection awareness: inside the DevOS cycle the fleet snapshot flows through
// transportAdmittedFleet(), which rewrites every agent without an exact ACTIVE
// transport proof to ADMISSION_FENCED. The governor therefore treats
// ADMISSION_FENCED (tab-bound, non-ambiguous) as the projection of
// PROVISIONING/BOUND_UNVERIFIED and selects those for shrink. The shell-side
// executor re-validates against the provisioner's TRUE snapshot and only ever
// retires PROVISIONING/BOUND_UNVERIFIED agents, so a malformed or ambiguous
// proposal can never survive the execution boundary.
//
// Invariants preserved:
//   - authority_effect: false everywhere; the plan never grants authority;
//   - capacity expansion still flows exclusively through the existing
//     FLEET_RECONCILE loop (no second scheduler loop, no new timers);
//   - worker telemetry never influences capacity (backlog only, which is
//     server-authoritative);
//   - deterministic capacity backpressure in the provisioner is untouched;
//   - ambiguous agents (PROVISIONING_AMBIGUOUS) are never silently retired.

const DEFAULT_WARM_AGENTS = 2;
const DEFAULT_SPAWN_BURST_LIMIT = 8;
// Live-agent ceiling. Closed-loop audit fix (fleet scale): raised 12 -> 24 and
// operator-tunable via A2_FLEET_MAX_TARGET_AGENTS (bounded by the physical
// tab ceiling the TabRegistry enforces). The governor only ever grows the
// fleet on server-authoritative backlog demand, so a higher ceiling simply
// means the fleet CAN scale when work exists — idle agents still shrink away
// after the hysteresis window.
function envBoundedInt(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
const DEFAULT_MAX_TARGET_AGENTS = envBoundedInt('A2_FLEET_MAX_TARGET_AGENTS', 24, 1, 64);
// Hysteresis: consecutive zero-demand cycles before scale-down may start.
const IDLE_CYCLES_REQUIRED = 3;
// Bounded retire fan-out per cycle (tabs closed per DevOS cycle).
const MAX_RETIRE_PER_CYCLE = 8;
// States that hold a physical tab and are eligible for auto-shrink.
// PROVISIONING/BOUND_UNVERIFIED appear in raw provisioner snapshots;
// ADMISSION_FENCED is their projection inside the transport-admitted cycle
// state. ACTIVE (may hold leases) and PROVISIONING_AMBIGUOUS (fenced evidence)
// are never eligible.
const RETIRE_ELIGIBLE_STATES = Object.freeze(['PROVISIONING', 'BOUND_UNVERIFIED', 'ADMISSION_FENCED']);
const LIVE_STATES = Object.freeze(['REGISTERED', 'PROVISIONING', 'BOUND_UNVERIFIED', 'ACTIVE', 'ADMISSION_FENCED']);

export const FLEET_ELASTIC_GOVERNOR_VERSION = '1.1.0';

export const ELASTIC_FLEET_CONTRACT = Object.freeze({
  schema: 'metaengine.browser.fleet-elastic-governor.v1',
  capacity_model: 'ELASTIC_BACKLOG_DRIVEN_WITH_IDLE_SHRINK',
  scale_up: 'IMMEDIATE_ON_DEMAND',
  scale_down: 'AFTER_IDLE_CYCLES',
  idle_cycles_required: IDLE_CYCLES_REQUIRED,
  max_retire_per_cycle: MAX_RETIRE_PER_CYCLE,
  max_target_agents_default: DEFAULT_MAX_TARGET_AGENTS,
  retire_eligible_states: RETIRE_ELIGIBLE_STATES,
  never_retire_states: Object.freeze(['ACTIVE', 'PROVISIONING_AMBIGUOUS']),
  warm_floor_enforced: true,
  second_scheduler_loop: false,
  worker_telemetry_capacity_authority: false,
  tab_census_capacity_authority: true,
  authority_effect: false,
});

function nonNegative(value) {
  const out = Number(value);
  return Number.isFinite(out) && out >= 0 ? out : 0;
}

export function liveFleetAgents(fleetSnapshot = {}) {
  const agents = Array.isArray(fleetSnapshot?.agents) ? fleetSnapshot.agents : [];
  return agents.filter((row) => LIVE_STATES.includes(String(row?.lifecycle_state || '')));
}

export function retireEligibleFleetAgents(fleetSnapshot = {}, { limit = MAX_RETIRE_PER_CYCLE, reliability = null } = {}) {
  const bounded = Math.max(1, Math.min(Number(limit) || MAX_RETIRE_PER_CYCLE, MAX_RETIRE_PER_CYCLE));
  const agents = Array.isArray(fleetSnapshot?.agents) ? fleetSnapshot.agents : [];
  // Newest first: the youngest surplus workers were the most recently spawned
  // for a burst that has since drained, so they are the first to shrink away.
  // A tab_id is required (there must be a physical tab to close), and agents
  // carrying an ambiguity marker stay fenced no-retry evidence.
  const eligible = agents
    .filter((row) => {
      const state = String(row?.lifecycle_state || '');
      return RETIRE_ELIGIBLE_STATES.includes(state)
        && row?.tab_id
        && !row?.ambiguous_reason;
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  // T3-9 reliability ordering: when the fleet experience signal supplies
  // per-role success rates, retirement order is re-ranked BEFORE the bound is
  // applied — lowest-reliability roles shrink first, proven-good roles keep
  // their agents even when they are the newest. Unknown reliability sits
  // BETWEEN the known bands (neutral 0.5 midpoint), and the stable sort keeps
  // the newest-first order inside every band.
  if (reliability && typeof reliability === 'object') {
    const band = (row) => {
      const entry = reliability[String(row?.role || '').toUpperCase()];
      const rate = entry && Number.isFinite(Number(entry.success_rate)) ? Number(entry.success_rate) : null;
      return rate === null ? 0.5 : Math.max(0, Math.min(1, rate));
    };
    eligible.sort((a, b) => band(a) - band(b));
  }
  return eligible.slice(0, bounded);
}

// Physical worker-tab pool: every tab-bound, non-fenced agent regardless of
// admission projection. This is the shrink inventory — idle tabs are exactly
// what scale-down must reclaim.
function workerTabPoolCount(fleetSnapshot = {}) {
  const agents = Array.isArray(fleetSnapshot?.agents) ? fleetSnapshot.agents : [];
  return agents.filter((row) => {
    const state = String(row?.lifecycle_state || '');
    return row?.tab_id
      && !row?.ambiguous_reason
      && ['ACTIVE', 'PROVISIONING', 'BOUND_UNVERIFIED', 'ADMISSION_FENCED'].includes(state);
  }).length;
}

// Normalize a read-only tab census for governor grounding. Returns null when
// the census is absent or malformed — the governor then keeps its purely
// logical projection semantics (all pre-v1.1.0 behavior).
function normalizeTabCensus(tabCensus) {
  if (!tabCensus || typeof tabCensus !== 'object') return null;
  const fleetTabs = Number(tabCensus.by_role?.FLEET ?? tabCensus.fleet_tabs);
  const ceiling = Number(tabCensus.fleet_tab_ceiling);
  if (!Number.isSafeInteger(fleetTabs) || fleetTabs < 0) return null;
  if (!Number.isSafeInteger(ceiling) || ceiling < 0) return null;
  return Object.freeze({ fleet_tabs: fleetTabs, fleet_tab_ceiling: ceiling });
}

export function planElasticFleetCapacity({ backlog = {}, fleetSnapshot = {}, idleCycles = 0, maxTargetAgents = null, tabCensus = null, experience = null } = {}) {
  const ready = nonNegative(backlog?.ready);
  const running = nonNegative(backlog?.running);
  const policy = fleetSnapshot?.policy || {};
  const warm = Math.max(0, nonNegative(policy.warm_agents ?? DEFAULT_WARM_AGENTS));
  const burst = Math.max(1, nonNegative(policy.spawn_burst_limit ?? DEFAULT_SPAWN_BURST_LIMIT) || DEFAULT_SPAWN_BURST_LIMIT);
  const ceiling = Math.max(warm, nonNegative(maxTargetAgents ?? policy.elastic_max_target_agents ?? DEFAULT_MAX_TARGET_AGENTS));
  const live = liveFleetAgents(fleetSnapshot).length;
  const pool = workerTabPoolCount(fleetSnapshot);
  const census = normalizeTabCensus(tabCensus);
  // Physical grounding (W3): when a read-only census is available, the shrink
  // inventory uses the TRUE count of fleet-role physical tabs (never lower
  // than the logical count — orphan and ambiguous tabs occupy slots too). The
  // execution boundary still re-validates every retire against the TRUE
  // provisioner snapshot, so a census defect can only ever under-shrink, never
  // over-retire an agent that holds a tab.
  const physicalPool = census ? Math.max(pool, census.fleet_tabs) : pool;
  const demand = ready + running;
  const previousIdleCycles = Math.max(0, nonNegative(idleCycles));
  // T3-9 experience-driven fleet: the Outcome River signal extends the idle
  // shrink horizon (productive fleets — recent verified positives — stay warm
  // longer) and orders retirement by role reliability (lowest first). The
  // demand math and the warm floor are UNCHANGED; the DB stays the scheduler
  // authority. A missing/empty signal keeps every pre-T3 behavior exact.
  const experienceGrace = experience && experience.available === true
    ? Math.max(0, Math.min(4, Math.floor(Number(experience.experience_grace_cycles) || 0)))
    : 0;
  const idleRequired = IDLE_CYCLES_REQUIRED + experienceGrace;
  const roleReliability = experience && experience.available === true && experience.per_role && typeof experience.per_role === 'object'
    ? experience.per_role
    : null;

  let nextIdleCycles = previousIdleCycles;
  let target;
  let retireAgentIds = [];

  if (demand > 0) {
    nextIdleCycles = 0;
    target = Math.max(warm, Math.min(Math.max(live, warm) + Math.min(ready, burst), warm + demand, ceiling));
  } else {
    nextIdleCycles = previousIdleCycles + 1;
    if (nextIdleCycles >= idleRequired) {
      target = warm;
      const surplus = Math.max(0, physicalPool - target);
      if (surplus > 0) {
        const eligible = retireEligibleFleetAgents(fleetSnapshot, {
          limit: Math.min(surplus, MAX_RETIRE_PER_CYCLE),
          reliability: roleReliability,
        });
        retireAgentIds = eligible.map((row) => String(row.agent_id));
      }
    } else {
      target = Math.max(warm, Math.min(live, ceiling));
    }
  }

  return Object.freeze({
    schema: 'metaengine.browser.fleet-elastic-plan.v1',
    governor: FLEET_ELASTIC_GOVERNOR_VERSION,
    active: demand > 0,
    target_agents: target,
    spawn_burst_limit: burst,
    ready,
    running,
    idle_cycles: nextIdleCycles,
    idle_cycles_required: IDLE_CYCLES_REQUIRED,
    idle_cycles_required_effective: idleRequired,
    max_target_agents: ceiling,
    worker_tab_pool: pool,
    physical_worker_tabs: census ? census.fleet_tabs : null,
    fleet_tab_ceiling: census ? census.fleet_tab_ceiling : null,
    tab_census_grounded: census != null,
    experience: Object.freeze({
      reliability_informed: experienceGrace > 0 || roleReliability != null,
      available: experience?.available === true,
      sample_count: Number(experience?.sample_count) || 0,
      recent_positive: Number(experience?.recent_positive) || 0,
      fleet_success_rate: experience?.fleet_success_rate ?? null,
      experience_grace_cycles: experienceGrace,
    }),
    retire_agent_ids: Object.freeze(retireAgentIds),
    retire_count: retireAgentIds.length,
    scale_down: retireAgentIds.length > 0,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
