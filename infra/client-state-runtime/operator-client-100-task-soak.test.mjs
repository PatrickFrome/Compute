import test from 'node:test';
import assert from 'node:assert/strict';
import { runOperatorClient100TaskSoak, createLoopbackSoakReader } from './operator-client-100-task-soak.mjs';

const gateway = { schema: 'metaengine.operator.gateway.v1', scope: 'READ_ONLY',
  storage: 'OWN_POSTGRES_ONLY', authority_effect: false, scheduler_authority: false };
const run = { project_id: 'stage-project', run_id: 'stage-run', owner_id: 'stage-owner',
  owner_epoch: 7, cursor: '100', fresh: true, proof: 'TRUSTED_READBACK' };
const proven = { ...gateway, ...run, source: 'OWN_POSTGRES_READBACK', proof: 'TRUSTED_READBACK' };
const taskId = n => 'task-' + String(n).padStart(4, '0');
function fixture({ change = () => {}, fail = null } = {}) {
  const requests = [];
  let inFlight = 0, peak = 0;
  const read = async path => {
    requests.push(path);
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      await Promise.resolve();
      const url = new URL(path, 'http://127.0.0.1');
      const route = url.pathname.split('/').at(-1);
      let body;
      if (route === 'context') body = { ...gateway, context: { operational_state: 'NOT_PROVEN' }, run };
      else if (route === 'run_status') body = { ...proven, state: 'COMPLETED', event_seq: 100 };
      else if (route === 'inspect') {
        const task_id = url.searchParams.get('task_id');
        body = { ...proven, task_id, state: 'COMPLETED', event_seq: Number(task_id.slice(-4)) };
      } else if (route === 'events') {
        const after = Number(url.searchParams.get('after'));
        const limit = Number(url.searchParams.get('limit'));
        const rows = Array.from({ length: Math.min(limit, 100 - after) }, (_, i) => ({
          event_seq: after + i + 1, task_id: taskId(after + i + 1),
          proof_sha256: 'a'.repeat(64), kind: 'TASK_COMPLETED',
        }));
        body = { ...proven, events: rows, watermark_cursor: '100',
          next_cursor: String(after + rows.length), has_more: after + rows.length < 100 };
      } else throw new Error('unexpected_route');
      if (fail === route) return { status: 503, body: {} };
      change(route, body, url);
      return { status: 200, body };
    } finally { inFlight--; }
  };
  return { read, requests, get peak() { return peak; } };
}

test('deterministic 100-task Client GET soak: 4 lanes, exactly 100 events, no side effects', async () => {
  const f = fixture();
  let t = 0;
  const report = await runOperatorClient100TaskSoak({ read: f.read, time: () => t++,
    heapUsed: () => 1024 });
  assert.equal(report.pass, true);
  assert.equal(report.tasks, 100);
  assert.equal(report.events, 100);
  assert.equal(report.requests, 106); // context + status + 100 inspect + 4 event pages
  assert.equal(report.peak_in_flight, 4);
  assert.equal(report.peak_heap_growth_bytes, 0);
  assert.equal(report.authority_effect, false);
  assert.equal(report.installed_runtime_proven, false);
  assert.equal(f.peak, 4);
  assert.equal(new Set(f.requests.filter(p => p.includes('task_id='))).size, 100);
  assert(f.requests.every(p => /^\/operator\/v1\/(context|inspect|run_status|events)/.test(p)));
  assert(!JSON.stringify(report).includes('stage-owner'));
});

test('failed status, UNKNOWN context and forged run identity fail closed', async () => {
  await assert.rejects(runOperatorClient100TaskSoak({ read: fixture({ fail: 'run_status' }).read }),
    /soak_readback_unavailable/);
  await assert.rejects(runOperatorClient100TaskSoak({ read: fixture({ change: (kind, body) => {
    if (kind === 'context') body.context.operational_state = 'ALL_PLANES_REPORTED_READY';
  } }).read }), /soak_context_unverified/);
  await assert.rejects(runOperatorClient100TaskSoak({ read: fixture({ change: (kind, body) => {
    if (kind === 'inspect') body.owner_epoch = 8;
  } }).read }), /soak_readback_unverified/);
});

test('task completeness and event cursor gaps/duplicates/fake proof fail closed', async () => {
  for (const mutate of [
    (kind, body) => { if (kind === 'inspect') body.state = 'RUNNING'; },
    (kind, body) => { if (kind === 'events') body.events[0].event_seq += 1; },
    (kind, body) => { if (kind === 'events') body.next_cursor = '0'; },
    (kind, body) => { if (kind === 'events') body.events[0].proof_sha256 = 'forged'; },
    (kind, body) => { if (kind === 'events') body.watermark_cursor = '99'; },
  ]) {
    await assert.rejects(runOperatorClient100TaskSoak({ read: fixture({ change: mutate }).read }),
      /soak_(task_unverified|event_gap_or_forgery|cursor_unverified|event_window_invalid)/);
  }
});

test('memory/latency budgets are explicit, never silently green', async () => {
  const f = fixture();
  let ticks = 0;
  await assert.rejects(runOperatorClient100TaskSoak({ read: f.read,
    time: () => (ticks++ * 10), maxP95Ms: 1 }), /soak_budget_exceeded/);
  let heap = 0;
  await assert.rejects(runOperatorClient100TaskSoak({ read: fixture().read,
    heapUsed: () => heap += 1024, maxHeapGrowthBytes: 1 }), /soak_budget_exceeded/);
  await assert.rejects(runOperatorClient100TaskSoak({ read: fixture().read,
    concurrency: 9 }), /soak_configuration_invalid/);
});

test('HTTP adapter only allows authenticated loopback GET, no hosted fallback or arbitrary path', async () => {
  for (const baseUrl of ['https://example.net:443', 'http://localhost:7777',
    'http://127.0.0.1:7777/evil', 'http://127.0.0.1:7777?target=evil',
    'http://user:pass@127.0.0.1:7777']) {
    assert.throws(() => createLoopbackSoakReader({ baseUrl, apiKey: 'k'.repeat(64) }),
      /soak_loopback_required/);
  }
  const observed = [];
  const reader = createLoopbackSoakReader({ baseUrl: 'http://127.0.0.1:7777',
    apiKey: 'k'.repeat(64), fetchImpl: async (url, opts) => {
      observed.push({ url, opts });
      return { status: 200, headers: { get: () => '2' }, arrayBuffer: async () =>
        new TextEncoder().encode('{}').buffer };
    } });
  for (const path of ['/rest/v1/rpc/mutate', '/operator/v1/submit_goal',
    'http://evil.example/', '/operator/v1/events#evil']) {
    await assert.rejects(reader(path), /soak_get_only/);
  }
  assert.equal((await reader('/operator/v1/context')).status, 200);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].opts.method, 'GET');
  assert.equal(observed[0].opts.redirect, 'error');
  assert.equal(observed[0].url, 'http://127.0.0.1:7777/operator/v1/context');
});
