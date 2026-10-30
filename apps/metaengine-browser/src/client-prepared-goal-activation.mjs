import {isDeepStrictEqual as same} from 'node:util';
import {pendingActivationInput} from './native-coding-pending-activation-phase.mjs';
import {preparedGoalInput} from './client-prepared-goal.mjs';
import {readNativeCodingProtectedJson} from './native-coding-host-observers.mjs';
import path from 'node:path';
const fail=()=>{throw Error('client_prepared_goal_activation_invalid');};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...k].sort().join('|');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
export async function readPreparedActivationProfilePin(stateDirectory){
 const {value}=await readNativeCodingProtectedJson(path.join(stateDirectory,'native-coding-seed-operator-v1.json'));
 if(!exact(value,['schema','profile_id','profile_sha256'])||value.schema!=='metaengine.native-coding.seed-operator.v1'
  ||!UUID.test(value.profile_id||'')||!SHA.test(value.profile_sha256||''))fail();
 return {profile_id:value.profile_id,profile_sha256:value.profile_sha256};
}
export function normalizePreparedActivationInput(value,entry){
 const input=pendingActivationInput(value),pending=preparedGoalInput(entry);
 if(Object.keys(pending).some(k=>pending[k]!==input[k]))fail();
 return input;
}
export function normalizePreparedActivationReceipt(v,entry){
 const input=normalizePreparedActivationInput(entry.activation_input,entry);
 if(!exact(v,['schema','state','input','workspace_id','project_id','root_task_id','profile_id','profile_sha256','task_spec_sha256','root_state','project_state','permit_ids','loaded_runtime_code_attested','production_qualified','automatic_retry_allowed','authority_effect'])
  ||v.schema!=='metaengine.native-coding.pending-activation-receipt.v1'||v.state!=='ACTIVATED'||!same(v.input,input)
  ||!entry.receipt||['workspace_id','project_id','root_task_id'].some(k=>v[k]!==entry.receipt[k])
  ||!SHA.test(v.task_spec_sha256||'')||v.profile_id!==input.profile_id||v.profile_sha256!==input.profile_sha256||v.root_state!=='READY'||v.project_state!=='ACTIVE'
  ||!Array.isArray(v.permit_ids)||!v.permit_ids.length||new Set(v.permit_ids).size!==v.permit_ids.length||!v.permit_ids.every(x=>UUID.test(x||''))
  ||['loaded_runtime_code_attested','production_qualified','automatic_retry_allowed','authority_effect'].some(k=>v[k]!==false))fail();
 return Object.freeze(structuredClone(v));
}
export function normalizePreparedActivationResult(value,entry){
 if(!exact(value,['schema','state','activation','automatic_retry_allowed','authority_effect'])||value.schema!=='metaengine.native-coding.pending-activation-result.v1'
  ||!['ACTIVATED','READBACK_REQUIRED','NOT_STARTED'].includes(value.state)||value.automatic_retry_allowed!==false||value.authority_effect!==false)fail();
 if(value.state==='ACTIVATED')return normalizePreparedActivationReceipt(value.activation,entry);
 if(value.activation!==null)fail();return null;
}
const flights=new WeakSet();
// Durable exact selector precedes dispatch. Any retained attempt is READ-only,
// including NOT_STARTED recovery; neither a refresh nor restart may replay it.
export function createPreparedActivationRouter({journal,readProfilePin,request,newId,onActivated=null}={}){
 if(!journal||[readProfilePin,request,newId].some(f=>typeof f!=='function')||onActivated!==null&&typeof onActivated!=='function')fail();
 async function record(receipt){
  const entry=await journal.recordPreparedActivation(receipt);
  if(!onActivated)return entry;
  try{await onActivated(entry);return await journal.recordPreparedActivationMountStatus(entry.request_id,null);}
  catch{return journal.recordPreparedActivationMountStatus(entry.request_id,'ACTIVATION_RUNTIME_MOUNT_UNAVAILABLE');}
 }
 async function observe(entry){
  if(!entry.activation_input)return entry;
  const receipt=normalizePreparedActivationResult(await request('READ_PREPARED_GOAL_ACTIVATION_V1',entry.activation_input),entry);
  if(receipt)return record(receipt);
  return entry;
 }
 return Object.freeze({refresh:observe,async activate(entry){
  if(flights.has(journal))fail();flights.add(journal);
  try{
   await journal.load();entry=journal.get(entry.request_id);
   if(entry?.activation_input)return observe(entry);
   if(entry?.kind!=='PREPARED_GOAL'||entry.state!=='PENDING_ACTIVATION'||!entry.receipt)fail();
   const pin=await readProfilePin();
   const input=normalizePreparedActivationInput({...preparedGoalInput(entry),activation_id:newId(),...pin},entry);
   entry=await journal.beginPreparedActivation(input);
   try{
    if(!same(pin,await readProfilePin()))fail();
    const receipt=normalizePreparedActivationResult(await request('ACTIVATE_PREPARED_GOAL_V1',input),entry);
    if(!receipt)fail();return await record(receipt);
   }catch{try{await observe(entry);}catch{}throw Error('client_prepared_goal_activation_readback_required');}
  }finally{flights.delete(journal);}
 }});
}
