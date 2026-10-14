import assert from 'node:assert/strict';
import test from 'node:test';
import { auditClientCandidateAcceptanceW49, W49_CANDIDATE_PINS,
  W49_REQUIRED_CANDIDATE_CI } from './client-candidate-acceptance-w49.mjs';
import { reduceOperatorObservatory } from '../../apps/me2-ui/src/lib/operator-observatory.mjs';

const NOW = Date.parse('2026-10-15T00:00:00Z');
const T = new Date(NOW - 1_000).toISOString();
const BIRTH = new Date(NOW - 90_000).toISOString();
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const sha = c => c.repeat(40);
const digest = c => c.repeat(64);
const SOURCES = {
  database: 'LOCAL_POSTGRES', client: 'NATIVE_BROWSER_READBACK',
  supervisor: 'SIGNED_SUPERVISOR_READBACK', fleet: 'LOCAL_TASK_LEDGER',
  host: 'TRUSTED_HOST_READBACK', source: 'EXACT_GIT_READBACK',
  continuity: 'LOCAL_CHECKPOINT_LEDGER',
};
function w42SourceOnlyReceipt() {
  const expected = {
    source_sha: A, baseline_source_sha: B, artifact_sha256: digest('1'),
    baseline_artifact_sha256: digest('2'), owner_id: 'owner:local',
    owner_epoch: 7, process_incarnation: 'incarnation:1',
    run_id: 'run:fixture', event_seq: 9,
  };
  const planes = Object.fromEntries(Object.entries(SOURCES).map(([name, source]) =>
    [name, { source, state: 'READY', fresh: true, proof: 'TRUSTED_READBACK', observed_at: T }]));
  const context = {
    schema: 'metaengine.operator.context.v1', storage: 'OWN_POSTGRES_ONLY',
    scope: 'READ_ONLY', authority_effect: false, scheduler_authority: false,
    automatic_retry_allowed: false, remote_fallback_allowed: false,
    cloud_database_dependency: false, generated_at: T, owner_id: expected.owner_id,
    owner_epoch: 7, source_sha: A, run_id: expected.run_id, event_seq: 9,
    proof_identity: digest('3'), planes,
  };
  const projected = reduceOperatorObservatory(context, { nowMs: NOW });
  return {
    expected,
    refs: { main: sha('c'), integration: sha('d'), client: A,
      pr1216: sha('e'), pr1221: sha('f'), roadmap: sha('c'),
      ancestry: { base_sha: sha('e'), head_sha: sha('f'),
        merge_base_sha: sha('e'), behind_by: 0, ahead_by: 1 } },
    owner: { owner_id: expected.owner_id, owner_epoch: 7, source_sha: A,
      process_incarnation: expected.process_incarnation, provider: 'LOCAL_POSTGRES',
      boot_state: 'READY', state: 'HEALTHY', native_instance_id: 'native:7',
      pid: 1024, process_created_at: BIRTH, observed_at: T },
    postgres: { owner_id: expected.owner_id, owner_epoch: 7, source_sha: A,
      native_instance_id: 'native:7', provider: 'LOCAL_POSTGRES',
      address: '127.0.0.1', snapshot_isolation: 'REPEATABLE_READ',
      read_only: true, grants_proven: true, conflicting_leases: 0,
      unresolved_effects: 0, observed_at: T },
    context, ui: { ...projected, source_sha: A, owner_epoch: 7 },
    package: { source_sha: A, artifact_sha256: digest('1'),
      installed_exe_sha256: digest('1'), source_manifest_sha256: digest('4'),
      installed_manifest_sha256: digest('4'), native_instance_id: 'native:7',
      package_identity_reserved: false, reproducible_source: true, observed_at: T },
    ci: { source_sha: A, workflows: [
      'Client State Runtime Contracts', 'Browser Windows Package Smoke', 'ME2 Unified Gate',
    ].map(name => ({ name, source_sha: A, status: 'completed', conclusion: 'success' })) },
    promotion: { source_sha: A, owner_id: expected.owner_id, owner_epoch: 7,
      state: 'REVIEW_REQUIRED', critic_independent: true, authority_effect: false,
      executed: false, unknown_effects: 0, observed_at: T },
    rollback: { source_sha: B, artifact_sha256: digest('2'),
      owner_id: expected.owner_id, owner_epoch: 7, native_instance_id: 'native:7',
      rehearsal: 'PASS', unresolved_effects: 0, executed: false, observed_at: T },
  };
}

function fixture() {
  return {
    candidate: { source_sha: A },
    git: { branch: 'work/metaengine-client-wave8-w43-20261015',
      candidate_sha: A, ref_readback_sha: A, tree_sha: sha('c'),
      merged_into_main: false, source_freeze: true,
      parents: Object.entries(W49_CANDIDATE_PINS).map(([pr, head_sha]) => ({
        pr: Number(pr), head_sha, current_head_sha: head_sha, included_in_candidate: true,
      })) },
    ci: { source_sha: A, runs: W49_REQUIRED_CANDIDATE_CI.map((name, i) => ({
      name, head_sha: A, status: 'completed', conclusion: 'success',
      run_id: i + 10, attempt: 1,
    })) },
    w42_input: w42SourceOnlyReceipt(),
    pg17: { source_sha: A, origin: 'STAGING', fixture_scope: 'GENERATED_DISPOSABLE',
      fixture_id: 'own-pg-fixture-49', server_major: 17, production_touched: false,
      owner_rls: true, select_grants: true, execute_grants: true,
      lease_cas_concurrency: true, postmaster_restart: true,
      lost_ack_reconcile: true, lease_transfer_fenced: true, event_order_proven: true,
      slot_return_proven: true },
    package: { source_sha: A, origin: 'STAGING', source_tree_sha: sha('c'),
      exe_sha256: digest('a'), provenance_sha256: digest('b'), version: '0.7.0-dev.999',
      reserved_identity: false, version_collision: false, signature_verified: true,
      windows_package_smoke_sha: A, artifact_readback_sha256: digest('a'),
      exact_dependency_closure: true },
    backup: { source_sha: A, origin: 'STAGING', fixture_scope: 'GENERATED_DISPOSABLE',
      archive_sha256: digest('c'), fixture_data_sha256: digest('d'),
      restored_data_sha256: digest('d'), immutable_intent: true,
      owner_only_acl: true, archive_readback: true, pg_restore_list: true,
      actual_disposable_restore: true, rollback_preserved: true,
      truncated_archive_rejected: true, ambiguous_old_request_fenced: true,
      real_pgdata_touched: false },
    rollback: { source_sha: A, origin: 'STAGING', baseline_source_sha: B,
      baseline_artifact_sha256: digest('e'), rehearsal: 'PASS',
      unknown_effects: 0, rollback_preserved: true, installed_mutation: false },
    agent: { claimed_scope: 'STAGING', origin: 'SYNTHETIC', fixture_scope: 'STAGING' },
  };
}
const check = x => auditClientCandidateAcceptanceW49(x, { nowMs: NOW });
test('W49 full synthetic SOURCE+STAGING shape requests review, NEVER accepts R1/C1/C2 or LIVE', () => {
  const out = check(fixture());
  assert.equal(out.state, 'REVIEW_REQUIRED', JSON.stringify(out));
  assert.equal(out.gates.live_provenance, 'UNKNOWN');
  assert.equal(out.canonical_r1_c1_c2_accepted, false);
  assert.equal(out.installed_healthy_proven, false);
  assert.equal(out.live_accepted, false);
  assert.equal(out.can_merge, false);
  assert.equal(out.can_install, false);
  assert.equal(out.effect_authority, false);
  assert.equal(out.automatic_retry_allowed, false);
});
const attacks = [
  ['collection of individually green PRs with no frozen W43 candidate', x => {
    delete x.git;
  }, 'ONE_FROZEN_INTEGRATED_SOURCE_OR_PARENT_READBACK_MISSING'],
  ['missing one integration parent #1268', x => {
    x.git.parents.pop();
  }, 'ONE_FROZEN_INTEGRATED_SOURCE_OR_PARENT_READBACK_MISSING'],
  ['coordinator pin #1262 advanced after evidence', x => {
    x.git.parents.find(p => p.pr === 1262).current_head_sha = sha('c');
  }, 'ONE_FROZEN_INTEGRATED_SOURCE_OR_PARENT_READBACK_MISSING'],
  ['duplicate PR ledger entry hides missing W37', x => {
    const p = x.git.parents.find(p => p.pr === 1266);
    p.pr = 1265;
  }, 'ONE_FROZEN_INTEGRATED_SOURCE_OR_PARENT_READBACK_MISSING'],
  ['PR merged or candidate head advanced after freeze', x => {
    x.git.ref_readback_sha = B;
    x.git.merged_into_main = true;
  }, 'ONE_FROZEN_INTEGRATED_SOURCE_OR_PARENT_READBACK_MISSING'],
  ['green checks belong to separate PR heads rather than integrated SHA', x => {
    x.ci.runs[0].head_sha = W49_CANDIDATE_PINS[1267];
  }, 'EXACT_W43_HEAD_CI_NOT_GREEN'],
  ['Windows package smoke actually failed', x => {
    x.ci.runs[1].conclusion = 'failure';
  }, 'EXACT_W43_HEAD_CI_NOT_GREEN'],
  ['missing integrated ME2 workflow', x => {
    x.ci.runs.pop();
  }, 'EXACT_W43_HEAD_CI_NOT_GREEN'],
  ['GitHub run is a zero-id fabricated receipt', x => {
    x.ci.runs[0].run_id = 0;
  }, 'EXACT_W43_HEAD_CI_NOT_GREEN'],
  ['W42 source-only reducer rejects cross-plane Owner', x => {
    x.w42_input.context.owner_id = 'fake-other-owner';
  }, 'W42_REAL_REDUCER_OR_CANONICAL_CONTEXT_MISSING'],
  ['without W42 reducer input positive booleans do not qualify', x => {
    delete x.w42_input;
  }, 'W42_REAL_REDUCER_OR_CANONICAL_CONTEXT_MISSING'],
  ['PG RLS and role permissions not run', x => {
    x.pg17.owner_rls = false;
  }, 'OWN_PG17_ROLE_ACL_CONCURRENCY_RESTART_UNPROVEN'],
  ['PG SELECT and EXECUTE grant gap', x => {
    x.pg17.execute_grants = false;
  }, 'OWN_PG17_ROLE_ACL_CONCURRENCY_RESTART_UNPROVEN'],
  ['no real postmaster restart', x => {
    x.pg17.postmaster_restart = false;
  }, 'OWN_PG17_ROLE_ACL_CONCURRENCY_RESTART_UNPROVEN'],
  ['lost ACK replay may double claim', x => {
    x.pg17.lost_ack_reconcile = false;
  }, 'OWN_PG17_ROLE_ACL_CONCURRENCY_RESTART_UNPROVEN'],
  ['fixture falsely tagged installed', x => {
    x.pg17.origin = 'LIVE';
  }, 'OWN_PG17_ROLE_ACL_CONCURRENCY_RESTART_UNPROVEN'],
  ['reserved package cannot be reused', x => {
    x.package.reserved_identity = true;
  }, 'PACKAGE_RESERVED_UNSIGNED_OR_UNPROVEN'],
  ['unsigned EXE disqualifies Windows acceptance', x => {
    x.package.signature_verified = false;
  }, 'PACKAGE_RESERVED_UNSIGNED_OR_UNPROVEN'],
  ['artifact hash no longer equals readback', x => {
    x.package.artifact_readback_sha256 = digest('f');
  }, 'PACKAGE_RESERVED_UNSIGNED_OR_UNPROVEN'],
  ['backup is not an actual data-equal restore', x => {
    x.backup.restored_data_sha256 = digest('0');
  }, 'BACKUP_RESTORE_DATA_EQUALITY_OR_OWNER_ACL_UNPROVEN'],
  ['no independent pg_restore listing', x => {
    x.backup.pg_restore_list = false;
  }, 'BACKUP_RESTORE_DATA_EQUALITY_OR_OWNER_ACL_UNPROVEN'],
  ['0-byte archive cannot be accepted', x => {
    x.backup.archive_sha256 = '';
  }, 'BACKUP_RESTORE_DATA_EQUALITY_OR_OWNER_ACL_UNPROVEN'],
  ['owner backup ACL is incorrect', x => {
    x.backup.owner_only_acl = false;
  }, 'BACKUP_RESTORE_DATA_EQUALITY_OR_OWNER_ACL_UNPROVEN'],
  ['rollback was never rehearsed', x => {
    x.rollback.rehearsal = 'UNKNOWN';
  }, 'ROLLBACK_BASELINE_REHEARSAL_UNPROVEN'],
  ['rollback leaves an ambiguous effect', x => {
    x.rollback.unknown_effects = 1;
  }, 'ROLLBACK_BASELINE_REHEARSAL_UNPROVEN'],
  ['SYNTHETIC agent invents LIVE by setting verified', x => {
    x.agent.claimed_scope = 'LIVE'; x.agent.verified = true;
  }, 'SYNTHETIC_OR_STAGING_LIVE_MASQUERADE'],
  ['STAGING masquerades as real provider', x => {
    x.agent.claimed_scope = 'LIVE'; x.agent.origin = 'REAL_PROVIDER';
  }, 'SYNTHETIC_OR_STAGING_LIVE_MASQUERADE'],
];
for (const [name, mutate, reason] of attacks) {
  test('W49 rejects ' + name, () => {
    const x = fixture(); mutate(x);
    const result = check(x);
    assert.equal(result.state, 'BLOCKED', JSON.stringify(result));
    assert.ok(result.reasons.includes(reason), JSON.stringify(result.reasons));
    assert.equal(result.canonical_r1_c1_c2_accepted, false);
    assert.equal(result.effect_authority, false);
    assert.equal(result.can_install, false);
  });
}
test('a claimed real native worker without verified external issuer remains UNKNOWN, never LIVE', () => {
  const x = fixture();
  x.agent = { claimed_scope: 'LIVE', origin: 'NATIVE_AGENT', verified: true };
  const out = check(x);
  assert.equal(out.state, 'REVIEW_REQUIRED');
  assert.equal(out.gates.live_provenance, 'UNKNOWN');
  assert.equal(out.live_accepted, false);
});
test('effect and secret claims cannot change the critic output', () => {
  const x = fixture();
  x.owner_password = 'do-not-echo';
  x.pg17.secret = 'do-not-echo';
  x.ci.verified = true;
  x.package.installed = true;
  const out = check(x);
  assert.equal(out.state, 'REVIEW_REQUIRED');
  assert.equal(JSON.stringify(out).includes('do-not-echo'), false);
  assert.equal(out.installed_healthy_proven, false);
});
test('clock poison is rejected before any receipt can be accepted', () => {
  assert.throws(() => auditClientCandidateAcceptanceW49(fixture(), { nowMs: Infinity }),
    /w49_clock_invalid/);
});
