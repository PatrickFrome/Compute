import crypto from 'node:crypto';
import {
  FleetProvisioner as CoreFleetProvisioner,
  FLEET_PROFILES,
  FLEET_PROVISIONER_VERSION,
  FLEET_STATES,
} from './fleet-provisioner-core.mjs';
import { registerFleetRuntime } from './fleet-runtime-bridge.mjs';

export { FLEET_PROFILES, FLEET_PROVISIONER_VERSION, FLEET_STATES };

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const CAPACITY_AMBIGUITY_PREFIX = 'CREATE_TAB_AMBIGUOUS:tab_capacity_exceeded';

function normalizeRootChatGptUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('fleet_transport_preconversation_origin_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '') throw new Error('fleet_transport_preconversation_path_invalid');
  return 'https://chatgpt.com/';
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

function deterministicCapacityAttempts(snapshot) {
  return (snapshot?.agents || []).filter((agent) =>
    String(agent?.lifecycle_state || '') === 'PROVISIONING_AMBIGUOUS'
    && String(agent?.ambiguous_reason || '').startsWith(CAPACITY_AMBIGUITY_PREFIX));
}

export class FleetProvisioner extends CoreFleetProvisioner {
  #preconversationProofs = new Map();
  #capacityBackpressure = false;
  #capacityRetiredAttempts = 0;

  async #retireDeterministicCapacityAttempts() {
    const rows = deterministicCapacityAttempts(super.snapshot());
    if (rows.length === 0) return false;
    for (const agent of rows) await super.retire(agent.agent_id);
    this.#capacityRetiredAttempts += rows.length;
    this.#capacityBackpressure = true;
    return true;
  }

  async init(...args) {
    this.#preconversationProofs.clear();
    this.#capacityBackpressure = false;
    this.#capacityRetiredAttempts = 0;
    await super.init(...args);
    // Older 1.4.1 state classified tab_capacity_exceeded as ambiguous even though
    // TabRegistry rejects it before creating a physical WebContents. Retire only
    // those exact no-effect logical attempts; every other ambiguity remains fenced.
    await this.#retireDeterministicCapacityAttempts();
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
    out.capacity_backpressure = {
      blocked: this.#capacityBackpressure,
      retired_no_effect_attempts: this.#capacityRetiredAttempts,
      reason: this.#capacityBackpressure ? 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT' : null,
      deterministic_no_effect: true,
      automatic_retry_allowed: false,
      release_signal: 'PHYSICAL_TAB_CLOSED',
      authority_effect: false,
    };
    return Object.freeze(out);
  }

  async reconcile(args = {}) {
    const active = args?.active === true;
    if (active && this.#capacityBackpressure) return this.snapshot();
    // Keep this wrapper least-authority. Capacity backpressure is handled here, but
    // only the core's documented scheduler inputs may cross the inheritance boundary.
    // Future wrapper fields can therefore never become owner-gate or fanout authority.
    const targetAgents = args?.target_agents ?? null;
    const spawnBurstLimit = args?.spawn_burst_limit ?? null;
    await super.reconcile({ active, target_agents: targetAgents, spawn_burst_limit: spawnBurstLimit });
    await this.#retireDeterministicCapacityAttempts();
    return this.snapshot();
  }

  async onTabClosed(tabId, reason = 'PHYSICAL_TAB_CLOSED') {
    const out = await super.onTabClosed(tabId, reason);
    // A physical close is the only local evidence that capacity may have changed.
    // It permits a later reconcile to make one normal bounded provisioning pass;
    // no failed createTab effect itself is replayed.
    if (this.#capacityBackpressure) this.#capacityBackpressure = false;
    return out ? this.snapshot() : this.snapshot();
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
    if (String(agent.ownership || '') !== 'FLEET_OWNED' || String(agent.lifecycle_state || '') !== 'BOUND_UNVERIFIED') {
      throw new Error(`fleet_transport_preconversation_state_invalid:${agent.lifecycle_state}`);
    }
    if (!tabId || String(agent.tab_id || '') !== tabId) throw new Error('fleet_transport_preconversation_tab_binding_mismatch');
    if (!targetId || String(agent.target_id || '').toLowerCase() !== targetId) throw new Error('fleet_transport_preconversation_target_binding_mismatch');
    if (!Number.isSafeInteger(generationEpoch) || Number(agent.generation_epoch) !== generationEpoch) {
      throw new Error('fleet_transport_preconversation_generation_binding_mismatch');
    }
    const normalizedUrl = normalizeRootChatGptUrl(transport_url);
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
