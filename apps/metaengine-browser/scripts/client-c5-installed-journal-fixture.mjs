import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ClientGoalJournal } from '../src/client-goal-journal.mjs';
import {
  normalizeClientGoalExecutionProofReadback,
  normalizeClientGoalProgressReadback,
} from '../src/client-control-contract.mjs';
import { normalizeClientUsefulWorkProof } from '../src/client-useful-work-proof.mjs';

const SHA40_RE = /^[0-9a-f]{40}$/;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error('client_c5_journal_fixture_args_invalid');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

const input = args(process.argv.slice(2));
const target = path.resolve(input.out || '');
const baseline = String(input.baseline || '').toLowerCase();
const mode = String(input.mode || 'valid').toLowerCase();
if (!target) throw new Error('client_c5_journal_fixture_out_required');
if (!SHA40_RE.test(baseline)) throw new Error('client_c5_journal_fixture_baseline_invalid');
if (!['valid', 'stale'].includes(mode)) throw new Error('client_c5_journal_fixture_mode_invalid');

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const pointId = 'obj.client-c5-installed-restart.v1';
const conversation = 'a'.repeat(64);
const resultSha = '1'.repeat(64);
const claimSha = '2'.repeat(64);
const artifactSha = '3'.repeat(64);
const planSha = 'c'.repeat(64);
const taskSpecSha = 'd'.repeat(64);

const receipt = Object.freeze({
  schema: 'metaengine.client.goal-submission.v1',
  request_id: requestId,
  goal: 'Verify installed journal restart continuity',
  objective_id: 'metaengine-client-v1:g1',
  roadmap_id: 'metaengine-client-v1',
  workspace_id: workspaceId,
  alignment_epoch: 1,
  baseline_sha: baseline,
  plan_sha256: planSha,
  task_spec_sha256: taskSpecSha,
  plan_generation: 1,
  point_ids: [pointId],
  node_count: 1,
  task_id: taskId,
  task_ids: [taskId],
  task_admission_state: 'ADMITTED',
  atomic_plan_and_admission: true,
  exact_activation_readback: true,
  operator_initiated: true,
  request_replayed: false,
  exact_request_correlation: true,
  reconciliation_required: false,
  automatic_retry_allowed: false,
  scheduler_authority: false,
  browser_actuation_authority: false,
  release_authority: false,
  authority_effect: false,
});

const wireProgress = {
  schema: 'metaengine.client-v1.goal-progress.v1',
  found: true,
  request_id: requestId,
  workspace_id: workspaceId,
  roadmap_id: 'metaengine-client-v1',
  plan_generation: 1,
  alignment_epoch: 1,
  baseline_sha: baseline,
  plan_sha256: planSha,
  point_id: pointId,
  task_id: taskId,
  task_spec_sha256: taskSpecSha,
  task_state: 'COMPLETED',
  terminal: true,
  lease_generation: 1,
  result_checkpoint_id: null,
  result_summary_sha256: resultSha,
  result_sha256: resultSha,
  error_code: null,
  survives_plan_retirement: true,
  task_payload_returned: false,
  result_summary_returned: false,
  scheduler_identity_returned: false,
  automatic_retry_allowed: false,
  scheduler_authority: false,
  browser_authority: false,
  release_authority: false,
  authority_effect: false,
};

const wireExecution = {
  ...wireProgress,
  schema: 'metaengine.client-v1.goal-execution-proof.v1',
  agent_origin_proof: {
    proven: true,
    contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
    conversation_url_sha256: conversation,
    agent_surface_sha256: 'e'.repeat(64),
    prompt_sha256: 'f'.repeat(64),
    effect_state: 'PROVEN_CONVERSATION',
    lease_generation: 1,
    proven_at: '2026-10-06T00:00:00Z',
    agent_identity_returned: false,
    tab_identity_returned: false,
    target_identity_returned: false,
    authority_effect: false,
  },
  result_proof: {
    available: true,
    result_summary_sha256: resultSha,
    result_sha256: resultSha,
    claim_valid: true,
    claim_schema: 'metaengine.agent-result-claim.v1',
    claim_sha256: claimSha,
    claim_disposition: 'ACCEPT',
    conversation_url_sha256: conversation,
    origin_bound: true,
    accepted: true,
    result_summary_returned: false,
    model_output_returned: false,
    page_content_returned: false,
    authority_effect: false,
  },
  user_goal_to_agent_readback: true,
  user_goal_to_result_readback: true,
  page_content_returned: false,
  model_output_returned: false,
};

const progress = normalizeClientGoalProgressReadback(wireProgress, requestId, receipt);
const execution = normalizeClientGoalExecutionProofReadback(wireExecution, requestId, receipt);
const useful = normalizeClientUsefulWorkProof({
  schema: 'metaengine.client-v1.useful-work-proof.v1',
  found: true,
  request_id: requestId,
  workspace_id: workspaceId,
  roadmap_id: 'metaengine-client-v1',
  plan_generation: 1,
  alignment_epoch: 1,
  baseline_sha: baseline,
  plan_sha256: planSha,
  point_id: pointId,
  task_id: taskId,
  task_spec_sha256: taskSpecSha,
  lease_generation: 1,
  result_sha256: resultSha,
  claim_sha256: claimSha,
  conversation_url_sha256: conversation,
  evidence_class: 'SYNTHETIC',
  evidence_origin: 'CONTROLLED_FIXTURE',
  repository: {
    repository_identity_sha256: '4'.repeat(64),
    checkout_sha: baseline,
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
}, execution);

let persisted = null;
const journal = new ClientGoalJournal({
  loadState: async () => {
    const error = new Error('not_found');
    error.code = 'ENOENT';
    throw error;
  },
  saveState: async (value) => { persisted = structuredClone(value); },
});
await journal.load();
await journal.begin({ request_id: requestId, goal: receipt.goal });
await journal.recordSubmission(receipt);
await journal.recordProgress(progress);
await journal.recordExecutionProof(execution);
await journal.recordUsefulWorkProof(useful);

const snapshot = structuredClone(persisted);
if (mode === 'stale') {
  snapshot.entries[0].useful_work_proof.lease_generation = 2;
}
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });

process.stdout.write(JSON.stringify({
  schema: 'metaengine.client-v1.c5-installed-journal-fixture.v1',
  mode,
  target,
  request_id: requestId,
  baseline_sha: baseline,
  state: snapshot.entries[0].state,
  execution_proof_present: snapshot.entries[0].execution_proof != null,
  useful_work_proof_present_on_disk: snapshot.entries[0].useful_work_proof != null,
  useful_work_lease_generation_on_disk: snapshot.entries[0].useful_work_proof?.lease_generation ?? null,
  execution_lease_generation_on_disk: snapshot.entries[0].execution_proof?.lease_generation ?? null,
  evidence_class: snapshot.entries[0].useful_work_proof?.evidence_class || null,
  client_c5_useful_work_verified: false,
  canonical_c2_promotion_authorized: false,
  authority_effect: false,
}) + '\n');
