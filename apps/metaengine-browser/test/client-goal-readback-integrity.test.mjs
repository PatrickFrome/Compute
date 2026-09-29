import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeClientGoalActivationReadback, normalizeClientGoalIntent } from '../src/client-control-contract.mjs';

const workspace = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const task = '655d2460-9077-437c-848a-860b71e63791';
const point = 'obj.integrity-check.v1';
const goal = 'Verify one exact goal receipt';
const zero = { automatic_retry_allowed:false, scheduler_authority:false, browser_authority:false, release_authority:false, authority_effect:false };
function receipt() {
  return {
    schema:'metaengine.meta-orchestrator.objective-activation.v1', objective:goal,
    roadmap_id:'metaengine-client-v1', plan_generation:3, point_ids:[point], node_count:1,
    task_ids:[task], task_admission_state:'ADMITTED', atomic_plan_and_admission:true, operator_initiated:true, ...zero,
    activation:{schema:'metaengine.meta-orchestrator.plan-state.v1', workspace_id:workspace,
      roadmap_id:'metaengine-client-v1', plan_generation:3, alignment_epoch:2, baseline_sha:'a'.repeat(40),
      plan_sha256:'b'.repeat(64), state:'ACTIVE', ...zero},
    admission:{schema:'metaengine.meta-orchestrator.task-admission.v1', workspace_id:workspace,
      roadmap_id:'metaengine-client-v1', plan_generation:3, alignment_epoch:2, point_id:point,
      task_id:task, task_spec_sha256:'c'.repeat(64), task_payload_returned:false,
      scheduler_identity_returned:false, task_content_authority:false, ...zero},
  };
}

test('a complete consistent SQL receipt is accepted and its binding retained', () => {
  const out=normalizeClientGoalActivationReadback(receipt(),goal);
  assert.equal(out.task_id,task);
  assert.equal(out.workspace_id,workspace);
  assert.equal(out.alignment_epoch,2);
  assert.equal(out.baseline_sha,'a'.repeat(40));
  assert.equal(out.plan_sha256,'b'.repeat(64));
  assert.equal(out.task_spec_sha256,'c'.repeat(64));
});

const corruptions = [
  ['missing activation',r=>delete r.activation],
  ['different workspace',r=>r.admission.workspace_id='11111111-1111-4111-8111-111111111111'],
  ['malformed workspace',r=>{r.activation.workspace_id='';r.admission.workspace_id='';}],
  ['different roadmap',r=>r.admission.roadmap_id='other-roadmap'],
  ['different activation generation',r=>r.activation.plan_generation=2],
  ['different admission generation',r=>r.admission.plan_generation=4],
  ['different alignment epoch',r=>r.admission.alignment_epoch=3],
  ['superseded activation',r=>r.activation.state='SUPERSEDED'],
  ['invalid point syntax',r=>{r.point_ids=['bad point'];r.admission.point_id='bad point';}],
  ['missing plan digest',r=>delete r.activation.plan_sha256],
  ['malformed task digest',r=>r.admission.task_spec_sha256='no'],
  ['nested retry permission',r=>r.admission.automatic_retry_allowed=true],
  ['missing nested permission',r=>delete r.activation.browser_authority],
  ['task payload exposed',r=>r.admission.task_payload_returned=true],
  ['scheduler identity exposed',r=>r.admission.scheduler_identity_returned=true],
  ['boolean generation coercion',r=>{r.plan_generation=true;r.activation.plan_generation=true;r.admission.plan_generation=true;}],
  ['array generation coercion',r=>{r.plan_generation=[3];r.activation.plan_generation=[3];r.admission.plan_generation=[3];}],
  ['boolean node count',r=>r.node_count=true],
];
for(const [name,mutate] of corruptions) test(`rejects ${name}`,()=>{
  const r=receipt();mutate(r);
  assert.throws(()=>normalizeClientGoalActivationReadback(r,goal),/client_goal_/);
});
test('goal content must be a string, never object coercion',()=>{
  for(const input of [{goal:42},{goal:{toString:()=>goal}},{goal:['text']}]) {
    assert.throws(()=>normalizeClientGoalIntent(input),/client_goal_invalid/);
  }
});
