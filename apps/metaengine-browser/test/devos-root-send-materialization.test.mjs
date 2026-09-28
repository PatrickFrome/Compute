import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const url='https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789abc';
const sha256=(v)=>crypto.createHash('sha256').update(String(v),'utf8').digest('hex');
const semref={schema:'metaengine.native-browser.semantic-ref.v1',semantic_ref_id:'semref_'+'c'.repeat(64)};
const lease={
  task_id:'09f2e414-5c31-4fc7-87a3-f5de1315cb81',agent_id:'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role:'IMPLEMENTER',tab_id:'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',target_id:'webcontents:10',
  agent_generation_epoch:7,lease_generation:1,base_sha:'724612235eb7ceb4534c13d126425b274d876394',
  branch_name:'work/devos-native-task-dispatch-v1',automatic_retry_allowed:false,
  task_spec:{schema:'metaengine.devos.task.v1',objective:'Implement safe slice.'},
};
const proof={schema:'metaengine.browser.fleet-transport-proof.v1',tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:7,
  conversation_url_sha256:sha256(url),agent_surface_sha256:'d'.repeat(64),proven_at:'2026-09-28T00:00:00.000Z',authority_effect:false};
const fleet={schema:'metaengine.browser.fleet-snapshot.v1',readiness_contract:'TRANSPORT_PROOF_REQUIRED',policy:{warm_agents:1,spawn_burst_limit:4},
  agents:[{agent_id:lease.agent_id,role:lease.role,lifecycle_state:'ACTIVE',tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:7,transport_proof:proof,automatic_retry_allowed:false,authority_effect:false}]};
const response=(status,body)=>({status,ok:status>=200&&status<300,async json(){return structuredClone(body)}});

test('R98 task submit materializes only inside an already-proven Agent conversation', async () => {
  const calls=[];
  const frame={schema:'metaengine.native-browser.perception.v1',tab_id:lease.tab_id,target_id:lease.target_id,url,viewport:{width:0,height:0},
    semantic_targets:[{role:'textbox',name:'Describe your task',semantic_ref:semref,backend_node_id:3,value_length:0}],
    interaction_tree:{schema:'metaengine.native-browser.interaction-tree.v1',elements:[{role:'statictext',text:'GLM-5.3-Flash'}]},authority_effect:false};
  const cycle=new DevOsNativeTaskCycle({
    getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),
    executeCommand:async(command)=>{
      calls.push(command.action);
      if(command.action==='FLEET_RECONCILE')return fleet;
      if(command.action==='CAPTURE')return frame;
      if(command.action==='SEMANTIC_TYPE')return {effect_state:'PROVEN_COMPOSER_CLEARED',composer_cleared:true,new_conversation_observed:false,automatic_retry_allowed:false,authority_effect:true};
      throw new Error(`unexpected:${command.action}`);
    },
    signedRequest:async(path)=>{
      if(path==='/v1/devos/cycle')return response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:1,running:0},lease,running:[]});
      if(path==='/v1/devos/mark-running')return response(200,{state:'RUNNING'});
      throw new Error(`unexpected:${path}`);
    },
  });
  const out=await cycle.cycle();
  assert.equal(out.dispatch.state,'RUNNING');
  assert.equal(out.dispatch.proof.effect_state,'PROVEN_COMPOSER_CLEARED');
  assert.equal(out.dispatch.proof.agent_surface_sha256,'d'.repeat(64));
  assert.equal(out.dispatch.conversation_bootstrap,'PREEXISTING_ACTIVE_AGENT_SESSION');
  assert.equal(calls.filter(x=>x==='SEMANTIC_TYPE').length,1);
  assert.equal(calls.includes('TYPED_CLICK'),false);
  assert.equal(calls.includes('SELECT_TAB'),false);
});
