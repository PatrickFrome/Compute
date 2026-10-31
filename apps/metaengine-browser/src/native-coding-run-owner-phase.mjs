// Additive fixed READ-only facet on the ORIGINAL Phase1B request/channel.
// Original pending Owner/activation wire contracts remain unchanged.
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {sealedOwnerDigestW74} from './host-owner-genesis-custody-w74.mjs';
export const RUN_OWNER_READ='READ_RUN_OWNER_CUSTODY_V1';
export const RUN_OWNER_PHASE='metaengine.native-coding.run-owner-phase.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const BIRTH=/^pid:([1-9][0-9]*):created_100ns:[1-9][0-9]{16,18}$/;
const BINDING=['instance_id','host_pid','request_id','action','request_sha256','body_sha256'];
const EXECUTION=['workspace_id','task_id','lease_generation','agent_id','target_id','agent_generation_epoch','host_incarnation','scope_sha256','reservation_id'];
const OWNER=['schema','source','owner_id','device_id','project_id','pid','created_at','process_incarnation_id','epoch','generation','source_sha','device_key_fingerprint_sha256','observed_at','authority_effect','pending_custody'];
const fail=()=>{throw Error('native_run_owner_phase_invalid');};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).sort().join('|')===[...k].sort().join('|');
const same=(a,b)=>json(a)===json(b),date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const integer=v=>Number.isSafeInteger(v)&&v>0;
const clone=v=>Object.freeze(structuredClone(v));
export function validateRunOwnerReadInput(v){
  const s=v?.scope;
  if(!exact(v,['scope'])||!exact(s,EXECUTION)||![s.workspace_id,s.task_id,s.reservation_id].every(x=>UUID.test(x||''))
    ||![s.lease_generation,s.agent_generation_epoch].every(integer)||!/^agent_[a-z0-9-]{8,64}$/.test(s.agent_id||'')
    ||!/^codex-cli:[a-f0-9-]{36}$/.test(s.target_id||'')||!BIRTH.test(s.host_incarnation||'')||!HASH.test(s.scope_sha256||''))fail();
  return clone(v);
}
export function runOwnerControl(v){
  if(!exact(v,['workspace_id','generation_floor','refill_enabled','supervisor_admission_enabled','reset_at','updated_at'])
    ||!UUID.test(v.workspace_id||'')||!Number.isSafeInteger(v.generation_floor)||v.generation_floor<0
    ||v.refill_enabled!==true||v.supervisor_admission_enabled!==true||v.reset_at!==null&&!date(v.reset_at)||!date(v.updated_at))fail();
  return clone(v);
}
export function runOwnerScope(v){
  if(!exact(v,['schema','execution','device','project_id','root_task_id','activation_id','sealed_owner_sha256','artifact','control','observed_at'])
    ||v.schema!=='metaengine.native-coding.run-owner-scope.v1')fail();
  validateRunOwnerReadInput({scope:v.execution});runOwnerControl(v.control);
  const d=v.device,a=v.artifact;
  if(!exact(d,['device_id','client_id','key_fingerprint_sha256','admin_grant_epoch'])
    ||![d.device_id,d.client_id,v.project_id,v.root_task_id,v.activation_id].every(x=>UUID.test(x||''))
    ||!HASH.test(d.key_fingerprint_sha256||'')||!integer(d.admin_grant_epoch)||!HASH.test(v.sealed_owner_sha256||'')
    ||!date(v.observed_at)||v.control.workspace_id!==v.execution.workspace_id||v.execution.agent_generation_epoch<v.control.generation_floor
    ||!exact(a,['installed_exe_sha256','installed_asar_sha256','runtime_bundle_sha256','source_sha','cli_executable_sha256'])
    ||!Object.entries(a).every(([k,x])=>(k==='source_sha'?SHA:HASH).test(x||'')))fail();
  return clone(v);
}
export function runOwnerEvidence(v,rawScope){
  const s=runOwnerScope(rawScope),o=v?.sealed_record,p=o?.pending_custody,a=v?.source;
  if(!exact(v,['schema','sealed_record','sealed_sha256','observed_at','source','authority_effect'])
    ||v.schema!=='metaengine.host.run-owner-read-evidence.v1'||v.authority_effect!==false||!date(v.observed_at)
    ||!exact(o,OWNER)||o.schema!=='metaengine.host.owner-incarnation.v1'||o.source!=='LOCAL_HOST_OWNER'||o.authority_effect!==false
    ||o.owner_id!==s.device.client_id||o.device_id!==s.device.device_id||o.project_id!==s.project_id||o.epoch!==s.device.admin_grant_epoch
    ||o.device_key_fingerprint_sha256!==s.device.key_fingerprint_sha256||o.source_sha!==s.artifact.source_sha
    ||!integer(o.generation)||!integer(o.pid)||Number(BIRTH.exec(o.process_incarnation_id||'')?.[1])!==o.pid
    ||o.process_incarnation_id!==s.execution.host_incarnation||!date(o.created_at)||!date(o.observed_at)
    ||!exact(p,['schema','installed_exe_sha256','package_code_sha256','proof_identity','guardian_enrollment_evidence_sha256','loaded_runtime_code_attested'])
    ||p.schema!=='metaengine.host.pending-owner-native-custody.v1'||p.loaded_runtime_code_attested!==false
    ||p.installed_exe_sha256!==s.artifact.installed_exe_sha256
    ||!['package_code_sha256','proof_identity','guardian_enrollment_evidence_sha256'].every(k=>HASH.test(p[k]||''))
    ||!exact(a,['source_sha','installed_exe_sha256','package_code_sha256','proof_identity','loaded_runtime_code_attested','production_qualified'])
    ||a.source_sha!==o.source_sha||a.installed_exe_sha256!==p.installed_exe_sha256||a.package_code_sha256!==p.package_code_sha256
    ||a.proof_identity!==p.proof_identity||a.loaded_runtime_code_attested!==false||a.production_qualified!==false
    ||v.sealed_sha256!==s.sealed_owner_sha256||sealedOwnerDigestW74(o)!==s.sealed_owner_sha256)fail();
  return clone(v);
}
export function runOwnerReadResult(evidence,rawScope){
  const scope=runOwnerScope(rawScope),e=runOwnerEvidence(evidence,scope),o=e.sealed_record;
  return Object.freeze({schema:'metaengine.native-coding.run-owner-read-result.v1',state:'OWNER_RECORD_BOUND_SOURCE_ONLY',
    sealed_owner_sha256:e.sealed_sha256,owner_identity_sha256:sha(Object.fromEntries(OWNER.filter(k=>!['observed_at','pending_custody'].includes(k)).map(k=>[k,o[k]]))),
    execution_scope_sha256:sha(scope.execution),control_sha256:sha(scope.control),observed_at:e.observed_at,
    qualification:{custody:'W74_CURRENT',source:'SIGNED_ON_DISK',loaded_runtime_code_attested:false,production_qualified:false,execution_ready:false},
    send_capability:false,automatic_retry_allowed:false,authority_effect:false});
}
const immutableScope=v=>({...v,observed_at:null});
const STANDALONE=Object.freeze({schema:RUN_OWNER_PHASE,keys:BINDING,valid:v=>v.action===RUN_OWNER_READ});
function binding(v,protocol=STANDALONE){
  if(!exact(v,protocol.keys)||!protocol.valid(v)||![v.instance_id,v.request_id].every(x=>UUID.test(x||''))
    ||!integer(v.host_pid)||!HASH.test(v.request_sha256||'')
    ||protocol===STANDALONE&&!HASH.test(v.body_sha256||''))fail();return clone(v);
}
const frame=(b,sequence,phase,value,protocol=STANDALONE)=>({schema:protocol.schema,...b,sequence,phase,value});
function validate(v,b,protocol=STANDALONE){
  if(!exact(v,['schema',...protocol.keys,'sequence','phase','value'])||v.schema!==protocol.schema||protocol.keys.some(k=>v[k]!==b[k])
    ||!Number.isSafeInteger(v.sequence)||v.sequence<0||v.sequence>4||Buffer.byteLength(json(v))>16384)fail();
}
const empty=v=>{if(!exact(v,[]))fail();};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});promise.catch(()=>{});return{promise,resolve,reject};};
export function createRunOwnerHostPhases(options={}){return createOwnerHostRound(options,STANDALONE);}
function createOwnerHostRound({binding:raw,send,signal}={},protocol){
  const b=binding(raw,protocol);let closed=false,started=false,waiting=null,inProgress=false,sequence=0,reads=0,verified=null;
  const open=()=>{if(closed||signal?.aborted)fail();};
  const close=()=>{closed=true;waiting?.reject(Error('native_run_owner_phase_closed'));waiting=null;};
  signal?.addEventListener('abort',close,{once:true});
  function receive(message,handle){
    if(message?.schema!==protocol.schema||message.request_id!==b.request_id)return false;
    try{open();validate(message,b,protocol);if(handle||!started||inProgress||!waiting||message.sequence!==sequence+1)fail();
      const gate=waiting;waiting=null;inProgress=true;gate.resolve(message);
    }catch{close();}return true;
  }
  async function run(initial,handlers){
    open();if(started)fail();started=true;const fixed=runOwnerScope(initial);
    const check=async()=>{const current=runOwnerScope(await handlers.readScope());open();if(!same(immutableScope(fixed),immutableScope(current)))fail();return current;};
    try{
      let next=deferred();waiting=next;send(frame(b,0,'LOCKED',fixed,protocol));
      for(;;){const m=await next.promise;open();sequence=m.sequence;let result={};
        if(m.phase==='ABORT'){empty(m.value);fail();}
        if(m.phase==='RECHECK_SCOPE'){empty(m.value);if(reads||verified)fail();result=await check();reads++;}
        else if(m.phase==='VERIFY_OWNER'){
          if(reads!==1||verified)fail();const evidence=runOwnerEvidence(m.value,fixed);
          await check();await handlers.verifyOwner(evidence);open();verified=evidence;
        }else if(m.phase==='RELEASE'){
          empty(m.value);if(reads!==1||!verified)fail();await check();return runOwnerReadResult(verified,fixed);
        }else fail();
        open();next=deferred();waiting=next;inProgress=false;send(frame(b,sequence,'ACK',result,protocol));
      }
    }finally{close();signal?.removeEventListener('abort',close);}
  }
  return Object.freeze({receive,run,close});
}
export function createRunOwnerClientPhases(options={}){return createOwnerClientRound(options,STANDALONE);}
function createOwnerClientRound({binding:raw,send,callback,assertLifetime,input,onFailure=null}={},protocol){
  const b=binding(raw,protocol),expected=validateRunOwnerReadInput(input);if(typeof callback!=='function'||typeof assertLifetime!=='function')fail();
  let closed=false,started=false,sequence=0,waiting=null,waitingPhase=null,scope=null,work=Promise.resolve(),released=false,reads=0,verified=null;
  const abort=new AbortController();
  const open=()=>{if(closed)fail();assertLifetime();};
  function close(){closed=true;abort.abort();waiting?.reject(Error('native_run_owner_phase_closed'));waiting=null;}
  function transmit(phase,value){open();if(waiting||released)fail();sequence++;if(sequence>4)fail();const gate=deferred();waiting=gate;waitingPhase=phase;
    try{send(frame(b,sequence,phase,value,protocol));}catch{onFailure?.();close();}return gate.promise;}
  function receive(message,handle){
    if(message?.schema!==protocol.schema||message.request_id!==b.request_id)return false;
    try{open();validate(message,b,protocol);if(handle)fail();
      if(message.phase==='LOCKED'){
        if(started||message.sequence!==0)fail();started=true;scope=runOwnerScope(message.value);if(!same(scope.execution,expected.scope))fail();const fixed=scope;
        const tx=Object.freeze({signal:abort.signal,assertOpen:open,runOwner:fixed,
          readAuthenticatedAdmin:async()=>{open();return {...scope.device,access_tier:'ADMIN',admin_ready:true};},
          readScope:async()=>{
            if(reads||verified)fail();const current=runOwnerScope(await transmit('RECHECK_SCOPE',{}));
            if(!same(immutableScope(fixed),immutableScope(current)))fail();scope=current;reads++;
            return {...current.device,project_id:current.project_id,observed_at:current.observed_at};
          },
          verifyOwnerRecord:async value=>{if(reads!==1||verified)fail();const evidence=runOwnerEvidence(value,fixed);await transmit('VERIFY_OWNER',evidence);verified=evidence;},
        });
        work=Promise.resolve().then(()=>callback(tx)).then(value=>{
          open();if(!value||waiting||reads!==1||!verified||!same(value,verified))fail();sequence++;released=true;send(frame(b,sequence,'RELEASE',{},protocol));
        }).catch(()=>{if(!closed&&!released){try{sequence++;send(frame(b,sequence,'ABORT',{},protocol));}catch{}}onFailure?.();close();});
      }else{
        if(!started||!waiting||message.phase!=='ACK'||message.sequence!==sequence)fail();
        if(waitingPhase==='RECHECK_SCOPE')runOwnerScope(message.value);else empty(message.value);
        const gate=waiting;waiting=null;waitingPhase=null;gate.resolve(message.value);
      }
    }catch{onFailure?.();close();}return true;
  }
  async function finish(value){
    if(!released){onFailure?.();close();await work;fail();}await work;open();
    if(!verified||!same(value,runOwnerReadResult(verified,scope)))fail();close();return value;
  }
  return Object.freeze({receive,finish,close,drain:()=>work});
}

// Additive read-only cycles on an existing execution/publication ticket. These
// frames bind the actual parent frame digest, not an invented signed body.
// This is not mounted by default and grants no worker/publication authority.
export const PUBLICATION_OWNER_PHASE='metaengine.native-coding.publication-owner-phase.v1';
const PUBLICATION_BINDING=['instance_id','host_pid','request_id','action','request_sha256'];
const OWNER_READ_BUDGET=Object.freeze({RESERVE_EXECUTION:6,PUBLISH_RUN_CALLBACK_V1:6,AGENT_OPERATION:3});
const PUBLICATION_ROUND=Object.freeze({schema:PUBLICATION_OWNER_PHASE,keys:[...PUBLICATION_BINDING,'cycle'],
  valid:v=>Object.hasOwn(OWNER_READ_BUDGET,v.action)&&integer(v.cycle)&&v.cycle<=OWNER_READ_BUDGET[v.action]});
function publicationBinding(raw){
  if(!exact(raw,PUBLICATION_BINDING))fail();
  binding({...raw,cycle:1},PUBLICATION_ROUND);return clone(raw);
}
const cycleFrame=(b,cycle,phase,value={})=>frame({...b,cycle},4,phase,value,PUBLICATION_ROUND);
function publicationFrame(message,b){
  if(!integer(message?.cycle)||message.cycle>OWNER_READ_BUDGET[b.action])fail();
  validate(message,{...b,cycle:message.cycle},PUBLICATION_ROUND);
}
export function createPublicationOwnerHostPhases({binding:raw,send,signal,assertLifetime}={}){
  const b=publicationBinding(raw);if(typeof send!=='function'||typeof assertLifetime!=='function')fail();
  let closed=false,cycle=0,active=null,release=null;
  const open=()=>{if(closed||signal?.aborted)fail();assertLifetime();};
  function close(){closed=true;active?.close();release?.reject(Error('native_publication_owner_closed'));release=null;signal?.removeEventListener('abort',close);}
  function abortPeer(){if(!closed&&cycle){try{send(cycleFrame(b,cycle,'CYCLE_ABORT'));}catch{}}close();}
  signal?.addEventListener('abort',close,{once:true});
  function receive(message,handle){
    if(message?.schema!==PUBLICATION_OWNER_PHASE||message.request_id!==b.request_id)return false;
    try{open();publicationFrame(message,b);if(handle||!active||message.cycle!==cycle)fail();
      if(message.phase==='CYCLE_ABORT'){if(message.sequence!==4)fail();empty(message.value);close();}
      else if(message.phase==='CYCLE_RELEASED'){
        if(!release||message.sequence!==4)fail();empty(message.value);
        const gate=release;release=null;gate.resolve();
      }else{if(release)fail();active.receive(message,handle);}
    }catch{abortPeer();}return true;
  }
  async function run(initial,handlers){
    open();if(active||cycle>=OWNER_READ_BUDGET[b.action])fail();cycle++;
    const round=createOwnerHostRound({binding:{...b,cycle},send,signal},PUBLICATION_ROUND);active=round;
    try{
      const value=await round.run(initial,handlers);open();
      const gate=deferred();release=gate;send(cycleFrame(b,cycle,'CYCLE_RESULT',value));
      await gate.promise;open();return value;
    }catch(error){abortPeer();throw error;}finally{round.close();active=null;}
  }
  function finish(){open();if(active||cycle!==OWNER_READ_BUDGET[b.action])fail();close();}
  return Object.freeze({receive,run,finish,close,started:()=>cycle>0});
}
export function createPublicationOwnerClientPhases({binding:raw,send,callback,assertLifetime,scope:expected}={}){
  const b=publicationBinding(raw);if(typeof send!=='function'||typeof callback!=='function'||typeof assertLifetime!=='function')fail();
  // RESERVE has no reservation ID yet. Match every existing scope field, then
  // bind the actual first reservation ID for every subsequent read cycle.
  const expectedKeys=b.action==='RESERVE_EXECUTION'?EXECUTION.filter(k=>k!=='reservation_id'):EXECUTION;
  if(!exact(expected,expectedKeys))fail();expected=structuredClone(expected);
  let closed=false,cycle=0,active=null,execution=null,finishing=false;
  const pending=new Set();
  const open=()=>{if(closed)fail();assertLifetime();};
  function close(){closed=true;active?.close();}
  function abortPeer(failedCycle=cycle){if(!closed&&integer(failedCycle)&&failedCycle<=OWNER_READ_BUDGET[b.action]){try{send(cycleFrame(b,failedCycle,'CYCLE_ABORT'));}catch{}}close();}
  function track(p){pending.add(p);p.finally(()=>pending.delete(p)).catch(()=>{});return p;}
  function receive(message,handle){
    if(message?.schema!==PUBLICATION_OWNER_PHASE||message.request_id!==b.request_id)return false;
    try{open();publicationFrame(message,b);if(handle)fail();
      if(message.phase==='CYCLE_ABORT'){if(message.cycle!==cycle||message.sequence!==4)fail();empty(message.value);close();}
      else if(message.phase==='LOCKED'){
        if(active||finishing||message.cycle!==cycle+1||message.sequence!==0)fail();
        const scope=runOwnerScope(message.value);
        if(expectedKeys.some(k=>scope.execution[k]!==expected[k])||execution&&!same(execution,scope.execution))fail();
        execution=scope.execution;cycle=message.cycle;
        active=createOwnerClientRound({binding:{...b,cycle},send,callback,assertLifetime:open,input:{scope:execution},onFailure:()=>abortPeer()},PUBLICATION_ROUND);
        active.receive(message);track(active.drain());
      }else if(message.phase==='CYCLE_RESULT'){
        if(!active||finishing||message.cycle!==cycle||message.sequence!==4)fail();
        finishing=true;const round=active,current=cycle;
        track(round.finish(message.value).then(()=>{
          open();active=null;finishing=false;send(cycleFrame(b,current,'CYCLE_RELEASED'));
        }).catch(()=>{abortPeer();}));
      }else{
        if(!active||finishing||message.cycle!==cycle)fail();active.receive(message);
      }
    }catch{abortPeer(!active&&message.phase==='LOCKED'&&message.cycle===cycle+1?cycle+1:cycle);}return true;
  }
  async function drain(){while(pending.size)await Promise.allSettled([...pending]);}
  async function finish(value){
    await drain();open();
    // An actual duplicate reserve legitimately performs zero fresh Owner reads.
    // This projection remains historical readback, never a publication handle.
    const e=value?.execution;
    const readback=b.action==='RESERVE_EXECUTION'&&cycle===0&&!active&&!finishing
      &&exact(value,['state','execution','automatic_retry_allowed','authority_effect'])
      &&value.state==='READBACK_ONLY'&&value.automatic_retry_allowed===false&&value.authority_effect===false
      &&(e===null||e&&typeof e==='object'&&!Array.isArray(e)
        &&e.workspace_id===expected.workspace_id&&e.task_id===expected.task_id&&Number(e.lease_generation)===expected.lease_generation
        &&e.automatic_retry_allowed===false&&e.authority_effect===false
        &&['RESERVED','ATTEMPTED','RESULT_READY','FAILED','AMBIGUOUS','CHECKPOINTED'].includes(e.state));
    if(!readback&&(active||finishing||cycle!==OWNER_READ_BUDGET[b.action]))fail();close();return value;
  }
  return Object.freeze({receive,finish,close,drain});
}
