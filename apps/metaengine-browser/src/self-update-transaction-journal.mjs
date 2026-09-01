import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SELF_UPDATE_TRANSACTION_FILE = 'metaengine-self-update-transaction-v1.json';
export const SELF_UPDATE_TRANSACTION_SCHEMA = 'metaengine.self-update.transaction.v1';
export const SELF_UPDATE_INSTALL_EFFECT_BARRIER = 'WRITE_AHEAD_V1';
export const SELF_UPDATE_INSTALL_EFFECT_SCOPE = 'BROWSER_RESTART';
export const SELF_UPDATE_INSTALL_ACTUATOR = 'ELECTRON_UPDATER_QUIT_AND_INSTALL';

const STATES = new Set([
  'PREPARED',
  'INSTALLING',
  'SUCCESSOR_BOOTED',
  'QUALIFIED',
  'AMBIGUOUS_INSTALL',
  'QUARANTINED',
  'SUPERSEDED',
]);

const TERMINAL = new Set(['QUALIFIED', 'QUARANTINED', 'SUPERSEDED']);
const BEGIN_ALLOWED_PRIOR_STATES = new Set(['QUALIFIED', 'SUPERSEDED']);
const TRANSITIONS = new Map([
  ['PREPARED', new Set(['INSTALLING','SUCCESSOR_BOOTED','AMBIGUOUS_INSTALL','SUPERSEDED'])],
  ['INSTALLING', new Set(['SUCCESSOR_BOOTED','AMBIGUOUS_INSTALL','SUPERSEDED'])],
  ['SUCCESSOR_BOOTED', new Set(['QUALIFIED','QUARANTINED','AMBIGUOUS_INSTALL','SUPERSEDED'])],
  ['AMBIGUOUS_INSTALL', new Set(['SUCCESSOR_BOOTED','QUARANTINED','SUPERSEDED'])],
  ['QUALIFIED', new Set(['SUPERSEDED'])],
  ['QUARANTINED', new Set(['SUPERSEDED'])],
  ['SUPERSEDED', new Set()],
]);

let installEffectBarrierTail = Promise.resolve();

function assertApp(app) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getVersion !== 'function') {
    throw new Error('self_update_transaction_app_invalid');
  }
}

function transactionPath(app) {
  assertApp(app);
  return path.join(app.getPath('userData'), SELF_UPDATE_TRANSACTION_FILE);
}

async function atomicWrite(target, row) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try {
    await handle.write(`${JSON.stringify(row)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
}

function safeEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) continue;
    if (['string','number','boolean'].includes(typeof raw) || raw == null) result[key] = raw;
  }
  return result;
}

function validate(row) {
  if (!row || row.schema !== SELF_UPDATE_TRANSACTION_SCHEMA) throw new Error('self_update_transaction_schema_invalid');
  if (!STATES.has(String(row.state || ''))) throw new Error('self_update_transaction_state_invalid');
  if (!row.transaction_id || !row.source_version || !row.target_version) throw new Error('self_update_transaction_binding_invalid');
  if (row.automatic_retry_allowed !== false) throw new Error('self_update_transaction_retry_contract_invalid');
  if (row.authority_effect !== false) throw new Error('self_update_transaction_authority_invalid');
  return row;
}

function serializeInstallEffectBarrier(operation) {
  const run = installEffectBarrierTail.then(operation, operation);
  installEffectBarrierTail = run.then(() => undefined, () => undefined);
  return run;
}

export async function readSelfUpdateTransaction(app) {
  const target = transactionPath(app);
  let raw;
  try { raw = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  let row;
  try { row = JSON.parse(raw); }
  catch { throw new Error('self_update_transaction_json_invalid'); }
  return structuredClone(validate(row));
}

export async function beginSelfUpdateTransaction(app, receipt, { clock = () => Date.now() } = {}) {
  assertApp(app);
  const targetVersion = String(receipt?.version || '');
  if (!targetVersion || targetVersion !== String(receipt?.available_version || '')) throw new Error('self_update_transaction_target_invalid');
  if (receipt?.metadata_verified !== true || receipt?.restart_gate_safe !== true || receipt?.authority_effect !== false) {
    throw new Error('self_update_transaction_receipt_invalid');
  }
  // Never erase an unreadable journal and never replace an unresolved/held attempt.
  // A new transaction is admissible only after explicit prior convergence.
  const prior = await readSelfUpdateTransaction(app);
  if (prior && !BEGIN_ALLOWED_PRIOR_STATES.has(prior.state)) {
    throw new Error(`self_update_transaction_unresolved_prior:${prior.state}`);
  }
  const now = Number(clock());
  const sameTargetAttempts = prior?.target_version === targetVersion ? Number(prior.attempt_count || 0) : 0;
  const row = {
    schema: SELF_UPDATE_TRANSACTION_SCHEMA,
    transaction_id: crypto.randomUUID(),
    source_version: String(app.getVersion() || ''),
    target_version: targetVersion,
    resolved_git_sha: receipt?.resolved_git_sha ? String(receipt.resolved_git_sha) : null,
    state: 'PREPARED',
    swapping: true,
    qualified: false,
    quarantined: false,
    attempt_count: sameTargetAttempts + 1,
    automatic_retry_allowed: false,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    evidence: {},
    authority_effect: false,
  };
  await atomicWrite(transactionPath(app), row);
  return structuredClone(row);
}

export async function transitionSelfUpdateTransaction(app, nextState, {
  evidence = {},
  clock = () => Date.now(),
  requireTargetVersion = null,
} = {}) {
  const current = await readSelfUpdateTransaction(app);
  if (!current) throw new Error('self_update_transaction_missing');
  const next = String(nextState || '').toUpperCase();
  if (!STATES.has(next)) throw new Error('self_update_transaction_state_invalid');
  if (requireTargetVersion != null && String(requireTargetVersion) !== current.target_version) {
    throw new Error('self_update_transaction_target_binding_mismatch');
  }
  if (next !== current.state) {
    const allowed = TRANSITIONS.get(current.state) || new Set();
    if (!allowed.has(next)) throw new Error(`self_update_transaction_transition_invalid:${current.state}:${next}`);
  }
  const now = Number(clock());
  const row = {
    ...current,
    state: next,
    swapping: !TERMINAL.has(next) && next !== 'SUCCESSOR_BOOTED',
    qualified: next === 'QUALIFIED',
    quarantined: next === 'QUARANTINED',
    automatic_retry_allowed: false,
    updated_at: new Date(now).toISOString(),
    evidence: { ...safeEvidence(current.evidence), ...safeEvidence(evidence) },
    authority_effect: false,
  };
  await atomicWrite(transactionPath(app), row);
  return structuredClone(row);
}

export async function markSelfUpdateInstallEffectAttempted(app, {
  targetVersion,
  clock = () => Date.now(),
} = {}) {
  return serializeInstallEffectBarrier(async () => {
    const expectedTarget = String(targetVersion || '');
    if (!expectedTarget) throw new Error('self_update_install_effect_target_invalid');
    const current = await readSelfUpdateTransaction(app);
    if (!current) throw new Error('self_update_transaction_missing');
    if (current.state !== 'PREPARED') {
      throw new Error(`self_update_install_effect_barrier_state_invalid:${current.state}`);
    }
    if (current.target_version !== expectedTarget) {
      throw new Error('self_update_transaction_target_binding_mismatch');
    }
    return transitionSelfUpdateTransaction(app, 'INSTALLING', {
      requireTargetVersion: expectedTarget,
      clock,
      evidence: {
        effect_barrier_contract: SELF_UPDATE_INSTALL_EFFECT_BARRIER,
        effect_scope: SELF_UPDATE_INSTALL_EFFECT_SCOPE,
        actuator_type: SELF_UPDATE_INSTALL_ACTUATOR,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        effect_must_be_single_shot: true,
        post_effect_readback_required: true,
        process_id: process.pid,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
    });
  });
}

export async function qualifySelfUpdateTransaction(app, evidence = {}) {
  return transitionSelfUpdateTransaction(app, 'QUALIFIED', {
    requireTargetVersion: String(app.getVersion() || ''),
    evidence: { ...evidence, qualified_version: String(app.getVersion() || '') },
  });
}

export async function quarantineSelfUpdateTransaction(app, reason = 'qualification_failed') {
  return transitionSelfUpdateTransaction(app, 'QUARANTINED', {
    evidence: { quarantine_reason: String(reason || 'qualification_failed').slice(0, 180) },
  });
}
