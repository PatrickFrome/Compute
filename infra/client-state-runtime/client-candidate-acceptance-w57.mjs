/**
 * W57 independent, read-only Client candidate *receipt consistency* falsifier.
 *
 * Inputs are UNTRUSTED even if they contain plausible SHAs and "verified" flags.
 * This reducer NEVER upgrades source/CI/staging shapes to independently verified
 * installed Owner, PG, native Agent, signed installer or release authority.
 * Current GitHub/CI/Host evidence must be retrieved by a separate trusted verifier.
 */
export const W57_PARENT_PINS = Object.freeze({
  1269: '8628b9dd35e1e918d045e45fd0b6d405d30786d8', // W45
  1270: '8f2515719a009a0cec05fbbf84a6857ba1ece34a', // W46 reserved source
  1271: 'f0935e0b5027304cdc2ba20d2cc58b14dfd67ab1', // W47
  1272: '241f1ed06dc6063e95806e6965c7a17a8bd91cfa', // W49
  1273: 'b24e240b3a273a9622a3983a1029faa53d6a6576', // W43
  1274: '67d67a0b7eca53d3a8bf42550affdd99404ccae7', // W48
  1275: '56ba9d7ebedd3805e778cbee4fdcb46ce07e574d', // W44
  1276: 'adde7d726dd7272aaa84806add559aaaba371482', // W50
});
export const W57_REQUIRED_CI = Object.freeze([
  'Client State Runtime Contracts',
  'ME2 Unified Gate',
  'Browser Windows Package Smoke',
  'METAENGINE Browser Self Update E2E',
  'Client Source Sync W50 (source only)',
  'Client PG17 Qualification W45',
  'Client W48 Serial Staging Source and Disposable PG17',
]);
const REQUIRED_INCLUDED = new Set([1269, 1271, 1273, 1274, 1275, 1276]);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const goodSha = v => typeof v === 'string' && SHA.test(v);
const goodDigest = v => typeof v === 'string' && DIGEST.test(v);
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 128;
const positive = v => Number.isSafeInteger(v) && v > 0;
const all = (r, fields) => record(r) && fields.every(k => r[k] === true);
const unique = (xs) => xs.length === new Set(xs).size;

function parentLedgerOk(parents) {
  if (!Array.isArray(parents) || parents.length !== 8 || !unique(parents.map(x => x?.pr))) return false;
  return Object.entries(W57_PARENT_PINS).every(([number, pinned]) => {
    const pr = Number(number), p = parents.find(v => v?.pr === pr);
    if (!p || p.head_sha !== pinned || p.current_head_sha !== pinned) return false;
    if (!REQUIRED_INCLUDED.has(pr)) return p.inclusion === 'REVIEWED_NOT_IMPORTED' ||
      p.inclusion === 'ANCESTOR' || (p.inclusion === 'REVIEWED_CHERRYPICK' && goodDigest(p.blob_ledger_sha256));
    return p.inclusion === 'ANCESTOR' ||
      (p.inclusion === 'REVIEWED_CHERRYPICK' && goodDigest(p.blob_ledger_sha256));
  });
}
function ciOk(ci, sha) {
  if (!record(ci) || ci.source_sha !== sha || !Array.isArray(ci.runs) ||
      ci.runs.length > 64 || !unique(ci.runs.map(r => r?.run_id))) return false;
  return W57_REQUIRED_CI.every(name => ci.runs.some(r =>
    r?.name === name && r?.head_sha === sha && r?.status === 'completed' &&
    r?.conclusion === 'success' && positive(r?.run_id) && positive(r?.attempt) &&
    Array.isArray(r.jobs) && r.jobs.length > 0 &&
    r.jobs.every(job => positive(job?.job_id) && job?.head_sha === sha &&
      job?.conclusion === 'success' && job?.run_id === r.run_id)));
}
function syncOk(sync, sha) {
  if (!record(sync) || !goodSha(sync.github_head_sha) || sync.github_head_sha !== sha ||
      sync.git_head_before !== sha || sync.git_head_after !== sha ||
      sync.binding_source_sha !== sha || sync.tracked_clean !== true ||
      sync.untracked_clean !== true || sync.same_named_upstream !== true ||
      sync.canonical_origin_no_credentials !== true || sync.native_workspace_binding !== true ||
      sync.provider_origin !== 'TRUSTED_NATIVE_FIXED_GITHUB_READER') return false;
  return sync.cached_origin_only === false && sync.read_only === true &&
    sync.owner_state === 'CANONICAL_BOUND' && sync.platforms?.windows === 'PASS' &&
    sync.platforms?.linux === 'PASS';
}
function pgOk(pg, sha) {
  return record(pg) && pg.source_sha === sha && pg.origin === 'STAGING' &&
    pg.server_major === 17 && pg.fixture_scope === 'GENERATED_DISPOSABLE' &&
    id(pg.fixture_id) && id(pg.run_id) && pg.installed_pgdata_touched === false &&
    all(pg, ['owner_acl_and_rls', 'select_execute_grants', 'host_cap_concurrency',
      'actual_owner_transaction', 'lease_cas_concurrency', 'postmaster_restart',
      'restart_receipt_readback', 'lost_ack_fenced', 'lease_transfer_fenced',
      'emergency_stop_slot_return', 'event_sequence_ordered']) &&
    goodDigest(pg.fixture_receipt_sha256);
}
function backupOk(b, sha) {
  return record(b) && b.source_sha === sha && b.origin === 'STAGING' &&
    b.fixture_scope === 'GENERATED_DISPOSABLE' && positive(b.archive_size) &&
    b.pg_dump_format === 'CUSTOM' && goodDigest(b.archive_sha256) &&
    goodDigest(b.pg_restore_list_sha256) && goodDigest(b.source_data_sha256) &&
    b.source_data_sha256 === b.restored_data_sha256 &&
    goodDigest(b.rollback_before_sha256) &&
    b.rollback_before_sha256 === b.rollback_after_sha256 &&
    b.installed_pgdata_touched === false &&
    all(b, ['owner_only_acl', 'archive_readback', 'actual_pg_restore',
      'separate_generated_restore_cluster', 'role_grants_compared',
      'zero_byte_rejected', 'truncated_archive_rejected',
      'ambiguous_old_backup_fenced']);
}
function loopOk(l, sha) {
  return record(l) && l.source_sha === sha && l.origin === 'SYNTHETIC/STAGING' &&
    l.temp_git_repo === true && l.fail_before_edit === true &&
    l.pass_after_edit === true && l.one_existing_executor === true &&
    goodSha(l.actual_git_head_sha) && goodDigest(l.artifact_sha256) &&
    goodDigest(l.independent_critic_sha256) &&
    l.critic_independent_process === true && l.own_pg_checkpoint === true &&
    l.actual_postmaster_restart === true && l.next_task_lease_readback === true &&
    l.ack_loss_fenced === true && l.duplicate_edit_fenced === true &&
    l.lease_transfer_fenced === true && l.stale_critic_fenced === true &&
    l.unknown_effects === 0 && l.real_agent_origin === 'UNKNOWN';
}
function packageOk(p, sha) {
  return record(p) && p.source_sha === sha && p.origin === 'STAGING' &&
    p.version !== '0.7.0-dev.842024784850.1' && id(p.version) &&
    p.immutable_reservation === 'UNUSED_AND_UNAMBIGUOUS' &&
    p.reserved_old_identity_reused === false && p.version_collision === false &&
    p.installer_present === true && p.installer_kind === 'NSIS_EXE' &&
    positive(p.installer_bytes) && goodDigest(p.installer_sha256) &&
    p.artifact_readback_sha256 === p.installer_sha256 &&
    goodDigest(p.dependency_lock_sha256) && p.source_lock_matches === true &&
    p.signature_verified === true && p.slsa_verified === true &&
    p.windows_package_source_sha === sha && p.self_update_source_sha === sha &&
    p.production_installed === false;
}

/**
 * The state is bounded to BLOCKED / REVIEW_REQUIRED. Even a forged complete
 * receipt can establish at most consistency of SOURCE/STAGING input shapes.
 */
export function auditClientCandidateW57(input = {}) {
  input = record(input) ? input : {};
  const sha = input?.candidate?.source_sha;
  const valid = goodSha(sha);
  const gates = {};
  const reasons = [];
  const gate = (name, ok, code, missing = false) => {
    gates[name] = ok ? 'CLAIM_CONSISTENT_NOT_ATTESTED' : missing ? 'UNKNOWN' : 'BLOCKED';
    if (!ok) reasons.push(code);
  };
  const c = input.candidate;
  gate('one_source', valid && c?.ref_readback_sha === sha &&
      c?.source_freeze === true && c?.branch_kind === 'W54_FINAL_PACKAGE_SOURCE' &&
      goodSha(c?.tree_sha) && c?.merged_to_main === false &&
      c?.unknown_effects === 0 &&
      parentLedgerOk(input.parents) &&
      input.ancestry?.verified_by_git_compare === true &&
      input.ancestry?.head_sha === sha &&
      input.ancestry?.w43_ancestor_or_blob_equivalent === true,
    'W51_W54_ONE_FINAL_SOURCE_AND_ANCESTRY_UNPROVEN', !c);
  gate('exact_head_ci', valid && ciOk(input.ci, sha),
    'EXACT_FINAL_SHA_CI_RUN_JOB_RECEIPTS_MISSING_OR_FAILED', !input.ci);
  gate('native_owner', false, 'ACTUAL_NATIVE_ISSUER_GUARDIAN_PG_OWNER_UNPROVEN',
    !input.native_owner);
  gate('source_sync', valid && syncOk(input.source_sync, sha),
    'WINDOWS_SOURCE_SYNC_OR_CURRENT_GITHUB_PROVENANCE_UNPROVEN', !input.source_sync);
  gate('own_pg17', valid && pgOk(input.pg17, sha),
    'ACTUAL_DISPOSABLE_PG17_HOST_CAP_RESTART_ACL_UNPROVEN', !input.pg17);
  gate('backup_restore', valid && backupOk(input.backup_restore, sha),
    'ACTUAL_DUMP_RESTORE_EQUALITY_ROLLBACK_UNPROVEN', !input.backup_restore);
  gate('serial_checkpoint', valid && loopOk(input.serial_checkpoint, sha),
    'INDEPENDENT_PG_RESTART_SERIAL_CRITIC_CHECKPOINT_UNPROVEN', !input.serial_checkpoint);
  gate('package', valid && packageOk(input.package, sha),
    'DISTINCT_SIGNED_SLSA_NSIS_AND_SAME_SOURCE_UNPROVEN', !input.package);
  const hosted = input.legacy_hosted_ci;
  gate('own_pg_replacement', hosted?.legacy_supabase_probe === 'NOT_APPLICABLE' &&
      hosted?.hosted_probe_falsely_marked_green === false &&
      hosted?.hosted_secrets_requested === false &&
      hosted?.negative_no_egress_gate_retained === true &&
      hosted?.replacement === 'OWN_PG17_DISPOSABLE' &&
      input.pg17 && pgOk(input.pg17, sha) &&
      input.backup_restore && backupOk(input.backup_restore, sha),
    'OBSOLETE_HOSTED_PROBE_NEEDS_REAL_OWN_PG_REPLACEMENT', !hosted);
  // No caller-provided verified=true, shape, fake issuer or CI record may alter this gate.
  gate('installed_and_live', false, 'AUTHENTIC_OWNER_GUARDIAN_AGENT_EFFECT_UNPROVEN', true);
  const blocking = Object.entries(gates).some(([name, state]) =>
    state === 'BLOCKED' || (state === 'UNKNOWN' &&
      name !== 'installed_and_live' && name !== 'native_owner'));
  return Object.freeze({
    schema: 'metaengine.client.w57.critic.v1',
    source_sha: valid ? sha : null,
    state: blocking ? 'BLOCKED' : 'REVIEW_REQUIRED',
    gates: Object.freeze(gates),
    reasons: Object.freeze([...new Set(reasons)]),
    source_claims_only: true,
    source_qualified_by_trusted_provenance: false,
    physical_pg17_proven: false,
    installed_healthy: false,
    live_accepted: false,
    canonical_r1_c1_c2_accepted: false,
    promotion_authority: false,
    effect_authority: false,
    can_merge: false,
    can_install: false,
    automatic_retry_allowed: false,
    hosted_fallback_allowed: false,
  });
}
