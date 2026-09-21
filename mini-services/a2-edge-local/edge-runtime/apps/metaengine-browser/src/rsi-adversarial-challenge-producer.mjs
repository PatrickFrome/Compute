import crypto from 'node:crypto';

import {
  createRsiCurriculumChallenge,
  verifyRsiCurriculumChallenge,
} from './rsi-open-ended-search-policy.mjs';

export const RSI_CHALLENGE_SOURCE_EVIDENCE_SCHEMA = 'metaengine.rsi.challenge-source-evidence.v1';
export const RSI_ADVERSARIAL_CHALLENGE_PROPOSAL_SCHEMA = 'metaengine.rsi.adversarial-challenge-proposal.v1';
export const RSI_CHALLENGE_MATERIALIZATION_RECEIPT_SCHEMA = 'metaengine.rsi.challenge-materialization-receipt.v1';
export const RSI_ADVERSARIAL_CHALLENGE_HANDOFF_SCHEMA = 'metaengine.rsi.adversarial-challenge-handoff.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_HISTORY = 64;
const MAX_EVIDENCE_REFS = 32;

const SOURCE_KINDS = Object.freeze({
  EVALUATOR_FAILURE: 'ADVERSARIAL',
  HARD_INVARIANT_NEAR_MISS: 'ADVERSARIAL',
  CROSS_MODEL_DISAGREEMENT: 'ADVERSARIAL',
  PRODUCTION_INCIDENT: 'PRODUCTION_INCIDENT',
  TRANSFER_REGRESSION: 'TRANSFER',
});

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_challenge_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_challenge_${label}_sha_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_challenge_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_challenge_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_challenge_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_challenge_${label}_invalid`);
  return out;
}

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) throw new Error(`rsi_challenge_${label}_invalid`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`rsi_challenge_${label}_fields_invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_challenge_${label}_fields_invalid`);
  }
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_challenge_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_challenge_${label}_automatic_retry_invalid`);
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

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_challenge_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_challenge_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function normalizeHistory(value) {
  if (!Array.isArray(value) || value.length > MAX_HISTORY) throw new Error('rsi_challenge_history_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const sha = exactSha(raw, 'history_candidate');
    if (seen.has(sha)) throw new Error('rsi_challenge_history_duplicate');
    seen.add(sha);
    return sha;
  }).sort();
}

function sourceClassFor(kind) {
  const sourceClass = SOURCE_KINDS[kind];
  if (!sourceClass) throw new Error('rsi_challenge_source_kind_invalid');
  return sourceClass;
}

export function createRsiChallengeSourceEvidence({
  source_id,
  source_kind,
  source_candidate_sha = null,
  baseline_sha,
  family,
  mechanism_tags,
  failure_codes,
  evidence_digest,
  evidence_refs,
  predecessor_history = [],
  external_verifier = false,
  authored_by_candidate = true,
} = {}) {
  if (external_verifier !== true || authored_by_candidate !== false) throw new Error('rsi_challenge_source_external_origin_required');
  const kind = boundedToken(source_kind, 'source_kind');
  sourceClassFor(kind);
  const history = normalizeHistory(predecessor_history);
  const candidateSha = source_candidate_sha == null ? null : exactSha(source_candidate_sha, 'source_candidate');
  const baseSha = exactSha(baseline_sha, 'baseline');
  if (candidateSha && candidateSha === baseSha) throw new Error('rsi_challenge_source_noop_candidate');
  const core = {
    schema: RSI_CHALLENGE_SOURCE_EVIDENCE_SCHEMA,
    version: 1,
    source_id: boundedId(source_id, 'source_id'),
    source_kind: kind,
    source_class: sourceClassFor(kind),
    source_candidate_sha: candidateSha,
    baseline_sha: baseSha,
    family: boundedToken(family, 'family'),
    mechanism_tags: (() => {
      if (!Array.isArray(mechanism_tags) || mechanism_tags.length < 1 || mechanism_tags.length > 16) throw new Error('rsi_challenge_mechanism_tags_invalid');
      return [...new Set(mechanism_tags.map((entry) => boundedToken(entry, 'mechanism_tag')))].sort();
    })(),
    failure_codes: (() => {
      if (!Array.isArray(failure_codes) || failure_codes.length < 1 || failure_codes.length > 16) throw new Error('rsi_challenge_failure_codes_invalid');
      return [...new Set(failure_codes.map((entry) => boundedToken(entry, 'failure_code')))].sort();
    })(),
    predecessor_history: history,
    predecessor_history_digest: digest(history),
    evidence_digest: exactDigest(evidence_digest, 'source_evidence'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_verifier: true,
    authored_by_candidate: false,
    raw_page_text_present: false,
    raw_user_input_present: false,
    secret_material_present: false,
    model_text_is_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, source_digest: digest(core) });
}

export function verifyRsiChallengeSourceEvidence(source) {
  exactKeys(source, [
    'schema','version','source_id','source_kind','source_class','source_candidate_sha','baseline_sha','family',
    'mechanism_tags','failure_codes','predecessor_history','predecessor_history_digest','evidence_digest','evidence_refs',
    'external_verifier','authored_by_candidate','raw_page_text_present','raw_user_input_present','secret_material_present',
    'model_text_is_authority','execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','automatic_retry_allowed','authority_effect','source_digest',
  ], [], 'source');
  if (source.schema !== RSI_CHALLENGE_SOURCE_EVIDENCE_SCHEMA || source.version !== 1) throw new Error('rsi_challenge_source_invalid');
  assertZeroAuthority(source, 'source');
  if (
    source.external_verifier !== true
    || source.authored_by_candidate !== false
    || source.raw_page_text_present !== false
    || source.raw_user_input_present !== false
    || source.secret_material_present !== false
    || source.model_text_is_authority !== false
  ) throw new Error('rsi_challenge_source_policy_invalid');
  const canonical = createRsiChallengeSourceEvidence({
    source_id: source.source_id,
    source_kind: source.source_kind,
    source_candidate_sha: source.source_candidate_sha,
    baseline_sha: source.baseline_sha,
    family: source.family,
    mechanism_tags: source.mechanism_tags,
    failure_codes: source.failure_codes,
    evidence_digest: source.evidence_digest,
    evidence_refs: source.evidence_refs,
    predecessor_history: source.predecessor_history,
    external_verifier: true,
    authored_by_candidate: false,
  });
  if (canonical.source_digest !== exactDigest(source.source_digest, 'source')) throw new Error('rsi_challenge_source_digest_mismatch');
  if (canonical.predecessor_history_digest !== exactDigest(source.predecessor_history_digest, 'history')) throw new Error('rsi_challenge_history_digest_mismatch');
  return canonical;
}

export function buildRsiAdversarialChallengeProposal({
  source_evidence,
  generation,
  requested_difficulty = 5,
} = {}) {
  const source = verifyRsiChallengeSourceEvidence(source_evidence);
  const gen = positiveInt(generation, 'generation', 1_000_000);
  const difficulty = positiveInt(requested_difficulty, 'difficulty', 10);
  const dynamicHistory = source.predecessor_history.length > 0
    || ['EVALUATOR_FAILURE', 'HARD_INVARIANT_NEAR_MISS', 'CROSS_MODEL_DISAGREEMENT'].includes(source.source_kind);
  const core = {
    schema: RSI_ADVERSARIAL_CHALLENGE_PROPOSAL_SCHEMA,
    version: 1,
    generation: gen,
    source_id: source.source_id,
    source_digest: source.source_digest,
    source_kind: source.source_kind,
    source_class: source.source_class,
    baseline_sha: source.baseline_sha,
    source_candidate_sha: source.source_candidate_sha,
    family: source.family,
    mechanism_tags: [...source.mechanism_tags],
    failure_codes: [...source.failure_codes],
    requested_difficulty: difficulty,
    predecessor_history_digest: source.predecessor_history_digest,
    predecessor_history_count: source.predecessor_history.length,
    challenge_dynamics: dynamicHistory ? 'GROWING_PREDECESSOR_HISTORY' : 'INCIDENT_REPRODUCTION',
    static_benchmark_only: false,
    candidate_can_select_opponents: false,
    candidate_can_select_expected_solution: false,
    hidden_manifest_required: true,
    external_materialization_required: true,
    trusted_evaluator_required: true,
    minimal_criterion_targeted: true,
    solution_exposed_to_candidate: false,
    task_manifest_exposed_to_candidate: false,
    no_live_production_adversary: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const proposalDigest = digest(core);
  return Object.freeze({
    ...core,
    proposal_id: `rsi_challenge_${proposalDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    proposal_digest: proposalDigest,
  });
}

export function verifyRsiAdversarialChallengeProposal(proposal) {
  exactKeys(proposal, [
    'schema','version','generation','source_id','source_digest','source_kind','source_class','baseline_sha',
    'source_candidate_sha','family','mechanism_tags','failure_codes','requested_difficulty','predecessor_history_digest',
    'predecessor_history_count','challenge_dynamics','static_benchmark_only','candidate_can_select_opponents',
    'candidate_can_select_expected_solution','hidden_manifest_required','external_materialization_required',
    'trusted_evaluator_required','minimal_criterion_targeted','solution_exposed_to_candidate',
    'task_manifest_exposed_to_candidate','no_live_production_adversary','execution_authority',
    'production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed',
    'authority_effect','proposal_id','proposal_digest',
  ], [], 'proposal');
  if (proposal.schema !== RSI_ADVERSARIAL_CHALLENGE_PROPOSAL_SCHEMA || proposal.version !== 1) {
    throw new Error('rsi_challenge_proposal_invalid');
  }
  assertZeroAuthority(proposal, 'proposal');
  if (
    proposal.static_benchmark_only !== false
    || proposal.candidate_can_select_opponents !== false
    || proposal.candidate_can_select_expected_solution !== false
    || proposal.hidden_manifest_required !== true
    || proposal.external_materialization_required !== true
    || proposal.trusted_evaluator_required !== true
    || proposal.minimal_criterion_targeted !== true
    || proposal.solution_exposed_to_candidate !== false
    || proposal.task_manifest_exposed_to_candidate !== false
    || proposal.no_live_production_adversary !== true
  ) throw new Error('rsi_challenge_proposal_policy_invalid');
  exactDigest(proposal.source_digest, 'proposal_source');
  exactDigest(proposal.predecessor_history_digest, 'proposal_history');
  exactSha(proposal.baseline_sha, 'proposal_baseline');
  if (proposal.source_candidate_sha != null) exactSha(proposal.source_candidate_sha, 'proposal_candidate');
  sourceClassFor(boundedToken(proposal.source_kind, 'proposal_source_kind'));
  positiveInt(proposal.generation, 'proposal_generation', 1_000_000);
  positiveInt(proposal.requested_difficulty, 'proposal_difficulty', 10);
  nonNegativeInt(proposal.predecessor_history_count, 'proposal_history_count', MAX_HISTORY);
  const clone = structuredClone(proposal);
  delete clone.proposal_id;
  delete clone.proposal_digest;
  const expected = digest(clone);
  if (proposal.proposal_digest !== expected || proposal.proposal_id !== `rsi_challenge_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
    throw new Error('rsi_challenge_proposal_digest_mismatch');
  }
  return proposal;
}

export function createRsiChallengeMaterializationReceipt({
  proposal,
  suite_digest,
  hidden_manifest_digest,
  environment_fingerprint,
  attempted_count = 0,
  solved_count = 0,
  exact_predecessor_history_digest,
  sandbox_backend,
  external_materializer = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiAdversarialChallengeProposal(proposal);
  if (external_materializer !== true || authored_by_candidate !== false) throw new Error('rsi_challenge_materialization_external_origin_required');
  const attempted = nonNegativeInt(attempted_count, 'materialization_attempted', 1_000_000);
  const solved = nonNegativeInt(solved_count, 'materialization_solved', attempted);
  const core = {
    schema: RSI_CHALLENGE_MATERIALIZATION_RECEIPT_SCHEMA,
    version: 1,
    proposal_id: checked.proposal_id,
    proposal_digest: checked.proposal_digest,
    suite_digest: exactDigest(suite_digest, 'materialization_suite'),
    hidden_manifest_digest: exactDigest(hidden_manifest_digest, 'materialization_manifest'),
    environment_fingerprint: boundedId(environment_fingerprint, 'environment_fingerprint'),
    attempted_count: attempted,
    solved_count: solved,
    exact_predecessor_history_digest: exactDigest(exact_predecessor_history_digest, 'materialization_history'),
    sandbox_backend: boundedToken(sandbox_backend, 'sandbox_backend'),
    external_materializer: true,
    authored_by_candidate: false,
    hidden_manifest_verified: true,
    candidate_visible_manifest: false,
    expected_solution_exposed: false,
    live_production_target: false,
    network_default_deny: true,
    host_repository_mounted: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  if (core.exact_predecessor_history_digest !== checked.predecessor_history_digest) throw new Error('rsi_challenge_materialization_history_mismatch');
  if (core.suite_digest === core.hidden_manifest_digest) throw new Error('rsi_challenge_materialization_suite_manifest_alias');
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function finalizeRsiAdversarialChallenge({ source_evidence, proposal, materialization_receipt } = {}) {
  const source = verifyRsiChallengeSourceEvidence(source_evidence);
  const checkedProposal = verifyRsiAdversarialChallengeProposal(proposal);
  if (checkedProposal.source_digest !== source.source_digest) throw new Error('rsi_challenge_finalize_source_mismatch');
  const receipt = materialization_receipt;
  exactKeys(receipt, [
    'schema','version','proposal_id','proposal_digest','suite_digest','hidden_manifest_digest',
    'environment_fingerprint','attempted_count','solved_count','exact_predecessor_history_digest','sandbox_backend',
    'external_materializer','authored_by_candidate','hidden_manifest_verified','candidate_visible_manifest',
    'expected_solution_exposed','live_production_target','network_default_deny','host_repository_mounted',
    'execution_authority','production_mutation_authority','promotion_authority','self_update_authority',
    'automatic_retry_allowed','authority_effect','receipt_digest',
  ], [], 'materialization');
  if (receipt.schema !== RSI_CHALLENGE_MATERIALIZATION_RECEIPT_SCHEMA || receipt.version !== 1) {
    throw new Error('rsi_challenge_materialization_invalid');
  }
  assertZeroAuthority(receipt, 'materialization');
  if (
    receipt.external_materializer !== true
    || receipt.authored_by_candidate !== false
    || receipt.hidden_manifest_verified !== true
    || receipt.candidate_visible_manifest !== false
    || receipt.expected_solution_exposed !== false
    || receipt.live_production_target !== false
    || receipt.network_default_deny !== true
    || receipt.host_repository_mounted !== false
  ) throw new Error('rsi_challenge_materialization_policy_invalid');
  const canonicalReceipt = createRsiChallengeMaterializationReceipt({
    proposal: checkedProposal,
    suite_digest: receipt.suite_digest,
    hidden_manifest_digest: receipt.hidden_manifest_digest,
    environment_fingerprint: receipt.environment_fingerprint,
    attempted_count: receipt.attempted_count,
    solved_count: receipt.solved_count,
    exact_predecessor_history_digest: receipt.exact_predecessor_history_digest,
    sandbox_backend: receipt.sandbox_backend,
    external_materializer: true,
    authored_by_candidate: false,
  });
  if (canonicalReceipt.receipt_digest !== exactDigest(receipt.receipt_digest, 'materialization_receipt')) {
    throw new Error('rsi_challenge_materialization_digest_mismatch');
  }

  const challenge = createRsiCurriculumChallenge({
    challenge_id: checkedProposal.proposal_id,
    family: checkedProposal.family,
    difficulty: checkedProposal.requested_difficulty,
    source_class: checkedProposal.source_class,
    suite_digest: canonicalReceipt.suite_digest,
    hidden_manifest_digest: canonicalReceipt.hidden_manifest_digest,
    attempted_count: canonicalReceipt.attempted_count,
    solved_count: canonicalReceipt.solved_count,
    external_origin_verified: true,
    authored_by_candidate: false,
  });
  verifyRsiCurriculumChallenge(challenge);

  const core = {
    schema: RSI_ADVERSARIAL_CHALLENGE_HANDOFF_SCHEMA,
    version: 1,
    proposal_id: checkedProposal.proposal_id,
    proposal_digest: checkedProposal.proposal_digest,
    source_digest: source.source_digest,
    materialization_receipt_digest: canonicalReceipt.receipt_digest,
    challenge,
    challenge_digest: challenge.challenge_digest,
    dynamics: checkedProposal.challenge_dynamics,
    predecessor_history_digest: checkedProposal.predecessor_history_digest,
    environment_fingerprint: canonicalReceipt.environment_fingerprint,
    sandbox_backend: canonicalReceipt.sandbox_backend,
    eligible_for_curriculum: true,
    eligible_for_live_adversarial_execution: false,
    candidate_can_see_hidden_manifest: false,
    candidate_can_see_expected_solution: false,
    candidate_can_select_opponents: false,
    external_evaluator_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, handoff_digest: digest(core) });
}

export function rsiAdversarialChallengeTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.adversarial-challenge-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-adversarial-challenge-producer.mjs',
    source_kinds: Object.keys(SOURCE_KINDS).sort(),
    source_classes: [...new Set(Object.values(SOURCE_KINDS))].sort(),
    growing_predecessor_history: true,
    production_incident_reproduction: true,
    hidden_manifest_required: true,
    external_materialization_required: true,
    candidate_can_author_source_evidence: false,
    candidate_can_select_opponents: false,
    candidate_can_select_expected_solution: false,
    live_production_adversary_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, challenge_root_digest: digest(root) });
}
