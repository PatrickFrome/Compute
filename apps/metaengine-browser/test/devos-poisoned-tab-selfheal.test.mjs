import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const source=await readFile(new URL('../src/devos-native-task-cycle.mjs',import.meta.url),'utf8');
const core=await readFile(new URL('../src/devos-native-task-cycle-core.mjs',import.meta.url),'utf8');
const response=(status,body)=>({status,ok:status>=200&&status<300,async json(){return structuredClone(body)}});

test('R98 poisoned root recovery is owned by promotion/bootstrap, not the task scheduler', () => {
  assert.match(source,/LOCAL_AGENT_NEW_TASK_AMBIGUOUS|LOCAL_PRECONVERSATION_BOOTSTRAP_AMBIGUOUS/);
  assert.match(source,/write_ahead_barrier_persisted/);
  assert.doesNotMatch(core,/POISONED_AGENT_TAB_CLOSED|fleet_task_root_draft_over_flush_limit|FLUSH_ALREADY_ATTEMPTED/);
});

test('R98 a poisoned PRECONVERSATION_ROOT never receives the real task prompt', async () => {
  const lease={
    task_id:'86543210-1111-4222-8333-444455556666',agent_id:'agent_selfheal-1111',role:'PLANNER',
    tab_id:'tab_selfheal-2222',target_id:'webcontents:77',agent_generation_epoch:3,lease_generation:1,
    base_sha:'724612235eb7ceb4534c13d126425b274d876394',branch_name:'work/r98-poison-fence',
    automatic_retry_allowed:false,task_spec:{schema:'metaengine.devos.task.v1',objective:'must remain fenced'},
  };
  const fleet={schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',policy:{warm_agents:0,spawn_burst_limit:1},agents:[{
    agent_id:lease.agent_id,role:lease.role,lifecycle_state:'BOUND_UNVERIFIED',tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:3,
    transport_proof:{schema:'metaengine.browser.fleet-transport-proof.v1',tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:3,transport_stage:'PRECONVERSATION_ROOT',conversation_url_sha256:'a'.repeat(64),proven_at:'2026-09-28T00:00:00.000Z',authority_effect:false},
    automatic_retry_allowed:false,authority_effect:false,
  }]};
  const effects=[];
  const cycle=new DevOsNativeTaskCycle({
    getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),
    executeCommand:async(command)=>{effects.push(command.action);if(command.action==='FLEET_RECONCILE')return fleet;throw new Error('unexpected_effect')},
    signedRequest:async(path)=>path==='/v1/devos/cycle'?response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:1,running:0},lease,running:[]}):response(500,{}),
  });
  await assert.rejects(()=>cycle.cycle(),/ADMISSION_FENCED/);
  assert.equal(effects.includes('SEMANTIC_TYPE'),false);
  assert.equal(effects.includes('CLOSE_TAB'),false);
});
