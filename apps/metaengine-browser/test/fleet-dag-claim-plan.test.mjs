import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFleetDagClaims } from '../supabase/a2-browser-native-supervisor-v1/fleet-dag-claim-plan.mjs';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const sha = 'a'.repeat(64);
const control = Object.freeze({schema:'metaengine.devos.environment-state.v1',state:'OPEN',
  authoritative:true,authority_effect:false,continuous_service_allowed:true,
  workspace_id:workspaceId,generation_floor:8,refill_enabled:true,
  supervisor_admission_enabled:true});
const off = Object.freeze({...control,state:'CLOSED',continuous_service_allowed:false});
const graph = (n,role='IMPLEMENTER',deps=[],resource='BROWSER',slots=1) =>
  ({task_id:id(n),state:'READY',role,priority:100-n,authority_effect:false,
    task_spec:{fleet_coordination_v1:{version:1,role,resource,slots,dependencies:deps}}});
const done = n => ({...graph(n,'RESEARCHER'),state:'COMPLETED',
  result_sha256:sha,proof_verified:true,lease_agent_id:'agent_previous',
  lease_generation:1,authority_effect:false});
const active = (n,role='IMPLEMENTER',resource='BROWSER',slots=1) =>
  ({...graph(n,role,[],resource,slots),state:'RUNNING',
    lease_agent_id:'agent_worker-'+n,lease_generation:2});
const claim = (t,extra={})=>({task_id:t.task_id,agent_id:t.lease_agent_id,
  lease_generation:t.lease_generation,state:'ACTIVE',
  expires_at:'1999-01-01T00:00:00Z',...extra});
const snap = (tasks,claims=[],completed=[])=>({
  active_tasks:tasks,active_claims:claims,completed_tasks:completed,
  authority_effect:false,recent_events:[]});
const plan = (snapshot,runtimeControl=control) =>
  planFleetDagClaims({snapshot,runtimeControl});
const candidate = n=>({agent_id:'agent_worker-'+String(n).padStart(4,'0'),
  role:'IMPLEMENTER',lifecycle_state:'ACTIVE',tab_id:'tab-'+n,
  target_id:'webcontents:'+(10+n),generation_epoch:3});

test('legacy untagged fleet retains original leased executor policy',()=>{
  assert.equal(plan(snap([{task_id:id(1),role:'IMPLEMENTER',state:'READY'}])),null);
});
test('verified DAG proposals are role-bounded, not an executor or claim',()=>{
  const p=plan(snap([graph(2,'IMPLEMENTER',[id(1)])],[],[done(1)]));
  assert.equal(p.state,'OPEN');
  assert.equal(p.ready,1);
  assert.deepEqual(p.by_role,{IMPLEMENTER:1});
  assert.equal(p.remaining_slots,16);
  assert.equal(p.lease_authority,'EXISTING_DEVOS_FLEET_LEASE_V1');
  assert.equal(p.scheduler_authority,false);
  assert.equal(p.authority_effect,false);
  assert.equal(p.automatic_retry_allowed,false);
});
test('role-only RPC is never invoked for a role with a blocked sibling task',()=>{
  const good=graph(2,'IMPLEMENTER');
  const blocked=graph(1,'IMPLEMENTER',[id(3)]);
  const p=plan(snap([good,blocked]));
  assert.equal(p.ready,0);
  assert.deepEqual(p.by_role,{});
  assert.deepEqual(p.unsafe_roles,['IMPLEMENTER']);
  assert.equal(p.blocked['role:IMPLEMENTER'],'ROLE_ONLY_TASK_SELECTION_UNVERIFIED');
});
test('stop or absent owner control is fail-closed, including bogus OPEN text',()=>{
  const s=snap([graph(1)]);
  for(const runtimeControl of [null,{},off,{...control,authoritative:false},
    {...control,authority_effect:true}]) {
    const p=plan(s,runtimeControl);
    assert.equal(p.ready,0);
    assert.equal(p.state,'FENCED');
    assert.equal(p.automatic_retry_allowed,false);
  }
});
test('unknown/orphan and duplicate active claims never imply spare capacity',()=>{
  const good=graph(1);
  for(const claims of [
    [{task_id:id(55),state:'ACTIVE',lease_generation:3}],
    [claim(active(30)),claim(active(30))],
  ]){
    const p=plan(snap([good],claims));
    assert.equal(p.state,'FENCED');
    assert.equal(p.ready,0);
    assert.equal(p.remaining_slots,0);
  }
});
test('stale expiry alone cannot return a HOST slot or unlock another claim',()=>{
  const held=active(1,'IMPLEMENTER','HOST',2);
  const s=snap([held,graph(2,'RESEARCHER',[],'HOST',1)],[claim(held)]);
  const p=plan(s);
  assert.equal(p.ready,0);
  assert.equal(p.remaining_slots,15);
  assert.equal(p.blocked[id(2)],'RESOURCE_SLOTS_FULL');
  assert.equal(p.proof_state,'CONSISTENT_NOT_AUTHORITY');
});
test('role/global budgets are bounded, never overflow with mixed legacy tasks',()=>{
  const impl=Array.from({length:8},(_,i)=>active(i+10,'IMPLEMENTER','COMPUTE',1));
  const p=plan(snap([...impl,graph(1,'IMPLEMENTER')],impl.map(claim)));
  assert.equal(p.ready,0);
  assert.equal(p.blocked[id(1)],'ROLE_SLOTS_FULL');
  const mixed=plan(snap([graph(2),...Array.from({length:20},(_,i)=>({
    task_id:id(i+30),role:'IMPLEMENTER',state:'READY',authority_effect:false
  }))]));
  assert.equal(mixed.state,'FENCED');
  assert.equal(mixed.ready,0);
});
test('missing dependent verifier/independent critic fails without alternate path',()=>{
  const critic=graph(3,'CRITIC',[id(2)]);
  for(const child of [undefined,{...done(2),proof_verified:false}]) {
    const p=plan(snap([critic],[],child?[child]:[]));
    assert.equal(p.ready,0);
    assert.equal(p.by_role.CRITIC,undefined);
  }
});
test('real cycle fences unknown claim owner before existing lease RPC',async()=>{
  let leases=0;
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>control,
    rpc:async name=>{
      if(name==='devos_fleet_snapshot_v1')return snap([graph(1)],[
        {task_id:id(77),state:'ACTIVE',lease_generation:4}]);
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')leases++;
      throw Error('unavailable: '+name);
    },
  });
  const response=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
  const body=await response.json();
  assert.equal(body.fleet_dag_admission.state,'FENCED');
  assert.equal(body.lease_attempts,0);
  assert.equal(leases,0);
});
test('real cycle rechecks stop transition before claim attempt, no new scheduler',async()=>{
  let reads=0,leases=0;
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>++reads===1?control:off,
    rpc:async name=>{
      if(name==='devos_fleet_snapshot_v1')return snap([graph(1)]);
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')leases++;
      throw Error('unavailable: '+name);
    },
  });
  const response=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
  const body=await response.json();
  assert.equal(leases,0);
  assert.equal(body.lease_attempts,0);
  assert.equal(body.lease_fenced,true);
  assert.equal(body.lease_fence_reason,'FLEET_DAG_STOP_OR_OWNER_EPOCH_CHANGED');
  assert.equal(body.second_scheduler_loop,false);
});
test('role-only blocked sibling prevents physical lease in existing cycle',async()=>{
  let leases=0;
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>control,
    rpc:async name=>{
      if(name==='devos_fleet_snapshot_v1')return snap([
        graph(1,'IMPLEMENTER',[id(3)]),graph(2,'IMPLEMENTER')]);
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')leases++;
      throw Error('unavailable: '+name);
    },
  });
  const response=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
  const body=await response.json();
  assert.equal(body.fleet_dag_admission.ready,0);
  assert.equal(body.lease_attempts,0);
  assert.equal(leases,0);
});
test('valid DAG lease still flows exactly once through existing executor RPC',async()=>{
  const calls=[];
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>control,
    rpc:async(name)=>{
      calls.push(name);
      if(name==='devos_fleet_snapshot_v1')return snap([graph(1)]);
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')return {leased:true,task_id:id(1),
        agent_id:candidate(1).agent_id,role:'IMPLEMENTER',authority_effect:false};
      throw Error('unavailable: '+name);
    },
  });
  const r=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
  const body=await r.json();
  assert.equal(calls.filter(x=>x==='devos_fleet_lease_v1').length,1);
  assert.equal(body.leases.length,1);
  assert.equal(body.fleet_dag_admission.ready,1);
  assert.equal(body.lease_attempts,1);
  assert.equal(body.automatic_retry_allowed,false);
  assert.equal(body.second_scheduler_loop,false);
});
test('null native Owner callback cannot be substituted with an OPEN DB response',async()=>{
  let leases=0;
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>null,
    rpc:async name=>{
      if(name==='devos_environment_state_v1')return control;
      if(name==='devos_fleet_snapshot_v1')return snap([graph(1)]);
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')leases++;
      throw Error('unavailable: '+name);
    },
  });
  const r=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
  const body=await r.json();
  assert.equal(body.fleet_dag_admission.state,'FENCED');
  assert.equal(body.lease_attempts,0);
  assert.equal(leases,0);
});
test('generation-floor rollover fences a claim even when service is still OPEN',async()=>{
  let reads=0,leases=0;
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>++reads===1?control:{...control,generation_floor:9},
    rpc:async name=>{
      if(name==='devos_fleet_snapshot_v1')return snap([graph(1)]);
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')leases++;
      throw Error('unavailable: '+name);
    },
  });
  const r=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
  const body=await r.json();
  assert.equal(body.lease_fenced,true);
  assert.equal(body.lease_attempts,0);
  assert.equal(leases,0);
});
test('wrong workspace and unknown Owner generation cannot enter leased executor',async()=>{
  for (const forged of [
    {...control,workspace_id:id(999)},
    {...control,generation_floor:null},
  ]) {
    let leases=0;
    const handler=createDevosSupervisorRoutes({
      workspaceId,readRuntimeControl:async()=>forged,
      rpc:async name=>{
        if(name==='devos_fleet_snapshot_v1')return snap([graph(1)]);
        if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
        if(name==='devos_fleet_lease_v1')leases++;
        throw Error('unavailable: '+name);
      },
    });
    const r=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
      clientId:'device',body:{fleet:{agents:[candidate(1)]}}});
    const body=await r.json();
    assert.equal(body.fleet_dag_admission.state,'FENCED');
    assert.equal(body.fleet_dag_admission.ready,0);
    assert.equal(leases,0);
  }
});
test('canonical own-PG transaction remains sole claim writer',()=>{
  const sql=readFileSync(new URL('../../../infra/client-state-runtime/fleet-coordination-claim-guard-v1.sql',import.meta.url),'utf8');
  const source=readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/fleet-dag-claim-plan.mjs',import.meta.url),'utf8');
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/before insert on destruktion_meta\.devos_fleet_claim_h205f22/);
  assert.doesNotMatch(source,/create\s+(table|trigger)|fetch\(|setInterval\(|setTimeout\(/i);
});
