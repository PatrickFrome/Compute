import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFreshSchemaApplicationPlan,FRESH_SCHEMA_BASELINE_RESOURCES} from './fresh-schema-application-plan.mjs';
import {RPC_ALLOWLIST} from './db-api-core.mjs';
import {qualifyFreshSchemaWasm,qualifyFreshSchemaNative} from './test/fresh-schema-disposable.mjs';

test('fresh application plan has exact reviewed source spans and explicit static prerequisites',async()=>{
  const plan=await loadFreshSchemaApplicationPlan();
  assert.equal(FRESH_SCHEMA_BASELINE_RESOURCES.length,31);
  assert.equal(plan.excluded_functions.length,3);
  assert.equal(plan.rpc_signatures.length,RPC_ALLOWLIST.length);
  assert.equal(plan.runtime_ready,false);assert.equal(plan.automatic_population_required,true);
  assert.match(plan.prerequisite_sql,/create role service_role nologin/);
  assert.match(plan.post_upgrade_acl_sql,/alter default privileges/);
  assert.match(plan.source_manifest_sha256,/^[a-f0-9]{64}$/);
  assert(plan.statements.every(row=>row.sql && Number.isSafeInteger(row.start)&&row.end>row.start));
});
test('atomic fresh schema PostgreSQL18 WASM supplemental qualification',{
  skip:!process.env.METAENGINE_PGLITE_MODULE||!process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE,timeout:120000,
},async()=>{
  const receipt=await qualifyFreshSchemaWasm({moduleUrl:process.env.METAENGINE_PGLITE_MODULE,
    pgcryptoModuleUrl:process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE,applicationMode:'ATOMIC_SLICE'});
  assert.equal(receipt.atomic_transaction,true);assert.equal(receipt.effective_extra_api_functions,0);
  assert.equal(receipt.future_function_execute_denied,true);
  console.log(JSON.stringify(receipt));
});
test('atomic fresh schema factory-owned native PG17 qualification',{
  skip:!process.env.METAENGINE_PG_TEST_BIN||!process.env.METAENGINE_PG_TEST_DRIVER,timeout:240000,
},async()=>{
  const receipt=await qualifyFreshSchemaNative({bin:process.env.METAENGINE_PG_TEST_BIN,
    driver:process.env.METAENGINE_PG_TEST_DRIVER,base:process.env.METAENGINE_PG_TEST_BASE,applicationMode:'ATOMIC_SLICE',
    exercise:async({sql})=>{
      // The shared fixture accepts serialized JSON parameters, including when
      // the server infers their type from an RPC rather than an explicit cast.
      for(const value of [{nested:{safe:true}},['rpc_one','rpc_two'],'literal',7,true,null]){
        const text=JSON.stringify(value);
        const [row]=await sql.unsafe('select $1::json as json_value,$2::jsonb as jsonb_value,jsonb_typeof($3) as inferred_type',
          [text,text,text]);
        assert.deepEqual(row.json_value,value);assert.deepEqual(row.jsonb_value,value);
        assert.equal(row.inferred_type,value===null?'null':Array.isArray(value)?'array':typeof value);
      }
      const jsonText=JSON.stringify({must_remain:'text'});
      const [plain]=await sql.unsafe('select $1::text as value,$2::jsonb is null as sql_null',[jsonText,null]);
      assert.equal(plain.value,jsonText);assert.equal(plain.sql_null,true);
      await assert.rejects(sql.unsafe('select $1::jsonb',['not valid JSON']),error=>error.code==='22P02');
      return {serialized_json_shapes_verified:true};
    }});
  assert.equal(receipt.atomic_transaction,true);assert.equal(receipt.native_identity_verified,true);
  assert.equal(receipt.future_function_execute_denied,true);
  assert.equal(receipt.test_exercise.serialized_json_shapes_verified,true);
  console.log(JSON.stringify(receipt));
});
