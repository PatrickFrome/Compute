
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiExistingLibraryCasAppendRequest,
  verifyRsiExistingLibraryCasAppendReceipt,
} from './rsi-existing-library-cas-append.mjs';
import {
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';
import {
  verifyRsiSkillLibraryGovernance,
} from './rsi-skill-library-governance.mjs';

export const RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA =
  'metaengine.rsi.dormant-skill-retrieval-review.v1';
export const RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_ARCHIVE_SCHEMA =
  'metaengine.rsi.dormant-skill-retrieval-review-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=2048;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error('rsi_phase35_'+l+'_digest_invalid');
  return x;
}
function exactSha(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA40_RE.test(x))throw new Error('rsi_phase35_'+l+'_sha_invalid');
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase35_'+l+'_invalid');
  return x;
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
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZero(v,l){
  for(const f of [
    'execution_authority','browser_authority','task_authority',
    'production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','authority_effect'
  ]){
    if(v?.[f]!==false)throw new Error('rsi_phase35_'+l+'_'+f+'_invalid');
  }
  if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase35_'+l+'_retry_invalid');
}

function verifyStorage({
  append_request,
  append_request_args,
  append_receipt,
  append_receipt_args,
  successor_library,
  current_governance,
}={}){
  const request=verifyRsiExistingLibraryCasAppendRequest(
    append_request,
    append_request_args||{},
  );
  const receipt=verifyRsiExistingLibraryCasAppendReceipt(
    append_receipt,
    {
      ...(append_receipt_args||{}),
      request,
      request_args:append_request_args||{},
    },
  );
  if(
    receipt.outcome!=='APPENDED_WITH_READBACK'
    ||receipt.library_append_observed!==true
    ||receipt.exact_successor_readback_verified!==true
    ||receipt.predecessor_entries_preserved!==true
    ||receipt.exactly_one_intended_skill_appended!==true
    ||receipt.effect_unknown!==false
    ||receipt.retry_allowed!==false
  ){
    throw new Error('rsi_phase35_storage_readback_not_exact_success');
  }
  const library=verifyRsiVerifiedSkillLibrary(successor_library);
  if(
    library.library_digest!==receipt.observed_successor_library_digest
    ||library.library_digest!==request.expected_successor_library_digest
  ){
    throw new Error('rsi_phase35_successor_library_mismatch');
  }
  const governance=verifyRsiSkillLibraryGovernance(current_governance,library);
  const skillRow=governance.entries.find(row=>row.skill_digest===request.proposed_skill_digest);
  if(!skillRow)throw new Error('rsi_phase35_appended_skill_missing_from_governance');
  if(
    skillRow.state!=='DORMANT_CAP'
    ||skillRow.active_for_composition!==false
    ||skillRow.evidence_window_count!==0
  ){
    throw new Error('rsi_phase35_zero_evidence_skill_must_be_dormant');
  }
  return Object.freeze({request,receipt,library,governance,skillRow});
}

function classify({
  evidenceBlockers,
  task_non_regression,
  safety_non_regression,
  security_non_regression,
  process_non_regression,
  outcome_non_regression,
  efficiency_non_regression,
  strict_post_append_improvement,
  coalition_ablation_pass,
  marginal_contribution_pass,
  active_cap_pass,
  capacityAvailable,
}={}){
  if(evidenceBlockers.length>0)return 'KEEP_DORMANT_INVALID_EVIDENCE';
  if(
    task_non_regression!==true
    ||safety_non_regression!==true
    ||security_non_regression!==true
    ||process_non_regression!==true
    ||outcome_non_regression!==true
    ||efficiency_non_regression!==true
  )return 'KEEP_DORMANT_NEGATIVE_TRANSFER';
  if(strict_post_append_improvement!==true)return 'KEEP_DORMANT_NO_CLEAR_BENEFIT';
  if(coalition_ablation_pass!==true)return 'KEEP_DORMANT_COALITION_RISK';
  if(marginal_contribution_pass!==true)return 'KEEP_DORMANT_NO_MARGINAL_GAIN';
  if(active_cap_pass!==true||capacityAvailable!==true)return 'KEEP_DORMANT_ACTIVE_CAP';
  return 'ELIGIBLE_FOR_EXTERNAL_RETRIEVAL_EXPOSURE_ACTIVATION_REVIEW';
}

export function createRsiDormantSkillRetrievalReview({
  review_id,
  append_request,
  append_request_args,
  append_receipt,
  append_receipt_args,
  successor_library,
  current_governance,
  post_append_evaluation_epoch_digest,
  post_append_holdout_digest,
  post_append_evaluator_root_digest,
  matched_control_receipt_digest,
  treatment_receipt_digest,
  post_append_evidence_digest,
  coalition_ablation_receipt_digest,
  marginal_contribution_receipt_digest,
  active_cap_policy_digest,
  same_instances_pass=false,
  same_harness_pass=false,
  same_budget_pass=false,
  evaluator_integrity_pass=false,
  consumer_state_integrity_pass=false,
  retrieval_profile_integrity_pass=false,
  hidden_holdout_pass=false,
  contamination_clear=false,
  from_scratch_replay_pass=false,
  task_non_regression=false,
  safety_non_regression=false,
  security_non_regression=false,
  process_non_regression=false,
  outcome_non_regression=false,
  efficiency_non_regression=false,
  strict_post_append_improvement=false,
  coalition_ablation_pass=false,
  marginal_contribution_pass=false,
  active_cap_pass=false,
  external_retrieval_reviewer=false,
  external_consumer_evaluator=false,
  authored_by_candidate=true,
}={}){
  if(
    external_retrieval_reviewer!==true
    ||external_consumer_evaluator!==true
    ||authored_by_candidate!==false
  ){
    throw new Error('rsi_phase35_external_reviewers_required');
  }
  const storage=verifyStorage({
    append_request,append_request_args,append_receipt,append_receipt_args,
    successor_library,current_governance,
  });

  const roots=[
    exactDigest(post_append_evaluation_epoch_digest,'post_append_epoch'),
    exactDigest(post_append_holdout_digest,'post_append_holdout'),
    exactDigest(post_append_evaluator_root_digest,'post_append_evaluator'),
    exactDigest(matched_control_receipt_digest,'matched_control_receipt'),
    exactDigest(treatment_receipt_digest,'treatment_receipt'),
    exactDigest(post_append_evidence_digest,'post_append_evidence'),
    exactDigest(coalition_ablation_receipt_digest,'coalition_ablation_receipt'),
    exactDigest(marginal_contribution_receipt_digest,'marginal_contribution_receipt'),
    exactDigest(active_cap_policy_digest,'active_cap_policy'),
    storage.request.append_request_digest,
    storage.receipt.append_receipt_digest,
    storage.library.library_digest,
    storage.governance.governance_digest,
  ];
  if(new Set(roots).size!==roots.length){
    throw new Error('rsi_phase35_independent_evidence_roots_required');
  }

  const evidenceBlockers=[];
  if(same_instances_pass!==true)evidenceBlockers.push('INSTANCE_MISMATCH');
  if(same_harness_pass!==true)evidenceBlockers.push('HARNESS_MISMATCH');
  if(same_budget_pass!==true)evidenceBlockers.push('BUDGET_MISMATCH');
  if(evaluator_integrity_pass!==true)evidenceBlockers.push('EVALUATOR_INTEGRITY_FAILURE');
  if(consumer_state_integrity_pass!==true)evidenceBlockers.push('CONSUMER_STATE_DRIFT');
  if(retrieval_profile_integrity_pass!==true)evidenceBlockers.push('RETRIEVAL_PROFILE_DRIFT');
  if(hidden_holdout_pass!==true)evidenceBlockers.push('HIDDEN_HOLDOUT_FAILURE');
  if(contamination_clear!==true)evidenceBlockers.push('CONTAMINATION_DETECTED');
  if(from_scratch_replay_pass!==true)evidenceBlockers.push('FROM_SCRATCH_REPLAY_FAILURE');

  const capacityAvailable=storage.governance.active_count<storage.governance.config.max_active_skills;
  const state=classify({
    evidenceBlockers,
    task_non_regression,safety_non_regression,security_non_regression,
    process_non_regression,outcome_non_regression,efficiency_non_regression,
    strict_post_append_improvement,coalition_ablation_pass,marginal_contribution_pass,
    active_cap_pass,capacityAvailable,
  });

  const core=zero({
    schema:RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA,
    version:1,
    review_id:id(review_id,'review_id'),
    source_sha:exactSha(storage.request.source_sha,'source'),
    append_request_digest:storage.request.append_request_digest,
    append_receipt_digest:storage.receipt.append_receipt_digest,
    library_digest:storage.library.library_digest,
    governance_digest:storage.governance.governance_digest,
    skill_digest:storage.request.proposed_skill_digest,
    skill_evidence_digest:storage.request.proposed_skill_evidence_digest,
    consumer_task_set_digest:storage.request.consumer_task_set_digest,
    consumer_retrieval_profile_digest:storage.request.consumer_retrieval_profile_digest,
    current_consumer_plane_digest:storage.request.current_consumer_plane_digest,
    current_verified_library_digest:storage.request.current_verified_library_digest,
    consumer_evaluation_contract_digest:storage.request.consumer_evaluation_contract_digest,
    post_append_evaluation_epoch_digest:roots[0],
    post_append_holdout_digest:roots[1],
    post_append_evaluator_root_digest:roots[2],
    matched_control_receipt_digest:roots[3],
    treatment_receipt_digest:roots[4],
    post_append_evidence_digest:roots[5],
    coalition_ablation_receipt_digest:roots[6],
    marginal_contribution_receipt_digest:roots[7],
    active_cap_policy_digest:roots[8],
    same_instances_pass:same_instances_pass===true,
    same_harness_pass:same_harness_pass===true,
    same_budget_pass:same_budget_pass===true,
    evaluator_integrity_pass:evaluator_integrity_pass===true,
    consumer_state_integrity_pass:consumer_state_integrity_pass===true,
    retrieval_profile_integrity_pass:retrieval_profile_integrity_pass===true,
    hidden_holdout_pass:hidden_holdout_pass===true,
    contamination_clear:contamination_clear===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,
    task_non_regression:task_non_regression===true,
    safety_non_regression:safety_non_regression===true,
    security_non_regression:security_non_regression===true,
    process_non_regression:process_non_regression===true,
    outcome_non_regression:outcome_non_regression===true,
    efficiency_non_regression:efficiency_non_regression===true,
    strict_post_append_improvement:strict_post_append_improvement===true,
    coalition_ablation_pass:coalition_ablation_pass===true,
    marginal_contribution_pass:marginal_contribution_pass===true,
    active_cap_pass:active_cap_pass===true,
    active_cap_capacity_available:capacityAvailable,
    evidence_blockers:Object.freeze(evidenceBlockers.sort()),
    state,
    appended_skill_initial_governance_state:'DORMANT_CAP',
    appended_skill_zero_evidence_dormant_verified:true,
    fresh_post_append_paired_evidence_required:true,
    matched_no_skill_or_reference_required:true,
    coalition_aware_ablation_required:true,
    marginal_contribution_required:true,
    exact_current_governance_required:true,
    retrieval_exposure_token:null,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    governance_mutation_performed:false,
    review_can_schedule_work:false,
  });
  return Object.freeze({...core,retrieval_review_digest:digest(core)});
}

export function verifyRsiDormantSkillRetrievalReview(row,args={}){
  if(!row||row.schema!==RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA||row.version!==1){
    throw new Error('rsi_phase35_review_invalid');
  }
  assertZero(row,'review');
  if(
    row.appended_skill_initial_governance_state!=='DORMANT_CAP'
    ||row.appended_skill_zero_evidence_dormant_verified!==true
    ||row.fresh_post_append_paired_evidence_required!==true
    ||row.matched_no_skill_or_reference_required!==true
    ||row.coalition_aware_ablation_required!==true
    ||row.marginal_contribution_required!==true
    ||row.exact_current_governance_required!==true
    ||row.retrieval_exposure_token!==null
    ||row.retrieval_exposure_changed!==false
    ||row.skill_activation_performed!==false
    ||row.lifecycle_mutation_performed!==false
    ||row.governance_mutation_performed!==false
    ||row.review_can_schedule_work!==false
  ){
    throw new Error('rsi_phase35_review_policy_invalid');
  }
  const canonical=createRsiDormantSkillRetrievalReview({
    ...args,
    review_id:row.review_id,
    post_append_evaluation_epoch_digest:row.post_append_evaluation_epoch_digest,
    post_append_holdout_digest:row.post_append_holdout_digest,
    post_append_evaluator_root_digest:row.post_append_evaluator_root_digest,
    matched_control_receipt_digest:row.matched_control_receipt_digest,
    treatment_receipt_digest:row.treatment_receipt_digest,
    post_append_evidence_digest:row.post_append_evidence_digest,
    coalition_ablation_receipt_digest:row.coalition_ablation_receipt_digest,
    marginal_contribution_receipt_digest:row.marginal_contribution_receipt_digest,
    active_cap_policy_digest:row.active_cap_policy_digest,
    same_instances_pass:row.same_instances_pass,
    same_harness_pass:row.same_harness_pass,
    same_budget_pass:row.same_budget_pass,
    evaluator_integrity_pass:row.evaluator_integrity_pass,
    consumer_state_integrity_pass:row.consumer_state_integrity_pass,
    retrieval_profile_integrity_pass:row.retrieval_profile_integrity_pass,
    hidden_holdout_pass:row.hidden_holdout_pass,
    contamination_clear:row.contamination_clear,
    from_scratch_replay_pass:row.from_scratch_replay_pass,
    task_non_regression:row.task_non_regression,
    safety_non_regression:row.safety_non_regression,
    security_non_regression:row.security_non_regression,
    process_non_regression:row.process_non_regression,
    outcome_non_regression:row.outcome_non_regression,
    efficiency_non_regression:row.efficiency_non_regression,
    strict_post_append_improvement:row.strict_post_append_improvement,
    coalition_ablation_pass:row.coalition_ablation_pass,
    marginal_contribution_pass:row.marginal_contribution_pass,
    active_cap_pass:row.active_cap_pass,
    external_retrieval_reviewer:true,
    external_consumer_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.retrieval_review_digest!==exactDigest(row.retrieval_review_digest,'review')){
    throw new Error('rsi_phase35_review_digest_mismatch');
  }
  return canonical;
}

function archiveState(sourceSha,rows){
  const states={};
  for(const row of rows)states[row.state]=(states[row.state]||0)+1;
  const core=zero({
    schema:RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    state_counts:Object.freeze(states),
    append_only:true,
    durable_before_visible:true,
    dormant_by_default:true,
    negative_transfer_retained:true,
    review_does_not_change_retrieval_exposure:true,
    archive_can_activate_skill:false,
    archive_can_change_governance:false,
    archive_can_change_lifecycle:false,
    archive_can_schedule_work:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiDormantSkillRetrievalReviewArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_phase35_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_phase35_archive_resolver_required');
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'archive_source');
    this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'archive');
      if(
        parsed.schema!==RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_ARCHIVE_SCHEMA
        ||parsed.version!==1||parsed.source_sha!==this.#sourceSha
        ||parsed.append_only!==true||parsed.durable_before_visible!==true
        ||parsed.dormant_by_default!==true||parsed.negative_transfer_retained!==true
        ||parsed.review_does_not_change_retrieval_exposure!==true
        ||parsed.archive_can_activate_skill!==false
        ||parsed.archive_can_change_governance!==false
        ||parsed.archive_can_change_lifecycle!==false
        ||parsed.archive_can_schedule_work!==false
      )throw new Error('rsi_phase35_archive_policy_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'archive'))throw new Error('rsi_phase35_archive_digest_mismatch');
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)throw new Error('rsi_phase35_archive_rows_invalid');
      const seen=new Set(),checked=[];
      for(const row of parsed.rows){
        const evidence=await this.#resolver({retrieval_review_digest:row.retrieval_review_digest});
        const review=verifyRsiDormantSkillRetrievalReview(row,evidence||{});
        if(review.source_sha!==this.#sourceSha)throw new Error('rsi_phase35_archive_source_mismatch');
        const identity=review.append_receipt_digest+'|'+review.skill_digest+'|'+review.current_consumer_plane_digest+'|'+review.post_append_evaluation_epoch_digest;
        if(seen.has(identity))throw new Error('rsi_phase35_archive_duplicate');
        seen.add(identity);
        checked.push(review);
      }
      this.#rows=checked;
    }catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    this.#initialized=true;
    return this.snapshot();
  }
  async #persist(rows){
    const state=archiveState(this.#sourceSha,rows);
    const temp=this.#path+'.tmp';
    const h=await fs.open(temp,'w',0o600);
    try{await h.writeFile(JSON.stringify(state)+'\n','utf8');await h.sync();}
    finally{await h.close();}
    await fs.rename(temp,this.#path);
  }
  async add({review,review_args={}}={}){
    if(!this.#initialized)throw new Error('rsi_phase35_archive_not_initialized');
    const checked=verifyRsiDormantSkillRetrievalReview(review,review_args);
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_phase35_archive_source_mismatch');
    const identity=checked.append_receipt_digest+'|'+checked.skill_digest+'|'+checked.current_consumer_plane_digest+'|'+checked.post_append_evaluation_epoch_digest;
    const existing=this.#rows.find(row=>
      row.append_receipt_digest+'|'+row.skill_digest+'|'+row.current_consumer_plane_digest+'|'+row.post_append_evaluation_epoch_digest===identity
    );
    if(existing){
      if(existing.retrieval_review_digest!==checked.retrieval_review_digest)throw new Error('rsi_phase35_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',retrieval_review_digest:checked.retrieval_review_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_phase35_archive_capacity_exceeded');
    const next=[...this.#rows,checked];
    await this.#persist(next);
    this.#rows=next;
    return zero({state:checked.state,retrieval_review_digest:checked.retrieval_review_digest});
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      row_count:s.row_count,state_counts:s.state_counts,
      append_only:true,durable_before_visible:true,dormant_by_default:true,negative_transfer_retained:true,
      review_does_not_change_retrieval_exposure:true,
      archive_can_activate_skill:false,archive_can_change_governance:false,
      archive_can_change_lifecycle:false,archive_can_schedule_work:false,authority_effect:false,
    });
  }
}

export function rsiDormantSkillRetrievalReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.dormant-skill-retrieval-review-root.v1',
    version:1,
    successful_phase34b_storage_readback_required:true,
    existing_verified_skill_library_only:true,
    existing_skill_library_governance_only:true,
    zero_evidence_skill_must_start_dormant:true,
    fresh_post_append_paired_evidence_required:true,
    matched_no_skill_or_reference_required:true,
    consumer_state_integrity_required:true,
    retrieval_profile_integrity_required:true,
    task_safety_security_process_outcome_efficiency_non_regression_required:true,
    strict_post_append_improvement_required:true,
    coalition_aware_ablation_required:true,
    marginal_contribution_required:true,
    active_cap_required:true,
    negative_transfer_retained:true,
    retrieval_exposure_review_is_zero_effect:true,
    direct_retrieval_exposure_change:false,
    direct_skill_activation:false,
    direct_governance_mutation:false,
    direct_lifecycle_mutation:false,
    direct_scheduler_action:false,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,phase35_root_digest:digest(root)});
}
