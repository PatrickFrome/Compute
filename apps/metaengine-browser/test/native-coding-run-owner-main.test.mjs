import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadedNativeRunOwnerCallback} from '../src/native-coding-run-owner-main.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function setup(read){
 const state={device_id:'device',client_id:'client',key_fingerprint_sha256:'key',enrolled:true};
 const host={instance_id:'host',host_pid:123,closed:false};let calls=0,scopeChecks=0;
 const abort=new AbortController(),scope={signal:abort.signal,assertOpen(){scopeChecks++;if(abort.signal.aborted)throw Error('scope closed');}};
 const callback=createLoadedNativeRunOwnerCallback({identity:{snapshot:()=>state,readLoadedRunOwnerW74:async value=>{calls++;return read?read(value):{source_only:true};}},
  capability:{snapshot:()=>host,withRunOwnerScope(){throw Error('nested IPC forbidden');},drainPhysical(){throw Error('global drain forbidden');}},assertOpen(){}});
 return{callback,scope,state,host,abort,get calls(){return calls;},get scopeChecks(){return scopeChecks;}};
}
test('direct callback performs fresh reads on the original scope without nested IPC or drain',async()=>{
 const f=setup(async v=>{assert.equal(v.scope,f.scope);assert.equal(v.signal,f.scope.signal);v.assertLifetime();return{source_only:true};});
 for(let i=0;i<6;i++)assert.deepEqual(await f.callback(f.scope),{source_only:true});assert.equal(f.calls,6);assert.ok(f.scopeChecks>=18);
});
for(const field of ['device_id','client_id','key_fingerprint_sha256','enrolled'])test('direct callback fences changed '+field+' before native read',async()=>{
 const f=setup();f.state[field]=field==='enrolled'?false:'changed';await assert.rejects(f.callback(f.scope),/main_changed/);assert.equal(f.calls,0);
});
for(const field of ['instance_id','host_pid','closed'])test('direct callback fences changed Host '+field,async()=>{
 const f=setup();f.host[field]=field==='closed'?true:field==='host_pid'?456:'other';await assert.rejects(f.callback(f.scope),/main_changed/);assert.equal(f.calls,0);
});
test('direct callback rejects cancellation before work and after a held native read settles',async()=>{
 const a=setup();a.abort.abort();await assert.rejects(a.callback(a.scope));assert.equal(a.calls,0);
 let release,entered;const wait=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
 const f=setup(async()=>{entered();await wait;return{source_only:true};});let settled=false;
 const p=f.callback(f.scope);p.finally(()=>settled=true).catch(()=>{});await entry;f.abort.abort();await tick();assert.equal(settled,false);
 release();await assert.rejects(p);assert.equal(settled,true);
});
test('direct callback does not accept a plain serialized scope',async()=>{
 const f=setup();await assert.rejects(f.callback({signal:{aborted:false}}),/scope_closed/);assert.equal(f.calls,0);
});
