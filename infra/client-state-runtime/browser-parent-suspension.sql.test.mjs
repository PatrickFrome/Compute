// Same SERIAL fixture on separately factory-owned native PG17 or supplemental
// PostgreSQL-WASM. Neither lane proves concurrency or installed-client behavior.
// All authority/device/claim/heartbeat rows are synthetic TEST-ONLY data in a
// newly allocated disposable database; no existing DB URI is ever accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qualifyFreshSchemaNative} from './test/fresh-schema-disposable.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {loadFreshSchemaCandidatePlan} from './fresh-schema-plan.mjs';
import {exerciseBrowserParentSuspension} from './test/browser-parent-suspension-fixture.mjs';
const moduleUrl=process.env.METAENGINE_PGLITE_MODULE,cryptoUrl=process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE;
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const root=new URL('../../',import.meta.url);
test('browser suspension SQL (supplemental WASM, serial): exact lease, replay, dependency and custody fences',{skip:!moduleUrl||!cryptoUrl,timeout:120000},async t=>{
 const {PGlite}=await import(moduleUrl);
 const {pgcrypto}=await import(cryptoUrl);
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
 const q=async(s,a=[]) => (await db.query(s,a)).rows;
 const wrap=c=>({unsafe:async(s,a)=>a?.length?(await c.query(s,a)).rows:(await c.exec(s)).at(-1)?.rows??[],begin:cb=>cb(wrap(c))});
 await db.exec('create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;create schema destruktion_meta');
 const plan=await loadFreshSchemaCandidatePlan();
 assert.match(plan.upgrade_sources_sha256,/^[a-f0-9]{64}$/);
 for(const e of plan.baseline)await db.exec(await readFile(new URL(e.path,root),'utf8'));
 await applyLocalRuntimeMigrations({sql:wrap(db),expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
 await exerciseBrowserParentSuspension({q,exec:s=>db.exec(s)});
});

test('browser suspension SQL (factory-owned native PG17, serial): exact lease, replay, dependency and custody fences', {
 skip:!bin||!driver?'Native PG17 binaries/driver absent: native suspension and concurrency UNQUALIFIED':false,timeout:240000,
},async()=>{
 const receipt=await qualifyFreshSchemaNative({bin,driver,base:process.env.METAENGINE_PG_TEST_BASE,
  exercise:async({sql,engine,parallel_backends})=>{
   assert.equal(engine,'NATIVE_PG17');assert.equal(parallel_backends,1);
   await exerciseBrowserParentSuspension({q:(s,a=[])=>sql.unsafe(s,a),exec:s=>sql.unsafe(s)});
   return {status:'BROWSER_PARENT_SUSPENSION_SERIAL_ASSERTIONS_PASSED',engine,parallel_backends,
    synthetic_authority_fixture:true,concurrency_qualified:false,installed_client_qualified:false,production_qualified:false};
  }});
 assert.equal(receipt.native_identity_verified,true);
 assert.equal(receipt.test_exercise.status,'BROWSER_PARENT_SUSPENSION_SERIAL_ASSERTIONS_PASSED');
 assert.equal(receipt.test_exercise.concurrency_qualified,false);
 console.log(JSON.stringify(receipt.test_exercise));
});

test('native fixture callback rejects non-code values before allocating any cluster',async()=>{
 await assert.rejects(qualifyFreshSchemaNative({exercise:{connection:'not accepted'}}),/fresh_test_exercise_invalid/);
});
