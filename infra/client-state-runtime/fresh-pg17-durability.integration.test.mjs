import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { inspectLocalApiSchemaCatalog } from './db-api-core.mjs';
import { initializeFreshClientPg17 } from './fresh-pg17-initdb.mjs';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';

const bundle = process.env.LOCAL_STATE_TEST_FRESH_BUNDLE_DIRECTORY;
const sha = process.env.LOCAL_STATE_TEST_FRESH_BUNDLE_SHA256;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
const same = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase() : a === b;

async function freeLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert(port > 1023 && port <= 65535);
  return port;
}
async function portClosed(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('physical_pg17_port_close_timeout')); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('physical_pg17_port_still_open')); });
    socket.once('error', error => {
      clearTimeout(timer);
      socket.destroy();
      error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('physical_pg17_port_probe_unconfirmed'));
    });
  });
}

test('new owned PG17+Vault cold-restarts with exact persisted SQL row and unchanged key', {
  skip: !bundle && !sha, timeout: 300000,
}, async t => {
  if (!bundle || !sha || !/^[a-f0-9]{64}$/.test(sha))
    throw new Error('physical_pg17_explicit_bundle_pin_required');
  assert.equal(process.platform, 'win32', 'physical installed-runtime qualification is Windows-scoped');
  const verified = await verifyOfflineRuntimeBundle({ bundleDirectory: bundle, expectedBundleDigest: sha });
  const bin = verified.paths.postgresBinDirectory;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-physical-pg17-cold-')));
  const marker = randomUUID();
  await fs.writeFile(path.join(root, 'synthetic-test-owner.marker'), marker, { flag: 'wx', mode: 0o600 });
  const privateState = path.join(root, 'private');
  const dataDirectory = path.join(privateState, 'pg17');
  const passwordFile = path.join(root, 'init-password');
  const password = randomBytes(32).toString('hex');
  await fs.writeFile(passwordFile, password + '\n', { flag: 'wx', mode: 0o600 });
  const selected = {
    bundleDirectory: bundle, expectedBundleSha256: sha,
    stateDirectory: privateState, pgDataDirectory: dataDirectory,
    runtimeConfigFile: path.join(privateState, 'host-config.json'),
    ownerFile: path.join(root, 'roaming', 'owner.json'),
    passwordFile, ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT',
  };
  const port = await freeLoopbackPort();
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^PG/i.test(name) || /^SUPABASE_/i.test(name)) delete env[name];
  Object.assign(env, { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres',
    PGPASSWORD: password, PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3' });

  let active = null;
  let sql = null;
  let completed = false;
  const pidPath = path.join(dataDirectory, 'postmaster.pid');
  const assertOwnedProcess = async session => {
    const verifiedProcess = await session.owned.verify();
    assert.equal(verifiedProcess.pid, session.pid, 'verified OS process must be this owned postmaster');
    assert.equal(verifiedProcess.processCreatedAt, session.processCreatedAt, 'Windows process creation identity must remain pinned');
    const lines = (await fs.readFile(pidPath, 'utf8')).trim().split(/\r?\n/);
    assert.equal(Number(lines[0]), session.pid, 'postgres PID must belong to this test');
    assert.equal(Number(lines[3]), port, 'postgres port must be the isolated test port');
    assert(same(await fs.realpath(lines[1]), await fs.realpath(dataDirectory)), 'postgres PGDATA must be this synthetic cluster');
    assert(lines[2], 'postmaster start identity required');
    return lines[2];
  };
  const start = async () => {
    assert.equal(active, null);
    await portClosed(port);
    const owned = await startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: dataDirectory,
      databasePort: port, env, startupTimeoutMs: 30000 });
    active = { owned, pid: owned.pid, processCreatedAt: owned.processCreatedAt,
      startIdentity: owned.postmasterStartIdentity };
    assert.equal(await assertOwnedProcess(active), active.startIdentity);
    assert.equal(await owned.isAlive(), true);
    return active;
  };
  const stop = async () => {
    if (sql) {
      await sql.end({ timeout: 5 });
      sql = null;
    }
    if (!active) return;
    const owned = active;
    assert.equal(await assertOwnedProcess(owned), owned.startIdentity, 'postmaster identity drift during shutdown');
    assert.equal((await owned.owned.stop()).cleanup_confirmed, true);
    assert.equal(await owned.owned.isAlive(), false, 'the original OS postmaster process must be absent');
    await assert.rejects(fs.lstat(pidPath), { code: 'ENOENT' });
    await portClosed(port);
    active = null;
  };
  t.after(async () => {
    await stop();
    if (completed) {
      assert.equal(await fs.readFile(path.join(root, 'synthetic-test-owner.marker'), 'utf8'), marker);
      assert.equal(path.dirname(root).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
      assert(path.basename(root).startsWith('compute-physical-pg17-cold-'));
      await fs.rm(root, { recursive: true, force: false });
    }
  });

  const receipt = await initializeFreshClientPg17(selected);
  assert.equal(receipt.state, 'PG17_INITIALIZED_UNPROVISIONED');
  assert.equal(receipt.runtime_ready, false);
  assert.equal(receipt.vault_key_created, true);
  assert.equal(receipt.schema_provisioned, false);
  assert.equal(receipt.owner_profile_written, false);
  assert.equal(receipt.authority_effect, false);
  const vaultPath = path.join(dataDirectory, 'client-vault.key');
  const originalVault = hash(await fs.readFile(vaultPath));
  assert.equal((await fs.readFile(path.join(dataDirectory, 'PG_VERSION'), 'utf8')).trim(), '17');
  const markerValue = randomUUID();

  const first = await start();
  sql = postgres('postgres://postgres:' + password + '@127.0.0.1:' + port + '/postgres',
    { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5, onnotice: () => {} });
  const [version] = await sql.unsafe('SELECT current_setting(\'server_version_num\')::integer AS major');
  assert(version.major >= 170000 && version.major < 180000);
  const catalog = await inspectLocalApiSchemaCatalog({ sql });
  assert.equal(catalog.state, 'BASELINE_SCHEMA_MISSING');
  assert.equal(catalog.required_rpc_count, 40);
  assert.equal(catalog.required_table_count, 5);
  assert.equal(catalog.runtime_ready, false);
  assert.equal(catalog.initialization_authorized, false);
  // A clean initdb is deliberately NOT a prepared METAENGINE schema.
  const [baseline] = await sql.unsafe("SELECT pg_catalog.to_regclass('public.compute_fabric_a2_browser_device_h205f22') IS NOT NULL AS ready");
  assert.equal(baseline.ready, false);
  await sql.unsafe('CREATE TABLE public.compute_first_run_durability_probe (id integer PRIMARY KEY, value text NOT NULL)');
  await sql.unsafe('INSERT INTO public.compute_first_run_durability_probe(id, value) VALUES ($1,$2)', [1, markerValue]);
  assert.equal((await sql.unsafe('SELECT value FROM public.compute_first_run_durability_probe WHERE id=1'))[0].value, markerValue);
  const firstIdentity = first.startIdentity;
  const originalPidBytes = await fs.readFile(pidPath);
  try {
    const changed = originalPidBytes.toString('utf8').replace(/^\d+/, String(first.pid + 1));
    await fs.writeFile(pidPath, changed);
    await assert.rejects(first.owned.verify(), { code: 'owned_postgres_process_identity_unconfirmed' });
    await assert.rejects(first.owned.stop(), { code: 'runtime_cleanup_unconfirmed' });
    assert.equal(await first.owned.isAlive(), true, 'uncertain PID ownership must not terminate the postmaster');
  } finally { await fs.writeFile(pidPath, originalPidBytes); }
  assert.equal(await assertOwnedProcess(first), firstIdentity);
  await stop();

  // postmaster.pid records whole seconds. Crossing that boundary preserves
  // the original assertion that a cold restart has a fresh start identity.
  while (Math.floor(Date.now() / 1000) <= Number(firstIdentity)) await sleep(50);

  const second = await start();
  assert.notEqual(second.startIdentity, firstIdentity, 'cold restart must create a fresh postmaster start identity');
  sql = postgres('postgres://postgres:' + password + '@127.0.0.1:' + port + '/postgres',
    { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5, onnotice: () => {} });
  assert.equal((await sql.unsafe('SELECT value FROM public.compute_first_run_durability_probe WHERE id=1'))[0].value, markerValue);
  assert.equal(hash(await fs.readFile(vaultPath)), originalVault, 'original private Vault key bytes must survive restart');
  await assert.rejects(fs.lstat(selected.ownerFile), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(selected.runtimeConfigFile), { code: 'ENOENT' });
  await assert.rejects(initializeFreshClientPg17(selected), /existing_state_requires_reconciliation/);
  assert.equal(JSON.stringify(receipt).includes(password), false);
  await stop();
  completed = true;
});
