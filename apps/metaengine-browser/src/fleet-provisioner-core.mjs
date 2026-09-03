import crypto from 'node:crypto';
import { globalOwnerGateDisabled } from './owner-safety-gate-registry.mjs';
import { persistFleetStateTargetRevalidation } from './fleet-state-target-revalidation.mjs';

export const FLEET_PROVISIONER_VERSION = '1.5.0';
export const FLEET_STATES = Object.freeze([
  'REGISTERED',
  'PROVISIONING',
  'BOUND_UNVERIFIED',
  'ACTIVE',
  'PROVISIONING_AMBIGUOUS',
  'LOST',
  'RETIRED',
]);

export const FLEET_PROFILES = Object.freeze({
  BALANCED: Object.freeze(['PLANNER', 'RESEARCHER', 'IMPLEMENTER', 'CRITIC', 'FALSIFIER', 'SYNTHESIZER']),
  RESEARCH: Object.freeze(['PLANNER', 'RESEARCHER', 'RESEARCHER_2', 'CRITIC', 'FALSIFIER', 'SYNTHESIZER']),
  IMPLEMENTATION: Object.freeze(['ARCHITECT', 'IMPLEMENTER', 'TESTER', 'CRITIC', 'FALSIFIER', 'SYNTHESIZER']),
  INCIDENT: Object.freeze(['DIAGNOSTIC', 'REPRODUCER', 'RESEARCHER', 'FIX_REVIEWER', 'FALSIFIER', 'SYNTHESIZER']),
});

const DEFAULT_SEED_AGENTS = 6;
const DEFAULT_WARM_AGENTS = 2;
const DEFAULT_SPAWN_BURST_LIMIT = 8;
const MAX_SPAWN_BURST_LIMIT = 256;
// Bound on RETIRED evidence rows kept in the persisted state file. RETIRED
// rows carry no live slot and no tab binding; their forensic value decays, so
// only the newest RETIRED_HISTORY_LIMIT rows survive a restart (the state file
// is otherwise grow-only across capacity events).
const RETIRED_HISTORY_LIMIT = 64;
const LEGACY_CAPACITY_AMBIGUITY = 'CREATE_TAB_AMBIGUOUS:tab_capacity_exceeded';
const CAPACITY_BACKPRESSURE_REASON = 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT';

function clone(value) { return value == null ? value : structuredClone(value); }
function iso(clock) {
  const d = new Date(clock());
  if (!Number.isFinite(d.getTime())) throw new Error('fleet_clock_invalid');
  return d.toISOString();
}
function nonNegativeInteger(value, fallback, name) {
  const out = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new Error(`fleet_${name}_invalid`);
  return out;
}
function burstLimit(value, fallback = DEFAULT_SPAWN_BURST_LIMIT) {
  const out = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > MAX_SPAWN_BURST_LIMIT) throw new Error('fleet_spawn_burst_limit_invalid');
  return out;
}
function isDeterministicPreEffectCapacityError(error) {
  return String(error?.message || error) === 'tab_capacity_exceeded';
}
function normalizePolicy(policy = {}) {
  const profile = String(policy.profile || 'BALANCED').toUpperCase();
  if (!FLEET_PROFILES[profile]) throw new Error('fleet_profile_invalid');
  const warmAgents = nonNegativeInteger(policy.warm_agents, DEFAULT_WARM_AGENTS, 'warm_agents');
  const desiredAgents = nonNegativeInteger(policy.desired_agents, DEFAULT_SEED_AGENTS, 'desired_agents');
  const spawnBurstLimit = burstLimit(policy.spawn_burst_limit, DEFAULT_SPAWN_BURST_LIMIT);
  if (warmAgents > desiredAgents) throw new Error('fleet_capacity_order_invalid');
  return Object.freeze({
    profile,
    warm_agents: warmAgents,
    desired_agents: desiredAgents,
    elastic: true,
    hard_agent_cap: null,
    max_agents: null,
    spawn_burst_limit: spawnBurstLimit,
    legacy_max_agents_ignored: policy.max_agents != null,
    capacity_model: 'ELASTIC_BACKLOG_DRIVEN',
    adopt_existing: false,
    direct_peer_messaging: false,
    browser_authority: false,
    automatic_work_retry: false,
    idle_physical_tabs: false,
  });
}

function freshState(policy) {
  return {
    schema: 'metaengine.browser.fleet-state.v1',
    version: FLEET_PROVISIONER_VERSION,
    policy: clone(policy),
    agents: [],
    updated_at: null,
  };
}

function sanitizeTransportProof(value) {
  if (!value || value.schema !== 'metaengine.browser.fleet-transport-proof.v1') return null;
  const tabId = String(value.tab_id || '');
  const targetId = String(value.target_id || '').toLowerCase();
  const generationEpoch = Number(value.generation_epoch);
  const conversationUrlSha256 = String(value.conversation_url_sha256 || '').toLowerCase();
  const provenAt = String(value.proven_at || '');
  if (!tabId || !targetId || !Number.isSafeInteger(generationEpoch) || generationEpoch < 1) return null;
  if (!/^[a-f0-9]{64}$/.test(conversationUrlSha256) || !provenAt) return null;
  return {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    tab_id: tabId,
    target_id: targetId,
    generation_epoch: generationEpoch,
    conversation_url_sha256: conversationUrlSha256,
    proven_at: provenAt,
    authority_effect: false,
  };
}

function normalizeConversationUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('fleet_transport_conversation_origin_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!/^\/c\/[a-z0-9-]+$/i.test(path)) throw new Error('fleet_transport_conversation_path_invalid');
  return `https://chatgpt.com${path.toLowerCase()}`;
}

function sanitizeLoadedState(input, policy) {
  if (!input || input.schema !== 'metaengine.browser.fleet-state.v1' || !Array.isArray(input.agents)) return freshState(policy);
  const agents = [];
  const seen = new Set();
  for (const row of input.agents) {
    if (!row || typeof row !== 'object') continue;
    const agentId = String(row.agent_id || '').toLowerCase();
    if (!/^agent_[a-z0-9-]{8,64}$/.test(agentId) || seen.has(agentId)) continue;
    let lifecycle = FLEET_STATES.includes(row.lifecycle_state) ? row.lifecycle_state : 'LOST';
    const transportProof = sanitizeTransportProof(row.transport_proof);
    if (lifecycle === 'ACTIVE' && !transportProof) lifecycle = 'BOUND_UNVERIFIED';
    seen.add(agentId);
    agents.push({
      agent_id: agentId,
      role: String(row.role || 'WORKER').toUpperCase(),
      ownership: 'FLEET_OWNED',
      lifecycle_state: lifecycle === 'PROVISIONING' ? 'LOST' : lifecycle,
      tab_id: row.tab_id ? String(row.tab_id) : null,
      target_id: row.target_id ? String(row.target_id) : null,
      conversation_epoch: Number.isSafeInteger(Number(row.conversation_epoch)) ? Number(row.conversation_epoch) : 0,
      generation_epoch: Number.isSafeInteger(Number(row.generation_epoch)) ? Number(row.generation_epoch) : 1,
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
      lost_reason: row.lost_reason ? String(row.lost_reason) : null,
      ambiguous_reason: row.ambiguous_reason ? String(row.ambiguous_reason) : null,
      transport_proof: transportProof,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
  // Bounded RETIRED history: RETIRED rows hold no slot and no tab, so only the
  // newest RETIRED_HISTORY_LIMIT survive a restart. Everything else is kept
  // verbatim (AMBIGUOUS rows are fenced evidence and are never pruned here).
  const retiredRows = agents.filter((a) => a.lifecycle_state === 'RETIRED');
  if (retiredRows.length > RETIRED_HISTORY_LIMIT) {
    const drop = new Set(retiredRows
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(RETIRED_HISTORY_LIMIT)
      .map((a) => a.agent_id));
    for (let i = agents.length - 1; i >= 0; i -= 1) {
      if (drop.has(agents[i].agent_id)) agents.splice(i, 1);
    }
  }
  return {
    schema: 'metaengine.browser.fleet-state.v1',
    version: FLEET_PROVISIONER_VERSION,
    policy: clone(policy),
    agents,
    updated_at: input.updated_at || null,
  };
}

export class FleetProvisioner {
  #createTab;
  #loadTab;
  #tabExists;
  #loadState;
  #saveState;
  #census;
  #clock;
  #uuid;
  #state;
  #ready = false;
  #mutex = Promise.resolve();
  #capacityBackpressure = false;
  #capacityRetiredAttempts = 0;

  constructor({ createTab, loadTab, tabExists, loadState, saveState, census = null, policy, clock = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
    if (![createTab, loadTab, tabExists, loadState, saveState].every((fn) => typeof fn === 'function')) throw new Error('fleet_dependency_invalid');
    if (census != null && typeof census !== 'function') throw new Error('fleet_census_dependency_invalid');
    this.#createTab = createTab;
    this.#loadTab = loadTab;
    this.#tabExists = tabExists;
    this.#loadState = loadState;
    this.#saveState = saveState;
    this.#census = typeof census === 'function' ? census : null;
    this.#clock = clock;
    this.#uuid = uuid;
    this.#state = freshState(normalizePolicy(policy));
  }

  async init() {
    const loaded = await this.#loadState();
    this.#state = sanitizeLoadedState(loaded, this.#state.policy);
    this.#capacityBackpressure = false;
    this.#capacityRetiredAttempts = 0;
    for (const agent of this.#state.agents) {
      if (agent.lifecycle_state === 'PROVISIONING_AMBIGUOUS' && agent.ambiguous_reason === LEGACY_CAPACITY_AMBIGUITY) {
        agent.lifecycle_state = 'RETIRED';
        agent.tab_id = null;
        agent.target_id = null;
        agent.transport_proof = null;
        agent.generation_epoch += 1;
        agent.lost_reason = CAPACITY_BACKPRESSURE_REASON;
        agent.ambiguous_reason = null;
        agent.updated_at = iso(this.#clock);
        this.#capacityBackpressure = true;
        this.#capacityRetiredAttempts += 1;
        continue;
      }
      if (agent.tab_id && !this.#tabExists(agent.tab_id) && !['RETIRED', 'PROVISIONING_AMBIGUOUS'].includes(agent.lifecycle_state)) {
        agent.lifecycle_state = 'LOST';
        agent.lost_reason = 'PHYSICAL_TAB_MISSING_ON_RESTART';
        agent.tab_id = null;
        agent.target_id = null;
        agent.transport_proof = null;
        agent.generation_epoch += 1;
        agent.updated_at = iso(this.#clock);
      } else if (agent.lifecycle_state === 'ACTIVE') {
        agent.lifecycle_state = 'BOUND_UNVERIFIED';
        agent.transport_proof = null;
        agent.generation_epoch += 1;
        agent.updated_at = iso(this.#clock);
      }
    }
    this.#ready = true;
    await this.#persist();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser.fleet-snapshot.v1',
      version: FLEET_PROVISIONER_VERSION,
      lifecycle_owner: 'METAENGINE_BROWSER',
      readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
      policy: clone(this.#state.policy),
      agents: this.#state.agents.map(clone),
      counts: Object.fromEntries(FLEET_STATES.map((state) => [state, this.#state.agents.filter((a) => a.lifecycle_state === state).length])),
      owner_override_ambiguous_compensating_fanout: globalOwnerGateDisabled('fleet.ambiguous_compensating_fanout'),
      capacity_backpressure: {
        blocked: this.#capacityBackpressure,
        retired_no_effect_attempts: this.#capacityRetiredAttempts,
        reason: this.#capacityBackpressure ? CAPACITY_BACKPRESSURE_REASON : null,
        deterministic_no_effect: true,
        automatic_retry_allowed: false,
        release_signal: 'PHYSICAL_TAB_CLOSED',
        census_probe: this.#readCensus(),
        authority_effect: false,
      },
      authority_effect: false,
    });
  }

  async setProfile(profile) {
    return this.#serial(async () => {
      const next = normalizePolicy({ ...this.#state.policy, profile });
      this.#state.policy = clone(next);
      await this.#persist();
      return this.snapshot();
    });
  }

  async setTargetAgents(targetAgents) {
    return this.#serial(async () => {
      this.#assertReady();
      const target = nonNegativeInteger(targetAgents, this.#state.policy.desired_agents, 'desired_agents');
      if (target < this.#state.policy.warm_agents) throw new Error('fleet_capacity_order_invalid');
      this.#state.policy = clone(normalizePolicy({ ...this.#state.policy, desired_agents: target }));
      await this.#persist();
      return this.snapshot();
    });
  }

  async revalidateTargetBinding({ agent_id, observeLocalTarget } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      const nextState = await persistFleetStateTargetRevalidation({
        state: this.#state,
        agent_id,
        observeLocalTarget,
        saveState: this.#saveState,
      });
      this.#state = clone(nextState);
      return this.snapshot();
    });
  }

  async markTransportProven({ agent_id, tab_id, target_id, generation_epoch, conversation_url } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      const agent = this.#requireAgent(agent_id);
      const tabId = String(tab_id || '');
      const targetId = String(target_id || '').toLowerCase();
      const generationEpoch = Number(generation_epoch);
      if (!['BOUND_UNVERIFIED', 'ACTIVE'].includes(agent.lifecycle_state)) throw new Error(`fleet_transport_state_invalid:${agent.lifecycle_state}`);
      if (!tabId || agent.tab_id !== tabId) throw new Error('fleet_transport_tab_binding_mismatch');
      if (!targetId || String(agent.target_id || '').toLowerCase() !== targetId) throw new Error('fleet_transport_target_binding_mismatch');
      if (!Number.isSafeInteger(generationEpoch) || generationEpoch !== agent.generation_epoch) throw new Error('fleet_transport_generation_binding_mismatch');
      const conversationUrl = normalizeConversationUrl(conversation_url);
      agent.transport_proof = {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: tabId,
        target_id: targetId,
        generation_epoch: generationEpoch,
        conversation_url_sha256: crypto.createHash('sha256').update(conversationUrl, 'utf8').digest('hex'),
        proven_at: iso(this.#clock),
        authority_effect: false,
      };
      agent.lifecycle_state = 'ACTIVE';
      agent.lost_reason = null;
      agent.ambiguous_reason = null;
      agent.updated_at = iso(this.#clock);
      await this.#persist();
      return this.snapshot();
    });
  }

  async reconcile({ active = false, target_agents = null, spawn_burst_limit = null } = {}) {
    return this.#serial(async () => {
      this.#assertReady();
      if (active && this.#capacityBackpressure) return this.snapshot();
      const desired = active
        ? nonNegativeInteger(target_agents, this.#state.policy.desired_agents, 'desired_agents')
        : this.#state.policy.warm_agents;
      if (desired < this.#state.policy.warm_agents) throw new Error('fleet_capacity_order_invalid');
      const burst = burstLimit(spawn_burst_limit, this.#state.policy.spawn_burst_limit);
      if (active && target_agents != null && desired !== this.#state.policy.desired_agents) {
        this.#state.policy = clone(normalizePolicy({ ...this.#state.policy, desired_agents: desired }));
        await this.#persist();
      }

      let createdThisCycle = 0;
      while (this.#slotCount() < desired && createdThisCycle < burst) {
        const agent = this.#newRegisteredAgent();
        this.#state.agents.push(agent);
        createdThisCycle += 1;
        await this.#persist();
      }

      if (!active) return this.snapshot();

      let provisionedThisCycle = 0;
      // Census gate (W3): when a read-only capacity probe is available and it
      // proves the fleet is at its per-kind ceiling (or the shared wall), the
      // pass adopts the identical deterministic pre-effect no-op posture as a
      // failed createTab — WITHOUT attempting the doomed create. The signal,
      // ambiguity semantics, and release contract (physical tab close) are all
      // unchanged; only the evidence source improves (read vs side effect).
      const censusProbe = this.#readCensus();
      if (censusProbe && (censusProbe.fleet_at_ceiling || censusProbe.total_at_wall) && !this.#capacityBackpressure) {
        this.#capacityBackpressure = true;
      }
      const activatable = this.#state.agents.filter((agent) => ['REGISTERED', 'LOST'].includes(agent.lifecycle_state));
      for (const agent of activatable) {
        if (this.#liveCount() >= desired || provisionedThisCycle >= burst || this.#capacityBackpressure) break;
        await this.#provision(agent, { isRecovery: agent.lifecycle_state === 'LOST' });
        provisionedThisCycle += 1;
      }

      if (globalOwnerGateDisabled('fleet.ambiguous_compensating_fanout')) {
        while (!this.#capacityBackpressure && this.#liveCount() < desired && createdThisCycle < burst && provisionedThisCycle < burst) {
          const agent = this.#newRegisteredAgent();
          this.#state.agents.push(agent);
          createdThisCycle += 1;
          await this.#persist();
          await this.#provision(agent, { isRecovery: false });
          provisionedThisCycle += 1;
        }
      }

      return this.snapshot();
    });
  }

  async onTabClosed(tabId, reason = 'PHYSICAL_TAB_CLOSED') {
    return this.#serial(async () => {
      if (this.#capacityBackpressure) this.#capacityBackpressure = false;
      const agent = this.#state.agents.find((row) => row.tab_id === String(tabId));
      if (!agent || ['RETIRED', 'PROVISIONING_AMBIGUOUS'].includes(agent.lifecycle_state)) return this.snapshot();
      agent.lifecycle_state = 'LOST';
      agent.tab_id = null;
      agent.target_id = null;
      agent.transport_proof = null;
      agent.generation_epoch += 1;
      agent.lost_reason = String(reason);
      agent.updated_at = iso(this.#clock);
      await this.#persist();
      return this.snapshot();
    });
  }

  async retire(agentId) {
    return this.#serial(async () => {
      const agent = this.#requireAgent(agentId);
      if (agent.lifecycle_state === 'RETIRED') return this.snapshot();
      agent.lifecycle_state = 'RETIRED';
      agent.tab_id = null;
      agent.target_id = null;
      agent.transport_proof = null;
      agent.generation_epoch += 1;
      agent.updated_at = iso(this.#clock);
      await this.#persist();
      return this.snapshot();
    });
  }

  #newRegisteredAgent() {
    const at = iso(this.#clock);
    return {
      agent_id: `agent_${String(this.#uuid()).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`,
      role: this.#nextRole(),
      ownership: 'FLEET_OWNED',
      lifecycle_state: 'REGISTERED',
      tab_id: null,
      target_id: null,
      conversation_epoch: 0,
      generation_epoch: 1,
      created_at: at,
      updated_at: at,
      lost_reason: null,
      ambiguous_reason: null,
      transport_proof: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
  }

  #assertReady() { if (!this.#ready) throw new Error('fleet_not_initialized'); }
  // Read-only census probe (W3). Never throws: an unavailable or malformed
  // census degrades to null and the provisioner falls back to the existing
  // learn-by-failed-attempt posture (which remains deterministic).
  #readCensus() {
    if (typeof this.#census !== 'function') return null;
    try {
      const value = this.#census();
      if (!value || typeof value !== 'object') return null;
      const fleetTabs = Number(value.by_role?.FLEET);
      const totalTabs = Number(value.total_tabs);
      const fleetCeiling = Number(value.fleet_tab_ceiling);
      const maxTabs = Number(value.max_tabs);
      if (![fleetTabs, totalTabs, fleetCeiling, maxTabs].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
      if (fleetCeiling > maxTabs) return null;
      return Object.freeze({
        schema: 'metaengine.browser.tab-census.v1',
        fleet_tabs: fleetTabs,
        total_tabs: totalTabs,
        user_tabs: totalTabs - fleetTabs,
        fleet_tab_ceiling: fleetCeiling,
        max_tabs: maxTabs,
        fleet_at_ceiling: fleetTabs >= fleetCeiling,
        total_at_wall: totalTabs >= maxTabs,
        authority_effect: false,
      });
    } catch {
      return null;
    }
  }
  #requireAgent(agentId) {
    const agent = this.#state.agents.find((row) => row.agent_id === String(agentId).toLowerCase());
    if (!agent) throw new Error('fleet_agent_not_found');
    return agent;
  }
  #slotCount() {
    const ignoreAmbiguous = globalOwnerGateDisabled('fleet.ambiguous_compensating_fanout');
    return this.#state.agents.filter((a) => a.lifecycle_state !== 'RETIRED' && !(ignoreAmbiguous && a.lifecycle_state === 'PROVISIONING_AMBIGUOUS')).length;
  }
  #liveCount() { return this.#state.agents.filter((a) => ['PROVISIONING', 'BOUND_UNVERIFIED', 'ACTIVE'].includes(a.lifecycle_state)).length; }
  #nextRole() {
    const roles = FLEET_PROFILES[this.#state.policy.profile];
    const active = this.#state.agents.filter((a) => a.lifecycle_state !== 'RETIRED');
    const counts = new Map(roles.map((r) => [r, 0]));
    for (const agent of active) if (counts.has(agent.role)) counts.set(agent.role, counts.get(agent.role) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1] || roles.indexOf(a[0]) - roles.indexOf(b[0]))[0]?.[0] || roles[0];
  }

  async #provision(agent, { isRecovery }) {
    agent.lifecycle_state = 'PROVISIONING';
    agent.updated_at = iso(this.#clock);
    agent.lost_reason = null;
    agent.transport_proof = null;
    await this.#persist();

    let tab;
    try {
      tab = await this.#createTab({
        url: 'https://chatgpt.com/',
        select: false,
        load: false,
        ownership: 'FLEET_OWNED',
        agent_id: agent.agent_id,
      });
    } catch (error) {
      if (isDeterministicPreEffectCapacityError(error)) {
        agent.lifecycle_state = 'RETIRED';
        agent.tab_id = null;
        agent.target_id = null;
        agent.transport_proof = null;
        agent.generation_epoch += 1;
        agent.lost_reason = CAPACITY_BACKPRESSURE_REASON;
        agent.ambiguous_reason = null;
        agent.updated_at = iso(this.#clock);
        this.#capacityBackpressure = true;
        this.#capacityRetiredAttempts += 1;
        await this.#persist();
        return;
      }
      agent.lifecycle_state = 'PROVISIONING_AMBIGUOUS';
      agent.ambiguous_reason = `CREATE_TAB_AMBIGUOUS:${String(error?.message || error)}`.slice(0, 240);
      agent.updated_at = iso(this.#clock);
      await this.#persist();
      return;
    }

    agent.tab_id = String(tab.tab_id);
    agent.target_id = `webcontents:${String(tab.webcontents_id ?? tab.tab_id)}`.toLowerCase();
    agent.conversation_epoch += isRecovery ? 1 : 0;
    agent.lifecycle_state = 'BOUND_UNVERIFIED';
    agent.ambiguous_reason = null;
    agent.transport_proof = null;
    agent.updated_at = iso(this.#clock);
    await this.#persist();

    try {
      await this.#loadTab(agent.tab_id, 'https://chatgpt.com/');
    } catch (error) {
      agent.lost_reason = `SURFACE_LOAD_UNVERIFIED:${String(error?.message || error)}`.slice(0, 240);
      agent.updated_at = iso(this.#clock);
      await this.#persist();
    }
  }

  async #persist() {
    this.#state.updated_at = iso(this.#clock);
    await this.#saveState(clone(this.#state));
  }

  #serial(fn) {
    const next = this.#mutex.then(fn, fn);
    this.#mutex = next.catch(() => {});
    return next;
  }
}