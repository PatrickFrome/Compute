import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { rsiRuntimeSkillLifecycleTrustRootSnapshot } from '../src/rsi-runtime-skill-lifecycle.mjs';

const LIFECYCLE_URL=new URL('../src/rsi-runtime-skill-lifecycle.mjs',import.meta.url);
const SERVICE_URL=new URL('../src/rsi-runtime-service.mjs',import.meta.url);

function slice(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start);
  assert.notEqual(start,-1,`missing ${startMarker}`);
  assert.notEqual(end,-1,`missing ${endMarker}`);
  return source.slice(start,end);
}

test('Phase36 effect requires a durable zero-effect certificate ledger record before preparation',async()=>{
  const service=await fs.readFile(SERVICE_URL,'utf8');
  const prepare=slice(service,'async prepareSkillExposureReleaseAttempt({','async executeSkillExposureReleaseAttempt({');
  const ledgerRead=prepare.indexOf('this.#skillExposureCertificateLedger.get(certificate_id)');
  const recordDigestFence=prepare.indexOf('record.record_digest !== String(certificate_record_digest');
  const lifecyclePrepare=prepare.indexOf('this.#skillLifecycle.prepareExposureReleaseAttempt');
  assert.ok(ledgerRead>=0);
  assert.ok(recordDigestFence>ledgerRead);
  assert.ok(lifecyclePrepare>recordDigestFence);
  assert.match(prepare,/certificate_can_execute_release !== false/);
  assert.match(prepare,/ledger_can_release_hold !== false/);
  assert.match(prepare,/release_effect_performed !== false/);
  assert.match(prepare,/release_certificate_record_digest: record\.record_digest/);
  assert.match(prepare,/certificate_is_effect_authority: false/);
  assert.match(prepare,/certificate_ledger_is_effect_authority: false/);
});

test('Phase36 durable ATTEMPTED fence precedes exact post-attempt readback and the single hold release',async()=>{
  const lifecycle=await fs.readFile(LIFECYCLE_URL,'utf8');
  const execute=slice(lifecycle,'async executePreparedExposureReleaseAttempt({','async reconcileExposureReleaseAttempt({');
  const attempted=execute.indexOf('await this.recordExposureReleaseAttempted');
  const reread=execute.indexOf("stage:'POST_ATTEMPT_PRE_EFFECT_READBACK'");
  const release=execute.indexOf('this.#exposureHolds.delete(row.skill_digest)');
  const persistEffect=execute.indexOf('try{await this.#persist()');
  assert.ok(attempted>=0);
  assert.ok(reread>attempted);
  assert.ok(release>reread);
  assert.ok(persistEffect>release);
  assert.match(execute,/current_state==='ATTEMPTED'\|\|row\.current_state==='RECONCILIATION_ONLY'/);
  assert.match(execute,/attempt_ambiguous_reconcile_required/);
  assert.match(execute,/expected_next_governance_digest/);
  assert.match(execute,/EXPLORATION_ACTIVE/);
  assert.match(execute,/full_activation_authorized:false/);
  assert.match(execute,/same_effect_id_retry_allowed:false/);
});

test('Phase36 ambiguity reconciliation is readback-only and cannot replay the exposure effect',async()=>{
  const lifecycle=await fs.readFile(LIFECYCLE_URL,'utf8');
  const reconcile=slice(lifecycle,'async reconcileExposureReleaseAttempt({','exposureReleaseAttemptSnapshot(');
  assert.doesNotMatch(reconcile,/exposureHolds\.delete/);
  assert.doesNotMatch(reconcile,/executePreparedExposureReleaseAttempt/);
  assert.doesNotMatch(reconcile,/recordExposureReleaseAttempted/);
  assert.match(reconcile,/CONFIRMED_EXPOSURE_RELEASED/);
  assert.match(reconcile,/CONFIRMED_NOT_RELEASED_NEW_ATTEMPT_REQUIRED/);
  assert.match(reconcile,/additional_effect_attempt_performed:false/);
  assert.match(reconcile,/same_effect_id_retry_allowed:false/);
});

test('Phase36 release-attempt evidence is bounded to 64 KiB and exact-record bound',async()=>{
  const lifecycle=await fs.readFile(LIFECYCLE_URL,'utf8');
  assert.match(lifecycle,/MAX_EXPOSURE_RELEASE_ATTEMPT_BYTES=64\*1024/);
  assert.match(lifecycle,/attempt_payload_budget_exceeded/);
  assert.match(lifecycle,/release_certificate_record_digest/);
  assert.match(lifecycle,/durable_verified_release_certificate_record_required:true/);
  const root=rsiRuntimeSkillLifecycleTrustRootSnapshot();
  assert.equal(root.durable_verified_release_certificate_record_required,true);
  assert.equal(root.exposure_release_attempt_payload_max_bytes,64*1024);
  assert.equal(root.exposure_release_effect_attempt_limit,1);
  assert.equal(root.blind_retry_for_exposure_release_effect,false);
  assert.equal(root.exposure_release_pre_effect_readback_after_attempt_persist_required,true);
  assert.equal(root.ambiguous_exposure_release_readback_only_reconciliation,true);
  assert.equal(root.exposure_release_is_exploration_only,true);
  assert.equal(root.full_activation_via_exposure_release_forbidden,true);
  assert.equal(root.authority_effect,false);
});

test('Phase36 runtime wrappers grant no browser task scheduler promotion or self-update authority',async()=>{
  const service=await fs.readFile(SERVICE_URL,'utf8');
  const execute=slice(service,'async executeSkillExposureReleaseAttempt({','async reconcileSkillExposureReleaseAttempt({');
  const reconcile=slice(service,'async reconcileSkillExposureReleaseAttempt({','skillExposureReleaseAttemptSnapshot(');
  for(const section of [execute,reconcile]){
    assert.match(section,/browser_authority: false/);
    assert.match(section,/task_authority: false/);
    assert.match(section,/scheduler_authority: false/);
    assert.match(section,/promotion_authority: false/);
    assert.match(section,/self_update_authority: false/);
    assert.match(section,/automatic_retry_allowed: false/);
    assert.match(section,/authority_effect: false/);
  }
});
