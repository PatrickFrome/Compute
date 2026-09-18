import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId='09f2e414-5c31-4fc7-87a3-f5de1315cb81';
const binding={
  task_id:taskId,
  agent_id:'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  lease_generation:1,
  tab_id:'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',
  target_id:'webcontents:10',
  agent_generation_epoch:7,
};
async function bodyOf(response){return JSON.parse(await response.text());}

test('stale completion fence is a deterministic fail-closed 409',async()=>{
  const route=createDevosSupervisorRoutes({
    workspaceId,
    rpc:async(name)=>{
      assert.equal(name,'devos_fleet_complete_v1');
      throw new Error('rest_400:{"message":"task_lease_fenced"}');
    },
  });
  const response=await route({
    req:{method:'POST'},
    path:'/v1/devos/complete',
    clientId:'device',
    body:{...binding,state:'COMPLETED',summary:{proof:'stale'}},
  });
  const body=await bodyOf(response);
  assert.equal(response.status,409);
  assert.equal(body.error,'task_lease_fenced');
  assert.equal(body.fenced,true);
  assert.equal(body.automatic_retry_allowed,false);
  assert.equal(body.authority_effect,false);
});

test('stale mark-running fence is a deterministic fail-closed 409',async()=>{
  const route=createDevosSupervisorRoutes({
    workspaceId,
    rpc:async(name)=>{
      assert.equal(name,'devos_fleet_mark_running_v1');
      throw new Error('rest_400:{"message":"task_lease_fenced"}');
    },
  });
  const response=await route({
    req:{method:'POST'},
    path:'/v1/devos/mark-running',
    clientId:'device',
    body:{...binding,proof:{prompt_sha256:'a'.repeat(64),conversation_url_sha256:'b'.repeat(64),effect_state:'PROVEN_GENERATING'}},
  });
  assert.equal(response.status,409);
  assert.equal((await bodyOf(response)).automatic_retry_allowed,false);
});

test('unknown database errors are never laundered into a fence response',async()=>{
  const route=createDevosSupervisorRoutes({
    workspaceId,
    rpc:async()=>{throw new Error('unexpected_database_failure');},
  });
  await assert.rejects(
    route({
      req:{method:'POST'},
      path:'/v1/devos/complete',
      clientId:'device',
      body:{...binding,state:'COMPLETED',summary:{proof:'x'}},
    }),
    /unexpected_database_failure/,
  );
});
