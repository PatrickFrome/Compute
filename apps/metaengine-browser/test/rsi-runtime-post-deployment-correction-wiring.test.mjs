import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime correction requires persisted learning and two persisted utility admissions',()=>{
  const start=runtime.indexOf('async recordPostDeploymentCorrection({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'recordPostDeploymentCorrection missing');
  const body=runtime.slice(start,end);
  assert.match(body,/rsi_runtime_post_deployment_learning_admission_not_persisted/);
  assert.match(body,/rsi_runtime_post_deployment_utility_admission_not_persisted/);
  assert.match(body,/rsi_runtime_post_deployment_correction_distinct_utility_required/);
  assert.match(body,/createRsiPostDeploymentCorrectionAdmission/);
  assert.match(body,/verifyRsiPostDeploymentCorrectionAdmission/);
});

test('runtime persists correction before applying the derived trace to the graph',()=>{
  const start=runtime.indexOf('async recordPostDeploymentCorrection({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  const body=runtime.slice(start,end);
  const compute=body.indexOf('const nextGraph = applyRsiPostDeploymentCorrectionAdmission');
  const append=body.indexOf("await this.#ledger.append('RSI_POST_DEPLOYMENT_CORRECTION_RECORDED'");
  const apply=body.indexOf('this.#experienceGraphSnapshot = nextGraph');
  assert.ok(compute>=0&&append>compute&&apply>append,'correction graph mutation must follow durable append');
});

test('runtime correction is retrieval-only and cannot trigger rollback self-update or promotion',()=>{
  const start=runtime.indexOf('async recordPostDeploymentCorrection({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  const body=runtime.slice(start,end);
  assert.match(body,/original_deployment_case_preserved: true/);
  assert.match(body,/correction_edge_is_retrieval_signal_only: true/);
  assert.match(body,/candidate_can_self_certify_recovery: false/);
  assert.match(body,/rollback_triggered: false/);
  assert.match(body,/self_update_triggered: false/);
  assert.match(body,/promotion_triggered: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|applyWhenSafe|quitAndInstall|issue_native|lease_batch|complete_v5/);
});

test('runtime replay validates and reapplies correction traces append-only',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.post_deployment_correction_admission\)/);
  assert.match(runtime,/verifyRsiPostDeploymentCorrectionAdmission\(row\.payload\.post_deployment_correction_admission\)/);
  assert.match(runtime,/applyRsiPostDeploymentCorrectionAdmission\(/);
  assert.match(runtime,/#postDeploymentCorrectionCount \+= 1/);
  assert.match(runtime,/#lastPostDeploymentCorrectionEdgeDigest/);
});

test('runtime snapshot keeps correction traces zero-authority',()=>{
  assert.match(runtime,/post_deployment_correction: Object\.freeze\(\{/);
  assert.match(runtime,/harmful_then_helpful_temporal_order_required: true/);
  assert.match(runtime,/derived_failure_success_trace_only: true/);
  assert.match(runtime,/correction_edge_is_retrieval_signal_only: true/);
  assert.match(runtime,/rollback_triggered_by_rsi: false/);
  assert.match(runtime,/self_update_triggered_by_rsi: false/);
  assert.match(runtime,/promotion_triggered_by_rsi: false/);
  assert.match(runtime,/release_authority: false/);
  assert.match(runtime,/self_update_authority: false/);
});
