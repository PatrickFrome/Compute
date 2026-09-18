
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiAnytimeLibraryAdmissionProposal,
  verifyRsiAnytimeLibraryAdmissionCertificate,
} from './rsi-anytime-library-admission.mjs';
import {
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';

export const RSI_EXISTING_LIBRARY_CAS_APPEND_REQUEST_SCHEMA =
  'metaengine.rsi.existing-library-cas-append-request.v1';
export const RSI_EXISTING_LIBRARY_CAS_APPEND_RECEIPT_SCHEMA =
  'metaengine.rsi.existing-library-cas-append-receipt.v1';
export const RSI_EXISTING_LIBRARY_CAS_APPEND_ARCHIVE_SCHEMA =
  'metaengine.rsi.existing-library-cas-append-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const OUTCOMES=new Set([
  'APPENDED_WITH_READBACK',
  'REJECTED_NO_EFFECT',
  'AMBIGUOUS_EFFECT_UNKNOWN',
]);
const REJECTION_CODES=new Set([
  'CAS_PREDECESSOR_MISMATCH',
  'WRITER_REJECTED',
  'STORAGE_POLICY_REJECTED',
]);
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
  if(!SHA256_RE.test(x))throw new Error('rsi_phase34b_'+l+'_digest_invalid');
  return x;
}
function exactSha(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA40_RE.test(x))throw new Error('rsi_phase34b_'+l+'_sha_invalid');
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase34b_'+l+'_invalid');
  return x;
}
function positiveInt(v,l){
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<1)throw new Error('rsi_phase34b_'+l+'_invalid');
  return n;
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
    if(v?.[f]!==false)throw new Error('rsi_phase34b_'+l+'_'+f+'_invalid');
  }
  if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase34b_'+l+'_retry_invalid');
}

function verifyPhase34({
  admission_proposal,
  admission_proposal_args,
  admission_certificate,
  admission_certificate_args,
}={}){
  const proposal=verifyRsiAnytimeLibraryAdmissionProposal(
    admission_proposal,
    admission_proposal_args||{},
  );
  const certificate=verifyRsiAnytimeLibraryAdmissionCertificate(
    admission_certificate,
    admission_certificate_args||{},
  );
  if(certificate.admission_proposal_digest!==proposal.admission_proposal_digest){
    throw new Error('rsi_phase34b_phase34_binding_mismatch');
  }
  if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'){
    throw new Error('rsi_phase34b_phase34_certificate_not_eligible');
  }
  if(!Array.isArray(certificate.blockers)||certificate.blockers.length!==0){
    throw new Error('rsi_phase34b_phase34_certificate_blocked');
  }
  if(certificate.predecessor_source_qualification_pass!==true){
    throw new Error('rsi_phase34b_phase34_source_qualification_not_green');
  }
  if(
    certificate.append_handoff_one_attempt_only!==true
    ||certificate.ambiguous_append_retry_allowed!==false
    ||certificate.append_effect_performed!==false
    ||certificate.library_append_token!==null
    ||certificate.retrieval_exposure_change_authorized!==false
    ||certificate.skill_activation_authorized!==false
    ||certificate.lifecycle_mutation_authorized!==false
  ){
    throw new Error('rsi_phase34b_phase34_effect_policy_invalid');
  }
  if(
    certificate.current_library_digest!==proposal.current_library_digest
    ||certificate.proposed_successor_library_digest!==proposal.proposed_successor_library_digest
    ||certificate.proposed_skill_digest!==proposal.proposed_skill_digest
    ||certificate.proposed_skill_evidence_digest!==proposal.proposed_skill_evidence_digest
  ){
    throw new Error('rsi_phase34b_phase34_library_binding_invalid');
  }
  return Object.freeze({proposal,certificate});
}

function exactEntryFingerprint(entry){
  return digest({
    skill_id:entry.skill_id,
    skill_version:entry.skill_version,
    skill_digest:entry.skill_digest,
    evidence_digest:entry.evidence_digest,
    role:entry.role,
    input_schema_digest:entry.input_schema_digest,
    output_schema_digest:entry.output_schema_digest,
    capabilities:entry.capabilities,
    max_context_tokens:entry.max_context_tokens,
    max_output_tokens:entry.max_output_tokens,
    max_invocations:entry.max_invocations,
    observed_success_rate:entry.observed_success_rate,
    source_candidate_sha:entry.source_candidate_sha,
    capsule:entry.capsule,
    evidence:entry.evidence,
    state:entry.state,
    reusable:entry.reusable,
    direct_execution_allowed:entry.direct_execution_allowed,
    candidate_can_activate_without_plan:entry.candidate_can_activate_without_plan,
  });
}

function verifyAppendReadback({predecessor,successor,request}={}){
  const before=verifyRsiVerifiedSkillLibrary(predecessor);
  const after=verifyRsiVerifiedSkillLibrary(successor);
  if(before.library_digest!==request.expected_predecessor_library_digest){
    throw new Error('rsi_phase34b_predecessor_digest_mismatch');
  }
  if(after.library_digest!==request.expected_successor_library_digest){
    throw new Error('rsi_phase34b_successor_digest_mismatch');
  }
  if(after.library_id!==before.library_id){
    throw new Error('rsi_phase34b_library_id_drift');
  }
  if(after.entry_count!==before.entry_count+1){
    throw new Error('rsi_phase34b_successor_entry_count_invalid');
  }

  const beforeByDigest=new Map(before.entries.map(row=>[row.skill_digest,row]));
  const afterByDigest=new Map(after.entries.map(row=>[row.skill_digest,row]));
  for(const [skillDigest,beforeEntry] of beforeByDigest){
    const afterEntry=afterByDigest.get(skillDigest);
    if(!afterEntry)throw new Error('rsi_phase34b_predecessor_entry_missing');
    if(exactEntryFingerprint(afterEntry)!==exactEntryFingerprint(beforeEntry)){
      throw new Error('rsi_phase34b_predecessor_entry_rewritten');
    }
  }

  const added=after.entries.filter(row=>!beforeByDigest.has(row.skill_digest));
  if(added.length!==1)throw new Error('rsi_phase34b_exactly_one_new_skill_required');
  const appended=added[0];
  if(
    appended.skill_digest!==request.proposed_skill_digest
    ||appended.evidence_digest!==request.proposed_skill_evidence_digest
  ){
    throw new Error('rsi_phase34b_appended_skill_binding_mismatch');
  }
  return Object.freeze({before,after,appended});
}

export function createRsiExistingLibraryCasAppendRequest({
  request_id,
  admission_proposal,
  admission_proposal_args,
  admission_certificate,
  admission_certificate_args,
  current_library,
  library_writer_identity_digest,
  storage_backend_identity_digest,
  compare_and_swap_policy_digest,
  readback_policy_digest,
  external_library_writer=false,
  authored_by_candidate=true,
}={}){
  if(external_library_writer!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34b_external_writer_required');
  }
  const p34=verifyPhase34({
    admission_proposal,
    admission_proposal_args,
    admission_certificate,
    admission_certificate_args,
  });
  const current=verifyRsiVerifiedSkillLibrary(current_library);
  if(current.library_digest!==p34.certificate.current_library_digest){
    throw new Error('rsi_phase34b_current_library_drift');
  }
  const proposed=verifyRsiVerifiedSkillLibrary(p34.proposal.proposed_successor_library);
  if(proposed.library_digest!==p34.certificate.proposed_successor_library_digest){
    throw new Error('rsi_phase34b_proposed_successor_drift');
  }

  const writer=exactDigest(library_writer_identity_digest,'writer_identity');
  const backend=exactDigest(storage_backend_identity_digest,'storage_backend_identity');
  const casPolicy=exactDigest(compare_and_swap_policy_digest,'cas_policy');
  const readbackPolicy=exactDigest(readback_policy_digest,'readback_policy');
  const roots=[
    writer,backend,casPolicy,readbackPolicy,
    p34.certificate.admission_certificate_digest,
    p34.proposal.admission_proposal_digest,
    current.library_digest,
    proposed.library_digest,
    p34.proposal.proposed_skill_digest,
    p34.proposal.proposed_skill_evidence_digest,
  ];
  if(new Set(roots).size!==roots.length){
    throw new Error('rsi_phase34b_independent_request_roots_required');
  }

  const core=zero({
    schema:RSI_EXISTING_LIBRARY_CAS_APPEND_REQUEST_SCHEMA,
    version:1,
    request_id:id(request_id,'request_id'),
    source_sha:exactSha(p34.certificate.source_sha,'source'),
    phase34_admission_proposal_digest:p34.proposal.admission_proposal_digest,
    phase34_admission_certificate_digest:p34.certificate.admission_certificate_digest,
    phase34_policy_source_sha:p34.certificate.phase33_policy_source_sha,
    predecessor_source_qualification_digest:p34.certificate.predecessor_source_qualification_digest,
    source_evaluation_contract_digest:p34.certificate.source_evaluation_contract_digest,
    consumer_task_set_digest:p34.certificate.consumer_task_set_digest,
    consumer_retrieval_profile_digest:p34.certificate.consumer_retrieval_profile_digest,
    current_consumer_plane_digest:p34.certificate.current_consumer_plane_digest,
    current_verified_library_digest:p34.certificate.current_verified_library_digest,
    consumer_evaluation_contract_digest:p34.certificate.consumer_evaluation_contract_digest,
    expected_predecessor_library_digest:current.library_digest,
    expected_successor_library_digest:proposed.library_digest,
    expected_successor_library_entry_count:proposed.entry_count,
    proposed_skill_digest:p34.proposal.proposed_skill_digest,
    proposed_skill_evidence_digest:p34.proposal.proposed_skill_evidence_digest,
    library_writer_identity_digest:writer,
    storage_backend_identity_digest:backend,
    compare_and_swap_policy_digest:casPolicy,
    readback_policy_digest:readbackPolicy,
    state:'READY_FOR_EXTERNAL_STORAGE_CAS_APPEND',
    existing_verified_skill_library_only:true,
    compare_and_swap_required:true,
    exact_predecessor_read_required:true,
    exact_successor_readback_required:true,
    one_attempt_only:true,
    append_attempt_budget:1,
    append_attempts_consumed:0,
    retry_after_ambiguous_allowed:false,
    phase34_security_and_verifier_lineage_bound:true,
    append_effect_performed:false,
    library_append_observed:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    experience_graph_write_performed:false,
    meta_skill_profile_mutated:false,
    request_can_schedule_work:false,
  });
  return Object.freeze({...core,append_request_digest:digest(core)});
}

export function verifyRsiExistingLibraryCasAppendRequest(row,args={}){
  if(!row||row.schema!==RSI_EXISTING_LIBRARY_CAS_APPEND_REQUEST_SCHEMA||row.version!==1){
    throw new Error('rsi_phase34b_append_request_invalid');
  }
  assertZero(row,'append_request');
  if(
    row.state!=='READY_FOR_EXTERNAL_STORAGE_CAS_APPEND'
    ||row.existing_verified_skill_library_only!==true
    ||row.compare_and_swap_required!==true
    ||row.exact_predecessor_read_required!==true
    ||row.exact_successor_readback_required!==true
    ||row.one_attempt_only!==true
    ||row.append_attempt_budget!==1
    ||row.append_attempts_consumed!==0
    ||row.retry_after_ambiguous_allowed!==false
    ||row.phase34_security_and_verifier_lineage_bound!==true
    ||row.append_effect_performed!==false
    ||row.library_append_observed!==false
    ||row.retrieval_exposure_changed!==false
    ||row.skill_activation_performed!==false
    ||row.lifecycle_mutation_performed!==false
    ||row.experience_graph_write_performed!==false
    ||row.meta_skill_profile_mutated!==false
    ||row.request_can_schedule_work!==false
  ){
    throw new Error('rsi_phase34b_append_request_policy_invalid');
  }
  const canonical=createRsiExistingLibraryCasAppendRequest({
    ...args,
    request_id:row.request_id,
    library_writer_identity_digest:row.library_writer_identity_digest,
    storage_backend_identity_digest:row.storage_backend_identity_digest,
    compare_and_swap_policy_digest:row.compare_and_swap_policy_digest,
    readback_policy_digest:row.readback_policy_digest,
    external_library_writer:true,
    authored_by_candidate:false,
  });
  if(canonical.append_request_digest!==exactDigest(row.append_request_digest,'append_request')){
    throw new Error('rsi_phase34b_append_request_digest_mismatch');
  }
  return canonical;
}

export function createRsiExistingLibraryCasAppendReceipt({
  receipt_id,
  request,
  request_args,
  outcome,
  rejection_code=null,
  observed_predecessor_library_digest,
  predecessor_library,
  successor_library_readback=null,
  storage_effect_receipt_digest,
  readback_receipt_digest,
  append_attempt_count,
  external_library_writer=false,
  external_readback_verifier=false,
  authored_by_candidate=true,
}={}){
  if(external_library_writer!==true||external_readback_verifier!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34b_external_receipt_owners_required');
  }
  const checkedRequest=verifyRsiExistingLibraryCasAppendRequest(request,request_args||{});
  const state=String(outcome||'').trim().toUpperCase();
  if(!OUTCOMES.has(state))throw new Error('rsi_phase34b_append_outcome_invalid');
  const attempts=positiveInt(append_attempt_count,'append_attempt_count');
  if(attempts!==1)throw new Error('rsi_phase34b_append_attempt_count_must_equal_one');

  const observedPredecessor=exactDigest(observed_predecessor_library_digest,'observed_predecessor');
  const predecessor=verifyRsiVerifiedSkillLibrary(predecessor_library);
  if(predecessor.library_digest!==observedPredecessor){
    throw new Error('rsi_phase34b_predecessor_readback_digest_mismatch');
  }

  const effectReceipt=exactDigest(storage_effect_receipt_digest,'storage_effect_receipt');
  const readbackReceipt=exactDigest(readback_receipt_digest,'readback_receipt');
  if(effectReceipt===readbackReceipt)throw new Error('rsi_phase34b_receipt_roots_must_be_independent');

  const casPreconditionPass=observedPredecessor===checkedRequest.expected_predecessor_library_digest;
  let successorDigest=null;
  let successorEntryCount=null;
  let appendedSkillDigest=null;
  let appendedEvidenceDigest=null;
  let libraryAppendObserved=false;
  let effectUnknown=false;
  let rejection=null;

  if(state==='APPENDED_WITH_READBACK'){
    if(!casPreconditionPass)throw new Error('rsi_phase34b_success_without_cas_precondition');
    if(!successor_library_readback)throw new Error('rsi_phase34b_success_readback_required');
    const verified=verifyAppendReadback({
      predecessor,
      successor:successor_library_readback,
      request:checkedRequest,
    });
    successorDigest=verified.after.library_digest;
    successorEntryCount=verified.after.entry_count;
    appendedSkillDigest=verified.appended.skill_digest;
    appendedEvidenceDigest=verified.appended.evidence_digest;
    libraryAppendObserved=true;
  }else if(state==='REJECTED_NO_EFFECT'){
    if(successor_library_readback!=null)throw new Error('rsi_phase34b_rejected_successor_readback_forbidden');
    rejection=String(rejection_code||'').trim().toUpperCase();
    if(!REJECTION_CODES.has(rejection))throw new Error('rsi_phase34b_rejection_code_invalid');
    if(!casPreconditionPass&&rejection!=='CAS_PREDECESSOR_MISMATCH'){
      throw new Error('rsi_phase34b_cas_mismatch_rejection_code_required');
    }
  }else{
    if(successor_library_readback!=null)throw new Error('rsi_phase34b_ambiguous_successor_claim_forbidden');
    if(rejection_code!=null)throw new Error('rsi_phase34b_ambiguous_rejection_code_forbidden');
    effectUnknown=true;
  }

  const core=zero({
    schema:RSI_EXISTING_LIBRARY_CAS_APPEND_RECEIPT_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:checkedRequest.source_sha,
    append_request_digest:checkedRequest.append_request_digest,
    phase34_admission_certificate_digest:checkedRequest.phase34_admission_certificate_digest,
    expected_predecessor_library_digest:checkedRequest.expected_predecessor_library_digest,
    observed_predecessor_library_digest:observedPredecessor,
    expected_successor_library_digest:checkedRequest.expected_successor_library_digest,
    observed_successor_library_digest:successorDigest,
    observed_successor_library_entry_count:successorEntryCount,
    proposed_skill_digest:checkedRequest.proposed_skill_digest,
    proposed_skill_evidence_digest:checkedRequest.proposed_skill_evidence_digest,
    appended_skill_digest:appendedSkillDigest,
    appended_skill_evidence_digest:appendedEvidenceDigest,
    storage_effect_receipt_digest:effectReceipt,
    readback_receipt_digest:readbackReceipt,
    append_attempt_count:attempts,
    append_attempt_budget:1,
    cas_precondition_pass:casPreconditionPass,
    outcome:state,
    rejection_code:rejection,
    library_append_observed:libraryAppendObserved,
    effect_unknown:effectUnknown,
    terminal_effect_evidence:true,
    retry_allowed:false,
    requires_external_reconciliation:effectUnknown,
    exact_successor_readback_verified:libraryAppendObserved,
    predecessor_entries_preserved:libraryAppendObserved,
    exactly_one_intended_skill_appended:libraryAppendObserved,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    governance_mutation_performed:false,
    experience_graph_write_performed:false,
    meta_skill_profile_mutated:false,
    scheduler_action_performed:false,
    browser_effect_performed:false,
    promotion_effect_performed:false,
    install_effect_performed:false,
    self_update_effect_performed:false,
  });
  return Object.freeze({...core,append_receipt_digest:digest(core)});
}

export function verifyRsiExistingLibraryCasAppendReceipt(row,args={}){
  if(!row||row.schema!==RSI_EXISTING_LIBRARY_CAS_APPEND_RECEIPT_SCHEMA||row.version!==1){
    throw new Error('rsi_phase34b_append_receipt_invalid');
  }
  assertZero(row,'append_receipt');
  if(
    row.append_attempt_count!==1
    ||row.append_attempt_budget!==1
    ||row.terminal_effect_evidence!==true
    ||row.retry_allowed!==false
    ||row.retrieval_exposure_changed!==false
    ||row.skill_activation_performed!==false
    ||row.lifecycle_mutation_performed!==false
    ||row.governance_mutation_performed!==false
    ||row.experience_graph_write_performed!==false
    ||row.meta_skill_profile_mutated!==false
    ||row.scheduler_action_performed!==false
    ||row.browser_effect_performed!==false
    ||row.promotion_effect_performed!==false
    ||row.install_effect_performed!==false
    ||row.self_update_effect_performed!==false
  ){
    throw new Error('rsi_phase34b_append_receipt_policy_invalid');
  }
  const canonical=createRsiExistingLibraryCasAppendReceipt({
    ...args,
    receipt_id:row.receipt_id,
    outcome:row.outcome,
    rejection_code:row.rejection_code,
    observed_predecessor_library_digest:row.observed_predecessor_library_digest,
    storage_effect_receipt_digest:row.storage_effect_receipt_digest,
    readback_receipt_digest:row.readback_receipt_digest,
    append_attempt_count:row.append_attempt_count,
    external_library_writer:true,
    external_readback_verifier:true,
    authored_by_candidate:false,
  });
  if(canonical.append_receipt_digest!==exactDigest(row.append_receipt_digest,'append_receipt')){
    throw new Error('rsi_phase34b_append_receipt_digest_mismatch');
  }
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};
  for(const row of rows)counts[row.receipt.outcome]=(counts[row.receipt.outcome]||0)+1;
  const core=zero({
    schema:RSI_EXISTING_LIBRARY_CAS_APPEND_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    outcome_counts:Object.freeze(counts),
    append_only:true,
    durable_before_visible:true,
    ambiguous_effects_retained:true,
    retry_after_ambiguous_allowed:false,
    storage_append_receipts_do_not_change_retrieval_exposure:true,
    archive_can_write_library:false,
    archive_can_change_retrieval_exposure:false,
    archive_can_change_lifecycle:false,
    archive_can_activate_skill:false,
    archive_can_schedule_work:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiExistingLibraryCasAppendArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_phase34b_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_phase34b_archive_resolver_required');
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
        parsed.schema!==RSI_EXISTING_LIBRARY_CAS_APPEND_ARCHIVE_SCHEMA
        ||parsed.version!==1
        ||parsed.source_sha!==this.#sourceSha
        ||parsed.append_only!==true
        ||parsed.durable_before_visible!==true
        ||parsed.ambiguous_effects_retained!==true
        ||parsed.retry_after_ambiguous_allowed!==false
        ||parsed.storage_append_receipts_do_not_change_retrieval_exposure!==true
        ||parsed.archive_can_write_library!==false
        ||parsed.archive_can_change_retrieval_exposure!==false
        ||parsed.archive_can_change_lifecycle!==false
        ||parsed.archive_can_activate_skill!==false
        ||parsed.archive_can_schedule_work!==false
      )throw new Error('rsi_phase34b_archive_policy_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'archive'))throw new Error('rsi_phase34b_archive_digest_mismatch');
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)throw new Error('rsi_phase34b_archive_rows_invalid');
      const seen=new Set(),checked=[];
      for(const row of parsed.rows){
        const evidence=await this.#resolver({
          append_request_digest:row.request.append_request_digest,
          append_receipt_digest:row.receipt.append_receipt_digest,
        });
        const request=verifyRsiExistingLibraryCasAppendRequest(row.request,evidence?.request_args||{});
        const receipt=verifyRsiExistingLibraryCasAppendReceipt(row.receipt,{
          ...(evidence?.receipt_args||{}),
          request,
          request_args:evidence?.request_args||{},
        });
        if(request.source_sha!==this.#sourceSha||receipt.source_sha!==this.#sourceSha){
          throw new Error('rsi_phase34b_archive_source_mismatch');
        }
        if(receipt.append_request_digest!==request.append_request_digest){
          throw new Error('rsi_phase34b_archive_binding_mismatch');
        }
        if(seen.has(request.request_id))throw new Error('rsi_phase34b_archive_duplicate');
        seen.add(request.request_id);
        checked.push(Object.freeze({request,receipt}));
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
    try{
      await h.writeFile(JSON.stringify(state)+'\n','utf8');
      await h.sync();
    }finally{
      await h.close();
    }
    await fs.rename(temp,this.#path);
  }
  async add({request,receipt,request_args={},receipt_args={}}={}){
    if(!this.#initialized)throw new Error('rsi_phase34b_archive_not_initialized');
    const checkedRequest=verifyRsiExistingLibraryCasAppendRequest(request,request_args);
    const checkedReceipt=verifyRsiExistingLibraryCasAppendReceipt(receipt,{
      ...receipt_args,
      request:checkedRequest,
      request_args,
    });
    if(
      checkedRequest.source_sha!==this.#sourceSha
      ||checkedReceipt.source_sha!==this.#sourceSha
      ||checkedReceipt.append_request_digest!==checkedRequest.append_request_digest
    )throw new Error('rsi_phase34b_archive_binding_mismatch');

    const existing=this.#rows.find(row=>row.request.request_id===checkedRequest.request_id);
    if(existing){
      if(
        existing.request.append_request_digest!==checkedRequest.append_request_digest
        ||existing.receipt.append_receipt_digest!==checkedReceipt.append_receipt_digest
      )throw new Error('rsi_phase34b_archive_identity_conflict');
      return zero({
        state:'IDEMPOTENT',
        append_request_digest:checkedRequest.append_request_digest,
        append_receipt_digest:checkedReceipt.append_receipt_digest,
      });
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_phase34b_archive_capacity_exceeded');
    const next=[...this.#rows,Object.freeze({request:checkedRequest,receipt:checkedReceipt})];
    await this.#persist(next);
    this.#rows=next;
    return zero({
      state:checkedReceipt.outcome,
      append_request_digest:checkedRequest.append_request_digest,
      append_receipt_digest:checkedReceipt.append_receipt_digest,
    });
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,
      initialized:this.#initialized,row_count:s.row_count,outcome_counts:s.outcome_counts,
      append_only:true,durable_before_visible:true,ambiguous_effects_retained:true,
      retry_after_ambiguous_allowed:false,
      storage_append_receipts_do_not_change_retrieval_exposure:true,
      archive_can_write_library:false,archive_can_change_retrieval_exposure:false,
      archive_can_change_lifecycle:false,archive_can_activate_skill:false,
      archive_can_schedule_work:false,authority_effect:false,
    });
  }
}

export function rsiExistingLibraryCasAppendTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.existing-library-cas-append-root.v1',
    version:1,
    phase34_exact_admission_certificate_required:true,
    exact_green_source_qualification_required:true,
    existing_verified_skill_library_only:true,
    compare_and_swap_required:true,
    exact_predecessor_library_required:true,
    exact_successor_readback_required:true,
    exact_predecessor_entries_preserved:true,
    exactly_one_intended_skill_append_required:true,
    external_library_writer_required:true,
    external_readback_verifier_required:true,
    one_attempt_only:true,
    ambiguous_effect_is_terminal:true,
    retry_after_ambiguous_allowed:false,
    phase34_harness_and_benchmark_security_lineage_bound:true,
    append_does_not_imply_retrieval_exposure:true,
    append_does_not_imply_skill_activation:true,
    append_does_not_change_lifecycle:true,
    append_does_not_change_governance:true,
    direct_library_append:false,
    direct_retrieval_exposure_change:false,
    direct_skill_activation:false,
    direct_lifecycle_mutation:false,
    direct_scheduler_action:false,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,phase34b_root_digest:digest(root)});
}
