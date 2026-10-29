import {validateNativeCodingAgentMcpBinding,validateNativeCodingAgentMcpArguments} from './native-coding-agent-mcp-broker.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Reflect.ownKeys(value).sort().join(',')===[...keys].sort().join(',')
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const fail=reason=>{throw Error('native_coding_agent_host_'+reason);};
export const NATIVE_AGENT_HOST_TOOLS=Object.freeze(['project_overview','project_history_page','agent_send_message','agent_ack_message','project_propose_children']);
export function validateNativeCodingAgentHostRequest(value){
  if(!exact(value,['args','binding','job_binding','operation']))fail('request_invalid');
  validateNativeCodingAgentMcpBinding(value.binding);
  const j=value.job_binding,m=/^pid:([1-9][0-9]*):created_100ns:([1-9][0-9]{16,18})$/.exec(j?.process_incarnation_id||'');
  if(!exact(j,['job_id','pid','process_incarnation_id','executable_sha256'])||!UUID.test(j.job_id||'')
    ||!Number.isSafeInteger(j.pid)||j.pid<1||j.pid>0x7fffffff||!m||Number(m[1])!==j.pid
    ||BigInt(m[2])>18446744073709551615n||!SHA.test(j.executable_sha256||''))fail('job_binding_invalid');
  if(value.operation==='CHECK'){if(!exact(value.args,[]))fail('arguments_invalid');}
  else if(value.operation==='READ_INTENT'){
    if(!exact(value.args,['request_id'])||!UUID.test(value.args.request_id||''))fail('arguments_invalid');
  }else{
    if(!NATIVE_AGENT_HOST_TOOLS.includes(value.operation))fail('operation_unbound');
    validateNativeCodingAgentMcpArguments(value.operation,value.args);
    if(value.operation==='project_propose_children'&&value.binding.role!=='IMPLEMENTER')fail('critic_spawn_denied');
  }
  return value;
}
export const nativeCodingAgentHostOperationWrites=value=>['agent_send_message','agent_ack_message','project_propose_children'].includes(value?.operation);
