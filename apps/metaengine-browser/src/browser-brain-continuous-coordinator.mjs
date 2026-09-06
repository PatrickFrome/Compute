import { BrowserBrainRealtimeObservationBridge } from './browser-brain-realtime-observation-bridge.mjs';
import { BrowserBrainAdaptiveFanoutRuntime } from './browser-brain-adaptive-fanout-runtime.mjs';
import { BrowserBrainRealtimePressureBridge } from './browser-brain-realtime-pressure-bridge.mjs';

export const BROWSER_BRAIN_CONTINUOUS_COORDINATOR_SCHEMA = 'metaengine.browser-brain.continuous-coordinator.v1';

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

/**
 * Zero-scheduler composition layer for the always-on Browser Brain.
 *
 * The caller owns the existing process/semantic event source and the existing
 * command scheduler. This class only connects those proven surfaces:
 *   realtime process/semantic edge -> exact binding + bounded memory
 *   same process snapshot            -> adaptive pressure budget
 *   already leased mutation batch    -> independent BrowserCell fan-out
 *
 * It intentionally owns no timer, DB lease, hidden queue, retry loop, or
 * physical Browser implementation.
 */
export class BrowserBrainContinuousCoordinator {
  #observation;
  #adaptive;
  #pressure;
  #lastProcessSnapshot = null;
  #lastCoverage = coverage();
  #edgeCount = 0;
  #reconcileCount = 0;
  #lastEvent = null;

  constructor({
    scheduler,
    executeRuntimeFenced,
    observationBridge = null,
    adaptiveRuntime = null,
    pressureBridge = null,
    pressureGovernor = undefined,
    getExtraPressureSample = null,
    clock = () => Date.now(),
    hardBatchLimit = 128,
  } = {}) {
    this.#observation = observationBridge || new BrowserBrainRealtimeObservationBridge();
    this.#adaptive = adaptiveRuntime || new BrowserBrainAdaptiveFanoutRuntime({
      scheduler,
      executeRuntimeFenced,
      ...(pressureGovernor ? { governor: pressureGovernor } : {}),
      hardBatchLimit,
    });
    this.#pressure = pressureBridge || new BrowserBrainRealtimePressureBridge({
      adaptiveRuntime: this.#adaptive,
      getExtraSample: getExtraPressureSample,
      clock,
    });
    if (typeof this.#observation.observe !== 'function' || typeof this.#observation.reconcile !== 'function') {
      throw new Error('browser_brain_continuous_observation_invalid');
    }
    if (typeof this.#adaptive.dispatchMutations !== 'function') {
      throw new Error('browser_brain_continuous_adaptive_runtime_invalid');
    }
    if (typeof this.#pressure.observe !== 'function') {
      throw new Error('browser_brain_continuous_pressure_bridge_invalid');
    }
  }

  reconcile(processSnapshot, { tabs = [], cell_by_tab = null } = {}) {
    if (!validProcessSnapshot(processSnapshot)) {
      throw new Error('browser_brain_continuous_process_snapshot_invalid');
    }
    this.#lastProcessSnapshot = processSnapshot;
    this.#lastCoverage = coverage(processSnapshot);
    this.#observation.reconcile(processSnapshot, { tabs, cell_by_tab });
    this.#pressure.observe(processSnapshot);
    this.#reconcileCount += 1;
    return this.snapshot();
  }

  observeEdge(event = {}, { process_snapshot = null, tabs = [], cell_by_tab = null } = {}) {
    const snapshot = process_snapshot || this.#lastProcessSnapshot;
    if (!validProcessSnapshot(snapshot)) {
      throw new Error('browser_brain_continuous_process_snapshot_required');
    }
    this.#lastProcessSnapshot = snapshot;
    this.#lastCoverage = coverage(snapshot);
    const observed = this.#observation.observe(event, {
      process_snapshot: snapshot,
      tabs,
      cell_by_tab,
    });
    const pressure = this.#pressure.observe(snapshot);
    this.#edgeCount += 1;
    this.#lastEvent = Object.freeze({
      seq: Number.isSafeInteger(Number(event?.seq)) ? Number(event.seq) : null,
      type: String(event?.type || 'UNKNOWN').slice(0, 96),
      tab_id: event?.tab_id ? String(event.tab_id).slice(0, 96) : null,
      observed_at: event?.observed_at ? String(event.observed_at).slice(0, 64) : null,
      authority_effect: false,
    });
    return Object.freeze({
      schema: 'metaengine.browser-brain.continuous-edge-result.v1',
      observation: observed,
      pressure,
      coverage: this.#lastCoverage,
      scheduler_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  dispatchMutations(commands, options = {}) {
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
      last_event: this.#lastEvent,
      coverage: this.#lastCoverage,
      observation: this.#observation.snapshot(),
      adaptive_fanout: this.#adaptive.snapshot(),
      pressure: this.#pressure.snapshot(),
      hot_path: 'REALTIME_EDGE_TO_MEMORY_PRESSURE_TO_EXISTING_SCHEDULER',
      mutation_path: 'DB_LEASED_BATCH_TO_RUNTIME_FENCED_INDEPENDENT_BROWSER_CELLS',
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
