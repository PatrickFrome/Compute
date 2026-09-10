import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatFastControlRuntime } from '../src/chat-fast-control-runtime.mjs';
import { CONTROL_ACTION_MANIFEST_REVISION } from '../src/control-actions-manifest.mjs';

function harness() {
  const calls = { repo: [], state: 0, batch: [], delta: [], emergency: [] };
  const developmentPlane = {
    async request(capability, input) {
      calls.repo.push({ capability, input: structuredClone(input) });
      return {
        schema: 'metaengine.development-plane.repo-search.v1',
        status: 'OK',
        query_revision: 'rq:test',
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
  assert.equal(snap.authority_effect, false);
});
