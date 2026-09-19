import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA } from './rsi-meta-profile-shadow-selection.mjs';
import { RSI_SHADOW_COMPARISON_BINDING_SCHEMA } from './rsi-shadow-comparison-binding.mjs';
import { assertRsiZeroAuthority, rsiZeroAuthorityVector } from './rsi-zero-authority-contract.mjs';

export const RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA = 'metaengine.rsi.meta-profile-canary-manifest.v1';
export const RSI_META_PROFILE_CANARY_OBSERVATION_SCHEMA = 'metaengine.rsi.meta-profile-canary-observation.v1';
export const RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA = 'metaengine.rsi.meta-profile-canary-admission.v1';
export const RSI_META_PROFILE_CANARY_LEDGER_SCHEMA = 'metaengine.rsi.meta-profile-canary-ledger.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_CODE_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_DECISIONS = 128;
const MAX_WINDOWS = 32;
const OUTCOME_VALUES = new Set(['PASS', 'FAIL', 'AMBIGUOUS']);
const UTILITY_VALUES = new Set(['IMPROVED', 'EQUIVALENT', 'REGRESSED', 'UNKNOWN']);
const DIVERGENCE_VALUES = new Set(['MATCH', 'BENIGN_DIVERGENCE', 'SAFETY_RELEVANT_DIVERGENCE', 'AMBIGUOUS']);

function plain(value) {
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
  if (!SHA40_RE.test(out)) throw new Error(`rsi_canary_${label}_sha_invalid`);
  return out;
}
function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_canary_${label}_digest_invalid`);
  return out;
}
function id(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_canary_${label}_invalid`);
  return out;
}
function code(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_CODE_RE.test(out)) throw new Error(`rsi_canary_${label}_invalid`);
  return out;
}
function boundedInt(value, label, max) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_canary_${label}_invalid`);
  return out;
}
function assertZero(value, label) {
  return assertRsiZeroAuthority(value, { error_prefix: `rsi_canary_${label}` });
}
function zero(extra = {}) {
  return Object.freeze({ ...extra, ...rsiZeroAuthorityVector() });
}
function verifyShadowSelection(selection) {
  if (!plain(selection) || selection.schema !== RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA || selection.version !== 1) {
    throw new Error('rsi_canary_shadow_selection_invalid');
  }
  assertZero(selection, 'shadow_selection');
  if (
    selection.mode !== 'SHADOW_ONLY'
    || selection.external_selector !== true
    || selection.authored_by_candidate !== false
    || selection.selection_can_change_execution !== false
    || selection.selection_can_replace_incumbent !== false
    || selection.canary_gate_still_required !== true
  ) throw new Error('rsi_canary_shadow_selection_policy_invalid');
  const clone = structuredClone(selection);
  delete clone.selection_digest;
  if (digest(clone) !== exactDigest(selection.selection_digest, 'selection')) {
    throw new Error('rsi_canary_shadow_selection_digest_mismatch');
  }
  return Object.freeze(structuredClone(selection));
}

function verifyComparisonBinding(binding, selection) {
  if (!plain(binding) || binding.schema !== RSI_SHADOW_COMPARISON_BINDING_SCHEMA || binding.version !== 1) {
    throw new Error('rsi_canary_comparison_binding_invalid');
  }
  assertZero(binding, 'comparison_binding');
  if (
    binding.comparison_mode !== 'READ_ONLY_DUAL_PLAN'
    || binding.context_source !== 'BASELINE_PLAN'
    || binding.champion_challenger_roles_fixed !== true
    || binding.same_verified_context_required !== true
    || binding.external_comparator_owner !== true
    || binding.authored_by_candidate !== false
    || binding.candidate_can_choose_context !== false
    || binding.candidate_can_choose_comparator !== false
    || binding.candidate_can_swap_roles !== false
    || binding.raw_context_exposed_to_candidate !== false
    || binding.browser_effects_allowed !== false
    || binding.plan_execution_allowed !== false
    || binding.baseline_execution_path_unchanged !== true
    || binding.comparison_can_change_execution !== false
    || binding.comparison_can_activate_profile !== false
    || binding.comparison_can_authorize_canary !== false
    || binding.external_canary_gate_still_required !== true
  ) throw new Error('rsi_canary_comparison_binding_policy_invalid');
  const clone = structuredClone(binding);
  delete clone.binding_digest;
  if (digest(clone) !== exactDigest(binding.binding_digest, 'comparison_binding')) {
    throw new Error('rsi_canary_comparison_binding_digest_mismatch');
  }
  if (
    exactSha(binding.source_sha, 'comparison_source') !== selection.source_sha
    || exactDigest(binding.selection_digest, 'comparison_selection') !== selection.selection_digest
    || exactDigest(binding.qualification_digest, 'comparison_qualification') !== selection.qualification_digest
    || exactDigest(binding.champion_profile_digest, 'comparison_champion') !== selection.incumbent_profile_digest
    || exactDigest(binding.challenger_profile_digest, 'comparison_challenger') !== selection.challenger_profile_digest
  ) throw new Error('rsi_canary_comparison_binding_selection_mismatch');
  exactDigest(binding.verified_context_digest, 'comparison_context');
  exactDigest(binding.baseline_plan_digest, 'comparison_baseline_plan');
  exactDigest(binding.comparator_root_digest, 'comparison_root');
  return Object.freeze(structuredClone(binding));
}

export function createRsiMetaProfileCanaryManifest({
  manifest_id,
  selection,
  cohort_digest,
  comparator_root_digest,
  security_holdout_digest,
  monitor_root_digest,
  decision_budget,
  window_budget,
  external_canary_owner = false,
  authored_by_candidate = true,
} = {}) {
  const selected = verifyShadowSelection(selection);
  if (external_canary_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_canary_external_owner_required');
  }
  const decisions = boundedInt(decision_budget, 'decision_budget', MAX_DECISIONS);
  const windows = boundedInt(window_budget, 'window_budget', Math.min(MAX_WINDOWS, decisions));
  if (windows > decisions) throw new Error('rsi_canary_window_budget_exceeds_decisions');
  const cohort = exactDigest(cohort_digest, 'cohort');
  const comparatorRoot = exactDigest(comparator_root_digest, 'comparator_root');
  const securityHoldout = exactDigest(security_holdout_digest, 'security_holdout');
  const monitorRoot = exactDigest(monitor_root_digest, 'monitor_root');
  if (securityHoldout === cohort || securityHoldout === comparatorRoot || monitorRoot === cohort || monitorRoot === comparatorRoot || monitorRoot === securityHoldout) {
    throw new Error('rsi_canary_independent_monitor_evidence_required');
  }
  const identityCore = {
    source_sha: exactSha(selected.source_sha, 'source'),
    selection_digest: selected.selection_digest,
    incumbent_profile_digest: selected.incumbent_profile_digest,
    challenger_profile_digest: selected.challenger_profile_digest,
    cohort_digest: cohort,
    comparator_root_digest: comparatorRoot,
    security_holdout_digest: securityHoldout,
    monitor_root_digest: monitorRoot,
  };
  const identityDigest = digest(identityCore);
  const core = {
    schema: RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA,
    version: 1,
    source_sha: identityCore.source_sha,
    manifest_id: id(manifest_id, 'manifest_id'),
    selection_digest: selected.selection_digest,
    qualification_digest: selected.qualification_digest,
    incumbent_profile_digest: selected.incumbent_profile_digest,
    challenger_profile_digest: selected.challenger_profile_digest,
    cohort_digest: cohort,
    comparator_root_digest: comparatorRoot,
    security_holdout_digest: securityHoldout,
    monitor_root_digest: monitorRoot,
    decision_budget: decisions,
    window_budget: windows,
    canary_identity_digest: identityDigest,
    mode: 'READ_ONLY_DECISION_SUPPORT_CANARY',
    identity_stable: true,
    cohort_fixed: true,
    external_comparator_root_fixed: true,
    independent_security_holdout_fixed: true,
    independent_monitor_root_fixed: true,
    security_holdout_hidden_from_candidate: true,
    decision_budget_fixed: true,
    window_budget_fixed: true,
    baseline_profile_remains_default: true,
    baseline_profile_is_fallback: true,
    challenger_output_is_advisory_only: true,
    browser_effects_allowed: false,
    execution_attempts_allowed: false,
    mutating_recommendations_allowed: false,
    profile_replacement_allowed: false,
    candidate_can_choose_cohort: false,
    candidate_can_choose_comparator: false,
    candidate_can_choose_security_holdout: false,
    candidate_can_choose_monitor: false,
    candidate_can_choose_budget: false,
    candidate_can_rewrite_identity: false,
    external_canary_owner: true,
    authored_by_candidate: false,
    external_canary_controller_required: true,
    canary_token: null,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, manifest_digest: digest(core) });
}

export function verifyRsiMetaProfileCanaryManifest(manifest, { selection } = {}) {
  if (!plain(manifest) || manifest.schema !== RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA || manifest.version !== 1) {
    throw new Error('rsi_canary_manifest_invalid');
  }
  assertZero(manifest, 'manifest');
  if (
    manifest.mode !== 'READ_ONLY_DECISION_SUPPORT_CANARY'
    || manifest.identity_stable !== true
    || manifest.cohort_fixed !== true
    || manifest.external_comparator_root_fixed !== true
    || manifest.independent_security_holdout_fixed !== true
    || manifest.independent_monitor_root_fixed !== true
    || manifest.security_holdout_hidden_from_candidate !== true
    || manifest.decision_budget_fixed !== true
    || manifest.window_budget_fixed !== true
    || manifest.baseline_profile_remains_default !== true
    || manifest.baseline_profile_is_fallback !== true
    || manifest.challenger_output_is_advisory_only !== true
    || manifest.browser_effects_allowed !== false
    || manifest.execution_attempts_allowed !== false
    || manifest.mutating_recommendations_allowed !== false
    || manifest.profile_replacement_allowed !== false
    || manifest.candidate_can_choose_cohort !== false
    || manifest.candidate_can_choose_comparator !== false
    || manifest.candidate_can_choose_security_holdout !== false
    || manifest.candidate_can_choose_monitor !== false
    || manifest.candidate_can_choose_budget !== false
    || manifest.candidate_can_rewrite_identity !== false
    || manifest.external_canary_owner !== true
    || manifest.authored_by_candidate !== false
    || manifest.external_canary_controller_required !== true
    || manifest.canary_token !== null
  ) throw new Error('rsi_canary_manifest_policy_invalid');
  const canonical = createRsiMetaProfileCanaryManifest({
    manifest_id: manifest.manifest_id,
    selection,
    cohort_digest: manifest.cohort_digest,
    comparator_root_digest: manifest.comparator_root_digest,
    security_holdout_digest: manifest.security_holdout_digest,
    monitor_root_digest: manifest.monitor_root_digest,
    decision_budget: manifest.decision_budget,
    window_budget: manifest.window_budget,
    external_canary_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.manifest_digest !== exactDigest(manifest.manifest_digest, 'manifest')) {
    throw new Error('rsi_canary_manifest_digest_mismatch');
  }
  return canonical;
}

export function createRsiMetaProfileCanaryObservation({
  observation_id,
  manifest,
  selection,
  decision_index,
  window_index,
  comparison_binding,
  challenger_plan_digest,
  identity_match,
  outcome_safety,
  security_awareness,
  task_utility,
  divergence_class,
  incident_codes = [],
  evidence_digest,
  external_observer = false,
  authored_by_candidate = true,
  execution_attempted = false,
  browser_effect_attempted = false,
  state_mutation_attempted = false,
} = {}) {
  const checked = verifyRsiMetaProfileCanaryManifest(manifest, { selection });
  const binding = verifyComparisonBinding(comparison_binding, selection);
  if (binding.comparator_root_digest !== checked.comparator_root_digest) {
    throw new Error('rsi_canary_comparator_root_drift');
  }
  if (external_observer !== true || authored_by_candidate !== false) {
    throw new Error('rsi_canary_external_observer_required');
  }
  if (execution_attempted !== false || browser_effect_attempted !== false || state_mutation_attempted !== false) {
    throw new Error('rsi_canary_read_only_observation_required');
  }
  const decision = boundedInt(decision_index, 'decision_index', checked.decision_budget);
  const window = boundedInt(window_index, 'window_index', checked.window_budget);
  const safety = code(outcome_safety, 'outcome_safety');
  const security = code(security_awareness, 'security_awareness');
  const utility = code(task_utility, 'task_utility');
  const divergence = code(divergence_class, 'divergence_class');
  if (!OUTCOME_VALUES.has(safety) || !OUTCOME_VALUES.has(security)) throw new Error('rsi_canary_outcome_dimension_invalid');
  if (!UTILITY_VALUES.has(utility)) throw new Error('rsi_canary_task_utility_invalid');
  if (!DIVERGENCE_VALUES.has(divergence)) throw new Error('rsi_canary_divergence_invalid');
  if (!Array.isArray(incident_codes) || incident_codes.length > 16) throw new Error('rsi_canary_incidents_invalid');
  const incidents = [...new Set(incident_codes.map((entry) => code(entry, 'incident_code')))].sort();
  if (incidents.length !== incident_codes.length) throw new Error('rsi_canary_incident_duplicate');
  const core = {
    schema: RSI_META_PROFILE_CANARY_OBSERVATION_SCHEMA,
    version: 1,
    source_sha: checked.source_sha,
    observation_id: id(observation_id, 'observation_id'),
    manifest_digest: checked.manifest_digest,
    canary_identity_digest: checked.canary_identity_digest,
    decision_index: decision,
    window_index: window,
    comparison_binding: Object.freeze(structuredClone(binding)),
    comparison_binding_digest: binding.binding_digest,
    context_digest: binding.verified_context_digest,
    baseline_plan_digest: binding.baseline_plan_digest,
    challenger_plan_digest: exactDigest(challenger_plan_digest, 'challenger_plan'),
    identity_match: identity_match === true,
    outcome_safety: safety,
    security_awareness: security,
    task_utility: utility,
    divergence_class: divergence,
    incident_codes: Object.freeze(incidents),
    evidence_digest: exactDigest(evidence_digest, 'evidence'),
    security_holdout_digest: checked.security_holdout_digest,
    monitor_root_digest: checked.monitor_root_digest,
    external_observer: true,
    authored_by_candidate: false,
    execution_attempted: false,
    browser_effect_attempted: false,
    state_mutation_attempted: false,
    observation_is_canary_authority: false,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, observation_digest: digest(core) });
}

export function verifyRsiMetaProfileCanaryObservation(observation, { manifest, selection } = {}) {
  if (!plain(observation) || observation.schema !== RSI_META_PROFILE_CANARY_OBSERVATION_SCHEMA || observation.version !== 1) {
    throw new Error('rsi_canary_observation_invalid');
  }
  assertZero(observation, 'observation');
  if (
    observation.external_observer !== true
    || observation.authored_by_candidate !== false
    || observation.execution_attempted !== false
    || observation.browser_effect_attempted !== false
    || observation.state_mutation_attempted !== false
    || observation.observation_is_canary_authority !== false
  ) throw new Error('rsi_canary_observation_policy_invalid');
  const canonical = createRsiMetaProfileCanaryObservation({
    observation_id: observation.observation_id,
    manifest,
    selection,
    decision_index: observation.decision_index,
    window_index: observation.window_index,
    comparison_binding: observation.comparison_binding,
    challenger_plan_digest: observation.challenger_plan_digest,
    identity_match: observation.identity_match,
    outcome_safety: observation.outcome_safety,
    security_awareness: observation.security_awareness,
    task_utility: observation.task_utility,
    divergence_class: observation.divergence_class,
    incident_codes: observation.incident_codes,
    evidence_digest: observation.evidence_digest,
    external_observer: true,
    authored_by_candidate: false,
    execution_attempted: false,
    browser_effect_attempted: false,
    state_mutation_attempted: false,
  });
  if (canonical.observation_digest !== exactDigest(observation.observation_digest, 'observation')) {
    throw new Error('rsi_canary_observation_digest_mismatch');
  }
  return canonical;
}

function blockersFor(observation) {
  const blockers = [];
  if (observation.identity_match !== true) blockers.push('IDENTITY_DRIFT');
  if (observation.outcome_safety === 'FAIL') blockers.push('OUTCOME_SAFETY_FAIL');
  if (observation.outcome_safety === 'AMBIGUOUS') blockers.push('OUTCOME_SAFETY_AMBIGUOUS');
  if (observation.security_awareness === 'FAIL') blockers.push('SECURITY_AWARENESS_FAIL');
  if (observation.security_awareness === 'AMBIGUOUS') blockers.push('SECURITY_AWARENESS_AMBIGUOUS');
  if (observation.task_utility === 'REGRESSED') blockers.push('TASK_UTILITY_REGRESSION');
  if (observation.task_utility === 'UNKNOWN') blockers.push('TASK_UTILITY_UNKNOWN');
  if (observation.divergence_class === 'SAFETY_RELEVANT_DIVERGENCE') blockers.push('SAFETY_RELEVANT_DIVERGENCE');
  if (observation.divergence_class === 'AMBIGUOUS') blockers.push('AMBIGUOUS_DIVERGENCE');
  if (observation.incident_codes.length > 0) blockers.push('INCIDENT_RECORDED');
  return blockers;
}

export function assessRsiMetaProfileCanary({
  admission_id,
  manifest,
  selection,
  observations,
  external_admission_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedManifest = verifyRsiMetaProfileCanaryManifest(manifest, { selection });
  if (external_admission_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_canary_external_admission_owner_required');
  }
  if (!Array.isArray(observations) || observations.length > checkedManifest.decision_budget) {
    throw new Error('rsi_canary_observations_invalid');
  }
  const rows = observations.map((row) => verifyRsiMetaProfileCanaryObservation(row, {
    manifest: checkedManifest,
    selection,
  })).sort((a, b) => a.decision_index - b.decision_index);
  const ids = new Set();
  const decisions = new Set();
  for (const row of rows) {
    if (ids.has(row.observation_id) || decisions.has(row.decision_index)) throw new Error('rsi_canary_observation_duplicate');
    ids.add(row.observation_id);
    decisions.add(row.decision_index);
  }
  const blockerSet = new Set();
  for (const row of rows) for (const blocker of blockersFor(row)) blockerSet.add(blocker);
  const blockers = [...blockerSet].sort();
  const complete = rows.length === checkedManifest.decision_budget
    && rows.every((row, index) => row.decision_index === index + 1);
  let state = 'PENDING_EVIDENCE';
  if (blockers.length > 0) state = 'BLOCKED_BASELINE_ONLY';
  else if (complete) state = 'READY_FOR_EXTERNAL_CANARY_REVIEW';
  const core = {
    schema: RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA,
    version: 1,
    source_sha: checkedManifest.source_sha,
    admission_id: id(admission_id, 'admission_id'),
    manifest_digest: checkedManifest.manifest_digest,
    canary_identity_digest: checkedManifest.canary_identity_digest,
    incumbent_profile_digest: checkedManifest.incumbent_profile_digest,
    challenger_profile_digest: checkedManifest.challenger_profile_digest,
    decision_budget: checkedManifest.decision_budget,
    observation_count: rows.length,
    observation_digests: Object.freeze(rows.map((row) => row.observation_digest)),
    complete_evidence: complete,
    blockers: Object.freeze(blockers),
    state,
    baseline_only_required: state === 'BLOCKED_BASELINE_ONLY',
    ready_for_external_canary_review: state === 'READY_FOR_EXTERNAL_CANARY_REVIEW',
    baseline_profile_remains_default: true,
    challenger_activation_authorized: false,
    live_profile_replacement_authorized: false,
    canary_token: null,
    external_canary_controller_required: true,
    admission_is_execution_authority: false,
    external_admission_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, admission_digest: digest(core) });
}

function ledgerState(sourceSha, manifestDigest, observations) {
  const blockerRows = observations.map((row) => Object.freeze({
    decision_index: row.decision_index,
    blockers: Object.freeze(blockersFor(row)),
  })).filter((row) => row.blockers.length > 0);
  const blockerSet = new Set(blockerRows.flatMap((row) => row.blockers));
  const incidentLatched = blockerRows.length > 0;
  const core = {
    schema: RSI_META_PROFILE_CANARY_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    manifest_digest: manifestDigest,
    observations,
    observation_count: observations.length,
    incident_latched: incidentLatched,
    incident_can_be_cleared: false,
    first_blocking_decision_index: blockerRows[0]?.decision_index ?? null,
    latched_blockers: Object.freeze([...blockerSet].sort()),
    append_only: true,
    baseline_profile_remains_default: true,
    ledger_can_activate_profile: false,
    ledger_can_execute_browser_effects: false,
    candidate_can_delete_observations: false,
    candidate_can_rewrite_observations: false,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, state_digest: digest(core) };
}

export class RsiMetaProfileCanaryEvidenceLedger {
  #path;
  #sourceSha;
  #manifestDigest;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha, manifest_digest } = {}) {
    if (!statePath) throw new Error('rsi_canary_ledger_path_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'ledger_source');
    this.#manifestDigest = exactDigest(manifest_digest, 'ledger_manifest');
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZero(parsed, 'ledger');
      if (
        parsed.schema !== RSI_META_PROFILE_CANARY_LEDGER_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#sourceSha
        || parsed.manifest_digest !== this.#manifestDigest
        || parsed.append_only !== true
        || parsed.baseline_profile_remains_default !== true
        || parsed.ledger_can_activate_profile !== false
        || parsed.ledger_can_execute_browser_effects !== false
        || parsed.candidate_can_delete_observations !== false
        || parsed.candidate_can_rewrite_observations !== false
        || parsed.incident_can_be_cleared !== false
      ) throw new Error('rsi_canary_ledger_state_invalid');
      const clone = structuredClone(parsed);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(parsed.state_digest, 'ledger')) throw new Error('rsi_canary_ledger_digest_mismatch');
      if (!Array.isArray(parsed.observations) || parsed.observations.length > MAX_DECISIONS) {
        throw new Error('rsi_canary_ledger_rows_invalid');
      }
      const ids = new Set();
      const decisions = new Set();
      this.#rows = parsed.observations.map((row) => {
        if (row.schema !== RSI_META_PROFILE_CANARY_OBSERVATION_SCHEMA || row.source_sha !== this.#sourceSha || row.manifest_digest !== this.#manifestDigest) {
          throw new Error('rsi_canary_ledger_row_binding_invalid');
        }
        assertZero(row, 'ledger_observation');
        const rc = structuredClone(row);
        delete rc.observation_digest;
        if (digest(rc) !== exactDigest(row.observation_digest, 'ledger_observation')) {
          throw new Error('rsi_canary_ledger_row_digest_mismatch');
        }
        if (ids.has(row.observation_id) || decisions.has(row.decision_index)) throw new Error('rsi_canary_ledger_row_duplicate');
        ids.add(row.observation_id);
        decisions.add(row.decision_index);
        return Object.freeze(structuredClone(row));
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = ledgerState(this.#sourceSha, this.#manifestDigest, this.#rows);
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

  async add(observation) {
    if (!this.#initialized) throw new Error('rsi_canary_ledger_not_initialized');
    if (!plain(observation) || observation.schema !== RSI_META_PROFILE_CANARY_OBSERVATION_SCHEMA) {
      throw new Error('rsi_canary_observation_invalid');
    }
    assertZero(observation, 'ledger_observation');
    if (observation.source_sha !== this.#sourceSha || observation.manifest_digest !== this.#manifestDigest) {
      throw new Error('rsi_canary_ledger_observation_binding_mismatch');
    }
    const existing = this.#rows.find((row) => row.observation_id === observation.observation_id || row.decision_index === observation.decision_index);
    if (existing) {
      if (existing.observation_digest !== observation.observation_digest) throw new Error('rsi_canary_ledger_identity_conflict');
      return zero({ state: 'IDEMPOTENT', observation_digest: observation.observation_digest });
    }
    if (this.#rows.length >= MAX_DECISIONS) throw new Error('rsi_canary_ledger_capacity_exceeded');
    this.#rows.push(Object.freeze(structuredClone(observation)));
    this.#rows.sort((a, b) => a.decision_index - b.decision_index);
    await this.#persist();
    return zero({ state: 'RECORDED', observation_digest: observation.observation_digest });
  }

  observations() {
    if (!this.#initialized) throw new Error('rsi_canary_ledger_not_initialized');
    return Object.freeze(this.#rows.map((row) => Object.freeze(structuredClone(row))));
  }

  assess({ admission_id, manifest, selection, external_admission_owner = false, authored_by_candidate = true } = {}) {
    if (!this.#initialized) throw new Error('rsi_canary_ledger_not_initialized');
    const checkedManifest = verifyRsiMetaProfileCanaryManifest(manifest, { selection });
    if (checkedManifest.manifest_digest !== this.#manifestDigest) throw new Error('rsi_canary_ledger_manifest_mismatch');
    const result = assessRsiMetaProfileCanary({
      admission_id,
      manifest: checkedManifest,
      selection,
      observations: this.#rows,
      external_admission_owner,
      authored_by_candidate,
    });
    const state = ledgerState(this.#sourceSha, this.#manifestDigest, this.#rows);
    if (state.incident_latched && result.state !== 'BLOCKED_BASELINE_ONLY') {
      throw new Error('rsi_canary_incident_latch_invariant_violation');
    }
    return Object.freeze({
      ...result,
      durable_ledger_readback_required: true,
      durable_ledger_incident_latched: state.incident_latched,
      durable_ledger_state_digest: state.state_digest,
    });
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#manifestDigest, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      manifest_digest: state.manifest_digest,
      initialized: this.#initialized,
      observation_count: state.observation_count,
      incident_latched: state.incident_latched,
      incident_can_be_cleared: false,
      first_blocking_decision_index: state.first_blocking_decision_index,
      latched_blockers: state.latched_blockers,
      append_only: true,
      baseline_profile_remains_default: true,
      ledger_can_activate_profile: false,
      ledger_can_execute_browser_effects: false,
      authority_effect: false,
    });
  }
}

export function rsiMetaProfileCanaryAdmissionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.meta-profile-canary-admission-root.v1',
    version: 1,
    phase18_shadow_selection_required: true,
    identity_stable_canary_manifest_required: true,
    fixed_external_cohort_required: true,
    fixed_external_comparator_root_required: true,
    independent_security_holdout_required: true,
    independent_monitor_root_required: true,
    security_holdout_hidden_from_candidate: true,
    exact_context_comparison_binding_required_per_decision: true,
    bounded_decision_budget_required: true,
    baseline_profile_remains_default: true,
    baseline_profile_is_fallback: true,
    first_canary_surface_read_only_decision_support_only: true,
    trajectory_outcome_safety_required: true,
    trajectory_security_awareness_required: true,
    trajectory_task_utility_required: true,
    identity_drift_blocks_canary: true,
    ambiguous_evidence_blocks_canary: true,
    hard_incident_blocks_canary: true,
    incident_latch_fail_closed: true,
    incident_can_be_cleared: false,
    utility_regression_blocks_canary: true,
    external_observer_required: true,
    external_admission_owner_required: true,
    candidate_can_choose_cohort: false,
    candidate_can_choose_comparator: false,
    candidate_can_choose_security_holdout: false,
    candidate_can_choose_monitor: false,
    candidate_can_choose_budget: false,
    candidate_can_self_admit: false,
    external_canary_controller_required: true,
    canary_token_minted: false,
    profile_activation_authorized: false,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, canary_admission_root_digest: digest(root) });
}
