import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFleetDagAdmission } from '../supabase/a2-browser-native-supervisor-v1/fleet-coordination-dag.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sha='a'.repeat(64);
const task=(n,role,deps=[],resource='BROWSER',slots=1)=>({
  task_id:id(n),role,state:'READY',priority:100-n,authority_effect:false,
  task_spec:{fleet_coordination_v1:{version:1,role,resource,slots,dependencies:deps}},
});
const snap=(tasks,claims=[],completed=[])=>({active_tasks:tasks,active_claims:claims,completed_tasks:completed,authority_effect:false});
const done=(n,role='RESEARCHER',agent='agent_previous')=>({
  task_id:id(n),role,state:'COMPLETED',result_sha256:sha,proof_verified:true,authority_effect:false,lease_agent_id:agent,
});
test('existing untagged lease path stays unchanged: no parallel scheduler',()=>{
  assert.equal(planFleetDagAdmission(snap([{task_id:id(1),role:'IMPLEMENTER',state:'READY'}])),null);
});
test('researcher -> implementer -> independent critic dependency graph',()=>{
  const research=task(1,'RESEARCHER'),build=task(2,'IMPLEMENTER',[id(1)]),critic=task(3,'CRITIC',[id(2)]);
  const first=planFleetDagAdmission(snap([research,build,critic]));
  assert.deepEqual(first.by_role,{RESEARCHER:1});
  assert.equal(first.blocked[id(2)],'DEPENDENCY_PROOF_UNKNOWN');
  const second=planFleetDagAdmission(snap([build,critic],[],[done(1)]));
  assert.deepEqual(second.by_role,{IMPLEMENTER:1});
  const last=planFleetDagAdmission(snap([critic],[],[done(2,'IMPLEMENTER')]));
  assert.deepEqual(last.by_role,{CRITIC:1});
  assert.equal(last.second_scheduler_loop,false);
  assert.equal(last.authority_effect,false);
});
test('ambiguous, absent or mismatched dependency never becomes success',()=>{
  const critic=task(5,'CRITIC',[id(1)]);
  assert.equal(planFleetDagAdmission(snap([critic])).blocked[id(5)],'DEPENDENCY_PROOF_UNKNOWN');
  const proof=done(1);proof.proof_verified=false;
  assert.equal(planFleetDagAdmission(snap([critic],[],[proof])).blocked[id(5)],'DEPENDENCY_PROOF_UNKNOWN');
  const self=done(1,'IMPLEMENTER','agent_self');
  critic.lease_agent_id='agent_self';
  assert.equal(planFleetDagAdmission(snap([critic],[],[self])).blocked[id(5)],'CRITIC_NOT_INDEPENDENT');
});
test('cycles, duplicate ids, self loops and malformed schemas fail closed',()=>{
  const a=task(1,'IMPLEMENTER',[id(2)]),b=task(2,'RESEARCHER',[id(1)]);
  const cyclic=planFleetDagAdmission(snap([a,b]));
  assert.equal(cyclic.blocked[id(1)],'GRAPH_CYCLE_OR_ANCESTOR_INVALID');
  assert.equal(cyclic.blocked[id(2)],'GRAPH_CYCLE_OR_ANCESTOR_INVALID');
  assert.equal(planFleetDagAdmission(snap([a,a])).state,'FENCED');
  assert.equal(planFleetDagAdmission(snap([task(3,'CRITIC',[id(3)])])).blocked[id(3)],'GRAPH_INVALID');
  assert.equal(planFleetDagAdmission(snap([task(4,'CRITIC',[id(5),id(5)])])).blocked[id(4)],'GRAPH_INVALID');
});
test('per-role, resource, and total slot caps restrict admissions',()=>{
  const p=planFleetDagAdmission(snap([task(1,'IMPLEMENTER',[],'HOST',2),task(2,'RESEARCHER',[],'HOST',1)]));
  assert.deepEqual(p.by_role,{IMPLEMENTER:1});
  assert.equal(p.blocked[id(2)],'RESOURCE_SLOTS_FULL');
  const total=planFleetDagAdmission(snap([task(3,'CRITIC')],Array.from({length:16},()=>({state:'ACTIVE'}))));
  assert.equal(total.blocked[id(3)],'GLOBAL_SLOTS_FULL');
  const large=planFleetDagAdmission(snap(Array.from({length:129},(_,n)=>task(n+1,'IMPLEMENTER'))));
  assert.equal(large.state,'FENCED');
});
test('source claim guard is attached to existing PG lease transaction, not second queue',()=>{
  const sql=readFileSync(new URL('../../../infra/client-state-runtime/fleet-coordination-claim-guard-v1.sql',import.meta.url),'utf8');
  assert.match(sql,/before insert on destruktion_meta\.devos_fleet_claim_h205f22/i);
  assert.match(sql,/pg_advisory_xact_lock/i);
  assert.match(sql,/project_completion_ready_h205f22/i);
  assert.match(sql,/fleet_coordination_duplicate_live_claim/i);
  assert.match(sql,/fleet_coordination_critic_not_independent/i);
  assert.doesNotMatch(sql,/create\s+table|create\s+or\s+replace\s+function\s+public\.devos_fleet_lease_v1/i);
});
