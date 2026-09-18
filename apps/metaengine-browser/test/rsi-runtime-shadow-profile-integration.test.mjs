import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiMetaSkillProfile,
  createRsiMetaSkillFastLoopSummary,
  createRsiMetaSkillEvolutionPlan,
  createRsiMetaSkillEvaluation,
  finalizeRsiMetaSkillEvolution,
} from '../src/rsi-meta-skill-evolution.mjs';
import {
  createRsiMetaProfilePairReceipt,
  evaluateRsiMetaProfileShadow,
  createRsiMetaProfileStatisticalCertificate,
} from '../src/rsi-meta-profile-qualification.mjs';
import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from '../src/rsi-recursive-risk-budget.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function mkSkill({id,role,sourceChar,implChar}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:sourceChar.repeat(40),
    role,input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(implChar),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(sourceChar),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:16,success_count:15,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function bind(x){return {skill_id:x.capsule.skill_id,skill_version:x.capsule.skill_version,skill_digest:x.capsule.skill_digest}}

test('runtime carries a qualified meta profile into shadow-only dual-plan comparison without changing execution authority',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-runtime-shadow-profile-'));
  try{
    const analyzerA=mkSkill({id:'runtime.shadow.analyzer.a',role:'ANALYZER',sourceChar:'b',implChar:'b'});
    const analyzerB=mkSkill({id:'runtime.shadow.analyzer.b',role:'ANALYZER',sourceChar:'c',implChar:'c'});
    const retriever=mkSkill({id:'runtime.shadow.retriever',role:'RETRIEVER',sourceChar:'d',implChar:'d'});
    const allocator=mkSkill({id:'runtime.shadow.allocator',role:'ALLOCATOR',sourceChar:'e',implChar:'e'});
    const proposer=mkSkill({id:'runtime.shadow.proposer',role:'PROPOSER',sourceChar:'f',implChar:'f'});
    const evolver=mkSkill({id:'runtime.shadow.evolver',role:'EVOLVER',sourceChar:'9',implChar:'9'});
    const library=createRsiVerifiedSkillLibrary({
      library_id:'runtime.shadow.integration.library',
      entries:[analyzerA,analyzerB,retriever,allocator,proposer,evolver],
      external_library_owner:true,authored_by_candidate:false,
    });

    const parent=createRsiMetaSkillProfile({
      profile_id:'runtime.shadow.profile.parent',library,profile_generation:1,slow_meta_epoch:1,fast_skill_epoch:5,
      frozen_backbone_family:'GPT_5_6_SOL',
      bindings:{ANALYZER:bind(analyzerA),RETRIEVER:bind(retriever),ALLOCATOR:bind(allocator),PROPOSER:bind(proposer),EVOLVER:bind(evolver)},
      external_profile_owner:true,authored_by_candidate:false,
    });
    const successor=createRsiMetaSkillProfile({
      profile_id:'runtime.shadow.profile.successor',library,profile_generation:2,slow_meta_epoch:2,fast_skill_epoch:5,
      frozen_backbone_family:'GPT_5_6_SOL',
      bindings:{ANALYZER:bind(analyzerB),RETRIEVER:bind(retriever),ALLOCATOR:bind(allocator),PROPOSER:bind(proposer),EVOLVER:bind(evolver)},
      external_profile_owner:true,authored_by_candidate:false,
    });
    const fast=createRsiMetaSkillFastLoopSummary({
      profile:parent,library,fast_holdout_digest:d('7'),episode_count:12,helpful_count:9,harmful_count:1,neutral_count:2,insufficient_count:0,
      evidence_refs:['runtime:shadow:fast'],external_evaluator:true,authored_by_candidate:false,
    });
    const plan=createRsiMetaSkillEvolutionPlan({
      parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,min_fast_episodes:8,
      meta_holdout_digest:d('8'),max_role_changes:1,external_meta_operator:true,authored_by_candidate:false,
    });
    const evaluation=createRsiMetaSkillEvaluation({
      plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluator_root_digest:d('9'),
      objective_spec:[
        {metric:'task_success',direction:'MAXIMIZE',materiality_threshold:0.01},
        {metric:'latency_ms',direction:'MINIMIZE',materiality_threshold:1},
      ],
      parent_metrics:{task_success:0.70,latency_ms:110},successor_metrics:{task_success:0.78,latency_ms:96},
      hard_invariants_pass:true,evidence_refs:['runtime:shadow:meta-eval'],external_evaluator:true,authored_by_candidate:false,
    });
    const result=finalizeRsiMetaSkillEvolution({plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation});

    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath:path.join(root,'rsi.jsonl')});
    await runtime.start();
    await runtime.adoptVerifiedSkillLibrary({library,external_library_owner:true,authored_by_candidate:false});
    const meta=await runtime.recordMetaSkillEvolution({
      record_id:'runtime.shadow.meta.record.1',parent_profile:parent,successor_profile:successor,fast_loop_summary:fast,
      plan,evaluation,result,external_archive_owner:true,authored_by_candidate:false,
    });
    assert.equal(meta.record.eligible_for_meta_archive,true);

    const shadowPlan=runtime.createMetaProfileShadowPlan({
      meta_record_digest:meta.record.record_digest,plan_id:'runtime.shadow.qual.plan.1',
      activation_holdout_digest:d('a'),evaluator_root_digest:d('b'),
      external_plan_owner:true,authored_by_candidate:false,
    });
    const receipts=[];
    for(let i=0;i<shadowPlan.pair_count;i++){
      receipts.push(createRsiMetaProfilePairReceipt({
        plan:shadowPlan,meta_record:meta.record,pair_index:i+1,order:shadowPlan.precommitted_order_schedule[i],seed:shadowPlan.precommitted_seed_schedule[i],
        parent_metrics:{task_success:0.70,latency_ms:110},successor_metrics:{task_success:0.80,latency_ms:94},
        hard_invariants_pass:true,evidence_digest:d(String((i%6)+1)),evidence_refs:[`runtime:shadow:pair:${i+1}`],
        external_evaluator:true,authored_by_candidate:false,
      }));
    }
    const shadowResult=evaluateRsiMetaProfileShadow({plan:shadowPlan,meta_record:meta.record,receipts});
    const budget=createRsiRecursiveRiskBudget({
      budget_id:'rsi.meta-profile.activation.risk.v1',global_alpha:0.05,
      spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
      evidence_family:'RSI_META_PROFILE_ACTIVATION',
    });
    const certificate=createRsiMetaProfileStatisticalCertificate({
      certificate_id:'runtime.shadow.qual.cert.1',budget,confirmation_index:1,meta_record:meta.record,
      shadow_plan:shadowPlan,shadow_result:shadowResult,receipts,alpha_used:rsiRiskAllocationForConfirmation(budget,1),
      superiority_certified:true,sample_count:shadowPlan.pair_count,evidence_refs:['runtime:shadow:stat'],
      external_verifier:true,authored_by_candidate:false,
    });
    const qualified=await runtime.recordMetaProfileQualification({
      meta_record_digest:meta.record.record_digest,qualification_id:'runtime.shadow.qual.final.1',
      shadow_plan:shadowPlan,receipts,shadow_result:shadowResult,risk_budget:budget,
      statistical_certificate:certificate,confirmation_index:1,
    });
    assert.equal(qualified.qualification.qualified_for_shadow_profile_selection,true);

    const selected=await runtime.selectShadowMetaProfile({
      selection_id:'runtime.shadow.selection.1',
      qualification_digest:qualified.qualification.qualification_digest,
      external_selector:true,authored_by_candidate:false,
    });
    assert.equal(selected.selection.mode,'SHADOW_ONLY');
    assert.equal(runtime.currentShadowMetaProfile().selection_digest,selected.selection.selection_digest);

    const compared=await runtime.compareShadowMetaProfileRoute({
      context_id:'runtime.shadow.context.1',
      task_signature_digest:d('c'),
      environment_fingerprint:'env.browser.chatgpt.v1',
      model_family:'GPT_5_6_SOL',
      challenge_family:'BROWSER_INTERACTION',
      required_role:'ANALYZER',
      required_capabilities:['READ_VERIFIED_CONTEXT'],
      input_schema_digest:d('1'),
      output_schema_digest:d('2'),
      max_selected:2,
      exploration_slots:1,
      external_planner:true,
      authored_by_candidate:false,
    });
    assert.equal(compared.shadow_projection.shadow_only,true);
    assert.equal(compared.shadow_projection.baseline_execution_path_unchanged,true);
    assert.equal(compared.shadow_projection.projection_can_add_skill_to_execution,false);
    assert.equal(compared.shadow_projection.projection_can_override_governance,false);
    assert.equal(compared.baseline_plan.routing_is_execution_authority,false);
    assert.equal(runtime.snapshot().meta_profile_shadow_registry.selection_count,1);

    const shadowEvidence=await runtime.recordBoundedCanaryShadowEvidence({
      evidence_id:'runtime.shadow.canary.evidence.1',
      context_cohort_digest:d('e'),
      shadow_observation_count:32,
      matched_count:24,
      divergence_count:8,
      ambiguity_count:0,
      incident_count:0,
      hard_invariant_violation_count:0,
      identity_drift_count:0,
      outcome_evidence_digest:d('1'),
      safety_evidence_digest:d('2'),
      security_evidence_digest:d('3'),
      awareness_evidence_digest:d('4'),
      utility_evidence_digest:d('5'),
      evidence_refs:['runtime:shadow:canary:evidence:1'],
      external_observer:true,
      authored_by_candidate:false,
    });
    assert.equal(shadowEvidence.evidence.eligible_for_bounded_canary_admission,true);
    const boundedHandoff=await runtime.qualifyBoundedCanaryHandoff({
      admission_id:'runtime.shadow.canary.handoff.1',
      shadow_evidence_digest:shadowEvidence.evidence.evidence_digest,
      fixed_cohort_digest:d('e'),
      external_admission_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(boundedHandoff.admission.eligible_for_external_bounded_canary_handoff,true);

    const canary=await runtime.admitBoundedCanaryMetaProfile({
      canary_id:'runtime.shadow.canary.1',
      bounded_admission_digest:boundedHandoff.admission.admission_digest,
      cohort_digest:d('e'),
      external_canary_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(canary.admission.action_surface,'READ_ONLY_DECISION_SUPPORT');
    assert.equal(canary.admission.max_decisions,16);
    assert.equal(canary.admission.canary_can_execute_browser_effect,false);

    const canaryDecision=await runtime.issueBoundedCanaryDecision({
      canary_id:'runtime.shadow.canary.1',
      cohort_digest:d('e'),
      route_args:{
        context_id:'runtime.shadow.canary.context.1',
        task_signature_digest:d('f'),
        environment_fingerprint:'env.browser.chatgpt.v1',
        model_family:'GPT_5_6_SOL',
        challenge_family:'BROWSER_INTERACTION',
        required_role:'ANALYZER',
        required_capabilities:['READ_VERIFIED_CONTEXT'],
        input_schema_digest:d('1'),
        output_schema_digest:d('2'),
        max_selected:2,
        exploration_slots:1,
        external_planner:true,
        authored_by_candidate:false,
      },
    });
    assert.equal(canaryDecision.decision.decision_can_execute_browser_effect,false);
    assert.equal(canaryDecision.decision.baseline_execution_unchanged,true);

    const canaryOutcome=await runtime.recordBoundedCanaryOutcome({
      canary_id:'runtime.shadow.canary.1',
      decision:canaryDecision.decision,
      outcome_id:'runtime.shadow.canary.outcome.1',
      outcome_safety:'PASS',
      security_awareness:'PASS',
      task_utility:0.5,
      ambiguous:false,
      hard_invariant_pass:true,
      evidence_digest:d('1'),
      evidence_refs:['runtime:shadow:canary:outcome:1'],
      external_evaluator:true,
      authored_by_candidate:false,
    });
    assert.equal(canaryOutcome.stored.rollback_required,false);
    assert.equal(runtime.snapshot().meta_profile_canary_ledger.total_decision_count,1);
    assert.equal(runtime.snapshot().meta_profile_canary_ledger.total_outcome_count,1);
    assert.ok(runtime.snapshot().bounded_canary_admission_ledger.row_count>=1);
    assert.equal(runtime.snapshot().execution_authority,false);
    assert.equal(runtime.snapshot().authority_effect,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
