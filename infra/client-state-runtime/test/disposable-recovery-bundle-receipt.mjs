#!/usr/bin/env node
// Test evidence only. This validator never grants installed or production authority.
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECOVERY_BUNDLE_SCHEMA = 'metaengine.disposable-recovery-bundle.v1';
export const RECOVERY_BUNDLE_PHYSICAL_TEST =
  'disposable recovery bundle restores content, sequence and vault after cold restart on Windows PG17';
export const RECOVERY_BUNDLE_PG_ARCHIVE_SHA256 =
  '6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3';
export const RECOVERY_BUNDLE_BINARIES = Object.freeze([
  'initdb', 'postgres', 'pg_ctl', 'pg_isready', 'psql', 'pg_dump', 'pg_restore',
]);
export const RECOVERY_BUNDLE_OBSERVATIONS = Object.freeze([
  'pinned_binaries_verified', 'distinct_clusters', 'content_matched', 'sequence_matched',
  'vault_decrypted', 'cold_restart_verified', 'post_restart_content_matched',
  'post_restart_sequence_matched', 'post_restart_vault_decrypted', 'source_unchanged',
  'key_unchanged', 'windows_dacl_verified', 'backup_effect_once', 'postmasters_stopped',
  'ports_released', 'next_sequence_values_matched',
]);
export const RECOVERY_BUNDLE_NEGATIVES = Object.freeze([
  'truncated_dump', 'substituted_dump', 'missing_key', 'substituted_key', 'invalid_manifest',
  'source_pgdata', 'source_port', 'junction', 'hardlink', 'lost_backup_ack',
  'equal_count_changed_content', 'unknown_cleanup',
]);
export const RECOVERY_BUNDLE_FALSE_BOUNDARIES = Object.freeze([
  'installed_owner_touched', 'installed_backup_verified', 'upgrade_authorized',
  'production_authorized', 'automatic_retry_allowed', 'physical_restore_proven',
  'authority_effect',
]);
const digestKeys = ['archive_sha256', 'key_sha256', 'manifest_sha256',
  'content_sha256', 'sequence_sha256'];
const clusterKeys = ['source', 'target_before_restart', 'target_after_restart'];
const sha256 = /^[a-f0-9]{64}$/;
const sha1 = /^[a-f0-9]{40}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const refuse = code => { throw Object.assign(new Error('recovery_receipt_' + code),
  { code: 'recovery_receipt_' + code }); };
const requireValue = (condition, code) => { if (!condition) refuse(code); };
const exactKeys = (value, keys, code) => requireValue(object(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key)), code);

export function createRecoveryBundleReceipt({ sourceSha, runId = 'local', runAttempt = 'local',
  platform = process.platform } = {}) {
  return {
    schema: RECOVERY_BUNDLE_SCHEMA, status: 'FAIL', source_sha: sourceSha, platform,
    pg_version: null, pg_archive_sha256: null, run_id: String(runId), run_attempt: String(runAttempt),
    ...Object.fromEntries(digestKeys.map(key => [key, null])), binaries_sha256: null,
    clusters: null, dump_invocations: 0, restore_invocations: 0, backup_effect_state: 'NOT_ATTEMPTED',
    observations: Object.fromEntries(RECOVERY_BUNDLE_OBSERVATIONS.map(key => [key, false])),
    negatives: Object.fromEntries(RECOVERY_BUNDLE_NEGATIVES.map(key => [key, 'NOT_RUN'])),
    ...Object.fromEntries(RECOVERY_BUNDLE_FALSE_BOUNDARIES.map(key => [key, false])),
    sql_acl_policy: 'NOT_TRANSFERRED_NO_OWNER_NO_ACL', evidence_class: 'SYNTHETIC/STAGING',
    error_code: 'recovery_bundle_not_started',
  };
}

const receiptKeys = Object.keys(createRecoveryBundleReceipt());

function validateCluster(value) {
  exactKeys(value, ['system_identifier', 'pid', 'port', 'pgdata_sha256'], 'cluster_shape_invalid');
  requireValue(typeof value.system_identifier === 'string'
    && /^[1-9][0-9]{9,19}$/.test(value.system_identifier), 'cluster_identity_invalid');
  requireValue(Number.isSafeInteger(value.pid) && value.pid > 0, 'cluster_pid_invalid');
  requireValue(Number.isInteger(value.port) && value.port > 1023 && value.port <= 65535
    && ![55432, 55433, 55434].includes(value.port), 'cluster_port_invalid');
  requireValue(typeof value.pgdata_sha256 === 'string' && sha256.test(value.pgdata_sha256),
    'cluster_path_digest_invalid');
}

// The schema is an explicit export allowlist, not merely a PASS checker. Unknown
// fields cannot carry plaintext, SQL rows, key bytes, passwords or private paths.
export function validateRecoveryBundleReceipt(receipt, { expectedSourceSha,
  expectedRunId, expectedRunAttempt, requirePass = false } = {}) {
  exactKeys(receipt, receiptKeys, 'shape_invalid');
  requireValue(receipt.schema === RECOVERY_BUNDLE_SCHEMA, 'schema_invalid');
  requireValue(['PASS', 'FAIL'].includes(receipt.status), 'status_invalid');
  requireValue(typeof receipt.source_sha === 'string' && sha1.test(receipt.source_sha), 'source_invalid');
  if (expectedSourceSha !== undefined) requireValue(sha1.test(expectedSourceSha)
    && receipt.source_sha === expectedSourceSha, 'source_mismatch');
  requireValue(['win32', 'linux', 'darwin'].includes(receipt.platform), 'platform_invalid');
  for (const [key, expected] of [['run_id', expectedRunId], ['run_attempt', expectedRunAttempt]]) {
    requireValue(typeof receipt[key] === 'string'
      && /^(?:local|[1-9][0-9]{0,19})$/.test(receipt[key]), 'run_identity_invalid');
    if (expected !== undefined) requireValue(receipt[key] === String(expected), 'run_identity_mismatch');
  }
  const pass = receipt.status === 'PASS';
  requireValue(receipt.pg_version === '17.11' || (!pass && receipt.pg_version === null),
    'pg_version_invalid');
  requireValue(receipt.pg_archive_sha256 === RECOVERY_BUNDLE_PG_ARCHIVE_SHA256
    || (!pass && receipt.pg_archive_sha256 === null), 'pg_archive_invalid');
  for (const key of digestKeys) requireValue(typeof receipt[key] === 'string' && sha256.test(receipt[key])
    || (!pass && receipt[key] === null), 'digest_invalid');
  if (receipt.binaries_sha256 !== null) {
    exactKeys(receipt.binaries_sha256, RECOVERY_BUNDLE_BINARIES, 'binary_shape_invalid');
    requireValue(RECOVERY_BUNDLE_BINARIES.every(key => typeof receipt.binaries_sha256[key] === 'string'
      && sha256.test(receipt.binaries_sha256[key])), 'binary_digest_invalid');
  } else requireValue(!pass, 'binary_evidence_missing');
  if (receipt.clusters !== null) {
    exactKeys(receipt.clusters, clusterKeys, 'clusters_shape_invalid');
    for (const key of clusterKeys) validateCluster(receipt.clusters[key]);
    const { source, target_before_restart: before, target_after_restart: after } = receipt.clusters;
    requireValue(source.system_identifier !== before.system_identifier
      && source.pid !== before.pid && source.pid !== after.pid && source.port !== before.port
      && source.pgdata_sha256 !== before.pgdata_sha256, 'clusters_not_disjoint');
    requireValue(before.system_identifier === after.system_identifier && before.port === after.port
      && before.pgdata_sha256 === after.pgdata_sha256 && before.pid !== after.pid,
    'restart_identity_invalid');
  } else requireValue(!pass, 'cluster_evidence_missing');
  for (const key of ['dump_invocations', 'restore_invocations']) {
    requireValue(Number.isInteger(receipt[key]) && receipt[key] >= 0 && receipt[key] <= 1,
      'effect_count_invalid');
    if (pass) requireValue(receipt[key] === 1, 'effect_evidence_missing');
  }
  requireValue(receipt.backup_effect_state === 'EFFECT_UNKNOWN'
    || (!pass && ['NOT_ATTEMPTED', 'NO_INTENT', 'PRE_EFFECT_FENCED', 'READBACK_UNKNOWN']
      .includes(receipt.backup_effect_state)), 'backup_effect_state_invalid');
  exactKeys(receipt.observations, RECOVERY_BUNDLE_OBSERVATIONS, 'observations_shape_invalid');
  for (const key of RECOVERY_BUNDLE_OBSERVATIONS) {
    requireValue(typeof receipt.observations[key] === 'boolean', 'observation_invalid');
    if (pass) requireValue(receipt.observations[key] === true, 'observation_unproven');
  }
  exactKeys(receipt.negatives, RECOVERY_BUNDLE_NEGATIVES, 'negatives_shape_invalid');
  for (const key of RECOVERY_BUNDLE_NEGATIVES) {
    requireValue(['REJECTED', 'NOT_RUN', 'UNKNOWN'].includes(receipt.negatives[key]), 'negative_invalid');
    if (pass) requireValue(receipt.negatives[key] === 'REJECTED', 'negative_unproven');
  }
  for (const key of RECOVERY_BUNDLE_FALSE_BOUNDARIES)
    requireValue(receipt[key] === false, 'authority_boundary_invalid');
  requireValue(receipt.sql_acl_policy === 'NOT_TRANSFERRED_NO_OWNER_NO_ACL', 'sql_acl_policy_invalid');
  requireValue(receipt.evidence_class === 'SYNTHETIC/STAGING', 'evidence_class_invalid');
  requireValue(pass ? receipt.error_code === null
    : typeof receipt.error_code === 'string' && /^recovery_bundle_[a-z0-9_]{1,96}$/.test(receipt.error_code),
  'diagnostic_invalid');
  if (pass) requireValue(receipt.platform === 'win32', 'windows_proof_required');
  if (requirePass) requireValue(pass, 'qualification_failed');
  // Round-trip copies only a schema-checked JSON value; consumers cannot mutate
  // the supplied object after validation and thereby change the exported proof.
  return JSON.parse(JSON.stringify(receipt));
}

export function assertRecoveryBundlePhysicalTap(tap) {
  requireValue(typeof tap === 'string' && Buffer.byteLength(tap) <= 1024 * 1024, 'tap_invalid');
  const lines = tap.split(/\r?\n/);
  const records = lines.map(line => line.trim()).filter(line => /^(?:not )?ok \d+ - /.test(line));
  const matches = records.filter(line => line.replace(/^(?:not )?ok \d+ - /, '')
    .replace(/\s+#.*$/, '') === RECOVERY_BUNDLE_PHYSICAL_TEST);
  requireValue(matches.length === 1, 'physical_test_missing_or_duplicate');
  requireValue(/^ok \d+ - /.test(matches[0])
    && matches[0].replace(/^ok \d+ - /, '') === RECOVERY_BUNDLE_PHYSICAL_TEST,
  'physical_test_not_passed');
  requireValue(!records.some(line => /^not ok\b/.test(line))
    && !lines.some(line => /^Bail out!/i.test(line.trim())), 'tap_failed');
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) {
    const values = lines.filter(line => new RegExp('^# ' + name + ' ').test(line));
    requireValue(values.length === 1 && values[0] === '# ' + name + ' 0', 'tap_incomplete');
  }
  return true;
}

async function readPrivateRegularFile(filename, maximum) {
  const info = await lstat(filename);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1
    && info.size > 0 && info.size <= maximum, 'input_file_invalid');
  return readFile(filename, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, receiptFile, tapFile, proofFile, ...extra] = process.argv.slice(2);
    requireValue(mode === 'verify' && receiptFile && tapFile && proofFile && !extra.length,
      'arguments_invalid');
    requireValue(sha1.test(process.env.EXPECTED_SHA || ''), 'expected_source_required');
    const receipt = validateRecoveryBundleReceipt(JSON.parse(await readPrivateRegularFile(receiptFile, 65536)), {
      expectedSourceSha: process.env.EXPECTED_SHA,
      expectedRunId: process.env.GITHUB_RUN_ID || 'local',
      expectedRunAttempt: process.env.GITHUB_RUN_ATTEMPT || 'local',
    });
    let physicalPass = false;
    try { physicalPass = assertRecoveryBundlePhysicalTap(await readPrivateRegularFile(tapFile, 1024 * 1024)); }
    catch { /* The failed observation is retained without exporting raw diagnostics. */ }
    const pass = receipt.status === 'PASS' && physicalPass;
    // Only the fixed test identity and observed verdict leave the private TAP.
    await writeFile(proofFile, 'TAP version 13\n' + (pass ? 'ok' : 'not ok')
      + ' 1 - ' + RECOVERY_BUNDLE_PHYSICAL_TEST + '\n1..1\n', { flag: 'wx', mode: 0o600 });
    if (!pass) refuse('qualification_failed');
    console.log('Disposable Windows recovery fixture qualified; installed and production authority remain false.');
  } catch (error) {
    const code = /^recovery_receipt_[a-z_]+$/.test(error?.code || '')
      ? error.code : 'recovery_receipt_verification_failed';
    console.error(code);
    process.exitCode = 1;
  }
}
