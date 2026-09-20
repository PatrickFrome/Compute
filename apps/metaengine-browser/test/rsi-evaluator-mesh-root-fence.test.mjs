import assert from 'node:assert/strict';
import test from 'node:test';

import { createRsiEvaluatorMeshPlan } from '../src/rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const CANDIDATE_ID = `candidate_sha256_${'d'.repeat(64)}`;

function baseHandoff(componentPath) {
  return {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    parent_sha: PARENT,
    candidate_sha: CANDIDATE,
    handoff_digest: `sha256:${'c'.repeat(64)}`,
    candidate_capsule: {
      candidate_id: CANDIDATE_ID,
      source: { head: CANDIDATE },
      components: [{ path: componentPath, change: 'MODIFY', digest: `sha256:${'e'.repeat(64)}` }],
    },
    candidate_verification: { ok: true, executable: false, promotion_authorized: false },
    sandbox_plan: { mode: 'PREPARE_ONLY' },
    sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: {
      candidate_id: CANDIDATE_ID,
      parent_sha: PARENT,
      candidate_sha: CANDIDATE,
      mutation_surface: 'AGENT_ORCHESTRATION',
      hypothesis: 'bounded test candidate',
    },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

test('evaluator admission rejects any candidate component that mutates evaluator trust root', () => {
  for (const path of [
    'apps/metaengine-browser/src/rsi-evaluator-mesh.mjs',
    'apps/metaengine-browser/src/rsi-shadow-core.mjs',
    'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',
    'apps/metaengine-browser/src/candidate-capsule.cjs',
    'apps/metaengine-browser/src/verification-sandbox-plan.cjs',
    'apps/metaengine-browser/src/verification-sandbox-backend-binding.cjs',
    'apps/metaengine-browser/src/browser-identity-signer-runtime.mjs',
    'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
  ]) {
    assert.throws(() => createRsiEvaluatorMeshPlan({ candidate_handoff: baseHandoff(path) }), /candidate_mutates_evaluator_root/);
  }
});

test('non-root candidate component remains admissible for evaluation planning', () => {
  const plan = createRsiEvaluatorMeshPlan({ candidate_handoff: baseHandoff('apps/metaengine-browser/src/browser-brain-routing-v2.mjs') });
  assert.equal(plan.evaluator_root.candidate_mutable, false);
  assert.equal(plan.evaluator_root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-evaluator-mesh.mjs'), true);
  assert.equal(plan.promotion_authority, false);
});
