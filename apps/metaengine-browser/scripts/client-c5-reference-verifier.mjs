import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeClientUsefulWorkProof } from '../src/client-useful-work-proof.mjs';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('client_c5_reference_verify_args_invalid');
    out[key.slice(2)] = value;
  }
  return out;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(stableJson(value), 'utf8'));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

const args = parseArgs(process.argv.slice(2));
const bundleDir = path.resolve(args.bundle || '');
const expectedHead = String(args.head || '').toLowerCase();
const outDir = path.resolve(args.out || '');

if (!SHA40_RE.test(expectedHead)) throw new Error('client_c5_reference_verify_head_invalid');
if (!bundleDir || !outDir) throw new Error('client_c5_reference_verify_path_invalid');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const producer = await readJson(path.join(bundleDir, 'producer-receipt.json'));
const provenance = await readJson(path.join(bundleDir, 'provenance.json'));
const commandContract = await readJson(path.join(bundleDir, 'command-contract.json'));
const changedManifest = await readJson(path.join(bundleDir, 'changed-file-manifest.json'));
const preReceipt = await readJson(path.join(bundleDir, 'pre-repair-receipt.json'));
const postReceipt = await readJson(path.join(bundleDir, 'post-repair-receipt.json'));
const buildReceipt = await readJson(path.join(bundleDir, 'build-receipt.json'));
const artifactPath = path.join(bundleDir, 'artifact', 'reference-artifact.json');
const artifactBytes = await readFile(artifactPath);
const patchBytes = await readFile(path.join(bundleDir, 'raw', 'repair.patch'));

assert.equal(producer.schema, 'metaengine.client-v1.c5-reference-producer.v1');
assert.equal(producer.expected_head, expectedHead);
assert.equal(producer.evidence_class, 'SYNTHETIC');
assert.equal(producer.evidence_origin, 'CONTROLLED_FIXTURE');
assert.equal(producer.client_c5_useful_work_verified, false);
assert.equal(producer.canonical_c2_promotion_authorized, false);
assert.equal(producer.authority_effect, false);
assert.equal(producer.independent_verification_required, true);
assert.equal(producer.independent_git_directories, true);
assert.equal(producer.git_alternates_absent, true);
assert.equal(producer.linked_worktree_exposed, false);
assert.equal(producer.source_snapshot_read_only, true);

assert.equal(provenance.schema, 'metaengine.client-v1.c5-reference-provenance.v1');
assert.equal(provenance.source_head, expectedHead);
assert.equal(provenance.evidence_class, 'SYNTHETIC');
assert.equal(provenance.evidence_origin, 'CONTROLLED_FIXTURE');
assert.equal(provenance.authority_effect, false);

const commandContractSha256 = sha256Json(commandContract);
const changedManifestSha256 = sha256Json(changedManifest);
const preReceiptSha256 = sha256Json(preReceipt);
const postReceiptSha256 = sha256Json(postReceipt);
const buildReceiptSha256 = sha256Json(buildReceipt);
const patchSha256 = sha256Bytes(patchBytes);
const artifactSha256 = sha256Bytes(artifactBytes);
const provenanceSha256 = sha256Json(provenance);
const artifactStat = await stat(artifactPath);

for (const [name, value] of [
  ['command_contract', commandContractSha256],
  ['changed_manifest', changedManifestSha256],
  ['pre_receipt', preReceiptSha256],
  ['post_receipt', postReceiptSha256],
  ['build_receipt', buildReceiptSha256],
  ['patch', patchSha256],
  ['artifact', artifactSha256],
  ['provenance', provenanceSha256],
]) {
  if (!SHA256_RE.test(value)) throw new Error(`client_c5_reference_verify_digest_invalid:${name}`);
}

assert.equal(commandContractSha256, producer.verification.command_contract_sha256);
assert.equal(changedManifestSha256, producer.edit.changed_file_manifest_sha256);
assert.equal(preReceiptSha256, producer.verification.pre_repair_receipt_sha256);
assert.equal(postReceiptSha256, producer.verification.post_repair_receipt_sha256);
assert.equal(buildReceiptSha256, producer.verification.build_receipt_sha256);
assert.equal(patchSha256, producer.edit.patch_sha256);
assert.equal(artifactSha256, producer.artifact.artifact_sha256);
assert.equal(artifactSha256, producer.artifact.artifact_subject_sha256);
assert.equal(provenanceSha256, producer.artifact.provenance_sha256);
assert.equal(artifactStat.size, producer.artifact.artifact_bytes);

assert.equal(provenance.command_contract_sha256, commandContractSha256);
assert.equal(provenance.changed_file_manifest_sha256, changedManifestSha256);
assert.equal(provenance.pre_repair_receipt_sha256, preReceiptSha256);
assert.equal(provenance.post_repair_receipt_sha256, postReceiptSha256);
assert.equal(provenance.build_receipt_sha256, buildReceiptSha256);
assert.equal(provenance.patch_sha256, patchSha256);
assert.equal(provenance.artifact_sha256, artifactSha256);
assert.equal(provenance.artifact_bytes, artifactStat.size);

assert.equal(preReceipt.schema, 'metaengine.client-v1.c5-command-receipt.v1');
assert.notEqual(preReceipt.exit_code, 0);
assert.equal(postReceipt.schema, 'metaengine.client-v1.c5-command-receipt.v1');
assert.equal(postReceipt.exit_code, 0);
assert.equal(buildReceipt.schema, 'metaengine.client-v1.c5-command-receipt.v1');
assert.equal(buildReceipt.exit_code, 0);

assert.equal(changedManifest.length, 1);
assert.equal(changedManifest[0].path, 'apps/metaengine-browser/test/fixtures/client-c5-reference-project/answer.mjs');
assert.equal(changedManifest[0].change, 'MODIFY');
assert.notEqual(changedManifest[0].before_sha256, changedManifest[0].after_sha256);

const artifact = JSON.parse(artifactBytes.toString('utf8'));
assert.deepEqual(artifact, {
  answer: 42,
  schema: 'metaengine.client-v1.c5-reference-artifact.v1',
  verified_behavior: 'answer-is-42',
});

const verificationCore = {
  schema: 'metaengine.client-v1.c5-reference-independent-verification.v1',
  source_head: expectedHead,
  producer_run_id: provenance.github_run_id,
  producer_run_attempt: provenance.github_run_attempt,
  producer_job: provenance.github_job,
  verifier_run_id: process.env.GITHUB_RUN_ID || null,
  verifier_run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 0),
  verifier_job: process.env.GITHUB_JOB || null,
  separate_github_job: process.env.GITHUB_JOB !== provenance.github_job,
  command_contract_sha256: commandContractSha256,
  patch_sha256: patchSha256,
  changed_file_manifest_sha256: changedManifestSha256,
  pre_repair_receipt_sha256: preReceiptSha256,
  post_repair_receipt_sha256: postReceiptSha256,
  build_receipt_sha256: buildReceiptSha256,
  artifact_sha256: artifactSha256,
  artifact_bytes: artifactStat.size,
  provenance_sha256: provenanceSha256,
  pre_repair_failed: preReceipt.exit_code !== 0,
  post_repair_passed: postReceipt.exit_code === 0,
  build_passed: buildReceipt.exit_code === 0,
  subject_digest_verified: true,
  provenance_verified: true,
  artifact_verified: true,
  independent_verifier: true,
  accepted: true,
  evidence_class: 'SYNTHETIC',
  evidence_origin: 'CONTROLLED_FIXTURE',
  client_c5_useful_work_verified: false,
  canonical_c2_promotion_authorized: false,
  authority_effect: false,
};
assert.equal(verificationCore.separate_github_job, true);
const verificationReceiptSha256 = sha256Json(verificationCore);
const verificationReceipt = {
  ...verificationCore,
  receipt_sha256: verificationReceiptSha256,
};
await writeFile(path.join(outDir, 'verification-receipt.json'), stableJson(verificationReceipt), 'utf8');

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const planSha256 = sha256Bytes(Buffer.from(`controlled-plan:${expectedHead}`, 'utf8'));
const taskSpecSha256 = sha256Bytes(Buffer.from(`controlled-task:${expectedHead}`, 'utf8'));
const conversationSha256 = sha256Bytes(Buffer.from(`controlled-conversation:${expectedHead}`, 'utf8'));
const agentSurfaceSha256 = sha256Bytes(Buffer.from(`controlled-agent-surface:${expectedHead}`, 'utf8'));
const promptSha256 = sha256Bytes(Buffer.from(`controlled-prompt:${expectedHead}`, 'utf8'));
const claimSha256 = sha256Json({
  schema: 'metaengine.agent-result-claim.v1',
  fixture_only: true,
  artifact_sha256: artifactSha256,
});

const executionProof = {
  schema: 'metaengine.client.goal-execution-proof.v1',
  request_id: requestId,
  found: true,
  workspace_id: workspaceId,
  roadmap_id: 'metaengine-client-v1',
  plan_generation: 1,
  alignment_epoch: 1,
  baseline_sha: expectedHead,
  plan_sha256: planSha256,
  point_id: 'obj.client-c5-reference-useful-work.v1',
  task_id: taskId,
  task_spec_sha256: taskSpecSha256,
  task_state: 'COMPLETED',
  terminal: true,
  lease_generation: 1,
  survives_plan_retirement: true,
  agent_origin_proof: {
    proven: true,
    contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
    conversation_url_sha256: conversationSha256,
    agent_surface_sha256: agentSurfaceSha256,
    prompt_sha256: promptSha256,
    effect_state: 'PROVEN_CONVERSATION',
    lease_generation: 1,
    proven_at: null,
    agent_identity_exposed: false,
    tab_identity_exposed: false,
    target_identity_exposed: false,
    authority_effect: false,
  },
  result_proof: {
    available: true,
    result_summary_sha256: artifactSha256,
    result_sha256: artifactSha256,
    claim_valid: true,
    claim_schema: 'metaengine.agent-result-claim.v1',
    claim_sha256: claimSha256,
    claim_disposition: 'ACCEPT',
    conversation_url_sha256: conversationSha256,
    origin_bound: true,
    accepted: true,
    result_summary_exposed: false,
    model_output_exposed: false,
    page_content_exposed: false,
    authority_effect: false,
  },
  user_goal_to_agent_readback: true,
  user_goal_to_result_readback: true,
  task_payload_exposed: false,
  result_summary_exposed: false,
  page_content_exposed: false,
  model_output_exposed: false,
  scheduler_identity_exposed: false,
  automatic_retry_allowed: false,
  scheduler_authority: false,
  browser_actuation_authority: false,
  release_authority: false,
  authority_effect: false,
  controlled_fixture_only: true,
};

const usefulWorkProof = {
  schema: 'metaengine.client-v1.useful-work-proof.v1',
  found: true,
  request_id: requestId,
  workspace_id: workspaceId,
  roadmap_id: 'metaengine-client-v1',
  plan_generation: 1,
  alignment_epoch: 1,
  baseline_sha: expectedHead,
  plan_sha256: planSha256,
  point_id: 'obj.client-c5-reference-useful-work.v1',
  task_id: taskId,
  task_spec_sha256: taskSpecSha256,
  lease_generation: 1,
  result_sha256: artifactSha256,
  claim_sha256: claimSha256,
  conversation_url_sha256: conversationSha256,
  evidence_class: 'SYNTHETIC',
  evidence_origin: 'CONTROLLED_FIXTURE',
  repository: producer.repository,
  edit: producer.edit,
  verification: {
    command_contract_sha256: commandContractSha256,
    pre_repair_receipt_sha256: preReceiptSha256,
    pre_repair_test_observed: true,
    pre_repair_exit_code: preReceipt.exit_code,
    post_repair_receipt_sha256: postReceiptSha256,
    post_repair_test_observed: true,
    post_repair_exit_code: postReceipt.exit_code,
    real_build_or_test: true,
    repair_verified: true,
    authority_effect: false,
  },
  artifact: {
    artifact_sha256: artifactSha256,
    artifact_bytes: artifactStat.size,
    artifact_subject_sha256: artifactSha256,
    provenance_sha256: provenanceSha256,
    verification_receipt_sha256: verificationReceiptSha256,
    provenance_verified: true,
    subject_digest_verified: true,
    artifact_verified: true,
    authority_effect: false,
  },
  review: {
    review_receipt_sha256: verificationReceiptSha256,
    independent_verifier: true,
    accepted: true,
    accepted_artifact_sha256: artifactSha256,
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
};

const normalized = normalizeClientUsefulWorkProof(usefulWorkProof, executionProof);
assert.equal(normalized.evidence_class, 'SYNTHETIC');
assert.equal(normalized.evidence_origin, 'CONTROLLED_FIXTURE');
assert.equal(normalized.client_c5_useful_work_verified, false);
assert.equal(normalized.canonical_c2_promotion_authorized, false);
assert.equal(normalized.user_goal_to_verified_artifact_readback, true);
assert.deepEqual(normalized.canonical_c2_criteria, {
  repo_checkout: true,
  isolated_edit: true,
  real_build_or_test: true,
  verified_artifact: true,
  serial_loop_end_to_end: true,
});

await writeFile(path.join(outDir, 'synthetic-execution-proof.json'), stableJson(executionProof), 'utf8');
await writeFile(path.join(outDir, 'synthetic-useful-work-proof.json'), stableJson(usefulWorkProof), 'utf8');
await writeFile(path.join(outDir, 'normalized-synthetic-useful-work-proof.json'), stableJson(normalized), 'utf8');

process.stdout.write(stableJson({
  schema: verificationReceipt.schema,
  source_head: expectedHead,
  artifact_sha256: artifactSha256,
  provenance_sha256: provenanceSha256,
  verification_receipt_sha256: verificationReceiptSha256,
  pre_repair_failed: true,
  post_repair_passed: true,
  build_passed: true,
  independent_verifier: true,
  client_c5_useful_work_verified: false,
  canonical_c2_promotion_authorized: false,
  authority_effect: false,
}));
