import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import { ComputePlanningBrokerService } from './planning-broker-service.mjs';
import { rotateControlToken, rpcEndpoint } from './security.mjs';
import { ComputeWebMcpService } from './webmcp-service.mjs';

const MAX_LINE_BYTES = 1024 * 1024;

export const RPC_METHODS = Object.freeze([
  'runtime.health', 'profile.start', 'profile.stop', 'profile.list',
  'context.create', 'context.list', 'context.close',
  'target.create', 'target.list',
  'perception.snapshot', 'webmcp.snapshot', 'webmcp.catalog', 'webmcp.describe',
  'planning.lookup', 'planning.tools.search', 'planning.context', 'planning.promote', 'planning.abort', 'planning.stats',
  'target.activate', 'target.close'
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
  'perception.snapshot': 'READ_ONLY',
  'webmcp.snapshot': 'READ_ONLY',
  'webmcp.catalog': 'READ_ONLY',
  'webmcp.describe': 'READ_ONLY',
  'planning.lookup': 'LOCAL_COORDINATION',
  'planning.tools.search': 'LOCAL_COORDINATION',
  'planning.context': 'LOCAL_COORDINATION',
  'planning.promote': 'LOCAL_COORDINATION',
  'planning.abort': 'LOCAL_COORDINATION',
  'planning.stats': 'READ_ONLY',
  'target.activate': 'LOCAL_UI',
  'target.close': 'LOCAL_LIFECYCLE'
});

const RPC_PARAM_KEYS = Object.freeze({
  'runtime.health': [],
  'profile.start': ['profileId'],
  'profile.stop': ['profileId'],
  'profile.list': [],
  'context.create': ['profileId', 'contextId'],
  'context.list': ['profileId', 'includeRetired'],
  'context.close': ['profileId', 'contextId'],
  'target.create': ['profileId', 'targetId', 'contextId', 'role', 'url'],
  'target.list': ['profileId', 'includeRetired'],
  'perception.snapshot': ['profileId', 'targetId'],
  'webmcp.snapshot': ['profileId', 'targetId'],
  'webmcp.catalog': ['profileId', 'targetId'],
  'webmcp.describe': ['profileId', 'targetId', 'toolRef'],
  'planning.lookup': ['profileId', 'targetId', 'intentId', 'actionKind'],
  'planning.tools.search': ['profileId', 'targetId', 'flightId', 'leaseToken', 'query'],
  'planning.context': ['profileId', 'targetId', 'flightId', 'leaseToken', 'surface'],
  'planning.promote': ['profileId', 'targetId', 'flightId', 'leaseToken', 'candidateRef'],
  'planning.abort': ['profileId', 'flightId', 'leaseToken', 'reasonCode'],
  'planning.stats': ['profileId'],
  'target.activate': ['profileId', 'targetId'],
  'target.close': ['profileId', 'targetId']
});

const CONCURRENT_METHODS = new Set([
  'perception.snapshot', 'webmcp.snapshot', 'webmcp.catalog', 'webmcp.describe',
  'planning.lookup', 'planning.tools.search', 'planning.context', 'planning.promote', 'planning.abort', 'planning.stats'
]);

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

async function dispatch(runtime, planning, webmcp, method, params) {
  params = validateRpcParams(method, params);
  switch (method) {
    case 'runtime.health': return runtime.health();
    case 'profile.start': return runtime.startProfile({ profileId: params?.profileId });
    case 'profile.stop': return runtime.stopProfile(params?.profileId);
    case 'profile.list': return runtime.listProfiles();
    case 'context.create': return runtime.createContext(params);
    case 'context.list': return runtime.listContexts(params?.profileId, { includeRetired: params?.includeRetired === true });
    case 'context.close': return runtime.closeContext(params);
    case 'target.create': return runtime.createTarget(params);
    case 'target.list': return runtime.listTargets(params?.profileId, { includeRetired: params?.includeRetired === true });
    case 'perception.snapshot': return runtime.snapshotTarget(params);
    case 'webmcp.snapshot': return webmcp.snapshot(params);
    case 'webmcp.catalog': return webmcp.catalog(params);
    case 'webmcp.describe': return webmcp.describe(params);
    case 'planning.lookup': return planning.lookup(params);
    case 'planning.tools.search': return planning.searchTools(params);
    case 'planning.context': return planning.context(params);
    case 'planning.promote': return planning.promote(params);
    case 'planning.abort': return planning.abort(params);
    case 'planning.stats': return planning.stats(params);
    case 'target.activate': return runtime.activateTarget(params);
    case 'target.close': return runtime.closeTarget(params);
    default: throw new Error('rpc_method_forbidden');
  }
}

export async function startRpcServer(runtime) {
  const { token, file: tokenFile } = await rotateControlToken(runtime.stateRoot);
  const endpoint = rpcEndpoint(runtime.stateRoot);
  const webmcp = new ComputeWebMcpService(runtime);
  const planning = new ComputePlanningBrokerService(runtime, { webMcpService: webmcp });
  if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
  let effectQueue = Promise.resolve();
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    let buffer = '';
    let socketQueue = Promise.resolve();
    async function respond(request, id) {
      try {
        if (!safeEqual(request.token, token)) throw new Error('rpc_unauthorized');
        if (!RPC_METHODS.includes(String(request.method || ''))) throw new Error('rpc_method_forbidden');
        const result = await dispatch(runtime, planning, webmcp, request.method, request.params || {});
        socket.write(`${JSON.stringify({ id, ok: true, effect_class: RPC_METHOD_EFFECTS[request.method], web_authority_effect: false, result })}\n`);
      } catch (error) {
        socket.write(`${JSON.stringify({ id, ok: false, error: String(error?.message || error) })}\n`);
      }
    }
    function drain() {
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let request;
        try { request = JSON.parse(line); }
        catch (_) { socket.write(`${JSON.stringify({ ok: false, error: 'rpc_json_invalid' })}\n`); continue; }
        const id = request.id ?? null;
        const execute = () => respond(request, id);
        const schedule = CONCURRENT_METHODS.has(request.method) ? execute : () => {
          const job = effectQueue.then(execute, execute);
          effectQueue = job.catch(() => {});
          return job;
        };
        socketQueue = socketQueue.then(schedule, schedule).catch(() => socket.destroy());
      }
    }
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) return socket.destroy(new Error('rpc_frame_too_large'));
      try { drain(); } catch (_) { socket.destroy(); }
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
    endpoint, tokenFile, server,
    async close() {
      planning.clear();
      await new Promise((resolve) => server.close(resolve));
      if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
      await fs.rm(tokenFile, { force: true }).catch(() => {});
    }
  };
}
