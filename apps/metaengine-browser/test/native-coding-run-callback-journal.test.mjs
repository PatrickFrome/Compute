import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNativeRunCallbackJournal,claimNativeRunCallbackJournal,readNativeRunCallbackJournal,durableNativeRunJson} from '../src/native-coding-run-callback-journal.mjs';
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'native-run-callback-journal-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const runId=randomUUID(),binding={task_id:randomUUID(),agent_id:'agent_fixture-12345678',lease_generation:1,agent_generation_epoch:1,role:'IMPLEMENTER',base_sha:'a'.repeat(40)};
 const scope={...binding,run_id:runId,workspace_id:randomUUID(),project_id:randomUUID(),provider_id:randomUUID()};delete scope.base_sha;
 const journal=await createNativeRunCallbackJournal({directory,runId,binding}),owner={binding:scope,instanceId:randomUUID(),hostPid:123};
 return{directory,runId,binding,scope,journal,owner,claim:()=>claimNativeRunCallbackJournal(journal,owner)};
}
const intent=()=>({kind:'INTENT',request_id:randomUUID(),request_sha256:'b'.repeat(64),operation:'CHECK',job_binding_sha256:'c'.repeat(64)});
const selected=x=>({request_id:x.request_id,request_sha256:x.request_sha256});
async function complete(writer,x,{outcome='OK',unsent=false}={}){
 await writer.append({kind:'CALLER',...selected(x),outcome});
 await writer.append(unsent?{kind:'UNSENT',...selected(x)}:{kind:'TERMINAL',...selected(x),state:'SETTLED',terminal_sha256:'d'.repeat(64)});
}
async function seal(writer,callbacks=1){await writer.append({kind:'FENCE'});await writer.append({kind:'CALLBACKS_JOINED',callbacks});return writer.candidate();}
test('exclusive chain retains digest-only intent and candidate explicitly lacks durable lineage/effect authority',async t=>{
 const f=await fixture(t),w=await f.claim(),x=intent();await w.append(x);await complete(w,x,{outcome:'UNKNOWN'});
 const value=await seal(w);assert.equal(value.state,'SCOPED_REQUESTS_JOINED');assert.equal(value.caller_unknown,1);assert.equal(value.lineage,'LINEAGE_UNBOUND');assert.equal(value.all_effects_cleanup,'UNCONFIRMED');
 assert.deepEqual(await readNativeRunCallbackJournal(f.directory),value);assert.equal(value.authority_effect,false);assert.equal(value.active,0);
 await assert.rejects(f.claim(),/journal_hold/);await assert.rejects(createNativeRunCallbackJournal(f),/journal_hold/);
});
test('unbranded journal, changed original run or unknown request body cannot mint a writer or evidence',async t=>{
 const f=await fixture(t);assert.throws(()=>claimNativeRunCallbackJournal({snapshot:()=>({})},f.owner),/journal_hold/);
 await assert.rejects(claimNativeRunCallbackJournal(f.journal,{...f.owner,binding:{...f.scope,run_id:randomUUID()}}),/journal_hold/);
 const g=await fixture(t),w=await g.claim();await assert.rejects(w.append({...intent(),body:'SECRET_BODY_SENTINEL'}),/journal_hold/);
 for(const file of await fs.readdir(path.join(g.directory,'host-callback-custody')))assert.ok(!(await fs.readFile(path.join(g.directory,'host-callback-custody',file),'utf8')).includes('SECRET_BODY_SENTINEL'));
});
for(const boundary of ['header-only','intent','caller','terminal','fence','join'])test(`interruption at ${boundary} is incomplete/HOLD, never a final all-effects seal`,async t=>{
 const f=await fixture(t);if(boundary==='header-only'){assert.equal((await readNativeRunCallbackJournal(f.directory)).state,'INCOMPLETE');return;}
 const w=await f.claim(),x=intent();await w.append(x);
 if(boundary!=='intent')await w.append({kind:'CALLER',...selected(x),outcome:'UNKNOWN'});
 if(['terminal','fence','join'].includes(boundary))await w.append({kind:'TERMINAL',...selected(x),state:'SETTLED',terminal_sha256:'d'.repeat(64)});
 if(['fence','join'].includes(boundary))await w.append({kind:'FENCE'});
 if(boundary==='join')await w.append({kind:'CALLBACKS_JOINED',callbacks:1});
 const read=await readNativeRunCallbackJournal(f.directory);assert.equal(read.state,'INCOMPLETE');assert.equal(read.all_effects_cleanup,'UNCONFIRMED');
});
for(const corruption of ['gap','partial','digest','extra','candidate-partial'])test(`read-only recovery refuses ${corruption} without repair/overwrite or truncation`,async t=>{
 const f=await fixture(t),w=await f.claim(),x=intent();await w.append(x);await complete(w,x);await seal(w);
 const root=path.join(f.directory,'host-callback-custody'),files=(await fs.readdir(root)).sort();
 if(corruption==='gap')await fs.unlink(path.join(root,files[2]));
 if(corruption==='partial')await fs.writeFile(path.join(root,files[3]),'{');
 if(corruption==='digest'){const file=path.join(root,files[3]),row=JSON.parse(await fs.readFile(file));row.previous_sha256='f'.repeat(64);await fs.writeFile(file,JSON.stringify(row));}
 if(corruption==='extra')await fs.writeFile(path.join(root,'0000000000001000.json'),'{}');
 if(corruption==='candidate-partial')await fs.writeFile(path.join(root,files.at(-1)),'{');
 const before=await fs.readdir(root);assert.equal((await readNativeRunCallbackJournal(f.directory)).state,'HOLD');assert.deepEqual(await fs.readdir(root),before);
});
test('UNSENT requires an existing intent and cannot be inferred on restart from missing terminal',async t=>{
 const f=await fixture(t),w=await f.claim(),x=intent();await w.append(x);assert.equal((await readNativeRunCallbackJournal(f.directory)).unsent,0);
 await complete(w,x,{outcome:'REJECTED',unsent:true});assert.equal((await seal(w)).unsent,1);
});
test('cleanup-only original Host shutdown and poisoned terminal never become a joined candidate',async t=>{
 for(const poisoned of [false,true]){
  const f=await fixture(t),w=await f.claim(),x=intent();await w.append(x);await w.append({kind:'CALLER',...selected(x),outcome:'UNKNOWN'});
  if(poisoned)await w.append({kind:'TERMINAL',...selected(x),state:'HOLD',terminal_sha256:'e'.repeat(64)});
  await w.append({kind:'CLEANUP_ONLY',...selected(x)});await assert.rejects(seal(w),/journal_hold/);
  assert.equal((await readNativeRunCallbackJournal(f.directory)).state,'HOLD');
 }
});
test('exclusive collision leaves partial HOLD and never overwrites durable bytes',async t=>{
 const f=await fixture(t),w=await f.claim(),x=intent(),target=path.join(f.directory,'host-callback-custody','0000000000000002.json');
 await fs.writeFile(target,'fixture retained partial');await assert.rejects(w.append(x),/journal_hold/);
 assert.equal(await fs.readFile(target,'utf8'),'fixture retained partial');assert.equal((await readNativeRunCallbackJournal(f.directory)).state,'HOLD');
 const file=path.join(f.directory,'durable.json');await durableNativeRunJson(file,{one:true},true);await assert.rejects(durableNativeRunJson(file,{two:true},true));
 assert.deepEqual(JSON.parse(await fs.readFile(file)),{one:true});
});
test('completed history grows without an arbitrary logical ceiling while live retention returns to zero',async t=>{
 const f=await fixture(t),w=await f.claim();for(let i=0;i<300;i++){const x=intent();await w.append(x);await complete(w,x);assert.equal(w.snapshot().active,0);}
 const candidate=await seal(w,300);assert.equal(candidate.requests,300);assert.equal(candidate.records,905);assert.deepEqual(await readNativeRunCallbackJournal(f.directory),candidate);
});

test('unanchored structural audit cannot detect a coherent whole-history rewrite and therefore grants no authority',async t=>{
 const {nativeCodingCanonicalSha256:sha}=await import('../src/native-coding-task-context.mjs');
 const f=await fixture(t),w=await f.claim(),x=intent();await w.append(x);await complete(w,x);const original=await seal(w);
 assert.equal(original.directory_durability,'DIRECTORY_DURABILITY_UNQUALIFIED');assert.equal(original.durability_scope,'PROCESS_CRASH_ONLY');assert.equal(original.chain_root,'CHAIN_ROOT_UNANCHORED');
 const root=path.join(f.directory,'host-callback-custody');let previous='0'.repeat(64);
 for(const name of (await fs.readdir(root)).sort()){
  const file=path.join(root,name),row=JSON.parse(await fs.readFile(file));row.previous_sha256=previous;
  if(row.event.kind==='HEADER')row.event.run_id=randomUUID();if(row.event.kind==='BOUND')row.event.instance_id=randomUUID();
  previous=sha(row);await fs.writeFile(file,JSON.stringify(row)+'\n');
 }
 const rewritten=await readNativeRunCallbackJournal(f.directory);assert.equal(rewritten.state,'SCOPED_REQUESTS_JOINED');
 assert.notEqual(rewritten.head_sha256,original.head_sha256);assert.equal(rewritten.chain_root,'CHAIN_ROOT_UNANCHORED');
 assert.equal(rewritten.all_effects_cleanup,'UNCONFIRMED');assert.equal(rewritten.authority_effect,false);
});
test('file-fsynced process-crash journal is explicitly unqualified for directory loss and no publication gate can be bypassed',async t=>{
 const {requireNativeRunCallbackPublication}=await import('../src/native-coding-run-callback-journal.mjs');
 const f=await fixture(t),w=await f.claim(),x=intent();await w.append(x);await complete(w,x);await seal(w);
 assert.throws(()=>requireNativeRunCallbackPublication(f.journal),/directory_durability_unqualified/);
 assert.throws(()=>requireNativeRunCallbackPublication({qualified:true}),/directory_durability_unqualified/);
 // Generated disappearance counterexample, NOT an actual power-loss test.
 await fs.rm(path.join(f.directory,'host-callback-custody'),{recursive:true});
 const read=await readNativeRunCallbackJournal(f.directory);assert.equal(read.state,'HOLD');assert.equal(read.directory_durability,'DIRECTORY_DURABILITY_UNQUALIFIED');
 assert.equal(read.unsent,0);assert.equal(read.automatic_retry_allowed,false);
});
