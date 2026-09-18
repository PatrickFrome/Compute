import crypto from 'node:crypto';

import {
  createRsiProxyAllocationGuidance,
  verifyRsiProxyCalibrationPolicy,
} from './rsi-proxy-reliability-calibration.mjs';

export const RSI_DISAGREEMENT_COMMITTEE_SCHEMA = 'metaengine.rsi.disagreement-committee.v1';
export const RSI_ACQUISITION_CANDIDATE_SCHEMA = 'metaengine.rsi.acquisition-candidate.v1';
export const RSI_COMMITTEE_PREDICTION_SCHEMA = 'metaengine.rsi.committee-prediction.v1';
export const RSI_ACTIVE_EVALUATION_BATCH_SCHEMA = 'metaengine.rsi.active-evaluation-batch.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_MEMBERS = 16;
const MAX_CANDIDATES = 2048;
const MAX_REFS = 32;

const MUTATION_SURFACES = new Set([
  'PROMPT_ROUTING',
  'AGENT_ORCHESTRATION',
  'TOOL_INTERFACE',
  'BROWSER_RUNTIME',
  'RSI_IMPROVER',
]);

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

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_disagreement_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_disagreement_${label}_sha_invalid`);
  return out;
}

function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_disagreement_${label}_candidate_id_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_disagreement_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_disagreement_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_disagreement_${label}_invalid`);
  return out;
}

function boundedScore(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_disagreement_${label}_invalid`);
  return out;
}

function finitePositive(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0) throw new Error(`rsi_disagreement_${label}_invalid`);
  return out;
}

function normalizeRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REFS) throw new Error('rsi_disagreement_evidence_refs_invalid');
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_disagreement_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
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

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_disagreement_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_disagreement_${label}_automatic_retry_invalid`);
}

function entropyBinary(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function deterministicTie(seed, id) {
  return crypto.createHash('sha256').update(`${seed}:${id}`, 'utf8').digest('hex');
}

function surface(value) {
  const out = boundedToken(value, 'mutation_surface');
  if (!MUTATION_SURFACES.has(out)) throw new Error('rsi_disagreement_mutation_surface_invalid');
  return out;
}

export function createRsiDisagreementCommitteeMember({
  member_id,
  predictor_family,
  predictor_identity_digest,
  proxy_policy,
  proxy_snapshot,
  external_member_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_member_owner !== true || authored_by_candidate !== false) throw new Error('rsi_disagreement_member_external_origin_required');
  const policy = verifyRsiProxyCalibrationPolicy(proxy_policy);
  const guidance = createRsiProxyAllocationGuidance({ policy, snapshot: proxy_snapshot });
  const core = {
    member_id: boundedId(member_id, 'member_id'),
    predictor_family: boundedToken(predictor_family, 'predictor_family'),
    predictor_identity_digest: exactDigest(predictor_identity_digest, 'predictor_identity'),
    proxy_policy_id: policy.policy_id,
    proxy_policy_digest: policy.policy_digest,
    proxy_snapshot_digest: exactDigest(proxy_snapshot.snapshot_digest, 'proxy_snapshot'),
    reliability_state: boundedToken(guidance.reliability_state, 'reliability_state'),
    reliability_weight: boundedScore(guidance.proxy_allocation_weight, 'reliability_weight'),
    pruning_mode: boundedToken(guidance.pruning_mode, 'pruning_mode'),
    drift_detected: guidance.drift_detected === true,
    external_member_owner: true,
    authored_by_candidate: false,
    member_prediction_is_full_evaluator: false,
    member_prediction_is_promotion_authority: false,
    candidate_can_edit_member_weight: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, member_digest: digest(core) });
}

export function createRsiDisagreementCommittee({
  committee_id,
  members,
  full_holdout_digest,
  evaluator_root_digest,
  external_committee_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_committee_owner !== true || authored_by_candidate !== false) throw new Error('rsi_disagreement_committee_external_origin_required');
  if (!Array.isArray(members) || members.length < 2 || members.length > MAX_MEMBERS) throw new Error('rsi_disagreement_members_invalid');

  const memberIds = new Set();
  const predictorIds = new Set();
  const rows = members.map((row) => {
    if (!plainObject(row) || !SHA256_RE.test(String(row.member_digest || ''))) throw new Error('rsi_disagreement_member_invalid');
    assertZeroAuthority(row, 'member');
    const clone = structuredClone(row);
    delete clone.member_digest;
    if (row.member_digest !== digest(clone)) throw new Error('rsi_disagreement_member_digest_mismatch');
    if (row.external_member_owner !== true || row.authored_by_candidate !== false || row.candidate_can_edit_member_weight !== false) {
      throw new Error('rsi_disagreement_member_policy_invalid');
    }
    const memberId = boundedId(row.member_id, 'member_id');
    if (memberIds.has(memberId)) throw new Error('rsi_disagreement_member_duplicate');
    memberIds.add(memberId);
    const predictorId = exactDigest(row.predictor_identity_digest, 'predictor_identity');
    if (predictorIds.has(predictorId)) throw new Error('rsi_disagreement_predictor_duplicate');
    predictorIds.add(predictorId);
    return Object.freeze(structuredClone(row));
  }).sort((a, b) => a.member_id.localeCompare(b.member_id));

  const active = rows.filter((row) => row.reliability_weight > 0);
  const activeFamilies = new Set(active.map((row) => row.predictor_family));
  const diversitySufficient = active.length >= 2 && activeFamilies.size >= 2;
  const reliabilityMass = active.reduce((sum, row) => sum + row.reliability_weight, 0);

  const core = {
    schema: RSI_DISAGREEMENT_COMMITTEE_SCHEMA,
    version: 1,
    committee_id: boundedId(committee_id, 'committee_id'),
    members: rows,
    member_count: rows.length,
    active_member_count: active.length,
    active_predictor_family_count: activeFamilies.size,
    reliability_mass: reliabilityMass,
    diversity_sufficient_for_disagreement: diversitySufficient,
    full_holdout_digest: exactDigest(full_holdout_digest, 'full_holdout'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    acquisition_rule: 'CALIBRATED_QUERY_BY_COMMITTEE',
    unreliable_members_have_zero_weight: true,
    committee_diversity_required_for_disagreement: true,
    disagreement_is_compute_allocation_only: true,
    candidate_can_choose_committee: false,
    candidate_can_choose_member_weights: false,
    candidate_can_choose_full_holdout_queries: false,
    external_committee_owner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, committee_digest: digest(core) });
}

export function verifyRsiDisagreementCommittee(committee) {
  if (!plainObject(committee) || committee.schema !== RSI_DISAGREEMENT_COMMITTEE_SCHEMA || committee.version !== 1) {
    throw new Error('rsi_disagreement_committee_invalid');
  }
  assertZeroAuthority(committee, 'committee');
  if (
    committee.acquisition_rule !== 'CALIBRATED_QUERY_BY_COMMITTEE'
    || committee.unreliable_members_have_zero_weight !== true
    || committee.committee_diversity_required_for_disagreement !== true
    || committee.disagreement_is_compute_allocation_only !== true
    || committee.candidate_can_choose_committee !== false
    || committee.candidate_can_choose_member_weights !== false
    || committee.candidate_can_choose_full_holdout_queries !== false
    || committee.external_committee_owner !== true
    || committee.authored_by_candidate !== false
  ) throw new Error('rsi_disagreement_committee_policy_invalid');
  const clone = structuredClone(committee);
  delete clone.committee_digest;
  if (exactDigest(committee.committee_digest, 'committee') !== digest(clone)) throw new Error('rsi_disagreement_committee_digest_mismatch');
  if (!Array.isArray(committee.members) || committee.members.length !== committee.member_count) throw new Error('rsi_disagreement_committee_member_count_invalid');
  return committee;
}

export function createRsiAcquisitionCandidate({
  candidate_id,
  candidate_sha,
  mutation_surface,
  novelty_score,
  estimated_full_eval_cost_units,
  low_fidelity_eligibility_digest,
  external_candidate_registry = false,
  authored_by_candidate = true,
} = {}) {
  if (external_candidate_registry !== true || authored_by_candidate !== false) throw new Error('rsi_disagreement_candidate_external_origin_required');
  const core = {
    schema: RSI_ACQUISITION_CANDIDATE_SCHEMA,
    version: 1,
    candidate_id: exactCandidateId(candidate_id, 'candidate'),
    candidate_sha: exactSha(candidate_sha, 'candidate'),
    mutation_surface: surface(mutation_surface),
    novelty_score: boundedScore(novelty_score, 'novelty_score'),
    estimated_full_eval_cost_units: finitePositive(estimated_full_eval_cost_units, 'estimated_full_eval_cost_units'),
    low_fidelity_eligibility_digest: exactDigest(low_fidelity_eligibility_digest, 'eligibility'),
    external_candidate_registry: true,
    authored_by_candidate: false,
    low_fidelity_survival_required: true,
    candidate_can_self_enqueue_full_holdout: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, candidate_digest: digest(core) });
}

export function createRsiCommitteePrediction({
  committee,
  member_id,
  candidate,
  predicted_holdout_score,
  predicted_pass_probability,
  evidence_digest,
  evidence_refs,
  external_predictor = false,
  authored_by_candidate = true,
} = {}) {
  const checkedCommittee = verifyRsiDisagreementCommittee(committee);
  if (external_predictor !== true || authored_by_candidate !== false) throw new Error('rsi_disagreement_prediction_external_origin_required');
  if (!plainObject(candidate) || candidate.schema !== RSI_ACQUISITION_CANDIDATE_SCHEMA || candidate.version !== 1) throw new Error('rsi_disagreement_candidate_invalid');
  assertZeroAuthority(candidate, 'candidate');
  const candidateClone = structuredClone(candidate);
  delete candidateClone.candidate_digest;
  if (exactDigest(candidate.candidate_digest, 'candidate') !== digest(candidateClone)) throw new Error('rsi_disagreement_candidate_digest_mismatch');
  const member = checkedCommittee.members.find((row) => row.member_id === String(member_id || ''));
  if (!member) throw new Error('rsi_disagreement_prediction_member_missing');

  const core = {
    schema: RSI_COMMITTEE_PREDICTION_SCHEMA,
    version: 1,
    committee_id: checkedCommittee.committee_id,
    committee_digest: checkedCommittee.committee_digest,
    member_id: member.member_id,
    member_digest: member.member_digest,
    member_reliability_state: member.reliability_state,
    member_reliability_weight: member.reliability_weight,
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    candidate_digest: candidate.candidate_digest,
    predicted_holdout_score: boundedScore(predicted_holdout_score, 'predicted_holdout_score'),
    predicted_pass_probability: boundedScore(predicted_pass_probability, 'predicted_pass_probability'),
    evidence_digest: exactDigest(evidence_digest, 'prediction_evidence'),
    evidence_refs: normalizeRefs(evidence_refs),
    external_predictor: true,
    authored_by_candidate: false,
    prediction_is_full_evaluator: false,
    prediction_is_promotion_authority: false,
    prediction_can_schedule_holdout: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, prediction_digest: digest(core) });
}

function verifyPrediction(row, committee, candidate) {
  if (!plainObject(row) || row.schema !== RSI_COMMITTEE_PREDICTION_SCHEMA || row.version !== 1) throw new Error('rsi_disagreement_prediction_invalid');
  assertZeroAuthority(row, 'prediction');
  if (
    row.external_predictor !== true
    || row.authored_by_candidate !== false
    || row.prediction_is_full_evaluator !== false
    || row.prediction_is_promotion_authority !== false
    || row.prediction_can_schedule_holdout !== false
  ) throw new Error('rsi_disagreement_prediction_policy_invalid');
  const canonical = createRsiCommitteePrediction({
    committee,
    member_id: row.member_id,
    candidate,
    predicted_holdout_score: row.predicted_holdout_score,
    predicted_pass_probability: row.predicted_pass_probability,
    evidence_digest: row.evidence_digest,
    evidence_refs: row.evidence_refs,
    external_predictor: true,
    authored_by_candidate: false,
  });
  if (canonical.prediction_digest !== exactDigest(row.prediction_digest, 'prediction')) throw new Error('rsi_disagreement_prediction_digest_mismatch');
  return canonical;
}

function candidateMetrics(candidate, memberRows, committee) {
  const activeRows = memberRows.filter((row) => row.member_reliability_weight > 0);
  const totalWeight = activeRows.reduce((sum, row) => sum + row.member_reliability_weight, 0);
  if (totalWeight <= 0) {
    return Object.freeze({
      weighted_mean_pass_probability: 0.5,
      weighted_mean_holdout_score: 0.5,
      weighted_variance: 0,
      weighted_stddev: 0,
      vote_entropy: 0,
      active_prediction_count: 0,
      effective_reliability_mass: 0,
      disagreement_available: false,
    });
  }
  const meanP = activeRows.reduce((sum, row) => sum + row.member_reliability_weight * row.predicted_pass_probability, 0) / totalWeight;
  const meanScore = activeRows.reduce((sum, row) => sum + row.member_reliability_weight * row.predicted_holdout_score, 0) / totalWeight;
  const variance = activeRows.reduce((sum, row) => {
    const delta = row.predicted_pass_probability - meanP;
    return sum + row.member_reliability_weight * delta * delta;
  }, 0) / totalWeight;
  const yesWeight = activeRows
    .filter((row) => row.predicted_pass_probability >= 0.5)
    .reduce((sum, row) => sum + row.member_reliability_weight, 0);
  const voteP = yesWeight / totalWeight;
  return Object.freeze({
    weighted_mean_pass_probability: meanP,
    weighted_mean_holdout_score: meanScore,
    weighted_variance: variance,
    weighted_stddev: Math.sqrt(variance),
    vote_entropy: entropyBinary(voteP),
    active_prediction_count: activeRows.length,
    effective_reliability_mass: totalWeight,
    disagreement_available: committee.diversity_sufficient_for_disagreement === true && activeRows.length >= 2,
  });
}

function rankDisagreement(a, b, seed) {
  return b.metrics.weighted_stddev - a.metrics.weighted_stddev
    || b.metrics.vote_entropy - a.metrics.vote_entropy
    || b.candidate.novelty_score - a.candidate.novelty_score
    || a.candidate.estimated_full_eval_cost_units - b.candidate.estimated_full_eval_cost_units
    || deterministicTie(seed, a.candidate.candidate_id).localeCompare(deterministicTie(seed, b.candidate.candidate_id));
}

function rankPromise(a, b, seed) {
  return b.metrics.weighted_mean_pass_probability - a.metrics.weighted_mean_pass_probability
    || b.metrics.weighted_mean_holdout_score - a.metrics.weighted_mean_holdout_score
    || a.candidate.estimated_full_eval_cost_units - b.candidate.estimated_full_eval_cost_units
    || deterministicTie(seed, a.candidate.candidate_id).localeCompare(deterministicTie(seed, b.candidate.candidate_id));
}

function rankDiversity(a, b, seed) {
  return b.candidate.novelty_score - a.candidate.novelty_score
    || b.metrics.weighted_stddev - a.metrics.weighted_stddev
    || a.candidate.estimated_full_eval_cost_units - b.candidate.estimated_full_eval_cost_units
    || deterministicTie(seed, a.candidate.candidate_id).localeCompare(deterministicTie(seed, b.candidate.candidate_id));
}

export function createRsiActiveEvaluationBatch({
  committee,
  candidates,
  predictions,
  batch_id,
  full_eval_slots,
  disagreement_slots,
  promise_slots,
  diversity_slots,
  external_acquisition_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedCommittee = verifyRsiDisagreementCommittee(committee);
  if (external_acquisition_owner !== true || authored_by_candidate !== false) throw new Error('rsi_disagreement_batch_external_origin_required');
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > MAX_CANDIDATES) throw new Error('rsi_disagreement_candidates_invalid');
  if (!Array.isArray(predictions)) throw new Error('rsi_disagreement_predictions_invalid');

  const byCandidate = new Map();
  const normalizedCandidates = candidates.map((candidate) => {
    if (!plainObject(candidate) || candidate.schema !== RSI_ACQUISITION_CANDIDATE_SCHEMA || candidate.version !== 1) throw new Error('rsi_disagreement_candidate_invalid');
    assertZeroAuthority(candidate, 'candidate');
    const clone = structuredClone(candidate);
    delete clone.candidate_digest;
    if (exactDigest(candidate.candidate_digest, 'candidate') !== digest(clone)) throw new Error('rsi_disagreement_candidate_digest_mismatch');
    if (byCandidate.has(candidate.candidate_id)) throw new Error('rsi_disagreement_candidate_duplicate');
    byCandidate.set(candidate.candidate_id, candidate);
    return candidate;
  });

  const expectedPredictionCount = checkedCommittee.members.length * normalizedCandidates.length;
  if (predictions.length !== expectedPredictionCount) throw new Error('rsi_disagreement_prediction_matrix_incomplete');

  const matrix = new Map();
  for (const candidate of normalizedCandidates) matrix.set(candidate.candidate_id, new Map());
  for (const raw of predictions) {
    const candidate = byCandidate.get(raw?.candidate_id);
    if (!candidate) throw new Error('rsi_disagreement_prediction_candidate_unknown');
    const row = verifyPrediction(raw, checkedCommittee, candidate);
    const memberMap = matrix.get(candidate.candidate_id);
    if (memberMap.has(row.member_id)) throw new Error('rsi_disagreement_prediction_duplicate');
    memberMap.set(row.member_id, row);
  }
  for (const memberMap of matrix.values()) {
    if (memberMap.size !== checkedCommittee.members.length) throw new Error('rsi_disagreement_prediction_matrix_incomplete');
  }

  const slots = positiveInt(full_eval_slots, 'full_eval_slots', normalizedCandidates.length);
  const dSlots = Number(disagreement_slots);
  const pSlots = Number(promise_slots);
  const vSlots = Number(diversity_slots);
  if (![dSlots, pSlots, vSlots].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('rsi_disagreement_slot_allocation_invalid');
  if (dSlots + pSlots + vSlots !== slots) throw new Error('rsi_disagreement_slot_sum_invalid');

  const seed = digest({
    committee_digest: checkedCommittee.committee_digest,
    batch_id: boundedId(batch_id, 'batch_id'),
    candidates: normalizedCandidates.map((row) => row.candidate_digest).sort(),
    predictions: predictions.map((row) => row.prediction_digest).sort(),
    slots: { disagreement: dSlots, promise: pSlots, diversity: vSlots },
  });

  const rows = normalizedCandidates.map((candidate) => ({
    candidate,
    predictions: [...matrix.get(candidate.candidate_id).values()],
    metrics: candidateMetrics(candidate, [...matrix.get(candidate.candidate_id).values()], checkedCommittee),
  }));

  const committeeTrusted = checkedCommittee.diversity_sufficient_for_disagreement === true
    && checkedCommittee.active_member_count >= 2
    && checkedCommittee.reliability_mass > 0;

  const selected = new Map();
  const add = (row, lane) => {
    if (!selected.has(row.candidate.candidate_id)) selected.set(row.candidate.candidate_id, { row, lane });
  };

  if (committeeTrusted) {
    for (const row of rows.slice().sort((a, b) => rankDisagreement(a, b, seed))) {
      if ([...selected.values()].filter((entry) => entry.lane === 'DISAGREEMENT').length >= dSlots) break;
      add(row, 'DISAGREEMENT');
    }
  }

  for (const row of rows.slice().sort((a, b) => rankPromise(a, b, seed))) {
    if ([...selected.values()].filter((entry) => entry.lane === 'PROMISE').length >= pSlots) break;
    if (selected.has(row.candidate.candidate_id)) continue;
    add(row, 'PROMISE');
  }

  const selectedSurfaces = new Set([...selected.values()].map((entry) => entry.row.candidate.mutation_surface));
  const diversityRank = rows.slice().sort((a, b) => {
    const aNew = selectedSurfaces.has(a.candidate.mutation_surface) ? 0 : 1;
    const bNew = selectedSurfaces.has(b.candidate.mutation_surface) ? 0 : 1;
    return bNew - aNew || rankDiversity(a, b, seed);
  });
  for (const row of diversityRank) {
    if ([...selected.values()].filter((entry) => entry.lane === 'DIVERSITY').length >= vSlots) break;
    if (selected.has(row.candidate.candidate_id)) continue;
    add(row, 'DIVERSITY');
    selectedSurfaces.add(row.candidate.mutation_surface);
  }

  if (selected.size < slots) {
    const fallback = committeeTrusted
      ? rows.slice().sort((a, b) => rankDisagreement(a, b, seed))
      : rows.slice().sort((a, b) => rankDiversity(a, b, seed));
    for (const row of fallback) {
      if (selected.size >= slots) break;
      if (!selected.has(row.candidate.candidate_id)) add(row, 'FALLBACK');
    }
  }

  const decisions = rows.map((row) => {
    const chosen = selected.get(row.candidate.candidate_id);
    return zeroAuthority({
      candidate_id: row.candidate.candidate_id,
      candidate_sha: row.candidate.candidate_sha,
      candidate_digest: row.candidate.candidate_digest,
      mutation_surface: row.candidate.mutation_surface,
      novelty_score: row.candidate.novelty_score,
      estimated_full_eval_cost_units: row.candidate.estimated_full_eval_cost_units,
      weighted_mean_pass_probability: row.metrics.weighted_mean_pass_probability,
      weighted_mean_holdout_score: row.metrics.weighted_mean_holdout_score,
      weighted_stddev: row.metrics.weighted_stddev,
      vote_entropy: row.metrics.vote_entropy,
      active_prediction_count: row.metrics.active_prediction_count,
      effective_reliability_mass: row.metrics.effective_reliability_mass,
      disagreement_available: row.metrics.disagreement_available,
      selected_for_full_holdout: Boolean(chosen),
      selection_lane: chosen?.lane || null,
      state: chosen ? 'REQUEST_FULL_HOLDOUT_EVALUATION' : 'DEFER_FULL_HOLDOUT',
      full_holdout_digest: checkedCommittee.full_holdout_digest,
      evaluator_root_digest: checkedCommittee.evaluator_root_digest,
      request_is_scheduler_task: false,
      request_is_lease: false,
      request_is_evaluation_result: false,
      request_is_promotion_authority: false,
      existing_scheduler_admission_required: true,
    });
  });

  const core = {
    schema: RSI_ACTIVE_EVALUATION_BATCH_SCHEMA,
    version: 1,
    batch_id: boundedId(batch_id, 'batch_id'),
    committee_id: checkedCommittee.committee_id,
    committee_digest: checkedCommittee.committee_digest,
    full_holdout_digest: checkedCommittee.full_holdout_digest,
    evaluator_root_digest: checkedCommittee.evaluator_root_digest,
    committee_trusted_for_disagreement: committeeTrusted,
    fallback_mode: committeeTrusted ? 'CALIBRATED_DISAGREEMENT' : 'DIVERSITY_PROMISE_WITHOUT_DISAGREEMENT',
    full_eval_slots: slots,
    requested_disagreement_slots: dSlots,
    requested_promise_slots: pSlots,
    requested_diversity_slots: vSlots,
    selected_count: decisions.filter((row) => row.selected_for_full_holdout).length,
    decisions,
    query_by_committee_inspired: true,
    active_learning_acquisition_only: true,
    low_fidelity_disagreement_is_not_truth: true,
    full_hidden_holdout_is_required: true,
    unreliable_committee_falls_back: true,
    diversity_collapse_disables_disagreement: true,
    candidate_can_choose_queries: false,
    candidate_can_choose_committee: false,
    candidate_can_self_schedule: false,
    existing_scheduler_admission_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, batch_digest: digest(core) });
}

export function verifyRsiActiveEvaluationBatch(batch) {
  if (!plainObject(batch) || batch.schema !== RSI_ACTIVE_EVALUATION_BATCH_SCHEMA || batch.version !== 1) throw new Error('rsi_disagreement_batch_invalid');
  assertZeroAuthority(batch, 'batch');
  if (
    batch.query_by_committee_inspired !== true
    || batch.active_learning_acquisition_only !== true
    || batch.low_fidelity_disagreement_is_not_truth !== true
    || batch.full_hidden_holdout_is_required !== true
    || batch.unreliable_committee_falls_back !== true
    || batch.diversity_collapse_disables_disagreement !== true
    || batch.candidate_can_choose_queries !== false
    || batch.candidate_can_choose_committee !== false
    || batch.candidate_can_self_schedule !== false
    || batch.existing_scheduler_admission_required !== true
  ) throw new Error('rsi_disagreement_batch_policy_invalid');
  if (!Array.isArray(batch.decisions) || batch.selected_count !== batch.decisions.filter((row) => row.selected_for_full_holdout).length) {
    throw new Error('rsi_disagreement_batch_count_invalid');
  }
  for (const row of batch.decisions) {
    assertZeroAuthority(row, 'batch_decision');
    if (
      row.request_is_scheduler_task !== false
      || row.request_is_lease !== false
      || row.request_is_evaluation_result !== false
      || row.request_is_promotion_authority !== false
      || row.existing_scheduler_admission_required !== true
    ) throw new Error('rsi_disagreement_batch_decision_policy_invalid');
  }
  const clone = structuredClone(batch);
  delete clone.batch_digest;
  if (exactDigest(batch.batch_digest, 'batch') !== digest(clone)) throw new Error('rsi_disagreement_batch_digest_mismatch');
  return batch;
}

export function rsiDisagreementAcquisitionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.disagreement-acquisition-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-disagreement-acquisition.mjs',
    mechanism: 'CALIBRATED_QUERY_BY_COMMITTEE_FOR_FULL_HOLDOUT_ALLOCATION',
    minimum_active_committee_members: 2,
    minimum_active_predictor_families: 2,
    unreliable_members_have_zero_weight: true,
    v1_22_proxy_calibration_required: true,
    full_prediction_matrix_required: true,
    disagreement_lane: true,
    promise_lane: true,
    diversity_lane: true,
    unreliable_committee_fallback: true,
    diversity_collapse_disables_disagreement: true,
    full_hidden_holdout_required: true,
    candidate_can_choose_committee: false,
    candidate_can_choose_queries: false,
    candidate_can_self_schedule: false,
    active_learning_signal_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, disagreement_root_digest: digest(root) });
}
