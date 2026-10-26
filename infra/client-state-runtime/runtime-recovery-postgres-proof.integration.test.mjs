import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runtimeRecoveryPostgresProof } from './runtime-recovery-postgres-proof.mjs';
import { withFreshOwnerNativeFixture } from './test/fresh-owner-native-fixture.mjs';

const bin = process.env.METAENGINE_PG_TEST_BIN;
const driver = process.env.METAENGINE_PG_TEST_DRIVER;

// Real PostgreSQL/SQL/PID-file evidence for the Host's post-launch continuity
// gate. No bundle, Deno/Edge, Browser Owner, Windows or installed readiness is
// simulated or claimed. The factory creates and removes only its own cluster.
test('Host continuity proof accepts actual disposable PG17 identity and refuses mismatched observations', {
  skip: !bin || !driver, timeout: 180000,
}, async t => {
  let dataDirectory;
  await withFreshOwnerNativeFixture({ bin, driver }, async ({ sql, check }) => {
    const [identity] = await sql.unsafe(`select current_setting('data_directory') as data_directory,
      current_setting('server_version_num')::int as version, inet_server_port() as port,
      pg_postmaster_start_time()::text as started_at, system_identifier::text from pg_catalog.pg_control_system()`);
    dataDirectory = await fs.realpath(identity.data_directory);
    const pidFile = path.join(dataDirectory, 'postmaster.pid');
    const pidBytes = await fs.readFile(pidFile);
    identity.pid = Number(pidBytes.toString('utf8').split(/\r?\n/)[0]);
    const options = { identity, pgDataDirectory: dataDirectory, expectedClusterSystemIdentifier: identity.system_identifier };
    const proof = await runtimeRecoveryPostgresProof(options);
    assert.equal(proof.schema, 'metaengine.client-state.postgres-continuity.v1');
    assert.equal(proof.pid, identity.pid);
    assert.equal(Math.floor(proof.version / 10000), 17);
    assert.equal(proof.system_identifier, identity.system_identifier);
    assert.equal(proof.started_at, new Date(identity.started_at).toISOString());
    assert.equal(proof.authority_effect, false);
    for (const field of ['sha256', 'data_directory_sha256', 'postmaster_pid_sha256']) assert.match(proof[field], /^[a-f0-9]{64}$/);
    for (const changed of [
      { ...options, expectedClusterSystemIdentifier: identity.system_identifier === '1' ? '2' : '1' },
      { ...options, identity: { ...identity, pid: identity.pid + 1 } },
      { ...options, identity: { ...identity, port: identity.port === 65535 ? 65534 : identity.port + 1 } },
      { ...options, identity: { ...identity, version: 160000 } },
      { ...options, identity: { ...identity, data_directory: path.dirname(dataDirectory) } },
    ]) await assert.rejects(runtimeRecoveryPostgresProof(changed), /runtime_recovery_postgres_identity_unproven/);
    assert.deepEqual(await fs.readFile(pidFile), pidBytes, 'read-only proof must never rewrite postmaster identity');
    await check();
    assert.deepEqual(await runtimeRecoveryPostgresProof(options), proof);
    t.diagnostic(JSON.stringify({ classification: 'REAL_DISPOSABLE_PG17_HOST_CONTINUITY_ONLY',
      postgres_version_num: identity.version, continuity_gate_verified: true, mismatch_controls: 5,
      bundle_verified: false, edge_qualified: false, installed_owner_qualified: false,
      production_ready: false, authority_effect: false }));
  });
  await assert.rejects(fs.lstat(dataDirectory), { code: 'ENOENT' });
  t.diagnostic('owned disposable postmaster stopped and generated cluster removed');
});
