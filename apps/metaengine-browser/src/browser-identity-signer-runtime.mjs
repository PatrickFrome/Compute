import { SupervisorIdentityDelegationSigner } from './supervisor-identity-delegation.mjs';
import {
  createSupervisorIdentitySignerServer,
  supervisorIdentitySignerEndpoint,
} from './supervisor-identity-delegation-ipc.mjs';

export const BROWSER_IDENTITY_SIGNER_RUNTIME_SCHEMA = 'metaengine.browser-identity-signer-runtime.v1';

function clipError(error) {
  return String(error?.message || error).slice(0, 240);
}

export class BrowserIdentitySignerRuntime {
  #identity;
  #userDataPath;
  #sessionKey;
  #serverFactory;
  #endpointFactory;
  #server = null;
  #endpoint = null;
  #state = 'STOPPED';
  #lastError = null;

  constructor({
    identity,
    userDataPath,
    sessionKey,
    serverFactory = createSupervisorIdentitySignerServer,
    endpointFactory = supervisorIdentitySignerEndpoint,
  } = {}) {
    if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
      throw new Error('browser_identity_signer_identity_required');
    }
    if (!String(userDataPath || '')) throw new Error('browser_identity_signer_user_data_path_required');
    if (!String(sessionKey || '')) throw new Error('browser_identity_signer_session_key_required');
    if (typeof serverFactory !== 'function') throw new Error('browser_identity_signer_server_factory_invalid');
    if (typeof endpointFactory !== 'function') throw new Error('browser_identity_signer_endpoint_factory_invalid');
    this.#identity = identity;
    this.#userDataPath = String(userDataPath);
    this.#sessionKey = String(sessionKey);
    this.#serverFactory = serverFactory;
    this.#endpointFactory = endpointFactory;
  }

  async start() {
    if (this.#state === 'READY') return this.snapshot();
    if (this.#state === 'STARTING') throw new Error('browser_identity_signer_start_in_progress');
    this.#state = 'STARTING';
    this.#lastError = null;
    try {
      this.#endpoint = this.#endpointFactory({ userDataPath: this.#userDataPath });
      const signer = new SupervisorIdentityDelegationSigner({ identity: this.#identity });
      this.#server = this.#serverFactory({ endpoint: this.#endpoint, sessionKey: this.#sessionKey, signer });
      if (!this.#server || typeof this.#server.start !== 'function' || typeof this.#server.close !== 'function') {
        throw new Error('browser_identity_signer_server_invalid');
      }
      await this.#server.start();
      this.#state = 'READY';
      return this.snapshot();
    } catch (error) {
      const primaryError = clipError(error);
      this.#lastError = primaryError;
      this.#state = 'FAILED';
      if (this.#server && typeof this.#server.close === 'function') {
        try {
          await this.#server.close();
          this.#server = null;
        } catch (cleanupError) {
          this.#lastError = `${primaryError};cleanup:${clipError(cleanupError)}`.slice(0, 240);
        }
      } else {
        this.#server = null;
      }
      throw error;
    }
  }

  async stop() {
    if (!this.#server) {
      this.#state = 'STOPPED';
      this.#lastError = null;
      return this.snapshot();
    }
    const server = this.#server;
    try {
      await server.close();
      this.#server = null;
      this.#state = 'STOPPED';
      this.#lastError = null;
    } catch (error) {
      this.#state = 'FAILED';
      this.#lastError = clipError(error);
      throw error;
    }
    return this.snapshot();
  }

  snapshot() {
    const server = this.#server?.snapshot?.() || null;
    return Object.freeze({
      schema: BROWSER_IDENTITY_SIGNER_RUNTIME_SCHEMA,
      state: this.#state,
      endpoint_kind: server?.endpoint_kind || (process.platform === 'win32' ? 'WINDOWS_NAMED_PIPE' : 'LOCAL_SOCKET'),
      signer_server: server ? structuredClone(server) : null,
      session_key_exposed: false,
      private_key_exported: false,
      enrollment_authority: false,
      browser_control_authority: false,
      arbitrary_origin_signing: false,
      last_error: this.#lastError,
      authority_effect: false,
    });
  }
}
