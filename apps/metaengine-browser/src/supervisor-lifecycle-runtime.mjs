import fs from 'node:fs/promises';
import path from 'node:path';
import { ChatGptSessionMonitor } from './chatgpt-session-monitor.mjs';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { classifyRetryDecision, REQUEST_EFFECT_CLASS } from './chatgpt-retry-policy.mjs';
import { SupervisorKeepalive, buildSupervisorRolloverMessage, buildSupervisorWakeMessage } from './supervisor-keepalive.mjs';

const CHAT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/c\/[a-z0-9-]+/i;
const LIMIT_RE = /(maximum conversation length|conversation is too long|start a new chat|диалог.{0,20}слишком длин|начните новый чат)/i;
const CONTINUOUS_WAKE_REASON = 'CONTINUE_DEVELOPMENT';
const AUTO_ROLLOVER_CYCLES = 24;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function generating(frame) {
  return Boolean(frame?.semantic_targets?.some((x) => x?.role === 'button' && chatGptControlMatches('STOP', x?.name)));
}
function unique(frame, role) {
  const rows = (frame?.semantic_targets || []).filter((x) => x?.role === role);
  return rows.length === 1 ? rows[0] : null;
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

  constructor({ getState, executeCommand, canActuate = () => true, statePath = null, monitorMs = 2000, researchMs = 30 * 60 * 1000, sessionMonitor = null } = {}) {
    if (typeof getState !== 'function' || typeof executeCommand !== 'function' || typeof canActuate !== 'function') throw new Error('supervisor_lifecycle_dependencies_required');
    this.#getState = getState; this.#execute = executeCommand; this.#canActuate = canActuate; this.#statePath = statePath;
    this.#monitorMs = Math.max(1000, Number(monitorMs) || 2000);
    this.#researchMs = Math.max(5 * 60 * 1000, Number(researchMs) || 30 * 60 * 1000);
    this.#sessionMonitor = sessionMonitor || new ChatGptSessionMonitor();
  }

  async start() {
    if (!this.#statePath) {
      const { app } = await import('electron');
      this.#statePath = path.join(app.getPath('userData'), 'metaengine-supervisor-keepalive-v1.json');
    }
    this.#keepalive = new SupervisorKeepalive({
      loadState: () => readJson(this.#statePath),
      saveState: (v) => writeJson(this.#statePath, v),
      maxCyclesPerEpoch: AUTO_ROLLOVER_CYCLES,
    });
    await this.#keepalive.init();
    const active = this.#keepalive.activeWake();
    if (active) {
      this.#activeRequest = {
        wake_id: active.wake_id,
        tab_id: String(this.#keepalive.snapshot().tab_id || ''),
        message: buildSupervisorWakeMessage({
          supervisorEpoch: active.supervisor_epoch,
          cycleSeq: active.cycle_seq,
          wakeId: active.wake_id,
          reason: active.reason,
        }),
        retry_attempt: 0,
        same_chat_retry_attempt: 0,
        blocked_ambiguous: false,
        effect_class: REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE,
        restored_from_durable_keepalive: true,
      };
    }
    await this.cycle({ force: true });
    return this.snapshot();
  }

  snapshot() {
    return {
      schema: 'metaengine.supervisor-lifecycle-runtime.v3',
      keepalive: this.#keepalive?.snapshot() || null,
      supervisor_generation: this.#lastSupervisorGeneration,
      supervisor_session: this.#sessionMonitor?.snapshot() || null,
      continuous_service: {
        enabled: true,
        monitor_ms: this.#monitorMs,
        auto_rollover_cycles: AUTO_ROLLOVER_CYCLES,
        terminal_requires_user_message: false,
        restart_resumable: true,
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
      actuation_enabled: this.#canActuate() === true,
      last_error: this.#lastError,
      authority_effect: false,
    };
  }

  isQuiescent() {
    const ks = this.#keepalive?.snapshot();
    if (!ks || this.#lastSupervisorGeneration !== 'IDLE') return false;
    if (this.#activeRequest || this.#lastRecovery?.ambiguous === true) return false;
    if (ks.pending_wake) return false;
    const blockingQueued = (ks.queued_wakes || []).filter((wake) => String(wake?.reason || '') !== CONTINUOUS_WAKE_REASON);
    if (blockingQueued.length > 0) return false;
    if (['WAKE_PENDING','WAKE_AMBIGUOUS','ROLLOVER_REQUIRED','ROLLOVER_AMBIGUOUS','RECOVERING','ACTIVE'].includes(ks.state)) return false;
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

  async #observeSupervisor(tab, state) {
    const frame = await this.#capture(tab.tab_id);
    const live = tabLiveness(state, tab.tab_id);
    const row = this.#sessionMonitor.observe({ tab_id: tab.tab_id, frame, ...live });
    const previous = this.#lastSupervisorGeneration;
    this.#lastSupervisorGeneration = row.state;
    if (this.#activeRequest && row.terminal_ready === true && previous !== 'IDLE') {
      await this.#keepalive.markCycleComplete();
      this.#activeRequest = null;
      this.#lastRecovery = null;
    }
    // Page/model text is only a non-authoritative hint. It may defer the current
    // conversation but never auto-authorizes a new supervisor conversation.
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
    if (['WAKE_AMBIGUOUS','ROLLOVER_DEFERRED','ROLLOVER_REQUIRED','ROLLOVER_AMBIGUOUS','RECOVERING'].includes(s.state)) return false;
    if ((s.queued_wakes || []).some((wake) => String(wake?.reason || '') === CONTINUOUS_WAKE_REASON)) return false;
    await this.#keepalive.enqueueWake(CONTINUOUS_WAKE_REASON, { key: `epoch-${s.supervisor_epoch}-cycle-${s.cycle_seq}` });
    return true;
  }

  async #autoReleaseDeterministicRollover() {
    const s = this.#keepalive.snapshot();
    if (s.state !== 'ROLLOVER_DEFERRED') return false;
    const reason = String(s.rollover_reason || '');
    if (!reason.startsWith('MAX_CYCLES_PER_EPOCH')) return false;
    await this.#keepalive.approveRollover('TRUSTED_CONTINUOUS_SERVICE');
    return true;
  }

  async #typeAndSend(tabId, message, positiveMarker) {
    let clicked = false;
    const before = await this.#capture(tabId);
    if (generating(before)) return { ok: false, reason: 'GENERATION_STILL_ACTIVE', clicked: false };
    const box = unique(before, 'textbox');
    if (!box) throw new Error('supervisor_composer_not_unique');
    await this.#execute({ action: 'SEMANTIC_TYPE', payload: { tab_id: tabId, role: 'textbox', accessible_name: box.name, text: message, replace_existing: true }, platform: null });
    const send = uniqueChatGptControl(await this.#capture(tabId), 'SEND');
    if (!send) throw new Error('supervisor_send_not_unique');
    clicked = true;
    await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tabId, role: 'button', accessible_name: send.name }, platform: null });
    for (let i = 0; i < 6; i += 1) {
      await sleep(700);
      const observed = await this.#capture(tabId);
      if (generating(observed) || (positiveMarker && String(observed?.text_excerpt || '').includes(positiveMarker))) return { ok: true, clicked, observed };
    }
    return { ok: false, reason: 'SEND_WITHOUT_POSITIVE_READBACK', clicked };
  }

  async #sendWake(prepared) {
    if (this.#canActuate() !== true) return false;
    let clicked = false;
    try {
      const sent = await this.#typeAndSend(prepared.tab_id, prepared.message, prepared.pending.wake_id);
      clicked = sent.clicked === true;
      if (sent.ok) {
        await this.#keepalive.confirmWakeSent(prepared.pending.wake_id);
        this.#activeRequest = {
          wake_id: prepared.pending.wake_id,
          tab_id: String(prepared.tab_id),
          message: prepared.message,
          retry_attempt: 0,
          same_chat_retry_attempt: 0,
          blocked_ambiguous: false,
          effect_class: REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE,
          restored_from_durable_keepalive: false,
        };
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

  async #continueExisting(tabId, frame) {
    const button = uniqueChatGptControl(frame, 'CONTINUE');
    if (!button) return false;
    await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tabId, role: 'button', accessible_name: button.name }, platform: null });
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
        action: 'STOP_AND_RETRY_SAME_CONVERSATION',
        tab_id: String(tabId),
        wake_id: req.wake_id,
        retry_attempt: req.retry_attempt,
        confirmed: sent.ok === true,
        ambiguous: sent.ok !== true && sent.clicked === true,
        at: new Date().toISOString(),
        authority_effect: false,
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
      tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
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
        action: 'NEW_CONVERSATION_RETRY',
        tab_id: String(tab.tab_id),
        wake_id: req.wake_id,
        retry_attempt: req.retry_attempt,
        confirmed: true,
        ambiguous: false,
        at: new Date().toISOString(),
        authority_effect: false,
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
    if (decision.action === 'ESCALATE') {
      this.#lastRecovery = { action: 'ESCALATE', reason: decision.reason, wake_id: this.#activeRequest.wake_id, at: new Date().toISOString(), authority_effect: false };
    }
    return false;
  }

  async #rollover() {
    if (this.#canActuate() !== true) return false;
    const s = this.#keepalive.snapshot();
    let tab = null;
    try {
      tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
      const sent = await this.#typeAndSend(tab.tab_id, buildSupervisorRolloverMessage({ previousUrl: s.conversation_url, supervisorEpoch: s.supervisor_epoch }), null);
      if (!sent.ok) {
        await this.#keepalive.markRolloverAmbiguous(sent.reason || 'ROLLOVER_WITHOUT_POSITIVE_READBACK');
        return false;
      }
      const observed = sent.observed || await this.#capture(tab.tab_id);
      if (CHAT_RE.test(String(observed?.url || '')) && generating(observed)) {
        await this.#keepalive.bindRollover({ url: observed.url, tab_id: tab.tab_id });
        this.#activeRequest = null;
        this.#lastRecovery = {
          action: 'SUPERVISOR_ROLLOVER_BOUND',
          tab_id: String(tab.tab_id),
          supervisor_epoch: this.#keepalive.snapshot().supervisor_epoch,
          confirmed: true,
          ambiguous: false,
          at: new Date().toISOString(),
          authority_effect: false,
        };
        return true;
      }
      await this.#keepalive.markRolloverAmbiguous('ROLLOVER_WITHOUT_POSITIVE_READBACK');
    } catch (e) {
      if (tab) await this.#keepalive.markRolloverAmbiguous(`ROLLOVER_ERROR:${String(e?.message || e)}`).catch(() => {});
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
      const state = await this.#getState();
      const supervisor = await this.#supervisorTab(state);
      await this.#observeWorkers(state);
      await this.#queueResearch();
      if (supervisor) {
        const observed = await this.#observeSupervisor(supervisor, state);
        if (this.#canActuate() === true) {
          let ks = this.#keepalive.snapshot();
          if (ks.state === 'ROLLOVER_DEFERRED') {
            await this.#autoReleaseDeterministicRollover();
            ks = this.#keepalive.snapshot();
          }
          if (ks.state === 'ROLLOVER_REQUIRED') await this.#rollover();
          else if (this.#activeRequest && ['STALLED','INTERRUPTED'].includes(observed.row.state)) await this.#recoverSupervisor(supervisor, observed.frame, observed.row);
          else if (observed.row.terminal_ready === true) {
            await this.#ensureContinuousWake();
            const prepared = await this.#keepalive.prepareNextWake();
            if (prepared?.rollover_deferred) {
              if (await this.#autoReleaseDeterministicRollover()) await this.#rollover();
            } else if (prepared?.ok) await this.#sendWake(prepared);
          }
        }
      }
      if (!this.#lastError?.startsWith('same_chat_retry:') && !this.#lastError?.startsWith('new_conversation_retry:')) this.#lastError = null;
    } catch (e) { this.#lastError = String(e?.message || e).slice(0, 240); }
    return this.snapshot();
  }
}
