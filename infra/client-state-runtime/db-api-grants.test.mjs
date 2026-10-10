import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY } from './db-api-core.mjs';
import { localApiRolePolicyName, provisionLocalApiLogin } from './db-api-grants.mjs';

const credentials = { databaseName: 'postgres', login: 'fixture_api', password: 'a'.repeat(64), roleMode: 'direct' };

test('operator CLIs report a missing DB driver without raw dependency paths or credentials',()=>{
  for(const [name,event] of [['db-api-grants','local_state_api_grants_failed'],['local-runtime-migrations','local_runtime_migration_failed']]){
    const moduleUrl=new URL('./'+name+'.mjs',import.meta.url);
    const code=[
      'import {registerHooks} from "node:module";',
      'registerHooks({resolve(specifier,context,nextResolve){if(specifier==="postgres")throw Object.assign(Error("private_dependency_path_and_password"),{code:"ERR_MODULE_NOT_FOUND"});return nextResolve(specifier,context);}});',
      'process.argv=[process.execPath,'+JSON.stringify(fileURLToPath(moduleUrl))+'];',
      'process.env.LOCAL_STATE_ADMIN_DATABASE_URL="postgres://private_api:private_url_password@127.0.0.1:35432/metaengine";',
      'await import('+JSON.stringify(moduleUrl.href)+');',
    ].join('\n');
    const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(result.status,1);
    assert.equal(result.stdout,'');
    assert.deepEqual(JSON.parse(result.stderr),{event,code:'dependency_unavailable'});
  }
});

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
