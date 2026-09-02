import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-devos-routes.mjs';

const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const agent={agent_id:'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',role:'IMPLEMENTER',lifecycle_state:'ACTIVE',tab_id:'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',target_id:'webcontents:10',generation_epoch:7};
const taskId='09f2e414-5c31-4fc7-87a3-f5de1315cb81';
async function bodyOf(r){return JSON.parse(await r.text());}
function fleetAgent(id,role='IMPLEMENTER',index=1){return{agent_id:id,role,lifecycle_state:'ACTIVE',tab_id:`tab_${id}`,target_id:`webcontents:${100+index}`,generation_epoch:1};}

test('heartbeat cycle reconciles stale leases before snapshot and is the sole scheduler source',async()=>{
  const calls=[];
  const rpc=async(name,args)=>{
    calls.push([name,args]);
    if(name==='devos_fleet_reconcile_v1')return{expired_tasks_fenced_ambiguous:16,automatic_retry_allowed:false};
    if(name==='devos_fleet_snapshot_v1')return{active_tasks:[{task_id:taskId,state:'READY',role:'IMPLEMENTER'}],active_claims:[],recent_events:[]};
    if(name==='devos_fleet_lease_v1')return{leased:true,task_id:taskId,agent_id:args.p_agent,role:'IMPLEMENTER',tab_id:args.p_tab,target_id:args.p_target,agent_generation_epoch:args.p_epoch,lease_generation:1,base_sha:'724612235eb7ceb4534c13d126425b274d876394',automatic_retry_allowed:false,task_spec:{objective:'x'}};
  };
  const route=createDevosSupervisorRoutes({rpc,workspaceId});
  const out=await bodyOf(await route({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents:[agent]}},clientId:'device'}));
  assert.deepEqual(calls.slice(0,3).map(c=>c[0]),['meta_orchestrator_controller_lease_v1','devos_fleet_reconcile_v1','devos_fleet_snapshot_v1']);
  assert.equal(out.reconcile.expired_tasks_fenced_ambiguous,16);
  assert.equal(out.scheduler_source,'NATIVE_SUPERVISOR_HEARTBEAT');
  assert.equal(out.scheduler_policy,'IDLE_ROLE_FAIR_SHARE_V1');
  assert.equal(out.second_scheduler_loop,false);
  assert.equal(out.automatic_retry_allowed,false);
  assert.equal(out.lease.target_id,'webcontents:10');
});

test('busy first eight agents cannot hide a later idle agent from the bounded lease scan',async()=>{
  const agents=Array.from({length:10},(_,i)=>fleetAgent(`agent_worker-${String(i+1).padStart(4,'0')}`,'IMPLEMENTER',i+1));
  const busy=agents.slice(0,8);
  const leaseAgents=[];
  const rpc=async(name,args)=>{
    if(name==='devos_fleet_reconcile_v1')return{expired_tasks_fenced_ambiguous:0,automatic_retry_allowed:false};
    if(name==='devos_fleet_snapshot_v1')return{
      active_tasks:[{task_id:taskId,state:'READY',role:'IMPLEMENTER',priority:100,created_at:'2026-08-30T14:00:00Z'}],
      active_claims:busy.map((a,i)=>({claim_id:i+1,agent_id:a.agent_id,state:'ACTIVE'})),recent_events:[],
    };
    if(name==='devos_fleet_lease_v1'){
      leaseAgents.push(args.p_agent);
      return{leased:args.p_agent===agents[8].agent_id,task_id:taskId,agent_id:args.p_agent,role:args.p_role,tab_id:args.p_tab,target_id:args.p_target,agent_generation_epoch:args.p_epoch,lease_generation:1,base_sha:'724612235eb7ceb4534c13d126425b274d876394',automatic_retry_allowed:false,task_spec:{objective:'x'}};
    }
    throw new Error(`unexpected_rpc:${name}`);
  };
  const route=createDevosSupervisorRoutes({rpc,workspaceId});
  const out=await bodyOf(await route({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents}},clientId:'device'}));
  assert.deepEqual(leaseAgents,[agents[8].agent_id]);
  assert.equal(out.lease.agent_id,agents[8].agent_id);
  assert.equal(out.lease_attempts,1);
});

test('bounded attempts interleave idle roles instead of spending all slots on one role',async()=>{
  const implementers=Array.from({length:9},(_,i)=>fleetAgent(`agent_impl-${String(i+1).padStart(4,'0')}`,'IMPLEMENTER',i+1));
  const critic=fleetAgent('agent_critic-0001','CRITIC',20);
  const attemptedRoles=[];
  const rpc=async(name,args)=>{
    if(name==='devos_fleet_reconcile_v1')return{expired_tasks_fenced_ambiguous:0,automatic_retry_allowed:false};
    if(name==='devos_fleet_snapshot_v1')return{
      active_tasks:[
        {task_id:taskId,state:'READY',role:'IMPLEMENTER',priority:100,created_at:'2026-08-30T13:00:00Z'},
        {task_id:'31ae8653-a5b3-425e-9953-07e55d515291',state:'READY',role:'CRITIC',priority:80,created_at:'2026-08-30T14:00:00Z'},
      ],active_claims:[],recent_events:[],
    };
    if(name==='devos_fleet_lease_v1'){
      attemptedRoles.push(args.p_role);
      if(args.p_role==='CRITIC')return{leased:true,task_id:'31ae8653-a5b3-425e-9953-07e55d515291',agent_id:args.p_agent,role:args.p_role,tab_id:args.p_tab,target_id:args.p_target,agent_generation_epoch:args.p_epoch,lease_generation:1,base_sha:'724612235eb7ceb4534c13d126425b274d876394',automatic_retry_allowed:false,task_spec:{objective:'review'}};
      return{leased:false,agent_id:args.p_agent,role:args.p_role,authority_effect:false};
    }
    throw new Error(`unexpected_rpc:${name}`);
  };
  const route=createDevosSupervisorRoutes({rpc,workspaceId});
  const out=await bodyOf(await route({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents:[...implementers,critic]}},clientId:'device'}));
  assert.deepEqual(attemptedRoles,['IMPLEMENTER','CRITIC']);
  assert.equal(out.lease.role,'CRITIC');
  assert.equal(out.lease_attempts,2);
});

test('mark-running passes all lease fences and proof to DB RPC',async()=>{
  let args;
  const route=createDevosSupervisorRoutes({workspaceId,rpc:async(name,a)=>{if(name==='devos_fleet_mark_running_v1'){args=a;return{state:'RUNNING'};}}});
  const r=await route({req:{method:'POST'},path:'/v1/devos/mark-running',clientId:'device',body:{task_id:taskId,agent_id:agent.agent_id,lease_generation:1,tab_id:agent.tab_id,target_id:agent.target_id,agent_generation_epoch:7,proof:{prompt_sha256:'a'.repeat(64),conversation_url_sha256:'b'.repeat(64),effect_state:'PROVEN_GENERATING'}}});
  assert.equal(r.status,200);assert.equal(args.p_target,'webcontents:10');assert.equal(args.p_epoch,7);assert.equal(args.p_generation,1);
});

test('status readback proves terminal completion from durable event without a second write',async()=>{
  let snapshotReads=0;
  const rpc=async(name)=>{assert.equal(name,'devos_fleet_snapshot_v1');snapshotReads+=1;return{active_tasks:[],recent_events:[{task_id:taskId,event_type:'TASK_RESULT_COMPLETED',lease_generation:1,payload:{result_sha256:'c'.repeat(64),error_code:null}}]};};
  const route=createDevosSupervisorRoutes({rpc,workspaceId});
  const out=await bodyOf(await route({req:{method:'GET'},path:`/v1/devos/tasks/${taskId}/status`,body:{},clientId:'device'}));
  assert.equal(snapshotReads,1);assert.equal(out.state,'COMPLETED');assert.equal(out.result_sha256,'c'.repeat(64));assert.equal(out.automatic_retry_allowed,false);
});