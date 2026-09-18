import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime release executor admission only persists externally leased evidence',()=>{
  const start=runtime.indexOf('async prepareReleaseExecutorAdmission({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'prepareReleaseExecutorAdmission missing');
  const body=runtime.slice(start,end);
  assert.match(body,/RSI_RELEASE_EXECUTOR_ADMISSION_PREPARED/);
  assert.match(body,/db_lease_is_execution_authority: true/);
  assert.match(body,/admission_is_execution_authority: false/);
  assert.match(body,/command_created_by_rsi: false/);
  assert.match(body,/command_leased_by_rsi: false/);
  assert.match(body,/command_completed_by_rsi: false/);
  assert.match(body,/effect_invoked_by_rsi: false/);
  assert.match(body,/release_transaction_created: false/);
  assert.match(body,/installer_effect_started: false/);
  assert.match(body,/self_update_check_invoked: false/);
  assert.match(body,/self_update_apply_invoked: false/);
  assert.doesNotMatch(body,/h205f22_a2_browser_supervisor_issue_native_v1|h205f22_a2_browser_supervisor_lease|SELF_UPDATE_APPLY['"]|quitAndInstall|checkNow\(|applyWhenSafe\(/);
});

test('runtime executor admission is one durable admission per release handoff',()=>{
  assert.match(runtime,/#findReleaseExecutorAdmissionByHandoff/);
  assert.match(runtime,/rsi_runtime_release_executor_admission_already_prepared/);
  assert.match(runtime,/release_handoff_digest/);
});

test('runtime replay validates the executor admission and restores command identity',()=>{
  assert.match(runtime,/if \(row\?\.payload\?\.release_executor_admission\)/);
  assert.match(runtime,/verifyRsiReleaseExecutorAdmission\(row\.payload\.release_executor_admission\)/);
  assert.match(runtime,/#releaseExecutorAdmissionCount \+= 1/);
  assert.match(runtime,/#lastReleaseExecutorAdmissionDigest/);
  assert.match(runtime,/#lastReleaseExecutorCommandId/);
});

test('runtime snapshot makes the DB lease authoritative but not RSI',()=>{
  assert.match(runtime,/release_executor_admission: Object\.freeze\(\{/);
  assert.match(runtime,/db_lease_is_execution_authority: true/);
  assert.match(runtime,/external_scheduler_selection_required: true/);
  assert.match(runtime,/command_created_by_rsi: false/);
  assert.match(runtime,/command_leased_by_rsi: false/);
  assert.match(runtime,/command_completed_by_rsi: false/);
  assert.match(runtime,/effect_invoked_by_rsi: false/);
  assert.match(runtime,/release_authority: false/);
  assert.match(runtime,/self_update_authority: false/);
});
