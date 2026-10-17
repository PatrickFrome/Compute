import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { readJsonBody, readBoundedBody, RequestBodyError, MAX_REQUEST_BODY_BYTES } from '../src/request-body.ts';

let importId = 0;
async function authModule(token, origins = '') {
  const beforeToken = process.env.ME2_API_TOKEN;
  const beforeOrigins = process.env.ME2_ALLOWED_ORIGINS;
  if (token === undefined) delete process.env.ME2_API_TOKEN; else process.env.ME2_API_TOKEN = token;
  process.env.ME2_ALLOWED_ORIGINS = origins;
  const module = await import(`../src/auth.ts?security-case=${++importId}`);
  return { module, restore() {
    if (beforeToken === undefined) delete process.env.ME2_API_TOKEN; else process.env.ME2_API_TOKEN = beforeToken;
    if (beforeOrigins === undefined) delete process.env.ME2_ALLOWED_ORIGINS; else process.env.ME2_ALLOWED_ORIGINS = beforeOrigins;
  } };
}
const requestShape = (headers = {}, method = 'POST', url = '/exec', peer = '127.0.0.1') => ({ headers, method, url, socket: { remoteAddress: peer } });

test('unset token closes private REST, WS and screencast even on loopback', async () => {
  const { module: auth, restore } = await authModule(undefined);
  try {
    for (const peer of ['127.0.0.1', '::1', '192.0.2.1']) assert.equal(auth.authorizeRequest(requestShape({}, 'POST', '/exec', peer)).status, 403);
    assert.equal(auth.authorizeHandshake({ headers: {}, address: '127.0.0.1' }).status, 403);
  } finally { restore(); }
});

test('local proxy, hostile Host and forged loopback Origin never replace a bearer', async () => {
  const { module: auth, restore } = await authModule('fixture-bearer');
  try {
    for (const headers of [{}, { host: 'attacker.invalid' }, { origin: 'http://localhost:7777' }, { 'x-forwarded-for': '127.0.0.1' }]) {
      assert.equal(auth.authorizeRequest(requestShape(headers)).status, 401);
      assert.equal(auth.authorizeHandshake({ headers, address: '127.0.0.1' }).status, 401);
    }
    assert.equal(auth.authorizeRequest(requestShape({ authorization: 'Bearer wrong' })).status, 401);
    assert.equal(auth.authorizeRequest(requestShape({ authorization: ['Bearer fixture-bearer', 'Bearer wrong'] })).status, 401);
    assert.equal(auth.authorizeRequest(requestShape({ authorization: ['Bearer wrong'], 'x-me2-token': 'fixture-bearer' })).status, 401);
    assert.equal(auth.authorizeRequest(requestShape({ authorization: 'Bearer fixture-bearer' })).ok, true);
    assert.equal(auth.authorizeHandshake({ headers: {}, address: '127.0.0.1', auth: { token: 'fixture-bearer' } }).ok, true);
  } finally { restore(); }
});

test('public exemption is bound to method and path; Origin also needs an explicit allowlist', async () => {
  const { module: auth, restore } = await authModule('fixture-bearer', 'https://allowed.example');
  try {
    for (const path of ['/health', '/ui']) {
      assert.equal(auth.authorizeRequest(requestShape({}, 'GET', path)).ok, true);
      assert.equal(auth.authorizeRequest(requestShape({}, 'POST', path)).status, 401);
    }
    assert.equal(auth.authorizeRequest(requestShape({}, 'POST', '/hooks/github')).via, 'hmac_webhook');
    assert.equal(auth.authorizeRequest(requestShape({}, 'GET', '/hooks/github')).status, 401);
    assert.equal(auth.authorizeRequest(requestShape({ authorization: 'Bearer fixture-bearer', origin: 'http://localhost:9999' })).status, 403);
    const headers = { authorization: 'Bearer fixture-bearer', origin: 'https://allowed.example' };
    assert.equal(auth.authorizeRequest(requestShape(headers)).ok, true);
    assert.equal(auth.corsHeadersFor({ headers })['Access-Control-Allow-Origin'], 'https://allowed.example');
    assert.equal(auth.authorizeRequest(requestShape({ origin: 'https://allowed.example' })).status, 401);
  } finally { restore(); }
});

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return server.address().port;
}
function send(port, { method = 'POST', path = '/', headers = {}, chunks = ['{}'] } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const received = [];
      res.on('data', (chunk) => received.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(received).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('real HTTP body reader rejects declared and chunked excess, malformed JSON and arrays', async (t) => {
  const port = await listen(t, async (req, res) => {
    try {
      const first = await readJsonBody(req);
      const second = await readJsonBody(req);
      assert.deepEqual(first, second);
      res.writeHead(200); res.end(JSON.stringify(first));
    } catch (error) { res.writeHead(error instanceof RequestBodyError ? error.statusCode : 500); res.end(error.message); }
  });
  const tooLarge = Buffer.alloc(MAX_REQUEST_BODY_BYTES + 1, 32);
  assert.equal((await send(port, { headers: { 'Content-Length': tooLarge.length }, chunks: [tooLarge] })).status, 413);
  assert.equal((await send(port, { chunks: [tooLarge.subarray(0, 600000), tooLarge.subarray(600000)] })).status, 413);
  for (const body of ['{', '[]', 'null', '1']) assert.equal((await send(port, { chunks: [body] })).status, 400);
  const atLimit = JSON.stringify({ value: 'x'.repeat(MAX_REQUEST_BODY_BYTES - 12) });
  assert.equal(Buffer.byteLength(atLimit), MAX_REQUEST_BODY_BYTES);
  assert.equal((await send(port, { chunks: [atLimit] })).status, 200);
  const utf8 = JSON.stringify({ value: 'я'.repeat(MAX_REQUEST_BODY_BYTES / 2) });
  assert.equal((await send(port, { chunks: [utf8] })).status, 413);
});

test('bounded webhook reader preserves exact raw bytes for signature verification', async (t) => {
  const expected = Buffer.from('{ "unicode": "\u044f", "spacing": true }\n');
  const port = await listen(t, async (req, res) => {
    const bytes = await readBoundedBody(req);
    assert.deepEqual(bytes, expected);
    assert.equal(await readBoundedBody(req), bytes);
    res.end('ok');
  });
  assert.equal((await send(port, { chunks: [expected.subarray(0, 5), expected.subarray(5)] })).status, 200);
});

// Exercise the production router with hermetic owner dependencies. Importing
// index.ts itself would start the legacy daemon and its module-level DB work.
const indexSource = stripTypeScriptTypes(readFileSync(new URL('../index.ts', import.meta.url), 'utf8'), { mode: 'strip' });
const routerStart = indexSource.indexOf('async function restHandler(');
const routerEnd = indexSource.indexOf('// B3: каждый REST-запрос', routerStart);
assert.ok(routerStart >= 0 && routerEnd > routerStart);
const makeRouter = new Function('dependencies', `with (dependencies) { ${indexSource.slice(routerStart, routerEnd)}; return restHandler; }`);

test('production router never runs eval from GET, and read-only probe rejects POST eval', async (t) => {
  const { module: auth, restore } = await authModule('fixture-bearer');
  t.after(restore);
  for (const mode of ['probe', 'qualification', 'production']) {
    let runs = 0;
    const handler = makeRouter({
      REST_PORT: 0, PROBE_MODE: mode !== 'production', QUALIFICATION_MODE: mode === 'qualification', PROBE_BLOCKED_GET_PATHS: new Set(),
      PROBE_POLICY: { read_only: mode === 'probe' },
      ...auth, readBody: readJsonBody, readBoundedBody, RequestBodyError,
      json(res, status, body) { res.writeHead(status); res.end(JSON.stringify(body)); },
      VERSION: 'fixture', evalStatus() { return { ok: true, runs_total: runs }; },
      evalRun() { runs++; return { ok: true, verdict: 'PASS' }; }, benchResetRings() {}, benchSuspend() {},
    });
    const port = await listen(t, handler);
    const headers = { Authorization: 'Bearer fixture-bearer' };
    assert.equal((await send(port, { method: 'GET', path: '/eval?run=1', headers, chunks: [] })).status, 200);
    assert.equal(runs, 0);
    const post = await send(port, { path: '/eval/run', headers });
    assert.equal(post.status, mode === 'qualification' ? 200 : 403);
    assert.equal(runs, mode === 'qualification' ? 1 : 0);
    const large = Buffer.alloc(MAX_REQUEST_BODY_BYTES + 1, 32);
    assert.equal((await send(port, { path: '/exec', headers, chunks: [large] })).status, mode === 'production' ? 413 : 403);
    assert.equal(runs, mode === 'qualification' ? 1 : 0);
  }
});
