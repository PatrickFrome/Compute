import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime retrieval influence requires persisted evaluation context and graph',()=>{
  const start=runtime.indexOf('async recordRetrievalInfluenceEvidence({');
  const end=runtime.indexOf('async prepareExternalPromotionReview({',start);
  assert.ok(start>=0&&end>start,'recordRetrievalInfluenceEvidence missing');
  const body=runtime.slice(start,end);
  assert.match(body,/rsi_runtime_external_evaluation_bundle_not_persisted/);
  assert.match(body,/rsi_runtime_retrieval_influence_context_plan_not_persisted/);
  assert.match(body,/rsi_runtime_retrieval_influence_experience_graph_required/);
  assert.match(body,/rsi_runtime_retrieval_influence_ambiguous_evaluation_forbidden/);
  assert.match(body,/createRsiRetrievalInfluenceAdmission/);
  assert.match(body,/verifyRsiRetrievalInfluenceAdmission/);
});

test('runtime appends retrieval influence before mutating Experience Graph',()=>{
  const start=runtime.indexOf('async recordRetrievalInfluenceEvidence({');
  const end=runtime.indexOf('async prepareExternalPromotionReview({',start);
  const body=runtime.slice(start,end);
  const compute=body.indexOf('const nextGraph = applyRsiRetrievalInfluenceAdmission');
  const append=body.indexOf("await this.#ledger.append('RSI_RETRIEVAL_INFLUENCE_EVIDENCE_RECORDED'");
  const apply=body.indexOf('this.#experienceGraphSnapshot = nextGraph');
  assert.ok(compute>=0&&append>compute&&apply>append,'graph mutation must follow durable append');
});

test('runtime retrieval influence forbids shared trajectory reward and candidate memory rating',()=>{
  const start=runtime.indexOf('async recordRetrievalInfluenceEvidence({');
  const end=runtime.indexOf('async prepareExternalPromotionReview({',start);
  const body=runtime.slice(start,end);
  assert.match(body,/per_case_utility_only: true/);
  assert.match(body,/trajectory_level_reward_assigned: false/);
  assert.match(body,/co_retrieved_memories_share_reward: false/);
  assert.match(body,/unassessed_cases_receive_no_utility: true/);
  assert.match(body,/candidate_can_rate_memory: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|applyWhenSafe|quitAndInstall|issue_native|lease_batch|complete_v5/);
});

test('runtime replay independently verifies influence lineage before applying receipts',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.retrieval_influence_admission\)/);
  assert.match(runtime,/#findExternalEvaluationBundleByDigest/);
  assert.match(runtime,/#experienceContextPlans\.get\(admission\.episode_id\)/);
  assert.match(runtime,/rsi_runtime_retrieval_influence_replay_lineage_missing/);
  assert.match(runtime,/verifyRsiRetrievalInfluenceAdmission\(admission, \{/);
  assert.match(runtime,/applyRsiRetrievalInfluenceAdmission\(/);
  assert.match(runtime,/#retrievalInfluenceCount \+= 1/);
});

test('runtime snapshot exposes retrieval influence as append-only zero-authority evidence',()=>{
  assert.match(runtime,/retrieval_influence: Object\.freeze\(\{/);
  assert.match(runtime,/external_evaluation_bundle_required: true/);
  assert.match(runtime,/per_case_utility_only: true/);
  assert.match(runtime,/trajectory_level_reward_assigned: false/);
  assert.match(runtime,/co_retrieved_memories_share_reward: false/);
  assert.match(runtime,/unassessed_cases_receive_no_utility: true/);
  assert.match(runtime,/candidate_can_rate_memory: false/);
  assert.match(runtime,/graph_append_only: true/);
  assert.match(runtime,/execution_authority: false/);
  assert.match(runtime,/self_update_authority: false/);
});
