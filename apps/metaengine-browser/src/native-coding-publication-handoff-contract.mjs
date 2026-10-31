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
