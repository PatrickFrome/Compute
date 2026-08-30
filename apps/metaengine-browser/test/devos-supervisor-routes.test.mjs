import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-devos-routes.mjs';

const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const agent={agent_id:'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',role:'IMPLEMENTER',lifecycle_state:'ACTIVE',tab_id:'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',target_id:'webcontents:10',generation_epoch:7};
const taskId='09f2e414-5c31-4fc7-87a3-f5de1315cb81';
async function bodyOf(r){return JSON.parse(await r.text());}

test('heartbeat cycle is sole scheduler source and leases exact physical binding',async()=>{
  const calls=[];
  const rpc=async(name,args)=>{
    calls.push([name,args]);
    if(name==='devos_fleet_snapshot_v1')return{active_tasks:[{task_id:taskId,state:'READY',role:'IMPLEMENTER'}],recent_events:[]};
    if(name==='devos_fleet_lease_v1')return{leased:true,task_id:taskId,agent_id:args.p_agent,role:'IMPLEMENTER',tab_id:args.p_tab,target_id:args.p_target,agent_generation_epoch:args.p_epoch,lease_generation:1,base_sha:'724612235eb7ceb4534c13d126425b274d876394',automatic_retry_allowed:false,task_spec:{objective:'x'}};
  };
  const route=createDevosSupervisorRoutes({rpc,rest:async()=>[],workspaceId});
  const out=await bodyOf(await route({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents:[agent]}},clientId:'device'}));
  assert.equal(out.scheduler_source,'NATIVE_SUPERVISOR_HEARTBEAT');
  assert.equal(out.second_scheduler_loop,false);
  assert.equal(out.lease.target_id,'webcontents:10');
  assert.equal(calls.filter(c=>c[0]==='devos_fleet_lease_v1').length,1);
});

test('mark-running passes all lease fences and proof to DB RPC',async()=>{
  let args;
  const route=createDevosSupervisorRoutes({workspaceId,rest:async()=>[],rpc:async(name,a)=>{if(name==='devos_fleet_mark_running_v1'){args=a;return{state:'RUNNING'};}}});
  const r=await route({req:{method:'POST'},path:'/v1/devos/mark-running',clientId:'device',body:{task_id:taskId,agent_id:agent.agent_id,lease_generation:1,tab_id:agent.tab_id,target_id:agent.target_id,agent_generation_epoch:7,proof:{prompt_sha256:'a'.repeat(64),conversation_url_sha256:'b'.repeat(64),effect_state:'PROVEN_GENERATING'}}});
  assert.equal(r.status,200);
  assert.equal(args.p_target,'webcontents:10');
  assert.equal(args.p_epoch,7);
  assert.equal(args.p_generation,1);
});
