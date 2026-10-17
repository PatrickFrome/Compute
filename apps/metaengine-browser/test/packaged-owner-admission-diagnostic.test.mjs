import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectPackagedOwnerAdmissionDiagnostic } from '../src/packaged-owner-admission-diagnostic.mjs';

test('packaged Owner startup reports a missing attached descriptor without authority or private paths', () => {
  const value = projectPackagedOwnerAdmissionDiagnostic({
    phase: 'PACKAGED_OWNER_ADMISSION',
    bootstrapState: 'NO_OWNER_CONFIG',
    attachmentState: 'NO_DESCRIPTOR',
  });
  assert.deepEqual(value, {
    phase: 'PACKAGED_OWNER_ADMISSION',
    bootstrap_state: 'NO_OWNER_CONFIG',
    attachment_state: 'NO_DESCRIPTOR',
    authority_effect: false,
  });
  assert(Object.isFrozen(value));
});

test('packaged Owner diagnostics distinguish a protected descriptor error from revalidation error', () => {
  assert.deepEqual(projectPackagedOwnerAdmissionDiagnostic({
    phase: 'ATTACHED_DESCRIPTOR_READBACK', bootstrapState: 'NO_OWNER_CONFIG',
  }), {
    phase: 'ATTACHED_DESCRIPTOR_READBACK', bootstrap_state: 'NO_OWNER_CONFIG',
    attachment_state: 'NOT_ATTEMPTED', authority_effect: false,
  });
  const revalidation = projectPackagedOwnerAdmissionDiagnostic({
    phase: 'ATTACHED_OWNER_REVALIDATION', bootstrapState: 'NO_OWNER_CONFIG',
    attachmentState: 'CONFIGURED',
  });
  assert.equal(revalidation.phase, 'ATTACHED_OWNER_REVALIDATION');
  assert.equal(revalidation.attachment_state, 'CONFIGURED');
});

test('diagnostic projection never publishes injected values or a false READY state', () => {
  const injected = 'C:\\private\\db\\credentials.json SECRET_TOKEN=never_export';
  const value = projectPackagedOwnerAdmissionDiagnostic({
    phase: injected, bootstrapState: injected, attachmentState: injected,
  });
  assert.deepEqual(value, {
    phase: 'UNKNOWN', bootstrap_state: 'UNKNOWN',
    attachment_state: 'UNKNOWN', authority_effect: false,
  });
  assert.doesNotMatch(JSON.stringify(value), /SECRET_TOKEN|private|credentials/);
  assert.equal(projectPackagedOwnerAdmissionDiagnostic().bootstrap_state, 'UNKNOWN');
});

test('source uses bounded diagnostic only on the existing fail-closed startup path', async () => {
  const entry = await readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const catchLocation = entry.indexOf("state: 'LOCAL_PROVIDER_STARTUP_BLOCKED'");
  const diagnosticLocation = entry.indexOf('...projectPackagedOwnerAdmissionDiagnostic({');
  const admissionLocation = entry.indexOf('requirePackagedLocalProviderAdmission({');
  assert(admissionLocation >= 0 && catchLocation > admissionLocation && diagnosticLocation > catchLocation);
  assert.match(entry, /ownerAdmissionPhase = 'ATTACHED_DESCRIPTOR_READBACK'/);
  assert.match(entry, /observedAttachedDescriptorState = setup.state/);
  assert.match(entry, /ownerAdmissionPhase = 'ATTACHED_OWNER_REVALIDATION'/);
  assert.match(entry, /observedOwnerBootstrapState = bootstrapState/);
  assert.match(entry, /browser_runtime_started: false/);
  assert.match(entry, /automatic_cloud_fallback: false/);
});
