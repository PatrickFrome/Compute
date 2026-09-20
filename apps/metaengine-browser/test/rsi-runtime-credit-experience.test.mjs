import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRsiBrowserOutcomeEpisode } from '../src/rsi-browser-outcome-ingest.mjs';
import {
  createRsiStepCreditReceipt,
  verifyRsiStepCreditReceipt,
  rsiStepCreditTrustRootSnapshot,
} from '../src/rsi-runtime-credit-assignment.mjs';
import {
  RsiRuntimeExperienceStore,
  materializeRsiExperienceCaseFromCredit,
  rsiRuntimeExperienceStoreTrustRootSnapshot,
} from '../src/rsi-runtime-experience-store.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;

function episode({command='33333333-3333-4333-8333-333333333333',step=1,count=2,predecessor=null,effect='CONFIRMED'}={}){
  return createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,
    readback:{
      schema:'metaengine.rsi.result-receipt-readback.v1',
      command_id:command,found:true,terminal:true,status:'COMPLETED',
      receipt:{
        schema:'metaengine.native-supervisor.command-receipt.v2',
        command_id:command,action:'SCROLL',platform:'CHATGPT',result:{moved:true},
        effect_outcome:effect,lane:'MUTATION',effect_key:`effect-${step}`,execution_ms:10+step,
        recorded_at:`2026-09-18T17:2${step}:00.000Z`,authority_effect:false,
      },
      error:null,execution_authority:false,production_mutation_authority:false,promotion_authority:false,
      self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
    },
    attribution:{
      task_id:'task.credit.experience.1',task_signature_digest:d('1'),
      environment_fingerprint:'env.browser.chatgpt.v1',model_family:'GPT_5_6_SOL',
      candidate_id:`candidate_sha256_${'b'.repeat(64)}`,candidate_sha:'c'.repeat(40),proposal_digest:d('2'),
      skill_digests:[d('3')],trajectory_id:'trajectory.credit.1',step_index:step,step_count:count,
      predecessor_episode_digest:predecessor,external_attribution:true,authored_by_candidate:false,
    },
  });
}

function anchor(){
  return {
    task_id:'task.credit.experience.1',
    task_signature_digest:d('1'),
    challenge_family:'BROWSER_INTERACTION',
    hidden_manifest_digest:d('4'),
    external_writer:true,
    authored_by_candidate:false,
  };
}

function credit(ep,overrides={}){
  return createRsiStepCreditReceipt({
    credit_id:`credit.${ep.command_id}`,
    episode:ep,
    credit_sign:'POSITIVE',
    credit_score:0.75,
    method:'EXTERNAL_STEP_EVALUATOR',
    evaluator_digest:d('5'),
    evaluation_digest:d('6'),
    failure_codes:[],
    lesson_digests:[d('7')],
    evidence_refs:['eval:step:1'],
    external_credit_assigner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('trajectory-bound Browser outcome is eligible for external step credit',()=>{
  const ep=episode();
  assert.equal(ep.eligible_for_credit_assignment,true);
  assert.equal(ep.trajectory_id,'trajectory.credit.1');
  assert.equal(ep.step_index,1);
  assert.equal(ep.step_count,2);
  const receipt=credit(ep);
  verifyRsiStepCreditReceipt(receipt,ep);
  assert.equal(receipt.credit_sign,'POSITIVE');
  assert.equal(receipt.final_task_reward_broadcast_to_all_steps,false);
  assert.equal(receipt.candidate_can_assign_own_credit,false);
  assert.equal(receipt.authority_effect,false);
});

test('candidate cannot self-assign credit and negative credit requires an explicit failure code',()=>{
  const ep=episode();
  assert.throws(()=>createRsiStepCreditReceipt({
    credit_id:'credit.self',episode:ep,credit_sign:'POSITIVE',credit_score:1,method:'EXTERNAL_STEP_EVALUATOR',
    evaluator_digest:d('5'),evaluation_digest:d('6'),evidence_refs:['self:claim'],
    external_credit_assigner:false,authored_by_candidate:true,
  }),/external_assigner_required/);
  assert.throws(()=>credit(ep,{credit_sign:'NEGATIVE',credit_score:-0.5,failure_codes:[]}),/negative_failure_code_required/);
});

test('positive and negative external credit become typed experience cases while neutral is held',()=>{
  const ep=episode();
  const positive=materializeRsiExperienceCaseFromCredit({episode:ep,credit_receipt:credit(ep),task_anchor:anchor()});
  assert.equal(positive.state,'MATERIALIZED');
  assert.equal(positive.case_row.outcome,'SUCCESS');
  assert.equal(positive.case_row.raw_trajectory_present,false);
  assert.deepEqual(positive.case_row.lesson_digests,[d('7')]);

  const ep2=episode({command:'44444444-4444-4444-8444-444444444444',step:2,predecessor:ep.episode_digest});
  const negativeCredit=credit(ep2,{
    credit_id:'credit.negative.2',credit_sign:'NEGATIVE',credit_score:-0.4,
    failure_codes:['BAD_TARGET_SELECTION'],lesson_digests:[d('8')],evidence_refs:['eval:step:2'],
  });
  const negative=materializeRsiExperienceCaseFromCredit({episode:ep2,credit_receipt:negativeCredit,task_anchor:anchor()});
  assert.equal(negative.case_row.outcome,'FAILURE');
  assert.deepEqual(negative.case_row.failure_codes,['BAD_TARGET_SELECTION']);
  assert.ok(negative.case_row.attribution_digests.includes(ep.episode_digest));

  const neutralCredit=credit(ep,{credit_id:'credit.neutral.1',credit_sign:'NEUTRAL',credit_score:0,lesson_digests:[]});
  const neutral=materializeRsiExperienceCaseFromCredit({episode:ep,credit_receipt:neutralCredit,task_anchor:anchor()});
  assert.equal(neutral.state,'HELD_NEUTRAL');
  assert.equal(neutral.case_row,null);
});

test('runtime experience store persists append-only graph snapshots and exact idempotence',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-experience-store-'));
  const statePath=path.join(root,'experience.json');
  try{
    const store=new RsiRuntimeExperienceStore({statePath,source_sha:SOURCE});
    await store.init();
    const ep=episode();
    const materialized=materializeRsiExperienceCaseFromCredit({episode:ep,credit_receipt:credit(ep),task_anchor:anchor()});
    const first=await store.appendMaterialization(materialized);
    assert.equal(first.state,'APPENDED');
    assert.equal(store.snapshot().graph_epoch,1);
    assert.equal(store.snapshot().case_count,1);

    const again=await store.appendMaterialization(materialized);
    assert.equal(again.state,'IDEMPOTENT');
    assert.equal(store.snapshot().graph_epoch,1);

    const ep2=episode({command:'44444444-4444-4444-8444-444444444444',step:2,predecessor:ep.episode_digest});
    const secondMaterialized=materializeRsiExperienceCaseFromCredit({
      episode:ep2,
      credit_receipt:credit(ep2,{credit_id:'credit.positive.2',evidence_refs:['eval:step:2']}),
      task_anchor:anchor(),
    });
    const second=await store.appendMaterialization(secondMaterialized);
    assert.equal(second.state,'APPENDED');
    assert.equal(store.snapshot().graph_epoch,2);
    assert.equal(store.snapshot().case_count,2);

    const restored=new RsiRuntimeExperienceStore({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().graph_epoch,2);
    assert.equal(restored.snapshot().case_count,2);
    assert.equal(restored.graphSnapshot().predecessor_snapshot_digest!=null,true);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('task anchor drift cannot rewrite the durable experience graph',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-experience-anchor-'));
  try{
    const store=new RsiRuntimeExperienceStore({statePath:path.join(root,'experience.json'),source_sha:SOURCE});
    await store.init();
    const ep=episode();
    await store.appendMaterialization(materializeRsiExperienceCaseFromCredit({episode:ep,credit_receipt:credit(ep),task_anchor:anchor()}));
    const ep2=episode({command:'44444444-4444-4444-8444-444444444444',step:2,predecessor:ep.episode_digest});
    const drift={...anchor(),hidden_manifest_digest:d('9')};
    const materialized=materializeRsiExperienceCaseFromCredit({episode:ep2,credit_receipt:credit(ep2,{credit_id:'credit.anchor.2',evidence_refs:['eval:step:2']}),task_anchor:drift});
    await assert.rejects(()=>store.appendMaterialization(materialized),/task_anchor_conflict/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('credit and experience-store trust roots remain evidence-only',()=>{
  const creditRoot=rsiStepCreditTrustRootSnapshot();
  const storeRoot=rsiRuntimeExperienceStoreTrustRootSnapshot();
  assert.equal(creditRoot.final_task_reward_broadcast_to_all_steps,false);
  assert.equal(creditRoot.candidate_can_assign_own_credit,false);
  assert.equal(storeRoot.append_only_graph_chain,true);
  assert.equal(storeRoot.candidate_can_write_graph,false);
  assert.equal(storeRoot.execution_authority,false);
  assert.equal(storeRoot.authority_effect,false);
});
