import fs from 'node:fs/promises';
import path from 'node:path';
import { SupervisorKeepalive, buildSupervisorRolloverMessage } from './supervisor-keepalive.mjs';

const CHAT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/c\/[a-z0-9-]+/i;
const STOP_RE = /^(stop|stop generating|остановить|остановить создание)$/i;
const SEND_RE = /^(send|send prompt|отправить|отправить промпт)$/i;
const LIMIT_RE = /(maximum conversation length|conversation is too long|start a new chat|диалог.{0,20}слишком длин|начните новый чат)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function generating(frame) {
  return Boolean(frame?.semantic_targets?.some((x) => x?.role === 'button' && STOP_RE.test(String(x?.name || ''))));
}
function unique(frame, role, matcher = null) {
  const rows = (frame?.semantic_targets || []).filter((x) => x?.role === role && (!matcher || matcher.test(String(x?.name || ''))));
  return rows.length === 1 ? rows[0] : null;
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
  #lastWorkerSignals = []; #monitorMs; #researchMs;

  constructor({ getState, executeCommand, canActuate = () => true, statePath = null, monitorMs = 15000, researchMs = 30 * 60 * 1000 } = {}) {
    if (typeof getState !== 'function' || typeof executeCommand !== 'function' || typeof canActuate !== 'function') throw new Error('supervisor_lifecycle_dependencies_required');
    this.#getState = getState; this.#execute = executeCommand; this.#canActuate = canActuate; this.#statePath = statePath;
    this.#monitorMs = Math.max(5000, Number(monitorMs) || 15000);
    this.#researchMs = Math.max(5 * 60 * 1000, Number(researchMs) || 30 * 60 * 1000);
  }

  async start() {
    if (!this.#statePath) {
      const { app } = await import('electron');
      this.#statePath = path.join(app.getPath('userData'), 'metaengine-supervisor-keepalive-v1.json');
    }
    this.#keepalive = new SupervisorKeepalive({ loadState: () => readJson(this.#statePath), saveState: (v) => writeJson(this.#statePath, v) });
    await this.#keepalive.init();
    await this.cycle({ force: true });
    return this.snapshot();
  }

  snapshot() {
    return {
      schema: 'metaengine.supervisor-lifecycle-runtime.v1',
      keepalive: this.#keepalive?.snapshot() || null,
      supervisor_generation: this.#lastSupervisorGeneration,
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
    if (['WAKE_PENDING','WAKE_AMBIGUOUS','ROLLOVER_REQUIRED','ROLLOVER_AMBIGUOUS','RECOVERING'].includes(ks.state)) return false;
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

  async #observeSupervisor(tab) {
    const frame = await this.#capture(tab.tab_id);
    const state = generating(frame) ? 'GENERATING' : 'IDLE';
    if (this.#lastSupervisorGeneration === 'GENERATING' && state === 'IDLE') await this.#keepalive.markCycleComplete();
    this.#lastSupervisorGeneration = state;
    if (LIMIT_RE.test(String(frame?.text_excerpt || ''))) await this.#keepalive.requestRollover('CHATGPT_CONVERSATION_LIMIT_SIGNAL');
    return frame;
  }

  async #queueResearch() {
    const s = this.#keepalive.snapshot();
    const last = s.last_research_wake_at ? new Date(s.last_research_wake_at).getTime() : 0;
    if (!last || Date.now() - last >= this.#researchMs) await this.#keepalive.enqueueWake('RESEARCH_ACCELERATOR_DUE', { key: `epoch-${s.supervisor_epoch}` });
  }

  async #sendWake(prepared) {
    if (this.#canActuate() !== true) return false;
    let clicked = false;
    try {
      const before = await this.#capture(prepared.tab_id);
      if (generating(before)) return false;
      const box = unique(before, 'textbox');
      if (!box) throw new Error('supervisor_composer_not_unique');
      await this.#execute({ action: 'SEMANTIC_TYPE', payload: { tab_id: prepared.tab_id, role: 'textbox', accessible_name: box.name, text: prepared.message, replace_existing: true }, platform: null });
      const send = unique(await this.#capture(prepared.tab_id), 'button', SEND_RE);
      if (!send) throw new Error('supervisor_send_not_unique');
      clicked = true;
      await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: prepared.tab_id, role: 'button', accessible_name: send.name }, platform: null });
      for (let i = 0; i < 5; i += 1) {
        await sleep(700);
        const observed = await this.#capture(prepared.tab_id);
        if (generating(observed) || String(observed?.text_excerpt || '').includes(prepared.pending.wake_id)) {
          await this.#keepalive.confirmWakeSent(prepared.pending.wake_id); return true;
        }
      }
      await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'SEND_WITHOUT_POSITIVE_READBACK');
    } catch (e) {
      await this.#keepalive.markWakeAmbiguous(prepared.pending.wake_id, clicked ? 'SEND_PATH_AMBIGUOUS' : 'NO_SEND_EFFECT').catch(() => {});
      if (!clicked) await this.#keepalive.resolveAmbiguous({ observed_sent: false }).catch(() => {});
      this.#lastError = String(e?.message || e).slice(0, 240);
    }
    return false;
  }

  async #rollover() {
    if (this.#canActuate() !== true) return false;
    const s = this.#keepalive.snapshot();
    let tab = null;
    try {
      tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
      const before = await this.#capture(tab.tab_id);
      const box = unique(before, 'textbox');
      if (!box) throw new Error('rollover_composer_not_unique');
      await this.#execute({ action: 'SEMANTIC_TYPE', payload: { tab_id: tab.tab_id, role: 'textbox', accessible_name: box.name, text: buildSupervisorRolloverMessage({ previousUrl: s.conversation_url, supervisorEpoch: s.supervisor_epoch }), replace_existing: true }, platform: null });
      const send = unique(await this.#capture(tab.tab_id), 'button', SEND_RE);
      if (!send) throw new Error('rollover_send_not_unique');
      await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tab.tab_id, role: 'button', accessible_name: send.name }, platform: null });
      for (let i = 0; i < 8; i += 1) {
        await sleep(750);
        const observed = await this.#capture(tab.tab_id);
        if (CHAT_RE.test(String(observed?.url || '')) && generating(observed)) { await this.#keepalive.bindRollover({ url: observed.url, tab_id: tab.tab_id }); return true; }
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
        const frame = await this.#observeSupervisor(supervisor);
        if (this.#canActuate() === true) {
          const ks = this.#keepalive.snapshot();
          if (ks.state === 'ROLLOVER_REQUIRED') await this.#rollover();
          else if (!generating(frame)) {
            const prepared = await this.#keepalive.prepareNextWake();
            if (prepared?.rollover_required) await this.#rollover();
            else if (prepared?.ok) await this.#sendWake(prepared);
          }
        }
      }
      this.#lastError = null;
    } catch (e) { this.#lastError = String(e?.message || e).slice(0, 240); }
    return this.snapshot();
  }
}
