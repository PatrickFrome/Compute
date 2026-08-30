import fs from 'node:fs/promises';
import path from 'node:path';
import { SupervisorMesh } from './supervisor-mesh.mjs';

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

export class SupervisorMeshRuntime {
  #getState;
  #mesh = null;
  #statePath;
  #lastError = null;
  #lastReconcileAt = null;
  #running = false;
  #maxSupervisors;
  #clock;
  #uuid;

  constructor({
    getState,
    statePath = null,
    maxSupervisors = 16,
    clock = () => Date.now(),
    uuid = undefined,
  } = {}) {
    if (typeof getState !== 'function') throw new Error('supervisor_mesh_runtime_state_provider_required');
    this.#getState = getState;
    this.#statePath = statePath;
    this.#maxSupervisors = maxSupervisors;
    this.#clock = clock;
    this.#uuid = uuid;
  }

  async start() {
    if (this.#running) return this.snapshot();
    if (!this.#statePath) {
      const { app } = await import('electron');
      this.#statePath = path.join(app.getPath('userData'), 'metaengine-supervisor-mesh-v1.json');
    }
    this.#mesh = new SupervisorMesh({
      loadState: () => readJson(this.#statePath),
      saveState: (value) => writeJson(this.#statePath, value),
      maxSupervisors: this.#maxSupervisors,
      clock: this.#clock,
      ...(this.#uuid ? { uuid: this.#uuid } : {}),
    });
    await this.#mesh.init();
    this.#running = true;
    await this.reconcile();
    return this.snapshot();
  }

  stop() {
    this.#running = false;
    return this.snapshot();
  }

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
    } catch (error) {
      this.#lastError = String(error?.message || error).slice(0, 300);
    }
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.supervisor-mesh-runtime.v1',
      running: this.#running,
      state_path_bound: Boolean(this.#statePath),
      last_reconcile_at: this.#lastReconcileAt,
      last_error: this.#lastError,
      mesh: this.#mesh?.snapshot() || null,
      authority_effect: false,
    });
  }

  isQuiescent() {
    const mesh = this.#mesh?.snapshot();
    if (!this.#running || !mesh) return false;
    return mesh.supervisors.every((row) => !row.pending_delivery && !row.ambiguous_delivery);
  }

  async prefer(target = {}) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    const result = await this.#mesh.prefer(target);
    return { preferred_supervisor_id: result.preferred_supervisor_id, mesh_epoch: result.mesh_epoch, authority_effect: false };
  }

  async pause(supervisorId) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    return this.#mesh.pause(supervisorId);
  }

  async resume(supervisorId) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    return this.#mesh.resume(supervisorId);
  }

  async reserveWakeTargets(input = {}) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    return this.#mesh.reserveWakeTargets(input);
  }

  async confirmDelivery(supervisorId, deliveryId) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    return this.#mesh.confirmDelivery(supervisorId, deliveryId);
  }

  async markDeliveryAmbiguous(supervisorId, deliveryId, reason) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    return this.#mesh.markDeliveryAmbiguous(supervisorId, deliveryId, reason);
  }

  async resolveDeliveryAmbiguity(supervisorId, observation) {
    if (!this.#mesh) throw new Error('supervisor_mesh_runtime_not_started');
    return this.#mesh.resolveDeliveryAmbiguity(supervisorId, observation);
  }
}
