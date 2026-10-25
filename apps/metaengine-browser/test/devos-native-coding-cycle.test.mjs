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
