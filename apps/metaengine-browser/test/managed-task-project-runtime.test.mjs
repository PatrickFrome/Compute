import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createWorkspaceReservation } from '../src/workspace-manager.mjs';
import { planLockedWorkspaceMaterialization, planWorkspaceInventory } from '../src/workspace-git-hardening.mjs';
import { createManagedTaskProjectMemoryJournal, createManagedTaskProjectRuntime, createShellFreeGitExecutor } from '../src/managed-task-project-runtime.mjs';

const exec = promisify(execFile);

async function privateGitFixture(root) {
  const filename = process.platform === 'win32' ? 'git.exe' : 'git';
  const { stdout } = await exec('git', ['--exec-path']);
  const candidates = [path.join(stdout.trim(), filename), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, filename))];
  let gitExecutable;
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) { gitExecutable = await fs.realpath(candidate); break; } } catch {}
  }
  assert.ok(gitExecutable, 'source fixture requires an absolute Git executable');
  const decoy = path.join(root, 'decoy-path'); await fs.mkdir(decoy);
  await fs.writeFile(path.join(decoy, filename), 'invalid external Git payload', { mode: 0o700 });
  const environment = { PATH: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR']) if (process.env[key]) environment[key] = process.env[key];
  return { gitExecutable, environment, decoy };
}

async function fixture(t, { rootLength = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-project-test-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  // Keep the repository itself short enough for unconfigured Git init, but put
  // its genuine worktree administration files beyond the legacy Win32 limit.
  const base = rootLength > root.length ? path.join(root, 'p'.repeat(Math.max(1, rootLength - root.length - 1))) : root;
  if (base !== root) await fs.mkdir(base);
  const repo = path.join(base, 'repo'); const managed = path.join(base, 'projects');
  await fs.mkdir(repo); await fs.mkdir(managed);
  const git = (args) => exec('git', args, { cwd: repo, windowsHide: true });
  await git(['init', '-q']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
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

test('private Git executor uses its absolute capability despite an ambient decoy PATH', async t => {
  const request = await fixture(t), tools = await privateGitFixture(request.workspace_root);
  let validations = 0; const calls = [];
  const privateTools = Object.freeze({ gitExecutable: tools.gitExecutable, environment: Object.freeze(tools.environment),
    revalidate: async () => { validations++; } });
  const executor = createShellFreeGitExecutor({ privateTools, spawnProcess: (executable, argv, options) => {
    assert.equal(validations, calls.length + 1, 'revalidate must precede every physical Git spawn');
    calls.push({ executable, argv, options }); return spawn(executable, argv, options);
  } });
  const previous = process.env.PATH;
  try {
    process.env.PATH = tools.decoy;
    const result = await executor.execute(planWorkspaceInventory(createWorkspaceReservation(request)));
    assert.ok(result.stdout.includes(request.trusted_repo.repo_root.split(path.sep).join('/')));
    assert.equal(calls.length, 1); assert.equal(calls[0].executable, tools.gitExecutable);
    assert.equal(calls[0].options.env.PATH, ''); assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.env.GIT_CONFIG_GLOBAL, tools.environment.GIT_CONFIG_GLOBAL);
    assert.equal(privateTools.environment.GIT_OPTIONAL_LOCKS, undefined, 'invocation options must not mutate the capability');
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});

test('private Git executor refuses malformed, missing and changed tools without ambient fallback', async t => {
  const request = await fixture(t), plan = planWorkspaceInventory(createWorkspaceReservation(request));
  let spawns = 0, validations = 0;
  const privateTools = { gitExecutable: path.join(request.workspace_root, 'missing-git'), environment: { PATH: '' },
    revalidate: async () => { validations++; await fs.access(privateTools.gitExecutable); } };
  const spawnProcess = () => { spawns++; throw Error('must_not_spawn'); };
  for (const invalid of [{ ...privateTools, gitExecutable: 'git' }, { ...privateTools, revalidate: null },
    { ...privateTools, environment: { PATH: 'trusted', Path: 'decoy' } }])
    assert.throws(() => createShellFreeGitExecutor({ privateTools: invalid, spawnProcess }), /private_tools/);
  const executor = createShellFreeGitExecutor({ privateTools, spawnProcess });
  await assert.rejects(executor.execute({ ...plan, argv: ['config', '--list'] }), /git_plan_invalid/);
  assert.equal(validations, 0, 'a private executable must not broaden the fixed Git plans');
  await assert.rejects(executor.execute(plan), { code: 'ENOENT' });
  assert.equal(validations, 1); assert.equal(spawns, 0);
  const changed = createShellFreeGitExecutor({ privateTools: { ...privateTools,
    revalidate: async () => { throw Error('private_git_payload_changed'); } }, spawnProcess });
  await assert.rejects(changed.execute(plan), /private_git_payload_changed/);
  assert.equal(spawns, 0);
});

test('same key with changed agent or repository identity is rejected', async (t) => {
  const request = await fixture(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor();
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true, journal, executePlan: plan => git.execute(plan) });
  await runtime.create(request);
  await assert.rejects(runtime.create({ ...request, claim: { ...request.claim, target_id: 'webcontents:8' } }), /idempotency_binding_conflict/);
  await assert.rejects(runtime.create({ ...request, trusted_repo: { ...request.trusted_repo, repo_id: 'github:test/other' } }), /idempotency_binding_conflict/);
});

test('ambient Git repository overrides cannot redirect physical project creation', async (t) => {
  const request = await fixture(t); const other = await fixture(t);
  const executor = createShellFreeGitExecutor();
  const runtime = createManagedTaskProjectRuntime({ validateClaim: async () => true,
    journal: createManagedTaskProjectMemoryJournal(), executePlan: plan => executor.execute(plan) });
  const overrides = { GIT_DIR: path.join(other.trusted_repo.repo_root, '.git'),
    GIT_WORK_TREE: other.trusted_repo.repo_root, GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  let created;
  try {
    Object.assign(process.env, overrides);
    created = await runtime.create(request);
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  assert.equal(created.state, 'PROVEN');
  const inventory = repo => exec('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: repo, windowsHide: true, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
  });
  assert.ok((await inventory(request.trusted_repo.repo_root)).stdout.includes(`branch refs/heads/${request.claim.branch_name}\0`));
  assert.equal((await inventory(other.trusted_repo.repo_root)).stdout.includes(`branch refs/heads/${request.claim.branch_name}\0`), false);
  assert.equal(created.proof.head_sha, request.claim.base_sha);
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


test('validated Git plans receive only the fixed invocation-local Windows long-path option', async (t) => {
  const request = await fixture(t), binding = createWorkspaceReservation(request);
  const plans = [planWorkspaceInventory(binding), planLockedWorkspaceMaterialization(binding),
    ...Object.entries({ WORKTREE_STATUS_READ: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
      WORKTREE_UPSTREAM_READ: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      WORKTREE_ORIGIN_READ: ['remote', 'get-url', 'origin'] }).map(([effect, argv]) => ({ ...planWorkspaceInventory(binding), effect, argv }))];
  const calls = [];
  const executor = createShellFreeGitExecutor({ spawnProcess: (executable, argv, options) => {
    calls.push({ executable, argv, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => child.emit('close', 0, null)); return child;
  } });
  for (const plan of plans) {
    const before = structuredClone(plan); await executor.execute(plan);
    const call = calls.at(-1);
    assert.equal(call.executable, 'git'); assert.equal(call.options.shell, false); assert.equal(call.options.cwd, plan.cwd);
    const expected = [...plan.argv];
    if (process.platform === 'win32' && plan.effect === 'WORKTREE_CREATE_LOCKED') {
      expected[7] = './' + path.relative(plan.cwd, plan.argv[7]).split(path.sep).join('/');
      assert.equal(path.resolve(call.options.cwd, call.argv[9]), plan.argv[7]);
    }
    assert.deepEqual(call.argv, [...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), ...expected]);
    assert.deepEqual(plan, before, 'configuration must not rewrite the admitted plan or its authority binding');
    assert.equal(call.options.env.GIT_CONFIG_PARAMETERS, undefined); assert.equal(call.options.env.GIT_CONFIG_COUNT, undefined);
  }
  const count = calls.length;
  for (const config of ['core.longpaths=false', 'core.hooksPath=untrusted', 'core.worktree=other'])
    await assert.rejects(executor.execute({ ...plans[0], argv: ['-c', config, ...plans[0].argv] }), /managed_project_git_plan_invalid/);
  assert.equal(calls.length, count, 'caller configuration must be refused before spawning');
});

test('real Git long managed paths preserve exact locked creation and readback without persistent configuration', async (t) => {
  const request = await fixture(t, { rootLength: 139 }), journal = createManagedTaskProjectMemoryJournal();
  const config = path.join(request.trusted_repo.repo_root, '.git', 'config'), beforeConfig = await fs.readFile(config);
  const executor = createShellFreeGitExecutor(); let adds = 0;
  const runtime = createManagedTaskProjectRuntime({ journal, validateClaim: async () => true,
    executePlan: plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') adds++; return executor.execute(plan); } });
  const first = await runtime.create(request);
  assert.ok(path.join(request.trusted_repo.repo_root, '.git', 'worktrees', path.basename(first.reservation.worktree_path), 'refs').length >= 249);
  assert.ok(Buffer.byteLength(first.reservation.worktree_path + '/.git', 'utf8') <= 259);
  assert.equal(first.state, 'PROVEN'); assert.equal(first.reservation.state, 'READY'); assert.equal(first.proof.locked, true);
  assert.equal(first.proof.head_sha, request.claim.base_sha);
  const replay = await runtime.create(request);
  assert.equal(replay.replayed, true); assert.equal(adds, 1);
  assert.equal(replay.binding_digest, first.binding_digest);
  assert.deepEqual(journal.snapshot().map(row => row.state), ['RESERVED', 'PROVEN']);
  assert.deepEqual(await fs.readFile(config), beforeConfig, 'invocation policy must not persist repository configuration');
});


test('unsupported new Windows target is refused before reservation or Git add', async (t) => {
  const request = await fixture(t, { rootLength: 176 }), journal = createManagedTaskProjectMemoryJournal();
  const binding = createWorkspaceReservation(request), executor = createShellFreeGitExecutor(); let adds = 0, reserves = 0;
  assert.ok(Buffer.byteLength(binding.worktree_path + '/.git', 'utf8') > 259);
  const runtime = createManagedTaskProjectRuntime({ journal, validateClaim: async () => true,
    reserveBinding: async () => { reserves++; },
    executePlan: plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') adds++; return executor.execute(plan); } });
  if (process.platform === 'win32') {
    await assert.rejects(runtime.create(request), /managed_project_windows_path_requires_shorter_root/);
    assert.equal(adds, 0); assert.equal(reserves, 0); assert.deepEqual(journal.snapshot(), []);
    await assert.rejects(fs.stat(binding.worktree_path), { code: 'ENOENT' });
    const branches = await exec('git', ['show-ref', '--heads'], { cwd: request.trusted_repo.repo_root, windowsHide: true });
    assert.equal(branches.stdout.includes(request.claim.branch_name), false);
  } else {
    assert.equal((await runtime.create(request)).state, 'PROVEN');
    assert.equal(adds, 1); assert.equal(reserves, 1);
  }
});

test('derived Windows spelling refuses cross-volume, malformed and UTF8-overlimit creation plans before spawn', async (t) => {
  const request = await fixture(t), binding = createWorkspaceReservation(request), plan = planLockedWorkspaceMaterialization(binding);
  let spawns = 0;
  const executor = createShellFreeGitExecutor({ spawnProcess: () => { spawns++; throw Error('must_not_spawn'); } });
  for (const target of ['../escape', path.join(plan.cwd, 'child') + path.sep + '..' + path.sep + 'escape', 'C:drive-relative'])
    await assert.rejects(executor.execute({ ...plan, argv: plan.argv.map((v, i) => i === 7 ? target : v) }), /managed_project_git_plan_invalid/);
  if (process.platform === 'win32') {
    const drive = path.parse(plan.cwd).root[0].toLowerCase() === 'z' ? 'Y' : 'Z';
    const foreign = drive + ':\\other\\approved-looking';
    await assert.rejects(executor.execute({ ...plan, argv: plan.argv.map((v, i) => i === 7 ? foreign : v) }), /managed_project_windows_cross_volume_worktree_unsupported/);
    const unicode = path.join(path.parse(plan.cwd).root, 'é'.repeat(130));
    assert.ok(unicode.length < 220); assert.ok(Buffer.byteLength(unicode + '/.git', 'utf8') > 259);
    await assert.rejects(executor.execute({ ...plan, argv: plan.argv.map((v, i) => i === 7 ? unicode : v) }), /managed_project_windows_path_requires_shorter_root/);
  }
  assert.equal(spawns, 0);
});


test('derived target remains the same physical worktree from a nested Git executor cwd', async (t) => {
  const request = await fixture(t, { rootLength: 139 }), binding = createWorkspaceReservation(request);
  const nested = path.join(request.trusted_repo.repo_root, 'nested'); await fs.mkdir(nested);
  const executor = createShellFreeGitExecutor(), plan = planLockedWorkspaceMaterialization(binding);
  await executor.execute({ ...plan, cwd: await fs.realpath(nested) });
  const inventory = await executor.execute(planWorkspaceInventory(binding));
  const { verifyWorkspaceInventory } = await import('../src/workspace-git-hardening.mjs');
  const proof = verifyWorkspaceInventory(binding, inventory.stdout);
  assert.equal(proof.worktree_path, binding.worktree_path); assert.equal(proof.head_sha, request.claim.base_sha); assert.equal(proof.locked, true);
  assert.equal(await fs.realpath(binding.worktree_path), binding.worktree_path);
});
