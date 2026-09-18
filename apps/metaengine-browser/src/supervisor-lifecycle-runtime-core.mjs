import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isChatAuthRedirectUrl } from './chatgpt-auth-readback.mjs';
import { AgentSessionMonitor } from './agent-session-monitor.mjs';
import { AGENT_PLATFORM_HOME_URL, AGENT_PLATFORM_ID } from './browser-agent-platform.mjs';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { classifyRetryDecision, REQUEST_EFFECT_CLASS } from './chatgpt-retry-policy.mjs';
import { buildSupervisorRolloverMessage, buildSupervisorWakeMessage } from './supervisor-keepalive.mjs';
import { SupervisorBootstrapKeepalive } from './supervisor-bootstrap-keepalive.mjs';
import { evaluateActiveWakeTerminalRetirement } from './supervisor-terminal-retirement.mjs';
import {
  devosRuntimeControlAllowsContinuousService,
  normalizeDevosRuntimeControl,
  unavailableDevosRuntimeControl,
} from './devos-runtime-control.mjs';

const CHAT_RE = /^https:\/\/chat\.z\.ai\/c\/[a-z0-9-]+/i;
const CHAT_ROOT_RE = /^https:\/\/chat\.z\.ai\/?$/i;
const LIMIT_RE = /(maximum conversation length|conversation is too long|start a new chat|диалог.{0,20}слишком длин|начните новый чат)/i;
const CONTINUOUS_WAKE_REASON = 'CONTINUE_DEVELOPMENT';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function generating(frame) {
  return Boolean(frame?.semantic_targets?.some((x) => x?.role === 'button' && chatGptControlMatches('STOP', x?.name)));
}
function unique(frame, role) {
  const rows = (frame?.semantic_targets || []).filter((x) => x?.role === role);
  return rows.length === 1 ? rows[0] : null;
}
function composerMatches(frame, message) {
  const box = unique(frame, 'textbox');
  return Boolean(box?.value_sha256 && box.value_sha256 === sha256(message));
}
function retryEnvelope(message, wakeId, retryAttempt) {
  return `${String(message)}\n\nMETAENGINE_SAME_WAKE_RETRY_V1\nwake_id=${String(wakeId)}\nretry_attempt=${Number(retryAttempt)}\nThis is the same logical supervisor wake, not authority for a duplicate effect. Before any write, deployment, merge or external actuation, re-read authoritative GitHub/Supabase/receipt state and reconcile whether the prior attempt already produced that effect. Never repeat an observed or ambiguous effect. Continue only missing work.`;
}
function tabLiveness(state, tabId) {
  const id = String(tabId || '');
  const tab = (state?.tabs || []).find((row) => String(row?.tab_id || '') === id) || null;
  const networkRows = state?.network?.tabs || state?.tab_network?.tabs || [];
  const network = networkRows.find((row) => String(row?.tab_id || '') === id || Number(row?.webcontents_id || 0) === Number(tab?.webcontents_id || -1)) || tab?.network || null;
  const healthRows = state?.health?.tabs || state?.tab_health?.tabs || [];
  const health = healthRows.find((row) => String(row?.tab_id || '') === id) || tab?.health || null;
  return {
    physical_health: String(health?.state || tab?.physical_health || 'HEALTHY').toUpperCase(),
    network_active: Number(network?.inflight_tracked || 0) > 0,
  };
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e?.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

export class SupervisorLifecycleRuntime {
  #getState; #execute; #canActuate; #keepalive = null; #statePath; #lastRun = 0; #lastSupervisorGeneration = 'UNKNOWN'; #lastError = null;
  #lastWorkerSignals = []; #monitorMs; #researchMs; #sessionMonitor; #activeRequest = null; #lastRecovery = null;
  // P0 (2026-09-17): tabs created by failed bootstrap pre-effects (auth redirect
  // surfaces) and not yet provably closed. Retried before every new bootstrap
  // attempt so a wedged CLOSE_TAB can never turn into unbounded tab growth.
  #bootstrapLeakedTabIds = new Set();
  #runtimeControl = unavailableDevosRuntimeControl('NOT_OBSERVED');
  #requireAuthoritativeAdmission = false;

  constructor({ getState, executeCommand, canActuate = () => true, statePath = null, monitorMs = 2000, researchMs = 30 * 60 * 1000, sessionMonitor = null, requireAuthoritativeAdmission = false } = {}) {
    if (typeof getState !== 'function' || typeof executeCommand !== 'function' || typeof canActuate !== 'function') throw new Error('supervisor_lifecycle_dependencies_required');
    this.#getState = getState; this.#execute = executeCommand; this.#canActuate = canActuate; this.#statePath = statePath;
    this.#monitorMs = Math.max(1000, Number(monitorMs) || 2000);
    this.#researchMs = Math.max(5 * 60 * 1000, Number(researchMs) || 30 * 60 * 1000);
    this.#sessionMonitor = sessionMonitor || new AgentSessionMonitor();
    this.#requireAuthoritativeAdmission = requireAuthoritativeAdmission === true;
  }

  async start() {
    if (!this.#statePath) {
      const { app } = await import('electron');
      this.#statePath = path.join(app.getPath('userData'), 'metaengine-supervisor-keepalive-v1.json');
    }
    this.#keepalive = new SupervisorBootstrapKeepalive({
      loadState: () => readJson(this.#statePath),
      saveState: (v) => writeJson(this.#statePath, v),
    });
    await this.#keepalive.init();
    if (this.#requireAuthoritativeAdmission || this.#runtimeControl.authoritative === true) {
      await this.#applyRuntimeControlToKeepalive();
    }
    const active = this.#keepalive.activeWake();
    if (active) this.#activateRequest(active, this.#keepalive.snapshot().tab_id, true);
    await this.cycle({ force: true });
    return this.snapshot();
  }

  #activateRequest(wake, tabId, restored) {
    const message = buildSupervisorWakeMessage({
      supervisorEpoch: wake.supervisor_epoch,
      cycleSeq: wake.cycle_seq,
      wakeId: wake.wake_id,
      reason: wake.reason,
    });
    this.#activeRequest = {
      wake_id: wake.wake_id,
      tab_id: String(tabId || ''),
      message,
      retry_attempt: 0,
      same_chat_retry_attempt: 0,
      blocked_ambiguous: false,
      effect_class: REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE,
      restored_from_durable_keepalive: restored === true,
    };
    return this.#activeRequest;
  }

  async #applyRuntimeControlToKeepalive() {
    if (!this.#keepalive) return null;
    const durableFloor = this.#keepalive.snapshot()?.admission_generation_floor;
    if (this.#runtimeControl.authoritative === true
      && typeof durableFloor === 'number'
      && this.#runtimeControl.generation_floor < durableFloor) {
      this.#runtimeControl = unavailableDevosRuntimeControl('GENERATION_FLOOR_REGRESSION');
    }
    if (this.#runtimeControl.authoritative !== true) {
      return this.#keepalive.applyAdmissionUnavailable(this.#runtimeControl.reason || 'AUTHORITATIVE_READBACK_UNAVAILABLE');
    }
    if (devosRuntimeControlAllowsContinuousService(this.#runtimeControl)) {
      return this.#keepalive.applyAdmissionOpen(this.#runtimeControl);
    }
    return this.#keepalive.applyAdmissionClosed(this.#runtimeControl);
  }

  async applyRuntimeControl(value) {
    const next = normalizeDevosRuntimeControl(value);
    const previous = this.#runtimeControl;
    this.#runtimeControl = next;
    const changed = previous.state !== next.state
      || previous.authoritative !== next.authoritative
      || previous.generation_floor !== next.generation_floor
      || previous.refill_enabled !== next.refill_enabled
      || previous.supervisor_admission_enabled !== next.supervisor_admission_enabled
      || previous.reason !== next.reason;
    if (changed || this.#keepalive?.snapshot()?.admission_state !== next.state) {
      await this.#applyRuntimeControlToKeepalive();
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      schema: 'metaengine.supervisor-lifecycle-runtime.v4',
      keepalive: this.#keepalive?.snapshot() || null,
      supervisor_generation: this.#lastSupervisorGeneration,
      supervisor_session: this.#sessionMonitor?.snapshot() || null,
      continuous_service: {
        enabled: this.#requireAuthoritativeAdmission
          ? devosRuntimeControlAllowsContinuousService(this.#runtimeControl)
          : true,
        runtime_control: structuredClone(this.#runtimeControl),
        admission_state: this.#requireAuthoritativeAdmission ? this.#runtimeControl.state : 'UNSCOPED',
        authoritative_admission_required: this.#requireAuthoritativeAdmission,
        monitor_ms: this.#monitorMs,
        auto_rollover_cycles: null,
        work_cycle_limit: null,
        automatic_rollover_cycle_limit_enabled: false,
        external_confirmation_required_for_continuation: false,
        terminal_requires_user_message: false,
        restart_resumable: true,
        restart_pending_wake_reconciliation: 'COMPOSER_HASH_OR_TRANSCRIPT_PROOF_V1',
        restart_rollover_reconciliation: 'ROLLOVER_ATTEMPT_COMPOSER_HASH_OR_TRANSCRIPT_PROOF_V1',
        prompt_plaintext_persisted: false,
        orphaned_stall_stop_only: true,
        ambiguous_terminal_retirement: true,
        active_wake_terminal_retirement: 'EXACT_WAKE_TAB_GENERATION_V1',
        ambiguous_same_wake_retry: false,
        wake_send_transport: 'SEMANTIC_TYPE_SUBMIT_EVENT_LATCH_V1',
        initial_conversation_bootstrap: 'DEDICATED_ROOT_EXACT_WAKE_V1',
        authority_effect: false,
      },
      active_request: this.#activeRequest ? {
        wake_id: this.#activeRequest.wake_id,
        tab_id: this.#activeRequest.tab_id,
        retry_attempt: this.#activeRequest.retry_attempt,
        same_chat_retry_attempt: this.#activeRequest.same_chat_retry_attempt,
        blocked_ambiguous: this.#activeRequest.blocked_ambiguous === true,
        restored_from_durable_keepalive: this.#activeRequest.restored_from_durable_keepalive === true,
        trusted_prompt_persisted: false,
        effect_class: this.#activeRequest.effect_class,
      } : null,
      last_recovery: this.#lastRecovery ? structuredClone(this.#lastRecovery) : null,
      worker_signals: structuredClone(this.#lastWorkerSignals),
      quiescent: this.isQuiescent(),
      actuation_enabled: this.#canActuate() === true
        && (!this.#requireAuthoritativeAdmission || devosRuntimeControlAllowsContinuousService(this.#runtimeControl)),
      last_error: this.#lastError,
      authority_effect: false,
    };
  }

  isQuiescent() {
    const ks = this.#keepalive?.snapshot();
    if (ks?.state === 'PARKED') return !ks.pending_wake && !ks.active_wake;
    if (!ks || this.#lastSupervisorGeneration !== 'IDLE') return false;
    if (this.#activeRequest || this.#lastRecovery?.ambiguous === true) return false;
    if (ks.pending_wake) return false;
    const blockingQueued = (ks.queued_wakes || []).filter((wake) => String(wake?.reason || '') !== CONTINUOUS_WAKE_REASON);
    if (blockingQueued.length > 0) return false;
    if (['WAKE_PENDING','WAKE_AMBIGUOUS','ROLLOVER_REQUIRED','ROLLOVER_PENDING','ROLLOVER_AMBIGUOUS','RECOVERING','ACTIVE'].includes(ks.state)) return false;
    return this.#lastWorkerSignals.every((s) => ['IDLE','TERMINAL'].includes(String(s?.generation_state || 'UNKNOWN')));
  }

  async #capture(tabId) { return this.#execute({ action: 'CAPTURE', payload: { tab_id: String(tabId) }, platform: null }); }

  async #supervisorTab(state) {
    const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => a?.tab_id).filter(Boolean).map(String));
    const tabs = state?.tabs || [];
    const snap = this.#keepalive.snapshot();
    if (snap.conversation_url) {
      const exact = tabs.find((t) => String(t?.url || '') === snap.conversation_url && !fleetTabs.has(String(t?.tab_id || '')));
      if (exact) { if (snap.tab_id !== String(exact.tab_id)) await this.#keepalive.rebindTab(exact.tab_id); return exact; }
      // P0 (2026-09-17): while the user session is logged out, recreating the bound
      // conversation tab would land on the auth-redirect surface again and leak one
      // tab per maintenance tick (the live host reached tab_capacity_exceeded this
      // way). Reuse the existing auth-redirect tab as the observation target instead:
      // the session monitor classifies it (NOT_CHATGPT_CONVERSATION) and every
      // navigation-class recovery stays gated on auth surfaces. Zero new tabs.
      const authRedirected = tabs.filter((t) => !fleetTabs.has(String(t?.tab_id || '')) && isChatAuthRedirectUrl(String(t?.url || '')));
      if (authRedirected.length > 0) {
        return authRedirected.find((t) => t?.selected === true) || authRedirected[0];
      }
      if (this.#canActuate() !== true) return null;
      const restored = await this.#execute({ action: 'NEW_TAB', payload: { url: snap.conversation_url, select: false }, platform: null });
      if (restored?.tab_id) { await this.#keepalive.rebindTab(restored.tab_id); return { ...restored, url: snap.conversation_url }; }
    }
    const candidates = tabs.filter((t) => !fleetTabs.has(String(t?.tab_id || '')) && CHAT_RE.test(String(t?.url || '')));
    const picked = candidates.find((t) => t?.selected === true) || candidates[0] || null;
    if (picked) await this.#keepalive.bindConversation({ url: picked.url, tab_id: picked.tab_id });
    return picked;
  }

  async #observeWorkers(state) {
    const signals = [];
    for (const agent of state?.fleet?.agents || []) {
      let generation_state = ['LOST','RETIRED','PROVISIONING_AMBIGUOUS'].includes(String(agent?.lifecycle_state || '')) ? 'TERMINAL' : 'UNKNOWN';
      if (agent?.tab_id && generation_state !== 'TERMINAL') {
        try { generation_state = generating(await this.#capture(agent.tab_id)) ? 'GENERATING' : 'IDLE'; } catch {}
      }
      signals.push({ agent_id: agent?.agent_id, lifecycle_state: agent?.lifecycle_state, generation_state });
    }
    this.#lastWorkerSignals = signals;
    await this.#keepalive.observeWorkers(signals);
  }

  async #observeSendReadback(tabId, marker, attempts = 6) {
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await sleep(700);
      const observed = await this.#capture(tabId);
      if (generating(observed) || (marker && String(observed?.text_excerpt || '').includes(marker))) return { ok: true, observed };
    }
    return { ok: false, observed: null };
  }

  async #recoverAmbiguousWakeFromFrame(tab, frame, row, keepalive) {
    const pending = keepalive.pending_wake;
    if (!pending?.ambiguous_at) return false;
    const message = buildSupervisorWakeMessage({
      supervisorEpoch: pending.supervisor_epoch,
      cycleSeq: pending.cycle_seq,
      wakeId: pending.wake_id,
      reason: pending.reason,
    });
    const markerObserved = String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''));
    if (markerObserved) {
      await this.#keepalive.resolveAmbiguous({ observed_sent: true });
      this.#activateRequest(pending, tab.tab_id, true);
      this.#lastRecovery = {
        action: 'AMBIGUOUS_WAKE_POSITIVELY_REBOUND', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'WAKE_MARKER_IN_TRANSCRIPT', confirmed: true, ambiguous: false,
        automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
    const composer = unique(frame, 'textbox');
    if (row.terminal_ready === true
      && composer?.value_sha256 === sha256(message)
      && this.#canActuate() === true) {
      // GLM platform: the composer still holding the exact message is the
      // proof the prior Enter never submitted; the continuation re-submits the
      // same logical wake through the Enter lane (no named SEND control).
      if (!composer?.semantic_ref) return false;
      const continuationArmed = await this.#keepalive.markAmbiguousContinuationAttempt({
        wake_id: pending.wake_id,
        tab_id: tab.tab_id,
        composer_sha256: composer.value_sha256,
      });
      if (!continuationArmed) return false;
      await this.#execute({
        action: 'SEMANTIC_TYPE',
        payload: { tab_id: String(tab.tab_id), role: 'textbox', accessible_name: composer.name, semantic_ref: composer.semantic_ref, text: message, replace_existing: true, submit_after_type: true },
        platform: AGENT_PLATFORM_ID,
      });
      const readback = await this.#observeSendReadback(tab.tab_id, pending.wake_id);
      if (readback.ok) {
        await this.#keepalive.resolveAmbiguous({ observed_sent: true });
        this.#activateRequest(pending, tab.tab_id, true);
        this.#lastRecovery = {
          action: 'RESTART_TYPED_WAKE_SEND_RECOVERED', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
          proof: 'DURABLE_SINGLE_CONTINUATION_FENCE_THEN_POSITIVE_SEND_READBACK', confirmed: true, ambiguous: false,
          prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
        return true;
      }
      this.#lastRecovery = {
        action: 'RESTART_TYPED_WAKE_SEND_AMBIGUOUS', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'DURABLE_SINGLE_CONTINUATION_FENCE_BEFORE_CLICK', confirmed: false, ambiguous: true,
        prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
    return false;
  }

  async #observeSupervisor(tab, state) {
    const frame = await this.#capture(tab.tab_id);
    const live = tabLiveness(state, tab.tab_id);
    const row = this.#sessionMonitor.observe({ tab_id: tab.tab_id, frame, ...live });
    const previous = this.#lastSupervisorGeneration;
    this.#lastSupervisorGeneration = row.state;

    let keepalive = this.#keepalive.snapshot();
    if (keepalive.pending_wake?.ambiguous_at) {
      const recovered = await this.#recoverAmbiguousWakeFromFrame(tab, frame, row, keepalive);
      keepalive = this.#keepalive.snapshot();
      if (recovered) return { frame, row };
    }
    if (row.terminal_ready === true && keepalive.pending_wake?.ambiguous_at) {
      const retiredWakeId = String(keepalive.pending_wake.wake_id || '');
      await this.#keepalive.retireAmbiguousAfterTerminal({
        tab_id: tab.tab_id,
        generation_epoch: row.generation_epoch,
        reason: 'SUPERVISOR_TERMINAL_BOUNDARY_CONFIRMED',
      });
      this.#lastRecovery = {
        action: 'AMBIGUOUS_WAKE_RETIRED_AFTER_TERMINAL',
        wake_id: retiredWakeId,
        tab_id: String(tab.tab_id),
        generation_epoch: row.generation_epoch,
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
      keepalive = this.#keepalive.snapshot();
    }

    const activeRetirement = this.#activeRequest ? evaluateActiveWakeTerminalRetirement({
      active_request: this.#activeRequest,
      active_wake: keepalive.active_wake,
      terminal_row: row,
      previous_state: previous,
      observed_tab_id: tab.tab_id,
      keepalive_tab_id: this.#keepalive.snapshot().tab_id,
    }) : null;
    if (activeRetirement?.retire === true) {
      const request = this.#activeRequest;
      await this.#keepalive.markCycleComplete();
      this.#activeRequest = null;
      this.#lastRecovery = {
        action: 'ACTIVE_WAKE_RETIRED_AFTER_TERMINAL',
        reason: activeRetirement.reason,
        wake_id: activeRetirement.wake_id,
        prior_request_tab_id: request?.tab_id || null,
        tab_id: String(tab.tab_id),
        generation_epoch: row.generation_epoch,
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
    } else if (row.terminal_ready === true && this.#lastRecovery?.action === 'STOP_ORPHANED_GENERATION') {
      this.#lastRecovery = { ...this.#lastRecovery, confirmed: true, ambiguous: false, terminal_confirmed_at: new Date().toISOString() };
    }
    if (LIMIT_RE.test(String(frame?.text_excerpt || ''))) await this.#keepalive.requestRollover('CHATGPT_CONVERSATION_LIMIT_HINT');
    return { frame, row };
  }

  async #queueResearch() {
    const s = this.#keepalive.snapshot();
    const last = s.last_research_wake_at ? new Date(s.last_research_wake_at).getTime() : 0;
    if (!last || Date.now() - last >= this.#researchMs) await this.#keepalive.enqueueWake('RESEARCH_ACCELERATOR_DUE', { key: `epoch-${s.supervisor_epoch}` });
  }

  async #ensureContinuousWake() {
    const s = this.#keepalive.snapshot();
    if (s.paused || s.pending_wake || s.active_wake) return false;
    if (['WAKE_AMBIGUOUS','ROLLOVER_DEFERRED','ROLLOVER_REQUIRED','ROLLOVER_PENDING','ROLLOVER_AMBIGUOUS','RECOVERING'].includes(s.state)) return false;
    if ((s.queued_wakes || []).some((wake) => String(wake?.reason || '') === CONTINUOUS_WAKE_REASON)) return false;
    await this.#keepalive.enqueueWake(CONTINUOUS_WAKE_REASON, { key: `epoch-${s.supervisor_epoch}-cycle-${s.cycle_seq}` });
    return true;
  }

  async #typeAndSend(tabId, message, positiveMarker) {
    let clicked = false;
    const before = await this.#capture(tabId);
    if (generating(before)) return { ok: false, reason: 'GENERATION_STILL_ACTIVE', clicked: false };
    const box = unique(before, 'textbox');
    if (!box) throw new Error('supervisor_composer_not_unique');
    // Persisted wake intent already fences this logical effect. Submit through the
    // semantic command's CDP event latch so type + send has one physical boundary
    // and one positive readback path. Once submit dispatch starts, any exception is
    // conservatively ambiguous and must never fall through to a second click.
    clicked = true;
    const submitted = await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: {
        tab_id: tabId,
        role: 'textbox',
        accessible_name: box.name,
        semantic_ref: box.semantic_ref,
        text: message,
        replace_existing: true,
        submit_after_type: true,
      },
      platform: AGENT_PLATFORM_ID,
    });
    if (submitted?.suppressed === true) {
      const reason = String(submitted.reason || 'SEMANTIC_SUBMIT_SUPPRESSED');
      const preEffect = ['SEMANTIC_REF_REOBSERVE_REQUIRED','CHATGPT_SERVICE_THROTTLED'].includes(reason);
      return { ok: false, reason, clicked: !preEffect, event_driven_readback: true };
    }
    const submitState = String(submitted?.effect_state || '').toUpperCase();
    if (['PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_COMPOSER_CLEARED'].includes(submitState)) {
      // The GLM monitor's only authoritative GENERATING entry: the proven
      // Enter submit. Digest churn then tracks streaming; settle flips IDLE.
      this.#sessionMonitor.markGenerationStarted(tabId);
      return { ok: true, clicked: true, observed: submitted, event_driven_readback: true };
    }
    if (submitState) {
      const readback = await this.#observeSendReadback(tabId, positiveMarker);
      return readback.ok
        ? { ok: true, clicked: true, observed: readback.observed, event_driven_readback: true }
        : { ok: false, reason: 'SEND_WITHOUT_POSITIVE_READBACK', clicked: true, event_driven_readback: true };
    }

    // Compatibility only for injected/legacy executors that do not advertise a
    // submit effect state. Current Browser executors never take this branch.
    // GLM platform: there is no named SEND control — the compatibility path
    // re-submits through the same Enter lane using the live composer ref.
    const compatFrame = await this.#capture(tabId);
    const compatComposer = unique(compatFrame, 'textbox');
    if (!compatComposer?.semantic_ref) throw new Error('supervisor_composer_not_unique');
    await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: { tab_id: tabId, role: 'textbox', accessible_name: compatComposer.name, semantic_ref: compatComposer.semantic_ref, text: message, replace_existing: true, submit_after_type: true },
      platform: AGENT_PLATFORM_ID,
    });
    const readback = await this.#observeSendReadback(tabId, positiveMarker);
    return readback.ok ? { ok: true, clicked, observed: readback.observed } : { ok: false, reason: 'SEND_WITHOUT_POSITIVE_READBACK', clicked };
  }

  async #sendWake(prepared) {
    if (this.#canActuate() !== true) return false;
    let clicked = false;
    try {
      const sent = await this.#typeAndSend(prepared.tab_id, prepared.message, prepared.pending.wake_id);
      clicked = sent.clicked === true;
      if (sent.ok) {
        await this.#keepalive.confirmWakeSent(prepared.pending.wake_id);
        this.#activateRequest(prepared.pending, prepared.tab_id, false);
        return true;
      }
      await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, sent.reason || 'SEND_WITHOUT_POSITIVE_READBACK');
    } catch (e) {
      await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, clicked ? 'SEND_PATH_AMBIGUOUS' : 'NO_SEND_EFFECT').catch(() => {});
      if (!clicked) await this.#keepalive.resolveAmbiguous({ observed_sent: false }).catch(() => {});
      this.#lastError = String(e?.message || e).slice(0, 240);
    }
    return false;
  }

  async #waitForBootstrapRoot(tabId, attempts = 8) {
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await sleep(500);
      const frame = await this.#capture(tabId);
      if (CHAT_ROOT_RE.test(String(frame?.url || '')) && !generating(frame) && unique(frame, 'textbox')) {
        return { ok: true, frame };
      }
      if (CHAT_RE.test(String(frame?.url || ''))) return { ok: false, reason: 'BOOTSTRAP_ROOT_UNEXPECTED_CONVERSATION', frame };
    }
    return { ok: false, reason: 'BOOTSTRAP_ROOT_NOT_READY', frame: null };
  }

  async #bootstrapSupervisorConversation({ preferredExistingRootTabId = null } = {}) {
    if (this.#canActuate() !== true) return false;
    const before = this.#keepalive.snapshot();
    if (before.paused
      || before.state !== 'RECOVERING'
      || before.conversation_url
      || before.pending_wake
      || before.active_wake
      || !Array.isArray(before.queued_wakes)
      || before.queued_wakes.length === 0) return false;

    let prepared = null;
    try {
      // P0 (2026-09-17): close-by-proof sweep of tabs leaked by earlier failed
      // bootstrap attempts before creating anything new, so the retry loop is
      // tab-neutral no matter how long the user session stays logged out.
      if (this.#bootstrapLeakedTabIds.size > 0) await this.#sweepLeakedBootstrapTabs();
      const preferredId = String(preferredExistingRootTabId || '');
      let tab = null;
      let createdHere = false;
      if (preferredId) {
        const current = await this.#getState();
        const fleetTabs = new Set((current?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
        const scopedRoots = (current?.tabs || []).filter((candidate) => (
          String(candidate?.tab_id || '') === preferredId
          && !fleetTabs.has(String(candidate?.tab_id || ''))
          && CHAT_ROOT_RE.test(String(candidate?.url || ''))
        ));
        if (scopedRoots.length !== 1) {
          this.#lastError = 'supervisor_bootstrap_pre_effect:BOOTSTRAP_ROOT_AMBIGUOUS';
          return false;
        }
        tab = scopedRoots[0];
      } else {
        // Normal first bootstrap retains the dedicated-root invariant. Existing roots
        // are reusable only for the explicit process-boundary recovery path above.
        tab = await this.#execute({ action: 'NEW_TAB', payload: { url: AGENT_PLATFORM_HOME_URL, select: false }, platform: null });
        createdHere = true;
      }
      if (!tab?.tab_id) throw new Error('supervisor_bootstrap_tab_creation_no_readback');
      const ready = await this.#waitForBootstrapRoot(tab.tab_id);
      if (!ready.ok) {
        // Pre-effect failure (typ. auth redirect while logged out): the tab this
        // attempt created never became a usable root and was never bound, typed
        // into, or handed to the user. Close it by proof so retrying bootstrap
        // cannot amplify tab cardinality (7 -> 32 incident vector, intra-process leg).
        if (createdHere) await this.#closeFailedBootstrapTab(tab.tab_id);
        this.#lastError = `supervisor_bootstrap_pre_effect:${ready.reason}`;
        return false;
      }

      prepared = await this.#keepalive.prepareBootstrapWake();
      if (!prepared?.ok) return false;
      const sent = await this.#typeAndSend(tab.tab_id, prepared.message, prepared.pending.wake_id);
      if (!sent.ok) {
        if (sent.clicked === true) {
          await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, sent.reason || 'BOOTSTRAP_SEND_EFFECT_UNKNOWN');
          this.#lastRecovery = {
            action: 'SUPERVISOR_BOOTSTRAP_AMBIGUOUS', wake_id: prepared.pending.wake_id, tab_id: String(tab.tab_id),
            reason: sent.reason || 'BOOTSTRAP_SEND_EFFECT_UNKNOWN', confirmed: false, ambiguous: true,
            automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
          };
        } else {
          await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, sent.reason || 'BOOTSTRAP_PRE_EFFECT_ABORT');
          await this.#keepalive.resolveAmbiguous({ observed_sent: false });
          await this.#keepalive.resume();
        }
        return false;
      }

      let observed = sent.observed;
      if (!CHAT_RE.test(String(observed?.url || ''))) observed = await this.#capture(tab.tab_id);
      const url = String(observed?.url || '');
      const markerObserved = String(observed?.text_excerpt || '').includes(String(prepared.pending.wake_id));
      if (!CHAT_RE.test(url) || !(generating(observed) || markerObserved || sent.event_driven_readback === true)) {
        await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING');
        this.#lastRecovery = {
          action: 'SUPERVISOR_BOOTSTRAP_AMBIGUOUS', wake_id: prepared.pending.wake_id, tab_id: String(tab.tab_id),
          reason: 'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING', confirmed: false, ambiguous: true,
          automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
        return false;
      }

      await this.#keepalive.confirmWakeSent(prepared.pending.wake_id);
      await this.#keepalive.bindConversation({ url, tab_id: tab.tab_id });
      this.#activateRequest(prepared.pending, tab.tab_id, false);
      // A successful bind is the recovery boundary for every prior failed
      // attempt: stale supervisor_bootstrap* errors must not survive it, or the
      // state projection keeps reporting an incident that is already over.
      if (this.#lastError?.startsWith?.('supervisor_bootstrap')) this.#lastError = null;
      this.#lastRecovery = {
        action: 'SUPERVISOR_BOOTSTRAP_BOUND', wake_id: prepared.pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'DEDICATED_ROOT_TO_EXACT_CONVERSATION_POSITIVE_READBACK', confirmed: true, ambiguous: false,
        automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    } catch (e) {
      if (prepared?.pending?.wake_id) {
        await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'BOOTSTRAP_SEND_PATH_AMBIGUOUS').catch(() => {});
        this.#lastRecovery = {
          action: 'SUPERVISOR_BOOTSTRAP_AMBIGUOUS', wake_id: prepared.pending.wake_id, tab_id: null,
          reason: 'BOOTSTRAP_SEND_PATH_AMBIGUOUS', confirmed: false, ambiguous: true,
          automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
      }
      this.#lastError = `supervisor_bootstrap:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  // Close-by-proof for a tab created by a failed bootstrap pre-effect. The proof
  // obligations: (1) the tab_id was created by THIS runtime's NEW_TAB in the
  // failed attempt (caller passes it only for createdHere tabs); (2) the tab
  // still exists in the registry; (3) it is not currently selected and not
  // claimed by a fleet agent — a tab the user has taken over is never ours to
  // close, it simply leaves the leaked set as a bounded, user-owned exception.
  // CLOSE_TAB is best-effort: on failure the id stays in the in-memory ledger
  // and is retried before the next bootstrap attempt, so a transiently wedged
  // command plane cannot turn one leak into unbounded growth.
  async #closeFailedBootstrapTab(tabId) {
    const id = String(tabId || '');
    if (!id) return;
    try {
      const state = await this.#getState();
      const fleetTabs = new Set((state?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
      const row = (state?.tabs || []).find((t) => String(t?.tab_id || '') === id);
      if (!row) {
        this.#bootstrapLeakedTabIds.delete(id);
        return;
      }
      if (row.selected === true || fleetTabs.has(id)) {
        this.#bootstrapLeakedTabIds.delete(id);
        return;
      }
      await this.#execute({ action: 'CLOSE_TAB', payload: { tab_id: id }, platform: null });
      this.#bootstrapLeakedTabIds.delete(id);
    } catch {
      this.#bootstrapLeakedTabIds.add(id);
    }
  }

  async #sweepLeakedBootstrapTabs() {
    for (const tabId of Array.from(this.#bootstrapLeakedTabIds)) {
      await this.#closeFailedBootstrapTab(tabId);
    }
  }

  async #recoverProcessBoundaryBootstrapAmbiguity(state, keepalive) {
    const pending = keepalive?.pending_wake;
    if (keepalive?.state !== 'WAKE_AMBIGUOUS' || !pending?.ambiguous_at || keepalive?.conversation_url) return false;
    const pendingProcess = String(pending.process_incarnation_id || '');
    const currentProcess = String(keepalive.process_incarnation_id || '');
    const predecessorProcess = String(keepalive.predecessor_process_incarnation_id || '');
    if (!pendingProcess || !currentProcess || pendingProcess === currentProcess) return false;
    const immediatePredecessorFence = predecessorProcess === pendingProcess
      && Boolean(keepalive.predecessor_fenced_at);
    const durableWakeBoundaryFence = Boolean(pending.process_boundary_fenced_at)
      && pending.automatic_retry_allowed === false;
    if (!keepalive.predecessor_fenced_at || (!immediatePredecessorFence && !durableWakeBoundaryFence)) return false;

    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    const durableTabId = String(
      pending.ambiguity_continuation_tab_id
      || keepalive.tab_id
      || '',
    );
    if (durableTabId && tabs.some((tab) => String(tab?.tab_id || '') === durableTabId)) return false;

    const fleetTabs = new Set((state?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
    const roots = tabs.filter((tab) => (
      !fleetTabs.has(String(tab?.tab_id || ''))
      && CHAT_ROOT_RE.test(String(tab?.url || ''))
    ));
    if (roots.length !== 1 || this.#canActuate() !== true) return false;

    const root = roots[0];
    let frame;
    try { frame = await this.#capture(root.tab_id); } catch { return false; }
    if (!CHAT_ROOT_RE.test(String(frame?.url || root?.url || '')) || generating(frame)) return false;
    if (String(frame?.text_excerpt || '').includes(String(pending.wake_id || ''))) return false;
    const composer = unique(frame, 'textbox');
    if (!composer || Number(composer.value_length) !== 0) return false;
    const live = tabLiveness(state, root.tab_id);
    const row = this.#sessionMonitor.observe({ tab_id: root.tab_id, frame, ...live });
    if (row.terminal_ready !== true) return false;

    const retiredWakeId = String(pending.wake_id || '');
    await this.#keepalive.retireAmbiguousAfterProcessBoundary({
      reason: 'PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST',
      replacement_tab_id: root.tab_id,
    });
    this.#lastRecovery = {
      action: 'PROCESS_BOUNDARY_AMBIGUOUS_WAKE_RETIRED',
      wake_id: retiredWakeId,
      tab_id: String(root.tab_id),
      proof: 'DURABLE_PROCESS_BOUNDARY_FENCE_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT',
      confirmed: true,
      ambiguous: false,
      automatic_retry_allowed: false,
      at: new Date().toISOString(),
      authority_effect: false,
    };

    const bootstrapped = await this.#bootstrapSupervisorConversation({ preferredExistingRootTabId: root.tab_id });
    if (bootstrapped) {
      this.#lastRecovery = {
        action: 'PROCESS_BOUNDARY_BOOTSTRAP_RECOVERED',
        wake_id: this.#keepalive.activeWake()?.wake_id || null,
        retired_wake_id: retiredWakeId,
        tab_id: String(root.tab_id),
        proof: 'RETIRED_PREDECESSOR_THEN_REUSED_UNIQUE_EMPTY_ROOT',
        confirmed: true,
        ambiguous: false,
        automatic_retry_allowed: false,
        at: new Date().toISOString(),
        authority_effect: false,
      };
    }
    return true;
  }

  async #continueExisting(tabId, frame) {
    const button = uniqueChatGptControl(frame, 'CONTINUE');
    if (!button) return false;
    await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tabId, role: 'button', accessible_name: button.name, semantic_ref: button.semantic_ref }, platform: null });
    this.#sessionMonitor.markRecovery(tabId, 'CONTINUE_GENERATION');
    this.#lastRecovery = { action: 'CONTINUE_EXISTING', tab_id: String(tabId), at: new Date().toISOString(), authority_effect: false };
    return true;
  }

  async #stopAndRetrySameConversation(tabId, frame) {
    const req = this.#activeRequest;
    if (!req || req.blocked_ambiguous || String(req.tab_id) !== String(tabId)) return false;
    try {
      if (generating(frame)) {
        this.#sessionMonitor.markRecovery(tabId, 'STOP_GENERATION');
        await this.#execute({ action: 'STOP_GENERATION', payload: { tab_id: String(tabId) }, platform: null });
        for (let i = 0; i < 8; i += 1) {
          await sleep(500);
          if (!generating(await this.#capture(tabId))) break;
          if (i === 7) throw new Error('same_chat_stop_not_observed');
        }
      }
      const nextAttempt = req.retry_attempt + 1;
      const sent = await this.#typeAndSend(tabId, retryEnvelope(req.message, req.wake_id, nextAttempt), req.wake_id);
      req.retry_attempt = nextAttempt;
      req.same_chat_retry_attempt += 1;
      if (!sent.ok && sent.clicked) req.blocked_ambiguous = true;
      this.#lastRecovery = {
        action: 'STOP_AND_RETRY_SAME_CONVERSATION', tab_id: String(tabId), wake_id: req.wake_id, retry_attempt: req.retry_attempt,
        confirmed: sent.ok === true, ambiguous: sent.ok !== true && sent.clicked === true,
        at: new Date().toISOString(), authority_effect: false,
      };
      return sent.ok === true;
    } catch (e) {
      this.#lastError = `same_chat_retry:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  async #retryInNewConversation() {
    const req = this.#activeRequest;
    if (!req || req.blocked_ambiguous || this.#canActuate() !== true) return false;
    let tab = null;
    try {
      tab = await this.#execute({ action: 'NEW_TAB', payload: { url: AGENT_PLATFORM_HOME_URL, select: false }, platform: null });
      const nextAttempt = req.retry_attempt + 1;
      const sent = await this.#typeAndSend(tab.tab_id, retryEnvelope(req.message, req.wake_id, nextAttempt), req.wake_id);
      req.retry_attempt = nextAttempt;
      if (!sent.ok && sent.clicked) req.blocked_ambiguous = true;
      if (!sent.ok) return false;
      const observed = sent.observed || await this.#capture(tab.tab_id);
      const url = String(observed?.url || tab?.url || '');
      if (!CHAT_RE.test(url)) throw new Error('new_conversation_retry_binding_missing');
      await this.#keepalive.bindConversation({ url, tab_id: tab.tab_id });
      req.tab_id = String(tab.tab_id);
      this.#lastRecovery = {
        action: 'NEW_CONVERSATION_RETRY', tab_id: String(tab.tab_id), wake_id: req.wake_id, retry_attempt: req.retry_attempt,
        confirmed: true, ambiguous: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    } catch (e) {
      this.#lastError = `new_conversation_retry:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  async #recoverSupervisor(tab, frame, row) {
    if (this.#canActuate() !== true || !this.#activeRequest || this.#activeRequest.blocked_ambiguous) return false;
    if (row.state === 'INTERRUPTED' && row.controls?.continue === 1) return this.#continueExisting(tab.tab_id, frame);
    if (row.state !== 'STALLED') return false;
    const decision = classifyRetryDecision({
      effect_class: this.#activeRequest.effect_class,
      silence_age_ms: row.progress_age_ms,
      adaptive_timeout_ms: row.adaptive_hard_ms,
      retry_attempt: this.#activeRequest.retry_attempt,
      max_retry_attempts: 2,
      same_chat_retry_attempt: this.#activeRequest.same_chat_retry_attempt,
      max_same_chat_retry_attempts: 1,
      same_conversation_usable: true,
      network_active: row.network_active === true,
      external_progress: row.external_progress === true,
      request_accepted: true,
    });
    if (decision.action === 'STOP_AND_RETRY_SAME_CONVERSATION') return this.#stopAndRetrySameConversation(tab.tab_id, frame);
    if (decision.action === 'NEW_CONVERSATION_RETRY') return this.#retryInNewConversation();
    if (decision.action === 'ESCALATE') this.#lastRecovery = { action: 'ESCALATE', reason: decision.reason, wake_id: this.#activeRequest.wake_id, at: new Date().toISOString(), authority_effect: false };
    return false;
  }

  async #recoverOrphanedSupervisor(tab, frame, row) {
    if (this.#canActuate() !== true || row.state !== 'STALLED' || !generating(frame)) return false;
    const recovery = this.#sessionMonitor.nextRecovery(tab.tab_id);
    if (recovery.action !== 'STOP_GENERATION') return false;
    this.#sessionMonitor.markRecovery(tab.tab_id, 'STOP_GENERATION');
    const record = {
      action: 'STOP_ORPHANED_GENERATION', tab_id: String(tab.tab_id), generation_epoch: row.generation_epoch,
      confirmed: false, ambiguous: false, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    this.#lastRecovery = record;
    try {
      await this.#execute({ action: 'STOP_GENERATION', payload: { tab_id: String(tab.tab_id) }, platform: null });
      for (let i = 0; i < 8; i += 1) {
        await sleep(500);
        if (!generating(await this.#capture(tab.tab_id))) {
          this.#lastRecovery = { ...record, confirmed: true, observed_stopped_at: new Date().toISOString() };
          return true;
        }
      }
      this.#lastRecovery = { ...record, ambiguous: true, reason: 'STOP_WITHOUT_TERMINAL_READBACK' };
      return false;
    } catch (e) {
      this.#lastRecovery = { ...record, ambiguous: true, reason: 'STOP_TRANSPORT_AMBIGUOUS' };
      this.#lastError = `orphaned_stall_stop:${String(e?.message || e).slice(0, 200)}`;
      return false;
    }
  }

  #rolloverMessage(snapshot) {
    const attempt = snapshot?.rollover_attempt || null;
    return buildSupervisorRolloverMessage({
      previousUrl: attempt?.previous_conversation || snapshot?.conversation_url,
      supervisorEpoch: attempt?.supervisor_epoch ?? snapshot?.supervisor_epoch,
      rolloverAttemptId: attempt?.attempt_id || null,
    });
  }

  async #bindRecoveredRollover(tabId, frame) {
    const url = String(frame?.url || '');
    if (!CHAT_RE.test(url)) return false;
    await this.#keepalive.bindRollover({ url, tab_id: String(tabId) });
    this.#activeRequest = null;
    this.#lastRecovery = {
      action: 'AMBIGUOUS_ROLLOVER_POSITIVELY_REBOUND', tab_id: String(tabId),
      supervisor_epoch: this.#keepalive.snapshot().supervisor_epoch,
      confirmed: true, ambiguous: false, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    return true;
  }

  async #reconcileAmbiguousRollover(state) {
    const s = this.#keepalive.snapshot();
    const attempt = s.rollover_attempt;
    if (s.state !== 'ROLLOVER_AMBIGUOUS' || !attempt?.attempt_id) return false;
    const message = this.#rolloverMessage(s);
    const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => String(a?.tab_id || '')).filter(Boolean));
    const candidates = (state?.tabs || []).filter((tab) => !fleetTabs.has(String(tab?.tab_id || '')) && String(tab?.tab_id || '') !== String(s.tab_id || ''));
    const ordered = [...candidates].sort((a, b) => Number(String(b?.tab_id || '') === String(attempt.tab_id || '')) - Number(String(a?.tab_id || '') === String(attempt.tab_id || '')));
    const composerMatchesRows = [];
    for (const tab of ordered) {
      let frame;
      try { frame = await this.#capture(tab.tab_id); } catch { continue; }
      const marker = String(frame?.text_excerpt || '').includes(String(attempt.attempt_id));
      if (CHAT_RE.test(String(frame?.url || '')) && marker) return this.#bindRecoveredRollover(tab.tab_id, frame);
      if ((CHAT_ROOT_RE.test(String(frame?.url || '')) || CHAT_RE.test(String(frame?.url || ''))) && composerMatches(frame, message)) composerMatchesRows.push({ tab, frame });
    }
    if (composerMatchesRows.length !== 1 || this.#canActuate() !== true) return false;
    const { tab, frame } = composerMatchesRows[0];
    if (!attempt.tab_id) await this.#keepalive.bindRolloverAttemptTab(tab.tab_id).catch(() => {});
    // GLM platform: composer sha256 match proves the typed rollover message
    // never submitted; re-submit through the Enter lane (no named SEND).
    const rolloverComposer = unique(frame, 'textbox');
    if (!rolloverComposer?.semantic_ref) return false;
    await this.#execute({
      action: 'SEMANTIC_TYPE',
      payload: { tab_id: String(tab.tab_id), role: 'textbox', accessible_name: rolloverComposer.name, semantic_ref: rolloverComposer.semantic_ref, text: message, replace_existing: true, submit_after_type: true },
      platform: AGENT_PLATFORM_ID,
    });
    const readback = await this.#observeSendReadback(tab.tab_id, attempt.attempt_id);
    if (readback.ok) return this.#bindRecoveredRollover(tab.tab_id, readback.observed);
    this.#lastRecovery = {
      action: 'RESTART_TYPED_ROLLOVER_SEND_AMBIGUOUS', tab_id: String(tab.tab_id), rollover_attempt_id: attempt.attempt_id,
      proof: 'EXACT_COMPOSER_SHA256_BEFORE_SINGLE_CLICK', prompt_retyped: false,
      confirmed: false, ambiguous: true, automatic_retry_allowed: false,
      at: new Date().toISOString(), authority_effect: false,
    };
    return true;
  }

  async #rollover() {
    if (this.#canActuate() !== true) return false;
    const before = this.#keepalive.snapshot();
    let tab = null;
    let attempt = null;
    try {
      attempt = await this.#keepalive.beginRolloverAttempt();
      const message = buildSupervisorRolloverMessage({
        previousUrl: before.conversation_url,
        supervisorEpoch: before.supervisor_epoch,
        rolloverAttemptId: attempt.attempt_id,
      });
      tab = await this.#execute({ action: 'NEW_TAB', payload: { url: AGENT_PLATFORM_HOME_URL, select: false }, platform: null });
      if (!tab?.tab_id) throw new Error('rollover_tab_creation_no_readback');
      await this.#keepalive.bindRolloverAttemptTab(tab.tab_id);
      const sent = await this.#typeAndSend(tab.tab_id, message, attempt.attempt_id);
      if (!sent.ok) {
        await this.#keepalive.markRolloverAmbiguous(sent.reason || 'ROLLOVER_WITHOUT_POSITIVE_READBACK');
        return false;
      }
      const observed = sent.observed || await this.#capture(tab.tab_id);
      const markerObserved = String(observed?.text_excerpt || '').includes(String(attempt.attempt_id));
      if (CHAT_RE.test(String(observed?.url || '')) && (generating(observed) || markerObserved)) {
        await this.#keepalive.bindRollover({ url: observed.url, tab_id: tab.tab_id });
        this.#activeRequest = null;
        this.#lastRecovery = {
          action: 'SUPERVISOR_ROLLOVER_BOUND', tab_id: String(tab.tab_id),
          supervisor_epoch: this.#keepalive.snapshot().supervisor_epoch,
          rollover_attempt_id: attempt.attempt_id, confirmed: true, ambiguous: false,
          at: new Date().toISOString(), authority_effect: false,
        };
        return true;
      }
      await this.#keepalive.markRolloverAmbiguous('ROLLOVER_WITHOUT_POSITIVE_READBACK');
    } catch (e) {
      if (attempt) await this.#keepalive.markRolloverAmbiguous(`ROLLOVER_ERROR:${String(e?.message || e)}`).catch(() => {});
      this.#lastError = String(e?.message || e).slice(0, 240);
    }
    return false;
  }

  async cycle({ force = false } = {}) {
    if (!this.#keepalive) return this.snapshot();
    const now = Date.now();
    if (!force && now - this.#lastRun < this.#monitorMs) return this.snapshot();
    this.#lastRun = now;
    try {
      if (this.#requireAuthoritativeAdmission && this.#runtimeControl.authoritative !== true) return this.snapshot();
      const admissionOpen = !this.#requireAuthoritativeAdmission
        || devosRuntimeControlAllowsContinuousService(this.#runtimeControl);
      if (!admissionOpen) {
        const keepalive = this.#keepalive.snapshot();
        const unresolved = keepalive.pending_wake
          || keepalive.active_wake
          || ['ROLLOVER_PENDING','ROLLOVER_AMBIGUOUS'].includes(keepalive.state);
        if (!unresolved || !keepalive.conversation_url) return this.snapshot();
      }
      let state = await this.#getState();
      await this.#observeWorkers(state);
      if (admissionOpen) await this.#queueResearch();
      if (this.#keepalive.snapshot().state === 'ROLLOVER_AMBIGUOUS') {
        const reconciled = await this.#reconcileAmbiguousRollover(state);
        if (reconciled && this.#keepalive.snapshot().state !== 'ROLLOVER_AMBIGUOUS') state = await this.#getState();
      }
      let keepalive = this.#keepalive.snapshot();
      if (keepalive.state === 'WAKE_AMBIGUOUS'
        && keepalive.pending_wake?.ambiguous_at
        && !keepalive.conversation_url) {
        const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => a?.tab_id).filter(Boolean).map(String));
        const bootstrapCandidates = (state?.tabs || []).filter((tab) => {
          if (fleetTabs.has(String(tab?.tab_id || ''))) return false;
          const url = String(tab?.url || '');
          return CHAT_ROOT_RE.test(url) || CHAT_RE.test(url);
        });
        const durableTabId = String(
          keepalive.pending_wake?.ambiguity_continuation_tab_id
          || keepalive.tab_id
          || '',
        );
        const scopedCandidates = durableTabId
          ? bootstrapCandidates.filter((tab) => String(tab?.tab_id || '') === durableTabId)
          : bootstrapCandidates;

        if (scopedCandidates.length === 1) {
          const bootstrapTab = scopedCandidates[0];
          try {
            const frame = await this.#capture(bootstrapTab.tab_id);
            const frameUrl = String(frame?.url || bootstrapTab?.url || '');
            if (CHAT_ROOT_RE.test(frameUrl) || CHAT_RE.test(frameUrl)) {
              const live = tabLiveness(state, bootstrapTab.tab_id);
              const row = this.#sessionMonitor.observe({ tab_id: bootstrapTab.tab_id, frame, ...live });
              this.#lastSupervisorGeneration = row.state;
              await this.#recoverAmbiguousWakeFromFrame(bootstrapTab, frame, row, keepalive);
              keepalive = this.#keepalive.snapshot();
              if (keepalive.state !== 'WAKE_AMBIGUOUS' && keepalive.active_wake) {
                let reboundFrame = frame;
                if (!CHAT_RE.test(String(reboundFrame?.url || ''))) {
                  try { reboundFrame = await this.#capture(bootstrapTab.tab_id); } catch {}
                }
                const reboundUrl = String(reboundFrame?.url || '');
                if (CHAT_RE.test(reboundUrl)) {
                  await this.#keepalive.bindConversation({ url: reboundUrl, tab_id: bootstrapTab.tab_id });
                  keepalive = this.#keepalive.snapshot();
                }
              }
            }
          } catch (e) {
            this.#lastError = `bootstrap_ambiguous_reconcile:${String(e?.message || e).slice(0, 200)}`;
          }
        }

        keepalive = this.#keepalive.snapshot();
        if (keepalive.state === 'WAKE_AMBIGUOUS') {
          const processBoundaryHandled = await this.#recoverProcessBoundaryBootstrapAmbiguity(state, keepalive);
          keepalive = this.#keepalive.snapshot();
          if (keepalive.state === 'WAKE_AMBIGUOUS') return this.snapshot();
          if (processBoundaryHandled && !keepalive.conversation_url) return this.snapshot();
        }
        if (keepalive.active_wake && !keepalive.conversation_url) return this.snapshot();
        state = await this.#getState();
      }
      let supervisor = await this.#supervisorTab(state);
      if (!supervisor && admissionOpen && this.#canActuate() === true) {
        const bootstrapped = await this.#bootstrapSupervisorConversation();
        if (bootstrapped) {
          state = await this.#getState();
          supervisor = await this.#supervisorTab(state);
        }
      }
      if (supervisor) {
        const observed = await this.#observeSupervisor(supervisor, state);
        if (this.#canActuate() === true) {
          const ks = this.#keepalive.snapshot();
          if (ks.state === 'ROLLOVER_REQUIRED') await this.#rollover();
          else if (['STALLED','INTERRUPTED'].includes(observed.row.state)) {
            if (this.#activeRequest && this.#activeRequest.blocked_ambiguous !== true) await this.#recoverSupervisor(supervisor, observed.frame, observed.row);
            else if (observed.row.state === 'STALLED') await this.#recoverOrphanedSupervisor(supervisor, observed.frame, observed.row);
          } else if (observed.row.terminal_ready === true) {
            await this.#ensureContinuousWake();
            const prepared = await this.#keepalive.prepareNextWake();
            if (prepared?.ok) await this.#sendWake(prepared);
          }
        }
      }
      if (!this.#lastError?.startsWith('same_chat_retry:') && !this.#lastError?.startsWith('new_conversation_retry:') && !this.#lastError?.startsWith('orphaned_stall_stop:') && !this.#lastError?.startsWith('supervisor_bootstrap:') && !this.#lastError?.startsWith('supervisor_bootstrap_pre_effect:')) this.#lastError = null;
    } catch (e) { this.#lastError = String(e?.message || e).slice(0, 240); }
    return this.snapshot();
  }
}
