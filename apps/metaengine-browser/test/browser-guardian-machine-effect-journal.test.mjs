import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  BrowserGuardianEffectJournal,
  BROWSER_GUARDIAN_EFFECT_DOMAINS,
  journalPath,
} = require('../src/browser-guardian-effect-journal.cjs');

const binding = Object.freeze({
  guardian_instance_id: 'guardian-installation-a',
  executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe',
});
const processRelease = Object.freeze({ release_id: 'release-dev-9', artifact_sha256: '9'.repeat(64) });
const sourceHead = '1'.repeat(40);
const guardianSha = 'a'.repeat(64);
const verifiedSha = 'b'.repeat(64);
const serviceSha = 'c'.repeat(64);
const configuratorSha = 'd'.repeat(64);
const version = '0.6.6-dev.123.1';
const slotId = `${sourceHead.slice(0,16)}-${guardianSha.slice(0,16)}`;
const slotPath = `%ProgramFiles%\\METAENGINE\\Guardian\\slots\\${slotId}`;
const requiredPrivileges = Object.freeze([
  'SeTcbPrivilege',
  'SeAssignPrimaryTokenPrivilege',
  'SeIncreaseQuotaPrivilege',
]);

function processPlan() {
  return {
    schema: 'metaengine.browser-guardian.plan.v1',
    action: 'START_CHILD',
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
    target_release: processRelease,
    process_absence_proven: true,
  };
}

function target() {
  return {
    slot_id: slotId,
    slot_path: slotPath,
    source_head: sourceHead,
    version,
    github_tag: `v${version}`,
    verified_self_update_manifest_sha256: verifiedSha,
    guardian_manifest_sha256: guardianSha,
    service_binary_sha256: serviceSha,
    service_binary_size: 238080,
    configurator_binary_sha256: configuratorSha,
    configurator_binary_size: 322560,
  };
}

function zeroAuthority(action, reason) {
  return {
    schema: 'metaengine.browser-guardian.bootstrap-plan.v1',
    protocol_generation: 2,
    action,
    reason,
    browser_authority: false,
    task_authority: false,
    page_model_text_authority: false,
    scheduler_authority: false,
    release_authority: false,
    service_configuration_authority: false,
    process_effect_authority: false,
    filesystem_effect_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    target: target(),
  };
}

function machineCopyPlan(overrides = {}) {
  return {
    ...zeroAuthority('COPY_EXACT_RELEASE_ASSETS', 'TARGET_SLOT_ABSENT'),
    copy_contract: {
      source: 'VERIFIED_GITHUB_RELEASE_ASSETS_ONLY',
      source_tag: `v${version}`,
      overwrite_existing: false,
      require_sha256_readback: true,
      require_size_readback: true,
      require_machine_acl_readback: true,
      require_final_path_readback: true,
    },
    ...overrides,
  };
}

function scmPlan(overrides = {}) {
  return {
    ...zeroAuthority('APPLY_SCM_CONFIG_EXACT_SLOT', 'TARGET_SLOT_READY_SERVICE_ABSENT'),
    ...overrides,
  };
}

function machineCopyProof(overrides = {}) {
  return {
    slot_id: slotId,
    slot_path: slotPath,
    source_head: sourceHead,
    guardian_manifest_sha256: guardianSha,
    service_binary_path: `${slotPath}\\METAENGINEBrowserGuardian.exe`,
    service_binary_sha256: serviceSha,
    service_binary_size: 238080,
    configurator_binary_path: `${slotPath}\\METAENGINEBrowserGuardianConfigure.exe`,
    configurator_binary_sha256: configuratorSha,
    configurator_binary_size: 322560,
    files_exact: true,
    exact_file_set: true,
    sha256_readback_proven: true,
    size_readback_proven: true,
    acl_machine_secure: true,
    final_path_inside_machine_root: true,
    ...overrides,
  };
}

function scmProof(overrides = {}) {
  return {
    readback_proven: true,
    service_name: 'METAENGINEBrowserGuardian',
    service_type: 'SERVICE_WIN32_OWN_PROCESS',
    start_type: 'SERVICE_AUTO_START',
    account: 'LocalSystem',
    binary_path: `${slotPath}\\METAENGINEBrowserGuardian.exe`,
    binary_sha256: serviceSha,
    machine_secure_binary_path: true,
    required_privileges: [...requiredPrivileges],
    service_sid_type: 'SERVICE_SID_TYPE_UNRESTRICTED',
    least_privilege_readback_proven: true,
    failure_reset_period: 'INFINITE',
    failure_actions: [
      { type: 'RESTART', delay_ms: 5000 },
      { type: 'RESTART', delay_ms: 15000 },
      { type: 'RESTART', delay_ms: 60000 },
    ],
    last_failure_action_repeats: true,
    non_crash_failure_actions: true,
    reboot_action: false,
    run_command_action: false,
    service_start_stop_effect: false,
    ...overrides,
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-machine-journal-'));
  return { root, statePath: path.join(root, 'guardian-state.json') };
}
async function cleanup(root) { await fs.rm(root, { recursive: true, force: true }); }

test('legacy PROCESS rows without effect_domain restore as PROCESS and keep the old digest resumable', async () => {
  const f = await fixture();
  try {
    const first = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await first.init(binding);
    const row = await first.beginEffect(binding, processPlan());
    const persisted = JSON.parse(await fs.readFile(journalPath(f.statePath), 'utf8'));
    delete persisted.effect_domain;
    await fs.writeFile(journalPath(f.statePath), JSON.stringify(persisted), 'utf8');

    const restored = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    const snapshot = await restored.init(binding);
    assert.equal(snapshot.effect_domain, BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS);
    const resumed = await restored.beginEffect(binding, processPlan());
    assert.equal(resumed.effect_id, row.effect_id);
    assert.equal(resumed.plan_digest, row.plan_digest);
  } finally { await cleanup(f.root); }
});

test('MACHINE_COPY intent is exact, idempotent, and serializes the shared canonical journal', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const first = await journal.beginMachineCopyEffect(binding, machineCopyPlan());
    const again = await journal.beginMachineCopyEffect(binding, machineCopyPlan());
    assert.equal(first.effect_domain, 'MACHINE_COPY');
    assert.equal(again.effect_id, first.effect_id);
    assert.equal(first.plan.target.slot_path, slotPath);
    assert.equal(first.plan.copy_contract.overwrite_existing, false);
    await assert.rejects(() => journal.beginScmConfigEffect(binding, scmPlan()), /guardian_effect_unresolved_intent_plan_drift/);
  } finally { await cleanup(f.root); }
});

test('MACHINE_COPY rejects authority drift and target/copy-contract drift before journaling', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    await assert.rejects(
      () => journal.beginMachineCopyEffect(binding, machineCopyPlan({ filesystem_effect_authority: true })),
      /guardian_machine_effect_plan_authority_invalid:filesystem_effect_authority/,
    );
    await assert.rejects(
      () => journal.beginMachineCopyEffect(binding, machineCopyPlan({ target: { ...target(), slot_path: '%ProgramFiles%\\METAENGINE\\Guardian\\slots\\wrong' } })),
      /guardian_machine_effect_slot_path_drift/,
    );
    await assert.rejects(
      () => journal.beginMachineCopyEffect(binding, machineCopyPlan({ copy_contract: { ...machineCopyPlan().copy_contract, overwrite_existing: true } })),
      /guardian_machine_copy_contract_invalid/,
    );
  } finally { await cleanup(f.root); }
});

test('generic success, generic process confirmation, dispatch and generic absence cannot confirm MACHINE_COPY', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginMachineCopyEffect(binding, machineCopyPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await assert.rejects(() => journal.confirmMachineCopyEffect(binding, intent.effect_id, { success: true }), /guardian_machine_copy_confirm_proof_invalid/);
    await assert.rejects(() => journal.confirmEffect(binding, intent.effect_id, { success: true }), /guardian_effect_process_domain_required/);
    await assert.rejects(() => journal.markDispatched(binding, intent.effect_id, { pid: 42 }), /guardian_effect_process_domain_required/);
    await assert.rejects(() => journal.proveNoEffect(binding, intent.effect_id, { effect_absent_proven: true }), /guardian_effect_typed_absence_proof_required/);
  } finally { await cleanup(f.root); }
});

test('MACHINE_COPY confirms only exact files, SHA-256, size, ACL and final-path readback', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginMachineCopyEffect(binding, machineCopyPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await assert.rejects(
      () => journal.confirmMachineCopyEffect(binding, intent.effect_id, machineCopyProof({ acl_machine_secure: false })),
      /guardian_machine_copy_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmMachineCopyEffect(binding, intent.effect_id, machineCopyProof({ service_binary_sha256: 'e'.repeat(64) })),
      /guardian_machine_copy_confirm_proof_invalid/,
    );
    const confirmed = await journal.confirmMachineCopyEffect(binding, intent.effect_id, machineCopyProof());
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(confirmed.result, 'exact_machine_copy_readback');
  } finally { await cleanup(f.root); }
});

test('ambiguous MACHINE_COPY cannot replay and converges only by late exact typed readback', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginMachineCopyEffect(binding, machineCopyPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    const ambiguous = await journal.markAmbiguous(binding, intent.effect_id, 'copy_transport_ack_lost');
    assert.equal(ambiguous.state, 'AMBIGUOUS');
    await assert.rejects(() => journal.beginMachineCopyEffect(binding, machineCopyPlan()), /guardian_effect_unresolved:AMBIGUOUS/);
    const confirmed = await journal.confirmMachineCopyEffect(binding, intent.effect_id, machineCopyProof());
    assert.equal(confirmed.result, 'late_exact_machine_copy_reconciliation');
  } finally { await cleanup(f.root); }
});

test('SCM_CONFIG intent binds LocalSystem path, least-privilege identity and perpetual recovery policy into the digest', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginScmConfigEffect(binding, scmPlan());
    assert.equal(intent.effect_domain, 'SCM_CONFIG');
    assert.deepEqual(intent.plan.scm_contract.failure_actions, [
      { type: 'RESTART', delay_ms: 5000 },
      { type: 'RESTART', delay_ms: 15000 },
      { type: 'RESTART', delay_ms: 60000 },
    ]);
    assert.deepEqual(intent.plan.scm_contract.required_privileges, requiredPrivileges);
    assert.equal(intent.plan.scm_contract.service_sid_type, 'SERVICE_SID_TYPE_UNRESTRICTED');
    assert.equal(intent.plan.scm_contract.least_privilege_readback_required, true);
    assert.equal(intent.plan.scm_contract.last_failure_action_repeats, true);
    assert.equal(intent.plan.scm_contract.account, 'LocalSystem');
    assert.equal(intent.plan.scm_contract.binary_path, `${slotPath}\\METAENGINEBrowserGuardian.exe`);

    const file = journalPath(f.statePath);
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    persisted.plan.scm_contract.required_privileges = ['SeTcbPrivilege'];
    await fs.writeFile(file, JSON.stringify(persisted), 'utf8');
    const restored = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await assert.rejects(() => restored.init(binding), /guardian_effect_plan_digest_drift/);
  } finally { await cleanup(f.root); }
});

test('SCM_CONFIG rejects path/account/recovery and least-privilege proof drift before exact confirmation', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginScmConfigEffect(binding, scmPlan());
    await journal.markEffectAttempted(binding, intent.effect_id);
    await assert.rejects(() => journal.confirmScmConfigEffect(binding, intent.effect_id, { success: true }), /guardian_scm_config_confirm_proof_invalid/);
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ readback_proven: false })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ account: 'User' })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ binary_path: 'C:\\Users\\x\\METAENGINEBrowserGuardian.exe' })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ required_privileges: requiredPrivileges.slice(0, 2) })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ required_privileges: [...requiredPrivileges, 'SeDebugPrivilege'] })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ service_sid_type: 'SERVICE_SID_TYPE_RESTRICTED' })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ least_privilege_readback_proven: false })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    await assert.rejects(
      () => journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof({ failure_actions: [{ type: 'RESTART', delay_ms: 5000 }] })),
      /guardian_scm_config_confirm_proof_invalid/,
    );
    const confirmed = await journal.confirmScmConfigEffect(binding, intent.effect_id, scmProof());
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(confirmed.result, 'exact_scm_config_readback');
  } finally { await cleanup(f.root); }
});

test('an unattempted typed intent can be abandoned without claiming any physical effect', async () => {
  const f = await fixture();
  try {
    const journal = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await journal.init(binding);
    const intent = await journal.beginMachineCopyEffect(binding, machineCopyPlan());
    const abandoned = await journal.abandonUnattemptedIntent(binding, intent.effect_id, 'planner_reobserved_target');
    assert.equal(abandoned.state, 'NO_EFFECT_PROVEN');
    assert.equal(abandoned.physical_effect_attempted, false);
    assert.equal(abandoned.effect_barrier_crossed, false);
    const next = await journal.beginScmConfigEffect(binding, scmPlan());
    assert.equal(next.effect_generation, 2);
    assert.equal(next.effect_domain, 'SCM_CONFIG');
  } finally { await cleanup(f.root); }
});
