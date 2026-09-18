import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiRuntimeMetaSkillRecord } from './rsi-runtime-meta-skill-archive.mjs';
import { verifyRsiMetaProfileShadowPlan } from './rsi-meta-profile-qualification.mjs';
import {
  verifyQualifiedMetaProfile,
  verifyRsiShadowProfileBinding,
} from './rsi-shadow-profile-binding.mjs';

export const RSI_SHADOW_DIVERGENCE_MONITOR_POLICY_SCHEMA = 'metaengine.rsi.shadow-divergence-monitor-policy.v1';
export const RSI_SHADOW_DIVERGENCE_OBSERVATION_SCHEMA = 'metaengine.rsi.shadow-divergence-observation.v1';
export const RSI_SHADOW_DIVERGENCE_MONITOR_LEDGER_SCHEMA = 'metaengine.rsi.shadow-divergence-monitor-ledger.v1';
export const RSI_SHADOW_DIVERGENCE_REVIEW_EVIDENCE_SCHEMA = 'metaengine.rsi.shadow-divergence-review-evidence.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MIN_OBSERVATIONS = 8;
const MAX_OBSERVATIONS = 64;
const MAX_EVIDENCE_REFS = 32;
const RELATIONS = new Set([
  'MATCH',
  'CHALLENGER_BETTER',
  'CHAMPION_BETTER',
  'TRADEOFF',
  'INCONCLUSIVE',
]);

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
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_shadow_monitor_${label}_sha_invalid`);
  return normalized;
}

function exactDigest(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_shadow_monitor_${label}_digest_invalid`);
  return normalized;
}

function boundedId(value, label) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID_RE.test(normalized)) throw new Error(`rsi_shadow_monitor_${label}_invalid`);
  return normalized;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > max) {
    throw new Error(`rsi_shadow_monitor_${label}_invalid`);
  }
  return normalized;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_shadow_monitor_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_shadow_monitor_${label}_automatic_retry_invalid`);
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
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) {
    throw new Error('rsi_shadow_monitor_evidence_refs_invalid');
  }
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_shadow_monitor_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
}

function verifyLineage({ binding, qualification, meta_record, shadow_plan }) {
  const record = verifyRsiRuntimeMetaSkillRecord(meta_record);
  const qualified = verifyQualifiedMetaProfile(qualification);
  const plan = verifyRsiMetaProfileShadowPlan(shadow_plan, record);
  const bound = verifyRsiShadowProfileBinding(binding, qualified);

  if (
    qualified.source_sha !== record.source_sha
    || qualified.meta_record_digest !== record.record_digest
    || qualified.parent_profile_digest !== record.parent_profile_digest
    || qualified.successor_profile_digest !== record.successor_profile_digest
    || qualified.shadow_plan_digest !== plan.plan_digest
  ) {
    throw new Error('rsi_shadow_monitor_qualification_lineage_mismatch');
  }
  if (
    bound.source_sha !== qualified.source_sha
    || bound.qualification_digest !== qualified.qualification_digest
    || bound.champion_profile_digest !== qualified.parent_profile_digest
    || bound.challenger_profile_digest !== qualified.successor_profile_digest
  ) {
    throw new Error('rsi_shadow_monitor_binding_lineage_mismatch');
  }
  return Object.freeze({ record, qualified, plan, bound });
}

export function createRsiShadowDivergenceMonitorPolicy({
  monitor_id,
  binding,
  qualification,
  meta_record,
  shadow_plan,
  security_negative_holdout_digest,
  from_scratch_replay_root_digest,
  monitor_root_digest,
  min_observations = MIN_OBSERVATIONS,
  external_monitor_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_monitor_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_shadow_monitor_external_owner_required');
  }
  const lineage = verifyLineage({ binding, qualification, meta_record, shadow_plan });
  const securityHoldout = exactDigest(security_negative_holdout_digest, 'security_holdout');
  const replayRoot = exactDigest(from_scratch_replay_root_digest, 'replay_root');
  const monitorRoot = exactDigest(monitor_root_digest, 'monitor_root');
  const fastHoldout = exactDigest(lineage.record.fast_loop_summary.fast_holdout_digest, 'fast_holdout');
  const metaHoldout = exactDigest(lineage.record.plan.meta_holdout_digest, 'meta_holdout');
  const activationHoldout = exactDigest(lineage.plan.activation_holdout_digest, 'activation_holdout');
  if ([fastHoldout, metaHoldout, activationHoldout].includes(securityHoldout)) {
    throw new Error('rsi_shadow_monitor_security_holdout_alias');
  }
  if (monitorRoot === lineage.bound.comparator_root_digest) {
    throw new Error('rsi_shadow_monitor_monitor_comparator_root_alias');
  }
  const minimum = positiveInt(min_observations, 'min_observations', MAX_OBSERVATIONS);
  if (minimum < MIN_OBSERVATIONS) throw new Error('rsi_shadow_monitor_min_observations_below_floor');

  const core = {
    schema: RSI_SHADOW_DIVERGENCE_MONITOR_POLICY_SCHEMA,
    version: 1,
    source_sha: exactSha(lineage.record.source_sha, 'source'),
    monitor_id: boundedId(monitor_id, 'monitor_id'),
    binding_digest: lineage.bound.binding_digest,
    qualification_digest: lineage.qualified.qualification_digest,
    meta_record_digest: lineage.record.record_digest,
    shadow_plan_digest: lineage.plan.plan_digest,
    champion_profile_digest: lineage.bound.champion_profile_digest,
    challenger_profile_digest: lineage.bound.challenger_profile_digest,
    verified_context_digest: lineage.bound.verified_context_digest,
    comparator_root_digest: lineage.bound.comparator_root_digest,
    monitor_root_digest: monitorRoot,
    fast_holdout_digest: fastHoldout,
    meta_holdout_digest: metaHoldout,
    activation_holdout_digest: activationHoldout,
    security_negative_holdout_digest: securityHoldout,
    from_scratch_replay_root_digest: replayRoot,
    min_observations: minimum,
    max_observations: MAX_OBSERVATIONS,
    allowed_relations: Object.freeze([...RELATIONS].sort()),
    same_verified_context_required: true,
    independent_security_negative_holdout_required: true,
    security_holdout_distinct_from_fast_meta_activation: true,
    from_scratch_replay_required: true,
    immutable_candidate_identity_required: true,
    external_monitor_required: true,
    monitor_independent_from_comparator_required: true,
    candidate_can_choose_monitor: false,
    candidate_can_choose_security_holdout: false,
    candidate_can_view_security_holdout: false,
    candidate_can_author_observations: false,
    candidate_can_clear_incidents: false,
    raw_monitor_events_exposed_to_candidate: false,
    incident_latch_fail_closed: true,
    champion_remains_default: true,
    production_activation_authorized: false,
    canary_activation_authorized: false,
    canary_review_only: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, policy_digest: digest(core) });
}

export function verifyRsiShadowDivergenceMonitorPolicy(policy, lineage) {
  if (
    !plain(policy)
    || policy.schema !== RSI_SHADOW_DIVERGENCE_MONITOR_POLICY_SCHEMA
    || policy.version !== 1
  ) {
    throw new Error('rsi_shadow_monitor_policy_invalid');
  }
  assertZeroAuthority(policy, 'policy');
  const canonical = createRsiShadowDivergenceMonitorPolicy({
    monitor_id: policy.monitor_id,
    binding: lineage.binding,
    qualification: lineage.qualification,
    meta_record: lineage.meta_record,
    shadow_plan: lineage.shadow_plan,
    security_negative_holdout_digest: policy.security_negative_holdout_digest,
    from_scratch_replay_root_digest: policy.from_scratch_replay_root_digest,
    monitor_root_digest: policy.monitor_root_digest,
    min_observations: policy.min_observations,
    external_monitor_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.policy_digest !== exactDigest(policy.policy_digest, 'policy')) {
    throw new Error('rsi_shadow_monitor_policy_digest_mismatch');
  }
  return canonical;
}

export function createRsiShadowDivergenceObservation({
  policy,
  lineage,
  observation_index,
  relation,
  hard_invariants_pass,
  security_negative_pass,
  verifier_integrity_pass,
  identity_stable,
  from_scratch_replay_pass,
  ambiguous_evidence = false,
  evidence_digest,
  evidence_refs,
  external_monitor = false,
  authored_by_candidate = true,
} = {}) {
  const checkedPolicy = verifyRsiShadowDivergenceMonitorPolicy(policy, lineage);
  if (external_monitor !== true || authored_by_candidate !== false) {
    throw new Error('rsi_shadow_monitor_external_observation_required');
  }
  const index = positiveInt(observation_index, 'observation_index', checkedPolicy.max_observations);
  const normalizedRelation = String(relation || '').trim().toUpperCase();
  if (!RELATIONS.has(normalizedRelation)) throw new Error('rsi_shadow_monitor_relation_invalid');

  const incidentCodes = [];
  if (hard_invariants_pass !== true) incidentCodes.push('HARD_INVARIANT_FAILURE');
  if (security_negative_pass !== true) incidentCodes.push('SECURITY_NEGATIVE_FAILURE');
  if (verifier_integrity_pass !== true) incidentCodes.push('VERIFIER_INTEGRITY_FAILURE');
  if (identity_stable !== true) incidentCodes.push('CANDIDATE_IDENTITY_DRIFT');
  if (from_scratch_replay_pass !== true) incidentCodes.push('FROM_SCRATCH_REPLAY_FAILURE');
  if (ambiguous_evidence === true) incidentCodes.push('AMBIGUOUS_EVIDENCE');

  const core = {
    schema: RSI_SHADOW_DIVERGENCE_OBSERVATION_SCHEMA,
    version: 1,
    source_sha: checkedPolicy.source_sha,
    monitor_id: checkedPolicy.monitor_id,
    policy_digest: checkedPolicy.policy_digest,
    binding_digest: checkedPolicy.binding_digest,
    qualification_digest: checkedPolicy.qualification_digest,
    meta_record_digest: checkedPolicy.meta_record_digest,
    champion_profile_digest: checkedPolicy.champion_profile_digest,
    challenger_profile_digest: checkedPolicy.challenger_profile_digest,
    verified_context_digest: checkedPolicy.verified_context_digest,
    monitor_root_digest: checkedPolicy.monitor_root_digest,
    security_negative_holdout_digest: checkedPolicy.security_negative_holdout_digest,
    from_scratch_replay_root_digest: checkedPolicy.from_scratch_replay_root_digest,
    observation_index: index,
    relation: normalizedRelation,
    hard_invariants_pass: hard_invariants_pass === true,
    security_negative_pass: security_negative_pass === true,
    verifier_integrity_pass: verifier_integrity_pass === true,
    identity_stable: identity_stable === true,
    from_scratch_replay_pass: from_scratch_replay_pass === true,
    ambiguous_evidence: ambiguous_evidence === true,
    incident: incidentCodes.length > 0,
    incident_codes: Object.freeze(incidentCodes.sort()),
    evidence_digest: exactDigest(evidence_digest, 'observation_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_monitor: true,
    authored_by_candidate: false,
    observation_is_execution_authority: false,
    observation_is_canary_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, observation_digest: digest(core) });
}

export function verifyRsiShadowDivergenceObservation(observation, { policy, lineage }) {
  if (
    !plain(observation)
    || observation.schema !== RSI_SHADOW_DIVERGENCE_OBSERVATION_SCHEMA
    || observation.version !== 1
  ) {
    throw new Error('rsi_shadow_monitor_observation_invalid');
  }
  assertZeroAuthority(observation, 'observation');
  const canonical = createRsiShadowDivergenceObservation({
    policy,
    lineage,
    observation_index: observation.observation_index,
    relation: observation.relation,
    hard_invariants_pass: observation.hard_invariants_pass,
    security_negative_pass: observation.security_negative_pass,
    verifier_integrity_pass: observation.verifier_integrity_pass,
    identity_stable: observation.identity_stable,
    from_scratch_replay_pass: observation.from_scratch_replay_pass,
    ambiguous_evidence: observation.ambiguous_evidence,
    evidence_digest: observation.evidence_digest,
    evidence_refs: observation.evidence_refs,
    external_monitor: true,
    authored_by_candidate: false,
  });
  if (canonical.observation_digest !== exactDigest(observation.observation_digest, 'observation')) {
    throw new Error('rsi_shadow_monitor_observation_digest_mismatch');
  }
  return canonical;
}

function summarize(policy, rows) {
  const counts = Object.fromEntries([...RELATIONS].sort().map((relation) => [
    relation,
    rows.filter((row) => row.relation === relation).length,
  ]));
  const firstIncident = rows.find((row) => row.incident === true) || null;
  const incidentLatched = firstIncident != null;
  const enoughEvidence = rows.length >= policy.min_observations;
  const noNegativeComparativeEvidence = counts.CHAMPION_BETTER === 0 && counts.TRADEOFF === 0;
  const challengerHasPositiveEvidence = counts.CHALLENGER_BETTER > 0;
  const ready = enoughEvidence && !incidentLatched && noNegativeComparativeEvidence && challengerHasPositiveEvidence;
  return {
    counts,
    incident_latched: incidentLatched,
    first_incident_observation_index: firstIncident?.observation_index ?? null,
    first_incident_codes: firstIncident?.incident_codes ?? [],
    enough_evidence: enoughEvidence,
    no_negative_comparative_evidence: noNegativeComparativeEvidence,
    challenger_has_positive_evidence: challengerHasPositiveEvidence,
    ready_for_external_bounded_canary_review: ready,
  };
}

function ledgerState(sourceSha, policy, rows) {
  const summary = summarize(policy, rows);
  const core = {
    schema: RSI_SHADOW_DIVERGENCE_MONITOR_LEDGER_SCHEMA,
    version: 1,
    source_sha: sourceSha,
    policy,
    rows,
    row_count: rows.length,
    relation_counts: summary.counts,
    incident_latched: summary.incident_latched,
    first_incident_observation_index: summary.first_incident_observation_index,
    first_incident_codes: summary.first_incident_codes,
    enough_evidence: summary.enough_evidence,
    no_negative_comparative_evidence: summary.no_negative_comparative_evidence,
    challenger_has_positive_evidence: summary.challenger_has_positive_evidence,
    ready_for_external_bounded_canary_review: summary.ready_for_external_bounded_canary_review,
    append_only: true,
    champion_remains_default: true,
    active_profile_digest: policy.champion_profile_digest,
    challenger_profile_digest: policy.challenger_profile_digest,
    incident_can_be_cleared: false,
    ledger_can_activate_canary: false,
    ledger_can_replace_profile: false,
    canary_activation_authorized: false,
    production_activation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, state_digest: digest(core) };
}

export class RsiShadowDivergenceMonitorLedger {
  #path;
  #sourceSha;
  #policy;
  #rows = [];
  #initialized = false;

  constructor({ statePath, source_sha, policy, lineage } = {}) {
    if (!statePath) throw new Error('rsi_shadow_monitor_ledger_path_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'ledger_source');
    this.#policy = verifyRsiShadowDivergenceMonitorPolicy(policy, lineage);
    if (this.#policy.source_sha !== this.#sourceSha) {
      throw new Error('rsi_shadow_monitor_policy_source_mismatch');
    }
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const persisted = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      assertZeroAuthority(persisted, 'ledger');
      if (
        persisted.schema !== RSI_SHADOW_DIVERGENCE_MONITOR_LEDGER_SCHEMA
        || persisted.version !== 1
        || persisted.source_sha !== this.#sourceSha
        || persisted.policy?.policy_digest !== this.#policy.policy_digest
        || persisted.append_only !== true
        || persisted.incident_can_be_cleared !== false
        || persisted.ledger_can_activate_canary !== false
        || persisted.ledger_can_replace_profile !== false
        || !Array.isArray(persisted.rows)
        || persisted.rows.length > this.#policy.max_observations
      ) {
        throw new Error('rsi_shadow_monitor_ledger_state_invalid');
      }
      const clone = structuredClone(persisted);
      delete clone.state_digest;
      if (digest(clone) !== exactDigest(persisted.state_digest, 'ledger_state')) {
        throw new Error('rsi_shadow_monitor_ledger_digest_mismatch');
      }
      this.#rows = persisted.rows.map((row) => {
        assertZeroAuthority(row, 'persisted_observation');
        if (row.policy_digest !== this.#policy.policy_digest || row.source_sha !== this.#sourceSha) {
          throw new Error('rsi_shadow_monitor_ledger_observation_binding_mismatch');
        }
        const cloneRow = structuredClone(row);
        delete cloneRow.observation_digest;
        if (digest(cloneRow) !== exactDigest(row.observation_digest, 'persisted_observation')) {
          throw new Error('rsi_shadow_monitor_ledger_observation_digest_mismatch');
        }
        return row;
      });
      for (let index = 0; index < this.#rows.length; index += 1) {
        if (this.#rows[index].observation_index !== index + 1) {
          throw new Error('rsi_shadow_monitor_ledger_sequence_invalid');
        }
      }
      const recomputed = ledgerState(this.#sourceSha, this.#policy, this.#rows);
      if (
        recomputed.incident_latched !== persisted.incident_latched
        || recomputed.ready_for_external_bounded_canary_review !== persisted.ready_for_external_bounded_canary_review
      ) {
        throw new Error('rsi_shadow_monitor_ledger_summary_mismatch');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    const state = ledgerState(this.#sourceSha, this.#policy, this.#rows);
    const tempPath = `${this.#path}.tmp`;
    const handle = await fs.open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, this.#path);
  }

  async add(observation, { lineage }) {
    if (!this.#initialized) throw new Error('rsi_shadow_monitor_ledger_not_initialized');
    const checked = verifyRsiShadowDivergenceObservation(observation, {
      policy: this.#policy,
      lineage,
    });
    const expectedIndex = this.#rows.length + 1;
    if (checked.observation_index !== expectedIndex) {
      throw new Error('rsi_shadow_monitor_observation_index_out_of_sequence');
    }
    if (this.#rows.length >= this.#policy.max_observations) {
      throw new Error('rsi_shadow_monitor_observation_capacity_exceeded');
    }
    this.#rows.push(structuredClone(checked));
    await this.#persist();
    const snapshot = this.snapshot();
    return zeroAuthority({
      state: checked.incident ? 'INCIDENT_LATCHED' : 'OBSERVED',
      observation_digest: checked.observation_digest,
      incident_latched: snapshot.incident_latched,
      ready_for_external_bounded_canary_review: snapshot.ready_for_external_bounded_canary_review,
      canary_activation_authorized: false,
    });
  }

  reviewEvidence() {
    if (!this.#initialized) throw new Error('rsi_shadow_monitor_ledger_not_initialized');
    const state = ledgerState(this.#sourceSha, this.#policy, this.#rows);
    const core = {
      schema: RSI_SHADOW_DIVERGENCE_REVIEW_EVIDENCE_SCHEMA,
      version: 1,
      source_sha: state.source_sha,
      monitor_id: state.policy.monitor_id,
      policy_digest: state.policy.policy_digest,
      binding_digest: state.policy.binding_digest,
      qualification_digest: state.policy.qualification_digest,
      champion_profile_digest: state.active_profile_digest,
      challenger_profile_digest: state.challenger_profile_digest,
      verified_context_digest: state.policy.verified_context_digest,
      monitor_root_digest: state.policy.monitor_root_digest,
      security_negative_holdout_digest: state.policy.security_negative_holdout_digest,
      from_scratch_replay_root_digest: state.policy.from_scratch_replay_root_digest,
      observation_count: state.row_count,
      relation_counts: Object.freeze({ ...state.relation_counts }),
      incident_latched: state.incident_latched,
      first_incident_observation_index: state.first_incident_observation_index,
      first_incident_codes: Object.freeze([...state.first_incident_codes]),
      enough_evidence: state.enough_evidence,
      no_negative_comparative_evidence: state.no_negative_comparative_evidence,
      challenger_has_positive_evidence: state.challenger_has_positive_evidence,
      ready_for_external_bounded_canary_review: state.ready_for_external_bounded_canary_review,
      champion_remains_default: true,
      active_profile_replacement_authorized: false,
      canary_activation_authorized: false,
      external_review_still_required: true,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      scheduler_authority: false,
      signing_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, review_evidence_digest: digest(core) });
  }

  snapshot() {
    const state = ledgerState(this.#sourceSha, this.#policy, this.#rows);
    return Object.freeze({
      schema: state.schema,
      version: state.version,
      source_sha: state.source_sha,
      initialized: this.#initialized,
      policy_digest: state.policy.policy_digest,
      row_count: state.row_count,
      relation_counts: Object.freeze({ ...state.relation_counts }),
      incident_latched: state.incident_latched,
      first_incident_observation_index: state.first_incident_observation_index,
      first_incident_codes: Object.freeze([...state.first_incident_codes]),
      enough_evidence: state.enough_evidence,
      no_negative_comparative_evidence: state.no_negative_comparative_evidence,
      challenger_has_positive_evidence: state.challenger_has_positive_evidence,
      ready_for_external_bounded_canary_review: state.ready_for_external_bounded_canary_review,
      champion_remains_default: true,
      active_profile_digest: state.active_profile_digest,
      challenger_profile_digest: state.challenger_profile_digest,
      incident_can_be_cleared: false,
      ledger_can_activate_canary: false,
      ledger_can_replace_profile: false,
      canary_activation_authorized: false,
      production_activation_authorized: false,
      authority_effect: false,
    });
  }
}

export function rsiShadowDivergenceMonitorTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.shadow-divergence-monitor-root.v1',
    version: 1,
    exact_qualified_lineage_required: true,
    exact_shadow_binding_required: true,
    same_verified_context_required: true,
    independent_security_negative_holdout_required: true,
    security_holdout_distinct_from_fast_meta_activation: true,
    from_scratch_replay_required: true,
    immutable_candidate_identity_required: true,
    external_monitor_required: true,
    monitor_independent_from_comparator_required: true,
    minimum_observation_floor: MIN_OBSERVATIONS,
    maximum_observations: MAX_OBSERVATIONS,
    candidate_can_choose_monitor: false,
    candidate_can_choose_security_holdout: false,
    candidate_can_view_security_holdout: false,
    candidate_can_author_observations: false,
    candidate_can_clear_incidents: false,
    raw_monitor_events_exposed_to_candidate: false,
    incident_latch_fail_closed: true,
    champion_remains_default: true,
    bounded_canary_review_only: true,
    canary_activation_authorized: false,
    production_activation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, shadow_monitor_root_digest: digest(root) });
}
