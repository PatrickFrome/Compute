import assert from 'node:assert/strict';
import test from 'node:test';

import { ClientGoalJournal } from '../src/client-goal-journal.mjs';
import {
  normalizeClientGoalExecutionProofReadback,
  normalizeClientGoalProgressReadback,
} from '../src/client-control-contract.mjs';
import { normalizeClientUsefulWorkProof } from '../src/client-useful-work-proof.mjs';
import { receipt, requestId, wireProof, wireProgress } from './fixtures/client-goal-proof.mjs';

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

function completedWire() {
  const proof = wireProof();
  proof.task_state = 'COMPLETED';
  proof.terminal = true;
  proof.result_proof.claim_disposition = 'ACCEPT';
  const progress = wireProgress();
  progress.task_state = 'COMPLETED';
  progress.terminal = true;
  progress.result_proof.claim_disposition = 'ACCEPT';
  return { proof, progress };
}

function usefulWire(execution, overrides = {}) {
  const artifactSha = '3'.repeat(64);
  return {
    schema: 'metaengine.client-v1.useful-work-proof.v1',
    found: true,
    request_id: execution.request_id,
    workspace_id: execution.workspace_id,
    roadmap_id: execution.roadmap_id,
    plan_generation: execution.plan_generation,
    alignment_epoch: execution.alignment_epoch,
    baseline_sha: execution.baseline_sha,
    plan_sha256: execution.plan_sha256,
    point_id: execution.point_id,
    task_id: execution.task_id,
    task_spec_sha256: execution.task_spec_sha256,
    lease_generation: execution.lease_generation,
    result_sha256: execution.result_proof.result_sha256,
    claim_sha256: execution.result_proof.claim_sha256,
    conversation_url_sha256: execution.agent_origin_proof.conversation_url_sha256,
    evidence_class: 'SYNTHETIC',
    evidence_origin: 'CONTROLLED_FIXTURE',
    repository: {
      repository_identity_sha256: '4'.repeat(64),
      checkout_sha: execution.baseline_sha,
      source_snapshot_sha256: '5'.repeat(64),
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: '6'.repeat(64),
      changed_file_manifest_sha256: '7'.repeat(64),
      changed_file_count: 1,
      materialized_edit_operations: 1,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: '8'.repeat(64),
      pre_repair_receipt_sha256: '9'.repeat(64),
      pre_repair_test_observed: true,
      pre_repair_exit_code: 1,
      post_repair_receipt_sha256: 'a'.repeat(64),
      post_repair_test_observed: true,
      post_repair_exit_code: 0,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: artifactSha,
      artifact_bytes: 64,
      artifact_subject_sha256: artifactSha,
      provenance_sha256: 'b'.repeat(64),
      verification_receipt_sha256: 'c'.repeat(64),
      provenance_verified: true,
      subject_digest_verified: true,
      artifact_verified: true,
      authority_effect: false,
    },
    review: {
      review_receipt_sha256: 'd'.repeat(64),
      independent_verifier: true,
      accepted: true,
      accepted_artifact_sha256: artifactSha,
      authority_effect: false,
    },
    serial_loop_end_to_end: true,
    user_goal_to_verified_artifact_readback: true,
    client_c5_useful_work_verified: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

async function seeded() {
  const store = storage();
  const journal = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: value => store.saveState(value),
  });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Repair one bounded fixture' });

  const wire = completedWire();
  const progress = normalizeClientGoalProgressReadback(wire.progress, requestId, receipt);
  const execution = normalizeClientGoalExecutionProofReadback(wire.proof, requestId, receipt);
  const useful = normalizeClientUsefulWorkProof(usefulWire(execution), execution);

  await journal.recordProgress(progress);
  await journal.recordExecutionProof(execution);
  await journal.recordUsefulWorkProof(useful);
  return { store, journal, progress, execution, useful };
}

test('accepted useful-work proof survives journal restart without gaining authority', async () => {
  const { store, useful } = await seeded();
  const restarted = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: value => store.saveState(value),
  });
  await restarted.load();

  const restored = restarted.latest();
  assert.deepEqual(restored.useful_work_proof, useful);
  assert.equal(restored.useful_work_proof.evidence_class, 'SYNTHETIC');
  assert.equal(restored.useful_work_proof.client_c5_useful_work_verified, false);
  assert.equal(restored.useful_work_proof.canonical_c2_promotion_authorized, false);
  assert.equal(restored.automatic_retry_allowed, false);
  assert.equal(restored.authority_effect, false);
});

for (const [name, mutate] of [
  ['lease generation', progress => { progress.lease_generation += 1; }],
  ['task state', progress => { progress.task_state = 'FENCED'; progress.terminal = true; }],
  ['result digest', progress => { progress.result_sha256 = 'e'.repeat(64); progress.result_summary_sha256 = 'e'.repeat(64); }],
  ['unknown progress', progress => { progress.found = false; }],
]) {
  test(`progress ${name} durably invalidates execution and useful-work proof across restart`, async () => {
    const { store, journal, progress } = await seeded();
    const next = structuredClone(progress);
    mutate(next);
    await journal.recordProgress(next);
    assert.equal(journal.latest().execution_proof, null);
    assert.equal(journal.latest().useful_work_proof, null);

    const restarted = new ClientGoalJournal({
      loadState: () => store.loadState(),
      saveState: value => store.saveState(value),
    });
    await restarted.load();
    assert.equal(restarted.latest().execution_proof, null);
    assert.equal(restarted.latest().useful_work_proof, null);
  });
}

test('new completed execution proof with result drift removes obsolete useful-work proof', async () => {
  const { journal, progress, execution } = await seeded();
  const result = 'e'.repeat(64);
  const nextProgress = {
    ...progress,
    result_sha256: result,
    result_summary_sha256: result,
  };
  await journal.recordProgress(nextProgress);
  assert.equal(journal.latest().useful_work_proof, null);

  const nextExecution = structuredClone(execution);
  nextExecution.result_proof.result_sha256 = result;
  nextExecution.result_proof.result_summary_sha256 = result;
  await journal.recordExecutionProof(nextExecution);
  assert.equal(journal.latest().execution_proof.result_proof.result_sha256, result);
  assert.equal(journal.latest().useful_work_proof, null);
});

test('restart drops a stale useful-work proof injected into an otherwise valid snapshot', async () => {
  const { store } = await seeded();
  const snapshot = store.read();
  snapshot.entries[0].useful_work_proof.lease_generation += 1;

  const restoredStore = storage(snapshot);
  const restarted = new ClientGoalJournal({
    loadState: () => restoredStore.loadState(),
    saveState: value => restoredStore.saveState(value),
  });
  await restarted.load();

  assert.equal(restarted.latest().execution_proof?.found, true);
  assert.equal(restarted.latest().useful_work_proof, null);
});

test('late useful-work proof from the previous execution binding is rejected', async () => {
  const { journal, progress, useful } = await seeded();
  await journal.recordProgress({ ...progress, lease_generation: 3 });
  await assert.rejects(
    () => journal.recordUsefulWorkProof(useful),
    /client_goal_journal_useful_work_proof_execution_drift/,
  );
  assert.equal(journal.latest().useful_work_proof, null);
});

test('failed durable useful-work write never publishes in-memory proof', async () => {
  const store = storage();
  const journal = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: value => store.saveState(value),
  });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Repair one bounded fixture' });

  const wire = completedWire();
  const progress = normalizeClientGoalProgressReadback(wire.progress, requestId, receipt);
  const execution = normalizeClientGoalExecutionProofReadback(wire.proof, requestId, receipt);
  const useful = normalizeClientUsefulWorkProof(usefulWire(execution), execution);

  await journal.recordProgress(progress);
  await journal.recordExecutionProof(execution);
  store.fail = true;
  await assert.rejects(() => journal.recordUsefulWorkProof(useful), /disk_write_failed/);
  assert.equal(journal.latest().useful_work_proof, null);

  store.fail = false;
  const restarted = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: value => store.saveState(value),
  });
  await restarted.load();
  assert.equal(restarted.latest().useful_work_proof, null);
});

test('concurrent progress drift wins before a queued late useful-work proof', async () => {
  const { store, progress, useful } = await seeded();
  let release;
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let pause = true;

  const journal = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: async value => {
      if (pause) {
        pause = false;
        reached();
        await gate;
      }
      await store.saveState(value);
    },
  });
  await journal.load();

  const advance = journal.recordProgress({ ...progress, lease_generation: 3 });
  await entered;
  const late = assert.rejects(
    () => journal.recordUsefulWorkProof(useful),
    /useful_work_proof_execution_drift/,
  );
  release();
  await Promise.all([advance, late]);

  assert.equal(journal.latest().progress.lease_generation, 3);
  assert.equal(journal.latest().execution_proof, null);
  assert.equal(journal.latest().useful_work_proof, null);
});

test('journal exposes no submit or effect-replay operation for restored useful work', () => {
  const names = Object.getOwnPropertyNames(ClientGoalJournal.prototype);
  assert.equal(names.includes('submit'), false);
  assert.equal(names.includes('replay'), false);
  assert.equal(names.includes('retry'), false);
  assert.equal(names.includes('recordUsefulWorkProof'), true);
});
