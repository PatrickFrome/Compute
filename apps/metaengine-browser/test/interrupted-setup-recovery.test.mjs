import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { InterruptedSetupRecovery, interruptedSetupDigest, planInterruptedSetupRecovery } from '../src/interrupted-setup-recovery.mjs';
import { SupervisorKeepalive as SupervisorBootstrapKeepalive } from '../src/supervisor-keepalive.mjs';
import { FleetProvisioner } from '../src/fleet-provisioner-core.mjs';
import { createBrowserParentSuspensionMutationGate } from '../src/browser-parent-suspension-mutation-gate.mjs';

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
  await assert.rejects(controller.execute(request(getState())), /readback_changed_before_supervisor/);
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

test('fresh setup schedules the new epoch on the next lifecycle cycle despite a recent archived research wake', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-recovery-fresh-cycle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = fixture();
  original.keepalive.last_research_wake_at = new Date().toISOString();
  const { SupervisorBootstrapKeepalive: BootstrapKeepalive } = await import('../src/supervisor-bootstrap-keepalive.mjs');
  let saved = structuredClone(original.keepalive);
  const keepalive = new BootstrapKeepalive({ processIncarnationId: 'process_current',
    loadState: async () => saved, saveState: async value => { saved = structuredClone(value); } });
  await keepalive.init();
  // Execute the production lifecycle queue method without Electron/browser
  // dependencies. Queueing a fresh intent creates no physical send effect.
  const source = await fs.readFile(new URL('../src/supervisor-lifecycle-runtime-core.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('  async #queueResearch() {');
  const end = source.indexOf('  async #ensureContinuousWake()', begin);
  assert.ok(begin >= 0 && end > begin);
  const QueueLifecycle = vm.runInNewContext(`(class {
    #keepalive; #researchMs = 30 * 60 * 1000;
    constructor(keepalive) { this.#keepalive = keepalive; }
    ${source.slice(begin, end)}
    async cycle() { await this.#queueResearch(); }
  })`);
  const lifecycle = new QueueLifecycle(keepalive);
  await lifecycle.cycle();
  assert.equal(keepalive.snapshot().queued_wakes.length, 0, 'the predecessor research timestamp is still fresh');
  let fleetSaved = structuredClone(original.fleet);
  const fleet = new FleetProvisioner({ createTab: () => assert.fail('recovery cannot create tabs'), loadTab: () => assert.fail('recovery cannot navigate'),
    tabExists: () => false, loadState: async () => fleetSaved, saveState: async value => { fleetSaved = structuredClone(value); }, policy: {} });
  await fleet.init();
  const before = { keepalive: keepalive.snapshot(), fleet: fleet.snapshot(), tabs: [] };
  const controller = new InterruptedSetupRecovery({ directory, uuid: () => recoveryId.slice(9),
    getSnapshot: async () => ({ keepalive: keepalive.snapshot(), fleet: fleet.snapshot(), tabs: [] }),
    applyFleet: binding => fleet.archiveInterruptedBootstrapAgents(binding),
    applySupervisor: binding => keepalive.archiveInterruptedBootstrapForNewEpoch(binding) });
  await controller.init();
  await controller.execute(request(before));
  assert.equal(keepalive.snapshot().last_research_wake_at, null);
  assert.equal(saved.last_research_wake_at, null, 'the scheduling reset is in the same durable epoch checkpoint');
  assert.equal(keepalive.snapshot().pending_wake, null, 'the recovery action itself sends no prompt');
  await lifecycle.cycle();
  const queued = keepalive.snapshot().queued_wakes;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].key, 'RESEARCH_ACCELERATOR_DUE:epoch-3');
  assert.equal(queued[0].process_incarnation_id, 'process_current');
  const prepared = await keepalive.prepareBootstrapWake();
  assert.equal(prepared.ok, true);
  assert.equal(prepared.pending.supervisor_epoch, 3);
  assert.equal(prepared.pending.cycle_seq, 1);
  assert.notEqual(prepared.pending.wake_id, before.keepalive.pending_wake.wake_id);
  assert.equal(prepared.message.includes(before.keepalive.pending_wake.wake_id), false);
  const archived = keepalive.snapshot().ambiguous_history.at(-1);
  for (const [key, value] of Object.entries(before.keepalive.pending_wake)) assert.deepEqual(archived[key], value);
  assert.equal(archived.previous_effect_outcome, 'UNKNOWN');
  assert.equal(archived.automatic_retry_allowed, false);
});

test('native recovery hold serializes explicit operations and remains closed after uncertain apply', async () => {
  const source = await fs.readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('  canStartMaintenance() {');
  const end = source.indexOf('  async archiveInterruptedBootstrapForNewEpoch(binding)', begin);
  assert.ok(begin >= 0 && end > begin);
  // Run the actual mutation-hold methods in their private-field scope. Other
  // native dependencies (Electron, update services, network) stay absent.
  const NativeHold = vm.runInNewContext(`(class {
    #interruptedSetupRecoveryHold = false; #interruptedSetupRecoveryActive = false; #interruptedSetupRecoveryRetainedFence = false; #currentCommands = new Map(); #legacyFastlaneBusy = false; #maintenancePromise = null;
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
  assert.equal(client.canStartMaintenance(), false, 'losing concurrent caller cannot release the acquired hold');
  release();
  assert.equal((await operation).state, 'FRESH_SETUP_PREPARED');
  assert.equal(client.canStartMaintenance(), true);
  await assert.rejects(client.withInterruptedSetupRecovery(() => { throw new Error('uncertain_apply'); }), /uncertain_apply/);
  assert.equal(client.canStartMaintenance(), false);
  await assert.rejects(client.withInterruptedSetupRecovery(() => assert.fail('no retry')), /native_mutation_busy/);
  client.setInterruptedSetupRecoveryFence(false);
  await assert.rejects(client.withInterruptedSetupRecovery(() => { throw new Error('request_rejected_before_archive'); }, {
    retainFenceOnError: () => false,
  }), /request_rejected_before_archive/);
  assert.equal(client.canStartMaintenance(), true, 'only the acquired owner releases its pre-archive validation hold');
});

for (const stage of ['before-supervisor', 'after-supervisor']) test(`new predecessor/conversation census at ${stage} keeps UNKNOWN setup fenced`, async t => {
  const { directory, effects, getState, setState } = await harness(t);
  const controller = new InterruptedSetupRecovery({ directory, uuid: () => recoveryId.slice(9), getSnapshot: getState,
    applyFleet: () => {
      effects.push('fleet'); const state = getState(); state.fleet.agents[0].lifecycle_state = 'RETIRED';
      if (stage === 'before-supervisor') state.tabs.push({ tab_id: 'tab_old_agent', url: 'https://chatgpt.com/' });
      setState(state);
    },
    applySupervisor: binding => {
      effects.push('supervisor'); const state = getState();
      state.keepalive.ambiguous_history.push({ ...state.keepalive.pending_wake, operator_recovery_id: binding.recovery_id });
      state.keepalive.pending_wake = null; state.keepalive.supervisor_epoch += 1;
      if (stage === 'after-supervisor') state.tabs.push({ tab_id: 'tab_spa_new', url: 'https://chatgpt.com/c/late-new-conversation' });
      setState(state);
    } });
  await controller.init();
  await assert.rejects(controller.execute(request(getState())), stage === 'before-supervisor' ? /readback_changed_before_supervisor/ : /apply_readback_unconfirmed/);
  assert.equal(controller.status().fenced, true);
  assert.deepEqual(effects, stage === 'before-supervisor' ? ['fleet'] : ['fleet', 'supervisor']);
});

test('main command guard accounts already admitted direct mutations and denies new mutation entries', async () => {
  const source = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('function assertInterruptedSetupCommandAllowed(action)');
  const end = source.indexOf('async function handleCommand(command, payload = {})', begin);
  assert.ok(begin >= 0 && end > begin);
  let hold = false;
  const lane = vm.runInNewContext(`(() => {
    let interruptedSetupPhysicalMutationsInFlight = 0;
    ${source.slice(begin, end)}
    return { run: runInterruptedSetupPhysicalMutation, count: () => interruptedSetupPhysicalMutationsInFlight };
  })()`, { nativeSupervisor: { interruptedSetupRecoveryFenced: () => hold },
    browserParentMutationGate: createBrowserParentSuspensionMutationGate(),
    classifyNativeSupervisorCommand: ({ action }) => ({ read_only: action === 'CAPTURE' || action === 'READ_TRANSCRIPT' }) });
  let finish;
  const longOperation = lane.run('FLEET_RECONCILE', () => new Promise(resolve => { finish = resolve; }));
  assert.equal(lane.count(), 1, 'fresh IPC must reject while a previously admitted shell mutation awaits');
  hold = true;
  for (const action of ['FLEET_RECONCILE', 'FLEET_SET_PROFILE', 'NEW_TAB', 'CLOSE_TAB', 'NAVIGATE', 'GATE_DISABLE', 'MANAGED_PROJECT_WORKTREE_CREATE']) {
    await assert.rejects(lane.run(action, () => assert.fail('hold denies physical mutation')), /recovery_fenced/);
  }
  assert.equal(await lane.run('CAPTURE', () => 'safe-read'), 'safe-read');
  assert.equal(lane.count(), 1);
  finish(); await longOperation;
  assert.equal(lane.count(), 0);
});

test('concurrent real start-fresh IPC loser cannot release the first pre-archive hold', async () => {
  const [nativeSource, mainSource] = await Promise.all([
    fs.readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8'),
  ]);
  const nativeBegin = nativeSource.indexOf('  canStartMaintenance() {');
  const nativeEnd = nativeSource.indexOf('  async archiveInterruptedBootstrapForNewEpoch(binding)', nativeBegin);
  const NativeHold = vm.runInNewContext(`(class {
    #interruptedSetupRecoveryHold = false; #interruptedSetupRecoveryActive = false; #interruptedSetupRecoveryRetainedFence = false; #currentCommands = new Map(); #legacyFastlaneBusy = false; #maintenancePromise = null;
    ${nativeSource.slice(nativeBegin, nativeEnd)}
  })`);
  const native = new NativeHold();
  let finish;
  const pauseBeforeArchive = new Promise(resolve => { finish = resolve; });
  let executeCount = 0;
  const recovery = { status: () => ({ fenced: false }), execute: async () => { executeCount++; await pauseBeforeArchive; return { state: 'FRESH_SETUP_PREPARED' }; } };
  const ipcBegin = mainSource.indexOf("ipcMain.handle('metaengine:client:interrupted-setup-start-fresh'");
  const ipcEnd = mainSource.indexOf("ipcMain.handle('metaengine:client:work-readiness'", ipcBegin);
  assert.ok(ipcBegin >= 0 && ipcEnd > ipcBegin);
  let handler;
  vm.runInNewContext(mainSource.slice(ipcBegin, ipcEnd), {
    ipcMain: { handle: (name, callback) => { handler = callback; } }, assertShellSender: () => {},
    ensureInterruptedSetupRecovery: async () => recovery, nativeSupervisor: native,
    interruptedSetupPhysicalMutationsInFlight: 0, publishSnapshot: async () => {},
  });
  const frame = {};
  const event = { sender: { mainFrame: frame }, senderFrame: frame };
  const first = handler(event, request(fixture()));
  for (let index = 0; index < 5 && executeCount === 0; index++) await Promise.resolve();
  assert.equal(executeCount, 1);
  await assert.rejects(handler(event, request(fixture())), /native_mutation_busy/);
  assert.equal(native.interruptedSetupRecoveryFenced(), true, 'IPC rejection cannot release another operation before its archive starts');
  assert.equal(executeCount, 1);
  finish();
  assert.equal((await first).state, 'FRESH_SETUP_PREPARED');
  assert.equal(native.interruptedSetupRecoveryFenced(), false);
});

test('deferred physical tab entrypoints obey the same recovery hold without losing arguments', async () => {
  const source = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const names = ['createTab', 'loadTab', 'closeTab'];
  const bodies = names.map(name => {
    const begin = source.indexOf(`async function ${name}(`);
    const end = source.indexOf(`async function ${name}WithRecoveryAdmission(`, begin);
    assert.ok(begin >= 0 && end > begin);
    return source.slice(begin, end);
  }).join('\n');
  const guardBegin = source.indexOf('function assertInterruptedSetupCommandAllowed(action)');
  const guardEnd = source.indexOf('async function handleCommand(command, payload = {})', guardBegin);
  let hold = false;
  const observed = [];
  const implementation = name => (...args) => { observed.push({ name, args }); return name; };
  const tabApi = vm.runInNewContext(`(() => {
    let interruptedSetupPhysicalMutationsInFlight = 0;
    ${source.slice(guardBegin, guardEnd)}
    ${bodies}
    return { createTab, loadTab, closeTab, count: () => interruptedSetupPhysicalMutationsInFlight };
  })()`, {
    AGENT_PLATFORM_HOME_URL: 'https://chatgpt.com/', nativeSupervisor: { interruptedSetupRecoveryFenced: () => hold },
    browserParentMutationGate: createBrowserParentSuspensionMutationGate(),
    classifyNativeSupervisorCommand: () => ({ read_only: false }),
    createTabWithRecoveryAdmission: implementation('createTab'), loadTabWithRecoveryAdmission: implementation('loadTab'), closeTabWithRecoveryAdmission: implementation('closeTab'),
  });
  hold = true;
  await assert.rejects(tabApi.createTab('https://example.com/'), /recovery_fenced/);
  await assert.rejects(tabApi.loadTab('tab_exact', 'https://example.com/'), /recovery_fenced/);
  await assert.rejects(tabApi.closeTab('tab_exact'), /recovery_fenced/);
  assert.deepEqual(observed, []);
  hold = false;
  await tabApi.createTab('https://example.com/', { role: 'AGENT', select: false, load: false, awaitLoad: false, created_by_continuity_id: 'continuity-exact' });
  await tabApi.loadTab('tab_exact', 'https://example.com/'); await tabApi.closeTab('tab_exact');
  assert.equal(observed[0].args[0], 'https://example.com/');
  assert.equal(observed[0].args[1].role, 'AGENT');
  assert.equal(observed[0].args[1].select, false);
  assert.equal(observed[0].args[1].created_by_continuity_id, 'continuity-exact');
  assert.deepEqual(observed[1].args, ['tab_exact', 'https://example.com/']);
  assert.deepEqual(observed[2].args, ['tab_exact']);
  assert.equal(tabApi.count(), 0);
});

// Regression checks for unknown initialization and final identity drift.
const fenceRecoveryId='recovery_9389026c-f74a-48a3-a3f0-b336e7d1c619';
const fenceSnapshot=()=>({keepalive:{supervisor_epoch:2,cycle_seq:5,process_incarnation_id:'current',predecessor_process_incarnation_id:'old',predecessor_fenced_at:'2026-10-27T00:00:00Z',admission_generation_floor:7,ambiguous_history:[],pending_wake:{wake_id:'wake',process_incarnation_id:'old',ambiguous_at:'2026-10-27T00:00:00Z',automatic_retry_allowed:false,process_boundary_fenced_at:'2026-10-27T00:00:00Z'}},fleet:{agents:[]},tabs:[]});
const fenceRequest=s=>({schema:'metaengine.client.interrupted-setup-request.v1',action:'ARCHIVE_INTERRUPTED_SETUP_AND_START_NEW',operator_initiated:true,expected_recovery_sha256:planInterruptedSetupRecovery(s).expected_recovery_sha256});
for(const mode of ['directory verifier','archive schema','commit syntax']) test(`initialization failure remains fenced: ${mode}`,async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-fence-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const state=fenceSnapshot();let effects=0;
 if(mode!=='directory verifier') await fs.writeFile(path.join(directory,fenceRecoveryId+'.archive.json'),JSON.stringify({schema:mode==='archive schema'?'invalid':'metaengine.client.interrupted-setup-archive.v1',recovery_id:fenceRecoveryId}));
 if(mode==='commit syntax') await fs.writeFile(path.join(directory,fenceRecoveryId+'.committed.json'),'{');
 const c=new InterruptedSetupRecovery({directory,getSnapshot:async()=>state,applyFleet:async()=>effects++,applySupervisor:async()=>effects++,verifyDirectory:mode==='directory verifier'?async()=>{throw Error('private_directory_unverified');}:null});
 await assert.rejects(c.init());
 assert.equal(c.status().fenced,true);
 await assert.rejects(c.execute(fenceRequest(state)),/fenced/);
 assert.equal(effects,0);
});
for(const [field,value] of [['process_incarnation_id','replaced'],['admission_generation_floor',8],['rollover_attempt',{id:'new'}]]) test(`final readback rejects unexpected ${field} drift`,async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-final-drift-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const state=fenceSnapshot();
 const c=new InterruptedSetupRecovery({directory,getSnapshot:async()=>structuredClone(state),applyFleet:async()=>{},applySupervisor:async binding=>{
  state.keepalive.pending_wake=null;state.keepalive.supervisor_epoch=3;state.keepalive.ambiguous_history.push({wake_id:'wake',operator_recovery_id:binding.recovery_id});state.keepalive[field]=value;
 }});
 await c.init();await assert.rejects(c.execute(fenceRequest(state)),/readback_unconfirmed/);
 assert.equal(c.status().fenced,true);
 assert.equal((await fs.readdir(directory)).some(n=>n.endsWith('.committed.json')),false);
});


async function nativeRecoveryHoldFixture({ archive = () => ({}) } = {}) {
  const source = await fs.readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('  canStartMaintenance() {');
  const end = source.indexOf('  #kickMaintenance()', begin);
  return new (vm.runInNewContext(`(class {
    #interruptedSetupRecoveryHold = false; #interruptedSetupRecoveryActive = false; #interruptedSetupRecoveryRetainedFence = false;
    #currentCommands = new Map(); #legacyFastlaneBusy = false; #maintenancePromise = null;
    #lifecycle = { archiveInterruptedBootstrapForNewEpoch: binding => fixtureArchive(binding) };
    setMaintenance(promise) { this.#maintenancePromise = promise; }
    ${source.slice(begin, end)}
  })`, { fixtureArchive: archive }))();
}

test('a clear journal readback cannot release an active native recovery operation', async () => {
  const client = await nativeRecoveryHoldFixture();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const operation = client.withInterruptedSetupRecovery(async () => { entered(); await barrier; return {}; });
  await started;
  client.setInterruptedSetupRecoveryFence(false);
  try {
    assert.equal(client.canStartMaintenance(), false);
    assert.equal(client.interruptedSetupRecoveryFenced(), true);
    await assert.rejects(client.withInterruptedSetupRecovery(() => assert.fail('second mutation')), /native_mutation_busy/);
  } finally { release(); await operation; }
  assert.equal(client.interruptedSetupRecoveryFenced(), false);
});

for (const outcome of ['success', 'rejected-before-archive']) test(`a journal fence arriving during ${outcome} survives operation cleanup`, async () => {
  const client = await nativeRecoveryHoldFixture();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const operation = client.withInterruptedSetupRecovery(async () => {
    entered(); await barrier;
    if (outcome !== 'success') throw Error('fixture_pre_archive_validation');
    return {};
  }, { retainFenceOnError: () => false });
  await started;
  client.setInterruptedSetupRecoveryFence(true);
  release();
  if (outcome === 'success') await operation;
  else await assert.rejects(operation, /fixture_pre_archive_validation/);
  assert.equal(client.interruptedSetupRecoveryFenced(), true);
  assert.equal(client.canStartMaintenance(), false);
  client.setInterruptedSetupRecoveryFence(false);
  assert.equal(client.canStartMaintenance(), true);
});


test('a new retained fence during maintenance drain prevents recovery from starting', async () => {
  const client = await nativeRecoveryHoldFixture();
  let release, effects = 0;
  client.setMaintenance(new Promise(resolve => { release = resolve; }));
  const operation = client.withInterruptedSetupRecovery(() => { effects++; return {}; });
  client.setInterruptedSetupRecoveryFence(true);
  release();
  await assert.rejects(operation, /native_mutation_busy/);
  assert.equal(effects, 0);
  assert.equal(client.interruptedSetupRecoveryFenced(), true);
});

test('retained journal fence alone cannot authorize the native recovery mutation', async () => {
  let effects = 0;
  const client = await nativeRecoveryHoldFixture({ archive: () => { effects++; } });
  client.setInterruptedSetupRecoveryFence(true);
  await assert.rejects(client.archiveInterruptedBootstrapForNewEpoch({}), /native_hold_required/);
  assert.equal(effects, 0);
});

test('native recovery mutation requires active ownership and no newly retained fence', async () => {
  let effects = 0;
  const client = await nativeRecoveryHoldFixture({ archive: () => { effects++; return {}; } });
  await client.withInterruptedSetupRecovery(() => client.archiveInterruptedBootstrapForNewEpoch({}));
  assert.equal(effects, 1);
  await assert.rejects(client.withInterruptedSetupRecovery(async () => {
    client.setInterruptedSetupRecoveryFence(true);
    return client.archiveInterruptedBootstrapForNewEpoch({});
  }), /native_hold_required/);
  assert.equal(effects, 1);
  assert.equal(client.interruptedSetupRecoveryFenced(), true);
});
