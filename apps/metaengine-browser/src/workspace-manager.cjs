'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const SCHEMA = 'metaengine.devos.workspace-manager.state.v1';
const PLAN_SCHEMA = 'metaengine.devos.workspace-plan.v1';
const STATES = new Set(['RESERVED','CREATING','ACTIVE','CREATE_AMBIGUOUS','RETIRED']);
const AGENT_RE = /^agent_[a-z0-9-]{8,64}$/;
const POINT_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const CLAIM_RE = /^claim_[a-z0-9-]{8,96}$/;

const clone = (value) => value == null ? value : structuredClone(value);
const iso = (clock) => new Date(clock()).toISOString();
const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function validateText(value, regex, name, transform = (x) => x) {
  const normalized = transform(String(value || '').trim());
  if (!regex.test(normalized)) throw new Error(`workspace_${name}_invalid`);
  return normalized;
}

function normalizeRequest(input = {}) {
  return Object.freeze({
    agent_id: validateText(input.agent_id, AGENT_RE, 'agent_id', (x) => x.toLowerCase()),
    role: validateText(input.role, ROLE_RE, 'role', (x) => x.toUpperCase()),
    point_id: validateText(input.point_id, POINT_RE, 'point_id', (x) => x.toLowerCase()),
    base_sha: validateText(input.base_sha, SHA_RE, 'base_sha', (x) => x.toLowerCase()),
    claim_id: validateText(input.claim_id, CLAIM_RE, 'claim_id', (x) => x.toLowerCase()),
  });
}

function safePointSlug(pointId) {
  return pointId.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function assertWorkspacePath(root, workspacePath) {
  const normalizedRoot = path.resolve(root);
  const normalizedPath = path.resolve(workspacePath);
  if (normalizedPath === normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('workspace_path_escape');
  }
  return normalizedPath;
}

function deterministicPlan(input) {
  const req = normalizeRequest(input);
  const material = [
    'METAENGINE_DEVOS_WORKSPACE_PLAN_V1',
    `agent_id:${req.agent_id}`,
    `role:${req.role}`,
    `point_id:${req.point_id}`,
    `base_sha:${req.base_sha}`,
    `claim_id:${req.claim_id}`,
  ].join('\n');
  const planSha = digest(material);
  const agentSuffix = req.agent_id.slice('agent_'.length, 'agent_'.length + 12);
  const branchName = `work/devos-agent/${agentSuffix}/${safePointSlug(req.point_id)}-${req.base_sha.slice(0, 8)}`;
  return Object.freeze({
    schema: PLAN_SCHEMA,
    plan_sha256: planSha,
    workspace_id: `ws_${planSha.slice(0, 24)}`,
    agent_id: req.agent_id,
    role: req.role,
    point_id: req.point_id,
    base_sha: req.base_sha,
    claim_id: req.claim_id,
    branch_name: branchName,
    worktree_relative_path: `ws_${planSha.slice(0, 24)}`,
    effect_class: 'BRANCH_LOCAL',
    arbitrary_shell: false,
    fixed_git_executable: true,
    browser_authority: false,
    production_authority: false,
    main_merge_authority: false,
    authority_effect: false,
  });
}

function verifyPlan(plan) {
  if (!plan || plan.schema !== PLAN_SCHEMA) throw new Error('workspace_plan_schema_invalid');
  const rebuilt = deterministicPlan(plan);
  const fields = ['plan_sha256','workspace_id','agent_id','role','point_id','base_sha','claim_id','branch_name','worktree_relative_path'];
  for (const field of fields) {
    if (String(plan[field] || '') !== String(rebuilt[field] || '')) throw new Error(`workspace_plan_${field}_mismatch`);
  }
  if (plan.effect_class !== 'BRANCH_LOCAL' || plan.arbitrary_shell !== false || plan.fixed_git_executable !== true) {
    throw new Error('workspace_plan_authority_invalid');
  }
  return Object.freeze({ ok: true, plan_sha256: rebuilt.plan_sha256, authority_effect: false });
}

async function defaultRunGit(args, { cwd = undefined, timeoutMs = 30_000 } = {}) {
  if (!Array.isArray(args) || !args.length || args.some((row) => typeof row !== 'string')) throw new Error('workspace_git_argv_invalid');
  if (args.some((row) => row.includes('\u0000'))) throw new Error('workspace_git_argv_nul');
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { code: 0, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
  } catch (error) {
    const wrapped = new Error(`workspace_git_failed:${Number.isInteger(error?.code) ? error.code : 'unknown'}`);
    wrapped.exitCode = Number.isInteger(error?.code) ? error.code : null;
    wrapped.stdout = String(error?.stdout || '');
    wrapped.stderr = String(error?.stderr || '');
    throw wrapped;
  }
}

function freshState() {
  return { schema: SCHEMA, version: 1, workspaces: [], updated_at: null, authority_effect: false };
}

function sanitizeState(input) {
  const base = freshState();
  if (!input || input.schema !== SCHEMA || !Array.isArray(input.workspaces)) return base;
  const workspaces = [];
  for (const row of input.workspaces.slice(-128)) {
    try {
      const plan = deterministicPlan(row);
      if (row.plan_sha256 !== plan.plan_sha256 || row.workspace_id !== plan.workspace_id) continue;
      workspaces.push({
        ...plan,
        state: STATES.has(String(row.state)) ? String(row.state) : 'CREATE_AMBIGUOUS',
        attempt_id: row.attempt_id ? String(row.attempt_id) : null,
        worktree_path: row.worktree_path ? String(row.worktree_path) : null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        last_error: row.last_error ? String(row.last_error).slice(0, 300) : null,
        authority_effect: row.authority_effect === true,
      });
    } catch {}
  }
  return { ...base, workspaces, updated_at: input.updated_at || null };
}

function parseWorktreePorcelain(text) {
  const rows = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) rows.push(current);
      current = { path: line.slice(9), head: null, branch: null };
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5).toLowerCase();
    else if (current && line.startsWith('branch refs/heads/')) current.branch = line.slice('branch refs/heads/'.length);
    else if (!line && current) { rows.push(current); current = null; }
  }
  if (current) rows.push(current);
  return rows;
}

class WorkspaceManager {
  #repoRoot; #workspaceRoot; #statePath; #load; #save; #runGit; #clock; #uuid; #state;

  constructor({ repoRoot, workspaceRoot, statePath = null, loadState = null, saveState = null, runGit = defaultRunGit, clock = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
    this.#repoRoot = path.resolve(String(repoRoot || ''));
    this.#workspaceRoot = path.resolve(String(workspaceRoot || ''));
    if (!path.isAbsolute(this.#repoRoot) || !path.isAbsolute(this.#workspaceRoot) || this.#repoRoot === this.#workspaceRoot) {
      throw new Error('workspace_roots_invalid');
    }
    this.#statePath = statePath ? path.resolve(statePath) : path.join(this.#workspaceRoot, '.metaengine-workspaces-v1.json');
    this.#load = loadState;
    this.#save = saveState;
    this.#runGit = runGit;
    this.#clock = clock;
    this.#uuid = uuid;
    this.#state = freshState();
  }

  async init() {
    await fs.mkdir(this.#workspaceRoot, { recursive: true });
    const raw = this.#load ? await this.#load() : await this.#readStateFile();
    this.#state = sanitizeState(raw);
    for (const row of this.#state.workspaces) {
      if (row.state === 'CREATING') {
        row.state = 'CREATE_AMBIGUOUS';
        row.last_error = 'restart_during_create';
        row.updated_at = iso(this.#clock);
      }
    }
    await this.#persist();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      ...clone(this.#state),
      repo_root: this.#repoRoot,
      workspace_root: this.#workspaceRoot,
      arbitrary_shell: false,
      direct_main_mutation: false,
      automatic_ambiguous_retry: false,
      authority_effect: false,
    });
  }

  plan(input) { return deterministicPlan(input); }
  verify(plan) { return verifyPlan(plan); }

  async reserve(plan) {
    verifyPlan(plan);
    const existing = this.#state.workspaces.find((row) => row.workspace_id === plan.workspace_id);
    if (existing) return clone(existing);
    const worktreePath = assertWorkspacePath(this.#workspaceRoot, path.join(this.#workspaceRoot, plan.worktree_relative_path));
    const row = {
      ...clone(plan),
      state: 'RESERVED',
      attempt_id: null,
      worktree_path: worktreePath,
      created_at: iso(this.#clock),
      updated_at: iso(this.#clock),
      last_error: null,
      authority_effect: false,
    };
    this.#state.workspaces.push(row);
    this.#state.workspaces = this.#state.workspaces.slice(-128);
    await this.#persist();
    return clone(row);
  }

  async materialize(plan) {
    const reserved = await this.reserve(plan);
    const row = this.#state.workspaces.find((item) => item.workspace_id === reserved.workspace_id);
    if (row.state === 'ACTIVE') return Object.freeze({ ok: true, idempotent: true, workspace: clone(row), authority_effect: false });
    if (row.state === 'CREATE_AMBIGUOUS') throw new Error('workspace_create_ambiguous_reconcile_required');
    if (row.state !== 'RESERVED') throw new Error(`workspace_create_state_invalid:${row.state}`);

    await this.#assertBaseCommit(plan.base_sha);
    await this.#assertTargetUnused(row);

    row.state = 'CREATING';
    row.attempt_id = `attempt_${String(this.#uuid()).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
    row.updated_at = iso(this.#clock);
    row.last_error = null;
    row.authority_effect = false;
    await this.#persist();

    try {
      await this.#runGit(['-C', this.#repoRoot, 'worktree', 'add', '-b', row.branch_name, row.worktree_path, row.base_sha]);
      const proof = await this.#readExactWorktree(row);
      if (!proof.exact) throw new Error(`workspace_create_readback_failed:${proof.reason}`);
      row.state = 'ACTIVE';
      row.updated_at = iso(this.#clock);
      row.last_error = null;
      row.authority_effect = true;
      await this.#persist();
      return Object.freeze({ ok: true, idempotent: false, workspace: clone(row), readback: proof, authority_effect: true });
    } catch (error) {
      row.state = 'CREATE_AMBIGUOUS';
      row.updated_at = iso(this.#clock);
      row.last_error = String(error?.message || error).slice(0, 300);
      row.authority_effect = true;
      await this.#persist();
      throw error;
    }
  }

  async reconcile(workspaceId) {
    const row = this.#state.workspaces.find((item) => item.workspace_id === String(workspaceId || ''));
    if (!row) throw new Error('workspace_not_found');
    if (row.state === 'ACTIVE') {
      const proof = await this.#readExactWorktree(row);
      return Object.freeze({ outcome: proof.exact ? 'COMMITTED' : 'DRIFT', workspace: clone(row), readback: proof, authority_effect: false });
    }
    if (row.state !== 'CREATE_AMBIGUOUS') return Object.freeze({ outcome: 'NOT_AMBIGUOUS', workspace: clone(row), authority_effect: false });

    const proof = await this.#readExactWorktree(row);
    if (proof.exact) {
      row.state = 'ACTIVE';
      row.last_error = null;
      row.updated_at = iso(this.#clock);
      row.authority_effect = true;
      await this.#persist();
      return Object.freeze({ outcome: 'COMMITTED', workspace: clone(row), readback: proof, authority_effect: false });
    }

    const pathExists = await fs.lstat(row.worktree_path).then(() => true).catch((error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
    const branchExists = await this.#branchExists(row.branch_name);
    if (!pathExists && !branchExists) {
      row.state = 'RESERVED';
      row.attempt_id = null;
      row.last_error = 'no_effect_confirmed';
      row.updated_at = iso(this.#clock);
      row.authority_effect = false;
      await this.#persist();
      return Object.freeze({ outcome: 'NO_EFFECT', workspace: clone(row), readback: proof, authority_effect: false });
    }
    return Object.freeze({ outcome: 'AMBIGUOUS', workspace: clone(row), readback: proof, authority_effect: false });
  }

  async #assertBaseCommit(baseSha) {
    const result = await this.#runGit(['-C', this.#repoRoot, 'rev-parse', '--verify', `${baseSha}^{commit}`]);
    const actual = String(result.stdout || '').trim().toLowerCase();
    if (actual !== baseSha) throw new Error('workspace_base_sha_not_exact');
  }

  async #assertTargetUnused(row) {
    const exists = await fs.lstat(row.worktree_path).then(() => true).catch((error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) throw new Error('workspace_target_path_exists');
    if (await this.#branchExists(row.branch_name)) throw new Error('workspace_branch_exists');
  }

  async #branchExists(branchName) {
    try {
      await this.#runGit(['-C', this.#repoRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
      return true;
    } catch (error) {
      if (error?.exitCode === 1) return false;
      throw error;
    }
  }

  async #readExactWorktree(row) {
    let listing;
    try { listing = await this.#runGit(['-C', this.#repoRoot, 'worktree', 'list', '--porcelain']); }
    catch (error) { return { exact: false, reason: 'worktree_list_failed', error: String(error?.message || error), authority_effect: false }; }
    const wantedPath = path.resolve(row.worktree_path);
    const match = parseWorktreePorcelain(listing.stdout).find((item) => path.resolve(item.path) === wantedPath) || null;
    if (!match) return { exact: false, reason: 'worktree_missing', authority_effect: false };
    if (String(match.head || '').toLowerCase() !== row.base_sha) return { exact: false, reason: 'head_mismatch', observed_head: match.head, authority_effect: false };
    if (String(match.branch || '') !== row.branch_name) return { exact: false, reason: 'branch_mismatch', observed_branch: match.branch, authority_effect: false };
    return { exact: true, path: wantedPath, head: match.head, branch: match.branch, authority_effect: false };
  }

  async #readStateFile() {
    try { return JSON.parse(await fs.readFile(this.#statePath, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async #persist() {
    this.#state.updated_at = iso(this.#clock);
    const payload = clone(this.#state);
    if (this.#save) return this.#save(payload);
    await fs.mkdir(path.dirname(this.#statePath), { recursive: true });
    const temp = `${this.#statePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.#statePath);
  }
}

module.exports = {
  WorkspaceManager,
  createWorkspacePlan: deterministicPlan,
  verifyWorkspacePlan: verifyPlan,
  parseWorktreePorcelain,
  defaultRunGit,
};
