import { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {validateNativeCodingAgentHostRequest,nativeCodingAgentHostOperationWrites} from './native-coding-agent-host-contract.mjs';
import {validateNativeCodingDeviceRequest} from './native-coding-device-request.mjs';

export const NATIVE_CODING_HOST_IPC_REQUEST = 'metaengine.native-coding.host-ipc.request.v1';
export const NATIVE_CODING_HOST_IPC_RESPONSE = 'metaengine.native-coding.host-ipc.response.v1';
const WRITES = new Set(['REGISTER_PROVIDER','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','SEED_GOAL','SERVICE_HEARTBEAT']);
const writes=(action,value)=>WRITES.has(action)||action==='AGENT_OPERATION'&&nativeCodingAgentHostOperationWrites(value);
const REASONS = new Set(['INVALID_FRAME','INVALID_PAYLOAD','MESSAGE_TOO_LARGE','UNSUPPORTED_ACTION','INSTANCE_MISMATCH',
  'HOST_PID_MISMATCH','INFLIGHT_LIMIT','REQUEST_ID_REUSED','OPERATION_FAILED','WRITE_OUTCOME_UNKNOWN','RESPONSE_INVALID',
  'REQUEST_TIMEOUT','CHILD_EXIT','CHANNEL_CLOSED','SEND_FAILED','CLIENT_CLOSED','SERVER_CLOSED','HOST_TERMINATED']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SCOPE = ['workspace_id','task_id','lease_generation','agent_id','target_id','agent_generation_epoch','host_incarnation','scope_sha256'];
const LIMIT = 256 * 1024;
const invalid = reason => { const error=new Error(reason); error.reason=reason; throw error; };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function keys(value, expected) {
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
  else if(['SEED_GOAL','READ_SEED','LIST_SEEDS','SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT'].includes(action)){try{validateNativeCodingDeviceRequest(value,action);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='AGENT_OPERATION'){try{validateNativeCodingAgentHostRequest(value);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='FINISH_CHECKPOINT'||action==='READ_FINISH_CHECKPOINT'||action==='RECONCILE_FINISH_CHECKPOINT'){
    keys(value,['project_id','checkpoint_sha256']);if(!UUID.test(value.project_id||'')||!HASH.test(value.checkpoint_sha256||''))invalid('INVALID_PAYLOAD');
  }
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

export class NativeCodingHostIpcError extends Error {
  constructor(reason,{action=null,requestId=null,instanceId=null,unknown=false}={}) {
    super(`native_coding_host_ipc_${REASONS.has(reason)?reason:'RESPONSE_INVALID'}`);
    this.name='NativeCodingHostIpcError';this.reason=REASONS.has(reason)?reason:'RESPONSE_INVALID';
    this.action=action;this.request_id=requestId;this.instance_id=instanceId;
    this.effect_outcome=unknown?'UNKNOWN':'NONE';this.readback_required=unknown||reason==='REQUEST_TIMEOUT';
    this.automatic_retry_allowed=false;
  }
}

// The ChildProcess object is the capability. There is no HTTP/renderer path,
// generic SQL method, caller-chosen request id, or automatic retransmission.
// Transport must cover the Host's bounded 25s physical observation. Device
// signature and observation freshness checks remain independent and unchanged.
export function createNativeCodingHostIpcClient({child,instanceId,hostPid,timeoutMs=30000,maxInflight=16}={}) {
  if(!(child instanceof ChildProcess)||typeof child.send!=='function'||!child.channel||child.connected!==true
    ||!UUID.test(instanceId||'')||!Number.isSafeInteger(hostPid)||hostPid<1||child.pid!==hostPid
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isSafeInteger(maxInflight)||maxInflight<1||maxInflight>16)
    throw new NativeCodingHostIpcError('CHANNEL_CLOSED');
  const pending=new Map(),unavailableListeners=new Set();let closed=false,unavailable=null;
  const reject=(row,reason,unknown=row.write)=>row.reject(new NativeCodingHostIpcError(reason,
    {action:row.action,requestId:row.id,instanceId,unknown}));
  const take=id=>{const row=pending.get(id);if(row){clearTimeout(row.timer);pending.delete(id);}return row;};
  const notify=listener=>{try{Promise.resolve(listener(unavailable)).catch(()=>{});}catch{/* A consumer cannot prevent other consumers from fencing. */}};
  const stop=reason=>{if(closed)return;closed=true;
    unavailable=Object.freeze({schema:'metaengine.native-coding.host-unavailable.v1',reason,
      instance_id:instanceId,host_pid:hostPid,automatic_retry_allowed:false,authority_effect:false});
    for(const id of [...pending.keys()]){const row=take(id);reject(row,reason);}
    child.off('message',onMessage);child.off('exit',onExit);child.off('disconnect',onDisconnect);child.off('error',onError);
    const listeners=[...unavailableListeners];unavailableListeners.clear();for(const listener of listeners)notify(listener);
  };
  function onMessage(message,sendHandle) {
    // A terminal declaration can only remove authority. Even malformed
    // terminal payloads fence this exact child capability before process exit.
    if(message?.schema==='compute.runtime-host-terminal.v1'){stop('HOST_TERMINATED');return;}
    if(!plain(message)||message.schema!==NATIVE_CODING_HOST_IPC_RESPONSE)return;
    const row=pending.get(message.request_id);if(!row)return;
    try{
      json(message);keys(message,['schema','instance_id','host_pid','request_id','action','request_sha256','outcome','value','reason']);
      if(sendHandle||message.instance_id!==instanceId||message.host_pid!==hostPid||message.request_id!==row.id
        ||message.action!==row.action||message.request_sha256!==row.digest||!['OK','REJECTED','UNKNOWN'].includes(message.outcome)
        ||(message.outcome==='OK'?(message.reason!==null):(!REASONS.has(message.reason)||message.value!==null)))invalid('RESPONSE_INVALID');
    }catch{stop('RESPONSE_INVALID');return;}
    take(row.id);
    if(message.outcome==='OK')row.resolve(structuredClone(message.value));
    else reject(row,message.reason,message.outcome==='UNKNOWN');
  }
  const onExit=()=>stop('CHILD_EXIT'),onDisconnect=()=>stop('CHANNEL_CLOSED'),onError=()=>stop('CHANNEL_CLOSED');
  child.on('message',onMessage);child.on('exit',onExit);child.on('disconnect',onDisconnect);child.on('error',onError);
  function invoke(action,value) {
    if(child.connected!==true)stop('CHANNEL_CLOSED');
    if(closed)return Promise.reject(new NativeCodingHostIpcError('CHANNEL_CLOSED'));
    if(pending.size>=maxInflight)return Promise.reject(new NativeCodingHostIpcError('INFLIGHT_LIMIT'));
    let frame;
    try{payload(action,value);frame={schema:NATIVE_CODING_HOST_IPC_REQUEST,instance_id:instanceId,host_pid:hostPid,request_id:randomUUID(),action,payload:structuredClone(value)};json(frame);}
    catch(error){return Promise.reject(new NativeCodingHostIpcError(REASONS.has(error.reason)?error.reason:'INVALID_PAYLOAD'));}
    const requestDigest=digest(frame);
    return new Promise((resolve,rejectPromise)=>{
      const row={id:frame.request_id,action,write:writes(action,value),digest:requestDigest,resolve,reject:rejectPromise,timer:null};
      row.timer=setTimeout(()=>{const current=take(row.id);if(current)reject(current,'REQUEST_TIMEOUT');},timeoutMs);
      pending.set(row.id,row);
      try{child.send(frame,error=>{if(error)stop('SEND_FAILED');});}
      catch{stop('SEND_FAILED');}
    });
  }
  return Object.freeze({
    async readScope(){
      let after=null,current=null;const bindings=[],seen=new Set();
      do{
        const page=await invoke('READ_SCOPE',after?{after_permit_id:after}:{});
        if(!page||!Array.isArray(page.bindings)||page.has_more!==undefined&&typeof page.has_more!=='boolean'
          ||current&&(page.schema!==current.schema||page.source!==current.source
            ||JSON.stringify(page.postgres)!==JSON.stringify(current.postgres)))invalid('INVALID_SCOPE_PAGE');
        for(const row of page.bindings){
          if(!UUID.test(row.permit_id||'')||seen.has(row.permit_id)||after&&row.permit_id<=after)invalid('INVALID_SCOPE_CURSOR');
          seen.add(row.permit_id);bindings.push(row);after=row.permit_id;
        }
        if(page.has_more&&(!page.bindings.length||page.next_after_permit_id!==after))invalid('INVALID_SCOPE_CURSOR');
        current=page;
      }while(current.has_more===true);
      return {...current,bindings,has_more:false,next_after_permit_id:null};
    },readLease:value=>invoke('READ_LEASE',value),
    registerProvider:descriptor=>invoke('REGISTER_PROVIDER',{descriptor}),
    readExecution:scope=>invoke('READ_EXECUTION',{scope}),readPriorExecution:selector=>invoke('READ_PRIOR_EXECUTION',{selector}),
    reserveExecution:scope=>invoke('RESERVE_EXECUTION',{scope}),
    advanceExecution:(scope,transition)=>invoke('ADVANCE_EXECUTION',{scope,transition}),
    reconcileProject:project_id=>invoke('RECONCILE_PROJECT',{project_id}),
    readProjectCheckpoint:project_id=>invoke('READ_PROJECT_CHECKPOINT',{project_id}),
    agentOperation:request=>invoke('AGENT_OPERATION',request),
    finishCheckpoint:value=>invoke('FINISH_CHECKPOINT',value),
    readFinishCheckpoint:value=>invoke('READ_FINISH_CHECKPOINT',value),
    reconcileFinishCheckpoint:value=>invoke('RECONCILE_FINISH_CHECKPOINT',value),
    seedGoal:value=>invoke('SEED_GOAL',value),readSeed:value=>invoke('READ_SEED',value),listSeeds:value=>invoke('LIST_SEEDS',value),
    serviceHeartbeat:value=>invoke('SERVICE_HEARTBEAT',value),readServiceHeartbeat:value=>invoke('READ_SERVICE_HEARTBEAT',value),
    // Native callback only: never a renderer event or replacement permission.
    // Late subscribers observe the already-closed capability synchronously.
    onUnavailable(listener){
      if(typeof listener!=='function')throw new TypeError('native_coding_host_ipc_listener_required');
      if(closed){notify(listener);return()=>{};}
      unavailableListeners.add(listener);return()=>unavailableListeners.delete(listener);
    },
    close:()=>stop('CLIENT_CLOSED'),snapshot:()=>Object.freeze({instance_id:instanceId,host_pid:hostPid,inflight:pending.size,closed,automatic_retry_allowed:false}),
  });
}
