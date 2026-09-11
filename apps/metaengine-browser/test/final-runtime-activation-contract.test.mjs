import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyFinalRuntimeCommand } from '../src/final-runtime-activation.mjs';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function source(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('packaged browser enters through the final runtime activation hook', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.equal(pkg.main, 'src/final-runtime-entry.mjs');

  const entry = source('src/final-runtime-entry.mjs');
  assert.match(entry, /registerHooks/);
  assert.match(entry, /development-plane-activated\.mjs/);
  assert.match(entry, /native-supervisor-client-activated\.mjs/);
  assert.match(entry, /context\.parentURL !== mainUrl/);
  assert.match(entry, /probeStdoutReserved/);
  assert.match(entry, /second_scheduler: false/);

  const development = source('src/development-plane-activated.mjs');
  assert.match(development, /extends ProvenDevelopmentPlane/);
  assert.match(development, /registerFinalRuntimeDevelopmentPlane\(this\)/);

  const supervisor = source('src/native-supervisor-client-activated.mjs');
  assert.match(supervisor, /extends ProvenNativeSupervisorClient/);
  assert.match(supervisor, /markFinalRuntimeSupervisorStarted\(this\)/);
  assert.match(supervisor, /final_runtime_activation_required/);
});

test('Host activation is primary before enrollment while remote signing remains fail-closed', () => {
  const hostIdentity = source('src/host-agent-supervisor-identity.mjs');
  const connectBody = hostIdentity.match(/async connect\(\) \{([\s\S]*?)\n    \},/)?.[1] || '';
  assert.match(connectBody, /await client\.connect\(\)/);
  assert.doesNotMatch(connectBody, /identity\.ensure\(/);
  assert.match(hostIdentity, /WAITING_FOR_ENROLLMENT/);
  assert.match(hostIdentity, /startup_requires_enrollment: false/);
  assert.match(hostIdentity, /remote_requests_require_enrollment: true/);
  assert.match(hostIdentity, /remote_signing_ready: enrolled/);

  const strictDelegation = source('src/supervisor-identity-delegation.mjs');
  assert.match(strictDelegation, /!UUID_RE\.test\(clientId\) \|\| !UUID_RE\.test\(deviceId\)/);
  assert.match(strictDelegation, /supervisor_identity_delegation_identity_invalid/);
});

test('verified execution refuses to confirm an unproven mutation', () => {
  const command = {
    action: 'TYPED_CLICK',
    payload: { tab_id: 'tab_00000000-0000-4000-8000-000000000001' },
  };
  const verification = verifyFinalRuntimeCommand(command, { ok: true, authority_effect: true }, {
    tabs: [{ tab_id: command.payload.tab_id, selected: true, url: 'https://chatgpt.com/' }],
    active_tab: { tab_id: command.payload.tab_id, url: 'https://chatgpt.com/' },
  });
  assert.deepEqual(verification, {
    confirmed: false,
    no_effect_proven: false,
    evidence_conflict: false,
    evidence: 'POSTCONDITION_NOT_PROVEN',
    automatic_retry_allowed: false,
    authority_effect: false,
  });
});

test('verified execution accepts exact tab readback for select and close', () => {
  const tabId = 'tab_00000000-0000-4000-8000-000000000001';
  assert.equal(verifyFinalRuntimeCommand({ action: 'SELECT_TAB', payload: { tab_id: tabId } }, {}, {
    tabs: [{ tab_id: tabId, selected: true }],
    active_tab: { tab_id: tabId },
  }).confirmed, true);
  assert.equal(verifyFinalRuntimeCommand({ action: 'CLOSE_TAB', payload: { tab_id: tabId } }, {}, {
    tabs: [],
    active_tab: null,
  }).confirmed, true);
});

test('activation registry remains single-scheduler and never fabricates production authority', () => {
  const activation = source('src/final-runtime-activation.mjs');
  const registry = source('src/final-runtime-activation-registry.mjs');
  assert.match(activation, /scheduler_owner: 'NATIVE_SUPERVISOR_CLIENT'/);
  assert.match(activation, /fast_control_production_mutation_authority: false/);
  assert.match(activation, /production_authority_fabricated: false/);
  assert.match(registry, /second_scheduler: false/);
  assert.match(registry, /production_authority_fabricated: false/);
  assert.doesNotMatch(registry, /setInterval\(/);
});

test('self-update handoff quiesces activated Host and IPC before proven supervisor releases installer lock', () => {
  const supervisor = source('src/native-supervisor-client-activated.mjs');
  const registry = source('src/final-runtime-activation-registry.mjs');
  assert.match(supervisor, /beforeSelfUpdateInstall/);
  assert.match(supervisor, /quiesceFinalRuntimeSupervisor\(finalRuntimeSupervisor, 'SELF_UPDATE_INSTALLER_HANDOFF'\)/);
  assert.match(supervisor, /quiesced\.state !== 'IDLE'/);
  assert.match(registry, /export async function quiesceFinalRuntimeSupervisor/);
  assert.match(registry, /return stopActivation\(reason\)/);
});

test('machine-readable probes reserve stdout from activation telemetry', () => {
  const entry = source('src/final-runtime-entry.mjs');
  const registry = source('src/final-runtime-activation-registry.mjs');
  for (const flag of ['--metaengine-version-probe', '--metaengine-profile-probe', '--metaengine-single-instance-probe', '--metaengine-self-update-smoke']) {
    assert.ok(entry.includes(flag));
    assert.ok(registry.includes(flag));
  }
  assert.match(entry, /if \(probeStdoutReserved\) console\.error\(activationEntryRow\)/);
  assert.match(registry, /if \(error \|\| probeStdoutReserved\) console\.error\(text\)/);
});

test('production command lane keeps parallel cross-tab execution and serializes same-tab mutations', async () => {
  const main = source('src/main.mjs');
  assert.match(main, /commandBatchSize: 64/);
  assert.match(main, /commandReadConcurrency: 32/);
  assert.match(main, /commandMutationConcurrency: 16/);
  assert.match(main, /legacySingleLeaseFallback: false/);
  assert.match(main, /commandFastlane: false/);

  const scheduler = new NativeSupervisorCommandLaneScheduler({
    readConcurrency: 32,
    mutationConcurrency: 16,
    maxBatch: 64,
  });
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.read_concurrency, 32);
  assert.equal(snapshot.mutation_concurrency, 16);
  assert.equal(snapshot.same_tab_mutations_serialized, true);
  assert.equal(snapshot.cross_tab_reads_parallel, true);

  const tabA = 'tab_00000000-0000-4000-8000-000000000001';
  const tabB = 'tab_00000000-0000-4000-8000-000000000002';
  let active = 0;
  let maxActive = 0;
  await scheduler.drain([
    { action: 'CAPTURE', payload: { tab_id: tabA } },
    { action: 'CAPTURE', payload: { tab_id: tabB } },
    { action: 'NAVIGATE', payload: { tab_id: tabA } },
    { action: 'NAVIGATE', payload: { tab_id: tabB } },
  ], async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(25);
    active -= 1;
    return { ok: true };
  });
  assert.ok(maxActive >= 2, `cross-tab work did not execute concurrently: maxActive=${maxActive}`);

  active = 0;
  maxActive = 0;
  await scheduler.drain([
    { action: 'NAVIGATE', payload: { tab_id: tabA } },
    { action: 'NAVIGATE', payload: { tab_id: tabA } },
  ], async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(20);
    active -= 1;
    return { ok: true };
  });
  assert.equal(maxActive, 1);
});