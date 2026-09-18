import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiBenchmarkProvenancePolicy,
  verifyRsiBenchmarkEvidenceAdmission,
  rsiBenchmarkProvenanceTrustRootSnapshot,
} from './rsi-benchmark-provenance-guard.mjs';
import { rsiVerifierShadowLifecycleTrustRootSnapshot } from './rsi-verifier-shadow-lifecycle.mjs';

export const RSI_BENCHMARK_COEVOLUTION_PROPOSAL_SCHEMA='metaengine.rsi.benchmark-coevolution-proposal.v1';
export const RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA='metaengine.rsi.benchmark-coevolution-admission.v1';
export const RSI_BENCHMARK_COEVOLUTION_LEDGER_SCHEMA='metaengine.rsi.benchmark-coevolution-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_GENERATIONS=256;
const MAX_TASKS_PER_GENERATION=4096;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;
}
function exactDigest(v,label){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_benchmark_coevolution_${label}_digest_invalid`);
  return x;
}
function exactSha(v,label){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA40_RE.test(x))throw new Error(`rsi_benchmark_coevolution_${label}_sha_invalid`);
  return x;
}
function boundedId(v,label){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_benchmark_coevolution_${label}_invalid`);
  return x;
}
function nonNegativeInt(v,label,max=Number.MAX_SAFE_INTEGER){
  const x=Number(v);
  if(!Number.isSafeInteger(x)||x<0||x>max)throw new Error(`rsi_benchmark_coevolution_${label}_invalid`);
  return x;
}
function positiveInt(v,label,max=Number.MAX_SAFE_INTEGER){
  const x=Number(v);
  if(!Number.isSafeInteger(x)||x<1||x>max)throw new Error(`rsi_benchmark_coevolution_${label}_invalid`);
  return x;
}
function assertZero(v,label){
  for(const f of [
    'execution_authority','browser_authority','task_authority','production_mutation_authority',
    'promotion_authority','self_update_authority','scheduler_authority','verifier_replacement_authority',
    'benchmark_activation_authority','authority_effect',
  ]){
    if(v?.[f]!==false)throw new Error(`rsi_benchmark_coevolution_${label}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_benchmark_coevolution_${label}_automatic_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    verifier_replacement_authority:false,
    benchmark_activation_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function sortedUniqueDigests(values,label){
  if(!Array.isArray(values)||values.length<1||values.length>MAX_TASKS_PER_GENERATION)throw new Error(`rsi_benchmark_coevolution_${label}_invalid`);
  const out=values.map(v=>exactDigest(v,label)).sort();
  if(new Set(out).size!==out.length)throw new Error(`rsi_benchmark_coevolution_${label}_duplicate`);
  return Object.freeze(out);
}

function currentPolicyRoots(){
  const benchmark=rsiBenchmarkProvenanceTrustRootSnapshot();
  const verifierShadow=rsiVerifierShadowLifecycleTrustRootSnapshot();
  return Object.freeze({
    benchmark_provenance_root_digest:exactDigest(benchmark.benchmark_root_digest,'benchmark_provenance_root'),
    verifier_shadow_lifecycle_root_digest:exactDigest(verifierShadow.verifier_shadow_lifecycle_root_digest,'verifier_shadow_lifecycle_root'),
  });
}

export function createRsiBenchmarkCoevolutionProposal({
  proposal_id,
  source_sha,
  benchmark_family_id,
  parent_generation,
  parent_benchmark_digest,
  parent_generation_receipt_digest,
  proposed_generation,
  proposed_benchmark_digest,
  task_digest_set,
  trusted_runtime_digest,
  active_verifier_root_digest,
  anchor_set_digest,
  heldout_anchor_digest,
  mastery_policy_digest,
  mastery_certificate_digest,
  mastery_certified,
  anchor_recalibration_receipt_digest,
  anchor_recalibration_pass,
  task_quality_audit_digest,
  semantic_construction_audit_digest,
  no_op_ablation_digest,
  environment_fidelity_audit_digest,
  agentic_usability_audit_digest,
  freshness_probe_digest,
  broken_task_count,
  task_quality_pass,
  semantic_construction_pass,
  no_op_ablation_pass,
  environment_fidelity_pass,
  agentic_usability_pass,
  freshness_probe_pass,
  benchmark_provenance_policy,
  benchmark_provenance_admission,
  benchmark_provenance_assessments,
  benchmark_provenance_tasks,
  external_benchmark_curator=false,
  authored_by_candidate=true,
}={}){
  if(external_benchmark_curator!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_coevolution_external_curator_required');

  const source=exactSha(source_sha,'source');
  const parentGen=nonNegativeInt(parent_generation,'parent_generation',MAX_GENERATIONS-1);
  const nextGen=positiveInt(proposed_generation,'proposed_generation',MAX_GENERATIONS);
  if(nextGen!==parentGen+1)throw new Error('rsi_benchmark_coevolution_generation_must_advance_by_one');

  const parentDigest=exactDigest(parent_benchmark_digest,'parent_benchmark');
  const proposedDigest=exactDigest(proposed_benchmark_digest,'proposed_benchmark');
  if(parentDigest===proposedDigest)throw new Error('rsi_benchmark_coevolution_benchmark_digest_must_change');

  const runtime=exactDigest(trusted_runtime_digest,'trusted_runtime');
  const activeVerifier=exactDigest(active_verifier_root_digest,'active_verifier_root');
  const anchor=exactDigest(anchor_set_digest,'anchor_set');
  const heldout=exactDigest(heldout_anchor_digest,'heldout_anchor');
  if(anchor===heldout)throw new Error('rsi_benchmark_coevolution_anchor_holdout_alias');

  const checkedPolicy=verifyRsiBenchmarkProvenancePolicy(benchmark_provenance_policy);
  const checkedAdmission=verifyRsiBenchmarkEvidenceAdmission(
    benchmark_provenance_admission,
    checkedPolicy,
    benchmark_provenance_assessments,
    benchmark_provenance_tasks,
  );
  if(checkedAdmission.eligible_for_full_holdout_evidence!==true)throw new Error('rsi_benchmark_coevolution_provenance_admission_required');

  const taskDigests=sortedUniqueDigests(task_digest_set,'task_digest');
  if(taskDigests.length!==checkedAdmission.task_count)throw new Error('rsi_benchmark_coevolution_task_count_mismatch');
  if(nonNegativeInt(broken_task_count,'broken_task_count',MAX_TASKS_PER_GENERATION)!==0)throw new Error('rsi_benchmark_coevolution_broken_task_present');

  const blockers=[];
  if(mastery_certified!==true)blockers.push('MASTERY_NOT_CERTIFIED');
  if(anchor_recalibration_pass!==true)blockers.push('ANCHOR_RECALIBRATION_FAILED');
  if(task_quality_pass!==true)blockers.push('TASK_QUALITY_AUDIT_FAILED');
  if(semantic_construction_pass!==true)blockers.push('SEMANTIC_CONSTRUCTION_AUDIT_FAILED');
  if(no_op_ablation_pass!==true)blockers.push('NO_OP_ABLATION_FAILED');
  if(environment_fidelity_pass!==true)blockers.push('ENVIRONMENT_FIDELITY_AUDIT_FAILED');
  if(agentic_usability_pass!==true)blockers.push('AGENTIC_USABILITY_AUDIT_FAILED');
  if(freshness_probe_pass!==true)blockers.push('FRESHNESS_PROBE_FAILED');
  if(checkedAdmission.eligible_for_full_holdout_evidence!==true)blockers.push('PROVENANCE_ADMISSION_FAILED');

  const policyRoots=currentPolicyRoots();
  const core=zero({
    schema:RSI_BENCHMARK_COEVOLUTION_PROPOSAL_SCHEMA,
    version:1,
    proposal_id:boundedId(proposal_id,'proposal_id'),
    source_sha:source,
    benchmark_family_id:boundedId(benchmark_family_id,'benchmark_family_id'),
    parent_generation:parentGen,
    proposed_generation:nextGen,
    parent_benchmark_digest:parentDigest,
    parent_generation_receipt_digest:exactDigest(parent_generation_receipt_digest,'parent_generation_receipt'),
    proposed_benchmark_digest:proposedDigest,
    task_digest_set:taskDigests,
    task_count:taskDigests.length,
    trusted_runtime_digest:runtime,
    active_verifier_root_digest:activeVerifier,
    anchor_set_digest:anchor,
    heldout_anchor_digest:heldout,
    mastery_policy_digest:exactDigest(mastery_policy_digest,'mastery_policy'),
    mastery_certificate_digest:exactDigest(mastery_certificate_digest,'mastery_certificate'),
    mastery_certified:mastery_certified===true,
    anchor_recalibration_receipt_digest:exactDigest(anchor_recalibration_receipt_digest,'anchor_recalibration_receipt'),
    anchor_recalibration_pass:anchor_recalibration_pass===true,
    provenance_policy_digest:checkedPolicy.policy_digest,
    provenance_admission_digest:checkedAdmission.admission_digest,
    provenance_task_count:checkedAdmission.task_count,
    provenance_resistant_task_count:checkedAdmission.resistant_task_count,
    provenance_resistant_source_family_count:checkedAdmission.resistant_source_family_count,
    provenance_public_static_fraction:checkedAdmission.public_static_fraction,
    task_quality_audit_digest:exactDigest(task_quality_audit_digest,'task_quality_audit'),
    semantic_construction_audit_digest:exactDigest(semantic_construction_audit_digest,'semantic_construction_audit'),
    no_op_ablation_digest:exactDigest(no_op_ablation_digest,'no_op_ablation'),
    environment_fidelity_audit_digest:exactDigest(environment_fidelity_audit_digest,'environment_fidelity_audit'),
    agentic_usability_audit_digest:exactDigest(agentic_usability_audit_digest,'agentic_usability_audit'),
    freshness_probe_digest:exactDigest(freshness_probe_digest,'freshness_probe'),
    broken_task_count:0,
    task_quality_pass:task_quality_pass===true,
    semantic_construction_pass:semantic_construction_pass===true,
    no_op_ablation_pass:no_op_ablation_pass===true,
    environment_fidelity_pass:environment_fidelity_pass===true,
    agentic_usability_pass:agentic_usability_pass===true,
    freshness_probe_pass:freshness_probe_pass===true,
    blockers:Object.freeze(blockers.sort()),
    clean_generation_evidence:blockers.length===0,
    transition_kind:'MASTERY_THROTTLED_DIFFICULTY_ADVANCE',
    raw_task_content_present:false,
    process_and_outcome_labels_separate:true,
    controllable_and_environment_failures_separate:true,
    current_benchmark_remains_active:true,
    proposed_benchmark_shadow_only:true,
    candidate_can_author_benchmark:false,
    candidate_can_choose_tasks:false,
    candidate_can_choose_sources:false,
    candidate_can_choose_mastery_policy:false,
    candidate_can_choose_anchor:false,
    candidate_can_choose_verifier:false,
    candidate_can_choose_trusted_runtime:false,
    candidate_can_choose_generation_transition:false,
    candidate_can_modify_evaluator_harness:false,
    external_benchmark_curator:true,
    authored_by_candidate:false,
    benchmark_provenance_root_digest:policyRoots.benchmark_provenance_root_digest,
    verifier_shadow_lifecycle_root_digest:policyRoots.verifier_shadow_lifecycle_root_digest,
  });
  return Object.freeze({...core,proposal_digest:digest(core)});
}

export function verifyRsiBenchmarkCoevolutionProposal(proposal,{
  benchmark_provenance_policy,
  benchmark_provenance_admission,
  benchmark_provenance_assessments,
  benchmark_provenance_tasks,
}={}){
  if(!proposal||proposal.schema!==RSI_BENCHMARK_COEVOLUTION_PROPOSAL_SCHEMA||proposal.version!==1)throw new Error('rsi_benchmark_coevolution_proposal_invalid');
  assertZero(proposal,'proposal');
  if(proposal.raw_task_content_present!==false||proposal.process_and_outcome_labels_separate!==true
    ||proposal.controllable_and_environment_failures_separate!==true||proposal.current_benchmark_remains_active!==true
    ||proposal.proposed_benchmark_shadow_only!==true||proposal.candidate_can_author_benchmark!==false
    ||proposal.candidate_can_choose_tasks!==false||proposal.candidate_can_choose_sources!==false
    ||proposal.candidate_can_choose_mastery_policy!==false||proposal.candidate_can_choose_anchor!==false
    ||proposal.candidate_can_choose_verifier!==false||proposal.candidate_can_choose_trusted_runtime!==false
    ||proposal.candidate_can_choose_generation_transition!==false||proposal.candidate_can_modify_evaluator_harness!==false
    ||proposal.external_benchmark_curator!==true||proposal.authored_by_candidate!==false
    ||proposal.transition_kind!=='MASTERY_THROTTLED_DIFFICULTY_ADVANCE')throw new Error('rsi_benchmark_coevolution_proposal_policy_invalid');

  const canonical=createRsiBenchmarkCoevolutionProposal({
    proposal_id:proposal.proposal_id,
    source_sha:proposal.source_sha,
    benchmark_family_id:proposal.benchmark_family_id,
    parent_generation:proposal.parent_generation,
    parent_benchmark_digest:proposal.parent_benchmark_digest,
    parent_generation_receipt_digest:proposal.parent_generation_receipt_digest,
    proposed_generation:proposal.proposed_generation,
    proposed_benchmark_digest:proposal.proposed_benchmark_digest,
    task_digest_set:proposal.task_digest_set,
    trusted_runtime_digest:proposal.trusted_runtime_digest,
    active_verifier_root_digest:proposal.active_verifier_root_digest,
    anchor_set_digest:proposal.anchor_set_digest,
    heldout_anchor_digest:proposal.heldout_anchor_digest,
    mastery_policy_digest:proposal.mastery_policy_digest,
    mastery_certificate_digest:proposal.mastery_certificate_digest,
    mastery_certified:proposal.mastery_certified,
    anchor_recalibration_receipt_digest:proposal.anchor_recalibration_receipt_digest,
    anchor_recalibration_pass:proposal.anchor_recalibration_pass,
    task_quality_audit_digest:proposal.task_quality_audit_digest,
    semantic_construction_audit_digest:proposal.semantic_construction_audit_digest,
    no_op_ablation_digest:proposal.no_op_ablation_digest,
    environment_fidelity_audit_digest:proposal.environment_fidelity_audit_digest,
    agentic_usability_audit_digest:proposal.agentic_usability_audit_digest,
    freshness_probe_digest:proposal.freshness_probe_digest,
    broken_task_count:proposal.broken_task_count,
    task_quality_pass:proposal.task_quality_pass,
    semantic_construction_pass:proposal.semantic_construction_pass,
    no_op_ablation_pass:proposal.no_op_ablation_pass,
    environment_fidelity_pass:proposal.environment_fidelity_pass,
    agentic_usability_pass:proposal.agentic_usability_pass,
    freshness_probe_pass:proposal.freshness_probe_pass,
    benchmark_provenance_policy,
    benchmark_provenance_admission,
    benchmark_provenance_assessments,
    benchmark_provenance_tasks,
    external_benchmark_curator:true,
    authored_by_candidate:false,
  });
  if(canonical.proposal_digest!==exactDigest(proposal.proposal_digest,'proposal'))throw new Error('rsi_benchmark_coevolution_proposal_digest_mismatch');
  return canonical;
}

export function createRsiBenchmarkCoevolutionAdmission({
  admission_id,
  proposal,
  benchmark_provenance_policy,
  benchmark_provenance_admission,
  benchmark_provenance_assessments,
  benchmark_provenance_tasks,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_coevolution_external_admission_owner_required');
  const checked=verifyRsiBenchmarkCoevolutionProposal(proposal,{
    benchmark_provenance_policy,
    benchmark_provenance_admission,
    benchmark_provenance_assessments,
    benchmark_provenance_tasks,
  });
  const eligible=checked.clean_generation_evidence===true&&checked.blockers.length===0;
  const core=zero({
    schema:RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA,
    version:1,
    admission_id:boundedId(admission_id,'admission_id'),
    source_sha:checked.source_sha,
    proposal_digest:checked.proposal_digest,
    benchmark_family_id:checked.benchmark_family_id,
    parent_generation:checked.parent_generation,
    proposed_generation:checked.proposed_generation,
    parent_benchmark_digest:checked.parent_benchmark_digest,
    proposed_benchmark_digest:checked.proposed_benchmark_digest,
    trusted_runtime_digest:checked.trusted_runtime_digest,
    active_verifier_root_digest:checked.active_verifier_root_digest,
    anchor_set_digest:checked.anchor_set_digest,
    heldout_anchor_digest:checked.heldout_anchor_digest,
    mastery_certificate_digest:checked.mastery_certificate_digest,
    anchor_recalibration_receipt_digest:checked.anchor_recalibration_receipt_digest,
    provenance_admission_digest:checked.provenance_admission_digest,
    task_digest_set:checked.task_digest_set,
    task_count:checked.task_count,
    state:eligible?'ELIGIBLE_FOR_SHADOW_BENCHMARK_TRIAL':'BENCHMARK_GENERATION_REJECTED',
    eligible_for_shadow_benchmark_trial:eligible,
    current_benchmark_remains_active:true,
    active_verifier_remains_unchanged:true,
    admission_can_activate_benchmark:false,
    admission_can_replace_verifier:false,
    admission_can_gate_canary:false,
    admission_can_gate_promotion:false,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiBenchmarkCoevolutionAdmission(admission,{
  proposal,
  benchmark_provenance_policy,
  benchmark_provenance_admission,
  benchmark_provenance_assessments,
  benchmark_provenance_tasks,
}={}){
  if(!admission||admission.schema!==RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_benchmark_coevolution_admission_invalid');
  assertZero(admission,'admission');
  if(admission.current_benchmark_remains_active!==true||admission.active_verifier_remains_unchanged!==true
    ||admission.admission_can_activate_benchmark!==false||admission.admission_can_replace_verifier!==false
    ||admission.admission_can_gate_canary!==false||admission.admission_can_gate_promotion!==false
    ||admission.external_admission_owner!==true||admission.authored_by_candidate!==false)throw new Error('rsi_benchmark_coevolution_admission_policy_invalid');
  const canonical=createRsiBenchmarkCoevolutionAdmission({
    admission_id:admission.admission_id,
    proposal,
    benchmark_provenance_policy,
    benchmark_provenance_admission,
    benchmark_provenance_assessments,
    benchmark_provenance_tasks,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(admission.admission_digest,'admission'))throw new Error('rsi_benchmark_coevolution_admission_digest_mismatch');
  return canonical;
}

function verifyStoredAdmission(row){
  if(!row||row.schema!==RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_benchmark_coevolution_ledger_admission_invalid');
  assertZero(row,'ledger_admission');
  if(row.current_benchmark_remains_active!==true||row.active_verifier_remains_unchanged!==true
    ||row.admission_can_activate_benchmark!==false||row.admission_can_replace_verifier!==false
    ||row.admission_can_gate_canary!==false||row.admission_can_gate_promotion!==false
    ||row.external_admission_owner!==true||row.authored_by_candidate!==false)throw new Error('rsi_benchmark_coevolution_ledger_admission_policy_invalid');
  if(row.state!=='ELIGIBLE_FOR_SHADOW_BENCHMARK_TRIAL'||row.eligible_for_shadow_benchmark_trial!==true)throw new Error('rsi_benchmark_coevolution_ledger_only_eligible_admissions_allowed');
  exactSha(row.source_sha,'ledger_source');
  exactDigest(row.proposal_digest,'ledger_proposal');
  exactDigest(row.parent_benchmark_digest,'ledger_parent_benchmark');
  exactDigest(row.proposed_benchmark_digest,'ledger_proposed_benchmark');
  exactDigest(row.trusted_runtime_digest,'ledger_trusted_runtime');
  exactDigest(row.active_verifier_root_digest,'ledger_active_verifier');
  exactDigest(row.anchor_set_digest,'ledger_anchor_set');
  exactDigest(row.heldout_anchor_digest,'ledger_heldout_anchor');
  exactDigest(row.mastery_certificate_digest,'ledger_mastery_certificate');
  exactDigest(row.anchor_recalibration_receipt_digest,'ledger_anchor_recalibration');
  exactDigest(row.provenance_admission_digest,'ledger_provenance_admission');
  const tasks=sortedUniqueDigests(row.task_digest_set,'ledger_task_digest');
  if(tasks.length!==positiveInt(row.task_count,'ledger_task_count',MAX_TASKS_PER_GENERATION))throw new Error('rsi_benchmark_coevolution_ledger_task_count_mismatch');
  const parent=nonNegativeInt(row.parent_generation,'ledger_parent_generation',MAX_GENERATIONS-1);
  const next=positiveInt(row.proposed_generation,'ledger_proposed_generation',MAX_GENERATIONS);
  if(next!==parent+1)throw new Error('rsi_benchmark_coevolution_ledger_generation_invalid');
  const clone=structuredClone(row);delete clone.admission_digest;
  if(digest(clone)!==exactDigest(row.admission_digest,'ledger_admission'))throw new Error('rsi_benchmark_coevolution_ledger_admission_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

function ledgerState(sourceSha,rows){
  const current=rows.length?rows[rows.length-1]:null;
  const core=zero({
    schema:RSI_BENCHMARK_COEVOLUTION_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    append_only:true,
    current_shadow_generation:current?current.proposed_generation:null,
    current_shadow_benchmark_digest:current?current.proposed_benchmark_digest:null,
    active_benchmark_digest:null,
    active_verifier_root_digest:null,
    ledger_can_activate_benchmark:false,
    ledger_can_replace_verifier:false,
    ledger_can_gate_canary:false,
    ledger_can_gate_promotion:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiBenchmarkCoevolutionLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_benchmark_coevolution_ledger_path_required');
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'ledger');
      if(parsed.schema!==RSI_BENCHMARK_COEVOLUTION_LEDGER_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha
        ||parsed.append_only!==true||parsed.active_benchmark_digest!==null||parsed.active_verifier_root_digest!==null
        ||parsed.ledger_can_activate_benchmark!==false||parsed.ledger_can_replace_verifier!==false
        ||parsed.ledger_can_gate_canary!==false||parsed.ledger_can_gate_promotion!==false
        ||parsed.candidate_can_delete!==false||parsed.candidate_can_rewrite!==false)throw new Error('rsi_benchmark_coevolution_ledger_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'ledger'))throw new Error('rsi_benchmark_coevolution_ledger_digest_mismatch');
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_GENERATIONS)throw new Error('rsi_benchmark_coevolution_ledger_rows_invalid');
      const checked=[];
      const ids=new Set();
      for(const raw of parsed.rows){
        const row=verifyStoredAdmission(raw);
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_benchmark_coevolution_ledger_source_mismatch');
        if(ids.has(row.admission_id))throw new Error('rsi_benchmark_coevolution_ledger_admission_duplicate');
        if(checked.length===0){
          if(row.parent_generation!==0)throw new Error('rsi_benchmark_coevolution_ledger_genesis_parent_generation_invalid');
        }else{
          const prev=checked[checked.length-1];
          if(row.parent_generation!==prev.proposed_generation||row.parent_benchmark_digest!==prev.proposed_benchmark_digest)throw new Error('rsi_benchmark_coevolution_ledger_lineage_discontinuity');
          if(row.trusted_runtime_digest!==prev.trusted_runtime_digest||row.active_verifier_root_digest!==prev.active_verifier_root_digest
            ||row.anchor_set_digest!==prev.anchor_set_digest||row.heldout_anchor_digest!==prev.heldout_anchor_digest)throw new Error('rsi_benchmark_coevolution_ledger_grounding_drift');
        }
        ids.add(row.admission_id);
        checked.push(row);
      }
      const canonical=ledgerState(this.#sourceSha,checked);
      if(parsed.current_shadow_generation!==canonical.current_shadow_generation
        ||parsed.current_shadow_benchmark_digest!==canonical.current_shadow_benchmark_digest)throw new Error('rsi_benchmark_coevolution_ledger_summary_mismatch');
      this.#rows=checked;
    }catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    this.#initialized=true;
    return this.snapshot();
  }
  async #persist(rows=this.#rows){
    const state=ledgerState(this.#sourceSha,rows);
    const tmp=`${this.#path}.tmp`;
    const h=await fs.open(tmp,'w',0o600);
    try{
      await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');
      await h.sync();
    }finally{
      await h.close();
    }
    await fs.rename(tmp,this.#path);
  }
  async add(admission){
    if(!this.#initialized)throw new Error('rsi_benchmark_coevolution_ledger_not_initialized');
    const row=verifyStoredAdmission(admission);
    if(row.source_sha!==this.#sourceSha)throw new Error('rsi_benchmark_coevolution_ledger_source_mismatch');
    const existing=this.#rows.find(x=>x.admission_id===row.admission_id||x.proposed_benchmark_digest===row.proposed_benchmark_digest);
    if(existing){
      if(existing.admission_digest!==row.admission_digest)throw new Error('rsi_benchmark_coevolution_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:row.admission_digest});
    }
    if(this.#rows.length>=MAX_GENERATIONS)throw new Error('rsi_benchmark_coevolution_ledger_capacity_exceeded');
    if(this.#rows.length===0){
      if(row.parent_generation!==0)throw new Error('rsi_benchmark_coevolution_ledger_genesis_parent_generation_invalid');
    }else{
      const prev=this.#rows[this.#rows.length-1];
      if(row.parent_generation!==prev.proposed_generation||row.parent_benchmark_digest!==prev.proposed_benchmark_digest)throw new Error('rsi_benchmark_coevolution_ledger_lineage_discontinuity');
      if(row.trusted_runtime_digest!==prev.trusted_runtime_digest||row.active_verifier_root_digest!==prev.active_verifier_root_digest
        ||row.anchor_set_digest!==prev.anchor_set_digest||row.heldout_anchor_digest!==prev.heldout_anchor_digest)throw new Error('rsi_benchmark_coevolution_ledger_grounding_drift');
    }
    const nextRows=[...this.#rows,structuredClone(row)];
    await this.#persist(nextRows);
    this.#rows=nextRows;
    return zero({state:row.state,admission_digest:row.admission_digest});
  }
  admissions(){
    if(!this.#initialized)throw new Error('rsi_benchmark_coevolution_ledger_not_initialized');
    return Object.freeze(this.#rows.map(x=>Object.freeze(structuredClone(x))));
  }
  snapshot(){
    const s=ledgerState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      row_count:s.row_count,current_shadow_generation:s.current_shadow_generation,
      current_shadow_benchmark_digest:s.current_shadow_benchmark_digest,
      active_benchmark_digest:null,active_verifier_root_digest:null,
      ledger_can_activate_benchmark:false,ledger_can_replace_verifier:false,
      ledger_can_gate_canary:false,ledger_can_gate_promotion:false,append_only:true,authority_effect:false,
    });
  }
}

export function rsiBenchmarkCoevolutionTrustRootSnapshot(){
  const policyRoots=currentPolicyRoots();
  const root={
    schema:'metaengine.rsi.benchmark-coevolution-root.v1',
    version:1,
    existing_benchmark_provenance_guard_reused:true,
    benchmark_provenance_root_digest:policyRoots.benchmark_provenance_root_digest,
    verifier_shadow_lifecycle_root_digest:policyRoots.verifier_shadow_lifecycle_root_digest,
    mastery_certificate_required:true,
    exact_generation_increment_required:true,
    stable_trusted_runtime_required:true,
    stable_active_verifier_required:true,
    stable_anchor_set_required:true,
    heldout_anchor_required:true,
    anchor_recalibration_required:true,
    task_quality_audit_required:true,
    semantic_construction_audit_required:true,
    no_op_ablation_required:true,
    environment_fidelity_audit_required:true,
    agentic_usability_audit_required:true,
    freshness_probe_required:true,
    zero_broken_tasks_required:true,
    raw_task_content_persisted:false,
    current_benchmark_remains_active:true,
    proposed_benchmark_shadow_only:true,
    candidate_can_author_benchmark:false,
    candidate_can_choose_tasks:false,
    candidate_can_choose_sources:false,
    candidate_can_choose_mastery_policy:false,
    candidate_can_choose_anchor:false,
    candidate_can_choose_verifier:false,
    candidate_can_choose_generation_transition:false,
    benchmark_activation_authorized:false,
    verifier_replacement_authorized:false,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,benchmark_coevolution_root_digest:digest(root)});
}
