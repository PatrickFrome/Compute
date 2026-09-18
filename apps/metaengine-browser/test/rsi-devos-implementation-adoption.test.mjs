import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import {
  createRsiDevosImplementationAdoption,
  verifyRsiDevosImplementationAdoption,
  verifyRsiFrontierReviewResult,
  RSI_FRONTIER_REVIEW_RESULT_SCHEMA,
} from '../src/rsi-devos-implementation-adoption.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiMutationContract } from '../src/supervisor-rsi-mutation-contract.mjs';

const SOURCE='46b7b838439120f796e932a4f71edcc3915228d8';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}

function review(){
  const observer=new RsiCommandPlaneLivenessObserver({
    source_sha:SOURCE,
    clock:()=>Date.parse('2026-09-18T10:41:40Z'),
    heartbeat_fresh_ms:15_000,
    perception_fresh_ms:15_000,
    command_stall_ms:120_000,
  });
  const observation=observer.observe({
    schema:RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at:'2026-09-18T10:41:40Z',
    heartbeat_at:'2026-09-18T10:41:35Z',
    perception_at:'2026-09-18T10:41:36Z',
    command_progress_at:'2026-09-18T05:09:49.879Z',
    pending_command_count:5,
    active_command:{
      command_id:'d5d24937-c7e6-4ce1-bf93-134495b1d039',
      action:'SCROLL',command_lane:'TAB_MUTATION',status:'LEASED',
      leased_at:'2026-09-18T05:09:48.211Z',
      effect_bound_at:'2026-09-18T05:09:49.879Z',
      receipt_recorded_at:null,
    },
    command_payload_exposed:false,page_text_exposed:false,input_values_exposed:false,raw_network_exposed:false,
    execution_authority:false,production_mutation_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
  const opportunity=observation.opportunities.find(x=>x.signal==='RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.ok(opportunity);
  const hypothesis=buildRsiExperimentHypothesis({observation,opportunity_id:opportunity.opportunity_id});
  const experiment_plan=buildRsiDevosExperimentPlan({observation,opportunity_id:opportunity.opportunity_id,hypothesis});
  const mutation_contract=buildRsiMutationContract({hypothesis});
  const material={
    schema:RSI_FRONTIER_REVIEW_RESULT_SCHEMA,version:1,
    verdict:'ACCEPT',
    source_sha:SOURCE,
    opportunity_id:opportunity.opportunity_id,
    hypothesis_digest:hypothesis.hypothesis_digest,
    plan_digest:experiment_plan.plan_digest,
    mutation_contract_digest:mutation_contract.contract_digest,
    hypothesis,experiment_plan,mutation_contract,
    reviewed_by_external_agent:true,
    authored_by_candidate:false,
    candidate_materialization_performed:false,
    implementation_dispatched:false,
    review_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...material,review_digest:digest(material)};
}

test('accepted external review becomes an exact zero-authority implementation envelope',()=>{
  const reviewed=review();
  assert.equal(verifyRsiFrontierReviewResult(reviewed).verdict,'ACCEPT');
  const adoption=createRsiDevosImplementationAdoption({review_result:reviewed});
  assert.equal(adoption.source_sha,SOURCE);
  assert.equal(adoption.target_branch,reviewed.experiment_plan.target_branch);
  assert.deepEqual(adoption.implementation_task_spec.exact_mutation_set,reviewed.mutation_contract.allowed_mutations);
  assert.equal(adoption.implementation_task_spec.isolated_candidate_builder_required,true);
  assert.equal(adoption.implementation_task_spec.verification_sandbox_required,true);
  assert.equal(adoption.implementation_task_spec.external_evaluator_required,true);
  assert.equal(adoption.implementation_task_spec.no_second_scheduler,true);
  assert.equal(adoption.implementation_task_spec.no_blind_retry_after_ambiguous_effect,true);
  assert.equal(adoption.implementation_task_not_yet_enqueued,true);
  assert.equal(adoption.candidate_not_yet_materialized,true);
  assert.equal(adoption.external_scheduler_must_revalidate_current_source,true);
  assert.equal(adoption.execution_authority,false);
  assert.equal(verifyRsiDevosImplementationAdoption(adoption,{review_result:reviewed}).adoption_digest,adoption.adoption_digest);
});

test('review cannot widen the mutation contract or self-authorize implementation',()=>{
  const widened=structuredClone(review());
  widened.mutation_contract.allowed_mutations.push({path:'apps/metaengine-browser/src/main.mjs',change:'MODIFY'});
  const material=structuredClone(widened); delete material.review_digest; widened.review_digest=digest(material);
  assert.throws(()=>verifyRsiFrontierReviewResult(widened),/mutation_contract/);

  const authoritative=structuredClone(review());
  authoritative.implementation_dispatched=true;
  const body=structuredClone(authoritative); delete body.review_digest; authoritative.review_digest=digest(body);
  assert.throws(()=>verifyRsiFrontierReviewResult(authoritative),/review_policy_invalid/);
});

test('source, plan and hypothesis digest drift fails closed before a task spec exists',()=>{
  for(const mutate of [
    r=>{r.source_sha='f'.repeat(40);},
    r=>{r.plan_digest='0'.repeat(64);},
    r=>{r.hypothesis_digest=`sha256:${'0'.repeat(64)}`;},
  ]){
    const row=structuredClone(review());
    mutate(row);
    const body=structuredClone(row); delete body.review_digest; row.review_digest=digest(body);
    assert.throws(()=>createRsiDevosImplementationAdoption({review_result:row}),/binding_invalid|digest_mismatch/);
  }
});
