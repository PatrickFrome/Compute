import fs from 'node:fs/promises';
import path from 'node:path';
import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';
import { createSupervisorSendBoundaryExecutor } from './supervisor-lifecycle-runtime.mjs';
import { SupervisorMesh } from './supervisor-mesh.mjs';
import {
  fenceReservedCoordination,
  assertFencedReservationCurrent,
} from './supervisor-mesh-fenced-reservation.mjs';

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
    this.#execute = createSupervisorSendBoundaryExecutor({ getState, executeCommand });
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
      foreground_send_boundary: 'EXACT_TAB_TARGET_PROCESS_VIEWPORT_V1',
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

  #assertDeliveryFenceCurrent(delivery) {
    if (!this.#mesh) throw new Error('supervisor_mesh_not_started');
    assertFencedReservationCurrent({
      coordination_fence: delivery?.coordination_fence,
      deliveries: [delivery],
    }, this.#mesh.snapshot());
  }

  async #send(delivery) {
    const tabId = String(delivery?.tab_id || '');
    if (!tabId) throw new Error('supervisor_mesh_delivery_tab_missing');
    let clicked = false;
    let typed = false;
    try {
      const before = await this.#capture(tabId);
      if (generating(before)) return { ok: false, busy: true, clicked: false, typed: false, reason: 'TARGET_GENERATING' };
      const textbox = uniqueTextbox(before);
      if (!textbox) throw new Error('supervisor_mesh_composer_not_unique');
      this.#assertDeliveryFenceCurrent(delivery);
      const typedResult = await this.#execute({
        action: 'SEMANTIC_TYPE',
        payload: { tab_id: tabId, role: 'textbox', accessible_name: textbox.name, text: delivery.message, replace_existing: true },
        platform: 'CHATGPT',
      });
      typed = true;
      if (typedResult?.suppressed === true) {
        return { ok: false, clicked: false, typed: true, reason: String(typedResult.reason || 'TYPE_EFFECT_AMBIGUOUS') };
      }
      const afterType = await this.#capture(tabId);
      const send = uniqueChatGptControl(afterType, 'SEND');
      if (!send) throw new Error('supervisor_mesh_send_not_unique');
      this.#assertDeliveryFenceCurrent(delivery);
      clicked = true;
      await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: tabId, role: 'button', accessible_name: send.name }, platform: 'CHATGPT' });
      for (let i = 0; i < 6; i += 1) {
        await sleep(500);
        const observed = await this.#capture(tabId);
        if (generating(observed) || String(observed?.text_excerpt || '').includes(String(delivery?.pending?.delivery_id || ''))) {
          return { ok: true, clicked: true, typed: true, observed };
        }
      }
      return { ok: false, clicked: true, typed: true, reason: 'SEND_WITHOUT_POSITIVE_READBACK' };
    } catch (error) {
      return { ok: false, clicked, typed, reason: String(error?.message || error).slice(0, 240) };
    }
  }

  async #settleNoEffect(delivery, reason) {
    await this.#mesh.markDeliveryAmbiguous(delivery.supervisor_id, delivery.pending.delivery_id, `NO_SEND_EFFECT:${String(reason || '')}`);
    await this.#mesh.resolveDeliveryAmbiguity(delivery.supervisor_id, { observed_sent: false });
  }

  async dispatchRecoveryIfNeeded() {
    if (!this.#running || !this.#mesh || this.#canActuate() !== true) return { ok: false, suppressed: true, authority_effect: false };
    const lifecycle = this.#primaryLifecycle() || null;
    const keepalive = lifecycle?.keepalive || null;
    const state = String(keepalive?.state || '');
    const rolloverAttemptId = keepalive?.rollover_attempt?.attempt_id ? String(keepalive.rollover_attempt.attempt_id) : null;
    const meshSnapshot = this.#mesh.snapshot();
    const primary = meshSnapshot.supervisors.find((row) => row.conversation_url === keepalive?.conversation_url) || null;
    const primaryId = primary?.supervisor_id || null;
    let reason = null;
    let eventKey = null;
    let priorAmbiguousEventId = null;

    if (keepalive?.conversation_url && (!primary || !['ACTIVE'].includes(String(primary.status)))) {
      reason = 'PRIMARY_SUPERVISOR_UNAVAILABLE';
      eventKey = `primary-unavailable:${keepalive?.supervisor_epoch || 0}:${String(keepalive.conversation_url)}`;
    } else if (state === 'WAKE_AMBIGUOUS') {
      const wakeId = String(keepalive?.pending_wake?.wake_id || 'unknown');
      reason = 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY';
      eventKey = `wake-ambiguous:${keepalive?.supervisor_epoch || 0}:${wakeId}`;
      priorAmbiguousEventId = wakeId;
    } else if (state === 'ROLLOVER_DEFERRED' || state === 'ROLLOVER_REQUIRED' || state === 'ROLLOVER_AMBIGUOUS') {
      reason = 'PRIMARY_ROLLOVER_COORDINATION';
      eventKey = `rollover:${keepalive?.supervisor_epoch || 0}:${rolloverAttemptId || String(keepalive?.rollover_reason || state)}`;
      priorAmbiguousEventId = state === 'ROLLOVER_AMBIGUOUS'
        ? (rolloverAttemptId || String(keepalive?.rollover_reason || ''))
        : null;
    } else {
      return { ok: false, suppressed: true, reason: 'PRIMARY_HEALTHY', authority_effect: false };
    }

    const reservation = await this.#mesh.reserveCoordination({
      eventKey,
      reason,
      excludeSupervisorIds: primaryId ? [primaryId] : [],
      priorAmbiguousEventId,
      metadata: {
        primary_state: state,
        supervisor_epoch: keepalive?.supervisor_epoch || null,
        rollover_attempt_id: rolloverAttemptId,
      },
    });
    if (!reservation.ok) return reservation;

    let fencedReservation;
    try {
      fencedReservation = fenceReservedCoordination(reservation, this.#mesh.snapshot());
      assertFencedReservationCurrent(fencedReservation, this.#mesh.snapshot());
    } catch (error) {
      const delivery = reservation.deliveries[0];
      await this.#settleNoEffect(delivery, `FENCE_REJECTED:${String(error?.message || error)}`);
      this.#lastDelivery = {
        event_id: reservation.event_id,
        status: 'FENCE_REJECTED_NO_SEND',
        supervisor_id: delivery.supervisor_id,
        reason: String(error?.message || error).slice(0, 240),
        authority_effect: false,
      };
      return { ok: false, fenced: false, no_effect: true, authority_effect: false };
    }

    const delivery = fencedReservation.deliveries[0];
    const sent = await this.#send(delivery);
    if (sent.busy === true && sent.clicked === false && sent.typed !== true) {
      await this.#settleNoEffect(delivery, sent.reason);
      this.#lastDelivery = { event_id: reservation.event_id, status: 'TARGET_BUSY_NO_EFFECT', supervisor_id: delivery.supervisor_id, authority_effect: false };
      return { ok: false, busy: true, authority_effect: false };
    }
    if (sent.ok) {
      await this.#mesh.confirmDelivery(delivery.supervisor_id, delivery.pending.delivery_id);
      this.#lastDelivery = {
        event_id: reservation.event_id,
        status: 'SENT',
        supervisor_id: delivery.supervisor_id,
        rollover_attempt_id: rolloverAttemptId,
        at: new Date(this.#clock()).toISOString(),
        authority_effect: false,
      };
      return { ok: true, event_id: reservation.event_id, supervisor_id: delivery.supervisor_id, authority_effect: false };
    }
    if (sent.clicked || sent.typed) {
      await this.#mesh.markDeliveryAmbiguous(delivery.supervisor_id, delivery.pending.delivery_id, sent.reason);
      this.#lastDelivery = { event_id: reservation.event_id, status: 'AMBIGUOUS', supervisor_id: delivery.supervisor_id, reason: sent.reason, typed: sent.typed === true, clicked: sent.clicked === true, authority_effect: false };
      return { ok: false, ambiguous: true, authority_effect: false };
    }
    await this.#settleNoEffect(delivery, sent.reason);
    this.#lastDelivery = { event_id: reservation.event_id, status: 'NO_EFFECT', supervisor_id: delivery.supervisor_id, reason: sent.reason, authority_effect: false };
    return { ok: false, no_effect: true, authority_effect: false };
  }
}
