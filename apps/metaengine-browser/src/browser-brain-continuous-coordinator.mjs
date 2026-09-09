import { BrowserBrainRealtimeObservationBridge } from './browser-brain-realtime-observation-bridge.mjs';
import { BrowserBrainAdaptiveFanoutRuntime } from './browser-brain-adaptive-fanout-runtime.mjs';
import { BrowserBrainRealtimePressureBridge } from './browser-brain-realtime-pressure-bridge.mjs';
import { BrowserControlPressureGovernor } from './browser-control-pressure-governor.mjs';
import { BrowserBrainCognitionFabric } from './browser-brain-cognition-fabric.mjs';
import { BrowserBrainCollaborationRuntimeV2 } from './browser-brain-collaboration-runtime-v2.mjs';
import { applyNativeSupervisorCommandPressureBudget } from './native-supervisor-command-lanes.mjs';

export const BROWSER_BRAIN_CONTINUOUS_COORDINATOR_SCHEMA = 'metaengine.browser-brain.continuous-coordinator.v1';

const PRESSURE_RELEVANT_EVENTS = new Set([
  'METRICS_SAMPLE',
  'PROCESS_CENSUS_REFRESHED',
  'WEB_CONTENTS_CREATED',
  'WEB_CONTENTS_DESTROYED',
  'WEB_CONTENTS_UNRESPONSIVE',
  'WEB_CONTENTS_RESPONSIVE',
  'RENDER_PROCESS_GONE',
  'CHILD_PROCESS_GONE',
]);
const COVERAGE_RELEVANT_EVENTS = PRESSURE_RELEVANT_EVENTS;
const CANONICAL_RESYNC_EVENTS = new Set(['METRICS_SAMPLE', 'PROCESS_CENSUS_REFRESHED']);

function validProcessSnapshot(snapshot) {
  return snapshot?.schema === 'metaengine.browser.realtime-process-plane.v1';
}

function coverage(snapshot = {}) {
  const webContents = Array.isArray(snapshot.web_contents) ? snapshot.web_contents : [];
  let liveWebContentsCount = 0;
  let exactTabBoundWebContentsCount = 0;
  for (const row of webContents) {
    if (!row || row.destroyed === true) continue;
    liveWebContentsCount += 1;
    if (String(row.tab_id || '').startsWith('tab_')) exactTabBoundWebContentsCount += 1;
  }
  return Object.freeze({
    process_count: Array.isArray(snapshot.processes) ? snapshot.processes.length : 0,
    web_contents_count: webContents.length,
    live_web_contents_count: liveWebContentsCount,
    exact_tab_bound_web_contents_count: exactTabBoundWebContentsCount,
    unbound_live_web_contents_count: Math.max(0, liveWebContentsCount - exactTabBoundWebContentsCount),
    process_source: 'ELECTRON_APP_METRICS',
    web_contents_source: 'ELECTRON_GET_ALL_WEBCONTENTS',
    lifecycle_event_driven: snapshot.event_driven_lifecycle === true,
    resource_sampling_is_authority: false,
    authority_effect: false,
  });
}

function producerSequences(snapshot = {}) {
  const process = Number(snapshot?.sequence);
  const semantic = Number(snapshot?.semantic_plane?.sequence);
  return Object.freeze({
    process_sequence: Number.isSafeInteger(process) && process >= 0 ? process : null,
    semantic_sequence: Number.isSafeInteger(semantic) && semantic >= 0 ? semantic : null,
  });
}

function unboundAdaptiveSnapshot() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.adaptive-fanout-unbound.v1',
    bound: false,
    reason: 'EXISTING_CORE_SCHEDULER_USED_VIA_PRESSURE_REGISTER',
    second_scheduler_created: false,
    hidden_queue: false,
    command_leasing: false,
    execution_authority: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  });
}

function pressureBudgetProjection(result) {
  const budget = result?.budget;
  if (!budget || typeof budget !== 'object') return null;
  const read = Number(budget.read_concurrency);
  const mutation = Number(budget.mutation_concurrency);
  if (!Number.isSafeInteger(read) || read < 1 || !Number.isSafeInteger(mutation) || mutation < 1) return null;
  return Object.freeze({
    pressure_band: String(budget.pressure_band || 'UNKNOWN').slice(0, 32),
    read_concurrency: read,
    mutation_concurrency: mutation,
    resource_sample_ms: Number.isSafeInteger(Number(budget.resource_sample_ms)) ? Number(budget.resource_sample_ms) : null,
    live_cells: Number.isSafeInteger(Number(budget.live_cells)) ? Number(budget.live_cells) : null,
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
}

function sameCommandBudget(a, b) {
  return Boolean(a && b
    && a.pressure_band === b.pressure_band
    && a.read_concurrency === b.read_concurrency
    && a.mutation_concurrency === b.mutation_concurrency
    && a.live_cells === b.live_cells);
}

/**
 * Zero-scheduler composition layer for the always-on Browser Brain.
 *
 * Observation, cognition and collaboration are advisory. This coordinator owns no
 * DB lease, hidden queue, effect retry loop or second scheduler. Collaboration
 * records let agents keep useful work moving continuously without a user-prompt
 * boundary, while all physical effects remain fenced by the existing authority
 * path outside this information plane.
 */
export class BrowserBrainContinuousCoordinator {
  #observation;
  #adaptive;
  #pressure;
  #cognition;
  #collaboration;
  #lastProcessSnapshot = null;
  #lastCoverage = coverage();
  #lastPressureResult = null;
  #lastAppliedCommandBudget = null;
  #lastCognitionResult = null;
  #edgeCount = 0;
  #pressureEvaluationCount = 0;
  #pressureReuseCount = 0;
  #coverageEvaluationCount = 0;
  #coverageReuseCount = 0;
  #commandBudgetApplyCount = 0;
  #reconcileCount = 0;
  #cognitionResyncCount = 0;
  #lastEvent = null;

  constructor({
    scheduler = null,
    executeRuntimeFenced = null,
    observationBridge = null,
    adaptiveRuntime = null,
    pressureBridge = null,
    pressureGovernor = null,
    cognitionFabric = null,
    collaborationFabric = null,
    collaborationLoadState = null,
    collaborationSaveState = null,
    collaborationCheckpoint = null,
    getExtraPressureSample = null,
    clock = () => Date.now(),
    hardBatchLimit = 128,
  } = {}) {
    this.#observation = observationBridge || new BrowserBrainRealtimeObservationBridge();
    this.#cognition = cognitionFabric || new BrowserBrainCognitionFabric({ clock });
    this.#collaboration = collaborationFabric || new BrowserBrainCollaborationRuntimeV2({
      clock,
      loadState: collaborationLoadState,
      saveState: collaborationSaveState,
    });
    if (collaborationCheckpoint != null && typeof this.#collaboration.restore === 'function') {
      this.#collaboration.restore(collaborationCheckpoint);
    }
    const canBindAdaptive = adaptiveRuntime != null
      || (scheduler != null && typeof executeRuntimeFenced === 'function');
    this.#adaptive = adaptiveRuntime || (canBindAdaptive
      ? new BrowserBrainAdaptiveFanoutRuntime({
          scheduler,
          executeRuntimeFenced,
          ...(pressureGovernor ? { governor: pressureGovernor } : {}),
          hardBatchLimit,
        })
      : null);

    const governor = pressureGovernor || new BrowserControlPressureGovernor();
    const pressureTarget = this.#adaptive || Object.freeze({
      observePressure: (sample) => governor.observe(sample),
    });
    this.#pressure = pressureBridge || new BrowserBrainRealtimePressureBridge({
      adaptiveRuntime: pressureTarget,
      getExtraSample: getExtraPressureSample,
      clock,
    });
    if (typeof this.#observation.observe !== 'function' || typeof this.#observation.reconcile !== 'function') {
      throw new Error('browser_brain_continuous_observation_invalid');
    }
    if (this.#adaptive != null && typeof this.#adaptive.dispatchMutations !== 'function') {
      throw new Error('browser_brain_continuous_adaptive_runtime_invalid');
    }
    if (typeof this.#pressure.observe !== 'function') {
      throw new Error('browser_brain_continuous_pressure_bridge_invalid');
    }
    if (
      typeof this.#cognition.observeEdge !== 'function'
      || typeof this.#cognition.reconcileProducerSequences !== 'function'
      || typeof this.#cognition.snapshot !== 'function'
    ) {
      throw new Error('browser_brain_continuous_cognition_fabric_invalid');
    }
    if (
      typeof this.#collaboration.recordTask !== 'function'
      || typeof this.#collaboration.decideAutonomousContinuation !== 'function'
      || typeof this.#collaboration.snapshot !== 'function'
    ) {
      throw new Error('browser_brain_continuous_collaboration_fabric_invalid');
    }
  }

  async initCollaboration() {
    return typeof this.#collaboration.init === 'function' ? this.#collaboration.init() : this.#collaboration.snapshot();
  }

  #evaluatePressure(processSnapshot) {
    this.#lastPressureResult = this.#pressure.observe(processSnapshot);
    this.#pressureEvaluationCount += 1;
    const budget = pressureBudgetProjection(this.#lastPressureResult);
    if (budget && !sameCommandBudget(this.#lastAppliedCommandBudget, budget)) {
      this.#lastAppliedCommandBudget = applyNativeSupervisorCommandPressureBudget(budget);
      this.#commandBudgetApplyCount += 1;
    }
    return this.#lastPressureResult;
  }

  #evaluateCoverage(processSnapshot) {
    this.#lastCoverage = coverage(processSnapshot);
    this.#coverageEvaluationCount += 1;
    return this.#lastCoverage;
  }

  #resyncCognition(processSnapshot) {
    const result = this.#cognition.reconcileProducerSequences(producerSequences(processSnapshot));
    if (result.length > 0) this.#cognitionResyncCount += 1;
    return result;
  }

  reconcile(processSnapshot, { tabs = [], cell_by_tab = null } = {}) {
    if (!validProcessSnapshot(processSnapshot)) {
      throw new Error('browser_brain_continuous_process_snapshot_invalid');
    }
    this.#lastProcessSnapshot = processSnapshot;
    this.#evaluateCoverage(processSnapshot);
    this.#observation.reconcile(processSnapshot, { tabs, cell_by_tab });
    this.#resyncCognition(processSnapshot);
    this.#evaluatePressure(processSnapshot);
    this.#reconcileCount += 1;
    return this.snapshot();
  }

  observeEdge(event = {}, { process_snapshot = null, tabs = [], cell_by_tab = null } = {}) {
    const hasFreshProcessSnapshot = process_snapshot != null;
    const snapshot = process_snapshot || this.#lastProcessSnapshot;
    if (!validProcessSnapshot(snapshot)) {
      throw new Error('browser_brain_continuous_process_snapshot_required');
    }
    const type = String(event?.type || 'UNKNOWN').toUpperCase();
    const hadProcessSnapshot = this.#lastProcessSnapshot != null;
    this.#lastProcessSnapshot = snapshot;
    const coverageEvaluated = !hadProcessSnapshot
      || hasFreshProcessSnapshot
      || COVERAGE_RELEVANT_EVENTS.has(type);
    if (coverageEvaluated) this.#evaluateCoverage(snapshot);
    else this.#coverageReuseCount += 1;
    this.#lastCognitionResult = this.#cognition.observeEdge(event);
    const observed = this.#observation.observe(event, {
      process_snapshot: snapshot,
      tabs,
      cell_by_tab,
    });
    if (this.#lastCognitionResult?.resync_required === true && CANONICAL_RESYNC_EVENTS.has(type)) {
      this.#resyncCognition(snapshot);
      this.#lastCognitionResult = Object.freeze({
        ...this.#lastCognitionResult,
        canonical_resync_applied: true,
        authority_effect: false,
      });
    }
    const pressureEvaluated = this.#lastPressureResult == null
      || hasFreshProcessSnapshot
      || PRESSURE_RELEVANT_EVENTS.has(type);
    const pressure = pressureEvaluated
      ? this.#evaluatePressure(snapshot)
      : this.#lastPressureResult;
    if (!pressureEvaluated) this.#pressureReuseCount += 1;
    this.#edgeCount += 1;
    this.#lastEvent = Object.freeze({
      seq: Number.isSafeInteger(Number(event?.seq)) ? Number(event.seq) : null,
      type: type.slice(0, 96),
      tab_id: event?.tab_id ? String(event.tab_id).slice(0, 96) : null,
      observed_at: event?.observed_at ? String(event.observed_at).slice(0, 64) : null,
      authority_effect: false,
    });
    return Object.freeze({
      schema: 'metaengine.browser-brain.continuous-edge-result.v1',
      cognition: this.#lastCognitionResult,
      observation: observed,
      pressure,
      pressure_evaluated: pressureEvaluated,
      coverage_evaluated: coverageEvaluated,
      command_lane_pressure_budget: this.#lastAppliedCommandBudget,
      coverage: this.#lastCoverage,
      mutation_runtime_bound: this.#adaptive != null,
      continuous_autonomous_work: true,
      external_confirmation_gate: false,
      scheduler_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  pressureBudget() {
    return pressureBudgetProjection(this.#lastPressureResult);
  }

  dispatchMutations(commands, options = {}) {
    if (!this.#adaptive) throw new Error('browser_brain_continuous_mutation_runtime_unbound');
    return this.#adaptive.dispatchMutations(commands, options);
  }

  context(tabId) {
    return this.#observation.context(tabId);
  }

  binding(tabId, options = {}) {
    return this.#observation.binding(tabId, options);
  }

  bindingsForProcess(processKey) {
    return this.#observation.bindingsForProcess(processKey);
  }

  checkpoint() {
    return this.#observation.checkpoint();
  }

  rememberAdvisoryPlan(plan) {
    return this.#cognition.rememberPlan(plan);
  }

  resolveAdvisoryPlan(query) {
    return this.#cognition.resolvePlan(query);
  }

  observeAgent(agent) {
    const observed = this.#cognition.observeAgent(agent);
    if (typeof this.#collaboration.observeRoutingAgent === 'function') {
      this.#collaboration.observeRoutingAgent({ ...agent, generation: agent?.generation ?? 1 });
    }
    return observed;
  }

  routeAgents(query) {
    return this.#cognition.routeAgents(query);
  }

  routeAgentsV2(query) {
    return typeof this.#collaboration.routeAgentsV2 === 'function'
      ? this.#collaboration.routeAgentsV2(query)
      : this.#cognition.routeAgents(query);
  }

  recordEvidence(evidence) {
    return this.#cognition.recordEvidence(evidence);
  }

  cognitionSnapshot() {
    return this.#cognition.snapshot();
  }

  recordCollaborationTask(task) {
    return this.#collaboration.recordTask(task);
  }

  advanceCollaborationTask(progress) {
    return this.#collaboration.advanceTask(progress);
  }

  recordAgentMessage(message) {
    return this.#collaboration.recordMessage(message);
  }

  recordCollaborationArtifact(artifact) {
    return this.#collaboration.recordArtifact(artifact);
  }

  claimCollaborationWork(claim) {
    return this.#collaboration.claimWork(claim);
  }

  releaseCollaborationClaim(claimId, reason) {
    return this.#collaboration.releaseClaim(claimId, reason);
  }

  recordHandoffCapsule(handoff) {
    return this.#collaboration.recordHandoff(handoff);
  }

  collaborationTaskLedger(contextId) {
    return this.#collaboration.taskLedger(contextId);
  }

  collaborationProgressLedger(contextId) {
    return this.#collaboration.progressLedger(contextId);
  }

  autonomousContinuation(query) {
    return this.#collaboration.decideAutonomousContinuation(query);
  }

  collaborationCheckpoint() {
    return typeof this.#collaboration.checkpoint === 'function' ? this.#collaboration.checkpoint() : null;
  }

  restoreCollaborationCheckpoint(checkpoint) {
    if (typeof this.#collaboration.restore !== 'function') throw new Error('browser_brain_collaboration_restore_unavailable');
    return this.#collaboration.restore(checkpoint);
  }

  flushCollaborationPersistence() {
    return typeof this.#collaboration.flush === 'function'
      ? this.#collaboration.flush()
      : Promise.resolve(Object.freeze({ ok: true, authority_effect: false }));
  }

  retrieveCollaborationMemory(query) {
    if (typeof this.#collaboration.retrieveMemory !== 'function') throw new Error('browser_brain_collaboration_memory_unavailable');
    return this.#collaboration.retrieveMemory(query);
  }

  collaborationSemanticFacts() {
    return typeof this.#collaboration.semanticFacts === 'function' ? this.#collaboration.semanticFacts() : Object.freeze([]);
  }

  collaborationPlaybooks() {
    return typeof this.#collaboration.playbooks === 'function' ? this.#collaboration.playbooks() : Object.freeze([]);
  }

  planCollaborationFanout(query) {
    if (typeof this.#collaboration.planFanout !== 'function') throw new Error('browser_brain_collaboration_fanout_unavailable');
    return this.#collaboration.planFanout(query);
  }

  a2aTask(input) {
    if (typeof this.#collaboration.a2aTask !== 'function') throw new Error('browser_brain_a2a_adapter_unavailable');
    return this.#collaboration.a2aTask(input);
  }

  a2aIngressMessage(message, options) {
    if (typeof this.#collaboration.a2aIngressMessage !== 'function') throw new Error('browser_brain_a2a_adapter_unavailable');
    return this.#collaboration.a2aIngressMessage(message, options);
  }

  a2aIngressTask(task) {
    if (typeof this.#collaboration.a2aIngressTask !== 'function') throw new Error('browser_brain_a2a_adapter_unavailable');
    return this.#collaboration.a2aIngressTask(task);
  }

  collaborationSnapshot() {
    return this.#collaboration.snapshot();
  }

  snapshot() {
    const collaboration = this.#collaboration.snapshot();
    return Object.freeze({
      schema: BROWSER_BRAIN_CONTINUOUS_COORDINATOR_SCHEMA,
      edge_count: this.#edgeCount,
      reconcile_count: this.#reconcileCount,
      pressure_evaluation_count: this.#pressureEvaluationCount,
      pressure_reuse_count: this.#pressureReuseCount,
      coverage_evaluation_count: this.#coverageEvaluationCount,
      coverage_reuse_count: this.#coverageReuseCount,
      command_budget_apply_count: this.#commandBudgetApplyCount,
      cognition_resync_count: this.#cognitionResyncCount,
      semantic_edges_reuse_pressure: true,
      semantic_edges_reuse_coverage: true,
      last_event: this.#lastEvent,
      coverage: this.#lastCoverage,
      cognition_fabric: this.#cognition.snapshot(),
      collaboration_fabric: collaboration,
      observation: this.#observation.snapshot(),
      adaptive_fanout: this.#adaptive?.snapshot?.() || unboundAdaptiveSnapshot(),
      pressure: this.#pressure.snapshot(),
      pressure_budget: this.pressureBudget(),
      command_lane_pressure_budget: this.#lastAppliedCommandBudget,
      command_lane_pressure_register_bound: this.#lastAppliedCommandBudget != null,
      hot_path: 'REALTIME_EDGE_TO_CAUSAL_COGNITION_MEMORY_AND_PRESSURE_TO_EXISTING_COMMAND_LANES',
      mutation_path: this.#adaptive
        ? 'DB_LEASED_BATCH_TO_RUNTIME_FENCED_INDEPENDENT_BROWSER_CELLS'
        : 'EXISTING_NATIVE_SUPERVISOR_COMMAND_LANES_ONLY',
      cognition_path: 'REAL_PRODUCER_SEQUENCE_TO_BOUNDED_ADVISORY_FABRIC',
      collaboration_path: 'TYPED_CAUSAL_MESSAGES_TO_DURABLE_EPISODIC_MEMORY_ROUTING_REPLAN_AND_AUTONOMOUS_CONTINUATION',
      mutation_runtime_bound: this.#adaptive != null,
      exact_tab_binding_required_for_mutation: true,
      semantic_plan_revalidation_required: true,
      page_model_data_grants_authority: false,
      continuous_autonomous_work: collaboration.continuous_autonomous_work === true,
      durable_collaboration_memory: collaboration.journal?.hash_verified_checkpoint === true,
      episodic_collaboration_memory: collaboration.episodic_memory?.immutable_provenance === true,
      routing_v2: collaboration.routing_v2_enabled === true,
      adaptive_sparse_fanout: collaboration.adaptive_sparse_fanout === true,
      a2a_boundary_only: collaboration.a2a_boundary_only === true,
      external_confirmation_gate: false,
      external_prompt_required_for_continuation: false,
      idle_wait_allowed: false,
      work_cycle_limit: null,
      full_electron_process_visibility: true,
      os_global_process_visibility: false,
      bounded_memory: true,
      dedicated_timer: false,
      second_scheduler: false,
      hidden_queue: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}