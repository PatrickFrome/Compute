import crypto from 'node:crypto';

import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from './rsi-isolated-candidate-builder.mjs';
import { RSI_MUTATION_SURFACES } from './rsi-shadow-core.mjs';
import {
  RSI_REVISION_ENVELOPE_SCHEMA,
  RSI_REVISION_PROPOSAL_SCHEMA,
  verifyRsiBoundedRevisionEnvelope,
  verifyRsiBoundedRevisionProposal,
} from './rsi-bounded-revision-proposal.mjs';

export const RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA='metaengine.rsi.bounded-revision-devos-bridge.v1';
export const RSI_ISOLATED_IMPLEMENTATION_MANIFEST_SCHEMA='metaengine.rsi.isolated-implementation-manifest.v1';
export const RSI_IMPLEMENTATION_ARTIFACT_RECEIPT_SCHEMA='metaengine.rsi.implementation-artifact-receipt.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CHANGE_TYPES=new Set(['CREATE','MODIFY','DELETE']);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function digest(v){return `sha256:${hash(v)}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_revision_bridge_${l}_digest_invalid`);return x;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_revision_bridge_${l}_sha_invalid`);return x;}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_revision_bridge_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_bridge_${l}_retry_invalid`);}
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

function implementationManifest({
  source_sha,
  envelope_digest,
  proposal_digest,
  approved_mutation_manifest_digest,
  implementation_reviewer_root_digest,
  harness_manifest_digest,
  harness_signature_bundle_digest,
  manifest_signer_root_digest,
  toolchain_digest,
  dependency_lock_digest,
  dependency_closure_digest,
  capability_profile_digest,
  network_policy_digest,
  build_recipe_digest,
  expected_builder_identity_digest,
  external_manifest_verifier=false,
  harness_signature_verified=false,
}={}){
  if(external_manifest_verifier!==true||harness_signature_verified!==true)throw new Error('rsi_revision_bridge_external_manifest_verification_required');
  const roots=[
    exactDigest(harness_manifest_digest,'harness_manifest'),
    exactDigest(harness_signature_bundle_digest,'harness_signature_bundle'),
    exactDigest(manifest_signer_root_digest,'manifest_signer_root'),
    exactDigest(toolchain_digest,'toolchain'),
    exactDigest(dependency_lock_digest,'dependency_lock'),
    exactDigest(dependency_closure_digest,'dependency_closure'),
    exactDigest(capability_profile_digest,'capability_profile'),
    exactDigest(network_policy_digest,'network_policy'),
    exactDigest(build_recipe_digest,'build_recipe'),
    exactDigest(expected_builder_identity_digest,'expected_builder_identity'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_revision_bridge_provenance_root_alias');
  const core={
    schema:RSI_ISOLATED_IMPLEMENTATION_MANIFEST_SCHEMA,
    version:1,
    source_sha:exactSha(source_sha,'manifest_source'),
    envelope_digest:exactDigest(envelope_digest,'manifest_envelope'),
    proposal_digest:exactDigest(proposal_digest,'manifest_proposal'),
    approved_mutation_manifest_digest:exactDigest(approved_mutation_manifest_digest,'manifest_mutations'),
    implementation_reviewer_root_digest:exactDigest(implementation_reviewer_root_digest,'manifest_reviewer'),
    harness_manifest_digest:roots[0],
    harness_signature_bundle_digest:roots[1],
    manifest_signer_root_digest:roots[2],
    toolchain_digest:roots[3],
    dependency_lock_digest:roots[4],
    dependency_closure_digest:roots[5],
    capability_profile_digest:roots[6],
    network_policy_digest:roots[7],
    build_recipe_digest:roots[8],
    expected_builder_identity_digest:roots[9],
    external_manifest_verifier:true,
    harness_signature_verified:true,
    dependency_closure_pinned:true,
    host_toolchain_forbidden:true,
    undeclared_dependencies_forbidden:true,
    network_deny_by_default:true,
    existing_devos_builder_required:true,
    materials_must_be_complete:true,
    provenance_receipt_required:true,
    manifest_can_execute:false,
    manifest_can_schedule:false,
    manifest_can_promote:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,manifest_digest:digest(core)});
}

export function verifyRsiIsolatedImplementationManifest(manifest){
  if(!manifest||manifest.schema!==RSI_ISOLATED_IMPLEMENTATION_MANIFEST_SCHEMA||manifest.version!==1)throw new Error('rsi_revision_bridge_manifest_invalid');
  assertZero(manifest,'manifest');
  if(manifest.external_manifest_verifier!==true||manifest.harness_signature_verified!==true
    ||manifest.dependency_closure_pinned!==true||manifest.host_toolchain_forbidden!==true
    ||manifest.undeclared_dependencies_forbidden!==true||manifest.network_deny_by_default!==true
    ||manifest.existing_devos_builder_required!==true||manifest.materials_must_be_complete!==true
    ||manifest.provenance_receipt_required!==true||manifest.manifest_can_execute!==false
    ||manifest.manifest_can_schedule!==false||manifest.manifest_can_promote!==false)throw new Error('rsi_revision_bridge_manifest_policy_invalid');
  const canonical=implementationManifest({
    source_sha:manifest.source_sha,
    envelope_digest:manifest.envelope_digest,
    proposal_digest:manifest.proposal_digest,
    approved_mutation_manifest_digest:manifest.approved_mutation_manifest_digest,
    implementation_reviewer_root_digest:manifest.implementation_reviewer_root_digest,
    harness_manifest_digest:manifest.harness_manifest_digest,
    harness_signature_bundle_digest:manifest.harness_signature_bundle_digest,
    manifest_signer_root_digest:manifest.manifest_signer_root_digest,
    toolchain_digest:manifest.toolchain_digest,
    dependency_lock_digest:manifest.dependency_lock_digest,
    dependency_closure_digest:manifest.dependency_closure_digest,
    capability_profile_digest:manifest.capability_profile_digest,
    network_policy_digest:manifest.network_policy_digest,
    build_recipe_digest:manifest.build_recipe_digest,
    expected_builder_identity_digest:manifest.expected_builder_identity_digest,
    external_manifest_verifier:true,
    harness_signature_verified:true,
  });
  if(canonical.manifest_digest!==exactDigest(manifest.manifest_digest,'manifest'))throw new Error('rsi_revision_bridge_manifest_digest_mismatch');
  return canonical;
}

function evidenceDigest(handoff,name){
  const rows=handoff?.candidate_capsule?.evidence;
  if(!Array.isArray(rows))throw new Error('rsi_revision_bridge_handoff_evidence_invalid');
  const hits=rows.filter(row=>row?.name===name);
  if(hits.length!==1)throw new Error('rsi_revision_bridge_handoff_evidence_missing');
  return exactDigest(hits[0].digest,'handoff_evidence');
}

function verifyCandidateHandoff(handoff,bridge){
  if(!handoff||handoff.schema!==RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA||handoff.version!==1)throw new Error('rsi_revision_bridge_handoff_invalid');
  assertZero(handoff,'handoff');
  if(handoff.experiment_id!==bridge.devos_experiment_plan.experiment_id
    ||handoff.parent_sha!==bridge.source_sha
    ||handoff.target_branch!==bridge.devos_experiment_plan.target_branch
    ||handoff.eligible_for_evaluation!==true||handoff.eligible_for_promotion!==false
    ||handoff.materialization_replay_authorized!==false)throw new Error('rsi_revision_bridge_handoff_policy_invalid');
  exactSha(handoff.parent_sha,'handoff_parent');
  exactSha(handoff.candidate_sha,'handoff_candidate');
  const clone=structuredClone(handoff);delete clone.handoff_digest;
  if(digest(clone)!==exactDigest(handoff.handoff_digest,'handoff'))throw new Error('rsi_revision_bridge_handoff_digest_mismatch');
  return Object.freeze(structuredClone(handoff));
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
  harness_manifest_digest,
  harness_signature_bundle_digest,
  manifest_signer_root_digest,
  toolchain_digest,
  dependency_lock_digest,
  dependency_closure_digest,
  capability_profile_digest,
  network_policy_digest,
  build_recipe_digest,
  expected_builder_identity_digest,
  external_manifest_verifier=false,
  harness_signature_verified=false,
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
  const manifest=implementationManifest({
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    harness_manifest_digest,
    harness_signature_bundle_digest,
    manifest_signer_root_digest,
    toolchain_digest,
    dependency_lock_digest,
    dependency_closure_digest,
    capability_profile_digest,
    network_policy_digest,
    build_recipe_digest,
    expected_builder_identity_digest,
    external_manifest_verifier,
    harness_signature_verified,
  });
  const seed={
    source_sha:checkedEnvelope.source_sha,
    envelope_digest:checkedEnvelope.envelope_digest,
    proposal_digest:checkedProposal.proposal_digest,
    mutation_surface:surface,
    approved_mutation_manifest_digest:manifestDigest,
    implementation_reviewer_root_digest:reviewerRoot,
    implementation_manifest_digest:manifest.manifest_digest,
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
    implementation_manifest_digest:manifest.manifest_digest,
    harness_manifest_digest:manifest.harness_manifest_digest,
    harness_signature_bundle_digest:manifest.harness_signature_bundle_digest,
    manifest_signer_root_digest:manifest.manifest_signer_root_digest,
    toolchain_digest:manifest.toolchain_digest,
    dependency_lock_digest:manifest.dependency_lock_digest,
    dependency_closure_digest:manifest.dependency_closure_digest,
    capability_profile_digest:manifest.capability_profile_digest,
    network_policy_digest:manifest.network_policy_digest,
    build_recipe_digest:manifest.build_recipe_digest,
    expected_builder_identity_digest:manifest.expected_builder_identity_digest,
  });
  const constraints=Object.freeze([
    `exact_base_sha=${checkedEnvelope.source_sha}`,
    `revision_envelope_digest=${checkedEnvelope.envelope_digest}`,
    `revision_proposal_digest=${checkedProposal.proposal_digest}`,
    `approved_mutation_manifest_digest=${manifestDigest}`,
    `max_mutated_files=${limits.max_mutated_files}`,
    `max_edit_operations=${limits.max_edit_operations}`,
    `max_changed_bytes=${limits.max_changed_bytes}`,
    `implementation_manifest_digest=${manifest.manifest_digest}`,
    `toolchain_digest=${manifest.toolchain_digest}`,
    `dependency_closure_digest=${manifest.dependency_closure_digest}`,
    `capability_profile_digest=${manifest.capability_profile_digest}`,
    'existing_devos_scheduler_only',
    'exact_toolchain_and_dependency_closure_required',
    'manifest_signature_verification_required',
    'complete_provenance_receipt_required',
    'undeclared_dependency_forbidden',
    'host_toolchain_forbidden',
    'existing_isolated_candidate_builder_only',
    'branch_local_only',
    'private_writable_layer_required',
    'no_host_repository_mount',
    'network_deny_by_default',
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
    mutation_surface:surface,
    revision_limits:limits,
    implementation_manifest:manifest,
    devos_experiment_plan:Object.freeze(plan),
    external_implementation_reviewer:true,
    authored_by_optimizer:false,
    uses_existing_devos_scheduler:true,
    uses_existing_isolated_candidate_builder:true,
    bridge_can_create_workspace:false,
    bridge_can_materialize_candidate:false,
    bridge_can_execute_commands:false,
    bridge_can_promote:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
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
    ||bridge.bridge_can_execute_commands!==false||bridge.bridge_can_promote!==false)throw new Error('rsi_revision_bridge_policy_invalid');
  const canonical=createRsiBoundedRevisionDevosBridge({
    envelope,proposal,experiment_intent,experiment_receipt,
    mutation_surface:bridge.mutation_surface,
    approved_mutations:bridge.approved_mutations,
    approved_mutation_manifest_digest:bridge.approved_mutation_manifest_digest,
    implementation_reviewer_root_digest:bridge.implementation_reviewer_root_digest,
    harness_manifest_digest:bridge.implementation_manifest?.harness_manifest_digest,
    harness_signature_bundle_digest:bridge.implementation_manifest?.harness_signature_bundle_digest,
    manifest_signer_root_digest:bridge.implementation_manifest?.manifest_signer_root_digest,
    toolchain_digest:bridge.implementation_manifest?.toolchain_digest,
    dependency_lock_digest:bridge.implementation_manifest?.dependency_lock_digest,
    dependency_closure_digest:bridge.implementation_manifest?.dependency_closure_digest,
    capability_profile_digest:bridge.implementation_manifest?.capability_profile_digest,
    network_policy_digest:bridge.implementation_manifest?.network_policy_digest,
    build_recipe_digest:bridge.implementation_manifest?.build_recipe_digest,
    expected_builder_identity_digest:bridge.implementation_manifest?.expected_builder_identity_digest,
    external_manifest_verifier:true,
    harness_signature_verified:true,
    external_implementation_reviewer:true,
  });
  if(canonical.bridge_digest!==exactDigest(bridge.bridge_digest,'bridge'))throw new Error('rsi_revision_bridge_digest_mismatch');
  return canonical;
}


export function createRsiBoundedRevisionArtifactReceipt({
  bridge,
  candidate_handoff,
  artifact_bundle_digest,
  sbom_digest,
  provenance_statement_digest,
  artifact_signature_bundle_digest,
  external_artifact_signer_root_digest,
  builder_identity_digest,
  external_provenance_verifier=false,
  provenance_verified=false,
  materials_complete=false,
  hermeticity_pass=false,
  artifact_signature_verified=false,
  network_egress_observed=true,
  undeclared_dependency_observed=true,
  host_dependency_observed=true,
}={}){
  if(!bridge||bridge.schema!==RSI_BOUNDED_REVISION_DEVOS_BRIDGE_SCHEMA)throw new Error('rsi_revision_bridge_receipt_bridge_invalid');
  const manifest=verifyRsiIsolatedImplementationManifest(bridge.implementation_manifest);
  if(manifest.manifest_digest!==bridge.revision_limits?.implementation_manifest_digest)throw new Error('rsi_revision_bridge_receipt_manifest_binding_mismatch');
  if(external_provenance_verifier!==true||provenance_verified!==true||materials_complete!==true
    ||hermeticity_pass!==true||artifact_signature_verified!==true)throw new Error('rsi_revision_bridge_receipt_external_verification_required');
  if(network_egress_observed!==false||undeclared_dependency_observed!==false||host_dependency_observed!==false)throw new Error('rsi_revision_bridge_receipt_hermeticity_violation');
  const handoff=verifyCandidateHandoff(candidate_handoff,bridge);
  const builder=exactDigest(builder_identity_digest,'receipt_builder_identity');
  if(builder!==manifest.expected_builder_identity_digest)throw new Error('rsi_revision_bridge_receipt_builder_identity_mismatch');
  const sourceSnapshot=evidenceDigest(handoff,'SOURCE_SNAPSHOT');
  const workspaceBinding=evidenceDigest(handoff,'WORKSPACE_BINDING_READBACK');
  const materialization=evidenceDigest(handoff,'MATERIALIZATION_RECEIPT');
  const outputManifest=evidenceDigest(handoff,'OUTPUT_MANIFEST');
  const core={
    schema:RSI_IMPLEMENTATION_ARTIFACT_RECEIPT_SCHEMA,
    version:1,
    source_sha:bridge.source_sha,
    candidate_sha:exactSha(handoff.candidate_sha,'receipt_candidate'),
    target_branch:handoff.target_branch,
    bridge_digest:bridge.bridge_digest,
    implementation_manifest_digest:manifest.manifest_digest,
    envelope_digest:bridge.envelope_digest,
    proposal_digest:bridge.proposal_digest,
    build_plan_digest:handoff.build_plan_digest,
    source_snapshot_digest:sourceSnapshot,
    workspace_binding_readback_digest:workspaceBinding,
    materialization_receipt_digest:materialization,
    output_manifest_digest:outputManifest,
    artifact_bundle_digest:exactDigest(artifact_bundle_digest,'artifact_bundle'),
    sbom_digest:exactDigest(sbom_digest,'sbom'),
    provenance_statement_digest:exactDigest(provenance_statement_digest,'provenance_statement'),
    artifact_signature_bundle_digest:exactDigest(artifact_signature_bundle_digest,'artifact_signature_bundle'),
    external_artifact_signer_root_digest:exactDigest(external_artifact_signer_root_digest,'artifact_signer_root'),
    builder_identity_digest:builder,
    harness_manifest_digest:manifest.harness_manifest_digest,
    toolchain_digest:manifest.toolchain_digest,
    dependency_lock_digest:manifest.dependency_lock_digest,
    dependency_closure_digest:manifest.dependency_closure_digest,
    capability_profile_digest:manifest.capability_profile_digest,
    network_policy_digest:manifest.network_policy_digest,
    build_recipe_digest:manifest.build_recipe_digest,
    external_provenance_verifier:true,
    provenance_verified:true,
    materials_complete:true,
    hermeticity_pass:true,
    artifact_signature_verified:true,
    network_egress_observed:false,
    undeclared_dependency_observed:false,
    host_dependency_observed:false,
    subject_identity_exact:true,
    eligible_for_external_evaluation_handoff:true,
    eligible_for_promotion:false,
    receipt_can_execute:false,
    receipt_can_schedule:false,
    receipt_can_promote:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiBoundedRevisionArtifactReceipt(receipt,{bridge,candidate_handoff}={}){
  if(!receipt||receipt.schema!==RSI_IMPLEMENTATION_ARTIFACT_RECEIPT_SCHEMA||receipt.version!==1)throw new Error('rsi_revision_bridge_artifact_receipt_invalid');
  assertZero(receipt,'artifact_receipt');
  if(receipt.external_provenance_verifier!==true||receipt.provenance_verified!==true||receipt.materials_complete!==true
    ||receipt.hermeticity_pass!==true||receipt.artifact_signature_verified!==true||receipt.network_egress_observed!==false
    ||receipt.undeclared_dependency_observed!==false||receipt.host_dependency_observed!==false||receipt.subject_identity_exact!==true
    ||receipt.eligible_for_external_evaluation_handoff!==true||receipt.eligible_for_promotion!==false
    ||receipt.receipt_can_execute!==false||receipt.receipt_can_schedule!==false||receipt.receipt_can_promote!==false)throw new Error('rsi_revision_bridge_artifact_receipt_policy_invalid');
  const canonical=createRsiBoundedRevisionArtifactReceipt({
    bridge,
    candidate_handoff,
    artifact_bundle_digest:receipt.artifact_bundle_digest,
    sbom_digest:receipt.sbom_digest,
    provenance_statement_digest:receipt.provenance_statement_digest,
    artifact_signature_bundle_digest:receipt.artifact_signature_bundle_digest,
    external_artifact_signer_root_digest:receipt.external_artifact_signer_root_digest,
    builder_identity_digest:receipt.builder_identity_digest,
    external_provenance_verifier:true,
    provenance_verified:true,
    materials_complete:true,
    hermeticity_pass:true,
    artifact_signature_verified:true,
    network_egress_observed:false,
    undeclared_dependency_observed:false,
    host_dependency_observed:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'artifact_receipt'))throw new Error('rsi_revision_bridge_artifact_receipt_digest_mismatch');
  return canonical;
}

export function rsiBoundedRevisionDevosBridgeTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.bounded-revision-devos-bridge-root.v2',
    version:2,
    selected_phase27_replay_required:true,
    existing_devos_scheduler_only:true,
    existing_isolated_candidate_builder_only:true,
    externally_verified_implementation_manifest_required:true,
    signed_harness_manifest_required:true,
    exact_toolchain_digest_required:true,
    dependency_lock_and_closure_required:true,
    capability_profile_required:true,
    network_deny_policy_required:true,
    host_toolchain_forbidden:true,
    undeclared_dependencies_forbidden:true,
    complete_provenance_receipt_required:true,
    sbom_required:true,
    artifact_signature_bundle_required:true,
    builder_identity_binding_required:true,
    durable_candidate_materialization_receipt_required:true,
    external_evaluation_handoff_only:true,
    second_scheduler_forbidden:true,
    second_executor_forbidden:true,
    bridge_can_create_workspace:false,
    bridge_can_materialize_candidate:false,
    bridge_can_execute_commands:false,
    bridge_can_promote:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,bridge_root_digest:digest(root)});
}
