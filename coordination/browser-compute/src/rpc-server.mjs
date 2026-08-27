import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import { getOrCreateControlToken, rpcEndpoint } from './security.mjs';

const MAX_LINE_BYTES = 1024 * 1024;

export const RPC_METHODS = Object.freeze([
  'runtime.health',
  'profile.start',
  'profile.stop',
  'profile.list',
  'target.create',
  'target.list',
  'target.activate',
  'target.close'
]);

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function dispatch(runtime, method, params) {
  switch (method) {
    case 'runtime.health': return runtime.health();
    case 'profile.start': return runtime.startProfile(params);
    case 'profile.stop': return runtime.stopProfile(params?.profileId);
    case 'profile.list': return runtime.listProfiles();
    case 'target.create': return runtime.createTarget(params);
    case 'target.list': return runtime.listTargets(params?.profileId, { includeRetired: params?.includeRetired === true });
    case 'target.activate': return runtime.activateTarget(params);
    case 'target.close': return runtime.closeTarget(params);
    default: throw new Error('rpc_method_forbidden');
  }
}

export async function startRpcServer(runtime) {
  const token = await getOrCreateControlToken(runtime.stateRoot);
  const endpoint = rpcEndpoint(runtime.stateRoot);
  if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) return socket.destroy(new Error('rpc_frame_too_large'));
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
          socket.write(`${JSON.stringify({ id, ok: true, result })}\n`);
        } catch (error) {
          socket.write(`${JSON.stringify({ id, ok: false, error: String(error?.message || error) })}\n`);
        }
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  if (process.platform !== 'win32') await fs.chmod(endpoint, 0o600).catch(() => {});
  return { endpoint, server, async close() { await new Promise((resolve) => server.close(resolve)); if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {}); } };
}
