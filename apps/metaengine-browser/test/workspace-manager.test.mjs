import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import workspaceModule from '../src/workspace-manager.cjs';

const execFileAsync = promisify(execFile);
const { WorkspaceManager, createWorkspacePlan, verifyWorkspacePlan, defaultRunGit } = workspaceModule;

async function git(args, cwd) {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true, shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return String(result.stdout || '').trim();
}

async function repoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-workspace-'));
  const repo = path.join(root, 'repo');
  const workspaces = path.join(root, 'workspaces');
  await fs.mkdir(repo, { recursive: true });
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.name', 'METAENGINE CI'], repo);
  await git(['config', 'user.email', 'metaengine@example.invalid'], repo);
  await fs.writeFile(path.join(repo, 'README.md'), 'base\n');
  await git(['add', 'README.md'], repo);
  await git(['commit', '-m', 'base'], repo);
  const baseSha = await git(['rev-parse', 'HEAD'], repo);
  return { root, repo, workspaces, baseSha };
}

function request(baseSha, suffix = 'a1b2c3d4') {
  return {
    agent_id: `agent_${suffix}-1234-5678`,
    role: 'IMPLEMENTER',
    point_id: 'devos.workspace.p0',
    base_sha: baseSha,
    claim_id: `claim_${suffix}-1234-5678`,
  };
}

test('workspace plan is deterministic, claim-bound and contains no arbitrary shell authority', () => {
  const base = 'a'.repeat(40);
  const first = createWorkspacePlan(request(base));
  const second = createWorkspacePlan(request(base));
  assert.deepEqual(first, second);
  assert.match(first.workspace_id, /^ws_[0-9a-f]{24}$/);
  assert.match(first.branch_name, /^work\/devos-agent\//);
  assert.equal(first.effect_class, 'BRANCH_LOCAL');
  assert.equal(first.arbitrary_shell, false);
  assert.equal(first.fixed_git_executable, true);
  assert.equal(first.production_authority, false);
  assert.equal(first.main_merge_authority, false);
  assert.equal(verifyWorkspacePlan(first).ok, true);
  assert.throws(() => verifyWorkspacePlan({ ...first, base_sha: 'b'.repeat(40) }), /mismatch/);
});

test('materialize creates one exact agent-owned worktree with fixed git argv and durable readback', async () => {
  const f = await repoFixture();
  try {
    const manager = new WorkspaceManager({ repoRoot: f.repo, workspaceRoot: f.workspaces });
    await manager.init();
    const plan = manager.plan(request(f.baseSha));
    const result = await manager.materialize(plan);
    assert.equal(result.ok, true);
    assert.equal(result.authority_effect, true);
    assert.equal(result.readback.exact, true);
    assert.equal(result.workspace.state, 'ACTIVE');
    assert.equal(await git(['rev-parse', 'HEAD'], result.workspace.worktree_path), f.baseSha);
    assert.equal(await git(['branch', '--show-current'], result.workspace.worktree_path), plan.branch_name);
    const status = manager.snapshot();
    assert.equal(status.automatic_ambiguous_retry, false);
    assert.equal(status.direct_main_mutation, false);
    assert.equal(status.workspaces.length, 1);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('unknown result after actual git effect becomes CREATE_AMBIGUOUS and restart reconciliation proves COMMITTED without retry', async () => {
  const f = await repoFixture();
  let addCalls = 0;
  try {
    const lossyRunner = async (args, options) => {
      if (args.includes('worktree') && args.includes('add')) {
        addCalls += 1;
        await defaultRunGit(args, options);
        const error = new Error('simulated_transport_loss_after_git_effect');
        error.exitCode = null;
        throw error;
      }
      return defaultRunGit(args, options);
    };
    const statePath = path.join(f.workspaces, 'state.json');
    const manager = new WorkspaceManager({ repoRoot: f.repo, workspaceRoot: f.workspaces, statePath, runGit: lossyRunner });
    await manager.init();
    const plan = manager.plan(request(f.baseSha, 'b2c3d4e5'));
    await assert.rejects(() => manager.materialize(plan), /simulated_transport_loss/);
    assert.equal(addCalls, 1);
    assert.equal(manager.snapshot().workspaces[0].state, 'CREATE_AMBIGUOUS');
    await assert.rejects(() => manager.materialize(plan), /ambiguous_reconcile_required/);
    assert.equal(addCalls, 1, 'ambiguous effect must never be blindly replayed');

    const restarted = new WorkspaceManager({ repoRoot: f.repo, workspaceRoot: f.workspaces, statePath });
    await restarted.init();
    assert.equal(restarted.snapshot().workspaces[0].state, 'CREATE_AMBIGUOUS');
    const reconciled = await restarted.reconcile(plan.workspace_id);
    assert.equal(reconciled.outcome, 'COMMITTED');
    assert.equal(reconciled.workspace.state, 'ACTIVE');
    assert.equal(await git(['branch', '--show-current'], reconciled.workspace.worktree_path), plan.branch_name);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('proven no-effect resets ambiguous create to RESERVED but does not retry by itself', async () => {
  const f = await repoFixture();
  let addCalls = 0;
  try {
    const noEffectRunner = async (args, options) => {
      if (args.includes('worktree') && args.includes('add')) {
        addCalls += 1;
        const error = new Error('simulated_pre_effect_transport_failure');
        error.exitCode = null;
        throw error;
      }
      return defaultRunGit(args, options);
    };
    const statePath = path.join(f.workspaces, 'state.json');
    const manager = new WorkspaceManager({ repoRoot: f.repo, workspaceRoot: f.workspaces, statePath, runGit: noEffectRunner });
    await manager.init();
    const plan = manager.plan(request(f.baseSha, 'c3d4e5f6'));
    await assert.rejects(() => manager.materialize(plan), /pre_effect_transport_failure/);
    assert.equal(addCalls, 1);
    const reconciled = await manager.reconcile(plan.workspace_id);
    assert.equal(reconciled.outcome, 'NO_EFFECT');
    assert.equal(reconciled.workspace.state, 'RESERVED');
    assert.equal(addCalls, 1, 'reconcile only proves state; it does not actuate');
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('workspace path cannot escape configured workspace root', async () => {
  const f = await repoFixture();
  try {
    const manager = new WorkspaceManager({ repoRoot: f.repo, workspaceRoot: f.workspaces });
    await manager.init();
    const plan = manager.plan(request(f.baseSha, 'd4e5f6a7'));
    assert.throws(() => verifyWorkspacePlan({ ...plan, worktree_relative_path: '../escape' }), /mismatch/);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
