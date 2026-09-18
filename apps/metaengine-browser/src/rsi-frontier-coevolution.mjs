import crypto from 'node:crypto';

import {
  createRsiCurriculumChallenge,
  verifyRsiCurriculumChallenge,
} from './rsi-open-ended-search-policy.mjs';

export const RSI_FRONTIER_TASK_PROPOSAL_SCHEMA = 'metaengine.rsi.frontier-task-proposal.v1';
export const RSI_FRONTIER_TASK_MATERIALIZATION_SCHEMA = 'metaengine.rsi.frontier-task-materialization.v1';
export const RSI_FRONTIER_LEARNABILITY_SCHEMA = 'metaengine.rsi.frontier-learnability.v1';
export const RSI_FRONTIER_TASK_HANDOFF_SCHEMA = 'metaengine.rsi.frontier-task-handoff.v1';
export const RSI_FRONTIER_BUFFER_SCHEMA = 'metaengine.rsi.frontier-task-buffer.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MODES = Object.freeze(['DEDUCTION', 'ABDUCTION', 'INDUCTION']);
const TOOL_CLASSES = Object.freeze(['READ_ONLY', 'PROPOSAL_ONLY']);
const MAX_ANCHORS = 16;
const MAX_TOOL_CLASSES = 4;
const MAX_PANEL_MODELS = 8;
const MAX_EVIDENCE_REFS = 32;
const MAX_BUFFER_TASKS = 512;
const FRONTIER_MIN_SOLVE_RATE = 0.125;
const FRONTIER_MAX_SOLVE_RATE = 0.875;
const FRONTIER_MIN_NOVELTY = 0.20;
const DIVERSITY_MIN_TASKS = 4;
const DIVERSITY_MAX_SINGLE_MODE_FRACTION = 0.75;

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_frontier_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_frontier_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_frontier_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_frontier_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_frontier_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_frontier_${label}_invalid`);
  return out;
}

function normalizeMode(value) {
  const out = boundedToken(value, 'mode');
  if (!MODES.includes(out)) throw new Error('rsi_frontier_mode_invalid');
  return out;
}

function normalizeToolClasses(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TOOL_CLASSES) throw new Error('rsi_frontier_tool_classes_invalid');
  const seen = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, 'tool_class');
    if (!TOOL_CLASSES.includes(token)) throw new Error('rsi_frontier_tool_class_invalid');
    if (seen.has(token)) throw new Error('rsi_frontier_tool_class_duplicate');
    seen.add(token);
  }
  return [...seen].sort();
}

function normalizeDigests(value, label, max = MAX_ANCHORS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error(`rsi_frontier_${label}_invalid`);
  const seen = new Set();
  for (const raw of value) {
    const row = exactDigest(raw, label);
    if (seen.has(row)) throw new Error(`rsi_frontier_${label}_duplicate`);
    seen.add(row);
  }
  return [...seen].sort();
}

function normalizeTokens(value, label, max = MAX_PANEL_MODELS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error(`rsi_frontier_${label}_invalid`);
  const seen = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, label);
    if (seen.has(token)) throw new Error(`rsi_frontier_${label}_duplicate`);
    seen.add(token);
  }
  return [...seen].sort();
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_frontier_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_frontier_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
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

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_frontier_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_frontier_${label}_automatic_retry_invalid`);
}

export function createRsiFrontierTaskProposal({
  proposal_id,
  generation,
  mode,
  family,
  target_difficulty,
  proposer_model_family,
  proposer_role = 'CURRICULUM_AGENT',
  source_anchor_digests,
  tool_capability_classes = ['READ_ONLY'],
  executor_authored = false,
} = {}) {
  const role = boundedToken(proposer_role, 'proposer_role');
  if (role !== 'CURRICULUM_AGENT' && role !== 'SHARED_SELF_PLAY_MODEL') throw new Error('rsi_frontier_proposer_role_invalid');
  const core = {
    schema: RSI_FRONTIER_TASK_PROPOSAL_SCHEMA,
    version: 1,
    proposal_id: boundedId(proposal_id, 'proposal_id'),
    generation: positiveInt(generation, 'generation', 1_000_000),
    mode: normalizeMode(mode),
    family: boundedToken(family, 'family'),
    target_difficulty: positiveInt(target_difficulty, 'target_difficulty', 10),
    proposer_model_family: boundedToken(proposer_model_family, 'proposer_model_family'),
    proposer_role: role,
    source_anchor_digests: normalizeDigests(source_anchor_digests, 'source_anchor'),
    tool_capability_classes: normalizeToolClasses(tool_capability_classes),
    executor_authored: executor_authored === true,
    proposal_is_untrusted_until_external_materialization: true,
    proposer_is_verifier: false,
    proposer_is_promotion_authority: false,
    candidate_can_self_admit_task: false,
    raw_task_content_in_trust_root: false,
    direct_tool_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, proposal_digest: digest(core) });
}

export function verifyRsiFrontierTaskProposal(proposal) {
  if (!plainObject(proposal) || proposal.schema !== RSI_FRONTIER_TASK_PROPOSAL_SCHEMA || proposal.version !== 1) throw new Error('rsi_frontier_proposal_invalid');
  assertZeroAuthority(proposal, 'proposal');
  if (
    proposal.proposal_is_untrusted_until_external_materialization !== true
    || proposal.proposer_is_verifier !== false
    || proposal.proposer_is_promotion_authority !== false
    || proposal.candidate_can_self_admit_task !== false
    || proposal.raw_task_content_in_trust_root !== false
    || proposal.direct_tool_execution_authority !== false
  ) throw new Error('rsi_frontier_proposal_policy_invalid');
  const canonical = createRsiFrontierTaskProposal({
    proposal_id: proposal.proposal_id,
    generation: proposal.generation,
    mode: proposal.mode,
    family: proposal.family,
    target_difficulty: proposal.target_difficulty,
    proposer_model_family: proposal.proposer_model_family,
    proposer_role: proposal.proposer_role,
    source_anchor_digests: proposal.source_anchor_digests,
    tool_capability_classes: proposal.tool_capability_classes,
    executor_authored: proposal.executor_authored,
  });
  if (canonical.proposal_digest !== exactDigest(proposal.proposal_digest, 'proposal')) throw new Error('rsi_frontier_proposal_digest_mismatch');
  return canonical;
}

export function createRsiFrontierTaskMaterializationReceipt({
  proposal,
  suite_digest,
  hidden_manifest_digest,
  oracle_digest,
  semantic_contract_digest,
  sandbox_backend,
  deterministic_replay_count,
  deterministic_outputs_match,
  forbidden_capability_scan_pass,
  network_default_deny = true,
  host_repository_mounted = false,
  external_materializer = false,
  authored_by_executor = true,
  evidence_refs,
} = {}) {
  const checked = verifyRsiFrontierTaskProposal(proposal);
  if (external_materializer !== true || authored_by_executor !== false) throw new Error('rsi_frontier_materialization_external_origin_required');
  const suite = exactDigest(suite_digest, 'suite');
  const manifest = exactDigest(hidden_manifest_digest, 'hidden_manifest');
  const oracle = exactDigest(oracle_digest, 'oracle');
  const semantic = exactDigest(semantic_contract_digest, 'semantic_contract');
  if (new Set([suite, manifest, oracle, semantic]).size !== 4) throw new Error('rsi_frontier_materialization_digest_alias');
  if (deterministic_outputs_match !== true || forbidden_capability_scan_pass !== true || network_default_deny !== true || host_repository_mounted !== false) {
    throw new Error('rsi_frontier_materialization_policy_invalid');
  }
  const core = {
    schema: RSI_FRONTIER_TASK_MATERIALIZATION_SCHEMA,
    version: 1,
    proposal_id: checked.proposal_id,
    proposal_digest: checked.proposal_digest,
    suite_digest: suite,
    hidden_manifest_digest: manifest,
    oracle_digest: oracle,
    semantic_contract_digest: semantic,
    sandbox_backend: boundedToken(sandbox_backend, 'sandbox_backend'),
    deterministic_replay_count: positiveInt(deterministic_replay_count, 'deterministic_replay_count', 32),
    deterministic_outputs_match: true,
    forbidden_capability_scan_pass: true,
    network_default_deny: true,
    host_repository_mounted: false,
    external_materializer: true,
    authored_by_executor: false,
    hidden_manifest_visible_to_proposer: false,
    oracle_visible_to_proposer: false,
    hidden_manifest_visible_to_executor: false,
    oracle_visible_to_executor: false,
    candidate_can_mutate_verifier: false,
    candidate_can_select_oracle: false,
    benchmark_promotion_evidence: false,
    evidence_refs: evidenceRefs(evidence_refs),
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, materialization_digest: digest(core) });
}

export function verifyRsiFrontierTaskMaterializationReceipt(receipt, proposal) {
  if (!plainObject(receipt) || receipt.schema !== RSI_FRONTIER_TASK_MATERIALIZATION_SCHEMA || receipt.version !== 1) throw new Error('rsi_frontier_materialization_invalid');
  assertZeroAuthority(receipt, 'materialization');
  const checkedProposal = verifyRsiFrontierTaskProposal(proposal);
  if (
    receipt.proposal_id !== checkedProposal.proposal_id
    || receipt.proposal_digest !== checkedProposal.proposal_digest
    || receipt.deterministic_outputs_match !== true
    || receipt.forbidden_capability_scan_pass !== true
    || receipt.network_default_deny !== true
    || receipt.host_repository_mounted !== false
    || receipt.external_materializer !== true
    || receipt.authored_by_executor !== false
    || receipt.hidden_manifest_visible_to_proposer !== false
    || receipt.oracle_visible_to_proposer !== false
    || receipt.hidden_manifest_visible_to_executor !== false
    || receipt.oracle_visible_to_executor !== false
    || receipt.candidate_can_mutate_verifier !== false
    || receipt.candidate_can_select_oracle !== false
    || receipt.benchmark_promotion_evidence !== false
  ) throw new Error('rsi_frontier_materialization_policy_invalid');
  const canonical = createRsiFrontierTaskMaterializationReceipt({
    proposal: checkedProposal,
    suite_digest: receipt.suite_digest,
    hidden_manifest_digest: receipt.hidden_manifest_digest,
    oracle_digest: receipt.oracle_digest,
    semantic_contract_digest: receipt.semantic_contract_digest,
    sandbox_backend: receipt.sandbox_backend,
    deterministic_replay_count: receipt.deterministic_replay_count,
    deterministic_outputs_match: true,
    forbidden_capability_scan_pass: true,
    network_default_deny: true,
    host_repository_mounted: false,
    external_materializer: true,
    authored_by_executor: false,
    evidence_refs: receipt.evidence_refs,
  });
  if (canonical.materialization_digest !== exactDigest(receipt.materialization_digest, 'materialization')) throw new Error('rsi_frontier_materialization_digest_mismatch');
  return canonical;
}

export function createRsiFrontierLearnabilityReceipt({
  proposal,
  materialization,
  executor_snapshot_digest,
  panel_model_families,
  solve_attempts,
  solve_successes,
  novelty_score,
  previous_buffer_digest = null,
  external_evaluator = false,
  authored_by_executor = true,
  evidence_refs,
} = {}) {
  const checkedProposal = verifyRsiFrontierTaskProposal(proposal);
  const checkedMaterialization = verifyRsiFrontierTaskMaterializationReceipt(materialization, checkedProposal);
  if (external_evaluator !== true || authored_by_executor !== false) throw new Error('rsi_frontier_learnability_external_origin_required');
  const attempts = positiveInt(solve_attempts, 'solve_attempts', 4096);
  if (attempts < 8) throw new Error('rsi_frontier_learnability_min_attempts');
  const successes = nonNegativeInt(solve_successes, 'solve_successes', attempts);
  const rate = successes / attempts;
  const novelty = unitInterval(novelty_score, 'novelty_score');
  const learnability = successes === 0 || successes === attempts ? 0 : 1 - rate;
  const frontierBalance = 4 * rate * (1 - rate);
  const minimalCriterion = rate >= FRONTIER_MIN_SOLVE_RATE && rate <= FRONTIER_MAX_SOLVE_RATE;
  const noveltyPass = novelty >= FRONTIER_MIN_NOVELTY;
  const admissible = minimalCriterion && noveltyPass;
  const core = {
    schema: RSI_FRONTIER_LEARNABILITY_SCHEMA,
    version: 1,
    proposal_id: checkedProposal.proposal_id,
    proposal_digest: checkedProposal.proposal_digest,
    mode: checkedProposal.mode,
    family: checkedProposal.family,
    materialization_digest: checkedMaterialization.materialization_digest,
    executor_snapshot_digest: exactDigest(executor_snapshot_digest, 'executor_snapshot'),
    panel_model_families: normalizeTokens(panel_model_families, 'panel_model_family'),
    solve_attempts: attempts,
    solve_successes: successes,
    solve_rate: rate,
    novelty_score: novelty,
    azr_style_learnability_reward: learnability,
    frontier_balance_score: frontierBalance,
    frontier_min_solve_rate: FRONTIER_MIN_SOLVE_RATE,
    frontier_max_solve_rate: FRONTIER_MAX_SOLVE_RATE,
    frontier_min_novelty: FRONTIER_MIN_NOVELTY,
    minimal_criterion_pass: minimalCriterion,
    novelty_gate_pass: noveltyPass,
    state: admissible ? 'FRONTIER_ADMISSIBLE' : 'HELD_NOT_FRONTIER',
    previous_buffer_digest: previous_buffer_digest == null ? null : exactDigest(previous_buffer_digest, 'previous_buffer'),
    external_evaluator: true,
    authored_by_executor: false,
    proposer_score_is_promotion_authority: false,
    solver_score_is_promotion_authority: false,
    evaluator_is_proposer: false,
    evaluator_is_executor: false,
    no_alpha_spent_for_curriculum_screening: true,
    evidence_refs: evidenceRefs(evidence_refs),
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, learnability_digest: digest(core) });
}

export function verifyRsiFrontierLearnabilityReceipt(receipt, proposal, materialization) {
  if (!plainObject(receipt) || receipt.schema !== RSI_FRONTIER_LEARNABILITY_SCHEMA || receipt.version !== 1) throw new Error('rsi_frontier_learnability_invalid');
  assertZeroAuthority(receipt, 'learnability');
  if (
    receipt.external_evaluator !== true
    || receipt.authored_by_executor !== false
    || receipt.proposer_score_is_promotion_authority !== false
    || receipt.solver_score_is_promotion_authority !== false
    || receipt.evaluator_is_proposer !== false
    || receipt.evaluator_is_executor !== false
    || receipt.no_alpha_spent_for_curriculum_screening !== true
  ) throw new Error('rsi_frontier_learnability_policy_invalid');
  const canonical = createRsiFrontierLearnabilityReceipt({
    proposal,
    materialization,
    executor_snapshot_digest: receipt.executor_snapshot_digest,
    panel_model_families: receipt.panel_model_families,
    solve_attempts: receipt.solve_attempts,
    solve_successes: receipt.solve_successes,
    novelty_score: receipt.novelty_score,
    previous_buffer_digest: receipt.previous_buffer_digest,
    external_evaluator: true,
    authored_by_executor: false,
    evidence_refs: receipt.evidence_refs,
  });
  if (canonical.learnability_digest !== exactDigest(receipt.learnability_digest, 'learnability')) throw new Error('rsi_frontier_learnability_digest_mismatch');
  return canonical;
}

export function finalizeRsiFrontierTask({
  proposal,
  materialization,
  learnability,
} = {}) {
  const checkedProposal = verifyRsiFrontierTaskProposal(proposal);
  const checkedMaterialization = verifyRsiFrontierTaskMaterializationReceipt(materialization, checkedProposal);
  const checkedLearnability = verifyRsiFrontierLearnabilityReceipt(learnability, checkedProposal, checkedMaterialization);

  if (checkedLearnability.state !== 'FRONTIER_ADMISSIBLE') {
    const core = {
      schema: RSI_FRONTIER_TASK_HANDOFF_SCHEMA,
      version: 1,
      state: 'HELD_NOT_FRONTIER',
      proposal_id: checkedProposal.proposal_id,
      proposal_digest: checkedProposal.proposal_digest,
      mode: checkedProposal.mode,
      family: checkedProposal.family,
      materialization_digest: checkedMaterialization.materialization_digest,
      learnability_digest: checkedLearnability.learnability_digest,
      challenge: null,
      eligible_for_curriculum: false,
      eligible_as_promotion_benchmark: false,
      eligible_for_trusted_memory_ingest: false,
      eligible_for_skill_library_ingest: false,
      benchmark_provenance_admission_required_for_promotion_evidence: true,
      external_curriculum_selection_still_required: true,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, handoff_digest: digest(core) });
  }

  const challenge = createRsiCurriculumChallenge({
    challenge_id: `frontier.${checkedProposal.proposal_id}`,
    family: checkedProposal.family,
    difficulty: checkedProposal.target_difficulty,
    source_class: 'SYNTHETIC_CURRICULUM',
    suite_digest: checkedMaterialization.suite_digest,
    hidden_manifest_digest: checkedMaterialization.hidden_manifest_digest,
    attempted_count: checkedLearnability.solve_attempts,
    solved_count: checkedLearnability.solve_successes,
    external_origin_verified: true,
    authored_by_candidate: false,
  });
  verifyRsiCurriculumChallenge(challenge);

  const core = {
    schema: RSI_FRONTIER_TASK_HANDOFF_SCHEMA,
    version: 1,
    state: 'ADMITTED_SYNTHETIC_FRONTIER_CURRICULUM',
    proposal_id: checkedProposal.proposal_id,
    proposal_digest: checkedProposal.proposal_digest,
    mode: checkedProposal.mode,
    family: checkedProposal.family,
    materialization_digest: checkedMaterialization.materialization_digest,
    learnability_digest: checkedLearnability.learnability_digest,
    challenge,
    eligible_for_curriculum: true,
    eligible_as_promotion_benchmark: false,
    eligible_for_trusted_memory_ingest: false,
    eligible_for_skill_library_ingest: false,
    benchmark_provenance_admission_required_for_promotion_evidence: true,
    external_curriculum_selection_still_required: true,
    self_play_task_is_promotion_evidence: false,
    proposer_cannot_self_certify_task: true,
    executor_cannot_self_certify_task: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, handoff_digest: digest(core) });
}

export function verifyRsiFrontierTaskHandoff(handoff, proposal, materialization, learnability) {
  if (!plainObject(handoff) || handoff.schema !== RSI_FRONTIER_TASK_HANDOFF_SCHEMA || handoff.version !== 1) throw new Error('rsi_frontier_handoff_invalid');
  assertZeroAuthority(handoff, 'handoff');
  const canonical = finalizeRsiFrontierTask({ proposal, materialization, learnability });
  if (canonical.handoff_digest !== exactDigest(handoff.handoff_digest, 'handoff')) throw new Error('rsi_frontier_handoff_digest_mismatch');
  if (handoff.eligible_as_promotion_benchmark !== false || handoff.eligible_for_trusted_memory_ingest !== false || handoff.eligible_for_skill_library_ingest !== false || handoff.benchmark_provenance_admission_required_for_promotion_evidence !== true) {
    throw new Error('rsi_frontier_handoff_policy_invalid');
  }
  return canonical;
}

export function createRsiFrontierTaskBufferSnapshot({ generation, handoffs } = {}) {
  const gen = positiveInt(generation, 'buffer_generation', 1_000_000);
  if (!Array.isArray(handoffs) || handoffs.length < 1 || handoffs.length > MAX_BUFFER_TASKS) throw new Error('rsi_frontier_buffer_handoffs_invalid');
  const admitted = handoffs.filter((row) => plainObject(row) && row.schema === RSI_FRONTIER_TASK_HANDOFF_SCHEMA && row.state === 'ADMITTED_SYNTHETIC_FRONTIER_CURRICULUM');
  if (admitted.length !== handoffs.length) throw new Error('rsi_frontier_buffer_non_admitted_task');
  const ids = new Set();
  const suiteDigests = new Set();
  const manifestDigests = new Set();
  const modeCounts = Object.fromEntries(MODES.map((mode) => [mode, 0]));
  const familyCounts = {};
  const tasks = handoffs.map((row) => {
    assertZeroAuthority(row, 'buffer_handoff');
    if (!row.challenge || row.eligible_for_curriculum !== true || row.eligible_as_promotion_benchmark !== false) throw new Error('rsi_frontier_buffer_handoff_policy_invalid');
    verifyRsiCurriculumChallenge(row.challenge);
    if (ids.has(row.challenge.challenge_id)) throw new Error('rsi_frontier_buffer_task_duplicate');
    if (suiteDigests.has(row.challenge.suite_digest)) throw new Error('rsi_frontier_buffer_suite_duplicate');
    if (manifestDigests.has(row.challenge.hidden_manifest_digest)) throw new Error('rsi_frontier_buffer_manifest_duplicate');
    ids.add(row.challenge.challenge_id);
    suiteDigests.add(row.challenge.suite_digest);
    manifestDigests.add(row.challenge.hidden_manifest_digest);
    const mode = normalizeMode(row.mode);
    modeCounts[mode] += 1;
    familyCounts[row.challenge.family] = (familyCounts[row.challenge.family] || 0) + 1;
    return Object.freeze({
      challenge_id: row.challenge.challenge_id,
      challenge_digest: row.challenge.challenge_digest,
      family: row.challenge.family,
      mode,
      suite_digest: row.challenge.suite_digest,
      hidden_manifest_digest: row.challenge.hidden_manifest_digest,
      handoff_digest: row.handoff_digest,
      eligible_as_promotion_benchmark: false,
    });
  }).sort((a, b) => a.challenge_id.localeCompare(b.challenge_id));

  const taskCount = tasks.length;
  const maxModeFraction = Math.max(...Object.values(modeCounts)) / taskCount;
  const distinctModes = Object.values(modeCounts).filter((count) => count > 0).length;
  const distinctFamilies = Object.keys(familyCounts).length;
  const diversityRequired = taskCount >= DIVERSITY_MIN_TASKS;
  const diversityFloorPass = !diversityRequired || (distinctModes >= 2 && distinctFamilies >= 2 && maxModeFraction <= DIVERSITY_MAX_SINGLE_MODE_FRACTION);

  const core = {
    schema: RSI_FRONTIER_BUFFER_SCHEMA,
    version: 1,
    generation: gen,
    tasks,
    task_count: taskCount,
    mode_counts: modeCounts,
    family_counts: Object.fromEntries(Object.entries(familyCounts).sort(([a], [b]) => a.localeCompare(b))),
    distinct_mode_count: distinctModes,
    distinct_family_count: distinctFamilies,
    max_single_mode_fraction: maxModeFraction,
    diversity_floor_required: diversityRequired,
    diversity_floor_pass: diversityFloorPass,
    eligible_for_proposer_conditioning: diversityFloorPass,
    buffer_exposes_hidden_manifests: false,
    buffer_exposes_oracles: false,
    buffer_exposes_raw_task_content: false,
    buffer_tasks_are_promotion_evidence: false,
    candidate_can_select_buffer_tasks: false,
    candidate_can_relax_diversity_floor: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, buffer_digest: digest(core) });
}

export function verifyRsiFrontierTaskBufferSnapshot(snapshot) {
  if (!plainObject(snapshot) || snapshot.schema !== RSI_FRONTIER_BUFFER_SCHEMA || snapshot.version !== 1) throw new Error('rsi_frontier_buffer_invalid');
  assertZeroAuthority(snapshot, 'buffer');
  if (
    snapshot.buffer_exposes_hidden_manifests !== false
    || snapshot.buffer_exposes_oracles !== false
    || snapshot.buffer_exposes_raw_task_content !== false
    || snapshot.buffer_tasks_are_promotion_evidence !== false
    || snapshot.candidate_can_select_buffer_tasks !== false
    || snapshot.candidate_can_relax_diversity_floor !== false
  ) throw new Error('rsi_frontier_buffer_policy_invalid');
  const clone = structuredClone(snapshot);
  delete clone.buffer_digest;
  if (exactDigest(snapshot.buffer_digest, 'buffer') !== digest(clone)) throw new Error('rsi_frontier_buffer_digest_mismatch');
  return snapshot;
}

export function rsiFrontierCoevolutionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.frontier-coevolution-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-frontier-coevolution.mjs',
    modes: [...MODES],
    tool_classes: [...TOOL_CLASSES],
    frontier_min_solve_rate: FRONTIER_MIN_SOLVE_RATE,
    frontier_max_solve_rate: FRONTIER_MAX_SOLVE_RATE,
    frontier_min_novelty: FRONTIER_MIN_NOVELTY,
    proposer_may_share_model_family_with_executor: true,
    proposer_is_verifier: false,
    external_materializer_required: true,
    external_learnability_evaluator_required: true,
    deterministic_sandbox_replay_required: true,
    hidden_manifest_required: true,
    oracle_hidden_from_proposer_and_executor: true,
    self_play_task_is_promotion_evidence: false,
    benchmark_provenance_admission_required_for_promotion_evidence: true,
    buffer_diversity_floor_required: true,
    candidate_can_relax_frontier_thresholds: false,
    candidate_can_self_admit_task: false,
    candidate_can_select_buffer_tasks: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, frontier_root_digest: digest(root) });
}
