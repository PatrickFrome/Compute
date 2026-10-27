import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installedLaunchProgressSnapshot, createInstalledLaunchProgressReporter,
  INSTALLED_LAUNCH_QUALIFIER_TIMEOUT_MS, INSTALLED_LAUNCH_FIXTURE_TIMEOUT_MS } from '../scripts/installed-launch-progress.mjs';
import { waitUntil } from '../scripts/qualify-installed-client-launch.mjs';

const identity = { source_head: 'a'.repeat(40), package_version: '0.7.0-dev.1107139874586.1' };
const pid = 711, boot = '11111111-2222-4333-8444-555555555555';
const input = () => ({ identity, phase: 'OWNER_STARTUP', sequence: 1, pid,
  journal: { schema: 'metaengine.browser.startup-journal.v1', version: 1,
    authority_effect: false, current_boot_id: boot, current_pid: pid, current_version: identity.package_version,
    events: [{ boot_id: boot, pid, version: identity.package_version, sequence: 1,
      state: 'RUNTIME_IMPORT_FAILED', details: { message: 'SECRET', password: 'SECRET' } }] } });

test('failure diagnostic binds current PID/version/boot and only fixed startup states', () => {
  const value = input(); value.error = new Error('SECRET postgres://owner:SECRET@localhost/db');
  value.journal.events.push({ ...value.journal.events[0], sequence: 2, state: 'SECRET' });
  const row = installedLaunchProgressSnapshot(value);
  assert.equal(row.startup_journal_binding, 'BOUND');
  assert.deepEqual(row.startup_states, [{ state: 'RUNTIME_IMPORT_FAILED', sequence: 1 }]);
  assert.equal(row.failure_code, 'installed_launch_contract_unproven');
  assert.equal(JSON.stringify(row).includes('SECRET'), false);
  assert.equal(row.qualification_proven, false); assert.equal(row.authority_effect, false);
  for (const mutation of [
    f => { f.journal.current_pid++; }, f => { f.journal.current_version = 'old'; },
    f => { f.journal.current_boot_id = 'malformed'; }, f => { f.journal.events = Array(129).fill(f.journal.events[0]); },
  ]) {
    const changed = input(); mutation(changed);
    const stale = installedLaunchProgressSnapshot(changed);
    assert.notEqual(stale.startup_journal_binding, 'BOUND'); assert.deepEqual(stale.startup_states, []);
  }
  const otherBoot = input(); otherBoot.journal.events[0].boot_id = '22222222-2222-4333-8444-555555555555';
  assert.deepEqual(installedLaunchProgressSnapshot(otherBoot).startup_states, []);
});

test('first actual failure survives cleanup and later generic errors', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-launch-progress-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const progress = createInstalledLaunchProgressReporter({ directory, identity });
  await progress.phase('OWNER_CDP_READBACK', { pid });
  await progress.failure(new Error('installed_launch_normal_primary_cdp_surface_unproven'), { pid });
  const before = await fs.readFile(path.join(directory, 'installed-launch-failure.json'));
  await progress.phase('OWNER_SHUTDOWN', { pid });
  await progress.failure(new Error('installed_launch_contract_unproven'));
  assert.equal((await fs.readFile(path.join(directory, 'installed-launch-failure.json'))).equals(before), true);
  const failure = JSON.parse(before);
  assert.equal(failure.phase, 'OWNER_CDP_READBACK'); assert.equal(failure.primary_pid, pid);
  assert.equal(failure.failure_code, 'installed_launch_normal_primary_cdp_surface_unproven');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'installed-launch-progress.json'))).phase, 'OWNER_SHUTDOWN');
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
});

test('diagnostic write failure cannot skip existing cleanup or manufacture qualification', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-launch-progress-denied-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of ['installed-launch-progress.json', 'installed-launch-failure.json']) await fs.mkdir(path.join(directory, name));
  const progress = createInstalledLaunchProgressReporter({ directory, identity });
  assert.equal(await progress.phase('OWNER_SHUTDOWN'), null);
  assert.equal(await progress.failure(new Error('SECRET')), null);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
});

test('a killed real qualifier process leaves its last completed diagnostic phase', { timeout: 10000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-launch-progress-kill-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const helper = new URL('../scripts/installed-launch-progress.mjs', import.meta.url).href;
  const source = `import { createInstalledLaunchProgressReporter } from ${JSON.stringify(helper)};
    const progress = createInstalledLaunchProgressReporter({ directory: process.argv[1], identity: ${JSON.stringify(identity)} });
    await progress.phase('OWNER_STARTUP_GRACE', { pid: process.pid });
    process.send('WRITTEN'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, directory], {
    windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  try {
    await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('close', () => reject(new Error('phase_child_ended_early'))); });
    assert.equal(child.kill(), true); await closed;
    const phase = JSON.parse(await fs.readFile(path.join(directory, 'installed-launch-progress.json')));
    assert.equal(phase.phase, 'OWNER_STARTUP_GRACE'); assert.equal(phase.primary_pid, child.pid);
    assert.equal(phase.state, 'IN_PROGRESS'); assert.equal(phase.qualification_proven, false);
    await assert.rejects(fs.stat(path.join(directory, 'installed-launch-failure.json')), { code: 'ENOENT' });
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed; } }
});

test('terminal startup failures propagate immediately while incomplete readbacks can converge', async () => {
  for (const reason of ['installed_launch_normal_runtime_import_failed', 'installed_launch_normal_primary_window_journal_failed', 'installed_launch_process_ended_before_readback']) {
    let reads = 0;
    await assert.rejects(waitUntil(() => { reads++; throw new Error(reason); }, null, 1000), { message: reason });
    assert.equal(reads, 1);
  }
  let reads = 0;
  assert.equal(await waitUntil(() => { if (++reads === 1) throw new Error('incomplete'); return 'ready'; }, null, 1000), 'ready');
  assert.equal(reads, 2);
});

test('outer fixture ceilings encompass existing startup and grace without relaxing physical budgets', async () => {
  assert(INSTALLED_LAUNCH_QUALIFIER_TIMEOUT_MS > 420000 + 190000 + 100000);
  assert(INSTALLED_LAUNCH_FIXTURE_TIMEOUT_MS > INSTALLED_LAUNCH_QUALIFIER_TIMEOUT_MS + 720000 + 300000);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const workflow = await fs.readFile(path.join(root, '.github/workflows/browser-final-runtime-activation-v1.yml'), 'utf8');
  assert.match(workflow, /owner-consumer-evidence-\*\/installed-launch-progress\.json/);
  assert.match(workflow, /owner-consumer-evidence-\*\/installed-launch-failure\.json/);
  assert.doesNotMatch(workflow, /owner-consumer-evidence-\*\/\*\*|owner-consumer-evidence-\*\/\*\.json/);
});
