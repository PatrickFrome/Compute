import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaOrchestratorNativeProvider } from '../src/meta-orchestrator-native-provider.mjs';

const workspace='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId='98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const identity={
  async ensure(){return{device_id:'11111111-1111-4111-8111-111111111111'}},
  async deviceHeaders(){return{'x-test-signature':'ok'}},
};

test('effectful admission has a bounded AbortSignal and remains no-hidden-retry',async()=>{
  const calls=[];
  const provider=new MetaOrchestratorNativeProvider({
    identity,
    workspace_id:workspace,
    baseUrl:'https://provider.test',
    runtimePath:'/native',
    effectDeadlineMs:1500,
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return new Response(JSON.stringify({
        schema:'metaengine.meta-orchestrator.task-admission.v1',
        workspace_id:workspace,
        roadmap_id:'metaengine-development-os-v1',
        plan_generation:3,
        point_id:'devos_ide_v1',
        task_id:taskId,
        task_payload_returned:false,
        scheduler_identity_returned:false,
        automatic_retry_allowed:false,
        task_content_authority:false,
        scheduler_authority:false,
        browser_authority:false,
        release_authority:false,
        authority_effect:false,
      }),{status:200,headers:{'content-type':'application/json'}});
    },
  });
  const out=await provider.admitTask({roadmap_id:'metaengine-development-os-v1',plan_generation:3,point_id:'devos_ide_v1'});
  assert.equal(out.task_id,taskId);
  assert.equal(calls.length,1);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(provider.snapshot().effect_deadline_ms,1500);
  assert.equal(provider.snapshot().effect_timeout_requires_authoritative_readback,true);
  assert.equal(provider.snapshot().automatic_retry,false);
});
