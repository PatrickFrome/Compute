import { MetaOrchestratorPrivilegedAdapter } from './meta-orchestrator-privileged-adapter.mjs';
import {
  createBoundedSupervisorFetch,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
} from './native-supervisor-client.mjs';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROADMAP_RE=/^[a-z0-9][a-z0-9._:-]{2,159}$/;

function object(value,name){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`meta_native_${name}_invalid`);return value}
function workspaceId(value){const out=String(value||'').toLowerCase();if(!UUID_RE.test(out))throw new Error('meta_native_workspace_id_invalid');return out}
function roadmapId(value){const out=String(value||'').trim().toLowerCase();if(!ROADMAP_RE.test(out))throw new Error('meta_native_roadmap_id_invalid');return out}
function nonNegative(value,name){const out=Number(value);if(!Number.isSafeInteger(out)||out<0)throw new Error(`meta_native_${name}_invalid`);return out}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=stable(value[key]);return out}return value}
function samePlan(left,right){try{return JSON.stringify(stable(left))===JSON.stringify(stable(right))}catch{return false}}

export class MetaOrchestratorActivationOutcomeError extends Error{
  constructor(message,{effectState='AMBIGUOUS',automaticRetryAllowed=false,cause=null}={}){super(message,{cause});this.name='MetaOrchestratorActivationOutcomeError';this.effect_state=effectState;this.automatic_retry_allowed=automaticRetryAllowed;this.authority_effect=false}
}

export class MetaOrchestratorNativeProvider{
  #identity;
  #readFetch;
  #effectFetch;
  #workspaceId;
  #baseUrl;
  #runtimePath;
  #lastReadAt=null;
  #lastActivation=null;

  constructor({identity,fetchImpl=globalThis.fetch,workspace_id,baseUrl=NATIVE_SUPERVISOR_BASE,runtimePath=NATIVE_SUPERVISOR_RUNTIME_PATH,readDeadlineMs=8000}={}){
    if(!identity||typeof identity.ensure!=='function'||typeof identity.deviceHeaders!=='function')throw new Error('meta_native_identity_required');
    if(typeof fetchImpl!=='function')throw new Error('meta_native_fetch_required');
    this.#identity=identity;
    this.#readFetch=createBoundedSupervisorFetch(fetchImpl,{deadlineMs:readDeadlineMs});
    this.#effectFetch=fetchImpl;
    this.#workspaceId=workspaceId(workspace_id);
    this.#baseUrl=String(baseUrl||'').replace(/\/+$/,'');
    this.#runtimePath=String(runtimePath||'');
    if(!this.#baseUrl.startsWith('https://')||!this.#runtimePath.startsWith('/'))throw new Error('meta_native_endpoint_invalid');
  }

  snapshot(){return Object.freeze({schema:'metaengine.meta-orchestrator.native-provider.v1',workspace_id:this.#workspaceId,last_read_at:this.#lastReadAt,last_activation:this.#lastActivation?structuredClone(this.#lastActivation):null,automatic_retry:false,second_polling_loop:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false})}

  async #signedPost(path,payload,{effectful=false}={}){
    const identity=await this.#identity.ensure();
    if(!identity?.device_id)throw new Error('meta_native_device_not_enrolled');
    const bodyText=JSON.stringify(payload??{});
    const requestPath=`${this.#runtimePath}${path}`;
    const headers=await this.#identity.deviceHeaders('POST',requestPath,bodyText);
    const fetchImpl=effectful?this.#effectFetch:this.#readFetch;
    return fetchImpl(`${this.#baseUrl}${path}`,{method:'POST',headers,body:bodyText,cache:'no-store'});
  }

  async readAuthoritativeInputs({workspace_id=this.#workspaceId,roadmap_id='metaengine-development-os-v1'}={}){
    const workspace=workspaceId(workspace_id);
    if(workspace!==this.#workspaceId)throw new Error('meta_native_workspace_drift');
    const roadmap=roadmapId(roadmap_id);
    const response=await this.#signedPost('/v1/meta/authoritative-inputs',{roadmap_id:roadmap});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(`meta_native_authoritative_inputs_http_${response.status}:${body?.error||body?.reason||'unknown'}`);
    const bundle=object(body,'authoritative_inputs');
    if(String(bundle.workspace_id||'').toLowerCase()!==workspace||String(bundle.roadmap_id||'').toLowerCase()!==roadmap)throw new Error('meta_native_authoritative_inputs_identity_drift');
    if(bundle.authority_effect!==false||bundle.scheduler_authority!==false||bundle.browser_authority!==false||bundle.release_authority!==false||bundle.task_content_authority!==false)throw new Error('meta_native_authoritative_inputs_authority_invalid');
    this.#lastReadAt=new Date().toISOString();
    return bundle;
  }

  async activatePlan({p_workspace_id=this.#workspaceId,p_roadmap_id,p_expected_current_generation,p_plan}={}){
    const workspace=workspaceId(p_workspace_id);
    if(workspace!==this.#workspaceId)throw new Error('meta_native_workspace_drift');
    const roadmap=roadmapId(p_roadmap_id);
    const expected=nonNegative(p_expected_current_generation,'expected_current_generation');
    const plan=object(p_plan,'plan');
    if(plan.schema!=='metaengine.meta-orchestrator.plan.v1'||plan.authority_effect===true||plan.scheduler_authority===true||plan.browser_authority===true||plan.release_authority===true||plan.task_content_authority===true)throw new Error('meta_native_zero_authority_plan_required');
    if(Number(plan.plan_generation)!==expected+1||String(plan.roadmap_id||'').toLowerCase()!==roadmap)throw new Error('meta_native_plan_generation_or_roadmap_drift');

    let response;
    let body={};
    try{
      response=await this.#signedPost('/v1/meta/activate-plan',{roadmap_id:roadmap,expected_current_generation:expected,plan:structuredClone(plan)},{effectful:true});
      body=await response.json().catch(()=>({}));
    }catch(error){
      return this.#reconcileAmbiguousActivation({roadmap,expected,plan,cause:error});
    }

    if(response.ok){
      this.#lastActivation={state:'EFFECT_CONFIRMED',plan_generation:Number(body.plan_generation),at:new Date().toISOString(),automatic_retry_allowed:false,authority_effect:false};
      return body;
    }
    if(response.status===409){
      this.#lastActivation={state:'FENCED',plan_generation:expected,at:new Date().toISOString(),automatic_retry_allowed:false,authority_effect:false};
      throw new MetaOrchestratorActivationOutcomeError(`meta_native_activation_fenced:${body?.reason||body?.error||'conflict'}`,{effectState:'FENCED',automaticRetryAllowed:false});
    }
    if(response.status>=400&&response.status<500){
      this.#lastActivation={state:'REJECTED',plan_generation:expected,at:new Date().toISOString(),automatic_retry_allowed:false,authority_effect:false};
      throw new MetaOrchestratorActivationOutcomeError(`meta_native_activation_rejected_${response.status}:${body?.reason||body?.error||'rejected'}`,{effectState:'EFFECT_ABSENT',automaticRetryAllowed:false});
    }
    return this.#reconcileAmbiguousActivation({roadmap,expected,plan,cause:new Error(`meta_native_activation_http_${response.status}:${body?.reason||body?.error||'unknown'}`)});
  }

  async #reconcileAmbiguousActivation({roadmap,expected,plan,cause}){
    let inputs;
    try{inputs=await this.readAuthoritativeInputs({workspace_id:this.#workspaceId,roadmap_id:roadmap})}catch(readError){
      this.#lastActivation={state:'AMBIGUOUS',plan_generation:expected+1,at:new Date().toISOString(),automatic_retry_allowed:false,authority_effect:false};
      throw new MetaOrchestratorActivationOutcomeError('meta_native_activation_ambiguous_readback_failed',{effectState:'AMBIGUOUS',automaticRetryAllowed:false,cause:readError});
    }
    const state=object(inputs.plan_state,'activation_readback');
    const generation=Number(state.plan_generation||0);
    if(state.found===true&&state.state==='ACTIVE'&&generation===expected+1&&samePlan(state.plan_spec,plan)){
      this.#lastActivation={state:'EFFECT_CONFIRMED',plan_generation:generation,at:new Date().toISOString(),automatic_retry_allowed:false,reconciled:true,authority_effect:false};
      return state;
    }
    if((state.found!==true&&expected===0)||(state.found===true&&generation===expected)){
      this.#lastActivation={state:'EFFECT_ABSENT',plan_generation:expected,at:new Date().toISOString(),automatic_retry_allowed:true,reconciled:true,authority_effect:false};
      throw new MetaOrchestratorActivationOutcomeError('meta_native_activation_effect_absent_after_readback',{effectState:'EFFECT_ABSENT',automaticRetryAllowed:true,cause});
    }
    this.#lastActivation={state:'AMBIGUOUS',plan_generation:generation||null,at:new Date().toISOString(),automatic_retry_allowed:false,reconciled:true,authority_effect:false};
    throw new MetaOrchestratorActivationOutcomeError('meta_native_activation_ambiguous_after_readback',{effectState:'AMBIGUOUS',automaticRetryAllowed:false,cause});
  }

  privilegedAdapter(){return new MetaOrchestratorPrivilegedAdapter({readAuthoritativeInputs:(args)=>this.readAuthoritativeInputs(args),activatePlan:(args)=>this.activatePlan(args)})}
}
