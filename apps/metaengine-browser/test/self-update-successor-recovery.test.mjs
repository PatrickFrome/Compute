import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldResumeSuccessorQualification } from '../src/self-update-successor-recovery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../src');

function installedInspection(overrides = {}) {
  return {
    schema: 'metaengine.self-update.startup-inspection.v1',
    state: 'TARGET_INSTALLED',
    transaction_state: 'SUCCESSOR_BOOTED',
    current_version: '0.6.6-dev.8.1',
    target_version: '0.6.6-dev.8.1',
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function updatedHandoff(overrides = {}) {
  return {
    successor_startup: 'NORMAL',
    row: {
      schema: 'metaengine.self-update.successor-receipt.v1',
      version: '0.6.6-dev.8.1',
      primary_instance: true,
      authority_effect: false,
      ...overrides,
    },
  };
}

test('updated launch qualifies only after exact successor handoff is durably proven', () => {
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: true, updateHandoff: updatedHandoff() }), true);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: true, updateHandoff: null, startupInspection: installedInspection() }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: true, updateHandoff: updatedHandoff({ primary_instance: false }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: true, updateHandoff: updatedHandoff({ authority_effect: true }) }), false);
});

test('normal restart resumes qualification only for exact unresolved SUCCESSOR_BOOTED evidence', () => {
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection() }), true);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ transaction_state: 'QUALIFIED' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ transaction_state: 'SUPERSEDED' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ transaction_state: 'PREPARED' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ transaction_state: 'INSTALLING' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ transaction_state: null }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ state: 'NONE' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ state: 'AMBIGUOUS_INSTALL' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ target_version: '0.6.6-dev.9.1' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ authority_effect: true }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ automatic_retry_allowed: true }) }), false);
});

test('main entry does not recreate successor receipt on recovery startup and preserves ambiguous updated-launch hold', async () => {
  const source = await fs.readFile(path.join(src, 'main-entry.mjs'), 'utf8');
  assert.match(source, /const resumeSuccessorQualification = shouldResumeSuccessorQualification/);
  assert.match(source, /updatedLaunch,\s*updateHandoff,\s*startupInspection: startupUpdateInspection/);
  const persistAt = source.indexOf('persistUpdatedSuccessorReceipt(app');
  const updatedGuardAt = source.lastIndexOf('if (updatedLaunch)', persistAt);
  assert.ok(updatedGuardAt >= 0 && updatedGuardAt < persistAt, 'successor receipt remains --updated-only');
  assert.match(source, /if \(resumeSuccessorQualification\)[\s\S]*qualifyUpdatedSuccessorWhenHealthy\(\{ app \}\)/);
  assert.doesNotMatch(source, /if \(updatedLaunch && updateHandoff\)[\s\S]*qualifyUpdatedSuccessorWhenHealthy/);
  assert.doesNotMatch(source, /TARGET_INSTALLED[\s\S]{0,300}(?:unlink|rmSync|writeFile)/i);
});
