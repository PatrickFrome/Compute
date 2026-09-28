import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const mkLease = (n, tabId, targetId = `webcontents:1${n}`) => ({
  task_id: `09f2e414-5c31-4fc7-87a3-f5de1315cb8${n}`,
  agent_id: `agent_a2bf77e6-66d3-4f10-9c9c-683df36f45${n}${n}`,
  role: 'IMPLEMENTER',
  tab_id: tabId,
  target_id: targetId,
  agent_generation_epoch: 7,
  lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: `work/devos-concurrent-v1-${n}`,
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: `Implement slice ${n}.`, constraints: [], deliverable: 'tests' },
});
const conversationUrl = (n) => `https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789ab${n}`;
const semref = (id) => ({ schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:'semref_' + String(id).padEnd(64,'0').slice(0,64) });

function frame({ lease, n, stop = false }){
  return {
    schema:'metaengine.native-browser.perception.v1',
    process_incarnation_id:'process_test_incarnation_0001',
    tab_id:lease.tab_id,
    target_id:lease.target_id,
    url:conversationUrl(n),
    viewport:{width:0,height:0},
    semantic_targets:[
      { role:'textbox', name:'Describe your task', value_length:0, semantic_ref:semref(`composer-${n}`), backend_node_id:3+n },
      ...(stop ? [{role:'button',name:null,semantic_ref:semref(`stop-${n}`),backend_node_id:30+n}] : []),
    ],
    interaction_tree:{schema:'metaengine.native-browser.interaction-tree.v1',elements:[{role:'statictext',text:'GLM-5.3-Flash'}]},
    authority_effect:false,
  };
}
function fleetOf(leases){
  return {
    schema:'metaengine.browser.fleet-snapshot.v1',
    readiness_contract:'TRANSPORT_PROOF_REQUIRED',
    policy:{warm_agents:2,spawn_burst_limit:4},
    agents:leases.map((lease,index)=>({
      agent_id:lease.agent_id, role:lease.role, lifecycle_state:'ACTIVE',
      tab_id:lease.tab_id, target_id:lease.target_id, generation_epoch:lease.agent_generation_epoch,
      transport_proof:{
        schema:'metaengine.browser.fleet-transport-proof.v1',
        tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:lease.agent_generation_epoch,
        conversation_url_sha256:sha256(conversationUrl(index+1)),
        agent_surface_sha256:String(index+1).repeat(64).slice(0,64),
        proven_at:'2026-09-28T00:00:00.000Z',authority_effect:false,
      },
      automatic_retry_allowed:false,authority_effect:false,
    })),
  };
}
const response=(status,body)=>({status,ok:status>=200&&status<300,async json(){return structuredClone(body)}});

test('D-C2: distinct canonical Agent sessions dispatch concurrently without foreground mutation', async () => {
  const leases=[
    mkLease(1,'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1'),
    mkLease(2,'tab_5c081392-f073-4a40-9a2a-f6e01a9361d2'),
  ];
  const fleet=fleetOf(leases);
  const inFlight=new Set(); let maxConcurrent=0; const typed=[];
  const executeCommand=async(command)=>{
    if(command.action==='FLEET_RECONCILE') return fleet;
    if(command.action==='SELECT_TAB') throw new Error('foreground_mutation_forbidden');
    if(command.action==='CAPTURE'){
      const n=leases.findIndex(x=>x.tab_id===command.payload.tab_id)+1;
      inFlight.add(command.payload.tab_id); maxConcurrent=Math.max(maxConcurrent,inFlight.size);
      await new Promise(r=>setTimeout(r,40)); inFlight.delete(command.payload.tab_id);
      return frame({lease:leases[n-1],n,stop:false});
    }
    if(command.action==='SEMANTIC_TYPE'){
      typed.push(command.payload.tab_id);
      return {effect_state:'PROVEN_COMPOSER_CLEARED',composer_cleared:true,new_conversation_observed:false,automatic_retry_allowed:false,authority_effect:true};
    }
    throw new Error(`unexpected:${command.action}`);
  };
  const signedRequest=async(path)=>{
    if(path==='/v1/devos/cycle') return response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:2,running:0},leases,running:[]});
    if(path==='/v1/devos/mark-running') return response(200,{state:'RUNNING'});
    throw new Error(`unexpected:${path}`);
  };
  const cycle=new DevOsNativeTaskCycle({getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),executeCommand,signedRequest});
  const out=await cycle.cycle();
  assert.equal(out.dispatch.state,'BATCH_DISPATCHED');
  assert.equal(out.dispatch.dispatched,2);
  assert.equal(out.dispatch.failed,0);
  assert.equal(maxConcurrent,2);
  assert.equal(typed.length,2);
});

test('D-C2: same-tab canonical Agent leases serialize and isolate one failed effect', async () => {
  const leaseA=mkLease(1,'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1');
  const leaseB={...mkLease(2,leaseA.tab_id,leaseA.target_id),agent_id:leaseA.agent_id,agent_generation_epoch:leaseA.agent_generation_epoch};
  const fleet=fleetOf([leaseA]);
  let active=0,maxActive=0,types=0;
  const executeCommand=async(command)=>{
    if(command.action==='FLEET_RECONCILE') return fleet;
    if(command.action==='CAPTURE'){active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,25));active--;return frame({lease:leaseA,n:1});}
    if(command.action==='SEMANTIC_TYPE'){types++;if(types===1)throw new Error('flaky_tab_effect');return {effect_state:'PROVEN_COMPOSER_CLEARED',composer_cleared:true,new_conversation_observed:false,automatic_retry_allowed:false,authority_effect:true};}
    throw new Error(`unexpected:${command.action}`);
  };
  const signedRequest=async(path)=>{
    if(path==='/v1/devos/cycle') return response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:2,running:0},leases:[leaseA,leaseB],running:[]});
    if(path==='/v1/devos/mark-running') return response(200,{state:'RUNNING'});
    throw new Error(`unexpected:${path}`);
  };
  const cycle=new DevOsNativeTaskCycle({getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),executeCommand,signedRequest});
  const out=await cycle.cycle();
  assert.equal(out.dispatch.state,'BATCH_DISPATCHED');
  assert.equal(out.dispatch.dispatched,1);
  assert.equal(out.dispatch.failed,1);
  assert.equal(maxActive,1);
  assert.match(out.dispatch.results.find(x=>x.state==='DISPATCH_FAILED').reason,/flaky_tab_effect/);
});

test('D-C3: PRECONVERSATION_ROOT can never be task-dispatched by the scheduler', async () => {
  const lease=mkLease(3,'tab_root');
  const fleet=fleetOf([lease]);
  fleet.agents[0].lifecycle_state='BOUND_UNVERIFIED';
  fleet.agents[0].transport_proof={
    schema:'metaengine.browser.fleet-transport-proof.v1',
    tab_id:lease.tab_id,target_id:lease.target_id,generation_epoch:lease.agent_generation_epoch,
    transport_stage:'PRECONVERSATION_ROOT',conversation_url_sha256:'a'.repeat(64),
    proven_at:'2026-09-28T00:00:00.000Z',authority_effect:false,
  };
  const commands=[];
  const cycle=new DevOsNativeTaskCycle({
    getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),
    executeCommand:async(command)=>{commands.push(command.action);if(command.action==='FLEET_RECONCILE')return fleet;throw new Error('task_effect_must_not_run')},
    signedRequest:async(path)=>path==='/v1/devos/cycle'?response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:1,running:0},lease,running:[]}):response(500,{}),
  });
  await assert.rejects(()=>cycle.cycle(),/devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(commands,['FLEET_RECONCILE']);
});

test('D-C1: canonical Agent task prompts still carry isolated per-agent context', async () => {
  const lease=mkLease(1,'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1');
  const fleet=fleetOf([lease]); let seen='';
  const cycle=new DevOsNativeTaskCycle({
    getState:async()=>({fleet,active_tab:{tab_id:'tab_user'},tabs:[]}),
    executeCommand:async(command)=>{
      if(command.action==='FLEET_RECONCILE')return fleet;
      if(command.action==='CAPTURE')return frame({lease,n:1});
      if(command.action==='SEMANTIC_TYPE'){seen=String(command.payload.text);return {effect_state:'PROVEN_COMPOSER_CLEARED',composer_cleared:true,new_conversation_observed:false,automatic_retry_allowed:false,authority_effect:true};}
      throw new Error(`unexpected:${command.action}`);
    },
    signedRequest:async(path)=>{
      if(path==='/v1/devos/cycle')return response(200,{schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:1,running:0},lease,running:[]});
      if(path==='/v1/devos/mark-running')return response(200,{state:'RUNNING'});
      throw new Error(`unexpected:${path}`);
    },
    identity:{agentContextTokenProof:async({agent_id,role,generation_epoch,mission_digest})=>({
      schema:'metaengine.agent-context-token.v1',client_id:'test-client',agent_id,role,generation_epoch,mission_digest,
      issued_at:'2026-09-19T12:00:00.000Z',expires_at:'2026-12-19T12:00:00.000Z',
      signature:'c2ln',token_sha256:'b'.repeat(64),public_jwk:null,key_fingerprint_sha256:null,authority_effect:false,
    })},
  });
  const out=await cycle.cycle();
  assert.equal(out.dispatch.state,'RUNNING');
  assert.match(seen,/METAENGINE FLEET TASK V1/);
  assert.match(seen,/AGENT CONTEXT \(isolated session/);
  assert.match(seen,/context_token_sha256=b{64}/);
});
