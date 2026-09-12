import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { executeDeveloperEmergencyUpdate } from '../src/developer-emergency-update-runtime.mjs';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal } = require('../src/browser-guardian-effect-journal.cjs');

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const NONCE = 'n'.repeat(32);
const GIT_SHA = 'a'.repeat(40);
const INSTALLER_SHA = 'a'.repeat(64);
const EXE_SHA = 'b'.repeat(64);
const MANIFEST_SHA = 'c'.repeat(64);
const release = Object.freeze({ release_id: 'v0.7.0-dev.3.1', artifact_sha256: INSTALLER_SHA });
const binding = Object.freeze({ guardian_instance_id: 'guardian-emergency-runtime-a', executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe' });

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
    enrollment_evidence_sha256: INSTALLER_SHA,
    device_key_fingerprint_sha256: EXE_SHA,
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
    release_version: '0.7.0-dev.3.1',
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
    reason: 'DEVELOPER_EMERGENCY_TEST',
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-developer-emergency-'));
  const journal = new BrowserGuardianEffectJournal({ statePath: path.join(root, 'guardian-state.json') });
  await journal.init(binding);
  return { root, journal };
}

async function cleanup(root) { await fs.rm(root, { recursive: true, force: true }); }

function baseArgs(f, overrides = {}) {
  return {
    command: command(),
    owner_binding: ownerBinding(),
    release_gate: releaseGate(),
    guardian_recovery_plan: recoveryPlan(),
    guardian_effect_plan: effectPlan(),
    guardian_journal: f.journal,
    guardian_binding: binding,
    revalidate_candidate: async () => ({ proven: true, installer_sha256: INSTALLER_SHA, manifest_sha256: MANIFEST_SHA }),
    dispatch_activation: async () => ({ state: 'DISPATCHED', pid: 9401, process_incarnation_id: 'emergency-successor-1' }),
    observe_activation: async ({ pid, process_incarnation_id }) => ({ state: 'READY', pid, process_incarnation_id, release, exact_ready_binding: true }),
    ...overrides,
  };
}

test('valid developer emergency proofs bypass program policy and dispatch exactly one Guardian activation', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeDeveloperEmergencyUpdate(baseArgs(f, {
      dispatch_activation: async () => {
        dispatchCalls += 1;
        return { state: 'DISPATCHED', pid: 9401, process_incarnation_id: 'emergency-successor-1' };
      },
    }));
    assert.equal(out.state, 'CONFIRMED');
    assert.equal(out.admitted, true);
    assert.equal(out.bypass_program_policy, true);
    assert.equal(out.bypassed_browser_mode, true);
    assert.equal(out.bypassed_browser_armed_state, true);
    assert.equal(out.bypassed_browser_rollout_policy, true);
    assert.equal(out.bypassed_browser_update_cadence, true);
    assert.equal(out.bypassed_browser_self_update_state, true);
    assert.equal(out.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'CONFIRMED');
  } finally { await cleanup(f.root); }
});

test('missing developer device proof holds before Guardian journal or physical dispatch', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeDeveloperEmergencyUpdate(baseArgs(f, {
      owner_binding: ownerBinding({ device_binding_proven: false }),
      dispatch_activation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
    }));
    assert.equal(out.state, 'HOLD');
    assert.equal(out.reason, 'DEVELOPER_OWNER_DEVICE_BINDING_REQUIRED');
    assert.equal(out.physical_dispatch_count, 0);
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot(), null);
  } finally { await cleanup(f.root); }
});

test('release digest drift is fenced before physical dispatch', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeDeveloperEmergencyUpdate(baseArgs(f, {
      revalidate_candidate: async () => ({ proven: true, installer_sha256: 'f'.repeat(64), manifest_sha256: MANIFEST_SHA }),
      dispatch_activation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
    }));
    assert.equal(out.state, 'PRE_EFFECT_FENCED');
    assert.equal(out.physical_dispatch_count, 0);
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot().state, 'NO_EFFECT_PROVEN');
  } finally { await cleanup(f.root); }
});

test('Guardian effect plan cannot point emergency admission at another artifact', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeDeveloperEmergencyUpdate(baseArgs(f, {
      guardian_effect_plan: effectPlan({ target_release: { ...release, artifact_sha256: 'f'.repeat(64) } }),
      dispatch_activation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
    }));
    assert.equal(out.state, 'HOLD');
    assert.equal(out.reason, 'GUARDIAN_EFFECT_PLAN_RELEASE_BINDING_REQUIRED');
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot(), null);
  } finally { await cleanup(f.root); }
});

test('ambiguous first activation permanently fences blind replay of the same emergency effect', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  const args = baseArgs(f, {
    dispatch_activation: async () => {
      dispatchCalls += 1;
      throw new Error('native handoff outcome lost');
    },
    observe_activation: async () => ({ state: 'UNRESOLVED' }),
  });
  try {
    const first = await executeDeveloperEmergencyUpdate(args);
    assert.equal(first.state, 'AMBIGUOUS');
    assert.equal(first.physical_dispatch_count, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');

    const second = await executeDeveloperEmergencyUpdate(args);
    assert.equal(second.state, 'HELD_UNRESOLVED');
    assert.equal(second.physical_dispatch_count, 0);
    assert.equal(dispatchCalls, 1);
    assert.equal(f.journal.snapshot().state, 'AMBIGUOUS');
  } finally { await cleanup(f.root); }
});

test('arbitrary URL field is rejected at admission before all effects', async () => {
  const f = await fixture();
  let dispatchCalls = 0;
  try {
    const out = await executeDeveloperEmergencyUpdate(baseArgs(f, {
      command: command({ url: 'https://example.invalid/emergency.exe' }),
      dispatch_activation: async () => { dispatchCalls += 1; return { state: 'AMBIGUOUS' }; },
    }));
    assert.equal(out.state, 'HOLD');
    assert.equal(out.reason, 'EMERGENCY_COMMAND_INVALID');
    assert.equal(out.arbitrary_url_allowed, false);
    assert.equal(dispatchCalls, 0);
    assert.equal(f.journal.snapshot(), null);
  } finally { await cleanup(f.root); }
});
