import net from 'node:net';
import {createHash,createHmac,timingSafeEqual,randomBytes,randomUUID} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const AGENT=/^agent_[a-z0-9-]{8,64}$/,SHA=/^[a-f0-9]{64}$/;
export const NATIVE_AGENT_MCP_TOOLS=Object.freeze(['project_overview','project_history_page','agent_send_message','agent_ack_message','project_propose_children','client_control_intent']);
const WRITES=new Set(NATIVE_AGENT_MCP_TOOLS.slice(2));
const SCHEMA='metaengine.native-coding.agent-mcp-channel.v1';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const keys=(x,required,optional=[])=>plain(x)&&required.every(key=>Object.hasOwn(x,key))&&Object.keys(x).every(key=>required.includes(key)||optional.includes(key));
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&!x.includes('\0');
const fail=reason=>{throw Error('native_agent_bridge_'+reason);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function canonical(value,depth=0){
  if(depth>16)fail('json_budget');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
  if(Array.isArray(value)){if(value.length>256)fail('json_budget');return '['+value.map(x=>canonical(x,depth+1)).join(',')+']';}
  if(!plain(value)||Object.keys(value).length>128)fail('json_type');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function nativeCodingAgentMcpIntentBodySha256(tool,args){
  if(!WRITES.has(tool))fail('write_tool_required');const body={...argumentsFor(tool,args)};delete body.request_id;
  return digest({tool,args:body});
}
const secretDigest=value=>createHash('sha256').update(value).digest('hex');
const proof=(capability,side,clientNonce,serverNonce)=>createHmac('sha256',capability)
  .update([SCHEMA,side,clientNonce,serverNonce].join(':')).digest('hex');
const proofMatches=(actual,expected)=>SHA.test(actual||'')&&timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
function publicValue(value,depth=0){
  if(depth>16)fail('json_budget');
  if(typeof value==='string'&&/(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\//i.test(value))fail('private_data');
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
    if(/^(?:dsn|database_url|connection_string|password|api_key|private_key|capability)$/i.test(key))fail('private_data');
    publicValue(child,depth+1);
  }
}
export function validateNativeCodingAgentMcpBinding(value){
  if(!keys(value,['run_id','workspace_id','project_id','task_id','lease_generation','agent_id','agent_generation_epoch','provider_id','role'])
    ||['run_id','workspace_id','project_id','task_id','provider_id'].some(key=>!UUID.test(value[key]||''))
    ||!AGENT.test(value.agent_id||'')||!['IMPLEMENTER','CRITIC'].includes(value.role)
    ||!integer(value.lease_generation,1,Number.MAX_SAFE_INTEGER)||!integer(value.agent_generation_epoch,1,Number.MAX_SAFE_INTEGER))fail('binding');
  return freeze(structuredClone(value));
}
function jobBinding(value){
  const incarnation=/^pid:([0-9]+):created_100ns:([0-9]{15,20})$/.exec(value?.process_incarnation_id||'');
  if(!keys(value,['job_id','pid','process_incarnation_id','executable_sha256'])||!UUID.test(value.job_id||'')
    ||!integer(value.pid,1,0xffffffff)||!incarnation||Number(incarnation[1])!==value.pid
    ||BigInt(incarnation[2])>18446744073709551615n||!SHA.test(value.executable_sha256||''))fail('job_binding');
  return freeze(structuredClone(value));
}
function argumentsFor(name,args){
  publicValue(args);canonical(args);
  if(name==='project_overview'){if(!keys(args,[],['after_seq','limit'])
    ||Object.hasOwn(args,'after_seq')&&!integer(args.after_seq,0,Number.MAX_SAFE_INTEGER)
    ||Object.hasOwn(args,'limit')&&!integer(args.limit,1,32))fail('arguments');}
  else if(name==='project_history_page'){
    if(!keys(args,['after_seq','limit'],['through_seq'])||!integer(args.after_seq,0,Number.MAX_SAFE_INTEGER)||!integer(args.limit,1,16)
      ||Object.hasOwn(args,'through_seq')&&!integer(args.through_seq,args.after_seq,Number.MAX_SAFE_INTEGER))fail('arguments');
  }else{
    if(!UUID.test(args?.request_id||''))fail('arguments');
    if(name==='agent_ack_message'&&(!keys(args,['request_id','message_seq'])||!integer(args.message_seq,1,Number.MAX_SAFE_INTEGER)))fail('arguments_invalid');
    if(name==='agent_send_message'&&(!keys(args,['request_id','target_agent_id','message'])||!AGENT.test(args.target_agent_id||'')
      ||!text(args.message,12000)||Buffer.byteLength(args.message)>8192))fail('arguments');
    if(name==='project_propose_children'&&(!keys(args,['request_id','children'])||!Array.isArray(args.children)||!args.children.length||args.children.length>16
      ||args.children.some(child=>!keys(child,['role','objective'])||!['IMPLEMENTER','CRITIC'].includes(child.role)||!text(child.objective,1000))))fail('arguments');
    if(name==='client_control_intent'){
      if(!keys(args,['request_id','action'],['relative_path'])||!['CLIENT_STATUS','OPEN_PROJECT_FILE','PREPARE_CLIENT_RESTART'].includes(args.action))fail('arguments');
      if(args.action==='OPEN_PROJECT_FILE'){
        if(!text(args.relative_path,500)||/^[\\/]|^[a-z]:/i.test(args.relative_path)||args.relative_path.split(/[\\/]/).some(part=>!part||part==='..'||part==='.')
          ||/[\x00-\x1f<>:"|?*]/.test(args.relative_path))fail('arguments');
      }else if(Object.hasOwn(args,'relative_path'))fail('arguments');
    }
  }
  return freeze(structuredClone(args));
}
export const validateNativeCodingAgentMcpArguments=argumentsFor;
function toolsFor(value,operations){
  if(!Array.isArray(value)||!value.length||value.length>NATIVE_AGENT_MCP_TOOLS.length||new Set(value).size!==value.length
    ||value.some(tool=>!NATIVE_AGENT_MCP_TOOLS.includes(tool)||typeof operations?.[tool]!=='function'))fail('tools');
  return Object.freeze([...value]);
}
function endpointValid(endpoint){
  return typeof endpoint==='string'&&(process.platform==='win32'?/^\\\\\.\\pipe\\METAENGINE-NativeMcp-[a-f0-9-]{36}$/.test(endpoint)
    :endpoint.startsWith('/')&&Buffer.byteLength(endpoint)<100&&!endpoint.includes('\0'));
}
function wire(socket,{maxFrameBytes,onFrame,onClose}){
  let pending=Buffer.alloc(0),ended=false;
  const close=()=>{if(ended)return;ended=true;pending=Buffer.alloc(0);socket.destroy();onClose?.();};
  const send=value=>{if(ended)return false;const bytes=JSON.stringify(value)+'\n';
    if(Buffer.byteLength(bytes)>maxFrameBytes||(socket.writableLength??0)>maxFrameBytes*4){close();return false;}socket.write(bytes);return true;};
  socket.on('data',chunk=>{
    if(ended)return;pending=Buffer.concat([pending,chunk]);let index;
    while((index=pending.indexOf(10))!==-1){const line=pending.subarray(0,index);pending=pending.subarray(index+1);
      if(!line.length||line.length>maxFrameBytes){close();return;}
      let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));canonical(value);}catch{close();return;}
      onFrame(value);if(ended)return;
    }
    if(pending.length>maxFrameBytes)close();
  });
  socket.once('error',close);socket.once('end',close);socket.once('close',close);
  return {send,close};
}
const unknown=(reason,write,requestId=null)=>({reason,effect_outcome:write?'UNKNOWN':'NONE',readback_required:write,
  automatic_retry_allowed:false,request_id:requestId});
const denied=(reason,requestId=null)=>({...unknown(reason,false,requestId),readback_required:false});

/** Private Host only. A capability selects a pre-registered scope; wire data never selects authority. */
export async function createNativeCodingAgentMcpBroker({endpoint,operations,assertInvocationAuthorized,readIntentReceipt=null,clock=()=>Date.now(),
  // CHECK and the actual operation each traverse the independently bounded
  // 30-second Host channel. This transport does not extend either proof TTL.
  timeoutMs=60000,maxInflight=16,maxRuns=128,maxIntents=256,maxConnections=32,maxFrameBytes=256*1024}={}){
  endpoint??=process.platform==='win32'?`\\\\.\\pipe\\METAENGINE-NativeMcp-${randomUUID()}`:null;
  if(!endpointValid(endpoint)||typeof assertInvocationAuthorized!=='function'||typeof clock!=='function'
    ||!integer(timeoutMs,1,60000)||!integer(maxInflight,1,16)||!integer(maxRuns,1,1024)||!integer(maxIntents,1,1024)
    ||!integer(maxConnections,1,64)||!integer(maxFrameBytes,1024,256*1024)
    ||readIntentReceipt!==null&&typeof readIntentReceipt!=='function')fail('composition');
  const handlers=Object.freeze(Object.fromEntries(NATIVE_AGENT_MCP_TOOLS.filter(name=>typeof operations?.[name]==='function').map(name=>[name,operations[name]])));
  const registry=new Map(),byRun=new Map(),sockets=new Set();let closed=false,fatal=false,inflight=0;
  function live(record){return !closed&&!fatal&&!record.revoked&&record.jobBinding!==null&&clock()<record.expiresAt;}
  function revoke(record){if(record.revoked)return;record.revoked=true;record.capability=null;clearTimeout(record.expiryTimer);
    for(const session of record.sessions)session.wire.close();
    for(const active of record.active)active.finish('RUN_REVOKED');}
  const server=net.createServer(socket=>{
    if(closed||sockets.size>=maxConnections){socket.destroy();return;}sockets.add(socket);
    const session={record:null,challenge:null,active:new Map(),wire:null};
    const authTimer=setTimeout(()=>session.wire.close(),2000);authTimer.unref();
    session.wire=wire(socket,{maxFrameBytes,onClose:()=>{
      clearTimeout(authTimer);sockets.delete(socket);session.record?.sessions.delete(session);
      for(const active of session.active.values())active.finish('CHANNEL_CLOSED');
    },onFrame:frame=>{
      if(!session.record){
        if(!session.challenge){
          if(!keys(frame,['schema','id','action','capability_id','client_nonce'])||frame.schema!==SCHEMA||frame.action!=='AUTHENTICATE'
            ||!UUID.test(frame.id||'')||!SHA.test(frame.capability_id||'')||!SHA.test(frame.client_nonce||'')){session.wire.close();return;}
          const record=registry.get(frame.capability_id);
          if(!record||!live(record)||record.sessions.size>=2){session.wire.close();return;}
          session.challenge={record,clientNonce:frame.client_nonce,serverNonce:randomBytes(32).toString('hex')};
          session.wire.send({schema:SCHEMA,id:frame.id,ok:true,value:{challenge:session.challenge.serverNonce}});return;
        }
        const {record,clientNonce,serverNonce}=session.challenge;
        if(!keys(frame,['schema','id','action','proof'])||frame.schema!==SCHEMA||frame.action!=='PROVE'
          ||!UUID.test(frame.id||'')||!live(record)||record.sessions.size>=2
          ||!proofMatches(frame.proof,proof(record.capability,'CLIENT',clientNonce,serverNonce))){session.wire.close();return;}
        clearTimeout(authTimer);session.record=record;record.sessions.add(session);
        session.wire.send({schema:SCHEMA,id:frame.id,ok:true,value:{binding:record.binding,allowed_tools:record.tools,
          timeout_ms:timeoutMs,expires_at:new Date(record.expiresAt).toISOString(),server_proof:proof(record.capability,'SERVER',clientNonce,serverNonce)}});
        session.challenge=null;return;
      }
      const record=session.record;
      if(!live(record)){revoke(record);return;}
      if(keys(frame,['schema','id','action'])&&frame.schema===SCHEMA&&frame.action==='CANCEL'&&UUID.test(frame.id||'')){
        session.active.get(frame.id)?.finish('REQUEST_CANCELLED');return;
      }
      if(!keys(frame,['schema','id','action','tool','args'])||frame.schema!==SCHEMA||frame.action!=='INVOKE'
        ||!UUID.test(frame.id||'')||!record.tools.includes(frame.tool)||session.active.has(frame.id)){session.wire.close();return;}
      let args;try{args=argumentsFor(frame.tool,frame.args);}catch{
        session.wire.send({schema:SCHEMA,id:frame.id,ok:false,error:denied('ARGUMENTS_DENIED',frame.args?.request_id??null)});return;}
      const write=WRITES.has(frame.tool),requestId=write?args.request_id:null,bodySha=digest({tool:frame.tool,args});
      const semanticSha=write?nativeCodingAgentMcpIntentBodySha256(frame.tool,args):null;
      let intent=write?record.intents.get(requestId):null,ownsIntent=false,cachedResponse=null;
      if(intent)cachedResponse=intent.bodySha!==bodySha?{ok:false,error:unknown('INTENT_BODY_CHANGED',true,requestId)}
        :intent.response??{ok:false,error:unknown('INTENT_READBACK_REQUIRED',true,requestId)};
      if(write&&!intent){
        const priorBody=record.unknownBodies.get(semanticSha);
        if(priorBody)cachedResponse={ok:false,error:{...unknown('INTENT_READBACK_REQUIRED',true,requestId),readback_request_id:priorBody.requestId}};
        else if(record.intents.size>=maxIntents)cachedResponse={ok:false,error:denied('INTENT_CAPACITY_FENCED',requestId)};
        else {
        intent={requestId,tool:frame.tool,bodySha,semanticSha,response:null,physicalPending:false};record.intents.set(requestId,intent);
        record.unknownBodies.set(semanticSha,intent);
        ownsIntent=true;
        }
      }
      if(inflight>=maxInflight){const response={ok:false,error:denied('INFLIGHT_LIMIT',requestId)};if(ownsIntent){intent.response=response;
        if(record.unknownBodies.get(intent.semanticSha)===intent)record.unknownBodies.delete(intent.semanticSha);}
        session.wire.send({schema:SCHEMA,id:frame.id,...response});return;}
      const controller=new AbortController();let settled=false,timer;
      const active={finish:reason=>complete({ok:false,error:unknown(reason,write,requestId)})};
      function complete(response){
        if(settled)return;settled=true;clearTimeout(timer);controller.abort();session.active.delete(frame.id);record.active.delete(active);
        if(ownsIntent){intent.response=response;
          if(response.ok&&record.unknownBodies.get(intent.semanticSha)===intent)record.unknownBodies.delete(intent.semanticSha);}
        session.wire.send({schema:SCHEMA,id:frame.id,...response});
      }
      session.active.set(frame.id,active);record.active.add(active);inflight++;
      const context=Object.freeze({binding:record.binding,jobBinding:record.jobBinding,tool:frame.tool,request_id:requestId,
        arguments_sha256:bodySha,intent_body_sha256:semanticSha,signal:controller.signal});
      timer=setTimeout(()=>active.finish('HOST_OPERATION_TIMEOUT'),timeoutMs);
      if(ownsIntent)intent.physicalPending=true;
      void(async()=>{
        try{
          // Called for EVERY invocation, including reads, after resolving the private capability.
          await assertInvocationAuthorized(context);
          if(!live(record)||controller.signal.aborted)fail('revoked');
          if(cachedResponse){complete(cachedResponse);return;}
          const value=await handlers[frame.tool](args,context);
          if(!live(record)||controller.signal.aborted)fail('revoked');
          if(!plain(value))fail('result_type');publicValue(value);canonical(value);
          if(Buffer.byteLength(JSON.stringify(value))>maxFrameBytes-1024)fail('output_budget');
          if(write&&(value.effect_outcome==='UNKNOWN'||value.readback_required===true||['UNKNOWN','READBACK_REQUIRED'].includes(value.state))){
            active.finish('HOST_READBACK_REQUIRED');return;}
          complete({ok:true,value});
        }catch{active.finish('HOST_OPERATION_UNCONFIRMED');}
        finally{if(ownsIntent)intent.physicalPending=false;inflight--;}
      })();
    }});
  });
  // Reject startup errors without publishing any token or accepting a shadowed endpoint.
  await new Promise((resolve,reject)=>{const error=()=>reject(Error('native_agent_bridge_listen_failed'));
    server.once('error',error);server.listen(endpoint,()=>{server.off('error',error);resolve();});});
  server.on('error',()=>{fatal=true;for(const record of registry.values())revoke(record);});
  return Object.freeze({
    issueRun({binding,jobBinding:job=null,expiresAt,allowedTools=['project_overview','project_history_page']}={}){
      if(closed||fatal||registry.size>=maxRuns)fail('registry_fenced');const scope=validateNativeCodingAgentMcpBinding(binding),nativeJob=job===null?null:jobBinding(job);
      const expiry=typeof expiresAt==='number'?expiresAt:Date.parse(expiresAt);
      if(byRun.has(scope.run_id)||!Number.isFinite(expiry)||expiry<=clock()||expiry-clock()>1800000)fail('run_registration');
      const tools=toolsFor(allowedTools,handlers),capability=randomBytes(32).toString('hex');
      const record={binding:scope,jobBinding:nativeJob,tools,capability,expiresAt:expiry,revoked:false,sessions:new Set(),active:new Set(),intents:new Map(),unknownBodies:new Map()};
      record.expiryTimer=setTimeout(()=>revoke(record),Math.max(1,expiry-clock()));record.expiryTimer.unref();
      registry.set(secretDigest(capability),record);byRun.set(scope.run_id,record);
      const descriptor={endpoint,binding:scope,allowedTools:tools,expiresAt:new Date(expiry).toISOString()};
      Object.defineProperty(descriptor,'capability',{value:capability,enumerable:false});return Object.freeze(descriptor);
    },
    bindRun(runId,job){const record=byRun.get(runId),nativeJob=jobBinding(job);
      if(closed||fatal||!record||record.revoked||record.jobBinding!==null||clock()>=record.expiresAt)fail('job_binding_denied');
      record.jobBinding=nativeJob;return true;},
    async reconcileIntent(runId,requestId){
      const record=byRun.get(runId),intent=record?.intents.get(requestId);
      if(typeof readIntentReceipt!=='function'||!record||!live(record)||!intent||intent.physicalPending||inflight>=maxInflight)fail('readback_denied');
      const controller=new AbortController();let timer,rejectStop;inflight++;
      const stopped=new Promise((_,reject)=>{rejectStop=reject;});
      const active={finish:()=>{controller.abort();rejectStop(Error('native_agent_bridge_readback_revoked'));}};record.active.add(active);
      const context=Object.freeze({binding:record.binding,jobBinding:record.jobBinding,tool:intent.tool,request_id:requestId,
        arguments_sha256:intent.bodySha,intent_body_sha256:intent.semanticSha,readback_only:true,signal:controller.signal});
      const work=(async()=>{
        await assertInvocationAuthorized(context);if(!live(record)||controller.signal.aborted)fail('readback_denied');
        const receipt=await readIntentReceipt(context);
        if(!live(record)||controller.signal.aborted||!keys(receipt,['schema','run_id','tool','request_id','intent_body_sha256','state','result','authority_effect'])
          ||receipt.schema!=='metaengine.native-coding.agent-tool-receipt.v1'||receipt.run_id!==runId||receipt.tool!==intent.tool
          ||receipt.request_id!==requestId||receipt.intent_body_sha256!==intent.semanticSha
          ||!['CONFIRMED','NO_EFFECT'].includes(receipt.state)||receipt.authority_effect!==false||!plain(receipt.result))fail('readback_denied');
        publicValue(receipt.result);canonical(receipt.result);if(Buffer.byteLength(JSON.stringify(receipt.result))>maxFrameBytes-1024)fail('output_budget');
        intent.response={ok:true,value:freeze(structuredClone(receipt.result))};
        if(record.unknownBodies.get(intent.semanticSha)===intent)record.unknownBodies.delete(intent.semanticSha);
        return Object.freeze({state:receipt.state,run_id:runId,request_id:requestId,intent_body_sha256:intent.semanticSha,authority_effect:false});
      })();
      work.catch(()=>{}).finally(()=>{inflight--;});
      try{return await Promise.race([work,stopped,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('native_agent_bridge_readback_unknown'));},timeoutMs);})]);}
      finally{record.active.delete(active);clearTimeout(timer);controller.abort();}
    },
    revokeRun(runId){const record=byRun.get(runId);if(record)revoke(record);return Boolean(record);},
    snapshot:()=>({closed,fatal,runs:registry.size,connections:sockets.size,inflight,
      active_runs:[...registry.values()].filter(live).length,authority_effect:false}),
    async close(){if(closed)return;closed=true;for(const record of registry.values())revoke(record);
      for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
  });
}

/** Trusted stdio process only; no transparent reconnect or automatic invocation retry. */
export async function connectNativeCodingAgentMcpBroker({endpoint,capability,timeoutMs=65000,maxFrameBytes=256*1024}={}){
  if(!endpointValid(endpoint)||!SHA.test(capability||'')||!integer(timeoutMs,1,65000)||!integer(maxFrameBytes,1024,256*1024))fail('connection');
  const socket=net.createConnection(endpoint),pending=new Map();let closed=false,resolveCompletion;
  const completion=new Promise(resolve=>{resolveCompletion=resolve;});
  const channel=wire(socket,{maxFrameBytes,onFrame:frame=>{
    if(!keys(frame,['schema','id','ok'],['value','error'])||frame.schema!==SCHEMA||!UUID.test(frame.id||'')||typeof frame.ok!=='boolean'
      ||(frame.ok?!Object.hasOwn(frame,'value')||Object.hasOwn(frame,'error'):!Object.hasOwn(frame,'error')||Object.hasOwn(frame,'value'))){channel.close();return;}
    const item=pending.get(frame.id);if(!item){channel.close();return;}pending.delete(frame.id);clearTimeout(item.timer);item.cleanup();
    if(frame.ok)item.resolve(frame.value);else item.reject(Error('native_agent_bridge_host_unconfirmed'));
  },onClose:()=>{closed=true;for(const item of pending.values()){clearTimeout(item.timer);item.cleanup();item.reject(Error('native_agent_bridge_channel_closed'));}pending.clear();resolveCompletion();}});
  function request(value,signal){
    if(closed||signal?.aborted||pending.size>=16)return Promise.reject(Error('native_agent_bridge_request_denied'));
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const abort=()=>{const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);item.cleanup();
        channel.send({schema:SCHEMA,id,action:'CANCEL'});reject(Error('native_agent_bridge_request_unknown'));};
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const timer=setTimeout(abort,timeoutMs);pending.set(id,{resolve,reject,timer,cleanup});signal?.addEventListener('abort',abort,{once:true});
      if(!channel.send({schema:SCHEMA,id,...value})){pending.delete(id);clearTimeout(timer);cleanup();reject(Error('native_agent_bridge_channel_closed'));}
    });
  }
  // Mutual nonce-bound HMAC authentication: the capability itself never goes on
  // the pipe, and a shadowed pipe cannot impersonate the Host to the entrypoint.
  let hello,serverNonce;const clientNonce=randomBytes(32).toString('hex');
  try{const challenge=await request({action:'AUTHENTICATE',capability_id:secretDigest(capability),client_nonce:clientNonce});
    if(!keys(challenge,['challenge'])||!SHA.test(challenge.challenge||''))fail('challenge');serverNonce=challenge.challenge;
    hello=await request({action:'PROVE',proof:proof(capability,'CLIENT',clientNonce,serverNonce)});
  }catch{channel.close();fail('authentication_failed');}
  if(!keys(hello,['binding','allowed_tools','timeout_ms','expires_at','server_proof'])||!Array.isArray(hello.allowed_tools)
    ||hello.allowed_tools.some(name=>!NATIVE_AGENT_MCP_TOOLS.includes(name))||!integer(hello.timeout_ms,1,60000)
    ||!Number.isFinite(Date.parse(hello.expires_at))||!proofMatches(hello.server_proof,proof(capability,'SERVER',clientNonce,serverNonce))){channel.close();fail('handshake');}
  const binding=validateNativeCodingAgentMcpBinding(hello.binding);
  return Object.freeze({binding,allowedTools:Object.freeze([...hello.allowed_tools]),timeoutMs:hello.timeout_ms,completion,
    async invoke(tool,args,{signal}={}){if(!hello.allowed_tools.includes(tool))fail('tool_denied');
      return request({action:'INVOKE',tool,args:argumentsFor(tool,args)},signal);},
    close:()=>channel.close(),snapshot:()=>({closed,inflight:pending.size,authority_effect:false})});
}
