import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { LOCAL_RUNTIME_MIGRATIONS, loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';
import { loadFreshSchemaCandidatePlan, inspectFreshSchemaCandidate, FRESH_SCHEMA_OCCUPANCY_QUERY } from './fresh-schema-plan.mjs';
import { qualifyFreshSchemaWasm, assertDisposableIdentity, assertReservedBackend, assertEmptyApplicationSchema } from './test/fresh-schema-disposable.mjs';

test('empty schema guard accepts driver Result arrays but refuses every occupied or invalid result', () => {
  class Result extends Array {}
  assert.doesNotThrow(() => assertEmptyApplicationSchema(new Result()));
  assert.doesNotThrow(() => assertEmptyApplicationSchema([]));
  for (const rows of [new Result({kind:'function',object_name:'existing'}), [{kind:'relation',object_name:'existing'}], null, undefined, {length:0}, '']) {
    assert.throws(() => assertEmptyApplicationSchema(rows), /application schema/);
  }
});

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
  assert.equal(plan.rpc_signatures.length, 59); assert.equal(plan.production_qualified, false);
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
  assert.equal(receipt.exact_rpc_signatures,59); assert.equal(receipt.rest_tables,5);
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


test('fresh inventory includes every registered upgrade in order and excludes unregistered publication SQL', async () => {
  const candidate = await loadFreshSchemaCandidatePlan();
  const actual = (await loadLocalRuntimeMigrationPlan()).migrations.flatMap(row => [
    { path: row.source, sha256: row.source_sha256 },
    ...(row.upgrade_source ? [{ path: row.upgrade_source, sha256: row.upgrade_source_sha256 }] : []),
  ]);
  assert.deepEqual(candidate.upgrades.map(row => ({ path: path.basename(row.path), sha256: row.sha256 })), actual);
  assert.equal(actual.at(-1).path, 'native-coding-capacity-v2.sql');
  assert.equal(LOCAL_RUNTIME_MIGRATIONS.filter(row => row.path === 'native-coding-capacity-v2.sql').length, 1);
  assert.equal(candidate.upgrades.some(row => row.path.endsWith('native-coding-callback-publication-v1.sql')), false);
  assert.equal(LOCAL_RUNTIME_MIGRATIONS.some(row => row.path === 'native-coding-callback-publication-v1.sql'), false);
});

test('actual fresh loader rejects missing, duplicate, reordered, forged and unregistered inventory before SQL access', async () => {
  // A disposable source-only copy exercises the real loader/catalog, without
  // modifying repository files, SQL authority, a running database or its guards.
  const root = await mkdtemp(path.join(os.tmpdir(), 'fresh-inventory-drift-'));
  const runtime = path.join(root, 'infra/client-state-runtime');
  const sourceRoot = new URL('../../', import.meta.url);
  const original = JSON.parse(await readFile(new URL('./fresh-schema-candidate-plan.json', import.meta.url), 'utf8'));
  const extraPath = 'infra/client-state-runtime/native-coding-callback-publication-v1.sql';
  const resources = new Set([...original.baseline, ...original.upgrades].map(row => row.path));
  resources.add(extraPath);
  resources.add('infra/client-state-runtime/fresh-schema-plan.mjs');
  resources.add('infra/client-state-runtime/local-runtime-migrations.mjs');
  try {
    for (const resource of resources) {
      const target = path.join(root, resource);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(new URL(resource, sourceRoot), target);
    }
    const file = path.join(runtime, 'fresh-schema-candidate-plan.json');
    await writeFile(file, JSON.stringify(original));
    const loader = await import(pathToFileURL(path.join(runtime, 'fresh-schema-plan.mjs')).href);
    assert.equal((await loader.loadFreshSchemaCandidatePlan()).production_qualified, false);
    const extra = { path: extraPath, sha256: createHash('sha256').update(await readFile(path.join(root, extraPath))).digest('hex') };
    let connections = 0;
    const sql = { begin() { connections++; throw Error('unexpected SQL acquisition'); } };
    for (const mode of ['missing', 'duplicate', 'reordered', 'forged', 'unregistered']) {
      const candidate = structuredClone(original);
      if (mode === 'missing') candidate.upgrades.pop();
      if (mode === 'duplicate') candidate.upgrades.push(candidate.upgrades.at(-1));
      if (mode === 'reordered') [candidate.upgrades[candidate.upgrades.length - 1], candidate.upgrades[candidate.upgrades.length - 2]] = [candidate.upgrades.at(-2), candidate.upgrades.at(-1)];
      if (mode === 'forged') candidate.upgrades.at(-1).sha256 = '0'.repeat(64);
      if (mode === 'unregistered') candidate.upgrades.push(extra);
      await writeFile(file, JSON.stringify(candidate));
      await assert.rejects(loader.inspectFreshSchemaCandidate({ sql }), mode === 'forged'
        ? /fresh_schema_source_pin_mismatch/ : /fresh_schema_upgrade_plan_changed/, mode);
      assert.equal(connections, 0, mode + ': drift must fail before DB acquisition');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
