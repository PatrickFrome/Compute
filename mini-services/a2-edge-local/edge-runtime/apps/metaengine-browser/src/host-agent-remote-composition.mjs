import { BrowserIdentitySignerRuntime } from './browser-identity-signer-runtime.mjs';
import {
  BrowserExecutorClient,
  browserExecutorEndpoint,
  createBrowserExecutorServer,
} from './browser-executor-ipc.mjs';
import { createHostAgentSupervisorIdentity } from './host-agent-supervisor-identity.mjs';
import { HostAgentRuntime } from './host-agent-runtime.mjs';
import { NativeSupervisorRuntimeTransport } from './native-supervisor-runtime-transport.mjs';

export const HOST_AGENT_REMOTE_COMPOSITION_SCHEMA = 'metaengine.host-agent.remote-composition.v1';

function requireFunction(value, code) {
  if (typeof value !== 'function') throw new Error(code);
  return value;
}

function clipError(error) {
  return String(error?.message || error).slice(0, 240);
}

export class HostAgentRemoteComposition {
  #userDataPath;
  #identity;
  #signerSessionKey;
  #browserSessionKey;
  #hostEndpoint;
  #hostSessionKey;
  #sessionKeysConsumed = false;
  #developmentPlane;
  #fastControl;
  #browserStatus;
  #browserPlanExecute;
  #browserPlanCancel;
  #fetchImpl;
  #signerRuntime = null;
  #browserServer = null;
  #hostIdentity = null;
  #browserClient = null;
  #transport = null;
  #hostRuntime = null;
  #state = 'STOPPED';
  #lastError = null;

  constructor({
    userDataPath,
    identity,
    signerSessionKey,
    browserSessionKey,
    hostEndpoint,
    hostSessionKey,
    developmentPlane,
    fastControl,
    browserStatus,
    browserPlanExecute,
    browserPlanCancel,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!String(userDataPath || '')) throw new Error('host_agent_remote_user_data_path_required');
    if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') throw new Error('host_agent_remote_identity_required');
    if (!String(signerSessionKey || '')) throw new Error('host_agent_remote_signer_session_key_required');
    if (!String(browserSessionKey || '')) throw new Error('host_agent_remote_browser_session_key_required');
    if (!String(hostEndpoint || '')) throw new Error('host_agent_remote_host_endpoint_required');
    if (!String(hostSessionKey || '')) throw new Error('host_agent_remote_host_session_key_required');
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('host_agent_remote_development_plane_required');
    if (!fastControl || typeof fastControl.invoke !== 'function') throw new Error('host_agent_remote_fast_control_required');
    if (typeof fetchImpl !== 'function') throw new Error('host_agent_remote_fetch_required');
    this.#userDataPath = String(userDataPath);
    this.#identity = identity;
    this.#signerSessionKey = String(signerSessionKey);
    this.#browserSessionKey = String(browserSessionKey);
    this.#hostEndpoint = String(hostEndpoint);
    this.#hostSessionKey = String(hostSessionKey);
    this.#developmentPlane = developmentPlane;
    this.#fastControl = fastControl;
    this.#browserStatus = requireFunction(browserStatus, 'host_agent_remote_browser_status_required');
    this.#browserPlanExecute = requireFunction(browserPlanExecute, 'host_agent_remote_browser_execute_required');
    this.#browserPlanCancel = requireFunction(browserPlanCancel, 'host_agent_remote_browser_cancel_required');
    this.#fetchImpl = fetchImpl;
  }

  async start() {
    if (this.#state === 'READY') return this.snapshot();
    if (this.#state === 'STARTING') throw new Error('host_agent_remote_start_in_progress');
    if (this.#sessionKeysConsumed) throw new Error('host_agent_remote_new_session_keys_required');

    const signerSessionKey = this.#signerSessionKey;
    const browserSessionKey = this.#browserSessionKey;
    const hostSessionKey = this.#hostSessionKey;
    this.#signerSessionKey = null;
    this.#browserSessionKey = null;
    this.#hostSessionKey = null;
    this.#sessionKeysConsumed = true;
    this.#state = 'STARTING';
    this.#lastError = null;
    try {
      // Browser-owned boundary: the encrypted P-256 key remains behind this signer.
      this.#signerRuntime = new BrowserIdentitySignerRuntime({
        identity: this.#identity,
        userDataPath: this.#userDataPath,
        sessionKey: signerSessionKey,
      });
      await this.#signerRuntime.start();

      // Browser-owned typed executor boundary; deliberately separate from signer IPC.
      const browserEndpoint = browserExecutorEndpoint({ userDataPath: this.#userDataPath });
      this.#browserServer = createBrowserExecutorServer({
        endpoint: browserEndpoint,
        sessionKey: browserSessionKey,
        browserStatus: this.#browserStatus,
        browserPlanExecute: this.#browserPlanExecute,
        browserPlanCancel: this.#browserPlanCancel,
      });
      await this.#browserServer.start();

      // Host-side identity and browser clients. These are the only objects that a
      // detached Host Agent process needs from the Browser-owned boundaries.
      this.#hostIdentity = createHostAgentSupervisorIdentity({
        userDataPath: this.#userDataPath,
        sessionKey: signerSessionKey,
      });
      await this.#hostIdentity.connect();
      this.#browserClient = new BrowserExecutorClient({ endpoint: browserEndpoint, sessionKey: browserSessionKey });
      await this.#browserClient.connect();

      this.#transport = new NativeSupervisorRuntimeTransport({
        identity: this.#hostIdentity.identity,
        fetchImpl: this.#fetchImpl,
      });

      this.#hostRuntime = new HostAgentRuntime({
        endpoint: this.#hostEndpoint,
        sessionKey: hostSessionKey,
        developmentPlane: this.#developmentPlane,
        fastControl: this.#fastControl,
        browserClient: this.#browserClient,
      });
      await this.#hostRuntime.start();
      this.#state = 'READY';
      return this.snapshot();
    } catch (error) {
      const primaryError = clipError(error);
      this.#state = 'FAILED';
      const cleanupErrors = await this.#closeParts();
      this.#lastError = cleanupErrors.length > 0
        ? `${primaryError};cleanup:${cleanupErrors.join('|')}`.slice(0, 240)
        : primaryError;
      throw error;
    }
  }

  async #closeParts() {
    const errors = [];

    if (this.#hostRuntime) {
      try {
        await this.#hostRuntime.close();
        this.#hostRuntime = null;
      } catch (error) {
        errors.push(`host_runtime:${clipError(error)}`);
      }
    }

    if (this.#browserClient) {
      try {
        this.#browserClient.close();
        this.#browserClient = null;
      } catch (error) {
        errors.push(`browser_client:${clipError(error)}`);
      }
    }

    if (this.#hostIdentity) {
      try {
        this.#hostIdentity.close();
        this.#hostIdentity = null;
      } catch (error) {
        errors.push(`host_identity:${clipError(error)}`);
      }
    }

    if (this.#browserServer) {
      try {
        await this.#browserServer.close();
        this.#browserServer = null;
      } catch (error) {
        errors.push(`browser_server:${clipError(error)}`);
      }
    }

    if (this.#signerRuntime) {
      try {
        await this.#signerRuntime.stop();
        this.#signerRuntime = null;
      } catch (error) {
        errors.push(`signer_runtime:${clipError(error)}`);
      }
    }

    this.#transport = null;
    return errors;
  }

  async stop() {
    const cleanupErrors = await this.#closeParts();
    if (cleanupErrors.length > 0) {
      this.#state = 'FAILED';
      this.#lastError = `cleanup:${cleanupErrors.join('|')}`.slice(0, 240);
      throw new Error(`host_agent_remote_cleanup_failed:${this.#lastError}`);
    }
    this.#state = 'STOPPED';
    this.#lastError = null;
    return this.snapshot();
  }

  transport() {
    if (this.#state !== 'READY' || !this.#transport) throw new Error('host_agent_remote_transport_not_ready');
    return this.#transport;
  }

  snapshot() {
    return Object.freeze({
      schema: HOST_AGENT_REMOTE_COMPOSITION_SCHEMA,
      state: this.#state,
      signer: this.#signerRuntime?.snapshot?.() || null,
      browser_executor: this.#browserServer?.snapshot?.() || null,
      host_identity: this.#hostIdentity?.snapshot?.() || null,
      browser_client: this.#browserClient?.snapshot?.() || null,
      transport: this.#transport?.snapshot?.() || null,
      host_runtime: this.#hostRuntime?.snapshot?.() || null,
      signer_session_key_exposed: false,
      browser_session_key_exposed: false,
      host_session_key_exposed: false,
      session_keys_one_shot: true,
      session_keys_consumed: this.#sessionKeysConsumed,
      restart_requires_new_composition: true,
      restart_requires_new_session_keys: true,
      private_key_exported: false,
      enrollment_authority_moved: false,
      browser_execution_via_typed_ipc: true,
      transport_via_delegated_identity: true,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
      last_error: this.#lastError,
    });
  }
}
