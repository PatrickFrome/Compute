import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createImmutableJournalStore as store} from '../src/immutable-journal-store.mjs';
const sample=()=>({schema:'metaengine.devfleet.operator.v1',
  sessions:[],requests:[{operation:'assign',request_id:'original-ambiguous-task',
    state:'AMBIGUOUS',receipt:{state:'AMBIGUOUS',automatic_retry_allowed:false}}]});
async function fixture(t){
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'me-immutable-test-'));
 t.after(async()=>{await fs.rm(d,{recursive:true,force:true})});
 return d;
}
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('legacy file migrates without ever replacing its externally held path',async t=>{
 const dir=await fixture(t),legacy=path.join(dir,'operator-state.json');
 const original=JSON.stringify(sample())+'\n';await fs.writeFile(legacy,original);
 const guarded={...fs,rename:async(a,b)=>{if(b===legacy)throw Error('forbidden_legacy_overwrite');return fs.rename(a,b);}};
 const a=store({dataDir:dir,io:guarded});
 assert.deepEqual(await a.load(),sample());
 await a.save(sample());
 assert.equal(await fs.readFile(legacy,'utf8'),original);
 const b=store({dataDir:dir});assert.deepEqual(await b.load(),sample());
 assert.equal(b.readOnlyStatus().generation,1);
});
test('monotonic immutable commits preserve original UNKNOWN receipts',async t=>{
 const dir=await fixture(t),a=store({dataDir:dir});assert.equal(await a.load(),null);
 for(let n=1;n<=12;n++){
  const state={...sample(),n};
  const r=await a.save(state);assert.equal(r.generation,n);
 }
 const b=store({dataDir:dir}),x=await b.load();
 assert.equal(x.n,12);
 assert.equal(x.requests[0].state,'AMBIGUOUS');
 assert.equal(x.requests[0].receipt.automatic_retry_allowed,false);
 assert.equal((await b.save({...x,n:13})).generation,13);
});
test('uncommitted temp files are ignored after crash',async t=>{
 const dir=await fixture(t),a=store({dataDir:dir});await a.load();
 await fs.writeFile(path.join(dir,'operator-snapshot-g0000000001-'+('a'.repeat(64))+'.json.tmp-crash'),'partial');
 assert.equal((await a.save(sample())).generation,1);
});
test('corrupted latest generation is not replaced with stale legacy state',async t=>{
 const dir=await fixture(t);await fs.writeFile(path.join(dir,'operator-state.json'),JSON.stringify(sample()));
 const a=store({dataDir:dir});await a.load();await a.save(sample());
 const file=(await fs.readdir(dir)).find(n=>n.endsWith('.json')&&n.startsWith('operator-snapshot-'));
 await fs.writeFile(path.join(dir,file),'tampered');
 const b=store({dataDir:dir});
 await assert.rejects(b.load(),/journal_digest_mismatch/);
});
test('two different snapshots at same seq fail closed as fork',async t=>{
 const dir=await fixture(t),a=store({dataDir:dir});await a.load();await a.save(sample());
 const name=(await fs.readdir(dir)).find(n=>n.startsWith('operator-snapshot-')&&!n.includes('.tmp-'));
 const body=JSON.stringify({schema:'metaengine.devfleet.immutable-snapshot.v1',seq:1,
   previous_digest:null,state:{x:123}},null,2)+'\n';
 const clash='operator-snapshot-g0000000001-'+hash(body)+'.json';
 await fs.writeFile(path.join(dir,clash),body);
 await assert.rejects(store({dataDir:dir}).load(),/journal_generation_fork/);
});
test('other process commits while local store alive => no stale overwrite',async t=>{
 const dir=await fixture(t),a=store({dataDir:dir}),b=store({dataDir:dir});
 await a.load();await b.load();
 await a.save(sample());
 await assert.rejects(b.save(sample()),/journal_generation_changed/);
});
test('ambiguous rename after successful commit is proven by exact bytes only',async t=>{
 const dir=await fixture(t);
 const io={...fs,rename:async(from,to)=>{await fs.rename(from,to);const e=Error('uncertain');e.code='EPERM';throw e;}};
 const a=store({dataDir:dir,io});await a.load();
 assert.equal((await a.save(sample())).generation,1);
 assert.deepEqual(await store({dataDir:dir}).load(),sample());
});
test('failed pre-commit rename leaves older generation as only source',async t=>{
 const dir=await fixture(t),a=store({dataDir:dir});await a.load();await a.save(sample());
 const failio={...fs,rename:async()=>{const e=Error('sharing violation');e.code='EPERM';throw e;}};
 const b=store({dataDir:dir,io:failio});await b.load();
 await assert.rejects(b.save({...sample(),n:2}),e=>e.code==='EPERM');
 const c=store({dataDir:dir});assert.equal((await c.load()).n,undefined);
});
test('missing legacy is clean first boot but invalid legacy does not silently reset',async t=>{
 const dir=await fixture(t);const a=store({dataDir:dir});
 assert.equal(await a.load(),null);
 await fs.writeFile(path.join(dir,'operator-state.json'),'{broken');
 await assert.rejects(store({dataDir:dir}).load(),/journal_legacy_invalid/);
});
