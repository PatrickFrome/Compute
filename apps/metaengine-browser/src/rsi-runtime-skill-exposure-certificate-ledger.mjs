import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA,
  verifyRsiSkillExposureReleaseCertificate,
} from './rsi-skill-exposure-release.mjs';

export const RSI_RUNTIME_SKILL_EXPOSURE_CERTIFICATE_LEDGER_SCHEMA='metaengine.rsi.runtime-skill-exposure-certificate-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const MAX_RECORDS=1024;
const ZERO_FIELDS=[
  'execution_authority','browser_authority','task_authority','production_mutation_authority',
  'promotion_authority','self_update_authority','scheduler_authority','signing_authority',
  'direct_tool_execution_authority','authority_effect',
];

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;
}
function exactSha(v,l='source'){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA40_RE.test(x))throw new Error(`rsi_runtime_exposure_certificate_${l}_sha_invalid`);
  return x;
}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_runtime_exposure_certificate_${l}_digest_invalid`);
  return x;
}
function assertZero(v,l){
  for(const field of ZERO_FIELDS){
    if(v?.[field]!==false)throw new Error(`rsi_runtime_exposure_certificate_${l}_${field}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_runtime_exposure_certificate_${l}_automatic_retry_invalid`);
}
function cloneFrozen(v){return Object.freeze(structuredClone(v));}
function validateStoredCertificate(certificate){
  if(!certificate||certificate.schema!==RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA||certificate.version!==1){
    throw new Error('rsi_runtime_exposure_certificate_invalid');
  }
  assertZero(certificate,'certificate');
  if(certificate.release_token!==null
    ||certificate.one_attempt_release_required!==true
    ||certificate.ambiguous_release_retry_allowed!==false
    ||certificate.automatic_full_activation_allowed!==false
    ||certificate.release_does_not_grant_browser_authority!==true
    ||certificate.release_does_not_grant_tool_authority!==true){
    throw new Error('rsi_runtime_exposure_certificate_policy_invalid');
  }
  const eligible=certificate.state==='ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE';
  const rejected=certificate.state==='REJECTED_EXPOSURE_RELEASE';
  if(!eligible&&!rejected)throw new Error('rsi_runtime_exposure_certificate_state_invalid');
  if(certificate.eligible_for_one_attempt_exposure_release!==eligible){
    throw new Error('rsi_runtime_exposure_certificate_eligibility_mismatch');
  }
  exactDigest(certificate.library_digest,'library');
  exactDigest(certificate.current_governance_digest,'current_governance');
  exactDigest(certificate.next_governance_digest,'next_governance');
  exactDigest(certificate.release_preview_digest,'release_preview');
  exactDigest(certificate.dormant_retrieval_review_digest,'dormant_retrieval_review');
  exactDigest(certificate.skill_digest,'skill');
  const core=structuredClone(certificate);delete core.certificate_digest;
  if(digest(core)!==exactDigest(certificate.certificate_digest,'certificate')){
    throw new Error('rsi_runtime_exposure_certificate_digest_mismatch');
  }
  return cloneFrozen(certificate);
}
function transitionKey(certificate){
  return digest({
    schema:'metaengine.rsi.runtime-skill-exposure-transition-key.v1',
    skill_digest:certificate.skill_digest,
    library_digest:certificate.library_digest,
    current_governance_digest:certificate.current_governance_digest,
    next_governance_digest:certificate.next_governance_digest,
    release_preview_digest:certificate.release_preview_digest,
    dormant_retrieval_review_digest:certificate.dormant_retrieval_review_digest,
    release_mode:certificate.release_mode,
  });
}
function recordCore({sourceSha,certificate,recordedAt}){
  return {
    schema:'metaengine.rsi.runtime-skill-exposure-certificate-record.v1',
    version:1,
    source_sha:sourceSha,
    certificate_id:certificate.certificate_id,
    certificate_digest:certificate.certificate_digest,
    transition_key_digest:transitionKey(certificate),
    certificate,
    recorded_at:recordedAt,
    state:certificate.state,
    eligible_for_one_attempt_exposure_release:certificate.eligible_for_one_attempt_exposure_release===true,
    skill_digest:certificate.skill_digest,
    library_digest:certificate.library_digest,
    current_governance_digest:certificate.current_governance_digest,
    next_governance_digest:certificate.next_governance_digest,
    release_preview_digest:certificate.release_preview_digest,
    dormant_retrieval_review_digest:certificate.dormant_retrieval_review_digest,
    evidence_is_zero_effect:true,
    certificate_can_execute_release:false,
    ledger_can_release_hold:false,
    release_effect_performed:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
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
  };
}
function validateRecord(row,sourceSha){
  if(!row||row.schema!=='metaengine.rsi.runtime-skill-exposure-certificate-record.v1'||row.version!==1){
    throw new Error('rsi_runtime_exposure_certificate_record_invalid');
  }
  if(exactSha(row.source_sha,'record_source')!==sourceSha)throw new Error('rsi_runtime_exposure_certificate_record_source_mismatch');
  assertZero(row,'record');
  if(row.evidence_is_zero_effect!==true||row.certificate_can_execute_release!==false||row.ledger_can_release_hold!==false
    ||row.release_effect_performed!==false||row.retrieval_exposure_changed!==false||row.skill_activation_performed!==false){
    throw new Error('rsi_runtime_exposure_certificate_record_policy_invalid');
  }
  if(!Number.isFinite(Date.parse(String(row.recorded_at||''))))throw new Error('rsi_runtime_exposure_certificate_record_time_invalid');
  const certificate=validateStoredCertificate(row.certificate);
  for(const [field,value] of [
    ['certificate_digest',certificate.certificate_digest],
    ['transition_key_digest',transitionKey(certificate)],
    ['skill_digest',certificate.skill_digest],
    ['library_digest',certificate.library_digest],
    ['current_governance_digest',certificate.current_governance_digest],
    ['next_governance_digest',certificate.next_governance_digest],
    ['release_preview_digest',certificate.release_preview_digest],
    ['dormant_retrieval_review_digest',certificate.dormant_retrieval_review_digest],
  ]){
    if(row[field]!==value)throw new Error(`rsi_runtime_exposure_certificate_record_${field}_mismatch`);
  }
  if(row.certificate_id!==certificate.certificate_id||row.state!==certificate.state
    ||row.eligible_for_one_attempt_exposure_release!==(certificate.eligible_for_one_attempt_exposure_release===true)){
    throw new Error('rsi_runtime_exposure_certificate_record_identity_mismatch');
  }
  const core=structuredClone(row);delete core.record_digest;
  if(digest(core)!==exactDigest(row.record_digest,'record'))throw new Error('rsi_runtime_exposure_certificate_record_digest_mismatch');
  return Object.freeze({...row,certificate});
}
function stateCore({sourceSha,rows}){
  const eligible=rows.filter(row=>row.eligible_for_one_attempt_exposure_release===true).length;
  const rejected=rows.length-eligible;
  const core={
    schema:RSI_RUNTIME_SKILL_EXPOSURE_CERTIFICATE_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    records:rows,
    record_count:rows.length,
    eligible_record_count:eligible,
    rejected_record_count:rejected,
    append_only:true,
    durable_before_visible:true,
    exact_external_certificate_verification_required:true,
    unique_eligible_transition_required:true,
    certificate_is_evidence_not_effect_authority:true,
    ledger_can_release_hold:false,
    ledger_can_change_retrieval_exposure:false,
    ledger_can_activate_skill:false,
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
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillExposureCertificateLedger{
  #path;#sourceSha;#clock;#rows=[];#initialized=false;
  constructor({statePath,source_sha,clock=()=>Date.now()}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_runtime_exposure_certificate_state_path_required');
    if(typeof clock!=='function')throw new Error('rsi_runtime_exposure_certificate_clock_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha);this.#clock=clock;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      if(parsed.schema!==RSI_RUNTIME_SKILL_EXPOSURE_CERTIFICATE_LEDGER_SCHEMA||parsed.version!==1
        ||parsed.source_sha!==this.#sourceSha||parsed.append_only!==true||parsed.durable_before_visible!==true
        ||parsed.certificate_is_evidence_not_effect_authority!==true||parsed.ledger_can_release_hold!==false){
        throw new Error('rsi_runtime_exposure_certificate_state_invalid');
      }
      assertZero(parsed,'state');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_runtime_exposure_certificate_state_digest_mismatch');
      if(!Array.isArray(parsed.records)||parsed.records.length>MAX_RECORDS||parsed.record_count!==parsed.records.length){
        throw new Error('rsi_runtime_exposure_certificate_records_invalid');
      }
      const ids=new Set(),digests=new Set();
      this.#rows=parsed.records.map(raw=>{
        const row=validateRecord(raw,this.#sourceSha);
        if(ids.has(row.certificate_id)||digests.has(row.certificate_digest))throw new Error('rsi_runtime_exposure_certificate_duplicate');
        ids.add(row.certificate_id);digests.add(row.certificate_digest);return row;
      });
      const expected=stateCore({sourceSha:this.#sourceSha,rows:this.#rows});
      if(parsed.eligible_record_count!==expected.eligible_record_count||parsed.rejected_record_count!==expected.rejected_record_count){
        throw new Error('rsi_runtime_exposure_certificate_state_count_mismatch');
      }
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_runtime_exposure_certificate_not_initialized')}
  #now(){const n=Number(this.#clock());if(!Number.isFinite(n))throw new Error('rsi_runtime_exposure_certificate_clock_invalid');return new Date(n).toISOString()}
  async #persist(rows){
    const state=stateCore({sourceSha:this.#sourceSha,rows});
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  async add({certificate,verification_args}={}){
    this.#assertInit();
    const canonical=verifyRsiSkillExposureReleaseCertificate(certificate,verification_args||{});
    const existingById=this.#rows.find(row=>row.certificate_id===canonical.certificate_id);
    if(existingById){
      if(existingById.certificate_digest!==canonical.certificate_digest)throw new Error('rsi_runtime_exposure_certificate_id_reuse');
      return Object.freeze({state:'IDEMPOTENT',record:structuredClone(existingById),authority_effect:false});
    }
    const existingByDigest=this.#rows.find(row=>row.certificate_digest===canonical.certificate_digest);
    if(existingByDigest)throw new Error('rsi_runtime_exposure_certificate_digest_reuse');
    const key=transitionKey(canonical);
    if(canonical.eligible_for_one_attempt_exposure_release===true
      &&this.#rows.some(row=>row.eligible_for_one_attempt_exposure_release===true&&row.transition_key_digest===key)){
      throw new Error('rsi_runtime_exposure_certificate_transition_already_certified');
    }
    if(this.#rows.length>=MAX_RECORDS)throw new Error('rsi_runtime_exposure_certificate_capacity_exceeded');
    const core=recordCore({sourceSha:this.#sourceSha,certificate:canonical,recordedAt:this.#now()});
    const record=Object.freeze({...core,record_digest:digest(core)});
    const next=[...this.#rows,record];
    await this.#persist(next);
    this.#rows=next;
    return Object.freeze({state:'RECORDED_ZERO_EFFECT',record:structuredClone(record),authority_effect:false});
  }
  get(certificate_id){
    this.#assertInit();
    const id=String(certificate_id||'').trim();
    const row=this.#rows.find(candidate=>candidate.certificate_id===id);
    return row?structuredClone(row):null;
  }
  snapshot(){
    const eligible=this.#rows.filter(row=>row.eligible_for_one_attempt_exposure_release===true).length;
    return Object.freeze({
      schema:RSI_RUNTIME_SKILL_EXPOSURE_CERTIFICATE_LEDGER_SCHEMA,
      version:1,
      source_sha:this.#sourceSha,
      initialized:this.#initialized,
      record_count:this.#rows.length,
      eligible_record_count:eligible,
      rejected_record_count:this.#rows.length-eligible,
      latest_certificate_digest:this.#rows.at(-1)?.certificate_digest||null,
      append_only:true,
      durable_before_visible:true,
      unique_eligible_transition_required:true,
      certificate_is_evidence_not_effect_authority:true,
      ledger_can_release_hold:false,
      ledger_can_change_retrieval_exposure:false,
      ledger_can_activate_skill:false,
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
}

export function rsiRuntimeSkillExposureCertificateLedgerTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.runtime-skill-exposure-certificate-ledger-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-runtime-skill-exposure-certificate-ledger.mjs',
    verified_phase36_certificate_required:true,
    full_external_verifier_args_required_on_record:true,
    append_only:true,
    durable_before_visible:true,
    rejected_certificate_evidence_retained:true,
    certificate_id_reuse_forbidden:true,
    unique_eligible_transition_required:true,
    certificate_digest_reuse_forbidden:true,
    certificate_is_evidence_not_effect_authority:true,
    one_attempt_release_execution_implemented_here:false,
    ledger_can_release_hold:false,
    ledger_can_change_retrieval_exposure:false,
    ledger_can_activate_skill:false,
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
  };
  return Object.freeze({...root,exposure_certificate_ledger_root_digest:digest(root)});
}
