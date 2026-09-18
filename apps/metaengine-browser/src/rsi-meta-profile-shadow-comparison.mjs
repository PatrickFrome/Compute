import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA,
  verifyRsiMetaProfileShadowSelection,
} from './rsi-meta-profile-shadow-selection.mjs';
import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from './rsi-meta-profile-qualification.mjs';

export const RSI_META_PROFILE_SHADOW_BINDING_SCHEMA = 'metaengine.rsi.meta-profile-shadow-comparison-binding.v1';
export const RSI_META_PROFILE_DUAL_PLAN_COMPARISON_SCHEMA = 'metaengine.rsi.meta-profile-dual-plan-comparison.v1';
export const RSI_META_PROFILE_SHADOW_COMPARISON_LEDGER_SCHEMA = 'metaengine.rsi.meta-profile-shadow-comparison-ledger.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS = 2048;
const MAX_EVIDENCE_REFS = 32;

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
  if (!SHA40_RE.test(out)) throw new Error(`rsi_meta_comparison_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_meta_comparison_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_meta_comparison_${label}_invalid`);
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
    if (value?.[field] !== false) throw new Error(`rsi_meta_comparison_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_meta_comparison_${label}_retry_invalid`);
  }
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

function verifyQualification(row, selection) {
  if (!plainObject(row) || row.schema !== RSI_META_PROFILE_QUALIFICATION_SCHEMA || row.version !== 1) {
    throw new Error('rsi_meta_comparison_qualification_invalid');
  }
  assertZeroAuthority(row, 'qualification');
  const clone = structuredClone(row);
  delete clone.qualification_digest;
  if (digest(clone) !== exactDigest(row.qualification_digest, 'qualification')) {
    throw new Error('rsi_meta_comparison_qualification_digest_mismatch');
  }
  if (
    row.state !== 'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION'
    || row.qualified_for_shadow_profile_selection !== true
    || row.live_profile_activation_authorized !== false
    || row.profile_replacement_authorized !== false
    || row.canary_activation_authorized !== false
    || row.external_activation_gate_still_required !== true
  ) {
    throw new Error('rsi_meta_comparison_qualification_policy_invalid');
  }
  if (exactSha(row.source_sha, 'qualification_source') !== selection.source_sha) {
    throw new Error('rsi_meta_comparison_qualification_source_mismatch');
  }
  if (exactDigest(row.qualification_digest, 'qualification') !== selection.selected.qualification_digest) {
    throw new Error('rsi_meta_comparison_selected_qualification_mismatch');
  }
  if (
    exactDigest(row.parent_profile_digest, 'parent_profile') !== selection.selected.parent_profile_digest
    || exactDigest(row.successor_profile_digest, 'successor_profile') !== selection.selected.successor_profile_digest
  ) {
    throw new Error('rsi_meta_comparison_selected_profile_mismatch');
  }
  return Object.freeze(structuredClone(row));
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) {
    throw new Error('rsi_meta_comparison_evidence_refs_invalid');
  }
  const out = [...new Set(value.map((item) => boundedId(item, 'evidence_ref')))].sort();
  if (out.length !== value.length) throw new Error('rsi_meta_comparison_evidence_refs_duplicate');
  return Object.freeze(out);
}

export function createRsiMetaProfileShadowComparisonBinding({
  binding_id,
  selection,
  selected_qualification,
  verified_context_digest,
  comparator_root_digest,
  external_comparator_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedSelection = verifyRsiMetaProfileShadowSelection(selection);
  const qualification = verifyQualification(selected_qualification, checkedSelection);
  if (external_comparator_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_meta_comparison_external_comparator_owner_required');
  }
  const contextDigest = exactDigest(verified_context_digest, 'verified_context');
  if (contextDigest !== checkedSelection.context_digest) {
    throw new Error('rsi_meta_comparison_context_binding_mismatch');
  }

  const core = {
    schema: RSI_META_PROFILE_SHADOW_BINDING_SCHEMA,
    version: 1,
    source_sha: exactSha(checkedSelection.source_sha, 'source'),
    binding_id: boundedId(binding_id, 'binding_id'),
    selection_id: checkedSelection.selection_id,
    selection_digest: checkedSelection.selection_digest,
    selection_policy: checkedSelection.policy,
    qualification_id: qualification.qualification_id,
    qualification_digest: qualification.qualification_digest,
    context_class: checkedSelection.context_class,
    verified_context_digest: contextDigest,
    comparator_root_digest: exactDigest(comparator_root_digest, 'comparator_root'),
    champion_profile_digest: qualification.parent_profile_digest,
    challenger_profile_digest: qualification.successor_profile_digest,
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    qd_selection_required: true,
    same_verified_context_required: true,
    champion_challenger_roles_fixed: true,
    raw_context_exposed_to_candidate: false,
    candidate_can_choose_profile: false,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    plan_execution_allowed: false,
    browser_effects_allowed: false,
    active_profile_replacement_authorized: false,
    shadow_profile_activation_authorized: false,
    canary_activation_authorized: false,
    future_canary_gate_still_required: true,
    external_comparator_owner: true,
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

export function verifyRsiMetaProfileShadowComparisonBinding(binding, {
  selection,
  selected_qualification,
} = {}) {
  if (!plainObject(binding) || binding.schema !== RSI_META_PROFILE_SHADOW_BINDING_SCHEMA || binding.version !== 1) {
    throw new Error('rsi_meta_comparison_binding_invalid');
  }
  assertZeroAuthority(binding, 'binding');
  if (
    binding.comparison_mode !== 'READ_ONLY_DUAL_PLAN'
    || binding.qd_selection_required !== true
    || binding.same_verified_context_required !== true
    || binding.champion_challenger_roles_fixed !== true
    || binding.raw_context_exposed_to_candidate !== false
    || binding.candidate_can_choose_profile !== false
    || binding.candidate_can_choose_context !== false
    || binding.candidate_can_choose_comparator !== false
    || binding.candidate_can_swap_roles !== false
    || binding.plan_execution_allowed !== false
    || binding.browser_effects_allowed !== false
    || binding.active_profile_replacement_authorized !== false
    || binding.shadow_profile_activation_authorized !== false
    || binding.canary_activation_authorized !== false
    || binding.future_canary_gate_still_required !== true
    || binding.external_comparator_owner !== true
    || binding.authored_by_candidate !== false
  ) {
    throw new Error('rsi_meta_comparison_binding_policy_invalid');
  }
  const canonical = createRsiMetaProfileShadowComparisonBinding({
    binding_id: binding.binding_id,
    selection,
    selected_qualification,
    verified_context_digest: binding.verified_context_digest,
    comparator_root_digest: binding.comparator_root_digest,
    external_comparator_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.binding_digest !== exactDigest(binding.binding_digest, 'binding')) {
    throw new Error('rsi_meta_comparison_binding_digest_mismatch');
  }
  return canonical;
}

export function createRsiMetaProfileDualPlanComparison({
  comparison_id,
  binding,
  selection,
  selected_qualification,
  champion_plan_digest,
  challenger_plan_digest,
  champion_projection_digest,
  challenger_projection_digest,
  hard_invariants_pass,
  incident_observed = false,
  divergence_kind = 'SEMANTIC_PLAN',
  evidence_digest,
  evidence_refs,
  external_comparator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedBinding = verifyRsiMetaProfileShadowComparisonBinding(binding, {
    selection,
    selected_qualification,
  });
  if (external_comparator !== true || authored_by_candidate !== false) {
    throw new Error('rsi_meta_comparison_external_comparator_required');
  }
  const championPlan = exactDigest(champion_plan_digest, 'champion_plan');
  const challengerPlan = exactDigest(challenger_plan_digest, 'challenger_plan');
  const championProjection = exactDigest(champion_projection_digest, 'champion_projection');
  const challengerProjection = exactDigest(challenger_projection_digest, 'challenger_projection');
  const hardPass = hard_invariants_pass === true;
  const incident = incident_observed === true;
  const diverged = championProjection !== challengerProjection;
  const relation = !hardPass
    ? 'HARD_INVARIANT_FAILURE'
    : incident
      ? 'INCIDENT'
      : diverged
        ? 'SHADOW_DIVERGENCE'
        : 'MATCHES_CHAMPION';
  const kind = diverged ? boundedId(divergence_kind, 'divergence_kind') : 'NONE';

  const core = {
    schema: RSI_META_PROFILE_DUAL_PLAN_COMPARISON_SCHEMA,
    version: 1,
    source_sha: checkedBinding.source_sha,
    comparison_id: boundedId(comparison_id, 'comparison_id'),
    binding_digest: checkedBinding.binding_digest,
    selection_digest: checkedBinding.selection_digest,
    qualification_digest: checkedBinding.qualification_digest,
    verified_context_digest: checkedBinding.verified_context_digest,
    comparator_root_digest: checkedBinding.comparator_root_digest,
    champion_profile_digest: checkedBinding.champion_profile_digest,
    challenger_profile_digest: checkedBinding.challenger_profile_digest,
    champion_plan_digest: championPlan,
    challenger_plan_digest: challengerPlan,
    champion_projection_digest: championProjection,
    challenger_projection_digest: challengerProjection,
    hard_invariants_pass: hardPass,
    incident_observed: incident,
    relation,
    divergence_kind: kind,
    evidence_digest: exactDigest(evidence_digest, 'evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    shadow_only: true,
    plan_execution_observed: false,
    plan_execution_authorized: false,
    raw_context_stored: false,
    candidate_can_author_comparison: false,
    candidate_can_choose_comparator: false,
    eligible_for_future_canary_review_evidence: hardPass && !incident,
    canary_activation_authorized: false,
    live_profile_activation_authorized: false,
    profile_replacement_authorized: false,
    external_comparator: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, comparison_digest: digest(core) });
}

export function verifyRsiMetaProfileDualPlanComparison(row, args = {}) {
  if (!plainObject(row) || row.schema !== RSI_META_PROFILE_DUAL_PLAN_COMPARISON_SCHEMA || row.version !== 1) {
    throw new Error('rsi_meta_comparison_receipt_invalid');
  }
  assertZeroAuthority(row, 'comparison');
  if (
    row.shadow_only !== true
    || row.plan_execution_observed !== false
    || row.plan_execution_authorized !== false
    || row.raw_context_stored !== false
    || row.candidate_can_author_comparison !== false
    || row.candidate_can_choose_comparator !== false
    || row.canary_activation_authorized !== false
    || row.live_profile_activation_authorized !== false
    || row.profile_replacement_authorized !== false
    || row.external_comparator !== true
    || row.authored_by_candidate !== false
  ) {
    throw new Error('rsi_meta_comparison_receipt_policy_invalid');
  }
  const canonical = createRsiMetaProfileDualPlanComparison({
    comparison_id: row.comparison_id,
    binding: args.binding,
    selection: args.selection,
    selected_qualification: args.selected_qualification,
    champion_plan_digest: row.champion_plan_digest,
    challenger_plan_digest: row.challenger_plan_digest,
    champion_projection_digest: row.champion_projection_digest,
    challenger_projection_digest: row.challenger_projection_digest,
    hard_invariants_pass: row.hard_invariants_pass,
    incident_observed: row.incident_observed,
    divergence_kind: row.divergence_kind === 'NONE' ? 'SEMANTIC_PLAN' : row.divergence_kind,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_comparator: true,
    authored_by_candidate: false,
  });
  if (canonical.comparison_digest !== exactDigest(row.comparison_digest, 'comparison')) {
    throw new Error('rsi_meta_comparison_receipt_digest_mismatch');
  }
  return canonical;
}

function ledgerState(sourceSha, bindings, comparisons) {
  const core = {
    schema: RSI_META_PROFILE_SHADOW_COMPARISON_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    bindings,
    comparisons,
    binding_count: bindings.length,
    comparison_count: comparisons.length,
    append_only: true,
    active_profile_digest: null,
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

export class RsiMetaProfileShadowComparisonLedger {
  #path;
  #sourceSha;
  #bindings = [];
  #comparisons = [];
  #initialized = false;

  constructor({ statePath, source_sha } = {}) {
    if (!statePath) throw new Error('rsi_meta_comparison_ledger_path_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'ledger_source');
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZeroAuthority(parsed, 'ledger');
      if (
        parsed.schema !== RSI_META_PROFILE_SHADOW_COMPARISON_LEDGER_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#sourceSha
        || parsed.append_only !== true
        || parsed.ledger_can_activate_profile !== false
        || !Array.isArray(parsed.bindings)
        || !Array.isArray(parsed.comparisons)
        || parsed.bindings.length > MAX_ROWS
        || parsed.comparisons.length > MAX_ROWS
      ) throw new Error('rsi_meta_comparison_ledger_state_invalid');
      const clone = structuredClone(parsed);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(parsed.state_digest, 'ledger')) {
        throw new Error('rsi_meta_comparison_ledger_digest_mismatch');
      }
      const bindingIds = new Set();
      const comparisonIds = new Set();
      for (const binding of parsed.bindings) {
        assertZeroAuthority(binding, 'persisted_binding');
        if (binding.source_sha !== this.#sourceSha) throw new Error('rsi_meta_comparison_ledger_binding_source_mismatch');
        if (bindingIds.has(binding.binding_id)) throw new Error('rsi_meta_comparison_ledger_binding_duplicate');
        bindingIds.add(binding.binding_id);
        const row = structuredClone(binding);
        delete row.binding_digest;
        if (digest(row) !== exactDigest(binding.binding_digest, 'binding')) {
          throw new Error('rsi_meta_comparison_ledger_binding_digest_mismatch');
        }
      }
      for (const comparison of parsed.comparisons) {
        assertZeroAuthority(comparison, 'persisted_comparison');
        if (comparison.source_sha !== this.#sourceSha) throw new Error('rsi_meta_comparison_ledger_comparison_source_mismatch');
        if (comparisonIds.has(comparison.comparison_id)) throw new Error('rsi_meta_comparison_ledger_comparison_duplicate');
        if (!parsed.bindings.some((binding) => binding.binding_digest === comparison.binding_digest)) {
          throw new Error('rsi_meta_comparison_ledger_orphan_comparison');
        }
        comparisonIds.add(comparison.comparison_id);
        const row = structuredClone(comparison);
        delete row.comparison_digest;
        if (digest(row) !== exactDigest(comparison.comparison_digest, 'comparison')) {
          throw new Error('rsi_meta_comparison_ledger_comparison_digest_mismatch');
        }
      }
      this.#bindings = parsed.bindings;
      this.#comparisons = parsed.comparisons;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = ledgerState(this.#sourceSha, this.#bindings, this.#comparisons);
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

  async addBinding(binding) {
    if (!this.#initialized) throw new Error('rsi_meta_comparison_ledger_not_initialized');
    if (!plainObject(binding) || binding.schema !== RSI_META_PROFILE_SHADOW_BINDING_SCHEMA) {
      throw new Error('rsi_meta_comparison_binding_invalid');
    }
    assertZeroAuthority(binding, 'binding');
    if (binding.source_sha !== this.#sourceSha) throw new Error('rsi_meta_comparison_binding_source_mismatch');
    const row = structuredClone(binding);
    delete row.binding_digest;
    if (digest(row) !== exactDigest(binding.binding_digest, 'binding')) {
      throw new Error('rsi_meta_comparison_binding_digest_mismatch');
    }
    const existing = this.#bindings.find((entry) => entry.binding_id === binding.binding_id);
    if (existing) {
      if (existing.binding_digest !== binding.binding_digest) throw new Error('rsi_meta_comparison_binding_identity_conflict');
      return zeroAuthority({ state: 'IDEMPOTENT', binding_digest: binding.binding_digest });
    }
    if (this.#bindings.length >= MAX_ROWS) throw new Error('rsi_meta_comparison_ledger_capacity_exceeded');
    this.#bindings.push(structuredClone(binding));
    await this.#persist();
    return zeroAuthority({ state: 'SHADOW_BOUND', binding_digest: binding.binding_digest });
  }

  async addComparison(comparison) {
    if (!this.#initialized) throw new Error('rsi_meta_comparison_ledger_not_initialized');
    if (!plainObject(comparison) || comparison.schema !== RSI_META_PROFILE_DUAL_PLAN_COMPARISON_SCHEMA) {
      throw new Error('rsi_meta_comparison_receipt_invalid');
    }
    assertZeroAuthority(comparison, 'comparison');
    if (comparison.source_sha !== this.#sourceSha) throw new Error('rsi_meta_comparison_receipt_source_mismatch');
    if (!this.#bindings.some((binding) => binding.binding_digest === comparison.binding_digest)) {
      throw new Error('rsi_meta_comparison_binding_not_persisted');
    }
    const row = structuredClone(comparison);
    delete row.comparison_digest;
    if (digest(row) !== exactDigest(comparison.comparison_digest, 'comparison')) {
      throw new Error('rsi_meta_comparison_receipt_digest_mismatch');
    }
    const existing = this.#comparisons.find((entry) => entry.comparison_id === comparison.comparison_id);
    if (existing) {
      if (existing.comparison_digest !== comparison.comparison_digest) throw new Error('rsi_meta_comparison_receipt_identity_conflict');
      return zeroAuthority({ state: 'IDEMPOTENT', comparison_digest: comparison.comparison_digest });
    }
    if (this.#comparisons.length >= MAX_ROWS) throw new Error('rsi_meta_comparison_ledger_capacity_exceeded');
    this.#comparisons.push(structuredClone(comparison));
    await this.#persist();
    return zeroAuthority({ state: 'COMPARISON_RECORDED', comparison_digest: comparison.comparison_digest });
  }

  bindingByDigest(bindingDigest) {
    const digestValue = exactDigest(bindingDigest, 'binding');
    const row = this.#bindings.find((entry) => entry.binding_digest === digestValue);
    return row ? Object.freeze(structuredClone(row)) : null;
  }

  comparisons() {
    if (!this.#initialized) throw new Error('rsi_meta_comparison_ledger_not_initialized');
    return Object.freeze(this.#comparisons.map((row) => Object.freeze(structuredClone(row))));
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#bindings, this.#comparisons);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      binding_count: state.binding_count,
      comparison_count: state.comparison_count,
      append_only: true,
      active_profile_digest: null,
      canary_profile_digest: null,
      ledger_can_activate_profile: false,
      authority_effect: false,
    });
  }
}

export function rsiMetaProfileShadowComparisonTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.meta-profile-shadow-comparison-root.v1',
    version: 1,
    phase18_qd_selection_required: true,
    exact_selected_qualification_required: true,
    same_verified_context_required: true,
    external_comparator_root_required: true,
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    champion_is_selected_parent_profile: true,
    challenger_is_selected_successor_profile: true,
    candidate_can_choose_profile: false,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    raw_context_exposed_to_candidate: false,
    plan_execution_allowed: false,
    browser_effects_allowed: false,
    comparison_evidence_append_only: true,
    future_canary_gate_still_required: true,
    canary_activation_authorized: false,
    active_profile_replacement_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, comparison_root_digest: digest(root) });
}
