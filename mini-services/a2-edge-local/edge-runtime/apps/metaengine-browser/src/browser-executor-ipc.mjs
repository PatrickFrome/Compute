import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createHostAgentServer, HostAgentClient } from './host-agent-ipc.mjs';

export const BROWSER_EXECUTOR_IPC_SCHEMA = 'metaengine.browser-executor.ipc.v1';

const BASE_OPS = Object.freeze(['BROWSER_STATUS', 'BROWSER_PLAN_EXECUTE', 'BROWSER_PLAN_CANCEL']);
const EFFECT_PREPARE_OP = 'BROWSER_EFFECT_BINDING_PREPARE';

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

function effectPreparationInput(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('browser_executor_effect_prepare_command_required');
  return Object.freeze({
    command_id: command.command_id,
    action: command.action,
    platform: command.platform ?? null,
    idempotency_key: command.idempotency_key,
    expires_at: command.expires_at,
    payload: { tab_id: command.payload?.tab_id },
  });
}

export function createBrowserExecutorServer({
  endpoint,
  sessionKey,
  browserStatus,
  browserPlanExecute,
  browserPlanCancel,
  effectBindingPrepare = null,
  netModule = undefined,
} = {}) {
  const status = requireFunction(browserStatus, 'browser_executor_status_required');
  const execute = requireFunction(browserPlanExecute, 'browser_executor_plan_execute_required');
  const cancel = requireFunction(browserPlanCancel, 'browser_executor_plan_cancel_required');
  const prepare = effectBindingPrepare == null
    ? null
    : requireFunction(effectBindingPrepare, 'browser_executor_effect_prepare_invalid');
  const allowedOps = prepare ? [...BASE_OPS, EFFECT_PREPARE_OP] : [...BASE_OPS];
  const server = createHostAgentServer({
    endpoint,
    sessionKey,
    ...(netModule ? { netModule } : {}),
    handlers: {
      BROWSER_STATUS: (payload) => status(payload),
      ...(prepare ? { [EFFECT_PREPARE_OP]: (payload) => prepare(payload?.command) } : {}),
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
        allowed_ops: [...allowedOps],
        effect_binding_preparation: prepare != null,
        effect_binding_sealing: false,
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
  prepareEffectBinding(command) {
    return this.#client.request(EFFECT_PREPARE_OP, { command: effectPreparationInput(command) });
  }
  execute(payload) { return this.#client.request('BROWSER_PLAN_EXECUTE', payload, { timeoutMs: 60000 }); }
  cancel(payload) { return this.#client.request('BROWSER_PLAN_CANCEL', payload); }
  close() { return this.#client.close(); }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-executor.ipc-client.v1',
      ipc: this.#client.snapshot(),
      allowed_ops: [...BASE_OPS, EFFECT_PREPARE_OP],
      effect_binding_preparation_payload: 'COMMAND_ID_ACTION_TAB_IDEMPOTENCY_EXPIRY_ONLY',
      effect_binding_sealing: false,
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
    replay_protection: 'SEQUENCED_EPOCH_HIGH_WATER_NO_EVICTION',
    session_key_rotation: 'REQUIRED_ON_SERVER_PROCESS_RESTART',
    allowed_ops: [...BASE_OPS, EFFECT_PREPARE_OP],
    effect_binding_preparation_payload: 'COMMAND_ID_ACTION_TAB_IDEMPOTENCY_EXPIRY_ONLY',
    effect_binding_sealing: false,
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
