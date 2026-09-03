import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSelfUpdateRecoveryDiagnostic,
  shouldResumeSuccessorQualification,
} from '../src/self-update-successor-recovery.mjs';

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

test('recovery diagnostic exposes exact pending qualification without reopening installer authority', () => {
  const row = buildSelfUpdateRecoveryDiagnostic(installedInspection());
  assert.equal(row.schema, 'metaengine.self-update.recovery-diagnostic.v1');
  assert.equal(row.state, 'TARGET_INSTALLED_PENDING_QUALIFICATION');
  assert.equal(row.recovery_active, true);
  assert.equal(row.qualification_resume_allowed, true);
  assert.equal(row.recovery_installer_effect_allowed, false);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
});

test('recovery diagnostic classifies qualified, superseded, quarantine and ambiguous transactions without retry authority', () => {
  const cases = [
    [installedInspection({ transaction_state: 'QUALIFIED' }), 'QUALIFIED'],
    [installedInspection({ state: 'SUPERSEDED', current_version: '0.6.6-dev.9.1', target_version: '0.6.6-dev.8.1' }), 'SUPERSEDED'],
    [installedInspection({ state: 'AMBIGUOUS_INSTALL', transaction_state: 'QUARANTINED', reason: 'session_continuity_partial' }), 'QUARANTINED'],
    [installedInspection({ state: 'AMBIGUOUS_INSTALL', current_version: '0.6.6-dev.7.1', target_version: '0.6.6-dev.8.1', reason: 'target_not_installed' }), 'AMBIGUOUS_INSTALL'],
  ];
  for (const [inspection, expected] of cases) {
    const row = buildSelfUpdateRecoveryDiagnostic(inspection);
    assert.equal(row.state, expected);
    assert.equal(row.qualification_resume_allowed, false);
    assert.equal(row.recovery_installer_effect_allowed, false);
    assert.equal(row.automatic_retry_allowed, false);
    assert.equal(row.authority_effect, false);
  }
});

test('recovery diagnostic preserves normal no-transaction retry semantics and fails closed on unknown evidence', () => {
  const none = buildSelfUpdateRecoveryDiagnostic(installedInspection({
    state: 'NONE',
    transaction_state: null,
    target_version: null,
    automatic_retry_allowed: true,
  }));
  assert.equal(none.state, 'NO_TRANSACTION');
  assert.equal(none.recovery_active, false);
  assert.equal(none.recovery_installer_effect_allowed, null);
  assert.equal(none.automatic_retry_allowed, true);

  const unknown = buildSelfUpdateRecoveryDiagnostic(installedInspection({
    state: 'TARGET_INSTALLED',
    transaction_state: 'PREPARED',
  }));
  assert.equal(unknown.state, 'BLOCKED_NONTERMINAL');
  assert.equal(unknown.recovery_installer_effect_allowed, false);
  assert.equal(unknown.automatic_retry_allowed, false);
  assert.equal(unknown.qualification_resume_allowed, false);

  const invalid = buildSelfUpdateRecoveryDiagnostic(null);
  assert.equal(invalid.state, 'INSPECTION_UNAVAILABLE');
  assert.equal(invalid.recovery_installer_effect_allowed, false);
  assert.equal(invalid.automatic_retry_allowed, false);
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
