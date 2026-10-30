import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readNativeCallbackProtectedPrefix} from './native-coding-callback-prefix.mjs';
import {nativeCodingCanonicalSha256 as sha,nativeCodingCanonicalJson} from './native-coding-task-context.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {createNativeRunCallbackJournal,claimNativeRunCallbackJournal} from '../../apps/metaengine-browser/src/native-coding-run-callback-journal.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
// Actual filesystem bytes and parser, GENERATED owner-DACL witness. No Windows
// ACL, directory-flush, storage hardware or native process qualification.
const read=(file,options)=>readNativeCodingProtectedJson(file,{...options,verifyStorage:async()=>({owner_dacl_verified:true})});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(process.env.METAENGINE_CALLBACK_JOURNAL_TEST_BASE||os.tmpdir()),'native-prefix-reader-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const ancestor=path.join(root,'ancestor'),directory=path.join(ancestor,'run');await fs.mkdir(directory,{recursive:true});
 const runId=randomUUID(),binding={task_id:randomUUID(),agent_id:'agent_fixture-12345678',lease_generation:1,agent_generation_epoch:1,role:'IMPLEMENTER',base_sha:'a'.repeat(40)};
 const scope={run_id:runId,workspace_id:randomUUID(),project_id:randomUUID(),task_id:binding.task_id,lease_generation:1,agent_id:binding.agent_id,agent_generation_epoch:1,provider_id:randomUUID(),role:'IMPLEMENTER'};
 const journal=await createNativeRunCallbackJournal({directory,runId,binding});
 const writer=await claimNativeRunCallbackJournal(journal,{binding:scope,instanceId:randomUUID(),hostPid:123});
 await fs.writeFile(path.join(directory,'attempt.json'),JSON.stringify({run_id:runId,state:'RESERVED',...binding}),{flag:'wx'});
 const scan=options=>readNativeCallbackProtectedPrefix({directory,readProtectedJson:read,...options});
 return {root,ancestor,directory,runId,writer,scan};
}
const intent=()=>({kind:'INTENT',request_id:randomUUID(),request_sha256:'b'.repeat(64),operation:'CHECK',job_binding_sha256:'c'.repeat(64)});
async function rewrite(directory,mutate){
 const root=path.join(directory,'host-callback-custody');let head='0'.repeat(64);
 for(const name of (await fs.readdir(root)).sort()){
  const file=path.join(root,name),record=JSON.parse(await fs.readFile(file,'utf8'));mutate(record);record.previous_sha256=head;head=sha(record);await fs.writeFile(file,JSON.stringify(record));
 }
}
test('actual protected prefix extends only the exact previous head; no publication/cleanup authority',async t=>{
 const f=await fixture(t),first=await f.scan();await f.writer.append(intent());const next=await f.scan({expected:first});
 assert.equal(next.record_count,3);assert.equal(next.intent_count,1);assert.equal(first.prefix_identity_sha256,next.prefix_identity_sha256);
 assert.equal(next.structural_only,true);assert.equal(next.local_durability,'DIRECTORY_DURABILITY_UNQUALIFIED');
});
test('coherent full-history rewrite passes structure but fails the independently supplied anchored prefix',async t=>{
 const f=await fixture(t);await f.writer.append(intent());const first=await f.scan();
 await rewrite(f.directory,row=>{if(row.event.kind==='INTENT')row.event.request_sha256='f'.repeat(64);});
 assert.notEqual((await f.scan()).head_sha256,first.head_sha256);
 await assert.rejects(f.scan({expected:first}),/prefix_hold/);
});
for(const change of ['gap','trailing','hardlink','symlink','missing-attempt'])test('protected prefix refuses '+change,async t=>{
 const f=await fixture(t),root=path.join(f.directory,'host-callback-custody'),file=path.join(root,'0000000000000001.json');
 if(change==='gap')await fs.rename(file,path.join(root,'0000000000000003.json'));
 if(change==='trailing')await fs.writeFile(path.join(root,'foreign.json'),'{}');
 if(change==='hardlink')await fs.link(file,path.join(f.root,'linked.json'));
 if(change==='symlink'){await fs.rename(file,path.join(f.root,'target.json'));await fs.symlink(path.join(f.root,'target.json'),file);}
 if(change==='missing-attempt')await fs.unlink(path.join(f.directory,'attempt.json'));
 await assert.rejects(f.scan());
});
test('same leaf moved through a replaced ancestor changes physical root identity',async t=>{
 const f=await fixture(t),before=await f.scan(),old=path.join(f.root,'old');
 const leaf=await fs.stat(f.directory);await fs.rename(f.ancestor,old);await fs.mkdir(f.ancestor);await fs.rename(path.join(old,'run'),f.directory);
 assert.equal((await fs.stat(f.directory)).ino,leaf.ino);
 const after=await f.scan({expected:before});assert.notEqual(after.prefix_identity_sha256,before.prefix_identity_sha256);
});
test('ancestor replacement during actual file reads is refused even when the leaf stays identical',async t=>{
 const f=await fixture(t);let changed=false;
 await assert.rejects(f.scan({readProtectedJson:async(file,options)=>{
  const result=await read(file,options);if(!changed){changed=true;const old=path.join(f.root,'old');await fs.rename(f.ancestor,old);await fs.mkdir(f.ancestor);await fs.rename(path.join(old,'run'),f.directory);}return result;
 }}),/prefix_hold/);
});
test('attempt rewrite during observation and cancellation cannot produce a prefix',async t=>{
 const f=await fixture(t);let changed=false;
 await assert.rejects(f.scan({readProtectedJson:async(file,options)=>{
  const result=await read(file,options);if(!changed&&path.basename(file)==='attempt.json'){changed=true;await fs.writeFile(file,JSON.stringify({...result.value,run_id:randomUUID()}));}return result;
 }}),/prefix_hold/);
 const controller=new AbortController();controller.abort();await assert.rejects(f.scan({request:{signal:controller.signal}}),/request_cancelled/);
});
test('whole prefix exceeds 1024 records without truncation or logical-history cap',async t=>{
 const f=await fixture(t),first=await f.scan();
 for(let n=0;n<350;n++){const e=intent();await f.writer.append(e);const selected={request_id:e.request_id,request_sha256:e.request_sha256};
  await f.writer.append({kind:'CALLER',...selected,outcome:'UNKNOWN'});await f.writer.append({kind:'TERMINAL',...selected,state:'SETTLED',terminal_sha256:'d'.repeat(64)});
 }
 const final=await f.scan({expected:first});assert.equal(final.record_count,1052);assert.equal(final.intent_count,350);
});
test('default OS method derives path from protected operator; exact original Host birth is sticky',async()=>{
 const source=await fs.readFile(new URL('./native-coding-host-os-scope.mjs',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('  function journalPath('),source.indexOf('  async function readNativeWorker'));
 const body=source.slice(source.indexOf('  let publicationHost='),source.indexOf('  return Object.freeze({readNativeScope'));
 const operator={journal_root:path.resolve('/fixture/protected')},scope={task_id:randomUUID(),lease_generation:7},permit={role:'CRITIC'},calls=[];
 let native={pid:process.pid,created_at:new Date().toISOString(),process_incarnation_id:`pid:${process.pid}:created_100ns:134000000000000001`,exe_path:process.execPath};
 let onRead=null;
 const readers=new Function('path','createHash','config','readNativeCodingOperatorPaths','readNativeCallbackProtectedPrefix','assertNativeCodingHostRequestOpen','readNativeCodingWindowsProcess','samePath','publicProcess','nativeCodingCanonicalJson','fail',helper+body+'return {readPublicationHost,readCallbackPrefix};')
  (path,createHash,{state_directory:'/fixture/state'},async()=>structuredClone(operator),async input=>{calls.push(input);await onRead?.();return {structural_only:true};},
   assertNativeCodingHostRequestOpen,async()=>structuredClone(native),(a,b)=>a===b,p=>({pid:p.pid,created_at:p.created_at,process_incarnation_id:p.process_incarnation_id}),nativeCodingCanonicalJson,reason=>{throw Error(reason);});
 await readers.readCallbackPrefix({scope,permit,expected:null,request:{},directory:'/caller/forged'});
 assert.equal(calls[0].directory,path.join(operator.journal_root,createHash('sha256').update(JSON.stringify({...scope,role:'CRITIC'})).digest('hex')));
 await readers.readPublicationHost({});native.process_incarnation_id=`pid:${process.pid}:created_100ns:134000000000000002`;
 await assert.rejects(readers.readPublicationHost({}),/publication_host_birth_changed/);
 onRead=()=>{operator.journal_root='/fixture/changed';};await assert.rejects(readers.readCallbackPrefix({scope,permit,request:{}}),/publication_operator_changed/);
});
