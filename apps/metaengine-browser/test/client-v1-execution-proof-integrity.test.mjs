import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientGoalJournal } from '../src/client-goal-journal.mjs';
import {
  normalizeClientGoalExecutionProofReadback,
  normalizeClientGoalProgressReadback,
} from '../src/client-control-contract.mjs';
import { receipt, requestId, wireProof, wireProgress } from './fixtures/client-goal-proof.mjs';

for (const [name, change] of [
  ['result unavailable', p => { p.result_proof.available = false; }],
  ['result digest drift', p => { p.result_proof.result_sha256 = '3'.repeat(64); }],
  ['rejected result', p => { p.result_proof.claim_disposition = 'REJECT'; }],
  ['blocked result', p => { p.result_proof.claim_disposition = 'BLOCKED'; }],
  ['failed result', p => { p.result_proof.claim_disposition = 'FAILED'; }],
  ['unleased Agent proof', p => { p.lease_generation = 0; p.agent_origin_proof.lease_generation = 0; }],
]) {
  test(`positive execution proof rejects ${name}`, () => {
    const value = wireProof();
    change(value);
    assert.throws(() => normalizeClientGoalExecutionProofReadback(value, requestId, receipt));
  });
}

function storage(initial = null) {
  let value = structuredClone(initial);
  return {
    fail: false,
    async loadState() { return structuredClone(value); },
    async saveState(next) {
      if (this.fail) throw new Error('disk_write_failed');
      value = structuredClone(next);
    },
    read() { return structuredClone(value); },
  };
}

async function seeded() {
  const store = storage();
  const journal = new ClientGoalJournal({ loadState: () => store.loadState(), saveState: s => store.saveState(s) });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Ship exact proof' });
  const progress = normalizeClientGoalProgressReadback(wireProgress(), requestId, receipt);
  const proof = normalizeClientGoalExecutionProofReadback(wireProof(), requestId, receipt);
  await journal.recordProgress(progress);
  await journal.recordExecutionProof(proof);
  return { store, journal, progress, proof };
}

for (const [name, change] of [
  ['lease generation', p => { p.lease_generation += 1; }],
  ['task state', p => { p.task_state = 'FENCED'; p.terminal = true; }],
  ['result digest', p => { p.result_sha256 = '3'.repeat(64); }],
  ['unknown progress', p => { p.found = false; }],
]) {
  test(`new ${name} removes obsolete proof durably, including after restart`, async () => {
    const { journal, store, progress } = await seeded();
    const next = structuredClone(progress);
    change(next);
    await journal.recordProgress(next);
    assert.equal(journal.latest().execution_proof, null);
    const restarted = new ClientGoalJournal({ loadState: () => store.loadState(), saveState: s => store.saveState(s) });
    await restarted.load();
    assert.equal(restarted.latest().execution_proof, null);
  });
}

test('late proof from the previous lease cannot overwrite newer progress', async () => {
  const { journal, progress, proof } = await seeded();
  await journal.recordProgress({ ...progress, lease_generation: 3 });
  await assert.rejects(() => journal.recordExecutionProof(proof), /client_goal_journal_execution_proof_progress_drift/);
  assert.equal(journal.latest().progress.lease_generation, 3);
  assert.equal(journal.latest().execution_proof, null);
});

test('restart discards an older-format snapshot with a mismatched proof', async () => {
  const { store } = await seeded();
  const snapshot = store.read();
  snapshot.entries[0].progress.lease_generation += 1;
  const restoredStore = storage(snapshot);
  const restored = new ClientGoalJournal({ loadState: () => restoredStore.loadState(), saveState: s => restoredStore.saveState(s) });
  await restored.load();
  assert.equal(restored.latest().execution_proof, null);
});

test('matching progress keeps valid proof', async () => {
  const { journal, progress } = await seeded();
  await journal.recordProgress({ ...progress, updated_at: '2026-09-30T01:00:00Z' });
  assert.equal(journal.latest().execution_proof.user_goal_to_result_readback, true);
});

test('failed durable write cannot change the published journal state', async () => {
  const { journal, store, progress } = await seeded();
  store.fail = true;
  await assert.rejects(() => journal.recordProgress({ ...progress, lease_generation: 3 }), /disk_write_failed/);
  assert.equal(journal.latest().progress.lease_generation, 2);
  store.fail = false;
  await journal.recordProgress({ ...progress, lease_generation: 3 });
  assert.equal(journal.latest().execution_proof, null);
});

test('concurrent progress write and late proof serialize against the latest durable binding', async () => {
  const { store, progress, proof } = await seeded();
  let release;
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let pause = true;
  const journal = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: async next => {
      if (pause) { pause = false; reached(); await gate; }
      await store.saveState(next);
    },
  });
  await journal.load();
  const advance = journal.recordProgress({ ...progress, lease_generation: 3 });
  await entered;
  const obsolete = assert.rejects(() => journal.recordExecutionProof(proof), /progress_drift/);
  release();
  await Promise.all([advance, obsolete]);
  assert.equal(journal.latest().progress.lease_generation, 3);
  assert.equal(store.read().entries[0].progress.lease_generation, 3);
  assert.equal(journal.latest().execution_proof, null);
});

test('failed correlation barrier does not publish a request that was never saved', async () => {
  const store = storage();
  store.fail = true;
  const journal = new ClientGoalJournal({ loadState: () => store.loadState(), saveState: s => store.saveState(s) });
  await journal.load();
  await assert.rejects(() => journal.begin({ request_id: requestId, goal: 'Ship exact proof' }), /disk_write_failed/);
  assert.equal(journal.get(requestId), null);
  store.fail = false;
  await journal.begin({ request_id: requestId, goal: 'Ship exact proof' });
  assert.equal(store.read().entries[0].request_id, requestId);
});
