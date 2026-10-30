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
function binding(v){
  if(!exact(v,BINDING)||v.action!==RUN_OWNER_READ||![v.instance_id,v.request_id].every(x=>UUID.test(x||''))
    ||!integer(v.host_pid)||![v.request_sha256,v.body_sha256].every(x=>HASH.test(x||'')))fail();return clone(v);
}
const frame=(b,sequence,phase,value)=>({schema:RUN_OWNER_PHASE,...b,sequence,phase,value});
function validate(v,b){
  if(!exact(v,['schema',...BINDING,'sequence','phase','value'])||v.schema!==RUN_OWNER_PHASE||BINDING.some(k=>v[k]!==b[k])
    ||!Number.isSafeInteger(v.sequence)||v.sequence<0||v.sequence>4||Buffer.byteLength(json(v))>16384)fail();
}
const empty=v=>{if(!exact(v,[]))fail();};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});promise.catch(()=>{});return{promise,resolve,reject};};
export function createRunOwnerHostPhases({binding:raw,send,signal}={}){
  const b=binding(raw);let closed=false,started=false,waiting=null,inProgress=false,sequence=0,reads=0,verified=null;
  const open=()=>{if(closed||signal?.aborted)fail();};
  const close=()=>{closed=true;waiting?.reject(Error('native_run_owner_phase_closed'));waiting=null;};
  signal?.addEventListener('abort',close,{once:true});
  function receive(message,handle){
    if(message?.schema!==RUN_OWNER_PHASE||message.request_id!==b.request_id)return false;
    try{open();validate(message,b);if(handle||!started||inProgress||!waiting||message.sequence!==sequence+1)fail();
      const gate=waiting;waiting=null;inProgress=true;gate.resolve(message);
    }catch{close();}return true;
  }
  async function run(initial,handlers){
    open();if(started)fail();started=true;const fixed=runOwnerScope(initial);
    const check=async()=>{const current=runOwnerScope(await handlers.readScope());open();if(!same(immutableScope(fixed),immutableScope(current)))fail();return current;};
    try{
      let next=deferred();waiting=next;send(frame(b,0,'LOCKED',fixed));
      for(;;){const m=await next.promise;open();sequence=m.sequence;let result={};
        if(m.phase==='ABORT'){empty(m.value);fail();}
        if(m.phase==='RECHECK_SCOPE'){empty(m.value);if(reads||verified)fail();result=await check();reads++;}
        else if(m.phase==='VERIFY_OWNER'){
          if(reads!==1||verified)fail();const evidence=runOwnerEvidence(m.value,fixed);
          await check();await handlers.verifyOwner(evidence);open();verified=evidence;
        }else if(m.phase==='RELEASE'){
          empty(m.value);if(reads!==1||!verified)fail();await check();return runOwnerReadResult(verified,fixed);
        }else fail();
        open();next=deferred();waiting=next;inProgress=false;send(frame(b,sequence,'ACK',result));
      }
    }finally{close();signal?.removeEventListener('abort',close);}
  }
  return Object.freeze({receive,run,close});
}
export function createRunOwnerClientPhases({binding:raw,send,callback,assertLifetime,input}={}){
  const b=binding(raw),expected=validateRunOwnerReadInput(input);if(typeof callback!=='function'||typeof assertLifetime!=='function')fail();
  let closed=false,started=false,sequence=0,waiting=null,waitingPhase=null,scope=null,work=Promise.resolve(),released=false,reads=0,verified=null;
  const abort=new AbortController();
  const open=()=>{if(closed)fail();assertLifetime();};
  function close(){closed=true;abort.abort();waiting?.reject(Error('native_run_owner_phase_closed'));waiting=null;}
  function transmit(phase,value){open();if(waiting||released)fail();sequence++;if(sequence>4)fail();const gate=deferred();waiting=gate;waitingPhase=phase;
    try{send(frame(b,sequence,phase,value));}catch{close();}return gate.promise;}
  function receive(message,handle){
    if(message?.schema!==RUN_OWNER_PHASE||message.request_id!==b.request_id)return false;
    try{open();validate(message,b);if(handle)fail();
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
          open();if(!value||waiting||reads!==1||!verified||!same(value,verified))fail();sequence++;released=true;send(frame(b,sequence,'RELEASE',{}));
        }).catch(()=>{if(!closed&&!released){try{sequence++;send(frame(b,sequence,'ABORT',{}));}catch{}}close();});
      }else{
        if(!started||!waiting||message.phase!=='ACK'||message.sequence!==sequence)fail();
        if(waitingPhase==='RECHECK_SCOPE')runOwnerScope(message.value);else empty(message.value);
        const gate=waiting;waiting=null;waitingPhase=null;gate.resolve(message.value);
      }
    }catch{close();}return true;
  }
  async function finish(value){
    if(!released){close();await work;fail();}await work;open();
    if(!verified||!same(value,runOwnerReadResult(verified,scope)))fail();close();return value;
  }
  return Object.freeze({receive,finish,close,drain:()=>work});
}
