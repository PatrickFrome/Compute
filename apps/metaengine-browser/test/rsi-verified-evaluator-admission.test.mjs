import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  createRsiBenchmarkProvenancePolicy,
  createRsiBenchmarkTaskProvenance,
  assessRsiBenchmarkContamination,
  createRsiBenchmarkEvidenceAdmission,
} from '../src/rsi-benchmark-provenance-guard.mjs';
import {
  createRsiEvaluationIntegrityPolicy,
  createRsiEvaluationIntegrityReceipt,
  assessRsiEvaluationIntegrity,
} from '../src/rsi-evaluation-integrity-guard.mjs';
import {
  createRsiEvaluatorMeshPlan,
  createRsiEvaluatorReceipt,
} from '../src/rsi-evaluator-mesh.mjs';
import {
  applyRsiVerifiedEvaluatorMesh,
  createRsiVerifiedEvaluatorAdmission,
} from '../src/rsi-verified-evaluator-admission.mjs';
import {
  createRsiArtifactSpecAuditReceipt,
} from '../src/rsi-artifact-spec-audit.mjs';
import {
  createRsiSandboxBoundaryReceipt,
} from '../src/rsi-sandbox-boundary-admission.mjs';
import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiMutationContract } from '../src/supervisor-rsi-mutation-contract.mjs';
import { RsiShadowArchive, RSI_SHADOW_STATES } from '../src/rsi-shadow-core.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const require=createRequire(import.meta.url);
const {
  createBackendBindingCandidate,
  BACKEND_OBSERVATION_SCHEMA,
}=require('../src/verification-sandbox-backend-binding.cjs');

const d=(c)=>`sha256:${c.repeat(64)}`;
const PARENT='a'.repeat(40);
const CANDIDATE='b'.repeat(40);
const CANDIDATE_ID=`candidate_sha256_${'c'.repeat(64)}`;
const HANDOFF_DIGEST=d('d');
const COMPONENT_DIGEST=d('e');

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function hashPlan(core){
  return crypto.createHash('sha256').update(JSON.stringify(stable(core)),'utf8').digest('hex');
}
function hypothesisAndContract(){
  const observer=new RsiCommandPlaneLivenessObserver({
    source_sha:PARENT,
    clock:()=>Date.parse('2026-09-18T12:00:00Z'),
    heartbeat_fresh_ms:15_000,
    perception_fresh_ms:15_000,
    command_stall_ms:120_000,
  });
  const observation=observer.observe({
    schema:RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at:'2026-09-18T12:00:00Z',
    heartbeat_at:'2026-09-18T11:59:55Z',
    perception_at:'2026-09-18T11:59:56Z',
    command_progress_at:'2026-09-18T05:00:00Z',
    pending_command_count:3,
    active_command:{
      command_id:'11111111-1111-4111-8111-111111111111',
      action:'SCROLL',command_lane:'TAB_MUTATION',status:'LEASED',
      leased_at:'2026-09-18T04:59:59Z',effect_bound_at:'2026-09-18T05:00:00Z',receipt_recorded_at:null,
    },
    command_payload_exposed:false,page_text_exposed:false,input_values_exposed:false,raw_network_exposed:false,
    execution_authority:false,production_mutation_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
  const opportunity=observation.opportunities.find((entry)=>entry.signal==='RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.ok(opportunity);
  const hypothesis=buildRsiExperimentHypothesis({observation,opportunity_id:opportunity.opportunity_id});
  return {hypothesis,mutationContract:buildRsiMutationContract({hypothesis})};
}

function sandboxPlan(){
  const core={
    schema:'metaengine.development-plane.verification-sandbox-plan.v1',
    version:'1.0.0',
    mode:'PREPARE_ONLY',
    candidate:{
      candidate_id:CANDIDATE_ID,
      digest:d('f'),
      source_head:CANDIDATE,
      sequence:1,
      verification_plan:[{id:'UNIT_TESTS',required:true}],
    },
    isolation:{
      requested_backend:'VERCEL_SANDBOX',
      backend_bound:false,backend_identity:null,
      accepted_backends:['CLOUDFLARE_SANDBOX','FIRECRACKER','GVISOR','KATA','VERCEL_SANDBOX'],
      required_boundary:'VM_OR_STRONGER_OR_USERSPACE_KERNEL',
      execution_authority:false,
    },
    filesystem:{
      materialization_strategy:'IMMUTABLE_SNAPSHOT',
      source_read_only:true,host_repository_mounted:false,writable_layer:'PRIVATE_DIRECTORY',
      output_allowlist:['evidence/'],allow_special_files:false,
    },
    network:{deny_by_default:true,inbound_exposure:false,allowed_hosts:[],allowed_cidrs:[],credential_brokering:false},
    resources:{wall_time_seconds:120,memory_bytes:2147483648,pids:96,disk_bytes:2147483648,output_bytes:16777216},
    evidence_contract:{
      sandbox_identity_receipt_required:true,input_manifest_digest_required:true,
      verification_receipts_required:true,output_manifest_digest_required:true,teardown_receipt_required:true,
    },
    policy:{
      candidate_only:true,prepare_only:true,execution_authority:false,arbitrary_command_authority:false,
      browser_actuation_authority:false,direct_promote_current:false,promotion_authority:false,
      signed_attestation_authority:false,authority_effect:false,
    },
    authority_effect:false,
  };
  const hex=hashPlan(core);
  return {...core,plan_id:`sandbox_plan_sha256_${hex}`,digest:`sha256:${hex}`};
}

function handoff(){
  return {
    schema:RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,version:1,
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    mutation_surface:'BROWSER_RUNTIME',
    parent_sha:PARENT,candidate_sha:CANDIDATE,
    target_branch:'work/rsi/integrity-aaaaaaaa-01234567',
    handoff_digest:HANDOFF_DIGEST,
    candidate_capsule:{
      candidate_id:CANDIDATE_ID,
      source:{head:CANDIDATE},
      components:[{path:'apps/metaengine-browser/src/result-delivery-transport.mjs',change:'CREATE',digest:COMPONENT_DIGEST}],
    },
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:sandboxPlan(),
    sandbox_plan_verification:{execution_authorized:false},
    shadow_archive_proposal:{
      candidate_id:CANDIDATE_ID,parent_sha:PARENT,candidate_sha:CANDIDATE,
      mutation_surface:'BROWSER_RUNTIME',hypothesis:'Improve without touching trust roots.',
    },
    eligible_for_evaluation:true,eligible_for_promotion:false,
    materialization_replay_authorized:false,
    execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
}

function benchmark({contaminated=false}={}){
  const policy=createRsiBenchmarkProvenancePolicy({
    policy_id:'verified.eval.benchmark.v1',
    min_resistant_tasks:1,min_source_families:1,max_public_static_fraction:0,
    external_policy_owner:true,authored_by_candidate:false,
  });
  const task=createRsiBenchmarkTaskProvenance({
    policy,task_id:'task.private.1',benchmark_id:'rsi.private.holdout.v1',benchmark_version:'2026-09-18.1',
    task_prompt_digest:d('1'),hidden_test_digest:d('2'),
    source_kind:'FRESH_PRIVATE_COMMIT',source_family:'private.family',
    source_repository_digest:d('3'),candidate_repository_digest:d('4'),source_commit_sha:'5'.repeat(40),
    source_published_at:'2026-09-18T10:00:00.000Z',candidate_frozen_at:'2026-09-18T09:00:00.000Z',task_materialized_at:'2026-09-18T10:05:00.000Z',
    searchability:'NOT_SEARCHABLE',reference_solution_visible:false,hidden_tests_visible:false,evaluator_harness_visible:false,
    evaluator_harness_mutated_by_candidate:contaminated,task_authored_by_candidate:false,task_selected_by_candidate:false,
    source_repository_selected_by_candidate:false,ingested_into_trusted_memory:false,ingested_into_skill_library:false,
    external_provenance_verifier:true,authored_by_candidate:false,evidence_refs:['PROVENANCE_PRIVATE_1'],
  });
  const assessment=assessRsiBenchmarkContamination({policy,task});
  const admission=createRsiBenchmarkEvidenceAdmission({policy,assessments:[assessment],tasks:[task]});
  return {policy,tasks:[task],assessments:[assessment],admission};
}

function integrity({tampered=false}={}){
  const policy=createRsiEvaluationIntegrityPolicy({
    policy_id:'verified.eval.integrity.v1',
    visible_suite_digest:d('6'),compositional_holdout_digest:d('7'),
    evaluator_root_digest:d('8'),workspace_baseline_digest:d('9'),
    max_visible_holdout_gap:0.15,min_holdout_pass_rate:0.8,
    external_policy_owner:true,authored_by_candidate:false,
  });
  const receipt=createRsiEvaluationIntegrityReceipt({
    policy,receipt_id:'verified.eval.receipt.1',candidate_id:CANDIDATE_ID,candidate_sha:CANDIDATE,
    visible_pass_rate:0.9,holdout_pass_rate:0.88,evaluator_root_digest:policy.evaluator_root_digest,
    workspace_before_digest:policy.workspace_baseline_digest,workspace_after_digest:d('a'),
    patch_audit_digest:d('b'),file_access_audit_digest:d('c'),network_audit_digest:d('d'),
    evaluator_files_modified:tampered,hidden_tests_read:false,reference_solution_retrieved:false,
    expected_outputs_retrieved:false,contamination_canary_retrieved:false,evaluation_metric_tampered:false,
    validation_bypass_detected:false,external_integrity_monitor:true,authored_by_candidate:false,
    evidence_refs:['PATCH_AUDIT','FILE_AUDIT','NETWORK_AUDIT'],
  });
  return {policy,receipt,assessment:assessRsiEvaluationIntegrity({policy,receipt})};
}

function artifact(candidateHandoff,hypothesis,mutationContract,{noopEquivalent=false}={}){
  return createRsiArtifactSpecAuditReceipt({
    candidate_handoff:candidateHandoff,hypothesis,mutation_contract:mutationContract,
    observed_artifacts:[{
      path:'apps/metaengine-browser/src/result-delivery-transport.mjs',change:'CREATE',
      artifact_digest:COMPONENT_DIGEST,artifact_present_after:true,
      expected_change_observed:true,artifact_exercised_by_verification:true,
    }],
    no_op_ablation:{
      performed:true,kind:'EXACT_MUTATION_REVERT_TO_PARENT',same_harness_and_holdout:true,
      candidate_effect_observed:true,no_op_effect_equivalent:noopEquivalent,
      candidate_evidence_digest:d('1'),no_op_evidence_digest:d('2'),
    },
    external_mechanical_auditor:true,authored_by_candidate:false,
    evidence_refs:['ARTIFACT_MANIFEST','NOOP_ABLATION'],
  });
}

function sandbox(candidateHandoff,{hostLeak=false}={}){
  const binding=createBackendBindingCandidate({plan:candidateHandoff.sandbox_plan});
  const observation={
    schema:BACKEND_OBSERVATION_SCHEMA,provider:'VERCEL_SANDBOX',session_id:'sbx_eval123',
    isolation_class:'FIRECRACKER_MICROVM',
    runtime_digest:d('1'),image_digest:d('2'),input_manifest_digest:d('3'),output_manifest_digest:d('4'),teardown_receipt_digest:d('5'),
    created_at:'2026-09-18T10:00:00.000Z',stopped_at:'2026-09-18T10:01:00.000Z',
    network_policy:{deny_by_default:true,allowed_domains:[],allowed_cidrs:[],exposed_ports:[]},
    secrets:{environment_secret_injection:false,credential_brokering:false},
    materialization:{host_repository_mounted:false,source_read_only:true},
    teardown:{stopped:true,persistent_state_deleted:true},
  };
  const receipt=createRsiSandboxBoundaryReceipt({
    candidate_handoff:candidateHandoff,backend_binding:binding,backend_observation:observation,
    filesystem_probe_digest:d('6'),tool_inventory_digest:d('7'),credential_probe_digest:d('8'),network_probe_digest:d('9'),
    host_source_absent:!hostLeak,host_project_cache_absent:true,host_management_tools_absent:true,
    unexpected_privileged_tool_count:0,credential_material_absent:true,network_egress_observed:false,
    external_boundary_monitor:true,authored_by_candidate:false,evidence_refs:['FS_PROBE','TOOL_INVENTORY','CREDENTIAL_PROBE','NETWORK_PROBE'],
  });
  return {binding,observation,receipt};
}

function evaluator(candidateHandoff){
  const plan=createRsiEvaluatorMeshPlan({candidate_handoff:candidateHandoff});
  const receipts=plan.evaluator_root.invariants.map((entry,index)=>createRsiEvaluatorReceipt({
    plan,evaluator_id:entry.evaluator_id,result:'PASS',evidence_refs:[`run:${index}`],
  }));
  receipts.push(createRsiEvaluatorReceipt({
    plan,evaluator_id:'rsi.objective.latency.v1',objective:{baseline:100,candidate:80},evidence_refs:['run:objective'],
  }));
  return {plan,receipts};
}

function archiveFor(candidateHandoff){
  const archive=new RsiShadowArchive({clock:()=>Date.parse('2026-09-18T12:00:00Z')});
  archive.propose(candidateHandoff.shadow_archive_proposal);
  return archive;
}

function completeEvidence({contaminated=false,tampered=false}={}){
  const candidateHandoff=handoff();
  const {hypothesis,mutationContract}=hypothesisAndContract();
  const b=benchmark({contaminated});
  const i=integrity({tampered});
  const a=artifact(candidateHandoff,hypothesis,mutationContract);
  const s=sandbox(candidateHandoff);
  const e=evaluator(candidateHandoff);
  return {candidateHandoff,hypothesis,mutationContract,b,i,a,s,e};
}

test('archive admission requires benchmark, harness, mechanical artifact and sandbox-boundary evidence',()=>{
  const x=completeEvidence();
  const admission=createRsiVerifiedEvaluatorAdmission({
    evaluator_plan:x.e.plan,candidate_handoff:x.candidateHandoff,
    benchmark_policy:x.b.policy,benchmark_tasks:x.b.tasks,benchmark_assessments:x.b.assessments,benchmark_admission:x.b.admission,
    integrity_policy:x.i.policy,integrity_receipt:x.i.receipt,integrity_assessment:x.i.assessment,
    hypothesis:x.hypothesis,mutation_contract:x.mutationContract,artifact_receipt:x.a,
    sandbox_backend_binding:x.s.binding,sandbox_backend_observation:x.s.observation,sandbox_boundary_receipt:x.s.receipt,
  });
  assert.equal(admission.state,'READY');
  assert.equal(admission.archive_apply_authorized,true);
  assert.equal(admission.mechanical_artifact_audit_required,true);
  assert.equal(admission.no_op_ablation_required,true);
  assert.equal(admission.sandbox_boundary_evidence_required,true);
  assert.equal(admission.promotion_authority,false);

  const archive=archiveFor(x.candidateHandoff);
  const result=applyRsiVerifiedEvaluatorMesh({
    archive,candidate_handoff:x.candidateHandoff,evaluator_plan:x.e.plan,evaluator_receipts:x.e.receipts,
    benchmark_policy:x.b.policy,benchmark_tasks:x.b.tasks,benchmark_assessments:x.b.assessments,benchmark_admission:x.b.admission,
    integrity_policy:x.i.policy,integrity_receipt:x.i.receipt,integrity_assessment:x.i.assessment,
    hypothesis:x.hypothesis,mutation_contract:x.mutationContract,artifact_receipt:x.a,
    sandbox_backend_binding:x.s.binding,sandbox_backend_observation:x.s.observation,sandbox_boundary_receipt:x.s.receipt,
    verified_admission:admission,
  });
  assert.equal(result.evaluator_state,RSI_SHADOW_STATES.SHADOW_QUALIFIED);
  assert.equal(result.benchmark_provenance_verified,true);
  assert.equal(result.harness_integrity_verified,true);
  assert.equal(result.mechanical_artifact_audit_verified,true);
  assert.equal(result.no_op_ablation_verified,true);
  assert.equal(result.sandbox_boundary_verified,true);
  assert.equal(result.direct_promotion_enabled,false);
  assert.equal(result.authority_effect,false);
});

test('candidate-mutated evaluator harness blocks archive admission even with complete other evidence',()=>{
  const x=completeEvidence({contaminated:true});
  const admission=createRsiVerifiedEvaluatorAdmission({
    evaluator_plan:x.e.plan,candidate_handoff:x.candidateHandoff,
    benchmark_policy:x.b.policy,benchmark_tasks:x.b.tasks,benchmark_assessments:x.b.assessments,benchmark_admission:x.b.admission,
    integrity_policy:x.i.policy,integrity_receipt:x.i.receipt,integrity_assessment:x.i.assessment,
    hypothesis:x.hypothesis,mutation_contract:x.mutationContract,artifact_receipt:x.a,
    sandbox_backend_binding:x.s.binding,sandbox_backend_observation:x.s.observation,sandbox_boundary_receipt:x.s.receipt,
  });
  assert.equal(admission.state,'BLOCKED');
  assert.equal(admission.archive_apply_authorized,false);
  assert.ok(admission.blockers.includes('BENCHMARK_PROVENANCE_NOT_ADMITTED'));
  assert.ok(admission.blockers.includes('CONTAMINATED_BENCHMARK_TASK'));
});

test('external integrity monitor detecting evaluator tamper blocks archive admission',()=>{
  const x=completeEvidence({tampered:true});
  const admission=createRsiVerifiedEvaluatorAdmission({
    evaluator_plan:x.e.plan,candidate_handoff:x.candidateHandoff,
    benchmark_policy:x.b.policy,benchmark_tasks:x.b.tasks,benchmark_assessments:x.b.assessments,benchmark_admission:x.b.admission,
    integrity_policy:x.i.policy,integrity_receipt:x.i.receipt,integrity_assessment:x.i.assessment,
    hypothesis:x.hypothesis,mutation_contract:x.mutationContract,artifact_receipt:x.a,
    sandbox_backend_binding:x.s.binding,sandbox_backend_observation:x.s.observation,sandbox_boundary_receipt:x.s.receipt,
  });
  assert.equal(x.i.assessment.state,'REWARD_HACKING_DETECTED');
  assert.equal(admission.state,'BLOCKED');
  assert.equal(admission.archive_apply_authorized,false);
  assert.ok(admission.blockers.includes('EVALUATION_INTEGRITY_REWARD_HACKING_DETECTED'));
});

test('artifact no-op equivalence and sandbox host leakage fail before archive admission',()=>{
  const candidateHandoff=handoff();
  const {hypothesis,mutationContract}=hypothesisAndContract();
  assert.throws(()=>artifact(candidateHandoff,hypothesis,mutationContract,{noopEquivalent:true}),/noop_ablation_invalid/);
  assert.throws(()=>sandbox(candidateHandoff,{hostLeak:true}),/boundary_violation/);
});
