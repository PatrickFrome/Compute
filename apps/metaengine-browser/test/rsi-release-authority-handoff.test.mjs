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
import {
  expectedRsiReleaseExecutorIdempotencyKey,
  createRsiReleaseExecutorReadback,
  verifyRsiReleaseExecutorReadback,
  createRsiReleaseExecutorAdmission,
  verifyRsiReleaseExecutorAdmission,
  rsiReleaseExecutorAdmissionTrustRootSnapshot,
} from '../src/rsi-release-executor-admission.mjs';
import {
  createRsiReleaseEffectCommandReadback,
  createRsiSelfUpdateTransactionReadback,
  createRsiSuccessorRuntimeReadback,
  createRsiReleaseEffectReconciliation,
  verifyRsiReleaseEffectReconciliation,
  rsiReleaseEffectReconciliationTrustRootSnapshot,
} from '../src/rsi-release-effect-reconciliation.mjs';

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


function readyReleaseHandoffFixture(){
  const {request,review}=promotionReviewFixture();
  const authorityReadback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-release-monitor-1',
    verified_at:'2026-09-18T18:11:00.000Z',
    current_authority_sha:PARENT,
    current_version:'0.7.0-dev.998.1',
    browser_generation:28,
    exact_runtime_identity:true,
    externally_verified:true,
  });
  const releaseHandoff=createRsiReleaseAuthorityHandoff({
    promotion_review_result:review,
    promotion_review_request:request,
    authority_readback:authorityReadback,
    ...releaseEvidence(),
    evaluated_at:'2026-09-18T18:12:00.000Z',
  });
  return {request,review,releaseHandoff};
}

function executorReadback(releaseHandoff,review,overrides={}){
  const commandId='11111111-1111-4111-8111-111111111111';
  return createRsiReleaseExecutorReadback({
    verifier_id:'native-executor-monitor-1',
    verified_at:'2026-09-18T18:12:09.000Z',
    workspace_id:'2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    command_id:commandId,
    target_client_id:'22222222-2222-4222-8222-222222222222',
    leased_by:'22222222-2222-4222-8222-222222222222',
    issued_by:review.gate_result.qualification_digest,
    action:'SELF_UPDATE_APPLY',
    status:'LEASED',
    payload:{},
    issued_at:'2026-09-18T18:12:00.000Z',
    leased_at:'2026-09-18T18:12:05.000Z',
    expires_at:'2026-09-18T18:14:00.000Z',
    idempotency_key:expectedRsiReleaseExecutorIdempotencyKey(releaseHandoff),
    command_lane:'GLOBAL_MUTATION',
    effect_key:'global:control-plane',
    supervisor_mode:'CONTROL',
    armed:true,
    continuous_service_admitted:true,
    current_command_id:commandId,
    browser_generation:28,
    current_authority_sha:PARENT,
    command_row_authority_effect:false,
    db_row_externally_verified:true,
    native_runtime_externally_verified:true,
    ...overrides,
  });
}

test('fresh externally selected DB lease admits exactly one external effect attempt without invoking it',()=>{
  const {request,review,releaseHandoff}=readyReleaseHandoffFixture();
  const lease=executorReadback(releaseHandoff,review);
  verifyRsiReleaseExecutorReadback(lease);
  const authorityReadback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-pre-effect-monitor-1',
    verified_at:'2026-09-18T18:12:10.000Z',
    current_authority_sha:PARENT,
    current_version:'0.7.0-dev.998.1',
    browser_generation:28,
    exact_runtime_identity:true,
    externally_verified:true,
  });
  const admission=createRsiReleaseExecutorAdmission({
    release_handoff:releaseHandoff,
    promotion_review_result:review,
    promotion_review_request:request,
    executor_readback:lease,
    pre_effect_authority_readback:authorityReadback,
    evaluated_at:'2026-09-18T18:12:12.000Z',
  });
  verifyRsiReleaseExecutorAdmission(admission);
  assert.equal(admission.state,'READY_FOR_ONE_ATTEMPT_EXTERNAL_EFFECT');
  assert.equal(admission.db_lease_is_execution_authority,true);
  assert.equal(admission.admission_is_execution_authority,false);
  assert.equal(admission.scheduler_selected_externally,true);
  assert.equal(admission.command_created_by_rsi,false);
  assert.equal(admission.command_leased_by_rsi,false);
  assert.equal(admission.command_completed_by_rsi,false);
  assert.equal(admission.effect_invoked_by_admission,false);
  assert.equal(admission.release_transaction_created,false);
  assert.equal(admission.installer_effect_started,false);
  assert.equal(admission.self_update_apply_invoked,false);
  assert.equal(admission.ambiguous_effect_replay_allowed,false);
  assert.equal(admission.execution_authority,false);
});

test('executor admission fails on stale lease, wrong action, stale generation or unbound idempotency key',()=>{
  const {request,review,releaseHandoff}=readyReleaseHandoffFixture();
  const freshAuthority=createRsiReleaseAuthorityReadback({
    verifier_id:'native-pre-effect-monitor-1',
    verified_at:'2026-09-18T18:12:10.000Z',
    current_authority_sha:PARENT,
    current_version:'0.7.0-dev.998.1',
    browser_generation:28,
    exact_runtime_identity:true,
    externally_verified:true,
  });
  assert.throws(()=>executorReadback(releaseHandoff,review,{action:'SELF_UPDATE_CHECK'}),/action_invalid/);
  assert.throws(()=>executorReadback(releaseHandoff,review,{command_lane:'READ_ONLY'}),/lane_invalid/);
  assert.throws(()=>createRsiReleaseExecutorAdmission({
    release_handoff:releaseHandoff,promotion_review_result:review,promotion_review_request:request,
    executor_readback:executorReadback(releaseHandoff,review,{idempotency_key:'external-unbound-release-effect-0001'}),
    pre_effect_authority_readback:freshAuthority,evaluated_at:'2026-09-18T18:12:12.000Z',
  }),/idempotency_binding_mismatch/);
  const staleAuthority=createRsiReleaseAuthorityReadback({
    verifier_id:'native-pre-effect-monitor-1',
    verified_at:'2026-09-18T18:11:40.000Z',
    current_authority_sha:PARENT,current_version:'0.7.0-dev.998.1',browser_generation:28,
    exact_runtime_identity:true,externally_verified:true,
  });
  assert.throws(()=>createRsiReleaseExecutorAdmission({
    release_handoff:releaseHandoff,promotion_review_result:review,promotion_review_request:request,
    executor_readback:executorReadback(releaseHandoff,review),
    pre_effect_authority_readback:staleAuthority,evaluated_at:'2026-09-18T18:12:12.000Z',
  }),/readback_stale/);
  const driftAuthority=createRsiReleaseAuthorityReadback({
    verifier_id:'native-pre-effect-monitor-1',
    verified_at:'2026-09-18T18:12:10.000Z',
    current_authority_sha:PARENT,current_version:'0.7.0-dev.998.1',browser_generation:29,
    exact_runtime_identity:true,externally_verified:true,
  });
  assert.throws(()=>createRsiReleaseExecutorAdmission({
    release_handoff:releaseHandoff,promotion_review_result:review,promotion_review_request:request,
    executor_readback:executorReadback(releaseHandoff,review),
    pre_effect_authority_readback:driftAuthority,evaluated_at:'2026-09-18T18:12:12.000Z',
  }),/browser_generation_drift/);
});

test('release executor admission root reuses existing DB lease plane and gives RSI no command authority',()=>{
  const root=rsiReleaseExecutorAdmissionTrustRootSnapshot();
  assert.equal(root.existing_command_table,'public.compute_fabric_a2_browser_supervisor_command_h205f22');
  assert.equal(root.existing_lease_rpc,'h205f22_a2_browser_supervisor_lease_batch_v1');
  assert.equal(root.existing_completion_rpc,'h205f22_a2_browser_supervisor_complete_v5');
  assert.equal(root.required_action,'SELF_UPDATE_APPLY');
  assert.equal(root.required_command_lane,'GLOBAL_MUTATION');
  assert.equal(root.required_effect_key,'global:control-plane');
  assert.equal(root.db_lease_is_execution_authority,true);
  assert.equal(root.rsi_can_issue_command,false);
  assert.equal(root.rsi_can_lease_command,false);
  assert.equal(root.rsi_can_complete_command,false);
  assert.equal(root.rsi_can_invoke_effect,false);
  assert.equal(root.same_command_receipt_reconciliation_required,true);
  assert.equal(root.ambiguous_effect_replay_allowed,false);
});


function executorAdmissionFixture(){
  const {request,review,releaseHandoff}=readyReleaseHandoffFixture();
  const lease=executorReadback(releaseHandoff,review);
  const authorityReadback=createRsiReleaseAuthorityReadback({
    verifier_id:'native-pre-effect-monitor-1',
    verified_at:'2026-09-18T18:12:10.000Z',
    current_authority_sha:PARENT,
    current_version:'0.7.0-dev.998.1',
    browser_generation:28,
    exact_runtime_identity:true,
    externally_verified:true,
  });
  const admission=createRsiReleaseExecutorAdmission({
    release_handoff:releaseHandoff,
    promotion_review_result:review,
    promotion_review_request:request,
    executor_readback:lease,
    pre_effect_authority_readback:authorityReadback,
    evaluated_at:'2026-09-18T18:12:12.000Z',
  });
  return {request,review,releaseHandoff,lease,admission};
}

function postCommandReadback(admission,overrides={}){
  return createRsiReleaseEffectCommandReadback({
    verifier_id:'native-command-reconciler-1',
    observed_at:'2026-09-18T18:13:00.000Z',
    workspace_id:admission.workspace_id,
    command_id:admission.command_id,
    leased_by:admission.leased_by,
    action:'SELF_UPDATE_APPLY',
    status:'FAILED',
    idempotency_key:admission.idempotency_key,
    command_lane:'GLOBAL_MUTATION',
    effect_key:'global:control-plane',
    leased_at:admission.leased_at,
    expires_at:admission.expires_at,
    completed_at:'2026-09-18T18:12:30.000Z',
    receipt:{
      schema:'metaengine.native-supervisor.command-receipt.v2',
      command_id:admission.command_id,
      action:'SELF_UPDATE_APPLY',
      platform:null,
      result:null,
      effect_outcome:'AMBIGUOUS',
      lane:'GLOBAL_MUTATION',
      effect_key:'global:control-plane',
      execution_ms:25,
      recorded_at:'2026-09-18T18:12:29.000Z',
      authority_effect:false,
    },
    error:'self_update_apply_not_ready',
    command_row_authority_effect:false,
    db_row_externally_verified:true,
    ...overrides,
  });
}

function transactionRow(releaseHandoff,{state='PREPARED',effect=false}={}){
  return {
    schema:'metaengine.self-update.transaction.v1',
    transaction_id:'33333333-3333-4333-8333-333333333333',
    source_version:releaseHandoff.authority_readback.current_version,
    target_version:releaseHandoff.trusted_release.version,
    resolved_git_sha:CANDIDATE,
    state,
    swapping:!['SUCCESSOR_BOOTED','QUALIFIED','QUARANTINED','SUPERSEDED'].includes(state),
    qualified:state==='QUALIFIED',
    quarantined:state==='QUARANTINED',
    attempt_count:1,
    automatic_retry_allowed:false,
    created_at:'2026-09-18T18:12:15.000Z',
    updated_at:'2026-09-18T18:12:40.000Z',
    evidence:effect?{
      effect_barrier_contract:'WRITE_AHEAD_V1',
      effect_scope:'BROWSER_RESTART',
      actuator_type:'ELECTRON_UPDATER_QUIT_AND_INSTALL',
      physical_effect_attempted:true,
      effect_barrier_crossed:true,
      effect_must_be_single_shot:true,
      post_effect_readback_required:true,
    }:{},
    authority_effect:false,
  };
}

test('failed same command before install barrier is reconciled as NO_EFFECT_PROVEN without retry authority',()=>{
  const {request,review,releaseHandoff,admission}=executorAdmissionFixture();
  const command=postCommandReadback(admission);
  const transaction=createRsiSelfUpdateTransactionReadback({
    verifier_id:'journal-reconciler-1',
    observed_at:'2026-09-18T18:13:00.000Z',
    transaction_present:true,
    transaction:transactionRow(releaseHandoff,{state:'PREPARED',effect:false}),
    filesystem_read_verified:true,
  });
  const row=createRsiReleaseEffectReconciliation({
    executor_admission:admission,
    release_handoff:releaseHandoff,
    promotion_review_result:review,
    promotion_review_request:request,
    command_readback:command,
    transaction_readback:transaction,
    successor_runtime_readback:null,
    reconciled_at:'2026-09-18T18:13:02.000Z',
  });
  verifyRsiReleaseEffectReconciliation(row);
  assert.equal(row.result,'NO_EFFECT_PROVEN');
  assert.equal(row.no_effect_proven,true);
  assert.equal(row.physical_effect_confirmed,false);
  assert.equal(row.retry_authorized,false);
  assert.equal(row.effect_reexecution_authorized,false);
  assert.equal(row.release_authority,false);
});

test('installer barrier crossed without exact qualified successor is AMBIGUOUS even if DB command completed',()=>{
  const {request,review,releaseHandoff,admission}=executorAdmissionFixture();
  const command=postCommandReadback(admission,{
    status:'COMPLETED',
    error:null,
    command_row_authority_effect:true,
    receipt:{
      schema:'metaengine.native-supervisor.command-receipt.v2',
      command_id:admission.command_id,
      action:'SELF_UPDATE_APPLY',
      platform:null,
      result:{state:'RESTART_GRACE',current_version:releaseHandoff.authority_readback.current_version},
      effect_outcome:'AMBIGUOUS',
      lane:'GLOBAL_MUTATION',
      effect_key:'global:control-plane',
      execution_ms:80,
      recorded_at:'2026-09-18T18:12:29.000Z',
      authority_effect:true,
    },
  });
  const transaction=createRsiSelfUpdateTransactionReadback({
    verifier_id:'journal-reconciler-1',
    observed_at:'2026-09-18T18:13:00.000Z',
    transaction_present:true,
    transaction:transactionRow(releaseHandoff,{state:'INSTALLING',effect:true}),
    filesystem_read_verified:true,
  });
  const row=createRsiReleaseEffectReconciliation({
    executor_admission:admission,release_handoff:releaseHandoff,
    promotion_review_result:review,promotion_review_request:request,
    command_readback:command,transaction_readback:transaction,
    successor_runtime_readback:null,reconciled_at:'2026-09-18T18:13:02.000Z',
  });
  assert.equal(row.result,'AMBIGUOUS');
  assert.equal(row.reason,'INSTALL_EFFECT_STARTED_SUCCESSOR_NOT_QUALIFIED');
  assert.equal(row.db_command_completion_is_not_physical_success_proof,true);
  assert.equal(row.db_authority_effect_is_not_physical_success_proof,true);
  assert.equal(row.retry_authorized,false);
  assert.equal(row.ambiguous,true);
});

test('exact QUALIFIED successor independently proves the physical effect even when command receipt delivery did not complete',()=>{
  const {request,review,releaseHandoff,admission}=executorAdmissionFixture();
  const command=createRsiReleaseEffectCommandReadback({
    verifier_id:'native-command-reconciler-1',
    observed_at:'2026-09-18T18:14:05.000Z',
    workspace_id:admission.workspace_id,
    command_id:admission.command_id,
    leased_by:admission.leased_by,
    action:'SELF_UPDATE_APPLY',
    status:'EXPIRED',
    idempotency_key:admission.idempotency_key,
    command_lane:'GLOBAL_MUTATION',
    effect_key:'global:control-plane',
    leased_at:admission.leased_at,
    expires_at:admission.expires_at,
    completed_at:'2026-09-18T18:14:01.000Z',
    receipt:null,
    error:'lease_timeout_no_retry',
    command_row_authority_effect:false,
    db_row_externally_verified:true,
  });
  const tx=transactionRow(releaseHandoff,{state:'QUALIFIED',effect:true});
  const transaction=createRsiSelfUpdateTransactionReadback({
    verifier_id:'journal-reconciler-1',
    observed_at:'2026-09-18T18:14:05.000Z',
    transaction_present:true,
    transaction:tx,
    filesystem_read_verified:true,
  });
  const successor=createRsiSuccessorRuntimeReadback({
    verifier_id:'successor-runtime-verifier-1',
    observed_at:'2026-09-18T18:14:06.000Z',
    transaction_id:tx.transaction_id,
    running_version:releaseHandoff.trusted_release.version,
    running_git_sha:CANDIDATE,
    installed_executable_sha256:releaseHandoff.trusted_release.installed_executable_sha256,
    browser_generation:29,
    successor_qualification_state:'QUALIFIED',
    exact_runtime_identity:true,
    installed_executable_hash_verified:true,
    trusted_release_verified:true,
    external_successor_verifier:true,
  });
  const row=createRsiReleaseEffectReconciliation({
    executor_admission:admission,release_handoff:releaseHandoff,
    promotion_review_result:review,promotion_review_request:request,
    command_readback:command,transaction_readback:transaction,
    successor_runtime_readback:successor,reconciled_at:'2026-09-18T18:14:07.000Z',
  });
  assert.equal(row.result,'CONFIRMED');
  assert.equal(row.physical_effect_confirmed,true);
  assert.equal(row.no_effect_proven,false);
  assert.equal(row.ambiguous,false);
  assert.equal(row.external_release_authority_convergence_still_required,true);
  assert.equal(row.release_authority,false);
  assert.equal(row.effect_reexecution_authorized,false);
});

test('reconciliation rejects a different command id and exact-successor hash drift',()=>{
  const {request,review,releaseHandoff,admission}=executorAdmissionFixture();
  assert.throws(()=>createRsiReleaseEffectReconciliation({
    executor_admission:admission,release_handoff:releaseHandoff,
    promotion_review_result:review,promotion_review_request:request,
    command_readback:postCommandReadback(admission,{command_id:'44444444-4444-4444-8444-444444444444'}),
    transaction_readback:createRsiSelfUpdateTransactionReadback({
      verifier_id:'journal-reconciler-1',observed_at:'2026-09-18T18:13:00.000Z',
      transaction_present:false,transaction:null,filesystem_read_verified:true,
    }),
    successor_runtime_readback:null,reconciled_at:'2026-09-18T18:13:02.000Z',
  }),/same_command_binding_mismatch|receipt_command_mismatch/);

  const tx=transactionRow(releaseHandoff,{state:'QUALIFIED',effect:true});
  const badSuccessor=createRsiSuccessorRuntimeReadback({
    verifier_id:'successor-runtime-verifier-1',observed_at:'2026-09-18T18:13:31.000Z',
    transaction_id:tx.transaction_id,running_version:releaseHandoff.trusted_release.version,
    running_git_sha:'f'.repeat(40),installed_executable_sha256:releaseHandoff.trusted_release.installed_executable_sha256,
    browser_generation:29,successor_qualification_state:'QUALIFIED',exact_runtime_identity:true,
    installed_executable_hash_verified:true,trusted_release_verified:true,external_successor_verifier:true,
  });
  const ambiguous=createRsiReleaseEffectReconciliation({
    executor_admission:admission,release_handoff:releaseHandoff,
    promotion_review_result:review,promotion_review_request:request,
    command_readback:postCommandReadback(admission),
    transaction_readback:createRsiSelfUpdateTransactionReadback({
      verifier_id:'journal-reconciler-1',observed_at:'2026-09-18T18:13:00.000Z',
      transaction_present:true,transaction:tx,filesystem_read_verified:true,
    }),
    successor_runtime_readback:badSuccessor,reconciled_at:'2026-09-18T18:13:32.000Z',
  });
  assert.equal(ambiguous.result,'AMBIGUOUS');
  assert.equal(ambiguous.physical_effect_confirmed,false);
});

test('release effect reconciliation root encodes at-most-once no-retry semantics',()=>{
  const root=rsiReleaseEffectReconciliationTrustRootSnapshot();
  assert.equal(root.same_db_command_identity_required,true);
  assert.equal(root.db_command_completion_is_not_physical_success_proof,true);
  assert.equal(root.db_authority_effect_is_not_physical_success_proof,true);
  assert.equal(root.exact_qualified_successor_required_for_confirmed_success,true);
  assert.equal(root.failed_or_expired_without_effect_barrier_can_prove_no_effect,true);
  assert.equal(root.installer_started_without_qualified_successor_is_ambiguous,true);
  assert.equal(root.effect_reexecution_authorized,false);
  assert.equal(root.retry_authorized,false);
  assert.equal(root.ambiguous_effect_replay_allowed,false);
  assert.equal(root.external_release_authority_convergence_required_after_confirmed_success,true);
});
