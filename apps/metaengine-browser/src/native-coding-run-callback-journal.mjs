import fs from 'node:fs/promises';
import path from 'node:path';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
const journals=new WeakMap(),SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCHEMA='metaengine.native-coding.run-callback-record.v1',ZERO='0'.repeat(64),MAX_BYTES=8192;
const fail=()=>{throw Error('native_run_callback_journal_hold');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const OPS=['CHECK','READ_INTENT','project_overview','project_history_page','agent_send_message','agent_ack_message','project_propose_children'];
// Same file-data fsync primitive previously local to codex-cli-runner. It does
// NOT flush directory/ancestor entries or prove OS/power-loss durability. No
// rename/overwrite fallback, credential store, independent root or proof mint.
export async function durableNativeRunJson(file,value,exclusive=false){
 const handle=await fs.open(file,exclusive?'wx':'w',0o600);
 try{await handle.writeFile(`${JSON.stringify(value)}\n`);await handle.sync();}finally{await handle.close();}
}
const filename=sequence=>String(sequence).padStart(16,'0')+'.json';
const aggregate=()=>({header:false,bound:null,fenced:false,joined:false,candidate:false,requests:0,callers:0,settled:0,unsent:0,unknown:0,callbacks:0,held:false,active:new Map()});
function apply(state,event){
 if(!event||typeof event!=='object'||state.candidate)fail();
 const fields={HEADER:['run_id','lease_binding_sha256'],BOUND:['binding_sha256','instance_id','host_pid'],
  INTENT:['request_id','request_sha256','operation','job_binding_sha256'],CALLER:['request_id','request_sha256','outcome'],
  TERMINAL:['request_id','request_sha256','state','terminal_sha256'],UNSENT:['request_id','request_sha256'],CLEANUP_ONLY:['request_id','request_sha256'],
  FENCE:[],CALLBACKS_JOINED:['callbacks'],CANDIDATE:['state','lineage','all_effects_cleanup','authority_effect']};
 if(!fields[event.kind]||!exact(event,['kind',...fields[event.kind]]))fail();
 if(event.kind==='HEADER'){if(state.header||!UUID.test(event.run_id||'')||!SHA.test(event.lease_binding_sha256||''))fail();state.header=true;return;}
 if(!state.header)fail();
 if(event.kind==='BOUND'){
  if(state.bound||!SHA.test(event.binding_sha256||'')||!UUID.test(event.instance_id||'')||!Number.isSafeInteger(event.host_pid)||event.host_pid<1)fail();
  state.bound={binding_sha256:event.binding_sha256,instance_id:event.instance_id,host_pid:event.host_pid};return;
 }
 if(!state.bound)fail();
 if(event.kind==='FENCE'){if(state.fenced)fail();state.fenced=true;return;}
 if(event.kind==='CALLBACKS_JOINED'){
  if(!state.fenced||state.joined||!Number.isSafeInteger(event.callbacks)||event.callbacks<0)fail();state.joined=true;state.callbacks=event.callbacks;return;
 }
 if(event.kind==='CANDIDATE'){
  if(!state.fenced||!state.joined||state.held||state.active.size||state.requests!==state.callers||state.requests!==state.settled+state.unsent
   ||event.state!=='SCOPED_REQUESTS_JOINED'||event.lineage!=='LINEAGE_UNBOUND'||event.all_effects_cleanup!=='UNCONFIRMED'||event.authority_effect!==false)fail();
  state.candidate=true;return;
 }
 if(!UUID.test(event.request_id||'')||!SHA.test(event.request_sha256||''))fail();
 if(event.kind==='INTENT'){
  if(state.fenced||state.active.has(event.request_id)||state.active.size>=16||!OPS.includes(event.operation)||!SHA.test(event.job_binding_sha256||''))fail();
  state.active.set(event.request_id,{digest:event.request_sha256,caller:false,terminal:false});state.requests++;return;
 }
 const row=state.active.get(event.request_id);if(!row||row.digest!==event.request_sha256)fail();
 if(event.kind==='CALLER'){
  if(row.caller||!['OK','REJECTED','UNKNOWN'].includes(event.outcome))fail();row.caller=true;state.callers++;if(event.outcome==='UNKNOWN')state.unknown++;
 }else if(event.kind==='TERMINAL'){
  if(row.terminal||row.hold||!['SETTLED','HOLD'].includes(event.state)||!SHA.test(event.terminal_sha256||''))fail();
  if(event.state==='HOLD'){state.held=true;row.hold=true;return;}
  if(row.hold)fail();row.terminal=true;state.settled++;
 }else if(event.kind==='UNSENT'){
  if(row.terminal||row.hold)fail();row.terminal=true;state.unsent++;
 }else if(event.kind==='CLEANUP_ONLY'){
  if(row.terminal)fail();row.terminal=true;state.held=true;
 }else fail();
 if(row.caller&&row.terminal)state.active.delete(event.request_id);
}
const projection=(state,sequence,head,failed=false)=>Object.freeze({schema:'metaengine.native-coding.run-callback-journal.v1',
 durability_scope:'PROCESS_CRASH_ONLY',directory_durability:'DIRECTORY_DURABILITY_UNQUALIFIED',chain_root:'CHAIN_ROOT_UNANCHORED',
 state:failed||state.held?'HOLD':state.candidate?'SCOPED_REQUESTS_JOINED':'INCOMPLETE',lineage:'LINEAGE_UNBOUND',all_effects_cleanup:'UNCONFIRMED',
 records:sequence,head_sha256:head,requests:state.requests,caller_unknown:state.unknown,unsent:state.unsent,active:state.active.size,
 callbacks:state.callbacks,dispatch_fenced:state.fenced,callbacks_joined:state.joined,authority_effect:false,automatic_retry_allowed:false});
async function createJournal({directory,runId,binding}={}){
 if(!path.isAbsolute(directory||'')||!UUID.test(runId||'')||!binding||!UUID.test(binding.task_id||''))fail();
 const base=await fs.realpath(directory),before=await fs.lstat(directory);if(base!==path.resolve(directory)||!before.isDirectory()||before.isSymbolicLink())fail();
 const root=path.join(base,'host-callback-custody');await fs.mkdir(root,{mode:0o700}); // EEXIST is HOLD, never resume a writer.
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())fail();
 const state=aggregate();let sequence=0,head=ZERO,failed=false,tail=Promise.resolve(),claimed=false;
 const guard=async()=>{const now=await fs.lstat(root),parent=await fs.lstat(base);if(now.isSymbolicLink()||now.dev!==stat.dev||now.ino!==stat.ino
   ||parent.isSymbolicLink()||parent.dev!==before.dev||parent.ino!==before.ino||await fs.realpath(root)!==root)fail();};
 const append=event=>{
  const work=tail.then(async()=>{
   if(failed||!Number.isSafeInteger(sequence+1))fail();await guard();
   // Validate a copy first, so a refused record never advances durable state.
   const next=structuredClone(state);apply(next,event);
   const record={schema:SCHEMA,sequence,previous_sha256:head,event:structuredClone(event)};
   if(Buffer.byteLength(JSON.stringify(record))>MAX_BYTES)fail();
   await durableNativeRunJson(path.join(root,filename(sequence)),record,true);await guard();
   Object.assign(state,next);head=sha(record);sequence++;return projection(state,sequence,head);
  });
  tail=work.catch(()=>{failed=true;});return work.catch(()=>{failed=true;throw Error('native_run_callback_journal_hold');});
 };
 await append({kind:'HEADER',run_id:runId,lease_binding_sha256:sha(binding)});
 const journal=Object.freeze({snapshot:()=>projection(state,sequence,head,failed)});
 journals.set(journal,{runId,binding:structuredClone(binding),claim:async value=>{
  if(claimed)fail();claimed=true;
  if(value.binding?.run_id!==runId||['task_id','agent_id','lease_generation','agent_generation_epoch','role'].some(k=>value.binding[k]!==binding[k]))fail();
  await append({kind:'BOUND',binding_sha256:sha(value.binding),instance_id:value.instanceId,host_pid:value.hostPid});
  return Object.freeze({append,drain:async()=>{await tail;if(failed)fail();return journal.snapshot();},snapshot:journal.snapshot,
   candidate:()=>append({kind:'CANDIDATE',state:'SCOPED_REQUESTS_JOINED',lineage:'LINEAGE_UNBOUND',all_effects_cleanup:'UNCONFIRMED',authority_effect:false})});
 }});return journal;
}
export async function createNativeRunCallbackJournal(options){try{return await createJournal(options);}catch{throw Error('native_run_callback_journal_hold');}}
// No directory-entry/ancestor persistence or independently anchored chain-head
// producer exists yet. File fsync/ACLs/readable bytes cannot qualify publication.
// This default admission gate deliberately has no caller boolean/proof override.
export function requireNativeRunCallbackPublication(){
 throw Error('native_run_callback_directory_durability_unqualified');
}
export function claimNativeRunCallbackJournal(journal,binding){const owner=journals.get(journal);if(!owner)fail();return owner.claim(binding);}
// Read-only structural audit, NOT historical authority or a replay/resume API.
// Unanchored hashes detect local chain inconsistency, NOT a coherent rewrite
// of the complete history. No fsync/directory durability can be inferred here.
// Streams sequential bounded records; whole-directory scan detects trailing
// records/gaps without retaining the history or silently truncating it.
export async function readNativeRunCallbackJournal(directory){
 const root=path.join(directory,'host-callback-custody'),state=aggregate();let sequence=0,head=ZERO;
 try{
  const initial=await fs.lstat(root);if(initial.isSymbolicLink()||!initial.isDirectory()||await fs.realpath(root)!==path.resolve(root))fail();
  for(;;){
   const file=path.join(root,filename(sequence));let stat;try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')break;throw error;}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)fail();
   const fd=await fs.open(file,'r');let bytes;
   try{const held=await fd.stat();if(held.dev!==stat.dev||held.ino!==stat.ino||held.size!==stat.size)fail();bytes=await fd.readFile();const after=await fd.stat();if(after.size!==held.size||after.mtimeMs!==held.mtimeMs||after.ctimeMs!==held.ctimeMs)fail();}finally{await fd.close();}
   const row=JSON.parse(bytes.toString());if(bytes.length>MAX_BYTES||!exact(row,['schema','sequence','previous_sha256','event'])||row.schema!==SCHEMA||row.sequence!==sequence||row.previous_sha256!==head
     ||sequence===0&&row.event?.kind!=='HEADER'||sequence!==0&&row.event?.kind==='HEADER')fail();
   apply(state,row.event);head=sha(row);sequence++;
  }
  let files=0;for await(const entry of await fs.opendir(root)){if(!entry.isFile()||!/^\d{16}\.json$/.test(entry.name)||Number(entry.name.slice(0,16))>=sequence)fail();files++;}
  const final=await fs.lstat(root);if(final.dev!==initial.dev||final.ino!==initial.ino||final.mtimeMs!==initial.mtimeMs||final.ctimeMs!==initial.ctimeMs||files!==sequence||sequence===0)fail();
  return projection(state,sequence,head);
 }catch{return projection(state,sequence,head,true);}
}
