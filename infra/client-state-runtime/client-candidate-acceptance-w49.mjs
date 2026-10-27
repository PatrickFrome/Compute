import { auditClientCrossPlaneIntegration } from './operator-cross-plane-integration-critic.mjs';

// W49 is an independent, pure, fail-closed evidence critic. All supplied receipts
// are untrusted data. The caller MUST independently fetch refs/checks and native
// proofs; this module has no GitHub, SQL, package, process or effect authority.
export const W49_CANDIDATE_PINS = Object.freeze({
  1248: 'ff9dab18d88a4d656fa91c5cc86f3392fde3f023',
  1257: '6498c1596432ea9d9987f343c92505b273d1ac11',
  1262: '11c6f0e754d160f4d2c042da86c2cb88e4495298',
  1263: 'ee39b256e2b54f5dfddf4bff021977c0185fb744',
  1264: 'ea1703cb6c4d0d15f1c7cd4cb4faf22ec2ac959d',
  1265: '37ce5d8407a1c1fa9702aa3aeb05133131f7a11a',
  1266: '2557acd2ee11464c6f3f63b2e3b22bba74df142f',
  1267: '2e9018d14cfe55256ddc5a94693ff0a288b90318',
  1268: '33f97db8d03fb57c4a78fa2e5abcb08509725551',
});
export const W49_REQUIRED_CANDIDATE_CI = Object.freeze([
  'Client State Runtime Contracts', 'Browser Windows Package Smoke', 'ME2 Unified Gate',
]);
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const OBJ = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ID = x => typeof x === 'string' && x.length > 0 && x.length <= 128;
const unique = xs => new Set(xs).size === xs.length;
const all = (x, props) => OBJ(x) && props.every(k => x[k] === true);

/**
 * Determine which release exit gates are still unsupported by independently
 * fetched evidence. No source-shaped receipt, including a forged verified flag,
 * can produce READY, installed qualification, LIVE, or action authority.
 */
export function auditClientCandidateAcceptanceW49(input = {}, { nowMs = Date.now() } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('w49_clock_invalid');
  const sha = input?.candidate?.source_sha;
  const validSha = SHA.test(sha ?? '');
  const gates = {};
  const reasons = [];
  const gate = (name, ok, reason, unknown = false) => {
    gates[name] = ok ? 'SOURCE_SHAPE_ONLY' : unknown ? 'UNKNOWN' : 'BLOCKED';
    if (!ok) reasons.push(reason);
  };

  const git = input?.git;
  const parents = git?.parents;
  const pinEntries = Object.entries(W49_CANDIDATE_PINS);
  const parentOk = Array.isArray(parents) && parents.length === pinEntries.length
    && unique(parents.map(p => p?.pr)) && pinEntries.every(([pr, head]) =>
      parents.some(p => p?.pr === Number(pr) && p.head_sha === head
        && p.current_head_sha === head && p.included_in_candidate === true));
  gate('candidate_source', validSha && OBJ(git) && git.branch ===
    'work/metaengine-client-wave8-w43-20261015'
    && git.candidate_sha === sha && git.ref_readback_sha === sha
    && SHA.test(git.tree_sha ?? '') && git.merged_into_main === false
    && git.source_freeze === true && parentOk,
    'ONE_FROZEN_INTEGRATED_SOURCE_OR_PARENT_READBACK_MISSING');

  const ci = input?.ci;
  const runs = ci?.runs;
  const requiredRuns = Array.isArray(runs) && runs.length <= 64
    && unique(runs.map(r => r?.name)) && unique(runs.map(r => r?.run_id))
    && W49_REQUIRED_CANDIDATE_CI.every(name =>
      runs.some(r => r?.name === name && r.head_sha === sha
        && r.status === 'completed' && r.conclusion === 'success'
        && Number.isSafeInteger(r.run_id) && r.run_id > 0
        && Number.isSafeInteger(r.attempt) && r.attempt > 0));
  gate('exact_head_ci', validSha && ci?.source_sha === sha && requiredRuns,
    'EXACT_W43_HEAD_CI_NOT_GREEN');

  const w42 = input?.w42_input;
  const sourceCritic = OBJ(w42)
    ? auditClientCrossPlaneIntegration(w42, { nowMs }) : null;
  gate('independent_w42', validSha && sourceCritic?.source_sha === sha
    && sourceCritic.state === 'REVIEW_REQUIRED'
    && sourceCritic.authority_effect === false
    && sourceCritic.evidence_scope === 'UNTRUSTED_SOURCE_CONFORMANCE_ONLY',
    'W42_REAL_REDUCER_OR_CANONICAL_CONTEXT_MISSING', !w42);

  const pg = input?.pg17;
  gate('disposable_pg17', validSha && pg?.source_sha === sha
    && pg.origin === 'STAGING' && pg.fixture_scope === 'GENERATED_DISPOSABLE'
    && pg.server_major === 17 && ID(pg.fixture_id)
    && pg.production_touched === false
    && all(pg, ['owner_rls', 'select_grants', 'execute_grants',
      'lease_cas_concurrency', 'postmaster_restart', 'lost_ack_reconcile',
      'lease_transfer_fenced', 'event_order_proven', 'slot_return_proven']),
    'OWN_PG17_ROLE_ACL_CONCURRENCY_RESTART_UNPROVEN', !pg);

  const pkg = input?.package;
  gate('package', validSha && pkg?.source_sha === sha && pkg.origin === 'STAGING'
    && SHA.test(pkg.source_tree_sha ?? '') && DIGEST.test(pkg.exe_sha256 ?? '')
    && DIGEST.test(pkg.provenance_sha256 ?? '') && ID(pkg.version)
    && pkg.reserved_identity === false && pkg.version_collision === false
    && pkg.signature_verified === true && pkg.windows_package_smoke_sha === sha
    && pkg.artifact_readback_sha256 === pkg.exe_sha256
    && pkg.exact_dependency_closure === true,
    'PACKAGE_RESERVED_UNSIGNED_OR_UNPROVEN', !pkg);

  const backup = input?.backup;
  gate('backup_restore', validSha && backup?.source_sha === sha
    && backup.origin === 'STAGING' && backup.fixture_scope === 'GENERATED_DISPOSABLE'
    && DIGEST.test(backup.archive_sha256 ?? '')
    && DIGEST.test(backup.fixture_data_sha256 ?? '')
    && backup.fixture_data_sha256 === backup.restored_data_sha256
    && all(backup, ['immutable_intent', 'owner_only_acl', 'archive_readback',
      'pg_restore_list', 'actual_disposable_restore', 'rollback_preserved',
      'truncated_archive_rejected', 'ambiguous_old_request_fenced'])
    && backup.real_pgdata_touched === false,
    'BACKUP_RESTORE_DATA_EQUALITY_OR_OWNER_ACL_UNPROVEN', !backup);

  const rollback = input?.rollback;
  gate('rollback', validSha && rollback?.source_sha === sha
    && rollback.origin === 'STAGING'
    && DIGEST.test(rollback.baseline_artifact_sha256 ?? '')
    && SHA.test(rollback.baseline_source_sha ?? '')
    && rollback.baseline_source_sha !== sha && rollback.rehearsal === 'PASS'
    && rollback.unknown_effects === 0 && rollback.rollback_preserved === true
    && rollback.installed_mutation === false,
    'ROLLBACK_BASELINE_REHEARSAL_UNPROVEN', !rollback);

  // A page, synthetic worker, or staging fixture cannot assert LIVE simply by
  // adding verified:true, a pid, or source_sha. This pure critic has no trusted
  // native verifier and intentionally leaves actual installed/LIVE UNKNOWN.
  const agent = input?.agent;
  const syntheticLive = agent?.claimed_scope === 'LIVE'
    && (!['REAL_PROVIDER', 'NATIVE_AGENT'].includes(agent?.origin)
      || agent?.fixture_scope === 'SYNTHETIC'
      || agent?.fixture_scope === 'STAGING');
  gate('live_provenance', false, syntheticLive
    ? 'SYNTHETIC_OR_STAGING_LIVE_MASQUERADE'
    : 'AUTHENTIC_INSTALLED_OWNER_AND_NATIVE_AGENT_UNKNOWN', !syntheticLive);

  // Missing W42 cannot be waived: only the absent physical LIVE verifier may
  // stay UNKNOWN at this source/staging review threshold.
  const blockers = Object.entries(gates).filter(([name, value]) =>
    value === 'BLOCKED' || (value === 'UNKNOWN' && name !== 'live_provenance')).length;
  return Object.freeze({
    schema: 'metaengine.client.candidate-acceptance.w49.v1',
    source_sha: validSha ? sha : null,
    state: blockers === 0 && Object.values(gates).every(x => x !== 'BLOCKED')
      ? 'REVIEW_REQUIRED' : 'BLOCKED',
    gates: Object.freeze(gates),
    reasons: Object.freeze([...new Set(reasons)]),
    w42_state: sourceCritic?.state ?? 'UNKNOWN',
    evidence_scope: 'UNTRUSTED_STAGING_AND_SOURCE_RECEIPT_SHAPES',
    canonical_r1_c1_c2_accepted: false,
    // Even a shape-complete integrated SHA is not source provenance proof.
    source_convergence_qualified: false,
    source_shape_conformant: blockers === 0,
    physical_pg17_proven: false,
    installed_healthy_proven: false,
    live_accepted: false,
    promotion_authority: false,
    can_merge: false,
    can_install: false,
    effect_authority: false,
    automatic_retry_allowed: false,
  });
}
