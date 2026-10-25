import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {nativeCodingPgPoolFixtureTarget,nativeCodingPhysicalIdentitySql} from './test/native-coding-pg-pool-target.mjs';

const url='postgres://postgres:checkpoint-fixture-only@127.0.0.1:5432/checkpoint_fixture';
const fixture=()=>({METAENGINE_NATIVE_POOL_PG17:'1',GITHUB_ACTIONS:'true',LOCAL_STATE_TEST_ADMIN_DATABASE_URL:url});

test('real native pool qualification accepts only the explicitly enabled existing checkpoint CI service',()=>{
  assert.equal(nativeCodingPgPoolFixtureTarget(fixture()),url);
});

test('real pool qualification uses one exact production physical identity query and refuses unavailable/ambiguous source',async()=>{
  const source=await fs.readFile(new URL('./native-coding-host-os-scope.mjs',import.meta.url),'utf8');
  const sql=nativeCodingPhysicalIdentitySql(source);
  assert.match(sql,/^select current_setting\('data_directory'\)/);
  assert.match(sql,/pg_catalog\.pg_control_system\(\)/);
  assert.match(sql,/inet_server_addr\(\)/);
  for(const invalid of [undefined,'',source.replace('const rows=await reader.unsafe','const rows=await other.unsafe'),source+source])
    assert.throws(()=>nativeCodingPhysicalIdentitySql(invalid),/native_pool_physical_identity_sql_unavailable/);
});

test('real pool qualification cannot fall back to arbitrary database credentials or another database',()=>{
  for(const mutate of [
    e=>delete e.METAENGINE_NATIVE_POOL_PG17,
    e=>e.METAENGINE_NATIVE_POOL_PG17='true',
    e=>delete e.GITHUB_ACTIONS,
    e=>e.GITHUB_ACTIONS='false',
    e=>{delete e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;e.DATABASE_URL=url;},
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace('127.0.0.1','db.example.com'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace('127.0.0.1','localhost'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace(':5432/',':55432/'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace('/checkpoint_fixture','/user_database'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace('/checkpoint_fixture','/%63heckpoint_fixture'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace('postgres:checkpoint-','state_owner:checkpoint-'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url.replace('fixture-only@','different-password@'),
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url+'?options=-csearch_path=public',
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL=url+'#fragment',
    e=>e.LOCAL_STATE_TEST_ADMIN_DATABASE_URL='not-a-url',
  ]){
    const env=fixture();mutate(env);
    assert.throws(()=>nativeCodingPgPoolFixtureTarget(env),
      error=>error.message==='native_pool_explicit_checkpoint_ci_fixture_required');
  }
});
