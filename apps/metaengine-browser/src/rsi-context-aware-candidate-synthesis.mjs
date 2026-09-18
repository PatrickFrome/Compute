import crypto from 'node:crypto';

import {
  prepareRsiIsolatedCandidateBuild,
  verifyRsiIsolatedCandidateBuildPlan,
} from './rsi-isolated-candidate-builder.mjs';
import { verifyRsiExperienceContextPlan } from './rsi-experience-context-planner.mjs';

export const RSI_CANDIDATE_SYNTHESIS_REQUEST_SCHEMA = 'metaengine.rsi.candidate-synthesis-request.v1';
export const RSI_CANDIDATE_MUTATION_PROPOSAL_SCHEMA = 'metaengine.rsi.candidate-mutation-proposal.v1';
export const RSI_CONTEXT_AWARE_CANDIDATE_BUILD_SCHEMA = 'metaengine.rsi.context-aware-candidate-build.v1';
export const RSI_CONTEXT_AWARE_CANDIDATE_ROOT_SCHEMA = 'metaengine.rsi.context-aware-candidate-root.v1';
export const RSI_CONTEXT_AWARE_CANDIDATE_LEDGER_SCHEMA = 'metaengine.rsi.context-aware-candidate-ledger-payload.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_MUTATIONS=16;
const MAX_SELECTED_EXPERIENCE=12;
const MAX_LEDGER_PAYLOAD_BYTES=48*1024;
const FORBIDDEN_LEDGER_KEYS=new Set(['page_text','raw_dom','raw_html','prompt','prompt_plaintext','input_value','input_values','cookie','cookies','authorization','access_token','refresh_token','secret','password']);
const GENERIC_CHANGE_TYPES=new Set(['MODIFY','DELETE']);
const STRATEGIES=new Set([
  'CONTEXT_GUIDED_DIVERSE_PROPOSAL',
  'FAILURE_DIRECTED_REPAIR',
  'MECHANISM_TRANSFER',
  'PARETO_COMPLEMENT',
]);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(v,l){for(const k of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(Object.hasOwn(v||{},k)&&v[k]!==false)throw new Error(`rsi_synthesis_${l}_${k}_invalid`);if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false)throw new Error(`rsi_synthesis_${l}_retry_invalid`)}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_synthesis_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_synthesis_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_synthesis_${l}_invalid`);return o}
function token(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_synthesis_${l}_invalid`);return o}
function positiveInt(v,l,max=1_000_000){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_synthesis_${l}_invalid`);return o}
function normalizePath(v){const p=String(v||'').trim();if(!p||p.length>240||p.startsWith('/')||p.includes('\\')||p.includes('\0')||p.split('/').some(x=>!x||x==='.'||x==='..'||x==='.git'))throw new Error('rsi_synthesis_mutation_path_invalid');return p}

function assertLedgerSafe(value,path=[]){
  if(Array.isArray(value)){for(let i=0;i<value.length;i+=1)assertLedgerSafe(value[i],[...path,String(i)]);return}
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    const normalized=String(key).toLowerCase();
    if(FORBIDDEN_LEDGER_KEYS.has(normalized))throw new Error(`rsi_synthesis_ledger_sensitive_field_forbidden:${[...path,key].join('.')}`);
    assertLedgerSafe(child,[...path,key]);
  }
}
function canonicalBytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}

function verifyFrontierBinding(entry, contextPlan){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('rsi_synthesis_frontier_entry_invalid');
  assertZeroAuthority(entry,'frontier');
  const hypothesis=entry.hypothesis;
  const plan=entry.plan;
  if(!hypothesis||typeof hypothesis!=='object'||Array.isArray(hypothesis))throw new Error('rsi_synthesis_hypothesis_invalid');
  if(!plan||typeof plan!=='object'||Array.isArray(plan))throw new Error('rsi_synthesis_experiment_plan_invalid');
  assertZeroAuthority(hypothesis,'hypothesis');
  assertZeroAuthority(plan,'experiment');
  const source=exactSha(contextPlan.source_sha,'context_source');
  if(exactSha(hypothesis.source_sha,'hypothesis_source')!==source||exactSha(plan.source_sha,'experiment_source')!==source)throw new Error('rsi_synthesis_source_binding_mismatch');
  if(
    entry.opportunity_id!==contextPlan.opportunity_id
    || String(entry.signal||'').toUpperCase()!==contextPlan.signal
    || String(entry.mutation_surface||'').toUpperCase()!==contextPlan.mutation_surface
    || entry.observation_digest!==contextPlan.observation_digest
    || hypothesis.hypothesis_digest!==contextPlan.hypothesis_digest
    || `sha256:${plan.plan_digest}`!==contextPlan.experiment_plan_digest
    || plan.experiment_id!==contextPlan.experiment_id
    || plan.target_branch!==contextPlan.target_branch
  ) throw new Error('rsi_synthesis_context_frontier_mismatch');
  if(
    hypothesis.candidate_can_modify_hypothesis!==false
    || hypothesis.candidate_can_modify_acceptance_contract!==false
    || hypothesis.requires_independent_evaluator!==true
    || plan.requires_existing_devos_scheduler!==true
    || plan.lease_created!==false
    || plan.workspace_bound!==false
    || plan.command_created!==false
  ) throw new Error('rsi_synthesis_frontier_policy_invalid');
  return {hypothesis,plan,source};
}

function experienceRefs(contextPlan){
  const rows=Array.isArray(contextPlan.selected_cases)?contextPlan.selected_cases:[];
  if(rows.length>MAX_SELECTED_EXPERIENCE)throw new Error('rsi_synthesis_selected_experience_invalid');
  return Object.freeze(rows.map(row=>Object.freeze({
    case_id:boundedId(row.case_id,'experience_case_id'),
    case_digest:exactDigest(row.case_digest,'experience_case'),
    outcome:token(row.outcome,'experience_outcome'),
    lesson_digests:Object.freeze((Array.isArray(row.lesson_digests)?row.lesson_digests:[]).map(x=>exactDigest(x,'experience_lesson')).sort()),
    exact_task_match:row.exact_task_match===true,
    corrective_trace_target:row.corrective_trace_target===true,
    source_context_truth_is_portable:false,
    external_transfer_validation_required:true,
  })));
}

export function createRsiCandidateSynthesisRequest({
  context_plan,
  frontier_entry,
  generation=1,
  strategy='CONTEXT_GUIDED_DIVERSE_PROPOSAL',
}={}){
  const context=verifyRsiExperienceContextPlan(context_plan);
  const {hypothesis,plan,source}=verifyFrontierBinding(frontier_entry,context);
  const normalizedStrategy=token(strategy,'strategy');
  if(!STRATEGIES.has(normalizedStrategy))throw new Error('rsi_synthesis_strategy_invalid');
  const gen=positiveInt(generation,'generation');
  const refs=experienceRefs(context);
  const acceptanceDigest=digest(hypothesis.acceptance_contract);
  const core=zeroAuthority({
    schema:RSI_CANDIDATE_SYNTHESIS_REQUEST_SCHEMA,
    version:1,
    source_sha:source,
    request_id:`rsi_synth_${context.search_context_digest.slice(0,20)}_${gen}`,
    generation:gen,
    strategy:normalizedStrategy,
    opportunity_id:context.opportunity_id,
    signal:context.signal,
    mutation_surface:context.mutation_surface,
    observation_digest:context.observation_digest,
    hypothesis_id:hypothesis.hypothesis_id,
    hypothesis_digest:hypothesis.hypothesis_digest,
    acceptance_contract_digest:acceptanceDigest,
    experiment_id:plan.experiment_id,
    experiment_plan_digest:context.experiment_plan_digest,
    target_branch:plan.target_branch,
    context_plan_digest:context.context_plan_digest,
    search_context_digest:context.search_context_digest,
    experience_mode:context.mode,
    experience_graph_snapshot_digest:context.graph_snapshot_digest,
    experience_retrieval_digest:context.retrieval_digest,
    selected_experience:refs,
    selected_experience_count:refs.length,
    requested_mutation_change_types:Object.freeze([...GENERIC_CHANGE_TYPES].sort()),
    max_mutations:MAX_MUTATIONS,
    raw_patch_requested:false,
    raw_source_persisted_in_request:false,
    raw_trajectory_persisted_in_request:false,
    hidden_evaluation_manifest_exposed:false,
    candidate_can_modify_hypothesis:false,
    candidate_can_modify_acceptance_contract:false,
    candidate_can_mark_memory_portable:false,
    model_or_page_output_is_authority:false,
    source_snapshot_required_before_build:true,
    existing_devos_scheduler_required:true,
    existing_devos_workspace_authority_required:true,
    request_is_build_authority:false,
    request_is_materialization_authority:false,
    request_is_execution_authority:false,
  });
  return Object.freeze({...core,synthesis_request_digest:digest(core)});
}

export function verifyRsiCandidateSynthesisRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||request.schema!==RSI_CANDIDATE_SYNTHESIS_REQUEST_SCHEMA||request.version!==1)throw new Error('rsi_synthesis_request_invalid');
  assertZeroAuthority(request,'request');
  if(
    request.raw_patch_requested!==false
    || request.raw_source_persisted_in_request!==false
    || request.raw_trajectory_persisted_in_request!==false
    || request.hidden_evaluation_manifest_exposed!==false
    || request.candidate_can_modify_hypothesis!==false
    || request.candidate_can_modify_acceptance_contract!==false
    || request.candidate_can_mark_memory_portable!==false
    || request.model_or_page_output_is_authority!==false
    || request.source_snapshot_required_before_build!==true
    || request.existing_devos_scheduler_required!==true
    || request.existing_devos_workspace_authority_required!==true
    || request.request_is_build_authority!==false
    || request.request_is_materialization_authority!==false
    || request.request_is_execution_authority!==false
  )throw new Error('rsi_synthesis_request_policy_invalid');
  exactSha(request.source_sha,'request_source');
  exactDigest(request.hypothesis_digest,'request_hypothesis');
  exactDigest(request.acceptance_contract_digest,'request_acceptance');
  exactDigest(request.experiment_plan_digest,'request_experiment');
  exactDigest(request.context_plan_digest,'request_context');
  if(request.experience_graph_snapshot_digest!=null)exactDigest(request.experience_graph_snapshot_digest,'request_graph');
  if(request.experience_retrieval_digest!=null)exactDigest(request.experience_retrieval_digest,'request_retrieval');
  const material={...structuredClone(request)};delete material.synthesis_request_digest;
  if(digest(material)!==exactDigest(request.synthesis_request_digest,'request'))throw new Error('rsi_synthesis_request_digest_mismatch');
  return request;
}

function normalizeProposalMutations(rows){
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_MUTATIONS)throw new Error('rsi_synthesis_proposal_mutations_invalid');
  const seen=new Set();
  return Object.freeze(rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_synthesis_proposal_mutation_invalid');
    const path=normalizePath(row.path);
    if(seen.has(path))throw new Error('rsi_synthesis_proposal_mutation_duplicate');
    seen.add(path);
    const change=token(row.change,'proposal_change');
    if(!GENERIC_CHANGE_TYPES.has(change))throw new Error('rsi_synthesis_generic_create_requires_separate_absence_proof');
    return Object.freeze({path,change});
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.change.localeCompare(b.change)));
}

export function createRsiCandidateMutationProposal({synthesis_request,proposal}={}){
  const request=verifyRsiCandidateSynthesisRequest(synthesis_request);
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))throw new Error('rsi_synthesis_proposal_invalid');
  if(proposal.external_proposer_verified!==true||proposal.authored_by_candidate!==false)throw new Error('rsi_synthesis_external_proposer_required');
  const mutations=normalizeProposalMutations(proposal.mutations);
  const core=zeroAuthority({
    schema:RSI_CANDIDATE_MUTATION_PROPOSAL_SCHEMA,
    version:1,
    proposal_id:boundedId(proposal.proposal_id,'proposal_id'),
    source_sha:request.source_sha,
    synthesis_request_digest:request.synthesis_request_digest,
    context_plan_digest:request.context_plan_digest,
    opportunity_id:request.opportunity_id,
    hypothesis_digest:request.hypothesis_digest,
    mutation_surface:request.mutation_surface,
    mutations,
    mutation_count:mutations.length,
    proposal_evidence_digest:exactDigest(proposal.proposal_evidence_digest,'proposal_evidence'),
    producer_receipt_digest:exactDigest(proposal.producer_receipt_digest,'producer_receipt'),
    proposer_class:token(proposal.proposer_class,'proposer_class'),
    external_proposer_verified:true,
    authored_by_candidate:false,
    raw_patch_present:false,
    code_content_present:false,
    prompt_plaintext_present:false,
    proposal_is_build_authority:false,
    proposal_is_materialization_authority:false,
    proposal_is_execution_authority:false,
    model_or_page_output_is_authority:false,
    generic_create_allowed:false,
  });
  return Object.freeze({...core,mutation_proposal_digest:digest(core)});
}

export function verifyRsiCandidateMutationProposal(proposal,request){
  const req=verifyRsiCandidateSynthesisRequest(request);
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||proposal.schema!==RSI_CANDIDATE_MUTATION_PROPOSAL_SCHEMA||proposal.version!==1)throw new Error('rsi_synthesis_mutation_proposal_invalid');
  assertZeroAuthority(proposal,'proposal');
  if(
    proposal.source_sha!==req.source_sha
    || proposal.synthesis_request_digest!==req.synthesis_request_digest
    || proposal.context_plan_digest!==req.context_plan_digest
    || proposal.opportunity_id!==req.opportunity_id
    || proposal.hypothesis_digest!==req.hypothesis_digest
    || proposal.mutation_surface!==req.mutation_surface
  )throw new Error('rsi_synthesis_proposal_binding_mismatch');
  if(
    proposal.external_proposer_verified!==true
    || proposal.authored_by_candidate!==false
    || proposal.raw_patch_present!==false
    || proposal.code_content_present!==false
    || proposal.prompt_plaintext_present!==false
    || proposal.proposal_is_build_authority!==false
    || proposal.proposal_is_materialization_authority!==false
    || proposal.proposal_is_execution_authority!==false
    || proposal.model_or_page_output_is_authority!==false
    || proposal.generic_create_allowed!==false
  )throw new Error('rsi_synthesis_proposal_policy_invalid');
  const normalized=normalizeProposalMutations(proposal.mutations);
  if(JSON.stringify(normalized)!==JSON.stringify(proposal.mutations))throw new Error('rsi_synthesis_proposal_mutation_canonicalization_mismatch');
  const material={...structuredClone(proposal)};delete material.mutation_proposal_digest;
  if(digest(material)!==exactDigest(proposal.mutation_proposal_digest,'proposal'))throw new Error('rsi_synthesis_proposal_digest_mismatch');
  return proposal;
}

export function prepareRsiContextAwareCandidateBuild({
  synthesis_request,
  frontier_entry,
  source_snapshot,
  mutation_proposal,
  sequence=1,
  previous_candidate_id=null,
  requested_backend=null,
}={}){
  const request=verifyRsiCandidateSynthesisRequest(synthesis_request);
  const proposal=verifyRsiCandidateMutationProposal(mutation_proposal,request);
  if(!frontier_entry||frontier_entry.opportunity_id!==request.opportunity_id)throw new Error('rsi_synthesis_build_frontier_mismatch');
  const sourceFiles=new Set(Array.isArray(source_snapshot?.source_files)?source_snapshot.source_files:[]);
  for(const row of proposal.mutations){
    if(row.change!=='MODIFY'&&row.change!=='DELETE')throw new Error('rsi_synthesis_build_change_invalid');
    if(!sourceFiles.has(row.path))throw new Error('rsi_synthesis_build_mutation_target_not_in_source_snapshot');
  }
  const frontierPlan=frontier_entry.plan;
  if(!frontierPlan||`sha256:${frontierPlan.plan_digest}`!==request.experiment_plan_digest)throw new Error('rsi_synthesis_build_experiment_mismatch');
  if(frontier_entry.hypothesis?.hypothesis_digest!==request.hypothesis_digest)throw new Error('rsi_synthesis_build_hypothesis_mismatch');
  if(exactSha(frontierPlan.source_sha,'build_source')!==request.source_sha)throw new Error('rsi_synthesis_build_source_mismatch');

  const genericBuild=prepareRsiIsolatedCandidateBuild({
    experiment_plan:frontierPlan,
    source_snapshot,
    mutations:proposal.mutations,
    sequence,
    previous_candidate_id,
    requested_backend,
  });
  verifyRsiIsolatedCandidateBuildPlan(genericBuild);
  const core=zeroAuthority({
    schema:RSI_CONTEXT_AWARE_CANDIDATE_BUILD_SCHEMA,
    version:1,
    source_sha:request.source_sha,
    synthesis_request_digest:request.synthesis_request_digest,
    mutation_proposal_digest:proposal.mutation_proposal_digest,
    context_plan_digest:request.context_plan_digest,
    search_context_digest:request.search_context_digest,
    experiment_id:request.experiment_id,
    hypothesis_digest:request.hypothesis_digest,
    mutation_surface:request.mutation_surface,
    exact_mutation_set:proposal.mutations,
    generic_build_plan:genericBuild,
    generic_build_plan_digest:genericBuild.plan_digest,
    source_snapshot_digest:genericBuild.source.source_snapshot_digest,
    context_aware:true,
    raw_source_persisted:false,
    raw_patch_persisted:false,
    devos_lease_required_before_materialization:true,
    devos_workspace_binding_required:true,
    candidate_materialized:false,
    lease_created:false,
    workspace_created:false,
    build_is_execution_authority:false,
    build_is_promotion_authority:false,
  });
  return Object.freeze({...core,context_aware_build_digest:digest(core)});
}

export function verifyRsiContextAwareCandidateBuild(envelope,{synthesis_request,mutation_proposal}={}){
  const request=verifyRsiCandidateSynthesisRequest(synthesis_request);
  const proposal=verifyRsiCandidateMutationProposal(mutation_proposal,request);
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||envelope.schema!==RSI_CONTEXT_AWARE_CANDIDATE_BUILD_SCHEMA||envelope.version!==1)throw new Error('rsi_synthesis_build_invalid');
  assertZeroAuthority(envelope,'build');
  if(
    envelope.source_sha!==request.source_sha
    || envelope.synthesis_request_digest!==request.synthesis_request_digest
    || envelope.mutation_proposal_digest!==proposal.mutation_proposal_digest
    || envelope.context_plan_digest!==request.context_plan_digest
    || envelope.experiment_id!==request.experiment_id
    || envelope.hypothesis_digest!==request.hypothesis_digest
  )throw new Error('rsi_synthesis_build_binding_mismatch');
  if(
    envelope.context_aware!==true
    || envelope.raw_source_persisted!==false
    || envelope.raw_patch_persisted!==false
    || envelope.devos_lease_required_before_materialization!==true
    || envelope.devos_workspace_binding_required!==true
    || envelope.candidate_materialized!==false
    || envelope.lease_created!==false
    || envelope.workspace_created!==false
    || envelope.build_is_execution_authority!==false
    || envelope.build_is_promotion_authority!==false
  )throw new Error('rsi_synthesis_build_policy_invalid');
  verifyRsiIsolatedCandidateBuildPlan(envelope.generic_build_plan);
  if(envelope.generic_build_plan_digest!==envelope.generic_build_plan.plan_digest)throw new Error('rsi_synthesis_generic_build_digest_mismatch');
  const material={...structuredClone(envelope)};delete material.context_aware_build_digest;
  if(digest(material)!==exactDigest(envelope.context_aware_build_digest,'build'))throw new Error('rsi_synthesis_build_digest_mismatch');
  return envelope;
}

export function rsiContextAwareCandidateTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_CONTEXT_AWARE_CANDIDATE_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-context-aware-candidate-synthesis.mjs',
    verified_experience_context_required:true,
    exact_source_sha_required:true,
    precommitted_hypothesis_required:true,
    precommitted_acceptance_contract_required:true,
    external_proposer_receipt_required:true,
    raw_model_patch_is_authority:false,
    generic_create_allowed:false,
    source_snapshot_required_before_build:true,
    existing_isolated_candidate_builder_required:true,
    existing_devos_scheduler_required:true,
    existing_devos_workspace_authority_required:true,
    devos_lease_required_before_materialization:true,
    candidate_materialized_by_this_module:false,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,context_candidate_root_digest:digest(root)});
}
