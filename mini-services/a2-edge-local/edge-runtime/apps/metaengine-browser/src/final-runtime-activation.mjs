import crypto from 'node:crypto';
import { ChatFastControlRuntime } from './chat-fast-control-runtime.mjs';
import { controlActionDescriptor } from './control-actions-manifest.mjs';
import { HostAgentRemoteComposition } from './host-agent-remote-composition.mjs';
import { hostAgentEndpoint } from './host-agent-ipc.mjs';
import { LeasedBrowserPlanExecutor } from './leased-browser-plan.mjs';

export const FINAL_RUNTIME_ACTIVATION_SCHEMA = 'metaengine.browser.final-runtime-activation.v1';

const clip = (value, max = 240) => String(value ?? '').slice(0, max);
const sessionKey = () => crypto.randomBytes(32).toString('base64url');

function unavailableMutationAuthority(operation) {
  return async () => {
    throw new Error(`fast_control_production_authority_unavailable:${operation}`);
  };
}

function authorizationProjection(nativeSupervisor, command) {
  const descriptor = controlActionDescriptor(command?.action);
  const supervisor = nativeSupervisor?.snapshot?.() || null;
  const running = supervisor?.running === true;
  const mutating = descriptor?.effect === 'MUTATING';
  const controlReady = supervisor?.supervisor_mode === 'CONTROL' && supervisor?.armed === true;
  return Object.freeze({
    authorized: running && (!mutating || controlReady),
    running,
    mutating,
    supervisor_mode: supervisor?.supervisor_mode || null,
    armed: supervisor?.armed === true,
    db_lease_required: true,
    transport_delivery_is_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function selectedTabId(state) {
  return state?.active_tab?.tab_id || state?.tabs?.find?.((row) => row?.selected === true)?.tab_id || null;
}

function stateHasTab(state, tabId) {
  return Array.isArray(state?.tabs) && state.tabs.some((row) => String(row?.tab_id || '') === String(tabId || ''));
}

function semanticValueConfirmed(command, result, state) {
  if (String(command?.action || '') !== 'SEMANTIC_TYPE') return false;
  if (command?.payload?.submit_after_type === true) {
    return /^PROVEN_/.test(String(result?.effect_state || ''));
  }
  if (command?.payload?.replace_existing === false || !result?.prompt_sha256) return false;
  const role = String(command?.payload?.role || '').trim().toLowerCase();
  const name = String(command?.payload?.accessible_name || '').trim();
  const targets = state?.perception?.semantic_targets;
  if (!Array.isArray(targets)) return false;
  return targets.some((row) => String(row?.role || '').toLowerCase() === role
    && String(row?.name || '') === name
    && String(row?.value_sha256 || '') === String(result.prompt_sha256));
}

export function verifyFinalRuntimeCommand(command, result, state) {
  const action = String(command?.action || '').toUpperCase();
  const tabId = String(command?.payload?.tab_id || '');
  if (result?.effect_outcome === 'CONFIRMED' || result?.navigation?.state === 'CONFIRMED') {
    return Object.freeze({ confirmed: true, evidence: 'EXECUTOR_CONFIRMED_OUTCOME', authority_effect: false });
  }
  if (action === 'SELECT_TAB') {
    return Object.freeze({ confirmed: selectedTabId(state) === tabId, evidence: 'ACTIVE_TAB_READBACK', authority_effect: false });
  }
  if (action === 'CLOSE_TAB') {
    return Object.freeze({ confirmed: !stateHasTab(state, tabId), evidence: 'TAB_ABSENCE_READBACK', authority_effect: false });
  }
  if (action === 'NEW_TAB') {
    const createdTabId = String(result?.tab_id || '');
    return Object.freeze({ confirmed: Boolean(createdTabId) && stateHasTab(state, createdTabId), evidence: 'CREATED_TAB_READBACK', authority_effect: false });
  }
  if (semanticValueConfirmed(command, result, state)) {
    return Object.freeze({ confirmed: true, evidence: 'SEMANTIC_VALUE_OR_SUBMIT_READBACK', authority_effect: false });
  }
  return Object.freeze({
    confirmed: false,
    no_effect_proven: false,
    evidence_conflict: false,
    evidence: 'POSTCONDITION_NOT_PROVEN',
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export class FinalRuntimeActivation {
  #userDataPath;
  #appVersion;
  #identity;
  #developmentPlane;
  #nativeSupervisor;
  #getBrowserState;
  #getCurrentUrl;
  #executeCommand;
  #fetchImpl;
  #fastControl = null;
  #leasedExecutor = null;
  #composition = null;
  #state = 'STOPPED';
  #lastError = null;
  #startedAt = null;

  constructor({
    userDataPath,
    appVersion = '0.0.0',
    identity,
    developmentPlane,
    nativeSupervisor,
    getBrowserState,
    getCurrentUrl,
    executeCommand,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!String(userDataPath || '')) throw new Error('final_runtime_user_data_path_required');
    if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') throw new Error('final_runtime_identity_required');
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('final_runtime_development_plane_required');
    if (!nativeSupervisor || typeof nativeSupervisor.snapshot !== 'function') throw new Error('final_runtime_native_supervisor_required');
    if (typeof getBrowserState !== 'function') throw new Error('final_runtime_browser_state_required');
    if (typeof getCurrentUrl !== 'function') throw new Error('final_runtime_current_url_required');
    if (typeof executeCommand !== 'function') throw new Error('final_runtime_command_executor_required');
    if (typeof fetchImpl !== 'function') throw new Error('final_runtime_fetch_required');
    this.#userDataPath = String(userDataPath);
    this.#appVersion = String(appVersion || '0.0.0');
    this.#identity = identity;
    this.#developmentPlane = developmentPlane;
    this.#nativeSupervisor = nativeSupervisor;
    this.#getBrowserState = getBrowserState;
    this.#getCurrentUrl = getCurrentUrl;
    this.#executeCommand = executeCommand;
    this.#fetchImpl = fetchImpl;
  }

  async start() {
    if (this.#state === 'READY') return this.snapshot();
    if (this.#state === 'STARTING') throw new Error('final_runtime_start_in_progress');
    if (this.#composition) throw new Error('final_runtime_new_activation_required_after_stop');
    this.#state = 'STARTING';
    this.#lastError = null;
    try {
      this.#fastControl = new ChatFastControlRuntime({
        developmentPlane: this.#developmentPlane,
        getBrowserState: this.#getBrowserState,
        issueBatch: unavailableMutationAuthority('run_submit'),
        resultDelta: unavailableMutationAuthority('run_status'),
        issueEmergency: unavailableMutationAuthority('emergency_stop'),
      });
      this.#leasedExecutor = new LeasedBrowserPlanExecutor({
        authorizeCommand: async (command) => authorizationProjection(this.#nativeSupervisor, command),
        executeCommand: async (command) => this.#executeCommand(command),
        verifyCommand: async (command, result) => verifyFinalRuntimeCommand(command, result, await this.#getBrowserState()),
        getCurrentUrl: async (command) => this.#getCurrentUrl(command),
      });
      this.#composition = new HostAgentRemoteComposition({
        userDataPath: this.#userDataPath,
        identity: this.#identity,
        signerSessionKey: sessionKey(),
        browserSessionKey: sessionKey(),
        hostEndpoint: hostAgentEndpoint({ userDataPath: this.#userDataPath }),
        hostSessionKey: sessionKey(),
        developmentPlane: this.#developmentPlane,
        fastControl: this.#fastControl,
        browserStatus: async () => ({
          schema: 'metaengine.browser.final-runtime-status.v1',
          version: this.#appVersion,
          browser: await this.#getBrowserState(),
          native_supervisor: this.#nativeSupervisor.snapshot(),
          leased_browser_plan: this.#leasedExecutor.snapshot(),
          fast_control: this.#fastControl.snapshot(),
          second_scheduler: false,
          authority_effect: false,
        }),
        browserPlanExecute: (payload) => this.#leasedExecutor.execute(payload),
        browserPlanCancel: (payload) => this.#leasedExecutor.cancel(payload?.plan_id, payload?.reason),
        fetchImpl: this.#fetchImpl,
      });
      await this.#composition.start();
      this.#startedAt = new Date().toISOString();
      this.#state = 'READY';
      return this.snapshot();
    } catch (error) {
      this.#state = 'FAILED';
      this.#lastError = clip(error?.message || error);
      if (this.#composition) {
        try { await this.#composition.stop(); } catch (cleanupError) {
          this.#lastError = `${this.#lastError};cleanup:${clip(cleanupError?.message || cleanupError)}`.slice(0, 240);
        }
      }
      throw error;
    }
  }

  async stop() {
    const composition = this.#composition;
    if (composition) await composition.stop();
    this.#composition = null;
    this.#fastControl = null;
    this.#leasedExecutor = null;
    this.#state = 'STOPPED';
    this.#startedAt = null;
    this.#lastError = null;
    return this.snapshot();
  }

  snapshot() {
    const supervisor = this.#nativeSupervisor?.snapshot?.() || null;
    return Object.freeze({
      schema: FINAL_RUNTIME_ACTIVATION_SCHEMA,
      state: this.#state,
      version: this.#appVersion,
      started_at: this.#startedAt,
      host_agent: this.#composition?.snapshot?.() || null,
      leased_browser_plan: this.#leasedExecutor?.snapshot?.() || null,
      fast_control: this.#fastControl?.snapshot?.() || null,
      scheduler_owner: 'NATIVE_SUPERVISOR_CLIENT',
      native_supervisor_running: supervisor?.running === true,
      second_scheduler: false,
      host_agent_process_required_for_scheduler: false,
      browser_execution_via_typed_ipc: this.#composition?.snapshot?.()?.browser_execution_via_typed_ipc === true,
      verified_execution_outcomes_active: this.#leasedExecutor != null,
      fast_control_read_side_active: this.#fastControl != null,
      fast_control_production_mutation_authority: false,
      production_authority_fabricated: false,
      automatic_effect_retry_allowed: false,
      restart_requires_new_activation: true,
      last_error: this.#lastError,
      authority_effect: false,
    });
  }
}

export function createFinalRuntimeActivation(options) {
  return new FinalRuntimeActivation(options);
}
