import test from 'node:test';
import assert from 'node:assert/strict';
import {DevOsNativeTaskCycle} from '../src/devos-native-task-cycle-core.mjs';
const id='11111111-1111-4111-8111-111111111111';
const lease={task_id:id,agent_id:'agent_'+id,target_id:'codex-cli:'+id,tab_id:'native-coding:'+id,
  lease_generation:1,agent_generation_epoch:1,role:'IMPLEMENTER',base_sha:'a'.repeat(40)};
const fleet={schema:'metaengine.browser.fleet-snapshot.v1',agents:[],policy:{warm_agents:0,spawn_burst_limit:1}};

test('one existing cycle dispatches and observes native leases without browser clicks, new tabs or another scheduler',async()=>{
  const calls=[],providers={schema:'metaengine.native-coding.providers.v1',providers:[]};let turn=0;
  const runtime={observeProviders:async()=>providers,dispatchLease:async raw=>{assert.deepEqual(raw,lease);calls.push('dispatch');return{state:'STARTED'};},
    observeLease:async raw=>{assert.deepEqual(raw,lease);calls.push('observe');return{state:'RUNNING'};},completeFromTrustedCommand:async()=>({state:'RESULT_READY'})};
  const cycle=new DevOsNativeTaskCycle({getState:async()=>({fleet}),executeCommand:async()=>{throw Error('unexpected_browser_effect');},
    signedRequest:async(route,{payload})=>{
      assert.equal(route,'/v1/devos/cycle');assert.equal(payload.native_coding,providers);assert.deepEqual(payload.fleet.agents,[]);
      const body={schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:8,running:1},
        leases:turn++===0?[lease]:[],running:turn===1?[]:[lease]};
      return{status:200,ok:true,json:async()=>body};
    }});
  cycle.bindNativeCodingRuntime(runtime);
  assert.equal((await cycle.cycle()).dispatch.state,'STARTED');
  assert.equal((await cycle.cycle()).result_ready.state,'RUNNING');
  assert.deepEqual(calls,['dispatch','observe']);
});

test('a native lease cannot fall through to the browser dispatcher when the private runtime is absent',async()=>{
  const cycle=new DevOsNativeTaskCycle({getState:async()=>({fleet}),executeCommand:async()=>{throw Error('browser_effect_forbidden');},
    signedRequest:async()=>({status:200,ok:true,json:async()=>({schema:'metaengine.devos.browser-cycle.v1',lease})})});
  await assert.rejects(cycle.cycle(),/native_coding_runtime_unbound/);
  assert.throws(()=>cycle.bindNativeCodingRuntime({dispatchLease(){}}),/runtime_invalid/);
});

for(const failOne of [false,true])test(`all accepted native leases are serviced with bounded concurrency (failure=${failOne})`,async()=>{
 const leases=Array.from({length:9},(_,i)=>{
  const uuid='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  return {...lease,task_id:uuid,agent_id:'agent_'+uuid,target_id:'codex-cli:'+uuid,tab_id:'native-coding:'+uuid};
 });
 let active=0,peak=0;const calls=[];
 const runtime={observeProviders:async()=>({schema:'metaengine.native-coding.providers.v1',providers:[]}),
  dispatchLease:async raw=>{calls.push(raw.task_id);active++;peak=Math.max(peak,active);
   try{await new Promise(resolve=>setTimeout(resolve,5));if(failOne&&raw.task_id===leases[1].task_id)throw Error('one_fixture_failure');return {state:'STARTED',task_id:raw.task_id};}
   finally{active--;}
  },observeLease:async()=>({state:'RUNNING'}),completeFromTrustedCommand:async()=>({state:'RESULT_READY'})};
 const cycle=new DevOsNativeTaskCycle({getState:async()=>({fleet}),executeCommand:async()=>{throw Error('unexpected_browser_effect');},
  signedRequest:async()=>({status:200,ok:true,json:async()=>({schema:'metaengine.devos.browser-cycle.v1',leases,running:[]})})});
 cycle.bindNativeCodingRuntime(runtime);
 const result=await cycle.cycle();
 assert.equal(calls.length,9,'a concurrency budget must not discard already allocated leases');
 assert.deepEqual(new Set(calls),new Set(leases.map(row=>row.task_id)));
 assert.ok(peak<=4&&peak>1);assert.equal(active,0);
 assert.equal(result.dispatch.results.length,9);
 assert.equal(result.dispatch.dispatched,failOne?8:9);assert.equal(result.dispatch.failed,failOne?1:0);
});

test('running native leases beyond the browser-sized observation budget are not starved',async()=>{
 const running=Array.from({length:9},(_,i)=>({...lease,task_id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')}));
 const observed=[];
 const runtime={observeProviders:async()=>({schema:'metaengine.native-coding.providers.v1',providers:[]}),
  dispatchLease:async()=>{throw Error('unexpected_new_dispatch');},observeLease:async raw=>{observed.push(raw.task_id);return {state:'RUNNING'};},completeFromTrustedCommand:async()=>({state:'RESULT_READY'})};
 const cycle=new DevOsNativeTaskCycle({getState:async()=>({fleet}),executeCommand:async()=>{throw Error('unexpected_browser_effect');},
  signedRequest:async()=>({status:200,ok:true,json:async()=>({schema:'metaengine.devos.browser-cycle.v1',leases:[],running})})});
 cycle.bindNativeCodingRuntime(runtime);
 for(let i=0;i<3;i++)assert.equal((await cycle.cycle()).result_ready_batch.observed,4);
 assert.equal(new Set(observed).size,9,'later running leases must eventually receive readback even when earlier workers stay running');
});
