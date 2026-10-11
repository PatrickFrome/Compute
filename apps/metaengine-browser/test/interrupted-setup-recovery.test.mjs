import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { InterruptedSetupRecovery, interruptedSetupDigest, planInterruptedSetupRecovery } from '../src/interrupted-setup-recovery.mjs';
import { SupervisorKeepalive as SupervisorBootstrapKeepalive } from '../src/supervisor-keepalive.mjs';
import { FleetProvisioner } from '../src/fleet-provisioner-core.mjs';

const recoveryId = 'recovery_9389026c-f74a-48a3-a3f0-b336e7d1c619';
function fixture() {
  return {
    keepalive: {
      schema: 'metaengine.supervisor-keepalive.state.v1', supervisor_id: 'METAENGINE_SUPERVISOR', state: 'WAKE_AMBIGUOUS', supervisor_epoch: 2, cycle_seq: 2110,
      process_incarnation_id: 'process_current', predecessor_process_incarnation_id: 'process_previous',
      predecessor_fenced_at: '2026-10-11T05:00:00.000Z', admission_state: 'OPEN', admission_generation_floor: 28,
      conversation_url: null, active_wake: null, rollover_attempt: null, queued_wakes: [], ambiguous_history: [],
      pending_wake: { wake_id: 'wake_previous', reason: 'CONTINUE_DEVELOPMENT', supervisor_epoch: 2, cycle_seq: 2110,
        process_incarnation_id: 'process_old', ambiguous_at: '2026-10-05T12:31:01.588Z', ambiguous_reason: 'SEND_CLICK_EFFECT_AMBIGUOUS',
        ambiguity_continuation_tab_id: 'tab_old_supervisor', process_boundary_fenced_at: '2026-10-05T12:33:36.354Z',
        automatic_retry_allowed: false, private_bootstrap_marker: 'exact-private-evidence' },
    },
    fleet: { schema: 'metaengine.browser.fleet-state.v1', policy: {}, agents: [{
      agent_id: 'agent_00000000-0000-0000-0000-000000000001', role: 'PLANNER', provider: 'CHATGPT', platform: 'CHATGPT',
      lifecycle_state: 'PROVISIONING_AMBIGUOUS', ambiguous_reason: 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING',
      tab_id: 'tab_old_agent', target_id: 'webcontents:3', generation_epoch: 28, conversation_epoch: 0,
      conversation_url_sha256: null, transport_proof: null, automatic_retry_allowed: false,
    }] },
    tabs: [{ tab_id: 'tab_current_root', url: 'https://chatgpt.com/' }],
  };
}
function request(snapshot) {
  return { schema: 'metaengine.client.interrupted-setup-request.v1', action: 'ARCHIVE_INTERRUPTED_SETUP_AND_START_NEW',
    operator_initiated: true, expected_recovery_sha256: planInterruptedSetupRecovery(snapshot).expected_recovery_sha256 };
}
async function harness(t, { failure = null, fileSystem = fs } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-interrupted-setup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let state = fixture();
  const effects = [];
  const controller = new InterruptedSetupRecovery({ directory, fileSystem, uuid: () => recoveryId.slice(9),
    getSnapshot: async () => structuredClone(state),
    applyFleet: async binding => {
      const archive = JSON.parse(await fs.readFile(path.join(directory, `${recoveryId}.archive.json`), 'utf8'));
      assert.equal(archive.keepalive.pending_wake.private_bootstrap_marker, 'exact-private-evidence');
      assert.equal(interruptedSetupDigest(archive), binding.archive_sha256);
      effects.push('fleet');
      state.fleet.agents[0].lifecycle_state = 'RETIRED';
      if (failure === 'fleet') throw new Error('injected_fleet_failure');
    },
    applySupervisor: async binding => {
      effects.push('supervisor');
      if (failure === 'supervisor') throw new Error('injected_supervisor_failure');
      state.keepalive.ambiguous_history.push({ ...state.keepalive.pending_wake, operator_recovery_id: binding.recovery_id });
      state.keepalive.pending_wake = null;
      state.keepalive.supervisor_epoch += 1;
    },
  });
  await controller.init();
  return { controller, directory, effects, getState: () => structuredClone(state), setState: value => { state = value; } };
}

test('fresh setup planner requires exact cross-process unbound absent bootstrap targets', () => {
  assert.equal(planInterruptedSetupRecovery(fixture()).eligible, true);
  const cases = [
    ['CURRENT_NATIVE_CENSUS_UNAVAILABLE', state => { delete state.tabs; }],
    ['BOUND_OR_ACTIVE_SETUP_REQUIRES_READBACK', state => { state.keepalive.conversation_url = 'https://chatgpt.com/c/private'; }],
    ['BOUND_OR_ACTIVE_SETUP_REQUIRES_READBACK', state => { state.keepalive.rollover_attempt = { attempt_id: 'rollover_old' }; }],
    ['CROSS_PROCESS_BOUNDARY_REQUIRED', state => { state.keepalive.pending_wake.process_incarnation_id = 'process_current'; }],
    ['DURABLE_PREDECESSOR_FENCE_REQUIRED', state => { delete state.keepalive.pending_wake.process_boundary_fenced_at; }],
    ['NON_BOOTSTRAP_AGENT_REQUIRES_READBACK', state => { state.fleet.agents[0].ambiguous_reason = 'CONVERSATION_IDENTITY_CONFLICT'; }],
    ['PREDECESSOR_TARGET_STILL_PRESENT', state => { state.tabs.push({ tab_id: 'tab_old_agent', url: 'https://chatgpt.com/' }); }],
    ['PREDECESSOR_TARGET_STILL_PRESENT', state => { state.tabs.push({ tab_id: 'tab_old_supervisor', url: 'https://chatgpt.com/' }); }],
    ['EXISTING_CONVERSATION_REQUIRES_READBACK', state => { state.tabs.push({ tab_id: 'tab_other', url: 'https://chatgpt.com/c/existing' }); }],
  ];
  for (const [reason, alter] of cases) {
    const state = fixture(); alter(state);
    const plan = planInterruptedSetupRecovery(state);
    assert.equal(plan.eligible, false, reason); assert.equal(plan.reason, reason);
  }
  const projection = JSON.stringify(planInterruptedSetupRecovery(fixture()));
  assert.equal(projection.includes('exact-private-evidence'), false);
  assert.equal(projection.includes('https://'), false);
});

test('typed recovery rejects stale identity and implicit actions before any archive or mutation', async t => {
  const { controller, directory, effects, getState } = await harness(t);
  await assert.rejects(controller.execute({ ...request(getState()), operator_initiated: false }), /explicit_typed/);
  await assert.rejects(controller.execute({ ...request(getState()), arbitrary_path: 'C:/private' }), /explicit_typed/);
  const stale = request(getState());
  stale.expected_recovery_sha256 = 'f'.repeat(64);
  await assert.rejects(controller.execute(stale), /readback_changed/);
  assert.deepEqual(await fs.readdir(directory), []); assert.deepEqual(effects, []);
  assert.equal(controller.status().fenced, false);
});

test('durable full archive precedes local mutation and retains UNKNOWN previous effect', async t => {
  const { controller, directory, effects, getState } = await harness(t);
  const previous = getState();
  const receipt = await controller.execute(request(previous));
  assert.equal(receipt.state, 'FRESH_SETUP_PREPARED');
  assert.equal(receipt.previous_effect_outcome, 'UNKNOWN');
  assert.equal(receipt.previous_effect_replayed, false);
  assert.equal(receipt.tasks_modified, false); assert.equal(receipt.sql_admission_modified, false);
  assert.deepEqual(effects, ['fleet', 'supervisor']);
  const archiveBytes = await fs.readFile(path.join(directory, `${recoveryId}.archive.json`), 'utf8');
  const archive = JSON.parse(archiveBytes);
  assert.deepEqual(archive.keepalive, previous.keepalive); assert.deepEqual(archive.fleet, previous.fleet);
  assert.equal(archive.previous_effect_outcome, 'UNKNOWN');
  assert.equal(controller.status().fenced, false);
  await assert.rejects(controller.execute(request(previous)), /readback_changed/);
  assert.equal(await fs.readFile(path.join(directory, `${recoveryId}.archive.json`), 'utf8'), archiveBytes);
});

for (const failure of ['fleet', 'supervisor']) test(`partial ${failure} apply remains fenced across restart without replay`, async t => {
  const { controller, directory, effects, getState } = await harness(t, { failure });
  await assert.rejects(controller.execute(request(getState())), new RegExp(`injected_${failure}_failure`));
  const effectCount = effects.length;
  assert.equal(controller.status().fenced, true);
  await assert.rejects(controller.execute(request(getState())), /incomplete_recovery_fenced/);
  assert.equal(effects.length, effectCount);
  const restarted = new InterruptedSetupRecovery({ directory, getSnapshot: getState,
    applyFleet: () => assert.fail('no recovery replay'), applySupervisor: () => assert.fail('no recovery replay') });
  assert.equal((await restarted.init()).fenced, true);
  assert.equal((await restarted.inspect()).eligible, false);
});

test('archive fsync failure performs no mutation and fences retained uncertain bytes', async t => {
  const injected = { ...fs, open: async (...args) => {
    const real = await fs.open(...args);
    return { writeFile: (...args) => real.writeFile(...args), sync: async () => { throw new Error('injected_sync'); }, close: () => real.close() };
  } };
  const { controller, directory, effects, getState } = await harness(t, { fileSystem: injected });
  await assert.rejects(controller.execute(request(getState())), /injected_sync/);
  assert.deepEqual(effects, []); assert.equal(controller.status().fenced, true);
  assert.equal((await fs.readdir(directory)).length, 1);
});

for (const stage of ['write', 'close', 'readback', 'commit']) test(`${stage} persistence failure cannot report fresh setup complete`, async t => {
  let artifact = null;
  const injected = { ...fs,
    open: async (...args) => {
      artifact = String(args[0]);
      if (stage === 'commit' && artifact.endsWith('.committed.json')) throw new Error('injected_commit');
      const real = await fs.open(...args);
      return {
        writeFile: async (...writeArgs) => {
          if (stage === 'write') { await real.writeFile('{partial', 'utf8'); throw new Error('injected_write'); }
          return real.writeFile(...writeArgs);
        }, sync: () => real.sync(), close: async () => { await real.close(); if (stage === 'close') throw new Error('injected_close'); },
      };
    },
    readFile: async (...args) => stage === 'readback' && String(args[0]) === artifact ? 'wrong-bytes' : fs.readFile(...args),
  };
  const { controller, directory, effects, getState } = await harness(t, { fileSystem: injected });
  await assert.rejects(controller.execute(request(getState())), stage === 'readback' ? /readback_mismatch/ : new RegExp(`injected_${stage}`));
  assert.equal(controller.status().fenced, true);
  if (stage !== 'commit') assert.deepEqual(effects, []);
  else assert.deepEqual(effects, ['fleet', 'supervisor']);
  const restarted = new InterruptedSetupRecovery({ directory, getSnapshot: getState,
    applyFleet: () => assert.fail('no replay'), applySupervisor: () => assert.fail('no replay') });
  if (stage === 'write') await assert.rejects(restarted.init(), SyntaxError);
  else assert.equal((await restarted.init()).fenced, true);
});

test('missing fleet readback after local apply cannot be treated as confirmed retirement', async t => {
  const { directory, getState, setState } = await harness(t);
  const controller = new InterruptedSetupRecovery({ directory, uuid: () => recoveryId.slice(9), getSnapshot: getState,
    applyFleet: () => { const state = getState(); state.fleet.agents = []; setState(state); },
    applySupervisor: binding => {
      const state = getState();
      state.keepalive.ambiguous_history.push({ ...state.keepalive.pending_wake, operator_recovery_id: binding.recovery_id });
      state.keepalive.pending_wake = null; state.keepalive.supervisor_epoch += 1; setState(state);
    } });
  await controller.init();
  await assert.rejects(controller.execute(request(getState())), /apply_readback_unconfirmed/);
  assert.equal(controller.status().fenced, true);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.committed.json')), false);
});

test('storage verification failure blocks use of broad or redirected recovery files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-recovery-private-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const controller = new InterruptedSetupRecovery({ directory, getSnapshot: async () => fixture(),
    applyFleet: () => assert.fail('no effects'), applySupervisor: () => assert.fail('no effects'),
    verifyDirectory: () => { throw new Error('private_directory_unverified'); } });
  await assert.rejects(controller.init(), /private_directory_unverified/);
});

test('a new live predecessor target after durable archive prevents both mutations', async t => {
  const { controller, directory, effects, getState, setState } = await harness(t);
  const initial = getState();
  const realWrite = fs.open;
  // Inject at the durable archive close/readback boundary through a fileSystem
  // adapter, using the real disk write so stale native state must be re-read.
  const second = new InterruptedSetupRecovery({ directory, uuid: () => recoveryId.slice(9),
    getSnapshot: async () => {
      if ((await fs.readdir(directory)).length) { const changed = getState(); changed.tabs.push({ tab_id: 'tab_old_agent' }); setState(changed); }
      return getState();
    }, applyFleet: () => effects.push('fleet'), applySupervisor: () => effects.push('supervisor'), fileSystem: { ...fs, open: realWrite } });
  await second.init();
  await assert.rejects(second.execute(request(initial)), /readback_changed_after_archive/);
  assert.deepEqual(effects, []); assert.equal(second.status().fenced, true);
});

test('real keepalive and fleet archive methods preserve unknown history and never mark ACTIVE', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-recovery-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = fixture();
  let keepaliveDisk = original.keepalive;
  let fleetDisk = original.fleet;
  const keepalive = new SupervisorBootstrapKeepalive({ processIncarnationId: 'process_current',
    loadState: async () => keepaliveDisk, saveState: async value => { keepaliveDisk = structuredClone(value); } });
  await keepalive.init();
  const fleet = new FleetProvisioner({ createTab: () => assert.fail('recovery cannot create tabs'), loadTab: () => assert.fail('recovery cannot navigate'),
    tabExists: () => false, loadState: async () => fleetDisk, saveState: async value => { fleetDisk = structuredClone(value); }, policy: {} });
  await fleet.init();
  const controller = new InterruptedSetupRecovery({ directory, uuid: () => recoveryId.slice(9),
    getSnapshot: async () => ({ keepalive: keepalive.snapshot(), fleet: fleet.snapshot(), tabs: [] }),
    applyFleet: binding => fleet.archiveInterruptedBootstrapAgents(binding),
    applySupervisor: binding => keepalive.archiveInterruptedBootstrapForNewEpoch(binding) });
  await controller.init();
  const before = { keepalive: keepalive.snapshot(), fleet: fleet.snapshot(), tabs: [] };
  await controller.execute(request(before));
  assert.equal(keepalive.snapshot().supervisor_epoch, 3);
  assert.equal(keepalive.snapshot().cycle_seq, 0);
  assert.equal(keepalive.snapshot().pending_wake, null);
  const archived = keepalive.snapshot().ambiguous_history.at(-1);
  for (const [key, value] of Object.entries(before.keepalive.pending_wake)) assert.deepEqual(archived[key], value);
  assert.equal(archived.previous_effect_outcome, 'UNKNOWN');
  assert.equal(keepalive.snapshot().admission_state, before.keepalive.admission_state);
  assert.equal(fleet.snapshot().agents[0].lifecycle_state, 'RETIRED');
  assert.equal(fleet.snapshot().agents[0].generation_epoch, 29);
  assert.equal(fleet.snapshot().agents[0].automatic_retry_allowed, false);
});

test('native recovery hold serializes explicit operations and remains closed after uncertain apply', async () => {
  const source = await fs.readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('  canStartMaintenance() {');
  const end = source.indexOf('  async archiveInterruptedBootstrapForNewEpoch(binding)', begin);
  assert.ok(begin >= 0 && end > begin);
  // Run the actual mutation-hold methods in their private-field scope. Other
  // native dependencies (Electron, update services, network) stay absent.
  const NativeHold = vm.runInNewContext(`(class {
    #interruptedSetupRecoveryHold = false; #currentCommands = new Map(); #legacyFastlaneBusy = false; #maintenancePromise = null;
    ${source.slice(begin, end)}
    snapshot() { return { continuous_service: { interrupted_setup_recovery_fenced: this.#interruptedSetupRecoveryHold } }; }
  })`);
  const client = new NativeHold();
  assert.equal(client.canStartMaintenance(), true);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const operation = client.withInterruptedSetupRecovery(async () => {
    assert.equal(client.canStartMaintenance(), false);
    assert.equal(client.snapshot().continuous_service.interrupted_setup_recovery_fenced, true);
    await pending;
    return { state: 'FRESH_SETUP_PREPARED' };
  });
  await assert.rejects(client.withInterruptedSetupRecovery(() => assert.fail('no concurrent recovery')), /native_mutation_busy/);
  release();
  assert.equal((await operation).state, 'FRESH_SETUP_PREPARED');
  assert.equal(client.canStartMaintenance(), true);
  await assert.rejects(client.withInterruptedSetupRecovery(() => { throw new Error('uncertain_apply'); }), /uncertain_apply/);
  assert.equal(client.canStartMaintenance(), false);
  await assert.rejects(client.withInterruptedSetupRecovery(() => assert.fail('no retry')), /native_mutation_busy/);
});
