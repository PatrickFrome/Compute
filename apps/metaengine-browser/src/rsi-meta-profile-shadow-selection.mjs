import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from './rsi-meta-profile-qualification.mjs';

export const RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA = 'metaengine.rsi.meta-profile-shadow-selection.v1';
export const RSI_META_PROFILE_SHADOW_SELECTION_LEDGER_SCHEMA = 'metaengine.rsi.meta-profile-shadow-selection-ledger.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_CANDIDATES = 64;
const MAX_HISTORY_ROWS = 4096;
const POLICY = 'QUALIFIED_PARETO_DIVERSITY_ROUND_ROBIN_V1';

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_meta_selection_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_meta_selection_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_meta_selection_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_meta_selection_${label}_invalid`);
  return out;
}

function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`rsi_meta_selection_${label}_invalid`);
  return out;
}

function finitePositive(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0) throw new Error(`rsi_meta_selection_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_meta_selection_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_meta_selection_${label}_retry_invalid`);
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function verifyQualifiedProfile(row, sourceSha) {
  if (!plainObject(row) || row.schema !== RSI_META_PROFILE_QUALIFICATION_SCHEMA || row.version !== 1) {
    throw new Error('rsi_meta_selection_qualification_invalid');
  }
  assertZeroAuthority(row, 'qualification');
  if (
    row.state !== 'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION'
    || row.qualified_for_shadow_profile_selection !== true
    || row.live_profile_activation_authorized !== false
    || row.profile_replacement_authorized !== false
    || row.canary_activation_authorized !== false
    || row.external_activation_gate_still_required !== true
  ) {
    throw new Error('rsi_meta_selection_qualification_policy_invalid');
  }
  if (exactSha(row.source_sha, 'qualification_source') !== sourceSha) {
    throw new Error('rsi_meta_selection_qualification_source_mismatch');
  }
  const clone = structuredClone(row);
  delete clone.qualification_digest;
  if (digest(clone) !== exactDigest(row.qualification_digest, 'qualification')) {
    throw new Error('rsi_meta_selection_qualification_digest_mismatch');
  }

  const confirmationIndex = positiveInt(row.confirmation_index, 'confirmation_index');
  const alphaUsed = finitePositive(row.alpha_used, 'alpha_used');
  const allocatedAlpha = finitePositive(row.allocated_alpha, 'allocated_alpha');
  if (alphaUsed > allocatedAlpha + 1e-12) throw new Error('rsi_meta_selection_qualification_alpha_invalid');

  return Object.freeze({
    qualification_id: boundedId(row.qualification_id, 'qualification_id'),
    qualification_digest: exactDigest(row.qualification_digest, 'qualification'),
    meta_record_digest: exactDigest(row.meta_record_digest, 'meta_record'),
    parent_profile_digest: exactDigest(row.parent_profile_digest, 'parent_profile'),
    successor_profile_digest: exactDigest(row.successor_profile_digest, 'successor_profile'),
    shadow_result_digest: exactDigest(row.shadow_result_digest, 'shadow_result'),
    risk_budget_digest: exactDigest(row.risk_budget_digest, 'risk_budget'),
    confirmation_index: confirmationIndex,
    alpha_used: alphaUsed,
  });
}

function verifyHistoryRow(row, sourceSha) {
  const checked = verifyRsiMetaProfileShadowSelection(row);
  if (checked.source_sha !== sourceSha) throw new Error('rsi_meta_selection_history_source_mismatch');
  return checked;
}

function familyDigest(candidate) {
  return digest({
    parent_profile_digest: candidate.parent_profile_digest,
    risk_budget_digest: candidate.risk_budget_digest,
  });
}

function normalizeCandidates(value, sourceSha) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CANDIDATES) {
    throw new Error('rsi_meta_selection_candidates_invalid');
  }
  const byQualification = new Set();
  const bySuccessor = new Set();
  return Object.freeze(value.map((row) => {
    const q = verifyQualifiedProfile(row, sourceSha);
    if (byQualification.has(q.qualification_digest)) throw new Error('rsi_meta_selection_candidate_duplicate');
    if (bySuccessor.has(q.successor_profile_digest)) throw new Error('rsi_meta_selection_successor_duplicate');
    byQualification.add(q.qualification_digest);
    bySuccessor.add(q.successor_profile_digest);
    return Object.freeze({ ...q, family_digest: familyDigest(q) });
  }).sort((a, b) => a.qualification_digest.localeCompare(b.qualification_digest)));
}

function selectionCounts(history, contextDigest) {
  const candidateCount = new Map();
  const familyCount = new Map();
  for (const row of history) {
    if (row.context_digest !== contextDigest) continue;
    candidateCount.set(
      row.selected.qualification_digest,
      (candidateCount.get(row.selected.qualification_digest) || 0) + 1,
    );
    familyCount.set(
      row.selected.family_digest,
      (familyCount.get(row.selected.family_digest) || 0) + 1,
    );
  }
  return { candidateCount, familyCount };
}

function rankedCandidateSummaries(candidates, history, contextDigest) {
  const { candidateCount, familyCount } = selectionCounts(history, contextDigest);
  const rows = candidates.map((candidate) => Object.freeze({
    qualification_id: candidate.qualification_id,
    qualification_digest: candidate.qualification_digest,
    meta_record_digest: candidate.meta_record_digest,
    parent_profile_digest: candidate.parent_profile_digest,
    successor_profile_digest: candidate.successor_profile_digest,
    family_digest: candidate.family_digest,
    context_selection_count: candidateCount.get(candidate.qualification_digest) || 0,
    family_context_selection_count: familyCount.get(candidate.family_digest) || 0,
    risk_confirmation_index: candidate.confirmation_index,
  }));
  rows.sort((a, b) => {
    const aSeen = a.context_selection_count > 0 ? 1 : 0;
    const bSeen = b.context_selection_count > 0 ? 1 : 0;
    if (aSeen !== bSeen) return aSeen - bSeen;
    if (a.family_context_selection_count !== b.family_context_selection_count) {
      return a.family_context_selection_count - b.family_context_selection_count;
    }
    if (a.context_selection_count !== b.context_selection_count) {
      return a.context_selection_count - b.context_selection_count;
    }
    return a.qualification_digest.localeCompare(b.qualification_digest);
  });
  return Object.freeze(rows);
}

export function createRsiMetaProfileShadowSelection({
  source_sha,
  selection_id,
  context_class,
  context_digest,
  qualified_profiles,
  selection_history = [],
  external_context_owner = false,
  authored_by_candidate = true,
} = {}) {
  const sourceSha = exactSha(source_sha, 'source');
  if (external_context_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_meta_selection_external_context_owner_required');
  }
  const contextClass = boundedToken(context_class, 'context_class');
  const contextDigest = exactDigest(context_digest, 'context');
  if (!Array.isArray(selection_history) || selection_history.length > MAX_HISTORY_ROWS) {
    throw new Error('rsi_meta_selection_history_invalid');
  }
  const history = Object.freeze(selection_history.map((row) => verifyHistoryRow(row, sourceSha)));
  const candidates = normalizeCandidates(qualified_profiles, sourceSha);
  const ranked = rankedCandidateSummaries(candidates, history, contextDigest);
  const selected = ranked[0];
  const reason = selected.context_selection_count === 0
    ? 'UNSEEN_QUALIFIED_PROFILE_IN_CONTEXT'
    : 'LEAST_EXPOSED_QUALIFIED_LINEAGE_IN_CONTEXT';

  const core = {
    schema: RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    selection_id: boundedId(selection_id, 'selection_id'),
    policy: POLICY,
    context_class: contextClass,
    context_digest: contextDigest,
    candidate_count: ranked.length,
    candidates: ranked,
    selected: Object.freeze({ ...selected }),
    selection_reason: reason,
    quality_floor: 'RISK_CONTROLLED_META_PROFILE_QUALIFICATION_REQUIRED',
    preserves_qualified_set_without_scalarization: true,
    lineage_diversity_first: true,
    per_context_exposure_balancing: true,
    scalar_winner: null,
    selection_is_profile_activation: false,
    eligible_for_external_shadow_trial_handoff: true,
    shadow_trial_activation_authorized: false,
    live_profile_activation_authorized: false,
    profile_replacement_authorized: false,
    candidate_can_choose_context: false,
    candidate_can_choose_selection_policy: false,
    candidate_can_rewrite_history: false,
    external_context_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, selection_digest: digest(core) });
}

export function verifyRsiMetaProfileShadowSelection(row) {
  if (!plainObject(row) || row.schema !== RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA || row.version !== 1) {
    throw new Error('rsi_meta_selection_invalid');
  }
  assertZeroAuthority(row, 'selection');
  if (
    row.policy !== POLICY
    || row.preserves_qualified_set_without_scalarization !== true
    || row.lineage_diversity_first !== true
    || row.per_context_exposure_balancing !== true
    || row.scalar_winner !== null
    || row.selection_is_profile_activation !== false
    || row.eligible_for_external_shadow_trial_handoff !== true
    || row.shadow_trial_activation_authorized !== false
    || row.live_profile_activation_authorized !== false
    || row.profile_replacement_authorized !== false
    || row.candidate_can_choose_context !== false
    || row.candidate_can_choose_selection_policy !== false
    || row.candidate_can_rewrite_history !== false
    || row.external_context_owner !== true
    || row.authored_by_candidate !== false
  ) {
    throw new Error('rsi_meta_selection_policy_invalid');
  }
  exactSha(row.source_sha, 'source');
  boundedId(row.selection_id, 'selection_id');
  boundedToken(row.context_class, 'context_class');
  exactDigest(row.context_digest, 'context');
  if (!Array.isArray(row.candidates) || row.candidates.length < 1 || row.candidates.length > MAX_CANDIDATES) {
    throw new Error('rsi_meta_selection_candidate_set_invalid');
  }
  if (!plainObject(row.selected)) throw new Error('rsi_meta_selection_selected_invalid');
  const selectedDigest = exactDigest(row.selected.qualification_digest, 'selected_qualification');
  if (!row.candidates.some((candidate) => candidate.qualification_digest === selectedDigest)) {
    throw new Error('rsi_meta_selection_selected_not_in_candidate_set');
  }
  const clone = structuredClone(row);
  delete clone.selection_digest;
  if (digest(clone) !== exactDigest(row.selection_digest, 'selection')) {
    throw new Error('rsi_meta_selection_digest_mismatch');
  }
  return Object.freeze(structuredClone(row));
}

function ledgerState(sourceSha, rows) {
  const core = {
    schema: RSI_META_PROFILE_SHADOW_SELECTION_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    policy: POLICY,
    rows,
    row_count: rows.length,
    max_rows: MAX_HISTORY_ROWS,
    append_only: true,
    active_profile_digest: null,
    shadow_profile_digest: null,
    ledger_can_activate_profile: false,
    candidate_can_delete_rows: false,
    candidate_can_rewrite_rows: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, state_digest: digest(core) };
}

export class RsiMetaProfileShadowSelectionLedger {
  #path;
  #sourceSha;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha } = {}) {
    if (!statePath) throw new Error('rsi_meta_selection_ledger_path_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'source');
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZeroAuthority(parsed, 'ledger');
      if (
        parsed.schema !== RSI_META_PROFILE_SHADOW_SELECTION_LEDGER_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#sourceSha
        || parsed.policy !== POLICY
        || parsed.append_only !== true
        || parsed.active_profile_digest !== null
        || parsed.shadow_profile_digest !== null
        || parsed.ledger_can_activate_profile !== false
        || parsed.candidate_can_delete_rows !== false
        || parsed.candidate_can_rewrite_rows !== false
      ) throw new Error('rsi_meta_selection_ledger_state_invalid');
      const clone = structuredClone(parsed);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(parsed.state_digest, 'ledger')) {
        throw new Error('rsi_meta_selection_ledger_digest_mismatch');
      }
      if (!Array.isArray(parsed.rows) || parsed.rows.length > MAX_HISTORY_ROWS) {
        throw new Error('rsi_meta_selection_ledger_rows_invalid');
      }
      const ids = new Set();
      this.#rows = parsed.rows.map((row) => {
        const checked = verifyRsiMetaProfileShadowSelection(row);
        if (checked.source_sha !== this.#sourceSha) throw new Error('rsi_meta_selection_ledger_row_source_mismatch');
        if (ids.has(checked.selection_id)) throw new Error('rsi_meta_selection_ledger_row_duplicate');
        ids.add(checked.selection_id);
        return checked;
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = ledgerState(this.#sourceSha, this.#rows);
    const temp = `${this.#path}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, this.#path);
    return state;
  }

  async add(selection) {
    if (!this.#initialized) throw new Error('rsi_meta_selection_ledger_not_initialized');
    const checked = verifyRsiMetaProfileShadowSelection(selection);
    if (checked.source_sha !== this.#sourceSha) throw new Error('rsi_meta_selection_ledger_source_mismatch');
    const existing = this.#rows.find((row) => row.selection_id === checked.selection_id);
    if (existing) {
      if (existing.selection_digest !== checked.selection_digest) throw new Error('rsi_meta_selection_identity_conflict');
      return zeroAuthority({ state: 'IDEMPOTENT', selection_digest: checked.selection_digest });
    }
    if (this.#rows.length >= MAX_HISTORY_ROWS) throw new Error('rsi_meta_selection_ledger_capacity_exceeded');
    this.#rows.push(checked);
    await this.#persist();
    return zeroAuthority({ state: 'RECORDED', selection_digest: checked.selection_digest });
  }

  history() {
    if (!this.#initialized) throw new Error('rsi_meta_selection_ledger_not_initialized');
    return Object.freeze(this.#rows.map((row) => Object.freeze(structuredClone(row))));
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      policy: state.policy,
      row_count: state.row_count,
      max_rows: state.max_rows,
      append_only: true,
      active_profile_digest: null,
      shadow_profile_digest: null,
      ledger_can_activate_profile: false,
      authority_effect: false,
    });
  }
}

export function rsiMetaProfileShadowSelectionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.meta-profile-shadow-selection-root.v1',
    version: 1,
    policy: POLICY,
    phase17_risk_qualification_required: true,
    exact_source_fencing_required: true,
    per_context_exposure_balancing: true,
    lineage_diversity_first: true,
    pareto_qualified_set_preserved: true,
    scalar_winner_authoritative: false,
    selection_is_profile_activation: false,
    external_shadow_trial_handoff_required: true,
    candidate_can_choose_context: false,
    candidate_can_choose_selection_policy: false,
    candidate_can_rewrite_history: false,
    live_profile_activation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, selection_root_digest: digest(root) });
}
