const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_:-]{1,63}$/;
const CAP_RE = /^[a-z0-9][a-z0-9._:-]{1,95}$/;
const COMPLEXITIES = new Set(['SIMPLE', 'MEDIUM', 'HARD', 'CRITICAL']);

export const AGENT_FLEET_SCHEDULER_VERSION = '1.0.0';

const BASE_TEMPLATES = Object.freeze({
  SIMPLE: Object.freeze([
    Object.freeze({ role: 'WORKER', required_capabilities: [] }),
  ]),
  MEDIUM: Object.freeze([
    Object.freeze({ role: 'RESEARCHER', required_capabilities: ['research'] }),
    Object.freeze({ role: 'CODER', required_capabilities: ['code'] }),
    Object.freeze({ role: 'CRITIC', required_capabilities: ['review'] }),
    Object.freeze({ role: 'INTEGRATOR', required_capabilities: ['integrate'] }),
  ]),
  HARD: Object.freeze([
    Object.freeze({ role: 'PLANNER', required_capabilities: ['plan'] }),
    Object.freeze({ role: 'RESEARCHER', required_capabilities: ['research'] }),
    Object.freeze({ role: 'CODER', required_capabilities: ['code'] }),
    Object.freeze({ role: 'TESTER', required_capabilities: ['test'] }),
    Object.freeze({ role: 'CRITIC', required_capabilities: ['review'] }),
    Object.freeze({ role: 'INTEGRATOR', required_capabilities: ['integrate'] }),
  ]),
  CRITICAL: Object.freeze([
    Object.freeze({ role: 'PROPOSER_A', required_capabilities: ['reason'], blind_group: 'proposal' }),
    Object.freeze({ role: 'PROPOSER_B', required_capabilities: ['reason'], blind_group: 'proposal' }),
    Object.freeze({ role: 'PROPOSER_C', required_capabilities: ['reason'], blind_group: 'proposal' }),
    Object.freeze({ role: 'FALSIFIER', required_capabilities: ['falsify'] }),
    Object.freeze({ role: 'SECURITY', required_capabilities: ['security'] }),
    Object.freeze({ role: 'TESTER', required_capabilities: ['test'] }),
    Object.freeze({ role: 'CRITIC', required_capabilities: ['review'] }),
    Object.freeze({ role: 'JURY', required_capabilities: ['integrate'] }),
  ]),
});

const HARD_EXPANSION = Object.freeze([
  Object.freeze({ role: 'RESEARCHER_2', required_capabilities: ['research'] }),
  Object.freeze({ role: 'CODER_2', required_capabilities: ['code'] }),
  Object.freeze({ role: 'FALSIFIER', required_capabilities: ['falsify'] }),
  Object.freeze({ role: 'SECURITY', required_capabilities: ['security'] }),
  Object.freeze({ role: 'PERFORMANCE', required_capabilities: ['benchmark'] }),
  Object.freeze({ role: 'EVIDENCE_JURY', required_capabilities: ['integrate'] }),
]);
const CRITICAL_EXPANSION = Object.freeze([
  Object.freeze({ role: 'PROPOSER_D', required_capabilities: ['reason'], blind_group: 'proposal' }),
  Object.freeze({ role: 'RESEARCHER', required_capabilities: ['research'] }),
  Object.freeze({ role: 'CODER', required_capabilities: ['code'] }),
  Object.freeze({ role: 'PERFORMANCE', required_capabilities: ['benchmark'] }),
]);

export class AgentFleetSchedulerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentFleetSchedulerError';
    this.code = code;
  }
}
function text(value, max, code) {
  if (typeof value !== 'string') throw new AgentFleetSchedulerError(code);
  const v = value.trim();
  if (!v || v.length > max) throw new AgentFleetSchedulerError(code);
  return v;
}
function token(value, re, max, code, transform = (v) => v) {
  const v = transform(text(value, max, code));
  if (!re.test(v)) throw new AgentFleetSchedulerError(code);
  return v;
}
function caps(value = []) {
  if (!Array.isArray(value) || value.length > 64) throw new AgentFleetSchedulerError('scheduler_capabilities_invalid');
  const out = value.map((v) => token(v, CAP_RE, 96, 'scheduler_capability_invalid', (x) => x.toLowerCase())).sort();
  if (out.some((v, i) => i > 0 && v === out[i - 1])) throw new AgentFleetSchedulerError('scheduler_capability_duplicate');
  return out;
}
function agentShape(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AgentFleetSchedulerError('scheduler_agent_invalid');
  return Object.freeze({
    agent_id: token(raw.agent_id, AGENT_ID_RE, 128, 'scheduler_agent_id_invalid', (v) => v.toLowerCase()),
    role: token(raw.role, ROLE_RE, 64, 'scheduler_agent_role_invalid', (v) => v.toUpperCase()),
    lifecycle_state: text(raw.lifecycle_state, 16, 'scheduler_agent_state_invalid').toUpperCase(),
    capability_set: caps(raw.capability_set || []),
  });
}
function hasCapabilities(agent, needed) {
  const available = new Set(agent.capability_set);
  return needed.every((cap) => available.has(cap));
}
function chooseCount(complexity, requestedWorkers, maxWorkers) {
  const minimum = { SIMPLE: 1, MEDIUM: 4, HARD: 6, CRITICAL: 8 }[complexity];
  if (maxWorkers < minimum) throw new AgentFleetSchedulerError('scheduler_max_workers_below_complexity_minimum');
  if (requestedWorkers == null) return minimum;
  if (!Number.isInteger(requestedWorkers) || requestedWorkers < minimum || requestedWorkers > 12) {
    throw new AgentFleetSchedulerError('scheduler_requested_workers_invalid');
  }
  return Math.min(requestedWorkers, maxWorkers);
}
function templateFor(complexity, count) {
  const base = [...BASE_TEMPLATES[complexity]];
  if (complexity === 'HARD') return [...base, ...HARD_EXPANSION].slice(0, count);
  if (complexity === 'CRITICAL') return [...base, ...CRITICAL_EXPANSION].slice(0, count);
  return base.slice(0, count);
}

export function planAgentFleet({ point_id, complexity, available_agents = [], requested_workers = null, max_workers = 12 } = {}) {
  const pointId = token(point_id, POINT_ID_RE, 128, 'scheduler_point_id_invalid', (v) => v.toLowerCase());
  const level = text(complexity, 16, 'scheduler_complexity_invalid').toUpperCase();
  if (!COMPLEXITIES.has(level)) throw new AgentFleetSchedulerError('scheduler_complexity_invalid');
  if (!Number.isInteger(max_workers) || max_workers < 1 || max_workers > 12) throw new AgentFleetSchedulerError('scheduler_max_workers_invalid');
  if (!Array.isArray(available_agents) || available_agents.length > 256) throw new AgentFleetSchedulerError('scheduler_available_agents_invalid');
  const available = available_agents.map(agentShape);
  const ids = new Set();
  for (const agent of available) {
    if (ids.has(agent.agent_id)) throw new AgentFleetSchedulerError('scheduler_duplicate_agent_id');
    ids.add(agent.agent_id);
  }
  const count = chooseCount(level, requested_workers, max_workers);
  const template = templateFor(level, count);
  if (template.length !== count) throw new AgentFleetSchedulerError('scheduler_template_capacity_invalid');

  const used = new Set();
  const slots = template.map((spec, index) => {
    const required = caps(spec.required_capabilities || []);
    const exactRole = available.find((agent) =>
      !used.has(agent.agent_id) && agent.lifecycle_state === 'READY' && agent.role === spec.role && hasCapabilities(agent, required));
    const compatible = exactRole || available.find((agent) =>
      !used.has(agent.agent_id) && agent.lifecycle_state === 'READY' && hasCapabilities(agent, required));
    if (compatible) used.add(compatible.agent_id);
    return Object.freeze({
      slot_id: `${pointId}:slot:${String(index + 1).padStart(2, '0')}`,
      role: spec.role,
      required_capabilities: Object.freeze(required),
      blind_group: spec.blind_group || null,
      reuse_agent_id: compatible?.agent_id || null,
      spawn_required: !compatible,
    });
  });

  const reused = slots.filter((slot) => slot.reuse_agent_id).map((slot) => slot.reuse_agent_id);
  const spawn = slots.filter((slot) => slot.spawn_required).map((slot) => Object.freeze({
    slot_id: slot.slot_id,
    role: slot.role,
    required_capabilities: slot.required_capabilities,
    blind_group: slot.blind_group,
  }));
  return Object.freeze({
    version: AGENT_FLEET_SCHEDULER_VERSION,
    point_id: pointId,
    complexity: level,
    worker_count: slots.length,
    max_workers,
    manager_pattern: true,
    direct_peer_messaging: false,
    automatic_spawn_side_effect: false,
    slots: Object.freeze(slots),
    reused_agent_ids: Object.freeze(reused),
    spawn_requests: Object.freeze(spawn),
    authority_effect: false,
    actuation_eligible: false,
  });
}
