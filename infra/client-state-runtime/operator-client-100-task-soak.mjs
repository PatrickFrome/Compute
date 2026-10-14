import { performance } from 'node:perf_hooks';

// W34: read-only traffic against the existing Operator Gateway. This is an
// observer workload, NOT a second executor, admission queue or task creator.
export const CLIENT_SOAK_TASK_COUNT = 100;
export const CLIENT_SOAK_MAX_IN_FLIGHT = 4;
const SCHEMA = 'metaengine.operator.gateway.v1';
const taskId = n => 'task-' + String(n).padStart(4, '0');
const safeInt = v => Number.isSafeInteger(v) && v >= 0;
function requireProof(result, run) {
  if (!result || result.schema !== SCHEMA || result.authority_effect !== false ||
    result.scheduler_authority !== false || result.scope !== 'READ_ONLY' ||
    result.storage !== 'OWN_POSTGRES_ONLY' || result.proof !== 'TRUSTED_READBACK' ||
    result.project_id !== run.project_id || result.run_id !== run.run_id ||
    result.owner_id !== run.owner_id || result.owner_epoch !== run.owner_epoch) {
    throw new Error('soak_readback_unverified');
  }
}
function percentile(sorted, pct) {
  return Number((sorted[Math.ceil(sorted.length * pct) - 1] || 0).toFixed(3));
}
export async function runOperatorClient100TaskSoak({ read, concurrency = CLIENT_SOAK_MAX_IN_FLIGHT,
  time = () => performance.now(), heapUsed = () => process.memoryUsage().heapUsed,
  maxHeapGrowthBytes = 64 * 1024 * 1024, maxP95Ms = 5000 } = {}) {
  if (typeof read !== 'function' || !safeInt(concurrency) || concurrency < 1 ||
    concurrency > CLIENT_SOAK_MAX_IN_FLIGHT || !safeInt(maxHeapGrowthBytes) ||
    !Number.isFinite(maxP95Ms) || maxP95Ms <= 0) throw new Error('soak_configuration_invalid');
  const latencies = [];
  let active = 0, peakActive = 0;
  const initialHeap = heapUsed();
  let peakHeap = initialHeap;
  async function sample(path) {
    active++;
    peakActive = Math.max(peakActive, active);
    const started = time();
    try {
      const response = await read(path);
      if (!response || response.status !== 200) throw new Error('soak_readback_unavailable');
      return response.body;
    } finally {
      const elapsed = time() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('soak_clock_invalid');
      latencies.push(elapsed);
      peakHeap = Math.max(peakHeap, heapUsed());
      active--;
    }
  }
  const context = await sample('/operator/v1/context');
  if (!context || context.schema !== SCHEMA || context.scope !== 'READ_ONLY' ||
    context.storage !== 'OWN_POSTGRES_ONLY' || context.authority_effect !== false ||
    context.scheduler_authority !== false || context.context?.operational_state !== 'NOT_PROVEN') {
    throw new Error('soak_context_unverified');
  }
  const run = context.run;
  if (!run || run.proof !== 'TRUSTED_READBACK' || run.fresh !== true ||
    !run.project_id || !run.run_id || !run.owner_id || !safeInt(run.owner_epoch) ||
    run.cursor !== String(CLIENT_SOAK_TASK_COUNT)) throw new Error('soak_run_unverified');
  const suffix = '?run_id=' + encodeURIComponent(run.run_id);
  const status = await sample('/operator/v1/run_status' + suffix);
  requireProof(status, run);
  if (status.state !== 'COMPLETED' || status.event_seq !== CLIENT_SOAK_TASK_COUNT) {
    throw new Error('soak_status_unverified');
  }
  let next = 1;
  const observed = new Set();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next <= CLIENT_SOAK_TASK_COUNT) {
      const id = taskId(next++);
      const row = await sample('/operator/v1/inspect' + suffix + '&task_id=' + id);
      requireProof(row, run);
      if (row.task_id !== id || row.state !== 'COMPLETED' ||
        !safeInt(row.event_seq) || row.event_seq < 1 || row.event_seq > CLIENT_SOAK_TASK_COUNT ||
        observed.has(id)) throw new Error('soak_task_unverified');
      observed.add(id);
    }
  }));
  if (observed.size !== CLIENT_SOAK_TASK_COUNT) throw new Error('soak_task_count_mismatch');
  let cursor = 0;
  const events = new Set();
  for (let page = 0; cursor < CLIENT_SOAK_TASK_COUNT && page < CLIENT_SOAK_TASK_COUNT; page++) {
    const body = await sample('/operator/v1/events' + suffix + '&after=' + cursor + '&limit=32');
    requireProof(body, run);
    if (body.watermark_cursor !== run.cursor || !Array.isArray(body.events) ||
      body.events.length === 0 || body.events.length > 32) throw new Error('soak_event_window_invalid');
    for (const event of body.events) {
      if (event.event_seq !== cursor + 1 || event.task_id !== taskId(cursor + 1) ||
        typeof event.proof_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.proof_sha256) ||
        events.has(event.event_seq)) throw new Error('soak_event_gap_or_forgery');
      events.add(event.event_seq);
      cursor = event.event_seq;
    }
    if (body.next_cursor !== String(cursor) || body.has_more !== (cursor < CLIENT_SOAK_TASK_COUNT)) {
      throw new Error('soak_cursor_unverified');
    }
  }
  if (events.size !== CLIENT_SOAK_TASK_COUNT || cursor !== CLIENT_SOAK_TASK_COUNT) {
    throw new Error('soak_event_count_mismatch');
  }
  const ordered = latencies.sort((a, b) => a - b);
  const delta = Math.max(0, peakHeap - initialHeap);
  const report = Object.freeze({ schema: 'metaengine.client.operator-soak.v1',
    qualification: 'STAGING_OBSERVATION_ONLY', tasks: observed.size, events: events.size,
    requests: ordered.length, concurrency, peak_in_flight: peakActive,
    p50_ms: percentile(ordered, 0.5), p95_ms: percentile(ordered, 0.95),
    p99_ms: percentile(ordered, 0.99), max_ms: percentile(ordered, 1),
    peak_heap_growth_bytes: delta, heap_budget_bytes: maxHeapGrowthBytes,
    latency_budget_p95_ms: maxP95Ms, authority_effect: false,
    scheduler_authority: false, installed_runtime_proven: false,
    pass: delta <= maxHeapGrowthBytes && percentile(ordered, 0.95) <= maxP95Ms });
  if (!report.pass) throw new Error('soak_budget_exceeded');
  return report;
}

// Read-only HTTP adapter deliberately cannot address a remote/hosted service.
export function createLoopbackSoakReader({ baseUrl, apiKey, fetchImpl = fetch } = {}) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('soak_loopback_required'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^[1-9]\d*$/.test(url.port) ||
    Number(url.port) > 65535 || url.pathname !== '/' || url.search || url.hash ||
    url.username || url.password || typeof apiKey !== 'string' || apiKey.length < 32 ||
    typeof fetchImpl !== 'function') throw new Error('soak_loopback_required');
  const allowed = /^\/operator\/v1\/(context|inspect|run_status|events)(?:\?[^#]*)?$/;
  return async path => {
    if (typeof path !== 'string' || !allowed.test(path)) throw new Error('soak_get_only');
    const response = await fetchImpl(url.origin + path, {
      method: 'GET', headers: { apikey: apiKey }, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (Number(response.headers.get('content-length')) > 32768) throw new Error('soak_oversize');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 32768) throw new Error('soak_oversize');
    return { status: response.status, body: JSON.parse(new TextDecoder().decode(bytes)) };
  };
}
