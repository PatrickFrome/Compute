import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runDisposableRecoveryBundle } from './test/disposable-recovery-bundle.mjs';
import { RECOVERY_BUNDLE_PHYSICAL_TEST, validateRecoveryBundleReceipt }
  from './test/disposable-recovery-bundle-receipt.mjs';

const required = process.env.RECOVERY_BUNDLE_REQUIRE_PHYSICAL === '1';
const available = process.platform === 'win32' && !!process.env.LOCAL_STATE_TEST_PG_BIN_DIR;

test(RECOVERY_BUNDLE_PHYSICAL_TEST, {
  skip: !required && !available ? 'Windows with the pinned disposable PG17 binaries is required' : false,
  timeout: 900000,
}, async () => {
  // Required CI cannot convert absent physical prerequisites into a green SKIP.
  if (!available) throw new Error('recovery_bundle_windows_prerequisite_missing');
  const receipt = await runDisposableRecoveryBundle();
  validateRecoveryBundleReceipt(receipt, { expectedSourceSha: process.env.EXPECTED_SHA });
  const output = process.env.RECOVERY_BUNDLE_RECEIPT_PATH;
  if (output) {
    if (!path.isAbsolute(output)) throw new Error('recovery_bundle_receipt_path_invalid');
    // Only the allowlisted receipt leaves the fixture, after cleanup. Never
    // overwrite/reuse an earlier output as evidence for a new attempt.
    const handle = await fs.open(output, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
  }
  if (receipt.status !== 'PASS') throw new Error(receipt.error_code);
});
