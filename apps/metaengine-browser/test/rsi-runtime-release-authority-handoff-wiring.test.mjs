import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime release handoff persists evidence without invoking self-update effects',()=>{
  const start=runtime.indexOf('async prepareReleaseAuthorityHandoff({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'prepareReleaseAuthorityHandoff missing');
  const body=runtime.slice(start,end);
  assert.match(body,/RSI_RELEASE_AUTHORITY_HANDOFF_PREPARED/);
  assert.match(body,/external_release_executor_required: true/);
  assert.match(body,/separate_journaled_promotion_effect_required: true/);
  assert.match(body,/exact_live_readback_required_before_effect: true/);
  assert.match(body,/release_transaction_created: false/);
  assert.match(body,/installer_effect_started: false/);
  assert.match(body,/self_update_check_invoked: false/);
  assert.match(body,/self_update_apply_invoked: false/);
  assert.match(body,/direct_install_authorized: false/);
  assert.match(body,/direct_self_update_authorized: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|SELF_UPDATE_CHECK|persistPreInstallReceipt|beginSelfUpdateTransaction|spawn\(|exec\(/);
});

test('runtime release handoff is idempotent by promotion-review result digest',()=>{
  assert.match(runtime,/#findReleaseAuthorityHandoffByReviewResult/);
  assert.match(runtime,/rsi_runtime_release_authority_handoff_already_prepared/);
  assert.match(runtime,/promotion_review_result_digest/);
});

test('runtime replay restores release handoff state from the existing ledger',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.release_authority_handoff\)/);
  assert.match(runtime,/#releaseAuthorityHandoffCount \+= 1/);
  assert.match(runtime,/#lastReleaseAuthorityHandoffDigest/);
  assert.match(runtime,/#lastReleaseAuthorityHandoffState/);
});

test('runtime snapshot keeps release executor and installer authority outside RSI',()=>{
  assert.match(runtime,/release_authority_handoff: Object\.freeze\(\{/);
  assert.match(runtime,/external_release_executor_required: true/);
  assert.match(runtime,/release_transaction_created_by_rsi: false/);
  assert.match(runtime,/installer_effect_started_by_rsi: false/);
  assert.match(runtime,/self_update_check_invoked_by_rsi: false/);
  assert.match(runtime,/self_update_apply_invoked_by_rsi: false/);
  assert.match(runtime,/direct_install_authorized: false/);
  assert.match(runtime,/direct_self_update_authorized: false/);
  assert.match(runtime,/release_authority: false/);
});
