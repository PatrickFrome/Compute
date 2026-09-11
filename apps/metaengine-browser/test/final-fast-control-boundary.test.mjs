import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FinalFastControlBoundary,
  FINAL_FAST_CONTROL_READ_TOOLS,
  FINAL_FAST_CONTROL_BLOCKED_TOOLS,
} from '../src/final-fast-control-boundary.mjs';

function harness() {
  const calls = { repo: 0, state: 0 };
  const boundary = new FinalFastControlBoundary({
    developmentPlane: {
      async request(capability, input) {
        calls.repo += 1;
        assert.equal(capability, 'DEVOS_REPO_SEARCH');
        return {
          schema: 'metaengine.development-plane.repo-search.v1',
          status: 'OK',
          query_revision: 'rq:final-fast-control',
          total_hits: 1,
          hits: [{ path: 'apps/metaengine-browser/src/main.mjs', line: 1, snippet: String(input?.query || ''), sha256: `sha256:${'a'.repeat(64)}`, score: 10, matched_terms: 1, authority_effect: false }],
          authority_effect: false,
        };
      },
    },
    getBrowserState: async () => {
      calls.state += 1;
      return { supervisor_mode: 'CONTROL', armed: true, tabs: [], authority_effect: false };
    },
  });
  return { boundary, calls };
}

test('final Fast Control boundary advertises only read/query tools before server authority promotion', () => {
  const { boundary } = harness();
  assert.deepEqual(boundary.listTools().map((row) => row.name), [...FINAL_FAST_CONTROL_READ_TOOLS]);
  assert.deepEqual(FINAL_FAST_CONTROL_BLOCKED_TOOLS, ['run_submit', 'run_status', 'emergency_stop']);
  const snap = boundary.snapshot();
  assert.equal(snap.mutation_authority_promoted, false);
  assert.equal(snap.result_outbox_promoted, false);
  assert.equal(snap.emergency_issue_promoted, false);
  assert.equal(snap.service_role_required_in_browser, false);
  assert.equal(snap.direct_sql_authority, false);
  assert.equal(snap.second_scheduler, false);
  assert.equal(snap.automatic_effect_retry_allowed, false);
});

test('context_get is live while mutation transport remains absent', async () => {
  const { boundary, calls } = harness();
  const result = await boundary.invoke('context_get', { fields: ['browser'], max_bytes: 4096 });
  assert.ok(result);
  assert.equal(calls.state, 1);
  assert.equal(calls.repo, 0);
});

test('dev_query uses the existing Development Plane read-only capability', async () => {
  const { boundary, calls } = harness();
  const result = await boundary.invoke('dev_query', { query: 'verified execution fabric', limit: 4, max_bytes: 4096 });
  assert.equal(result.tool, 'dev_query');
  assert.equal(result.result.status, 'OK');
  assert.equal(calls.repo, 1);
  assert.equal(calls.state, 0);
});

test('all unpromoted command/result/emergency tools fail closed before reaching runtime callbacks', async () => {
  const { boundary, calls } = harness();
  for (const tool of FINAL_FAST_CONTROL_BLOCKED_TOOLS) {
    await assert.rejects(
      Promise.resolve().then(() => boundary.invoke(tool, {})),
      new RegExp(`fast_control_authority_not_promoted:${tool}`),
    );
  }
  assert.equal(calls.repo, 0);
  assert.equal(calls.state, 0);
});

test('unknown tools fail closed instead of widening the Fast Control surface', async () => {
  const { boundary } = harness();
  await assert.rejects(
    Promise.resolve().then(() => boundary.invoke('raw_shell', {})),
    /final_fast_control_tool_denied:raw_shell/,
  );
});
