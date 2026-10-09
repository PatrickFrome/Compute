import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createManagedTaskProjectMemoryJournal, createManagedTaskProjectRuntime, createShellFreeGitExecutor } from '../src/managed-task-project-runtime.mjs';

const exec = promisify(execFile);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-project-test-'));
  const repo = path.join(root, 'repo'); const managed = path.join(root, 'projects');
  await fs.mkdir(repo); await fs.mkdir(managed);
  const git = (args) => exec('git', args, { cwd: repo, windowsHide: true });
  await git(['init', '-q']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  return {
    idempotency_key: 'task-project:create:v1',
    trusted_repo: { repo_id: 'github:test/repo', repo_root: await fs.realpath(repo) },
    workspace_root: await fs.realpath(managed),
    claim: {
      coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
      task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', claim_id: 46,
      point_id: 'task.project.v1', claim_class: 'MUTATING', base_sha: stdout.trim(),
      branch_name: 'work/task-project-test', agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
      tab_id: 'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d', target_id: 'webcontents:7',
      agent_generation_epoch: 9, lease_generation: 1,
      lease_expires_at: new Date(Date.now() + 600000).toISOString(),
    },
  };
}

test('real git creates exact locked task project and replay never runs a second add', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal();
  const git = createShellFreeGitExecutor(); let creates = 0; let opens = 0;
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true, journal,
    executePlan: async (plan) => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); },
    openProject: async ({ path: projectPath }) => { assert.ok((await fs.stat(projectPath)).isDirectory()); opens++; },
  });
  const first = await runtime.open(request);
  assert.equal(first.state, 'PROVEN'); assert.equal(first.opened, true);
  assert.equal(first.reservation.state, 'READY'); assert.equal(first.proof.locked, true);
  assert.equal(first.proof.head_sha, request.claim.base_sha);
  const replay = await runtime.create(request);
  assert.equal(replay.replayed, true); assert.equal(creates, 1); assert.equal(opens, 1);
  assert.deepEqual(journal.snapshot().map(row => row.state), ['RESERVED', 'PROVEN']);
  assert.equal(first.authority_effect, false); assert.equal(first.automatic_retry_allowed, false);
});

test('same key with changed agent or repository identity is rejected', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor();
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true, journal, executePlan: plan => git.execute(plan) });
  await runtime.create(request);
  await assert.rejects(runtime.create({ ...request, claim: { ...request.claim, target_id: 'webcontents:8' } }), /idempotency_binding_conflict/);
  await assert.rejects(runtime.create({ ...request, trusted_repo: { ...request.trusted_repo, repo_id: 'github:test/other' } }), /idempotency_binding_conflict/);
});

test('expired or advisory claim never calls the executor', async (t) => {
  const request = await fixture(t); let effects = 0;
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true, journal: createManagedTaskProjectMemoryJournal(), executePlan: async () => { effects++; } });
  await assert.rejects(runtime.create({ ...request, claim: { ...request.claim, lease_expires_at: '2020-01-01T00:00:00Z' } }), /lease_expired/);
  await assert.rejects(runtime.create({ ...request, claim: { ...request.claim, claim_class: 'ADVISORY' } }), /claim_class_not_mutating/);
  assert.equal(effects, 0);
});

test('write-ahead persistence failure prevents a physical effect', async (t) => {
  const request = await fixture(t); const git = createShellFreeGitExecutor(); let creates = 0;
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true, journal: { find: async () => null, append: async () => { throw new Error('db_unavailable'); } },
    executePlan: async (plan) => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); },
  });
  await assert.rejects(runtime.create(request), /db_unavailable/); assert.equal(creates, 0);
});

test('crash after git add reconciles durable intent without repeating creation', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor(); let creates = 0;
  const flakyJournal = { find: key => journal.find(key), append: entry => entry.state === 'PROVEN' ? Promise.reject(new Error('commit_lost')) : journal.append(entry) };
  const executePlan = async (plan) => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); };
  await assert.rejects(createManagedTaskProjectRuntime({ validateClaim: async () => true, journal: flakyJournal, executePlan }).create(request), /commit_lost/);
  const recovered = await createManagedTaskProjectRuntime({ validateClaim: async () => true, journal, executePlan }).create(request);
  assert.equal(recovered.state, 'PROVEN'); assert.equal(recovered.replayed, true); assert.equal(creates, 1);
});

test('executor failure with no worktree is journaled and cannot be blindly retried', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor(); let creates = 0;
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true, journal, executePlan: async (plan) => {
    if (plan.effect === 'WORKTREE_CREATE_LOCKED') { creates++; throw new Error('spawn_failed'); } return git.execute(plan);
  } });
  const result = await runtime.create(request); assert.equal(result.state, 'AMBIGUOUS');
  await assert.rejects(runtime.create(request), /effect_ambiguous/); assert.equal(creates, 1);
});

test('journal is mandatory and executor refuses shell plans', async () => {
  assert.throws(() => createManagedTaskProjectRuntime({ executePlan() {} }), /journal_required/);
  await assert.rejects(createShellFreeGitExecutor().execute({ executable: 'git', shell: true, argv: ['status'] }), /plan_invalid/);
  await assert.rejects(createShellFreeGitExecutor().execute({ schema: 'metaengine.devos.workspace-git-plan.v1', effect: 'WORKTREE_INVENTORY_READ', executable: 'git', shell: false, argv: ['config', '--list'], cwd: path.resolve('.'), workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4', task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', lease_generation: 1 }), /plan_invalid/);
});

test('lease expiring during reserve persistence never reaches git add', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor(); let creates = 0;
  let clock = Date.now();
  const runtime = createManagedTaskProjectRuntime({ journal, validateClaim: async () => true, now: () => clock,
    reserveBinding: async () => { clock = Date.parse(request.claim.lease_expires_at) + 1; },
    executePlan: async plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); },
  });
  await assert.rejects(runtime.create(request), /lease_expired/); assert.equal(creates, 0);
  assert.deepEqual(journal.snapshot().map(row => row.state), ['RESERVED']);
});

test('concurrent duplicate calls reserve once and cannot issue two adds', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor(); let creates = 0;
  const runtime = createManagedTaskProjectRuntime({ journal, validateClaim: async () => true,
    executePlan: async plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); },
  });
  const results = await Promise.allSettled([runtime.create(request), runtime.create(request)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(creates, 1);
});

test('timeout waits for child close before reporting ambiguous execution', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed; const killCalled = new Promise(resolve => { killed = resolve; });
  child.kill = () => { killed(); return true; };
  const git = createShellFreeGitExecutor({ timeoutMs: 1000, spawnProcess: () => child });
  let settled = false;
  const pending = git.execute({ schema: 'metaengine.devos.workspace-git-plan.v1', effect: 'WORKTREE_INVENTORY_READ', executable: 'git', shell: false, argv: ['worktree', 'list', '--porcelain', '-z'], cwd: path.resolve('.'), workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4', task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', lease_generation: 1 });
  const checked = assert.rejects(pending, /git_timeout/).then(() => { settled = true; });
  const keepAlive = setTimeout(() => {}, 1500);
  await killCalled; assert.equal(settled, false);
  child.emit('close', null, 'SIGTERM'); await checked; clearTimeout(keepAlive);
});

test('proven read-only replay allows expired lease but open revalidates it', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor(); let clock = Date.now(); let opens = 0;
  const runtime = createManagedTaskProjectRuntime({ journal, validateClaim: async () => true, now: () => clock,
    executePlan: plan => git.execute(plan), openProject: async () => { opens++; },
  });
  await runtime.create(request); clock = Date.parse(request.claim.lease_expires_at) + 1;
  assert.equal((await runtime.create(request)).replayed, true);
  await assert.rejects(runtime.open(request), /lease_expired/); assert.equal(opens, 0);
});

test('proven replay opens with a renewed lease without another add or rewriting the journal', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor();
  let clock = Date.now(); let creates = 0; let opens = 0; let activeExpiry = request.claim.lease_expires_at;
  const finalizations = []; const validations = [];
  const runtime = createManagedTaskProjectRuntime({ journal, now: () => clock,
    validateClaim: async (reservation, { phase }) => { validations.push({ phase, expiry: reservation.lease_expires_at }); return reservation.lease_expires_at === activeExpiry; },
    executePlan: async plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); },
    finalizeBinding: async entry => { finalizations.push(entry); },
    openProject: async ({ reservation }) => { assert.equal(reservation.lease_expires_at, activeExpiry); opens++; },
  });
  const first = await runtime.create(request); const history = journal.snapshot();
  clock = Date.parse(request.claim.lease_expires_at) + 1;
  activeExpiry = new Date(clock + 600000).toISOString();
  const renewed = { ...request, claim: { ...request.claim, lease_expires_at: activeExpiry } };
  const replay = await runtime.open(renewed);
  assert.equal(replay.replayed, true); assert.equal(replay.opened, true);
  assert.equal(replay.reservation.state, 'READY'); assert.equal(replay.reservation.lease_expires_at, activeExpiry);
  assert.equal(replay.binding_digest, first.binding_digest);
  assert.equal(replay.reservation.lease_generation, first.reservation.lease_generation);
  assert.equal(replay.reservation.workspace_id, first.reservation.workspace_id);
  assert.equal(replay.reservation.worktree_id, first.reservation.worktree_id);
  assert.equal(creates, 1); assert.equal(opens, 1);
  assert.equal(finalizations.at(-1).reservation.lease_expires_at, activeExpiry);
  assert.deepEqual(validations.at(-1), { phase: 'BEFORE_OPEN', expiry: activeExpiry });
  assert.deepEqual(journal.snapshot(), history);
});

test('renewed replay still refuses revoked and expired claims before opening', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor();
  let clock = Date.now(); let current = true; let creates = 0; let opens = 0;
  const runtime = createManagedTaskProjectRuntime({ journal, now: () => clock, validateClaim: async () => current,
    executePlan: async plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') creates++; return git.execute(plan); },
    openProject: async () => { opens++; },
  });
  await runtime.create(request);
  clock = Date.parse(request.claim.lease_expires_at) + 1;
  const renewed = { ...request, claim: { ...request.claim, lease_expires_at: new Date(clock + 600000).toISOString() } };
  current = false;
  await assert.rejects(runtime.open(renewed), /managed_project_claim_not_current/);
  current = true; clock = Date.parse(renewed.claim.lease_expires_at) + 1;
  await assert.rejects(runtime.open(renewed), /managed_project_lease_expired/);
  assert.equal(creates, 1); assert.equal(opens, 0);
  assert.deepEqual(journal.snapshot().map(row => row.state), ['RESERVED', 'PROVEN']);
});
