import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createRecoveryBundleReceipt, validateRecoveryBundleReceipt, assertRecoveryBundlePhysicalTap,
  RECOVERY_BUNDLE_PHYSICAL_TEST, RECOVERY_BUNDLE_PG_ARCHIVE_SHA256,
  RECOVERY_BUNDLE_BINARIES, RECOVERY_BUNDLE_OBSERVATIONS,
  RECOVERY_BUNDLE_NEGATIVES, RECOVERY_BUNDLE_FALSE_BOUNDARIES,
} from './disposable-recovery-bundle-receipt.mjs';

const execute = promisify(execFile);
const sourceSha = '9d7527683060e314eb1d39fec9ce2304a57103c4';
const expected = { expectedSourceSha: sourceSha, expectedRunId: '1234', expectedRunAttempt: '1' };
const clone = value => structuredClone(value);
const digest = value => value.repeat(64);

function passReceipt() {
  const receipt = createRecoveryBundleReceipt({ sourceSha, runId: '1234', runAttempt: '1', platform: 'win32' });
  Object.assign(receipt, {
    status: 'PASS', error_code: null, pg_version: '17.11',
    pg_archive_sha256: RECOVERY_BUNDLE_PG_ARCHIVE_SHA256,
    archive_sha256: digest('1'), key_sha256: digest('2'), manifest_sha256: digest('3'),
    content_sha256: digest('4'), sequence_sha256: digest('5'),
    binaries_sha256: Object.fromEntries(RECOVERY_BUNDLE_BINARIES.map(key => [key, digest('6')])),
    clusters: {
      source: { system_identifier: '7660584055118050001', pid: 1001, port: 41001, pgdata_sha256: digest('a') },
      target_before_restart: { system_identifier: '7660584055118050002', pid: 1002, port: 41002, pgdata_sha256: digest('b') },
      target_after_restart: { system_identifier: '7660584055118050002', pid: 1003, port: 41002, pgdata_sha256: digest('b') },
    },
    dump_invocations: 1, restore_invocations: 1, backup_effect_state: 'EFFECT_UNKNOWN',
    observations: Object.fromEntries(RECOVERY_BUNDLE_OBSERVATIONS.map(key => [key, true])),
    negatives: Object.fromEntries(RECOVERY_BUNDLE_NEGATIVES.map(key => [key, 'REJECTED'])),
  });
  return receipt;
}

function physicalTap() {
  return 'TAP version 13\n# Subtest: ' + RECOVERY_BUNDLE_PHYSICAL_TEST
    + '\nok 1 - ' + RECOVERY_BUNDLE_PHYSICAL_TEST
    + '\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
}

test('fixture receipt preserves every installed boundary and returns an independent JSON copy', () => {
  const original = passReceipt();
  const verified = validateRecoveryBundleReceipt(original, { ...expected, requirePass: true });
  assert.deepEqual(verified, original);
  original.observations.postmasters_stopped = false;
  assert.equal(verified.observations.postmasters_stopped, true);
  for (const key of RECOVERY_BUNDLE_FALSE_BOUNDARIES) assert.equal(verified[key], false);
});

test('FAIL or incomplete cleanup remains publishable sanitized failure but cannot qualify', () => {
  const early = createRecoveryBundleReceipt({ sourceSha, runId: '1234', runAttempt: '1', platform: 'win32' });
  early.error_code = 'recovery_bundle_cleanup_unknown';
  early.negatives.unknown_cleanup = 'UNKNOWN';
  assert.equal(validateRecoveryBundleReceipt(early, expected).status, 'FAIL');
  assert.throws(() => validateRecoveryBundleReceipt(early, { ...expected, requirePass: true }),
    /recovery_receipt_qualification_failed/);
  for (const key of ['postmasters_stopped', 'ports_released']) {
    const candidate = passReceipt(); candidate.observations[key] = false;
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /observation_unproven/);
  }
});

test('source/run/attempt mismatch and non-Windows evidence cannot inherit a physical PASS', () => {
  for (const [key, value] of [['source_sha', 'f'.repeat(40)], ['run_id', '4321'],
    ['run_attempt', '2'], ['platform', 'linux']]) {
    const candidate = passReceipt(); candidate[key] = value;
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /^Error: recovery_receipt_/);
  }
});

test('all required negative outcomes and physical observations are mandatory rather than skip-to-PASS', () => {
  for (const key of RECOVERY_BUNDLE_OBSERVATIONS) {
    const candidate = passReceipt(); candidate.observations[key] = false;
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /observation_unproven/);
  }
  for (const key of RECOVERY_BUNDLE_NEGATIVES) for (const value of ['NOT_RUN', 'UNKNOWN']) {
    const candidate = passReceipt(); candidate.negatives[key] = value;
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /negative_unproven/);
  }
});

test('production authority, SQL ACL transfer and repeated effects cannot enter fixture receipt', () => {
  for (const key of RECOVERY_BUNDLE_FALSE_BOUNDARIES) {
    const candidate = passReceipt(); candidate[key] = true;
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /authority_boundary_invalid/);
  }
  for (const key of ['dump_invocations', 'restore_invocations']) for (const value of [0, 2, '1']) {
    const candidate = passReceipt(); candidate[key] = value;
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /effect_/);
  }
  const acl = passReceipt(); acl.sql_acl_policy = 'ACL_RESTORED';
  assert.throws(() => validateRecoveryBundleReceipt(acl, expected), /sql_acl_policy_invalid/);
  const effect = passReceipt(); effect.backup_effect_state = 'SUCCESS';
  assert.throws(() => validateRecoveryBundleReceipt(effect, expected), /backup_effect_state_invalid/);
  effect.backup_effect_state = 'NOT_ATTEMPTED';
  assert.throws(() => validateRecoveryBundleReceipt(effect, expected), /backup_effect_state_invalid/);
  effect.backup_effect_state = 'READBACK_UNKNOWN';
  assert.throws(() => validateRecoveryBundleReceipt(effect, expected), /backup_effect_state_invalid/);
  effect.status = 'FAIL'; effect.error_code = 'recovery_bundle_backup_unconfirmed';
  for (const state of ['NOT_ATTEMPTED', 'NO_INTENT', 'PRE_EFFECT_FENCED', 'EFFECT_UNKNOWN', 'READBACK_UNKNOWN']) {
    effect.backup_effect_state = state;
    assert.equal(validateRecoveryBundleReceipt(effect, expected).backup_effect_state, state);
  }
});

test('cluster, endpoint and restart aliases fail even when all summary flags are true', () => {
  const edits = [
    receipt => { receipt.clusters.target_before_restart.system_identifier = receipt.clusters.source.system_identifier; },
    receipt => { receipt.clusters.target_before_restart.pid = receipt.clusters.source.pid; },
    receipt => { receipt.clusters.target_after_restart.pid = receipt.clusters.source.pid; },
    receipt => { receipt.clusters.target_before_restart.port = receipt.clusters.source.port; },
    receipt => { receipt.clusters.target_before_restart.pgdata_sha256 = receipt.clusters.source.pgdata_sha256; },
    receipt => { receipt.clusters.target_after_restart.pid = receipt.clusters.target_before_restart.pid; },
    receipt => { receipt.clusters.target_after_restart.system_identifier = '7660584055118050003'; },
    receipt => { receipt.clusters.target_after_restart.port++; },
    receipt => { receipt.clusters.target_after_restart.pgdata_sha256 = digest('c'); },
    receipt => { receipt.clusters.source.port = 55432; },
    receipt => { receipt.clusters = null; },
  ];
  for (const edit of edits) {
    const candidate = passReceipt(); edit(candidate);
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /recovery_receipt_/);
  }
});

test('unpinned binaries, missing digests and unknown schema fields cannot be exported', () => {
  const edits = [
    receipt => { receipt.pg_archive_sha256 = digest('f'); },
    receipt => { receipt.pg_version = '17'; },
    receipt => { receipt.binaries_sha256 = null; },
    receipt => { delete receipt.binaries_sha256.pg_restore; },
    receipt => { receipt.binaries_sha256.psql = 'private-native-path'; },
    receipt => { receipt.archive_sha256 = null; },
    receipt => { receipt.manifest_sha256 = 'not-a-digest'; },
    receipt => { receipt.raw_sql_rows = ['PRIVATE']; },
    receipt => { receipt.observations.password = 'PRIVATE'; },
    receipt => { receipt.clusters.source.pgdata = 'C:\\private-data'; },
    receipt => { receipt.negatives.key = 'PRIVATE'; },
    receipt => { receipt.error_code = 'PRIVATE'; },
  ];
  for (const edit of edits) {
    const candidate = passReceipt(); edit(candidate);
    assert.throws(() => validateRecoveryBundleReceipt(candidate, expected), /recovery_receipt_/);
  }
});

test('required physical TAP rejects absence, duplicate, failure, TODO, SKIP and incomplete termination', () => {
  const valid = physicalTap();
  assert.equal(assertRecoveryBundlePhysicalTap(valid), true);
  const row = 'ok 1 - ' + RECOVERY_BUNDLE_PHYSICAL_TEST;
  for (const replacement of ['', 'not ' + row, row + ' # SKIP Windows unavailable',
    row + ' # TODO evidence pending', row + '\n' + row]) {
    assert.throws(() => assertRecoveryBundlePhysicalTap(valid.replace(row, replacement)), /recovery_receipt_/);
  }
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) {
    assert.throws(() => assertRecoveryBundlePhysicalTap(valid.replace('# ' + name + ' 0', '# ' + name + ' 1')),
      /tap_incomplete/);
    assert.throws(() => assertRecoveryBundlePhysicalTap(valid.replace('# ' + name + ' 0', '')), /tap_incomplete/);
  }
  assert.throws(() => assertRecoveryBundlePhysicalTap(valid + 'not ok 2 - another failure\n'), /tap_failed/);
  assert.throws(() => assertRecoveryBundlePhysicalTap(valid + 'Bail out! aborted\n'), /tap_failed/);
});

test('CLI publishes only allowlisted TAP and fails closed on a valid failure receipt', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recovery-receipt-test-'));
  t.after(() => rm(root, { recursive: true, force: false }));
  const receiptFile = path.join(root, 'receipt.json');
  const privateTap = path.join(root, 'private.tap');
  const outputTap = path.join(root, 'proof.tap');
  const cli = fileURLToPath(new URL('disposable-recovery-bundle-receipt.mjs', import.meta.url));
  const env = { ...process.env, EXPECTED_SHA: sourceSha, GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1' };
  await writeFile(receiptFile, JSON.stringify(passReceipt()), { flag: 'wx' });
  await writeFile(privateTap, physicalTap() + '# PRIVATE_FIXTURE_DIAGNOSTIC_DO_NOT_EXPORT\n', { flag: 'wx' });
  await execute(process.execPath, [cli, 'verify', receiptFile, privateTap, outputTap], { env, timeout: 10000 });
  const exported = await readFile(outputTap, 'utf8');
  assert.equal(exported, 'TAP version 13\nok 1 - ' + RECOVERY_BUNDLE_PHYSICAL_TEST + '\n1..1\n');
  assert.equal(exported.includes('PRIVATE'), false);
  const failed = clone(passReceipt()); failed.status = 'FAIL';
  failed.error_code = 'recovery_bundle_cleanup_unknown'; failed.observations.postmasters_stopped = false;
  await writeFile(receiptFile, JSON.stringify(failed));
  const failedTap = path.join(root, 'failure-proof.tap');
  await assert.rejects(execute(process.execPath, [cli, 'verify', receiptFile, privateTap, failedTap], { env, timeout: 10000 }),
    error => error.code === 1 && error.stderr.trim() === 'recovery_receipt_qualification_failed');
  assert.match(await readFile(failedTap, 'utf8'), /^TAP version 13\nnot ok 1 - /);
  const unsafe = passReceipt(); unsafe.plaintext = 'PRIVATE_FIXTURE_DIAGNOSTIC_DO_NOT_EXPORT';
  await writeFile(receiptFile, JSON.stringify(unsafe));
  const unsafeTap = path.join(root, 'unsafe-proof.tap');
  await assert.rejects(execute(process.execPath, [cli, 'verify', receiptFile, privateTap, unsafeTap], { env, timeout: 10000 }),
    error => error.code === 1 && error.stderr.trim() === 'recovery_receipt_shape_invalid');
  await assert.rejects(readFile(unsafeTap), { code: 'ENOENT' });
});
