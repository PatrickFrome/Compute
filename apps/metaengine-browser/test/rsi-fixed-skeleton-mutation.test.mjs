import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiFixedSkeletonPolicy,
  verifyRsiFixedSkeletonPolicy,
  createRsiFixedSkeletonMutationPlan,
  verifyRsiFixedSkeletonMutationPlan,
  createRsiFixedSkeletonMaterializationReceipt,
  verifyRsiFixedSkeletonMaterializationReceipt,
  rsiFixedSkeletonTrustRootSnapshot,
} from '../src/rsi-fixed-skeleton-mutation.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;
const sha = (char) => char.repeat(40);

function blocks() {
  return [
    {
      block_id: 'block.command-priority',
      file_path: 'apps/metaengine-browser/src/command-priority-policy.mjs',
      language: 'JAVASCRIPT',
      semantic_role: 'PRIORITY_HEURISTIC',
      baseline_block_digest: d('1'),
      start_anchor_digest: d('a'),
      end_anchor_digest: d('b'),
      max_bytes: 8192,
    },
    {
      block_id: 'block.memory-ranking',
      file_path: 'apps/metaengine-browser/src/memory-ranking-policy.mjs',
      language: 'JAVASCRIPT',
      semantic_role: 'RANKING_HEURISTIC',
      baseline_block_digest: d('2'),
      start_anchor_digest: d('c'),
      end_anchor_digest: d('d'),
      max_bytes: 4096,
    },
  ];
}

function policy(overrides = {}) {
  return createRsiFixedSkeletonPolicy({
    policy_id: 'fixed-skeleton.browser-heuristics.1',
    parent_sha: sha('1'),
    source_tree_digest: d('3'),
    immutable_skeleton_digest: d('4'),
    blocks: blocks(),
    max_mutated_blocks: 2,
    max_total_mutated_bytes: 16 * 1024,
    external_policy_owner: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

function plan(p = policy()) {
  return createRsiFixedSkeletonMutationPlan({
    policy: p,
    plan_id: 'fixed-skeleton.plan.1',
    generation: 12,
    mutations: [
      {
        block_id: 'block.command-priority',
        replacement_digest: d('5'),
        replacement_bytes: 5000,
        proposal_evidence_digest: d('6'),
      },
      {
        block_id: 'block.memory-ranking',
        replacement_digest: d('7'),
        replacement_bytes: 3000,
        proposal_evidence_digest: d('8'),
      },
    ],
    external_planner: true,
    authored_by_candidate: false,
  });
}

function observed(p, mutationPlan) {
  return mutationPlan.mutations.map((mutation) => {
    const block = p.blocks.find((row) => row.block_id === mutation.block_id);
    return {
      block_id: block.block_id,
      file_path: block.file_path,
      before_digest: block.baseline_block_digest,
      after_digest: mutation.replacement_digest,
      after_bytes: mutation.replacement_bytes,
      start_anchor_digest: block.start_anchor_digest,
      end_anchor_digest: block.end_anchor_digest,
    };
  });
}

test('fixed skeleton policy exposes only declared critical blocks and keeps authority roots immutable', () => {
  const p = policy();
  verifyRsiFixedSkeletonPolicy(p);
  assert.equal(p.mutation_mode, 'DIGEST_ADDRESSED_TYPED_EVOLVE_BLOCKS_ONLY');
  assert.equal(p.immutable_skeleton_must_remain_exact, true);
  assert.equal(p.immutable_regions_are_candidate_inaccessible, true);
  assert.equal(p.only_declared_blocks_mutable, true);
  assert.equal(p.block_anchors_must_remain_exact, true);
  assert.equal(p.authority_paths_mutable, false);
  assert.equal(p.arbitrary_file_mutation_allowed, false);
  assert.equal(p.candidate_can_add_mutable_blocks, false);
  assert.equal(p.candidate_can_modify_policy, false);
  assert.equal(p.raw_patch_is_authority, false);
  assert.equal(p.authority_effect, false);
});

test('authority and RSI control-plane paths cannot be declared as evolve blocks', () => {
  for (const file_path of [
    '.github/workflows/evil.yml',
    'apps/metaengine-browser/supabase/edge.ts',
    'apps/metaengine-browser/src/native-supervisor-client.mjs',
    'apps/metaengine-browser/src/self-update-controller.mjs',
    'apps/metaengine-browser/src/rsi-open-ended-search-policy.mjs',
  ]) {
    assert.throws(() => policy({
      blocks: [{
        block_id: 'block.forbidden',
        file_path,
        language: 'JAVASCRIPT',
        semantic_role: 'FORBIDDEN',
        baseline_block_digest: d('1'),
        start_anchor_digest: d('2'),
        end_anchor_digest: d('3'),
        max_bytes: 1024,
      }],
      max_mutated_blocks: 1,
    }), /authority_path_forbidden/);
  }
});

test('mutation plan is digest-addressed only and structurally excludes raw patch content', () => {
  const p = policy();
  const mutationPlan = plan(p);
  verifyRsiFixedSkeletonMutationPlan(mutationPlan, p);
  assert.equal(mutationPlan.mutation_count, 2);
  assert.equal(mutationPlan.total_replacement_bytes, 8000);
  assert.equal(mutationPlan.raw_patch_content_present, false);
  assert.equal(mutationPlan.plan_is_materialization_authority, false);
  assert.equal(mutationPlan.plan_is_execution_authority, false);
  assert.equal(mutationPlan.plan_is_evaluation_authority, false);
  assert.equal(mutationPlan.plan_is_promotion_authority, false);
  for (const mutation of mutationPlan.mutations) {
    assert.equal(mutation.raw_patch_content_present, false);
    assert.equal(mutation.materialization_authority, false);
    assert.equal(Object.prototype.hasOwnProperty.call(mutation, 'content'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(mutation, 'patch'), false);
  }
});

test('undeclared, duplicate, no-op and oversized block mutations fail closed', () => {
  const p = policy();

  assert.throws(() => createRsiFixedSkeletonMutationPlan({
    policy: p,
    plan_id: 'plan.undeclared',
    generation: 1,
    mutations: [{
      block_id: 'block.unknown',
      replacement_digest: d('5'),
      replacement_bytes: 10,
      proposal_evidence_digest: d('6'),
    }],
    external_planner: true,
    authored_by_candidate: false,
  }), /block_not_declared/);

  assert.throws(() => createRsiFixedSkeletonMutationPlan({
    policy: p,
    plan_id: 'plan.duplicate',
    generation: 1,
    mutations: [
      { block_id: 'block.command-priority', replacement_digest: d('5'), replacement_bytes: 10, proposal_evidence_digest: d('6') },
      { block_id: 'block.command-priority', replacement_digest: d('7'), replacement_bytes: 10, proposal_evidence_digest: d('8') },
    ],
    external_planner: true,
    authored_by_candidate: false,
  }), /mutation_duplicate/);

  assert.throws(() => createRsiFixedSkeletonMutationPlan({
    policy: p,
    plan_id: 'plan.noop',
    generation: 1,
    mutations: [{
      block_id: 'block.command-priority',
      replacement_digest: d('1'),
      replacement_bytes: 10,
      proposal_evidence_digest: d('6'),
    }],
    external_planner: true,
    authored_by_candidate: false,
  }), /mutation_noop/);

  assert.throws(() => createRsiFixedSkeletonMutationPlan({
    policy: p,
    plan_id: 'plan.oversize',
    generation: 1,
    mutations: [{
      block_id: 'block.memory-ranking',
      replacement_digest: d('7'),
      replacement_bytes: 4097,
      proposal_evidence_digest: d('8'),
    }],
    external_planner: true,
    authored_by_candidate: false,
  }), /replacement_bytes_invalid/);
});

test('external materialization proves skeleton and anchors unchanged with exact block readback', () => {
  const p = policy();
  const mutationPlan = plan(p);
  const receipt = createRsiFixedSkeletonMaterializationReceipt({
    policy: p,
    plan: mutationPlan,
    candidate_sha: sha('2'),
    resulting_tree_digest: d('9'),
    immutable_skeleton_digest_after: p.immutable_skeleton_digest,
    observed_blocks: observed(p, mutationPlan),
    unexpected_changed_paths: [],
    source_parser_digest: d('e'),
    evidence_refs: ['PARSER_RUN_101', 'TREE_READBACK_101'],
    external_materializer: true,
    authored_by_candidate: false,
  });
  verifyRsiFixedSkeletonMaterializationReceipt(receipt, p, mutationPlan);
  assert.equal(receipt.immutable_skeleton_unchanged, true);
  assert.equal(receipt.only_declared_blocks_changed, true);
  assert.equal(receipt.anchors_unchanged, true);
  assert.equal(receipt.observed_block_count, 2);
  assert.equal(receipt.unexpected_changed_paths.length, 0);
  assert.equal(receipt.eligible_for_external_evaluation, true);
  assert.equal(receipt.eligible_for_archive_admission, false);
  assert.equal(receipt.eligible_for_promotion, false);
  assert.equal(receipt.materialization_is_execution_authority, false);
  assert.equal(receipt.authority_effect, false);
});

test('skeleton drift, anchor drift, unexpected path and block digest mismatch all fail materialization', () => {
  const p = policy();
  const mutationPlan = plan(p);
  const base = {
    policy: p,
    plan: mutationPlan,
    candidate_sha: sha('2'),
    resulting_tree_digest: d('9'),
    immutable_skeleton_digest_after: p.immutable_skeleton_digest,
    observed_blocks: observed(p, mutationPlan),
    unexpected_changed_paths: [],
    source_parser_digest: d('e'),
    evidence_refs: ['PARSER_RUN_102'],
    external_materializer: true,
    authored_by_candidate: false,
  };

  assert.throws(() => createRsiFixedSkeletonMaterializationReceipt({
    ...base,
    immutable_skeleton_digest_after: d('f'),
  }), /skeleton_drift/);

  assert.throws(() => createRsiFixedSkeletonMaterializationReceipt({
    ...base,
    unexpected_changed_paths: ['apps/metaengine-browser/src/unexpected.mjs'],
  }), /unexpected_path/);

  const anchorDrift = structuredClone(base.observed_blocks);
  anchorDrift[0].start_anchor_digest = d('f');
  assert.throws(() => createRsiFixedSkeletonMaterializationReceipt({
    ...base,
    observed_blocks: anchorDrift,
  }), /block_binding_mismatch/);

  const digestDrift = structuredClone(base.observed_blocks);
  digestDrift[1].after_digest = d('f');
  assert.throws(() => createRsiFixedSkeletonMaterializationReceipt({
    ...base,
    observed_blocks: digestDrift,
  }), /block_binding_mismatch/);
});

test('candidate cannot author policy, materialization proof or widen the mutable block set', () => {
  assert.throws(() => createRsiFixedSkeletonPolicy({
    policy_id: 'policy.self',
    parent_sha: sha('1'),
    source_tree_digest: d('3'),
    immutable_skeleton_digest: d('4'),
    blocks: blocks(),
    max_mutated_blocks: 2,
    max_total_mutated_bytes: 16 * 1024,
    external_policy_owner: false,
    authored_by_candidate: true,
  }), /external_origin_required/);

  const p = policy();
  const mutationPlan = plan(p);
  assert.throws(() => createRsiFixedSkeletonMaterializationReceipt({
    policy: p,
    plan: mutationPlan,
    candidate_sha: sha('2'),
    resulting_tree_digest: d('9'),
    immutable_skeleton_digest_after: p.immutable_skeleton_digest,
    observed_blocks: observed(p, mutationPlan),
    unexpected_changed_paths: [],
    source_parser_digest: d('e'),
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_materializer: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('fixed skeleton trust root encodes FunSearch-style critical-block evolution without widening authority', () => {
  const root = rsiFixedSkeletonTrustRootSnapshot();
  assert.equal(root.mechanism, 'FIXED_SKELETON_TYPED_EVOLVE_BLOCKS');
  assert.equal(root.funsearch_skeleton_inspired, true);
  assert.equal(root.alphaevolve_minimal_skeleton_compatible, true);
  assert.equal(root.immutable_skeleton_required, true);
  assert.equal(root.exact_block_anchors_required, true);
  assert.equal(root.digest_addressed_replacements, true);
  assert.equal(root.only_declared_blocks_mutable, true);
  assert.equal(root.authority_paths_mutable, false);
  assert.equal(root.candidate_can_add_mutable_blocks, false);
  assert.equal(root.materialization_requires_external_parser_readback, true);
  assert.equal(root.full_external_evaluation_required_after_materialization, true);
  assert.equal(root.execution_authority, false);
  assert.equal(root.promotion_authority, false);
  assert.equal(root.self_update_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.fixed_skeleton_root_digest, /^sha256:[0-9a-f]{64}$/);
});
