import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientGoalJournal } from '../src/client-goal-journal.mjs';

const requestId = '11111111-1111-4111-8111-111111111111';

function storage(initial = null) {
  let value = initial == null ? null : structuredClone(initial);
  return {
    async loadState() {
      if (value == null) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return structuredClone(value);
    },
    async saveState(next) { value = structuredClone(next); },
    snapshot() { return structuredClone(value); },
  };
}

test('request correlation is durable before submit and restores after restart', async () => {
  const store = storage();
  const first = new ClientGoalJournal({ ...store, maxEntries: 4 });
  await first.load();
  const pending = await first.begin({ request_id: requestId, goal: 'Ship durable progress' });
  assert.equal(pending.state, 'SUBMITTING');
  assert.equal(pending.automatic_retry_allowed, false);
  assert.equal(pending.authority_effect, false);

  const second = new ClientGoalJournal({
    loadState: store.loadState,
    saveState: store.saveState,
    maxEntries: 4,
  });
  await second.load();
  assert.equal(second.latest().request_id, requestId);
  assert.equal(second.latest().goal, 'Ship durable progress');
  assert.equal(second.latest().state, 'SUBMITTING');
});

test('transport ambiguity becomes reconciliation state and never a retry permission', async () => {
  const store = storage();
  const journal = new ClientGoalJournal({ loadState: store.loadState, saveState: store.saveState });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Ship durable progress' });
  const ambiguous = await journal.markReconcileRequired(requestId, new Error('network_unknown'));
  assert.equal(ambiguous.state, 'RECONCILE_REQUIRED');
  assert.equal(ambiguous.last_error, 'network_unknown');
  assert.equal(ambiguous.automatic_retry_allowed, false);
});

test('progress survives without a submission response and can become terminal', async () => {
  const store = storage();
  const journal = new ClientGoalJournal({ loadState: store.loadState, saveState: store.saveState });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Ship durable progress' });
  await journal.markReconcileRequired(requestId, 'response_lost');

  const running = await journal.recordProgress({
    schema: 'metaengine.client.goal-progress.v1',
    request_id: requestId,
    found: true,
    task_state: 'RUNNING',
  });
  assert.equal(running.state, 'RUNNING');

  const completed = await journal.recordProgress({
    schema: 'metaengine.client.goal-progress.v1',
    request_id: requestId,
    found: true,
    task_state: 'COMPLETED',
  });
  assert.equal(completed.state, 'COMPLETED');
});

test('request id reuse with different goal fails closed', async () => {
  const store = storage();
  const journal = new ClientGoalJournal({ loadState: store.loadState, saveState: store.saveState });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'First goal' });
  await assert.rejects(
    () => journal.begin({ request_id: requestId, goal: 'Different goal' }),
    /client_goal_journal_request_collision/,
  );
});
