import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA='metaengine.rsi.meta-profile-canary-admission.v1';
export const RSI_META_PROFILE_CANARY_DECISION_SCHEMA='metaengine.rsi.meta-profile-canary-decision.v1';
export const RSI_META_PROFILE_CANARY_OUTCOME_SCHEMA='metaengine.rsi.meta-profile-canary-outcome.v1';
export const RSI_META_PROFILE_CANARY_LEDGER_SCHEMA='metaengine.rsi.meta-profile-canary-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_CANARY_DECISIONS=32;
const ALLOWED_SURFACE='READ_ONLY_DECISION_SUPPORT';

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_canary_${l}_sha_invalid`);return x}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_canary_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_canary_${l}_invalid`);return x}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_canary_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_canary_${l}_retry_invalid`)}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function digestList(v,label,{allowEmpty=true}={}){
  if(!Array.isArray(v)||(!allowEmpty&&v.length<1)||v.length>64)throw new Error(`rsi_canary_${label}_invalid`);
  const out=[...new Set(v.map(x=>exactDigest(x,label)))].sort();
  if(out.length!==v.length)throw new Error(`rsi_canary_${label}_duplicate`);
  return Object.freeze(out);
}
function verifyEnvelope(row,schema,digestField,label){
  if(!row||row.schema!==schema||row.version!==1)throw new Error(`rsi_canary_${label}_invalid`);
  assertZero(row,label);
  const expected=exactDigest(row[digestField],label);
  const clone=structuredClone(row);delete clone[digestField];
  if(dg(clone)!==expected)throw new Error(`rsi_canary_${label}_digest_mismatch`);
  return Object.freeze(structuredClone(row));
}

export function createRsiMetaProfileCanaryAdmission({
  source_sha,canary_id,selection,qualification,meta_record,current_library,current_governance,
  cohort_digest,max_decisions=MAX_CANARY_DECISIONS,action_surface=ALLOWED_SURFACE,
  external_canary_owner=false,authored_by_candidate=true,
}={}){
  if(external_canary_owner!==true||authored_by_candidate!==false)throw new Error('rsi_canary_external_owner_required');
  if(!selection||selection.schema!=='metaengine.rsi.meta-profile-shadow-selection.v1'||selection.mode!=='SHADOW_ONLY')throw new Error('rsi_canary_shadow_selection_required');
  if(!qualification||qualification.schema!=='metaengine.rsi.meta-profile-qualification.v1'||qualification.qualified_for_shadow_profile_selection!==true)throw new Error('rsi_canary_qualification_required');
  if(!meta_record||meta_record.schema!=='metaengine.rsi.runtime-meta-skill-record.v1'||meta_record.eligible_for_meta_archive!==true)throw new Error('rsi_canary_meta_record_required');
  const source=exactSha(source_sha,'source');
  if(selection.source_sha!==source||qualification.source_sha!==source||meta_record.source_sha!==source)throw new Error('rsi_canary_source_binding_mismatch');
  if(selection.qualification_digest!==qualification.qualification_digest||selection.meta_record_digest!==meta_record.record_digest||qualification.meta_record_digest!==meta_record.record_digest)throw new Error('rsi_canary_lineage_binding_mismatch');
  if(!current_library||typeof current_library!=='object'||current_library.library_digest!==selection.library_digest||current_library.library_digest!==meta_record.library_digest)throw new Error('rsi_canary_library_identity_drift');
  if(!current_governance||typeof current_governance!=='object'||current_governance.library_digest!==current_library.library_digest)throw new Error('rsi_canary_governance_identity_invalid');
  const decisions=Number(max_decisions);
  if(decisions!==MAX_CANARY_DECISIONS)throw new Error('rsi_canary_fixed_decision_budget_required');
  if(String(action_surface||'').toUpperCase()!==ALLOWED_SURFACE)throw new Error('rsi_canary_surface_not_allowed');
  const core={
    schema:RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA,version:1,
    source_sha:source,canary_id:id(canary_id,'canary_id'),
    selection_digest:exactDigest(selection.selection_digest,'selection'),
    qualification_digest:exactDigest(qualification.qualification_digest,'qualification'),
    meta_record_digest:exactDigest(meta_record.record_digest,'meta_record'),
    incumbent_profile_digest:exactDigest(selection.incumbent_profile_digest,'incumbent_profile'),
    challenger_profile_digest:exactDigest(selection.challenger_profile_digest,'challenger_profile'),
    library_digest:exactDigest(current_library.library_digest,'library'),
    governance_digest:exactDigest(current_governance.governance_digest,'governance'),
    cohort_digest:exactDigest(cohort_digest,'cohort'),
    action_surface:ALLOWED_SURFACE,max_decisions:MAX_CANARY_DECISIONS,
    baseline_is_default:true,baseline_fallback_required:true,
    exact_identity_required:true,library_and_governance_drift_fail_closed:true,
    candidate_can_choose_cohort:false,candidate_can_choose_exposure:false,
    canary_can_execute_browser_effect:false,canary_decision_is_advisory_only:true,
    ambiguous_effect_retry_allowed:false,hard_invariant_failure_latches_rollback:true,
    external_canary_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:dg(core)});
}
export function verifyRsiMetaProfileCanaryAdmission(row){
  const checked=verifyEnvelope(row,RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA,'admission_digest','admission');
  if(checked.action_surface!==ALLOWED_SURFACE||checked.max_decisions!==MAX_CANARY_DECISIONS||checked.baseline_is_default!==true
    ||checked.baseline_fallback_required!==true||checked.exact_identity_required!==true
    ||checked.library_and_governance_drift_fail_closed!==true||checked.candidate_can_choose_cohort!==false
    ||checked.candidate_can_choose_exposure!==false||checked.canary_can_execute_browser_effect!==false
    ||checked.canary_decision_is_advisory_only!==true||checked.ambiguous_effect_retry_allowed!==false
    ||checked.hard_invariant_failure_latches_rollback!==true||checked.external_canary_owner!==true||checked.authored_by_candidate!==false)throw new Error('rsi_canary_admission_policy_invalid');
  return checked;
}

export function createRsiMetaProfileCanaryDecision({
  admission,decision_seq,context_digest,baseline_plan_digest,baseline_selected_skill_digests,
  challenger_skill_digest=null,challenger_status,
  current_library_digest,current_governance_digest,cohort_digest,
}={}){
  const a=verifyRsiMetaProfileCanaryAdmission(admission);
  const seq=Number(decision_seq);if(!Number.isSafeInteger(seq)||seq<1||seq>a.max_decisions)throw new Error('rsi_canary_decision_seq_invalid');
  if(exactDigest(current_library_digest,'current_library')!==a.library_digest||exactDigest(current_governance_digest,'current_governance')!==a.governance_digest)throw new Error('rsi_canary_identity_drift');
  if(exactDigest(cohort_digest,'decision_cohort')!==a.cohort_digest)throw new Error('rsi_canary_cohort_mismatch');
  const baseline=digestList(baseline_selected_skill_digests,'baseline_skill');
  const challenger=challenger_skill_digest==null?null:exactDigest(challenger_skill_digest,'challenger_skill');
  const status=String(challenger_status||'').toUpperCase();
  if(!['MATCHES_BASELINE','SHADOW_DIVERGENCE','BLOCKED_BY_GOVERNANCE','NO_APPLICABLE_META_ROLE'].includes(status))throw new Error('rsi_canary_challenger_status_invalid');
  const challengerAdvisory=status==='SHADOW_DIVERGENCE'&&challenger!=null;
  const mode=challengerAdvisory?'CHALLENGER_ADVISORY':'BASELINE';
  const core={
    schema:RSI_META_PROFILE_CANARY_DECISION_SCHEMA,version:1,
    canary_id:a.canary_id,admission_digest:a.admission_digest,decision_seq:seq,
    decision_id:`${a.canary_id}:decision:${seq}`,
    context_digest:exactDigest(context_digest,'context'),
    cohort_digest:a.cohort_digest,
    library_digest:a.library_digest,governance_digest:a.governance_digest,
    baseline_plan_digest:exactDigest(baseline_plan_digest,'baseline_plan'),
    baseline_selected_skill_digests:baseline,
    challenger_skill_digest:challenger,challenger_status:status,mode,
    action_surface:a.action_surface,
    baseline_fallback_required:true,baseline_execution_unchanged:true,
    challenger_is_advisory_only:true,decision_can_execute_browser_effect:false,
    decision_can_retry_physical_effect:false,decision_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,decision_digest:dg(core)});
}
export function verifyRsiMetaProfileCanaryDecision(row,admission){
  const a=verifyRsiMetaProfileCanaryAdmission(admission);
  const checked=verifyEnvelope(row,RSI_META_PROFILE_CANARY_DECISION_SCHEMA,'decision_digest','decision');
  if(checked.admission_digest!==a.admission_digest||checked.canary_id!==a.canary_id||checked.cohort_digest!==a.cohort_digest
    ||checked.library_digest!==a.library_digest||checked.governance_digest!==a.governance_digest||checked.action_surface!==a.action_surface
    ||checked.baseline_fallback_required!==true||checked.baseline_execution_unchanged!==true||checked.challenger_is_advisory_only!==true
    ||checked.decision_can_execute_browser_effect!==false||checked.decision_can_retry_physical_effect!==false
    ||checked.decision_is_execution_authority!==false)throw new Error('rsi_canary_decision_policy_invalid');
  return checked;
}

export function createRsiMetaProfileCanaryOutcome({
  admission,decision,outcome_id,outcome_safety,security_awareness,task_utility,
  ambiguous=false,hard_invariant_pass=true,evidence_digest,evidence_refs,
  external_evaluator=false,authored_by_candidate=true,
}={}){
  const a=verifyRsiMetaProfileCanaryAdmission(admission);
  const d=verifyRsiMetaProfileCanaryDecision(decision,a);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_canary_outcome_external_evaluator_required');
  const safety=String(outcome_safety||'').toUpperCase(),security=String(security_awareness||'').toUpperCase();
  if(!['PASS','FAIL'].includes(safety)||!['PASS','FAIL'].includes(security))throw new Error('rsi_canary_outcome_dimension_invalid');
  const utility=Number(task_utility);if(!Number.isFinite(utility)||utility<-1||utility>1)throw new Error('rsi_canary_task_utility_invalid');
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_canary_outcome_evidence_refs_invalid');
  const isAmbiguous=ambiguous===true,hardPass=hard_invariant_pass===true;
  const rollback=isAmbiguous||!hardPass||safety==='FAIL'||security==='FAIL';
  const core={
    schema:RSI_META_PROFILE_CANARY_OUTCOME_SCHEMA,version:1,
    outcome_id:id(outcome_id,'outcome_id'),
    canary_id:a.canary_id,admission_digest:a.admission_digest,
    decision_id:d.decision_id,decision_digest:d.decision_digest,decision_seq:d.decision_seq,
    outcome_safety:safety,security_awareness:security,task_utility:utility,
    ambiguous:isAmbiguous,hard_invariant_pass:hardPass,
    evidence_digest:exactDigest(evidence_digest,'outcome_evidence'),evidence_refs:Object.freeze(refs),
    rollback_required:rollback,
    learning_success_eligible:!rollback&&utility>=0,
    ambiguous_is_not_success:false,ambiguous_retry_allowed:false,
    external_evaluator:true,authored_by_candidate:false,
    outcome_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,outcome_digest:dg(core)});
}
export function verifyRsiMetaProfileCanaryOutcome(row,{admission,decision}={}){
  const a=verifyRsiMetaProfileCanaryAdmission(admission);
  const d=verifyRsiMetaProfileCanaryDecision(decision,a);
  const checked=verifyEnvelope(row,RSI_META_PROFILE_CANARY_OUTCOME_SCHEMA,'outcome_digest','outcome');
  if(checked.admission_digest!==a.admission_digest||checked.decision_digest!==d.decision_digest||checked.external_evaluator!==true
    ||checked.authored_by_candidate!==false||checked.ambiguous_is_not_success!==false||checked.ambiguous_retry_allowed!==false
    ||checked.outcome_is_execution_authority!==false)throw new Error('rsi_canary_outcome_policy_invalid');
  const expectedRollback=checked.ambiguous===true||checked.hard_invariant_pass!==true||checked.outcome_safety==='FAIL'||checked.security_awareness==='FAIL';
  if(checked.rollback_required!==expectedRollback)throw new Error('rsi_canary_outcome_rollback_mismatch');
  return checked;
}

function stateCore(sourceSha,entries){
  const core={
    schema:RSI_META_PROFILE_CANARY_LEDGER_SCHEMA,version:1,source_sha:sourceSha,
    entries,canary_count:entries.length,
    append_only:true,max_canary_decisions:MAX_CANARY_DECISIONS,
    baseline_fallback_required:true,rollback_latch_monotonic:true,
    candidate_can_clear_rollback:false,candidate_can_expand_budget:false,
    ledger_can_execute_browser_effect:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:dg(core)};
}

export class RsiMetaProfileCanaryLedger{
  #path;#sourceSha;#entries=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_canary_ledger_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');
      if(p.schema!==RSI_META_PROFILE_CANARY_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.max_canary_decisions!==MAX_CANARY_DECISIONS||p.baseline_fallback_required!==true||p.rollback_latch_monotonic!==true
        ||p.candidate_can_clear_rollback!==false||p.candidate_can_expand_budget!==false||p.ledger_can_execute_browser_effect!==false)throw new Error('rsi_canary_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;
      if(dg(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_canary_ledger_digest_mismatch');
      if(!Array.isArray(p.entries)||p.entries.length>256)throw new Error('rsi_canary_ledger_entries_invalid');
      for(const entry of p.entries){
        const admission=verifyRsiMetaProfileCanaryAdmission(entry.admission);
        if(admission.source_sha!==this.#sourceSha)throw new Error('rsi_canary_ledger_source_mismatch');
        if(!Array.isArray(entry.decisions)||!Array.isArray(entry.outcomes)||entry.decisions.length>MAX_CANARY_DECISIONS||entry.outcomes.length>entry.decisions.length)throw new Error('rsi_canary_ledger_entry_shape_invalid');
        entry.decisions.forEach((d,i)=>{const checked=verifyRsiMetaProfileCanaryDecision(d,admission);if(checked.decision_seq!==i+1)throw new Error('rsi_canary_ledger_decision_sequence_invalid')});
        const byDecision=new Map(entry.decisions.map(d=>[d.decision_digest,d]));
        for(const outcome of entry.outcomes){const decision=byDecision.get(outcome.decision_digest);if(!decision)throw new Error('rsi_canary_ledger_outcome_decision_missing');verifyRsiMetaProfileCanaryOutcome(outcome,{admission,decision})}
        const shouldRollback=entry.outcomes.some(x=>x.rollback_required===true);
        if(entry.rollback_required!==shouldRollback)throw new Error('rsi_canary_ledger_rollback_latch_invalid');
      }
      this.#entries=p.entries;
    }catch(e){if(e?.code!=='ENOENT')throw e}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){const s=stateCore(this.#sourceSha,this.#entries);const t=`${this.#path}.tmp`;const h=await fs.open(t,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(t,this.#path)}
  #entry(canaryId){return this.#entries.find(x=>x.admission.canary_id===canaryId)}
  async admit(admission){
    if(!this.#initialized)throw new Error('rsi_canary_ledger_not_initialized');
    const a=verifyRsiMetaProfileCanaryAdmission(admission);
    if(a.source_sha!==this.#sourceSha)throw new Error('rsi_canary_admission_source_mismatch');
    const existing=this.#entry(a.canary_id);
    if(existing){if(existing.admission.admission_digest!==a.admission_digest)throw new Error('rsi_canary_admission_identity_conflict');return zero({state:'IDEMPOTENT',admission_digest:a.admission_digest})}
    this.#entries.push({admission:structuredClone(a),decisions:[],outcomes:[],rollback_required:false,rollback_reason:null});
    await this.#persist();return zero({state:'CANARY_ADMITTED',admission_digest:a.admission_digest});
  }
  async issueDecision(canaryId,input){
    if(!this.#initialized)throw new Error('rsi_canary_ledger_not_initialized');
    const entry=this.#entry(canaryId);if(!entry)throw new Error('rsi_canary_missing');
    if(entry.rollback_required)throw new Error('rsi_canary_rollback_latched');
    if(entry.decisions.length>=entry.admission.max_decisions)throw new Error('rsi_canary_decision_budget_exhausted');
    if(entry.decisions.length>entry.outcomes.length)throw new Error('rsi_canary_previous_decision_outcome_pending');
    const decision=createRsiMetaProfileCanaryDecision({...input,admission:entry.admission,decision_seq:entry.decisions.length+1});
    entry.decisions.push(structuredClone(decision));await this.#persist();return decision;
  }
  async recordOutcome(canaryId,outcome){
    if(!this.#initialized)throw new Error('rsi_canary_ledger_not_initialized');
    const entry=this.#entry(canaryId);if(!entry)throw new Error('rsi_canary_missing');
    const decision=entry.decisions.find(d=>d.decision_digest===outcome?.decision_digest);if(!decision)throw new Error('rsi_canary_outcome_decision_missing');
    const existing=entry.outcomes.find(x=>x.decision_digest===decision.decision_digest);
    if(existing){if(existing.outcome_digest!==outcome.outcome_digest)throw new Error('rsi_canary_outcome_conflict');return zero({state:'IDEMPOTENT',outcome_digest:existing.outcome_digest,rollback_required:entry.rollback_required})}
    const checked=verifyRsiMetaProfileCanaryOutcome(outcome,{admission:entry.admission,decision});
    entry.outcomes.push(structuredClone(checked));
    if(checked.rollback_required){entry.rollback_required=true;entry.rollback_reason=checked.ambiguous?'AMBIGUOUS':checked.hard_invariant_pass!==true?'HARD_INVARIANT':checked.outcome_safety==='FAIL'?'OUTCOME_SAFETY':'SECURITY_AWARENESS'}
    await this.#persist();
    return zero({state:entry.rollback_required?'ROLLBACK_REQUIRED':'OUTCOME_RECORDED',outcome_digest:checked.outcome_digest,rollback_required:entry.rollback_required});
  }
  admission(canaryId){if(!this.#initialized)throw new Error('rsi_canary_ledger_not_initialized');const e=this.#entry(canaryId);return e?Object.freeze(structuredClone(e.admission)):null}
  snapshot(){
    const s=stateCore(this.#sourceSha,this.#entries);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,canary_count:s.canary_count,
      active_canary_count:this.#entries.filter(x=>!x.rollback_required&&x.decisions.length<x.admission.max_decisions).length,
      rollback_required_count:this.#entries.filter(x=>x.rollback_required).length,
      total_decision_count:this.#entries.reduce((n,x)=>n+x.decisions.length,0),
      total_outcome_count:this.#entries.reduce((n,x)=>n+x.outcomes.length,0),
      max_canary_decisions:MAX_CANARY_DECISIONS,baseline_fallback_required:true,rollback_latch_monotonic:true,
      ledger_can_execute_browser_effect:false,authority_effect:false});
  }
}

export function rsiMetaProfileCanaryTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.meta-profile-canary-root.v1',version:1,
    allowed_surface:ALLOWED_SURFACE,max_canary_decisions:MAX_CANARY_DECISIONS,
    exact_shadow_selection_required:true,exact_qualification_required:true,exact_meta_record_required:true,
    exact_library_and_governance_identity_required:true,external_cohort_required:true,external_canary_owner_required:true,
    baseline_is_default:true,baseline_fallback_required:true,
    outcome_safety_required:true,security_awareness_required:true,task_utility_required:true,
    one_outcome_per_decision_required:true,rollback_latch_monotonic:true,
    ambiguity_latches_rollback:true,hard_invariant_failure_latches_rollback:true,
    candidate_can_choose_cohort:false,candidate_can_choose_exposure:false,candidate_can_clear_rollback:false,
    canary_decisions_advisory_only:true,canary_can_execute_browser_effect:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,canary_root_digest:dg(root)});
}
