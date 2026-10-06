import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SHA40_RE = /^[0-9a-f]{40}$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('client_c5_reference_args_invalid');
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

async function run(command, args, { cwd, allowed = [0] } = {}) {
  const startedAt = new Date().toISOString();
  const child = spawn(command, args, {
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
  const out = Buffer.concat(stdout);
  const err = Buffer.concat(stderr);
  if (!allowed.includes(exitCode)) {
    throw new Error(`client_c5_reference_command_failed:${command}:${exitCode}:${err.toString('utf8').slice(0, 400)}`);
  }
  return {
    command,
    args,
    exit_code: exitCode,
    stdout: out,
    stderr: err,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  };
}

async function writeReceipt(file, commandResult) {
  const receipt = {
    schema: 'metaengine.client-v1.c5-command-receipt.v1',
    argv_sha256: sha256Json([commandResult.command, ...commandResult.args]),
    exit_code: commandResult.exit_code,
    stdout_sha256: sha256Bytes(commandResult.stdout),
    stderr_sha256: sha256Bytes(commandResult.stderr),
    stdout_bytes: commandResult.stdout.length,
    stderr_bytes: commandResult.stderr.length,
    authority_effect: false,
  };
  await writeFile(file, stableJson(receipt), 'utf8');
  return { receipt, receipt_sha256: sha256Json(receipt) };
}

async function makeReadOnlyTree(root) {
  const result = await run('chmod', ['-R', 'a-w', root], { allowed: [0] });
  if (result.exit_code !== 0) throw new Error('client_c5_reference_readonly_failed');
}

const args = parseArgs(process.argv.slice(2));
const repositoryRoot = path.resolve(args.repository || '');
const expectedHead = String(args.head || '').toLowerCase();
const outDir = path.resolve(args.out || '');

if (!SHA40_RE.test(expectedHead)) throw new Error('client_c5_reference_head_invalid');
if (!repositoryRoot || !outDir) throw new Error('client_c5_reference_path_invalid');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, 'raw'), { recursive: true });
await mkdir(path.join(outDir, 'artifact'), { recursive: true });

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'metaengine-client-c5-'));
const sourceDir = path.join(tempRoot, 'source-readonly');
const workspaceDir = path.join(tempRoot, 'workspace-private');

try {
  await run('git', ['clone', '--no-hardlinks', '--no-tags', '--no-checkout', repositoryRoot, sourceDir]);
  await run('git', ['-C', sourceDir, 'checkout', '--detach', expectedHead]);
  await run('git', ['clone', '--no-hardlinks', '--no-tags', '--no-checkout', repositoryRoot, workspaceDir]);
  await run('git', ['-C', workspaceDir, 'checkout', '--detach', expectedHead]);

  const sourceHead = (await run('git', ['-C', sourceDir, 'rev-parse', 'HEAD'])).stdout.toString('utf8').trim();
  const workspaceHead = (await run('git', ['-C', workspaceDir, 'rev-parse', 'HEAD'])).stdout.toString('utf8').trim();
  if (sourceHead !== expectedHead || workspaceHead !== expectedHead) throw new Error('client_c5_reference_checkout_drift');

  const hostGit = await realpath(path.join(repositoryRoot, '.git'));
  const sourceGit = await realpath(path.join(sourceDir, '.git'));
  const workspaceGit = await realpath(path.join(workspaceDir, '.git'));
  if (hostGit === sourceGit || hostGit === workspaceGit || sourceGit === workspaceGit) {
    throw new Error('client_c5_reference_gitdir_alias');
  }

  for (const gitDir of [sourceGit, workspaceGit]) {
    try {
      await stat(path.join(gitDir, 'objects', 'info', 'alternates'));
      throw new Error('client_c5_reference_git_alternates_forbidden');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const workspaceList = (await run('git', ['-C', workspaceDir, 'worktree', 'list', '--porcelain'])).stdout.toString('utf8');
  const worktreeRows = workspaceList.split('\n').filter((line) => line.startsWith('worktree '));
  if (worktreeRows.length !== 1) throw new Error('client_c5_reference_linked_worktree_detected');

  const treeSha = (await run('git', ['-C', sourceDir, 'rev-parse', 'HEAD^{tree}'])).stdout.toString('utf8').trim();
  const lsTree = (await run('git', ['-C', sourceDir, 'ls-tree', '-r', '--full-tree', 'HEAD'])).stdout;
  const sourceSnapshotSha256 = sha256Bytes(lsTree);
  await makeReadOnlyTree(sourceDir);

  const fixtureRel = 'apps/metaengine-browser/test/fixtures/client-c5-reference-project';
  const answerRel = `${fixtureRel}/answer.mjs`;
  const testRel = `${fixtureRel}/answer.test.mjs`;
  const buildRel = `${fixtureRel}/build.mjs`;
  const artifactRel = `${fixtureRel}/dist/reference-artifact.json`;
  const answerPath = path.join(workspaceDir, ...answerRel.split('/'));

  const before = await readFile(answerPath);
  const beforeSha256 = sha256Bytes(before);
  const expectedBefore = 'export const answer = 41;\n';
  if (before.toString('utf8') !== expectedBefore) throw new Error('client_c5_reference_fixture_baseline_invalid');

  const commandContract = {
    schema: 'metaengine.client-v1.c5-command-contract.v1',
    cwd: 'repository-root',
    pre_repair: ['node', '--test', testRel],
    post_repair: ['node', '--test', testRel],
    build: ['node', buildRel],
    shell: false,
    network_required: false,
    authority_effect: false,
  };
  const commandContractSha256 = sha256Json(commandContract);
  await writeFile(path.join(outDir, 'command-contract.json'), stableJson(commandContract), 'utf8');

  const pre = await run('node', ['--test', testRel], { cwd: workspaceDir, allowed: [0, 1] });
  if (pre.exit_code === 0) throw new Error('client_c5_reference_pre_repair_must_fail');
  await writeFile(path.join(outDir, 'raw', 'pre-repair.stdout'), pre.stdout);
  await writeFile(path.join(outDir, 'raw', 'pre-repair.stderr'), pre.stderr);
  const preReceipt = await writeReceipt(path.join(outDir, 'pre-repair-receipt.json'), pre);

  await chmod(answerPath, 0o644);
  await writeFile(answerPath, 'export const answer = 42;\n', 'utf8');
  const after = await readFile(answerPath);
  const afterSha256 = sha256Bytes(after);
  if (afterSha256 === beforeSha256) throw new Error('client_c5_reference_edit_not_materialized');

  const changed = (await run('git', ['-C', workspaceDir, 'diff', '--name-only', '--', answerRel])).stdout
    .toString('utf8').trim().split('\n').filter(Boolean);
  if (changed.length !== 1 || changed[0] !== answerRel) throw new Error('client_c5_reference_changed_file_invalid');

  const patch = (await run('git', ['-C', workspaceDir, 'diff', '--binary', '--', answerRel])).stdout;
  if (!patch.length) throw new Error('client_c5_reference_patch_missing');
  const patchSha256 = sha256Bytes(patch);
  await writeFile(path.join(outDir, 'raw', 'repair.patch'), patch);

  const changedManifest = [{
    path: answerRel,
    before_sha256: beforeSha256,
    after_sha256: afterSha256,
    change: 'MODIFY',
  }];
  const changedFileManifestSha256 = sha256Json(changedManifest);
  await writeFile(path.join(outDir, 'changed-file-manifest.json'), stableJson(changedManifest), 'utf8');

  const post = await run('node', ['--test', testRel], { cwd: workspaceDir, allowed: [0, 1] });
  if (post.exit_code !== 0) throw new Error('client_c5_reference_post_repair_must_pass');
  await writeFile(path.join(outDir, 'raw', 'post-repair.stdout'), post.stdout);
  await writeFile(path.join(outDir, 'raw', 'post-repair.stderr'), post.stderr);
  const postReceipt = await writeReceipt(path.join(outDir, 'post-repair-receipt.json'), post);

  const build = await run('node', [buildRel], { cwd: workspaceDir, allowed: [0] });
  await writeFile(path.join(outDir, 'raw', 'build.stdout'), build.stdout);
  await writeFile(path.join(outDir, 'raw', 'build.stderr'), build.stderr);
  const buildReceipt = await writeReceipt(path.join(outDir, 'build-receipt.json'), build);

  const artifactSource = path.join(workspaceDir, ...artifactRel.split('/'));
  const artifactBytes = await readFile(artifactSource);
  const artifactSha256 = sha256Bytes(artifactBytes);
  await copyFile(artifactSource, path.join(outDir, 'artifact', 'reference-artifact.json'));

  const repositoryIdentitySha256 = sha256Bytes(Buffer.from(`${process.env.GITHUB_REPOSITORY || 'PatrickFrome/Compute'}\n`, 'utf8'));
  const provenance = {
    schema: 'metaengine.client-v1.c5-reference-provenance.v1',
    repository_identity_sha256: repositoryIdentitySha256,
    source_head: expectedHead,
    source_tree_sha: treeSha,
    source_snapshot_sha256: sourceSnapshotSha256,
    command_contract_sha256: commandContractSha256,
    patch_sha256: patchSha256,
    changed_file_manifest_sha256: changedFileManifestSha256,
    pre_repair_receipt_sha256: preReceipt.receipt_sha256,
    post_repair_receipt_sha256: postReceipt.receipt_sha256,
    build_receipt_sha256: buildReceipt.receipt_sha256,
    artifact_sha256: artifactSha256,
    artifact_bytes: artifactBytes.length,
    github_run_id: process.env.GITHUB_RUN_ID || null,
    github_run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 0),
    github_job: process.env.GITHUB_JOB || null,
    evidence_class: 'SYNTHETIC',
    evidence_origin: 'CONTROLLED_FIXTURE',
    authority_effect: false,
  };
  const provenanceSha256 = sha256Json(provenance);
  await writeFile(path.join(outDir, 'provenance.json'), stableJson(provenance), 'utf8');

  const receipt = {
    schema: 'metaengine.client-v1.c5-reference-producer.v1',
    expected_head: expectedHead,
    source_tree_sha: treeSha,
    source_snapshot_sha256: sourceSnapshotSha256,
    independent_git_directories: true,
    git_alternates_absent: true,
    linked_worktree_exposed: false,
    source_snapshot_read_only: true,
    repository: {
      repository_identity_sha256: repositoryIdentitySha256,
      checkout_sha: expectedHead,
      source_snapshot_sha256: sourceSnapshotSha256,
      isolated_workspace: true,
      host_repository_mounted: false,
      host_git_directory_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      authority_effect: false,
    },
    edit: {
      patch_sha256: patchSha256,
      changed_file_manifest_sha256: changedFileManifestSha256,
      changed_file_count: 1,
      materialized_edit_operations: 1,
      edit_materialized: true,
      protected_root_modified: false,
      host_repository_modified: false,
      authority_effect: false,
    },
    verification: {
      command_contract_sha256: commandContractSha256,
      pre_repair_receipt_sha256: preReceipt.receipt_sha256,
      pre_repair_test_observed: true,
      pre_repair_exit_code: pre.exit_code,
      post_repair_receipt_sha256: postReceipt.receipt_sha256,
      post_repair_test_observed: true,
      post_repair_exit_code: post.exit_code,
      build_receipt_sha256: buildReceipt.receipt_sha256,
      real_build_or_test: true,
      repair_verified: true,
      authority_effect: false,
    },
    artifact: {
      artifact_sha256: artifactSha256,
      artifact_bytes: artifactBytes.length,
      artifact_subject_sha256: artifactSha256,
      provenance_sha256: provenanceSha256,
      provenance_verified: false,
      subject_digest_verified: false,
      artifact_verified: false,
      authority_effect: false,
    },
    evidence_class: 'SYNTHETIC',
    evidence_origin: 'CONTROLLED_FIXTURE',
    independent_verification_required: true,
    client_c5_useful_work_verified: false,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
  await writeFile(path.join(outDir, 'producer-receipt.json'), stableJson(receipt), 'utf8');
  await writeFile(path.join(outDir, 'producer-receipt.sha256'), `${sha256Json(receipt)}\n`, 'utf8');
  process.stdout.write(`${stableJson({
    schema: receipt.schema,
    expected_head: expectedHead,
    pre_repair_exit_code: pre.exit_code,
    post_repair_exit_code: post.exit_code,
    artifact_sha256: artifactSha256,
    provenance_sha256: provenanceSha256,
    client_c5_useful_work_verified: false,
    authority_effect: false,
  })}`);
} finally {
  await chmod(sourceDir, 0o755).catch(() => {});
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
