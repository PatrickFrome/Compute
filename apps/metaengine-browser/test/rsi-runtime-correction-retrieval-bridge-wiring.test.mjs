import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime rejects direct raw bridge-case injection',()=>{
  const start=runtime.indexOf('experienceContextForOpportunity({');
  const end=runtime.indexOf('async recordCorrectionRetrievalBridgeSelection({',start);
  assert.ok(start>=0&&end>start,'experienceContextForOpportunity missing');
  const body=runtime.slice(start,end);
  assert.match(body,/bridge_case_ids = \[\]/);
  assert.match(body,/rsi_runtime_external_bridge_selection_required/);
  assert.match(body,/bridge_selection_digest = null/);
  assert.match(body,/#findCorrectionRetrievalBridgeByDigest/);
  assert.match(body,/verifyRsiCorrectionRetrievalBridge/);
});

test('runtime persists external correction bridge selection against an empty-bridge base plan',()=>{
  const start=runtime.indexOf('async recordCorrectionRetrievalBridgeSelection({');
  const end=runtime.indexOf('async openLearningEpisodeFromOpportunity({',start);
  assert.ok(start>=0&&end>start,'recordCorrectionRetrievalBridgeSelection missing');
  const body=runtime.slice(start,end);
  assert.match(body,/bridge_case_ids: \[\]/);
  assert.match(body,/createRsiCorrectionRetrievalBridge/);
  assert.match(body,/verifyRsiCorrectionRetrievalBridge/);
  assert.match(body,/RSI_CORRECTION_RETRIEVAL_BRIDGE_RECORDED/);
  assert.match(body,/candidate_can_select_bridges: false/);
  assert.match(body,/bridge_selection_is_retrieval_signal_only: true/);
  assert.match(body,/source_context_truth_is_portable: false/);
  assert.match(body,/execution_authority: false/);
  assert.match(body,/promotion_authority: false/);
});

test('learning episode can consume only a persisted bridge selection digest',()=>{
  const start=runtime.indexOf('async openLearningEpisodeFromOpportunity({');
  const end=runtime.indexOf('episodeExperienceContext(',start);
  assert.ok(start>=0&&end>start,'openLearningEpisodeFromOpportunity missing');
  const body=runtime.slice(start,end);
  assert.match(body,/bridge_selection_digest = null/);
  assert.match(body,/bridge_selection_digest,/);
  assert.doesNotMatch(body,/bridge_case_ids\.push|bridge_case_ids\s*=\s*selection/);
});

test('runtime replay verifies correction bridge against exact graph and embedded base plan',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.correction_retrieval_bridge\)/);
  assert.match(runtime,/verifyRsiCorrectionRetrievalBridge\(/);
  assert.match(runtime,/row\.payload\.correction_retrieval_bridge\.base_context_plan/);
  assert.match(runtime,/#correctionRetrievalBridgeCount \+= 1/);
  assert.match(runtime,/#lastCorrectionRetrievalBridgeDigest/);
});

test('runtime snapshot makes bridge selection advisory and candidate-inaccessible',()=>{
  assert.match(runtime,/correction_retrieval_bridge: Object\.freeze\(\{/);
  assert.match(runtime,/raw_bridge_case_ids_accepted: false/);
  assert.match(runtime,/persisted_external_selection_required: true/);
  assert.match(runtime,/correction_failure_cases_only: true/);
  assert.match(runtime,/verified_success_correction_targets_required: true/);
  assert.match(runtime,/candidate_can_select_bridges: false/);
  assert.match(runtime,/bridge_selection_is_retrieval_signal_only: true/);
  assert.match(runtime,/source_context_truth_is_portable: false/);
  assert.match(runtime,/execution_authority: false/);
});
