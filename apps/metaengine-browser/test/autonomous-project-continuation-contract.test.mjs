import assert from 'node:assert/strict';
import test from 'node:test';
import { AutonomousProjectTaskRuntime } from '../src/autonomous-project-task-runtime.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const lease = { task_id: '22222222-2222-4222-8222-222222222222', parent_task_id: null,
  root_task_id: '22222222-2222-4222-8222-222222222222', agent_id: 'agent_drain-fixture-001',
  claim_id: 10, lease_generation: 1, depth: 0, role: 'CODER', state: 'RUNNING' };
const snapshot = () => ({ schema: 'metaengine.devos.project-snapshot.v1', found: true, project_id: projectId,
  root_task_id: lease.task_id, state: 'ACTIVE', tasks: [lease], selected_task: lease,
  immediate_children: [], proposals: [], policy: {}, authority_effect: false });
const emptyHistory = after => ({ schema: 'metaengine.devos.project-history.v1', project_id: projectId, entries: [],
  cursor: { after_seq: after, through_seq: after, next_seq: after, has_more: false, commit_ordered: true }, authority_effect: false });
function gate() {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  return { entered, release, wait: async () => { enter(); await waiting; } };
}
const invocation = {
  prepareLease: runtime => runtime.prepareLease(lease),
  waitForChildren: runtime => runtime.waitForChildren(lease),
  refreshContext: runtime => runtime.refreshContext(lease),
  latestTurnForLease: runtime => runtime.latestTurnForLease(lease),
  continueConversation: (runtime, blocked) => runtime.continueConversation(lease,
    [{ request_id: 'fixture:done', status: 'COMPLETED', summary: 'observed tool result' }], async () => {
      await blocked.wait(); return { effect_state: 'PROVEN_COMPOSER_CLEARED' };
    }, { observeTranscriptFloor: async () => 1200 }),
  reconcilePending: runtime => runtime.reconcilePending(),
  serveToolRequests: runtime => runtime.serveToolRequests({ lease,
    requests: [{ request_id: 'fixture:history', action: 'PROJECT_HISTORY', payload: { after_seq: 0, limit: 16 } }] }),
  recordActivity: runtime => runtime.recordActivity(lease, { request_id: 'fixture:activity', event_type: 'TASK_ACTIVITY' }),
  tick: runtime => runtime.tick(),
};

test('shutdown drains each public operation before closing its journal and fences new work', async t => {
  for (const name of Object.keys(invocation)) await t.test(name, async () => {
    const blocked = gate(); let journalClosed = 0;
    const journal = { find: async () => null, begin: async () => ({ receipt: null }), confirm: async () => ({}),
      latestConversationTurn: async () => { if (name === 'latestTurnForLease') await blocked.wait(); return null; },
      pending: async () => { if (name === 'reconcilePending') await blocked.wait(); return []; },
      close: async () => { journalClosed++; } };
    const runtime = new AutonomousProjectTaskRuntime({ journal,
      materializeProject: async () => { if (name === 'prepareLease') await blocked.wait(); return { state: 'PROVEN' }; },
      request: async ({ path, body }) => {
        if (path.endsWith('/snapshot')) {
          if (['waitForChildren', 'refreshContext'].includes(name)) await blocked.wait();
          return snapshot();
        }
        if (path.endsWith('/history')) { if (name === 'serveToolRequests') await blocked.wait(); return emptyHistory(body.after_seq); }
        if (path.endsWith('/activity')) { if (name === 'recordActivity') await blocked.wait(); return { authority_effect: false }; }
        if (path.endsWith('/reconcile')) {
          if (name === 'tick') await blocked.wait();
          return { schema: 'metaengine.devos.project-reconcile.v1', project_id: body.project_id,
            projects: [], bounded_projects: 4, authority_effect: false };
        }
        assert.fail(`unexpected route ${path}`);
      } });
    const active = invocation[name](runtime, blocked); await blocked.entered;
    assert.equal(runtime.snapshot().in_flight_operations, 1);
    const closing = runtime.close(); assert.equal(runtime.close(), closing);
    await Promise.resolve(); assert.equal(journalClosed, 0);
    await assert.rejects(runtime.tick(), /autonomous_project_closed/);
    blocked.release(); await active; await closing;
    assert.equal(journalClosed, 1); assert.equal(runtime.snapshot().in_flight_operations, 0);
  });
});

test('bounded agent history stays valid JSON and resumes every omitted event from its cursor', async () => {
  const entries = Array.from({ length: 128 }, (_, index) => ({ seq: index + 1, task_id: lease.task_id, attempt: 1,
    event_type: 'TASK_ACTIVITY', actor: 'agent_fixture', verified_evidence: false,
    content: { note: 'Unicode Ж and quotes " with \\ escapes '.repeat(80), event: index + 1 } }));
  const requests = [], journal = { find: async () => null, begin: async () => ({ receipt: null }), confirm: async () => ({}), close: async () => {} };
  const runtime = new AutonomousProjectTaskRuntime({ journal, materializeProject: async () => ({ state: 'PROVEN' }),
    request: async ({ path, body }) => {
      if (path.endsWith('/snapshot')) return snapshot();
      assert.ok(path.endsWith('/history')); requests.push(body);
      const rows = entries.filter(row => row.seq > body.after_seq).slice(0, body.limit);
      return { schema: 'metaengine.devos.project-history.v1', project_id: projectId, entries: rows,
        cursor: { after_seq: body.after_seq, through_seq: 128, next_seq: rows.at(-1)?.seq ?? 128,
          has_more: false, commit_ordered: true }, authority_effect: false };
    } });
  try {
    let after = 0; const seen = [];
    while (after < 128) {
      const [result] = await runtime.serveToolRequests({ lease,
        requests: [{ request_id: `fixture:page:${after}`, action: 'PROJECT_HISTORY', payload: { after_seq: after, through_seq: 128, limit: 128 } }] });
      assert.equal(result.status, 'COMPLETED'); assert.ok(result.summary.length <= 3600);
      const page = JSON.parse(result.summary);
      assert.equal(page.content_excerpt_only, true); assert.equal(page.cursor.after_seq, after);
      assert.ok(page.entries.length); assert.ok(page.cursor.next_seq > after);
      assert.equal(page.cursor.next_seq, page.entries.at(-1).seq);
      if (page.cursor.next_seq < 128) assert.equal(page.cursor.has_more, true);
      seen.push(...page.entries.map(row => row.seq)); after = page.cursor.next_seq;
    }
    assert.deepEqual(seen, Array.from({ length: 128 }, (_, index) => index + 1));
    assert.ok(requests.length > 1); assert.ok(requests.every(row => row.through_seq === 128));
  } finally { await runtime.close(); }
});
