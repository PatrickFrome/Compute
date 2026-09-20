import crypto from 'node:crypto';

import { verifyRsiExperienceLesson } from './rsi-open-ended-search-policy.mjs';
import { verifyRsiComponentAttributionRecord } from './rsi-component-attribution.mjs';

export const RSI_GROUP_MEMBER_SCHEMA = 'metaengine.rsi.group-member.v1';
export const RSI_GROUP_EXPERIENCE_POOL_SCHEMA = 'metaengine.rsi.group-experience-pool.v1';
export const RSI_GROUP_TRANSFER_PLAN_SCHEMA = 'metaengine.rsi.group-transfer-plan.v1';
export const RSI_GROUP_TRANSFER_RECEIPT_SCHEMA = 'metaengine.rsi.group-transfer-receipt.v1';
export const RSI_GROUP_TRANSFER_RESULT_SCHEMA = 'metaengine.rsi.group-transfer-result.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_MEMBERS = 64;
const MAX_ITEMS = 1024;
const MAX_SELECTED = 12;
const MAX_PER_SOURCE = 3;
const MAX_TAGS = 24;
const MAX_EVIDENCE_REFS = 32;

const TRANSFER_OUTCOMES = new Set([
  'TRANSFER_VERIFIED',
  'NEGATIVE_TRANSFER',
  'INSUFFICIENT_EVIDENCE',
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

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_group_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_group_${label}_digest_invalid`);
  return out;
}

function exactCandidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_group_${label}_candidate_id_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_group_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_group_${label}_invalid`);
  return out;
}

function normalizeTokens(value, label, { min = 0, max = MAX_TAGS } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`rsi_group_${label}_invalid`);
  const seen = new Set();
  for (const raw of value) {
    const token = boundedToken(raw, label);
    if (seen.has(token)) throw new Error(`rsi_group_${label}_duplicate`);
    seen.add(token);
  }
  return [...seen].sort();
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_group_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_group_${label}_invalid`);
  return out;
}

function finiteNumber(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`rsi_group_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_group_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_group_${label}_automatic_retry_invalid`);
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
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_group_evidence_refs_invalid');
  const seen = new Set();
  return value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_group_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort();
}

function modelFamily(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,95}$/.test(out)) throw new Error(`rsi_group_${label}_model_family_invalid`);
  return out;
}

function mutationSurface(value, label) {
  const out = boundedToken(value, label);
  if (!['PROMPT_ROUTING','AGENT_ORCHESTRATION','TOOL_INTERFACE','BROWSER_RUNTIME','RSI_IMPROVER'].includes(out)) {
    throw new Error(`rsi_group_${label}_mutation_surface_invalid`);
  }
  return out;
}

export function createRsiGroupMember({
  member_id,
  candidate_id,
  candidate_sha,
  mutation_surface,
  model_family,
  environment_family,
  lineage_id,
  archive_generation,
  external_identity_verified = false,
  authored_by_candidate = true,
} = {}) {
  if (external_identity_verified !== true || authored_by_candidate !== false) throw new Error('rsi_group_member_external_origin_required');
  const core = {
    schema: RSI_GROUP_MEMBER_SCHEMA,
    version: 1,
    member_id: boundedId(member_id, 'member_id'),
    candidate_id: exactCandidateId(candidate_id, 'member'),
    candidate_sha: exactSha(candidate_sha, 'member'),
    mutation_surface: mutationSurface(mutation_surface, 'member'),
    model_family: modelFamily(model_family, 'member'),
    environment_family: boundedToken(environment_family, 'environment_family'),
    lineage_id: boundedId(lineage_id, 'lineage_id'),
    archive_generation: positiveInt(archive_generation, 'archive_generation', 1_000_000),
    external_identity_verified: true,
    authored_by_candidate: false,
    raw_model_transcript_shared: false,
    raw_page_text_shared: false,
    raw_user_input_shared: false,
    secret_material_shared: false,
    candidate_can_edit_group_identity: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, member_digest: digest(core) });
}

export function verifyRsiGroupMember(member) {
  if (!plainObject(member) || member.schema !== RSI_GROUP_MEMBER_SCHEMA || member.version !== 1) throw new Error('rsi_group_member_invalid');
  assertZeroAuthority(member, 'member');
  if (
    member.external_identity_verified !== true
    || member.authored_by_candidate !== false
    || member.raw_model_transcript_shared !== false
    || member.raw_page_text_shared !== false
    || member.raw_user_input_shared !== false
    || member.secret_material_shared !== false
    || member.candidate_can_edit_group_identity !== false
  ) throw new Error('rsi_group_member_policy_invalid');
  const canonical = createRsiGroupMember({
    member_id: member.member_id,
    candidate_id: member.candidate_id,
    candidate_sha: member.candidate_sha,
    mutation_surface: member.mutation_surface,
    model_family: member.model_family,
    environment_family: member.environment_family,
    lineage_id: member.lineage_id,
    archive_generation: member.archive_generation,
    external_identity_verified: true,
    authored_by_candidate: false,
  });
  if (canonical.member_digest !== exactDigest(member.member_digest, 'member')) throw new Error('rsi_group_member_digest_mismatch');
  return canonical;
}

function attributionPortablePayload(record) {
  const checked = verifyRsiComponentAttributionRecord(record);
  return Object.freeze({
    kind: 'COMPONENT_ATTRIBUTION',
    candidate_id: checked.candidate_id,
    candidate_sha: checked.candidate_sha,
    mutation_surface: mutationSurface(checked.mutation_surface, 'attribution'),
    source_digest: checked.attribution_digest,
    classification: boundedToken(checked.classification, 'classification'),
    component_path: String(checked.component_path || '').slice(0, 240),
    component_digest: exactDigest(checked.component_digest, 'component'),
    objective_statuses: checked.objective_effects.map((row) => Object.freeze({
      metric: boundedId(row.metric, 'objective_metric'),
      status: boundedToken(row.status, 'objective_status'),
    })),
    mechanism_tags: Object.freeze([
      'EXTERNAL_COMPONENT_ABLATION',
      checked.classification === 'SAFETY_CRITICAL' ? 'SAFETY_CRITICAL_COMPONENT' : 'MEASURED_COMPONENT_EFFECT',
    ]),
    challenge_families: Object.freeze([]),
    freeform_text_shared: false,
  });
}

function lessonPortablePayload(lesson) {
  const checked = verifyRsiExperienceLesson(lesson);
  return Object.freeze({
    kind: 'FAILURE_LESSON',
    candidate_id: checked.source_candidate_id,
    candidate_sha: checked.source_candidate_sha,
    mutation_surface: mutationSurface(checked.mutation_surface, 'lesson'),
    source_digest: checked.lesson_digest,
    classification: boundedToken(checked.failure_class, 'failure_class'),
    component_path: null,
    component_digest: null,
    objective_statuses: Object.freeze([]),
    mechanism_tags: Object.freeze([...checked.mechanism_tags]),
    challenge_families: Object.freeze([...checked.challenge_families]),
    recommendation_codes: Object.freeze([...checked.recommendation_codes]),
    freeform_text_shared: false,
  });
}

function itemScore(item, member, target, targetTags) {
  let score = 0;
  if (item.mutation_surface === target.mutation_surface) score += 6;
  if (member.model_family !== target.model_family) score += 1;
  if (member.environment_family === target.environment_family) score += 2;
  if (item.kind === 'COMPONENT_ATTRIBUTION') {
    score += ({
      SAFETY_CRITICAL: 7,
      CONTRIBUTING: 6,
      HARMFUL: 5,
      TRADEOFF_INTERACTION: 4,
      NO_MATERIAL_EFFECT: 1,
    })[item.classification] ?? 2;
  } else {
    score += 4;
  }
  for (const tag of item.mechanism_tags || []) if (targetTags.has(tag)) score += 3;
  for (const family of item.challenge_families || []) if (targetTags.has(family)) score += 3;
  return score;
}

function deterministicTie(seed, itemId) {
  return crypto.createHash('sha256').update(`${seed}:${itemId}`, 'utf8').digest('hex');
}

export function createRsiGroupExperiencePool({
  group_id,
  members,
  attribution_records = [],
  experience_lessons = [],
} = {}) {
  if (!Array.isArray(members) || members.length < 2 || members.length > MAX_MEMBERS) throw new Error('rsi_group_members_invalid');
  const normalizedMembers = members.map(verifyRsiGroupMember);
  const memberIds = new Set();
  const byCandidate = new Map();
  for (const member of normalizedMembers) {
    if (memberIds.has(member.member_id)) throw new Error('rsi_group_member_id_duplicate');
    if (byCandidate.has(member.candidate_id)) throw new Error('rsi_group_candidate_duplicate');
    memberIds.add(member.member_id);
    byCandidate.set(member.candidate_id, member);
  }

  if (!Array.isArray(attribution_records) || !Array.isArray(experience_lessons)) throw new Error('rsi_group_experience_inputs_invalid');
  if (attribution_records.length + experience_lessons.length < 1 || attribution_records.length + experience_lessons.length > MAX_ITEMS) {
    throw new Error('rsi_group_experience_count_invalid');
  }

  const items = [];
  const seenSourceDigests = new Set();
  const ingest = (payload) => {
    const member = byCandidate.get(payload.candidate_id);
    if (!member || member.candidate_sha !== payload.candidate_sha) throw new Error('rsi_group_experience_member_binding_mismatch');
    if (seenSourceDigests.has(payload.source_digest)) throw new Error('rsi_group_experience_duplicate');
    seenSourceDigests.add(payload.source_digest);
    const itemCore = {
      source_member_id: member.member_id,
      source_member_digest: member.member_digest,
      source_candidate_id: member.candidate_id,
      source_candidate_sha: member.candidate_sha,
      source_model_family: member.model_family,
      source_environment_family: member.environment_family,
      source_lineage_id: member.lineage_id,
      source_archive_generation: member.archive_generation,
      ...payload,
      trusted_in_source_context: true,
      portable_to_other_context_without_validation: false,
      candidate_can_mark_portable: false,
      raw_model_transcript_shared: false,
      raw_page_text_shared: false,
      raw_user_input_shared: false,
      secret_material_shared: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    const itemDigest = digest(itemCore);
    items.push(Object.freeze({
      ...itemCore,
      item_id: `rsi_group_item_${itemDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
      item_digest: itemDigest,
    }));
  };
  for (const record of attribution_records) ingest(attributionPortablePayload(record));
  for (const lesson of experience_lessons) ingest(lessonPortablePayload(lesson));
  items.sort((a, b) => a.item_id.localeCompare(b.item_id));

  const core = {
    schema: RSI_GROUP_EXPERIENCE_POOL_SCHEMA,
    version: 1,
    group_id: boundedId(group_id, 'group_id'),
    members: normalizedMembers,
    items,
    member_count: normalizedMembers.length,
    item_count: items.length,
    group_is_evolutionary_unit: true,
    explicit_experience_sharing: true,
    cross_branch_transfer_requires_external_validation: true,
    source_context_truth_not_assumed_portable: true,
    raw_model_transcript_shared: false,
    raw_page_text_shared: false,
    raw_user_input_shared: false,
    secret_material_shared: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, pool_digest: digest(core) });
}

export function verifyRsiGroupExperiencePool(pool) {
  if (!plainObject(pool) || pool.schema !== RSI_GROUP_EXPERIENCE_POOL_SCHEMA || pool.version !== 1) throw new Error('rsi_group_pool_invalid');
  assertZeroAuthority(pool, 'pool');
  if (
    pool.group_is_evolutionary_unit !== true
    || pool.explicit_experience_sharing !== true
    || pool.cross_branch_transfer_requires_external_validation !== true
    || pool.source_context_truth_not_assumed_portable !== true
    || pool.raw_model_transcript_shared !== false
    || pool.raw_page_text_shared !== false
    || pool.raw_user_input_shared !== false
    || pool.secret_material_shared !== false
  ) throw new Error('rsi_group_pool_policy_invalid');
  if (!Array.isArray(pool.members) || pool.members.length < 2 || pool.members.length > MAX_MEMBERS) throw new Error('rsi_group_pool_members_invalid');
  if (!Array.isArray(pool.items) || pool.items.length < 1 || pool.items.length > MAX_ITEMS) throw new Error('rsi_group_pool_items_invalid');
  const members = pool.members.map(verifyRsiGroupMember);
  const byMember = new Map(members.map((member) => [member.member_id, member]));
  const seenItems = new Set();
  for (const item of pool.items) {
    if (!plainObject(item)) throw new Error('rsi_group_pool_item_invalid');
    assertZeroAuthority(item, 'pool_item');
    const member = byMember.get(String(item.source_member_id || ''));
    if (!member || item.source_member_digest !== member.member_digest || item.source_candidate_id !== member.candidate_id || item.source_candidate_sha !== member.candidate_sha) {
      throw new Error('rsi_group_pool_item_member_mismatch');
    }
    exactDigest(item.source_digest, 'pool_item_source');
    exactDigest(item.item_digest, 'pool_item');
    boundedId(item.item_id, 'pool_item_id');
    if (
      item.trusted_in_source_context !== true
      || item.portable_to_other_context_without_validation !== false
      || item.candidate_can_mark_portable !== false
      || item.freeform_text_shared !== false
      || item.raw_model_transcript_shared !== false
      || item.raw_page_text_shared !== false
      || item.raw_user_input_shared !== false
      || item.secret_material_shared !== false
    ) throw new Error('rsi_group_pool_item_policy_invalid');
    if (seenItems.has(item.item_id)) throw new Error('rsi_group_pool_item_duplicate');
    seenItems.add(item.item_id);
    const clone = structuredClone(item);
    delete clone.item_id;
    delete clone.item_digest;
    const expected = digest(clone);
    if (item.item_digest !== expected || item.item_id !== `rsi_group_item_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
      throw new Error('rsi_group_pool_item_digest_mismatch');
    }
  }
  if (pool.member_count !== members.length || pool.item_count !== pool.items.length) throw new Error('rsi_group_pool_count_mismatch');
  const clone = structuredClone(pool);
  delete clone.pool_digest;
  if (exactDigest(pool.pool_digest, 'pool') !== digest(clone)) throw new Error('rsi_group_pool_digest_mismatch');
  return pool;
}

function normalizeTarget(target) {
  if (!plainObject(target) || target.external_identity_verified !== true || target.authored_by_candidate !== false) throw new Error('rsi_group_target_external_origin_required');
  return Object.freeze({
    target_id: boundedId(target.target_id, 'target_id'),
    candidate_id: exactCandidateId(target.candidate_id, 'target'),
    candidate_sha: exactSha(target.candidate_sha, 'target'),
    mutation_surface: mutationSurface(target.mutation_surface, 'target'),
    model_family: modelFamily(target.model_family, 'target'),
    environment_family: boundedToken(target.environment_family, 'target_environment'),
    context_tags: normalizeTokens(target.context_tags || [], 'target_context_tag', { min: 0 }),
    external_identity_verified: true,
    authored_by_candidate: false,
  });
}

export function createRsiGroupTransferPlan({
  pool,
  target,
  max_items = 8,
  max_items_per_source = MAX_PER_SOURCE,
} = {}) {
  const checked = verifyRsiGroupExperiencePool(pool);
  const normalizedTarget = normalizeTarget(target);
  const limit = positiveInt(max_items, 'max_items', MAX_SELECTED);
  const perSource = positiveInt(max_items_per_source, 'max_items_per_source', MAX_PER_SOURCE);
  const targetTags = new Set(normalizedTarget.context_tags);
  const seed = digest({
    pool_digest: checked.pool_digest,
    target: normalizedTarget,
    max_items: limit,
    max_items_per_source: perSource,
  });

  const memberById = new Map(checked.members.map((member) => [member.member_id, member]));
  const ranked = checked.items
    .filter((item) => item.source_candidate_id !== normalizedTarget.candidate_id)
    .map((item) => ({
      item,
      member: memberById.get(item.source_member_id),
      score: itemScore(item, memberById.get(item.source_member_id), normalizedTarget, targetTags),
    }))
    .sort((a, b) => b.score - a.score || deterministicTie(seed, a.item.item_id).localeCompare(deterministicTie(seed, b.item.item_id)));

  const selected = [];
  const perSourceCounts = new Map();
  const sourceOrder = [...new Set(ranked.map((row) => row.item.source_member_id))];
  for (const sourceMemberId of sourceOrder) {
    if (selected.length >= limit) break;
    const row = ranked.find((candidate) => candidate.item.source_member_id === sourceMemberId);
    if (!row) continue;
    selected.push(row);
    perSourceCounts.set(sourceMemberId, 1);
  }
  for (const row of ranked) {
    if (selected.length >= limit) break;
    if (selected.some((selectedRow) => selectedRow.item.item_id === row.item.item_id)) continue;
    const count = perSourceCounts.get(row.item.source_member_id) || 0;
    if (count >= perSource) continue;
    selected.push(row);
    perSourceCounts.set(row.item.source_member_id, count + 1);
  }

  if (selected.length < 1) throw new Error('rsi_group_transfer_selection_empty');
  const rows = selected.map(({ item, member, score }) => Object.freeze({
    item_id: item.item_id,
    item_digest: item.item_digest,
    source_member_id: item.source_member_id,
    source_candidate_id: item.source_candidate_id,
    source_candidate_sha: item.source_candidate_sha,
    source_model_family: member.model_family,
    source_environment_family: member.environment_family,
    kind: item.kind,
    mutation_surface: item.mutation_surface,
    classification: item.classification,
    relevance_score: score,
    cross_model_transfer: member.model_family !== normalizedTarget.model_family,
    cross_environment_transfer: member.environment_family !== normalizedTarget.environment_family,
    transfer_state: 'PROPOSED_EXTERNAL_VALIDATION',
    candidate_can_activate_transfer: false,
    portable_for_target_search: false,
  }));

  const core = {
    schema: RSI_GROUP_TRANSFER_PLAN_SCHEMA,
    version: 1,
    pool_digest: checked.pool_digest,
    group_id: checked.group_id,
    target: normalizedTarget,
    selected_items: rows,
    selected_item_count: rows.length,
    selected_source_count: new Set(rows.map((row) => row.source_member_id)).size,
    max_items: limit,
    max_items_per_source: perSource,
    diversity_first_source_round: true,
    source_context_truth_not_assumed_portable: true,
    external_transfer_validation_required: true,
    target_candidate_can_select_sources: false,
    target_candidate_can_activate_transfer: false,
    raw_model_transcript_shared: false,
    raw_page_text_shared: false,
    raw_user_input_shared: false,
    secret_material_shared: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const planDigest = digest(core);
  return Object.freeze({
    ...core,
    plan_id: `rsi_group_transfer_${planDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_digest: planDigest,
  });
}

export function verifyRsiGroupTransferPlan(plan, pool) {
  const checkedPool = verifyRsiGroupExperiencePool(pool);
  if (!plainObject(plan) || plan.schema !== RSI_GROUP_TRANSFER_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_group_transfer_plan_invalid');
  assertZeroAuthority(plan, 'transfer_plan');
  if (
    plan.pool_digest !== checkedPool.pool_digest
    || plan.group_id !== checkedPool.group_id
    || plan.diversity_first_source_round !== true
    || plan.source_context_truth_not_assumed_portable !== true
    || plan.external_transfer_validation_required !== true
    || plan.target_candidate_can_select_sources !== false
    || plan.target_candidate_can_activate_transfer !== false
    || plan.raw_model_transcript_shared !== false
    || plan.raw_page_text_shared !== false
    || plan.raw_user_input_shared !== false
    || plan.secret_material_shared !== false
  ) throw new Error('rsi_group_transfer_plan_policy_invalid');
  normalizeTarget(plan.target);
  if (!Array.isArray(plan.selected_items) || plan.selected_items.length < 1 || plan.selected_items.length > MAX_SELECTED) throw new Error('rsi_group_transfer_plan_items_invalid');
  const sourceCounts = new Map();
  const ids = new Set();
  for (const row of plan.selected_items) {
    if (!plainObject(row) || row.transfer_state !== 'PROPOSED_EXTERNAL_VALIDATION' || row.candidate_can_activate_transfer !== false || row.portable_for_target_search !== false) {
      throw new Error('rsi_group_transfer_plan_item_policy_invalid');
    }
    if (ids.has(row.item_id)) throw new Error('rsi_group_transfer_plan_item_duplicate');
    ids.add(row.item_id);
    const poolItem = checkedPool.items.find((item) => item.item_id === row.item_id);
    if (!poolItem || poolItem.item_digest !== row.item_digest) throw new Error('rsi_group_transfer_plan_item_binding_mismatch');
    sourceCounts.set(row.source_member_id, (sourceCounts.get(row.source_member_id) || 0) + 1);
  }
  if ([...sourceCounts.values()].some((count) => count > plan.max_items_per_source)) throw new Error('rsi_group_transfer_plan_source_cap_exceeded');
  if (plan.selected_item_count !== plan.selected_items.length || plan.selected_source_count !== sourceCounts.size) throw new Error('rsi_group_transfer_plan_count_mismatch');
  const clone = structuredClone(plan);
  delete clone.plan_id;
  delete clone.plan_digest;
  const expected = digest(clone);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_group_transfer_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) throw new Error('rsi_group_transfer_plan_digest_mismatch');
  return plan;
}

export function createRsiGroupTransferReceipt({
  plan,
  pool,
  item_id,
  outcome,
  target_holdout_digest,
  evaluator_root_digest,
  target_hard_invariants_pass,
  net_benefit_verified,
  measured_delta,
  evidence_refs,
  external_transfer_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const checkedPlan = verifyRsiGroupTransferPlan(plan, pool);
  if (external_transfer_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_group_transfer_receipt_external_origin_required');
  const item = checkedPlan.selected_items.find((row) => row.item_id === String(item_id || ''));
  if (!item) throw new Error('rsi_group_transfer_receipt_item_invalid');
  const normalizedOutcome = boundedToken(outcome, 'transfer_outcome');
  if (!TRANSFER_OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_group_transfer_receipt_outcome_invalid');
  const hardPass = target_hard_invariants_pass === true;
  const benefit = net_benefit_verified === true;
  if (normalizedOutcome === 'TRANSFER_VERIFIED' && (!hardPass || !benefit)) throw new Error('rsi_group_transfer_receipt_positive_proof_invalid');
  if (normalizedOutcome === 'NEGATIVE_TRANSFER' && benefit) throw new Error('rsi_group_transfer_receipt_negative_proof_invalid');

  const core = {
    schema: RSI_GROUP_TRANSFER_RECEIPT_SCHEMA,
    version: 1,
    plan_id: checkedPlan.plan_id,
    plan_digest: checkedPlan.plan_digest,
    item_id: item.item_id,
    item_digest: item.item_digest,
    source_member_id: item.source_member_id,
    source_candidate_id: item.source_candidate_id,
    source_candidate_sha: item.source_candidate_sha,
    target_id: checkedPlan.target.target_id,
    target_candidate_id: checkedPlan.target.candidate_id,
    target_candidate_sha: checkedPlan.target.candidate_sha,
    target_model_family: checkedPlan.target.model_family,
    target_environment_family: checkedPlan.target.environment_family,
    target_holdout_digest: exactDigest(target_holdout_digest, 'target_holdout'),
    evaluator_root_digest: exactDigest(evaluator_root_digest, 'evaluator_root'),
    outcome: normalizedOutcome,
    target_hard_invariants_pass: hardPass,
    net_benefit_verified: benefit,
    measured_delta: finiteNumber(measured_delta, 'measured_delta'),
    evidence_refs: evidenceRefs(evidence_refs),
    external_transfer_evaluator: true,
    authored_by_candidate: false,
    target_candidate_can_self_certify_transfer: false,
    source_context_truth_not_assumed_portable: true,
    cross_model_transfer: item.cross_model_transfer === true,
    cross_environment_transfer: item.cross_environment_transfer === true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}

export function verifyRsiGroupTransferReceipt(receipt, plan, pool) {
  if (!plainObject(receipt) || receipt.schema !== RSI_GROUP_TRANSFER_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_group_transfer_receipt_invalid');
  assertZeroAuthority(receipt, 'transfer_receipt');
  if (
    receipt.external_transfer_evaluator !== true
    || receipt.authored_by_candidate !== false
    || receipt.target_candidate_can_self_certify_transfer !== false
    || receipt.source_context_truth_not_assumed_portable !== true
  ) throw new Error('rsi_group_transfer_receipt_policy_invalid');
  const canonical = createRsiGroupTransferReceipt({
    plan,
    pool,
    item_id: receipt.item_id,
    outcome: receipt.outcome,
    target_holdout_digest: receipt.target_holdout_digest,
    evaluator_root_digest: receipt.evaluator_root_digest,
    target_hard_invariants_pass: receipt.target_hard_invariants_pass,
    net_benefit_verified: receipt.net_benefit_verified,
    measured_delta: receipt.measured_delta,
    evidence_refs: receipt.evidence_refs,
    external_transfer_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.receipt_digest !== exactDigest(receipt.receipt_digest, 'transfer_receipt')) throw new Error('rsi_group_transfer_receipt_digest_mismatch');
  return canonical;
}

export function finalizeRsiGroupTransfer({ plan, pool, receipts } = {}) {
  const checkedPlan = verifyRsiGroupTransferPlan(plan, pool);
  if (!Array.isArray(receipts) || receipts.length !== checkedPlan.selected_items.length) throw new Error('rsi_group_transfer_receipt_set_incomplete');
  const byItem = new Map();
  for (const receipt of receipts) {
    const checked = verifyRsiGroupTransferReceipt(receipt, checkedPlan, pool);
    if (byItem.has(checked.item_id)) throw new Error('rsi_group_transfer_receipt_duplicate');
    byItem.set(checked.item_id, checked);
  }
  const records = checkedPlan.selected_items.map((item) => {
    const receipt = byItem.get(item.item_id);
    if (!receipt) throw new Error('rsi_group_transfer_receipt_missing');
    const portable = receipt.outcome === 'TRANSFER_VERIFIED';
    return Object.freeze({
      item_id: item.item_id,
      item_digest: item.item_digest,
      source_member_id: item.source_member_id,
      source_candidate_id: item.source_candidate_id,
      target_candidate_id: checkedPlan.target.candidate_id,
      transfer_outcome: receipt.outcome,
      portable_for_target_search: portable,
      negative_transfer_memory: receipt.outcome === 'NEGATIVE_TRANSFER',
      insufficient_evidence: receipt.outcome === 'INSUFFICIENT_EVIDENCE',
      receipt_digest: receipt.receipt_digest,
      target_holdout_digest: receipt.target_holdout_digest,
      evaluator_root_digest: receipt.evaluator_root_digest,
      cross_model_transfer: receipt.cross_model_transfer,
      cross_environment_transfer: receipt.cross_environment_transfer,
      candidate_can_activate_transfer: false,
      transfer_is_promotion_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  });
  const core = {
    schema: RSI_GROUP_TRANSFER_RESULT_SCHEMA,
    version: 1,
    plan_id: checkedPlan.plan_id,
    plan_digest: checkedPlan.plan_digest,
    pool_digest: checkedPlan.pool_digest,
    target: checkedPlan.target,
    records,
    verified_transfer_count: records.filter((row) => row.portable_for_target_search).length,
    negative_transfer_count: records.filter((row) => row.negative_transfer_memory).length,
    insufficient_evidence_count: records.filter((row) => row.insufficient_evidence).length,
    all_selected_items_evaluated: true,
    target_search_may_consume_verified_transfers_only: true,
    negative_transfer_is_memory_not_authority: true,
    group_experience_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, result_digest: digest(core) });
}

export function verifyRsiGroupTransferResult(result, plan, pool) {
  const checkedPlan = verifyRsiGroupTransferPlan(plan, pool);
  if (!plainObject(result) || result.schema !== RSI_GROUP_TRANSFER_RESULT_SCHEMA || result.version !== 1) throw new Error('rsi_group_transfer_result_invalid');
  assertZeroAuthority(result, 'transfer_result');
  if (
    result.plan_id !== checkedPlan.plan_id
    || result.plan_digest !== checkedPlan.plan_digest
    || result.pool_digest !== checkedPlan.pool_digest
    || result.all_selected_items_evaluated !== true
    || result.target_search_may_consume_verified_transfers_only !== true
    || result.negative_transfer_is_memory_not_authority !== true
    || result.group_experience_is_promotion_authority !== false
  ) throw new Error('rsi_group_transfer_result_policy_invalid');
  if (!Array.isArray(result.records) || result.records.length !== checkedPlan.selected_items.length) throw new Error('rsi_group_transfer_result_records_invalid');
  const ids = new Set();
  for (const row of result.records) {
    if (!plainObject(row)) throw new Error('rsi_group_transfer_result_record_invalid');
    assertZeroAuthority(row, 'transfer_result_record');
    if (
      row.candidate_can_activate_transfer !== false
      || row.transfer_is_promotion_authority !== false
      || !TRANSFER_OUTCOMES.has(String(row.transfer_outcome || ''))
    ) throw new Error('rsi_group_transfer_result_record_policy_invalid');
    if (ids.has(row.item_id)) throw new Error('rsi_group_transfer_result_record_duplicate');
    ids.add(row.item_id);
    const selected = checkedPlan.selected_items.find((item) => item.item_id === row.item_id);
    if (!selected || selected.item_digest !== row.item_digest) throw new Error('rsi_group_transfer_result_record_binding_mismatch');
    const positive = row.transfer_outcome === 'TRANSFER_VERIFIED';
    const negative = row.transfer_outcome === 'NEGATIVE_TRANSFER';
    const insufficient = row.transfer_outcome === 'INSUFFICIENT_EVIDENCE';
    if (
      row.portable_for_target_search !== positive
      || row.negative_transfer_memory !== negative
      || row.insufficient_evidence !== insufficient
    ) throw new Error('rsi_group_transfer_result_record_semantics_invalid');
    exactDigest(row.receipt_digest, 'transfer_result_receipt');
    exactDigest(row.target_holdout_digest, 'transfer_result_holdout');
    exactDigest(row.evaluator_root_digest, 'transfer_result_evaluator_root');
  }
  const verified = result.records.filter((row) => row.portable_for_target_search).length;
  const negative = result.records.filter((row) => row.negative_transfer_memory).length;
  const insufficient = result.records.filter((row) => row.insufficient_evidence).length;
  if (
    result.verified_transfer_count !== verified
    || result.negative_transfer_count !== negative
    || result.insufficient_evidence_count !== insufficient
  ) throw new Error('rsi_group_transfer_result_count_mismatch');
  const clone = structuredClone(result);
  delete clone.result_digest;
  if (exactDigest(result.result_digest, 'transfer_result') !== digest(clone)) throw new Error('rsi_group_transfer_result_digest_mismatch');
  return result;
}

export function rsiGroupExperienceTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.group-experience-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-group-experience-exchange.mjs',
    group_is_evolutionary_unit: true,
    explicit_experience_sharing: true,
    cross_branch_transfer_requires_external_validation: true,
    source_context_truth_not_assumed_portable: true,
    diversity_first_source_round: true,
    max_items_per_source: MAX_PER_SOURCE,
    target_candidate_can_select_sources: false,
    target_candidate_can_self_certify_transfer: false,
    raw_model_transcript_shared: false,
    raw_page_text_shared: false,
    raw_user_input_shared: false,
    secret_material_shared: false,
    group_experience_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, group_root_digest: digest(root) });
}
