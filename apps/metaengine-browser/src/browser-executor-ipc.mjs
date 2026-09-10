import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createHostAgentServer, HostAgentClient } from './host-agent-ipc.mjs';

export const BROWSER_EXECUTOR_IPC_SCHEMA = 'metaengine.browser-executor.ipc.v1';

function endpointHash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 24);
}

export function browserExecutorEndpoint({ userDataPath, platform = process.platform } = {}) {
  const material = path.resolve(String(userDataPath || os.tmpdir()));
  const suffix = endpointHash(material);
  if (platform === 'win32') return `\\\\.\\pipe\\metaengine-browser-executor-${suffix}`;
  return path.join(os.tmpdir(), `metaengine-browser-executor-${suffix}.sock`);
}

function requireFunction(value, code) {
  if (typeof value !== 'function') throw new Error(code);
  return value;
}

export function createBrowserExecutorServer({
  endpoint,
  sessionKey,
  browserStatus,
  browserPlanExecute,
  browserPlanCancel,
  netModule = undefined,
} = {}) {
  const status = requireFunction(browserStatus, 'browser_executor_status_required');
  const execute = requireFunction(browserPlanExecute, 'browser_executor_plan_execute_required');
  const cancel = requireFunction(browserPlanCancel, 'browser_executor_plan_cancel_required');
  const server = createHostAgentServer({
    endpoint,
    sessionKey,
    ...(netModule ? { netModule } : {}),
    handlers: {
      BROWSER_STATUS: (payload) => status(payload),
      BROWSER_PLAN_EXECUTE: (payload) => execute(payload),
      BROWSER_PLAN_CANCEL: (payload) => cancel(payload),
    },
  });

  return Object.freeze({
    start: () => server.start(),
    close: () => server.close(),
    snapshot() {
      return Object.freeze({
        schema: BROWSER_EXECUTOR_IPC_SCHEMA,
        ipc: server.snapshot(),
        allowed_ops: ['BROWSER_STATUS', 'BROWSER_PLAN_EXECUTE', 'BROWSER_PLAN_CANCEL'],
        control_ops: false,
        development_ops: false,
        command_leasing: false,
        supervisor_identity: false,
        raw_shell: false,
        raw_cdp: false,
        arbitrary_eval: false,
        authority_effect: false,
      });
    },
  });
}

export class BrowserExecutorClient {
  #client;

  constructor({ endpoint, sessionKey, netModule = undefined } = {}) {
    this.#client = new HostAgentClient({ endpoint, sessionKey, ...(netModule ? { netModule } : {}) });
  }

  connect() { return this.#client.connect(); }
  status(payload = {}) { return this.#client.request('BROWSER_STATUS', payload); }
  execute(payload) { return this.#client.request('BROWSER_PLAN_EXECUTE', payload, { timeoutMs: 60000 }); }
  cancel(payload) { return this.#client.request('BROWSER_PLAN_CANCEL', payload); }
  close() { return this.#client.close(); }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-executor.ipc-client.v1',
      ipc: this.#client.snapshot(),
      allowed_ops: ['BROWSER_STATUS', 'BROWSER_PLAN_EXECUTE', 'BROWSER_PLAN_CANCEL'],
      command_leasing: false,
      supervisor_identity: false,
      raw_shell: false,
      raw_cdp: false,
      arbitrary_eval: false,
      authority_effect: false,
    });
  }
}

export function browserExecutorIpcManifest() {
  return Object.freeze({
    schema: BROWSER_EXECUTOR_IPC_SCHEMA,
    transport: process.platform === 'win32' ? 'WINDOWS_NAMED_PIPE' : 'LOCAL_SOCKET',
    authentication: 'HMAC_SHA256_SESSION_KEY',
    replay_protection: 'BOUNDED_NONCE_WINDOW',
    allowed_ops: ['BROWSER_STATUS', 'BROWSER_PLAN_EXECUTE', 'BROWSER_PLAN_CANCEL'],
    control_ops: false,
    development_ops: false,
    command_leasing: false,
    supervisor_identity: false,
    raw_shell: false,
    raw_cdp: false,
    arbitrary_eval: false,
    authority_effect: false,
  });
}
