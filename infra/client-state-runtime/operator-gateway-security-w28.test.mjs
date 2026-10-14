// W28: source-only real HTTP falsification of the existing W3 Gateway.
// All peers are ephemeral Node loopback fixtures; no PostgreSQL/Browser/Guardian effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { startOperatorReadOnlyGateway } from './operator-readonly-gateway.mjs';

const key = 'w'.repeat(64);
const ownerId = 'owner-w28';
const projectId = 'project-w28';
const runId = 'run-w28';
const now = () => new Date().toISOString();
const identity = (overrides = {}) => ({
  source: 'OWN_POSTGRES_READBACK', proven: true, owner_id: ownerId,
  project_id: projectId, run_id: runId, owner_epoch: 3,
  event_seq: 18, observed_at: now(), ...overrides,
});
const status = (overrides = {}) => ({
  source: 'OWN_POSTGRES_READBACK', proven: true, owner_id: ownerId,
  project_id: projectId, run_id: runId, owner_epoch: 3,
  state: 'RUNNING', event_seq: 17, observed_at: now(), ...overrides,
});
const batch = (overrides = {}) => ({
  source: 'OWN_POSTGRES_READBACK', proven: true, owner_id: ownerId,
  project_id: projectId, run_id: runId, owner_epoch: 3,
  watermark_event_seq: 18, observed_at: now(),
  events: [{ event_seq: 18, kind: 'PROVEN', occurred_at: now(),
    proof_sha256: 'a'.repeat(64), task_id: null }], ...overrides,
});

async function start(options = {}) {
  const owner = { instance_id: ownerId, mode: 'LOCAL_POSTGRES' };
  const context = {
    schema: 'metaengine.operator.context.v1', storage: 'OWN_POSTGRES_ONLY',
    scope: 'READ_ONLY', authority_effect: false, scheduler_authority: false,
    cloud_database_dependency: false, remote_fallback_allowed: false,
    generated_at: now(), planes: {},
  };
  const upstream = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url === '/health' ? owner : context));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const runtime = await startOperatorReadOnlyGateway({
    apiKey: key, ownerId, upstreamBaseUrl: 'http://127.0.0.1:' + upstream.address().port,
    ...options,
  });
  const get = async path => fetch(runtime.address + path, {
    headers: { apikey: key },
  });
  return { get, owner, runtime, async stop() {
    await runtime.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  } };
}

test('W28 GET routes reject HTTP absolute-form and encoded route aliases', async () => {
  const f = await start();
  try {
    const address = f.runtime.server.address();
    const forged = await new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1', port: address.port,
        path: 'http://untrusted.invalid/operator/v1/context',
        headers: { host: '127.0.0.1:' + address.port, apikey: key },
      }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(forged, 400);
    assert.equal((await f.get('/operator/v1/%63ontext')).status, 404);
    assert.equal((await f.get('/operator/v1/a/../context')).status, 200);
    // WHATWG fetch normalizes dot segments on the client. Raw request is tested below.
    const dot = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: address.port,
        path: '/operator/v1/a/../context',
        headers: { host: '127.0.0.1:' + address.port, apikey: key },
      }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(dot, 404);
  } finally { await f.stop(); }
});

test('W28 Owner health identity changes while an adapter runs -> UNKNOWN/503', async () => {
  let f;
  f = await start({
    readRunIdentity: async () => identity(),
    readRunStatus: async () => { f.owner.instance_id = 'replaced-owner'; return status(); },
  });
  try {
    const res = await f.get('/operator/v1/run_status?run_id=' + runId);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.state, 'UNKNOWN');
    assert.equal(body.authority_effect, false);
    assert.equal(body.error, 'owner_identity_changed');
  } finally { await f.stop(); }
});

test('W28 run or epoch change between readback and postflight refuses success', async () => {
  let current = identity();
  const f = await start({
    readRunIdentity: async () => current,
    readRunStatus: async () => {
      current = identity({ owner_epoch: 4 });
      return status();
    },
  });
  try {
    const res = await f.get('/operator/v1/run_status?run_id=' + runId);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'run_generation_changed');
  } finally { await f.stop(); }
});

test('W28 advancing event_seq during events readback invalidates mixed watermark', async () => {
  let current = identity();
  const f = await start({
    readRunIdentity: async () => current,
    readEvents: async () => { current = identity({ event_seq: 19 }); return batch(); },
  });
  try {
    const res = await f.get('/operator/v1/events?run_id=' + runId + '&after=17');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'run_generation_changed');
  } finally { await f.stop(); }
});

test('W28 same owner epoch event_seq rollback fails after context/status observation', async () => {
  let current = identity();
  let projection = status();
  const f = await start({
    readRunIdentity: async () => current,
    readRunStatus: async () => projection,
  });
  try {
    assert.equal((await f.get('/operator/v1/context')).status, 200);
    current = identity({ event_seq: 17 });
    projection = status({ event_seq: 17 });
    const rollback = await f.get('/operator/v1/run_status?run_id=' + runId);
    assert.equal(rollback.status, 503);
    assert.equal((await rollback.json()).error, 'run_generation_regressed');
    current = identity({ owner_epoch: 4, event_seq: 0 });
    projection = status({ owner_epoch: 4, event_seq: 0 });
    assert.equal((await f.get('/operator/v1/run_status?run_id=' + runId)).status, 200);
    current = identity({ owner_epoch: 3, event_seq: 19 });
    projection = status({ owner_epoch: 3, event_seq: 17 });
    assert.equal((await f.get('/operator/v1/run_status?run_id=' + runId)).status, 503);
  } finally { await f.stop(); }
});

test('W28 missing adapter remains UNKNOWN; authenticated GET grants no write/scheduler API', async () => {
  const f = await start();
  try {
    assert.equal((await f.get('/operator/v1/context')).status, 200);
    const miss = await f.get('/operator/v1/run_status?run_id=' + runId);
    assert.equal(miss.status, 503);
    assert.equal((await miss.json()).state, 'UNKNOWN');
    assert.equal((await f.get('/operator/v1/control?run_id=' + runId)).status, 404);
    assert.equal((await f.get('/operator/v1/events?run_id=' + runId)).status, 503);
  } finally { await f.stop(); }
});
