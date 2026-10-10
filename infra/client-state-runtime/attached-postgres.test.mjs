import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { validateRuntimeHostConfig, verifyAttachedClusterSystemId } from './runtime-host.mjs';

const identity = '7694034680113450848';
const base = () => ({
  schema: 'compute.runtime-host-config.v1',
  version: 1,
  bundle_directory: path.resolve('bundle'),
  expected_bundle_sha256: 'a'.repeat(64),
  state_directory: path.resolve('state'),
  pg_data_directory: path.resolve('state', 'postgresql-17-live'),
  database_url: 'postgresql://worker:password@127.0.0.1:55432/postgres',
  inspect_database_url: 'postgresql://owner:password@127.0.0.1:55432/postgres',
  api_port: 55433,
  edge_port: 55434,
  startup_timeout_ms: 60000,
});
const attached = () => ({ ...base(), postgres_mode: 'attached', postgres_system_id: identity });
function error(code) { return e => e.code === code || e.message === code; }

test('owned v1 configuration remains backward compatible', () => {
  const config = validateRuntimeHostConfig(base());
  assert.equal(config.postgres_mode, undefined);
});
test('exact attached contract admits a separately owned PostgreSQL', () => {
  assert.equal(validateRuntimeHostConfig(attached()).postgres_system_id, identity);
});
test('rejects unknown mode, incomplete attached binding and extra fields', () => {
  assert.throws(() => validateRuntimeHostConfig({...base(),postgres_mode:'attached'}),
    error('runtime_host_config_contract_invalid'));
  assert.throws(() => validateRuntimeHostConfig({...base(),postgres_mode:'owned'}),
    error('runtime_host_config_contract_invalid'));
  assert.throws(() => validateRuntimeHostConfig({...attached(),postgres_mode:'anything'}),
    error('runtime_host_config_contract_invalid'));
  assert.throws(() => validateRuntimeHostConfig({...attached(),extra:'escape'}),
    error('runtime_host_config_contract_invalid'));
});
test('rejects non-numeric or absent PostgreSQL system identity', () => {
  for (const value of ['', '0', 'abc', '123/456', '1'.repeat(30), null]) {
    assert.throws(() => validateRuntimeHostConfig({...attached(), postgres_system_id:value}),
      error('runtime_host_config_contract_invalid'));
  }
});
test('independent PostgreSQL control-data matches expected cluster identifier', async () => {
  const calls = [];
  const result = await verifyAttachedClusterSystemId({pgBinDir:path.resolve('bin'),
    pgDataDir:path.resolve('state/postgresql-17-live'),expectedSystemId:identity,
    exec:async (...args) => {calls.push(args);return {stdout:`pg_control version number: 1700\nDatabase system identifier: ${identity}\nDatabase cluster state: in production\n`};}});
  assert.deepEqual(result,{system_id_verified:true,authority_effect:false});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0][1],[path.resolve('state/postgresql-17-live')]);
  assert.equal(calls[0][2].shell,false);
});
test('wrong control-data, missing data, failed subprocess are held', async () => {
  const args={pgBinDir:path.resolve('bin'),pgDataDir:path.resolve('data'),expectedSystemId:identity};
  await assert.rejects(verifyAttachedClusterSystemId({...args,exec:async()=>({stdout:'Database system identifier: 7694034680113450999'})}),
    error('runtime_host_attached_pg_identity_mismatch'));
  await assert.rejects(verifyAttachedClusterSystemId({...args,exec:async()=>({stdout:'not a PostgreSQL cluster'})}),
    error('runtime_host_attached_pg_identity_mismatch'));
  await assert.rejects(verifyAttachedClusterSystemId({...args,exec:async()=>{throw Error('disk unreadable')}}),
    error('runtime_host_attached_pg_control_unreadable'));
  await assert.rejects(verifyAttachedClusterSystemId({...args,expectedSystemId:'unknown',exec:async()=>({stdout:''})}),
    error('runtime_host_attached_pg_identity_invalid'));
});
