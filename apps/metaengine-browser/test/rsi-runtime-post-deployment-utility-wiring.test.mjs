import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime delayed utility requires a persisted post-deployment learning admission',()=>{
  const start=runtime.indexOf('async recordPostDeploymentUtility({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'recordPostDeploymentUtility missing');
  const body=runtime.slice(start,end);
  assert.match(body,/rsi_runtime_post_deployment_learning_admission_not_persisted/);
  assert.match(body,/createRsiPostDeploymentUtilityAdmission/);
  assert.match(body,/verifyRsiPostDeploymentUtilityAdmission/);
  assert.match(body,/RSI_POST_DEPLOYMENT_UTILITY_RECORDED/);
});

test('runtime applies utility to graph only after durable append',()=>{
  const start=runtime.indexOf('async recordPostDeploymentUtility({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  const body=runtime.slice(start,end);
  const compute=body.indexOf('const nextGraph = applyRsiPostDeploymentUtilityAdmission');
  const append=body.indexOf("await this.#ledger.append('RSI_POST_DEPLOYMENT_UTILITY_RECORDED'");
  const apply=body.indexOf('this.#experienceGraphSnapshot = nextGraph');
  assert.ok(compute>=0&&append>compute&&apply>append,'utility graph mutation must follow durable append');
});

test('runtime delayed utility has no self-rating rollback self-update or promotion authority',()=>{
  const start=runtime.indexOf('async recordPostDeploymentUtility({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  const body=runtime.slice(start,end);
  assert.match(body,/candidate_can_rate_self: false/);
  assert.match(body,/scalar_reward: null/);
  assert.match(body,/global_candidate_score_delta: null/);
  assert.match(body,/utility_can_trigger_rollback: false/);
  assert.match(body,/utility_can_trigger_self_update: false/);
  assert.match(body,/utility_can_trigger_promotion: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|applyWhenSafe|quitAndInstall|issue_native|lease_batch|complete_v5/);
});

test('runtime replay restores delayed utility into the append-only graph',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.post_deployment_utility_admission\)/);
  assert.match(runtime,/verifyRsiPostDeploymentUtilityAdmission\(row\.payload\.post_deployment_utility_admission\)/);
  assert.match(runtime,/applyRsiPostDeploymentUtilityAdmission\(/);
  assert.match(runtime,/#postDeploymentUtilityCount \+= 1/);
  assert.match(runtime,/#lastPostDeploymentUtilityOutcome/);
});

test('runtime snapshot keeps harmful utility queryable and non-actuating',()=>{
  assert.match(runtime,/post_deployment_utility: Object\.freeze\(\{/);
  assert.match(runtime,/delayed_external_observation_required: true/);
  assert.match(runtime,/utility_is_contextual_not_global_truth: true/);
  assert.match(runtime,/harmful_utility_remains_queryable: true/);
  assert.match(runtime,/candidate_can_rate_self: false/);
  assert.match(runtime,/utility_can_trigger_rollback: false/);
  assert.match(runtime,/release_authority: false/);
  assert.match(runtime,/self_update_authority: false/);
});
