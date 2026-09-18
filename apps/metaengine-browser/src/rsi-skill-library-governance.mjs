import crypto from 'node:crypto';

import {
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';

export const RSI_SKILL_LIFECYCLE_EVIDENCE_SCHEMA = 'metaengine.rsi.skill-lifecycle-evidence.v1';
export const RSI_SKILL_LIBRARY_GOVERNANCE_SCHEMA = 'metaengine.rsi.skill-library-governance.v1';
export const RSI_SKILL_ACTIVATION_VIEW_SCHEMA = 'metaengine.rsi.skill-activation-view.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const AUTHORING_PRIORS = new Set(['VERIFIED_META_SKILL', 'VERIFIED_DIRECT_SKILL', 'LEGACY_IMPORTED']);
const STATES = new Set(['ACTIVE', 'EXPLORATION_ACTIVE', 'DORMANT_CAP', 'QUARANTINED', 'RETIRED']);
const MAX_WINDOWS = 4096;
const MAX_ACTIVE_SKILLS = 256;
const MAX_EVIDENCE_REFS = 32;
const EPSILON = 1e-12;

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_skill_governance_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_skill_governance_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_skill_governance_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_skill_governance_${label}_invalid`);
  return out;
}

function finiteNumber(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`rsi_skill_governance_${label}_invalid`);
  return out;
}

function unitInterval(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_skill_governance_${label}_invalid`);
  return out;
}

function normalizeRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) {
    throw new Error('rsi_skill_governance_evidence_refs_invalid');
  }
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_skill_governance_evidence_ref_duplicate');
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
    signing_authority: false,
    direct_tool_execution_authority: false,
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
    'signing_authority',
    'direct_tool_execution_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_skill_governance_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_skill_governance_${label}_automatic_retry_invalid`);
}

function authoringPrior(value) {
  const out = String(value || '').toUpperCase();
  if (!AUTHORING_PRIORS.has(out)) throw new Error('rsi_skill_governance_authoring_prior_invalid');
  return out;
}

function priorBonus(value) {
  switch (value) {
    case 'VERIFIED_META_SKILL': return 0.15;
    case 'VERIFIED_DIRECT_SKILL': return 0.05;
    default: return 0;
  }
}

function findEntry(library, skillDigest) {
  const digestValue = exactDigest(skillDigest, 'skill');
  const entry = library.entries.find((row) => row.skill_digest === digestValue);
  if (!entry) throw new Error('rsi_skill_governance_skill_not_in_library');
  return entry;
}

export function createRsiSkillLifecycleEvidence({
  library,
  evidence_id,
  skill_digest,
  window_seq,
  generation_start,
  generation_end,
  invocation_count,
  helpful_count,
  harmful_count,
  neutral_count,
  insufficient_evidence_count,
  router_engagement_count,
  false_positive_injection_count,
  hard_invariant_violation_count,
  measured_net_delta,
  authoring_prior,
  authoring_provenance_digest,
  evidence_refs,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedLibrary = verifyRsiVerifiedSkillLibrary(library);
  const entry = findEntry(checkedLibrary, skill_digest);
  if (external_evaluator !== true || authored_by_candidate !== false) {
    throw new Error('rsi_skill_governance_lifecycle_external_origin_required');
  }

  const sequence = positiveInt(window_seq, 'window_seq', 1_000_000);
  const start = positiveInt(generation_start, 'generation_start', 1_000_000);
  const end = positiveInt(generation_end, 'generation_end', 1_000_000);
  if (end < start) throw new Error('rsi_skill_governance_generation_window_invalid');

  const invocations = nonNegativeInt(invocation_count, 'invocation_count', 1_000_000);
  const helpful = nonNegativeInt(helpful_count, 'helpful_count', invocations);
  const harmful = nonNegativeInt(harmful_count, 'harmful_count', invocations);
  const neutral = nonNegativeInt(neutral_count, 'neutral_count', invocations);
  const insufficient = nonNegativeInt(insufficient_evidence_count, 'insufficient_evidence_count', invocations);
  if (helpful + harmful + neutral + insufficient !== invocations) {
    throw new Error('rsi_skill_governance_outcome_count_mismatch');
  }

  const engagements = nonNegativeInt(router_engagement_count, 'router_engagement_count', 1_000_000);
  if (engagements < invocations) throw new Error('rsi_skill_governance_router_engagement_underflow');
  const falsePositive = nonNegativeInt(false_positive_injection_count, 'false_positive_injection_count', engagements);
  const hardViolations = nonNegativeInt(hard_invariant_violation_count, 'hard_invariant_violation_count', invocations);
  const prior = authoringPrior(authoring_prior);

  const core = {
    schema: RSI_SKILL_LIFECYCLE_EVIDENCE_SCHEMA,
    version: 1,
    evidence_id: boundedId(evidence_id, 'evidence_id'),
    library_id: checkedLibrary.library_id,
    library_digest: checkedLibrary.library_digest,
    skill_id: entry.skill_id,
    skill_version: entry.skill_version,
    skill_digest: entry.skill_digest,
    window_seq: sequence,
    generation_start: start,
    generation_end: end,
    invocation_count: invocations,
    helpful_count: helpful,
    harmful_count: harmful,
    neutral_count: neutral,
    insufficient_evidence_count: insufficient,
    router_engagement_count: engagements,
    false_positive_injection_count: falsePositive,
    hard_invariant_violation_count: hardViolations,
    measured_net_delta: finiteNumber(measured_net_delta, 'measured_net_delta'),
    authoring_prior: prior,
    authoring_provenance_digest: exactDigest(authoring_provenance_digest, 'authoring_provenance'),
    evidence_refs: normalizeRefs(evidence_refs),
    external_evaluator: true,
    authored_by_candidate: false,
    raw_model_transcript_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    candidate_can_change_lifecycle_evidence: false,
    lifecycle_evidence_is_activation_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, evidence_digest: digest(core) });
}

export function verifyRsiSkillLifecycleEvidence(evidence, library) {
  if (!plainObject(evidence) || evidence.schema !== RSI_SKILL_LIFECYCLE_EVIDENCE_SCHEMA || evidence.version !== 1) {
    throw new Error('rsi_skill_governance_lifecycle_evidence_invalid');
  }
  assertZeroAuthority(evidence, 'lifecycle_evidence');
  if (
    evidence.external_evaluator !== true
    || evidence.authored_by_candidate !== false
    || evidence.raw_model_transcript_stored !== false
    || evidence.raw_page_text_stored !== false
    || evidence.raw_user_input_stored !== false
    || evidence.secret_material_stored !== false
    || evidence.candidate_can_change_lifecycle_evidence !== false
    || evidence.lifecycle_evidence_is_activation_authority !== false
  ) throw new Error('rsi_skill_governance_lifecycle_evidence_policy_invalid');

  const canonical = createRsiSkillLifecycleEvidence({
    library,
    evidence_id: evidence.evidence_id,
    skill_digest: evidence.skill_digest,
    window_seq: evidence.window_seq,
    generation_start: evidence.generation_start,
    generation_end: evidence.generation_end,
    invocation_count: evidence.invocation_count,
    helpful_count: evidence.helpful_count,
    harmful_count: evidence.harmful_count,
    neutral_count: evidence.neutral_count,
    insufficient_evidence_count: evidence.insufficient_evidence_count,
    router_engagement_count: evidence.router_engagement_count,
    false_positive_injection_count: evidence.false_positive_injection_count,
    hard_invariant_violation_count: evidence.hard_invariant_violation_count,
    measured_net_delta: evidence.measured_net_delta,
    authoring_prior: evidence.authoring_prior,
    authoring_provenance_digest: evidence.authoring_provenance_digest,
    evidence_refs: evidence.evidence_refs,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.evidence_digest !== exactDigest(evidence.evidence_digest, 'lifecycle_evidence')) {
    throw new Error('rsi_skill_governance_lifecycle_evidence_digest_mismatch');
  }
  return canonical;
}

function summarizeSkill(entry, windows, config) {
  const sorted = [...windows].sort((a, b) => a.window_seq - b.window_seq);
  const totalInvocations = sorted.reduce((sum, row) => sum + row.invocation_count, 0);
  const helpful = sorted.reduce((sum, row) => sum + row.helpful_count, 0);
  const harmful = sorted.reduce((sum, row) => sum + row.harmful_count, 0);
  const neutral = sorted.reduce((sum, row) => sum + row.neutral_count, 0);
  const insufficient = sorted.reduce((sum, row) => sum + row.insufficient_evidence_count, 0);
  const engagements = sorted.reduce((sum, row) => sum + row.router_engagement_count, 0);
  const falsePositive = sorted.reduce((sum, row) => sum + row.false_positive_injection_count, 0);
  const hardViolations = sorted.reduce((sum, row) => sum + row.hard_invariant_violation_count, 0);
  const netDelta = sorted.reduce((sum, row) => sum + row.measured_net_delta, 0);
  const last = sorted.at(-1) || null;
  const prior = last?.authoring_prior || 'LEGACY_IMPORTED';

  const harmfulRate = totalInvocations === 0 ? 0 : harmful / totalInvocations;
  const helpfulRate = totalInvocations === 0 ? 0 : helpful / totalInvocations;
  const falsePositiveRate = engagements === 0 ? 0 : falsePositive / engagements;

  const recent = sorted.slice(-config.min_retirement_windows);
  const recentNegative = recent.length >= config.min_retirement_windows
    && recent.every((row) =>
      row.measured_net_delta < 0
      || (row.invocation_count > 0 && row.harmful_count > row.helpful_count)
      || row.false_positive_injection_count > 0
      || row.hard_invariant_violation_count > 0);

  const retirementEligible =
    totalInvocations >= config.min_retirement_observations
    && recentNegative
    && (harmfulRate >= config.retirement_harmful_rate || netDelta < -config.retirement_net_delta);

  const quarantine =
    !retirementEligible
    && (
      hardViolations > 0
      || falsePositiveRate >= config.quarantine_false_positive_rate
      || harmfulRate >= config.quarantine_harmful_rate
    );

  const provenPositive =
    totalInvocations >= config.min_positive_observations
    && hardViolations === 0
    && falsePositiveRate < config.quarantine_false_positive_rate
    && netDelta > config.positive_net_delta
    && helpfulRate > harmfulRate;

  const score =
    netDelta
    + helpfulRate
    - 1.5 * harmfulRate
    - 2 * falsePositiveRate
    - 3 * hardViolations
    + priorBonus(prior);

  return Object.freeze({
    skill_id: entry.skill_id,
    skill_version: entry.skill_version,
    skill_digest: entry.skill_digest,
    role: entry.role,
    authoring_prior: prior,
    evidence_window_count: sorted.length,
    latest_window_seq: last?.window_seq || null,
    total_invocations: totalInvocations,
    helpful_count: helpful,
    harmful_count: harmful,
    neutral_count: neutral,
    insufficient_evidence_count: insufficient,
    router_engagement_count: engagements,
    false_positive_injection_count: falsePositive,
    hard_invariant_violation_count: hardViolations,
    helpful_rate: helpfulRate,
    harmful_rate: harmfulRate,
    false_positive_rate: falsePositiveRate,
    measured_net_delta_sum: netDelta,
    recent_negative_windows: recentNegative,
    retirement_eligible: retirementEligible,
    quarantine_required: quarantine,
    proven_positive: provenPositive,
    governance_score: score,
  });
}

function deterministicTie(skillDigest, governanceId) {
  return crypto.createHash('sha256').update(`${governanceId}:${skillDigest}`, 'utf8').digest('hex');
}

export function createRsiSkillLibraryGovernance({
  governance_id,
  library,
  lifecycle_evidence,
  max_active_skills = 64,
  exploration_slots = 8,
  min_positive_observations = 4,
  min_retirement_observations = 12,
  min_retirement_windows = 2,
  positive_net_delta = 0,
  quarantine_harmful_rate = 0.4,
  quarantine_false_positive_rate = 0.2,
  retirement_harmful_rate = 0.6,
  retirement_net_delta = 0.05,
  external_library_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedLibrary = verifyRsiVerifiedSkillLibrary(library);
  if (external_library_owner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_skill_governance_external_origin_required');
  }
  if (!Array.isArray(lifecycle_evidence) || lifecycle_evidence.length > MAX_WINDOWS) {
    throw new Error('rsi_skill_governance_lifecycle_evidence_set_invalid');
  }

  const activeCap = positiveInt(max_active_skills, 'max_active_skills', MAX_ACTIVE_SKILLS);
  const exploration = nonNegativeInt(exploration_slots, 'exploration_slots', activeCap);
  const config = Object.freeze({
    max_active_skills: activeCap,
    exploration_slots: exploration,
    min_positive_observations: positiveInt(min_positive_observations, 'min_positive_observations', 1_000_000),
    min_retirement_observations: positiveInt(min_retirement_observations, 'min_retirement_observations', 1_000_000),
    min_retirement_windows: positiveInt(min_retirement_windows, 'min_retirement_windows', 16),
    positive_net_delta: finiteNumber(positive_net_delta, 'positive_net_delta'),
    quarantine_harmful_rate: unitInterval(quarantine_harmful_rate, 'quarantine_harmful_rate'),
    quarantine_false_positive_rate: unitInterval(quarantine_false_positive_rate, 'quarantine_false_positive_rate'),
    retirement_harmful_rate: unitInterval(retirement_harmful_rate, 'retirement_harmful_rate'),
    retirement_net_delta: finiteNumber(retirement_net_delta, 'retirement_net_delta'),
  });
  if (config.retirement_harmful_rate + EPSILON < config.quarantine_harmful_rate) {
    throw new Error('rsi_skill_governance_retirement_threshold_weaker_than_quarantine');
  }

  const bySkill = new Map(checkedLibrary.entries.map((entry) => [entry.skill_digest, []]));
  const seenEvidence = new Set();
  const seenWindow = new Set();
  for (const row of lifecycle_evidence) {
    const checked = verifyRsiSkillLifecycleEvidence(row, checkedLibrary);
    if (seenEvidence.has(checked.evidence_digest)) throw new Error('rsi_skill_governance_lifecycle_evidence_duplicate');
    seenEvidence.add(checked.evidence_digest);
    const key = `${checked.skill_digest}:${checked.window_seq}`;
    if (seenWindow.has(key)) throw new Error('rsi_skill_governance_window_duplicate');
    seenWindow.add(key);
    bySkill.get(checked.skill_digest).push(checked);
  }

  const summaries = checkedLibrary.entries.map((entry) => summarizeSkill(entry, bySkill.get(entry.skill_digest), config));
  const terminal = new Map();
  for (const row of summaries) {
    if (row.retirement_eligible) terminal.set(row.skill_digest, 'RETIRED');
    else if (row.quarantine_required) terminal.set(row.skill_digest, 'QUARANTINED');
  }

  const selectable = summaries.filter((row) => !terminal.has(row.skill_digest));
  const proven = selectable.filter((row) => row.proven_positive)
    .sort((a, b) => b.governance_score - a.governance_score || deterministicTie(a.skill_digest, governance_id).localeCompare(deterministicTie(b.skill_digest, governance_id)));
  const exploratory = selectable.filter((row) => !row.proven_positive)
    .sort((a, b) =>
      priorBonus(b.authoring_prior) - priorBonus(a.authoring_prior)
      || a.total_invocations - b.total_invocations
      || deterministicTie(a.skill_digest, governance_id).localeCompare(deterministicTie(b.skill_digest, governance_id)));

  const chosen = new Map();
  for (const row of exploratory.slice(0, Math.min(exploration, activeCap))) {
    chosen.set(row.skill_digest, 'EXPLORATION_ACTIVE');
  }
  for (const row of proven) {
    if (chosen.size >= activeCap) break;
    chosen.set(row.skill_digest, 'ACTIVE');
  }
  for (const row of exploratory) {
    if (chosen.size >= activeCap) break;
    if (!chosen.has(row.skill_digest)) chosen.set(row.skill_digest, 'EXPLORATION_ACTIVE');
  }

  const entries = summaries.map((row) => {
    const state = terminal.get(row.skill_digest) || chosen.get(row.skill_digest) || 'DORMANT_CAP';
    if (!STATES.has(state)) throw new Error('rsi_skill_governance_state_invalid');
    return Object.freeze({
      ...row,
      state,
      active_for_composition: state === 'ACTIVE' || state === 'EXPLORATION_ACTIVE',
      retained_in_evidence_archive: true,
      hard_deleted: false,
      candidate_can_reactivate: false,
      candidate_can_retire: false,
      candidate_can_bypass_active_cap: false,
      candidate_can_mark_portable: false,
    });
  }).sort((a, b) => a.skill_id.localeCompare(b.skill_id) || a.skill_version - b.skill_version);

  const core = {
    schema: RSI_SKILL_LIBRARY_GOVERNANCE_SCHEMA,
    version: 1,
    governance_id: boundedId(governance_id, 'governance_id'),
    library_id: checkedLibrary.library_id,
    library_digest: checkedLibrary.library_digest,
    config,
    entries,
    entry_count: entries.length,
    active_count: entries.filter((row) => row.active_for_composition).length,
    retired_count: entries.filter((row) => row.state === 'RETIRED').length,
    quarantined_count: entries.filter((row) => row.state === 'QUARANTINED').length,
    dormant_count: entries.filter((row) => row.state === 'DORMANT_CAP').length,
    lifecycle_evidence_count: lifecycle_evidence.length,
    library_evidence_remains_append_only: true,
    active_view_is_bounded: true,
    outcome_driven_retirement: true,
    premature_retirement_protected_by_minimum_evidence: true,
    meta_skill_authoring_prior_is_tiebreak_only: true,
    candidate_can_change_governance: false,
    candidate_can_reactivate_skill: false,
    candidate_can_retire_skill: false,
    candidate_can_bypass_active_cap: false,
    retired_skills_remain_auditable: true,
    active_view_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, governance_digest: digest(core) });
}

export function verifyRsiSkillLibraryGovernance(governance, library) {
  if (!plainObject(governance) || governance.schema !== RSI_SKILL_LIBRARY_GOVERNANCE_SCHEMA || governance.version !== 1) {
    throw new Error('rsi_skill_governance_invalid');
  }
  assertZeroAuthority(governance, 'governance');
  if (
    governance.library_evidence_remains_append_only !== true
    || governance.active_view_is_bounded !== true
    || governance.outcome_driven_retirement !== true
    || governance.premature_retirement_protected_by_minimum_evidence !== true
    || governance.meta_skill_authoring_prior_is_tiebreak_only !== true
    || governance.candidate_can_change_governance !== false
    || governance.candidate_can_reactivate_skill !== false
    || governance.candidate_can_retire_skill !== false
    || governance.candidate_can_bypass_active_cap !== false
    || governance.retired_skills_remain_auditable !== true
    || governance.active_view_is_promotion_authority !== false
  ) throw new Error('rsi_skill_governance_policy_invalid');

  const checkedLibrary = verifyRsiVerifiedSkillLibrary(library);
  if (governance.library_digest !== checkedLibrary.library_digest || governance.library_id !== checkedLibrary.library_id) {
    throw new Error('rsi_skill_governance_library_mismatch');
  }
  if (!Array.isArray(governance.entries) || governance.entries.length !== checkedLibrary.entries.length) {
    throw new Error('rsi_skill_governance_entries_invalid');
  }
  if (governance.active_count > governance.config.max_active_skills) throw new Error('rsi_skill_governance_active_cap_exceeded');

  for (const row of governance.entries) {
    if (!STATES.has(row.state)) throw new Error('rsi_skill_governance_entry_state_invalid');
    findEntry(checkedLibrary, row.skill_digest);
    const shouldActive = row.state === 'ACTIVE' || row.state === 'EXPLORATION_ACTIVE';
    if (row.active_for_composition !== shouldActive
      || row.retained_in_evidence_archive !== true
      || row.hard_deleted !== false
      || row.candidate_can_reactivate !== false
      || row.candidate_can_retire !== false
      || row.candidate_can_bypass_active_cap !== false) {
      throw new Error('rsi_skill_governance_entry_policy_invalid');
    }
  }

  const clone = structuredClone(governance);
  delete clone.governance_digest;
  if (exactDigest(governance.governance_digest, 'governance') !== digest(clone)) {
    throw new Error('rsi_skill_governance_digest_mismatch');
  }
  return governance;
}

export function createRsiSkillActivationView({
  governance,
  library,
  requested_skill_digests,
  external_planner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedGovernance = verifyRsiSkillLibraryGovernance(governance, library);
  if (external_planner !== true || authored_by_candidate !== false) {
    throw new Error('rsi_skill_governance_activation_external_origin_required');
  }
  if (!Array.isArray(requested_skill_digests) || requested_skill_digests.length < 1 || requested_skill_digests.length > 64) {
    throw new Error('rsi_skill_governance_requested_skills_invalid');
  }
  const seen = new Set();
  const selected = requested_skill_digests.map((raw) => {
    const skillDigest = exactDigest(raw, 'requested_skill');
    if (seen.has(skillDigest)) throw new Error('rsi_skill_governance_requested_skill_duplicate');
    seen.add(skillDigest);
    const row = checkedGovernance.entries.find((entry) => entry.skill_digest === skillDigest);
    if (!row) throw new Error('rsi_skill_governance_requested_skill_unknown');
    if (!row.active_for_composition) throw new Error(`rsi_skill_governance_requested_skill_not_active:${row.state}`);
    return Object.freeze({
      skill_id: row.skill_id,
      skill_version: row.skill_version,
      skill_digest: row.skill_digest,
      governance_state: row.state,
      governance_score: row.governance_score,
    });
  });

  const core = {
    schema: RSI_SKILL_ACTIVATION_VIEW_SCHEMA,
    version: 1,
    governance_id: checkedGovernance.governance_id,
    governance_digest: checkedGovernance.governance_digest,
    library_id: checkedGovernance.library_id,
    library_digest: checkedGovernance.library_digest,
    selected,
    selected_count: selected.length,
    only_governance_active_skills: true,
    retired_or_quarantined_skill_activation_allowed: false,
    candidate_can_override_governance_state: false,
    activation_view_is_execution_authority: false,
    external_planner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, activation_digest: digest(core) });
}

export function rsiSkillLibraryGovernanceTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.skill-library-governance-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-skill-library-governance.mjs',
    library_evidence_remains_append_only: true,
    outcome_driven_retirement: true,
    active_cap_required: true,
    exploration_slots_required: true,
    premature_retirement_protected_by_minimum_evidence: true,
    router_false_positive_diagnostics_required: true,
    meta_skill_authoring_prior_is_tiebreak_only: true,
    candidate_can_change_governance: false,
    candidate_can_reactivate_skill: false,
    candidate_can_retire_skill: false,
    candidate_can_bypass_active_cap: false,
    raw_model_transcript_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    secret_material_stored: false,
    skill_governance_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, governance_root_digest: digest(root) });
}
