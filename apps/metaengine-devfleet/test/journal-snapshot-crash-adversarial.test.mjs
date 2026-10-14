import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createJournalSnapshotStore as make} from '../src/journal-snapshot-store.mjs';
async function env(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'devfleet-snapshot-crash-'));
 t.after(async()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'operator-state.json');
 await fs.writeFile(file,'{"schema":"metaengine.devfleet.operator.v1","sessions":[],"requests":[]}', 'utf8');
 const err=async()=>{const e=Error('win32 lock');e.code='EPERM';throw e;};
 return {dir,file,err};
}
const content=(n)=>({schema:'metaengine.devfleet.operator.v1',sessions:[],requests:[
 {request_id:'mass-client-job-'+n,state:'AMBIGUOUS',operation:'assign'}
]});
test('half-written temp snapshot is ignored and next commit is recoverable',async t=>{
 const x=await env(t);
 const aborted=path.join(x.dir,'operator-state.json.snapshot-v1-00000001.json.tmp-'+crypto.randomUUID());
 await fs.writeFile(aborted,'PARTIAL UNCOMMITTED');
 const s=make({file:x.file,atomicWrite:x.err});
 assert.ok(await s.load());
 await s.save(content(1));
 assert.equal(s.snapshotStatus().snapshot_count,1);
 const fresh=make({file:x.file,atomicWrite:x.err});
 const loaded=await fresh.load();
 assert.equal(loaded.requests[0].request_id,'mass-client-job-1');
});
test('atomic hardlink destination does not overwrite a competing generation',async t=>{
 const x=await env(t);
 const first=make({file:x.file,atomicWrite:x.err});
 const second=make({file:x.file,atomicWrite:x.err});
 await first.load();await second.load();
 await first.save(content(1));
 await assert.rejects(second.save(content(2)),e=>e.code==='EEXIST');
 const verify=make({file:x.file,atomicWrite:x.err});
 assert.equal((await verify.load()).requests[0].request_id,'mass-client-job-1');
});
test('failed link before commit leaves no poisoned final snapshot',async t=>{
 const x=await env(t);
 const io={...fs,link:async()=>{const e=Error('denied');e.code='EACCES';throw e;}};
 const first=make({file:x.file,atomicWrite:x.err,io});
 await first.load();
 await assert.rejects(first.save(content(1)),e=>e.code==='EACCES');
 const names=await fs.readdir(x.dir);
 assert.equal(names.filter(y=>y.includes('.snapshot-v1-')).length,0);
 const second=make({file:x.file,atomicWrite:x.err});
 await second.load();await second.save(content(2));
 const next=make({file:x.file,atomicWrite:x.err});
 assert.equal((await next.load()).requests[0].request_id,'mass-client-job-2');
});
test('ambiguous link outcome is reconciled only after exact-byte readback',async t=>{
 const x=await env(t);
 const io={...fs,link:async(a,b)=>{await fs.link(a,b);const e=Error('ambiguous');e.code='EPERM';throw e;}};
 const first=make({file:x.file,atomicWrite:x.err,io});
 await first.load();await first.save(content(1));
 const second=make({file:x.file,atomicWrite:x.err});
 assert.equal((await second.load()).requests[0].request_id,'mass-client-job-1');
});
test('unknown committed catalog name is not silently skipped as a temp',async t=>{
 const x=await env(t);
 await fs.writeFile(path.join(x.dir,'operator-state.json.snapshot-v1-corrupt.json'),'{}');
 await assert.rejects(make({file:x.file,atomicWrite:x.err}).load(),/journal_snapshot_catalog_invalid/);
});
