import test from 'node:test';
import assert from 'node:assert/strict';
import { planFleetDagAdmission } from '../supabase/a2-browser-native-supervisor-v1/fleet-coordination-dag.mjs';
import { SUPERVISOR_CONTINUITY_SCHEMA, qualifySupervisorWakeReceipt } from '../src/supervisor-continuity-lease.mjs';

const task = {
  task_id: '42a42946-6a2f-4be2-9074-4783b07f613f', state: 'READY',
  role: 'IMPLEMENTER', authority_effect: false,
  task_spec: {fleet_coordination_v1:{version:1,role:'IMPLEMENTER',
    resource:'COMPUTE',slots:1,dependencies:[]}},
};
test('W5 advisory DAG admission cannot assert physical lease or scheduler authority',()=>{
  const advisory=planFleetDagAdmission({active_tasks:[task],active_claims:[],completed_tasks:[]});
  assert.equal(advisory.state,'OPEN');
  assert.equal(advisory.ready,1);
  assert.equal(advisory.authority_effect,false);
  assert.equal(advisory.scheduler_authority,false);
  assert.equal(advisory.second_scheduler_loop,false);
  assert.equal(advisory.lease_authority,'EXISTING_DEVOS_FLEET_LEASE_V1');
  assert.equal(advisory.automatic_retry_allowed,false);
});
test('W5 fails closed without actual claim snapshot even for independent READY task',()=>{
  const advisory=planFleetDagAdmission({active_tasks:[task],completed_tasks:[]});
  assert.equal(advisory.state,'FENCED');
  assert.equal(advisory.ready,0);
  assert.equal(advisory.authority_effect,false);
});
test('W4 ambiguous wake has no license to be settled by an OPEN W5 DAG',()=>{
  const advisory=planFleetDagAdmission({active_tasks:[task],active_claims:[],completed_tasks:[]});
  const lease={schema:SUPERVISOR_CONTINUITY_SCHEMA,source:'OWN_POSTGRES',
    owner_id:'owner-0001',run_id:'run-0001',lease_generation:4,event_seq:12,
    pending_wake_id:'wake_12345678-1234-1234-1234-1234567890ab',
    pending_wake_epoch:3,pending_wake_cycle:9,
    pending_wake_lease_generation:4,
    pending_wake_process_incarnation_id:'incarnation-0001',pending_wake_status:'AMBIGUOUS'};
  assert.equal(advisory.state,'OPEN');
  for(const receipt of [null, {}, {source:'PAGE_READBACK'},
    {source:'NATIVE_EXECUTOR_RECEIPT',effect_state:'SENT',
      trusted_native_readback:false,receipt_sha256:'a'.repeat(64)}]){
    const outcome=qualifySupervisorWakeReceipt(receipt,lease);
    assert.equal(outcome.state,'UNRESOLVED');
    assert.equal(outcome.authority_effect,false);
    assert.equal(outcome.automatic_retry_allowed,false);
  }
  // This is an independent safety contract, not yet W4/W5 physical integration.
});
