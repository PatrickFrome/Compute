const AGENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const MANAGER_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const TARGET_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;
const ASSIGNMENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_:-]{1,63}$/;
const CAPABILITY_RE = /^[a-z0-9][a-z0-9._:-]{1,95}$/;

export const AGENT_FLEET_VERSION = '1.0.0';
export const AGENT_STATES = Object.freeze(['REGISTERED', 'READY', 'BUSY', 'DRAINING', 'LOST', 'RETIRED']);

function clone(value) { return value == null ? value : structuredClone(value); }
function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentFleetError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) throw new AgentFleetError(code);
}
function text(value, max, code) {
  if (typeof value !== 'string') throw new AgentFleetError(code);
  const v = value.trim();
  if (!v || v.length > max) throw new AgentFleetError(code);
  return v;
}
function token(value, re, max, code, transform = (v) => v) {
  const v = transform(text(value, max, code));
  if (!re.test(v)) throw new AgentFleetError(code);
  return v;
}
function optionalToken(value, re, max, code, transform = (v) => v) {
  if (value == null) return null;
  return token(value, re, max, code, transform);
}
function capabilities(value = []) {
  if (!Array.isArray(value) || value.length > 64) throw new AgentFleetError('agent_capabilities_invalid');
  const out = value.map((item) => token(item, CAPABILITY_RE, 96, 'agent_capability_invalid', (v) => v.toLowerCase())).sort();
  if (out.some((item, i) => i > 0 && item === out[i - 1])) throw new AgentFleetError('agent_capability_duplicate');
  return Object.freeze(out);
}
function provider(value) { return text(value, 64, 'agent_provider_invalid').toUpperCase(); }
function surface(value) { return text(value, 64, 'agent_surface_invalid').toUpperCase(); }
function role(value) { return token(value, ROLE_RE, 64, 'agent_role_invalid', (v) => v.toUpperCase()); }
function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AgentFleetError('agent_clock_invalid');
  return date.toISOString();
}

export class AgentFleetError extends Error {
  constructor(code, { recoveryRequired = false } = {}) {
    super(code);
    this.name = 'AgentFleetError';
    this.code = code;
    this.recovery_required = recoveryRequired;
  }
}

function canonicalAgent(input, createdAt) {
  exactKeys(input, ['agent_id', 'role', 'provider', 'surface', 'target_id', 'conversation_epoch', 'capability_set'], 'agent_register_fields_invalid');
  const epoch = Number(input.conversation_epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new AgentFleetError('agent_conversation_epoch_invalid');
  return Object.freeze({
    version: AGENT_FLEET_VERSION,
    agent_id: token(input.agent_id, AGENT_ID_RE, 128, 'agent_id_invalid', (v) => v.toLowerCase()),
    role: role(input.role),
    provider: provider(input.provider),
    surface: surface(input.surface),
    target_id: optionalToken(input.target_id, TARGET_ID_RE, 96, 'agent_target_id_invalid', (v) => v.toLowerCase()),
    conversation_epoch: epoch,
    capability_set: capabilities(input.capability_set),
    lifecycle_state: 'REGISTERED',
    generation_epoch: 1,
    active_assignment: null,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

function canonicalAssignment(input, agent, managerId, assignedAt) {
  exactKeys(input, ['assignment_id', 'point_id', 'task_kind', 'required_capabilities'], 'agent_assignment_fields_invalid');
  const required = capabilities(input.required_capabilities);
  const available = new Set(agent.capability_set);
  if (required.some((cap) => !available.has(cap))) throw new AgentFleetError('agent_assignment_capability_missing');
  return Object.freeze({
    assignment_id: token(input.assignment_id, ASSIGNMENT_ID_RE, 128, 'agent_assignment_id_invalid', (v) => v.toLowerCase()),
    point_id: token(input.point_id, POINT_ID_RE, 128, 'agent_point_id_invalid', (v) => v.toLowerCase()),
    task_kind: role(input.task_kind),
    required_capabilities: required,
    assigned_by: managerId,
    generation_epoch: agent.generation_epoch,
    conversation_epoch: agent.conversation_epoch,
    target_id: agent.target_id,
    assigned_at: assignedAt,
  });
}

function withAgent(agent, patch, updatedAt) {
  return Object.freeze({ ...agent, ...patch, updated_at: updatedAt });
}

export class AgentFleetCoreV1 {
  #managerId;
  #clock;
  #agents = new Map();
  #assignmentIds = new Set();
  #events = [];
  #seq = 0;

  constructor({ managerId, clock = () => new Date() } = {}) {
    this.#managerId = token(managerId, MANAGER_ID_RE, 128, 'fleet_manager_id_invalid', (v) => v.toLowerCase());
    if (typeof clock !== 'function') throw new AgentFleetError('fleet_clock_invalid');
    this.#clock = clock;
  }

  managerId() { return this.#managerId; }
  listAgents() { return [...this.#agents.values()].map(clone); }
  getAgent(agentId) {
    const id = token(agentId, AGENT_ID_RE, 128, 'agent_id_invalid', (v) => v.toLowerCase());
    return this.#agents.has(id) ? clone(this.#agents.get(id)) : null;
  }
  events() { return this.#events.map(clone); }

  registerAgent(input) {
    const at = nowIso(this.#clock);
    const agent = canonicalAgent(input, at);
    if (this.#agents.has(agent.agent_id)) throw new AgentFleetError('agent_id_exists');
    this.#agents.set(agent.agent_id, agent);
    this.#record('AGENT_REGISTERED', agent.agent_id, { role: agent.role, provider: agent.provider, surface: agent.surface });
    return clone(agent);
  }

  markReady({ manager_id, agent_id }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (!['REGISTERED', 'DRAINING', 'LOST'].includes(agent.lifecycle_state)) throw new AgentFleetError('agent_ready_transition_invalid');
    if (agent.active_assignment) throw new AgentFleetError('agent_ready_assignment_active');
    const next = withAgent(agent, { lifecycle_state: 'READY' }, nowIso(this.#clock));
    this.#agents.set(agent.agent_id, next);
    this.#record('AGENT_READY', agent.agent_id, { generation_epoch: next.generation_epoch });
    return clone(next);
  }

  assignWork({ manager_id, agent_id, assignment }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (agent.lifecycle_state !== 'READY') throw new AgentFleetError('agent_not_ready');
    if (agent.active_assignment) throw new AgentFleetError('agent_assignment_active');
    const assignedAt = nowIso(this.#clock);
    const normalized = canonicalAssignment(assignment, agent, this.#managerId, assignedAt);
    if (this.#assignmentIds.has(normalized.assignment_id)) throw new AgentFleetError('agent_assignment_id_exists');
    this.#assignmentIds.add(normalized.assignment_id);
    const next = withAgent(agent, { lifecycle_state: 'BUSY', active_assignment: normalized }, assignedAt);
    this.#agents.set(agent.agent_id, next);
    this.#record('WORK_ASSIGNED', agent.agent_id, {
      assignment_id: normalized.assignment_id,
      point_id: normalized.point_id,
      generation_epoch: normalized.generation_epoch,
    });
    return clone(next);
  }

  completeWork({ manager_id, agent_id, assignment_id, generation_epoch, disposition = 'READY' }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (!['BUSY', 'DRAINING'].includes(agent.lifecycle_state) || !agent.active_assignment) throw new AgentFleetError('agent_assignment_not_active');
    const assignmentId = token(assignment_id, ASSIGNMENT_ID_RE, 128, 'agent_assignment_id_invalid', (v) => v.toLowerCase());
    if (agent.active_assignment.assignment_id !== assignmentId) throw new AgentFleetError('agent_assignment_identity_mismatch');
    if (Number(generation_epoch) !== agent.generation_epoch || agent.active_assignment.generation_epoch !== agent.generation_epoch) {
      throw new AgentFleetError('agent_assignment_generation_stale');
    }
    const nextState = String(disposition || '').toUpperCase();
    if (!['READY', 'DRAINING'].includes(nextState)) throw new AgentFleetError('agent_completion_disposition_invalid');
    if (agent.lifecycle_state === 'DRAINING' && nextState !== 'DRAINING') throw new AgentFleetError('agent_draining_completion_must_remain_draining');
    const at = nowIso(this.#clock);
    const next = withAgent(agent, { lifecycle_state: nextState, active_assignment: null }, at);
    this.#agents.set(agent.agent_id, next);
    this.#record('WORK_COMPLETED', agent.agent_id, { assignment_id: assignmentId, disposition: nextState });
    return clone(next);
  }

  markLost({ manager_id, agent_id, reason_code = 'WORKER_LOST' }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (agent.lifecycle_state === 'RETIRED') throw new AgentFleetError('agent_lost_transition_invalid');
    const reason = token(reason_code, ROLE_RE, 64, 'agent_lost_reason_invalid', (v) => v.toUpperCase());
    const invalidated = agent.active_assignment?.assignment_id || null;
    const at = nowIso(this.#clock);
    const next = withAgent(agent, {
      lifecycle_state: 'LOST',
      active_assignment: null,
      generation_epoch: agent.generation_epoch + 1,
    }, at);
    this.#agents.set(agent.agent_id, next);
    this.#record('AGENT_LOST', agent.agent_id, {
      reason_code: reason,
      invalidated_assignment_id: invalidated,
      automatic_retry_allowed: false,
      generation_epoch: next.generation_epoch,
    });
    return Object.freeze({ agent: clone(next), invalidated_assignment_id: invalidated, automatic_retry_allowed: false });
  }

  rolloverAgent({ manager_id, agent_id, target_id, conversation_epoch }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (agent.lifecycle_state === 'RETIRED') throw new AgentFleetError('agent_rollover_retired');
    const targetId = optionalToken(target_id, TARGET_ID_RE, 96, 'agent_target_id_invalid', (v) => v.toLowerCase());
    const nextConversationEpoch = Number(conversation_epoch);
    if (!Number.isSafeInteger(nextConversationEpoch) || nextConversationEpoch <= agent.conversation_epoch) {
      throw new AgentFleetError('agent_rollover_epoch_not_advanced');
    }
    const invalidated = agent.active_assignment?.assignment_id || null;
    const at = nowIso(this.#clock);
    const next = withAgent(agent, {
      target_id: targetId,
      conversation_epoch: nextConversationEpoch,
      generation_epoch: agent.generation_epoch + 1,
      active_assignment: null,
      lifecycle_state: targetId ? 'READY' : 'REGISTERED',
    }, at);
    this.#agents.set(agent.agent_id, next);
    this.#record('AGENT_ROLLOVER', agent.agent_id, {
      target_id: targetId,
      conversation_epoch: nextConversationEpoch,
      generation_epoch: next.generation_epoch,
      invalidated_assignment_id: invalidated,
      automatic_retry_allowed: false,
    });
    return Object.freeze({ agent: clone(next), invalidated_assignment_id: invalidated, automatic_retry_allowed: false });
  }

  drainAgent({ manager_id, agent_id }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (!['READY', 'BUSY'].includes(agent.lifecycle_state)) throw new AgentFleetError('agent_drain_transition_invalid');
    if (agent.lifecycle_state === 'BUSY') {
      const next = withAgent(agent, { lifecycle_state: 'DRAINING' }, nowIso(this.#clock));
      this.#agents.set(agent.agent_id, next);
      this.#record('AGENT_DRAINING', agent.agent_id, { assignment_id: agent.active_assignment.assignment_id });
      return clone(next);
    }
    const next = withAgent(agent, { lifecycle_state: 'DRAINING' }, nowIso(this.#clock));
    this.#agents.set(agent.agent_id, next);
    this.#record('AGENT_DRAINING', agent.agent_id, { assignment_id: null });
    return clone(next);
  }

  retireAgent({ manager_id, agent_id }) {
    this.#assertManager(manager_id);
    const agent = this.#requireAgent(agent_id);
    if (agent.lifecycle_state === 'RETIRED') return clone(agent);
    if (agent.active_assignment) throw new AgentFleetError('agent_retire_assignment_active');
    const next = withAgent(agent, { lifecycle_state: 'RETIRED', generation_epoch: agent.generation_epoch + 1 }, nowIso(this.#clock));
    this.#agents.set(agent.agent_id, next);
    this.#record('AGENT_RETIRED', agent.agent_id, { generation_epoch: next.generation_epoch });
    return clone(next);
  }

  #assertManager(value) {
    const id = token(value, MANAGER_ID_RE, 128, 'fleet_manager_id_invalid', (v) => v.toLowerCase());
    if (id !== this.#managerId) throw new AgentFleetError('fleet_manager_not_authorized');
  }

  #requireAgent(value) {
    const id = token(value, AGENT_ID_RE, 128, 'agent_id_invalid', (v) => v.toLowerCase());
    const agent = this.#agents.get(id);
    if (!agent) throw new AgentFleetError('agent_not_found');
    return agent;
  }

  #record(eventType, agentId, detail) {
    const event = Object.freeze({
      version: AGENT_FLEET_VERSION,
      seq: ++this.#seq,
      event_type: eventType,
      agent_id: agentId,
      detail: clone(detail),
      recorded_at: nowIso(this.#clock),
      authority_effect: false,
      actuation_eligible: false,
    });
    this.#events.push(event);
    return event;
  }
}

export function createAgentFleetCore(options) { return new AgentFleetCoreV1(options); }
