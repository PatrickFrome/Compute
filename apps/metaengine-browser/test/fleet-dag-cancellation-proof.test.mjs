import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { falsifyFleetDagCancellationProof } from '../supabase/a2-browser-native-supervisor-v1/fleet-dag-cancellation-proof.mjs';
import { planFleetDagAdmission } from '../supabase/a2-browser-native-supervisor-v1/fleet-coordination-dag.mjs';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const sourceSha = 'a'.repeat(40);
const proofSha = 'f'.repeat(64);
const open = Object.freeze({ schema:'metaengine.devos.environment-state.v1',
  state:'OPEN', authoritative:true, authority_effect:false, continuous_service_allowed:true });
const stopped = Object.freeze({ ...open, state:'CLOSED', continuous_service_allowed:false, reason:'EMERGENCY_STOP' });
const spec = (role, dependencies = [], resource = 'BROWSER', slots = 1) =>
  ({ version:1,role,resource,slots,dependencies });
const task = (n, role = 'IMPLEMENTER', deps = [], resource = 'BROWSER', slots = 1) =>
  ({task_id:id(n),role,state:'READY',priority:100-n,authority_effect:false,
    task_spec:{fleet_coordination_v1:spec(role,deps,resource,slots)}});
const completed = (n, role = 'RESEARCHER') =>
  ({...task(n,role),state:'COMPLETED',result_sha256:proofSha,proof_verified:true,
    lease_generation:1,lease_agent_id:'agent_old'});
const inflight = (n, role = 'IMPLEMENTER', resource = 'BROWSER', slots = 1) =>
  ({...task(n,role,[],resource,slots),state:'RUNNING',lease_generation:2,
    lease_agent_id:'agent_running'});
const claim = (t, state = 'ACTIVE', overrides = {}) =>
  ({task_id:t.task_id,agent_id:t.lease_agent_id,lease_generation:t.lease_generation,
    state,expires_at:'1999-01-01T00:00:00Z',...overrides});
const snap = (tasks, claims = [], done = []) =>
  ({active_tasks:tasks,active_claims:claims,completed_tasks:done,authority_effect:false,recent_events:[]});
const check = (snapshot,extra={}) =>
  falsifyFleetDagCancellationProof({snapshot,runtimeControl:open,...extra});
const has = (proof,reason) => assert(proof.reasons.includes(reason), proof.reasons.join(','));
const agent = n => ({agent_id:'agent_worker-'+String(n).padStart(4,'0'),role:'IMPLEMENTER',
  lifecycle_state:'ACTIVE',tab_id:'tab-'+n,target_id:'webcontents:'+(10+n),generation_epoch:3});

test('lost child is BLOCKED/AMBIGUOUS, never COMPLETED and never unlocks dependent DAG',()=>{
  const parent=task(1,'CRITIC',[id(2)]);
  for (const state of ['FAILED','BLOCKED','AMBIGUOUS','CANCELLED','FENCED']) {
    const child={...completed(2),state};
    assert.equal(planFleetDagAdmission(snap([parent],[],[child])).ready,0);
    assert.equal(planFleetDagAdmission(snap([parent],[],[child])).blocked[parent.task_id],'DEPENDENCY_PROOF_UNKNOWN');
  }
});
test('cycle and duplicate tasks remain fenced even with forged completed child metadata',()=>{
  const a=task(1,'IMPLEMENTER',[id(2)]),b=task(2,'CRITIC',[id(1)]);
  const result=check(snap([a,b]));
  assert.equal(result.admission_authorized,false); // cycle is DEGRADED, never OPEN authority
  assert.equal(planFleetDagAdmission(snap([a,b])).ready,0);
});
test('duplicate readback rejects claims; do not return a slot on double generation',()=>{
  const x=inflight(3);
  const result=check(snap([x],[claim(x),claim(x)]));
  has(result,'DUPLICATE_ACTIVE_CLAIM');
  assert.equal(result.returned_slots,0);
  assert.equal(result.admission_authorized,false);
});
test('stale claim timestamp alone never releases a capacity slot',()=>{
  const running=inflight(4,'IMPLEMENTER','HOST',2);
  const proof=check(snap([running],[claim(running)]));
  assert.equal(proof.state,'CONSISTENT_NOT_AUTHORITY');
  assert.equal(proof.active_slots,1);
  assert.equal(proof.returned_slots,0);
  assert.equal(proof.budget.resources.HOST,2);
});
test('slot return only after terminal task and exact reconciled generation from own PG',()=>{
  const running=inflight(5,'IMPLEMENTER','HOST',2);
  const before=check(snap([running],[claim(running)]));
  assert.equal(before.active_slots,1);
  const terminal={...running,state:'FENCED'};
  const after=check(snap([],[
    claim(running,'FENCED',{reconciliation:{
      source:'OWN_POSTGRES',verified:true,authority_effect:false,
      task_id:running.task_id,lease_generation:2,effect_state:'NO_UNKNOWN_EFFECT',
    }}),
  ],[terminal]));
  assert.equal(after.active_slots,0);
  assert.equal(after.returned_slots,1);
  assert.equal(after.state,'CONSISTENT_NOT_AUTHORITY');
  const altered=check(snap([],[
    claim(running,'FENCED',{reconciliation:{
      source:'OWN_POSTGRES',verified:true,authority_effect:false,
      task_id:running.task_id,lease_generation:3,effect_state:'NO_UNKNOWN_EFFECT',
    }}),
  ],[terminal]));
  has(altered,'SLOT_RETURN_PROOF_UNKNOWN');
  assert.equal(altered.returned_slots,0);
});
test('unreconciled expiry, cancellation, and uncertain effect never return slots',()=>{
  const running=inflight(6);
  const terminal={...running,state:'AMBIGUOUS'};
  const c=claim(running,'EXPIRED');
  has(check(snap([],[c],[terminal])),'SLOT_RETURN_PROOF_UNKNOWN');
  for (const effect_state of ['UNKNOWN','EFFECT_AMBIGUOUS']) {
    const row=claim(running,'FENCED',{reconciliation:{
      source:'OWN_POSTGRES',verified:true,authority_effect:false,
      task_id:running.task_id,lease_generation:2,effect_state,
    }});
    assert.equal(check(snap([],[row],[terminal])).returned_slots,0);
  }
  has(check(snap([running],[claim(running,'EXPIRED')])),'INFLIGHT_WITHOUT_ACTIVE_CLAIM');
});
test('unknown/orphan active claim cannot create spare physical capacity',()=>{
  const row=task(7);
  const proof=check(snap([row],[{
    task_id:id(10),agent_id:'agent_foreign',lease_generation:1,state:'ACTIVE',
  }]));
  has(proof,'ORPHAN_ACTIVE_CLAIM');
  assert.equal(proof.state,'FENCED');
});
test('mixed role/resource overbudget and forged claim ownership fail closed',()=>{
  const a=inflight(8,'IMPLEMENTER','HOST',2);
  const b=inflight(9,'RESEARCHER','HOST',2); b.lease_agent_id='agent_other';
  const proof=check(snap([a,b],[claim(a),claim(b)]));
  has(proof,'RESOURCE_CAPACITY_EXCEEDED');
  const mismatch=check(snap([a],[claim(a,'ACTIVE',{lease_generation:1})]));
  has(mismatch,'LEASE_BINDING_OR_STATE_CONFLICT');
});
test('emergency stop forbids admission without cancel effect, model text has no authority',()=>{
  const snapshot=snap([task(11)]);
  const p=falsifyFleetDagCancellationProof({
    snapshot,runtimeControl:stopped,leaseBatch:[],
  });
  has(p,'EMERGENCY_STOP_OR_ADMISSION_CLOSED');
  assert.equal(p.cancellation_effect,false);
  assert.equal(p.effect_authority,false);
  assert.equal(p.automatic_retry_allowed,false);
});
test('same task, agent, or generation replay in lease batch cannot double-admit',()=>{
  const t=task(12);
  const l={leased:true,task_id:id(12),agent_id:'agent_fresh',
    role:'IMPLEMENTER',lease_generation:1,base_sha:sourceSha,
    authority_effect:false,automatic_retry_allowed:false};
  has(check(snap([t]),{leaseBatch:[l,l]}),'DUPLICATE_OR_UNBOUND_LEASE_RECEIPT');
  const first=inflight(12);
  has(check(snap([first],[claim(first)]),{leaseBatch:[l]}),'LEASE_REPLAYS_ACTIVE_CLAIM');
});
test('source-only claim guard remains canonical: no extra queue or executor introduced',()=>{
  const sql=readFileSync(new URL('../../../infra/client-state-runtime/fleet-coordination-claim-guard-v1.sql',import.meta.url),'utf8');
  assert.match(sql,/before insert on destruktion_meta\.devos_fleet_claim_h205f22/i);
  assert.match(sql,/pg_advisory_xact_lock/i);
  assert.match(sql,/fleet_coordination_duplicate_live_claim/i);
  assert.doesNotMatch(sql,/create\s+table|create\s+function\s+public\.devos_fleet_lease_v1/i);
});
test('actual leased supervisor cycle fences a stopped runtime before any RPC or effect',async()=>{
  const calls=[];
  const handler=createDevosSupervisorRoutes({
    workspaceId,readRuntimeControl:async()=>stopped,
    rpc:async name=>{calls.push(name);throw Error('no RPC expected: '+name);},
  });
  const r=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[agent(1)]}}});
  const body=await r.json();
  assert.deepEqual(calls,[]);
  assert.equal(body.state,'ADMISSION_FENCED');
  assert.equal(body.lease_attempts,0);
  assert.equal(body.leases.length,0);
  assert.equal(body.automatic_retry_allowed,false);
  assert.equal(body.authority_effect,false);
});
test('actual leased supervisor cycle refuses cyclic DAG without issuing a lease',async()=>{
  let leases=0,completions=0;
  const rpc=async(name)=>{
    if(name==='devos_fleet_reconcile_v1')return {authority_effect:false,expired_tasks_fenced_ambiguous:0};
    if(name==='devos_fleet_snapshot_v1')return snap([
      task(20,'IMPLEMENTER',[id(21)]),task(21,'CRITIC',[id(20)]),
    ]);
    if(name==='devos_fleet_lease_v1')leases++;
    if(name==='devos_fleet_complete_v1')completions++;
    throw Error('unavailable:'+name);
  };
  const handler=createDevosSupervisorRoutes({workspaceId,readRuntimeControl:async()=>open,rpc});
  const r=await handler({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'device',body:{fleet:{agents:[agent(1)]}}});
  const body=await r.json();
  assert.equal(body.fleet_dag_admission.ready,0);
  assert.equal(body.lease_attempts,0);
  assert.equal(body.lease,null);
  assert.equal(leases,0);
  assert.equal(completions,0);
  assert.equal(body.second_scheduler_loop,false);
});
