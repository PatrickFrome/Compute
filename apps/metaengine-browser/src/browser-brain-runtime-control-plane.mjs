import { BrowserBrainWorkingMemory } from './browser-brain-working-memory.mjs';
import { BrowserControlPressureGovernor } from './browser-control-pressure-governor.mjs';
import { BrowserRuntimeBindingIndex } from './browser-runtime-binding-index.mjs';
import { nativeActionRequiresEffectBinding } from './native-effect-binding.mjs';

export const BROWSER_BRAIN_RUNTIME_CONTROL_PLANE_SCHEMA = 'metaengine.browser.brain-runtime-control-plane.v1';
export const BROWSER_RUNTIME_MUTATION_FENCE_SCHEMA = 'metaengine.browser.runtime-mutation-fence.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const FALLBACK_TARGET_RE = /^webcontents:[1-9][0-9]*$/i;
const LETHAL_RUNTIME_EVENTS = new Set(['WEB_CONTENTS_DESTROYED', 'RENDER_PROCESS_GONE']);

function text(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function exactTabId(value) {
  const tabId = String(value || '').toLowerCase();
  if (!TAB_ID_RE.test(tabId)) throw new Error('browser_runtime_fence_explicit_tab_required');
  return tabId;
}

function exactCommandId(value) {
  const commandId = String(value || '').toLowerCase();
  if (!UUID_RE.test(commandId)) throw new Error('browser_runtime_fence_command_id_invalid');
  return commandId;
}

function exactAction(command) {
  const action = String(command?.action || '').trim().toUpperCase();
  if (!nativeActionRequiresEffectBinding(action)) throw new Error('browser_runtime_fence_action_not_tab_effect');
  return action;
}

function liveWebContentsProjection(webContents) {
  if (!webContents || typeof webContents !== 'object') throw new Error('browser_runtime_fence_webcontents_unavailable');
  let destroyed = true;
  try { destroyed = webContents.isDestroyed?.() === true; } catch {}
  if (destroyed) throw new Error('browser_runtime_fence_webcontents_destroyed');

  const webContentsId = positiveInt(webContents.id);
  if (!webContentsId) throw new Error('browser_runtime_fence_webcontents_id_invalid');

  let rendererPid = null;
  try { rendererPid = positiveInt(webContents.getOSProcessId?.()); } catch {}
  if (!rendererPid) throw new Error('browser_runtime_fence_renderer_pid_unavailable');

  let targetId = null;
  try { targetId = text(webContents.getOrCreateDevToolsTargetId?.(), 192); } catch {}
  if (!targetId || FALLBACK_TARGET_RE.test(targetId)) throw new Error('browser_runtime_fence_exact_cdp_target_unavailable');

  return Object.freeze({ web_contents_id: webContentsId, renderer_pid: rendererPid, target_id: targetId });
}

function mutationFence(binding, command, observedAt) {
  return Object.freeze({
    schema: BROWSER_RUNTIME_MUTATION_FENCE_SCHEMA,
    command_id: exactCommandId(command?.command_id),
    action: exactAction(command),
    tab_id: exactTabId(command?.payload?.tab_id),
    cell_id: binding.cell_id || null,
    cell_generation: binding.cell_generation || null,
    binding_generation: binding.binding_generation,
    web_contents_id: binding.web_contents_id,
    renderer_pid: binding.renderer_pid,
    renderer_process_key: binding.renderer_process_key,
    target_id: binding.target_id,
    document_generation: binding.document_generation || 0,
    semantic_revision: binding.semantic_revision || 0,
    observed_at: observedAt,
    exact_cdp_target_required: true,
    process_identity: 'PID_PLUS_PROCESS_CREATION_TIME',
    stale_binding_execution_allowed: false,
    selected_tab_fallback_allowed: false,
    platform_fallback_allowed: false,
    page_content_exposed: false,
    command_payload_exposed: false,
    execution_authority: false,
    command_leasing: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export class BrowserBrainRuntimeControlPlane {
  #clock;
  #bindings;
  #memory;
  #pressure;
  #liveCells = 1;

  constructor({ clock = () => Date.now(), maxBindings = 128, maxCells = 128, maxEvents = 4096, pressureRecoverySamples = 3 } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_runtime_control_plane_clock_required');
    this.#clock = clock;
    this.#bindings = new BrowserRuntimeBindingIndex({ clock, maxBindings });
    this.#memory = new BrowserBrainWorkingMemory({ clock, maxCells, maxEvents });
    this.#pressure = new BrowserControlPressureGovernor({ recoverySamples: pressureRecoverySamples });
  }

  #now() { return new Date(this.#clock()).toISOString(); }

  reconcile({ tabs = [], process_snapshot = null, cell_by_tab = null } = {}) {
    if (!process_snapshot || typeof process_snapshot !== 'object') throw new Error('browser_runtime_control_plane_process_snapshot_required');
    const bindingSnapshot = this.#bindings.reconcile({ tabs, process_snapshot, cell_by_tab });
    this.#memory.reconcileBindings(bindingSnapshot);
    this.#liveCells = Math.max(1, bindingSnapshot.live_binding_count || 0);
    return this.snapshot();
  }

  ingestProcessEvent(event = {}) {
    const type = String(event?.type || '').toUpperCase();
    if (LETHAL_RUNTIME_EVENTS.has(type)) {
      this.#bindings.applyLifecycleEvent(event);
      this.#memory.ingestEvent(event);
      this.#memory.reconcileBindings(this.#bindings.snapshot());
      this.#liveCells = Math.max(1, this.#bindings.snapshot().live_binding_count || 0);
      return Object.freeze({
        type,
        runtime_binding_invalidated: true,
        reconciliation_required: true,
        authority_effect: false,
      });
    }
    const projected = this.#memory.ingestEvent(event);
    return Object.freeze({
      type,
      event: projected,
      runtime_binding_invalidated: false,
      reconciliation_required: false,
      authority_effect: false,
    });
  }

  prepareMutation(command) {
    const action = exactAction(command);
    const commandId = exactCommandId(command?.command_id);
    const tabId = exactTabId(command?.payload?.tab_id);
    const context = this.#memory.context(tabId);
    if (context?.status === 'NEEDS_ATTENTION') throw new Error('browser_runtime_fence_reconciliation_required');
    if (context?.status === 'GONE') throw new Error('browser_runtime_fence_target_not_live');

    const binding = this.#bindings.resolveTab(tabId, { require_complete_process_identity: true });
    if (!binding) throw new Error('browser_runtime_fence_target_not_live');
    if (!binding.target_id || FALLBACK_TARGET_RE.test(binding.target_id)) {
      throw new Error('browser_runtime_fence_exact_cdp_target_not_ready');
    }
    if (context?.binding && context.binding.binding_generation !== binding.binding_generation) {
      throw new Error('browser_runtime_fence_memory_binding_generation_stale');
    }

    return mutationFence(binding, {
      ...command,
      command_id: commandId,
      action,
      payload: { ...(command?.payload || {}), tab_id: tabId },
    }, this.#now());
  }

  assertMutationTarget({ command, fence, webContents } = {}) {
    if (!fence || fence.schema !== BROWSER_RUNTIME_MUTATION_FENCE_SCHEMA || fence.authority_effect !== false) {
      throw new Error('browser_runtime_fence_missing_or_invalid');
    }
    if (fence.execution_authority !== false || fence.command_leasing !== false || fence.automatic_retry_allowed !== false) {
      throw new Error('browser_runtime_fence_safety_flags_invalid');
    }

    const commandId = exactCommandId(command?.command_id);
    const action = exactAction(command);
    const tabId = exactTabId(command?.payload?.tab_id);
    if (fence.command_id !== commandId) throw new Error('browser_runtime_fence_command_id_mismatch');
    if (fence.action !== action) throw new Error('browser_runtime_fence_action_mismatch');
    if (fence.tab_id !== tabId) throw new Error('browser_runtime_fence_tab_id_mismatch');

    const context = this.#memory.context(tabId);
    if (context?.status === 'NEEDS_ATTENTION') throw new Error('browser_runtime_fence_reconciliation_required');

    const current = this.#bindings.assertExactRuntimeTarget({
      tab_id: fence.tab_id,
      binding_generation: fence.binding_generation,
      web_contents_id: fence.web_contents_id,
      renderer_process_key: fence.renderer_process_key,
      target_id: fence.target_id,
    });
    const live = liveWebContentsProjection(webContents);
    if (live.web_contents_id !== current.web_contents_id) throw new Error('browser_runtime_fence_live_webcontents_mismatch');
    if (live.renderer_pid !== current.renderer_pid) throw new Error('browser_runtime_fence_live_renderer_pid_mismatch');
    if (live.target_id !== current.target_id) throw new Error('browser_runtime_fence_live_target_id_mismatch');

    return Object.freeze({
      ...fence,
      validated_at: this.#now(),
      validated_immediately_before_effect: true,
      authority_effect: false,
    });
  }

  recordCommandOutcome(outcome = {}) {
    return this.#memory.rememberCommandOutcome(outcome);
  }

  observePressure(sample = {}) {
    return this.#pressure.observe({ ...sample, live_cells: sample?.live_cells ?? this.#liveCells });
  }

  bindingForTab(tabId) {
    return this.#bindings.resolveTab(tabId, { require_complete_process_identity: true });
  }

  contextForTab(tabId) {
    return this.#memory.context(tabId);
  }

  snapshot() {
    const bindings = this.#bindings.snapshot();
    this.#liveCells = Math.max(1, bindings.live_binding_count || 0);
    return Object.freeze({
      schema: BROWSER_BRAIN_RUNTIME_CONTROL_PLANE_SCHEMA,
      runtime_bindings: bindings,
      working_memory: this.#memory.snapshot(),
      pressure: this.#pressure.snapshot({ liveCells: this.#liveCells }),
      live_cells: bindings.live_binding_count,
      mutation_fence: BROWSER_RUNTIME_MUTATION_FENCE_SCHEMA,
      mutation_fence_validation_point: 'IMMEDIATELY_BEFORE_SIDE_EFFECT',
      exact_cdp_target_required: true,
      selected_tab_fallback_allowed_for_mutation: false,
      platform_fallback_allowed_for_mutation: false,
      stale_binding_execution_allowed: false,
      ambiguous_effect_blocks_same_cell_mutation: true,
      periodic_census_is_execution_authority: false,
      execution_authority: false,
      scheduler_authority: false,
      command_leasing: false,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
