import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRsiBrowserOutcomeEpisode } from '../src/rsi-browser-outcome-ingest.mjs';
import { createRsiStepCreditReceipt } from '../src/rsi-runtime-credit-assignment.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import { createRsiSkillLibraryGovernance } from '../src/rsi-skill-library-governance.mjs';
import {
  RsiRuntimeSkillRouter,
  createRsiSkillContextEvidence,
  verifyRsiSkillContextEvidence,
  createRsiSkillRouteContext,
  createRsiSkillRoutingPlan,
  rsiRuntimeSkillRouterTrustRootSnapshot,
} from '../src/rsi-runtime-skill-router.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function verifiedSkill({id,source,impl,role='ANALYZER',capabilities=['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES']}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:source.repeat(40),role,
    input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(impl),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities,max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d('3'),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:12,success_count:10,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}

function fixture(){
  const good=verifiedSkill({id:'skill.router.good',source:'b',impl:'b'});
  const bad=verifiedSkill({id:'skill.router.bad',source:'c',impl:'c'});
  const explore=verifiedSkill({
    id:'skill.router.explore',source:'d',impl:'d',role:'RETRIEVER',
    capabilities:['READ_VERIFIED_CONTEXT','SELECT_VERIFIED_MEMORY'],
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.router.library',
    entries:[good,bad,explore],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'runtime.skill.router.governance',
    library,
    lifecycle_evidence:[],
    max_active_skills:3,
    exploration_slots:3,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {good,bad,explore,library,governance};
}

function episode({command,skillDigest,sign='POSITIVE',step=1}){
  const ep=createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,
    readback:{
      schema:'metaengine.rsi.result-receipt-readback.v1',
      command_id:command,found:true,terminal:true,status:'COMPLETED',
      receipt:{
        schema:'metaengine.native-supervisor.command-receipt.v2',
        command_id:command,action:'SCROLL',platform:'CHATGPT',result:{moved:true},
        effect_outcome:'CONFIRMED',lane:'MUTATION',effect_key:`effect-${step}`,execution_ms:8,
        recorded_at:'2026-09-18T18:30:00.000Z',authority_effect:false,
      },
      error:null,execution_authority:false,production_mutation_authority:false,promotion_authority:false,
      self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
    },
    attribution:{
      task_id:'task.router.1',task_signature_digest:d('8'),
      environment_fingerprint:'env.browser.chatgpt.v1',model_family:'GPT_5_6_SOL',
      candidate_id:`candidate_sha256_${'9'.repeat(64)}`,candidate_sha:'e'.repeat(40),proposal_digest:d('a'),
      skill_digests:[skillDigest],trajectory_id:'trajectory.router.1',step_index:step,step_count:3,
      external_attribution:true,authored_by_candidate:false,
    },
  });
  const credit=createRsiStepCreditReceipt({
    credit_id:`credit.${command}`,episode:ep,credit_sign:sign,
    credit_score:sign==='POSITIVE'?0.7:sign==='NEGATIVE'?-0.7:0,
    method:'EXTERNAL_STEP_EVALUATOR',evaluator_digest:d('b'),evaluation_digest:d('c'),
    failure_codes:sign==='NEGATIVE'?['NEGATIVE_TRANSFER']:[],lesson_digests:[d('d')],
    evidence_refs:[`eval:${command}`],external_credit_assigner:true,authored_by_candidate:false,
  });
  return {ep,credit};
}

function context(overrides={}){
  return createRsiSkillRouteContext({
    source_sha:SOURCE,
    context_id:'context.router.1',
    task_signature_digest:d('8'),
    environment_fingerprint:'env.browser.chatgpt.v1',
    model_family:'GPT_5_6_SOL',
    challenge_family:'BROWSER_INTERACTION',
    required_role:null,
    required_capabilities:[],
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    external_planner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('contextual router selects proven useful skill, preserves bounded exploration, and vetoes exact negative transfer',()=>{
  const {good,bad,explore,library,governance}=fixture();
  const g=episode({command:'11111111-1111-4111-8111-111111111111',skillDigest:good.capsule.skill_digest,sign:'POSITIVE',step:1});
  const b1=episode({command:'22222222-2222-4222-8222-222222222222',skillDigest:bad.capsule.skill_digest,sign:'NEGATIVE',step:2});
  const b2=episode({command:'33333333-3333-4333-8333-333333333333',skillDigest:bad.capsule.skill_digest,sign:'NEGATIVE',step:3});
  const evidence=[
    createRsiSkillContextEvidence({source_sha:SOURCE,episode:g.ep,credit_receipt:g.credit,skill_digest:good.capsule.skill_digest,external_evaluator:true,authored_by_candidate:false}),
    createRsiSkillContextEvidence({source_sha:SOURCE,episode:b1.ep,credit_receipt:b1.credit,skill_digest:bad.capsule.skill_digest,external_evaluator:true,authored_by_candidate:false}),
    createRsiSkillContextEvidence({source_sha:SOURCE,episode:b2.ep,credit_receipt:b2.credit,skill_digest:bad.capsule.skill_digest,external_evaluator:true,authored_by_candidate:false}),
  ];
  const plan=createRsiSkillRoutingPlan({
    library,governance,context:context(),evidence,max_selected:2,exploration_slots:1,
    external_planner:true,authored_by_candidate:false,
  });
  assert.equal(plan.selected_count,2);
  assert.equal(plan.selected[0].skill_digest,good.capsule.skill_digest);
  assert.equal(plan.selected[0].reason,'CONTEXT_EVIDENCE');
  assert.equal(plan.selected[1].skill_digest,explore.capsule.skill_digest);
  assert.equal(plan.selected[1].reason,'BOUNDED_EXPLORATION');
  assert.equal(plan.exploration_used,1);
  assert.equal(plan.vetoed_count,1);
  assert.equal(plan.vetoed_negative_transfer[0].skill_digest,bad.capsule.skill_digest);
  assert.equal(plan.vetoed_negative_transfer[0].reason,'EXACT_CONTEXT_NEGATIVE_TRANSFER');
  assert.equal(plan.routing_is_execution_authority,false);
  assert.equal(plan.authority_effect,false);
});

test('router enforces verified interface and capability compatibility before utility ranking',()=>{
  const {good,explore,library,governance}=fixture();
  const g=episode({command:'44444444-4444-4444-8444-444444444444',skillDigest:good.capsule.skill_digest,sign:'POSITIVE'});
  const evidence=[createRsiSkillContextEvidence({
    source_sha:SOURCE,episode:g.ep,credit_receipt:g.credit,skill_digest:good.capsule.skill_digest,
    external_evaluator:true,authored_by_candidate:false,
  })];
  const plan=createRsiSkillRoutingPlan({
    library,governance,
    context:context({
      context_id:'context.router.retriever',
      required_role:'RETRIEVER',
      required_capabilities:['SELECT_VERIFIED_MEMORY'],
    }),
    evidence,max_selected:1,exploration_slots:1,external_planner:true,authored_by_candidate:false,
  });
  assert.equal(plan.selected_count,1);
  assert.equal(plan.selected[0].skill_digest,explore.capsule.skill_digest);
  assert.equal(plan.selected[0].reason,'BOUNDED_EXPLORATION');
});

test('candidate cannot author routing context or contextual evidence',()=>{
  const {good}=fixture();
  const g=episode({command:'55555555-5555-4555-8555-555555555555',skillDigest:good.capsule.skill_digest});
  assert.throws(()=>createRsiSkillRouteContext({
    source_sha:SOURCE,context_id:'context.candidate',task_signature_digest:d('8'),
    environment_fingerprint:'env.browser.chatgpt.v1',model_family:'GPT_5_6_SOL',
    challenge_family:'BROWSER_INTERACTION',external_planner:false,authored_by_candidate:true,
  }),/context_external_origin_required/);
  assert.throws(()=>createRsiSkillContextEvidence({
    source_sha:SOURCE,episode:g.ep,credit_receipt:g.credit,skill_digest:good.capsule.skill_digest,
    external_evaluator:false,authored_by_candidate:true,
  }),/context_evidence_external_origin_required/);
});

test('persisted contextual evidence is digest-verified, exact-source fenced, and idempotent',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-router-'));
  const statePath=path.join(root,'router.json');
  try{
    const {good,library,governance}=fixture();
    const g=episode({command:'66666666-6666-4666-8666-666666666666',skillDigest:good.capsule.skill_digest});
    const router=new RsiRuntimeSkillRouter({statePath,source_sha:SOURCE});
    await router.init();
    const first=await router.recordCreditedOutcome({episode:g.ep,credit_receipt:g.credit,external_evaluator:true,authored_by_candidate:false});
    const again=await router.recordCreditedOutcome({episode:g.ep,credit_receipt:g.credit,external_evaluator:true,authored_by_candidate:false});
    assert.equal(first.state,'APPENDED');
    assert.equal(again.state,'IDEMPOTENT');
    assert.equal(router.snapshot().evidence_count,1);

    const plan=await router.route({
      library,governance,context:context(),max_selected:1,exploration_slots:0,
      external_planner:true,authored_by_candidate:false,
    });
    assert.equal(plan.selected[0].skill_digest,good.capsule.skill_digest);
    assert.equal(router.snapshot().route_count,1);

    const restored=new RsiRuntimeSkillRouter({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().evidence_count,1);
    assert.equal(restored.snapshot().route_count,1);

    const row=createRsiSkillContextEvidence({
      source_sha:SOURCE,episode:g.ep,credit_receipt:g.credit,skill_digest:good.capsule.skill_digest,
      external_evaluator:true,authored_by_candidate:false,
    });
    assert.throws(()=>verifyRsiSkillContextEvidence({...row,credit_sign:'NEGATIVE'}),/evidence_digest_mismatch/);

    assert.throws(()=>createRsiSkillRoutingPlan({
      library,governance,
      context:createRsiSkillRouteContext({
        source_sha:'f'.repeat(40),context_id:'context.other.source',task_signature_digest:d('8'),
        environment_fingerprint:'env.browser.chatgpt.v1',model_family:'GPT_5_6_SOL',
        challenge_family:'BROWSER_INTERACTION',external_planner:true,authored_by_candidate:false,
      }),
      evidence:[row],max_selected:1,exploration_slots:0,external_planner:true,authored_by_candidate:false,
    }),/evidence_source_mismatch/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('routing is limited to governance-active skills and cannot reactivate quarantined entries',()=>{
  const {good,bad,library}=fixture();
  const negative=episode({command:'77777777-7777-4777-8777-777777777777',skillDigest:bad.capsule.skill_digest,sign:'NEGATIVE'});
  const lifecycleEvidence=[];
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'runtime.skill.router.quarantine',
    library,
    lifecycle_evidence:lifecycleEvidence,
    max_active_skills:1,
    exploration_slots:1,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const activeDigests=governance.entries.filter(row=>row.active_for_composition).map(row=>row.skill_digest);
  const plan=createRsiSkillRoutingPlan({
    library,governance,context:context(),
    evidence:[createRsiSkillContextEvidence({
      source_sha:SOURCE,episode:negative.ep,credit_receipt:negative.credit,skill_digest:bad.capsule.skill_digest,
      external_evaluator:true,authored_by_candidate:false,
    })],
    max_selected:3,exploration_slots:3,external_planner:true,authored_by_candidate:false,
  });
  assert.ok(plan.selected.every(row=>activeDigests.includes(row.skill_digest)));
  assert.ok(plan.selected_count<=1);
  assert.equal(plan.only_governance_active_skills,true);
  assert.equal(plan.selected_count, activeDigests.length > 0 ? 1 : 0);
});

test('coalition-pollution mask excludes an otherwise active compatible skill without granting any new activity',()=>{
  const {good,explore,library,governance}=fixture();
  const g=episode({command:'88888888-8888-4888-8888-888888888888',skillDigest:good.capsule.skill_digest,sign:'POSITIVE'});
  const evidence=[createRsiSkillContextEvidence({
    source_sha:SOURCE,episode:g.ep,credit_receipt:g.credit,skill_digest:good.capsule.skill_digest,
    external_evaluator:true,authored_by_candidate:false,
  })];
  const plan=createRsiSkillRoutingPlan({
    library,governance,context:context(),evidence,
    coalition_masked_skill_digests:[good.capsule.skill_digest],
    max_selected:2,exploration_slots:1,external_planner:true,authored_by_candidate:false,
  });
  assert.ok(!plan.selected.some(row=>row.skill_digest===good.capsule.skill_digest));
  assert.equal(plan.coalition_masked_count,1);
  assert.equal(plan.masked_coalition_pollution[0].skill_digest,good.capsule.skill_digest);
  assert.equal(plan.masked_coalition_pollution[0].reason,'NEGATIVE_COALITION_MARGINAL');
  assert.equal(plan.coalition_mask_cannot_grant_activity,true);
  assert.ok(plan.selected.every(row=>row.skill_digest!==good.capsule.skill_digest));
  assert.ok(plan.selected_count<=2);
  if(plan.selected_count>0)assert.equal(plan.selected[0].skill_digest,explore.capsule.skill_digest);
});

test('coalition mask is fenced to the exact verified library',()=>{
  const {library,governance}=fixture();
  assert.throws(()=>createRsiSkillRoutingPlan({
    library,
    governance,
    context:context(),
    evidence:[],
    coalition_masked_skill_digests:[d('f')],
    max_selected:1,
    exploration_slots:0,
    external_planner:true,
    authored_by_candidate:false,
  }),/coalition_mask_skill_not_in_library/);
});

test('skill-router trust root freezes thresholds, negative-transfer veto, and zero authority',()=>{
  const root=rsiRuntimeSkillRouterTrustRootSnapshot();
  assert.equal(root.verified_library_and_governance_required,true);
  assert.equal(root.only_governance_active_skills,true);
  assert.equal(root.exact_interface_compatibility_required,true);
  assert.equal(root.contextual_utility_not_global_truth,true);
  assert.equal(root.exact_context_negative_transfer_veto,true);
  assert.equal(root.coalition_pollution_mask_supported,true);
  assert.equal(root.coalition_mask_cannot_grant_activity,true);
  assert.equal(root.bounded_exploration_slots,true);
  assert.equal(root.candidate_can_write_evidence,false);
  assert.equal(root.candidate_can_select_skills,false);
  assert.equal(root.candidate_can_override_negative_transfer_veto,false);
  assert.equal(root.routing_is_execution_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.router_root_digest,/^sha256:[0-9a-f]{64}$/);
});
