import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime persists promotion-review request before any archive or release action',()=>{
  const start=runtime.indexOf('async prepareExternalPromotionReview({');
  const end=runtime.indexOf('async finalizeExternalPromotionReview({',start);
  assert.ok(start>=0&&end>start,'prepareExternalPromotionReview missing');
  const body=runtime.slice(start,end);
  assert.match(body,/RSI_EXTERNAL_PROMOTION_REVIEW_PREPARED/);
  assert.match(body,/external_review_required: true/);
  assert.match(body,/direct_install_authorized: false/);
  assert.match(body,/self_update_invocation_authorized: false/);
  assert.match(body,/promotion_token: null/);
  assert.doesNotMatch(body,/selfUpdate|SELF_UPDATE_APPLY|executeNativeSupervisorCommand|devos_fleet_enqueue_v1/);
});

test('runtime appends finalized review before applying verified archive state',()=>{
  const start=runtime.indexOf('async finalizeExternalPromotionReview({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'finalizeExternalPromotionReview missing');
  const body=runtime.slice(start,end);
  const append=body.indexOf("await this.#ledger.append('RSI_EXTERNAL_PROMOTION_REVIEW_FINALIZED'");
  const archiveApply=body.indexOf('const appliedAdmission = this.#verifiedArchive.admit');
  assert.ok(append>=0&&archiveApply>append,'verified archive must apply only after durable append');
  assert.match(body,/durable_before_archive_apply: true/);
  assert.match(body,/existing_self_update_handoff_authorized: false/);
  assert.match(body,/direct_install_authorized: false/);
  assert.match(body,/self_update_invocation_authorized: false/);
  assert.match(body,/promotion_token: null/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|install|spawn\(|exec\(|devos_fleet_enqueue_v1/);
});

test('runtime replay reconstructs verified archive admission and promotion-review counters',()=>{
  assert.match(runtime,/external_promotion_review_request/);
  assert.match(runtime,/external_promotion_review_result/);
  assert.match(runtime,/rsi_runtime_verified_archive_replay_mismatch/);
  assert.match(runtime,/#externalPromotionReviewRequestCount \+= 1/);
  assert.match(runtime,/#externalPromotionReviewResultCount \+= 1/);
});

test('promotion-review runtime snapshot remains external-review-only and zero authority',()=>{
  assert.match(runtime,/external_promotion_review: Object\.freeze\(\{/);
  assert.match(runtime,/external_human_or_release_authority_still_required: true/);
  assert.match(runtime,/existing_self_update_handoff_authorized: false/);
  assert.match(runtime,/direct_install_authorized: false/);
  assert.match(runtime,/self_update_invocation_authorized: false/);
  assert.match(runtime,/promotion_token: null/);
});
