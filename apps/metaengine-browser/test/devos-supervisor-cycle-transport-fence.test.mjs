import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-devos-routes.mjs';

const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId='09f2e414-5c31-4fc7-87a3-f5de1315cb81';
function agent(id,index){return{agent_id:id,role:'IMPLEMENTER',lifecycle_state:'ACTIVE',tab_id:`tab_${id}`,target_id:`webcontents:${100+index}`,generation_epoch:1};}
async function bodyOf(response){return JSON.parse(await response.text());}

function snapshot(){return{
  active_tasks:[{task_id:taskId,state:'READY',role:'IMPLEMENTER',priority:100,created_at:'2026-09-01T00:00:00Z'}],
  active_claims:[],
  recent_events:[],
};}

test('expected transport admission fence yields a safe no-lease cycle and stops further lease attempts',async()=>{
  const agents=[agent('agent_worker-0001',1),agent('agent_worker-0002',2)];
  const attempted=[];
  const rpc=async(name,args)=>{
    if(name==='devos_fleet_reconcile_v1')return{expired_tasks_fenced_ambiguous:0,automatic_retry_allowed:false};
    if(name==='devos_fleet_snapshot_v1')return snapshot();
    if(name==='devos_fleet_lease_v1'){
      attempted.push(args.p_agent);
      throw new Error('rest_400:{"message":"devos_transport_client_actuation_lease_active"}');
    }
    throw new Error(`unexpected_rpc:${name}`);
  };
  const route=createDevosSupervisorRoutes({rpc,workspaceId});
  const response=await route({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents}},clientId:'device'});
  const out=await bodyOf(response);
  assert.equal(response.status,200);
  assert.deepEqual(attempted,[agents[0].agent_id]);
  assert.equal(out.lease,null);
  assert.equal(out.lease_fenced,true);
  assert.equal(out.lease_fence_reason,'devos_transport_client_actuation_lease_active');
  assert.equal(out.automatic_retry_allowed,false);
  assert.equal(out.authority_effect,false);
});

test('unknown lease RPC failure remains an infrastructure failure instead of being swallowed as a fence',async()=>{
  const agents=[agent('agent_worker-0001',1)];
  const rpc=async(name)=>{
    if(name==='devos_fleet_reconcile_v1')return{expired_tasks_fenced_ambiguous:0,automatic_retry_allowed:false};
    if(name==='devos_fleet_snapshot_v1')return snapshot();
    if(name==='devos_fleet_lease_v1')throw new Error('database_connection_reset');
    throw new Error(`unexpected_rpc:${name}`);
  };
  const route=createDevosSupervisorRoutes({rpc,workspaceId});
  await assert.rejects(
    route({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents}},clientId:'device'}),
    /database_connection_reset/,
  );
});
