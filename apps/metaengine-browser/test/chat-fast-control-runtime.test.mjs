import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatFastControlRuntime, CHAT_FAST_CONTROL_QUERY_CACHE_MAX } from '../src/chat-fast-control-runtime.mjs';
import { CONTROL_ACTION_MANIFEST_REVISION } from '../src/control-actions-manifest.mjs';

function harness() {
  const calls = { repo: [], state: 0, batch: [], delta: [], emergency: [] };
  const developmentPlane = {
    async request(capability, input) {
      calls.repo.push({ capability, input: structuredClone(input) });
      return {
        schema: 'metaengine.development-plane.repo-search.v1',
        status: 'OK',
        query_revision: `rq:${String(input.query).toLowerCase()}`,
        total_hits: 1,
        hits: [{ path: 'apps/metaengine-browser/src/main.mjs', line: 1, snippet: 'boundedNavigation AbortSignal', sha256: `sha256:${'a'.repeat(64)}`, score: 80, matched_terms: 2, authority_effect: false }],
        authority_effect: false,
      };
    },
  };
  const runtime = new ChatFastControlRuntime({
    developmentPlane,
    getBrowserState: async () => {
      calls.state += 1;
      return {
        client_id: 'client-test',
        heartbeat_at: '2026-09-10T10:00:00.000Z',
        supervisor_mode: 'CONTROL',
        armed: true,
        tabs: [],
      };
    },
    issueBatch: async (value) => { calls.batch.push(value); return { accepted: true, authority_effect: false }; },
    resultDelta: async (value) => { calls.delta.push(value); return { results: [], next_seq: value.after_seq, authority_effect: false }; },
    issueEmergency: async (value) => { calls.emergency.push(value); return { accepted: true, authority_effect: false }; },
  });
  runtime.setSource({
    repository: 'PatrickFrome/Compute',
    branch: 'work/browser-command-fabric-v2-p0',
    head_sha: 'a'.repeat(40),
    pr: 453,
    dirty: false,
    authority_effect: false,
  }, '2026-09-10T10:00:00.000Z');
  runtime.setCapabilityRevision(CONTROL_ACTION_MANIFEST_REVISION);
  return { runtime, calls };
}

test('context_get returns one exact development capsule with one local browser-state read', async () => {
  const { runtime, calls } = harness();
  runtime.upsertCi({ id: 1, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  runtime.upsertEvidence({ id: 'blocker:one', kind: 'BLOCKER', title: 'Fix shell', severity: 'HIGH', authority_effect: false });
  const result = await runtime.callTool('context_get', { fields: ['development', 'development_capsule', 'ci'], max_bytes: 8192 });
  assert.equal(result.structuredContent.tool, 'context_get');
  assert.equal(result.structuredContent.result.context.development.head_sha, 'a'.repeat(40));
  assert.equal(result.structuredContent.result.context.development_capsule.focus.kind, 'CI_FAILURE');
  assert.equal(calls.state, 1);
  assert.equal(calls.repo.length, 0, 'context hot path must not trigger repo discovery');
});

test('dev_query returns repo, indexed evidence, and exact orientation in one tool call', async () => {
  const { runtime, calls } = harness();
  runtime.upsertCi({ id: 7, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  runtime.upsertEvidence({
    id: 'blocker:abort', kind: 'BLOCKER', title: 'AbortSignal blocker', text: 'boundedNavigation needs AbortSignal', severity: 'CRITICAL', authority_effect: false,
  });
  const result = await runtime.callTool('dev_query', { query: 'bounded navigation abort signal', limit: 8, max_bytes: 4096 });
  assert.equal(result.structuredContent.tool, 'dev_query');
  assert.equal(result.structuredContent.result.status, 'OK');
  assert.equal(result.structuredContent.result.hits.some((row) => row.source === 'REPO'), true);
  assert.equal(result.structuredContent.result.hits.some((row) => row.id === 'blocker:abort'), true);
  assert.equal(result.structuredContent.result.one_call_orientation, true);
  assert.equal(result.structuredContent.result.orientation.head_sha, 'a'.repeat(40));
  assert.equal(result.structuredContent.result.orientation.ci_state, 'RED');
  assert.equal(result.structuredContent.result.orientation.focus_kind, 'CI_FAILURE');
  assert.equal(calls.repo.length, 1);
  assert.equal(calls.state, 0, 'dev_query orientation must not require browser-state read');
});

test('Russian continuation intent is served from exact-revision cursor with zero extra Development Plane or browser-state reads', async () => {
  const { runtime, calls } = harness();
  const first = await runtime.callTool('dev_query', { query: 'bounded navigation abort signal', limit: 8, max_bytes: 4096 });
  const continued = await runtime.callTool('dev_query', { query: 'Продолжи!!!', limit: 8, max_bytes: 4096 });
  assert.equal(first.structuredContent.result.status, 'OK');
  assert.equal(continued.structuredContent.result.status, 'OK');
  assert.equal(continued.structuredContent.result.cursor_hit, true);
  assert.equal(continued.structuredContent.result.cursor_source_query, 'bounded navigation abort signal');
  assert.equal(continued.structuredContent.result.development_plane_calls, 0);
  assert.equal(continued.structuredContent.result.filesystem_reads_required, 0);
  assert.equal(continued.structuredContent.result.network_reads_required, 0);
  assert.equal(calls.repo.length, 1, 'continuation must not enter Development Plane on an exact cursor hit');
  assert.equal(calls.state, 0, 'continuation must not read live Browser state');
  const snap = runtime.snapshot().development_cursor;
  assert.equal(snap.current_revision_match, true);
  assert.equal(snap.hits, 1);
});

test('stale continuation cursor falls back once to current focus then returns to zero-DP hot path', async () => {
  const { runtime, calls } = harness();
  await runtime.callTool('dev_query', { query: 'shell failure', limit: 8 });
  assert.equal(calls.repo.length, 1);
  runtime.upsertCi({ id: 22, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  const refreshed = await runtime.callTool('dev_query', { query: 'продолжи', limit: 8 });
  assert.equal(refreshed.structuredContent.result.continuation_fallback, true);
  assert.equal(calls.repo.length, 2, 'changed development revision must not replay stale source frontier');
  assert.match(calls.repo[1].input.query, /Shell|CI FAILURE|next action/i);
  const hotAgain = await runtime.callTool('dev_query', { query: 'продолжи', limit: 8 });
  assert.equal(hotAgain.structuredContent.result.cursor_hit, true);
  assert.equal(calls.repo.length, 2, 'refreshed continuation frontier must return to zero-DP hot path');
  assert.equal(runtime.snapshot().continuation_fallbacks, 1);
});

test('repeated identical dev_query is served from warm cache with zero extra Development Plane calls', async () => {
  const { runtime, calls } = harness();
  const input = { query: 'bounded navigation abort signal', limit: 8, max_bytes: 4096 };
  const first = await runtime.callTool('dev_query', input);
  const second = await runtime.callTool('dev_query', input);
  assert.equal(first.structuredContent.result.status, 'OK');
  assert.deepEqual(second.structuredContent.result, first.structuredContent.result);
  assert.equal(calls.repo.length, 1);
  const snap = runtime.snapshot().dev_query_warm_cache;
  assert.equal(snap.hits, 1);
  assert.equal(snap.misses, 1);
  assert.equal(snap.entries, 1);
  assert.equal(snap.timers, false);
  assert.equal(snap.authority_effect, false);
});

test('cached if_none_match returns tiny NOT_MODIFIED without entering Development Plane', async () => {
  const { runtime, calls } = harness();
  const input = { query: 'bounded navigation abort signal', limit: 8, max_bytes: 4096 };
  const first = await runtime.callTool('dev_query', input);
  const revision = first.structuredContent.result.query_revision;
  const second = await runtime.callTool('dev_query', { ...input, if_none_match: revision });
  assert.equal(second.structuredContent.result.status, 'NOT_MODIFIED');
  assert.equal(second.structuredContent.result.query_revision, revision);
  assert.equal(second.structuredContent.result.warm_cache, true);
  assert.ok(second.structuredContent.result.bytes < 512);
  assert.equal(calls.repo.length, 1);
  assert.equal(runtime.snapshot().dev_query_warm_cache.not_modified_hits, 1);
});

test('development state revision invalidates warm query cache without explicit timers or flushes', async () => {
  const { runtime, calls } = harness();
  const input = { query: 'shell failure', limit: 8 };
  await runtime.callTool('dev_query', input);
  await runtime.callTool('dev_query', input);
  assert.equal(calls.repo.length, 1);
  runtime.upsertCi({ id: 22, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  await runtime.callTool('dev_query', input);
  assert.equal(calls.repo.length, 2, 'new development revision must miss old warm cache key');
});

test('warm query cache is hard bounded under many distinct chat queries', async () => {
  const { runtime, calls } = harness();
  for (let i = 0; i < CHAT_FAST_CONTROL_QUERY_CACHE_MAX + 7; i += 1) {
    await runtime.callTool('dev_query', { query: `source symbol ${i}`, kinds: ['SOURCE'], limit: 1, max_bytes: 2048 });
  }
  const snap = runtime.snapshot().dev_query_warm_cache;
  assert.equal(snap.entries, CHAT_FAST_CONTROL_QUERY_CACHE_MAX);
  assert.equal(snap.max_entries, CHAT_FAST_CONTROL_QUERY_CACHE_MAX);
  assert.equal(calls.repo.length, CHAT_FAST_CONTROL_QUERY_CACHE_MAX + 7);
});

test('Browser command management still delegates to existing authority boundaries only', async () => {
  const { runtime, calls } = harness();
  await runtime.callTool('run_submit', {
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    steps: [{ idempotency_key: 'chat:run:0001', action: 'POLL', payload: {} }],
  });
  await runtime.callTool('run_status', { after_seq: 0, limit: 8 });
  await runtime.callTool('emergency_stop', { kind: 'DISARM', idempotency_key: 'chat:stop:0001' });
  assert.equal(calls.batch.length, 1);
  assert.equal(calls.delta.length, 1);
  assert.equal(calls.emergency.length, 1);
  const snap = runtime.snapshot();
  assert.deepEqual(snap.tools, ['context_get', 'dev_query', 'run_submit', 'run_status', 'emergency_stop']);
  assert.equal(snap.dev_query_includes_orientation, true);
  assert.equal(snap.second_scheduler, false);
  assert.equal(snap.command_leasing_authority, false);
  assert.equal(snap.browser_execution_authority, false);
});

test('runtime owns no periodic source or CI discovery loop', () => {
  const { runtime } = harness();
  const snap = runtime.snapshot();
  assert.equal(snap.periodic_source_discovery, false);
  assert.equal(snap.periodic_ci_discovery, false);
  assert.equal(snap.query_provider.query_fanout_max, 2);
  assert.equal(snap.dev_query_warm_cache.timers, false);
  assert.equal(snap.development_cursor.timers, false);
  assert.equal(snap.authority_effect, false);
});
