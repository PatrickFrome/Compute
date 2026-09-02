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
    current_version: '0.6.6-dev.7.1',
    target_version: '0.6.6-dev.7.1',
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

test('updated launch keeps the established strict qualification path', () => {
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: true, startupInspection: null }), true);
});

test('normal restart resumes qualification only for exact durable TARGET_INSTALLED evidence', () => {
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection() }), true);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ state: 'NONE' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ state: 'AMBIGUOUS_INSTALL' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ target_version: '0.6.6-dev.8.1' }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ authority_effect: true }) }), false);
  assert.equal(shouldResumeSuccessorQualification({ updatedLaunch: false, startupInspection: installedInspection({ automatic_retry_allowed: true }) }), false);
});

test('main entry does not recreate successor receipt on recovery startup and reuses strict health qualification', async () => {
  const source = await fs.readFile(path.join(src, 'main-entry.mjs'), 'utf8');
  assert.match(source, /const resumeSuccessorQualification = shouldResumeSuccessorQualification/);
  const persistAt = source.indexOf('persistUpdatedSuccessorReceipt(app');
  const updatedGuardAt = source.lastIndexOf('if (updatedLaunch)', persistAt);
  assert.ok(updatedGuardAt >= 0 && updatedGuardAt < persistAt, 'successor receipt remains --updated-only');
  assert.match(source, /if \(resumeSuccessorQualification\)[\s\S]*qualifyUpdatedSuccessorWhenHealthy\(\{ app \}\)/);
  assert.doesNotMatch(source, /TARGET_INSTALLED[\s\S]{0,300}(?:unlink|rmSync|writeFile)/i);
});
