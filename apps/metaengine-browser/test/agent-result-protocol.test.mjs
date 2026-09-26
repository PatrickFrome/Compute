import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_RESULT_CLAIM_MARKER,
  parseAgentResultClaim,
  renderAgentResultProtocol,
} from '../src/agent-result-protocol.mjs';

const taskId='09f2e414-5c31-4fc7-87a3-f5de1315cb81';
const subjectTask='11111111-2222-4333-8444-555555555555';
const subjectSha='a'.repeat(64);

function block(payload){
  return `noise before
\`\`\`result
${AGENT_RESULT_CLAIM_MARKER}
${JSON.stringify(payload)}
\`\`\`
noise after`;
}

test('primary claim binds exact task and lease generation and remains non-authority',()=>{
  const out=parseAgentResultClaim(block({
    task_id:taskId,
    lease_generation:3,
    disposition:'READY',
    summary:'Implemented the bounded slice and produced exact artifacts.',
    deliverable_refs:['commit:abc'],
    evidence_refs:['ci:run-1'],
  }),{task_id:taskId,lease_generation:3,role:'IMPLEMENTER'});
  assert.equal(out.state,'CLAIM_BOUND');
  assert.equal(out.claim.disposition,'READY');
  assert.match(out.claim.claim_sha256,/^[0-9a-f]{64}$/);
  assert.equal(out.claim.model_claim_authority,false);
  assert.equal(out.claim.authority_effect,false);
});

test('primary claim rejects subject binding fields',()=>{
  const out=parseAgentResultClaim(block({
    task_id:taskId,lease_generation:1,disposition:'READY',summary:'done',
    subject_task_id:subjectTask,subject_result_sha256:subjectSha,
  }),{task_id:taskId,lease_generation:1,role:'IMPLEMENTER'});
  assert.equal(out.state,'MISSING');
  assert.match(out.invalid[0],/subject_forbidden/);
});

test('verifier claim must bind exact primary subject digest',()=>{
  const out=parseAgentResultClaim(block({
    task_id:taskId,
    lease_generation:4,
    disposition:'ACCEPT',
    summary:'Independent verification found no blocker.',
    deliverable_refs:[],
    evidence_refs:['ci:run-2'],
    subject_task_id:subjectTask,
    subject_result_sha256:subjectSha,
  }),{
    task_id:taskId,
    lease_generation:4,
    role:'CRITIC',
    expected_subject_task_id:subjectTask,
    expected_subject_result_sha256:subjectSha,
  });
  assert.equal(out.state,'CLAIM_BOUND');
  assert.equal(out.claim.subject_task_id,subjectTask);
  assert.equal(out.claim.subject_result_sha256,subjectSha);
});

test('verifier digest drift is rejected rather than accepted as another claim',()=>{
  const out=parseAgentResultClaim(block({
    task_id:taskId,
    lease_generation:4,
    disposition:'ACCEPT',
    summary:'accept',
    subject_task_id:subjectTask,
    subject_result_sha256:'b'.repeat(64),
  }),{
    task_id:taskId,
    lease_generation:4,
    role:'FALSIFIER',
    expected_subject_task_id:subjectTask,
    expected_subject_result_sha256:subjectSha,
  });
  assert.equal(out.state,'MISSING');
  assert.match(out.invalid[0],/subject_digest_binding_invalid/);
});

test('multiple claims for the same lease are ambiguous and fail closed',()=>{
  const one=block({task_id:taskId,lease_generation:2,disposition:'READY',summary:'first'});
  const two=block({task_id:taskId,lease_generation:2,disposition:'READY',summary:'second'});
  const out=parseAgentResultClaim(`${one}\n${two}`,{task_id:taskId,lease_generation:2,role:'RESEARCHER'});
  assert.equal(out.state,'AMBIGUOUS');
  assert.equal(out.claim,null);
  assert.equal(out.matching_claims,2);
});

test('result protocol renders exact verifier subject binding and labels claim non-authoritative',()=>{
  const rendered=renderAgentResultProtocol({
    task_id:taskId,
    lease_generation:7,
    role:'CRITIC',
    verification_subject:{task_id:subjectTask,result_sha256:subjectSha},
  });
  assert.match(rendered,/ACCEPT\|REJECT\|BLOCKED/);
  assert.match(rendered,new RegExp(subjectTask));
  assert.match(rendered,new RegExp(subjectSha));
  assert.match(rendered,/untrusted model output/i);
});
