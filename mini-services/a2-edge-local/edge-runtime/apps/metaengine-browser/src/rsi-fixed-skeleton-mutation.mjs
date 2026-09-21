import crypto from 'node:crypto';

export const RSI_FIXED_SKELETON_POLICY_SCHEMA = 'metaengine.rsi.fixed-skeleton-policy.v1';
export const RSI_FIXED_SKELETON_MUTATION_PLAN_SCHEMA = 'metaengine.rsi.fixed-skeleton-mutation-plan.v1';
export const RSI_FIXED_SKELETON_MATERIALIZATION_SCHEMA = 'metaengine.rsi.fixed-skeleton-materialization.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_BLOCKS = 64;
const MAX_PLAN_BLOCKS = 16;
const MAX_TOTAL_MUTATED_BYTES = 512 * 1024;

const AUTHORITY_PREFIXES = Object.freeze([
  '.github/',
  'apps/metaengine-browser/build/',
  'apps/metaengine-browser/native/browser-guardian-scm/',
  'apps/metaengine-browser/supabase/',
  'apps/metaengine-browser/src/browser-guardian-',
  'apps/metaengine-browser/src/developer-emergency-update-',
  'apps/metaengine-browser/src/native-supervisor-',
  'apps/metaengine-browser/src/self-update-',
  'apps/metaengine-browser/src/supervisor-',
  'apps/metaengine-browser/src/rsi-',
]);

const LANGUAGES = new Set(['JAVASCRIPT', 'TYPESCRIPT', 'PYTHON', 'SQL', 'JSON']);

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
  if (!SHA256_RE.test(out)) throw new Error(`rsi_skeleton_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_skeleton_${label}_sha_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_skeleton_${label}_invalid`);
  return out;
}

function boundedToken(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_skeleton_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_skeleton_${label}_invalid`);
  return out;
}

function boundedPath(value, label) {
  const out = String(value || '').trim();
  if (
    !out
    || out.length > 240
    || out.startsWith('/')
    || out.includes('\\')
    || out.includes('\0')
    || out.split('/').some((part) => !part || part === '.' || part === '..')
  ) throw new Error(`rsi_skeleton_${label}_path_invalid`);
  return out;
}

function assertNonAuthorityPath(path) {
  for (const prefix of AUTHORITY_PREFIXES) {
    if (path.startsWith(prefix)) throw new Error('rsi_skeleton_authority_path_forbidden');
  }
  return path;
}

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) throw new Error(`rsi_skeleton_${label}_invalid`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`rsi_skeleton_${label}_fields_invalid`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`rsi_skeleton_${label}_fields_invalid`);
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
    if (value?.[field] !== false) throw new Error(`rsi_skeleton_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_skeleton_${label}_automatic_retry_invalid`);
}

function normalizeBlock(row) {
  exactKeys(row, [
    'block_id',
    'file_path',
    'language',
    'semantic_role',
    'baseline_block_digest',
    'start_anchor_digest',
    'end_anchor_digest',
    'max_bytes',
  ], ['raw_source_exposed_as_authority', 'block_materialization_authority'], 'block');
  if (row.raw_source_exposed_as_authority != null && row.raw_source_exposed_as_authority !== false) {
    throw new Error('rsi_skeleton_block_raw_source_authority_invalid');
  }
  if (row.block_materialization_authority != null && row.block_materialization_authority !== false) {
    throw new Error('rsi_skeleton_block_materialization_authority_invalid');
  }
  const filePath = assertNonAuthorityPath(boundedPath(row.file_path, 'block'));
  const language = boundedToken(row.language, 'block_language');
  if (!LANGUAGES.has(language)) throw new Error('rsi_skeleton_block_language_invalid');
  return Object.freeze({
    block_id: boundedId(row.block_id, 'block_id'),
    file_path: filePath,
    language,
    semantic_role: boundedToken(row.semantic_role, 'semantic_role'),
    baseline_block_digest: exactDigest(row.baseline_block_digest, 'baseline_block'),
    start_anchor_digest: exactDigest(row.start_anchor_digest, 'start_anchor'),
    end_anchor_digest: exactDigest(row.end_anchor_digest, 'end_anchor'),
    max_bytes: positiveInt(row.max_bytes, 'block_max_bytes', MAX_TOTAL_MUTATED_BYTES),
    raw_source_exposed_as_authority: false,
    block_materialization_authority: false,
  });
}

function normalizePolicyBlocks(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BLOCKS) throw new Error('rsi_skeleton_blocks_invalid');
  const ids = new Set();
  const anchors = new Set();
  return Object.freeze(value.map(normalizeBlock).sort((a, b) => a.block_id.localeCompare(b.block_id)).map((row) => {
    if (ids.has(row.block_id)) throw new Error('rsi_skeleton_block_duplicate');
    ids.add(row.block_id);
    const anchorKey = `${row.file_path}:${row.start_anchor_digest}:${row.end_anchor_digest}`;
    if (anchors.has(anchorKey)) throw new Error('rsi_skeleton_block_anchor_duplicate');
    anchors.add(anchorKey);
    return row;
  }));
}

export function createRsiFixedSkeletonPolicy({
  policy_id,
  parent_sha,
  source_tree_digest,
  immutable_skeleton_digest,
  blocks,
  max_mutated_blocks = 4,
  max_total_mutated_bytes = 128 * 1024,
  external_policy_owner = false,
  authored_by_candidate = true,
} = {}) {
  if (external_policy_owner !== true || authored_by_candidate !== false) throw new Error('rsi_skeleton_policy_external_origin_required');
  const normalizedBlocks = normalizePolicyBlocks(blocks);
  const maxBlocks = positiveInt(max_mutated_blocks, 'max_mutated_blocks', Math.min(MAX_PLAN_BLOCKS, normalizedBlocks.length));
  const maxBytes = positiveInt(max_total_mutated_bytes, 'max_total_mutated_bytes', MAX_TOTAL_MUTATED_BYTES);
  if (normalizedBlocks.every((row) => row.max_bytes > maxBytes)) throw new Error('rsi_skeleton_policy_no_feasible_block');

  const core = {
    schema: RSI_FIXED_SKELETON_POLICY_SCHEMA,
    version: 1,
    policy_id: boundedId(policy_id, 'policy_id'),
    parent_sha: exactSha(parent_sha, 'parent'),
    source_tree_digest: exactDigest(source_tree_digest, 'source_tree'),
    immutable_skeleton_digest: exactDigest(immutable_skeleton_digest, 'immutable_skeleton'),
    blocks: normalizedBlocks,
    block_count: normalizedBlocks.length,
    max_mutated_blocks: maxBlocks,
    max_total_mutated_bytes: maxBytes,
    mutation_mode: 'DIGEST_ADDRESSED_TYPED_EVOLVE_BLOCKS_ONLY',
    immutable_skeleton_must_remain_exact: true,
    immutable_regions_are_candidate_inaccessible: true,
    only_declared_blocks_mutable: true,
    block_anchors_must_remain_exact: true,
    authority_paths_mutable: false,
    arbitrary_file_mutation_allowed: false,
    candidate_can_add_mutable_blocks: false,
    candidate_can_move_block_anchors: false,
    candidate_can_modify_policy: false,
    raw_patch_is_authority: false,
    external_policy_owner: true,
    authored_by_candidate: false,
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

export function verifyRsiFixedSkeletonPolicy(policy) {
  if (!plainObject(policy) || policy.schema !== RSI_FIXED_SKELETON_POLICY_SCHEMA || policy.version !== 1) throw new Error('rsi_skeleton_policy_invalid');
  assertZeroAuthority(policy, 'policy');
  if (
    policy.mutation_mode !== 'DIGEST_ADDRESSED_TYPED_EVOLVE_BLOCKS_ONLY'
    || policy.immutable_skeleton_must_remain_exact !== true
    || policy.immutable_regions_are_candidate_inaccessible !== true
    || policy.only_declared_blocks_mutable !== true
    || policy.block_anchors_must_remain_exact !== true
    || policy.authority_paths_mutable !== false
    || policy.arbitrary_file_mutation_allowed !== false
    || policy.candidate_can_add_mutable_blocks !== false
    || policy.candidate_can_move_block_anchors !== false
    || policy.candidate_can_modify_policy !== false
    || policy.raw_patch_is_authority !== false
    || policy.external_policy_owner !== true
    || policy.authored_by_candidate !== false
  ) throw new Error('rsi_skeleton_policy_contract_invalid');

  const canonical = createRsiFixedSkeletonPolicy({
    policy_id: policy.policy_id,
    parent_sha: policy.parent_sha,
    source_tree_digest: policy.source_tree_digest,
    immutable_skeleton_digest: policy.immutable_skeleton_digest,
    blocks: policy.blocks,
    max_mutated_blocks: policy.max_mutated_blocks,
    max_total_mutated_bytes: policy.max_total_mutated_bytes,
    external_policy_owner: true,
    authored_by_candidate: false,
  });
  if (canonical.policy_digest !== exactDigest(policy.policy_digest, 'policy')) throw new Error('rsi_skeleton_policy_digest_mismatch');
  return canonical;
}

function normalizeMutation(row, blockById) {
  exactKeys(row, ['block_id', 'replacement_digest', 'replacement_bytes', 'proposal_evidence_digest'], [], 'mutation');
  const blockId = boundedId(row.block_id, 'mutation_block_id');
  const block = blockById.get(blockId);
  if (!block) throw new Error('rsi_skeleton_mutation_block_not_declared');
  const replacementDigest = exactDigest(row.replacement_digest, 'replacement');
  if (replacementDigest === block.baseline_block_digest) throw new Error('rsi_skeleton_mutation_noop');
  const bytes = positiveInt(row.replacement_bytes, 'replacement_bytes', block.max_bytes);
  return Object.freeze({
    block_id: blockId,
    file_path: block.file_path,
    language: block.language,
    baseline_block_digest: block.baseline_block_digest,
    replacement_digest: replacementDigest,
    replacement_bytes: bytes,
    proposal_evidence_digest: exactDigest(row.proposal_evidence_digest, 'proposal_evidence'),
    raw_patch_content_present: false,
    materialization_authority: false,
  });
}

export function createRsiFixedSkeletonMutationPlan({
  policy,
  plan_id,
  generation,
  mutations,
  external_planner = false,
  authored_by_candidate = true,
} = {}) {
  const checked = verifyRsiFixedSkeletonPolicy(policy);
  if (external_planner !== true || authored_by_candidate !== false) throw new Error('rsi_skeleton_plan_external_origin_required');
  if (!Array.isArray(mutations) || mutations.length < 1 || mutations.length > checked.max_mutated_blocks) throw new Error('rsi_skeleton_mutations_invalid');
  const blockById = new Map(checked.blocks.map((row) => [row.block_id, row]));
  const normalized = mutations.map((row) => normalizeMutation(row, blockById)).sort((a, b) => a.block_id.localeCompare(b.block_id));
  const seen = new Set();
  for (const row of normalized) {
    if (seen.has(row.block_id)) throw new Error('rsi_skeleton_mutation_duplicate');
    seen.add(row.block_id);
  }
  const totalBytes = normalized.reduce((sum, row) => sum + row.replacement_bytes, 0);
  if (totalBytes > checked.max_total_mutated_bytes) throw new Error('rsi_skeleton_plan_byte_budget_exceeded');

  const core = {
    schema: RSI_FIXED_SKELETON_MUTATION_PLAN_SCHEMA,
    version: 1,
    plan_id: boundedId(plan_id, 'plan_id'),
    generation: positiveInt(generation, 'generation', 1_000_000),
    policy_id: checked.policy_id,
    policy_digest: checked.policy_digest,
    parent_sha: checked.parent_sha,
    source_tree_digest: checked.source_tree_digest,
    immutable_skeleton_digest: checked.immutable_skeleton_digest,
    mutations: normalized,
    mutation_count: normalized.length,
    total_replacement_bytes: totalBytes,
    plan_is_materialization_authority: false,
    plan_is_execution_authority: false,
    plan_is_evaluation_authority: false,
    plan_is_promotion_authority: false,
    immutable_regions_candidate_visible_as_mutation_surface: false,
    raw_patch_content_present: false,
    external_planner: true,
    authored_by_candidate: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, plan_digest: digest(core) });
}

export function verifyRsiFixedSkeletonMutationPlan(plan, policy) {
  if (!plainObject(plan) || plan.schema !== RSI_FIXED_SKELETON_MUTATION_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_skeleton_plan_invalid');
  assertZeroAuthority(plan, 'plan');
  if (
    plan.plan_is_materialization_authority !== false
    || plan.plan_is_execution_authority !== false
    || plan.plan_is_evaluation_authority !== false
    || plan.plan_is_promotion_authority !== false
    || plan.immutable_regions_candidate_visible_as_mutation_surface !== false
    || plan.raw_patch_content_present !== false
    || plan.external_planner !== true
    || plan.authored_by_candidate !== false
  ) throw new Error('rsi_skeleton_plan_policy_invalid');
  const canonical = createRsiFixedSkeletonMutationPlan({
    policy,
    plan_id: plan.plan_id,
    generation: plan.generation,
    mutations: plan.mutations.map((row) => ({
      block_id: row.block_id,
      replacement_digest: row.replacement_digest,
      replacement_bytes: row.replacement_bytes,
      proposal_evidence_digest: row.proposal_evidence_digest,
    })),
    external_planner: true,
    authored_by_candidate: false,
  });
  if (canonical.plan_digest !== exactDigest(plan.plan_digest, 'plan')) throw new Error('rsi_skeleton_plan_digest_mismatch');
  return canonical;
}

export function createRsiFixedSkeletonMaterializationReceipt({
  policy,
  plan,
  candidate_sha,
  resulting_tree_digest,
  immutable_skeleton_digest_after,
  observed_blocks,
  unexpected_changed_paths = [],
  source_parser_digest,
  evidence_refs,
  external_materializer = false,
  authored_by_candidate = true,
} = {}) {
  const checkedPolicy = verifyRsiFixedSkeletonPolicy(policy);
  const checkedPlan = verifyRsiFixedSkeletonMutationPlan(plan, checkedPolicy);
  if (external_materializer !== true || authored_by_candidate !== false) throw new Error('rsi_skeleton_materialization_external_origin_required');
  const candidateSha = exactSha(candidate_sha, 'candidate');
  if (candidateSha === checkedPolicy.parent_sha) throw new Error('rsi_skeleton_materialization_noop_candidate');
  const skeletonAfter = exactDigest(immutable_skeleton_digest_after, 'immutable_skeleton_after');
  if (skeletonAfter !== checkedPolicy.immutable_skeleton_digest) throw new Error('rsi_skeleton_materialization_skeleton_drift');
  if (!Array.isArray(unexpected_changed_paths)) throw new Error('rsi_skeleton_unexpected_paths_invalid');
  const unexpected = unexpected_changed_paths.map((row) => boundedPath(row, 'unexpected_changed_path')).sort();
  if (unexpected.length > 0) throw new Error('rsi_skeleton_materialization_unexpected_path');

  if (!Array.isArray(observed_blocks) || observed_blocks.length !== checkedPlan.mutations.length) throw new Error('rsi_skeleton_materialization_block_set_incomplete');
  const byId = new Map();
  for (const row of observed_blocks) {
    exactKeys(row, [
      'block_id',
      'file_path',
      'before_digest',
      'after_digest',
      'after_bytes',
      'start_anchor_digest',
      'end_anchor_digest',
    ], [], 'observed_block');
    const id = boundedId(row.block_id, 'observed_block_id');
    if (byId.has(id)) throw new Error('rsi_skeleton_materialization_block_duplicate');
    byId.set(id, row);
  }

  const normalizedObserved = checkedPlan.mutations.map((mutation) => {
    const row = byId.get(mutation.block_id);
    if (!row) throw new Error('rsi_skeleton_materialization_block_missing');
    const block = checkedPolicy.blocks.find((entry) => entry.block_id === mutation.block_id);
    const filePath = boundedPath(row.file_path, 'observed_block');
    const before = exactDigest(row.before_digest, 'observed_before');
    const after = exactDigest(row.after_digest, 'observed_after');
    const bytes = positiveInt(row.after_bytes, 'observed_after_bytes', block.max_bytes);
    const startAnchor = exactDigest(row.start_anchor_digest, 'observed_start_anchor');
    const endAnchor = exactDigest(row.end_anchor_digest, 'observed_end_anchor');
    if (
      filePath !== block.file_path
      || before !== block.baseline_block_digest
      || after !== mutation.replacement_digest
      || bytes !== mutation.replacement_bytes
      || startAnchor !== block.start_anchor_digest
      || endAnchor !== block.end_anchor_digest
    ) throw new Error('rsi_skeleton_materialization_block_binding_mismatch');
    return Object.freeze({
      block_id: mutation.block_id,
      file_path: filePath,
      before_digest: before,
      after_digest: after,
      after_bytes: bytes,
      start_anchor_digest: startAnchor,
      end_anchor_digest: endAnchor,
    });
  });

  const core = {
    schema: RSI_FIXED_SKELETON_MATERIALIZATION_SCHEMA,
    version: 1,
    policy_id: checkedPolicy.policy_id,
    policy_digest: checkedPolicy.policy_digest,
    plan_id: checkedPlan.plan_id,
    plan_digest: checkedPlan.plan_digest,
    parent_sha: checkedPolicy.parent_sha,
    candidate_sha: candidateSha,
    source_tree_digest: checkedPolicy.source_tree_digest,
    resulting_tree_digest: exactDigest(resulting_tree_digest, 'resulting_tree'),
    immutable_skeleton_digest_before: checkedPolicy.immutable_skeleton_digest,
    immutable_skeleton_digest_after: skeletonAfter,
    immutable_skeleton_unchanged: true,
    observed_blocks: Object.freeze(normalizedObserved),
    observed_block_count: normalizedObserved.length,
    unexpected_changed_paths: Object.freeze([]),
    source_parser_digest: exactDigest(source_parser_digest, 'source_parser'),
    evidence_refs: normalizeEvidenceRefs(evidence_refs),
    external_materializer: true,
    authored_by_candidate: false,
    only_declared_blocks_changed: true,
    anchors_unchanged: true,
    eligible_for_external_evaluation: true,
    eligible_for_archive_admission: false,
    eligible_for_promotion: false,
    materialization_is_execution_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, materialization_digest: digest(core) });
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error('rsi_skeleton_evidence_refs_invalid');
  const seen = new Set();
  return Object.freeze(value.map((raw) => {
    const ref = boundedId(raw, 'evidence_ref');
    if (seen.has(ref)) throw new Error('rsi_skeleton_evidence_ref_duplicate');
    seen.add(ref);
    return ref;
  }).sort());
}

export function verifyRsiFixedSkeletonMaterializationReceipt(receipt, policy, plan) {
  if (!plainObject(receipt) || receipt.schema !== RSI_FIXED_SKELETON_MATERIALIZATION_SCHEMA || receipt.version !== 1) {
    throw new Error('rsi_skeleton_materialization_invalid');
  }
  assertZeroAuthority(receipt, 'materialization');
  if (
    receipt.external_materializer !== true
    || receipt.authored_by_candidate !== false
    || receipt.immutable_skeleton_unchanged !== true
    || receipt.only_declared_blocks_changed !== true
    || receipt.anchors_unchanged !== true
    || receipt.eligible_for_external_evaluation !== true
    || receipt.eligible_for_archive_admission !== false
    || receipt.eligible_for_promotion !== false
    || receipt.materialization_is_execution_authority !== false
  ) throw new Error('rsi_skeleton_materialization_policy_invalid');

  const canonical = createRsiFixedSkeletonMaterializationReceipt({
    policy,
    plan,
    candidate_sha: receipt.candidate_sha,
    resulting_tree_digest: receipt.resulting_tree_digest,
    immutable_skeleton_digest_after: receipt.immutable_skeleton_digest_after,
    observed_blocks: receipt.observed_blocks,
    unexpected_changed_paths: receipt.unexpected_changed_paths,
    source_parser_digest: receipt.source_parser_digest,
    evidence_refs: receipt.evidence_refs,
    external_materializer: true,
    authored_by_candidate: false,
  });
  if (canonical.materialization_digest !== exactDigest(receipt.materialization_digest, 'materialization')) {
    throw new Error('rsi_skeleton_materialization_digest_mismatch');
  }
  return canonical;
}

export function rsiFixedSkeletonTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.fixed-skeleton-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-fixed-skeleton-mutation.mjs',
    mechanism: 'FIXED_SKELETON_TYPED_EVOLVE_BLOCKS',
    funsearch_skeleton_inspired: true,
    alphaevolve_minimal_skeleton_compatible: true,
    immutable_skeleton_required: true,
    exact_block_anchors_required: true,
    digest_addressed_replacements: true,
    raw_patch_is_authority: false,
    only_declared_blocks_mutable: true,
    authority_paths_mutable: false,
    arbitrary_file_mutation_allowed: false,
    candidate_can_add_mutable_blocks: false,
    candidate_can_modify_policy: false,
    materialization_requires_external_parser_readback: true,
    materialization_is_execution_authority: false,
    full_external_evaluation_required_after_materialization: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, fixed_skeleton_root_digest: digest(root) });
}
