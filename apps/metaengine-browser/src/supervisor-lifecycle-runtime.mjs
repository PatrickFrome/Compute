import crypto from 'node:crypto';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { ChatGptServiceThrottleGate } from './chatgpt-service-throttle.mjs';
import { SupervisorLifecycleRuntime as CoreSupervisorLifecycleRuntime } from './supervisor-lifecycle-runtime-core.mjs';

const NATIVE_FRAME_SCHEMA = 'metaengine.native-browser.perception.v1';
const CHAT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/c\/[a-z0-9-]+/i;
const CHAT_ROOT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/?$/i;
const SERVICE_THROTTLE_BLOCKED_ACTIONS = new Set([
  'NEW_TAB', 'NAVIGATE', 'RELOAD', 'SEMANTIC_TYPE', 'TYPED_CLICK', 'STOP_GENERATION',
]);
const TERMINAL_FLEET_STATES = new Set(['LOST', 'RETIRED', 'PROVISIONING_AMBIGUOUS']);
const DEFAULT_WORKER_OBSERVATION_CONCURRENCY = 4;
const TRANSPORT_WAKE_HISTORY_LIMIT = 4;
const TRANSPORT_SESSION_TAB_LIMIT = 32;
const TRANSPORT_WORKER_SIGNAL_LIMIT = 32;
const clip = (value, max = 180) => String(value ?? '').slice(0, max);

function isNativeFrame(frame) {
  return String(frame?.schema || '') === NATIVE_FRAME_SCHEMA;
}

function isGenerating(frame) {
  return Boolean(frame?.semantic_targets?.some((row) => row?.role === 'button' && chatGptControlMatches('STOP', row?.name)));
}

function exactSelectedTab(state, tabId) {
  const selected = (state?.tabs || []).filter((row) => row?.selected === true);
  return selected.length === 1 && String(selected[0]?.tab_id || '') === String(tabId || '');
}

function positiveViewport(frame) {
  return Number(frame?.viewport?.width || 0) > 0 && Number(frame?.viewport?.height || 0) > 0;
}

function exactIncarnation(before, after, tabId) {
  const expectedTabId = String(tabId || '');
  const beforeProcess = String(before?.process_incarnation_id || '');
  const afterProcess = String(after?.process_incarnation_id || '');
  const beforeTarget = String(before?.target_id || '');
  const afterTarget = String(after?.target_id || '');
  if (!expectedTabId || String(before?.tab_id || '') !== expectedTabId || String(after?.tab_id || '') !== expectedTabId) return false;
  if (!beforeProcess || beforeProcess !== afterProcess) return false;
  if (!beforeTarget || beforeTarget !== afterTarget) return false;
  return String(before?.url || '') === String(after?.url || '');
}

function promptSha(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function promptMarker(text) {
  const match = /(?:^|\n)wake_id=([^\s\n]+)/i.exec(String(text || ''));
  return match ? String(match[1]) : null;
}

function suppressed(action, reason, frame = null) {
  return Object.freeze({
    action,
    suppressed: true,
    reason: String(reason),
    tab_id: frame?.tab_id ? String(frame.tab_id) : null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function failClosedReadbackFrame(fallback, tabId, error) {
  return {
    schema: NATIVE_FRAME_SCHEMA,
    captured_at: new Date().toISOString(),
    tab_id: String(tabId || fallback?.tab_id || ''),
    process_incarnation_id: fallback?.process_incarnation_id || null,
    target_id: fallback?.target_id || null,
    url: String(fallback?.url || ''),
    title: String(fallback?.title || ''),
    semantic_targets: [],
    text_excerpt: '',
    viewport: fallback?.viewport ? { ...fallback.viewport } : null,
    perception_error: `SEND_READBACK_UNAVAILABLE:${clip(error?.message || error)}`,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function positiveReadback(frame, fence) {
  if (!fence || !isNativeFrame(frame)) return false;
  if (isGenerating(frame)) return true;
  if (fence.marker && String(frame?.text_excerpt || '').includes(fence.marker)) return true;
  return CHAT_ROOT_RE.test(String(fence.pre_url || '')) && CHAT_RE.test(String(frame?.url || ''));
}

function observationConcurrency(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.max(1, Math.min(16, parsed))
    : DEFAULT_WORKER_OBSERVATION_CONCURRENCY;
}

function wakeSummary(row) {
  if (!row || typeof row !== 'object') return null;
  return Object.freeze({
    wake_id: row.wake_id ? clip(row.wake_id, 96) : null,
    reason: row.reason ? clip(row.reason, 80) : null,
    queue_key: row.queue_key ? clip(row.queue_key, 240) : null,
    supervisor_epoch: Number.isSafeInteger(Number(row.supervisor_epoch)) ? Number(row.supervisor_epoch) : null,
    cycle_seq: Number.isSafeInteger(Number(row.cycle_seq)) ? Number(row.cycle_seq) : null,
    process_incarnation_id: row.process_incarnation_id ? clip(row.process_incarnation_id, 160) : null,
    origin_process_incarnation_id: row.origin_process_incarnation_id ? clip(row.origin_process_incarnation_id, 160) : null,
    prepared_at: row.prepared_at || null,
    confirmed_at: row.confirmed_at || null,
    ambiguous_at: row.ambiguous_at || null,
    ambiguous_reason: row.ambiguous_reason ? clip(row.ambiguous_reason, 160) : null,
    retired_at: row.retired_at || null,
    retired_reason: row.retired_reason ? clip(row.retired_reason, 160) : null,
    terminal_generation_epoch: Number.isSafeInteger(Number(row.terminal_generation_epoch)) ? Number(row.terminal_generation_epoch) : null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function queuedWakeSummary(row) {
  if (!row || typeof row !== 'object') return null;
  const agentIds = Array.isArray(row.metadata?.agent_ids) ? row.metadata.agent_ids : [];
  return Object.freeze({
    key: row.key ? clip(row.key, 240) : null,
    reason: row.reason ? clip(row.reason, 80) : null,
    queued_at: row.queued_at || null,
    process_incarnation_id: row.process_incarnation_id ? clip(row.process_incarnation_id, 160) : null,
    agent_id: row.metadata?.agent_id ? clip(row.metadata.agent_id, 80) : null,
    agent_count: agentIds.length,
    authority_effect: false,
  });
}

function scalarProjection(source, keys, max = 240) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const projected = {};
  for (const key of keys) {
    const value = source[key];
    if (value == null || typeof value === 'boolean' || typeof value === 'number') projected[key] = value ?? null;
    else if (typeof value === 'string') projected[key] = clip(value, max);
  }
  return projected;
}

function sessionRowSummary(row) {
  if (!row || typeof row !== 'object') return null;
  return Object.freeze({
    tab_id: row.tab_id ? clip(row.tab_id, 80) : null,
    state: clip(row.state || 'UNKNOWN', 48),
    state_since: row.state_since || null,
    generation_epoch: Math.max(0, Number(row.generation_epoch) || 0),
    generation_started_at: row.generation_started_at || null,
    last_progress_at: row.last_progress_at || null,
    last_progress_source: row.last_progress_source ? clip(row.last_progress_source, 64) : null,
    recovery_attempts: Math.max(0, Number(row.recovery_attempts) || 0),
    physical_health: clip(row.physical_health || 'UNKNOWN', 48),
    controls: row.controls && typeof row.controls === 'object' ? {
      stop: Math.max(0, Number(row.controls.stop) || 0),
      continue: Math.max(0, Number(row.controls.continue) || 0),
      retry: Math.max(0, Number(row.controls.retry) || 0),
      send: Math.max(0, Number(row.controls.send) || 0),
    } : null,
    progress_age_ms: Number.isFinite(Number(row.progress_age_ms)) ? Math.max(0, Number(row.progress_age_ms)) : null,
    soft_stall: row.soft_stall === true,
    hard_stall: row.hard_stall === true,
    terminal_ready: row.terminal_ready === true,
    last_observed_at: row.last_observed_at || null,
    authority_effect: false,
  });
}

export function buildSupervisorLifecycleStatusSnapshot(snapshot = {}) {
  const keepalive = snapshot?.keepalive && typeof snapshot.keepalive === 'object' ? snapshot.keepalive : null;
  const session = snapshot?.supervisor_session && typeof snapshot.supervisor_session === 'object' ? snapshot.supervisor_session : null;
  const ambiguousHistory = Array.isArray(keepalive?.ambiguous_history) ? keepalive.ambiguous_history : [];
  const predecessorHistory = Array.isArray(keepalive?.predecessor_wake_history) ? keepalive.predecessor_wake_history : [];
  const queuedWakes = Array.isArray(keepalive?.queued_wakes) ? keepalive.queued_wakes : [];
  const workerGeneration = keepalive?.previous_worker_generation && typeof keepalive.previous_worker_generation === 'object'
    ? Object.entries(keepalive.previous_worker_generation)
    : [];
  const sessionRows = Array.isArray(session?.tabs) ? session.tabs : [];
  const sessionSummaries = sessionRows.slice(-TRANSPORT_SESSION_TAB_LIMIT).map(sessionRowSummary).filter(Boolean);
  const stateCounts = {};
  for (const row of sessionSummaries) stateCounts[row.state] = Number(stateCounts[row.state] || 0) + 1;
  const workerSignals = (Array.isArray(snapshot?.worker_signals) ? snapshot.worker_signals : []).slice(-TRANSPORT_WORKER_SIGNAL_LIMIT).map((row) => ({
    agent_id: row?.agent_id ? clip(row.agent_id, 80) : null,
    lifecycle_state: clip(row?.lifecycle_state || 'UNKNOWN', 48),
    generation_state: clip(row?.generation_state || 'UNKNOWN', 48),
    authority_effect: false,
  }));

  const continuousService = scalarProjection(snapshot?.continuous_service, [
    'enabled', 'monitor_ms', 'auto_rollover_cycles', 'work_cycle_limit',
    'admission_state', 'authoritative_admission_required',
    'automatic_rollover_cycle_limit_enabled', 'external_confirmation_required_for_continuation',
    'terminal_requires_user_message', 'restart_resumable', 'restart_pending_wake_reconciliation',
    'restart_rollover_reconciliation', 'prompt_plaintext_persisted', 'orphaned_stall_stop_only',
    'ambiguous_terminal_retirement', 'active_wake_terminal_retirement', 'ambiguous_same_wake_retry',
    'wake_send_transport', 'service_throttle_backpressure', 'worker_observation_prefetch',
    'worker_observation_concurrency', 'authority_effect',
  ]);
  const runtimeControl = scalarProjection(snapshot?.continuous_service?.runtime_control, [
    'schema', 'state', 'reason', 'workspace_id', 'generation_floor', 'refill_enabled',
    'supervisor_admission_enabled', 'continuous_service_allowed', 'authoritative',
    'automatic_retry_allowed', 'authority_effect',
  ]);
  const activeRequest = scalarProjection(snapshot?.active_request, [
    'wake_id', 'tab_id', 'retry_attempt', 'same_chat_retry_attempt', 'blocked_ambiguous',
    'restored_from_durable_keepalive', 'trusted_prompt_persisted', 'effect_class',
  ]);
  const lastRecovery = scalarProjection(snapshot?.last_recovery, [
    'action', 'reason', 'wake_id', 'tab_id', 'prior_request_tab_id', 'generation_epoch',
    'supervisor_epoch', 'rollover_attempt_id', 'retry_attempt', 'proof', 'prompt_retyped',
    'confirmed', 'ambiguous', 'automatic_retry_allowed', 'at', 'observed_stopped_at',
    'terminal_confirmed_at', 'authority_effect',
  ]);
  const workerPrefetch = scalarProjection(snapshot?.worker_observation_prefetch, [
    'captured_count', 'failed_count', 'concurrency', 'elapsed_ms', 'error', 'read_only', 'authority_effect',
  ]);
  const serviceThrottle = scalarProjection(snapshot?.service_throttle, [
    'schema', 'state', 'reason', 'source_tab_id', 'first_observed_at', 'last_observed_at',
    'automatic_retry_allowed', 'authority_effect',
  ]);
  const rolloverAttempt = scalarProjection(keepalive?.rollover_attempt, [
    'attempt_id', 'supervisor_epoch', 'previous_conversation', 'started_at', 'tab_id', 'tab_bound_at',
    'ambiguous_at', 'ambiguous_reason', 'restart_recovered_at', 'automatic_retry_allowed',
  ], 1200);

  return Object.freeze({
    schema: clip(snapshot?.schema || 'metaengine.supervisor-lifecycle-runtime.v4', 96),
    keepalive: keepalive ? {
      schema: clip(keepalive.schema || 'metaengine.supervisor-keepalive.state.v1', 96),
      version: keepalive.version ? clip(keepalive.version, 48) : null,
      supervisor_id: keepalive.supervisor_id ? clip(keepalive.supervisor_id, 96) : null,
      supervisor_epoch: Math.max(0, Number(keepalive.supervisor_epoch) || 0),
      cycle_seq: Math.max(0, Number(keepalive.cycle_seq) || 0),
      state: clip(keepalive.state || 'UNKNOWN', 48),
      conversation_url: keepalive.conversation_url ? clip(keepalive.conversation_url, 1200) : null,
      tab_id: keepalive.tab_id ? clip(keepalive.tab_id, 80) : null,
      paused: keepalive.paused === true,
      paused_from_state: keepalive.paused_from_state ? clip(keepalive.paused_from_state, 48) : null,
      process_incarnation_id: keepalive.process_incarnation_id ? clip(keepalive.process_incarnation_id, 160) : null,
      process_incarnation_started_at: keepalive.process_incarnation_started_at || null,
      predecessor_process_incarnation_id: keepalive.predecessor_process_incarnation_id ? clip(keepalive.predecessor_process_incarnation_id, 160) : null,
      predecessor_fenced_at: keepalive.predecessor_fenced_at || null,
      predecessor_queued_wake_count: Math.max(0, Number(keepalive.predecessor_queued_wake_count) || 0),
      admission_state: keepalive.admission_state ? clip(keepalive.admission_state, 32) : 'UNKNOWN',
      admission_reason: keepalive.admission_reason ? clip(keepalive.admission_reason, 160) : null,
      admission_generation_floor: typeof keepalive.admission_generation_floor === 'number' && Number.isSafeInteger(keepalive.admission_generation_floor) ? keepalive.admission_generation_floor : null,
      admission_refill_enabled: typeof keepalive.admission_refill_enabled === 'boolean' ? keepalive.admission_refill_enabled : null,
      admission_supervisor_enabled: typeof keepalive.admission_supervisor_enabled === 'boolean' ? keepalive.admission_supervisor_enabled : null,
      admission_observed_at: keepalive.admission_observed_at || null,
      parked_at: keepalive.parked_at || null,
      parked_reason: keepalive.parked_reason ? clip(keepalive.parked_reason, 160) : null,
      parked_queued_wake_count: Math.max(0, Number(keepalive.parked_queued_wake_count) || 0),
      parked_wake_reasons: Array.isArray(keepalive.parked_wake_reasons) ? keepalive.parked_wake_reasons.slice(-32).map((reason) => clip(reason, 80)) : [],
      suppressed_wake_count: Math.max(0, Number(keepalive.suppressed_wake_count) || 0),
      last_suppressed_wake_at: keepalive.last_suppressed_wake_at || null,
      last_suppressed_wake_reason: keepalive.last_suppressed_wake_reason ? clip(keepalive.last_suppressed_wake_reason, 80) : null,
      queued_wakes: queuedWakes.slice(-TRANSPORT_WAKE_HISTORY_LIMIT).map(queuedWakeSummary).filter(Boolean),
      queued_wake_count: queuedWakes.length,
      pending_wake: wakeSummary(keepalive.pending_wake),
      active_wake: wakeSummary(keepalive.active_wake),
      ambiguous_history: ambiguousHistory.slice(-TRANSPORT_WAKE_HISTORY_LIMIT).map(wakeSummary).filter(Boolean),
      ambiguous_history_count: ambiguousHistory.length,
      predecessor_wake_history: predecessorHistory.slice(-TRANSPORT_WAKE_HISTORY_LIMIT).map(wakeSummary).filter(Boolean),
      predecessor_wake_history_count: predecessorHistory.length,
      previous_worker_generation: Object.fromEntries(workerGeneration.slice(-32).map(([key, value]) => [clip(key, 80), clip(value, 48)])),
      previous_worker_generation_count: workerGeneration.length,
      last_wake_at: keepalive.last_wake_at || null,
      last_wake_reason: keepalive.last_wake_reason ? clip(keepalive.last_wake_reason, 80) : null,
      last_completed_cycle_at: keepalive.last_completed_cycle_at || null,
      last_research_wake_at: keepalive.last_research_wake_at || null,
      rollover_reason: keepalive.rollover_reason ? clip(keepalive.rollover_reason, 160) : null,
      rollover_release_at: keepalive.rollover_release_at || null,
      rollover_attempt: rolloverAttempt,
      updated_at: keepalive.updated_at || null,
      work_cycle_limit: Number.isFinite(Number(keepalive.work_cycle_limit)) ? Number(keepalive.work_cycle_limit) : null,
      worker_generation_memory_limit: Number.isFinite(Number(keepalive.worker_generation_memory_limit)) ? Number(keepalive.worker_generation_memory_limit) : null,
      automatic_rollover_cycle_limit_enabled: keepalive.automatic_rollover_cycle_limit_enabled === true,
      external_confirmation_required_for_continuation: keepalive.external_confirmation_required_for_continuation === true,
      transport_history_limit: TRANSPORT_WAKE_HISTORY_LIMIT,
      transport_worker_generation_limit: 32,
      authority_effect: false,
    } : null,
    supervisor_generation: snapshot?.supervisor_generation ? clip(snapshot.supervisor_generation, 48) : null,
    supervisor_session: session ? {
      schema: session.schema || 'metaengine.chatgpt-session-monitor.snapshot.v1',
      version: session.version || null,
      tabs: sessionSummaries,
      tab_count: sessionRows.length,
      state_counts: stateCounts,
      persisted_response_text: false,
      full_frame_digests_included: false,
      recent_generation_samples_included: false,
      authority_effect: false,
    } : null,
    worker_signals: workerSignals,
    worker_signal_count: Array.isArray(snapshot?.worker_signals) ? snapshot.worker_signals.length : 0,
    continuous_service: continuousService ? { ...continuousService, runtime_control: runtimeControl } : null,
    active_request: activeRequest,
    last_recovery: lastRecovery,
    worker_observation_prefetch: workerPrefetch,
    service_throttle: serviceThrottle,
    quiescent: snapshot?.quiescent === true,
    actuation_enabled: snapshot?.actuation_enabled === true,
    last_error: snapshot?.last_error ? clip(snapshot.last_error, 240) : null,
    transport_session_tab_limit: TRANSPORT_SESSION_TAB_LIMIT,
    transport_worker_signal_limit: TRANSPORT_WORKER_SIGNAL_LIMIT,
    heartbeat_payload_bounded: true,
    full_history_retained_locally: true,
    authority_effect: false,
  });
}

export async function prefetchFleetWorkerFrames({ state, executeCommand, concurrency = DEFAULT_WORKER_OBSERVATION_CONCURRENCY } = {}) {
  if (typeof executeCommand !== 'function') throw new Error('supervisor_worker_prefetch_executor_required');
  const limit = observationConcurrency(concurrency);
  const candidates = (state?.fleet?.agents || [])
    .filter((agent) => agent?.tab_id && !TERMINAL_FLEET_STATES.has(String(agent?.lifecycle_state || '').toUpperCase()))
    .map((agent) => ({ agent_id: String(agent?.agent_id || ''), tab_id: String(agent.tab_id) }));
  const frames = new Map();
  let failures = 0;
  const started = Date.now();

  for (let offset = 0; offset < candidates.length; offset += limit) {
    const batch = candidates.slice(offset, offset + limit);
    const settled = await Promise.all(batch.map(async (agent) => {
      try {
        const frame = await executeCommand({ action: 'CAPTURE', payload: { tab_id: agent.tab_id }, platform: null });
        return { ...agent, frame, error: null };
      } catch (error) {
        return { ...agent, frame: null, error: clip(error) };
      }
    }));
    for (const row of settled) {
      if (row.frame) frames.set(row.tab_id, row.frame);
      else failures += 1;
    }
  }

  return {
    schema: 'metaengine.supervisor-worker-observation-prefetch.v1',
    candidate_count: candidates.length,
    captured_count: frames.size,
    failed_count: failures,
    concurrency: limit,
    elapsed_ms: Math.max(0, Date.now() - started),
    frames,
    read_only: true,
    authority_effect: false,
  };
}

export function createSupervisorSendBoundaryExecutor({ getState, executeCommand, throttleGate = null } = {}) {
  if (typeof getState !== 'function' || typeof executeCommand !== 'function') throw new Error('supervisor_send_boundary_dependencies_required');
  if (throttleGate != null && (typeof throttleGate.observe !== 'function' || typeof throttleGate.active !== 'function')) {
    throw new Error('supervisor_service_throttle_gate_invalid');
  }
  const lastNativeFrame = new Map();
  const promptFence = new Map();
  const readbackFence = new Map();

  const rememberFrame = (tabId, frame) => {
    const id = String(tabId || frame?.tab_id || '');
    if (!id || !isNativeFrame(frame)) return;
    lastNativeFrame.set(id, frame);
    throttleGate?.observe(id, frame);
    const fence = promptFence.get(id);
    if (positiveReadback(frame, fence)) {
      promptFence.delete(id);
      readbackFence.delete(id);
    }
  };

  const capture = async (command) => {
    const tabId = String(command?.payload?.tab_id || '');
    try {
      const frame = await executeCommand(command);
      rememberFrame(tabId, frame);
      const readback = readbackFence.get(tabId);
      if (readback) {
        readback.remaining -= 1;
        if (readback.remaining <= 0 || positiveReadback(frame, promptFence.get(tabId))) readbackFence.delete(tabId);
      }
      return frame;
    } catch (error) {
      const fence = promptFence.get(tabId);
      const readback = readbackFence.get(tabId);
      if (!fence || !readback) throw error;
      readback.remaining -= 1;
      if (readback.remaining <= 0) readbackFence.delete(tabId);
      return failClosedReadbackFrame(readback.fallback || lastNativeFrame.get(tabId), tabId, error);
    }
  };

  return async function executeWithSupervisorSendBoundary(command) {
    const action = String(command?.action || '');
    const tabId = String(command?.payload?.tab_id || '');

    if (action === 'CAPTURE') return capture(command);

    if (throttleGate?.active() && SERVICE_THROTTLE_BLOCKED_ACTIONS.has(action)) {
      return suppressed(action, 'CHATGPT_SERVICE_THROTTLED', lastNativeFrame.get(tabId) || null);
    }

    if (action === 'SEMANTIC_TYPE') {
      const baseline = lastNativeFrame.get(tabId);
      if (!isNativeFrame(baseline)) return executeCommand(command);
      const text = String(command?.payload?.text ?? '');
      const sha = promptSha(text);
      const prior = promptFence.get(tabId);
      if (prior?.prompt_sha256 === sha) {
        return suppressed(action, 'DUPLICATE_PROMPT_TYPE_SUPPRESSED', baseline);
      }
      const fence = {
        prompt_sha256: sha,
        marker: promptMarker(text),
        pre_url: String(baseline?.url || ''),
        phase: 'TYPE_ATTEMPTED',
        attempted_at: new Date().toISOString(),
      };
      promptFence.set(tabId, fence);
      try {
        const result = await executeCommand(command);
        fence.phase = 'TYPED';
        return result;
      } catch (error) {
        fence.phase = 'TYPE_EFFECT_AMBIGUOUS';
        fence.error = clip(error?.message || error);
        return suppressed(action, 'TYPE_EFFECT_AMBIGUOUS', baseline);
      }
    }

    const isSendClick = action === 'TYPED_CLICK'
      && String(command?.payload?.role || '').toLowerCase() === 'button'
      && chatGptControlMatches('SEND', command?.payload?.accessible_name);
    if (!isSendClick) return executeCommand(command);

    const fence = promptFence.get(tabId);
    if (fence?.phase === 'CLICK_ATTEMPTED') {
      return suppressed(action, 'SEND_CLICK_ALREADY_ATTEMPTED', lastNativeFrame.get(tabId));
    }

    let before = null;
    let activated = null;
    const block = (reason, error = null) => {
      if (fence) {
        fence.phase = 'PRECLICK_BLOCKED';
        if (error) fence.error = clip(error?.message || error);
      }
      const fallback = activated || before || lastNativeFrame.get(tabId) || null;
      readbackFence.set(tabId, { remaining: 6, fallback });
      return suppressed(action, reason, fallback);
    };

    try {
      before = await executeCommand({ action: 'CAPTURE', payload: { tab_id: tabId }, platform: command?.platform ?? null });
      rememberFrame(tabId, before);
      // Non-native executors are test/model adapters and retain the proven core path.
      // The installed Electron path always exposes metaengine.native-browser.perception.v1.
      if (!isNativeFrame(before)) return executeCommand(command);
      if (throttleGate?.active()) return block('CHATGPT_SERVICE_THROTTLED');

      await executeCommand({ action: 'SELECT_TAB', payload: { tab_id: tabId }, platform: command?.platform ?? null });
      const state = await getState();
      if (!exactSelectedTab(state, tabId)) return block('SUPERVISOR_TAB_NOT_EXACTLY_SELECTED');

      activated = await executeCommand({ action: 'CAPTURE', payload: { tab_id: tabId }, platform: command?.platform ?? null });
      rememberFrame(tabId, activated);
      if (!isNativeFrame(activated)) return block('SUPERVISOR_NATIVE_FRAME_LOST');
      if (throttleGate?.active()) return block('CHATGPT_SERVICE_THROTTLED');
      if (!exactIncarnation(before, activated, tabId)) return block('SUPERVISOR_TARGET_INCARNATION_CHANGED');
      if (!positiveViewport(activated)) return block('SUPERVISOR_VIEWPORT_NOT_VISIBLE');

      const send = uniqueChatGptControl(activated, 'SEND');
      if (!send) return block('SUPERVISOR_SEND_NOT_UNIQUE_AFTER_SELECT');
      if (String(send.name || '') !== String(command?.payload?.accessible_name || '')) return block('SUPERVISOR_SEND_CONTROL_CHANGED');

      if (fence) fence.phase = 'CLICK_ATTEMPTED';
      readbackFence.set(tabId, { remaining: 6, fallback: activated });
      try {
        return await executeCommand(command);
      } catch (error) {
        if (fence) fence.error = clip(error?.message || error);
        return suppressed(action, 'SEND_CLICK_EFFECT_AMBIGUOUS', activated);
      }
    } catch (error) {
      return block('SUPERVISOR_SEND_BOUNDARY_REVALIDATION_FAILED', error);
    }
  };
}

// Static continuity markers retained because the implementation itself remains in
// supervisor-lifecycle-runtime-core.mjs: CHATGPT_CONVERSATION_LIMIT_HINT and
// reason.startsWith('MAX_CYCLES_PER_EPOCH'). The wrapper adds no page authority.
export class SupervisorLifecycleRuntime extends CoreSupervisorLifecycleRuntime {
  #serviceThrottleGate;
  #sourceGetState;
  #sourceExecute;
  #workerCaptureCache;
  #workerObservationConcurrency;
  #lastWorkerPrefetch = null;

  constructor(options = {}) {
    const serviceThrottleGate = options.serviceThrottleGate || new ChatGptServiceThrottleGate();
    if (typeof serviceThrottleGate.active !== 'function' || typeof serviceThrottleGate.snapshot !== 'function') {
      throw new Error('supervisor_service_throttle_gate_invalid');
    }
    if (typeof options.getState !== 'function' || typeof options.executeCommand !== 'function') {
      throw new Error('supervisor_lifecycle_dependencies_required');
    }
    const baseCanActuate = typeof options.canActuate === 'function' ? options.canActuate : () => true;
    const workerCaptureCache = new Map();
    const sourceExecute = options.executeCommand;
    const cachedExecute = async (command) => {
      if (String(command?.action || '') === 'CAPTURE') {
        const tabId = String(command?.payload?.tab_id || '');
        if (tabId && workerCaptureCache.has(tabId)) {
          const frame = workerCaptureCache.get(tabId);
          workerCaptureCache.delete(tabId);
          return frame;
        }
      }
      return sourceExecute(command);
    };
    const guardedExecute = createSupervisorSendBoundaryExecutor({
      getState: options.getState,
      executeCommand: cachedExecute,
      throttleGate: serviceThrottleGate,
    });
    super({
      ...options,
      canActuate: () => baseCanActuate() === true && serviceThrottleGate.active() !== true,
      executeCommand: guardedExecute,
    });
    this.#serviceThrottleGate = serviceThrottleGate;
    this.#sourceGetState = options.getState;
    this.#sourceExecute = sourceExecute;
    this.#workerCaptureCache = workerCaptureCache;
    this.#workerObservationConcurrency = observationConcurrency(options.workerObservationConcurrency ?? options.workerObservationBudget);
  }

  async cycle(options = {}) {
    this.#workerCaptureCache.clear();
    try {
      const state = await this.#sourceGetState();
      const prefetched = await prefetchFleetWorkerFrames({
        state,
        executeCommand: this.#sourceExecute,
        concurrency: this.#workerObservationConcurrency,
      });
      for (const [tabId, frame] of prefetched.frames.entries()) this.#workerCaptureCache.set(tabId, frame);
      this.#lastWorkerPrefetch = Object.freeze({
        schema: prefetched.schema,
        candidate_count: prefetched.candidate_count,
        captured_count: prefetched.captured_count,
        failed_count: prefetched.failed_count,
        concurrency: prefetched.concurrency,
        elapsed_ms: prefetched.elapsed_ms,
        read_only: true,
        authority_effect: false,
      });
    } catch (error) {
      this.#lastWorkerPrefetch = Object.freeze({
        schema: 'metaengine.supervisor-worker-observation-prefetch.v1',
        candidate_count: null,
        captured_count: 0,
        failed_count: null,
        concurrency: this.#workerObservationConcurrency,
        elapsed_ms: null,
        error: clip(error),
        read_only: true,
        authority_effect: false,
      });
    }
    try {
      return await super.cycle(options);
    } finally {
      this.#workerCaptureCache.clear();
    }
  }

  snapshot() {
    const base = super.snapshot();
    return {
      ...base,
      continuous_service: {
        ...(base.continuous_service || {}),
        service_throttle_backpressure: 'UI_READBACK_GATE_V1',
        worker_observation_prefetch: 'BOUNDED_PARALLEL_READ_ONLY_V1',
        worker_observation_concurrency: this.#workerObservationConcurrency,
      },
      worker_observation_prefetch: this.#lastWorkerPrefetch ? structuredClone(this.#lastWorkerPrefetch) : null,
      service_throttle: this.#serviceThrottleGate.snapshot(),
      authority_effect: false,
    };
  }

  statusSnapshot() {
    return buildSupervisorLifecycleStatusSnapshot(this.snapshot());
  }
}
