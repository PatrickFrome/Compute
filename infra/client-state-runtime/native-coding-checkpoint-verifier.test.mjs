import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingCheckpointVerifier} from './native-coding-checkpoint-verifier.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {checkpointFixture} from './test/native-coding-checkpoint-fixture.mjs';

const make=()=>{const f=checkpointFixture();return {...f,verifier:createNativeCodingCheckpointVerifier(f)};};
const request=f=>({project:f.project,writer:f.writer,critic:f.critic});

test('historical writer and independent ACCEPT critic bind exact protected bytes after a Host/PG restart',async()=>{
  const f=make(),result=await f.verifier.verify(request(f)),k=result.checkpoint;
  assert.equal(result.checkpoint_sha256,sha(k));assert.equal(result.canonical_checkpoint,json(k));
  assert.equal(k.schema,'metaengine.native-coding.checkpoint.v1');assert.equal(k.authority_effect,false);assert.equal(k.successor_admitted,false);
  assert.equal(k.host_process.process_incarnation_id,f.native.host_process.process_incarnation_id);
  assert.notEqual(k.host_process.process_incarnation_id,k.writer_execution_scope.host_incarnation);
  assert.equal(k.writer_execution_scope.host_incarnation,f.writer.registration.job_envelope.payload.host_process.process_incarnation_id);
  assert.equal(k.postgres.postmaster.process_incarnation_id,f.native.postgres.postmaster.process_incarnation_id);
  assert.notEqual(k.postgres.postmaster.process_incarnation_id,f.writer.permit.postgres.postmaster.process_incarnation_id);
  assert.ok(Date.parse(f.writer.permit.expires_at)<f.clock(),'expired launch evidence remains historical only');
});

test('registered result mutation or fixed-journal mismatch cannot become checkpoint evidence',async()=>{
  for(const change of [f=>f.writer.registration.result_receipt.result.summary='changed in PG',
    f=>f.receipts.get(f.writer.task.task_id).result.summary='changed on disk',
    f=>f.writer.registration.canonical_job_envelope='{}',f=>f.writer.registration.result_receipt_sha256='f'.repeat(64)]) {
    const f=make();change(f);await assert.rejects(f.verifier.verify(request(f)),/checkpoint_/);
  }
});

test('a forged historical job signature or changed original ledger scope is rejected',async()=>{
  for(const change of [f=>{f.writer.registration.job_envelope.signature='A'.repeat(86);f.refresh(f.writer);},
    f=>f.writer.execution.host_incarnation=f.native.host_process.process_incarnation_id,
    f=>f.writer.execution.scope_sha256='f'.repeat(64)]) {
    const f=make();change(f);await assert.rejects(f.verifier.verify(request(f)),/signature_invalid|historical_scope_changed/);
  }
});

test('checkpoint requires current project/device/grant and exact goal/owner/worktree binding',async()=>{
  for(const change of [f=>f.project.state='PAUSED',f=>f.project.admin_grant_epoch=2,
    f=>f.critic.permit.goal_id=randomUUID(),f=>f.critic.permit.owner_epoch=2,
    f=>f.writer.permit_binding.revoked_at=new Date().toISOString(),
    f=>f.writer.device.public_jwk.d='private-key-field',f=>f.writer.permit.worktree.root_identity_sha256='f'.repeat(64)]) {
    const f=make();change(f);await assert.rejects(f.verifier.verify(request(f)),/checkpoint_|proof_/);
  }
});

test('DONE and ACCEPT cannot override a blocked outcome, failed check, or another review subject',async()=>{
  for(const change of [f=>{f.writer.registration.result_receipt.result.outcome='BLOCKED';f.refresh(f.writer);},
    f=>{f.critic.registration.result_receipt.result.verdict='REJECT';f.refresh(f.critic);},
    f=>{f.critic.registration.result_receipt.result.checks[0].passed=false;f.refresh(f.critic);},
    f=>{f.critic.registration.result_receipt.result.subject_result_sha256='f'.repeat(64);f.refresh(f.critic);},
    f=>{f.critic.registration.result_receipt.subject_run_id=randomUUID();f.refresh(f.critic);}]) {
    const f=make();change(f);await assert.rejects(f.verifier.verify(request(f)),/checkpoint_|codex_cli_result_invalid/);
  }
});

test('a CRITIC must leave the complete reviewed Git artifact unchanged',async()=>{
  for(const change of [f=>f.critic.registration.result_receipt.git_after.artifact_sha256='f'.repeat(64),
    f=>f.critic.registration.result_receipt.git_before.diff_sha256='f'.repeat(64),
    f=>f.critic.registration.result_receipt.git_after.changed_files[0].sha256='f'.repeat(64)]) {
    const f=make();change(f);f.refresh(f.critic);await assert.rejects(f.verifier.verify(request(f)),/independent_critic_mismatch/);
  }
});

test('current physical image, candidate bytes, own PG data identity and valid kernel births remain mandatory',async()=>{
  for(const change of [f=>f.native.artifact.installed_asar_sha256='f'.repeat(64),
    f=>f.native.git.artifact_sha256='f'.repeat(64),f=>f.native.postgres.system_identifier='12345',
    f=>f.native.postgres.data_directory_identity_sha256='f'.repeat(64),
    f=>f.native.worktree.path='C:\\different',f=>f.native.host_process.process_incarnation_id='pid:1:created_100ns:12345678901234567']) {
    const f=make();change(f);await assert.rejects(f.verifier.verify(request(f)),/current_physical_candidate_changed|current_native_process_invalid/);
  }
});

test('physical change between two reads and Host close while awaiting a read fence acceptance',async()=>{
  const f=checkpointFixture();let count=0;
  const changing=createNativeCodingCheckpointVerifier({...f,readCheckpointScope:async()=>{
    const value=structuredClone(f.native);if(++count===2)value.artifact.installed_asar_sha256='f'.repeat(64);return value;
  }});
  await assert.rejects(changing.verify(request(f)),/physical_candidate_changed/);
  let release,entered;const arrived=new Promise(resolve=>{entered=resolve;});
  const blocked=createNativeCodingCheckpointVerifier({...f,readCheckpointScope:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
  const pending=blocked.verify(request(f));await arrived;blocked.close();release(structuredClone(f.native));
  await assert.rejects(pending,/checkpoint_closed/);
});
