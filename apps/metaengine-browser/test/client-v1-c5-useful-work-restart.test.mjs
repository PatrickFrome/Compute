import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeClientGoalExecutionProofReadback,
  normalizeClientGoalProgressReadback,
} from '../src/client-control-contract.mjs';
import { ClientGoalJournal } from '../src/client-goal-journal.mjs';
import { normalizeClientUsefulWorkProof } from '../src/client-useful-work-proof.mjs';
import { receipt, requestId, wireProof, wireProgress } from './fixtures/client-goal-proof.mjs';

const mainSource = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

function storage(initial = null) {
  let value = structuredClone(initial);
  return {
    fail: false,
    saves: 0,
    loads: 0,
    async loadState() {
      this.loads += 1;
      return structuredClone(value);
    },
    async saveState(next) {
      if (this.fail) throw new Error('disk_write_failed');
      this.saves += 1;
      value = structuredClone(next);
    },
    read() {
      return structuredClone(value);
    },
  };
}

function completedReadbacks({ resultSha = '1'.repeat(64), claimSha = '2'.repeat(64), leaseGeneration = 2 } = {}) {
  const rawProgress = wireProgress();
  rawProgress.task_state = 'COMPLETED';
  rawProgress.terminal = true;
  rawProgress.lease_generation = leaseGeneration;
  rawProgress.result_summary_sha256 = resultSha;
  rawProgress.result_sha256 = resultSha;

  const rawExecution = wireProof();
  rawExecution.task_state = 'COMPLETED';
  rawExecution.terminal = true;
  rawExecution.lease_generation = leaseGeneration;
  rawExecution.agent_origin_proof = {
    ...rawExecution.agent_origin_proof,
    lease_generation: leaseGeneration,
    effect_state: 'PROVEN_CONVERSATION',
  };
  rawExecution.result_proof = {
    ...rawExecution.result_proof,
    result_summary_sha256: resultSha,
    result_sha256: resultSha,
    claim_sha256: claimSha,
    claim_disposition: 'ACCEPT',
    accepted: true,
  };

  return {
    progress: normalizeClientGoalProgressReadback(rawProgress, requestId, receipt),
    execution: normalizeClientGoalExecutionProofReadback(rawExecution, requestId, receipt),
  };
}

function usefulWork(execution, {
  artifactSha = '3'.repeat(64),
  provenanceSha = '4'.repeat(64),
  verificationReceiptSha = '5'.repeat(64),
  reviewReceiptSha = '6'.repeat(64),
  patchSha = '7'.repeat(64),
  changedManifestSha = '8'.repeat(64),
} = {}) {
  return normalizeClientUsefulWorkProof({
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
      repository_identity_sha256: '9'.repeat(64),
      checkout_sha: execution.baseline_sha,
      source_snapshot_sha256: 'a'.repeat(64),
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: patchSha,
      changed_file_manifest_sha256: changedManifestSha,
      changed_file_count: 1,
      materialized_edit_operations: 1,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: 'b'.repeat(64),
      pre_repair_receipt_sha256: 'c'.repeat(64),
      pre_repair_test_observed: true,
      pre_repair_exit_code: 1,
      post_repair_receipt_sha256: 'd'.repeat(64),
      post_repair_test_observed: true,
      post_repair_exit_code: 0,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: artifactSha,
      artifact_bytes: 4096,
      artifact_subject_sha256: artifactSha,
      provenance_sha256: provenanceSha,
      verification_receipt_sha256: verificationReceiptSha,
      provenance_verified: true,
      subject_digest_verified: true,
      artifact_verified: true,
      authority_effect: false,
    },
    review: {
      review_receipt_sha256: reviewReceiptSha,
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
  }, execution);
}

async function seeded({ store = storage(), readbacks = completedReadbacks() } = {}) {
  const journal = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: (value) => store.saveState(value),
  });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Repair one exact useful-work fixture' });
  await journal.recordProgress(readbacks.progress);
  await journal.recordExecutionProof(readbacks.execution);
  const proof = usefulWork(readbacks.execution);
  await journal.recordUsefulWorkProof(proof);
  return { journal, store, proof, ...readbacks };
}

test('accepted useful-work proof survives durable restart with evidence class intact', async () => {
  const { store, proof } = await seeded();
  const savesBeforeRestart = store.saves;

  const restarted = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: (value) => store.saveState(value),
  });
  await restarted.load();

  const row = restarted.latest();
  assert.equal(row.useful_work_proof.artifact.artifact_sha256, proof.artifact.artifact_sha256);
  assert.equal(row.useful_work_proof.evidence_class, 'SYNTHETIC');
  assert.equal(row.useful_work_proof.evidence_origin, 'CONTROLLED_FIXTURE');
  assert.equal(row.useful_work_proof.client_c5_useful_work_verified, false);
  assert.equal(row.useful_work_proof.canonical_c2_promotion_authorized, false);
  assert.equal(store.saves, savesBeforeRestart);
});

test('identical useful-work readback after restart is a no-op durable write', async () => {
  const { store, proof } = await seeded();
  const restarted = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: (value) => store.saveState(value),
  });
  await restarted.load();
  const saves = store.saves;
  const before = restarted.latest().updated_at;
  await restarted.recordUsefulWorkProof(proof);
  assert.equal(store.saves, saves);
  assert.equal(restarted.latest().updated_at, before);
});

test('new lease generation invalidates execution and useful-work proof durably', async () => {
  const { journal, store, progress } = await seeded();
  await journal.recordProgress({ ...progress, lease_generation: progress.lease_generation + 1 });
  assert.equal(journal.latest().execution_proof, null);
  assert.equal(journal.latest().useful_work_proof, null);

  const restarted = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: (value) => store.saveState(value),
  });
  await restarted.load();
  assert.equal(restarted.latest().execution_proof, null);
  assert.equal(restarted.latest().useful_work_proof, null);
});

test('new result digest invalidates old useful-work proof before new execution proof is recorded', async () => {
  const { journal } = await seeded();
  const next = completedReadbacks({ resultSha: 'e'.repeat(64), claimSha: 'f'.repeat(64) });
  await journal.recordProgress(next.progress);
  assert.equal(journal.latest().execution_proof, null);
  assert.equal(journal.latest().useful_work_proof, null);
  await journal.recordExecutionProof(next.execution);
  assert.equal(journal.latest().execution_proof.result_proof.result_sha256, 'e'.repeat(64));
  assert.equal(journal.latest().useful_work_proof, null);
});

test('same execution cannot silently replace accepted artifact or provenance evidence', async () => {
  const { journal, execution } = await seeded();
  const differentArtifact = usefulWork(execution, {
    artifactSha: 'e'.repeat(64),
    provenanceSha: 'f'.repeat(64),
    verificationReceiptSha: '0'.repeat(64),
    reviewReceiptSha: '1'.repeat(64),
  });
  await assert.rejects(
    () => journal.recordUsefulWorkProof(differentArtifact),
    /client_goal_journal_useful_work_proof_collision/,
  );
  assert.equal(journal.latest().useful_work_proof.artifact.artifact_sha256, '3'.repeat(64));
});

test('same artifact with different patch chain is also a collision', async () => {
  const { journal, execution } = await seeded();
  const differentEdit = usefulWork(execution, {
    patchSha: 'e'.repeat(64),
    changedManifestSha: 'f'.repeat(64),
  });
  await assert.rejects(
    () => journal.recordUsefulWorkProof(differentEdit),
    /client_goal_journal_useful_work_proof_collision/,
  );
});

test('failed durable useful-work write cannot publish in-memory proof', async () => {
  const store = storage();
  const readbacks = completedReadbacks();
  const journal = new ClientGoalJournal({
    loadState: () => store.loadState(),
    saveState: (value) => store.saveState(value),
  });
  await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Repair one exact useful-work fixture' });
  await journal.recordProgress(readbacks.progress);
  await journal.recordExecutionProof(readbacks.execution);
  const proof = usefulWork(readbacks.execution);

  store.fail = true;
  await assert.rejects(() => journal.recordUsefulWorkProof(proof), /disk_write_failed/);
  assert.equal(journal.latest().useful_work_proof, null);

  store.fail = false;
  await journal.recordUsefulWorkProof(proof);
  assert.equal(journal.latest().useful_work_proof.artifact.artifact_sha256, proof.artifact.artifact_sha256);
});

test('corrupted useful-work snapshot is discarded on restart after full proof revalidation', async () => {
  const { store } = await seeded();
  const snapshot = store.read();
  snapshot.entries[0].useful_work_proof.artifact.provenance_sha256 = 'not-a-digest';
  const corrupted = storage(snapshot);
  const restarted = new ClientGoalJournal({
    loadState: () => corrupted.loadState(),
    saveState: (value) => corrupted.saveState(value),
  });
  await restarted.load();
  assert.equal(restarted.latest().execution_proof?.found, true);
  assert.equal(restarted.latest().useful_work_proof, null);
});

test('restart reconciliation path remains read-only and never submits the goal again', () => {
  const start = mainSource.indexOf('async function reconcileClientGoal');
  const end = mainSource.indexOf('async function submitClientGoal', start);
  assert.ok(start >= 0 && end > start);
  const reconcile = mainSource.slice(start, end);
  assert.match(reconcile, /clientGoalProgress/);
  assert.match(reconcile, /clientGoalExecutionProof/);
  assert.doesNotMatch(reconcile, /clientGoalSubmit\s*\(/);
  assert.doesNotMatch(reconcile, /submitClientGoal\s*\(/);
});

test('journal module itself owns no provider, scheduler, browser or release authority', async () => {
  const { journal } = await seeded();
  const snapshot = journal.snapshot();
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.browser_actuation_authority, false);
  assert.equal(snapshot.release_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(snapshot.entries[0].useful_work_proof.authority_effect, false);
});
