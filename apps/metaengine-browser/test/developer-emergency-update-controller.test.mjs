import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  createDeveloperEmergencyUpdateController,
  developerEmergencyUpdateControllerContract,
} from '../src/developer-emergency-update-controller.mjs';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal } = require('../src/browser-guardian-effect-journal.cjs');

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174111';
const NONCE = 'controllerNonce0123456789ABCDEFGHIJ';
const GIT_SHA = 'a'.repeat(40);
const INSTALLER_SHA = 'b'.repeat(64);
const EXE_SHA = 'c'.repeat(64);
const MANIFEST_SHA = 'd'.repeat(64);
const release = Object.freeze({ release_id: 'v0.7.0-dev.4.1', artifact_sha256: INSTALLER_SHA });
const binding = Object.freeze({ guardian_instance_id: 'guardian-emergency-controller-a', executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe' });

function command(payload = {}) {
  return {
    command_id: COMMAND_ID,
    action: 'DEVELOPER_EMERGENCY_UPDATE',
    payload: {
      schema: 'metaengine.developer-emergency-update.v1',
      request_nonce: NONCE,
      release_mode: 'LATEST_TRUSTED',
      ...payload,
    },
  };
}

function ownerBinding(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.owner-session-binding.v1',
    durable_owner_binding_proven: true,
    device_binding_proven: true,
    caller_supplied_owner_sid_allowed: false,
    enrollment_evidence_sha256: 'e'.repeat(64),
    device_key_fingerprint_sha256: 'f'.repeat(64),
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function releaseGate(overrides = {}) {
  return {
    schema: 'metaengine.browser-fabric.release-authority-gate.v1',
    action: 'AUTHORITY_ADVANCE_CANDIDATE',
    authority_advance_candidate: true,
    requires_separate_journaled_promotion_effect: true,
    release_authority: false,
    automatic_retry_allowed: false,
    candidate_sha: GIT_SHA,
    release_tag: release.release_id,
    release_version: '0.7.0-dev.4.1',
    installer_sha256: INSTALLER_SHA,
    installed_executable_sha256: EXE_SHA,
    manifest_sha256: MANIFEST_SHA,
    authority_effect: false,
    ...overrides,
  };
}

function recoveryPlan(overrides = {}) {
  return {
    schema: 'metaengine.browser-fabric.guardian-recovery-plan.v1',
    action: 'STAGE_INACTIVE_SLOT_CANDIDATE',
    reason: 'DEVELOPER_EMERGENCY_CONTROLLER_TEST',
    requires_existing_guardian_effect_journal: true,
    release_publication_authority: false,
    policy_authority: false,
    direct_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function effectPlan(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.plan.v1',
    action: 'ACTIVATE_CANDIDATE',
    process_effect_candidate: true,
    requires_external_executor: true,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
    target_release: release,
    ...overrides,
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-emergency-controller-'));
  const journal = new BrowserGuardianEffectJournal({ statePath: path.join(root, 'guardian-state.json') });
  await journal.init(binding);
  return { root, journal };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

function providers(f, overrides = {}) {
  return {
    derive_owner_binding: async ({ request_nonce }) => {
      assert.equal(request_nonce, NONCE);
      return ownerBinding();
    },
    derive_release_gate: async () => releaseGate(),
    derive_guardian_recovery_plan: async () => recoveryPlan(),
    derive_guardian_effect_plan: async () => effectPlan(),
    guardian_journal: async () => f.journal,
    guardian_binding: async () => binding,
    revalidate_candidate: async () => ({ proven: true, installer_sha256: INSTALLER_SHA, manifest_sha256: MANIFEST_SHA }),
    dispatch_activation: async () => ({ state: 'DISPATCHED', pid: 9510, process_incarnation_id: 'controller-successor-1' }),
    observe_activation: async () => ({ state: 'READY', pid: 9510, process_incarnation_id: 'controller-successor-1', release, exact_ready_binding: true }),
    ...overrides,
  };
}

test('controller contract forbids caller proof/url/executable/shell and Electron fallback', () => {
  const contract = developerEmergencyUpdateControllerContract();
  assert.equal(contract.accepts_leased_command_only, true);
  assert.equal(contract.caller_supplied_proofs_allowed, false);
  assert.equal(contract.caller_supplied_url_allowed, false);
  assert.equal(contract.caller_supplied_executable_allowed, false);
  assert.equal(contract.caller_supplied_shell_allowed, false);
  assert.equal(contract.electron_updater_fallback_allowed, false);
  assert.equal(contract.durable_guardian_journal_required, true);
  assert.equal(contract.automatic_retry_allowed, false);
});

test('invalid caller payload is rejected before any local proof provider', async () => {
  let providerCalls = 0;
  const controller = createDeveloperEmergencyUpdateController({
    providers: {
      derive_owner_binding: async () => { providerCalls += 1; return ownerBinding(); },
    },
  });
  const out = await controller(command({ url: 'https://example.invalid/emergency.exe' }));
  assert.equal(out.state, 'HOLD');
  assert.equal(out.reason, 'EMERGENCY_COMMAND_INVALID');
  assert.equal(out.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.equal(out.physical_dispatch_count, 0);
  assert.equal(providerCalls, 0);
});

test('missing native proof provider fails closed with proven zero effect', async () => {
  const controller = createDeveloperEmergencyUpdateController({ providers: {} });
  const out = await controller(command());
  assert.equal(out.state, 'HOLD');
  assert.equal(out.reason, 'DEVELOPER_EMERGENCY_LOCAL_PROVIDER_REQUIRED');
  assert.equal(out.missing_provider, 'derive_owner_binding');
  assert.equal(out.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.equal(out.physical_dispatch_count, 0);
});

test('stale or mismatching local owner/device result never reaches physical activation', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const controller = createDeveloperEmergencyUpdateController({
      providers: providers(f, {
        derive_owner_binding: async () => ownerBinding({ device_binding_proven: false }),
        dispatch_activation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
      }),
    });
    const out = await controller(command());
    assert.equal(out.state, 'HOLD');
    assert.equal(out.reason, 'DEVELOPER_OWNER_DEVICE_BINDING_REQUIRED');
    assert.equal(out.effect_outcome, 'NO_EFFECT_PROVEN');
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot(), null);
  } finally { await cleanup(f.root); }
});

test('expected git SHA mismatch is fenced before Guardian effect journal', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const controller = createDeveloperEmergencyUpdateController({
      providers: providers(f, {
        dispatch_activation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
      }),
    });
    const out = await controller(command({ expected_git_sha: '9'.repeat(40) }));
    assert.equal(out.state, 'HOLD');
    assert.equal(out.reason, 'VERIFIED_RELEASE_GATE_REQUIRED');
    assert.equal(out.effect_outcome, 'NO_EFFECT_PROVEN');
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot(), null);
  } finally { await cleanup(f.root); }
});

test('locally derived exact proofs produce one journaled Guardian activation', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const controller = createDeveloperEmergencyUpdateController({
      providers: providers(f, {
        dispatch_activation: async () => {
          dispatchCalls += 1;
          return { state: 'DISPATCHED', pid: 9510, process_incarnation_id: 'controller-successor-1' };
        },
      }),
    });
    const out = await controller(command({ expected_git_sha: GIT_SHA }));
    assert.equal(out.state, 'CONFIRMED');
    assert.equal(out.effect_outcome, 'CONFIRMED');
    assert.equal(out.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'CONFIRMED');
  } finally { await cleanup(f.root); }
});

test('ambiguous native activation is journal-fenced against blind replay', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const controller = createDeveloperEmergencyUpdateController({
      providers: providers(f, {
        dispatch_activation: async () => {
          dispatchCalls += 1;
          throw new Error('native_activation_result_lost');
        },
        observe_activation: async () => ({ state: 'UNRESOLVED' }),
      }),
    });
    const first = await controller(command());
    assert.equal(first.state, 'AMBIGUOUS');
    assert.equal(first.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);

    const second = await controller(command());
    assert.equal(second.state, 'HELD_UNRESOLVED');
    assert.equal(second.physical_dispatch_count, 0);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
  } finally { await cleanup(f.root); }
});
