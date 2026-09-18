import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime records post-deployment learning only after persisted convergence',()=>{
  const start=runtime.indexOf('async recordPostDeploymentLearning({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'recordPostDeploymentLearning missing');
  const body=runtime.slice(start,end);
  assert.match(body,/rsi_runtime_release_authority_convergence_not_persisted/);
  assert.match(body,/rsi_runtime_post_deployment_source_not_converged_candidate/);
  assert.match(body,/RSI_POST_DEPLOYMENT_LEARNING_RECORDED/);
  assert.match(body,/graph_applied_after_durable_append: true/);
  assert.match(body,/candidate_can_self_reward: false/);
  assert.match(body,/candidate_global_score_delta: null/);
  assert.match(body,/reward_scalar: null/);
  assert.match(body,/release_authority_advanced_by_learning: false/);
  assert.match(body,/self_update_invoked_by_learning: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|applyWhenSafe|quitAndInstall|issue_native|lease_batch|complete_v5/);
});

test('runtime applies the graph snapshot only after durable append',()=>{
  const start=runtime.indexOf('async recordPostDeploymentLearning({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  const body=runtime.slice(start,end);
  const build=body.indexOf('const nextGraph = applyRsiPostDeploymentExperienceAdmission');
  const append=body.indexOf("await this.#ledger.append('RSI_POST_DEPLOYMENT_LEARNING_RECORDED'");
  const apply=body.indexOf('this.#experienceGraphSnapshot = nextGraph');
  assert.ok(build>=0&&append>build&&apply>append,'graph mutation must happen after durable append');
});

test('runtime replay restores release chain and post-deployment learning state',()=>{
  for(const pattern of [
    /if \(row\?\.payload\?\.release_authority_handoff\)/,
    /if \(row\?\.payload\?\.release_executor_admission\)/,
    /if \(row\?\.payload\?\.release_effect_reconciliation\)/,
    /if \(row\?\.payload\?\.release_authority_convergence\)/,
    /if \(row\?\.payload\?\.post_deployment_learning_admission\)/,
  ]) assert.match(runtime,pattern);
  assert.match(runtime,/verifyRsiPostDeploymentExperienceAdmission\(row\.payload\.post_deployment_learning_admission\)/);
  assert.match(runtime,/applyRsiPostDeploymentExperienceAdmission\(/);
  assert.match(runtime,/#postDeploymentLearningConvergenceDigests\.add/);
});

test('runtime snapshot exposes contextual feedback but no candidate self-reward or authority',()=>{
  assert.match(runtime,/post_deployment_learning: Object\.freeze\(\{/);
  assert.match(runtime,/deployment_success_is_contextual_not_global_truth: true/);
  assert.match(runtime,/candidate_can_self_reward: false/);
  assert.match(runtime,/candidate_global_score_delta: null/);
  assert.match(runtime,/reward_scalar: null/);
  assert.match(runtime,/existing_experience_graph_only: true/);
  assert.match(runtime,/release_authority_advanced_by_learning: false/);
  assert.match(runtime,/release_authority: false/);
  assert.match(runtime,/self_update_authority: false/);
});
