import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createReceiptRecorderFromEnv } from './receipt-recorder.mjs';

const HOST = '127.0.0.1';
const PUBLIC_PORT = Number(process.env.A2_BRIDGE_PORT || 8765);
const INTERNAL_PORT = Number(process.env.A2_BRIDGE_INTERNAL_PORT || (PUBLIC_PORT + 1));
const SECRET = String(process.env.A2_BRIDGE_SHARED_SECRET || '');
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const BLOCKED_LEASE_RETRY_TTL_MS = Math.max(1000, Number(process.env.A2_BRIDGE_RECEIPT_RETRY_TTL_MS || 30000));

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Refusing to start A2 Chat Bridge without SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
if (SECRET.length < 32) {
  console.error('Refusing to start A2 Chat Bridge without A2_BRIDGE_SHARED_SECRET (32+ chars).');
  process.exit(2);
}
if (!Number.isInteger(PUBLIC_PORT) || PUBLIC_PORT < 1024 || PUBLIC_PORT > 65534) {
  console.error('Invalid A2_BRIDGE_PORT.');
  process.exit(2);
}
if (!Number.isInteger(INTERNAL_PORT) || INTERNAL_PORT < 1024 || INTERNAL_PORT > 65535 || INTERNAL_PORT === PUBLIC_PORT) {
  console.error('Invalid A2_BRIDGE_INTERNAL_PORT.');
  process.exit(2);
}

const receiptRecorder = createReceiptRecorderFromEnv(process.env);
// Only commands that the internal scheduler has leased but the proxy has NOT
// returned to the browser because REQUIRED receipt persistence failed belong
// here. This cache is intentionally process-local and short-lived: it removes
// transient receipt-store delay without claiming active-lease restart survival.
const blockedLeaseByClient = new Map();

function secretMatches(candidate) {
  const supplied = Buffer.from(String(candidate || ''), 'utf8');
  const expected = Buffer.from(SECRET, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isReadOnlyDashboard(req) {
  if (req.method !== 'GET') return false;
  const path = new URL(req.url || '/', `http://${HOST}:${PUBLIC_PORT}`).pathname;
  return path === '/' || path === '/v1/status';
}

function reject(res) {
  return json(res, 401, { error: 'bridge_pairing_required' });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function sanitizedHeaders(headers = {}, body = null) {
  const next = { ...headers, host: `${HOST}:${INTERNAL_PORT}` };
  delete next['x-a2-chat-bridge-secret'];
  delete next['content-length'];
  delete next['transfer-encoding'];
  delete next.connection;
  if (body) next['content-length'] = String(body.length);
  return next;
}

function responseHeaders(headers = {}, body) {
  const next = { ...headers };
  delete next['content-length'];
  delete next['transfer-encoding'];
  delete next.connection;
  next['content-length'] = String(body.length);
  return next;
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('bridge_request_body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonBuffer(buffer) {
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString('utf8'));
}

function requestInternal({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, rejectRequest) => {
    const upstream = http.request({
      hostname: HOST,
      port: INTERNAL_PORT,
      method,
      path,
      headers: sanitizedHeaders(headers, body)
    }, (upstreamRes) => {
      const chunks = [];
      upstreamRes.on('data', (chunk) => chunks.push(chunk));
      upstreamRes.on('end', () => resolve({
        status: upstreamRes.statusCode || 502,
        headers: upstreamRes.headers,
        body: Buffer.concat(chunks)
      }));
    });
    upstream.on('error', rejectRequest);
    if (body?.length) upstream.write(body);
    upstream.end();
  });
}

function relayBuffered(res, upstream) {
  res.writeHead(upstream.status, responseHeaders(upstream.headers, upstream.body));
  res.end(upstream.body);
}

function proxy(req, res) {
  const headers = { ...req.headers, host: `${HOST}:${INTERNAL_PORT}` };
  delete headers['x-a2-chat-bridge-secret'];
  const upstream = http.request({
    hostname: HOST,
    port: INTERNAL_PORT,
    method: req.method,
    path: req.url,
    headers
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy(error);
    return json(res, 502, { error: 'bridge_internal_unavailable' });
  });
  req.pipe(upstream);
}

function requestClientId(req) {
  return String(req.headers['x-a2-chat-bridge-client'] || 'dashboard').slice(0, 160);
}

function blockedLeaseFor(clientId) {
  const row = blockedLeaseByClient.get(clientId);
  if (!row) return null;
  if (Date.now() - row.blocked_at_ms > BLOCKED_LEASE_RETRY_TTL_MS) {
    blockedLeaseByClient.delete(clientId);
    return null;
  }
  return row.command;
}

async function persistLeaseOrBlock(clientId, command) {
  try {
    const receipt = await receiptRecorder.recordLease(command);
    if (receiptRecorder.required && receipt?.persisted !== true) {
      throw new Error('receipt_lease_not_persisted');
    }
    blockedLeaseByClient.delete(clientId);
    return receipt;
  } catch (error) {
    if (receiptRecorder.required) {
      blockedLeaseByClient.set(clientId, { command, blocked_at_ms: Date.now() });
    }
    throw error;
  }
}

async function recoverReceiptLease(commandId) {
  const statusResponse = await requestInternal({ method: 'GET', path: '/v1/status' });
  if (statusResponse.status !== 200) throw new Error(`receipt_status_recovery_http_${statusResponse.status}`);
  const status = parseJsonBuffer(statusResponse.body);
  const command = Array.isArray(status?.queue)
    ? status.queue.find((item) => String(item?.command_id || '') === String(commandId))
    : null;
  if (!command) throw new Error(`receipt_lease_recovery_command_missing:${commandId}`);
  const peer = status?.peers?.[command.target_platform];
  if (!peer?.url) throw new Error(`receipt_lease_recovery_target_missing:${command.target_platform}`);
  receiptRecorder.noteSnapshot(command.target_platform, {
    url: peer.url,
    message_count: peer.message_count || 0,
    generating: peer.generating === true
  });
  const recovered = await receiptRecorder.recordLease(command);
  if (receiptRecorder.required && recovered?.persisted !== true) {
    throw new Error('receipt_lease_recovery_not_persisted');
  }
}

async function interceptSnapshot(req, res) {
  const body = await readBody(req);
  const parsed = parseJsonBuffer(body);
  const platform = String(parsed?.platform || parsed?.snapshot?.platform || '');
  if (parsed?.snapshot?.url && ['CHATGPT', 'GLM_ZAI'].includes(platform)) {
    receiptRecorder.noteSnapshot(platform, parsed.snapshot);
  }
  const upstream = await requestInternal({ method: req.method, path: req.url, headers: req.headers, body });
  return relayBuffered(res, upstream);
}

async function interceptNextCommand(req, res) {
  const clientId = requestClientId(req);
  if (receiptRecorder.required) {
    const blocked = blockedLeaseFor(clientId);
    if (blocked) {
      await persistLeaseOrBlock(clientId, blocked);
      // The browser has never seen this command yet. After idempotent receipt
      // persistence succeeds, return the exact already-leased command directly
      // instead of waiting for the internal lease timeout.
      return json(res, 200, { command: blocked, receipt_retry: true });
    }
  }

  const upstream = await requestInternal({ method: req.method, path: req.url, headers: req.headers });
  if (upstream.status >= 200 && upstream.status < 300 && receiptRecorder.enabled) {
    const parsed = parseJsonBuffer(upstream.body);
    if (parsed?.command) {
      await persistLeaseOrBlock(clientId, parsed.command);
    }
  }
  return relayBuffered(res, upstream);
}

async function interceptCommandResult(req, res, commandId) {
  const body = await readBody(req);
  const parsed = parseJsonBuffer(body);
  if (receiptRecorder.enabled) {
    if (!receiptRecorder.hasLease(commandId)) await recoverReceiptLease(commandId);
    const receipt = await receiptRecorder.recordResult(commandId, parsed);
    if (receiptRecorder.required && receipt?.persisted !== true) {
      throw new Error('receipt_result_not_persisted');
    }
  }
  // Result persistence deliberately happens before forwarding to the scheduler.
  // REQUIRED mode therefore cannot acknowledge daemon completion if receipt
  // storage failed; a retry reuses the immutable command/event receipt.
  const upstream = await requestInternal({ method: req.method, path: req.url, headers: req.headers, body });
  return relayBuffered(res, upstream);
}

process.env.A2_BRIDGE_HOST = HOST;
process.env.A2_BRIDGE_PORT = String(INTERNAL_PORT);
process.env.A2_BRIDGE_INTERNAL = '1';
await import('./run.mjs');

const gate = http.createServer(async (req, res) => {
  if (isReadOnlyDashboard(req)) return proxy(req, res);
  if (!secretMatches(req.headers['x-a2-chat-bridge-secret'])) return reject(res);

  const url = new URL(req.url || '/', `http://${HOST}:${PUBLIC_PORT}`);
  try {
    if (req.method === 'POST' && url.pathname === '/v1/snapshots') {
      return await interceptSnapshot(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/v1/commands/next') {
      return await interceptNextCommand(req, res);
    }
    const resultMatch = url.pathname.match(/^\/v1\/commands\/([^/]+)\/result$/);
    if (req.method === 'POST' && resultMatch) {
      return await interceptCommandResult(req, res, decodeURIComponent(resultMatch[1]));
    }
    return proxy(req, res);
  } catch (error) {
    const message = String(error?.message || error);
    if (receiptRecorder.required && message.startsWith('receipt_')) {
      return json(res, 503, { error: 'receipt_persistence_required', detail: message });
    }
    return json(res, 502, { error: 'bridge_proxy_failure', detail: message });
  }
});

gate.listen(PUBLIC_PORT, HOST, () => {
  console.log(`METAENGINE A2 Chat Bridge secure endpoint http://${HOST}:${PUBLIC_PORT}`);
  console.log(`internal scheduler http://${HOST}:${INTERNAL_PORT}`);
  console.log(`receipt persistence mode=${receiptRecorder.mode}`);
});
