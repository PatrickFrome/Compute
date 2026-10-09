import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWorkspaceReservation, recordWorkspaceMaterializationReadback } from './workspace-manager.mjs';
import { planLockedWorkspaceMaterialization, planWorkspaceInventory, verifyWorkspaceInventory, parseWorktreePorcelainZ } from './workspace-git-hardening.mjs';

export const MANAGED_TASK_PROJECT_RUNTIME_SCHEMA = 'metaengine.devos.managed-task-project-runtime.v1';
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRANCH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{3,200}$/;

function boundedText(value, name, max = 256) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`managed_project_${name}_invalid`);
  return text;
}
function clone(value) { return structuredClone(value); }
function bindingDigest(reservation) {
  return crypto.createHash('sha256').update(JSON.stringify({
    workspace_id: reservation.workspace_id, worktree_id: reservation.worktree_id,
    workspace_generation: reservation.workspace_generation,
    coordination_workspace_id: reservation.coordination_workspace_id,
    task_id: reservation.task_id, agent_id: reservation.agent_id,
    lease_generation: reservation.lease_generation, branch_name: reservation.branch_name,
    claim_id: reservation.claim_id, point_id: reservation.point_id,
    agent_generation_epoch: reservation.agent_generation_epoch,
    tab_id: reservation.tab_id, target_id: reservation.target_id,
    base_sha: reservation.base_sha, repo_id: reservation.repo_id,
    repo_root: reservation.repo_root, managed_root: reservation.managed_root,
    worktree_path: reservation.worktree_path,
  })).digest('hex');
}

/** A small append-only adapter useful in the shell and in tests. Production
 * callers can provide a DB/event-log adapter with the same methods. */
export function createManagedTaskProjectMemoryJournal() {
  const rows = new Map();
  return Object.freeze({
    async find(idempotencyKey) { return clone(rows.get(String(idempotencyKey))?.at(-1) || null); },
    async append(entry) {
      const key = String(entry.idempotency_key);
      const prior = rows.get(key) || [];
      if ((!prior.length && entry.state !== 'RESERVED') || (prior.length && (prior.at(-1).state !== 'RESERVED' || entry.state === 'RESERVED' || entry.binding_digest !== prior.at(-1).binding_digest))) throw new Error('managed_project_journal_append_conflict');
      rows.set(key, [...prior, clone(entry)]);
      return clone(entry);
    },
    snapshot() { return [...rows.values()].flat().map(clone); },
  });
}

function assertGitPlan(plan) {
  if (plan?.schema !== 'metaengine.devos.workspace-git-plan.v1' || plan.executable !== 'git' || plan.shell !== false ||
      !Array.isArray(plan.argv) || !plan.argv.every(arg => typeof arg === 'string') ||
      typeof plan.cwd !== 'string' || !path.isAbsolute(plan.cwd) || path.resolve(plan.cwd) !== plan.cwd ||
      !UUID_RE.test(String(plan.workspace_id || '')) || !UUID_RE.test(String(plan.task_id || '')) ||
      !Number.isSafeInteger(plan.lease_generation) || plan.lease_generation < 1) {
    throw new Error('managed_project_git_plan_invalid');
  }
  const argv = plan.argv;
  if (plan.effect === 'WORKTREE_INVENTORY_READ' &&
      argv.length === 4 && argv.every((arg, index) => arg === ['worktree', 'list', '--porcelain', '-z'][index])) return;
  if (plan.effect === 'WORKTREE_CREATE_LOCKED' && argv.length === 9 &&
      argv[0] === 'worktree' && argv[1] === 'add' && argv[2] === '--lock' && argv[3] === '--reason' &&
      argv[4] === `METAENGINE:${plan.workspace_id}:task:${plan.task_id}:lease:${plan.lease_generation}` &&
      argv[5] === '-b' && BRANCH_RE.test(argv[6]) &&
      path.isAbsolute(argv[7]) && path.resolve(argv[7]) === argv[7] &&
      SHA_RE.test(argv[8]) && argv[8] === plan.expected_initial_head_sha) return;
  throw new Error('managed_project_git_plan_invalid');
}

/** Execute only the fixed argv plans emitted by workspace-git-hardening. */
export function createShellFreeGitExecutor({ timeoutMs = 120000, spawnProcess = spawn } = {}) {
  const boundedTimeout = Math.max(1000, Math.min(300000, Number(timeoutMs) || 120000));
  return Object.freeze({
    async execute(plan) {
      assertGitPlan(plan);
      return new Promise((resolve, reject) => {
        // The repository remains trusted: Git can execute its configured hooks.
        // On timeout/output overflow wait for close before returning a receipt.
        const child = spawnProcess('git', plan.argv.map(String), { cwd: plan.cwd, shell: false, windowsHide: true });
        const out = []; const err = []; let bytes = 0; let timer; let failure = null;
        const stop = (reason) => { if (failure) return; failure = new Error(reason); child.kill(); };
        const collect = (target, chunk) => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { stop('managed_project_git_output_too_large'); return; } target.push(chunk); };
        child.stdout.on('data', (chunk) => collect(out, chunk));
        child.stderr.on('data', (chunk) => collect(err, chunk));
        child.once('error', (error) => { failure ||= error; });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          const result = { code, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') };
          if (failure || code !== 0) { failure ||= new Error(`managed_project_git_failed:${code ?? signal ?? 'unknown'}`); failure.result = result; reject(failure); return; }
          resolve(result);
        });
        timer = setTimeout(() => stop('managed_project_git_timeout'), boundedTimeout);
        timer.unref?.();
      });
    },
  });
}

function journalEntry({ idempotencyKey, reservation, state, proof = null, reason = null }) {
  return Object.freeze({
    schema: MANAGED_TASK_PROJECT_RUNTIME_SCHEMA,
    idempotency_key: idempotencyKey,
    binding_digest: bindingDigest(reservation),
    state,
    reservation: clone(reservation),
    proof: proof ? clone(proof) : null,
    reason: reason ? String(reason).slice(0, 240) : null,
    automatic_retry_allowed: false,
    authority_effect: false,
    recorded_at: new Date().toISOString(),
  });
}

/**
 * Creates a Codex-like per-task project directory as a locked git worktree.
 * The runtime owns no scheduler or DB authority: callers must pass the exact
 * MUTATING claim read from the authoritative lease plane and may persist each
 * entry through an append-only DB/event adapter.
 */
export function createManagedTaskProjectRuntime({ executePlan, journal, validateClaim, reserveBinding = null, finalizeBinding = null, openProject = null, now = Date.now } = {}) {
  if (typeof executePlan !== 'function') throw new Error('managed_project_executor_required');
  if (!journal || typeof journal.find !== 'function' || typeof journal.append !== 'function') throw new Error('managed_project_journal_required');
  if (typeof validateClaim !== 'function') throw new Error('managed_project_claim_validator_required');
  if (openProject != null && typeof openProject !== 'function') throw new Error('managed_project_open_handler_invalid');
  if (reserveBinding != null && typeof reserveBinding !== 'function') throw new Error('managed_project_reserve_handler_invalid');
  if (finalizeBinding != null && typeof finalizeBinding !== 'function') throw new Error('managed_project_finalize_handler_invalid');

  async function appendTerminal(entry) {
    await journal.append(entry);
    if (finalizeBinding) await finalizeBinding(clone(entry));
  }

  function assertLease(reservation) {
    if (!Number.isFinite(Date.parse(reservation.lease_expires_at)) || Date.parse(reservation.lease_expires_at) <= now()) throw new Error('managed_project_lease_expired');
  }
  async function revalidate(reservation, phase) {
    assertLease(reservation);
    if (await validateClaim(clone(reservation), { phase }) !== true) throw new Error('managed_project_claim_not_current');
    assertLease(reservation);
  }

  async function inventory(reservation) {
    try {
      const result = await executePlan(planWorkspaceInventory(reservation));
      const stdout = result?.stdout ?? result ?? '';
      const proof = verifyWorkspaceInventory(reservation, stdout);
      const record = parseWorktreePorcelainZ(stdout).find(row => path.resolve(String(row.worktree || '')) === path.resolve(reservation.worktree_path));
      if (record?.locked !== `METAENGINE:${reservation.workspace_id}:task:${reservation.task_id}:lease:${reservation.lease_generation}`) throw new Error('managed_project_lock_identity_mismatch');
      if (await fs.realpath(reservation.worktree_path) !== reservation.worktree_path) throw new Error('managed_project_realpath_mismatch');
      return proof;
    } catch (error) {
      if (String(error?.message || error) === 'workspace_git_inventory_path_missing') return null;
      throw error;
    }
  }

  async function create({ idempotency_key: rawKey, claim, trusted_repo, workspace_root, workspace_id, worktree_id, workspace_generation } = {}) {
    const idempotencyKey = boundedText(rawKey, 'idempotency_key', 128);
    if (!IDEMPOTENCY_RE.test(idempotencyKey)) throw new Error('managed_project_idempotency_key_invalid');
    const existing = await journal.find(idempotencyKey);
    // Reuse persisted random identities on a retry, while still comparing all
    // caller-supplied task/agent/repo/lease fields to the original binding.
    const reservation = createWorkspaceReservation({ claim, trusted_repo, workspace_root,
      workspace_id: workspace_id ?? existing?.reservation?.workspace_id,
      worktree_id: worktree_id ?? existing?.reservation?.worktree_id, workspace_generation });
    if (existing) {
      if (existing.binding_digest !== bindingDigest(reservation)) throw new Error('managed_project_idempotency_binding_conflict');
      if (existing.state === 'PROVEN') {
        if (!await inventory(reservation)) throw new Error('managed_project_replay_readback_missing');
        if (finalizeBinding) await finalizeBinding(clone(existing));
        return Object.freeze({ ...clone(existing), replayed: true });
      }
      if (existing.state === 'RESERVED') {
        const proof = await inventory(reservation);
        if (!proof) throw new Error('managed_project_reserved_reconciliation_required');
        const ready = recordWorkspaceMaterializationReadback(reservation, { effect_state: 'PROVEN', initial_head_sha: proof.head_sha, worktree_realpath: proof.worktree_path });
        const entry = journalEntry({ idempotencyKey, reservation: ready, state: 'PROVEN', proof, reason: 'EXACT_READBACK_REPLAY' });
        await appendTerminal(entry);
        return Object.freeze({ ...clone(entry), replayed: true });
      }
      if (['FAILED', 'AMBIGUOUS'].includes(existing.state) && finalizeBinding) await finalizeBinding(clone(existing));
      throw new Error(`managed_project_effect_${String(existing.state || 'UNKNOWN').toLowerCase()}`);
    }
    assertLease(reservation);
    if (await fs.realpath(reservation.repo_root) !== reservation.repo_root || await fs.realpath(reservation.managed_root) !== reservation.managed_root) throw new Error('managed_project_trusted_root_realpath_mismatch');
    // A prior process may have materialized the exact path before its journal
    // append. Reconcile by readback; never issue a second git add blindly.
    const before = await inventory(reservation);
    if (before) throw new Error('managed_project_unjournaled_worktree');
    const plan = planLockedWorkspaceMaterialization(reservation, { branch_exists: false });
    // This append is a write-ahead barrier. A persistent adapter must fsync or
    // commit it before resolving; cross-process conflicts must reject atomically.
    await journal.append(journalEntry({ idempotencyKey, reservation, state: 'RESERVED' }));
    if (reserveBinding) await reserveBinding(clone(reservation));
    await revalidate(reservation, 'BEFORE_CREATE');
    try { await executePlan(plan); } catch (error) {
      let proof = null;
      try { proof = await inventory(reservation); } catch (readbackError) {
        const frozen = journalEntry({ idempotencyKey, reservation, state: 'AMBIGUOUS', reason: readbackError?.message || error?.message });
        await appendTerminal(frozen); return Object.freeze(clone(frozen));
      }
      if (!proof) {
        // An absent inventory row does not prove absence of a partially-created
        // branch, directory or worktree administration entry.
        const failed = journalEntry({ idempotencyKey, reservation, state: 'AMBIGUOUS', reason: error?.message || error });
        await appendTerminal(failed); return Object.freeze(clone(failed));
      }
      const ambiguous = journalEntry({ idempotencyKey, reservation, state: 'AMBIGUOUS', proof, reason: error?.message || error });
      await appendTerminal(ambiguous); return Object.freeze(clone(ambiguous));
    }
    let proof;
    try { proof = await inventory(reservation); }
    catch (error) {
      const ambiguous = journalEntry({ idempotencyKey, reservation, state: 'AMBIGUOUS', reason: error?.message || error });
      await appendTerminal(ambiguous); return Object.freeze(clone(ambiguous));
    }
    if (!proof) {
      const ambiguous = journalEntry({ idempotencyKey, reservation, state: 'AMBIGUOUS', reason: 'WORKTREE_READBACK_MISSING' });
      await appendTerminal(ambiguous); return Object.freeze(clone(ambiguous));
    }
    const ready = recordWorkspaceMaterializationReadback(reservation, { effect_state: 'PROVEN', initial_head_sha: proof.head_sha, worktree_realpath: proof.worktree_path });
    const entry = journalEntry({ idempotencyKey, reservation: ready, state: 'PROVEN', proof });
    await appendTerminal(entry);
    return Object.freeze({ ...clone(entry), replayed: false });
  }

  async function open({ idempotency_key: key, ...request } = {}) {
    const created = await create({ idempotency_key: key, ...request });
    if (created.state !== 'PROVEN') return created;
    if (openProject) {
      await revalidate(created.reservation, 'BEFORE_OPEN');
      await openProject({ path: created.reservation.worktree_realpath || created.reservation.worktree_path, reservation: created.reservation, proof: created.proof });
    }
    return Object.freeze({ ...created, opened: Boolean(openProject) });
  }

  return Object.freeze({ schema: MANAGED_TASK_PROJECT_RUNTIME_SCHEMA, create, open, journal });
}
