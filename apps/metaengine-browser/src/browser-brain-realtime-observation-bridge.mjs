import { BrowserRuntimeBindingIndex } from './browser-runtime-binding-index.mjs';
import { BrowserBrainWorkingMemory } from './browser-brain-working-memory.mjs';

export const BROWSER_BRAIN_REALTIME_OBSERVATION_BRIDGE_SCHEMA = 'metaengine.browser.brain-realtime-observation-bridge.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const CENSUS_EVENT_TYPES = new Set(['METRICS_SAMPLE', 'PROCESS_CENSUS_REFRESHED']);

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sequence(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function tabId(value) {
  const normalized = String(value || '').toLowerCase();
  return TAB_ID_RE.test(normalized) ? normalized : null;
}

export class BrowserBrainRealtimeObservationBridge {
  #bindings;
  #memory;
  #eventCount = 0;
  #censusReconciliations = 0;
  #incrementalBindingUpdates = 0;
  #lifecycleInvalidations = 0;
  #lastEventSequence = 0;

  constructor({ bindingIndex = null, workingMemory = null } = {}) {
    this.#bindings = bindingIndex || new BrowserRuntimeBindingIndex();
    this.#memory = workingMemory || new BrowserBrainWorkingMemory();
    if (typeof this.#bindings.reconcile !== 'function' || typeof this.#bindings.applyLifecycleEvent !== 'function') {
      throw new Error('browser_brain_realtime_bridge_binding_index_invalid');
    }
    if (typeof this.#memory.ingestEvent !== 'function' || typeof this.#memory.reconcileBindings !== 'function') {
      throw new Error('browser_brain_realtime_bridge_working_memory_invalid');
    }
  }

  reconcile(processSnapshot, { tabs = [], cell_by_tab = null } = {}) {
    if (!processSnapshot || typeof processSnapshot !== 'object') {
      throw new Error('browser_brain_realtime_bridge_process_snapshot_required');
    }
    const bindingSnapshot = this.#bindings.reconcile({
      tabs,
      process_snapshot: processSnapshot,
      cell_by_tab,
    });
    this.#memory.reconcileBindings(bindingSnapshot);
    this.#censusReconciliations += 1;
    return this.snapshot();
  }

  #updateSemanticBinding(event) {
    const id = tabId(event?.tab_id);
    if (!id) return null;
    const current = this.#bindings.resolveTab(id);
    if (!current) return null;
    const semanticSequence = sequence(event?.semantic_sequence);
    const next = this.#bindings.bind({
      tab_id: current.tab_id,
      cell_id: current.cell_id,
      cell_generation: current.cell_generation,
      web_contents_id: current.web_contents_id,
      renderer_pid: current.renderer_pid,
      renderer_process_key: current.renderer_process_key,
      target_id: event?.target_id || current.target_id,
      document_generation: current.document_generation,
      semantic_revision: semanticSequence == null
        ? current.semantic_revision
        : Math.max(Number(current.semantic_revision || 0), semanticSequence),
      provider: current.provider,
      role: current.role,
      observed_at: event?.observed_at || null,
    });
    this.#memory.rememberBinding(next);
    this.#incrementalBindingUpdates += 1;
    return next;
  }

  observe(event = {}, { process_snapshot = null, tabs = [], cell_by_tab = null } = {}) {
    const type = String(event?.type || 'UNKNOWN').toUpperCase();
    const projected = this.#memory.ingestEvent(event);
    this.#eventCount += 1;
    const observedSequence = sequence(event?.sequence ?? event?.seq);
    if (observedSequence != null) this.#lastEventSequence = Math.max(this.#lastEventSequence, observedSequence);

    const invalidated = this.#bindings.applyLifecycleEvent(event);
    if (invalidated?.tab_id) {
      this.#memory.forgetBinding(invalidated.tab_id, type || 'LIFECYCLE_INVALIDATED');
      this.#lifecycleInvalidations += 1;
    }

    if (type === 'SEMANTIC_EVENT') this.#updateSemanticBinding(event);

    if (CENSUS_EVENT_TYPES.has(type) && process_snapshot) {
      this.reconcile(process_snapshot, { tabs, cell_by_tab });
    }

    return Object.freeze({
      schema: 'metaengine.browser.brain-realtime-observation-result.v1',
      event: projected,
      binding: tabId(event?.tab_id) ? this.#bindings.resolveTab(event.tab_id) : null,
      census_reconciled: CENSUS_EVENT_TYPES.has(type) && process_snapshot != null,
      execution_authority: false,
      command_leasing: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  context(tabIdRaw) {
    return this.#memory.context(tabIdRaw);
  }

  binding(tabIdRaw, options = {}) {
    return this.#bindings.resolveTab(tabIdRaw, options);
  }

  bindingsForProcess(processKey) {
    return this.#bindings.bindingsForProcess(processKey);
  }

  checkpoint() {
    return this.#memory.checkpoint();
  }

  snapshot() {
    const bindings = this.#bindings.snapshot();
    const memory = this.#memory.snapshot();
    return Object.freeze({
      schema: BROWSER_BRAIN_REALTIME_OBSERVATION_BRIDGE_SCHEMA,
      event_count: this.#eventCount,
      last_event_sequence: this.#lastEventSequence,
      census_reconciliations: this.#censusReconciliations,
      incremental_binding_updates: this.#incrementalBindingUpdates,
      lifecycle_invalidations: this.#lifecycleInvalidations,
      runtime_binding_index: bindings,
      working_memory: memory,
      event_path: 'EXISTING_REALTIME_PROCESS_AND_SEMANTIC_CALLBACKS',
      census_path: 'EXISTING_PROCESS_SAMPLE_ONLY',
      exact_tab_lookup_complexity: 'O(1)',
      process_lookup_complexity: 'O(1)_INDEX_PLUS_BOUND_CELL_SET',
      raw_dom_stored: false,
      raw_network_stored: false,
      page_text_stored: false,
      input_values_stored: false,
      command_payload_stored: false,
      poll_timer_required: false,
      second_scheduler: false,
      execution_authority: false,
      command_leasing: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
