import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createJournalSnapshotStore} from '../src/journal-snapshot-store.mjs';

async function fixture(fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'devfleet-journal-v1-'));
 const file=path.join(dir,'operator-state.json');
 try{await fn({file,dir});}finally{await fs.rm(dir,{recursive:true,force:true});}
}
const ep=()=>Object.assign(Error('win32 sharing'),{code:'EPERM'});
const noRename=async()=>{throw ep();};
test('Win32 locked primary uses fsync-backed immutable exact snapshot; restart recovers',async()=>fixture(async({file})=>{
 await fs.writeFile(file,JSON.stringify({requests:['base']})+'\n');
 const s=createJournalSnapshotStore({file,atomicWrite:noRename});
 assert.deepEqual(await s.load(),{requests:['base']});
 await s.save({requests:['base','new'],coding_queue:{items:[{task_id:'W22'}]}});
 assert.equal(s.snapshotStatus().snapshot_count,1);
 const restored=createJournalSnapshotStore({file,atomicWrite:noRename});
 assert.deepEqual(await restored.load(),{requests:['base','new'],coding_queue:{items:[{task_id:'W22'}]}});
 await restored.save({requests:['base','new','next']});
 const again=createJournalSnapshotStore({file,atomicWrite:noRename});
 assert.deepEqual((await again.load()).requests,['base','new','next']);
 assert.equal(again.snapshotStatus().snapshot_count,2);
}));
test('successful normal atomic write keeps primary path, no extra snapshots',async()=>fixture(async({file,dir})=>{
 const normal=async(dest,body)=>fs.writeFile(dest,body);
 const s=createJournalSnapshotStore({file,atomicWrite:normal});
 assert.equal(await s.load(),null);
 await s.save({requests:[]});
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{requests:[]});
 assert.equal(s.snapshotStatus().snapshot_count,0);
 assert.deepEqual((await fs.readdir(dir)).sort(),['operator-state.json']);
}));
test('truncated immutable snapshot fences boot; does not silently use stale primary',async()=>fixture(async({file,dir})=>{
 await fs.writeFile(file,'{}\n');
 const s=createJournalSnapshotStore({file,atomicWrite:noRename});await s.load();
 await s.save({requests:[1]});
 const name=(await fs.readdir(dir)).find(x=>x.includes('snapshot-v1-'));
 await fs.writeFile(path.join(dir,name),'{"partial":');
 await assert.rejects(createJournalSnapshotStore({file,atomicWrite:noRename}).load(),/snapshot_unreadable/);
}));
test('snapshot generation gap fences re-entry',async()=>fixture(async({file,dir})=>{
 await fs.writeFile(file,'{}\n');
 const s=createJournalSnapshotStore({file,atomicWrite:noRename});await s.load();
 await s.save({requests:[1]});await s.save({requests:[1,2]});
 await fs.rm(path.join(dir,'operator-state.json.snapshot-v1-00000001.json'));
 await assert.rejects(createJournalSnapshotStore({file,atomicWrite:noRename}).load(),/sequence_gap/);
}));
test('changed primary after append fences authority',async()=>fixture(async({file})=>{
 await fs.writeFile(file,'{}\n');
 const s=createJournalSnapshotStore({file,atomicWrite:noRename});await s.load();
 await s.save({requests:[1]});
 await fs.writeFile(file,'{"other":true}\n');
 await assert.rejects(s.save({requests:[1,2]}),/concurrent_drift/);
 await assert.rejects(createJournalSnapshotStore({file,atomicWrite:noRename}).load(),/integrity_invalid/);
}));
test('ENOSPC and arbitrary non-rename storage failure never trigger fallback',async()=>fixture(async({file,dir})=>{
 const noSpace=async()=>{throw Object.assign(Error('disk'),{code:'ENOSPC'});};
 const s=createJournalSnapshotStore({file,atomicWrite:noSpace});await s.load();
 await assert.rejects(s.save({requests:['x']}),e=>e.code==='ENOSPC');
 assert.equal((await fs.readdir(dir)).filter(x=>x.includes('snapshot-v1')).length,0);
}));
test('invalid sidecar suffix rejects catalog rather than ignoring corruption',async()=>fixture(async({file,dir})=>{
 await fs.writeFile(file,'{}\n');
 await fs.writeFile(path.join(dir,'operator-state.json.snapshot-v1-tampered.json'),'x');
 await assert.rejects(createJournalSnapshotStore({file,atomicWrite:noRename}).load(),/catalog_invalid/);
}));
