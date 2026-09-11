import { BrowserBrainStreamClock } from './browser-brain-stream-clock.mjs';

export const BROWSER_BRAIN_COGNITION_FABRIC_SCHEMA = 'metaengine.browser-brain.cognition-fabric.v1';
export const BROWSER_BRAIN_ADVISORY_PLAN_SCHEMA = 'metaengine.browser-brain.advisory-plan.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const SAFE_ACTION_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_STATUS = new Set(['READY', 'BUSY', 'DRAINING', 'DEGRADED', 'LOST', 'UNKNOWN']);
const INVALIDATING_TYPES = new Set([
  'WEB_CONTENTS_DESTROYED',
  'RENDER_PROCESS_GONE',
  'WEB_CONTENTS_UNRESPONSIVE',
]);
const INVALIDATING_SEMANTIC_METHODS = new Set([
  'DOM.documentUpdated',
  'Page.frameNavigated',
  'Page.navigatedWithinDocument',
  'METAENGINE.DebuggerDetached',
  'METAENGINE.TargetDetached',
]);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nonNegativeInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function safeId(value, code, { lower = false, max = 192 } = {}) {
  const raw = String(value || '').trim();
  const out = lower ? raw.toLowerCase() : raw;
  if (!out || out.length > max || !SAFE_ID_RE.test(out)) throw new Error(code);
  return out;
}

function tabId(value) {
  const id = String(value || '').trim().toLowerCase();
  return TAB_ID_RE.test(id) ? id : null;
}

function action(value) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_ACTION_RE.test(out)) throw new Error('browser_brain_cognition_action_invalid');
  return out;
}

function uniqueStrings(value, max = 32) {
  if (!Array.isArray(value) || value.length > max) throw new Error('browser_brain_cognition_list_invalid');
  return Object.freeze([...new Set(value.map((row) => safeId(row, 'browser_brain_cognition_token_invalid', { lower: true, max: 96 })))].sort());
}

function generationTuple(value = {}) {
  const binding = nonNegativeInt(value.binding_generation);
  const document = nonNegativeInt(value.document_generation);
  const semantic = nonNegativeInt(value.semantic_revision);
  if (binding == null || document == null || semantic == null) {
    throw new Error('browser_brain_cognition_generation_invalid');
  }
  return Object.freeze({
    binding_generation: binding,
    document_generation: document,
    semantic_revision: semantic,
  });
}

function sameGeneration(a, b) {
  return Boolean(a && b
    && a.binding_generation === b.binding_generation
    && a.document_generation === b.document_generation
    && a.semantic_revision === b.semantic_revision);
}

function publicAgent(row) {
  return Object.freeze({
    agent_id: row.agentId,
    role: row.role,
    provider: row.provider,
    capabilities: Object.freeze([...row.capabilities]),
    generation: row.generation,
    status: row.status,
    target_tab_id: row.targetTabId,
    observed_at: row.observedAt,
    execution_authority: false,
    scheduler_authority: false,
    authority_effect: false,
  });
}

function publicPlan(row) {
  return Object.freeze({
    schema: BROWSER_BRAIN_ADVISORY_PLAN_SCHEMA,
    tab_id: row.tabId,
    intent_id: row.intentId,
    action: row.action,
    candidate_ref: row.candidateRef,
    semantic_fingerprint: row.semanticFingerprint,
    locator_fingerprint: row.locatorFingerprint,
    generations: row.generations,
    recorded_at_ms: row.recordedAtMs,
    revalidation_required: true,
    execution_payload_stored: false,
    actuation_eligible: false,
    execution_authority: false,
    authority_effect: false,
  });
}

export class BrowserBrainCognitionFabric {
  #clock;
  #streamClock;
  #maxCells;
  #factsPerCell;
  #maxPlans;
  #maxAgents;
  #maxEvidence;
  #planMaxAgeMs;
  #cellFacts = new Map();
  #plans = new Map();
  #agents = new Map();
  #evidence = new Map();
  #evidenceOrder = [];
  #lastClockResults = [];
  #edgeCount = 0;
  #semanticEdgeCount = 0;
  #planHits = 0;
  #planMisses = 0;
  #planInvalidations = 0;
  #agentUpdates = 0;
  #evidenceEvictions = 0;
  #clockGaps = 0;
  #clockRegressions = 0;

  constructor({
    clock = () => Date.now(),
    streamClock = null,
    maxCells = 128,
    factsPerCell = 16,
    maxPlans = 1024,
    maxAgents = 128,
    maxEvidence = 1024,
    planMaxAgeMs = 60_000,
  } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_brain_cognition_clock_invalid');
    this.#clock = clock;
    this.#streamClock = streamClock || new BrowserBrainStreamClock({ maxSources: 64 });
    if (typeof this.#streamClock.observe !== 'function' || typeof this.#streamClock.snapshot !== 'function') {
      throw new Error('browser_brain_cognition_stream_clock_invalid');
    }
    this.#maxCells = boundedInt(maxCells, 128, 1, 512);
    this.#factsPerCell = boundedInt(factsPerCell, 16, 1, 64);
    this.#maxPlans = boundedInt(maxPlans, 1024, 1, 8192);
    this.#maxAgents = boundedInt(maxAgents, 128, 1, 256);
    this.#maxEvidence = boundedInt(maxEvidence, 1024, 1, 8192);
    this.#planMaxAgeMs = boundedInt(planMaxAgeMs, 60_000, 1_000, 10 * 60_000);
  }

  #now() {
    const value = Number(this.#clock());
    if (!Number.isFinite(value) || value < 0) throw new Error('browser_brain_cognition_clock_invalid');
    return value;
  }

  #factCell(id) {
    let row = this.#cellFacts.get(id);
    if (row) return row;
    if (this.#cellFacts.size >= this.#maxCells) {
      const first = this.#cellFacts.keys().next().value;
      if (first != null) this.#cellFacts.delete(first);
    }
    row = [];
    this.#cellFacts.set(id, row);
    return row;
  }

  #invalidateTab(id) {
    let removed = 0;
    for (const [key, row] of [...this.#plans.entries()]) {
      if (row.tabId !== id) continue;
      this.#plans.delete(key);
      removed += 1;
    }
    this.#planInvalidations += removed;
    return removed;
  }

  #observeProducer(clockResults, source, sequence) {
    const result = this.#streamClock.observe(source, sequence);
    clockResults.push(result);
    if (result.disposition === 'GAP') this.#clockGaps += 1;
    if (result.disposition === 'REGRESSION') this.#clockRegressions += 1;
  }

  observeEdge(event = {}) {
    const type = String(event?.type || 'UNKNOWN').toUpperCase();
    const clockResults = [];
    const processSequence = positiveInt(event?.seq);
    if (processSequence != null) this.#observeProducer(clockResults, 'process-plane', processSequence);
    if (type === 'SEMANTIC_EVENT') {
      const semanticSequence = positiveInt(event?.semantic_sequence);
      if (semanticSequence != null) this.#observeProducer(clockResults, 'semantic', semanticSequence);
    }
    this.#lastClockResults = clockResults.slice(-4);
    this.#edgeCount += 1;
    if (type === 'SEMANTIC_EVENT') this.#semanticEdgeCount += 1;

    const id = tabId(event?.tab_id);
    if (id && type !== 'METRICS_SAMPLE') {
      const facts = this.#factCell(id);
      facts.push(Object.freeze({
        type: text(type, 96),
        semantic_method: text(event?.semantic_method, 160),
        semantic_sequence: nonNegativeInt(event?.semantic_sequence),
        process_sequence: nonNegativeInt(event?.seq),
        reason: text(event?.reason, 160),
        observed_at: text(event?.observed_at, 64),
        raw_payload_exposed: false,
        authority_effect: false,
      }));
      if (facts.length > this.#factsPerCell) facts.splice(0, facts.length - this.#factsPerCell);
      const method = String(event?.semantic_method || '');
      if (INVALIDATING_TYPES.has(type) || INVALIDATING_SEMANTIC_METHODS.has(method)) this.#invalidateTab(id);
    }

    const streamClock = this.#streamClock.snapshot();
    return Object.freeze({
      schema: 'metaengine.browser-brain.cognition-edge-result.v1',
      clock: Object.freeze(clockResults),
      causal_epoch: streamClock.epoch,
      resync_required: streamClock.gap_requires_resync,
      authority_effect: false,
    });
  }

  reconcileProducerSequences({ process_sequence = null, semantic_sequence = null } = {}) {
    const recovered = [];
    const snapshot = this.#streamClock.snapshot();
    for (const [source, sequence] of [['process-plane', process_sequence], ['semantic', semantic_sequence]]) {
      const next = nonNegativeInt(sequence);
      if (next == null) continue;
      const row = snapshot.sources.find((candidate) => candidate.source === source);
      if (!row?.resync_required) continue;
      recovered.push(this.#streamClock.resync(source, next));
    }
    return Object.freeze(recovered);
  }

  rememberPlan({
    tab_id,
    intent_id,
    action: actionValue,
    candidate_ref,
    semantic_fingerprint,
    locator_fingerprint,
    binding_generation,
    document_generation,
    semantic_revision,
  } = {}) {
    const id = tabId(tab_id);
    if (!id) throw new Error('browser_brain_cognition_plan_tab_invalid');
    const intentId = safeId(intent_id, 'browser_brain_cognition_intent_invalid', { lower: true, max: 192 });
    const normalizedAction = action(actionValue);
    const candidateRef = safeId(candidate_ref, 'browser_brain_cognition_candidate_invalid', { max: 192 });
    const semanticFingerprint = safeId(semantic_fingerprint, 'browser_brain_cognition_semantic_fingerprint_invalid', { max: 192 });
    const locatorFingerprint = safeId(locator_fingerprint, 'browser_brain_cognition_locator_fingerprint_invalid', { max: 192 });
    const generations = generationTuple({ binding_generation, document_generation, semantic_revision });
    const key = `${id}\u001f${intentId}\u001f${normalizedAction}`;
    const row = Object.freeze({
      tabId: id,
      intentId,
      action: normalizedAction,
      candidateRef,
      semanticFingerprint,
      locatorFingerprint,
      generations,
      recordedAtMs: this.#now(),
    });
    if (this.#plans.has(key)) this.#plans.delete(key);
    this.#plans.set(key, row);
    while (this.#plans.size > this.#maxPlans) this.#plans.delete(this.#plans.keys().next().value);
    return publicPlan(row);
  }

  resolvePlan({
    tab_id,
    intent_id,
    action: actionValue,
    binding_generation,
    document_generation,
    semantic_revision,
    revalidate,
  } = {}) {
    const id = tabId(tab_id);
    if (!id) throw new Error('browser_brain_cognition_plan_tab_invalid');
    const intentId = safeId(intent_id, 'browser_brain_cognition_intent_invalid', { lower: true, max: 192 });
    const normalizedAction = action(actionValue);
    if (typeof revalidate !== 'function') throw new Error('browser_brain_cognition_revalidator_required');
    if (this.#streamClock.snapshot().gap_requires_resync) {
      this.#planMisses += 1;
      return Object.freeze({ hit: false, reason: 'CAUSAL_RESYNC_REQUIRED', actuation_eligible: false, authority_effect: false });
    }
    const key = `${id}\u001f${intentId}\u001f${normalizedAction}`;
    const row = this.#plans.get(key);
    if (!row) {
      this.#planMisses += 1;
      return Object.freeze({ hit: false, reason: 'NO_RECORD', actuation_eligible: false, authority_effect: false });
    }
    const current = generationTuple({ binding_generation, document_generation, semantic_revision });
    if (!sameGeneration(row.generations, current)) {
      this.#plans.delete(key);
      this.#planMisses += 1;
      this.#planInvalidations += 1;
      return Object.freeze({ hit: false, reason: 'GENERATION_CHANGED', actuation_eligible: false, authority_effect: false });
    }
    const age = this.#now() - row.recordedAtMs;
    if (age < 0 || age > this.#planMaxAgeMs) {
      this.#plans.delete(key);
      this.#planMisses += 1;
      this.#planInvalidations += 1;
      return Object.freeze({ hit: false, reason: 'EXPIRED', actuation_eligible: false, authority_effect: false });
    }
    if (revalidate(publicPlan(row)) !== true) {
      this.#planMisses += 1;
      return Object.freeze({ hit: false, reason: 'FRESH_REVALIDATION_FAILED', actuation_eligible: false, authority_effect: false });
    }
    this.#plans.delete(key);
    this.#plans.set(key, row);
    this.#planHits += 1;
    return Object.freeze({
      hit: true,
      reason: 'FINGERPRINT_AND_GENERATION_REVALIDATED',
      plan: publicPlan(row),
      revalidation_required_before_effect: true,
      actuation_eligible: false,
      execution_authority: false,
      authority_effect: false,
    });
  }

  observeAgent({ agent_id, role, provider, capabilities = [], generation = 1, status = 'UNKNOWN', target_tab_id = null, observed_at = null } = {}) {
    const agentId = safeId(agent_id, 'browser_brain_cognition_agent_invalid', { lower: true, max: 128 });
    const normalizedRole = safeId(role, 'browser_brain_cognition_agent_role_invalid', { max: 64 }).toUpperCase();
    const normalizedProvider = safeId(provider, 'browser_brain_cognition_agent_provider_invalid', { lower: true, max: 64 });
    const normalizedCapabilities = uniqueStrings(capabilities, 64);
    const normalizedGeneration = positiveInt(generation);
    if (normalizedGeneration == null) throw new Error('browser_brain_cognition_agent_generation_invalid');
    const normalizedStatus = String(status || 'UNKNOWN').toUpperCase();
    if (!SAFE_STATUS.has(normalizedStatus)) throw new Error('browser_brain_cognition_agent_status_invalid');
    const targetTabId = target_tab_id == null ? null : tabId(target_tab_id);
    if (target_tab_id != null && !targetTabId) throw new Error('browser_brain_cognition_agent_tab_invalid');
    const prior = this.#agents.get(agentId);
    if (!prior && this.#agents.size >= this.#maxAgents) {
      const lost = [...this.#agents.values()].find((row) => row.status === 'LOST');
      if (!lost) throw new Error('browser_brain_cognition_agent_capacity_exceeded');
      this.#agents.delete(lost.agentId);
    }
    if (prior && normalizedGeneration < prior.generation) throw new Error('browser_brain_cognition_agent_generation_regression');
    const row = Object.freeze({
      agentId,
      role: normalizedRole,
      provider: normalizedProvider,
      capabilities: normalizedCapabilities,
      generation: normalizedGeneration,
      status: normalizedStatus,
      targetTabId,
      observedAt: text(observed_at, 64) || new Date(this.#now()).toISOString(),
    });
    this.#agents.set(agentId, row);
    this.#agentUpdates += 1;
    return publicAgent(row);
  }

  routeAgents({ required_capabilities = [], preferred_provider = null, target_tab_id = null, limit = 16 } = {}) {
    const required = uniqueStrings(required_capabilities, 64);
    const provider = preferred_provider == null ? null : safeId(preferred_provider, 'browser_brain_cognition_provider_invalid', { lower: true, max: 64 });
    const target = target_tab_id == null ? null : tabId(target_tab_id);
    if (target_tab_id != null && !target) throw new Error('browser_brain_cognition_route_tab_invalid');
    const max = boundedInt(limit, 16, 1, 64);
    const eligible = [...this.#agents.values()].filter((row) =>
      row.status === 'READY'
      && required.every((capability) => row.capabilities.includes(capability))
      && (target == null || row.targetTabId == null || row.targetTabId === target)
    );
    eligible.sort((a, b) => {
      const ap = provider != null && a.provider === provider ? 0 : 1;
      const bp = provider != null && b.provider === provider ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const at = target != null && a.targetTabId === target ? 0 : 1;
      const bt = target != null && b.targetTabId === target ? 0 : 1;
      if (at !== bt) return at - bt;
      return a.agentId.localeCompare(b.agentId);
    });
    return Object.freeze({
      schema: 'metaengine.browser-brain.agent-route.v1',
      candidates: Object.freeze(eligible.slice(0, max).map(publicAgent)),
      required_capabilities: required,
      preferred_provider: provider,
      target_tab_id: target,
      selection_is_advisory: true,
      assignment_created: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      actuation_eligible: false,
      authority_effect: false,
    });
  }

  recordEvidence({ evidence_id, kind, content_digest, tainted = true, refs = [] } = {}) {
    const evidenceId = safeId(evidence_id, 'browser_brain_cognition_evidence_invalid', { lower: true, max: 128 });
    if (this.#evidence.has(evidenceId)) throw new Error('browser_brain_cognition_evidence_exists');
    const normalizedKind = action(kind);
    const digest = String(content_digest || '').trim().toLowerCase();
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('browser_brain_cognition_evidence_digest_invalid');
    if (typeof tainted !== 'boolean') throw new Error('browser_brain_cognition_evidence_taint_invalid');
    const normalizedRefs = uniqueStrings(refs, 32);
    for (const ref of normalizedRefs) if (!this.#evidence.has(ref)) throw new Error('browser_brain_cognition_evidence_ref_unknown');
    const row = Object.freeze({
      evidence_id: evidenceId,
      kind: normalizedKind,
      content_digest: digest,
      tainted,
      refs: normalizedRefs,
      recorded_at: new Date(this.#now()).toISOString(),
      body_stored: false,
      data_granted_authority: false,
      actuation_eligible: false,
      authority_effect: false,
    });
    this.#evidence.set(evidenceId, row);
    this.#evidenceOrder.push(evidenceId);
    while (this.#evidenceOrder.length > this.#maxEvidence) {
      const victim = this.#evidenceOrder.shift();
      if (victim != null) this.#evidence.delete(victim);
      this.#evidenceEvictions += 1;
    }
    return row;
  }

  facts(tab_id) {
    const id = tabId(tab_id);
    if (!id) return Object.freeze([]);
    return Object.freeze((this.#cellFacts.get(id) || []).map((row) => ({ ...row })));
  }

  snapshot() {
    const streamClock = this.#streamClock.snapshot();
    return Object.freeze({
      schema: BROWSER_BRAIN_COGNITION_FABRIC_SCHEMA,
      edge_count: this.#edgeCount,
      semantic_edge_count: this.#semanticEdgeCount,
      causal_epoch: streamClock.epoch,
      causal_clock: streamClock,
      last_clock_results: Object.freeze(this.#lastClockResults.map((row) => ({ ...row }))),
      clock_gap_count: this.#clockGaps,
      clock_regression_count: this.#clockRegressions,
      cell_fact_count: [...this.#cellFacts.values()].reduce((sum, rows) => sum + rows.length, 0),
      cell_count: this.#cellFacts.size,
      max_cells: this.#maxCells,
      facts_per_cell: this.#factsPerCell,
      advisory_plan_count: this.#plans.size,
      max_advisory_plans: this.#maxPlans,
      advisory_plan_max_age_ms: this.#planMaxAgeMs,
      advisory_plan_hits: this.#planHits,
      advisory_plan_misses: this.#planMisses,
      advisory_plan_invalidations: this.#planInvalidations,
      agent_count: this.#agents.size,
      max_agents: this.#maxAgents,
      agent_updates: this.#agentUpdates,
      evidence_count: this.#evidence.size,
      max_evidence: this.#maxEvidence,
      evidence_evictions: this.#evidenceEvictions,
      bounded_memory: true,
      raw_dom_stored: false,
      raw_network_stored: false,
      page_text_stored: false,
      input_values_stored: false,
      execution_payload_stored: false,
      page_model_data_grants_authority: false,
      advisory_routes_only: true,
      semantic_cache_requires_generation_match: true,
      semantic_cache_requires_fresh_revalidation: true,
      dedicated_timer: false,
      hidden_queue: false,
      second_scheduler: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      automatic_effect_retry_allowed: false,
      actuation_eligible: false,
      authority_effect: false,
    });
  }
}
