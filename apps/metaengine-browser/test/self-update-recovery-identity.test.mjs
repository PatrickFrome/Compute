import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectSelfUpdateStartup,
  PRE_INSTALL_RECEIPT_FILE,
} from '../src/self-update-handoff.mjs';
import {
  acceptedSignedSupervisorHeartbeatSnapshot,
  probeUpdatedSuccessorQualification,
  recordAcceptedSignedSupervisorHeartbeat,
} from '../src/self-update-successor-qualification.mjs';
import { shouldResumeSuccessorQualification } from '../src/self-update-successor-recovery.mjs';
import { SELF_UPDATE_TRANSACTION_FILE } from '../src/self-update-transaction-journal.mjs';

const version = '0.7.0-dev.1';
const gitSha = 'f43c48caab39b75b254da8971837fdddef580885';

function appFor(userData) {
  return {
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected_path:${name}`);
      return userData;
    },
    getVersion() { return version; },
    hasSingleInstanceLock() { return true; },
  };
}

function transaction(transactionId) {
  return {
    schema: 'metaengine.self-update.transaction.v1',
    transaction_id: transactionId,
    source_version: '0.6.9-dev.9.1',
    target_version: version,
    resolved_git_sha: gitSha,
    state: 'SUCCESSOR_BOOTED',
    swapping: false,
    qualified: false,
    quarantined: false,
    attempt_count: 1,
    automatic_retry_allowed: false,
    created_at: '2026-09-08T18:00:00.000Z',
    updated_at: '2026-09-08T18:01:00.000Z',
    evidence: { boot_version_match: true },
    authority_effect: false,
  };
}

test('startup recovery identity fences heartbeat admission and qualification against a same-version replacement transaction', async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-recovery-identity-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const app = appFor(userData);
  const transactionPath = path.join(userData, SELF_UPDATE_TRANSACTION_FILE);
  const preInstallPath = path.join(userData, PRE_INSTALL_RECEIPT_FILE);

  await fs.writeFile(preInstallPath, `${JSON.stringify({
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version,
    available_version: version,
    metadata_verified: true,
    restart_gate_safe: true,
    restart_gate_since: '2026-09-08T18:00:00.000Z',
    recorded_at: '2026-09-08T18:00:01.000Z',
    resolved_git_sha: gitSha,
    authority_effect: false,
  }, null, 2)}\n`);
  await fs.writeFile(transactionPath, `${JSON.stringify(transaction('tx-exact-a'), null, 2)}\n`);

  const inspection = await inspectSelfUpdateStartup(app, { clock: () => Date.parse('2026-09-08T18:05:00.000Z') });
  assert.equal(inspection.state, 'TARGET_INSTALLED');
  assert.equal(inspection.transaction_state, 'SUCCESSOR_BOOTED');
  assert.equal(inspection.transaction_id, 'tx-exact-a');
  assert.equal(inspection.target_git_sha, gitSha);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: inspection }), true);

  await fs.writeFile(transactionPath, `${JSON.stringify(transaction('tx-same-version-b'), null, 2)}\n`);

  const heartbeat = await recordAcceptedSignedSupervisorHeartbeat({ app, state: { shell_version: version } });
  assert.equal(heartbeat.state, 'RECOVERY_TRANSACTION_BINDING_DRIFT');
  assert.equal(heartbeat.expected_transaction_id, 'tx-exact-a');
  assert.equal(heartbeat.observed_transaction_id, 'tx-same-version-b');
  assert.equal(heartbeat.authority_effect, false);
  assert.equal(acceptedSignedSupervisorHeartbeatSnapshot(), null);

  const result = await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 30_000 });
  assert.equal(result.state, 'RECOVERY_TRANSACTION_BINDING_DRIFT');
  assert.equal(result.expected_transaction_id, 'tx-exact-a');
  assert.equal(result.observed_transaction_id, 'tx-same-version-b');
  assert.equal(result.authority_effect, false);

  const disk = JSON.parse(await fs.readFile(transactionPath, 'utf8'));
  assert.equal(disk.transaction_id, 'tx-same-version-b');
  assert.equal(disk.state, 'SUCCESSOR_BOOTED');
  assert.equal(disk.qualified, false);
  assert.equal(disk.quarantined, false);
});
