import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DevOsNativeTaskCycle, GLM_ROOT_CONVERSATION_SEED } from '../src/devos-native-task-cycle.mjs';

const read=(url)=>readFile(new URL(url,import.meta.url),'utf8');
const core=await read('../src/devos-native-task-cycle-core.mjs');
const wrapper=await read('../src/devos-native-task-cycle.mjs');
const response=(status,body)=>({status,ok:status>=200&&status<300,async json(){return structuredClone(body)}});

test('R98 Agent-session seed belongs to promotion/bootstrap, never scheduler task dispatch', () => {
  assert.match(GLM_ROOT_CONVERSATION_SEED,/METAENGINE AGENT SESSION SEED/);
  assert.match(wrapper,/NEW_TASK_DISPATCHED/);
  assert.match(wrapper,/GLM_ROOT_CONVERSATION_SEED/);
  assert.match(wrapper,/beginFleetTransportBootstrapAttempt/);
  assert.doesNotMatch(core,/#submitRootBootstrap|#ensureProvenConversation|GLM_ROOT_DRAFT_FLUSH/);
});

test('R98 scheduler fences a root worker before CAPTURE or SEMANTIC_TYPE', async () => {
  const lease={
    task_id:'86543210-1111-4222-8333-444455556666',agent_id:'agent_seed-1111',role:'IMPLEMENTER',
    tab_id:'tab_seed-2222',target_id:'webcontents:77',agent_generation_epoch:3,lease_generation:1,
    base_sha:'724612235eb7ceb4534c13d126425b274d876394',branch_name:'work/r98-seed-contract',
    automatic_retry_allowed:false,task_spec:{schema:'metaengine.devos.task.v1',objective:'must not dispatch on root'},
  };
  const fleet={
    schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',policy:{warm_agents:0,spawn_burst_limit:1},
    agents:[{agent_id:lease.agent_id,role:lease.role,lifecycle_state:'BOUND_UNVERIFIED',tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:3,
      transport_proof:{schema:'metaengine.browser.fleet-transport-proof.v1',tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:3,transport_stage:'PRECONVERSATION_ROOT',conversation_url_sha256:'a'.repeat(64),proven_at:'2026-09-28T00:00:00.000Z',authority_effect:false},
      automatic_retry_allowed:false,authority_effect:false}],
  };
  const commands=[];
  const cycle=new DevOsNativeTaskCycle({
    getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),
    executeCommand:async(command)=>{commands.push(command.action);if(command.action==='FLEET_RECONCILE')return fleet;throw new Error('unexpected_effect')},
    signedRequest:async(path)=>path==='/v1/devos/cycle'?response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:1,running:0},lease,running:[]}):response(500,{}),
  });
  await assert.rejects(()=>cycle.cycle(),/ADMISSION_FENCED/);
  assert.deepEqual(commands,['FLEET_RECONCILE']);
});
