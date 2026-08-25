import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const HOST = '127.0.0.1';
const PUBLIC_PORT = Number(process.env.A2_BRIDGE_PORT || 8765);
const INTERNAL_PORT = Number(process.env.A2_BRIDGE_INTERNAL_PORT || (PUBLIC_PORT + 1));
const SECRET = String(process.env.A2_BRIDGE_SHARED_SECRET || '');

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
  const body = JSON.stringify({ error: 'bridge_pairing_required' });
  res.writeHead(401, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
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
    const body = JSON.stringify({ error: 'bridge_internal_unavailable' });
    res.writeHead(502, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store'
    });
    res.end(body);
  });
  req.pipe(upstream);
}

process.env.A2_BRIDGE_HOST = HOST;
process.env.A2_BRIDGE_PORT = String(INTERNAL_PORT);
process.env.A2_BRIDGE_INTERNAL = '1';
await import('./run.mjs');

const gate = http.createServer((req, res) => {
  if (isReadOnlyDashboard(req)) return proxy(req, res);
  if (!secretMatches(req.headers['x-a2-chat-bridge-secret'])) return reject(res);
  return proxy(req, res);
});

gate.listen(PUBLIC_PORT, HOST, () => {
  console.log(`METAENGINE A2 Chat Bridge secure endpoint http://${HOST}:${PUBLIC_PORT}`);
  console.log(`internal scheduler http://${HOST}:${INTERNAL_PORT}`);
});
