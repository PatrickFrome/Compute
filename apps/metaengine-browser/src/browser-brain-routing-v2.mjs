export const BROWSER_BRAIN_ROUTING_V2_SCHEMA = 'metaengine.browser-brain.agent-routing.v2';
export const BROWSER_BRAIN_FANOUT_PLAN_SCHEMA = 'metaengine.browser-brain.sparse-fanout-plan.v1';

function clamp01(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }
function boundedInt(v, f, min, max) { const n = Number(v); return Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : f; }
function unique(v = [], max = 64) { return [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, max); }
function agentId(v) { const s = String(v || '').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(s)) throw new Error('browser_brain_routing_agent_invalid'); return s; }

export class BrowserBrainRoutingV2 {
  #maxAgents; #agents = new Map(); #routes = 0; #clock; #ttl;
  constructor({ maxAgents = 256, clock = () => Date.now(), observationTtlMs = 30_000 } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_brain_routing_clock_invalid');
    this.#maxAgents = boundedInt(maxAgents, 256, 1, 1024);
    this.#clock = clock;
    this.#ttl = boundedInt(observationTtlMs, 30_000, 1, 120_000);
  }

  observeAgent({ agent_id, role = 'AGENT', provider = 'unknown', capabilities = [], status = 'UNKNOWN', target_tab_id = null, contexts = [], load = 0, success_rate = 0.5, novelty = 0.5, recent_task_keys = [], generation = 1, observed_at_ms = this.#clock() } = {}) {
    const id = agentId(agent_id);
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(observed_at_ms) || observed_at_ms < 0
      || observed_at_ms > now + 5_000) throw new Error('browser_brain_routing_observation_time_invalid');
    if (!this.#agents.has(id) && this.#agents.size >= this.#maxAgents) {
      const lost = [...this.#agents.values()].find((r) => r.status === 'LOST');
      if (!lost) throw new Error('browser_brain_routing_agent_capacity_exceeded');
      this.#agents.delete(lost.agentId);
    }
    const prior = this.#agents.get(id);
    const gen = boundedInt(generation, 1, 1, Number.MAX_SAFE_INTEGER);
    if (prior && gen < prior.generation) throw new Error('browser_brain_routing_generation_regression');
    if (prior && observed_at_ms < prior.observedAt) throw new Error('browser_brain_routing_observation_regression');
    const row = {
      agentId: id,
      role: String(role).toUpperCase().slice(0, 64),
      provider: String(provider).toLowerCase().slice(0, 64),
      capabilities: unique(capabilities),
      status: String(status).toUpperCase().slice(0, 32),
      targetTabId: target_tab_id == null ? null : String(target_tab_id).toLowerCase(),
      contexts: unique(contexts),
      load: clamp01(load),
      successRate: clamp01(success_rate, 0.5),
      novelty: clamp01(novelty, 0.5),
      recentTaskKeys: unique(recent_task_keys, 128),
      generation: gen,
      observedAt: observed_at_ms,
    };
    this.#agents.set(id, row);
    return Object.freeze({ agent_id: id, generation: gen, authority_effect: false });
  }

  route({ required_capabilities = [], context_id = null, target_tab_id = null, preferred_provider = null, task_key = null, limit = 16 } = {}) {
    const required = unique(required_capabilities);
    const context = context_id == null ? null : String(context_id).toLowerCase();
    const tab = target_tab_id == null ? null : String(target_tab_id).toLowerCase();
    const provider = preferred_provider == null ? null : String(preferred_provider).toLowerCase();
    const key = task_key == null ? null : String(task_key).toLowerCase();
    const max = boundedInt(limit, 16, 1, 64);
    const candidates = [];
    const now = this.#clock();
    for (const row of this.#agents.values()) {
      if (row.status !== 'READY' || !Number.isSafeInteger(now)
        || row.observedAt > now + 5_000 || now - row.observedAt > this.#ttl) continue;
      const matched = required.filter((cap) => row.capabilities.includes(cap)).length;
      const capabilityFit = required.length === 0 ? 1 : matched / required.length;
      if (required.length > 0 && capabilityFit < 1) continue;
      const contextLocality = context == null ? 0.5 : row.contexts.includes(context) ? 1 : 0.25;
      const tabLocality = tab == null ? 0.5 : row.targetTabId === tab ? 1 : row.targetTabId == null ? 0.4 : 0;
      const locality = 0.65 * contextLocality + 0.35 * tabLocality;
      const loadScore = 1 - row.load;
      const providerBonus = provider && row.provider === provider ? 0.05 : 0;
      const novelty = key && row.recentTaskKeys.includes(key) ? row.novelty * 0.4 : row.novelty;
      const score = Math.min(1, 0.35 * capabilityFit + 0.2 * locality + 0.15 * loadScore + 0.2 * row.successRate + 0.1 * novelty + providerBonus);
      const why = [];
      if (capabilityFit === 1) why.push('REQUIRED_CAPABILITIES_MATCH');
      if (contextLocality === 1) why.push('CONTEXT_LOCALITY');
      if (tabLocality === 1) why.push('TARGET_TAB_LOCALITY');
      if (loadScore >= 0.7) why.push('LOW_CURRENT_LOAD');
      if (row.successRate >= 0.75) why.push('HIGH_HISTORICAL_SUCCESS');
      if (novelty >= 0.7) why.push('NOVELTY_BENEFIT');
      if (providerBonus > 0) why.push('PREFERRED_PROVIDER');
      candidates.push({ row, score, why, components: { capability_fit: capabilityFit, context_locality: contextLocality, tab_locality: tabLocality, load_score: loadScore, success_rate: row.successRate, novelty, provider_bonus: providerBonus } });
    }
    candidates.sort((a, b) => b.score - a.score || a.row.load - b.row.load || a.row.agentId.localeCompare(b.row.agentId));
    this.#routes += 1;
    return Object.freeze({
      schema: BROWSER_BRAIN_ROUTING_V2_SCHEMA,
      candidates: Object.freeze(candidates.slice(0, max).map((c, index) => Object.freeze({
        rank: index + 1, agent_id: c.row.agentId, role: c.row.role, provider: c.row.provider, generation: c.row.generation,
        score: Number(c.score.toFixed(6)), score_components: Object.freeze(c.components), why_selected: Object.freeze(c.why),
        selection_is_advisory: true, assignment_created: false, scheduler_authority: false, execution_authority: false, authority_effect: false,
      }))),
      required_capabilities: Object.freeze(required), context_id: context, target_tab_id: tab,
      current_scheduler_remains_authority: true, scheduler_authority: false, execution_authority: false, authority_effect: false,
    });
  }

  snapshot() { return Object.freeze({ schema: BROWSER_BRAIN_ROUTING_V2_SCHEMA, agent_count: this.#agents.size, route_count: this.#routes, observation_ttl_ms: this.#ttl, scoring: 'CAPABILITY_CONTEXT_LOAD_SUCCESS_NOVELTY', current_scheduler_remains_only_scheduler: true, scheduler_authority: false, execution_authority: false, authority_effect: false }); }
}

export function planAdaptiveSparseFanout({ parallelizability = 0, cost_budget_units = 1, unit_cost_per_agent = 1, verification_mode = false, risk = 0.5 } = {}) {
  const p = clamp01(parallelizability); const r = clamp01(risk, 0.5);
  const budget = Number(cost_budget_units); const unit = Number(unit_cost_per_agent);
  const validCost = Number.isFinite(budget) && budget >= 0 && Number.isFinite(unit) && unit > 0;
  const budgetCap = validCost ? Math.max(0, Math.min(5, Math.floor(budget / unit))) : 0;
  let desired = p < 0.3 ? 1 : p < 0.55 ? 2 : p < 0.8 ? 3 : 5;
  if (r >= 0.8 && desired > 2) desired = 2;
  if (verification_mode === true) desired = Math.max(2, desired);
  const blocked = !validCost ? 'INVALID_COST_INPUT'
    : budgetCap === 0 ? 'INSUFFICIENT_BUDGET'
      : verification_mode === true && budgetCap < 2 ? 'INDEPENDENT_VERIFICATION_UNAFFORDABLE' : null;
  const fanout = blocked ? 0 : Math.min(5, desired, budgetCap);
  return Object.freeze({
    schema: BROWSER_BRAIN_FANOUT_PLAN_SCHEMA,
    fanout,
    desired_fanout_before_budget: desired,
    parallelizability: p,
    cost_budget_units: Number.isFinite(budget) ? budget : null,
    unit_cost_per_agent: Number.isFinite(unit) ? unit : null,
    budget_cap: budgetCap,
    blocked_reason: blocked,
    estimated_cost_units: fanout * (validCost ? unit : 0),
    independent_verification_possible: fanout >= 2,
    verification_mode: verification_mode === true,
    risk: r,
    sparse: true,
    allowed_range: Object.freeze([0, 1, 2, 3, 4, 5]),
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}
