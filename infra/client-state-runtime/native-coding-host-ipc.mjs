import { createHash } from 'node:crypto';
import {validateNativeCodingAgentHostRequest,nativeCodingAgentHostOperationWrites} from '../../apps/metaengine-browser/src/native-coding-agent-host-contract.mjs';
import {validateNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';

export const NATIVE_CODING_HOST_IPC_REQUEST = 'metaengine.native-coding.host-ipc.request.v1';
export const NATIVE_CODING_HOST_IPC_RESPONSE = 'metaengine.native-coding.host-ipc.response.v1';
const ACTIONS = ['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','READ_PROJECT_CHECKPOINT','AGENT_OPERATION','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT'];
const OPTIONAL_ACTIONS=['READ_PROJECT_REJECTION','SEED_GOAL','READ_SEED','LIST_SEEDS','SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT','READ_PRIOR_EXECUTION','RECONCILE_FINISH_CHECKPOINT'];
const WRITES = new Set(['REGISTER_PROVIDER','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','SEED_GOAL','SERVICE_HEARTBEAT']);
const writes=(action,value)=>WRITES.has(action)||action==='AGENT_OPERATION'&&nativeCodingAgentHostOperationWrites(value);
const REASONS = new Set(['INVALID_FRAME','INVALID_PAYLOAD','MESSAGE_TOO_LARGE','UNSUPPORTED_ACTION','INSTANCE_MISMATCH',
  'HOST_PID_MISMATCH','INFLIGHT_LIMIT','REQUEST_ID_REUSED','OPERATION_FAILED','WRITE_OUTCOME_UNKNOWN','RESPONSE_INVALID',
  'REQUEST_TIMEOUT','CHILD_EXIT','CHANNEL_CLOSED','SEND_FAILED','CLIENT_CLOSED','SERVER_CLOSED']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SCOPE = ['workspace_id','task_id','lease_generation','agent_id','target_id','agent_generation_epoch','host_incarnation','scope_sha256'];
const LIMIT = 256 * 1024;
const invalid = reason => { const error=new Error(reason);error.reason=reason;throw error; };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function keys(value,expected) {
  if(!plain(value)||Reflect.ownKeys(value).sort().join('\0')!==[...expected].sort().join('\0'))invalid('INVALID_PAYLOAD');
}
function json(value) {
  let nodes=0;
  const walk=(v,depth)=>{
    if(++nodes>8192||depth>20)invalid('MESSAGE_TOO_LARGE');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)invalid('INVALID_PAYLOAD');return;}
    if(typeof v==='string'){if(v.length>65536)invalid('MESSAGE_TOO_LARGE');if(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\//i.test(v))invalid('INVALID_PAYLOAD');return;}
    if(Array.isArray(v)){if(v.length>1024||Object.keys(v).length!==v.length)invalid('INVALID_PAYLOAD');for(const item of v)walk(item,depth+1);return;}
    if(!plain(v)||Reflect.ownKeys(v).length>128)invalid('INVALID_PAYLOAD');
    for(const key of Reflect.ownKeys(v)){
      if(typeof key!=='string'||/^(?:__proto__|constructor|prototype|sql|raw_sql|query|statement|dsn|database_url|inspect_database_url|connection_string|connectionString)$/i.test(key))invalid('INVALID_PAYLOAD');
      const descriptor=Object.getOwnPropertyDescriptor(v,key);
      if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))invalid('INVALID_PAYLOAD');
      walk(descriptor.value,depth+1);
    }
  };
  walk(value,0);
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>LIMIT)invalid('MESSAGE_TOO_LARGE');
  return value;
}
function scope(value,reservation=false) {
  keys(value,reservation?[...SCOPE,'reservation_id']:SCOPE);
  if(!UUID.test(value.workspace_id)||!UUID.test(value.task_id)
    ||!Number.isSafeInteger(value.lease_generation)||value.lease_generation<1
    ||!/^agent_[a-z0-9-]{8,64}$/.test(value.agent_id||'')||!/^codex-cli:[0-9a-f-]{36}$/.test(value.target_id||'')
    ||!Number.isSafeInteger(value.agent_generation_epoch)||value.agent_generation_epoch<1
    ||!/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(value.host_incarnation||'')
    ||!HASH.test(value.scope_sha256||'')||(reservation&&!UUID.test(value.reservation_id||'')))invalid('INVALID_PAYLOAD');
}
function payload(action,value) {
  json(value);
  if(action==='READ_SCOPE'){
    keys(value,Object.hasOwn(value,'after_permit_id')?['after_permit_id']:[]);
    if(Object.hasOwn(value,'after_permit_id')&&!UUID.test(value.after_permit_id))invalid('INVALID_PAYLOAD');
  }
  else if(action==='READ_PRIOR_EXECUTION'){
    keys(value,['selector']);const s=value.selector;
    keys(s,['workspace_id','project_id','task_id','lease_generation','agent_id','provider_id','agent_generation_epoch']);
    if(!['workspace_id','project_id','task_id','provider_id'].every(name=>UUID.test(s[name]||''))
      ||!/^agent_[a-z0-9-]{8,64}$/.test(s.agent_id||'')
      ||!['lease_generation','agent_generation_epoch'].every(name=>Number.isSafeInteger(s[name])&&s[name]>0))invalid('INVALID_PAYLOAD');
  }
  else if(action==='READ_PROJECT_REJECTION'){
    keys(value,['project_id','writer_task_id','writer_lease_generation','critic_task_id','critic_lease_generation','result_sha256']);
    if(!['project_id','writer_task_id','critic_task_id'].every(k=>UUID.test(value[k]||''))
      ||!['writer_lease_generation','critic_lease_generation'].every(k=>Number.isSafeInteger(value[k])&&value[k]>0)
      ||value.writer_task_id===value.critic_task_id||!HASH.test(value.result_sha256||''))invalid('INVALID_PAYLOAD');
  }
  else if(action==='FINISH_CHECKPOINT'||action==='READ_FINISH_CHECKPOINT'||action==='RECONCILE_FINISH_CHECKPOINT'){
    keys(value,['project_id','checkpoint_sha256']);if(!UUID.test(value.project_id||'')||!HASH.test(value.checkpoint_sha256||''))invalid('INVALID_PAYLOAD');
  }
  else if(OPTIONAL_ACTIONS.includes(action)){try{validateNativeCodingDeviceRequest(value,action);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='AGENT_OPERATION'){try{validateNativeCodingAgentHostRequest(value);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='RECONCILE_PROJECT'||action==='READ_PROJECT_CHECKPOINT'){
    keys(value,['project_id']);if(!UUID.test(value.project_id||''))invalid('INVALID_PAYLOAD');
  }
  else if(action==='READ_LEASE'){
    keys(value,['workspace_id','project_id','task_id','agent_id','lease_generation','provider_id']);
    if(!['workspace_id','project_id','task_id','provider_id'].every(key=>UUID.test(value[key]))
      ||!/^agent_[a-z0-9-]{8,64}$/.test(value.agent_id||'')||!Number.isSafeInteger(value.lease_generation)||value.lease_generation<1)invalid('INVALID_PAYLOAD');
  }else if(action==='REGISTER_PROVIDER'){
    keys(value,['descriptor']);keys(value.descriptor,['algorithm','issuer_key_fingerprint_sha256','payload','signature']);
    const d=value.descriptor;
    if(d.algorithm!=='ES256'||!HASH.test(d.issuer_key_fingerprint_sha256||'')||!/^[-_A-Za-z0-9]{86}$/.test(d.signature||'')
      ||!plain(d.payload)||d.payload.schema!=='metaengine.codex-cli.transport-proof.v1')invalid('INVALID_PAYLOAD');
  }else if(action==='READ_EXECUTION'||action==='RESERVE_EXECUTION'){keys(value,['scope']);scope(value.scope);}
  else if(action==='ADVANCE_EXECUTION'){
    keys(value,['scope','transition']);scope(value.scope,true);
    const t=value.transition;keys(t,['from','to','evidence_sha256','critic_proof_sha256','checkpoint_sha256',
      ...(t?.to==='ATTEMPTED'?['job_proof']:t?.to==='RESULT_READY'?['result_receipt']:[])]);
    if(!({RESERVED:['ATTEMPTED','AMBIGUOUS'],ATTEMPTED:['RESULT_READY','FAILED','AMBIGUOUS'],RESULT_READY:['CHECKPOINTED']}[t.from]?.includes(t.to))
      ||!HASH.test(t.evidence_sha256||'')||![t.critic_proof_sha256,t.checkpoint_sha256].every(v=>v===null||HASH.test(v))
      ||(t.to==='CHECKPOINTED'&&(!HASH.test(t.critic_proof_sha256||'')||!HASH.test(t.checkpoint_sha256||''))))invalid('INVALID_PAYLOAD');
    if(t.to==='ATTEMPTED'){
      keys(t.job_proof,['algorithm','issuer_key_fingerprint_sha256','payload','signature']);
      if(!plain(t.job_proof.payload)||t.job_proof.payload.schema!=='metaengine.codex-cli.job-proof.v1')invalid('INVALID_PAYLOAD');
    }
    if(t.to==='RESULT_READY'&&(!plain(t.result_receipt)||t.result_receipt.schema!=='metaengine.codex-cli.run-receipt.v1'))invalid('INVALID_PAYLOAD');
  }else invalid('UNSUPPORTED_ACTION');
}
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:plain(value)
  ?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');

// This module has no SQL connection, DSN, network endpoint or lease poller.
// Root binds handleMessage directly to the existing private process IPC event.
export function createNativeCodingHostIpcServer({instanceId,operations,send=process.send?.bind(process),hostPid=process.pid,
  parentPid=process.ppid,maxInflight=16,timeoutMs=30000,onProtocolError=()=>{}}={}) {
  if(!UUID.test(instanceId||'')||hostPid!==process.pid||parentPid!==process.ppid||process.connected!==true
    ||typeof process.send!=='function'||typeof send!=='function'||typeof onProtocolError!=='function'
    ||!Number.isSafeInteger(maxInflight)||maxInflight<1||maxInflight>16
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)invalid('CHANNEL_CLOSED');
  // close is a private lifecycle method on the real authority. It is never a
  // dispatchable IPC action; reject every other unexpected property.
  const mountedActions=[...ACTIONS,...OPTIONAL_ACTIONS.filter(action=>Object.hasOwn(operations||{},action))];
  keys(operations,[...mountedActions,...(Object.hasOwn(operations||{},'close')?['close']:[])]);
  for(const action of mountedActions)if(typeof operations[action]!=='function')invalid('INVALID_PAYLOAD');
  if(Object.hasOwn(operations,'close')&&typeof operations.close!=='function')invalid('INVALID_PAYLOAD');
  let closed=false;const active=new Map(),completed=new Map();
  const protocolError=reason=>{try{onProtocolError(REASONS.has(reason)?reason:'INVALID_FRAME');}catch{}};
  function emit(frame) {
    if(process.connected!==true)return;
    try{json(frame);send(frame,error=>{if(error)protocolError('SEND_FAILED');});}
    catch{protocolError('SEND_FAILED');}
  }
  const response=(request,requestDigest,outcome,value,reason)=>({schema:NATIVE_CODING_HOST_IPC_RESPONSE,instance_id:instanceId,host_pid:hostPid,
    request_id:request.request_id,action:request.action,request_sha256:requestDigest,outcome,value,reason});
  function seal(row,outcome,value,reason) {
    if(row.response)return;
    let frame=response(row.request,row.digest,outcome,value,reason);
    try{json(frame);}catch{frame=response(row.request,row.digest,row.write?'UNKNOWN':'REJECTED',null,
      row.write?'WRITE_OUTCOME_UNKNOWN':'OPERATION_FAILED');}
    row.response=frame;clearTimeout(row.timer);completed.set(row.request.request_id,{digest:row.digest,frame});
    // This response cache is not a durable execution ledger. Task/lease scope
    // uniqueness and transition CAS remain in the existing own-PG operations.
    while(completed.size>256)completed.delete(completed.keys().next().value);
    emit(frame);
  }
  function close() {
    if(closed)return;closed=true;
    for(const row of active.values()){
      seal(row,row.write?'UNKNOWN':'REJECTED',null,'SERVER_CLOSED');
      row.abort.abort();
    }
    process.off('disconnect',onDisconnect);
  }
  const onDisconnect=()=>close();process.on('disconnect',onDisconnect);
  function handleMessage(message,sendHandle) {
    if(!plain(message)||message.schema!==NATIVE_CODING_HOST_IPC_REQUEST)return false;
    if(closed||process.connected!==true||process.pid!==hostPid||process.ppid!==parentPid){protocolError('CHANNEL_CLOSED');return true;}
    let requestDigest;
    try{
      if(sendHandle)invalid('INVALID_FRAME');json(message);
      keys(message,['schema','instance_id','host_pid','request_id','action','payload']);
      if(message.instance_id!==instanceId)invalid('INSTANCE_MISMATCH');
      if(message.host_pid!==hostPid)invalid('HOST_PID_MISMATCH');
      if(!UUID.test(message.request_id||''))invalid('INVALID_FRAME');
      if(!ACTIONS.includes(message.action)&&!OPTIONAL_ACTIONS.includes(message.action))invalid('UNSUPPORTED_ACTION');
      payload(message.action,message.payload);requestDigest=digest(message);
    }catch(error){protocolError(REASONS.has(error.reason)?error.reason:'INVALID_FRAME');return true;}
    const old=completed.get(message.request_id),running=active.get(message.request_id);
    if(old){if(old.digest===requestDigest)emit(old.frame);else emit(response(message,requestDigest,'UNKNOWN',null,'REQUEST_ID_REUSED'));return true;}
    if(running){emit(response(message,requestDigest,running.write||writes(message.action,message.payload)?'UNKNOWN':'REJECTED',null,'REQUEST_ID_REUSED'));return true;}
    if(!mountedActions.includes(message.action)){
      // A fully validated request for a known optional capability was never
      // dispatched. Reply on this exact private channel instead of silently
      // forcing discovery to time out (or making an unattempted write UNKNOWN).
      // Malformed/foreign frames still receive no correlated response above.
      seal({request:structuredClone(message),digest:requestDigest,write:false,timer:null,response:null},
        'REJECTED',null,'UNSUPPORTED_ACTION');
      return true;
    }
    if(active.size>=maxInflight){emit(response(message,requestDigest,'REJECTED',null,'INFLIGHT_LIMIT'));return true;}
    const row={request:structuredClone(message),write:writes(message.action,message.payload),digest:requestDigest,abort:new AbortController(),deadlineAt:Date.now()+timeoutMs,timer:null,response:null};
    active.set(message.request_id,row);
    row.timer=setTimeout(()=>{
      seal(row,row.write?'UNKNOWN':'REJECTED',null,'REQUEST_TIMEOUT');row.abort.abort();
      // Keep the physical operation counted until it really settles. A timeout
      // must not create unbounded parallel work or authorize a second write.
    },timeoutMs);
    Promise.resolve().then(()=>operations[message.action](Object.freeze(structuredClone(message.payload)),
      Object.freeze({signal:row.abort.signal,deadlineAt:row.deadlineAt,instanceId,hostPid,requestId:message.request_id,action:message.action})))
      .then(value=>{if(!row.response){json(value);seal(row,'OK',structuredClone(value),null);}})
      .catch(()=>seal(row,row.write?'UNKNOWN':'REJECTED',null,row.write?'WRITE_OUTCOME_UNKNOWN':'OPERATION_FAILED'))
      .finally(()=>{clearTimeout(row.timer);active.delete(message.request_id);});
    return true;
  }
  return Object.freeze({handleMessage,close,snapshot:()=>Object.freeze({instance_id:instanceId,host_pid:hostPid,inflight:active.size,closed,automatic_retry_allowed:false})});
}
