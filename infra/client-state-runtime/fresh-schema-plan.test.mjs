import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFreshSchemaCandidatePlan, inspectFreshSchemaCandidate, FRESH_SCHEMA_OCCUPANCY_QUERY } from './fresh-schema-plan.mjs';
import { qualifyFreshSchemaWasm, assertDisposableIdentity, assertReservedBackend } from './test/fresh-schema-disposable.mjs';

test('fresh schema qualification is registered in unit and disposable PG17 CI paths', async () => {
  const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(packageJson.scripts.test.split(' ').includes('fresh-schema-plan.test.mjs'));
  assert.equal(packageJson.scripts['test:fresh-schema:pg17'], 'node --test fresh-schema-pg17.integration.test.mjs');
  const workflow = await readFile(new URL('../../.github/workflows/client-source-candidate-w59.yml', import.meta.url), 'utf8');
  assert.match(workflow, /runuser -u postgres/);
  assert.match(workflow, /METAENGINE_PG_TEST_BIN=\/usr\/lib\/postgresql\/17\/bin/);
  assert.match(workflow, /test -x "\$METAENGINE_PG_TEST_BIN\/initdb"/);
  assert.match(workflow, /test -f "\$METAENGINE_PG_TEST_DRIVER"/);
  assert.match(workflow, /"\$NODE_BIN" --test infra\/client-state-runtime\/fresh-schema-pg17\.integration\.test\.mjs/);
});

test('candidate pins all exact bytes and current upgrade order without declaring readiness', async () => {
  const plan = await loadFreshSchemaCandidatePlan();
  assert.equal(plan.baseline.length, 32); assert.equal(new Set(plan.baseline.map(r=>r.path)).size, 31);
  assert.equal(plan.rpc_signatures.length, 52); assert.equal(plan.production_qualified, false);
  assert.equal(plan.authority_effect, false); assert.equal(plan.automatic_population_required, true);
  assert.equal(plan.unresolved_dependencies.length, 4);
});
test('preflight is transactional, locks before inspection, never applies SQL or activates', async () => {
  const calls = []; const sql = { begin: fn => fn({ unsafe: async query => { calls.push(query); return []; } }) };
  const result = await inspectFreshSchemaCandidate({ sql });
  assert.equal(result.status, 'BLOCKED_PENDING_BASELINE_REVIEW'); assert.equal(result.schema_applied, false);
  assert.match(calls[2], /pg_advisory_xact_lock/); assert.equal(calls[3], FRESH_SCHEMA_OCCUPANCY_QUERY);
  assert.equal(calls.length, 4);
});
test('preflight refuses even a partial function-only schema and rejects stale candidate pin before DB access', async () => {
  const sql = { begin: fn => fn({ unsafe: async q => q === FRESH_SCHEMA_OCCUPANCY_QUERY ? [{kind:'function',object_name:'partial'}] : [] }) };
  assert.equal((await inspectFreshSchemaCandidate({sql})).status, 'REFUSED_NONEMPTY_APPLICATION_SCHEMA');
  await assert.rejects(inspectFreshSchemaCandidate({sql:{begin(){throw Error('must not connect');}},expectedCandidateSha256:'0'.repeat(64)}), /candidate_pin_mismatch/);

});

test('fresh candidate PostgreSQL18 WASM supplemental qualification (not PG17)', {
  skip: !process.env.METAENGINE_PGLITE_MODULE || !process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE, timeout: 120000,
}, async () => {
  const receipt=await qualifyFreshSchemaWasm({moduleUrl:process.env.METAENGINE_PGLITE_MODULE,pgcryptoModuleUrl:process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE});
  assert.equal(receipt.exact_rpc_signatures,52); assert.equal(receipt.rest_tables,5);
  assert.equal(receipt.atomic_baseline,false);
  assert.equal(receipt.cleanup_required,'DESTROY_FACTORY_OWNED_DISPOSABLE_CLUSTER');
  console.log(JSON.stringify(receipt));
});

test('native factory identity refuses directory, cluster and connection substitution',()=>{
  const expected={directory:'/new/data',system_identifier:'123456',pid:42};
  assert.doesNotThrow(()=>assertDisposableIdentity({...expected},expected));
  for(const bad of [{directory:'/user/data'},{system_identifier:'654321'},{pid:43}])
    assert.throws(()=>assertDisposableIdentity({...expected,...bad},expected),/cluster_identity_mismatch/);
});

test('reserved backend guard needs no control-data privilege under restricted role',async()=>{
  const restricted={unsafe:async query=>{
    assert.equal(query,'select pg_backend_pid() as pid','must not query privileged cluster settings after SET ROLE');
    return [{pid:42}];
  }};
  await assertReservedBackend(restricted,42);
  await assert.rejects(assertReservedBackend(restricted,43),/backend_changed/);
});
