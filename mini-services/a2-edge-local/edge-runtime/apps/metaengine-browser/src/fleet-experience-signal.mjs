// Fleet Experience Signal — T3-9 (experience-driven fleet).
//
// The Outcome River materializes one durable experience case per attributed
// command; until now that evidence influenced nothing about the fleet itself
// (desired_agents was a static warm floor + demand math). This module derives
// a bounded, deterministic signal from the river's recent-credit ring:
//
//   - recent POSITIVE credit velocity (last 60 minutes) — are the agents
//     converting work into verified outcomes right now?
//   - per-agent / per-role success rates over the ring — which roles earn
//     their tab slots?
//
// The signal is a pure projection (no authority): the DB stays the scheduler
// authority, demand math stays demand-driven. The fleet governor uses the
// signal for exactly two things — idle-shrink grace (productive fleets stay
// warm longer) and retirement ordering (lowest-reliability roles shrink
// first). Everything is bounded; ids and counts only, never payloads.

export const FLEET_EXPERIENCE_SIGNAL_SCHEMA = 'metaengine.browser.fleet-experience-signal.v1';

const VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const VELOCITY_SATURATION = 24;      // 24 recent positives = full grace
const EXPERIENCE_GRACE_MAX = 4;      // +4 idle cycles at full velocity
const MAX_PER_AGENT = 64;

function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function deriveFleetExperienceSignal({ riverSnapshot = null, fleetSnapshot = null, now = Date.now() } = {}) {
  const ring = Array.isArray(riverSnapshot?.recent_credits) ? riverSnapshot.recent_credits : [];
  const agents = Array.isArray(fleetSnapshot?.agents) ? fleetSnapshot.agents : [];
  const roleOf = new Map(agents.map((row) => [String(row?.agent_id || '').toLowerCase(), String(row?.role || '').toUpperCase()]));
  const cutoff = Number(now) - VELOCITY_WINDOW_MS;

  let positive = 0;
  let negative = 0;
  let recentPositive = 0;
  const perAgent = new Map();
  for (const row of ring.slice(-MAX_PER_AGENT * 4)) {
    const sign = String(row?.credit || '').toUpperCase() === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE';
    const at = Date.parse(row?.at || '');
    const timestamp = Number.isFinite(at) ? at : 0;
    const agent = String(row?.agent_id || '').toLowerCase() || null;
    if (sign === 'POSITIVE') {
      positive += 1;
      if (timestamp >= cutoff) recentPositive += 1;
    } else {
      negative += 1;
    }
    if (agent) {
      const entry = perAgent.get(agent) || { credited: 0, positive: 0, negative: 0 };
      entry.credited += 1;
      if (sign === 'POSITIVE') entry.positive += 1; else entry.negative += 1;
      perAgent.set(agent, entry);
    }
  }

  const perRole = new Map();
  for (const [agent, entry] of perAgent.entries()) {
    const role = roleOf.get(agent) || 'UNKNOWN';
    const current = perRole.get(role) || { agent_count: 0, credited: 0, positive: 0, negative: 0 };
    current.agent_count += 1;
    current.credited += entry.credited;
    current.positive += entry.positive;
    current.negative += entry.negative;
    perRole.set(role, current);
  }

  const samples = positive + negative;
  const fleetSuccessRate = samples > 0 ? round3(positive / samples) : null;
  const graceCycles = Math.min(EXPERIENCE_GRACE_MAX, Math.floor((recentPositive / VELOCITY_SATURATION) * EXPERIENCE_GRACE_MAX));

  const perAgentBounded = {};
  let index = 0;
  for (const [agent, entry] of perAgent.entries()) {
    if (index >= MAX_PER_AGENT) break;
    perAgentBounded[agent] = Object.freeze({
      credited: entry.credited,
      positive: entry.positive,
      negative: entry.negative,
      success_rate: round3(entry.positive / entry.credited),
    });
    index += 1;
  }

  const perRoleBounded = {};
  for (const [role, entry] of perRole.entries()) {
    perRoleBounded[role] = Object.freeze({
      agent_count: entry.agent_count,
      credited: entry.credited,
      positive: entry.positive,
      negative: entry.negative,
      success_rate: round3(entry.positive / entry.credited),
    });
  }

  return zero({
    schema: FLEET_EXPERIENCE_SIGNAL_SCHEMA,
    version: 1,
    available: samples > 0,
    sample_count: samples,
    positive_count: positive,
    negative_count: negative,
    recent_positive: recentPositive,
    fleet_success_rate: fleetSuccessRate,
    experience_grace_cycles: graceCycles,
    velocity_window_minutes: VELOCITY_WINDOW_MS / 60000,
    per_role: Object.freeze(perRoleBounded),
    per_agent: Object.freeze(perAgentBounded),
  });
}
