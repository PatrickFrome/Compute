import test from 'node:test';
import assert from 'node:assert/strict';
import {atomicPrivateWrite} from '../src/atomic-private-write.mjs';
function fake({fail=0,code='EPERM',committedDespiteError=false}={}) {
 const files=new Map([['journal.json','old']]);let renames=0,cleanups=0;
 return {files,stats:()=>({renames,cleanups}),io:{
  async writeFile(p,v){if(files.has(p))throw Error('exists');files.set(p,v);},
  async rename(a,b){renames++;if(renames<=fail){
   if(committedDespiteError){files.set(b,files.get(a));files.delete(a);}
   const e=Error('win32 sharing violation');e.code=code;throw e;
  }files.set(b,files.get(a));files.delete(a);},
  async readFile(p){if(!files.has(p))throw Object.assign(Error('missing'),{code:'ENOENT'});return files.get(p);},
  async rm(p){cleanups++;files.delete(p);}
 }};
}
test('transient Windows rename conflict retries only the same staged journal',async()=>{
 const f=fake({fail:2});const delays=[];
 const x=await atomicPrivateWrite('journal.json','new',{io:f.io,delay:async t=>delays.push(t),uuid:()=> 'a'});
 assert.equal(x.state,'COMMITTED');assert.equal(x.attempts,3);
 assert.equal(f.files.get('journal.json'),'new');assert.deepEqual(delays,[20,40]);
 assert.equal(f.stats().renames,3);
});
test('ambiguous native error with exact committed bytes is reconciled without second rename',async()=>{
 const f=fake({fail:1,committedDespiteError:true});
 const x=await atomicPrivateWrite('journal.json','new',{io:f.io,delay:async()=>{},uuid:()=> 'b'});
 assert.equal(x.state,'COMMITTED_BY_READBACK');assert.equal(f.stats().renames,1);
 assert.equal(f.files.get('journal.json'),'new');
});
test('persistent sharing violation leaves old journal intact and fails closed',async()=>{
 const f=fake({fail:10});await assert.rejects(
  atomicPrivateWrite('journal.json','new',{io:f.io,delay:async()=>{},uuid:()=> 'c'}),
  e=>e.code==='EPERM');
 assert.equal(f.files.get('journal.json'),'old');assert.equal(f.stats().renames,4);
});
test('non-sharing filesystem errors are not retried',async()=>{
 const f=fake({fail:10,code:'ENOSPC'});await assert.rejects(
  atomicPrivateWrite('journal.json','new',{io:f.io,delay:async()=>{},uuid:()=> 'd'}),
  e=>e.code==='ENOSPC');
 assert.equal(f.stats().renames,1);
});
