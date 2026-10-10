import assert from 'node:assert/strict';
import test from 'node:test';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY } from './db-api-core.mjs';
import { localApiRolePolicyName, provisionLocalApiLogin } from './db-api-grants.mjs';

const credentials = { databaseName: 'postgres', login: 'fixture_api', password: 'a'.repeat(64), roleMode: 'direct' };

test('direct policy names are bounded deterministic role identities', () => {
  assert.match(localApiRolePolicyName('fixture_api', 'select'), /^compute_api_[a-f0-9]{24}_select$/);
  assert.notEqual(localApiRolePolicyName('fixture_api', 'select'), localApiRolePolicyName('other_api', 'select'));
});

test('role provisioning rejects incomplete or overloaded catalog before role DDL', async () => {
  for (const signatures of [[], RPC_ALLOWLIST.map(name => ({ name })).concat({ name: RPC_ALLOWLIST[0] })]) {
    const calls = [];
    const tx = { unsafe: async query => {
      calls.push(query);
      if (query === RPC_CATALOG_QUERY) return signatures;
      if (query.includes('current_database()')) return [{ name: 'postgres' }];
      return [];
    } };
    await assert.rejects(provisionLocalApiLogin({ ...credentials, sql: { begin: run => run(tx) } }), /local_api_rpc_catalog_(incomplete|overloaded)/);
    assert(!calls.some(query => query.includes('CREATE ROLE') || query.startsWith('GRANT')));
  }
});

test('role mode and target database validation reject before any grants', async () => {
  let opened = 0;
  await assert.rejects(provisionLocalApiLogin({ ...credentials, roleMode: 'admin', sql: { begin: () => { opened++; } } }), /role_mode_invalid/);
  assert.equal(opened, 0);
  const tx = { unsafe: async query => query.includes('current_database()') ? [{ name: 'other_database' }] : [] };
  await assert.rejects(provisionLocalApiLogin({ ...credentials, sql: { begin: run => run(tx) } }), /database_name_mismatch/);
});
