import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime effect reconciliation is evidence-only and never re-invokes SELF_UPDATE_APPLY',()=>{
  const start=runtime.indexOf('async reconcileReleaseEffect({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'reconcileReleaseEffect missing');
  const body=runtime.slice(start,end);
  assert.match(body,/RSI_RELEASE_EFFECT_RECONCILED/);
  assert.match(body,/same_command_receipt_required: true/);
  assert.match(body,/effect_reexecution_authorized: false/);
  assert.match(body,/retry_authorized: false/);
  assert.match(body,/ambiguous_effect_replay_allowed: false/);
  assert.match(body,/release_authority_advanced_by_rsi: false/);
  assert.match(body,/self_update_invoked_by_rsi: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|applyWhenSafe|quitAndInstall|issue_native|lease_batch|complete_v5/);
});

test('runtime accepts only one reconciliation per exact executor admission',()=>{
  assert.match(runtime,/#findReleaseEffectReconciliationByAdmission/);
  assert.match(runtime,/rsi_runtime_release_effect_already_reconciled/);
  assert.match(runtime,/executor_admission_digest/);
});

test('runtime replay verifies the persisted reconciliation before restoring outcome state',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.release_effect_reconciliation\)/);
  assert.match(runtime,/verifyRsiReleaseEffectReconciliation\(row\.payload\.release_effect_reconciliation\)/);
  assert.match(runtime,/#releaseEffectReconciliationCount \+= 1/);
  assert.match(runtime,/#lastReleaseEffectReconciliationDigest/);
  assert.match(runtime,/#lastReleaseEffectOutcome/);
});

test('runtime snapshot never treats DB completion or reconciliation as release authority',()=>{
  assert.match(runtime,/release_effect_reconciliation: Object\.freeze\(\{/);
  assert.match(runtime,/db_command_completion_is_not_physical_success_proof: true/);
  assert.match(runtime,/exact_qualified_successor_required_for_confirmed_success: true/);
  assert.match(runtime,/effect_reexecution_authorized: false/);
  assert.match(runtime,/retry_authorized: false/);
  assert.match(runtime,/release_authority_advanced_by_rsi: false/);
  assert.match(runtime,/release_authority: false/);
});
