import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { startOperatorReadOnlyGateway, OPERATOR_GATEWAY_SCHEMA } from './operator-readonly-gateway.mjs';

const key = 'k'.repeat(64);
const ownerId = 'local-owner-instance-1';
const projectId = 'project-alpha';
const runId = 'run-0001';
const now = () => new Date().toISOString();
const digest = 'a'.repeat(64);

async function fixture(options = {}) {
  const owner = { instance_id: ownerId, mode: 'LOCAL_POSTGRES', ok: true };
  const context = {
    schema: 'metaengine.operator.context.v1', storage: 'OWN_POSTGRES_ONLY',
    scope: 'READ_ONLY', authority_effect: false, scheduler_authority: false,
    cloud_database_dependency: false, remote_fallback_allowed: false,
    generated_at: now(), planes: { database: { state: 'AVAILABLE', fresh: true,
      proof: 'TRUSTED_READBACK', observed_at: now(),
      details: { catalog_rpc_expected: 50, secret: 'must-never-leak' } } },
    sensitive_token: 'context-private-value',
  };
  const upstream = createServer((req, res) => {
    const value = req.url === '/health' ? owner : context;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamBaseUrl = 'http://127.0.0.1:' + upstream.address().port;
  const runtime = await startOperatorReadOnlyGateway({
    apiKey: key, ownerId, upstreamBaseUrl, ...options,
  });
  const get = (path, init = {}) => fetch(runtime.address + path,
    { ...init, headers: { apikey: key, ...init.headers } });
  const stop = async () => {
    await runtime.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  };
  return { get, runtime, stop, owner, context, upstream };
}
const identity = (override = {}) => ({
  proven: true, source: 'OWN_POSTGRES_READBACK', owner_id: ownerId,
  project_id: projectId, run_id: runId, owner_epoch: 3,
  event_seq: 18, observed_at: now(), ...override,
});
const projection = (override = {}) => ({
  source: 'OWN_POSTGRES_READBACK', proven: true,
  project_id: projectId, run_id: runId,
  observed_at: now(), state: 'RUNNING', event_seq: 17, ...override,
});
const events = (override = {}) => ({
  source: 'OWN_POSTGRES_READBACK', proven: true,
  project_id: projectId, run_id: runId, observed_at: now(),
  watermark_event_seq: 18,
  events: [{ event_seq: 16, kind: 'TASK_COMPLETED', task_id: 'task-1',
    occurred_at: now(), proof_sha256: digest },
    { event_seq: 18, kind: 'CHECKPOINT_VERIFIED', task_id: null,
      occurred_at: now(), proof_sha256: digest }],
  ...override,
});

test('gateway startup never permits public listener, implicit Owner, remote provider or weak owner key', async () => {
  const valid = { apiKey: key, ownerId, upstreamBaseUrl: 'http://127.0.0.1:2333' };
  for (const patch of [{ host: '0.0.0.0' }, { host: '::' },
    { ownerId: '' }, { apiKey: 'short' },
    { upstreamBaseUrl: 'https://host.example:2333' },
    { upstreamBaseUrl: 'http://localhost:2333' },
    { upstreamBaseUrl: 'http://127.0.0.1:2333/path' },
    { upstreamBaseUrl: 'http://127.0.0.1:2333?x=1' },
    { readEvents: {} }]) {
    await assert.rejects(startOperatorReadOnlyGateway({ ...valid, ...patch }), /gateway_/);
  }
});

test('same owner-key authentication, Host/Origin/method/body/query fences and unknown path', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.runtime.address + '/operator/v1/context')).status, 401);
    assert.equal((await f.get('/operator/v1/context', { headers: { authorization: 'Bearer bad' } })).status, 401);
    assert.equal((await f.get('/operator/v1/context', { headers: { origin: 'https://chat.openai.com' } })).status, 403);
    // fetch() normalizes Host; use raw node:http to exercise a spoofed Host header.
    const badHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(f.runtime.address + '/operator/v1/context', {
        headers: { apikey: key, host: 'localhost:' + f.runtime.server.address().port },
      }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await f.get('/operator/v1/context', { method: 'POST' })).status, 405);
    assert.equal((await f.get('/operator/v1/context?run_id=bad')).status, 400);
    assert.equal((await f.get('/operator/v1/context?x=1&x=2')).status, 400);
    assert.equal((await f.get('/operator/v1/submit_goal', { method: 'POST' })).status, 405);
    assert.equal((await f.get('/operator/v1/submit_goal')).status, 404);
    assert.equal((await f.get('/rest/v1/rpc/devos_fleet_lease_v1')).status, 404);
    assert.equal((await f.get('/operator/v1/events?run_id=run-0001&after=0&limit=999')).status, 400);
    assert.equal((await f.get('/operator/v1/events?run_id=run-0001&after=01')).status, 400);
    assert.equal((await f.get('/operator/v1/events?run_id=run-0001&run_id=run-0002')).status, 400);
  } finally { await f.stop(); }
});

test('context is real P0 upstream projection with redaction; missing run identity remains UNKNOWN', async () => {
  const f = await fixture();
  try {
    const response = await f.get('/operator/v1/context');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.schema, OPERATOR_GATEWAY_SCHEMA);
    assert.equal(result.authority_effect, false);
    assert.equal(result.context.planes.database.state, 'AVAILABLE');
    assert.equal(result.context.planes.host.state, 'UNKNOWN');
    assert.equal(result.context.operational_state, 'NOT_PROVEN');
    assert.equal(result.run.state, 'UNKNOWN');
    assert.equal(result.run.run_id, null);
    assert.doesNotMatch(JSON.stringify(result), /must-never-leak|context-private-value/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await f.get('/operator/v1/run_status?run_id=run-0001')).status, 503);
  } finally { await f.stop(); }
});

test('forged READY without a trusted plane proof is UNVERIFIED', async () => {
  const f = await fixture();
  try {
    f.context.planes.host = { state: 'READY', fresh: true, proof: 'NONE', observed_at: now(),
      private_key: 'should-not-leak' };
    const body = await (await f.get('/operator/v1/context')).json();
    assert.equal(body.context.planes.host.state, 'UNVERIFIED');
    assert.equal(body.context.operational_state, 'NOT_PROVEN');
    assert.doesNotMatch(JSON.stringify(body), /should-not-leak/);
  } finally { await f.stop(); }
});

test('Owner instance mismatch and invalid upstream context are not accepted as readback', async () => {
  const f = await fixture({ readRunIdentity: async () => identity() });
  try {
    f.owner.instance_id = 'another-owner';
    assert.equal((await f.get('/operator/v1/context')).status, 503);
    f.owner.instance_id = ownerId;
    f.context.generated_at = new Date(Date.now() - 31_000).toISOString();
    assert.equal((await f.get('/operator/v1/context')).status, 503);
    f.context.generated_at = now();
    f.context.authority_effect = true;
    assert.equal((await f.get('/operator/v1/context')).status, 503);
  } finally { await f.stop(); }
});

test('one canonical run identity is independently proven and collision-fenced', async () => {
  let observed;
  const f = await fixture({
    readRunIdentity: async () => identity(),
    readRunStatus: async arg => { observed = arg; return projection({ secret: 'never-expose' }); },
  });
  try {
    const ctx = await (await f.get('/operator/v1/context')).json();
    assert.equal(ctx.run.run_id, runId);
    assert.equal(ctx.run.cursor, '18');
    assert.equal(ctx.run.owner_epoch, 3);
    const response = await f.get('/operator/v1/run_status?run_id=' + runId);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.state, 'RUNNING');
    assert.equal(result.event_seq, 17);
    assert.equal(result.authority_effect, false);
    assert.equal(result.run_id, runId);
    assert.deepEqual(observed, { projectId, runId, ownerEpoch: 3 });
    assert.doesNotMatch(JSON.stringify(result), /never-expose/);
    assert.equal((await f.get('/operator/v1/run_status?run_id=run-evil')).status, 409);
    assert.equal((await f.get('/operator/v1/run_status')).status, 400);
  } finally { await f.stop(); }
});

test('inspect only projects allowlisted fields of the exact task and owner run', async () => {
  const f = await fixture({
    readRunIdentity: async () => identity(),
    readInspect: async arg => projection({ task_id: arg.taskId, state: 'PENDING',
      raw_sql: 'SELECT secret', event_seq: 12 }),
  });
  try {
    const response = await f.get('/operator/v1/inspect?run_id=' + runId + '&task_id=task-A');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.task_id, 'task-A');
    assert.equal(result.state, 'PENDING');
    assert.doesNotMatch(JSON.stringify(result), /raw_sql|SELECT secret/);
  } finally { await f.stop(); }
});

test('events preserve monotonic per-run cursor with no duplicate or fabricated event', async () => {
  const seen = [];
  const f = await fixture({
    readRunIdentity: async () => identity(),
    readEvents: async args => { seen.push(args); return events(); },
  });
  try {
    const response = await f.get('/operator/v1/events?run_id=' + runId + '&after=15&limit=2');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.events.map(row => row.event_seq), [16, 18]);
    assert.equal(result.next_cursor, '18');
    assert.equal(result.watermark_cursor, '18');
    assert.equal(result.has_more, false);
    assert.equal(result.authority_effect, false);
    assert.deepEqual(seen[0], { projectId, runId, ownerEpoch: 3, after: 15, limit: 2 });
    assert.equal((await f.get('/operator/v1/events?run_id=' + runId + '&after=19')).status, 409);
    assert.equal((await f.get('/operator/v1/events?run_id=wrong&after=15')).status, 409);
  } finally { await f.stop(); }
});

test('malformed, reversed, unproved, cross-run and empty-gap event snapshots fail closed', async () => {
  let candidate = events();
  const f = await fixture({
    readRunIdentity: async () => identity(),
    readEvents: async () => candidate,
  });
  try {
    const url = '/operator/v1/events?run_id=' + runId + '&after=15&limit=2';
    for (const wrong of [
      events({ events: [...events().events].reverse() }),
      events({ events: [events().events[0], events().events[0]] }),
      events({ events: [{ ...events().events[0], proof_sha256: 'bad' }] }),
      events({ run_id: 'different' }),
      events({ source: 'CLOUD' }),
      events({ watermark_event_seq: 17 }),
      events({ events: [] }),
    ]) {
      candidate = wrong;
      assert.equal((await f.get(url)).status, 503);
    }
  } finally { await f.stop(); }
});

test('stale, mismatched owner, optimistic status and unqualified projection fail closed', async () => {
  let current = identity();
  let status = projection();
  const f = await fixture({
    readRunIdentity: async () => current,
    readRunStatus: async () => status,
  });
  try {
    const url = '/operator/v1/run_status?run_id=' + runId;
    current = identity({ owner_id: 'spoofed' });
    assert.equal((await f.get(url)).status, 503);
    current = identity({ observed_at: new Date(Date.now() - 31_000).toISOString() });
    assert.equal((await f.get(url)).status, 503);
    current = identity();
    status = projection({ state: 'READY', event_seq: 19 });
    assert.equal((await f.get(url)).status, 503);
    status = projection({ project_id: 'other-project' });
    assert.equal((await f.get(url)).status, 503);
  } finally { await f.stop(); }
});

test('no read-only adapter accidentally advances execution or claims a complete run', async () => {
  const f = await fixture({ readRunIdentity: async () => identity() });
  try {
    for (const route of ['inspect?run_id=' + runId, 'run_status?run_id=' + runId,
      'events?run_id=' + runId]) {
      const response = await f.get('/operator/v1/' + route);
      const value = await response.json();
      assert.equal(response.status, 503);
      assert.equal(value.state, 'UNKNOWN');
      assert.equal(value.authority_effect, false);
    }
  } finally { await f.stop(); }
});
