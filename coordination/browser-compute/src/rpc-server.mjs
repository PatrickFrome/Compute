import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import { rotateControlToken, rpcEndpoint } from './security.mjs';

const MAX_LINE_BYTES = 1024 * 1024;

export const RPC_METHODS = Object.freeze([
  'runtime.health',
  'profile.start',
  'profile.stop',
  'profile.list',
  'context.create',
  'context.list',
  'context.close',
  'target.create',
  'target.list',
  'target.semantic_snapshot',
  'target.activate',
  'target.close',
  'action.navigate',
  'action.click',
  'action.type',
  'action.submit',
  'receipt.get',
  'receipt.verify'
]);

export const RPC_METHOD_EFFECTS = Object.freeze({
  'runtime.health': 'READ_ONLY',
  'profile.start': 'LOCAL_LIFECYCLE',
  'profile.stop': 'LOCAL_LIFECYCLE',
  'profile.list': 'READ_ONLY',
  'context.create': 'LOCAL_LIFECYCLE',
  'context.list': 'READ_ONLY',
  'context.close': 'LOCAL_LIFECYCLE',
  'target.create': 'LOCAL_LIFECYCLE',
  'target.list': 'READ_ONLY',
  'target.semantic_snapshot': 'READ_ONLY',
  'target.activate': 'LOCAL_UI',
  'target.close': 'LOCAL_LIFECYCLE',
  'action.navigate': 'ACTUATION',
  'action.click': 'ACTUATION',
  'action.type': 'ACTUATION',
  'action.submit': 'ACTUATION',
  'receipt.get': 'READ_ONLY',
  'receipt.verify': 'READ_ONLY'
});

const RPC_PARAM_KEYS = Object.freeze({
  'runtime.health': [],
  'profile.start': ['profileId'],
  'profile.stop': ['profileId'],
  'profile.list': [],
  'context.create': ['profileId', 'contextId', 'kind'],
  'context.list': ['profileId', 'includeRetired'],
  'context.close': ['profileId', 'contextId'],
  'target.create': ['profileId', 'targetId', 'contextId', 'role', 'url'],
  'target.list': ['profileId', 'includeRetired'],
  'target.semantic_snapshot': ['profileId', 'targetId', 'maxNodes', 'taskText'],
  'target.activate': ['profileId', 'targetId'],
  'target.close': ['profileId', 'targetId'],
  'action.navigate': ['profileId', 'targetId', 'actionId', 'lease', 'url', 'idempotencyKey'],
  'action.click': ['profileId', 'targetId', 'actionId', 'lease', 'semanticId', 'framePath', 'idempotencyKey'],
  'action.type': ['profileId', 'targetId', 'actionId', 'lease', 'semanticId', 'text', 'idempotencyKey'],
  'action.submit': ['profileId', 'targetId', 'actionId', 'lease', 'semanticId', 'idempotencyKey'],
  'receipt.get': ['receiptId'],
  'receipt.verify': ['receiptId']
});

export function validateRpcParams(method, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('rpc_params_invalid');
  const allowed = RPC_PARAM_KEYS[method];
  if (!allowed) throw new Error('rpc_method_forbidden');
  if (Object.keys(params).some((key) => !allowed.includes(key))) throw new Error('rpc_params_forbidden');
  return params;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function dispatch(runtime, method, params) {
  params = validateRpcParams(method, params);
  switch (method) {
    case 'runtime.health': return runtime.health();
    case 'profile.start': return runtime.startProfile({ profileId: params?.profileId });
    case 'profile.stop': return runtime.stopProfile(params?.profileId);
    case 'profile.list': return runtime.listProfiles();
    case 'context.create': return runtime.createContext({ profileId: params?.profileId, contextId: params?.contextId, kind: params?.kind });
    case 'context.list': return runtime.listContexts(params?.profileId, { includeRetired: params?.includeRetired === true });
    case 'context.close': return runtime.closeContext({ profileId: params?.profileId, contextId: params?.contextId });
    case 'target.create': return runtime.createTarget(params);
    case 'target.list': return runtime.listTargets(params?.profileId, { includeRetired: params?.includeRetired === true });
    case 'target.semantic_snapshot': return runtime.semanticSnapshot({ profileId: params?.profileId, targetId: params?.targetId, maxNodes: params?.maxNodes, taskText: params?.taskText });
    case 'target.activate': return runtime.activateTarget(params);
    case 'target.close': return runtime.closeTarget(params);
    default: throw new Error('rpc_method_forbidden');
  }
}

export async function startRpcServer(runtime) {
  const { token, file: tokenFile } = await rotateControlToken(runtime.stateRoot);
  const endpoint = rpcEndpoint(runtime.stateRoot);
  if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
  let queue = Promise.resolve();
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    let buffer = '';

    async function drain() {
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let request;
        try { request = JSON.parse(line); }
        catch (_) { socket.write(`${JSON.stringify({ ok: false, error: 'rpc_json_invalid' })}\n`); continue; }
        const id = request.id ?? null;
        try {
          if (!safeEqual(request.token, token)) throw new Error('rpc_unauthorized');
          if (!RPC_METHODS.includes(String(request.method || ''))) throw new Error('rpc_method_forbidden');
          const result = await dispatch(runtime, request.method, request.params || {});
          socket.write(`${JSON.stringify({ id, ok: true, effect_class: RPC_METHOD_EFFECTS[request.method], web_authority_effect: false, result })}\n`);
        } catch (error) {
          socket.write(`${JSON.stringify({ id, ok: false, error: String(error?.message || error) })}\n`);
        }
      }
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) return socket.destroy(new Error('rpc_frame_too_large'));
      queue = queue.then(drain, drain).catch(() => socket.destroy());
    });
  });

  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  } catch (error) {
    await fs.rm(tokenFile, { force: true }).catch(() => {});
    throw error;
  }
  if (process.platform !== 'win32') await fs.chmod(endpoint, 0o600).catch(() => {});
  return {
    endpoint,
    tokenFile,
    server,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
      await fs.rm(tokenFile, { force: true }).catch(() => {});
    }
  };
}