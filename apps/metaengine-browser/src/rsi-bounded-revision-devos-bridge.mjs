import crypto from 'node:crypto';

import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import { RSI_MUTATION_SURFACES } from './rsi-shadow-core.mjs';
import {
  RSI_REVISION_ENVELOPE_SCHEMA,
  RSI_REVISION_PROPOSAL_SCHEMA,
  verifyRsiBoundedRevisionEnvelope,
  verifyRsiBoundedRevisionProposal,
} from './rsi-bounded-revision-proposal.mjs';
import {
  verifyRsiIsolatedCandidateBuildPlan,
  finalizeRsiIsolatedCandidateBuild,
} from './rsi-isolated-candidate-builder.mjs';
import {
  createRsiArtifactEvaluationRoutingRequest,
  verifyRsiArtifactEvaluationRoutingRequest,
} from './rsi-evaluation-budget-router.mjs';

export const RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA='metaengine.rsi.bounded-revision-devos-bridge.v1';
export const RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA='metaengine.rsi.bounded-revision-artifact-receipt.v1';
export const RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA='metaengine.rsi.materialized-candidate-evaluation-handoff.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SLSA_PREDICATE='https://slsa.dev/provenance/v1';
const CHANGE_TYPES=new Set(['CREATE','MODIFY','DELETE']);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function digest(v){return `sha256:${hash(v)}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_revision_bridge_${l}_digest_invalid`);return x;}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_revision_bridge_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_bridge_${l}_retry_invalid`);}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_revision_bridge_${l}_invalid`);return n;}
function verifyDigestObject(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_revision_bridge_${label}_invalid`);
  assertZero(row,label);
  const core=structuredClone(row);delete core[digestField];
  if(digest(core)!==exactDigest(row[digestField],label))throw new Error(`rsi_revision_bridge_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}
function normalizePath(value){
  const p=String(value||'').trim().replaceAll('\\','/');
  if(!p||p.startsWith('/')||p.includes('//')||p.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'))throw new Error('rsi_revision_bridge_mutation_path_invalid');
  return p;
}
function mutations(value,maxFiles){
  if(!Array.isArray(value)||value.length<1||value.length>maxFiles)throw new Error('rsi_revision_bridge_mutations_invalid');
  const seen=new Set();
  return Object.freeze(value.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('rsi_revision_bridge_mutation_invalid');
    const path=normalizePath(entry.path);
    if(seen.has(path))throw new Error('rsi_revision_bridge_mutation_duplicate');
    seen.add(path);
    const change=String(entry.change||'').trim().toUpperCase();
    if(!CHANGE_TYPES.has(change))throw new Error('rsi_revision_bridge_mutation_change_invalid');
    return Object.freeze({path,change});
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.change.localeCompare(b.change)));
}
function branchSlug(value){
  return String(value||'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,120)||'revision';
}

export function createRsiBoundedRevisionDevosBridge({
  envelope,
  proposal,
  experiment_intent,
  experiment_receipt,
  mutation_surface,
  approved_mutations,
  approved_mutation_manifest_digest,
  implementation_reviewer_root_digest,
  builder_identity_digest,
  worker_image_digest,
  toolchain_image_digest,
  dependency_material_manifest_digest,
  harness_manifest_digest,
  capability_manifest_digest,
  build_provenance_policy_digest,
  artifact_signature_policy_digest,
  transparency_log_policy_digest,
  external_implementation_reviewer=false,
}={}){
  if(external_implementation_reviewer!==true)throw new Error('rsi_revision_bridge_external_reviewer_required');
  if(!envelope||envelope.schema!==RSI_REVISION_ENVELOPE_SCHEMA)throw new Error('rsi_revision_bridge_envelope_invalid');
  if(!proposal||proposal.schema!==RSI_REVISION_PROPOSAL_SCHEMA)throw new Error('rsi_revision_bridge_proposal_invalid');
  const checkedEnvelope=verifyRsiBoundedRevisionEnvelope(envelope,{intent:experiment_intent,receipt:experiment_receipt});
  const checkedProposal=verifyRsiBoundedRevisionProposal(proposal,{envelope:checkedEnvelope});
  const surface=String(mutation_surface||'').trim().toUpperCase();
  if(!RSI_MUTATION_SURFACES.includes(surface))throw new Error('rsi_revision_bridge_mutation_surface_invalid');
  const approved=mutations(approved_mutations,checkedEnvelope.max_mutated_files);
  const manifestDigest=digest(approved);
  if(manifestDigest!==exactDigest(approved_mutation_manifest_digest,'approved_mutation_manifest'))throw new Error('rsi_revision_bridge_mutation_manifest_digest_mismatch');
  const reviewerRoot=exactDigest(implementation_reviewer_root_digest,'reviewer_root');
  const provenanceValues=[
    exactDigest(builder_identity_digest,'builder_identity'),
    exactDigest(worker_image_digest,'worker_image'),
    exactDigest(toolchain_image_digest,'toolchain_image'),
    exactDigest(dependency_material_manifest_digest,'dependency_material_manifest'),
    exactDigest(harness_manifest_digest,'harness_manifest'),
    exactDigest(capability_manifest_digest,'capability_manifest'),
    exactDigest(build_provenance_policy_digest,'build_provenance_policy'),
    exactDigest(artifact_signature_policy_digest,'artifact_signature_policy'),
    exactDigest(transparency_log_policy_digest,'transparency_log_policy'),
  ];
  if(new Set(provenanceValues).size!==provenanceValues.length)throw new Error('rsi_revision_bridge_independent_provenance_roots_required');
  const provenanceContract=Object.freeze({
    builder_identity_digest:provenanceValues[0],
    worker_image_digest:provenanceValues[1],
    toolchain_image_digest:provenanceValues[2],
    dependency_material_manifest_digest:provenanceValues[3],
    harness_manifest_digest:provenanceValues[4],
    capability_manifest_digest:provenanceValues[5],
    build_provenance_policy_digest:provenanceValues[6],
    artifact_signature_policy_digest:provenanceValues[7],
    transparency_log_policy_digest:provenanceValues[8],
    immutable_materials_required:true,
    network_deny_required:true,
    private_writable_layer_required:true,
    materials_complete_required:true,
    artifact_reconstruction_required:true,
    protected_root_diff_audit_required:true,
    preserved_behavior_review_required:true,
    external_build_attestation_required:true,
    artifact_signature_required:true,
    transparency_log_inclusion_required:true,
    candidate_can_choose_builder:false,
    candidate_can_choose_worker:false,
    candidate_can_choose_toolchain:false,
    candidate_can_choose_dependencies:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_capabilities:false,
    candidate_can_sign_artifact:false,
    candidate_can_choose_transparency_log:false,
    provenance_is_activation_authority:false,
  });
  const seed={
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    mutation_surface:surface,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    implementation_provenance_contract_digest:digest(provenanceContract),
  };
  const seedHash=hash(seed);
  const experimentId=`rsi_exp_${seedHash.slice(0,24)}`;
  const targetBranch=`work/rsi/revision-${checkedEnvelope.source_sha.slice(0,8)}-${seedHash.slice(0,8)}`;
  const limits=Object.freeze({
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    max_mutated_files:checkedEnvelope.max_mutated_files,
    max_edit_operations:checkedEnvelope.max_edit_operations,
    max_changed_bytes:checkedEnvelope.max_changed_bytes,
    protected_policy_roots_digest:digest(checkedEnvelope.protected_policy_roots),
    editable_scope_digest:checkedEnvelope.editable_scope_digest,
    preserved_behavior_digest:checkedEnvelope.preserved_behavior_digest,
    negative_evidence_root_digest:checkedEnvelope.negative_evidence_root_digest,
    regression_budget_digest:checkedEnvelope.regression_budget_digest,
    validation_plan_digest:checkedEnvelope.validation_plan_digest,
    implementation_provenance_contract_digest:digest(provenanceContract),
  });
  const constraints=Object.freeze([
    `exact_base_sha=${checkedEnvelope.source_sha}`,
    `revision_envelope_digest=${checkedEnvelope.envelope_digest}`,
    `revision_proposal_digest=${checkedProposal.proposal_digest}`,
    `approved_mutation_manifest_digest=${manifestDigest}`,
    `max_mutated_files=${limits.max_mutated_files}`,
    `max_edit_operations=${limits.max_edit_operations}`,
    `max_changed_bytes=${limits.max_changed_bytes}`,
    'existing_devos_scheduler_only',
    'existing_isolated_candidate_builder_only',
    'branch_local_only',
    'private_writable_layer_required',
    'no_host_repository_mount',
    'network_deny_by_default',
    'locked_dependency_materials_required',
    'external_build_attestation_required',
    'artifact_signature_required',
    'transparency_log_inclusion_required',
    'artifact_reconstruction_required',
    'protected_root_diff_audit_required',
    'preserved_behavior_review_required',
    'protected_policy_roots_immutable',
    'no_main_or_production_promotion',
    'no_direct_self_update',
    'no_live_process_self_modification',
    'no_second_scheduler',
    'no_blind_retry_after_ambiguous_effect',
    'external_materialization_receipt_required',
    'paired_validation_after_materialization_required',
  ]);
  const taskSpec=Object.freeze({
    schema:RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    objective:`Materialize bounded RSI revision proposal ${checkedProposal.proposal_id} in the existing isolated candidate pipeline without changing protected policy roots.`,
    constraints,
    deliverable:'Produce one exact candidate SHA and materialization receipt in the existing isolated DevOS workspace plane. Do not promote, install, activate, self-update, or bypass paired validation.',
    source_branch:'',
    target_branch:targetBranch,
    rsi:Object.freeze({
      experiment_id:experimentId,
      signal:'BOUNDED_REVISION_MATERIALIZATION',
      mutation_surface:surface,
      source_sha:checkedEnvelope.source_sha,
      shadow_only:true,
      revision_envelope_digest:checkedEnvelope.envelope_digest,
      revision_proposal_digest:checkedProposal.proposal_digest,
      revision_limits:limits,
      implementation_provenance_contract:provenanceContract,
    }),
  });
  const plan={
    schema:RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    experiment_id:experimentId,
    source_sha:checkedEnvelope.source_sha,
    target_branch:targetBranch,
    hypothesis_id:null,
    hypothesis_digest:null,
    task_spec:taskSpec,
    requires_existing_devos_scheduler:true,
    lease_created:false,
    agent_assigned:false,
    workspace_bound:false,
    command_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  plan.plan_digest=hash(plan);
  const core={
    schema:RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA,
    version:1,
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    approved_mutations:approved,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    implementation_provenance_contract:provenanceContract,
    mutation_surface:surface,
    revision_limits:limits,
    devos_experiment_plan:Object.freeze(plan),
    provenance_predicate_type:SLSA_PREDICATE,
    external_implementation_reviewer:true,
    authored_by_optimizer:false,
    uses_existing_devos_scheduler:true,
    uses_existing_isolated_candidate_builder:true,
    bridge_can_create_workspace:false,
    bridge_can_materialize_candidate:false,
    bridge_can_execute_commands:false,
    bridge_can_promote:false,
    candidate_can_self_attest:false,
    second_builder_created:false,
    second_scheduler_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,bridge_digest:digest(core)});
}

export function verifyRsiBoundedRevisionDevosBridge(bridge,{envelope,proposal,experiment_intent,experiment_receipt}={}){
  if(!bridge||bridge.schema!==RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA||bridge.version!==1)throw new Error('rsi_revision_bridge_invalid');
  assertZero(bridge,'bridge');
  if(bridge.external_implementation_reviewer!==true||bridge.authored_by_optimizer!==false
    ||bridge.uses_existing_devos_scheduler!==true||bridge.uses_existing_isolated_candidate_builder!==true
    ||bridge.bridge_can_create_workspace!==false||bridge.bridge_can_materialize_candidate!==false
    ||bridge.bridge_can_execute_commands!==false||bridge.bridge_can_promote!==false
    ||bridge.candidate_can_self_attest!==false||bridge.second_builder_created!==false||bridge.second_scheduler_created!==false
    ||bridge.provenance_predicate_type!==SLSA_PREDICATE)throw new Error('rsi_revision_bridge_policy_invalid');
  const canonical=createRsiBoundedRevisionDevosBridge({
    envelope,proposal,experiment_intent,experiment_receipt,
    mutation_surface:bridge.mutation_surface,
    approved_mutations:bridge.approved_mutations,
    approved_mutation_manifest_digest:bridge.approved_mutation_manifest_digest,
    implementation_reviewer_root_digest:bridge.implementation_reviewer_root_digest,
    builder_identity_digest:bridge.implementation_provenance_contract?.builder_identity_digest,
    worker_image_digest:bridge.implementation_provenance_contract?.worker_image_digest,
    toolchain_image_digest:bridge.implementation_provenance_contract?.toolchain_image_digest,
    dependency_material_manifest_digest:bridge.implementation_provenance_contract?.dependency_material_manifest_digest,
    harness_manifest_digest:bridge.implementation_provenance_contract?.harness_manifest_digest,
    capability_manifest_digest:bridge.implementation_provenance_contract?.capability_manifest_digest,
    build_provenance_policy_digest:bridge.implementation_provenance_contract?.build_provenance_policy_digest,
    artifact_signature_policy_digest:bridge.implementation_provenance_contract?.artifact_signature_policy_digest,
    transparency_log_policy_digest:bridge.implementation_provenance_contract?.transparency_log_policy_digest,
    external_implementation_reviewer:true,
  });
  if(canonical.bridge_digest!==exactDigest(bridge.bridge_digest,'bridge'))throw new Error('rsi_revision_bridge_digest_mismatch');
  return canonical;
}


export function createRsiBoundedRevisionArtifactReceipt({
  receipt_id,
  bridge,
  envelope,
  proposal,
  experiment_intent,
  experiment_receipt,
  build_plan,
  materialization_receipt,
  artifact_digest,
  provenance_attestation_digest,
  signature_bundle_digest,
  transparency_log_entry_digest,
  reproducibility_evidence_digest,
  external_attestor=false,
  authored_by_candidate=true,
}={}){
  if(external_attestor!==true||authored_by_candidate!==false)throw new Error('rsi_revision_bridge_external_attestor_required');
  const checkedBridge=verifyRsiBoundedRevisionDevosBridge(bridge,{envelope,proposal,experiment_intent,experiment_receipt});
  verifyRsiIsolatedCandidateBuildPlan(build_plan);
  if(build_plan.experiment_id!==checkedBridge.devos_experiment_plan.experiment_id
    ||build_plan.source?.parent_sha!==checkedBridge.source_sha
    ||build_plan.target_branch!==checkedBridge.devos_experiment_plan.target_branch)throw new Error('rsi_revision_bridge_build_plan_binding_mismatch');
  const buildManifestDigest=digest(build_plan.mutation_manifest);
  if(buildManifestDigest!==checkedBridge.approved_mutation_manifest_digest)throw new Error('rsi_revision_bridge_build_mutation_manifest_mismatch');
  const limits=build_plan.materialization_contract?.revision_limits;
  const provenanceContract=build_plan.materialization_contract?.implementation_provenance_contract;
  if(!limits||!provenanceContract
    ||limits.envelope_digest!==checkedBridge.envelope_digest
    ||limits.proposal_digest!==checkedBridge.proposal_digest
    ||limits.approved_mutation_manifest_digest!==checkedBridge.approved_mutation_manifest_digest
    ||limits.implementation_reviewer_root_digest!==checkedBridge.implementation_reviewer_root_digest
    ||limits.implementation_provenance_contract_digest!==checkedBridge.revision_limits.implementation_provenance_contract_digest
    ||digest(provenanceContract)!==checkedBridge.revision_limits.implementation_provenance_contract_digest)throw new Error('rsi_revision_bridge_build_revision_limits_mismatch');

  const handoff=finalizeRsiIsolatedCandidateBuild({build_plan,materialization_receipt});
  if(handoff.eligible_for_evaluation!==true||handoff.eligible_for_promotion!==false||handoff.authority_effect!==false)throw new Error('rsi_revision_bridge_candidate_handoff_policy_invalid');

  const workspaceId=String(materialization_receipt?.workspace?.workspace_id||'').toLowerCase();
  const bindings=materialization_receipt?.workspace?.binding_snapshot?.bindings;
  const matches=Array.isArray(bindings)?bindings.filter(x=>String(x?.workspace_id||'').toLowerCase()===workspaceId):[];
  if(matches.length!==1)throw new Error('rsi_revision_bridge_workspace_binding_missing');
  const binding=matches[0];
  const materializedOps=positiveInt(materialization_receipt.materialized_edit_operations,'materialized_edit_operations');
  if(materializedOps>checkedBridge.revision_limits.max_edit_operations)throw new Error('rsi_revision_bridge_edit_operation_budget_exceeded');

  const implementationProvenance=materialization_receipt?.implementation_provenance;
  if(!implementationProvenance||typeof implementationProvenance!=='object'||Array.isArray(implementationProvenance))throw new Error('rsi_revision_bridge_materialization_provenance_required');
  for(const field of [
    'builder_identity_digest','worker_image_digest','toolchain_image_digest','dependency_material_manifest_digest',
    'harness_manifest_digest','capability_manifest_digest'
  ]){
    if(exactDigest(implementationProvenance[field],field)!==checkedBridge.implementation_provenance_contract[field])throw new Error('rsi_revision_bridge_materialization_provenance_identity_mismatch');
  }

  const evidenceRoots=[
    exactDigest(artifact_digest,'artifact'),
    exactDigest(provenance_attestation_digest,'provenance_attestation'),
    exactDigest(signature_bundle_digest,'signature_bundle'),
    exactDigest(transparency_log_entry_digest,'transparency_log_entry'),
    exactDigest(reproducibility_evidence_digest,'reproducibility_evidence'),
    exactDigest(implementationProvenance.build_provenance_digest,'build_provenance'),
    exactDigest(implementationProvenance.artifact_signature_digest,'artifact_signature'),
    exactDigest(implementationProvenance.transparency_log_inclusion_digest,'transparency_log_inclusion'),
    exactDigest(implementationProvenance.artifact_reconstruction_digest,'artifact_reconstruction'),
    exactDigest(implementationProvenance.protected_root_diff_audit_digest,'protected_root_diff_audit'),
    exactDigest(implementationProvenance.preserved_behavior_review_digest,'preserved_behavior_review'),
  ];
  if(new Set(evidenceRoots).size!==evidenceRoots.length)throw new Error('rsi_revision_bridge_independent_artifact_evidence_required');

  const core={
    schema:RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA,
    version:1,
    receipt_id:String(receipt_id||'').trim(),
    source_sha:checkedBridge.source_sha,
    candidate_sha:handoff.candidate_sha,
    target_branch:handoff.target_branch,
    envelope_digest:checkedBridge.envelope_digest,
    proposal_digest:checkedBridge.proposal_digest,
    bridge_digest:checkedBridge.bridge_digest,
    build_plan_digest:build_plan.plan_digest,
    candidate_handoff_digest:handoff.handoff_digest,
    approved_mutation_manifest_digest:checkedBridge.approved_mutation_manifest_digest,
    implementation_provenance_contract_digest:checkedBridge.revision_limits.implementation_provenance_contract_digest,
    workspace_id:workspaceId,
    workspace_generation:positiveInt(binding.workspace_generation,'workspace_generation'),
    lease_generation:positiveInt(binding.lease_generation,'lease_generation'),
    materialized_file_count:Number(materialization_receipt.materialized_file_count),
    materialized_edit_operations:materializedOps,
    materialized_bytes:Number(materialization_receipt.materialized_bytes),
    output_manifest_digest:exactDigest(materialization_receipt.output_manifest_digest,'output_manifest'),
    provenance_predicate_type:SLSA_PREDICATE,
    builder_identity_digest:checkedBridge.implementation_provenance_contract.builder_identity_digest,
    worker_image_digest:checkedBridge.implementation_provenance_contract.worker_image_digest,
    toolchain_image_digest:checkedBridge.implementation_provenance_contract.toolchain_image_digest,
    dependency_material_manifest_digest:checkedBridge.implementation_provenance_contract.dependency_material_manifest_digest,
    harness_manifest_digest:checkedBridge.implementation_provenance_contract.harness_manifest_digest,
    capability_manifest_digest:checkedBridge.implementation_provenance_contract.capability_manifest_digest,
    build_provenance_policy_digest:checkedBridge.implementation_provenance_contract.build_provenance_policy_digest,
    artifact_signature_policy_digest:checkedBridge.implementation_provenance_contract.artifact_signature_policy_digest,
    transparency_log_policy_digest:checkedBridge.implementation_provenance_contract.transparency_log_policy_digest,
    artifact_digest:evidenceRoots[0],
    provenance_attestation_digest:evidenceRoots[1],
    signature_bundle_digest:evidenceRoots[2],
    transparency_log_entry_digest:evidenceRoots[3],
    reproducibility_evidence_digest:evidenceRoots[4],
    build_provenance_digest:evidenceRoots[5],
    artifact_signature_digest:evidenceRoots[6],
    transparency_log_inclusion_digest:evidenceRoots[7],
    artifact_reconstruction_digest:evidenceRoots[8],
    protected_root_diff_audit_digest:evidenceRoots[9],
    preserved_behavior_review_digest:evidenceRoots[10],
    hermetic_build:true,
    network_denied:true,
    materials_complete:true,
    artifact_reconstruction_pass:true,
    protected_root_diff_audit_pass:true,
    preserved_behavior_review_pass:true,
    external_build_attestation_verified:true,
    artifact_signature_verified:true,
    transparency_log_inclusion_verified:true,
    exact_source_bound:true,
    exact_workspace_lease_bound:true,
    exact_builder_materials_bound:true,
    signature_identity_bound:true,
    candidate_self_attestation_accepted:false,
    candidate_artifact_is_active:false,
    candidate_artifact_replaces_parent:false,
    eligible_for_fresh_paired_evaluation:true,
    eligible_for_promotion:false,
    external_attestor:true,
    authored_by_candidate:false,
    second_builder_created:false,
    second_scheduler_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  if(!core.receipt_id)throw new Error('rsi_revision_bridge_receipt_id_required');
  for(const field of [
    'materials_complete','artifact_reconstruction_pass','protected_root_diff_audit_pass','preserved_behavior_review_pass',
    'external_build_attestation_verified','artifact_signature_verified','transparency_log_inclusion_verified'
  ]) if(implementationProvenance[field]!==true)throw new Error('rsi_revision_bridge_materialization_provenance_evidence_invalid');
  return Object.freeze({...core,artifact_receipt_digest:digest(core)});
}

export function verifyRsiBoundedRevisionArtifactReceipt(row,args={}){
  const receipt=verifyDigestObject(row,RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA,'artifact_receipt_digest','artifact_receipt');
  if(receipt.provenance_predicate_type!==SLSA_PREDICATE
    ||receipt.hermetic_build!==true||receipt.network_denied!==true||receipt.materials_complete!==true
    ||receipt.artifact_reconstruction_pass!==true||receipt.protected_root_diff_audit_pass!==true||receipt.preserved_behavior_review_pass!==true
    ||receipt.external_build_attestation_verified!==true||receipt.artifact_signature_verified!==true||receipt.transparency_log_inclusion_verified!==true
    ||receipt.exact_source_bound!==true||receipt.exact_workspace_lease_bound!==true||receipt.exact_builder_materials_bound!==true
    ||receipt.signature_identity_bound!==true||receipt.candidate_self_attestation_accepted!==false
    ||receipt.candidate_artifact_is_active!==false||receipt.candidate_artifact_replaces_parent!==false
    ||receipt.eligible_for_fresh_paired_evaluation!==true||receipt.eligible_for_promotion!==false
    ||receipt.external_attestor!==true||receipt.authored_by_candidate!==false
    ||receipt.second_builder_created!==false||receipt.second_scheduler_created!==false)throw new Error('rsi_revision_bridge_artifact_receipt_policy_invalid');
  const canonical=createRsiBoundedRevisionArtifactReceipt({
    ...args,
    receipt_id:receipt.receipt_id,
    artifact_digest:receipt.artifact_digest,
    provenance_attestation_digest:receipt.provenance_attestation_digest,
    signature_bundle_digest:receipt.signature_bundle_digest,
    transparency_log_entry_digest:receipt.transparency_log_entry_digest,
    reproducibility_evidence_digest:receipt.reproducibility_evidence_digest,
    external_attestor:true,
    authored_by_candidate:false,
  });
  if(canonical.artifact_receipt_digest!==receipt.artifact_receipt_digest)throw new Error('rsi_revision_bridge_artifact_receipt_mismatch');
  return canonical;
}


export function createRsiMaterializedCandidateEvaluationHandoff({
  artifact_receipt,
  artifact_verification,
  evaluator_root_digest,
  evaluator_generation_digest,
  evaluation_epoch_digest,
  sealed_task_set_digest,
  harness_digest,
  trial_worker_image_digest,
  resource_budget_digest,
  task_order_digest,
  threshold_policy_digest,
  stopping_policy_digest,
  hidden_holdout_root_digest,
  safety_suite_root_digest,
  security_suite_root_digest,
  external_measurement_digest,
  proxy_score_digest,
  uncertainty,
  decision_closeness,
  proxy_reliability_gap,
  evaluator_cost_units,
  expected_information_gain,
  external_evaluation_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_evaluation_owner!==true||authored_by_candidate!==false)throw new Error('rsi_revision_bridge_external_evaluation_owner_required');
  const verification=artifact_verification||{};
  const receipt=verifyRsiBoundedRevisionArtifactReceipt(artifact_receipt,verification);
  const envelope=verification.envelope;
  const priorExperimentIntent=verification.experiment_intent;
  if(!envelope||envelope.envelope_digest!==receipt.envelope_digest)throw new Error('rsi_revision_bridge_phase29_envelope_binding_required');
  if(!priorExperimentIntent?.plan_digest)throw new Error('rsi_revision_bridge_phase29_prior_budget_binding_required');
  if(receipt.eligible_for_fresh_paired_evaluation!==true||receipt.eligible_for_promotion!==false
    ||receipt.candidate_artifact_is_active!==false||receipt.candidate_artifact_replaces_parent!==false){
    throw new Error('rsi_revision_bridge_phase29_artifact_not_evaluation_eligible');
  }
  const provenanceRoot=digest({
    artifact_receipt_digest:receipt.artifact_receipt_digest,
    provenance_attestation_digest:receipt.provenance_attestation_digest,
    signature_bundle_digest:receipt.signature_bundle_digest,
    transparency_log_entry_digest:receipt.transparency_log_entry_digest,
    reproducibility_evidence_digest:receipt.reproducibility_evidence_digest,
    build_provenance_digest:receipt.build_provenance_digest,
    artifact_signature_digest:receipt.artifact_signature_digest,
    transparency_log_inclusion_digest:receipt.transparency_log_inclusion_digest,
    artifact_reconstruction_digest:receipt.artifact_reconstruction_digest,
    protected_root_diff_audit_digest:receipt.protected_root_diff_audit_digest,
    preserved_behavior_review_digest:receipt.preserved_behavior_review_digest,
    builder_identity_digest:receipt.builder_identity_digest,
    worker_image_digest:receipt.worker_image_digest,
    toolchain_image_digest:receipt.toolchain_image_digest,
    dependency_material_manifest_digest:receipt.dependency_material_manifest_digest,
    harness_manifest_digest:receipt.harness_manifest_digest,
    capability_manifest_digest:receipt.capability_manifest_digest,
    workspace_id:receipt.workspace_id,
    workspace_generation:receipt.workspace_generation,
    lease_generation:receipt.lease_generation,
  });
  const seed={
    artifact_receipt_digest:receipt.artifact_receipt_digest,
    evaluator_root_digest:exactDigest(evaluator_root_digest,'phase29_evaluator_root'),
    evaluator_generation_digest:exactDigest(evaluator_generation_digest,'phase29_evaluator_generation'),
    evaluation_epoch_digest:exactDigest(evaluation_epoch_digest,'phase29_evaluation_epoch'),
    sealed_task_set_digest:exactDigest(sealed_task_set_digest,'phase29_sealed_task_set'),
    harness_digest:exactDigest(harness_digest,'phase29_harness'),
    trial_worker_image_digest:exactDigest(trial_worker_image_digest,'phase29_trial_worker'),
    resource_budget_digest:exactDigest(resource_budget_digest,'phase29_resource_budget'),
    task_order_digest:exactDigest(task_order_digest,'phase29_task_order'),
    threshold_policy_digest:exactDigest(threshold_policy_digest,'phase29_threshold_policy'),
    stopping_policy_digest:exactDigest(stopping_policy_digest,'phase29_stopping_policy'),
    prior_budget_plan_digest:exactDigest(priorExperimentIntent.plan_digest,'phase29_prior_budget_plan'),
    hidden_holdout_root_digest:exactDigest(hidden_holdout_root_digest,'phase29_hidden_holdout'),
    safety_suite_root_digest:exactDigest(safety_suite_root_digest,'phase29_safety_suite'),
    security_suite_root_digest:exactDigest(security_suite_root_digest,'phase29_security_suite'),
    provenance_root_digest:provenanceRoot,
  };
  const seedRoots=Object.values(seed);
  if(new Set(seedRoots).size!==seedRoots.length)throw new Error('rsi_revision_bridge_phase29_independent_acceptance_roots_required');
  if(seed.trial_worker_image_digest===receipt.worker_image_digest)throw new Error('rsi_revision_bridge_phase29_build_and_evaluation_worker_must_differ');
  const requestId=`phase29.eval.${hash(seed).slice(0,24)}`;
  const request=createRsiArtifactEvaluationRoutingRequest({
    request_id:requestId,
    source_sha:receipt.source_sha,
    phase28_artifact_receipt_digest:receipt.artifact_receipt_digest,
    parent_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_artifact_digest:receipt.artifact_digest,
    provenance_root_digest:provenanceRoot,
    evaluator_root_digest:seed.evaluator_root_digest,
    evaluator_generation_digest:seed.evaluator_generation_digest,
    evaluation_epoch_digest:seed.evaluation_epoch_digest,
    sealed_task_set_digest:seed.sealed_task_set_digest,
    harness_digest:seed.harness_digest,
    trial_worker_image_digest:seed.trial_worker_image_digest,
    resource_budget_digest:seed.resource_budget_digest,
    task_order_digest:seed.task_order_digest,
    threshold_policy_digest:seed.threshold_policy_digest,
    stopping_policy_digest:seed.stopping_policy_digest,
    prior_budget_plan_digest:seed.prior_budget_plan_digest,
    hidden_holdout_root_digest:seed.hidden_holdout_root_digest,
    safety_suite_root_digest:seed.safety_suite_root_digest,
    security_suite_root_digest:seed.security_suite_root_digest,
    external_measurement_digest,
    proxy_score_digest,
    uncertainty,
    decision_closeness,
    proxy_reliability_gap,
    evaluator_cost_units,
    expected_information_gain,
    scope_tags:['HIDDEN_HOLDOUT','MATERIALIZED_CANDIDATE','SAFETY','SECURITY'],
    recipient_group_tags:['RSI_CANDIDATE_VALIDATION'],
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiArtifactEvaluationRoutingRequest(request);
  const core={
    schema:RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA,
    version:1,
    source_sha:receipt.source_sha,
    phase28_artifact_receipt_digest:receipt.artifact_receipt_digest,
    phase27_envelope_digest:receipt.envelope_digest,
    phase27_proposal_digest:receipt.proposal_digest,
    parent_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_artifact_digest:receipt.artifact_digest,
    provenance_root_digest:provenanceRoot,
    evaluator_root_digest:request.evaluator_root_digest,
    evaluator_generation_digest:request.evaluator_generation_digest,
    evaluation_epoch_digest:request.evaluation_epoch_digest,
    sealed_task_set_digest:request.sealed_task_set_digest,
    harness_digest:request.harness_digest,
    trial_worker_image_digest:request.trial_worker_image_digest,
    resource_budget_digest:request.resource_budget_digest,
    task_order_digest:request.task_order_digest,
    threshold_policy_digest:request.threshold_policy_digest,
    stopping_policy_digest:request.stopping_policy_digest,
    prior_budget_plan_digest:request.prior_budget_plan_digest,
    hidden_holdout_root_digest:request.hidden_holdout_root_digest,
    safety_suite_root_digest:request.safety_suite_root_digest,
    security_suite_root_digest:request.security_suite_root_digest,
    fresh_evaluation_request:request,
    state:'READY_FOR_FRESH_EVALUATION_BUDGET_ROUTING',
    fresh_budget_epoch_required:true,
    previous_budget_plan_reuse_allowed:false,
    evaluator_generation_frozen:true,
    acceptance_assets_frozen:true,
    build_and_evaluation_workers_distinct:true,
    anchor_provenance_survives_evaluator_rotation:true,
    evaluator_dependent_verdict_reuse_allowed:false,
    existing_evaluation_budget_router_only:true,
    existing_candidate_experiment_ledger_only:true,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_evaluator_generation:false,
    candidate_can_choose_sealed_tasks:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_trial_worker:false,
    candidate_can_choose_resource_budget:false,
    candidate_can_choose_task_order:false,
    candidate_can_choose_thresholds:false,
    candidate_can_choose_stopping:false,
    candidate_can_choose_hidden_holdout:false,
    candidate_can_choose_safety_suite:false,
    candidate_can_choose_security_suite:false,
    candidate_can_choose_budget:false,
    handoff_can_schedule_evaluation:false,
    handoff_can_execute_evaluation:false,
    handoff_can_promote:false,
    external_evaluation_owner:true,
    authored_by_candidate:false,
    second_evaluation_router_created:false,
    second_experiment_ledger_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,evaluation_handoff_digest:digest(core)});
}

export function verifyRsiMaterializedCandidateEvaluationHandoff(row,args={}){
  const handoff=verifyDigestObject(
    row,
    RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA,
    'evaluation_handoff_digest',
    'phase29_evaluation_handoff',
  );
  if(handoff.state!=='READY_FOR_FRESH_EVALUATION_BUDGET_ROUTING'
    ||handoff.fresh_budget_epoch_required!==true
    ||handoff.previous_budget_plan_reuse_allowed!==false
    ||handoff.evaluator_generation_frozen!==true
    ||handoff.acceptance_assets_frozen!==true
    ||handoff.build_and_evaluation_workers_distinct!==true
    ||handoff.anchor_provenance_survives_evaluator_rotation!==true
    ||handoff.evaluator_dependent_verdict_reuse_allowed!==false
    ||handoff.existing_evaluation_budget_router_only!==true
    ||handoff.existing_candidate_experiment_ledger_only!==true
    ||handoff.candidate_can_choose_evaluator!==false
    ||handoff.candidate_can_choose_evaluator_generation!==false
    ||handoff.candidate_can_choose_sealed_tasks!==false
    ||handoff.candidate_can_choose_harness!==false
    ||handoff.candidate_can_choose_trial_worker!==false
    ||handoff.candidate_can_choose_resource_budget!==false
    ||handoff.candidate_can_choose_task_order!==false
    ||handoff.candidate_can_choose_thresholds!==false
    ||handoff.candidate_can_choose_stopping!==false
    ||handoff.candidate_can_choose_hidden_holdout!==false
    ||handoff.candidate_can_choose_safety_suite!==false
    ||handoff.candidate_can_choose_security_suite!==false
    ||handoff.candidate_can_choose_budget!==false
    ||handoff.handoff_can_schedule_evaluation!==false
    ||handoff.handoff_can_execute_evaluation!==false
    ||handoff.handoff_can_promote!==false
    ||handoff.external_evaluation_owner!==true
    ||handoff.authored_by_candidate!==false
    ||handoff.second_evaluation_router_created!==false
    ||handoff.second_experiment_ledger_created!==false)throw new Error('rsi_revision_bridge_phase29_handoff_policy_invalid');
  const canonical=createRsiMaterializedCandidateEvaluationHandoff({
    ...args,
    evaluator_root_digest:handoff.evaluator_root_digest,
    evaluator_generation_digest:handoff.evaluator_generation_digest,
    evaluation_epoch_digest:handoff.evaluation_epoch_digest,
    sealed_task_set_digest:handoff.sealed_task_set_digest,
    harness_digest:handoff.harness_digest,
    trial_worker_image_digest:handoff.trial_worker_image_digest,
    resource_budget_digest:handoff.resource_budget_digest,
    task_order_digest:handoff.task_order_digest,
    threshold_policy_digest:handoff.threshold_policy_digest,
    stopping_policy_digest:handoff.stopping_policy_digest,
    hidden_holdout_root_digest:handoff.hidden_holdout_root_digest,
    safety_suite_root_digest:handoff.safety_suite_root_digest,
    security_suite_root_digest:handoff.security_suite_root_digest,
    external_measurement_digest:handoff.fresh_evaluation_request.external_measurement_digest,
    proxy_score_digest:handoff.fresh_evaluation_request.proxy_score_digest,
    uncertainty:handoff.fresh_evaluation_request.uncertainty,
    decision_closeness:handoff.fresh_evaluation_request.decision_closeness,
    proxy_reliability_gap:handoff.fresh_evaluation_request.proxy_reliability_gap,
    evaluator_cost_units:handoff.fresh_evaluation_request.evaluator_cost_units,
    expected_information_gain:handoff.fresh_evaluation_request.expected_information_gain,
    external_evaluation_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.evaluation_handoff_digest!==handoff.evaluation_handoff_digest)throw new Error('rsi_revision_bridge_phase29_handoff_mismatch');
  return canonical;
}
