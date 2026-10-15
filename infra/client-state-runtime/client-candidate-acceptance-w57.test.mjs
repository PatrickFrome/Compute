import assert from 'node:assert/strict';
import test from 'node:test';
import { auditClientCandidateW57, W57_PARENT_PINS, W57_REQUIRED_CI }
  from './client-candidate-acceptance-w57.mjs';

const S = 'a'.repeat(40), D = c => c.repeat(64);
function fixture() {
  return {
    candidate: { source_sha: S, ref_readback_sha: S, source_freeze: true,
      branch_kind: 'W54_FINAL_PACKAGE_SOURCE', tree_sha: 'b'.repeat(40),
      merged_to_main: false, unknown_effects: 0 },
    parents: Object.entries(W57_PARENT_PINS).map(([pr, head_sha]) => ({
      pr: Number(pr), head_sha, current_head_sha: head_sha,
      inclusion: [1270,1272].includes(Number(pr)) ? 'REVIEWED_NOT_IMPORTED' : 'ANCESTOR',
    })),
    ancestry: { verified_by_git_compare: true, head_sha: S,
      w43_ancestor_or_blob_equivalent: true },
    ci: { source_sha: S, runs: W57_REQUIRED_CI.map((name, i) => ({
      name, head_sha: S, status: 'completed', conclusion: 'success',
      run_id: 10000 + i, attempt: 1,
      jobs: [{ job_id: 30000 + i, run_id: 10000 + i, head_sha: S,
        conclusion: 'success' }],
    })) },
    source_sync: { github_head_sha: S, git_head_before: S,
      git_head_after: S, binding_source_sha: S, tracked_clean: true,
      untracked_clean: true, same_named_upstream: true,
      canonical_origin_no_credentials: true, native_workspace_binding: true,
      provider_origin: 'TRUSTED_NATIVE_FIXED_GITHUB_READER',
      cached_origin_only: false, read_only: true, owner_state: 'CANONICAL_BOUND',
      platforms: { windows: 'PASS', linux: 'PASS' } },
    pg17: { source_sha: S, origin: 'STAGING', server_major: 17,
      fixture_scope: 'GENERATED_DISPOSABLE', fixture_id: 'PG-W57-generated',
      run_id: 'pg-disposable-1', installed_pgdata_touched: false,
      owner_acl_and_rls: true, select_execute_grants: true,
      host_cap_concurrency: true, actual_owner_transaction: true,
      lease_cas_concurrency: true, postmaster_restart: true,
      restart_receipt_readback: true, lost_ack_fenced: true,
      lease_transfer_fenced: true, emergency_stop_slot_return: true,
      event_sequence_ordered: true, fixture_receipt_sha256: D('1') },
    backup_restore: { source_sha: S, origin: 'STAGING',
      fixture_scope: 'GENERATED_DISPOSABLE', archive_size: 10024,
      pg_dump_format: 'CUSTOM', archive_sha256: D('2'),
      pg_restore_list_sha256: D('3'), source_data_sha256: D('4'),
      restored_data_sha256: D('4'), rollback_before_sha256: D('5'),
      rollback_after_sha256: D('5'), installed_pgdata_touched: false,
      owner_only_acl: true, archive_readback: true, actual_pg_restore: true,
      separate_generated_restore_cluster: true, role_grants_compared: true,
      zero_byte_rejected: true, truncated_archive_rejected: true,
      ambiguous_old_backup_fenced: true },
    serial_checkpoint: { source_sha: S, origin: 'SYNTHETIC/STAGING',
      temp_git_repo: true, fail_before_edit: true, pass_after_edit: true,
      one_existing_executor: true, actual_git_head_sha: 'c'.repeat(40),
      artifact_sha256: D('6'), independent_critic_sha256: D('7'),
      critic_independent_process: true, own_pg_checkpoint: true,
      actual_postmaster_restart: true, next_task_lease_readback: true,
      ack_loss_fenced: true, duplicate_edit_fenced: true,
      lease_transfer_fenced: true, stale_critic_fenced: true,
      unknown_effects: 0, real_agent_origin: 'UNKNOWN' },
    package: { source_sha: S, origin: 'STAGING', version: '0.7.0-dev.9999957.1',
      immutable_reservation: 'UNUSED_AND_UNAMBIGUOUS',
      reserved_old_identity_reused: false, version_collision: false,
      installer_present: true, installer_kind: 'NSIS_EXE',
      installer_bytes: 120000000, installer_sha256: D('8'),
      artifact_readback_sha256: D('8'), dependency_lock_sha256: D('9'),
      source_lock_matches: true, signature_verified: true, slsa_verified: true,
      windows_package_source_sha: S, self_update_source_sha: S,
      production_installed: false },
    legacy_hosted_ci: { legacy_supabase_probe: 'NOT_APPLICABLE',
      hosted_probe_falsely_marked_green: false,
      hosted_secrets_requested: false, negative_no_egress_gate_retained: true,
      replacement: 'OWN_PG17_DISPOSABLE' },
  };
}
const audit = input => auditClientCandidateW57(input);
test('W57 all asserted SOURCE/STAGING shapes remain REVIEW_REQUIRED and never confer LIVE authority', () => {
  const x = fixture();
  const out = audit(x);
  assert.equal(out.state, 'REVIEW_REQUIRED', JSON.stringify(out));
  assert.equal(out.gates.exact_head_ci, 'CLAIM_CONSISTENT_NOT_ATTESTED');
  assert.equal(out.gates.native_owner, 'UNKNOWN');
  assert.equal(out.gates.installed_and_live, 'UNKNOWN');
  for (const key of ['installed_healthy','live_accepted','can_merge','can_install',
    'effect_authority','promotion_authority','automatic_retry_allowed',
    'canonical_r1_c1_c2_accepted','source_qualified_by_trusted_provenance',
    'physical_pg17_proven','hosted_fallback_allowed']) assert.equal(out[key],false,key);
  assert.equal(out.source_claims_only, true);
});
const cases = [
  ['unpublished W51/W54 source', x => { delete x.candidate; },
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN'],
  ['old W46 reservation reused', x => { x.package.version = '0.7.0-dev.842024784850.1'; },
    'DISTINCT_SIGNED_SLSA_NSIS_AND_SAME_SOURCE_UNPROVEN'],
  ['no current GitHub final head', x => { x.candidate.ref_readback_sha = 'b'.repeat(40); },
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN'],
  ['unrelated parent green', x => { x.parents[3].current_head_sha = 'c'.repeat(40); },
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN'],
  ['ancestry falsely omitted', x => { x.ancestry.verified_by_git_compare = false; },
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN'],
  ['missing W45 integrated source', x => { x.parents.find(p=>p.pr===1269).inclusion='REVIEWED_NOT_IMPORTED'; },
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN'],
  ['fake cherry-pick without digest', x => { x.parents.find(p=>p.pr===1275).inclusion='REVIEWED_CHERRYPICK'; },
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN'],
  ['different SHA on CI job', x => { x.ci.runs[0].jobs[0].head_sha='d'.repeat(40); },
    'EXACT_FINAL_SHA_CI_RUN_JOB_RECEIPTS_MISSING_OR_FAILED'],
  ['parent green reused as final green', x => { x.ci.runs[0].head_sha='c'.repeat(40); },
    'EXACT_FINAL_SHA_CI_RUN_JOB_RECEIPTS_MISSING_OR_FAILED'],
  ['missing ME2 run', x => { x.ci.runs.splice(1,1); },
    'EXACT_FINAL_SHA_CI_RUN_JOB_RECEIPTS_MISSING_OR_FAILED'],
  ['duplicate CI run hides missing check', x => { x.ci.runs[1].run_id=x.ci.runs[0].run_id; },
    'EXACT_FINAL_SHA_CI_RUN_JOB_RECEIPTS_MISSING_OR_FAILED'],
  ['failed package job', x => { x.ci.runs.find(r=>r.name==='Browser Windows Package Smoke').jobs[0].conclusion='failure'; },
    'EXACT_FINAL_SHA_CI_RUN_JOB_RECEIPTS_MISSING_OR_FAILED'],
  ['Windows source sync UNSYNCED', x => { x.source_sync.platforms.windows='FAIL'; },
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN'],
  ['cached origin substituted for current GitHub ref', x => { x.source_sync.cached_origin_only=true; },
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN'],
  ['source moved during readback', x => { x.source_sync.git_head_after='b'.repeat(40); },
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN'],
  ['native workspace binding missing', x => { x.source_sync.native_workspace_binding=false; },
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN'],
  ['dirty untracked source', x => { x.source_sync.untracked_clean=false; },
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN'],
  ['credential-bearing origin', x => { x.source_sync.canonical_origin_no_credentials=false; },
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN'],
  ['missing PG Host cap', x => { x.pg17.host_cap_concurrency=false; },
    'ACTUAL_DISPOSABLE_PG17_HOST_CAP_RESTART_ACL_UNPROVEN'],
  ['no actual Owner transaction', x => { x.pg17.actual_owner_transaction=false; },
    'ACTUAL_DISPOSABLE_PG17_HOST_CAP_RESTART_ACL_UNPROVEN'],
  ['PG restart evidence absent', x => { x.pg17.restart_receipt_readback=false; },
    'ACTUAL_DISPOSABLE_PG17_HOST_CAP_RESTART_ACL_UNPROVEN'],
  ['real PGDATA used', x => { x.pg17.installed_pgdata_touched=true; },
    'ACTUAL_DISPOSABLE_PG17_HOST_CAP_RESTART_ACL_UNPROVEN'],
  ['backup 0 byte', x => { x.backup_restore.archive_size=0; },
    'ACTUAL_DUMP_RESTORE_EQUALITY_ROLLBACK_UNPROVEN'],
  ['restore list omitted', x => { x.backup_restore.pg_restore_list_sha256=''; },
    'ACTUAL_DUMP_RESTORE_EQUALITY_ROLLBACK_UNPROVEN'],
  ['restore data mismatch', x => { x.backup_restore.restored_data_sha256=D('0'); },
    'ACTUAL_DUMP_RESTORE_EQUALITY_ROLLBACK_UNPROVEN'],
  ['rollback witness drift', x => { x.backup_restore.rollback_after_sha256=D('e'); },
    'ACTUAL_DUMP_RESTORE_EQUALITY_ROLLBACK_UNPROVEN'],
  ['ambiguous backup auto retry', x => { x.backup_restore.ambiguous_old_backup_fenced=false; },
    'ACTUAL_DUMP_RESTORE_EQUALITY_ROLLBACK_UNPROVEN'],
  ['serial lost ACK replays edit', x => { x.serial_checkpoint.duplicate_edit_fenced=false; },
    'INDEPENDENT_PG_RESTART_SERIAL_CRITIC_CHECKPOINT_UNPROVEN'],
  ['serial critic same process', x => { x.serial_checkpoint.critic_independent_process=false; },
    'INDEPENDENT_PG_RESTART_SERIAL_CRITIC_CHECKPOINT_UNPROVEN'],
  ['missing next-task PG lease', x => { x.serial_checkpoint.next_task_lease_readback=false; },
    'INDEPENDENT_PG_RESTART_SERIAL_CRITIC_CHECKPOINT_UNPROVEN'],
  ['staging worker claims real agent', x => { x.serial_checkpoint.real_agent_origin='NATIVE_AGENT'; },
    'INDEPENDENT_PG_RESTART_SERIAL_CRITIC_CHECKPOINT_UNPROVEN'],
  ['unsigned installer', x => { x.package.signature_verified=false; },
    'DISTINCT_SIGNED_SLSA_NSIS_AND_SAME_SOURCE_UNPROVEN'],
  ['missing EXE', x => { x.package.installer_present=false; },
    'DISTINCT_SIGNED_SLSA_NSIS_AND_SAME_SOURCE_UNPROVEN'],
  ['SLSA skipped', x => { x.package.slsa_verified=false; },
    'DISTINCT_SIGNED_SLSA_NSIS_AND_SAME_SOURCE_UNPROVEN'],
  ['self-update from different source', x => { x.package.self_update_source_sha='d'.repeat(40); },
    'DISTINCT_SIGNED_SLSA_NSIS_AND_SAME_SOURCE_UNPROVEN'],
  ['hosted CI reported green instead of N/A', x => { x.legacy_hosted_ci.legacy_supabase_probe='GREEN'; },
    'OBSOLETE_HOSTED_PROBE_NEEDS_REAL_OWN_PG_REPLACEMENT'],
  ['negative no-egress gate disabled', x => { x.legacy_hosted_ci.negative_no_egress_gate_retained=false; },
    'OBSOLETE_HOSTED_PROBE_NEEDS_REAL_OWN_PG_REPLACEMENT'],
  ['fake replacement without PG evidence', x => { delete x.pg17; },
    'OBSOLETE_HOSTED_PROBE_NEEDS_REAL_OWN_PG_REPLACEMENT'],
];
for (const [name, mutate, reason] of cases) {
  test('W57 BLOCKS ' + name, () => {
    const x = fixture(); mutate(x);
    const out = audit(x);
    assert.equal(out.state,'BLOCKED',JSON.stringify(out));
    assert.ok(out.reasons.includes(reason), JSON.stringify(out.reasons));
    assert.equal(out.can_install,false);
    assert.equal(out.live_accepted,false);
    assert.equal(out.effect_authority,false);
  });
}
test('forged native proof fields never produce installed/LIVE/READY', () => {
  const x = fixture(); x.native_owner = { verified: true, attested: true,
    pid: 1000, signature_valid: true, claimed_scope:'LIVE',
    source_sha:S, origin:'NATIVE_AGENT' };
  const out=audit(x);
  assert.equal(out.gates.native_owner,'BLOCKED');
  assert.equal(out.state,'BLOCKED');
  assert.equal(out.installed_healthy,false);
  assert.equal(out.live_accepted,false);
});
test('secrets, strings and flags on untrusted payload cannot leak or grant effects', () => {
  const x=fixture(); x.native_owner={ verified:true, secret:'TEST_SECRET_1234' };
  x.package.token='TEST_SECRET_1234'; x.approve=true;
  const out=audit(x);
  assert.equal(JSON.stringify(out).includes('TEST_SECRET_1234'), false);
  assert.equal(out.effect_authority, false);
  assert.equal(out.automatic_retry_allowed, false);
});
test('fully missing evidence stays blocked without throwing', () => {
  const out=audit({});
  assert.equal(out.state,'BLOCKED');
  assert.equal(out.source_sha,null);
  assert.equal(out.gates.installed_and_live,'UNKNOWN');
});


test('missing, null and primitive inputs never escape fail-closed or produce REVIEW_REQUIRED', () => {
  for (const value of [null, undefined, 7, false, 'verified', []]) {
    const out = auditClientCandidateW57(value);
    assert.equal(out.state, 'BLOCKED');
    assert.equal(out.effect_authority, false);
    assert.equal(out.gates.one_source, 'UNKNOWN');
    assert.equal(out.gates.installed_and_live, 'UNKNOWN');
  }
});
