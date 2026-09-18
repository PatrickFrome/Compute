import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiMetaProfileShadowSelection } from './rsi-meta-profile-shadow-selection.mjs';

export const RSI_SELECTED_SHADOW_CONTEXT_BINDING_SCHEMA = 'metaengine.rsi.selected-shadow-context-binding.v1';
export const RSI_SELECTED_SHADOW_CONTEXT_BINDING_LEDGER_SCHEMA = 'metaengine.rsi.selected-shadow-context-binding-ledger.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS = 4096;

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
  if (!SHA40_RE.test(out)) throw new Error(`rsi_selected_shadow_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_selected_shadow_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_selected_shadow_${label}_invalid`);
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
    if (value?.[field] !== false) throw new Error(`rsi_selected_shadow_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_selected_shadow_${label}_retry_invalid`);
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

export function createRsiSelectedShadowContextBinding({
  binding_id,
  selection,
  comparator_root_digest,
  external_shadow_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedSelection = verifyRsiMetaProfileShadowSelection(selection);
  if (external_shadow_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_selected_shadow_external_owner_required');
  }

  const selected = checkedSelection.selected;
  const core = {
    schema: RSI_SELECTED_SHADOW_CONTEXT_BINDING_SCHEMA,
    version: 1,
    source_sha: exactSha(checkedSelection.source_sha, 'source'),
    binding_id: boundedId(binding_id, 'binding_id'),
    selection_id: boundedId(checkedSelection.selection_id, 'selection_id'),
    selection_digest: exactDigest(checkedSelection.selection_digest, 'selection'),
    selected_qualification_digest: exactDigest(selected.qualification_digest, 'qualification'),
    champion_profile_digest: exactDigest(selected.parent_profile_digest, 'champion_profile'),
    challenger_profile_digest: exactDigest(selected.successor_profile_digest, 'challenger_profile'),
    verified_context_class: String(checkedSelection.context_class),
    verified_context_digest: exactDigest(checkedSelection.context_digest, 'context'),
    comparator_root_digest: exactDigest(comparator_root_digest, 'comparator_root'),
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    same_verified_context_required: true,
    selection_policy_reused_without_override: true,
    champion_is_selected_parent_profile: true,
    challenger_is_selected_qualified_successor: true,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    candidate_can_bypass_phase18_selection: false,
    raw_context_exposed_to_candidate: false,
    browser_effects_allowed: false,
    plan_execution_allowed: false,
    active_profile_replaced: false,
    shadow_profile_activation_authorized: false,
    canary_activation_authorized: false,
    external_canary_gate_still_required: true,
    external_shadow_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, binding_digest: digest(core) });
}

export function verifyRsiSelectedShadowContextBinding(binding, selection) {
  if (
    !binding ||
    binding.schema !== RSI_SELECTED_SHADOW_CONTEXT_BINDING_SCHEMA ||
    binding.version !== 1
  ) {
    throw new Error('rsi_selected_shadow_binding_invalid');
  }
  assertZeroAuthority(binding, 'binding');
  if (
    binding.comparison_mode !== 'READ_ONLY_DUAL_PLAN'
    || binding.same_verified_context_required !== true
    || binding.selection_policy_reused_without_override !== true
    || binding.champion_is_selected_parent_profile !== true
    || binding.challenger_is_selected_qualified_successor !== true
    || binding.candidate_can_choose_context !== false
    || binding.candidate_can_choose_comparator !== false
    || binding.candidate_can_swap_roles !== false
    || binding.candidate_can_bypass_phase18_selection !== false
    || binding.raw_context_exposed_to_candidate !== false
    || binding.browser_effects_allowed !== false
    || binding.plan_execution_allowed !== false
    || binding.active_profile_replaced !== false
    || binding.shadow_profile_activation_authorized !== false
    || binding.canary_activation_authorized !== false
    || binding.external_canary_gate_still_required !== true
    || binding.external_shadow_owner !== true
    || binding.authored_by_candidate !== false
  ) {
    throw new Error('rsi_selected_shadow_binding_policy_invalid');
  }
  const canonical = createRsiSelectedShadowContextBinding({
    binding_id: binding.binding_id,
    selection,
    comparator_root_digest: binding.comparator_root_digest,
    external_shadow_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.binding_digest !== exactDigest(binding.binding_digest, 'binding')) {
    throw new Error('rsi_selected_shadow_binding_digest_mismatch');
  }
  return canonical;
}

function ledgerState(sourceSha, rows) {
  const core = {
    schema: RSI_SELECTED_SHADOW_CONTEXT_BINDING_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    rows,
    row_count: rows.length,
    max_rows: MAX_ROWS,
    append_only: true,
    active_profile_digest: null,
    shadow_profile_digest: null,
    canary_profile_digest: null,
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

export class RsiSelectedShadowContextBindingLedger {
  #path;
  #sourceSha;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha } = {}) {
    if (!statePath) throw new Error('rsi_selected_shadow_ledger_path_required');
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
        parsed.schema !== RSI_SELECTED_SHADOW_CONTEXT_BINDING_LEDGER_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#sourceSha
        || parsed.append_only !== true
        || parsed.active_profile_digest !== null
        || parsed.shadow_profile_digest !== null
        || parsed.canary_profile_digest !== null
        || parsed.ledger_can_activate_profile !== false
        || parsed.candidate_can_delete_rows !== false
        || parsed.candidate_can_rewrite_rows !== false
        || !Array.isArray(parsed.rows)
        || parsed.rows.length > MAX_ROWS
      ) {
        throw new Error('rsi_selected_shadow_ledger_state_invalid');
      }
      const stateClone = structuredClone(parsed);
      delete stateClone.state_digest;
      if (digest(stateClone) !== exactDigest(parsed.state_digest, 'ledger')) {
        throw new Error('rsi_selected_shadow_ledger_digest_mismatch');
      }
      const seen = new Set();
      for (const row of parsed.rows) {
        if (row.source_sha !== this.#sourceSha) throw new Error('rsi_selected_shadow_ledger_row_source_mismatch');
        assertZeroAuthority(row, 'ledger_row');
        const rowClone = structuredClone(row);
        delete rowClone.binding_digest;
        if (digest(rowClone) !== exactDigest(row.binding_digest, 'binding')) {
          throw new Error('rsi_selected_shadow_ledger_row_digest_mismatch');
        }
        if (seen.has(row.binding_id)) throw new Error('rsi_selected_shadow_ledger_row_duplicate');
        seen.add(row.binding_id);
      }
      this.#rows = parsed.rows;
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
  }

  async add(binding, selection) {
    if (!this.#initialized) throw new Error('rsi_selected_shadow_ledger_not_initialized');
    const checked = verifyRsiSelectedShadowContextBinding(binding, selection);
    if (checked.source_sha !== this.#sourceSha) throw new Error('rsi_selected_shadow_binding_source_mismatch');
    const existing = this.#rows.find((row) => row.binding_id === checked.binding_id);
    if (existing) {
      if (existing.binding_digest !== checked.binding_digest) throw new Error('rsi_selected_shadow_binding_conflict');
      return zeroAuthority({ state: 'IDEMPOTENT', binding_digest: checked.binding_digest });
    }
    if (this.#rows.length >= MAX_ROWS) throw new Error('rsi_selected_shadow_ledger_capacity_exceeded');
    this.#rows.push(structuredClone(checked));
    await this.#persist();
    return zeroAuthority({ state: 'READ_ONLY_DUAL_PLAN_BOUND', binding_digest: checked.binding_digest });
  }

  bindings() {
    if (!this.#initialized) throw new Error('rsi_selected_shadow_ledger_not_initialized');
    return Object.freeze(this.#rows.map((row) => Object.freeze(structuredClone(row))));
  }

  bindingByDigest(bindingDigest) {
    if (!this.#initialized) throw new Error('rsi_selected_shadow_ledger_not_initialized');
    const wanted = exactDigest(bindingDigest, 'binding');
    const row = this.#rows.find((entry) => entry.binding_digest === wanted);
    return row ? Object.freeze(structuredClone(row)) : null;
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      row_count: state.row_count,
      max_rows: state.max_rows,
      append_only: true,
      active_profile_digest: null,
      shadow_profile_digest: null,
      canary_profile_digest: null,
      ledger_can_activate_profile: false,
      authority_effect: false,
    });
  }
}

export function rsiSelectedShadowContextBindingTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.selected-shadow-context-binding-root.v1',
    version: 1,
    phase18_selection_required: true,
    selected_qualification_only: true,
    same_verified_context_required: true,
    champion_is_selected_parent_profile: true,
    challenger_is_selected_qualified_successor: true,
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    external_shadow_owner_required: true,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    candidate_can_bypass_phase18_selection: false,
    raw_context_exposed_to_candidate: false,
    browser_effects_allowed: false,
    plan_execution_allowed: false,
    active_profile_replacement_authorized: false,
    canary_activation_authorized: false,
    external_canary_gate_still_required: true,
    append_only_binding_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, binding_root_digest: digest(root) });
}
