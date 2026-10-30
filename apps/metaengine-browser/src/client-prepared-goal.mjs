import {readNativeWorkspaceStage} from './native-coding-workspace-preparation.mjs';
import {signNativeCodingDeviceRequest} from './native-coding-device-request.mjs';
import {isDeepStrictEqual} from 'node:util';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...k].sort().join('|');
const fail=reason=>{throw Error('client_prepared_goal_'+reason);};
const states=new WeakMap();
export function normalizePreparedGoalSelector(v){
 if(!exact(v,['preparation_id','configuration_sha256','workspace_id','preparation_grant_epoch'])
  ||![v.preparation_id,v.workspace_id].every(x=>UUID.test(x||''))||!SHA.test(v.configuration_sha256||'')
  ||!Number.isSafeInteger(v.preparation_grant_epoch)||v.preparation_grant_epoch<1)fail('selector_invalid');
 return Object.freeze({...v});
}
export function preparedGoalInput(entry){
 const selector=normalizePreparedGoalSelector(entry.prepared_selector);
 if(!UUID.test(entry.request_id||'')||typeof entry.goal!=='string'||entry.goal!==entry.goal.trim()
  ||entry.goal.length<1||entry.goal.length>480||Buffer.byteLength(entry.goal)>1920)fail('input_invalid');
 return {preparation_id:selector.preparation_id,configuration_sha256:selector.configuration_sha256,request_id:entry.request_id,objective:entry.goal};
}
export function normalizePreparedGoalAdmission(v,entry){
 const input=preparedGoalInput(entry),selector=entry.prepared_selector;
 if(!exact(v,['schema','state',...Object.keys(input),'workspace_id','project_id','root_task_id','task_spec_sha256','preparation_grant_epoch',
  'root_state','project_state','owner_incarnation_verified','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'])
  ||v.schema!=='metaengine.native-coding.pending-goal-admission.v1'||v.state!=='PENDING_ACTIVATION'
  ||Object.entries(input).some(([k,x])=>v[k]!==x)||v.workspace_id!==selector.workspace_id||v.preparation_grant_epoch!==selector.preparation_grant_epoch
  ||![v.project_id,v.root_task_id].every(x=>UUID.test(x||''))||!SHA.test(v.task_spec_sha256||'')
  ||v.root_state!=='BLOCKED'||v.project_state!=='PAUSED'
  ||['owner_incarnation_verified','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'].some(k=>v[k]!==false))fail('receipt_invalid');
 return Object.freeze(structuredClone(v));
}
export function normalizePreparedGoalResult(v,entry){
 if(!exact(v,['schema','state','admission','automatic_retry_allowed','authority_effect'])
  ||v.schema!=='metaengine.native-coding.pending-goal-result.v1'||!['PENDING_ACTIVATION','READBACK_REQUIRED','NOT_STARTED'].includes(v.state)
  ||v.automatic_retry_allowed!==false||v.authority_effect!==false)fail('result_invalid');
 if(v.state==='PENDING_ACTIVATION')return normalizePreparedGoalAdmission(v.admission,entry);
 if(v.admission!==null)fail('result_conflict');
 return null;
}
// No runtime callback or seed fallback exists in this router. The selector is
// saved durably before the sole effect; every subsequent call is read-only.
export function createClientPreparedGoalRouter({journal,request,readSelector}={}){
 if(!journal||typeof request!=='function'||typeof readSelector!=='function')fail('configuration');
 if(!states.has(journal))states.set(journal,{inFlight:false});const state=states.get(journal);
 async function observe(entry){
  const receipt=normalizePreparedGoalResult(await request('READ_PREPARED_GOAL_V1',preparedGoalInput(entry)),entry);
  if(receipt)return journal.recordPreparedAdmission(receipt);
  await journal.markReconcileRequired(entry.request_id,'prepared_goal_readback_required');
  return journal.get(entry.request_id);
 }
 return Object.freeze({
  async submit({request_id,goal}){
   if(state.inFlight)fail('operation_pending');state.inFlight=true;
   try{
    await journal.load();
    if(journal.snapshot().entries.some(e=>e.kind==='PREPARED_GOAL'||['SUBMITTING','RECONCILE_REQUIRED'].includes(e.state)))fail('previous_request_requires_readback');
    if(journal.get(request_id))fail('request_already_recorded');
    const selector=normalizePreparedGoalSelector(await readSelector());
    const entry=await journal.begin({request_id,goal,kind:'PREPARED_GOAL',prepared_selector:selector});
    try{
     // Revalidate after persistence; changed preparation never gets an effect.
     if(!isDeepStrictEqual(selector,normalizePreparedGoalSelector(await readSelector())))fail('preparation_changed');
     const receipt=normalizePreparedGoalResult(await request('ADMIT_PREPARED_GOAL_V1',preparedGoalInput(entry)),entry);
     if(!receipt)fail('readback_required');
     await journal.recordPreparedAdmission(receipt);return receipt;
    }catch{
     await journal.markReconcileRequired(request_id,'prepared_goal_readback_required').catch(()=>{});
     try{await observe(entry);}catch{}
     fail('submit_requires_reconciliation:'+request_id);
    }
   }finally{state.inFlight=false;}
  },
  async refresh(entry){
   const durable=journal.get(entry?.request_id);
   if(durable?.kind!=='PREPARED_GOAL')fail('kind_invalid');
   try{return await observe(durable);}catch(error){
    await journal.markReconcileRequired(durable.request_id,'prepared_goal_observation_unavailable').catch(()=>{});throw error;
   }
  },
 });
}

// Reads only: neither stage presence nor the renderer grants preparation.
export async function readVerifiedPreparedGoalSelector({stateDirectory,identity,capability,assertOpen=()=>{},readStage=readNativeWorkspaceStage}={}){
 const stage=await readStage(stateDirectory);assertOpen();
 const before=identity.snapshot();
 const signed=await signNativeCodingDeviceRequest({identity,binding:capability.snapshot(),operation:'READ_WORKSPACE_PREPARATION_V1',input:stage.input});assertOpen();
 const value=await capability.readWorkspacePreparation(signed);assertOpen();
 const after=identity.snapshot();
 if(['device_id','client_id','key_fingerprint_sha256'].some(k=>before[k]!==after[k]))fail('identity_changed');
 if(!exact(value,['schema','preparation_id','configuration_sha256','state','preparation_grant_epoch','current_grant_valid',
  'owner_incarnation_verified','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'])
  ||value.schema!=='metaengine.native-coding.workspace-preparation-readback.v1'||value.state!=='PREPARED'
  ||value.preparation_id!==stage.input.preparation_id||value.configuration_sha256!==stage.input.configuration_sha256
  ||value.current_grant_valid!==true||['owner_incarnation_verified','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'].some(k=>value[k]!==false))fail('preparation_unverified');
 return normalizePreparedGoalSelector({...stage.input,workspace_id:stage.configuration.workspace_id,preparation_grant_epoch:value.preparation_grant_epoch});
}
