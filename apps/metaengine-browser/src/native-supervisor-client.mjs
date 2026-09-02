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

const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const hostResilienceRuntime = () => globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ || null;
const hostResilienceSnapshot = () => hostResilienceRuntime()?.snapshot?.() || null;

export function exactCommandTargetProjection(command) {
  const commandId = String(command?.command_id || '').toLowerCase();
  const tabId = String(command?.payload?.tab_id || '');
  if (!COMMAND_ID_RE.test(commandId)) return null;
  return Object.freeze({
    command_id: commandId,
    target_tab_id: TAB_ID_RE.test(tabId) ? tabId : null,
    payload_exposed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}

export async function runSupervisorEnrollmentBootstrap(supervisor) {
  if (!supervisor || typeof supervisor.ensureEnrollment !== 'function') {
    throw new Error('native_supervisor_enrollment_bootstrap_required');
  }
  const row = await supervisor.ensureEnrollment();
  return Object.freeze({
    status: String(row?.status || 'UNKNOWN').slice(0, 80),
    device_id: row?.device_id ? String(row.device_id) : null,
    request_id: row?.request_id ? String(row.request_id) : null,
    command_leasing: false,
    browser_authority: false,
    automatic_retry_allowed: false,
    second_polling_loop: false,
    authority_effect: false,
  });
}

// Additive wrapper. The proven Native Supervisor implementation remains in
// native-supervisor-client-core.mjs. Workspace observation and enrollment recovery
// run as bounded stages of the same existing supervisor cycle and create no timer,
// scheduler, command lease or Browser authority. Enrollment is never auto-approved.
// Exact command target telemetry is derived only from an already-executing DB-leased
// typed command and exposes no payload.
export class NativeSupervisorClient extends CoreNativeSupervisorClient {
  #workspaceIdentity;
  #workspaceFetch;
  #workspaceObservation = unavailableWorkspaceBindingSnapshot('UNINITIALIZED');
  #workspaceObservationPromise = null;
  #commandTargetProjection = null;
  #enrollmentBootstrapPromise = null;
  #enrollmentBootstrapStatus = Object.freeze({
    status: 'UNINITIALIZED',
    device_id: null,
    request_id: null,
    command_leasing: false,
    browser_authority: false,
    automatic_retry_allowed: false,
    second_polling_loop: false,
    authority_effect: false,
  });
  #enrollmentBootstrapError = null;

  constructor(options = {}) {
    const executeCommand = options.executeCommand;
    const sourceGetState = options.getState;
    const sourceBeforeSelfUpdateInstall = options.beforeSelfUpdateInstall;
    let commandTargetProjection = null;
    const trackedExecuteCommand = typeof executeCommand === 'function'
      ? async (command) => {
          const projected = exactCommandTargetProjection(command);
          if (projected) commandTargetProjection = projected;
          return executeCommand(command);
        }
      : executeCommand;
    const getStateWithHostResilience = typeof sourceGetState === 'function'
      ? async () => ({
          ...(await sourceGetState()),
          host_resilience: hostResilienceSnapshot(),
        })
      : sourceGetState;
    const beforeSelfUpdateInstall = async (receipt) => {
      const host = hostResilienceRuntime();
      if (host?.prepareInstallerHandoff) await host.prepareInstallerHandoff('SELF_UPDATE');
      await sourceBeforeSelfUpdateInstall?.(receipt);
    };

    super({
      ...options,
      getState: getStateWithHostResilience,
      executeCommand: trackedExecuteCommand,
      beforeSelfUpdateInstall,
    });
    if (!options.identity) throw new Error('native_supervisor_identity_required');
    if (typeof (options.fetchImpl ?? globalThis.fetch) !== 'function') throw new Error('native_supervisor_fetch_required');
    this.#workspaceIdentity = options.identity;
    this.#workspaceFetch = createBoundedSupervisorFetch(options.fetchImpl ?? globalThis.fetch, { deadlineMs: options.requestDeadlineMs });
    this.#commandTargetProjection = () => commandTargetProjection;
  }

  async #bootstrapEnrollment() {
    if (this.#enrollmentBootstrapPromise) return this.#enrollmentBootstrapPromise;
    this.#enrollmentBootstrapPromise = (async () => {
      try {
        const result = await runSupervisorEnrollmentBootstrap(this);
        this.#enrollmentBootstrapStatus = result;
        this.#enrollmentBootstrapError = null;
        return result;
      } catch (error) {
        this.#enrollmentBootstrapError = String(error?.message || error).slice(0, 240);
        this.#enrollmentBootstrapStatus = Object.freeze({
          status: 'ERROR',
          device_id: null,
          request_id: null,
          command_leasing: false,
          browser_authority: false,
          automatic_retry_allowed: false,
          second_polling_loop: false,
          authority_effect: false,
        });
        return this.#enrollmentBootstrapStatus;
      }
    })().finally(() => { this.#enrollmentBootstrapPromise = null; });
    return this.#enrollmentBootstrapPromise;
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
    const base = super.snapshot();
    const target = this.#commandTargetProjection?.() || null;
    const currentCommand = base?.current_command && target?.command_id === String(base.current_command.command_id || '').toLowerCase()
      ? { ...base.current_command, target_tab_id: target.target_tab_id }
      : base?.current_command || null;
    return {
      ...base,
      current_command: currentCommand,
      current_command_payload_exposed: false,
      current_command_target_authority: 'DB_LEASED_TYPED_COMMAND_ONLY',
      enrollment_bootstrap: structuredClone(this.#enrollmentBootstrapStatus),
      enrollment_bootstrap_error: this.#enrollmentBootstrapError,
      enrollment_bootstrap_same_cycle: true,
      enrollment_bootstrap_auto_approval: false,
      workspace_bindings: structuredClone(this.#workspaceObservation),
      workspace_binding_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      workspace_binding_second_polling_loop: false,
      host_resilience: hostResilienceSnapshot(),
      host_resilience_source: 'PRIMARY_BROWSER_PROCESS',
      host_resilience_second_polling_loop: false,
    };
  }

  async start() {
    // Enrollment must be attempted before dependent mesh/lifecycle startup so a
    // fresh installation cannot remain visually alive but permanently transport-dead.
    // Failure is fail-soft here: super.start() still brings up the existing watchdog,
    // and the normal cycle below re-attempts the bounded enrollment handshake.
    await this.#bootstrapEnrollment();
    return super.start();
  }

  async cycle() {
    // Piggyback enrollment recovery on the one existing supervisor cycle. No second
    // interval is introduced and PENDING_APPROVAL never grants command authority.
    await this.#bootstrapEnrollment();
    try {
      await super.cycle();
    } finally {
      await this.#observeWorkspaceBindings();
    }
    return this.snapshot();
  }
}
