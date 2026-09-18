import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA,
} from './rsi-meta-profile-shadow-selection.mjs';

export const RSI_BOUNDED_CANARY_EVIDENCE_SCHEMA='metaengine.rsi.bounded-canary-shadow-evidence.v1';
export const RSI_BOUNDED_CANARY_ADMISSION_SCHEMA='metaengine.rsi.bounded-canary-admission.v1';
export const RSI_BOUNDED_CANARY_LEDGER_SCHEMA='metaengine.rsi.bounded-canary-admission-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MIN_SHADOW_OBSERVATIONS=32;
const MAX_READ_ONLY_DECISIONS=16;
const MAX_ROWS=1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function exactSha(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA40_RE.test(out))throw new Error(`rsi_canary_${label}_sha_invalid`);
  return out;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_canary_${label}_digest_invalid`);
  return out;
}
function boundedId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out))throw new Error(`rsi_canary_${label}_invalid`);
  return out;
}
function nonNegativeInt(value,label){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<0)throw new Error(`rsi_canary_${label}_invalid`);
  return out;
}
function positiveInt(value,label){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<1)throw new Error(`rsi_canary_${label}_invalid`);
  return out;
}
function assertZero(value,label){
  for(const field of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','authority_effect',
  ]){
    if(value?.[field]!==false)throw new Error(`rsi_canary_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_canary_${label}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function refs(value,label){
  if(!Array.isArray(value)||value.length<1)throw new Error(`rsi_canary_${label}_refs_invalid`);
  const out=[...new Set(value.map((row)=>boundedId(row,label)))].sort();
  if(out.length!==value.length)throw new Error(`rsi_canary_${label}_refs_invalid`);
  return Object.freeze(out);
}
function verifyShadowSelectionShape(selection){
  if(!selection||selection.schema!==RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA||selection.version!==1){
    throw new Error('rsi_canary_shadow_selection_invalid');
  }
  assertZero(selection,'shadow_selection');
  if(
    selection.mode!=='SHADOW_ONLY'
    ||selection.external_selector!==true
    ||selection.authored_by_candidate!==false
    ||selection.selection_can_change_execution!==false
    ||selection.selection_can_replace_incumbent!==false
    ||selection.selection_can_grant_skill_activity!==false
    ||selection.continuous_shadow_review_required!==true
    ||selection.canary_gate_still_required!==true
  ){
    throw new Error('rsi_canary_shadow_selection_policy_invalid');
  }
  const clone=structuredClone(selection);
  delete clone.selection_digest;
  if(digest(clone)!==exactDigest(selection.selection_digest,'shadow_selection')){
    throw new Error('rsi_canary_shadow_selection_digest_mismatch');
  }
  return Object.freeze(structuredClone(selection));
}

export function createRsiBoundedCanaryShadowEvidence({
  evidence_id,
  shadow_selection,
  context_cohort_digest,
  shadow_observation_count,
  matched_count,
  divergence_count,
  ambiguity_count,
  incident_count,
  hard_invariant_violation_count,
  identity_drift_count,
  outcome_evidence_digest,
  safety_evidence_digest,
  security_evidence_digest,
  awareness_evidence_digest,
  utility_evidence_digest,
  evidence_refs,
  external_observer=false,
  authored_by_candidate=true,
}={}){
  const selection=verifyShadowSelectionShape(shadow_selection);
  if(external_observer!==true||authored_by_candidate!==false){
    throw new Error('rsi_canary_external_observer_required');
  }
  const total=positiveInt(shadow_observation_count,'observation_count');
  const matched=nonNegativeInt(matched_count,'matched_count');
  const diverged=nonNegativeInt(divergence_count,'divergence_count');
  const ambiguous=nonNegativeInt(ambiguity_count,'ambiguity_count');
  const incidents=nonNegativeInt(incident_count,'incident_count');
  const hardFailures=nonNegativeInt(hard_invariant_violation_count,'hard_invariant_violation_count');
  const identityDrift=nonNegativeInt(identity_drift_count,'identity_drift_count');
  if(matched+diverged+ambiguous!==total)throw new Error('rsi_canary_shadow_counts_inconsistent');
  const rollbackRequired=ambiguous>0||incidents>0||hardFailures>0||identityDrift>0;
  const eligible=total>=MIN_SHADOW_OBSERVATIONS&&rollbackRequired===false;
  const core={
    schema:RSI_BOUNDED_CANARY_EVIDENCE_SCHEMA,
    version:1,
    source_sha:exactSha(selection.source_sha,'source'),
    evidence_id:boundedId(evidence_id,'evidence_id'),
    shadow_selection_digest:selection.selection_digest,
    incumbent_profile_digest:exactDigest(selection.incumbent_profile_digest,'incumbent_profile'),
    challenger_profile_digest:exactDigest(selection.challenger_profile_digest,'challenger_profile'),
    current_library_digest:exactDigest(selection.library_digest,'library'),
    context_cohort_digest:exactDigest(context_cohort_digest,'context_cohort'),
    shadow_observation_count:total,
    matched_count:matched,
    divergence_count:diverged,
    ambiguity_count:ambiguous,
    incident_count:incidents,
    hard_invariant_violation_count:hardFailures,
    identity_drift_count:identityDrift,
    outcome_evidence_digest:exactDigest(outcome_evidence_digest,'outcome_evidence'),
    safety_evidence_digest:exactDigest(safety_evidence_digest,'safety_evidence'),
    security_evidence_digest:exactDigest(security_evidence_digest,'security_evidence'),
    awareness_evidence_digest:exactDigest(awareness_evidence_digest,'awareness_evidence'),
    utility_evidence_digest:exactDigest(utility_evidence_digest,'utility_evidence'),
    evidence_refs:refs(evidence_refs,'evidence_ref'),
    identity_stable:identityDrift===0,
    hard_invariants_pass:hardFailures===0,
    ambiguous_shadow_outcome_present:ambiguous>0,
    incident_present:incidents>0,
    rollback_required_latched:rollbackRequired,
    minimum_shadow_observations:MIN_SHADOW_OBSERVATIONS,
    eligible_for_bounded_canary_admission:eligible,
    evidence_is_activation_authority:false,
    external_observer:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,evidence_digest:digest(core)});
}

export function verifyRsiBoundedCanaryShadowEvidence(evidence,{shadow_selection}={}){
  if(!evidence||evidence.schema!==RSI_BOUNDED_CANARY_EVIDENCE_SCHEMA||evidence.version!==1){
    throw new Error('rsi_canary_shadow_evidence_invalid');
  }
  assertZero(evidence,'shadow_evidence');
  if(
    evidence.external_observer!==true
    ||evidence.authored_by_candidate!==false
    ||evidence.evidence_is_activation_authority!==false
    ||evidence.minimum_shadow_observations!==MIN_SHADOW_OBSERVATIONS
  ){
    throw new Error('rsi_canary_shadow_evidence_policy_invalid');
  }
  const canonical=createRsiBoundedCanaryShadowEvidence({
    evidence_id:evidence.evidence_id,
    shadow_selection,
    context_cohort_digest:evidence.context_cohort_digest,
    shadow_observation_count:evidence.shadow_observation_count,
    matched_count:evidence.matched_count,
    divergence_count:evidence.divergence_count,
    ambiguity_count:evidence.ambiguity_count,
    incident_count:evidence.incident_count,
    hard_invariant_violation_count:evidence.hard_invariant_violation_count,
    identity_drift_count:evidence.identity_drift_count,
    outcome_evidence_digest:evidence.outcome_evidence_digest,
    safety_evidence_digest:evidence.safety_evidence_digest,
    security_evidence_digest:evidence.security_evidence_digest,
    awareness_evidence_digest:evidence.awareness_evidence_digest,
    utility_evidence_digest:evidence.utility_evidence_digest,
    evidence_refs:evidence.evidence_refs,
    external_observer:true,
    authored_by_candidate:false,
  });
  if(canonical.evidence_digest!==exactDigest(evidence.evidence_digest,'shadow_evidence')){
    throw new Error('rsi_canary_shadow_evidence_digest_mismatch');
  }
  return canonical;
}

export function createRsiBoundedCanaryAdmission({
  admission_id,
  shadow_selection,
  shadow_evidence,
  fixed_cohort_digest,
  decision_budget=MAX_READ_ONLY_DECISIONS,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  const selection=verifyShadowSelectionShape(shadow_selection);
  const evidence=verifyRsiBoundedCanaryShadowEvidence(shadow_evidence,{shadow_selection:selection});
  if(external_admission_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_canary_external_admission_owner_required');
  }
  if(evidence.eligible_for_bounded_canary_admission!==true||evidence.rollback_required_latched===true){
    throw new Error('rsi_canary_clean_shadow_evidence_required');
  }
  const cohort=exactDigest(fixed_cohort_digest,'fixed_cohort');
  if(cohort!==evidence.context_cohort_digest)throw new Error('rsi_canary_cohort_binding_mismatch');
  const budget=positiveInt(decision_budget,'decision_budget');
  if(budget!==MAX_READ_ONLY_DECISIONS)throw new Error('rsi_canary_fixed_decision_budget_required');
  const core={
    schema:RSI_BOUNDED_CANARY_ADMISSION_SCHEMA,
    version:1,
    source_sha:selection.source_sha,
    admission_id:boundedId(admission_id,'admission_id'),
    shadow_selection_digest:selection.selection_digest,
    shadow_evidence_digest:evidence.evidence_digest,
    incumbent_profile_digest:selection.incumbent_profile_digest,
    challenger_profile_digest:selection.challenger_profile_digest,
    fixed_cohort_digest:cohort,
    decision_budget:budget,
    canary_surface:'READ_ONLY_DECISION_SUPPORT',
    incumbent_remains_default:true,
    incumbent_is_mandatory_fallback:true,
    challenger_may_only_supply_advisory_decision_support:true,
    canary_mutations_allowed:false,
    canary_browser_effects_allowed:false,
    canary_tool_execution_allowed:false,
    canary_profile_replacement_allowed:false,
    cohort_is_externally_fixed:true,
    candidate_can_choose_cohort:false,
    candidate_can_choose_budget:false,
    identity_drift_fails_closed:true,
    ambiguity_fails_closed:true,
    hard_invariant_failure_fails_closed:true,
    incident_fails_closed:true,
    rollback_required_is_terminal_for_this_admission:true,
    eligible_for_external_bounded_canary_handoff:true,
    canary_activation_authorized:false,
    live_profile_activation_authorized:false,
    external_activation_gate_still_required:true,
    external_admission_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiBoundedCanaryAdmission(admission,{shadow_selection,shadow_evidence}={}){
  if(!admission||admission.schema!==RSI_BOUNDED_CANARY_ADMISSION_SCHEMA||admission.version!==1){
    throw new Error('rsi_canary_admission_invalid');
  }
  assertZero(admission,'admission');
  if(
    admission.canary_surface!=='READ_ONLY_DECISION_SUPPORT'
    ||admission.incumbent_remains_default!==true
    ||admission.incumbent_is_mandatory_fallback!==true
    ||admission.challenger_may_only_supply_advisory_decision_support!==true
    ||admission.canary_mutations_allowed!==false
    ||admission.canary_browser_effects_allowed!==false
    ||admission.canary_tool_execution_allowed!==false
    ||admission.canary_profile_replacement_allowed!==false
    ||admission.cohort_is_externally_fixed!==true
    ||admission.candidate_can_choose_cohort!==false
    ||admission.candidate_can_choose_budget!==false
    ||admission.identity_drift_fails_closed!==true
    ||admission.ambiguity_fails_closed!==true
    ||admission.hard_invariant_failure_fails_closed!==true
    ||admission.incident_fails_closed!==true
    ||admission.rollback_required_is_terminal_for_this_admission!==true
    ||admission.eligible_for_external_bounded_canary_handoff!==true
    ||admission.canary_activation_authorized!==false
    ||admission.live_profile_activation_authorized!==false
    ||admission.external_activation_gate_still_required!==true
    ||admission.external_admission_owner!==true
    ||admission.authored_by_candidate!==false
  ){
    throw new Error('rsi_canary_admission_policy_invalid');
  }
  const canonical=createRsiBoundedCanaryAdmission({
    admission_id:admission.admission_id,
    shadow_selection,
    shadow_evidence,
    fixed_cohort_digest:admission.fixed_cohort_digest,
    decision_budget:admission.decision_budget,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(admission.admission_digest,'admission')){
    throw new Error('rsi_canary_admission_digest_mismatch');
  }
  return canonical;
}

function ledgerState(sourceSha,rows){
  const rollbackLatched=rows.some((row)=>row.shadow_evidence?.rollback_required_latched===true);
  const core={
    schema:RSI_BOUNDED_CANARY_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    append_only:true,
    rollback_required_latched:rollbackLatched,
    active_canary_admission_digest:null,
    ledger_can_activate_canary:false,
    ledger_can_clear_rollback_latch:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiBoundedCanaryAdmissionLedger{
  #path;
  #sourceSha;
  #rows=[];
  #initialized=false;

  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_canary_ledger_path_required');
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'source');
  }

  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'ledger');
      if(
        parsed.schema!==RSI_BOUNDED_CANARY_LEDGER_SCHEMA
        ||parsed.version!==1
        ||parsed.source_sha!==this.#sourceSha
        ||parsed.append_only!==true
        ||parsed.active_canary_admission_digest!==null
        ||parsed.ledger_can_activate_canary!==false
        ||parsed.ledger_can_clear_rollback_latch!==false
      ){
        throw new Error('rsi_canary_ledger_state_invalid');
      }
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'ledger')){
        throw new Error('rsi_canary_ledger_digest_mismatch');
      }
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)throw new Error('rsi_canary_ledger_rows_invalid');
      this.#rows=parsed.rows.map((row)=>{
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_canary_ledger_row_source_mismatch');
        if(!row.shadow_evidence||row.shadow_evidence.schema!==RSI_BOUNDED_CANARY_EVIDENCE_SCHEMA){
          throw new Error('rsi_canary_ledger_evidence_missing');
        }
        assertZero(row.shadow_evidence,'shadow_evidence');
        const evidenceClone=structuredClone(row.shadow_evidence);delete evidenceClone.evidence_digest;
        if(digest(evidenceClone)!==exactDigest(row.shadow_evidence.evidence_digest,'shadow_evidence')){
          throw new Error('rsi_canary_ledger_evidence_digest_mismatch');
        }
        if(row.admission!==null){
          assertZero(row.admission,'admission');
          const admissionClone=structuredClone(row.admission);delete admissionClone.admission_digest;
          if(digest(admissionClone)!==exactDigest(row.admission.admission_digest,'admission')){
            throw new Error('rsi_canary_ledger_admission_digest_mismatch');
          }
          if(row.admission.shadow_evidence_digest!==row.shadow_evidence.evidence_digest){
            throw new Error('rsi_canary_ledger_evidence_binding_mismatch');
          }
        }
        return row;
      });
    }catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    this.#initialized=true;
    return this.snapshot();
  }

  async #persist(){
    const state=ledgerState(this.#sourceSha,this.#rows);
    const tmp=`${this.#path}.tmp`;
    const handle=await fs.open(tmp,'w',0o600);
    try{
      await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');
      await handle.sync();
    }finally{
      await handle.close();
    }
    await fs.rename(tmp,this.#path);
  }

  async recordEvidence(shadow_evidence){
    if(!this.#initialized)throw new Error('rsi_canary_ledger_not_initialized');
    if(!shadow_evidence||shadow_evidence.schema!==RSI_BOUNDED_CANARY_EVIDENCE_SCHEMA){
      throw new Error('rsi_canary_shadow_evidence_invalid');
    }
    assertZero(shadow_evidence,'shadow_evidence');
    if(shadow_evidence.source_sha!==this.#sourceSha)throw new Error('rsi_canary_ledger_source_mismatch');
    const existing=this.#rows.find((row)=>row.shadow_evidence.evidence_id===shadow_evidence.evidence_id);
    if(existing){
      if(existing.shadow_evidence.evidence_digest!==shadow_evidence.evidence_digest){
        throw new Error('rsi_canary_evidence_identity_conflict');
      }
      return zero({state:'IDEMPOTENT',evidence_digest:shadow_evidence.evidence_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_canary_ledger_capacity_exceeded');
    this.#rows.push(Object.freeze({
      source_sha:this.#sourceSha,
      admission:null,
      shadow_evidence:structuredClone(shadow_evidence),
    }));
    await this.#persist();
    return zero({
      state:shadow_evidence.rollback_required_latched===true?'ROLLBACK_REQUIRED_LATCHED':'SHADOW_EVIDENCE_RECORDED',
      evidence_digest:shadow_evidence.evidence_digest,
    });
  }

  async add({admission,shadow_evidence}={}){
    if(!this.#initialized)throw new Error('rsi_canary_ledger_not_initialized');
    if(!admission||admission.schema!==RSI_BOUNDED_CANARY_ADMISSION_SCHEMA)throw new Error('rsi_canary_admission_invalid');
    if(!shadow_evidence||shadow_evidence.schema!==RSI_BOUNDED_CANARY_EVIDENCE_SCHEMA)throw new Error('rsi_canary_shadow_evidence_invalid');
    assertZero(admission,'admission');
    assertZero(shadow_evidence,'shadow_evidence');
    if(admission.source_sha!==this.#sourceSha||shadow_evidence.source_sha!==this.#sourceSha){
      throw new Error('rsi_canary_ledger_source_mismatch');
    }
    if(admission.shadow_evidence_digest!==shadow_evidence.evidence_digest){
      throw new Error('rsi_canary_ledger_evidence_binding_mismatch');
    }
    if(this.#rows.some((row)=>row.shadow_evidence.rollback_required_latched===true)){
      throw new Error('rsi_canary_rollback_latch_active');
    }
    const existing=this.#rows.find((row)=>row.admission&&(row.admission.admission_id===admission.admission_id||row.admission.admission_digest===admission.admission_digest));
    if(existing){
      if(existing.admission.admission_digest!==admission.admission_digest)throw new Error('rsi_canary_admission_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:admission.admission_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_canary_ledger_capacity_exceeded');
    this.#rows.push(Object.freeze({
      source_sha:this.#sourceSha,
      admission:structuredClone(admission),
      shadow_evidence:structuredClone(shadow_evidence),
    }));
    await this.#persist();
    return zero({state:'ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_HANDOFF',admission_digest:admission.admission_digest});
  }

  snapshot(){
    const state=ledgerState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:state.schema,
      version:state.version,
      source_sha:state.source_sha,
      initialized:this.#initialized,
      row_count:state.row_count,
      rollback_required_latched:state.rollback_required_latched,
      active_canary_admission_digest:null,
      ledger_can_activate_canary:false,
      ledger_can_clear_rollback_latch:false,
      authority_effect:false,
    });
  }
}

export function rsiBoundedCanaryAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.bounded-canary-admission-root.v1',
    version:1,
    phase18_shadow_selection_required:true,
    minimum_shadow_observations:MIN_SHADOW_OBSERVATIONS,
    fixed_read_only_decision_budget:MAX_READ_ONLY_DECISIONS,
    canary_surface:'READ_ONLY_DECISION_SUPPORT',
    incumbent_remains_default:true,
    incumbent_is_mandatory_fallback:true,
    external_cohort_owner_required:true,
    identity_stable_manifest_required:true,
    outcome_safety_security_awareness_utility_evidence_required:true,
    ambiguity_latches_rollback:true,
    incident_latches_rollback:true,
    hard_invariant_failure_latches_rollback:true,
    identity_drift_latches_rollback:true,
    rollback_latch_cannot_be_cleared_by_candidate:true,
    canary_activation_authorized:false,
    live_profile_activation_authorized:false,
    candidate_can_choose_cohort:false,
    candidate_can_choose_budget:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,canary_admission_root_digest:digest(root)});
}
