import { BrowserBrainRealtimeObservationBridge } from './browser-brain-realtime-observation-bridge.mjs';
import { BrowserBrainAdaptiveFanoutRuntime } from './browser-brain-adaptive-fanout-runtime.mjs';
import { BrowserBrainRealtimePressureBridge } from './browser-brain-realtime-pressure-bridge.mjs';
import { BrowserControlPressureGovernor } from './browser-control-pressure-governor.mjs';
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

function validProcessSnapshot(snapshot) {
  return snapshot?.schema === 'metaengine.browser.realtime-process-plane.v1';
}

function coverage(snapshot = {}) {
  const webContents = Array.isArray(snapshot.web_contents) ? snapshot.web_contents : [];
  const live = webContents.filter((row) => row && row.destroyed !== true);
  const exact = live.filter((row) => String(row?.tab_id || '').startsWith('tab_'));
  return Object.freeze({
    process_count: Array.isArray(snapshot.processes) ? snapshot.processes.length : 0,
    web_contents_count: webContents.length,
    live_web_contents_count: live.length,
    exact_tab_bound_web_contents_count: exact.length,
    unbound_live_web_contents_count: Math.max(0, live.length - exact.length),
    process_source: 'ELECTRON_APP_METRICS',
    web_contents_source: 'ELECTRON_GET_ALL_WEBCONTENTS',
    lifecycle_event_driven: snapshot.event_driven_lifecycle === true,
    resource_sampling_is_authority: false,
    authority_effect: false,
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
 * The caller owns the existing process/semantic event source and the existing
 * command scheduler. This class only connects those proven surfaces:
 *   realtime process/semantic edge -> exact binding + bounded memory
 *   resource/lifecycle edge         -> adaptive pressure state
 *   pressure state                  -> numeric admission register consumed by the
 *                                      ONE existing command-lane scheduler
 *   already leased mutation batch   -> independent BrowserCell fan-out, but only
 *                                      when an explicit test/runtime adapter is bound
 *
 * It intentionally owns no timer, DB lease, hidden queue, retry loop, or
 * physical Browser implementation. Observation runs on every edge. Pressure is
 * deliberately not recomputed for each semantic/CDP burst because those events do
 * not change the resource/liveness sample; this keeps the hottest cognition path
 * allocation-light while crash/unresponsive/process changes remain immediate.
 */
export class BrowserBrainContinuousCoordinator {
  #observation;
  #adaptive;
  #pressure;
  #lastProcessSnapshot = null;
  #lastCoverage = coverage();
  #lastPressureResult = null;
  #lastAppliedCommandBudget = null;
  #edgeCount = 0;
  #pressureEvaluationCount = 0;
  #pressureReuseCount = 0;
  #commandBudgetApplyCount = 0;
  #reconcileCount = 0;
  #lastEvent = null;

  constructor({
    scheduler = null,
    executeRuntimeFenced = null,
    observationBridge = null,
    adaptiveRuntime = null,
    pressureBridge = null,
    pressureGovernor = null,
    getExtraPressureSample = null,
    clock = () => Date.now(),
    hardBatchLimit = 128,
  } = {}) {
    this.#observation = observationBridge || new BrowserBrainRealtimeObservationBridge();
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

  reconcile(processSnapshot, { tabs = [], cell_by_tab = null } = {}) {
    if (!validProcessSnapshot(processSnapshot)) {
      throw new Error('browser_brain_continuous_process_snapshot_invalid');
    }
    this.#lastProcessSnapshot = processSnapshot;
    this.#lastCoverage = coverage(processSnapshot);
    this.#observation.reconcile(processSnapshot, { tabs, cell_by_tab });
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
    this.#lastProcessSnapshot = snapshot;
    // The hottest semantic/CDP path normally omits process_snapshot and therefore
    // reuses the exact process-plane snapshot already covered by reconcile() or a
    // prior edge. Do not rescan every web_contents row for coverage in that proven
    // reuse case. A caller-supplied snapshot is always treated as fresh and is
    // rescanned before the edge result is published.
    if (hasFreshProcessSnapshot) this.#lastCoverage = coverage(snapshot);
    const observed = this.#observation.observe(event, {
      process_snapshot: snapshot,
      tabs,
      cell_by_tab,
    });
    const type = String(event?.type || 'UNKNOWN').toUpperCase();
    const pressureEvaluated = this.#lastPressureResult == null || PRESSURE_RELEVANT_EVENTS.has(type);
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
      observation: observed,
      pressure,
      pressure_evaluated: pressureEvaluated,
      command_lane_pressure_budget: this.#lastAppliedCommandBudget,
      coverage: this.#lastCoverage,
      mutation_runtime_bound: this.#adaptive != null,
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

  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_CONTINUOUS_COORDINATOR_SCHEMA,
      edge_count: this.#edgeCount,
      reconcile_count: this.#reconcileCount,
      pressure_evaluation_count: this.#pressureEvaluationCount,
      pressure_reuse_count: this.#pressureReuseCount,
      command_budget_apply_count: this.#commandBudgetApplyCount,
      semantic_edges_reuse_pressure: true,
      last_event: this.#lastEvent,
      coverage: this.#lastCoverage,
      observation: this.#observation.snapshot(),
      adaptive_fanout: this.#adaptive?.snapshot?.() || unboundAdaptiveSnapshot(),
      pressure: this.#pressure.snapshot(),
      pressure_budget: this.pressureBudget(),
      command_lane_pressure_budget: this.#lastAppliedCommandBudget,
      command_lane_pressure_register_bound: this.#lastAppliedCommandBudget != null,
      hot_path: 'REALTIME_EDGE_TO_MEMORY_AND_PRESSURE_TO_EXISTING_COMMAND_LANES',
      mutation_path: this.#adaptive
        ? 'DB_LEASED_BATCH_TO_RUNTIME_FENCED_INDEPENDENT_BROWSER_CELLS'
        : 'EXISTING_NATIVE_SUPERVISOR_COMMAND_LANES_ONLY',
      mutation_runtime_bound: this.#adaptive != null,
      exact_tab_binding_required_for_mutation: true,
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
