import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { rsiRuntimeSkillLifecycleTrustRootSnapshot } from '../src/rsi-runtime-skill-lifecycle.mjs';

const LIFECYCLE_URL=new URL('../src/rsi-runtime-skill-lifecycle.mjs',import.meta.url);
const SERVICE_URL=new URL('../src/rsi-runtime-service.mjs',import.meta.url);

function methodSlice(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start);
  assert.notEqual(start,-1,`missing ${startMarker}`);
  assert.notEqual(end,-1,`missing ${endMarker}`);
  return source.slice(start,end);
}

test('Phase36 exposure release effect is durable one-attempt and refuses replay after ATTEMPTED',async()=>{
  const source=await fs.readFile(LIFECYCLE_URL,'utf8');
  const execute=methodSlice(source,'async executePreparedExposureReleaseAttempt({','async reconcileExposureReleaseAttempt({');
  const durableAttempt=execute.indexOf('await this.recordExposureReleaseAttempted');
  const preEffectReadback=execute.indexOf('POST_ATTEMPT_PRE_EFFECT_READBACK');
  const holdRelease=execute.indexOf('this.#admissionExposureHolds.delete(row.skill_digest)');
  const confirmedPersist=execute.indexOf("this.#appendExposureReleaseState(row,'CONFIRMED_EXPLORATION_EXPOSURE'");
  assert.ok(durableAttempt>=0);
  assert.ok(preEffectReadback>durableAttempt);
  assert.ok(holdRelease>preEffectReadback);
  assert.ok(confirmedPersist>holdRelease);
  assert.match(execute,/current_state==='ATTEMPTED'\|\|row\.current_state==='RECONCILIATION_ONLY'/);
  assert.match(execute,/attempt_ambiguous_reconcile_required/);
  assert.match(execute,/PRE_EFFECT_DRIFT_NEW_ATTEMPT_REQUIRED/);
  assert.match(execute,/expected_next_governance_digest/);
  assert.match(execute,/EXPLORATION_ACTIVE/);
  assert.match(execute,/full_activation_authorized:false/);
});

test('Phase36 reconciliation is readback-only and cannot replay the hold release effect',async()=>{
  const source=await fs.readFile(LIFECYCLE_URL,'utf8');
  const reconcile=methodSlice(source,'async reconcileExposureReleaseAttempt({','exposureReleaseAttemptSnapshot(');
  assert.doesNotMatch(reconcile,/admissionExposureHolds\.delete/);
  assert.doesNotMatch(reconcile,/executePreparedExposureReleaseAttempt/);
  assert.match(reconcile,/CONFIRMED_EXPLORATION_EXPOSURE_BY_READBACK/);
  assert.match(reconcile,/CONFIRMED_NO_EFFECT_NEW_ATTEMPT_REQUIRED/);
  assert.match(reconcile,/additional_effect_attempt_performed:false/);
  assert.match(reconcile,/same_effect_id_retry_allowed:false/);
});

test('Phase36 release attempt is bounded and exact-root fenced',async()=>{
  const source=await fs.readFile(LIFECYCLE_URL,'utf8');
  assert.match(source,/MAX_EXPOSURE_RELEASE_ATTEMPT_BYTES=64\*1024/);
  assert.match(source,/attempt_payload_budget_exceeded/);
  assert.match(source,/current_library_digest/);
  assert.match(source,/current_governance_digest/);
  assert.match(source,/expected_next_governance_digest/);
  assert.match(source,/admission_provenance_digest/);
  assert.match(source,/effect_executor_identity_digest/);
  assert.match(source,/idempotency_key_digest/);
  assert.match(source,/only_target_exposure_hold_may_change:true/);
});

test('Phase36 runtime service exposes only prepare execute reconcile and readback wrappers',async()=>{
  const source=await fs.readFile(SERVICE_URL,'utf8');
  for(const marker of [
    'prepareSkillExposureReleaseAttempt({',
    'executeSkillExposureReleaseAttempt({',
    'reconcileSkillExposureReleaseAttempt({',
    'skillExposureReleaseAttemptSnapshot(attempt_id)',
  ]) assert.ok(source.includes(marker),marker);
  const execute=methodSlice(source,'async executeSkillExposureReleaseAttempt({','async reconcileSkillExposureReleaseAttempt({');
  assert.match(execute,/SKILL_EXPOSURE_RELEASE_EFFECT_CONFIRMED/);
  assert.match(execute,/full_activation_authorized: false/);
  assert.match(execute,/automatic_retry_allowed: false/);
  assert.match(execute,/authority_effect: false/);
});

test('Phase36 lifecycle trust root keeps release bounded to exploration with no blind retry',()=>{
  const root=rsiRuntimeSkillLifecycleTrustRootSnapshot();
  assert.equal(root.exposure_release_attempts_durable_before_effect,true);
  assert.equal(root.exposure_release_effect_attempt_limit,1);
  assert.equal(root.blind_retry_for_exposure_release_effect,false);
  assert.equal(root.exposure_release_pre_effect_readback_after_attempt_persist_required,true);
  assert.equal(root.ambiguous_exposure_release_effect_requires_readback_only_reconciliation,true);
  assert.equal(root.exposure_release_only_to_exploration_active,true);
  assert.equal(root.full_activation_from_exposure_release_forbidden,true);
  assert.equal(root.authority_effect,false);
});
