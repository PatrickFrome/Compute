import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime release-authority convergence records observation only',()=>{
  const start=runtime.indexOf('async recordReleaseAuthorityConvergence({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'recordReleaseAuthorityConvergence missing');
  const body=runtime.slice(start,end);
  assert.match(body,/RSI_RELEASE_AUTHORITY_CONVERGENCE_RECORDED/);
  assert.match(body,/convergence_is_observation_only: true/);
  assert.match(body,/authority_store_mutated_by_rsi: false/);
  assert.match(body,/release_authority_advanced_by_rsi: false/);
  assert.match(body,/self_update_effect_invoked_by_rsi: false/);
  assert.match(body,/rollback_effect_invoked_by_rsi: false/);
  assert.match(body,/direct_release_or_install_action_allowed: false/);
  assert.doesNotMatch(body,/SELF_UPDATE_APPLY|quitAndInstall|applyWhenSafe|issue_native|lease_batch|complete_v5/);
});

test('runtime refuses convergence without a persisted CONFIRMED effect reconciliation',()=>{
  assert.match(runtime,/rsi_runtime_release_effect_reconciliation_not_persisted/);
  assert.match(runtime,/rsi_runtime_confirmed_release_effect_required/);
  assert.match(runtime,/#findReleaseEffectReconciliationByDigest/);
  assert.match(runtime,/#findReleaseAuthorityConvergenceByReconciliation/);
  assert.match(runtime,/rsi_runtime_release_authority_convergence_already_recorded/);
});

test('runtime replay verifies convergence before restoring the converged release identity',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.release_authority_convergence\)/);
  assert.match(runtime,/verifyRsiReleaseAuthorityConvergence\(row\.payload\.release_authority_convergence\)/);
  assert.match(runtime,/#releaseAuthorityConvergenceCount \+= 1/);
  assert.match(runtime,/#lastReleaseAuthorityConvergenceDigest/);
  assert.match(runtime,/#lastConvergedReleaseSha/);
});

test('runtime snapshot permits post-deployment learning only after observed external convergence',()=>{
  assert.match(runtime,/release_authority_convergence: Object\.freeze\(\{/);
  assert.match(runtime,/confirmed_physical_effect_required: true/);
  assert.match(runtime,/external_authority_journal_readback_required: true/);
  assert.match(runtime,/convergence_is_observation_only: true/);
  assert.match(runtime,/post_deployment_learning_allowed_only_after_convergence: true/);
  assert.match(runtime,/release_authority: false/);
  assert.match(runtime,/self_update_authority: false/);
});
