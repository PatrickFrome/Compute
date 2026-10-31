import {RUN_OWNER_READ,RUN_OWNER_PHASE,PUBLICATION_OWNER_PHASE,createPublicationOwnerClientPhases,createRunOwnerClientPhases} from './native-coding-run-owner-phase.mjs';
import {claimNativeRunCallbackJournal} from './native-coding-run-callback-journal.mjs';
import {NATIVE_CALLBACK_PUBLICATION_ACTION,validateNativeCallbackPublicationIntent,validateNativeCallbackPublicationAck} from './native-coding-publication-handoff-contract.mjs';
import {validateNativeCodingAgentMcpBinding} from './native-coding-agent-mcp-broker.mjs';
import {NATIVE_SETUP_ACTIONS} from './native-coding-setup-contract.mjs';
import {NATIVE_CODING_HOST_SETTLEMENT,validateNativeCodingHostSettlement} from './native-coding-host-settlement.mjs';
import {PENDING_ACTIVATION_PHASE,createPendingActivationClientPhases} from './native-coding-pending-activation-phase.mjs';
import {PENDING_OWNER_PHASE,PENDING_OWNER_ACTIONS,createPendingOwnerClientPhases} from './native-coding-pending-owner-phase.mjs';
import { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {validateNativeCodingAgentHostRequest,nativeCodingAgentHostOperationWrites} from './native-coding-agent-host-contract.mjs';
import {validateNativeCodingDeviceRequest} from './native-coding-device-request.mjs';

export const NATIVE_CODING_HOST_IPC_REQUEST = 'metaengine.native-coding.host-ipc.request.v1';
export const NATIVE_CODING_HOST_IPC_RESPONSE = 'metaengine.native-coding.host-ipc.response.v1';
const WRITES = new Set(['BEGIN_NATIVE_SETUP_V1','CANCEL_NATIVE_SETUP_V1','ACTIVATE_PREPARED_GOAL_V1','ESTABLISH_PENDING_OWNER_V1','ADMIT_PREPARED_GOAL_V1','PREPARE_WORKSPACE_V1','REGISTER_PROVIDER','RESERVE_EXECUTION','ADVANCE_EXECUTION','RECONCILE_PROJECT','FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','SEED_GOAL','SERVICE_HEARTBEAT','SERVICE_HEARTBEAT_V2']);
const writes=(action,value)=>WRITES.has(action)||action==='AGENT_OPERATION'&&nativeCodingAgentHostOperationWrites(value);
const REASONS = new Set(['INVALID_FRAME','INVALID_PAYLOAD','MESSAGE_TOO_LARGE','UNSUPPORTED_ACTION','INSTANCE_MISMATCH',
  'HOST_PID_MISMATCH','INFLIGHT_LIMIT','REQUEST_ID_REUSED','OPERATION_FAILED','WRITE_OUTCOME_UNKNOWN','RESPONSE_INVALID',
  'PHYSICAL_CLEANUP_UNCONFIRMED','REQUEST_TIMEOUT','CHILD_EXIT','CHANNEL_CLOSED','SEND_FAILED','CLIENT_CLOSED','SERVER_CLOSED','HOST_TERMINATED']);
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
  if(action===NATIVE_CALLBACK_PUBLICATION_ACTION){try{validateNativeCallbackPublicationIntent(value);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='READ_SCOPE'){
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
  else if([RUN_OWNER_READ,'SERVICE_HEARTBEAT_V2','READ_SERVICE_HEARTBEAT_V2','READ_NATIVE_CAPACITY_V1',...NATIVE_SETUP_ACTIONS,'ACTIVATE_PREPARED_GOAL_V1','READ_PREPARED_GOAL_ACTIVATION_V1','ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1','ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1','PREPARE_WORKSPACE_V1','READ_WORKSPACE_PREPARATION_V1','SEED_GOAL','READ_SEED','LIST_SEEDS','SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT'].includes(action)){try{validateNativeCodingDeviceRequest(value,action);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='AGENT_OPERATION'){try{validateNativeCodingAgentHostRequest(value);}catch{invalid('INVALID_PAYLOAD');}}
  else if(action==='READ_PROJECT_REJECTION'){
    keys(value,['project_id','writer_task_id','writer_lease_generation','critic_task_id','critic_lease_generation','result_sha256']);
    if(!['project_id','writer_task_id','critic_task_id'].every(k=>UUID.test(value[k]||''))
      ||!['writer_lease_generation','critic_lease_generation'].every(k=>Number.isSafeInteger(value[k])&&value[k]>0)
      ||value.writer_task_id===value.critic_task_id||!HASH.test(value.result_sha256||''))invalid('INVALID_PAYLOAD');
  }
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
export function createNativeCodingHostIpcClient({child,instanceId,hostPid,timeoutMs=30000,maxInflight=16,readShutdownSettlement=null}={}) {
  if(readShutdownSettlement!==null&&typeof readShutdownSettlement!=='function'||!(child instanceof ChildProcess)||typeof child.send!=='function'||!child.channel||child.connected!==true
    ||!UUID.test(instanceId||'')||!Number.isSafeInteger(hostPid)||hostPid<1||child.pid!==hostPid
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isSafeInteger(maxInflight)||maxInflight<1||maxInflight>16)
    throw new NativeCodingHostIpcError('CHANNEL_CLOSED');
  const pending=new Map(),physical=new Map(),stages=new Map(),unavailableListeners=new Set(),runs=new Map(),waiters=new Set();
  let closed=false,unavailable=null,transportLost=false;
  const change=()=>{for(const done of waiters)done();waiters.clear();};
  const waitChange=()=>new Promise(resolve=>waiters.add(resolve));
  const detach=()=>{if(!closed||physical.size)return;child.off('message',onMessage);child.off('exit',onExit);child.off('disconnect',onDisconnect);child.off('error',onError);};
  const release=row=>{
    if(row.ticket){
      if(row.remoteSettled&&row.localDone)stages.delete(row.id);
      release(row.ticket);change();return;
    }
    if(row.remoteSettled&&row.localDone&&!row.auditPending
      &&(!row.publication||row.publication.remoteSettled&&row.publication.localDone)){
      physical.delete(row.id);stages.delete(row.id);row.runScope?.rows.delete(row);change();detach();
    }
  };
  const audit=(row,event)=>{
    if(!row.runScope)return Promise.resolve();row.auditPending=(row.auditPending||0)+1;
    const work=row.runScope.writer.append(event);work.catch(()=>{row.runScope.failed=true;row.runScope.fenced=true;})
      .finally(()=>{row.auditPending--;release(row);change();});return work;
  };
  const requestEvidence=row=>({request_id:row.id,request_sha256:row.digest});
  const localDone=(row,outcome='OK')=>{if(row.localDone)return;
    void audit(row,{kind:'CALLER',...requestEvidence(row),outcome}).catch(()=>{});
    row.localDone=true;release(row);change();};
  const reject=(row,reason,unknown=row.write)=>{
    const error=new NativeCodingHostIpcError(reason,{action:row.action,requestId:row.id,instanceId,unknown});
    const done=()=>{localDone(row,unknown?'UNKNOWN':'REJECTED');row.reject(error);};
    if(row.ownerPhases){row.ownerPhases.close();void row.ownerPhases.drain().then(done,done);}
    else done();
  };
  const take=id=>{const row=pending.get(id);if(row){clearTimeout(row.timer);pending.delete(id);}return row;};
  const notify=listener=>{try{Promise.resolve(listener(unavailable)).catch(()=>{});}catch{/* Consumer failure cannot bypass other fences. */}};
  const stop=reason=>{
    // Explicit close removes dispatch authority but still listens for physical
    // settlement; it is not a channel-loss/Host-shutdown witness.
    if(reason!=='CLIENT_CLOSED')transportLost=true;
    if(!closed){closed=true;
      unavailable=Object.freeze({schema:'metaengine.native-coding.host-unavailable.v1',reason,
        instance_id:instanceId,host_pid:hostPid,automatic_retry_allowed:false,authority_effect:false});
      for(const id of [...pending.keys()])reject(take(id),reason);
      const listeners=[...unavailableListeners];unavailableListeners.clear();for(const listener of listeners)notify(listener);
    }
    change();detach();
  };
  function onMessage(message,sendHandle) {
    if(message?.schema===NATIVE_CODING_HOST_SETTLEMENT){
      if(transportLost)return; // Protocol/channel loss requires independent Host shutdown, not late frames.
      const row=stages.get(message.request_id);if(!row)return; // Other private capabilities share the channel.
      try{
        json(message);if(sendHandle)invalid('RESPONSE_INVALID');
        const state=validateNativeCodingHostSettlement(message,{instance_id:instanceId,host_pid:hostPid,
          request_id:row.id,action:row.action,request_sha256:row.digest});
        if(row.held&&state!=='HOLD'||row.remoteSettled&&state!=='SETTLED')invalid('RESPONSE_INVALID');
        if(state==='HOLD'?!row.held:!row.remoteSettled)void audit(row,{kind:'TERMINAL',...requestEvidence(row),state,terminal_sha256:digest(message)}).catch(()=>{});
        if(state==='HOLD'){row.held=true;const ticket=row.ticket||row;ticket.held=true;if(ticket.runScope)ticket.runScope.evidenceHold=true;}
        else{row.remoteSettled=true;row.protocolSettled=true;}
        release(row);change();
      }catch{stop('RESPONSE_INVALID');}return;
    }
    if(message?.schema===RUN_OWNER_PHASE||message?.schema===PUBLICATION_OWNER_PHASE||message?.schema===PENDING_OWNER_PHASE||message?.schema===PENDING_ACTIVATION_PHASE){pending.get(message.request_id)?.ownerPhases?.receive(message,sendHandle);return;}
    if(message?.schema==='compute.runtime-host-terminal.v1'){stop('HOST_TERMINATED');return;}
    if(!plain(message)||message.schema!==NATIVE_CODING_HOST_IPC_RESPONSE)return;
    const row=pending.get(message.request_id);if(!row)return; // A late OK never upgrades caller UNKNOWN.
    try{
      json(message);keys(message,['schema','instance_id','host_pid','request_id','action','request_sha256','outcome','value','reason']);
      if(sendHandle||message.instance_id!==instanceId||message.host_pid!==hostPid||message.request_id!==row.id
        ||message.action!==row.action||message.request_sha256!==row.digest||!['OK','REJECTED','UNKNOWN'].includes(message.outcome)
        ||(message.outcome==='OK'?(message.reason!==null):(!REASONS.has(message.reason)||message.value!==null)))invalid('RESPONSE_INVALID');
      if(!row.sendAttempted)invalid('RESPONSE_INVALID');
      if(row.ticket&&message.outcome==='OK')validateNativeCallbackPublicationAck(message.value,row.intent);
    }catch{stop('RESPONSE_INVALID');return;}
    take(row.id);
    if(message.outcome==='OK'){
      if(row.ownerPhases)void row.ownerPhases.finish(structuredClone(message.value)).then(value=>{localDone(row);row.resolve(value);},()=>reject(row,'RESPONSE_INVALID'));
      else{localDone(row);row.resolve(structuredClone(message.value));}
    }else reject(row,message.reason,message.outcome==='UNKNOWN');
  }
  const onExit=()=>stop('CHILD_EXIT'),onDisconnect=()=>stop('CHANNEL_CLOSED'),onError=()=>stop('CHANNEL_CLOSED');
  child.on('message',onMessage);child.on('exit',onExit);child.on('disconnect',onDisconnect);child.on('error',onError);
  let draining=null;
  function drainPhysical({wait=true}={}){
    if(wait&&draining)return draining;
    const work=(async()=>{
      while(physical.size){
        if(transportLost||[...physical.values()].some(row=>row.held)){
          // Supplied only by the controller which captured this exact child.
          // No stopping/restarting here; missing evidence is finite HOLD.
          let witness=null;try{witness=await readShutdownSettlement?.();}catch{}
          if(!witness||witness.schema!=='metaengine.native-coding.host-shutdown-settlement.v1'
            ||witness.instance_id!==instanceId||witness.host_pid!==hostPid||witness.cleanup_confirmed!==true
            ||witness.authority_effect!==false)throw new NativeCodingHostIpcError('PHYSICAL_CLEANUP_UNCONFIRMED');
          for(const row of physical.values()){
            if(row.publication&&!row.publication.remoteSettled&&row.runScope)row.runScope.evidenceHold=true;
            if(!row.remoteSettled){if(row.runScope)row.runScope.evidenceHold=true;
              void audit(row,{kind:'CLEANUP_ONLY',...requestEvidence(row)}).catch(()=>{});}
            if(row.publication){row.publication.remoteSettled=true;row.publication.held=false;stages.delete(row.publication.id);}
            row.remoteSettled=true;row.held=false;release(row);
          }
          if(!physical.size)break;
        }
        if(!wait)throw new NativeCodingHostIpcError('PHYSICAL_CLEANUP_UNCONFIRMED');
        await waitChange();
      }
      return Object.freeze({schema:'metaengine.native-coding.physical-drain.v1',instance_id:instanceId,host_pid:hostPid,
        cleanup_confirmed:true,automatic_retry_allowed:false,authority_effect:false});
    })();
    if(!wait)return work;
    draining=work;const done=()=>{if(draining===work)draining=null;};work.then(done,done);return work;
  }
  function invoke(action,value,ownerScopeCallback=null,runScope=null) {
    if(child.connected!==true)stop('CHANNEL_CLOSED');
    if(closed||runScope?.fenced||runScope?.failed)return Promise.reject(new NativeCodingHostIpcError('CHANNEL_CLOSED'));
    if(physical.size>=maxInflight)return Promise.reject(new NativeCodingHostIpcError('INFLIGHT_LIMIT'));
    // Reserve the SAME existing physical ticket before UUID/digest/local intent.
    // Its entry survives both publication and original request stages.
    const ticketKey={},expiresMono=performance.now()+timeoutMs;
    physical.set(ticketKey,null);
    let frame;
    try{payload(action,value);frame={schema:NATIVE_CODING_HOST_IPC_REQUEST,instance_id:instanceId,host_pid:hostPid,request_id:randomUUID(),action,payload:structuredClone(value)};json(frame);}
    catch(error){physical.delete(ticketKey);return Promise.reject(new NativeCodingHostIpcError(REASONS.has(error.reason)?error.reason:'INVALID_PAYLOAD'));}
    const requestDigest=digest(frame);
    return new Promise((resolve,rejectPromise)=>{
      const row={id:frame.request_id,action,write:runScope?.published===true||writes(action,value),digest:requestDigest,resolve,reject:rejectPromise,timer:null,runScope,sendAttempted:false,expiresMono};
      if(ownerScopeCallback){
        if(!(action==='RESERVE_EXECUTION'||action===RUN_OWNER_READ||PENDING_OWNER_ACTIONS.includes(action)||action==='ACTIVATE_PREPARED_GOAL_V1')||typeof ownerScopeCallback!=='function'){physical.delete(ticketKey);rejectPromise(new NativeCodingHostIpcError('INVALID_PAYLOAD'));return;}
        row.ownerPhases=(action==='RESERVE_EXECUTION'?createPublicationOwnerClientPhases:action===RUN_OWNER_READ?createRunOwnerClientPhases:action==='ACTIVATE_PREPARED_GOAL_V1'?createPendingActivationClientPhases:createPendingOwnerClientPhases)({binding:{instance_id:instanceId,host_pid:hostPid,request_id:row.id,action,
          request_sha256:requestDigest,...(action==='RESERVE_EXECUTION'?{}:{body_sha256:value.headers['x-a2-device-body-sha256']})},callback:ownerScopeCallback,...(action==='RESERVE_EXECUTION'?{scope:value.scope}:{input:value.body.input}),
          assertLifetime:()=>{if(closed||child.connected!==true||child.pid!==hostPid||performance.now()>=row.expiresMono)throw new NativeCodingHostIpcError('CHANNEL_CLOSED');},
          send:phase=>{child.send(phase,error=>{if(error)stop('SEND_FAILED');});},
        });
      }
      row.timer=setTimeout(()=>{const current=take(row.id);if(current)reject(current,'REQUEST_TIMEOUT');},timeoutMs);
      physical.delete(ticketKey);pending.set(row.id,row);physical.set(row.id,row);stages.set(row.id,row);runScope?.rows.add(row);
      const unsent=()=>{
        if(row.sendAttempted)return;
        void audit(row,{kind:'UNSENT',...requestEvidence(row)}).catch(()=>{});row.remoteSettled=true;
        const current=take(row.id);if(current)reject(current,row.publication?.error?.reason||'CHANNEL_CLOSED',row.publication?.error?.effect_outcome==='UNKNOWN');release(row);change();
      };
      const send=()=>{
        if(closed||runScope?.fenced||runScope?.failed||child.connected!==true||!pending.has(row.id)){unsent();return;}
        row.write=writes(action,value);row.sendAttempted=true;
        try{child.send(frame,error=>{if(error)stop('SEND_FAILED');});}catch{stop('SEND_FAILED');}
      };
      const publishThenSend=async()=>{
        if(!runScope?.published){send();return;}
        if(closed||runScope.fenced||runScope.failed||!pending.has(row.id)){unsent();return;}
        const intent={binding:structuredClone(value.binding),request_id:row.id,request_sha256:row.digest,
          operation:value.operation,job_binding_sha256:digest(value.job_binding)};
        const publicationFrame={schema:NATIVE_CODING_HOST_IPC_REQUEST,instance_id:instanceId,host_pid:hostPid,
          request_id:randomUUID(),action:NATIVE_CALLBACK_PUBLICATION_ACTION,payload:intent};
        payload(publicationFrame.action,intent);json(publicationFrame);
        const publication={id:publicationFrame.request_id,action:publicationFrame.action,digest:digest(publicationFrame),
          write:true,ticket:row,intent,sendAttempted:false,resolve:value=>{publication.value=value;change();},
          reject:error=>{publication.error=error;change();}};
        row.publication=publication;pending.set(publication.id,publication);stages.set(publication.id,publication);
        publication.timer=setTimeout(()=>{const current=take(publication.id);if(current)reject(current,'REQUEST_TIMEOUT');},Math.max(1,row.expiresMono-performance.now()));
        publication.sendAttempted=true;
        try{child.send(publicationFrame,error=>{if(error)stop('SEND_FAILED');});}catch{stop('SEND_FAILED');}
        while(!publication.localDone||!publication.remoteSettled){
          if(closed||runScope.fenced||runScope.failed||publication.error||publication.held||!pending.has(row.id)){unsent();return;}
          await waitChange();
        }
        if(publication.error||publication.held||!publication.value){unsent();return;}
        send();
      };
      if(runScope)void audit(row,{kind:'INTENT',...requestEvidence(row),operation:value.operation,job_binding_sha256:digest(value.job_binding)}).then(publishThenSend,unsent).catch(unsent);
      else send();
    });
  }
  async function openAgentRunCustody({binding,journal}={},published=false){
    const pinned=structuredClone(validateNativeCodingAgentMcpBinding(binding));
    if(closed||runs.has(pinned.run_id))throw new NativeCodingHostIpcError('CHANNEL_CLOSED');
    const run={binding:pinned,published,writer:null,rows:new Set(),callbacks:new Set(),completedCallbacks:0,job:null,fenced:false,failed:false,evidenceHold:false,fenceWork:null,finishWork:null};
    runs.set(pinned.run_id,run);
    try{run.writer=await claimNativeRunCallbackJournal(journal,{binding:pinned,instanceId,hostPid});}
    catch{runs.delete(pinned.run_id);throw new NativeCodingHostIpcError('PHYSICAL_CLEANUP_UNCONFIRMED');}
    const fenceRun=()=>{
      if(run.fenceWork)return run.fenceWork;run.fenced=true;
      run.fenceWork=run.writer.append({kind:'FENCE'});run.fenceWork.catch(()=>{run.failed=true;});change();return run.fenceWork;
    };
    const trackCallback=operation=>{
      if(run.finishWork||typeof operation!=='function')return Promise.reject(new NativeCodingHostIpcError('CHANNEL_CLOSED'));
      const work=Promise.resolve().then(operation);run.callbacks.add(work);
      const done=()=>{run.callbacks.delete(work);run.completedCallbacks++;change();};work.then(done,done);return work;
    };
    if(closed){await fenceRun().catch(()=>{});runs.delete(pinned.run_id);throw new NativeCodingHostIpcError('CHANNEL_CLOSED');}
    return Object.freeze({
      agentOperation(request){
        try{validateNativeCodingAgentHostRequest(request);
          if(digest(request.binding)!==digest(pinned)||run.fenced||run.failed)throw Error();
          const job=digest(request.job_binding);if(run.job===null){if(request.operation!=='CHECK')throw Error();run.job=job;}
          else if(job!==run.job)throw Error();
        }catch{return Promise.reject(new NativeCodingHostIpcError('INVALID_PAYLOAD'));}
        return invoke('AGENT_OPERATION',request,null,run);
      },trackCallback,fence:fenceRun,
      finish(){
        if(run.finishWork)return run.finishWork;
        run.finishWork=(async()=>{
          await fenceRun().catch(()=>{});
          while(run.callbacks.size)await Promise.allSettled([...run.callbacks]);
          while(run.rows.size){
            if(transportLost||[...run.rows].some(row=>row.held)){
              // SAME existing cleanup-only owner, never starts Host shutdown.
              // Its witness can drain resources but cannot mint durable terminal evidence.
              try{await drainPhysical();}catch{/* Retain until original custody changes or explicit quit joins it. */}
            }
            if(run.rows.size)await waitChange();
          }
          if(!run.failed){try{
            await run.writer.append({kind:'CALLBACKS_JOINED',callbacks:run.completedCallbacks});
            if(!run.evidenceHold)await run.writer.candidate();
          }catch{run.failed=true;}}
          await run.writer.drain().catch(()=>{run.failed=true;});runs.delete(pinned.run_id);
          return Object.freeze({...run.writer.snapshot(),state:run.failed||run.evidenceHold?'HOLD':run.writer.snapshot().state});
        })();run.finishWork.catch(()=>{});return run.finishWork;
      },snapshot:()=>Object.freeze({schema:'metaengine.native-coding.run-callback-custody.v1',run_id:pinned.run_id,
        host_instance_id:instanceId,host_pid:hostPid,dispatch_fenced:run.fenced,callbacks:run.callbacks.size,requests:run.rows.size,
        durability_scope:'PROCESS_CRASH_ONLY',directory_durability:'DIRECTORY_DURABILITY_UNQUALIFIED',chain_root:'CHAIN_ROOT_UNANCHORED',
        state:run.failed||run.evidenceHold?'HOLD':'PENDING',lineage:'LINEAGE_UNBOUND',all_effects_cleanup:'UNCONFIRMED',authority_effect:false}),
    });
  }
  return Object.freeze({
    openAgentRunCustody:options=>openAgentRunCustody(options),
    // Source handoff path only. The default bridge gate remains closed and the
    // production Host does not mount a publisher until genuine custody exists.
    openPublishedAgentRunCustody:options=>openAgentRunCustody(options,true),
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
    reserveExecutionWithOwner:(scope,callback)=>typeof callback==='function'?invoke('RESERVE_EXECUTION',{scope},callback):Promise.reject(new NativeCodingHostIpcError('INVALID_PAYLOAD')),
    advanceExecution:(scope,transition)=>invoke('ADVANCE_EXECUTION',{scope,transition}),
    reconcileProject:project_id=>invoke('RECONCILE_PROJECT',{project_id}),
    readProjectCheckpoint:project_id=>invoke('READ_PROJECT_CHECKPOINT',{project_id}),
    readProjectRejection:selector=>invoke('READ_PROJECT_REJECTION',selector),
    agentOperation:request=>invoke('AGENT_OPERATION',request),
    finishCheckpoint:value=>invoke('FINISH_CHECKPOINT',value),
    readFinishCheckpoint:value=>invoke('READ_FINISH_CHECKPOINT',value),
    reconcileFinishCheckpoint:value=>invoke('RECONCILE_FINISH_CHECKPOINT',value),
    withRunOwnerScope:(value,callback)=>typeof callback==='function'?invoke(RUN_OWNER_READ,value,callback):Promise.reject(new NativeCodingHostIpcError('INVALID_PAYLOAD')),
    withPendingOwnerScope:(operation,value,callback)=>{
      if(!PENDING_OWNER_ACTIONS.includes(operation)||typeof callback!=='function')return Promise.reject(new NativeCodingHostIpcError('INVALID_PAYLOAD'));
      return invoke(operation,value,callback);
    },
    withPendingActivationScope:(value,callback)=>typeof callback==='function'?invoke('ACTIVATE_PREPARED_GOAL_V1',value,callback):Promise.reject(new NativeCodingHostIpcError('INVALID_PAYLOAD')),
    readPreparedGoalActivation:value=>invoke('READ_PREPARED_GOAL_ACTIVATION_V1',value),
    admitPreparedGoal:value=>invoke('ADMIT_PREPARED_GOAL_V1',value),readPreparedGoal:value=>invoke('READ_PREPARED_GOAL_V1',value),
    prepareWorkspace:value=>invoke('PREPARE_WORKSPACE_V1',value),readWorkspacePreparation:value=>invoke('READ_WORKSPACE_PREPARATION_V1',value),
    seedGoal:value=>invoke('SEED_GOAL',value),readSeed:value=>invoke('READ_SEED',value),listSeeds:value=>invoke('LIST_SEEDS',value),
    serviceHeartbeatV2:value=>invoke('SERVICE_HEARTBEAT_V2',value),readServiceHeartbeatV2:value=>invoke('READ_SERVICE_HEARTBEAT_V2',value),
    serviceHeartbeat:value=>invoke('SERVICE_HEARTBEAT',value),readServiceHeartbeat:value=>invoke('READ_SERVICE_HEARTBEAT',value),
    // Native callback only: never a renderer event or replacement permission.
    // Late subscribers observe the already-closed capability synchronously.
    onUnavailable(listener){
      if(typeof listener!=='function')throw new TypeError('native_coding_host_ipc_listener_required');
      if(closed){notify(listener);return()=>{};}
      unavailableListeners.add(listener);return()=>unavailableListeners.delete(listener);
    },
    readNativeCapacity:value=>invoke('READ_NATIVE_CAPACITY_V1',value),
    readNativeSetupRoute:value=>invoke('READ_NATIVE_SETUP_ROUTE_V1',value),
    discoverNativeSetup:value=>invoke('DISCOVER_NATIVE_SETUP_V1',value),beginNativeSetup:value=>invoke('BEGIN_NATIVE_SETUP_V1',value),
    readNativeSetup:value=>invoke('READ_NATIVE_SETUP_V1',value),cancelNativeSetup:value=>invoke('CANCEL_NATIVE_SETUP_V1',value),
    drainPhysical,
    close:()=>stop('CLIENT_CLOSED'),snapshot:()=>Object.freeze({instance_id:instanceId,host_pid:hostPid,inflight:pending.size,physical_inflight:physical.size,
      physical_cleanup_state:physical.size?(transportLost||[...physical.values()].some(row=>row.held)?'HOLD':'DRAINING'):'DRAINED',closed,automatic_retry_allowed:false}),
  });
}
