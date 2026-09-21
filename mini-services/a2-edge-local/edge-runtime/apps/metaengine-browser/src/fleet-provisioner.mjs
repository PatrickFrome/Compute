import crypto from 'node:crypto';
import { AGENT_PLATFORM_HOME_URL, isAgentPlatformUrl } from './browser-agent-platform.mjs';
import {
  FleetProvisioner as CoreFleetProvisioner,
  FLEET_PROFILES,
  FLEET_PROVISIONER_VERSION,
  FLEET_STATES,
} from './fleet-provisioner-core.mjs';
import { registerFleetRuntime } from './fleet-runtime-bridge.mjs';

export { FLEET_PROFILES, FLEET_PROVISIONER_VERSION, FLEET_STATES };

export const FLEET_RESTART_STALE_HISTORY_LIMIT = 64;
const RESTART_STALE_LOST_REASON = 'PHYSICAL_TAB_MISSING_ON_RESTART';
const TERMINAL_HISTORY_STATES = new Set(['LOST', 'RETIRED']);
const RECONCILE_SLOT_STATES = new Set(['REGISTERED', 'PROVISIONING', 'BOUND_UNVERIFIED', 'ACTIVE']);

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function hasCanonicalTimestamp(value) {
  const raw = String(value || '');
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === raw;
}

function isPrunableRestartStaleLost(row) {
  return row?.lifecycle_state === 'LOST'
    && row?.automatic_retry_allowed !== true
    && row?.lost_reason === RESTART_STALE_LOST_REASON
    && row?.tab_id == null
    && row?.target_id == null
    && row?.transport_proof == null
    && row?.authority_effect !== true
    && hasCanonicalTimestamp(row?.updated_at);
}

export function pruneRestartStaleLostHistory(input) {
  if (!input || input.schema !== 'metaengine.browser.fleet-state.v1' || !Array.isArray(input.agents)) return input;
  const stale = input.agents
    .map((row, index) => ({ row, index, updated_at: String(row?.updated_at || '') }))
    .filter(({ row }) => isPrunableRestartStaleLost(row));
  if (stale.length <= FLEET_RESTART_STALE_HISTORY_LIMIT) return input;

  const keep = new Set(stale
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.index - a.index)
    .slice(0, FLEET_RESTART_STALE_HISTORY_LIMIT)
    .map(({ index }) => index));
  return {
    ...input,
    agents: input.agents.filter((row, index) => !isPrunableRestartStaleLost(row) || keep.has(index)),
  };
}

function hasZeroDesiredFleet(input, policy = null) {
  const effective = policy && typeof policy === 'object' ? policy : input?.policy;
  return Number(effective?.desired_agents) === 0 && Number(effective?.warm_agents) === 0;
}

export function compactTerminalFleetHistory(input, policy = null) {
  if (!input || input.schema !== 'metaengine.browser.fleet-state.v1' || !Array.isArray(input.agents)) return input;
  if (!hasZeroDesiredFleet(input, policy)) return input;
  const agents = input.agents.filter((row) => !TERMINAL_HISTORY_STATES.has(String(row?.lifecycle_state || '')));
  if (agents.length === input.agents.length) return input;
  return {
    ...input,
    agents,
  };
}

export function compactFleetHistory(input, policy = null) {
  return pruneRestartStaleLostHistory(compactTerminalFleetHistory(input, policy));
}

function stableTransportProof(proof) {
  if (!proof || typeof proof !== 'object') return null;
  return {
    transport_stage: proof.transport_stage ? String(proof.transport_stage) : null,
    tab_id: proof.tab_id ? String(proof.tab_id) : null,
    target_id: proof.target_id ? String(proof.target_id).toLowerCase() : null,
    generation_epoch: Number(proof.generation_epoch) || 0,
    conversation_url_sha256: proof.conversation_url_sha256 ? String(proof.conversation_url_sha256).toLowerCase() : null,
  };
}

export function projectFleetReconcileSemantics(snapshot = {}) {
  const policy = snapshot?.policy || {};
  const agents = (Array.isArray(snapshot?.agents) ? snapshot.agents : []).map((row) => ({
    agent_id: String(row?.agent_id || '').toLowerCase(),
    role: String(row?.role || '').toUpperCase(),
    lifecycle_state: String(row?.lifecycle_state || '').toUpperCase(),
    tab_id: row?.tab_id ? String(row.tab_id) : null,
    target_id: row?.target_id ? String(row.target_id).toLowerCase() : null,
    generation_epoch: Number(row?.generation_epoch) || 0,
    conversation_epoch: Number(row?.conversation_epoch) || 0,
    lost_reason: row?.lost_reason ? String(row.lost_reason) : null,
    ambiguous_reason: row?.ambiguous_reason ? String(row.ambiguous_reason) : null,
    transport_proof: stableTransportProof(row?.transport_proof),
  })).sort((a, b) => a.agent_id.localeCompare(b.agent_id));
  return Object.freeze({
    schema: 'metaengine.browser.fleet-reconcile-semantics.v1',
    policy: Object.freeze({
      profile: String(policy.profile || ''),
      warm_agents: Math.max(0, Number(policy.warm_agents) || 0),
      desired_agents: Math.max(0, Number(policy.desired_agents) || 0),
      spawn_burst_limit: Math.max(0, Number(policy.spawn_burst_limit) || 0),
    }),
    agents: Object.freeze(agents),
    capacity_backpressure: Object.freeze({
      blocked: snapshot?.capacity_backpressure?.blocked === true,
      reason: snapshot?.capacity_backpressure?.reason ? String(snapshot.capacity_backpressure.reason) : null,
    }),
    authority_effect: false,
  });
}

function semanticHash(value) { return sha256(JSON.stringify(value)); }
function reconcileSlotCount(projection) { return (projection?.agents || []).filter((row) => RECONCILE_SLOT_STATES.has(row.lifecycle_state)).length; }

export function classifyFleetReconcileOutcome({ before, after, active = false, target_agents = null, physical_cleanup_count = 0 } = {}) {
  const beforeSemantic = projectFleetReconcileSemantics(before);
  const afterSemantic = projectFleetReconcileSemantics(after);
  const desired = active === true
    ? (target_agents == null ? afterSemantic.policy.desired_agents : Math.max(0, Number(target_agents) || 0))
    : afterSemantic.policy.warm_agents;
  const observed = reconcileSlotCount(afterSemantic);
  const blocked = afterSemantic.capacity_backpressure.blocked === true;
  const postconditionSatisfied = observed >= desired || blocked;
  const beforeSha = semanticHash(beforeSemantic);
  const afterSha = semanticHash(afterSemantic);
  const changed = beforeSha !== afterSha;
  const cleanupCount = Number.isSafeInteger(Number(physical_cleanup_count))
    ? Math.max(0, Number(physical_cleanup_count))
    : 0;
  const effectOutcome = postconditionSatisfied
    ? (changed || cleanupCount > 0 ? 'CONFIRMED' : 'NO_EFFECT_PROVEN')
    : 'AMBIGUOUS';
  return Object.freeze({
    effect_outcome: effectOutcome,
    automatic_retry_allowed: false,
    semantic_before_sha256: beforeSha,
    semantic_after_sha256: afterSha,
    postcondition: Object.freeze({
      contract: 'FLEET_SLOT_TARGET_OR_CAPACITY_BARRIER_V1',
      desired_slots: desired,
      observed_slots: observed,
      capacity_backpressure: blocked,
      physical_cleanup_count: cleanupCount,
      satisfied: postconditionSatisfied,
      volatile_fields_excluded: true,
      authority_effect: false,
    }),
    authority_effect: false,
  });
}

function isRestartMissingBinding(row, tabExists) {
  if (!row || typeof row !== 'object' || typeof tabExists !== 'function') return false;
  const lifecycle = String(row.lifecycle_state || '');
  if (!['BOUND_UNVERIFIED', 'ACTIVE'].includes(lifecycle)) return false;
  if (!row.tab_id || row.authority_effect === true) return false;
  try {
    return tabExists(String(row.tab_id)) === false;
  } catch {
    return false;
  }
}

export function compactZeroTargetRestartBindings(input, { policy = null, tabExists = null } = {}) {
  if (!input || input.schema !== 'metaengine.browser.fleet-state.v1' || !Array.isArray(input.agents)) return input;
  if (!hasZeroDesiredFleet(input, policy) || typeof tabExists !== 'function') return input;
  const agents = input.agents.filter((row) => !isRestartMissingBinding(row, tabExists));
  if (agents.length === input.agents.length) return input;
  return {
    ...input,
    agents,
  };
}

function normalizeRootAgentPlatformUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || !isAgentPlatformUrl(url.href)) {
    throw new Error('fleet_transport_preconversation_origin_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '') throw new Error('fleet_transport_preconversation_path_invalid');
  return AGENT_PLATFORM_HOME_URL;
}

function exactOverlayProof(agent, proof) {
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1') return false;
  if (proof.transport_stage !== 'PRECONVERSATION_ROOT' || proof.authority_effect !== false) return false;
  if (String(agent?.lifecycle_state || '') !== 'BOUND_UNVERIFIED') return false;
  if (String(agent?.tab_id || '') !== String(proof.tab_id || '')) return false;
  if (String(agent?.target_id || '').toLowerCase() !== String(proof.target_id || '').toLowerCase()) return false;
  if (Number(agent?.generation_epoch) !== Number(proof.generation_epoch)) return false;
  return /^[a-f0-9]{64}$/.test(String(proof.conversation_url_sha256 || '').toLowerCase())
    && Number.isFinite(Date.parse(String(proof.proven_at || '')));
}

export class FleetProvisioner extends CoreFleetProvisioner {
  #preconversationProofs = new Map();

  constructor(options = {}) {
    const loadState = options?.loadState;
    const saveState = options?.saveState;
    const startupPolicy = options?.policy;
    const tabExists = options?.tabExists;
    super({
      ...options,
      loadState: typeof loadState === 'function'
        ? async (...args) => compactZeroTargetRestartBindings(compactFleetHistory(await loadState(...args), startupPolicy), { policy: startupPolicy, tabExists })
        : loadState,
      saveState: typeof saveState === 'function'
        ? async (value, ...args) => saveState(compactFleetHistory(value), ...args)
        : saveState,
    });
  }

  async init(...args) {
    this.#preconversationProofs.clear();
    await super.init(...args);
    registerFleetRuntime(this);
    return this.snapshot();
  }

  snapshot() {
    const out = structuredClone(super.snapshot());
    let promoted = 0;
    for (const agent of out.agents || []) {
      const proof = this.#preconversationProofs.get(String(agent?.agent_id || '').toLowerCase()) || null;
      if (!exactOverlayProof(agent, proof)) {
        if (proof) this.#preconversationProofs.delete(String(agent?.agent_id || '').toLowerCase());
        continue;
      }
      agent.lifecycle_state = 'ACTIVE';
      agent.transport_proof = structuredClone(proof);
      promoted += 1;
    }
    if (promoted > 0 && out.counts) {
      out.counts.BOUND_UNVERIFIED = Math.max(0, Number(out.counts.BOUND_UNVERIFIED || 0) - promoted);
      out.counts.ACTIVE = Number(out.counts.ACTIVE || 0) + promoted;
    }
    return Object.freeze(out);
  }

  async reconcile(options = {}) {
    const before = this.snapshot();
    await super.reconcile(options);
    const after = this.snapshot();
    const outcome = classifyFleetReconcileOutcome({ before, after, ...options });
    return Object.freeze({ ...structuredClone(after), ...outcome });
  }

  async markTransportPreconversationProven({ agent_id, tab_id, target_id, generation_epoch, transport_url } = {}) {
    const agentId = String(agent_id || '').toLowerCase();
    const tabId = String(tab_id || '');
    const targetId = String(target_id || '').toLowerCase();
    const generationEpoch = Number(generation_epoch);
    const base = super.snapshot();
    const rows = (base?.agents || []).filter((row) => String(row?.agent_id || '').toLowerCase() === agentId);
    if (rows.length !== 1) throw new Error(rows.length ? 'fleet_transport_preconversation_agent_ambiguous' : 'fleet_transport_preconversation_agent_missing');
    const agent = rows[0];
    if (String(agent.ownership || '') !== 'FLEET_OWNED' || String(agent.lifecycle_state || '') !== 'BOUND_UNVERIFIED') throw new Error(`fleet_transport_preconversation_state_invalid:${agent.lifecycle_state}`);
    if (!tabId || String(agent.tab_id || '') !== tabId) throw new Error('fleet_transport_preconversation_tab_binding_mismatch');
    if (!targetId || String(agent.target_id || '').toLowerCase() !== targetId) throw new Error('fleet_transport_preconversation_target_binding_mismatch');
    if (!Number.isSafeInteger(generationEpoch) || Number(agent.generation_epoch) !== generationEpoch) throw new Error('fleet_transport_preconversation_generation_binding_mismatch');
    const normalizedUrl = normalizeRootAgentPlatformUrl(transport_url);
    const proof = Object.freeze({
      schema: 'metaengine.browser.fleet-transport-proof.v1',
      transport_stage: 'PRECONVERSATION_ROOT',
      tab_id: tabId,
      target_id: targetId,
      generation_epoch: generationEpoch,
      conversation_url_sha256: sha256(normalizedUrl),
      proven_at: new Date().toISOString(),
      authority_effect: false,
    });
    this.#preconversationProofs.set(agentId, proof);
    return this.snapshot();
  }

  async markTransportProven(args = {}) {
    const out = await super.markTransportProven(args);
    this.#preconversationProofs.delete(String(args?.agent_id || '').toLowerCase());
    return out;
  }
}
