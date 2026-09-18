import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_BENCHMARK_PROPOSAL_SCHEMA='metaengine.rsi.benchmark-generation-proposal.v1';
export const RSI_BENCHMARK_VALIDITY_RECEIPT_SCHEMA='metaengine.rsi.benchmark-validity-receipt.v1';
export const RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA='metaengine.rsi.benchmark-coevolution-admission.v1';
export const RSI_BENCHMARK_COEVOLUTION_LEDGER_SCHEMA='metaengine.rsi.benchmark-coevolution-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=512;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_benchmark_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_benchmark_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_benchmark_${l}_invalid`);return x;}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_benchmark_${l}_invalid`);return n;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_benchmark_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_benchmark_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}

export function createRsiBenchmarkGenerationProposal({
  proposal_id,
  source_sha,
  generation_index,
  parent_generation_digest,
  proposed_generation_digest,
  incumbent_verifier_root_digest,
  trusted_runtime_digest,
  anchor_set_digest,
  previous_mastery_receipt_digest,
  task_distribution_digest,
  difficulty_delta_digest,
  mastery_threshold_met,
  difficulty_increase_certified,
  external_curriculum_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_curriculum_owner!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_external_curriculum_owner_required');
  const roots=[
    exactDigest(parent_generation_digest,'parent_generation'),
    exactDigest(proposed_generation_digest,'proposed_generation'),
    exactDigest(incumbent_verifier_root_digest,'incumbent_verifier'),
    exactDigest(trusted_runtime_digest,'trusted_runtime'),
    exactDigest(anchor_set_digest,'anchor_set'),
    exactDigest(previous_mastery_receipt_digest,'mastery_receipt'),
    exactDigest(task_distribution_digest,'task_distribution'),
    exactDigest(difficulty_delta_digest,'difficulty_delta'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_benchmark_independent_roots_required');
  if(mastery_threshold_met!==true||difficulty_increase_certified!==true)throw new Error('rsi_benchmark_mastery_throttle_required');
  const core=zero({
    schema:RSI_BENCHMARK_PROPOSAL_SCHEMA,
    version:1,
    proposal_id:id(proposal_id,'proposal_id'),
    source_sha:exactSha(source_sha,'source'),
    generation_index:positiveInt(generation_index,'generation_index'),
    parent_generation_digest:roots[0],
    proposed_generation_digest:roots[1],
    incumbent_verifier_root_digest:roots[2],
    trusted_runtime_digest:roots[3],
    anchor_set_digest:roots[4],
    previous_mastery_receipt_digest:roots[5],
    task_distribution_digest:roots[6],
    difficulty_delta_digest:roots[7],
    mastery_threshold_met:true,
    difficulty_increase_certified:true,
    mastery_throttled:true,
    external_curriculum_owner:true,
    authored_by_candidate:false,
    candidate_can_choose_tasks:false,
    candidate_can_choose_difficulty:false,
    candidate_can_modify_incumbent_verifier:false,
    candidate_can_modify_trusted_runtime:false,
    proposal_changes_active_benchmark:false,
    external_validity_receipt_required:true,
  });
  return Object.freeze({...core,proposal_digest:digest(core)});
}

export function verifyRsiBenchmarkGenerationProposal(proposal){
  if(!proposal||proposal.schema!==RSI_BENCHMARK_PROPOSAL_SCHEMA||proposal.version!==1)throw new Error('rsi_benchmark_proposal_invalid');
  assertZero(proposal,'proposal');
  if(proposal.mastery_threshold_met!==true||proposal.difficulty_increase_certified!==true||proposal.mastery_throttled!==true
    ||proposal.external_curriculum_owner!==true||proposal.authored_by_candidate!==false
    ||proposal.candidate_can_choose_tasks!==false||proposal.candidate_can_choose_difficulty!==false
    ||proposal.candidate_can_modify_incumbent_verifier!==false||proposal.candidate_can_modify_trusted_runtime!==false
    ||proposal.proposal_changes_active_benchmark!==false||proposal.external_validity_receipt_required!==true)throw new Error('rsi_benchmark_proposal_policy_invalid');
  const canonical=createRsiBenchmarkGenerationProposal({
    proposal_id:proposal.proposal_id,source_sha:proposal.source_sha,generation_index:proposal.generation_index,
    parent_generation_digest:proposal.parent_generation_digest,proposed_generation_digest:proposal.proposed_generation_digest,
    incumbent_verifier_root_digest:proposal.incumbent_verifier_root_digest,trusted_runtime_digest:proposal.trusted_runtime_digest,
    anchor_set_digest:proposal.anchor_set_digest,previous_mastery_receipt_digest:proposal.previous_mastery_receipt_digest,
    task_distribution_digest:proposal.task_distribution_digest,difficulty_delta_digest:proposal.difficulty_delta_digest,
    mastery_threshold_met:true,difficulty_increase_certified:true,external_curriculum_owner:true,authored_by_candidate:false,
  });
  if(canonical.proposal_digest!==exactDigest(proposal.proposal_digest,'proposal'))throw new Error('rsi_benchmark_proposal_digest_mismatch');
  return canonical;
}

export function createRsiBenchmarkValidityReceipt({
  receipt_id,
  proposal,
  sealed_task_audit_digest,
  contamination_probe_digest,
  prompt_test_alignment_digest,
  semantic_coverage_audit_digest,
  noop_ablation_digest,
  anchor_recalibration_digest,
  hidden_holdout_digest,
  contamination_clear,
  broken_task_audit_pass,
  prompt_test_alignment_pass,
  semantic_coverage_pass,
  noop_ablation_pass,
  anchor_recalibration_pass,
  hidden_holdout_pass,
  incumbent_score_comparable,
  external_benchmark_auditor=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyRsiBenchmarkGenerationProposal(proposal);
  if(external_benchmark_auditor!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_external_auditor_required');
  const roots=[
    exactDigest(sealed_task_audit_digest,'sealed_task_audit'),
    exactDigest(contamination_probe_digest,'contamination_probe'),
    exactDigest(prompt_test_alignment_digest,'prompt_test_alignment'),
    exactDigest(semantic_coverage_audit_digest,'semantic_coverage'),
    exactDigest(noop_ablation_digest,'noop_ablation'),
    exactDigest(anchor_recalibration_digest,'anchor_recalibration'),
    exactDigest(hidden_holdout_digest,'hidden_holdout'),
    checked.anchor_set_digest,
    checked.proposed_generation_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_benchmark_validity_roots_must_be_independent');
  const blockers=[];
  if(contamination_clear!==true)blockers.push('CONTAMINATION_DETECTED');
  if(broken_task_audit_pass!==true)blockers.push('BROKEN_TASKS_DETECTED');
  if(prompt_test_alignment_pass!==true)blockers.push('PROMPT_TEST_MISALIGNMENT');
  if(semantic_coverage_pass!==true)blockers.push('SEMANTIC_COVERAGE_FAILURE');
  if(noop_ablation_pass!==true)blockers.push('NOOP_ABLATION_FAILURE');
  if(anchor_recalibration_pass!==true)blockers.push('ANCHOR_RECALIBRATION_FAILURE');
  if(hidden_holdout_pass!==true)blockers.push('HIDDEN_HOLDOUT_FAILURE');
  if(incumbent_score_comparable!==true)blockers.push('LONGITUDINAL_COMPARABILITY_FAILURE');
  const core=zero({
    schema:RSI_BENCHMARK_VALIDITY_RECEIPT_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:checked.source_sha,
    proposal_digest:checked.proposal_digest,
    generation_index:checked.generation_index,
    parent_generation_digest:checked.parent_generation_digest,
    proposed_generation_digest:checked.proposed_generation_digest,
    incumbent_verifier_root_digest:checked.incumbent_verifier_root_digest,
    trusted_runtime_digest:checked.trusted_runtime_digest,
    anchor_set_digest:checked.anchor_set_digest,
    sealed_task_audit_digest:roots[0],
    contamination_probe_digest:roots[1],
    prompt_test_alignment_digest:roots[2],
    semantic_coverage_audit_digest:roots[3],
    noop_ablation_digest:roots[4],
    anchor_recalibration_digest:roots[5],
    hidden_holdout_digest:roots[6],
    contamination_clear:contamination_clear===true,
    broken_task_audit_pass:broken_task_audit_pass===true,
    prompt_test_alignment_pass:prompt_test_alignment_pass===true,
    semantic_coverage_pass:semantic_coverage_pass===true,
    noop_ablation_pass:noop_ablation_pass===true,
    anchor_recalibration_pass:anchor_recalibration_pass===true,
    hidden_holdout_pass:hidden_holdout_pass===true,
    incumbent_score_comparable:incumbent_score_comparable===true,
    blockers:Object.freeze(blockers.sort()),
    clean_validity_evidence:blockers.length===0,
    external_benchmark_auditor:true,
    authored_by_candidate:false,
    candidate_can_read_hidden_holdout:false,
    candidate_can_read_contamination_probe:false,
    candidate_can_rewrite_anchor_recalibration:false,
    candidate_can_self_validate_benchmark:false,
    receipt_changes_active_benchmark:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiBenchmarkValidityReceipt(receipt,{proposal}={}){
  if(!receipt||receipt.schema!==RSI_BENCHMARK_VALIDITY_RECEIPT_SCHEMA||receipt.version!==1)throw new Error('rsi_benchmark_validity_receipt_invalid');
  assertZero(receipt,'validity_receipt');
  if(receipt.external_benchmark_auditor!==true||receipt.authored_by_candidate!==false
    ||receipt.candidate_can_read_hidden_holdout!==false||receipt.candidate_can_read_contamination_probe!==false
    ||receipt.candidate_can_rewrite_anchor_recalibration!==false||receipt.candidate_can_self_validate_benchmark!==false
    ||receipt.receipt_changes_active_benchmark!==false)throw new Error('rsi_benchmark_validity_receipt_policy_invalid');
  const canonical=createRsiBenchmarkValidityReceipt({
    receipt_id:receipt.receipt_id,proposal,
    sealed_task_audit_digest:receipt.sealed_task_audit_digest,
    contamination_probe_digest:receipt.contamination_probe_digest,
    prompt_test_alignment_digest:receipt.prompt_test_alignment_digest,
    semantic_coverage_audit_digest:receipt.semantic_coverage_audit_digest,
    noop_ablation_digest:receipt.noop_ablation_digest,
    anchor_recalibration_digest:receipt.anchor_recalibration_digest,
    hidden_holdout_digest:receipt.hidden_holdout_digest,
    contamination_clear:receipt.contamination_clear,
    broken_task_audit_pass:receipt.broken_task_audit_pass,
    prompt_test_alignment_pass:receipt.prompt_test_alignment_pass,
    semantic_coverage_pass:receipt.semantic_coverage_pass,
    noop_ablation_pass:receipt.noop_ablation_pass,
    anchor_recalibration_pass:receipt.anchor_recalibration_pass,
    hidden_holdout_pass:receipt.hidden_holdout_pass,
    incumbent_score_comparable:receipt.incumbent_score_comparable,
    external_benchmark_auditor:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'validity_receipt'))throw new Error('rsi_benchmark_validity_receipt_digest_mismatch');
  return canonical;
}

export function createRsiBenchmarkCoevolutionAdmission({
  admission_id,
  proposal,
  receipt,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_external_admission_owner_required');
  const checkedProposal=verifyRsiBenchmarkGenerationProposal(proposal);
  const checkedReceipt=verifyRsiBenchmarkValidityReceipt(receipt,{proposal:checkedProposal});
  const pass=checkedReceipt.clean_validity_evidence===true&&checkedReceipt.blockers.length===0;
  const core=zero({
    schema:RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA,
    version:1,
    admission_id:id(admission_id,'admission_id'),
    source_sha:checkedProposal.source_sha,
    proposal_digest:checkedProposal.proposal_digest,
    receipt_digest:checkedReceipt.receipt_digest,
    generation_index:checkedProposal.generation_index,
    parent_generation_digest:checkedProposal.parent_generation_digest,
    proposed_generation_digest:checkedProposal.proposed_generation_digest,
    incumbent_verifier_root_digest:checkedProposal.incumbent_verifier_root_digest,
    trusted_runtime_digest:checkedProposal.trusted_runtime_digest,
    anchor_set_digest:checkedProposal.anchor_set_digest,
    state:pass?'QUALIFIED_FOR_BENCHMARK_SHADOW':'BENCHMARK_COEVOLUTION_REJECTED',
    qualified_for_benchmark_shadow:pass,
    active_benchmark_unchanged:true,
    benchmark_shadow_observation_only:true,
    benchmark_shadow_can_change_training:false,
    benchmark_shadow_can_gate_canary:false,
    benchmark_shadow_can_gate_promotion:false,
    candidate_can_self_activate_generation:false,
    candidate_can_rewrite_history:false,
    external_activation_gate_required:true,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiBenchmarkCoevolutionAdmission(admission,{proposal,receipt}={}){
  if(!admission||admission.schema!==RSI_BENCHMARK_COEVOLUTION_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_benchmark_admission_invalid');
  assertZero(admission,'admission');
  if(admission.active_benchmark_unchanged!==true||admission.benchmark_shadow_observation_only!==true
    ||admission.benchmark_shadow_can_change_training!==false||admission.benchmark_shadow_can_gate_canary!==false
    ||admission.benchmark_shadow_can_gate_promotion!==false||admission.candidate_can_self_activate_generation!==false
    ||admission.candidate_can_rewrite_history!==false||admission.external_activation_gate_required!==true
    ||admission.external_admission_owner!==true||admission.authored_by_candidate!==false)throw new Error('rsi_benchmark_admission_policy_invalid');
  const canonical=createRsiBenchmarkCoevolutionAdmission({
    admission_id:admission.admission_id,proposal,receipt,external_admission_owner:true,authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(admission.admission_digest,'admission'))throw new Error('rsi_benchmark_admission_digest_mismatch');
  return canonical;
}

function verifyStoredBenchmarkRow(row,sourceSha){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_benchmark_ledger_row_invalid');
  const p=verifyRsiBenchmarkGenerationProposal(row.proposal);
  const r=verifyRsiBenchmarkValidityReceipt(row.receipt,{proposal:p});
  const a=verifyRsiBenchmarkCoevolutionAdmission(row.admission,{proposal:p,receipt:r});
  const expectedSource=exactSha(sourceSha,'ledger_source');
  if(row.source_sha!==expectedSource||p.source_sha!==expectedSource||r.source_sha!==expectedSource||a.source_sha!==expectedSource){
    throw new Error('rsi_benchmark_ledger_source_mismatch');
  }
  if(r.proposal_digest!==p.proposal_digest||a.proposal_digest!==p.proposal_digest||a.receipt_digest!==r.receipt_digest){
    throw new Error('rsi_benchmark_ledger_binding_mismatch');
  }
  return Object.freeze({
    source_sha:expectedSource,
    proposal:structuredClone(p),
    receipt:structuredClone(r),
    admission:structuredClone(a),
  });
}

function ledgerState(sourceSha,rows){
  const core=zero({
    schema:RSI_BENCHMARK_COEVOLUTION_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    qualified_count:rows.filter(r=>r.admission.qualified_for_benchmark_shadow===true).length,
    append_only:true,
    active_generation_digest:null,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
    ledger_can_activate_generation:false,
    ledger_can_change_training_distribution:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiBenchmarkCoevolutionLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_benchmark_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'ledger_source');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');
      if(p.schema!==RSI_BENCHMARK_COEVOLUTION_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.active_generation_digest!==null||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false
        ||p.ledger_can_activate_generation!==false||p.ledger_can_change_training_distribution!==false)throw new Error('rsi_benchmark_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_benchmark_ledger_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_benchmark_ledger_rows_invalid');
      const generations=new Set();
      const proposalIds=new Set();
      const admissionIds=new Set();
      const checkedRows=p.rows.map((row)=>{
        const checked=verifyStoredBenchmarkRow(row,this.#sourceSha);
        if(generations.has(checked.proposal.proposed_generation_digest))throw new Error('rsi_benchmark_ledger_generation_duplicate');
        if(proposalIds.has(checked.proposal.proposal_id))throw new Error('rsi_benchmark_ledger_proposal_duplicate');
        if(admissionIds.has(checked.admission.admission_id))throw new Error('rsi_benchmark_ledger_admission_duplicate');
        generations.add(checked.proposal.proposed_generation_digest);
        proposalIds.add(checked.proposal.proposal_id);
        admissionIds.add(checked.admission.admission_id);
        return checked;
      });
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows=this.#rows){const s=ledgerState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add({proposal,receipt,admission}={}){
    if(!this.#initialized)throw new Error('rsi_benchmark_ledger_not_initialized');
    const p=verifyRsiBenchmarkGenerationProposal(proposal);
    const r=verifyRsiBenchmarkValidityReceipt(receipt,{proposal:p});
    const a=verifyRsiBenchmarkCoevolutionAdmission(admission,{proposal:p,receipt:r});
    if(p.source_sha!==this.#sourceSha||r.source_sha!==this.#sourceSha||a.source_sha!==this.#sourceSha)throw new Error('rsi_benchmark_ledger_source_mismatch');
    const existing=this.#rows.find(x=>x.proposal.proposed_generation_digest===p.proposed_generation_digest);
    if(existing){
      if(existing.proposal.proposal_digest!==p.proposal_digest||existing.receipt.receipt_digest!==r.receipt_digest||existing.admission.admission_digest!==a.admission_digest)throw new Error('rsi_benchmark_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:a.admission_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_benchmark_ledger_capacity_exceeded');
    const nextRow=verifyStoredBenchmarkRow({
      source_sha:this.#sourceSha,
      proposal:structuredClone(p),
      receipt:structuredClone(r),
      admission:structuredClone(a),
    },this.#sourceSha);
    const preview=Object.freeze([...this.#rows,nextRow]);
    await this.#persist(preview);
    this.#rows=preview;
    return zero({state:a.state,admission_digest:a.admission_digest});
  }
  qualified(){if(!this.#initialized)throw new Error('rsi_benchmark_ledger_not_initialized');return Object.freeze(this.#rows.filter(r=>r.admission.qualified_for_benchmark_shadow===true).map(r=>Object.freeze(structuredClone(r.admission))));}
  snapshot(){const s=ledgerState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,qualified_count:s.qualified_count,append_only:true,active_generation_digest:null,ledger_can_activate_generation:false,ledger_can_change_training_distribution:false,authority_effect:false});}
}

export function rsiBenchmarkCoevolutionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.benchmark-coevolution-root.v1',
    version:1,
    mastery_throttled_curriculum_required:true,
    external_curriculum_owner_required:true,
    incumbent_verifier_fixed_during_generation_review:true,
    trusted_runtime_fixed_during_generation_review:true,
    anchor_recalibration_required:true,
    hidden_holdout_required:true,
    contamination_probe_required:true,
    broken_task_audit_required:true,
    prompt_test_alignment_required:true,
    semantic_coverage_audit_required:true,
    noop_ablation_required:true,
    longitudinal_comparability_required:true,
    append_only_generation_history_required:true,
    candidate_can_choose_tasks:false,
    candidate_can_choose_difficulty:false,
    candidate_can_self_validate_benchmark:false,
    candidate_can_self_activate_generation:false,
    active_benchmark_unchanged:true,
    benchmark_shadow_observation_only:true,
    ledger_can_change_training_distribution:false,
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
