import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiRuntimeMetaSkillRecord } from './rsi-runtime-meta-skill-archive.mjs';
import {
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';\nimport { assertRsiZeroAuthority } from './rsi-zero-authority-contract.mjs';

export const RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA='metaengine.rsi.meta-profile-shadow-selection.v1';
export const RSI_META_PROFILE_SHADOW_PROJECTION_SCHEMA='metaengine.rsi.meta-profile-shadow-projection.v1';
export const RSI_META_PROFILE_SHADOW_REGISTRY_SCHEMA='metaengine.rsi.meta-profile-shadow-registry.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const META_ROLES=new Set(['ANALYZER','RETRIEVER','ALLOCATOR','PROPOSER','EVOLVER']);
const MAX_SELECTIONS=1024;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_shadow_profile_${l}_sha_invalid`);return x}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_shadow_profile_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_shadow_profile_${l}_invalid`);return x}
function assertZero(v,l){return assertRsiZeroAuthority(v,{error_prefix:`rsi_shadow_profile_${l}`})}

function verifyQualification(q){
  if(!q||q.schema!=='metaengine.rsi.meta-profile-qualification.v1'||q.version!==1)throw new Error('rsi_shadow_profile_qualification_invalid');
  assertZero(q,'qualification');
  const clone=structuredClone(q);delete clone.qualification_digest;
  if(digest(clone)!==exactDigest(q.qualification_digest,'qualification'))throw new Error('rsi_shadow_profile_qualification_digest_mismatch');
  if(q.state!=='QUALIFIED_FOR_SHADOW_PROFILE_SELECTION'||q.qualified_for_shadow_profile_selection!==true
    ||q.live_profile_activation_authorized!==false||q.canary_activation_authorized!==false
    ||q.external_activation_gate_still_required!==true)throw new Error('rsi_shadow_profile_qualification_not_eligible');
  return Object.freeze(structuredClone(q));
}

export function createRsiMetaProfileShadowSelection({
  selection_id,qualification,meta_record,current_library,
  external_selector=false,authored_by_candidate=true,
}={}){
  const q=verifyQualification(qualification);
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  const library=verifyRsiVerifiedSkillLibrary(current_library);
  if(external_selector!==true||authored_by_candidate!==false)throw new Error('rsi_shadow_profile_external_selector_required');
  if(q.source_sha!==record.source_sha||q.meta_record_digest!==record.record_digest)throw new Error('rsi_shadow_profile_record_binding_mismatch');
  if(q.parent_profile_digest!==record.parent_profile_digest||q.successor_profile_digest!==record.successor_profile_digest)throw new Error('rsi_shadow_profile_profile_binding_mismatch');
  if(record.library_digest!==library.library_digest)throw new Error('rsi_shadow_profile_library_drift_requires_requalification');
  const core={
    schema:RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA,version:1,
    source_sha:exactSha(record.source_sha,'source'),
    selection_id:id(selection_id,'selection_id'),
    qualification_digest:q.qualification_digest,
    meta_record_digest:record.record_digest,
    library_digest:library.library_digest,
    incumbent_profile_digest:record.parent_profile_digest,
    challenger_profile_digest:record.successor_profile_digest,
    mode:'SHADOW_ONLY',
    external_selector:true,authored_by_candidate:false,
    candidate_can_select_profile:false,
    selection_can_change_execution:false,
    selection_can_replace_incumbent:false,
    selection_can_grant_skill_activity:false,
    continuous_shadow_review_required:true,
    canary_gate_still_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,selection_digest:digest(core)});
}

export function verifyRsiMetaProfileShadowSelection(row,{qualification,meta_record,current_library}={}){
  if(!row||row.schema!==RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA||row.version!==1)throw new Error('rsi_shadow_profile_selection_invalid');
  assertZero(row,'selection');
  if(row.mode!=='SHADOW_ONLY'||row.external_selector!==true||row.authored_by_candidate!==false
    ||row.candidate_can_select_profile!==false||row.selection_can_change_execution!==false
    ||row.selection_can_replace_incumbent!==false||row.selection_can_grant_skill_activity!==false
    ||row.browser_authority!==false||row.task_authority!==false
    ||row.continuous_shadow_review_required!==true||row.canary_gate_still_required!==true)throw new Error('rsi_shadow_profile_selection_policy_invalid');
  const c=createRsiMetaProfileShadowSelection({
    selection_id:row.selection_id,qualification,meta_record,current_library,
    external_selector:true,authored_by_candidate:false,
  });
  if(c.selection_digest!==exactDigest(row.selection_digest,'selection'))throw new Error('rsi_shadow_profile_selection_digest_mismatch');
  return c;
}

export function createRsiMetaProfileShadowProjection({
  selection,qualification,meta_record,current_library,governance,
  context_digest,required_role=null,baseline_plan_digest,baseline_selected_skill_digests=[],
}={}){
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  const library=verifyRsiVerifiedSkillLibrary(current_library);
  const checkedSelection=verifyRsiMetaProfileShadowSelection(selection,{qualification,meta_record:record,current_library:library});
  const gov=verifyRsiSkillLibraryGovernance(governance,library);
  const context=exactDigest(context_digest,'context');
  const baselineDigest=exactDigest(baseline_plan_digest,'baseline_plan');
  if(!Array.isArray(baseline_selected_skill_digests))throw new Error('rsi_shadow_profile_baseline_skills_invalid');
  const baseline=[...new Set(baseline_selected_skill_digests.map(x=>exactDigest(x,'baseline_skill')))].sort();
  if(baseline.length!==baseline_selected_skill_digests.length)throw new Error('rsi_shadow_profile_baseline_skill_duplicate');

  let status='NO_APPLICABLE_META_ROLE';
  let challengerSkillDigest=null;
  let challengerSkillState=null;
  let matchesBaseline=null;
  const role=required_role==null?null:String(required_role).trim().toUpperCase();
  if(role!=null&&META_ROLES.has(role)){
    const binding=record.successor_profile.bindings?.[role];
    if(!binding)throw new Error('rsi_shadow_profile_role_binding_missing');
    challengerSkillDigest=exactDigest(binding.skill_digest,'challenger_skill');
    const entry=library.entries.find(x=>x.skill_digest===challengerSkillDigest);
    if(!entry)throw new Error('rsi_shadow_profile_challenger_skill_not_in_library');
    const govRow=gov.entries.find(x=>x.skill_digest===challengerSkillDigest);
    if(!govRow)throw new Error('rsi_shadow_profile_challenger_governance_missing');
    challengerSkillState=govRow.state;
    if(govRow.active_for_composition!==true){
      status='BLOCKED_BY_GOVERNANCE';
      matchesBaseline=false;
    }else{
      matchesBaseline=baseline.includes(challengerSkillDigest);
      status=matchesBaseline?'MATCHES_BASELINE':'SHADOW_DIVERGENCE';
    }
  }

  const core={
    schema:RSI_META_PROFILE_SHADOW_PROJECTION_SCHEMA,version:1,
    source_sha:checkedSelection.source_sha,
    selection_digest:checkedSelection.selection_digest,
    qualification_digest:checkedSelection.qualification_digest,
    meta_record_digest:checkedSelection.meta_record_digest,
    context_digest:context,required_role:role,
    baseline_plan_digest:baselineDigest,baseline_selected_skill_digests:Object.freeze(baseline),
    challenger_skill_digest:challengerSkillDigest,challenger_skill_governance_state:challengerSkillState,
    status,matches_baseline:matchesBaseline,
    shadow_only:true,baseline_execution_path_unchanged:true,
    projection_can_add_skill_to_execution:false,
    projection_can_override_governance:false,
    projection_is_execution_authority:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,projection_digest:digest(core)});
}

function stateCore(sourceSha,selections){
  const current=selections.length?selections[selections.length-1]:null;
  const core={
    schema:RSI_META_PROFILE_SHADOW_REGISTRY_SCHEMA,version:1,source_sha:sourceSha,
    selections,selection_count:selections.length,current_selection_digest:current?.selection_digest||null,
    current_challenger_profile_digest:current?.challenger_profile_digest||null,
    append_only:true,shadow_only:true,
    registry_can_activate_profile:false,registry_can_change_execution:false,
    candidate_can_delete_selections:false,candidate_can_rewrite_selections:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiMetaProfileShadowRegistry{
  #path;#sourceSha;#selections=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_shadow_profile_registry_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'registry');
      if(p.schema!==RSI_META_PROFILE_SHADOW_REGISTRY_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.shadow_only!==true||p.registry_can_activate_profile!==false
        ||p.registry_can_change_execution!==false||p.candidate_can_delete_selections!==false||p.candidate_can_rewrite_selections!==false
        ||p.browser_authority!==false||p.task_authority!==false)throw new Error('rsi_shadow_profile_registry_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'registry'))throw new Error('rsi_shadow_profile_registry_digest_mismatch');
      if(!Array.isArray(p.selections)||p.selections.length>MAX_SELECTIONS)throw new Error('rsi_shadow_profile_registry_rows_invalid');
      for(const row of p.selections){
        if(row.source_sha!==this.#sourceSha||row.schema!==RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA)throw new Error('rsi_shadow_profile_registry_row_invalid');
        assertZero(row,'selection');
        if(row.browser_authority!==false||row.task_authority!==false)throw new Error('rsi_shadow_profile_registry_row_authority_invalid');
        const rc=structuredClone(row);delete rc.selection_digest;
        if(digest(rc)!==exactDigest(row.selection_digest,'selection'))throw new Error('rsi_shadow_profile_registry_row_digest_mismatch');
      }
      this.#selections=p.selections;
    }catch(e){if(e?.code!=='ENOENT')throw e}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){const s=stateCore(this.#sourceSha,this.#selections);const t=`${this.#path}.tmp`;const h=await fs.open(t,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(t,this.#path)}
  async select(selection){
    if(!this.#initialized)throw new Error('rsi_shadow_profile_registry_not_initialized');
    if(!selection||selection.schema!==RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA)throw new Error('rsi_shadow_profile_selection_invalid');
    assertZero(selection,'selection');
    if(selection.browser_authority!==false||selection.task_authority!==false)throw new Error('rsi_shadow_profile_selection_authority_invalid');
    if(selection.source_sha!==this.#sourceSha)throw new Error('rsi_shadow_profile_selection_source_mismatch');
    const existing=this.#selections.find(x=>x.selection_id===selection.selection_id||x.selection_digest===selection.selection_digest);
    if(existing){
      if(existing.selection_digest!==selection.selection_digest)throw new Error('rsi_shadow_profile_selection_identity_conflict');
      return Object.freeze({state:'IDEMPOTENT',selection_digest:selection.selection_digest,authority_effect:false});
    }
    if(this.#selections.length>=MAX_SELECTIONS)throw new Error('rsi_shadow_profile_registry_capacity_exceeded');
    this.#selections.push(structuredClone(selection));await this.#persist();
    return Object.freeze({state:'SHADOW_SELECTED',selection_digest:selection.selection_digest,authority_effect:false});
  }
  current(){
    if(!this.#initialized)throw new Error('rsi_shadow_profile_registry_not_initialized');
    const row=this.#selections[this.#selections.length-1];
    return row?Object.freeze(structuredClone(row)):null;
  }
  snapshot(){const s=stateCore(this.#sourceSha,this.#selections);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,selection_count:s.selection_count,current_selection_digest:s.current_selection_digest,current_challenger_profile_digest:s.current_challenger_profile_digest,shadow_only:true,registry_can_activate_profile:false,registry_can_change_execution:false,browser_authority:false,task_authority:false,authority_effect:false})}
}

export function rsiMetaProfileShadowSelectionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.meta-profile-shadow-selection-root.v1',version:1,
    exact_qualification_required:true,exact_meta_record_required:true,exact_current_library_required:true,
    current_library_drift_requires_requalification:true,
    external_selector_required:true,candidate_can_select_profile:false,
    shadow_only:true,baseline_execution_path_unchanged:true,
    projection_can_add_skill_to_execution:false,projection_can_override_governance:false,
    registry_can_activate_profile:false,canary_gate_still_required:true,
    continuous_shadow_review_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,shadow_selection_root_digest:digest(root)});
}
