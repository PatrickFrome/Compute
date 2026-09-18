import crypto from 'node:crypto';

export const RSI_TRAJECTORY_EVIDENCE_SCHEMA = 'metaengine.rsi.trajectory-evidence.v1';
export const RSI_REACTION_NORM_PROFILE_SCHEMA = 'metaengine.rsi.reaction-norm-profile.v1';
export const RSI_CROSS_LINEAGE_CONTRAST_SCHEMA = 'metaengine.rsi.cross-lineage-contrast.v1';
export const RSI_COMPARATIVE_MUTATION_PORTFOLIO_SCHEMA = 'metaengine.rsi.comparative-mutation-portfolio.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_TRAJECTORIES = 256;
const MAX_CODES = 24;
const MAX_EVIDENCE_REFS = 32;

const OUTCOMES = new Set(['PASS', 'FAIL', 'AMBIGUOUS']);
const OPERATORS = Object.freeze(['CLONAL', 'REACTION_NORM', 'CROSS_LINEAGE_HYBRID']);

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_lineage_${label}_digest_invalid`);
  return out;
}
function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_lineage_${label}_sha_invalid`);
  return out;
}
function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_lineage_${label}_candidate_id_invalid`);
  return out;
}
function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_lineage_${label}_invalid`);
  return out;
}
function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_lineage_${label}_invalid`);
  return out;
}
function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_lineage_${label}_invalid`);
  return out;
}
function normalizeCodes(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_CODES) throw new Error(`rsi_lineage_${label}_invalid`);
  const seen = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, label);
    if (seen.has(token)) throw new Error(`rsi_lineage_${label}_duplicate`);
    seen.add(token);
  }
  return [...seen].sort();
}
function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_lineage_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_lineage_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}
function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_lineage_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_lineage_${label}_automatic_retry_invalid`);
}
function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function createRsiTrajectoryEvidence({
  trajectory_id,
  candidate_id,
  candidate_sha,
  lineage_id,
  task_id,
  environment_family,
  outcome,
  evaluator_root_digest,
  trajectory_digest,
  failure_codes = [],
  success_mechanism_codes = [],
  tool_sequence_digest,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_lineage_trajectory_external_origin_required');
  const normalizedOutcome = boundedToken(outcome, 'outcome');
  if (!OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_lineage_outcome_invalid');
  const failures = normalizeCodes(failure_codes, 'failure_code');
  const successes = normalizeCodes(success_mechanism_codes, 'success_code');
  if (normalizedOutcome === 'PASS' && failures.length > 0) throw new Error('rsi_lineage_pass_failure_codes_forbidden');
  if (normalizedOutcome === 'FAIL' && successes.length > 0) throw new Error('rsi_lineage_fail_success_codes_forbidden');
  const core = {
    schema: RSI_TRAJECTORY_EVIDENCE_SCHEMA,
    version: 1,
    trajectory_id: boundedId(trajectory_id, 'trajectory_id'),
    candidate_id: exactCandidateId(candidate_id, 'trajectory'),
    candidate_sha: exactSha(candidate_sha, 'trajectory'),
    lineage_id: boundedId(lineage_id, 'lineage_id'),
    task_id: boundedId(task_id, 'task_id'),
    environment_family: boundedToken(environment_family, 'environment_family'),
    outcome: normalizedOutcome,
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    trajectory_digest: exactDigest(trajectory_digest, 'trajectory'),
    tool_sequence_digest: exactDigest(tool_sequence_digest, 'tool_sequence'),
    failure_codes: failures,
    success_mechanism_codes: successes,
    evidence_refs: evidenceRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    raw_trajectory_shared_with_candidate: false,
    raw_page_text_shared: false,
    raw_user_input_shared: false,
    secret_material_shared: false,
    model_narrative_is_authority: false,
    candidate_can_edit_trajectory_evidence: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, evidence_digest: digest(core) });
}

export function verifyRsiTrajectoryEvidence(row) {
  if (!plainObject(row) || row.schema !== RSI_TRAJECTORY_EVIDENCE_SCHEMA || row.version !== 1) throw new Error('rsi_lineage_trajectory_invalid');
  assertZeroAuthority(row, 'trajectory');
  if (
    row.external_evaluator !== true
    || row.authored_by_candidate !== false
    || row.raw_trajectory_shared_with_candidate !== false
    || row.raw_page_text_shared !== false
    || row.raw_user_input_shared !== false
    || row.secret_material_shared !== false
    || row.model_narrative_is_authority !== false
    || row.candidate_can_edit_trajectory_evidence !== false
  ) throw new Error('rsi_lineage_trajectory_policy_invalid');
  const canonical = createRsiTrajectoryEvidence({
    trajectory_id: row.trajectory_id,
    candidate_id: row.candidate_id,
    candidate_sha: row.candidate_sha,
    lineage_id: row.lineage_id,
    task_id: row.task_id,
    environment_family: row.environment_family,
    outcome: row.outcome,
    evaluator_root_digest: row.evaluator_root_digest,
    trajectory_digest: row.trajectory_digest,
    failure_codes: row.failure_codes,
    success_mechanism_codes: row.success_mechanism_codes,
    tool_sequence_digest: row.tool_sequence_digest,
    evidence_refs: row.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.evidence_digest !== exactDigest(row.evidence_digest, 'trajectory_evidence')) throw new Error('rsi_lineage_trajectory_digest_mismatch');
  return canonical;
}

export function createRsiReactionNormProfile({ trajectories } = {}) {
  if (!Array.isArray(trajectories) || trajectories.length < 2 || trajectories.length > MAX_TRAJECTORIES) throw new Error('rsi_lineage_reaction_norm_trajectories_invalid');
  const rows = trajectories.map(verifyRsiTrajectoryEvidence);
  const candidateId = rows[0].candidate_id;
  const candidateSha = rows[0].candidate_sha;
  const lineageId = rows[0].lineage_id;
  if (rows.some((row) => row.candidate_id !== candidateId || row.candidate_sha !== candidateSha || row.lineage_id !== lineageId)) {
    throw new Error('rsi_lineage_reaction_norm_candidate_mismatch');
  }
  const taskIds = new Set(rows.map((row) => row.task_id));
  if (taskIds.size < 2) throw new Error('rsi_lineage_reaction_norm_multi_task_required');

  const failureCounts = new Map();
  const successCounts = new Map();
  for (const row of rows) {
    for (const code of row.failure_codes) failureCounts.set(code, (failureCounts.get(code) || 0) + 1);
    for (const code of row.success_mechanism_codes) successCounts.set(code, (successCounts.get(code) || 0) + 1);
  }
  const recurringFailures = [...failureCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code,count]) => Object.freeze({ code, task_count: count }));
  const recurringSuccesses = [...successCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code,count]) => Object.freeze({ code, task_count: count }));

  const core = {
    schema: RSI_REACTION_NORM_PROFILE_SCHEMA,
    version: 1,
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    lineage_id: lineageId,
    task_count: taskIds.size,
    pass_count: rows.filter((row) => row.outcome === 'PASS').length,
    fail_count: rows.filter((row) => row.outcome === 'FAIL').length,
    ambiguous_count: rows.filter((row) => row.outcome === 'AMBIGUOUS').length,
    recurring_failure_codes: recurringFailures,
    recurring_success_mechanism_codes: recurringSuccesses,
    evidence_digests: rows.map((row) => row.evidence_digest).sort(),
    genotype_level_defect_signal: recurringFailures.length > 0,
    multi_task_comparison_required: true,
    raw_trajectory_shared_with_candidate: false,
    candidate_can_author_profile: false,
    profile_is_mutation_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, profile_digest: digest(core) });
}

export function verifyRsiReactionNormProfile(profile) {
  if (!plainObject(profile) || profile.schema !== RSI_REACTION_NORM_PROFILE_SCHEMA || profile.version !== 1) throw new Error('rsi_lineage_reaction_norm_invalid');
  assertZeroAuthority(profile, 'reaction_norm');
  if (
    profile.multi_task_comparison_required !== true
    || profile.raw_trajectory_shared_with_candidate !== false
    || profile.candidate_can_author_profile !== false
    || profile.profile_is_mutation_authority !== false
  ) throw new Error('rsi_lineage_reaction_norm_policy_invalid');
  const clone = structuredClone(profile);
  delete clone.profile_digest;
  if (exactDigest(profile.profile_digest, 'reaction_norm') !== digest(clone)) throw new Error('rsi_lineage_reaction_norm_digest_mismatch');
  return profile;
}

export function createRsiCrossLineageContrast({ target_trajectory, reference_trajectory } = {}) {
  const target = verifyRsiTrajectoryEvidence(target_trajectory);
  const reference = verifyRsiTrajectoryEvidence(reference_trajectory);
  if (target.task_id !== reference.task_id) throw new Error('rsi_lineage_contrast_same_task_required');
  if (target.candidate_id === reference.candidate_id || target.lineage_id === reference.lineage_id) throw new Error('rsi_lineage_contrast_distinct_lineage_required');
  if (target.evaluator_root_digest !== reference.evaluator_root_digest) throw new Error('rsi_lineage_contrast_evaluator_root_mismatch');
  if (target.outcome !== 'FAIL' || reference.outcome !== 'PASS') throw new Error('rsi_lineage_contrast_fail_pass_required');
  if (reference.success_mechanism_codes.length < 1) throw new Error('rsi_lineage_contrast_reference_mechanism_required');

  const core = {
    schema: RSI_CROSS_LINEAGE_CONTRAST_SCHEMA,
    version: 1,
    task_id: target.task_id,
    target_candidate_id: target.candidate_id,
    target_candidate_sha: target.candidate_sha,
    target_lineage_id: target.lineage_id,
    target_evidence_digest: target.evidence_digest,
    target_failure_codes: [...target.failure_codes],
    reference_candidate_id: reference.candidate_id,
    reference_candidate_sha: reference.candidate_sha,
    reference_lineage_id: reference.lineage_id,
    reference_evidence_digest: reference.evidence_digest,
    reference_success_mechanism_codes: [...reference.success_mechanism_codes],
    evaluator_root_digest: target.evaluator_root_digest,
    same_task_comparison: true,
    distinct_lineage_required: true,
    reference_success_required: true,
    target_failure_required: true,
    raw_trajectory_shared_with_candidate: false,
    candidate_can_select_reference: false,
    contrast_is_mutation_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, contrast_digest: digest(core) });
}

export function verifyRsiCrossLineageContrast(contrast) {
  if (!plainObject(contrast) || contrast.schema !== RSI_CROSS_LINEAGE_CONTRAST_SCHEMA || contrast.version !== 1) throw new Error('rsi_lineage_contrast_invalid');
  assertZeroAuthority(contrast, 'contrast');
  if (
    contrast.same_task_comparison !== true
    || contrast.distinct_lineage_required !== true
    || contrast.reference_success_required !== true
    || contrast.target_failure_required !== true
    || contrast.raw_trajectory_shared_with_candidate !== false
    || contrast.candidate_can_select_reference !== false
    || contrast.contrast_is_mutation_authority !== false
  ) throw new Error('rsi_lineage_contrast_policy_invalid');
  const clone = structuredClone(contrast);
  delete clone.contrast_digest;
  if (exactDigest(contrast.contrast_digest, 'contrast') !== digest(clone)) throw new Error('rsi_lineage_contrast_digest_mismatch');
  return contrast;
}

function proposalId(seed, operator, suffix) {
  return `rsi_mutation_${operator.toLowerCase()}_${crypto.createHash('sha256').update(`${seed}:${operator}:${suffix}`).digest('hex').slice(0,24)}`;
}

export function createRsiComparativeMutationPortfolio({
  target_trajectory,
  reaction_norm_profile = null,
  cross_lineage_contrasts = [],
  generation,
  max_proposals = 3,
} = {}) {
  const target = verifyRsiTrajectoryEvidence(target_trajectory);
  const gen = positiveInt(generation, 'generation', 1_000_000);
  const max = positiveInt(max_proposals, 'max_proposals', 3);
  if (target.outcome !== 'FAIL') throw new Error('rsi_lineage_target_failure_required');
  const reaction = reaction_norm_profile == null ? null : verifyRsiReactionNormProfile(reaction_norm_profile);
  if (reaction && (reaction.candidate_id !== target.candidate_id || reaction.candidate_sha !== target.candidate_sha)) {
    throw new Error('rsi_lineage_reaction_norm_target_mismatch');
  }
  if (!Array.isArray(cross_lineage_contrasts) || cross_lineage_contrasts.length > 64) throw new Error('rsi_lineage_contrasts_invalid');
  const contrasts = cross_lineage_contrasts.map(verifyRsiCrossLineageContrast)
    .filter((row) => row.target_candidate_id === target.candidate_id && row.target_candidate_sha === target.candidate_sha);

  const seed = digest({
    target_evidence_digest: target.evidence_digest,
    reaction_norm_profile_digest: reaction?.profile_digest || null,
    contrast_digests: contrasts.map((row) => row.contrast_digest).sort(),
    generation: gen,
  });

  const proposals = [];
  proposals.push(zeroAuthority({
    proposal_id: proposalId(seed, 'CLONAL', target.task_id),
    operator: 'CLONAL',
    target_candidate_id: target.candidate_id,
    target_candidate_sha: target.candidate_sha,
    evidence_digests: [target.evidence_digest],
    task_ids: [target.task_id],
    failure_codes: [...target.failure_codes],
    transferable_mechanism_codes: [],
    rationale_source: 'SINGLE_EXTERNALLY_VERIFIED_FAILURE',
    candidate_can_materialize_directly: false,
    candidate_can_select_operator: false,
    proposal_is_scheduler_authority: false,
  }));

  if (reaction?.genotype_level_defect_signal === true) {
    proposals.push(zeroAuthority({
      proposal_id: proposalId(seed, 'REACTION_NORM', reaction.profile_digest),
      operator: 'REACTION_NORM',
      target_candidate_id: target.candidate_id,
      target_candidate_sha: target.candidate_sha,
      evidence_digests: [...reaction.evidence_digests],
      task_ids: [],
      failure_codes: reaction.recurring_failure_codes.map((row) => row.code),
      transferable_mechanism_codes: reaction.recurring_success_mechanism_codes.map((row) => row.code),
      rationale_source: 'MULTI_TASK_RECURRING_EXTERNAL_EVIDENCE',
      candidate_can_materialize_directly: false,
      candidate_can_select_operator: false,
      proposal_is_scheduler_authority: false,
    }));
  }

  if (contrasts.length > 0) {
    const best = contrasts
      .slice()
      .sort((a,b) =>
        b.reference_success_mechanism_codes.length - a.reference_success_mechanism_codes.length
        || a.reference_candidate_id.localeCompare(b.reference_candidate_id)
      )[0];
    proposals.push(zeroAuthority({
      proposal_id: proposalId(seed, 'CROSS_LINEAGE_HYBRID', best.contrast_digest),
      operator: 'CROSS_LINEAGE_HYBRID',
      target_candidate_id: target.candidate_id,
      target_candidate_sha: target.candidate_sha,
      reference_candidate_id: best.reference_candidate_id,
      reference_candidate_sha: best.reference_candidate_sha,
      evidence_digests: [best.target_evidence_digest, best.reference_evidence_digest].sort(),
      task_ids: [best.task_id],
      failure_codes: [...best.target_failure_codes],
      transferable_mechanism_codes: [...best.reference_success_mechanism_codes],
      rationale_source: 'SAME_TASK_FAIL_VS_PASS_CROSS_LINEAGE_CONTRAST',
      candidate_can_materialize_directly: false,
      candidate_can_select_reference: false,
      candidate_can_select_operator: false,
      proposal_is_scheduler_authority: false,
    }));
  }

  const priority = new Map([
    ['REACTION_NORM', 0],
    ['CROSS_LINEAGE_HYBRID', 1],
    ['CLONAL', 2],
  ]);
  proposals.sort((a,b) => (priority.get(a.operator) ?? 9) - (priority.get(b.operator) ?? 9) || a.proposal_id.localeCompare(b.proposal_id));
  const selected = proposals.slice(0, max);
  const core = {
    schema: RSI_COMPARATIVE_MUTATION_PORTFOLIO_SCHEMA,
    version: 1,
    generation: gen,
    target_candidate_id: target.candidate_id,
    target_candidate_sha: target.candidate_sha,
    target_evidence_digest: target.evidence_digest,
    proposals: selected,
    proposal_count: selected.length,
    supported_operators: [...OPERATORS],
    comparative_evidence_preferred_when_available: true,
    clonal_fallback_preserved: true,
    reaction_norm_requires_multi_task_evidence: true,
    cross_lineage_requires_same_task_fail_pass: true,
    raw_trajectory_shared_with_candidate: false,
    mutation_plan_materialization_external: true,
    scheduler_action_authorized: false,
    candidate_can_select_operator: false,
    candidate_can_select_reference: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, portfolio_digest: digest(core) });
}

export function verifyRsiComparativeMutationPortfolio(portfolio) {
  if (!plainObject(portfolio) || portfolio.schema !== RSI_COMPARATIVE_MUTATION_PORTFOLIO_SCHEMA || portfolio.version !== 1) throw new Error('rsi_lineage_portfolio_invalid');
  assertZeroAuthority(portfolio, 'portfolio');
  if (
    portfolio.comparative_evidence_preferred_when_available !== true
    || portfolio.clonal_fallback_preserved !== true
    || portfolio.reaction_norm_requires_multi_task_evidence !== true
    || portfolio.cross_lineage_requires_same_task_fail_pass !== true
    || portfolio.raw_trajectory_shared_with_candidate !== false
    || portfolio.mutation_plan_materialization_external !== true
    || portfolio.scheduler_action_authorized !== false
    || portfolio.candidate_can_select_operator !== false
    || portfolio.candidate_can_select_reference !== false
  ) throw new Error('rsi_lineage_portfolio_policy_invalid');
  if (!Array.isArray(portfolio.proposals) || portfolio.proposals.length < 1 || portfolio.proposals.length > 3 || portfolio.proposal_count !== portfolio.proposals.length) {
    throw new Error('rsi_lineage_portfolio_proposals_invalid');
  }
  for (const proposal of portfolio.proposals) {
    assertZeroAuthority(proposal, 'proposal');
    if (!OPERATORS.includes(proposal.operator) || proposal.candidate_can_materialize_directly !== false || proposal.candidate_can_select_operator !== false || proposal.proposal_is_scheduler_authority !== false) {
      throw new Error('rsi_lineage_proposal_policy_invalid');
    }
  }
  const clone = structuredClone(portfolio);
  delete clone.portfolio_digest;
  if (exactDigest(portfolio.portfolio_digest, 'portfolio') !== digest(clone)) throw new Error('rsi_lineage_portfolio_digest_mismatch');
  return portfolio;
}

export function rsiComparativeLineageTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.comparative-lineage-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-comparative-lineage-operators.mjs',
    operators: [...OPERATORS],
    reaction_norm_requires_multi_task_evidence: true,
    cross_lineage_requires_same_task_fail_pass: true,
    raw_trajectory_shared_with_candidate: false,
    external_evaluator_required: true,
    candidate_can_select_operator: false,
    candidate_can_select_reference: false,
    mutation_plan_materialization_external: true,
    scheduler_action_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, lineage_root_digest: digest(root) });
}
