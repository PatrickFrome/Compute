import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { RSI_HARD_INVARIANTS, RSI_SHADOW_STATES } from '../src/rsi-shadow-core.mjs';
import { RSI_EVALUATOR_MESH_RESULT_SCHEMA } from '../src/rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import {
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
  evaluateRsiShadowTournament,
} from '../src/rsi-shadow-tournament.mjs';
import { RsiVerifiedEvolutionArchive } from '../src/rsi-verified-evolution-archive.mjs';
import {
  RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA,
  rsiPromotionGateTrustRootSnapshot,
} from '../src/rsi-promotion-admission-gate.mjs';
import {
  createRsiExternalPromotionReviewRequest,
  verifyRsiExternalPromotionReviewRequest,
  finalizeRsiExternalPromotionReview,
  verifyRsiExternalPromotionReviewResult,
  rsiExternalPromotionReviewTrustRootSnapshot,
} from '../src/rsi-external-promotion-review.mjs';

const PARENT='a'.repeat(40);
const CANDIDATE='b'.repeat(40);
const CANDIDATE_ID=`candidate_sha256_${'c'.repeat(64)}`;
const SUITE=`sha256:${'d'.repeat(64)}`;
const HOLDOUT=`sha256:${'e'.repeat(64)}`;
const ARTIFACT=`sha256:${'1'.repeat(64)}`;
const PROVENANCE=`sha256:${'2'.repeat(64)}`;
const ROLLBACK=`sha256:${'3'.repeat(64)}`;
const d=(c)=>`sha256:${c.repeat(64)}`;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function hardPass(){return Object.fromEntries(RSI_HARD_INVARIANTS.map(name=>[name,'PASS']))}

function handoff(componentPath='apps/metaengine-browser/src/browser-brain-routing-v2.mjs'){
  const core={
    schema:RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version:1,
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    mutation_surface:'AGENT_ORCHESTRATION',
    parent_sha:PARENT,
    candidate_sha:CANDIDATE,
    target_branch:'work/rsi/promotion-review-aaaaaaaa-01234567',
    candidate_capsule:{
      candidate_id:CANDIDATE_ID,
      source:{head:CANDIDATE},
      components:[{path:componentPath,change:'MODIFY',digest:d('4')}],
    },
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:{mode:'PREPARE_ONLY'},
    sandbox_plan_verification:{execution_authorized:false},
    shadow_archive_proposal:{
      candidate_id:CANDIDATE_ID,
      parent_sha:PARENT,
      candidate_sha:CANDIDATE,
      mutation_surface:'AGENT_ORCHESTRATION',
      hypothesis:'Improve routing while preserving authority.',
    },
    eligible_for_evaluation:true,
    eligible_for_promotion:false,
    materialization_replay_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,handoff_digest:digest(core)};
}

function evaluatorResult(){
  const core={
    schema:RSI_EVALUATOR_MESH_RESULT_SCHEMA,
    version:1,
    plan_id:'rsi_eval_0123456789abcdef',
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    state:RSI_SHADOW_STATES.SHADOW_QUALIFIED,
    final_digest:'4'.repeat(64),
    receipt_digests:Array.from({length:RSI_HARD_INVARIANTS.length+1},(_,i)=>d(String((i+5)%10))),
    hard_invariants:hardPass(),
    objectives:[{name:'p95_latency_ms',baseline:100,candidate:80}],
    eligible_for_promotion:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,result_digest:digest(core)};
}

function tournamentFixture(candidateHandoff=handoff()){
  const plan=createRsiShadowTournamentPlan({
    candidate_handoff:candidateHandoff,
    evaluator_result:evaluatorResult(),
    workload:{
      task_class:'browser-promotion-review',
      environment_fingerprint:'windows-x64-rsi-review-v1',
      suite_digest:SUITE,
      holdout_digest:HOLDOUT,
    },
    pair_count:5,
  });
  const receipts=Array.from({length:5},(_,index)=>createRsiTournamentPairReceipt({
    plan,
    pair_index:index+1,
    order:plan.pair_policy.precommitted_order_schedule[index],
    seed:plan.pair_policy.precommitted_seed_schedule[index],
    incumbent_metrics:{task_success_rate:0.9,p95_latency_ms:100+index,peak_rss_bytes:1000+index,recovery_p95_ms:60+index},
    candidate_metrics:{task_success_rate:0.94,p95_latency_ms:78+index,peak_rss_bytes:900+index,recovery_p95_ms:48+index},
    hard_invariants:hardPass(),
    evidence_refs:[`github:run:pair-${index+1}`],
  }));
  const result=evaluateRsiShadowTournament({plan,receipts});
  assert.equal(result.relation,'PARETO_ADVANCE');
  return {plan,receipts,result};
}

function evaluationBundle(candidateHandoff,plan,result,{allPass=true}={}){
  const kinds=['HARD_INVARIANTS','OBJECTIVES','HOLDOUT','REGRESSION_REPLAY','EVALUATION_INTEGRITY','TOURNAMENT'];
  const classes=kinds.map((kind,index)=>({
    evidence_id:`external:${kind.toLowerCase().replaceAll('_','-')}`,
    evidence_kind:kind,
    result:allPass||index!==4?'PASS':'FAIL',
    evidence_digest:d(String((index+1)%10)),
    support_schema:'metaengine.rsi.test-support.v1',
    support_digest:d(String((index+2)%10)),
    external_evaluator_required:true,
    authored_by_candidate:false,
    candidate_can_override_result:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  }));
  const core={
    schema:'metaengine.rsi.external-evaluation-bundle.v1',
    version:1,
    episode_id:'episode:rsi:111111111111111111111111',
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    parent_sha:PARENT,
    isolated_candidate_handoff_digest:candidateHandoff.handoff_digest,
    evaluator_plan_digest:d('5'),
    evaluator_result_digest:d('6'),
    benchmark_admission_digest:d('7'),
    holdout_result_digest:d('8'),
    regression_gate_digest:d('9'),
    evaluation_integrity_assessment_digest:d('a'),
    tournament_plan_digest:plan.plan_digest,
    tournament_result_digest:result.result_digest,
    evidence_classes:classes,
    required_evidence_kinds:kinds,
    all_classes_pass:classes.every(row=>row.result==='PASS'),
    any_class_ambiguous:false,
    candidate_can_self_certify:false,
    candidate_can_modify_evidence:false,
    evidence_ingest_is_promotion_authority:false,
    direct_promotion_enabled:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  const payloadBytes=Buffer.byteLength(JSON.stringify(stable(core)),'utf8');
  return {...core,payload_bytes:payloadBytes,max_payload_bytes:48*1024,bundle_digest:digest(core)};
}

function qualification({ci='SUCCESS',canary='PASS',rollback=true}={}){
  const workflows=rsiPromotionGateTrustRootSnapshot().required_workflows;
  const core={
    schema:RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA,
    version:1,
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    parent_sha:PARENT,
    artifact:{digest:ARTIFACT,signed:true,signature_verified:true},
    provenance:{
      digest:PROVENANCE,
      predicate_type:'https://slsa.dev/provenance/v1',
      builder_id:'github-actions:metaengine-browser-release-v1',
      source_repository:'PatrickFrome/Compute',
      source_sha:CANDIDATE,
      verified:true,
    },
    ci_checks:workflows.map((workflow,index)=>({
      workflow,
      run_id:5000+index,
      head_sha:CANDIDATE,
      conclusion:index===0?ci:'SUCCESS',
      evidence_ref:`github:actions/run/${5000+index}`,
    })),
    canary:{
      mode:'SHADOW_CANARY',
      candidate_sha:CANDIDATE,
      artifact_digest:ARTIFACT,
      result:canary,
      duplicate_irreversible_effects:0,
      ambiguous_effect_retries:0,
      authority_violations:0,
      workspace_escapes:0,
      evidence_refs:['github:artifact:shadow-canary'],
    },
    rollback:{
      predecessor_sha:PARENT,
      artifact_digest:ROLLBACK,
      ready:rollback,
      ambiguous_effect_replay_allowed:false,
      evidence_refs:['github:artifact:rollback-proof'],
    },
    evidence_refs:['github:release-qualification:exact-head'],
    external_verifier:true,
    authored_by_candidate:false,
    direct_install_authorized:false,
    self_update_invocation_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,qualification_digest:digest(core)};
}

test('nomination-ready six-class evidence can only produce an external promotion review request',()=>{
  const candidateHandoff=handoff();
  const {plan,receipts,result}=tournamentFixture(candidateHandoff);
  const bundle=evaluationBundle(candidateHandoff,plan,result);
  const request=createRsiExternalPromotionReviewRequest({
    evaluation_bundle:bundle,
    candidate_handoff:candidateHandoff,
    tournament_plan:plan,
    tournament_result:result,
    tournament_receipts:receipts,
    qualification:qualification(),
  });
  verifyRsiExternalPromotionReviewRequest(request);
  assert.equal(request.candidate_id,CANDIDATE_ID);
  assert.equal(request.external_review_required,true);
  assert.equal(request.candidate_can_promote,false);
  assert.equal(request.candidate_can_invoke_self_update,false);
  assert.equal(request.direct_install_authorized,false);
  assert.equal(request.self_update_invocation_authorized,false);
  assert.equal(request.promotion_token,null);
  assert.equal(request.promotion_authority,false);
  assert.ok(request.payload_bytes<request.max_payload_bytes);
});

test('canonical verified archive admission plus exact qualification reaches review-ready without gaining authority',()=>{
  const candidateHandoff=handoff();
  const {plan,receipts,result}=tournamentFixture(candidateHandoff);
  const request=createRsiExternalPromotionReviewRequest({
    evaluation_bundle:evaluationBundle(candidateHandoff,plan,result),
    candidate_handoff:candidateHandoff,
    tournament_plan:plan,
    tournament_result:result,
    tournament_receipts:receipts,
    qualification:qualification(),
  });
  const archive=new RsiVerifiedEvolutionArchive();
  const admission=archive.admit({plan,result,receipts});
  const review=finalizeRsiExternalPromotionReview({request,candidate_handoff:candidateHandoff,archive_admission:admission});
  verifyRsiExternalPromotionReviewResult(review,request);
  assert.equal(review.state,'READY_FOR_EXTERNAL_PROMOTION_REVIEW');
  assert.equal(review.ready_for_external_promotion_review,true);
  assert.deepEqual(review.blockers,[]);
  assert.equal(review.external_human_or_release_authority_still_required,true);
  assert.equal(review.existing_self_update_handoff_authorized,false);
  assert.equal(review.direct_install_authorized,false);
  assert.equal(review.self_update_invocation_authorized,false);
  assert.equal(review.promotion_token,null);
  assert.equal(review.promotion_authority,false);
  assert.equal(review.self_update_authority,false);
});

test('failed exact-head CI remains BLOCKED and cannot be converted into release authority',()=>{
  const candidateHandoff=handoff();
  const {plan,receipts,result}=tournamentFixture(candidateHandoff);
  const request=createRsiExternalPromotionReviewRequest({
    evaluation_bundle:evaluationBundle(candidateHandoff,plan,result),
    candidate_handoff:candidateHandoff,
    tournament_plan:plan,
    tournament_result:result,
    tournament_receipts:receipts,
    qualification:qualification({ci:'FAILURE'}),
  });
  const admission=new RsiVerifiedEvolutionArchive().admit({plan,result,receipts});
  const review=finalizeRsiExternalPromotionReview({request,candidate_handoff:candidateHandoff,archive_admission:admission});
  assert.equal(review.state,'BLOCKED');
  assert.ok(review.blockers.includes('REQUIRED_CI_NOT_GREEN'));
  assert.equal(review.ready_for_external_promotion_review,false);
  assert.equal(review.promotion_token,null);
  assert.equal(review.self_update_invocation_authorized,false);
});

test('failed six-class evidence and tournament tampering are rejected before promotion review construction',()=>{
  const candidateHandoff=handoff();
  const {plan,receipts,result}=tournamentFixture(candidateHandoff);
  assert.throws(()=>createRsiExternalPromotionReviewRequest({
    evaluation_bundle:evaluationBundle(candidateHandoff,plan,result,{allPass:false}),
    candidate_handoff:candidateHandoff,
    tournament_plan:plan,
    tournament_result:result,
    tournament_receipts:receipts,
    qualification:qualification(),
  }),/not_nomination_ready/);

  const tampered=structuredClone(result);
  tampered.relation='NO_MEASURED_ADVANCE';
  assert.throws(()=>createRsiExternalPromotionReviewRequest({
    evaluation_bundle:evaluationBundle(candidateHandoff,plan,result),
    candidate_handoff:candidateHandoff,
    tournament_plan:plan,
    tournament_result:tampered,
    tournament_receipts:receipts,
    qualification:qualification(),
  }),/tournament_result_not_canonical|result_digest/);
});

test('external promotion review trust root keeps release authority outside RSI',()=>{
  const root=rsiExternalPromotionReviewTrustRootSnapshot();
  assert.equal(root.nomination_ready_required,true);
  assert.equal(root.six_external_evidence_classes_required,true);
  assert.equal(root.canonical_tournament_recomputation_required,true);
  assert.equal(root.verified_archive_admission_required,true);
  assert.equal(root.signed_artifact_required,true);
  assert.equal(root.slsa_provenance_required,true);
  assert.equal(root.exact_candidate_head_ci_required,true);
  assert.equal(root.shadow_canary_required,true);
  assert.equal(root.rollback_ready_required,true);
  assert.equal(root.candidate_can_promote,false);
  assert.equal(root.candidate_can_invoke_self_update,false);
  assert.equal(root.external_review_required,true);
  assert.equal(root.direct_install_authorized,false);
  assert.equal(root.self_update_invocation_authorized,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
});
