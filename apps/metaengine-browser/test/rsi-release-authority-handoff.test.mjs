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
  finalizeRsiExternalPromotionReview,
} from '../src/rsi-external-promotion-review.mjs';
import {
  createRsiReleaseAuthorityReadback,
  verifyRsiReleaseAuthorityReadback,
  createRsiReleaseAuthorityHandoff,
  verifyRsiReleaseAuthorityHandoff,
  rsiReleaseAuthorityHandoffTrustRootSnapshot,
} from '../src/rsi-release-authority-handoff.mjs';

const PARENT='a'.repeat(40);
const CANDIDATE='b'.repeat(40);
const CANDIDATE_ID=`candidate_sha256_${'c'.repeat(64)}`;
const SUITE=`sha256:${'d'.repeat(64)}`;
const HOLDOUT=`sha256:${'e'.repeat(64)}`;
const ARTIFACT=`sha256:${'1'.repeat(64)}`;
const PROVENANCE=`sha256:${'2'.repeat(64)}`;
const ROLLBACK=`sha256:${'3'.repeat(64)}`;
const hx=(c)=>c.repeat(64);
const d=(c)=>`sha256:${hx(c)}`;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function hardPass(){return Object.fromEntries(RSI_HARD_INVARIANTS.map(name=>[name,'PASS']))}

function handoff(){
  const core={
    schema:RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version:1,
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    mutation_surface:'AGENT_ORCHESTRATION',
    parent_sha:PARENT,
    candidate_sha:CANDIDATE,
    target_branch:'work/rsi/release-authority-aaaaaaaa-01234567',
    candidate_capsule:{
      candidate_id:CANDIDATE_ID,
      source:{head:CANDIDATE},
      components:[{path:'apps/metaengine-browser/src/browser-brain-routing-v2.mjs',change:'MODIFY',digest:d('4')}],
    },
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:{mode:'PREPARE_ONLY'},
    sandbox_plan_verification:{execution_authorized:false},
    shadow_archive_proposal:{
      candidate_id:CANDIDATE_ID,parent_sha:PARENT,candidate_sha:CANDIDATE,
      mutation_surface:'AGENT_ORCHESTRATION',hypothesis:'Improve routing safely.',
    },
    eligible_for_evaluation:true,eligible_for_promotion:false,materialization_replay_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,handoff_digest:digest(core)};
}

function evaluatorResult(){
  const core={
    schema:RSI_EVALUATOR_MESH_RESULT_SCHEMA,version:1,
    plan_id:'rsi_eval_0123456789abcdef',
    candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE,state:RSI_SHADOW_STATES.SHADOW_QUALIFIED,
    final_digest:'4'.repeat(64),
    receipt_digests:Array.from({length:RSI_HARD_INVARIANTS.length+1},(_,i)=>d(String((i+5)%10))),
    hard_invariants:hardPass(),
    objectives:[{name:'p95_latency_ms',baseline:100,candidate:80}],
    eligible_for_promotion:false,execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,result_digest:digest(core)};
}

function tournamentFixture(candidateHandoff=handoff()){
  const plan=createRsiShadowTournamentPlan({
    candidate_handoff:candidateHandoff,evaluator_result:evaluatorResult(),
    workload:{task_class:'browser-release-handoff',environment_fingerprint:'windows-x64-rsi-release-v1',suite_digest:SUITE,holdout_digest:HOLDOUT},
    pair_count:5,
  });
  const receipts=Array.from({length:5},(_,i)=>createRsiTournamentPairReceipt({
    plan,pair_index:i+1,order:plan.pair_policy.precommitted_order_schedule[i],seed:plan.pair_policy.precommitted_seed_schedule[i],
    incumbent_metrics:{task_success_rate:0.9,p95_latency_ms:100+i,peak_rss_bytes:1000+i,recovery_p95_ms:60+i},
    candidate_metrics:{task_success_rate:0.94,p95_latency_ms:78+i,peak_rss_bytes:900+i,recovery_p95_ms:48+i},
    hard_invariants:hardPass(),evidence_refs:[`github:run:pair-${i+1}`],
  }));
  const result=evaluateRsiShadowTournament({plan,receipts});
  return {plan,receipts,result};
}

function evaluationBundle(candidateHandoff,plan,result){
  const kinds=['HARD_INVARIANTS','OBJECTIVES','HOLDOUT','REGRESSION_REPLAY','EVALUATION_INTEGRITY','TOURNAMENT'];
  const classes=kinds.map((kind,index)=>({
    evidence_id:`external:${kind.toLowerCase().replaceAll('_','-')}`,evidence_kind:kind,result:'PASS',
    evidence_digest:d(String((index+1)%10)),support_schema:'metaengine.rsi.test-support.v1',support_digest:d(String((index+2)%10)),
    external_evaluator_required:true,authored_by_candidate:false,candidate_can_override_result:false,physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  }));
  const core={
    schema:'metaengine.rsi.external-evaluation-bundle.v1',version:1,episode_id:'episode:rsi:release:1',
    candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE,parent_sha:PARENT,isolated_candidate_handoff_digest:candidateHandoff.handoff_digest,
    evaluator_plan_digest:d('5'),evaluator_result_digest:d('6'),benchmark_admission_digest:d('7'),holdout_result_digest:d('8'),
    regression_gate_digest:d('9'),evaluation_integrity_assessment_digest:d('a'),
    tournament_plan_digest:plan.plan_digest,tournament_result_digest:result.result_digest,
    evidence_classes:classes,required_evidence_kinds:kinds,all_classes_pass:true,any_class_ambiguous:false,
    candidate_can_self_certify:false,candidate_can_modify_evidence:false,evidence_ingest_is_promotion_authority:false,direct_promotion_enabled:false,
    physical_effect_replay_allowed:false,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  const payload_bytes=Buffer.byteLength(JSON.stringify(stable(core)),'utf8');
  return {...core,payload_bytes,max_payload_bytes:48*1024,bundle_digest:digest(core)};
}

function qualification(){
  const workflows=rsiPromotionGateTrustRootSnapshot().required_workflows;
  const core={
    schema:RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA,version:1,
    candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE,parent_sha:PARENT,
    artifact:{digest:ARTIFACT,signed:true,signature_verified:true},
    provenance:{digest:PROVENANCE,predicate_type:'https://slsa.dev/provenance/v1',builder_id:'github-actions:metaengine-browser-release-v1',source_repository:'PatrickFrome/Compute',source_sha:CANDIDATE,verified:true},
    ci_checks:workflows.map((workflow,index)=>({workflow,run_id:7000+index,head_sha:CANDIDATE,conclusion:'SUCCESS',evidence_ref:`github:actions/run/${7000+index}`})),
    canary:{mode:'SHADOW_CANARY',candidate_sha:CANDIDATE,artifact_digest:ARTIFACT,result:'PASS',duplicate_irreversible_effects:0,ambiguous_effect_retries:0,authority_violations:0,workspace_escapes:0,evidence_refs:['github:artifact:shadow-canary']},
    rollback:{predecessor_sha:PARENT,artifact_digest:ROLLBACK,ready:true,ambiguous_effect_replay_allowed:false,evidence_refs:['github:artifact:rollback-proof']},
    evidence_refs:['github:release-qualification:exact-head'],external_verifier:true,authored_by_candidate:false,
    direct_install_authorized:false,self_update_invocation_authorized:false,execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,qualification_digest:digest(core)};
}

function promotionReviewFixture(){
  const candidateHandoff=handoff();
  const {plan,receipts,result}=tournamentFixture(candidateHandoff);
  const request=createRsiExternalPromotionReviewRequest({
    evaluation_bundle:evaluationBundle(candidateHandoff,plan,result),
    candidate_handoff:candidateHandoff,tournament_plan:plan,tournament_result:result,tournament_receipts:receipts,qualification:qualification(),
  });
  const admission=new RsiVerifiedEvolutionArchive().admit({plan,result,receipts});
  const review=finalizeRsiExternalPromotionReview({request,candidate_handoff:candidateHandoff,archive_admission:admission});
  assert.equal(review.state,'READY_FOR_EXTERNAL_PROMOTION_REVIEW');
  return {request,review};
}

function releaseEvidence({ancestryCandidate=CANDIDATE,provenanceSource=CANDIDATE}={}){
  const release={
    schema:'metaengine.trusted-dev-release.v1',
    version:'0.7.0-dev.999.1',
    tag:'v0.7.0-dev.999.1',
    git_sha:CANDIDATE,
    feed_url:'https://github.com/PatrickFrome/Compute/releases/download/v0.7.0-dev.999.1/',
    installer_name:'METAENGINE-Browser-Test-Setup-0.7.0-dev.999.1-x64.exe',
    installer_sha256:hx('5'),installer_sha512:'A'.repeat(86)+'==',
    manifest_sha256:hx('6'),dev_yml_sha256:hx('7'),installed_executable_sha256:hx('8'),
    target_present_proof_supported:true,authority_effect:false,
  };
  const immutable={
    schema:'metaengine.browser-fabric.immutable-release-evidence.v1',verifier_id:'release-verifier-1',
    verified_at:'2026-09-18T18:10:00.000Z',enabled:true,tag_locked:true,assets_locked:true,attestation_verified:true,
    release_tag:release.tag,commit_sha:CANDIDATE,manifest_sha256:release.manifest_sha256,installer_sha256:release.installer_sha256,
    installed_executable_sha256:release.installed_executable_sha256,authority_effect:false,
  };
  const provenance={
    schema:'metaengine.browser-fabric.provenance-evidence.v1',verifier_id:'provenance-verifier-1',
    verified_at:'2026-09-18T18:10:00.000Z',verified:true,builder_trusted:true,builder_id:'github-actions-metaengine',
    source_sha:provenanceSource,subject_name:release.installer_name,subject_sha256:release.installer_sha256,
    predicate_type:'https://slsa.dev/provenance/v1',authority_effect:false,
  };
  const ancestry={
    schema:'metaengine.browser-fabric.source-ancestry-evidence.v1',verifier_id:'ancestry-verifier-1',
    verified_at:'2026-09-18T18:10:00.000Z',base_sha:PARENT,candidate_sha:ancestryCandidate,fast_forward_verified:true,authority_effect:false,
  };
  return {trusted_release:release,immutable_release_evidence:immutable,provenance_evidence:provenance,source_ancestry_evidence:ancestry};
}

test('exact external runtime readback is digest-bound and carries no release authority',()=>{
  const readback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-release-monitor-1',verified_at:'2026-09-18T18:11:00.000Z',
    current_authority_sha:PARENT,current_version:'0.7.0-dev.998.1',browser_generation:28,
    exact_runtime_identity:true,externally_verified:true,
  });
  verifyRsiReleaseAuthorityReadback(readback);
  assert.equal(readback.current_authority_sha,PARENT);
  assert.equal(readback.exact_runtime_identity,true);
  assert.equal(readback.readback_is_release_authority,false);
  assert.equal(readback.release_authority,false);
});

test('review-ready candidate plus immutable release evidence yields only external release-executor handoff',()=>{
  const {request,review}=promotionReviewFixture();
  const evidence=releaseEvidence();
  const readback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-release-monitor-1',verified_at:'2026-09-18T18:11:00.000Z',
    current_authority_sha:PARENT,current_version:'0.7.0-dev.998.1',browser_generation:28,
    exact_runtime_identity:true,externally_verified:true,
  });
  const handoff=createRsiReleaseAuthorityHandoff({
    promotion_review_result:review,promotion_review_request:request,authority_readback:readback,...evidence,
    evaluated_at:'2026-09-18T18:12:00.000Z',
  });
  verifyRsiReleaseAuthorityHandoff(handoff,review,request);
  assert.equal(handoff.state,'READY_FOR_EXTERNAL_RELEASE_EXECUTOR');
  assert.equal(handoff.ready_for_external_release_executor,true);
  assert.equal(handoff.release_gate_result.action,'AUTHORITY_ADVANCE_CANDIDATE');
  assert.equal(handoff.release_gate_result.requires_separate_journaled_promotion_effect,true);
  assert.equal(handoff.external_release_executor_required,true);
  assert.equal(handoff.release_transaction_created,false);
  assert.equal(handoff.installer_effect_started,false);
  assert.equal(handoff.self_update_check_invoked,false);
  assert.equal(handoff.self_update_apply_invoked,false);
  assert.equal(handoff.release_authority,false);
  assert.equal(handoff.self_update_authority,false);
  assert.equal(handoff.promotion_token,null);
});

test('provenance or ancestry drift is durably representable as HELD rather than granting partial authority',()=>{
  const {request,review}=promotionReviewFixture();
  const readback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-release-monitor-1',verified_at:'2026-09-18T18:11:00.000Z',
    current_authority_sha:PARENT,current_version:'0.7.0-dev.998.1',browser_generation:28,
    exact_runtime_identity:true,externally_verified:true,
  });
  for(const evidence of [
    releaseEvidence({provenanceSource:'f'.repeat(40)}),
    releaseEvidence({ancestryCandidate:'f'.repeat(40)}),
  ]){
    const row=createRsiReleaseAuthorityHandoff({
      promotion_review_result:review,promotion_review_request:request,authority_readback:readback,...evidence,
      evaluated_at:'2026-09-18T18:12:00.000Z',
    });
    assert.equal(row.state,'HELD');
    assert.equal(row.ready_for_external_release_executor,false);
    assert.ok(row.blockers.length===1);
    assert.equal(row.release_authority,false);
    assert.equal(row.self_update_apply_invoked,false);
  }
});

test('stale current authority identity fails before release-gate handoff can be prepared',()=>{
  const {request,review}=promotionReviewFixture();
  const readback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-release-monitor-1',verified_at:'2026-09-18T18:11:00.000Z',
    current_authority_sha:'f'.repeat(40),current_version:'0.7.0-dev.998.1',browser_generation:28,
    exact_runtime_identity:true,externally_verified:true,
  });
  assert.throws(()=>createRsiReleaseAuthorityHandoff({
    promotion_review_result:review,promotion_review_request:request,authority_readback:readback,...releaseEvidence(),
    evaluated_at:'2026-09-18T18:12:00.000Z',
  }),/parent_not_current_authority/);
});

test('release-authority handoff trust root reuses Browser Fabric gate and forbids direct self-update',()=>{
  const root=rsiReleaseAuthorityHandoffTrustRootSnapshot();
  assert.equal(root.external_promotion_review_ready_required,true);
  assert.equal(root.exact_runtime_authority_readback_required,true);
  assert.equal(root.immutable_verified_release_required,true);
  assert.equal(root.slsa_provenance_required,true);
  assert.equal(root.source_fast_forward_proof_required,true);
  assert.equal(root.installed_executable_binding_required,true);
  assert.equal(root.browser_fabric_release_gate_reused,true);
  assert.equal(root.separate_journaled_promotion_effect_required,true);
  assert.equal(root.external_release_executor_required,true);
  assert.equal(root.direct_install_authorized,false);
  assert.equal(root.direct_self_update_authorized,false);
  assert.equal(root.ambiguous_effect_replay_allowed,false);
  assert.equal(root.release_authority,false);
  assert.equal(root.self_update_authority,false);
});
