import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivationManager, extractActivationArg, resolveBootActivation } from '../src/update/activator.mjs';
import { ACTIVATION } from '../src/shared/me2-constants.mjs';

const V_OLD = '0.8.2-dev.0.1';
const V_NEW = '0.8.3-dev.0.1';
const ID = 'a1b2c3d4e5f60718';

function pending(over = {}) {
  return { id: ID, version: V_NEW, dir: '/staged/x', installer: 'setup.exe', started_at: new Date().toISOString(), ...over };
}

function newManager(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'me2-activation-'));
  const events = [];
  const mgr = new ActivationManager({
    userDataDir: dir,
    currentVersion: V_NEW,
    argv: [],
    journal: (r) => events.push(r),
    spawnImpl: null,
    ...over,
  });
  return { mgr, dir, events };
}

// --- pure: extractActivationArg ---

test('activation arg: separate value form', () => {
  assert.equal(extractActivationArg(['electron', '--me2-activation', ID]), ID);
});

test('activation arg: =form and absent', () => {
  assert.equal(extractActivationArg(['electron', `--me2-activation=${ID}`]), ID);
  assert.equal(extractActivationArg(['electron', '--me2-smoke']), null);
  assert.equal(extractActivationArg(['electron', '--me2-activation']), null); // flag without value
});

// --- pure: resolveBootActivation verdict matrix ---

test('boot verdict: idle — no flag, no pending', () => {
  assert.deepEqual(resolveBootActivation({ argv: [], pending: null, currentVersion: V_NEW }), { verdict: 'idle' });
});

test('boot verdict: qualifying — flag + pending + version applied', () => {
  const r = resolveBootActivation({ argv: ['e', '--me2-activation', ID], pending: pending(), currentVersion: V_NEW });
  assert.equal(r.verdict, 'qualifying');
});

test('boot verdict: version_mismatch — flag + pending, running version differs', () => {
  const r = resolveBootActivation({ argv: ['e', '--me2-activation', ID], pending: pending(), currentVersion: V_OLD });
  assert.equal(r.verdict, 'version_mismatch');
});

test('boot verdict: id_mismatch — flag id differs from pending id', () => {
  const r = resolveBootActivation({ argv: ['e', '--me2-activation', 'ffffffffffffffff'], pending: pending(), currentVersion: V_NEW });
  assert.equal(r.verdict, 'id_mismatch');
});

test('boot verdict: applied_unconfirmed — no flag, pending, version applied', () => {
  const r = resolveBootActivation({ argv: [], pending: pending(), currentVersion: V_NEW });
  assert.equal(r.verdict, 'applied_unconfirmed');
});

test('boot verdict: rolled_back — no flag, pending, version differs', () => {
  const r = resolveBootActivation({ argv: [], pending: pending(), currentVersion: V_OLD });
  assert.equal(r.verdict, 'rolled_back');
});

test('boot verdict: orphan_flag — flag without pending record', () => {
  const r = resolveBootActivation({ argv: ['e', '--me2-activation', ID], pending: null, currentVersion: V_NEW });
  assert.equal(r.verdict, 'orphan_flag');
});

test('boot verdict: stale — pending older than TTL', () => {
  const old = pending({ started_at: new Date(Date.now() - (ACTIVATION.PENDING_TTL_MS + 1000)).toISOString() });
  const r = resolveBootActivation({ argv: [], pending: old, currentVersion: V_OLD, now: Date.now() });
  assert.equal(r.verdict, 'stale');
});

// --- ActivationManager flows ---

test('requestFromStaged: picks .exe, writes durable pending, journals', () => {
  const { mgr, dir, events } = newManager();
  const r = mgr.requestFromStaged({ version: V_NEW, dir: '/staged/x', files: ['app.asar', 'setup.exe'] });
  assert.equal(r.ok, true);
  assert.match(r.id, /^[0-9a-f]{16}$/);
  assert.equal(r.installerPath, join('/staged/x', 'setup.exe'));
  const file = join(dir, ACTIVATION.PENDING_NAME);
  assert.equal(existsSync(file), true);
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, V_NEW);
  assert.equal(onDisk.installer, 'setup.exe');
  assert.ok(events.some((e) => e.event === 'pending' && e.version === V_NEW));
  assert.equal(mgr.snapshot().verdict, 'armed');
});

test('requestFromStaged: no installer entry → honest refusal, no pending', () => {
  const { mgr, dir } = newManager();
  const r = mgr.requestFromStaged({ version: V_NEW, dir: '/staged/x', files: ['app.asar'] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_installer_entry');
  assert.equal(existsSync(join(dir, ACTIVATION.PENDING_NAME)), false);
});

test('requestFromStaged: incomplete record refused', () => {
  const { mgr } = newManager();
  assert.equal(mgr.requestFromStaged({ version: V_NEW }).ok, false);
  assert.equal(mgr.requestFromStaged({ dir: '/x' }).ok, false);
});

test('spawnHandoff: armed → detached spawn with NSIS /S + unref', () => {
  const calls = [];
  const { mgr } = newManager({ spawnImpl: (path, args, opts) => ({ pid: 4242, unref: () => calls.push('unref'), path, args, opts }) });
  mgr.requestFromStaged({ version: V_NEW, dir: '/staged/x', files: ['setup.exe'] });
  const r = mgr.spawnHandoff();
  assert.equal(r.ok, true);
  assert.equal(r.pid, 4242);
  assert.deepEqual(calls, ['unref']);
  assert.ok(mgr.snapshot().pending); // durable truth stays until next boot resolves it
});

test('spawnHandoff: captures spawn args exactly (path, [/S], detached+ignore)', () => {
  let seen = null;
  const { mgr } = newManager({ spawnImpl: (path, args, opts) => { seen = { path, args, opts }; return { pid: 1, unref() {} }; } });
  mgr.requestFromStaged({ version: V_NEW, dir: '/staged/x', files: ['setup.exe'] });
  mgr.spawnHandoff();
  assert.equal(seen.path, join('/staged/x', 'setup.exe'));
  assert.deepEqual(seen.args, ['/S']);
  assert.deepEqual(seen.opts, { detached: true, stdio: 'ignore' });
});

test('spawnHandoff: not armed → no_pending_request; spawn throw → spawn_error', () => {
  const { mgr } = newManager();
  assert.deepEqual(mgr.spawnHandoff(), { ok: false, reason: 'no_pending_request' });
  const boom = newManager({ spawnImpl: () => { throw new Error('denied'); } });
  boom.mgr.requestFromStaged({ version: V_NEW, dir: '/x', files: ['setup.exe'] });
  assert.equal(boom.mgr.spawnHandoff().reason, 'spawn_error');
  assert.ok(boom.events.some((e) => e.event === 'spawn_failed'));
});

test('resolveBoot + qualify: qualifying → qualified, pending cleared, journaled', () => {
  const { mgr, dir, events } = newManager();
  const req = mgr.requestFromStaged({ version: V_NEW, dir: '/x', files: ['setup.exe'] });
  const boot = new ActivationManager({
    userDataDir: dir,
    currentVersion: V_NEW,
    argv: ['e', '--me2-activation', req.id],
    journal: (r) => events.push(r),
  });
  const snap = boot.resolveBoot({ autoQualify: false });
  assert.equal(snap.verdict, 'qualifying');
  const q = boot.qualify();
  assert.equal(q.ok, true);
  assert.equal(q.verdict, 'qualified');
  assert.equal(existsSync(join(dir, ACTIVATION.PENDING_NAME)), false);
  assert.ok(events.some((e) => e.event === 'boot_verdict' && e.verdict === 'qualifying'));
  assert.ok(events.some((e) => e.event === 'qualified' && e.version === V_NEW));
});

test('resolveBoot: rolled_back clears pending + journals honestly', () => {
  const { mgr, dir, events } = newManager();
  mgr.requestFromStaged({ version: V_NEW, dir: '/x', files: ['setup.exe'] });
  const boot = new ActivationManager({ userDataDir: dir, currentVersion: V_OLD, argv: [], journal: (r) => events.push(r) });
  const snap = boot.resolveBoot({ autoQualify: false });
  assert.equal(snap.verdict, 'rolled_back');
  assert.equal(existsSync(join(dir, ACTIVATION.PENDING_NAME)), false);
  assert.ok(events.some((e) => e.event === 'rolled_back' && e.reason === 'rolled_back'));
});

test('resolveBoot: stale pending → rolled_back family, no qualification', () => {
  const { mgr, dir } = newManager();
  mgr.requestFromStaged({ version: V_NEW, dir: '/x', files: ['setup.exe'] });
  const boot = new ActivationManager({ userDataDir: dir, currentVersion: V_OLD, argv: [], journal: () => {} });
  const snap = boot.resolveBoot({ autoQualify: false, now: Date.now() + ACTIVATION.PENDING_TTL_MS + 5000 });
  assert.equal(snap.verdict, 'stale');
  assert.equal(existsSync(join(dir, ACTIVATION.PENDING_NAME)), false);
});

test('qualify: refuses when not in qualifying state', () => {
  const { mgr } = newManager();
  mgr.resolveBoot({ autoQualify: false });
  assert.deepEqual(mgr.qualify(), { ok: false, reason: 'not_qualifying:idle' });
});
