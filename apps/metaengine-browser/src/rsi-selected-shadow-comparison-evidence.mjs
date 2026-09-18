import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiSelectedShadowContextBinding } from './rsi-selected-shadow-context-binding.mjs';

export const RSI_SELECTED_SHADOW_COMPARISON_OBSERVATION_SCHEMA = 'metaengine.rsi.selected-shadow-comparison-observation.v1';
export const RSI_SELECTED_SHADOW_COMPARISON_LEDGER_SCHEMA = 'metaengine.rsi.selected-shadow-comparison-ledger.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_CODE_RE = /^[A-Z0-9][A-Z0-9_.:-]{1,95}$/;
const MAX_ROWS = 4096;
const MAX_EVIDENCE_REFS = 32;
const MAX_INCIDENT_CODES = 32;
const MIN_EVIDENCE_FLOOR = 8;

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
  if (!SHA40_RE.test(out)) throw new Error(`rsi_shadow_compare_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_shadow_compare_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_shadow_compare_${label}_invalid`);
  return out;
}

function safeCode(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_CODE_RE.test(out)) throw new Error(`rsi_shadow_compare_${label}_invalid`);
  return out;
}

function finiteRange(value, label, min, max) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < min || out > max) {
    throw new Error(`rsi_shadow_compare_${label}_invalid`);
  }
  return out;
}

function nonnegativeInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new Error(`rsi_shadow_compare_${label}_invalid`);
  return out;
}

function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`rsi_shadow_compare_${label}_invalid`);
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
    if (value?.[field] !== false) throw new Error(`rsi_shadow_compare_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_shadow_compare_${label}_retry_invalid`);
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

function metricVector(value, label) {
  if (!plain(value)) throw new Error(`rsi_shadow_compare_${label}_metrics_invalid`);
  const expected = ['latency_ms', 'outcome_safety', 'security_awareness', 'task_utility', 'token_count'];
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`rsi_shadow_compare_${label}_metrics_shape_invalid`);
  }
  return Object.freeze({
    latency_ms: finiteRange(value.latency_ms, `${label}_latency_ms`, 0, 24 * 60 * 60 * 1000),
    outcome_safety: finiteRange(value.outcome_safety, `${label}_outcome_safety`, 0, 1),
    security_awareness: finiteRange(value.security_awareness, `${label}_security_awareness`, 0, 1),
    task_utility: finiteRange(value.task_utility, `${label}_task_utility`, 0, 1),
    token_count: nonnegativeInt(value.token_count, `${label}_token_count`),
  });
}

function codeList(value, label, { allowEmpty = true, max = MAX_INCIDENT_CODES } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > max) {
    throw new Error(`rsi_shadow_compare_${label}_invalid`);
  }
  const out = [...new Set(value.map((entry) => safeCode(entry, label)))].sort();
  if (out.length !== value.length) throw new Error(`rsi_shadow_compare_${label}_duplicate`);
  return Object.freeze(out);
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) {
    throw new Error('rsi_shadow_compare_evidence_refs_invalid');
  }
  const refs = [...new Set(value.map((entry) => boundedId(entry, 'evidence_ref')))].sort();
  if (refs.length !== value.length) throw new Error('rsi_shadow_compare_evidence_ref_duplicate');
  return Object.freeze(refs);
}

function signedGain(champion, challenger) {
  const gains = Object.freeze({
    outcome_safety: challenger.outcome_safety - champion.outcome_safety,
    security_awareness: challenger.security_awareness - champion.security_awareness,
    task_utility: challenger.task_utility - champion.task_utility,
    latency_efficiency: champion.latency_ms - challenger.latency_ms,
    token_efficiency: champion.token_count - challenger.token_count,
  });
  const values = Object.values(gains);
  const anyGain = values.some((value) => value > 0);
  const anyRegression = values.some((value) => value < 0);
  const relation = anyGain && !anyRegression
    ? 'VECTOR_PARETO_ADVANCE'
    : anyGain && anyRegression
      ? 'VECTOR_TRADEOFF'
      : !anyGain && anyRegression
        ? 'VECTOR_DOMINATED_REGRESSION'
        : 'VECTOR_MATCH';
  return Object.freeze({ gains, anyGain, anyRegression, relation });
}

function incidentCodes({
  challenger_hard_invariants_pass,
  comparator_integrity_pass,
  identity_stable,
  from_scratch_replay_pass,
  ambiguous_evidence,
  challenger_incident_codes,
}) {
  const codes = [...challenger_incident_codes];
  if (challenger_hard_invariants_pass !== true) codes.push('HARD_INVARIANT_FAILURE');
  if (comparator_integrity_pass !== true) codes.push('COMPARATOR_INTEGRITY_FAILURE');
  if (identity_stable !== true) codes.push('CANDIDATE_IDENTITY_DRIFT');
  if (from_scratch_replay_pass !== true) codes.push('FROM_SCRATCH_REPLAY_FAILURE');
  if (ambiguous_evidence === true) codes.push('AMBIGUOUS_EVIDENCE');
  return Object.freeze([...new Set(codes)].sort());
}

export function createRsiSelectedShadowComparisonObservation({
  observation_id,
  observation_index,
  binding,
  selection,
  simulation_environment_digest,
  evaluator_manifest_digest,
  champion_plan_digest,
  challenger_plan_digest,
  champion_trajectory_digest,
  challenger_trajectory_digest,
  champion_metrics,
  challenger_metrics,
  champion_hard_invariants_pass,
  challenger_hard_invariants_pass,
  champion_incident_codes = [],
  challenger_incident_codes = [],
  comparator_integrity_pass,
  identity_stable,
  from_scratch_replay_pass,
  ambiguous_evidence = false,
  evidence_digest,
  evidence_refs: refs,
  counterfactual_simulation = false,
  browser_effects_performed = true,
  live_plan_execution_performed = true,
  external_comparator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedBinding = verifyRsiSelectedShadowContextBinding(binding, selection);
  if (external_comparator !== true || authored_by_candidate !== false) {
    throw new Error('rsi_shadow_compare_external_comparator_required');
  }
  if (
    counterfactual_simulation !== true
    || browser_effects_performed !== false
    || live_plan_execution_performed !== false
  ) {
    throw new Error('rsi_shadow_compare_counterfactual_only_required');
  }

  const champion = metricVector(champion_metrics, 'champion');
  const challenger = metricVector(challenger_metrics, 'challenger');
  const championIncidents = codeList(champion_incident_codes, 'champion_incident_codes');
  const challengerIncidents = codeList(challenger_incident_codes, 'challenger_incident_codes');
  const vector = signedGain(champion, challenger);
  const incidents = incidentCodes({
    challenger_hard_invariants_pass,
    comparator_integrity_pass,
    identity_stable,
    from_scratch_replay_pass,
    ambiguous_evidence,
    challenger_incident_codes: challengerIncidents,
  });
  const baselineInvalid = champion_hard_invariants_pass !== true || championIncidents.length > 0;

  const core = {
    schema: RSI_SELECTED_SHADOW_COMPARISON_OBSERVATION_SCHEMA,
    version: 1,
    source_sha: exactSha(checkedBinding.source_sha, 'source'),
    observation_id: boundedId(observation_id, 'observation_id'),
    observation_index: positiveInt(observation_index, 'observation_index'),
    binding_digest: exactDigest(checkedBinding.binding_digest, 'binding'),
    selection_digest: exactDigest(checkedBinding.selection_digest, 'selection'),
    selected_qualification_digest: exactDigest(checkedBinding.selected_qualification_digest, 'qualification'),
    champion_profile_digest: exactDigest(checkedBinding.champion_profile_digest, 'champion_profile'),
    challenger_profile_digest: exactDigest(checkedBinding.challenger_profile_digest, 'challenger_profile'),
    verified_context_digest: exactDigest(checkedBinding.verified_context_digest, 'context'),
    comparator_root_digest: exactDigest(checkedBinding.comparator_root_digest, 'comparator_root'),
    simulation_environment_digest: exactDigest(simulation_environment_digest, 'simulation_environment'),
    evaluator_manifest_digest: exactDigest(evaluator_manifest_digest, 'evaluator_manifest'),
    champion_plan_digest: exactDigest(champion_plan_digest, 'champion_plan'),
    challenger_plan_digest: exactDigest(challenger_plan_digest, 'challenger_plan'),
    champion_trajectory_digest: exactDigest(champion_trajectory_digest, 'champion_trajectory'),
    challenger_trajectory_digest: exactDigest(challenger_trajectory_digest, 'challenger_trajectory'),
    champion_metrics: champion,
    challenger_metrics: challenger,
    signed_challenger_gain: vector.gains,
    vector_relation: vector.relation,
    has_any_gain: vector.anyGain,
    has_any_regression: vector.anyRegression,
    champion_hard_invariants_pass: champion_hard_invariants_pass === true,
    challenger_hard_invariants_pass: challenger_hard_invariants_pass === true,
    champion_incident_codes: championIncidents,
    challenger_incident_codes: challengerIncidents,
    baseline_invalid: baselineInvalid,
    comparator_integrity_pass: comparator_integrity_pass === true,
    identity_stable: identity_stable === true,
    from_scratch_replay_pass: from_scratch_replay_pass === true,
    ambiguous_evidence: ambiguous_evidence === true,
    incident: incidents.length > 0,
    incident_codes: incidents,
    plan_diverged: exactDigest(champion_plan_digest, 'champion_plan') !== exactDigest(challenger_plan_digest, 'challenger_plan'),
    trajectory_diverged: exactDigest(champion_trajectory_digest, 'champion_trajectory') !== exactDigest(challenger_trajectory_digest, 'challenger_trajectory'),
    evidence_digest: exactDigest(evidence_digest, 'evidence'),
    evidence_refs: evidenceRefs(refs),
    evaluation_dimensions: Object.freeze([
      'OUTCOME_SAFETY',
      'SECURITY_AWARENESS',
      'TASK_UTILITY',
      'LATENCY_EFFICIENCY',
      'TOKEN_EFFICIENCY',
    ]),
    scalar_winner: null,
    same_verified_context_required: true,
    counterfactual_simulation: true,
    browser_effects_performed: false,
    live_plan_execution_performed: false,
    champion_remains_execution_baseline: true,
    observation_is_canary_admission: false,
    canary_review_authorized: false,
    canary_activation_authorized: false,
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
  return Object.freeze({ ...core, observation_digest: digest(core) });
}

export function verifyRsiSelectedShadowComparisonObservation(observation, { binding, selection } = {}) {
  if (
    !plain(observation)
    || observation.schema !== RSI_SELECTED_SHADOW_COMPARISON_OBSERVATION_SCHEMA
    || observation.version !== 1
  ) {
    throw new Error('rsi_shadow_compare_observation_invalid');
  }
  assertZeroAuthority(observation, 'observation');
  if (
    observation.scalar_winner !== null
    || observation.same_verified_context_required !== true
    || observation.counterfactual_simulation !== true
    || observation.browser_effects_performed !== false
    || observation.live_plan_execution_performed !== false
    || observation.champion_remains_execution_baseline !== true
    || observation.observation_is_canary_admission !== false
    || observation.canary_review_authorized !== false
    || observation.canary_activation_authorized !== false
    || observation.profile_replacement_authorized !== false
    || observation.external_comparator !== true
    || observation.authored_by_candidate !== false
  ) {
    throw new Error('rsi_shadow_compare_observation_policy_invalid');
  }
  const canonical = createRsiSelectedShadowComparisonObservation({
    observation_id: observation.observation_id,
    observation_index: observation.observation_index,
    binding,
    selection,
    simulation_environment_digest: observation.simulation_environment_digest,
    evaluator_manifest_digest: observation.evaluator_manifest_digest,
    champion_plan_digest: observation.champion_plan_digest,
    challenger_plan_digest: observation.challenger_plan_digest,
    champion_trajectory_digest: observation.champion_trajectory_digest,
    challenger_trajectory_digest: observation.challenger_trajectory_digest,
    champion_metrics: observation.champion_metrics,
    challenger_metrics: observation.challenger_metrics,
    champion_hard_invariants_pass: observation.champion_hard_invariants_pass,
    challenger_hard_invariants_pass: observation.challenger_hard_invariants_pass,
    champion_incident_codes: observation.champion_incident_codes,
    challenger_incident_codes: observation.challenger_incident_codes,
    comparator_integrity_pass: observation.comparator_integrity_pass,
    identity_stable: observation.identity_stable,
    from_scratch_replay_pass: observation.from_scratch_replay_pass,
    ambiguous_evidence: observation.ambiguous_evidence,
    evidence_digest: observation.evidence_digest,
    evidence_refs: observation.evidence_refs,
    counterfactual_simulation: true,
    browser_effects_performed: false,
    live_plan_execution_performed: false,
    external_comparator: true,
    authored_by_candidate: false,
  });
  if (canonical.observation_digest !== exactDigest(observation.observation_digest, 'observation')) {
    throw new Error('rsi_shadow_compare_observation_digest_mismatch');
  }
  return canonical;
}

function summaryFor(rows, bindingDigest) {
  const boundRows = rows.filter((row) => row.binding_digest === bindingDigest);
  const firstIncident = boundRows.find((row) => row.incident === true) || null;
  return Object.freeze({
    binding_digest: bindingDigest,
    row_count: boundRows.length,
    evidence_floor_reached: boundRows.length >= MIN_EVIDENCE_FLOOR,
    incident_latched: firstIncident != null,
    first_incident_observation_index: firstIncident?.observation_index ?? null,
    first_incident_codes: Object.freeze([...(firstIncident?.incident_codes || [])]),
    baseline_invalid_observed: boundRows.some((row) => row.baseline_invalid === true),
    vector_regression_count: boundRows.filter((row) => row.has_any_regression === true).length,
    vector_advance_count: boundRows.filter((row) => row.vector_relation === 'VECTOR_PARETO_ADVANCE').length,
    tradeoff_count: boundRows.filter((row) => row.vector_relation === 'VECTOR_TRADEOFF').length,
    plan_divergence_count: boundRows.filter((row) => row.plan_diverged === true).length,
    trajectory_divergence_count: boundRows.filter((row) => row.trajectory_diverged === true).length,
    champion_remains_execution_baseline: true,
    ready_for_canary_review: false,
    canary_review_authorized: false,
    canary_activation_authorized: false,
    authority_effect: false,
  });
}

function ledgerState(sourceSha, rows) {
  const bindingDigests = [...new Set(rows.map((row) => row.binding_digest))].sort();
  const summaries = bindingDigests.map((bindingDigest) => summaryFor(rows, bindingDigest));
  const core = {
    schema: RSI_SELECTED_SHADOW_COMPARISON_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    rows,
    row_count: rows.length,
    binding_summaries: summaries,
    append_only: true,
    minimum_evidence_floor_per_binding: MIN_EVIDENCE_FLOOR,
    incident_can_be_cleared: false,
    ledger_can_authorize_canary_review: false,
    ledger_can_activate_canary: false,
    ledger_can_replace_profile: false,
    champion_remains_execution_baseline: true,
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

export class RsiSelectedShadowComparisonLedger {
  #path;
  #sourceSha;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha } = {}) {
    if (!statePath) throw new Error('rsi_shadow_compare_ledger_path_required');
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
        parsed.schema !== RSI_SELECTED_SHADOW_COMPARISON_LEDGER_SCHEMA
        || parsed.version !== 1
        || parsed.source_sha !== this.#sourceSha
        || parsed.append_only !== true
        || parsed.incident_can_be_cleared !== false
        || parsed.ledger_can_authorize_canary_review !== false
        || parsed.ledger_can_activate_canary !== false
        || parsed.ledger_can_replace_profile !== false
        || parsed.champion_remains_execution_baseline !== true
        || !Array.isArray(parsed.rows)
        || parsed.rows.length > MAX_ROWS
      ) {
        throw new Error('rsi_shadow_compare_ledger_state_invalid');
      }
      const stateClone = structuredClone(parsed);
      delete stateClone.state_digest;
      if (digest(stateClone) !== exactDigest(parsed.state_digest, 'ledger')) {
        throw new Error('rsi_shadow_compare_ledger_digest_mismatch');
      }
      const ids = new Set();
      for (const row of parsed.rows) {
        if (row.source_sha !== this.#sourceSha) throw new Error('rsi_shadow_compare_ledger_row_source_mismatch');
        assertZeroAuthority(row, 'ledger_row');
        const rowClone = structuredClone(row);
        delete rowClone.observation_digest;
        if (digest(rowClone) !== exactDigest(row.observation_digest, 'observation')) {
          throw new Error('rsi_shadow_compare_ledger_row_digest_mismatch');
        }
        if (ids.has(row.observation_id)) throw new Error('rsi_shadow_compare_ledger_row_duplicate');
        ids.add(row.observation_id);
      }
      const perBinding = new Map();
      for (const row of parsed.rows) {
        const expected = (perBinding.get(row.binding_digest) || 0) + 1;
        if (row.observation_index !== expected) throw new Error('rsi_shadow_compare_ledger_sequence_invalid');
        perBinding.set(row.binding_digest, expected);
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

  async add(observation, { binding, selection } = {}) {
    if (!this.#initialized) throw new Error('rsi_shadow_compare_ledger_not_initialized');
    const checked = verifyRsiSelectedShadowComparisonObservation(observation, { binding, selection });
    if (checked.source_sha !== this.#sourceSha) throw new Error('rsi_shadow_compare_observation_source_mismatch');
    const byId = this.#rows.find((row) => row.observation_id === checked.observation_id);
    if (byId) {
      if (byId.observation_digest !== checked.observation_digest) throw new Error('rsi_shadow_compare_observation_conflict');
      return zeroAuthority({
        state: 'IDEMPOTENT',
        observation_digest: checked.observation_digest,
        summary: summaryFor(this.#rows, checked.binding_digest),
      });
    }
    const expectedIndex = this.#rows.filter((row) => row.binding_digest === checked.binding_digest).length + 1;
    if (checked.observation_index !== expectedIndex) throw new Error('rsi_shadow_compare_observation_index_out_of_sequence');
    if (this.#rows.length >= MAX_ROWS) throw new Error('rsi_shadow_compare_ledger_capacity_exceeded');
    this.#rows.push(structuredClone(checked));
    await this.#persist();
    return zeroAuthority({
      state: checked.incident ? 'INCIDENT_LATCHED' : 'EVIDENCE_RECORDED',
      observation_digest: checked.observation_digest,
      summary: summaryFor(this.#rows, checked.binding_digest),
    });
  }

  observations({ binding_digest = null } = {}) {
    if (!this.#initialized) throw new Error('rsi_shadow_compare_ledger_not_initialized');
    const rows = binding_digest == null
      ? this.#rows
      : this.#rows.filter((row) => row.binding_digest === exactDigest(binding_digest, 'binding'));
    return Object.freeze(rows.map((row) => Object.freeze(structuredClone(row))));
  }

  summary(bindingDigest) {
    if (!this.#initialized) throw new Error('rsi_shadow_compare_ledger_not_initialized');
    return summaryFor(this.#rows, exactDigest(bindingDigest, 'binding'));
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      row_count: state.row_count,
      binding_count: state.binding_summaries.length,
      minimum_evidence_floor_per_binding: state.minimum_evidence_floor_per_binding,
      incident_can_be_cleared: false,
      ledger_can_authorize_canary_review: false,
      ledger_can_activate_canary: false,
      ledger_can_replace_profile: false,
      champion_remains_execution_baseline: true,
      authority_effect: false,
    });
  }
}

export function rsiSelectedShadowComparisonTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.selected-shadow-comparison-root.v1',
    version: 1,
    phase19a_binding_required: true,
    same_verified_context_required: true,
    counterfactual_simulation_required: true,
    browser_effects_forbidden: true,
    live_plan_execution_forbidden: true,
    external_comparator_required: true,
    comparator_integrity_required: true,
    immutable_candidate_identity_required: true,
    from_scratch_replay_required: true,
    multidimensional_metrics: Object.freeze([
      'OUTCOME_SAFETY',
      'SECURITY_AWARENESS',
      'TASK_UTILITY',
      'LATENCY_EFFICIENCY',
      'TOKEN_EFFICIENCY',
    ]),
    scalar_winner_authoritative: false,
    incident_latch_fail_closed: true,
    minimum_evidence_floor_per_binding: MIN_EVIDENCE_FLOOR,
    evidence_floor_does_not_authorize_canary_review: true,
    champion_remains_execution_baseline: true,
    canary_review_authorized: false,
    canary_activation_authorized: false,
    profile_replacement_authorized: false,
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
