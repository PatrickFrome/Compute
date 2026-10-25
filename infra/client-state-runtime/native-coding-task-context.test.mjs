import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildNativeCodingTaskContext,buildNativeCodingHistoricalTaskContext,nativeCodingCanonicalJson} from './native-coding-task-context.mjs';
const id='11111111-1111-4111-8111-111111111111';
const task=()=>({task_id:id,workspace_id:id,lease_generation:'2',lease_agent_id:'agent_11111111-1111-4111-8111-111111111111',
  lease_target_id:`codex-cli:${id}`,lease_agent_generation_epoch:'3',role:'IMPLEMENTER',base_sha:'a'.repeat(40),
  state:'LEASED',lease_expires_at:'2030-01-01T00:00:00.000Z',task_spec:{objective:'Repair the parser.',constraints:['Keep existing data.']}});
const options={projectId:id,providerId:id};
test('Host prompt is deterministic across JSON ordering and running/expiry observations',()=>{
  const first=buildNativeCodingTaskContext(task(),options);
  const second=buildNativeCodingTaskContext({...task(),state:'RUNNING',lease_expires_at:'2031-01-01T00:00:00.000Z',
    task_spec:{constraints:['Keep existing data.'],objective:'Repair the parser.'}},options);
  assert.equal(first.task_prompt,second.task_prompt);
  assert.equal(first.value.prompt_sha256,createHash('sha256').update(first.task_prompt).digest('hex'));
});
test('Host omits config/environment and ignores a supplied prompt digest',()=>{
  const candidate=task();candidate.task_spec.database_url='PRIVATE_FIXTURE_CONNECTION';
  candidate.task_spec.env={TOKEN:'PRIVATE_FIXTURE_TOKEN'};candidate.task_spec.prompt_sha256='f'.repeat(64);
  const context=buildNativeCodingTaskContext(candidate,options);
  assert.doesNotMatch(context.task_prompt,/PRIVATE_FIXTURE|TOKEN|database_url/);
  assert.notEqual(context.value.prompt_sha256,'f'.repeat(64));
});
test('exact native lease fields and a physical Critic artifact are mandatory',()=>{
  assert.throws(()=>buildNativeCodingTaskContext({...task(),lease_target_id:'webcontents:12'},options),/lease_binding_invalid/);
  assert.throws(()=>buildNativeCodingTaskContext({...task(),role:'CRITIC'},options),/critic_subject_invalid/);
  const subject={run_id:id,result_sha256:'b'.repeat(64),git_artifact_sha256:'c'.repeat(64),source_head:'a'.repeat(40)};
  const context=buildNativeCodingTaskContext({...task(),role:'CRITIC'},{...options,verificationSubject:subject});
  assert.match(context.task_prompt,/Independently assess/);
  assert.deepEqual(context.value.verification_subject,subject);
});
test('canonical envelope bytes agree across insertion order and reject non-JSON values',()=>{
  assert.equal(nativeCodingCanonicalJson({b:2,a:{z:true,c:null}}),nativeCodingCanonicalJson({a:{c:null,z:true},b:2}));
  assert.throws(()=>nativeCodingCanonicalJson({value:undefined}),/json_type/);
  assert.throws(()=>nativeCodingCanonicalJson({value:Infinity}),/json_type/);
});

test('historical reconstruction preserves expired terminal state and cannot grant a live task context',()=>{
  const candidate={...task(),state:'RESULT_READY',lease_expires_at:'2020-01-01T00:00:00.000Z'};
  const historical=buildNativeCodingHistoricalTaskContext(candidate,options);
  assert.equal(historical.value.state,'RESULT_READY');
  assert.equal(candidate.state,'RESULT_READY');
  assert.equal(historical.launch_authorized,false);
  assert.equal(historical.historical_readback_only,true);
  assert.equal(historical.task_prompt,buildNativeCodingTaskContext(task(),options).task_prompt);
  assert.throws(()=>buildNativeCodingTaskContext(candidate,options),/lease_binding_invalid/);
  assert.throws(()=>buildNativeCodingHistoricalTaskContext({...candidate,state:'RUNNING'},options),/lease_binding_invalid/);
});
