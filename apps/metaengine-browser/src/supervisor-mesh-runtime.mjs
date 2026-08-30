import fs from 'node:fs/promises';
import path from 'node:path';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { SupervisorMesh } from './supervisor-mesh.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function generating(frame) {
  return Boolean(frame?.semantic_targets?.some((row) => row?.role === 'button' && chatGptControlMatches('STOP', row?.name)));
}

function uniqueTextbox(frame) {
  const rows = (frame?.semantic_targets || []).filter((row) => row?.role === 'textbox');
  return rows.length === 1 ? rows[0] : null;
}

export class SupervisorMeshRuntime {
  #getState; #execute; #canActuate; #primaryLifecycle; #mesh = null; #statePath; #running = false;
  #lastError = null; #lastReconcileAt = null; #lastDelivery = null; #clock; #uuid; #maxSupervisors;

  constructor({
    getState,
    executeCommand,
    canActuate = () => true,
    primaryLifecycle = () => null,
    statePath = null,
    maxSupervisors = 16,
    clock = () => Date.now(),
    uuid = undefined,
  } = {}) {
    if (typeof getState !== 'function' || typeof executeCommand !== 'function') throw new Error('supervisor_mesh_runtime_dependencies_required');
    if (typeof canActuate !== 'function' || typeof primaryLifecycle !== 'function') throw new Error('supervisor_mesh_runtime_policy_required');
    this.#getState = getState;
    this.#execute = executeCommand;
    this.#canActuate = canActuate;
    this.#primaryLifecycle = primaryLifecycle;
    this.#statePath = statePath;
    this.#clock = clock;
    this.#uuid = uuid;
    this.#maxSupervisors = maxSupervisors;
  }

  async start() {
    if (this.#running) return this.snapshot();
    if (!this.#statePath) {
      const { app } = await import('electron');
      this.#statePath = path.join(app.getPath('userData'), 'metaengine-supervisor-mesh-v2.json');
    }
    this.#mesh = new SupervisorMesh({
      loadState: () => readJson(this.#statePath),
      saveState: (value) => writeJson(this.#statePath, value),
      clock: this.#clock,
      maxSupervisors: this.#maxSupervisors,
      ...(this.#uuid ? { uuid: this.#uuid } : {}),
    });
    await this.#mesh.init();
    this.#running = true;
    await this.reconcile();
    return this.snapshot();
  }

  stop() { this.#running = false; return this.snapshot(); }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.supervisor-mesh-runtime.v2',
      running: this.#running,
      last_reconcile_at: this.#lastReconcileAt,
      last_error: this.#lastError,
      last_delivery: this.#lastDelivery ? structuredClone(this.#lastDelivery) : null,
      mesh: this.#mesh?.snapshot() || null,
      continuous_failover_enabled: true,
      same_event_failover_retry: false,
      authority_effect: false,
    });
  }

  coordinator() { return this.#mesh?.coordinator() || null; }

  async reconcile(stateOverride = undefined) {
    if (!this.#running || !this.#mesh) return this.snapshot();
    try {
      const state = stateOverride ?? await this.#getState();
      await this.#mesh.reconcile({
        tabs: Array.isArray(state?.tabs) ? state.tabs : [],
        fleetAgents: Array.isArray(state?.fleet?.agents) ? state.fleet.agents : [],
      });
      this.#lastReconcileAt = new Date(this.#clock()).toISOString();
      this.#lastError = null;
    } catch (error) { this.#lastError = String(error?.message || error).slice(0, 300); }
    return this.snapshot();
  }

  async #capture(tabId) {
    return this.#execute({ action: 'CAPTURE', payload: { tab_id: String(tabId) }, platform: 'CHATGPT' });
  }

  async #send(delivery) {
    const tabId = String(delivery?.tab_id || '');
    if (!tabId) throw new Error('supervisor_mesh_delivery_tab_missing');
    let clicked = false;
    try {
      const before = await this.#capture(tabId);
      if (generating(before)) return { ok: false, busy: true, clicked: false, reason: 'TARGET_GENERATING' };
      const textbox = uniqueTextbox(before);
      if (!textbox) throw new Error('supervisor_mesh_composer_not_unique');
      await this.#execute({
        action: 'SEMANTIC_TYPE',
        payload: { tab_id: tabId, role: 'textbox', accessible_name: textbox.name, text: delivery.message, replace_existing: true },
        platform: 'CHATGPT',
      });
      const afterType = await this.#capture(tabId);
      const send = uniqueChatGptControl(afterType, 'SEND');
      if (!send) throw new Error('supervisor_mesh_send_not_unique');
      clicked = true;
      await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tabId, role: 'button', accessible_name: send.name }, platform: 'CHATGPT' });
      for (let i = 0; i < 6; i += 1) {
        await sleep(500);
        const observed = await this.#capture(tabId);
        if (generating(observed) || String(observed?.text_excerpt || '').includes(String(delivery?.pending?.delivery_id || ''))) {
          return { ok: true, clicked: true, observed };
        }
      }
      return { ok: false, clicked: true, reason: 'SEND_WITHOUT_POSITIVE_READBACK' };
    } catch (error) {
      return { ok: false, clicked, reason: String(error?.message || error).slice(0, 240) };
    }
  }

  async dispatchRecoveryIfNeeded() {
    if (!this.#running || !this.#mesh || this.#canActuate() !== true) return { ok: false, suppressed: true, authority_effect: false };
    const lifecycle = this.#primaryLifecycle() || null;
    const keepalive = lifecycle?.keepalive || null;
    const state = String(keepalive?.state || '');
    const primaryId = this.#mesh.snapshot().supervisors.find((row) => row.conversation_url === keepalive?.conversation_url)?.supervisor_id || null;
    let reason = null;
    let eventKey = null;
    let priorAmbiguousEventId = null;
    if (state === 'WAKE_AMBIGUOUS') {
      const wakeId = String(keepalive?.pending_wake?.wake_id || 'unknown');
      reason = 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY';
      eventKey = `wake-ambiguous:${keepalive?.supervisor_epoch || 0}:${wakeId}`;
      priorAmbiguousEventId = wakeId;
    } else if (state === 'ROLLOVER_DEFERRED' || state === 'ROLLOVER_REQUIRED' || state === 'ROLLOVER_AMBIGUOUS') {
      reason = 'PRIMARY_ROLLOVER_COORDINATION';
      eventKey = `rollover:${keepalive?.supervisor_epoch || 0}:${String(keepalive?.rollover_reason || state)}`;
      priorAmbiguousEventId = state === 'ROLLOVER_AMBIGUOUS' ? String(keepalive?.rollover_reason || '') : null;
    } else {
      return { ok: false, suppressed: true, reason: 'PRIMARY_HEALTHY', authority_effect: false };
    }

    const reservation = await this.#mesh.reserveCoordination({
      eventKey,
      reason,
      excludeSupervisorIds: primaryId ? [primaryId] : [],
      priorAmbiguousEventId,
      metadata: { primary_state: state, supervisor_epoch: keepalive?.supervisor_epoch || null },
    });
    if (!reservation.ok) return reservation;
    const delivery = reservation.deliveries[0];
    const sent = await this.#send(delivery);
    if (sent.busy === true && sent.clicked === false) {
      await this.#mesh.resolveReservedNoEffect?.(delivery.supervisor_id, delivery.pending.delivery_id).catch?.(() => {});
      this.#lastDelivery = { event_id: reservation.event_id, status: 'TARGET_BUSY_NO_EFFECT', supervisor_id: delivery.supervisor_id, authority_effect: false };
      return { ok: false, busy: true, authority_effect: false };
    }
    if (sent.ok) {
      await this.#mesh.confirmDelivery(delivery.supervisor_id, delivery.pending.delivery_id);
      this.#lastDelivery = { event_id: reservation.event_id, status: 'SENT', supervisor_id: delivery.supervisor_id, at: new Date(this.#clock()).toISOString(), authority_effect: false };
      return { ok: true, event_id: reservation.event_id, supervisor_id: delivery.supervisor_id, authority_effect: false };
    }
    if (sent.clicked) {
      await this.#mesh.markDeliveryAmbiguous(delivery.supervisor_id, delivery.pending.delivery_id, sent.reason);
      this.#lastDelivery = { event_id: reservation.event_id, status: 'AMBIGUOUS', supervisor_id: delivery.supervisor_id, reason: sent.reason, authority_effect: false };
      return { ok: false, ambiguous: true, authority_effect: false };
    }
    // No click means no message effect. Keep the event reservation terminal; a later
    // coordinator cycle may create a new recovery event after fresh reconciliation.
    await this.#mesh.markDeliveryAmbiguous(delivery.supervisor_id, delivery.pending.delivery_id, `NO_SEND_EFFECT:${sent.reason}`);
    await this.#mesh.resolveDeliveryAmbiguity(delivery.supervisor_id, { observed_sent: false });
    this.#lastDelivery = { event_id: reservation.event_id, status: 'NO_EFFECT', supervisor_id: delivery.supervisor_id, reason: sent.reason, authority_effect: false };
    return { ok: false, no_effect: true, authority_effect: false };
  }
}
