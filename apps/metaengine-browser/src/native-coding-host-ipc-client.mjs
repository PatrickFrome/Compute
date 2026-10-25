import { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

export const NATIVE_CODING_HOST_IPC_REQUEST = 'metaengine.native-coding.host-ipc.request.v1';
export const NATIVE_CODING_HOST_IPC_RESPONSE = 'metaengine.native-coding.host-ipc.response.v1';
const ACTIONS = ['READ_SCOPE','READ_LEASE','REGISTER_PROVIDER','READ_EXECUTION','RESERVE_EXECUTION','ADVANCE_EXECUTION'];
const WRITES = new Set(['REGISTER_PROVIDER','RESERVE_EXECUTION','ADVANCE_EXECUTION']);
const REASONS = new Set(['INVALID_FRAME','INVALID_PAYLOAD','MESSAGE_TOO_LARGE','UNSUPPORTED_ACTION','INSTANCE_MISMATCH',
  'HOST_PID_MISMATCH','INFLIGHT_LIMIT','REQUEST_ID_REUSED','OPERATION_FAILED','WRITE_OUTCOME_UNKNOWN','RESPONSE_INVALID',
  'REQUEST_TIMEOUT','CHILD_EXIT','CHANNEL_CLOSED','SEND_FAILED','CLIENT_CLOSED','SERVER_CLOSED']);
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
  if(action==='READ_SCOPE')keys(value,[]);
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
export function createNativeCodingHostIpcClient({child,instanceId,hostPid,timeoutMs=20000,maxInflight=16}={}) {
  if(!(child instanceof ChildProcess)||typeof child.send!=='function'||!child.channel||child.connected!==true
    ||!UUID.test(instanceId||'')||!Number.isSafeInteger(hostPid)||hostPid<1||child.pid!==hostPid
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||!Number.isSafeInteger(maxInflight)||maxInflight<1||maxInflight>16)
    throw new NativeCodingHostIpcError('CHANNEL_CLOSED');
  const pending=new Map();let closed=false;
  const reject=(row,reason,unknown=WRITES.has(row.action))=>row.reject(new NativeCodingHostIpcError(reason,
    {action:row.action,requestId:row.id,instanceId,unknown}));
  const take=id=>{const row=pending.get(id);if(row){clearTimeout(row.timer);pending.delete(id);}return row;};
  const stop=reason=>{if(closed)return;closed=true;for(const id of [...pending.keys()]){const row=take(id);reject(row,reason);}
    child.off('message',onMessage);child.off('exit',onExit);child.off('disconnect',onDisconnect);child.off('error',onError);};
  function onMessage(message,sendHandle) {
    if(!plain(message)||message.schema!==NATIVE_CODING_HOST_IPC_RESPONSE)return;
    const row=pending.get(message.request_id);if(!row)return;
    try{
      json(message);keys(message,['schema','instance_id','host_pid','request_id','action','request_sha256','outcome','value','reason']);
      if(sendHandle||message.instance_id!==instanceId||message.host_pid!==hostPid||message.request_id!==row.id
        ||message.action!==row.action||message.request_sha256!==row.digest||!['OK','REJECTED','UNKNOWN'].includes(message.outcome)
        ||(message.outcome==='OK'?(message.reason!==null):(!REASONS.has(message.reason)||message.value!==null)))invalid('RESPONSE_INVALID');
    }catch{take(row.id);reject(row,'RESPONSE_INVALID');return;}
    take(row.id);
    if(message.outcome==='OK')row.resolve(structuredClone(message.value));
    else reject(row,message.reason,message.outcome==='UNKNOWN');
  }
  const onExit=()=>stop('CHILD_EXIT'),onDisconnect=()=>stop('CHANNEL_CLOSED'),onError=()=>stop('CHANNEL_CLOSED');
  child.on('message',onMessage);child.on('exit',onExit);child.on('disconnect',onDisconnect);child.on('error',onError);
  function invoke(action,value) {
    if(closed||child.connected!==true)return Promise.reject(new NativeCodingHostIpcError('CHANNEL_CLOSED'));
    if(pending.size>=maxInflight)return Promise.reject(new NativeCodingHostIpcError('INFLIGHT_LIMIT'));
    let frame;
    try{payload(action,value);frame={schema:NATIVE_CODING_HOST_IPC_REQUEST,instance_id:instanceId,host_pid:hostPid,request_id:randomUUID(),action,payload:structuredClone(value)};json(frame);}
    catch(error){return Promise.reject(new NativeCodingHostIpcError(REASONS.has(error.reason)?error.reason:'INVALID_PAYLOAD'));}
    const requestDigest=digest(frame);
    return new Promise((resolve,rejectPromise)=>{
      const row={id:frame.request_id,action,digest:requestDigest,resolve,reject:rejectPromise,timer:null};
      row.timer=setTimeout(()=>{const current=take(row.id);if(current)reject(current,'REQUEST_TIMEOUT');},timeoutMs);
      pending.set(row.id,row);
      try{child.send(frame,error=>{if(error){const current=take(row.id);if(current)reject(current,'SEND_FAILED');}});}
      catch{const current=take(row.id);if(current)reject(current,'SEND_FAILED');}
    });
  }
  return Object.freeze({
    readScope:()=>invoke('READ_SCOPE',{}),readLease:value=>invoke('READ_LEASE',value),
    registerProvider:descriptor=>invoke('REGISTER_PROVIDER',{descriptor}),
    readExecution:scope=>invoke('READ_EXECUTION',{scope}),reserveExecution:scope=>invoke('RESERVE_EXECUTION',{scope}),
    advanceExecution:(scope,transition)=>invoke('ADVANCE_EXECUTION',{scope,transition}),
    close:()=>stop('CLIENT_CLOSED'),snapshot:()=>Object.freeze({instance_id:instanceId,host_pid:hostPid,inflight:pending.size,closed,automatic_retry_allowed:false}),
  });
}
