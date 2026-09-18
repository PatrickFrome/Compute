import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';
import { verifyRsiStepCreditReceipt } from './rsi-runtime-credit-assignment.mjs';

export const RSI_SKILL_CONTEXT_EVIDENCE_SCHEMA='metaengine.rsi.skill-context-evidence.v1';
export const RSI_SKILL_ROUTE_CONTEXT_SCHEMA='metaengine.rsi.skill-route-context.v1';
export const RSI_SKILL_ROUTING_PLAN_SCHEMA='metaengine.rsi.skill-routing-plan.v1';
export const RSI_RUNTIME_SKILL_ROUTER_STATE_SCHEMA='metaengine.rsi.runtime-skill-router-state.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_EVIDENCE=16384;
const MAX_REQUIRED_CAPABILITIES=16;
const MAX_SELECTED=8;
const NEGATIVE_TRANSFER_EXACT_MIN=2;
const CREDIT_SIGNS=new Set(['POSITIVE','NEGATIVE','NEUTRAL']);
const CREDIT_METHODS=new Set(['EXTERNAL_STEP_EVALUATOR','COUNTERFACTUAL_ABLATION','TD_REFERENCE_MODEL','MARGINAL_SHAPLEY']);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_skill_router_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_skill_router_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_skill_router_${l}_invalid`);return o}
function token(v,l,{nullable=false}={}){if(nullable&&(v==null||v===''))return null;const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_skill_router_${l}_invalid`);return o}
function positiveInt(v,l,max=1000000){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_skill_router_${l}_invalid`);return o}
function nonNegativeInt(v,l,max=1000000){const o=Number(v);if(!Number.isSafeInteger(o)||o<0||o>max)throw new Error(`rsi_skill_router_${l}_invalid`);return o}
function capabilities(v){
  if(v==null)return Object.freeze([]);
  if(!Array.isArray(v)||v.length>MAX_REQUIRED_CAPABILITIES)throw new Error('rsi_skill_router_required_capabilities_invalid');
  const seen=new Set();const out=[];
  for(const raw of v){const t=token(raw,'required_capability');if(seen.has(t))throw new Error('rsi_skill_router_required_capability_duplicate');seen.add(t);out.push(t)}
  return Object.freeze(out.sort());
}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_skill_router_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_skill_router_${l}_automatic_retry_invalid`);
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertEpisode(e){
  if(!e||typeof e!=='object'||Array.isArray(e)||e.schema!=='metaengine.rsi.browser-outcome-episode.v1')throw new Error('rsi_skill_router_episode_invalid');
  if(e.authority_effect!==false||e.execution_authority!==false||e.automatic_retry_allowed!==false||e.quarantined===true)throw new Error('rsi_skill_router_episode_not_eligible');
  if(e.eligible_for_skill_evidence!==true||!Array.isArray(e.skill_digests)||e.skill_digests.length<1)throw new Error('rsi_skill_router_episode_has_no_skill_evidence');
  exactDigest(e.episode_digest,'episode');return e;
}
function deterministicTie(contextDigest,skillDigest){return crypto.createHash('sha256').update(`${contextDigest}:${skillDigest}`,'utf8').digest('hex')}

export function createRsiSkillContextEvidence({
  source_sha,episode,credit_receipt,skill_digest,
  external_evaluator=false,authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const e=assertEpisode(episode);
  const credit=verifyRsiStepCreditReceipt(credit_receipt,e);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_skill_router_context_evidence_external_origin_required');
  const skillDigest=exactDigest(skill_digest,'skill');
  if(!e.skill_digests.includes(skillDigest))throw new Error('rsi_skill_router_skill_not_bound_to_episode');
  const core={
    schema:RSI_SKILL_CONTEXT_EVIDENCE_SCHEMA,version:1,source_sha:sourceSha,
    skill_digest:skillDigest,
    episode_digest:e.episode_digest,
    credit_receipt_digest:credit.receipt_digest,
    task_signature_digest:e.task_signature_digest,
    environment_fingerprint:boundedId(e.environment_fingerprint,'environment_fingerprint'),
    model_family:token(e.model_family,'model_family'),
    action:token(e.action,'action'),
    trajectory_id:boundedId(e.trajectory_id,'trajectory_id'),
    step_index:positiveInt(e.step_index,'step_index',10000),
    credit_sign:credit.credit_sign,
    credit_score:credit.credit_score,
    credit_method:credit.method,
    evaluator_digest:credit.evaluator_digest,
    external_evaluator:true,authored_by_candidate:false,
    contextual_utility_not_global_truth:true,
    raw_trajectory_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    candidate_can_edit_evidence:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,evidence_digest:digest(core)});
}

export function verifyRsiSkillContextEvidence(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SKILL_CONTEXT_EVIDENCE_SCHEMA||row.version!==1)throw new Error('rsi_skill_router_context_evidence_invalid');
  assertZero(row,'evidence');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false||row.candidate_can_edit_evidence!==false||row.contextual_utility_not_global_truth!==true
    ||row.raw_trajectory_stored!==false||row.raw_page_text_stored!==false||row.raw_user_input_stored!==false){
    throw new Error('rsi_skill_router_context_evidence_policy_invalid');
  }
  exactSha(row.source_sha,'evidence_source');
  exactDigest(row.skill_digest,'skill');
  exactDigest(row.episode_digest,'episode');
  exactDigest(row.credit_receipt_digest,'credit_receipt');
  exactDigest(row.task_signature_digest,'task_signature');
  boundedId(row.environment_fingerprint,'environment_fingerprint');
  token(row.model_family,'model_family');
  token(row.action,'action');
  boundedId(row.trajectory_id,'trajectory_id');
  positiveInt(row.step_index,'step_index',10000);
  const sign=token(row.credit_sign,'credit_sign');
  if(!CREDIT_SIGNS.has(sign))throw new Error('rsi_skill_router_credit_sign_invalid');
  const score=Number(row.credit_score);
  if(!Number.isFinite(score)||score < -1||score > 1)throw new Error('rsi_skill_router_credit_score_invalid');
  if((sign==='POSITIVE'&&score<=0)||(sign==='NEGATIVE'&&score>=0)||(sign==='NEUTRAL'&&score!==0))throw new Error('rsi_skill_router_credit_sign_score_mismatch');
  const method=token(row.credit_method,'credit_method');
  if(!CREDIT_METHODS.has(method))throw new Error('rsi_skill_router_credit_method_invalid');
  exactDigest(row.evaluator_digest,'evaluator');
  const clone=structuredClone(row);delete clone.evidence_digest;
  if(digest(clone)!==exactDigest(row.evidence_digest,'evidence'))throw new Error('rsi_skill_router_context_evidence_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

export function createRsiSkillRouteContext({
  source_sha,context_id,task_signature_digest,environment_fingerprint,model_family,
  challenge_family,required_role=null,required_capabilities=[],
  input_schema_digest=null,output_schema_digest=null,
  external_planner=false,authored_by_candidate=true,
}={}){
  if(external_planner!==true||authored_by_candidate!==false)throw new Error('rsi_skill_router_context_external_origin_required');
  const core={
    schema:RSI_SKILL_ROUTE_CONTEXT_SCHEMA,version:1,
    source_sha:exactSha(source_sha,'source'),
    context_id:boundedId(context_id,'context_id'),
    task_signature_digest:exactDigest(task_signature_digest,'task_signature'),
    environment_fingerprint:boundedId(environment_fingerprint,'environment_fingerprint'),
    model_family:token(model_family,'model_family'),
    challenge_family:token(challenge_family,'challenge_family'),
    required_role:token(required_role,'required_role',{nullable:true}),
    required_capabilities:capabilities(required_capabilities),
    input_schema_digest:input_schema_digest==null?null:exactDigest(input_schema_digest,'input_schema'),
    output_schema_digest:output_schema_digest==null?null:exactDigest(output_schema_digest,'output_schema'),
    external_planner:true,authored_by_candidate:false,
    candidate_can_choose_router_thresholds:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,context_digest:digest(core)});
}

function verifyContext(context){
  if(!context||typeof context!=='object'||Array.isArray(context)||context.schema!==RSI_SKILL_ROUTE_CONTEXT_SCHEMA||context.version!==1)throw new Error('rsi_skill_router_context_invalid');
  assertZero(context,'context');
  if(context.external_planner!==true||context.authored_by_candidate!==false||context.candidate_can_choose_router_thresholds!==false)throw new Error('rsi_skill_router_context_policy_invalid');
  const canonical=createRsiSkillRouteContext({
    source_sha:context.source_sha,context_id:context.context_id,task_signature_digest:context.task_signature_digest,
    environment_fingerprint:context.environment_fingerprint,model_family:context.model_family,
    challenge_family:context.challenge_family,required_role:context.required_role,
    required_capabilities:context.required_capabilities,input_schema_digest:context.input_schema_digest,
    output_schema_digest:context.output_schema_digest,external_planner:true,authored_by_candidate:false,
  });
  if(canonical.context_digest!==exactDigest(context.context_digest,'context'))throw new Error('rsi_skill_router_context_digest_mismatch');
  return canonical;
}

function compatible(entry,context){
  if(context.required_role&&entry.role!==context.required_role)return false;
  if(context.input_schema_digest&&entry.input_schema_digest!==context.input_schema_digest)return false;
  if(context.output_schema_digest&&entry.output_schema_digest!==context.output_schema_digest)return false;
  for(const cap of context.required_capabilities)if(!entry.capabilities.includes(cap))return false;
  return true;
}

function summarizeEvidence(skillDigest,context,evidence){
  const rows=evidence.filter(row=>row.skill_digest===skillDigest);
  const exact=rows.filter(row=>
    row.task_signature_digest===context.task_signature_digest
    && row.environment_fingerprint===context.environment_fingerprint
    && row.model_family===context.model_family);
  const sameTask=rows.filter(row=>row.task_signature_digest===context.task_signature_digest);
  const sameEnvModel=rows.filter(row=>row.environment_fingerprint===context.environment_fingerprint&&row.model_family===context.model_family);
  const count=(list,sign)=>list.filter(row=>row.credit_sign===sign).length;
  const scoreSum=list=>list.reduce((sum,row)=>sum+Number(row.credit_score||0),0);
  const exactPositive=count(exact,'POSITIVE');
  const exactNegative=count(exact,'NEGATIVE');
  const exactNeutral=count(exact,'NEUTRAL');
  const negativeTransferVeto=exactNegative>=NEGATIVE_TRANSFER_EXACT_MIN&&exactPositive===0;
  const sameTaskBalance=count(sameTask,'POSITIVE')-2*count(sameTask,'NEGATIVE');
  const sameEnvBalance=count(sameEnvModel,'POSITIVE')-2*count(sameEnvModel,'NEGATIVE');
  const exactBalance=exactPositive-3*exactNegative+0.1*exactNeutral;
  const weightedScore=
    exactBalance*100
    + sameTaskBalance*12
    + sameEnvBalance*6
    + scoreSum(exact)*10
    + Math.min(rows.length,20)*0.05;
  return Object.freeze({
    evidence_count:rows.length,
    exact_context_count:exact.length,
    exact_positive_count:exactPositive,
    exact_negative_count:exactNegative,
    exact_neutral_count:exactNeutral,
    same_task_count:sameTask.length,
    same_environment_model_count:sameEnvModel.length,
    exact_negative_transfer_veto:negativeTransferVeto,
    weighted_context_score:Math.round(weightedScore*1e6)/1e6,
  });
}

export function createRsiSkillRoutingPlan({
  library,governance,context,evidence=[],
  coalition_masked_skill_digests=[],
  max_selected=4,exploration_slots=1,
  external_planner=false,authored_by_candidate=true,
}={}){
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(governance,checkedLibrary);
  const checkedContext=verifyContext(context);
  if(external_planner!==true||authored_by_candidate!==false)throw new Error('rsi_skill_router_plan_external_origin_required');
  if(!Array.isArray(evidence)||evidence.length>MAX_EVIDENCE)throw new Error('rsi_skill_router_evidence_set_invalid');
  const seenEvidence=new Set();
  const checkedEvidence=evidence.map(row=>{
    const checked=verifyRsiSkillContextEvidence(row);
    if(checked.source_sha!==checkedContext.source_sha)throw new Error('rsi_skill_router_context_evidence_source_mismatch');
    if(seenEvidence.has(checked.evidence_digest))throw new Error('rsi_skill_router_context_evidence_duplicate');
    seenEvidence.add(checked.evidence_digest);return checked;
  });
  if(!Array.isArray(coalition_masked_skill_digests)||coalition_masked_skill_digests.length>checkedLibrary.entries.length)throw new Error('rsi_skill_router_coalition_mask_invalid');
  const coalitionMask=[...new Set(coalition_masked_skill_digests.map(value=>exactDigest(value,'coalition_mask_skill')))].sort();
  if(coalitionMask.length!==coalition_masked_skill_digests.length)throw new Error('rsi_skill_router_coalition_mask_duplicate');
  for(const skillDigest of coalitionMask){
    if(!checkedLibrary.entries.some(entry=>entry.skill_digest===skillDigest))throw new Error('rsi_skill_router_coalition_mask_skill_not_in_library');
  }
  const coalitionMaskSet=new Set(coalitionMask);
  const maxSelected=positiveInt(max_selected,'max_selected',MAX_SELECTED);
  const explore=nonNegativeInt(exploration_slots,'exploration_slots',maxSelected);

  const govByDigest=new Map(checkedGovernance.entries.map(row=>[row.skill_digest,row]));
  const activeCompatible=checkedLibrary.entries
    .filter(entry=>govByDigest.get(entry.skill_digest)?.active_for_composition===true)
    .filter(entry=>compatible(entry,checkedContext));
  const coalitionMasked=activeCompatible.filter(entry=>coalitionMaskSet.has(entry.skill_digest));
  const eligible=activeCompatible
    .filter(entry=>!coalitionMaskSet.has(entry.skill_digest))
    .map(entry=>{
      const utility=summarizeEvidence(entry.skill_digest,checkedContext,checkedEvidence);
      return {entry,governance:govByDigest.get(entry.skill_digest),utility,tie:deterministicTie(checkedContext.context_digest,entry.skill_digest)};
    });

  const vetoed=eligible.filter(row=>row.utility.exact_negative_transfer_veto);
  const candidates=eligible.filter(row=>!row.utility.exact_negative_transfer_veto);
  const proven=candidates.filter(row=>row.utility.exact_context_count>0)
    .sort((a,b)=>b.utility.weighted_context_score-a.utility.weighted_context_score
      || b.governance.governance_score-a.governance.governance_score
      || a.tie.localeCompare(b.tie));
  const unexplored=candidates.filter(row=>row.utility.exact_context_count===0)
    .sort((a,b)=>b.governance.governance_score-a.governance.governance_score||a.tie.localeCompare(b.tie));

  const selected=[];
  for(const row of proven){
    if(selected.length>=maxSelected-explore)break;
    selected.push({...row,reason:'CONTEXT_EVIDENCE'});
  }
  let exploreUsed=0;
  for(const row of unexplored){
    if(selected.length>=maxSelected||exploreUsed>=explore)break;
    selected.push({...row,reason:'BOUNDED_EXPLORATION'});
    exploreUsed+=1;
  }
  if(selected.length<maxSelected){
    for(const row of proven.slice(selected.filter(x=>x.reason==='CONTEXT_EVIDENCE').length)){
      if(selected.length>=maxSelected)break;
      if(!selected.some(x=>x.entry.skill_digest===row.entry.skill_digest))selected.push({...row,reason:'CONTEXT_EVIDENCE'});
    }
  }

  const core={
    schema:RSI_SKILL_ROUTING_PLAN_SCHEMA,version:1,
    library_digest:checkedLibrary.library_digest,
    governance_digest:checkedGovernance.governance_digest,
    context_digest:checkedContext.context_digest,
    selected:selected.map((row,index)=>Object.freeze({
      rank:index+1,skill_id:row.entry.skill_id,skill_version:row.entry.skill_version,skill_digest:row.entry.skill_digest,
      role:row.entry.role,reason:row.reason,context_utility:row.utility,
      governance_state:row.governance.state,governance_score:row.governance.governance_score,
    })),
    vetoed_negative_transfer:vetoed.map(row=>Object.freeze({
      skill_id:row.entry.skill_id,skill_digest:row.entry.skill_digest,context_utility:row.utility,
      reason:'EXACT_CONTEXT_NEGATIVE_TRANSFER',
    })).sort((a,b)=>a.skill_digest.localeCompare(b.skill_digest)),
    masked_coalition_pollution:coalitionMasked.map(entry=>Object.freeze({
      skill_id:entry.skill_id,skill_digest:entry.skill_digest,reason:'NEGATIVE_COALITION_MARGINAL',
    })).sort((a,b)=>a.skill_digest.localeCompare(b.skill_digest)),
    coalition_masked_count:coalitionMasked.length,
    coalition_masked_skill_digests:Object.freeze(coalitionMask),
    selected_count:selected.length,
    vetoed_count:vetoed.length,
    max_selected:maxSelected,
    exploration_slots:explore,
    exploration_used:exploreUsed,
    only_governance_active_skills:true,
    exact_interface_compatibility_required:true,
    exact_context_negative_transfer_veto:true,
    coalition_pollution_mask_supported:true,
    coalition_mask_cannot_grant_activity:true,
    negative_transfer_exact_min:NEGATIVE_TRANSFER_EXACT_MIN,
    contextual_utility_not_global_truth:true,
    coalition_pollution_mask_is_advisory_input:true,
    coalition_mask_cannot_grant_activity:true,
    candidate_can_select_skills:false,
    candidate_can_override_negative_transfer_veto:false,
    candidate_can_choose_router_thresholds:false,
    routing_is_execution_authority:false,
    external_planner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,plan_digest:digest(core)});
}

function stateCore(sourceSha,evidence,routeCount,lastPlanDigest){
  const core={
    schema:RSI_RUNTIME_SKILL_ROUTER_STATE_SCHEMA,version:1,source_sha:sourceSha,
    evidence,route_count:routeCount,last_plan_digest:lastPlanDigest,
    max_evidence:MAX_EVIDENCE,evidence_append_only:true,
    contextual_utility_not_global_truth:true,exact_negative_transfer_veto:true,
    candidate_can_write_evidence:false,candidate_can_select_skills:false,
    raw_trajectory_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillRouter{
  #path;#sourceSha;#evidence=[];#routeCount=0;#lastPlanDigest=null;#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_skill_router_state_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      if(parsed.schema!==RSI_RUNTIME_SKILL_ROUTER_STATE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha)throw new Error('rsi_skill_router_state_invalid');
      assertZero(parsed,'state');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_skill_router_state_digest_mismatch');
      if(!Array.isArray(parsed.evidence)||parsed.evidence.length>MAX_EVIDENCE)throw new Error('rsi_skill_router_state_evidence_invalid');
      const seen=new Set();
      for(const row of parsed.evidence){
        const checked=verifyRsiSkillContextEvidence(row);
        if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_skill_router_state_evidence_invalid');
        if(seen.has(checked.evidence_digest))throw new Error('rsi_skill_router_state_evidence_duplicate');
        seen.add(checked.evidence_digest);
      }
      this.#evidence=parsed.evidence;
      this.#routeCount=nonNegativeInt(parsed.route_count,'route_count');
      this.#lastPlanDigest=parsed.last_plan_digest==null?null:exactDigest(parsed.last_plan_digest,'last_plan');
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=stateCore(this.#sourceSha,this.#evidence,this.#routeCount,this.#lastPlanDigest);
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_skill_router_not_initialized')}
  async recordCreditedOutcome({episode,credit_receipt,external_evaluator=false,authored_by_candidate=true}={}){
    this.#assertInit();
    if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_skill_router_runtime_external_evidence_required');
    const e=assertEpisode(episode);const credit=verifyRsiStepCreditReceipt(credit_receipt,e);
    const additions=[];
    for(const skillDigest of e.skill_digests){
      const row=createRsiSkillContextEvidence({
        source_sha:this.#sourceSha,episode:e,credit_receipt:credit,skill_digest:skillDigest,
        external_evaluator:true,authored_by_candidate:false,
      });
      if(this.#evidence.some(existing=>existing.evidence_digest===row.evidence_digest))continue;
      additions.push(row);
    }
    if(this.#evidence.length+additions.length>MAX_EVIDENCE)throw new Error('rsi_skill_router_evidence_capacity_exceeded');
    this.#evidence.push(...additions);
    if(additions.length>0)await this.#persist();
    return zero({state:additions.length>0?'APPENDED':'IDEMPOTENT',appended_count:additions.length,evidence_digests:additions.map(x=>x.evidence_digest)});
  }
  async route({library,governance,context,coalition_masked_skill_digests=[],max_selected=4,exploration_slots=1,external_planner=false,authored_by_candidate=true}={}){
    this.#assertInit();
    const plan=createRsiSkillRoutingPlan({
      library,governance,context,evidence:this.#evidence,coalition_masked_skill_digests,max_selected,exploration_slots,external_planner,authored_by_candidate,
    });
    this.#routeCount+=1;this.#lastPlanDigest=plan.plan_digest;await this.#persist();return plan;
  }
  snapshot(){
    return Object.freeze({
      schema:RSI_RUNTIME_SKILL_ROUTER_STATE_SCHEMA,version:1,source_sha:this.#sourceSha,initialized:this.#initialized,
      evidence_count:this.#evidence.length,route_count:this.#routeCount,last_plan_digest:this.#lastPlanDigest,
      max_evidence:MAX_EVIDENCE,evidence_append_only:true,contextual_utility_not_global_truth:true,
      exact_negative_transfer_veto:true,candidate_can_write_evidence:false,candidate_can_select_skills:false,
      raw_trajectory_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiRuntimeSkillRouterTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.runtime-skill-router-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-runtime-skill-router.mjs',
    verified_library_and_governance_required:true,
    only_governance_active_skills:true,
    exact_interface_compatibility_required:true,
    contextual_utility_not_global_truth:true,
    exact_context_negative_transfer_veto:true,
    negative_transfer_exact_min:NEGATIVE_TRANSFER_EXACT_MIN,
    bounded_exploration_slots:true,max_selected:MAX_SELECTED,
    candidate_can_write_evidence:false,candidate_can_select_skills:false,
    candidate_can_override_negative_transfer_veto:false,candidate_can_choose_router_thresholds:false,
    raw_trajectory_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    routing_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,router_root_digest:digest(root)});
}
