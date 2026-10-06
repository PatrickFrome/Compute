import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CLIENT_C5_LIVE_OBJECTIVE,
  CLIENT_C5_LIVE_READINESS_SCHEMA,
  clientC5LiveCapsuleDigest,
  normalizeClientC5LiveReadinessCapsule,
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';

const SHA40_RE = /^[0-9a-f]{40}$/;
const FIXTURE_ROOT = 'coordination/client-v1/c5-live-readiness/fixture';
const ANSWER_PATH = `${FIXTURE_ROOT}/answer.mjs`;
const TEST_PATH = `${FIXTURE_ROOT}/answer.test.mjs`;
const BUILD_PATH = `${FIXTURE_ROOT}/build.mjs`;
const ARTIFACT_PATH = `${FIXTURE_ROOT}/dist/live-artifact.json`;
const BEFORE = 'export const answer = 41;\n';
const AFTER = 'export const answer = 42;\n';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error('client_c5_live_readiness_args_invalid');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function run(command, argv, { cwd, allowed = [0] } = {}) {
  const child = spawn(command, argv, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const result = {
    exit_code: exitCode,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr),
  };
  if (!allowed.includes(exitCode)) {
    throw new Error(`client_c5_live_readiness_command_failed:${command}:${exitCode}:${result.stderr.toString('utf8').slice(0, 300)}`);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const repository = path.resolve(args.repository || '');
const head = String(args.head || '').trim().toLowerCase();
const outDir = path.resolve(args.out || '');
const repositoryName = String(args['repository-name'] || process.env.GITHUB_REPOSITORY || 'PatrickFrome/Compute').trim();

if (!repository || !outDir || !SHA40_RE.test(head)) throw new Error('client_c5_live_readiness_input_invalid');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryName)) throw new Error('client_c5_live_repository_name_invalid');

const actualHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.toString('utf8').trim().toLowerCase();
if (actualHead !== head) throw new Error('client_c5_live_readiness_head_drift');

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'metaengine-client-c5-live-readiness-'));
const workspace = path.join(tempRoot, 'workspace');

try {
  await run('git', ['clone', '--no-hardlinks', '--no-tags', '--no-checkout', repository, workspace]);
  await run('git', ['-C', workspace, 'checkout', '--detach', head]);

  const workspaceHead = (await run('git', ['-C', workspace, 'rev-parse', 'HEAD'])).stdout.toString('utf8').trim().toLowerCase();
  if (workspaceHead !== head) throw new Error('client_c5_live_readiness_workspace_head_drift');

  const answerBefore = await readFile(path.join(workspace, ...ANSWER_PATH.split('/')));
  const testBytes = await readFile(path.join(workspace, ...TEST_PATH.split('/')));
  const buildBytes = await readFile(path.join(workspace, ...BUILD_PATH.split('/')));
  if (answerBefore.toString('utf8') !== BEFORE) throw new Error('client_c5_live_fixture_baseline_invalid');

  const pre = await run('node', ['--test', TEST_PATH], { cwd: workspace, allowed: [0, 1] });
  if (pre.exit_code === 0) throw new Error('client_c5_live_pre_repair_must_fail');

  await writeFile(path.join(workspace, ...ANSWER_PATH.split('/')), AFTER, 'utf8');

  const post = await run('node', ['--test', TEST_PATH], { cwd: workspace, allowed: [0, 1] });
  if (post.exit_code !== 0) throw new Error('client_c5_live_post_repair_must_pass');

  const build = await run('node', [BUILD_PATH], { cwd: workspace });
  if (build.exit_code !== 0) throw new Error('client_c5_live_build_must_pass');

  const answerAfter = await readFile(path.join(workspace, ...ANSWER_PATH.split('/')));
  const artifactBytes = await readFile(path.join(workspace, ...ARTIFACT_PATH.split('/')));
  const artifact = JSON.parse(artifactBytes.toString('utf8'));
  if (
    artifact.schema !== 'metaengine.client-v1.c5-live-artifact.v1'
    || artifact.answer !== 42
    || artifact.verified_behavior !== 'answer-is-42'
  ) throw new Error('client_c5_live_artifact_payload_invalid');

  const patch = (await run('git', ['-C', workspace, 'diff', '--binary', '--', ANSWER_PATH])).stdout;
  if (!patch.length) throw new Error('client_c5_live_patch_missing');

  const changedPaths = (await run('git', ['-C', workspace, 'diff', '--name-only'])).stdout
    .toString('utf8').trim().split('\n').filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== ANSWER_PATH) throw new Error('client_c5_live_changed_path_escape');

  const changedManifest = [{
    path: ANSWER_PATH,
    change: 'MODIFY',
    before_sha256: sha256ClientC5(answerBefore),
    after_sha256: sha256ClientC5(answerAfter),
  }];

  const commands = {
    pre_repair: ['node', '--test', TEST_PATH],
    post_repair: ['node', '--test', TEST_PATH],
    build: ['node', BUILD_PATH],
    shell: false,
    network_required: false,
  };
  const commandContractSha256 = sha256ClientC5(stableClientC5Json(commands));
  const changedFileManifestSha256 = sha256ClientC5(stableClientC5Json(changedManifest));
  const canonicalPatchSha256 = sha256ClientC5(patch);
  const artifactSha256 = sha256ClientC5(artifactBytes);

  const fixtureSnapshot = {
    answer_before_sha256: sha256ClientC5(answerBefore),
    test_sha256: sha256ClientC5(testBytes),
    build_sha256: sha256ClientC5(buildBytes),
  };
  const fixtureSnapshotSha256 = sha256ClientC5(stableClientC5Json(fixtureSnapshot));
  const repositoryIdentitySha256 = sha256ClientC5(`${repositoryName}\n`);

  const objective = CLIENT_C5_LIVE_OBJECTIVE;

  const material = {
    schema: CLIENT_C5_LIVE_READINESS_SCHEMA,
    source_head: head,
    repository_identity_sha256: repositoryIdentitySha256,
    roadmap_id: 'metaengine-client-v1',
    canonical_owner: 'C2_FIRST_SERIAL_CODING_LOOP',
    client_gate: 'C5_USEFUL_WORK',
    objective,
    objective_sha256: sha256ClientC5(objective),
    fixture_snapshot_sha256: fixtureSnapshotSha256,
    target: {
      fixture_root: FIXTURE_ROOT,
      allowed_changed_paths: [ANSWER_PATH],
      max_changed_files: 1,
      test_path: TEST_PATH,
      build_path: BUILD_PATH,
      artifact_path: ARTIFACT_PATH,
      network_required: false,
      isolated_workspace_required: true,
      host_repository_mutation_allowed: false,
      host_git_exposed_allowed: false,
      linked_worktree_allowed: false,
    },
    commands,
    command_contract_sha256: commandContractSha256,
    fixture: {
      ...fixtureSnapshot,
      answer_after_sha256: sha256ClientC5(answerAfter),
      pre_repair_exit_code: pre.exit_code,
      post_repair_exit_code: post.exit_code,
      build_exit_code: build.exit_code,
    },
    changed_file_manifest_sha256: changedFileManifestSha256,
    canonical_patch_sha256: canonicalPatchSha256,
    expected_artifact_sha256: artifactSha256,
    expected_artifact_bytes: artifactBytes.length,
    expected_artifact: {
      path: ARTIFACT_PATH,
      schema: artifact.schema,
      sha256: artifactSha256,
      bytes: artifactBytes.length,
      answer: artifact.answer,
      verified_behavior: artifact.verified_behavior,
    },
    live_readback_contract: {
      evidence_class: 'LIVE',
      evidence_origin: 'SIGNED_SUPERVISOR_READBACK',
      baseline_sha: head,
      repository_identity_sha256: repositoryIdentitySha256,
      command_contract_sha256: commandContractSha256,
      changed_file_manifest_sha256: changedFileManifestSha256,
      patch_sha256: canonicalPatchSha256,
      artifact_sha256: artifactSha256,
      artifact_bytes: artifactBytes.length,
      independent_verifier_required: true,
      user_goal_to_agent_readback_required: true,
      user_goal_to_result_readback_required: true,
    },
    dispatch_gate: {
      required_environment: 'client-v1-c5-live',
      environment_protection_verified: false,
      human_approval_required: true,
      prevent_self_review_required: true,
      explicit_live_effect_authorization_required: true,
      single_flight_required: true,
      live_effect_authorized: false,
      provider_contacted: false,
      goal_submitted: false,
      execution_ready: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    },
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };

  const capsule = {
    ...material,
    capsule_sha256: clientC5LiveCapsuleDigest(material),
  };
  normalizeClientC5LiveReadinessCapsule(capsule);

  const receipt = {
    schema: 'metaengine.client-v1.c5-live-readiness-receipt.v1',
    source_head: head,
    capsule_sha256: capsule.capsule_sha256,
    fixture_pre_repair_failed: true,
    fixture_post_repair_passed: true,
    fixture_build_passed: true,
    canonical_repair_single_file: true,
    expected_artifact_sha256: artifactSha256,
    environment_protection_verified: false,
    live_effect_authorized: false,
    provider_contacted: false,
    goal_submitted: false,
    execution_ready: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'client-c5-live-readiness-capsule.json'), stableClientC5Json(capsule), 'utf8');
  await writeFile(path.join(outDir, 'client-c5-live-readiness-receipt.json'), stableClientC5Json(receipt), 'utf8');
  await writeFile(path.join(outDir, 'expected-changed-file-manifest.json'), stableClientC5Json(changedManifest), 'utf8');
  await writeFile(path.join(outDir, 'expected-repair.patch'), patch);
  await writeFile(path.join(outDir, 'expected-live-artifact.json'), artifactBytes);

  process.stdout.write(stableClientC5Json(receipt));
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
