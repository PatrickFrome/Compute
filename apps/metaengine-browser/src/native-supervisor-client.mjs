import {
  NativeSupervisorClient as CoreNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  createBoundedSupervisorFetch,
} from './native-supervisor-client-core.mjs';
import {
  normalizeWorkspaceBindingSnapshot,
  unavailableWorkspaceBindingSnapshot,
} from './workspace-binding-observer.mjs';

export * from './native-supervisor-client-core.mjs';

// Additive read-only wrapper. The proven Native Supervisor implementation remains
// byte-identical in native-supervisor-client-core.mjs. Workspace observation runs
// as one bounded stage of the same existing heartbeat cycle and creates no timer,
// scheduler, command lease or Browser authority.
export class NativeSupervisorClient extends CoreNativeSupervisorClient {
  #workspaceIdentity;
  #workspaceFetch;
  #workspaceObservation = unavailableWorkspaceBindingSnapshot('UNINITIALIZED');
  #workspaceObservationPromise = null;

  constructor(options = {}) {
    super(options);
    if (!options.identity) throw new Error('native_supervisor_identity_required');
    if (typeof (options.fetchImpl ?? globalThis.fetch) !== 'function') throw new Error('native_supervisor_fetch_required');
    this.#workspaceIdentity = options.identity;
    this.#workspaceFetch = createBoundedSupervisorFetch(options.fetchImpl ?? globalThis.fetch, { deadlineMs: options.requestDeadlineMs });
  }

  async #observeWorkspaceBindings() {
    if (this.#workspaceObservationPromise) return this.#workspaceObservationPromise;
    this.#workspaceObservationPromise = (async () => {
      try {
        const identity = await this.#workspaceIdentity.ensure();
        if (!identity?.device_id) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('DEVICE_NOT_ENROLLED');
          return this.#workspaceObservation;
        }
        const path = '/v1/devos/workspace-snapshot';
        const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
        const headers = await this.#workspaceIdentity.deviceHeaders('GET', requestPath, '');
        const response = await this.#workspaceFetch(`${NATIVE_SUPERVISOR_BASE}${path}`, { method: 'GET', headers, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (response.status === 404) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('ROUTE_UNAVAILABLE', 'WORKSPACE_SNAPSHOT_ROUTE_UNAVAILABLE');
          return this.#workspaceObservation;
        }
        if (response.status === 503 && ['RUNTIME_NOT_DEPLOYED','READ_UNAVAILABLE'].includes(String(body?.state || '').toUpperCase())) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot(String(body.state).toUpperCase(), body?.reason || null);
          return this.#workspaceObservation;
        }
        if (!response.ok) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('READ_ERROR', `WORKSPACE_SNAPSHOT_HTTP_${response.status}`);
          return this.#workspaceObservation;
        }
        const checked = normalizeWorkspaceBindingSnapshot(body);
        this.#workspaceObservation = checked || unavailableWorkspaceBindingSnapshot('INVALID_READBACK', 'WORKSPACE_SNAPSHOT_SCHEMA_INVALID');
        return this.#workspaceObservation;
      } catch (error) {
        this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('READ_ERROR', String(error?.message || error).slice(0, 240));
        return this.#workspaceObservation;
      }
    })().finally(() => { this.#workspaceObservationPromise = null; });
    return this.#workspaceObservationPromise;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      workspace_bindings: structuredClone(this.#workspaceObservation),
      workspace_binding_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      workspace_binding_second_polling_loop: false,
    };
  }

  async cycle() {
    try {
      await super.cycle();
    } finally {
      await this.#observeWorkspaceBindings();
    }
    return this.snapshot();
  }
}
