import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {validateNativeCodingAgentMcpBinding} from './native-coding-agent-mcp-broker.mjs';
import {NATIVE_AGENT_HOST_TOOLS} from './native-coding-agent-host-contract.mjs';

export const NATIVE_CALLBACK_PUBLICATION_ACTION='PUBLISH_RUN_CALLBACK_V1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))
 &&Reflect.ownKeys(v).sort().join()===keys.sort().join()
 &&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const fail=()=>{throw Error('native_callback_handoff_invalid');};
export function validateNativeCallbackPublicationIntent(v){
 if(!exact(v,['binding','request_id','request_sha256','operation','job_binding_sha256'])||!UUID.test(v.request_id||'')
  ||!SHA.test(v.request_sha256||'')||!SHA.test(v.job_binding_sha256||'')||!['CHECK','READ_INTENT',...NATIVE_AGENT_HOST_TOOLS].includes(v.operation))fail();
 validateNativeCodingAgentMcpBinding(v.binding);return v;
}
// Correlation only. This JSON is neither a PG proof nor a send capability.
export function nativeCallbackPublicationAck(intent){return Object.freeze({schema:'metaengine.native-coding.callback-publication-ack.v1',
 request_id:intent.request_id,request_sha256:intent.request_sha256,automatic_retry_allowed:false,authority_effect:false});}
export function validateNativeCallbackPublicationAck(value,intent){
 const expected=nativeCallbackPublicationAck(intent);
 if(!exact(value,Object.keys(expected))||Object.keys(expected).some(k=>value[k]!==expected[k]))fail();
 return value;
}

// Correlated readback only. It is not a prepared-run token or dispatch grant.
export function nativeCallbackInitialPublicationAck(publication,scope,requestId){
 const r=publication?.root,c=publication?.cursor;
 if(publication?.schema!=='metaengine.native-coding.callback-publication.v1'||publication.job_sha256!==null
  ||!UUID.test(requestId||'')||r?.reserve_request_id!==requestId||!UUID.test(r?.run_id||'')
  ||!exact(scope,['workspace_id','task_id','lease_generation','agent_id','target_id','agent_generation_epoch','host_incarnation','scope_sha256','reservation_id'])
  ||!['workspace_id','task_id','reservation_id'].every(k=>UUID.test(scope[k]||''))
  ||!Number.isSafeInteger(scope.lease_generation)||scope.lease_generation<1
  ||!Number.isSafeInteger(scope.agent_generation_epoch)||scope.agent_generation_epoch<1
  ||!SHA.test(scope.scope_sha256||'')||sha(r.scope)!==sha(scope)
  ||c?.revision!==0||c.record_count!==2||c.intent_count!==0||c.dispatch_fenced!==false||!SHA.test(c.head_sha256||''))fail();
 return Object.freeze({schema:'metaengine.native-coding.initial-publication-readback.v1',
  request_id:requestId,run_id:r.run_id,workspace_id:scope.workspace_id,task_id:scope.task_id,
  lease_generation:scope.lease_generation,reservation_id:scope.reservation_id,
  root_sha256:sha(r),cursor_sha256:sha(c),execution_ready:false,automatic_retry_allowed:false,authority_effect:false});
}
export function validateNativeCallbackInitialPublicationAck(value,{scope,runId,requestId}={}){
 if(!exact(value,['schema','request_id','run_id','workspace_id','task_id','lease_generation','reservation_id','root_sha256','cursor_sha256','execution_ready','automatic_retry_allowed','authority_effect'])
  ||value.schema!=='metaengine.native-coding.initial-publication-readback.v1'||value.request_id!==requestId||value.run_id!==runId
  ||![requestId,runId,value.workspace_id,value.task_id,value.reservation_id].every(x=>UUID.test(x||''))
  ||!Number.isSafeInteger(value.lease_generation)||value.lease_generation<1
  ||['workspace_id','task_id','lease_generation','reservation_id'].some(k=>value[k]!==scope?.[k])
  ||![value.root_sha256,value.cursor_sha256].every(x=>SHA.test(x||''))
  ||value.execution_ready!==false||value.automatic_retry_allowed!==false||value.authority_effect!==false)fail();
 return value;
}
