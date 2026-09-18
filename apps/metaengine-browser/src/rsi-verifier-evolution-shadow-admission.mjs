import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_VERIFIER_EVOLUTION_CANDIDATE_SCHEMA='metaengine.rsi.verifier-evolution-candidate.v1';
export const RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA='metaengine.rsi.verifier-evolution-external-receipt.v1';
export const RSI_VERIFIER_EVOLUTION_SHADOW_ADMISSION_SCHEMA='metaengine.rsi.verifier-evolution-shadow-admission.v1';
export const RSI_VERIFIER_EVOLUTION_SHADOW_LEDGER_SCHEMA='metaengine.rsi.verifier-evolution-shadow-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const ROLES=new Set(['PREDECESSOR','SECONDARY']);
const MAX_ROWS=512;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function sha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_sha_invalid`);return x}
function dg(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_verifier_evolution_${l}_invalid`);return x}
function count(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw new Error(`rsi_verifier_evolution_${l}_invalid`);return n}
function score(v,l){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new Error(`rsi_verifier_evolution_${l}_invalid`);return n}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_verifier_evolution_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_verifier_evolution_${l}_retry_invalid`)}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>64)throw new Error('rsi_verifier_evolution_evidence_refs_invalid');const out=[...new Set(v.map(x=>id(x,'evidence_ref')))].sort();if(out.length!==v.length)throw new Error('rsi_verifier_evolution_evidence_ref_duplicate');return Object.freeze(out)}

export function createRsiVerifierEvolutionCandidate({
  source_sha,candidate_id,predecessor_verifier_root_digest,candidate_verifier_root_digest,
  constitution_digest,candidate_package_digest,training_evidence_digest,self_authored_eval_digest,
  external_candidate_builder=false,authored_by_candidate=true,
}={}){
  if(external_candidate_builder!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_external_builder_required');
  const predecessor=dg(predecessor_verifier_root_digest,'predecessor_root');
  const candidate=dg(candidate_verifier_root_digest,'candidate_root');
  if(predecessor===candidate)throw new Error('rsi_verifier_evolution_candidate_must_differ_from_predecessor');
  const core={
    schema:RSI_VERIFIER_EVOLUTION_CANDIDATE_SCHEMA,version:1,source_sha:sha(source_sha,'source'),
    candidate_id:id(candidate_id,'candidate_id'),predecessor_verifier_root_digest:predecessor,
    candidate_verifier_root_digest:candidate,constitution_digest:dg(constitution_digest,'constitution'),
    candidate_package_digest:dg(candidate_package_digest,'candidate_package'),
    training_evidence_digest:dg(training_evidence_digest,'training_evidence'),
    self_authored_eval_digest:dg(self_authored_eval_digest,'self_authored_eval'),
    mode:'VERIFIER_SHADOW_ONLY',
    self_authored_evaluation_is_advisory:true,
    candidate_can_choose_hidden_suites:false,
    candidate_can_choose_acceptance_thresholds:false,
    candidate_can_replace_predecessor:false,
    candidate_can_change_constitution:false,
    active_verifier_remains_predecessor:true,
    external_candidate_builder:true,authored_by_candidate:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,candidate_digest:digest(core)});
}

export function verifyRsiVerifierEvolutionCandidate(row){
  if(!row||row.schema!==RSI_VERIFIER_EVOLUTION_CANDIDATE_SCHEMA||row.version!==1)throw new Error('rsi_verifier_evolution_candidate_invalid');
  assertZero(row,'candidate');
  if(row.mode!=='VERIFIER_SHADOW_ONLY'||row.self_authored_evaluation_is_advisory!==true
    ||row.candidate_can_choose_hidden_suites!==false||row.candidate_can_choose_acceptance_thresholds!==false
    ||row.candidate_can_replace_predecessor!==false||row.candidate_can_change_constitution!==false
    ||row.active_verifier_remains_predecessor!==true||row.external_candidate_builder!==true||row.authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_candidate_policy_invalid');
  const canonical=createRsiVerifierEvolutionCandidate({
    source_sha:row.source_sha,candidate_id:row.candidate_id,
    predecessor_verifier_root_digest:row.predecessor_verifier_root_digest,
    candidate_verifier_root_digest:row.candidate_verifier_root_digest,
    constitution_digest:row.constitution_digest,candidate_package_digest:row.candidate_package_digest,
    training_evidence_digest:row.training_evidence_digest,self_authored_eval_digest:row.self_authored_eval_digest,
    external_candidate_builder:true,authored_by_candidate:false,
  });
  if(canonical.candidate_digest!==dg(row.candidate_digest,'candidate'))throw new Error('rsi_verifier_evolution_candidate_digest_mismatch');
  return canonical;
}

export function createRsiVerifierEvolutionExternalReceipt({
  receipt_id,candidate,evaluator_role,evaluator_root_digest,hidden_suite_root_digest,
  hidden_acceptance_digest,sabotage_suite_digest,transfer_holdout_digest,trajectory_integrity_digest,
  legibility_holdout_digest,challenge_archive_digest,
  acceptance_pass,sabotage_pass,transfer_pass,trajectory_integrity_pass,legibility_pass,
  monitorability_nonregression_pass,constitution_match,identity_match,
  discovered_exploit_count=0,sabotage_signal_count=0,ambiguous_case_count=0,
  verdict,evidence_refs,external_evaluator=false,authored_by_candidate=true,
}={}){
  const c=verifyRsiVerifierEvolutionCandidate(candidate);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_external_evaluator_required');
  const role=String(evaluator_role||'').trim().toUpperCase();
  if(!ROLES.has(role))throw new Error('rsi_verifier_evolution_evaluator_role_invalid');
  const evaluator=dg(evaluator_root_digest,'evaluator_root');
  if(evaluator===c.candidate_verifier_root_digest)throw new Error('rsi_verifier_evolution_candidate_cannot_self_verify');
  if(role==='PREDECESSOR'&&evaluator!==c.predecessor_verifier_root_digest)throw new Error('rsi_verifier_evolution_predecessor_root_mismatch');
  const exploits=count(discovered_exploit_count,'discovered_exploit_count');
  const sabotage=count(sabotage_signal_count,'sabotage_signal_count');
  const ambiguous=count(ambiguous_case_count,'ambiguous_case_count');
  const normalizedVerdict=String(verdict||'').trim().toUpperCase();
  if(!['PASS','FAIL'].includes(normalizedVerdict))throw new Error('rsi_verifier_evolution_verdict_invalid');
  const pass=acceptance_pass===true&&sabotage_pass===true&&transfer_pass===true&&trajectory_integrity_pass===true
    &&legibility_pass===true&&monitorability_nonregression_pass===true&&constitution_match===true&&identity_match===true
    &&exploits===0&&sabotage===0&&ambiguous===0;
  if((normalizedVerdict==='PASS')!==pass)throw new Error('rsi_verifier_evolution_verdict_evidence_mismatch');
  const core={
    schema:RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA,version:1,source_sha:c.source_sha,
    receipt_id:id(receipt_id,'receipt_id'),candidate_id:c.candidate_id,candidate_digest:c.candidate_digest,
    candidate_verifier_root_digest:c.candidate_verifier_root_digest,
    predecessor_verifier_root_digest:c.predecessor_verifier_root_digest,
    constitution_digest:c.constitution_digest,evaluator_role:role,evaluator_root_digest:evaluator,
    hidden_suite_root_digest:dg(hidden_suite_root_digest,'hidden_suite_root'),
    hidden_acceptance_digest:dg(hidden_acceptance_digest,'hidden_acceptance'),
    sabotage_suite_digest:dg(sabotage_suite_digest,'sabotage_suite'),
    transfer_holdout_digest:dg(transfer_holdout_digest,'transfer_holdout'),
    trajectory_integrity_digest:dg(trajectory_integrity_digest,'trajectory_integrity'),
    legibility_holdout_digest:dg(legibility_holdout_digest,'legibility_holdout'),
    challenge_archive_digest:dg(challenge_archive_digest,'challenge_archive'),
    acceptance_pass:acceptance_pass===true,sabotage_pass:sabotage_pass===true,transfer_pass:transfer_pass===true,
    trajectory_integrity_pass:trajectory_integrity_pass===true,legibility_pass:legibility_pass===true,
    monitorability_nonregression_pass:monitorability_nonregression_pass===true,
    constitution_match:constitution_match===true,identity_match:identity_match===true,
    discovered_exploit_count:exploits,sabotage_signal_count:sabotage,ambiguous_case_count:ambiguous,
    verdict:normalizedVerdict,evidence_refs:refs(evidence_refs),
    hidden_suites_visible_to_candidate:false,receipt_authored_by_candidate:false,
    receipt_is_verifier_replacement_authority:false,receipt_is_promotion_authority:false,
    external_evaluator:true,authored_by_candidate:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiVerifierEvolutionExternalReceipt(row,{candidate}={}){
  if(!row||row.schema!==RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_verifier_evolution_receipt_invalid');
  assertZero(row,'receipt');
  if(row.hidden_suites_visible_to_candidate!==false||row.receipt_authored_by_candidate!==false
    ||row.receipt_is_verifier_replacement_authority!==false||row.receipt_is_promotion_authority!==false
    ||row.external_evaluator!==true||row.authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_receipt_policy_invalid');
  const canonical=createRsiVerifierEvolutionExternalReceipt({
    receipt_id:row.receipt_id,candidate,evaluator_role:row.evaluator_role,evaluator_root_digest:row.evaluator_root_digest,
    hidden_suite_root_digest:row.hidden_suite_root_digest,hidden_acceptance_digest:row.hidden_acceptance_digest,
    sabotage_suite_digest:row.sabotage_suite_digest,transfer_holdout_digest:row.transfer_holdout_digest,
    trajectory_integrity_digest:row.trajectory_integrity_digest,legibility_holdout_digest:row.legibility_holdout_digest,
    challenge_archive_digest:row.challenge_archive_digest,acceptance_pass:row.acceptance_pass,sabotage_pass:row.sabotage_pass,
    transfer_pass:row.transfer_pass,trajectory_integrity_pass:row.trajectory_integrity_pass,legibility_pass:row.legibility_pass,
    monitorability_nonregression_pass:row.monitorability_nonregression_pass,constitution_match:row.constitution_match,
    identity_match:row.identity_match,discovered_exploit_count:row.discovered_exploit_count,
    sabotage_signal_count:row.sabotage_signal_count,ambiguous_case_count:row.ambiguous_case_count,
    verdict:row.verdict,evidence_refs:row.evidence_refs,external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==dg(row.receipt_digest,'receipt'))throw new Error('rsi_verifier_evolution_receipt_digest_mismatch');
  return canonical;
}

export function createRsiVerifierEvolutionShadowAdmission({
  admission_id,candidate,predecessor_receipt,secondary_receipt,
  external_admission_owner=false,authored_by_candidate=true,
}={}){
  const c=verifyRsiVerifierEvolutionCandidate(candidate);
  const predecessor=verifyRsiVerifierEvolutionExternalReceipt(predecessor_receipt,{candidate:c});
  const secondary=verifyRsiVerifierEvolutionExternalReceipt(secondary_receipt,{candidate:c});
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_external_admission_owner_required');
  if(predecessor.evaluator_role!=='PREDECESSOR'||secondary.evaluator_role!=='SECONDARY')throw new Error('rsi_verifier_evolution_dual_receipt_roles_required');
  if(secondary.evaluator_root_digest===predecessor.evaluator_root_digest
    ||secondary.evaluator_root_digest===c.candidate_verifier_root_digest
    ||secondary.evaluator_root_digest===c.predecessor_verifier_root_digest)throw new Error('rsi_verifier_evolution_secondary_root_not_independent');
  for(const field of ['candidate_digest','candidate_verifier_root_digest','predecessor_verifier_root_digest','constitution_digest',
    'hidden_suite_root_digest','hidden_acceptance_digest','sabotage_suite_digest','transfer_holdout_digest',
    'trajectory_integrity_digest','legibility_holdout_digest','challenge_archive_digest']){
    if(predecessor[field]!==secondary[field])throw new Error(`rsi_verifier_evolution_dual_receipt_${field}_mismatch`);
  }
  const receiptsAgree=predecessor.verdict===secondary.verdict;
  const clean=receiptsAgree&&predecessor.verdict==='PASS'&&secondary.verdict==='PASS';
  const core={
    schema:RSI_VERIFIER_EVOLUTION_SHADOW_ADMISSION_SCHEMA,version:1,source_sha:c.source_sha,
    admission_id:id(admission_id,'admission_id'),candidate_id:c.candidate_id,candidate_digest:c.candidate_digest,
    candidate_verifier_root_digest:c.candidate_verifier_root_digest,
    predecessor_verifier_root_digest:c.predecessor_verifier_root_digest,
    secondary_verifier_root_digest:secondary.evaluator_root_digest,
    constitution_digest:c.constitution_digest,hidden_suite_root_digest:predecessor.hidden_suite_root_digest,
    challenge_archive_digest:predecessor.challenge_archive_digest,
    predecessor_receipt_digest:predecessor.receipt_digest,secondary_receipt_digest:secondary.receipt_digest,
    receipts_agree:receiptsAgree,predecessor_verdict:predecessor.verdict,secondary_verdict:secondary.verdict,
    state:clean?'QUALIFIED_FOR_VERIFIER_SHADOW_ONLY':'VERIFIER_EVOLUTION_REJECTED',
    qualified_for_verifier_shadow_only:clean,
    active_verifier_remains_predecessor:true,
    candidate_verifier_shadow_only:true,
    candidate_can_replace_active_verifier:false,
    verifier_replacement_authorized:false,
    verifier_activation_authorized:false,
    promotion_review_still_required:true,
    disagreement_fails_closed:true,
    hidden_suite_failure_fails_closed:true,
    sabotage_signal_fails_closed:true,
    monitorability_regression_fails_closed:true,
    challenge_archive_is_append_only_evidence:true,
    automatic_counterexample_training_authorized:false,
    external_admission_owner:true,authored_by_candidate:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiVerifierEvolutionShadowAdmission(row,{candidate,predecessor_receipt,secondary_receipt}={}){
  if(!row||row.schema!==RSI_VERIFIER_EVOLUTION_SHADOW_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_verifier_evolution_admission_invalid');
  assertZero(row,'admission');
  if(row.active_verifier_remains_predecessor!==true||row.candidate_verifier_shadow_only!==true
    ||row.candidate_can_replace_active_verifier!==false||row.verifier_replacement_authorized!==false
    ||row.verifier_activation_authorized!==false||row.promotion_review_still_required!==true
    ||row.disagreement_fails_closed!==true||row.hidden_suite_failure_fails_closed!==true
    ||row.sabotage_signal_fails_closed!==true||row.monitorability_regression_fails_closed!==true
    ||row.challenge_archive_is_append_only_evidence!==true||row.automatic_counterexample_training_authorized!==false
    ||row.external_admission_owner!==true||row.authored_by_candidate!==false)throw new Error('rsi_verifier_evolution_admission_policy_invalid');
  const canonical=createRsiVerifierEvolutionShadowAdmission({
    admission_id:row.admission_id,candidate,predecessor_receipt,secondary_receipt,
    external_admission_owner:true,authored_by_candidate:false,
  });
  if(canonical.admission_digest!==dg(row.admission_digest,'admission'))throw new Error('rsi_verifier_evolution_admission_digest_mismatch');
  return canonical;
}

function verifyStoredCandidate(row){
  const clone=structuredClone(row);delete clone.candidate_digest;
  if(digest(clone)!==dg(row.candidate_digest,'candidate'))throw new Error('rsi_verifier_evolution_candidate_digest_mismatch');
  return verifyRsiVerifierEvolutionCandidate(row);
}
function verifyStoredReceipt(row){
  if(!row||row.schema!==RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_verifier_evolution_receipt_invalid');
  assertZero(row,'receipt');
  const clone=structuredClone(row);delete clone.receipt_digest;
  if(digest(clone)!==dg(row.receipt_digest,'receipt'))throw new Error('rsi_verifier_evolution_receipt_digest_mismatch');
  return Object.freeze(structuredClone(row));
}
function verifyStoredAdmission(row){
  if(!row||row.schema!==RSI_VERIFIER_EVOLUTION_SHADOW_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_verifier_evolution_admission_invalid');
  assertZero(row,'admission');
  const clone=structuredClone(row);delete clone.admission_digest;
  if(digest(clone)!==dg(row.admission_digest,'admission'))throw new Error('rsi_verifier_evolution_admission_digest_mismatch');
  return Object.freeze(structuredClone(row));
}
function state(sourceSha,rows){
  const core={schema:RSI_VERIFIER_EVOLUTION_SHADOW_LEDGER_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,
    qualified_count:rows.filter(x=>x.admission.qualified_for_verifier_shadow_only===true).length,append_only:true,
    active_verifier_root_digest:null,ledger_can_replace_verifier:false,ledger_can_activate_verifier:false,
    candidate_can_delete:false,candidate_can_rewrite:false,candidate_can_clear_negative_evidence:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    automatic_retry_allowed:false,authority_effect:false};
  return {...core,state_digest:digest(core)};
}

export class RsiVerifierEvolutionShadowLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_verifier_evolution_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=sha(source_sha,'source')}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');
      if(p.schema!==RSI_VERIFIER_EVOLUTION_SHADOW_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.ledger_can_replace_verifier!==false||p.ledger_can_activate_verifier!==false
        ||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false||p.candidate_can_clear_negative_evidence!==false
        ||!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_verifier_evolution_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==dg(p.state_digest,'ledger'))throw new Error('rsi_verifier_evolution_ledger_digest_mismatch');
      this.#rows=p.rows.map(row=>{
        if(!row||typeof row!=='object'||!row.candidate||!row.predecessor_receipt||!row.secondary_receipt||!row.admission)throw new Error('rsi_verifier_evolution_ledger_row_invalid');
        const candidate=verifyStoredCandidate(row.candidate);
        const predecessor=verifyRsiVerifierEvolutionExternalReceipt(row.predecessor_receipt,{candidate});
        const secondary=verifyRsiVerifierEvolutionExternalReceipt(row.secondary_receipt,{candidate});
        const admission=verifyRsiVerifierEvolutionShadowAdmission(row.admission,{
          candidate,
          predecessor_receipt:predecessor,
          secondary_receipt:secondary,
        });
        if(candidate.source_sha!==this.#sourceSha||admission.source_sha!==this.#sourceSha
          ||predecessor.source_sha!==this.#sourceSha||secondary.source_sha!==this.#sourceSha)throw new Error('rsi_verifier_evolution_ledger_source_mismatch');
        return Object.freeze({candidate,predecessor_receipt:predecessor,secondary_receipt:secondary,admission});
      });
    }catch(e){if(e?.code!=='ENOENT')throw e}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const s=state(this.#sourceSha,rows);const t=`${this.#path}.tmp`;const h=await fs.open(t,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}
    await fs.rename(t,this.#path);
  }
  async add({candidate,predecessor_receipt,secondary_receipt,admission}={}){
    if(!this.#initialized)throw new Error('rsi_verifier_evolution_ledger_not_initialized');
    const checked=verifyRsiVerifierEvolutionShadowAdmission(admission,{candidate,predecessor_receipt,secondary_receipt});
    const c=verifyRsiVerifierEvolutionCandidate(candidate);
    const p=verifyRsiVerifierEvolutionExternalReceipt(predecessor_receipt,{candidate:c});
    const s=verifyRsiVerifierEvolutionExternalReceipt(secondary_receipt,{candidate:c});
    if(c.source_sha!==this.#sourceSha)throw new Error('rsi_verifier_evolution_source_mismatch');
    const existing=this.#rows.find(x=>x.admission.admission_id===checked.admission_id||x.candidate.candidate_digest===c.candidate_digest);
    if(existing){
      if(existing.admission.admission_digest!==checked.admission_digest)throw new Error('rsi_verifier_evolution_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:checked.admission_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_verifier_evolution_ledger_capacity_exceeded');
    const next=[...this.#rows,Object.freeze({candidate:structuredClone(c),predecessor_receipt:structuredClone(p),secondary_receipt:structuredClone(s),admission:structuredClone(checked)})];
    await this.#persist(next);
    this.#rows=next;
    return zero({state:checked.state,admission_digest:checked.admission_digest});
  }
  qualified(){
    if(!this.#initialized)throw new Error('rsi_verifier_evolution_ledger_not_initialized');
    return Object.freeze(this.#rows.filter(x=>x.admission.qualified_for_verifier_shadow_only===true).map(x=>Object.freeze(structuredClone(x.admission))));
  }
  snapshot(){
    const s=state(this.#sourceSha,this.#rows);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,
      qualified_count:s.qualified_count,append_only:true,active_verifier_root_digest:null,ledger_can_replace_verifier:false,
      ledger_can_activate_verifier:false,candidate_can_clear_negative_evidence:false,authority_effect:false});
  }
}

export function rsiVerifierEvolutionShadowTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.verifier-evolution-shadow-root.v1',version:1,
    archive_based_verifier_evolution_required:true,in_place_verifier_rewrite_allowed:false,
    frozen_predecessor_verifier_required:true,distinct_secondary_verifier_required:true,
    candidate_verifier_must_differ_from_predecessor:true,hidden_suite_root_required:true,
    hidden_acceptance_required:true,sabotage_suite_required:true,transfer_holdout_required:true,
    trajectory_integrity_required:true,legibility_holdout_required:true,monitorability_nonregression_required:true,
    exact_constitution_binding_required:true,dual_receipt_agreement_required:true,
    candidate_self_evaluation_advisory_only:true,candidate_can_read_hidden_suites:false,
    candidate_can_choose_thresholds:false,challenge_archive_append_only:true,
    discovered_exploits_become_negative_evidence:true,automatic_counterexample_training_authorized:false,
    active_verifier_remains_predecessor:true,verifier_shadow_only:true,verifier_replacement_authorized:false,
    verifier_activation_authorized:false,promotion_review_still_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,trust_root_digest:digest(root)});
}
