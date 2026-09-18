import assert from 'node:assert/strict';
import test from 'node:test';

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
import { createRsiRuntimeMetaSkillRecord } from '../src/rsi-runtime-meta-skill-archive.mjs';
import {
  createRsiMetaProfileShadowPlan,
  createRsiMetaProfilePairReceipt,
  evaluateRsiMetaProfileShadow,
  createRsiMetaProfileStatisticalCertificate,
  createRsiMetaProfileQualification,
  rsiMetaProfileRiskBudgetSnapshot,
} from '../src/rsi-meta-profile-qualification.mjs';
import { rsiRiskAllocationForConfirmation } from '../src/rsi-recursive-risk-budget.mjs';
import {
  createRsiMetaProfileShadowPortfolio,
  verifyRsiMetaProfileShadowPortfolio,
  selectRsiMetaProfileShadowCandidate,
  rsiMetaProfileShadowPortfolioTrustRootSnapshot,
} from '../src/rsi-meta-profile-shadow-portfolio.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function skill({id,role,sourceChar,implChar}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:sourceChar.repeat(40),
    role,input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(implChar),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(sourceChar),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:20,success_count:18,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function binding(entry){
  return {skill_id:entry.capsule.skill_id,skill_version:entry.capsule.skill_version,skill_digest:entry.capsule.skill_digest};
}

function baseFixture(){
  const analyzerA=skill({id:'meta.portfolio.analyzer.a',role:'ANALYZER',sourceChar:'b',implChar:'b'});
  const analyzerB=skill({id:'meta.portfolio.analyzer.b',role:'ANALYZER',sourceChar:'c',implChar:'c'});
  const retriever=skill({id:'meta.portfolio.retriever',role:'RETRIEVER',sourceChar:'d',implChar:'d'});
  const allocator=skill({id:'meta.portfolio.allocator',role:'ALLOCATOR',sourceChar:'e',implChar:'e'});
  const proposer=skill({id:'meta.portfolio.proposer',role:'PROPOSER',sourceChar:'f',implChar:'f'});
  const evolver=skill({id:'meta.portfolio.evolver',role:'EVOLVER',sourceChar:'9',implChar:'9'});
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.meta.profile.portfolio.library',
    entries:[analyzerA,analyzerB,retriever,allocator,proposer,evolver],
    external_library_owner:true,authored_by_candidate:false,
  });
  const parent=createRsiMetaSkillProfile({
    profile_id:'meta.portfolio.parent',library,profile_generation:1,slow_meta_epoch:1,fast_skill_epoch:20,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{
      ANALYZER:binding(analyzerA),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),
      PROPOSER:binding(proposer),EVOLVER:binding(evolver),
    },
    external_profile_owner:true,authored_by_candidate:false,
  });
  const successor=createRsiMetaSkillProfile({
    profile_id:'meta.portfolio.successor',library,profile_generation:2,slow_meta_epoch:2,fast_skill_epoch:20,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{
      ANALYZER:binding(analyzerB),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),
      PROPOSER:binding(proposer),EVOLVER:binding(evolver),
    },
    external_profile_owner:true,authored_by_candidate:false,
  });
  const fast=createRsiMetaSkillFastLoopSummary({
    profile:parent,library,fast_holdout_digest:d('7'),episode_count:12,helpful_count:9,harmful_count:1,neutral_count:2,insufficient_count:0,
    evidence_refs:['meta:portfolio:fast'],external_evaluator:true,authored_by_candidate:false,
  });
  const plan=createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,min_fast_episodes:8,
    meta_holdout_digest:d('8'),max_role_changes:1,external_meta_operator:true,authored_by_candidate:false,
  });
  const evaluation=createRsiMetaSkillEvaluation({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    evaluator_root_digest:d('9'),
    objective_spec:[
      {metric:'task_success',direction:'MAXIMIZE',materiality_threshold:0.01},
      {metric:'latency_ms',direction:'MINIMIZE',materiality_threshold:1},
    ],
    parent_metrics:{task_success:0.70,latency_ms:110},
    successor_metrics:{task_success:0.76,latency_ms:100},
    hard_invariants_pass:true,evidence_refs:['meta:portfolio:slow'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const result=finalizeRsiMetaSkillEvolution({plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation});
  return {library,parent,successor,fast,plan,evaluation,result};
}

function qualifiedFixture({recordId,qualificationId,planId,certificateId,holdoutChar='a',evidencePrefix='one'}){
  const fx=baseFixture();
  const record=createRsiRuntimeMetaSkillRecord({
    source_sha:SOURCE,record_id:recordId,library:fx.library,parent_profile:fx.parent,successor_profile:fx.successor,
    fast_loop_summary:fx.fast,plan:fx.plan,evaluation:fx.evaluation,result:fx.result,
    external_archive_owner:true,authored_by_candidate:false,
  });
  const shadowPlan=createRsiMetaProfileShadowPlan({
    plan_id:planId,meta_record:record,activation_holdout_digest:d(holdoutChar),evaluator_root_digest:d('b'),
    external_plan_owner:true,authored_by_candidate:false,
  });
  const receipts=[];
  for(let i=0;i<shadowPlan.pair_count;i++){
    receipts.push(createRsiMetaProfilePairReceipt({
      plan:shadowPlan,meta_record:record,pair_index:i+1,
      order:shadowPlan.precommitted_order_schedule[i],seed:shadowPlan.precommitted_seed_schedule[i],
      parent_metrics:{task_success:0.70+(i%2)*0.01,latency_ms:110+(i%3)},
      successor_metrics:{task_success:0.78+(i%2)*0.01,latency_ms:98+(i%3)},
      hard_invariants_pass:true,evidence_digest:d(String((i%6)+1)),
      evidence_refs:[`meta:portfolio:${evidencePrefix}:pair:${i+1}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  const shadow=evaluateRsiMetaProfileShadow({plan:shadowPlan,meta_record:record,receipts});
  const budget=rsiMetaProfileRiskBudgetSnapshot();
  const alpha=rsiRiskAllocationForConfirmation(budget,1);
  const certificate=createRsiMetaProfileStatisticalCertificate({
    certificate_id:certificateId,budget,confirmation_index:1,meta_record:record,
    shadow_plan:shadowPlan,shadow_result:shadow,receipts,alpha_used:alpha,superiority_certified:true,
    sample_count:shadowPlan.pair_count,evidence_refs:[`meta:portfolio:${evidencePrefix}:stat`],
    external_verifier:true,authored_by_candidate:false,
  });
  const qualification=createRsiMetaProfileQualification({
    qualification_id:qualificationId,meta_record:record,shadow_plan:shadowPlan,shadow_result:shadow,
    receipts,budget,certificate,confirmation_index:1,
  });
  return {record,qualification};
}

test('portfolio accepts only Phase17-qualified exact meta records and preserves zero authority',()=>{
  const a=qualifiedFixture({
    recordId:'meta.portfolio.record.one',qualificationId:'meta.portfolio.qualification.one',
    planId:'meta.portfolio.shadow.one',certificateId:'meta.portfolio.cert.one',
  });
  const portfolio=createRsiMetaProfileShadowPortfolio({
    qualified_entries:[{qualification:a.qualification,meta_record:a.record}],
    external_portfolio_owner:true,authored_by_candidate:false,
  });
  verifyRsiMetaProfileShadowPortfolio(portfolio);
  assert.equal(portfolio.entry_count,1);
  assert.equal(portfolio.niche_count,1);
  assert.equal(portfolio.entries[0].niche_key,'ANALYZER');
  assert.equal(portfolio.scalar_winner_authoritative,false);
  assert.equal(portfolio.automatic_cross_niche_ranking_allowed,false);
  assert.equal(portfolio.portfolio_is_profile_activation_authority,false);
  assert.equal(portfolio.portfolio_is_canary_authority,false);
  assert.equal(portfolio.authority_effect,false);
});

test('multiple qualified profiles in one niche fail closed instead of auto-ranking a winner',()=>{
  const a=qualifiedFixture({
    recordId:'meta.portfolio.record.a',qualificationId:'meta.portfolio.qualification.a',
    planId:'meta.portfolio.shadow.a',certificateId:'meta.portfolio.cert.a',holdoutChar:'a',evidencePrefix:'a',
  });
  const b=qualifiedFixture({
    recordId:'meta.portfolio.record.b',qualificationId:'meta.portfolio.qualification.b',
    planId:'meta.portfolio.shadow.b',certificateId:'meta.portfolio.cert.b',holdoutChar:'c',evidencePrefix:'b',
  });
  const portfolio=createRsiMetaProfileShadowPortfolio({
    qualified_entries:[
      {qualification:a.qualification,meta_record:a.record},
      {qualification:b.qualification,meta_record:b.record},
    ],
    external_portfolio_owner:true,authored_by_candidate:false,
  });
  const ambiguous=selectRsiMetaProfileShadowCandidate({
    portfolio,requested_meta_role:'ANALYZER',external_selector:true,authored_by_candidate:false,
  });
  assert.equal(ambiguous.state,'AMBIGUOUS_NICHE');
  assert.equal(ambiguous.selected_successor_profile_digest,null);
  assert.equal(ambiguous.ambiguous_selection_auto_resolved,false);

  const explicit=selectRsiMetaProfileShadowCandidate({
    portfolio,requested_meta_role:'ANALYZER',qualification_digest:a.qualification.qualification_digest,
    external_selector:true,authored_by_candidate:false,
  });
  assert.equal(explicit.state,'SHADOW_CANDIDATE_IDENTIFIED');
  assert.equal(explicit.selected_qualification_digest,a.qualification.qualification_digest);
  assert.equal(explicit.live_profile_activation_authorized,false);
  assert.equal(explicit.canary_activation_authorized,false);
  assert.equal(explicit.authority_effect,false);
});

test('candidate-authored portfolio or selector input is rejected',()=>{
  const a=qualifiedFixture({
    recordId:'meta.portfolio.record.candidate',qualificationId:'meta.portfolio.qualification.candidate',
    planId:'meta.portfolio.shadow.candidate',certificateId:'meta.portfolio.cert.candidate',
  });
  assert.throws(()=>createRsiMetaProfileShadowPortfolio({
    qualified_entries:[{qualification:a.qualification,meta_record:a.record}],
    external_portfolio_owner:false,authored_by_candidate:true,
  }),/external_owner_required/);

  const portfolio=createRsiMetaProfileShadowPortfolio({
    qualified_entries:[{qualification:a.qualification,meta_record:a.record}],
    external_portfolio_owner:true,authored_by_candidate:false,
  });
  assert.throws(()=>selectRsiMetaProfileShadowCandidate({
    portfolio,requested_meta_role:'ANALYZER',external_selector:false,authored_by_candidate:true,
  }),/external_selector_required/);
});

test('qualification tampering is detected before portfolio admission',()=>{
  const a=qualifiedFixture({
    recordId:'meta.portfolio.record.tamper',qualificationId:'meta.portfolio.qualification.tamper',
    planId:'meta.portfolio.shadow.tamper',certificateId:'meta.portfolio.cert.tamper',
  });
  const tampered={...a.qualification,qualified_for_shadow_profile_selection:false};
  assert.throws(()=>createRsiMetaProfileShadowPortfolio({
    qualified_entries:[{qualification:tampered,meta_record:a.record}],
    external_portfolio_owner:true,authored_by_candidate:false,
  }),/qualification_policy_invalid/);
});

test('portfolio trust root forbids scalar winner and any activation authority',()=>{
  const root=rsiMetaProfileShadowPortfolioTrustRootSnapshot();
  assert.equal(root.qualification_state_required,'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION');
  assert.equal(root.exact_meta_record_binding_required,true);
  assert.equal(root.niche_derived_from_verified_changed_roles,true);
  assert.equal(root.quality_diversity_archive_semantics,true);
  assert.equal(root.scalar_winner_authoritative,false);
  assert.equal(root.automatic_within_niche_tie_break_allowed,false);
  assert.equal(root.ambiguous_niche_requires_external_disambiguation,true);
  assert.equal(root.selection_is_profile_activation_authority,false);
  assert.equal(root.selection_is_canary_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.portfolio_root_digest,/^sha256:[0-9a-f]{64}$/);
});
