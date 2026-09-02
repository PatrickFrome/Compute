import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldResumeSuccessorQualification } from '../src/self-update-successor-recovery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../src');

test('only exact durable TARGET_INSTALLED normal starts resume qualification', () => {
  const exact = {
    state: 'TARGET_INSTALLED',
    current_version: '0.6.6-dev.8.1',
    target_version: '0.6.6-dev.8.1',
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: exact }), true);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: { ...exact, target_version: '0.6.6-dev.9.1' } }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: { ...exact, state: 'AMBIGUOUS_INSTALL' } }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: { ...exact, automatic_retry_allowed: true } }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: { ...exact, authority_effect: true } }), false);
});

test('updated launch intent alone never bypasses the successor receipt gate in main-entry', async () => {
  const mainEntry = await fs.readFile(path.join(src, 'main-entry.mjs'), 'utf8');
  assert.match(mainEntry, /const qualificationRequested = \(updatedLaunch && Boolean\(updateHandoff\)\)/);
  assert.match(mainEntry, /\|\| \(!updatedLaunch && resumeSuccessorQualification\)/);
  assert.match(mainEntry, /recovery_startup: updatedLaunch !== true/);
  const receiptAt = mainEntry.indexOf('persistUpdatedSuccessorReceipt');
  const qualifierAt = mainEntry.lastIndexOf('qualifyUpdatedSuccessorWhenHealthy');
  assert.ok(receiptAt >= 0 && qualifierAt > receiptAt, 'receipt/hold decision must precede qualification scheduling');
});

test('normal restart recovery reuses strict qualifier and never recreates install receipt', async () => {
  const mainEntry = await fs.readFile(path.join(src, 'main-entry.mjs'), 'utf8');
  const updatedBlockAt = mainEntry.indexOf('if (updatedLaunch)');
  const receiptAt = mainEntry.indexOf('persistUpdatedSuccessorReceipt', updatedBlockAt);
  const qualificationRequestedAt = mainEntry.indexOf('const qualificationRequested');
  assert.ok(updatedBlockAt >= 0 && receiptAt > updatedBlockAt && qualificationRequestedAt > receiptAt);
  const normalRecoverySlice = mainEntry.slice(qualificationRequestedAt);
  assert.doesNotMatch(normalRecoverySlice, /persistUpdatedSuccessorReceipt/);
  assert.match(normalRecoverySlice, /qualifyUpdatedSuccessorWhenHealthy/);
});
