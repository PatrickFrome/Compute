// W44 hermetic SYNTHETIC/STAGING fixtures. This does not attest installed Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDbApi } from './db-api.mjs';
import { RPC_ALLOWLIST } from './db-api-core.mjs';
import { OPERATOR_PG17_RESTART_ADMISSION_SQL } from './operator-pg17-restart-admission.mjs';
import { OPERATOR_OWN_PG_PROJECT_SQL, OPERATOR_OWN_PG_TASK_CLAIM_SQL,
  OPERATOR_OWN_PG_EVENT_SQL } from './operator-own-pg-fleet-truth.mjs';
import { startOperatorReadOnlyGateway } from './operator-readonly-gateway.mjs';
import { createOperatorCanonicalNativeBindingReadback } from '../../apps/metaengine-browser/src/operator-canonical-native-w44.mjs';
import { createOperatorNativeContextReader } from '../../apps/metaengine-browser/src/operator-native-context-bridge.mjs';
import { reduceOperatorObservatory } from '../../apps/me2-ui/src/lib/operator-observatory.mjs';

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ownerId = 'owner-native-w44';
const projectId = uuid(1);
const key = 'k'.repeat(64);
const srcSha = 'a'.repeat(40);
const exeDigest = 'b'.repeat(64);
const proof = 'c'.repeat(64);
const packageCodeDigest = 'e'.repeat(64);
const birth = new Date(Date.now() - 60_000).toISOString();
const at = () => new Date().toISOString();
function makeNativeOwner(epoch = 7) {
  return { schema: 'metaengine.host.owner-incarnation.v1',
    source: 'LOCAL_HOST_OWNER', fixture_classification: 'SYNTHETIC',
    owner_id: ownerId, project_id: projectId, device_id: uuid(3),
    pid: 9212, generation: 21, epoch, created_at: birth,
    process_incarnation_id: 'native-w44-incarnation', observed_at: at(),
    authority_effect: false };
}
function makeInstalled(p = proof) {
  // Controlled synthetic verifier output models the v2 on-disk contract.
  // These fields do not authenticate a real package or native loaded code;
  // production W52 rejects this fixture_classification before W44 is reached.
  return { source: 'INSTALLED_EXE_NATIVE_VERIFIER',
    fixture_classification: 'SYNTHETIC', exact_bytes_verified: true,
    native_signature_verified: true, release_root_signature_verified: true,
    slsa_evidence_digest_bound: true, package_code_verified: true,
    package_code_sha256: packageCodeDigest, loaded_runtime_code_attested: false,
    owner_id: ownerId, owner_epoch: 7, owner_generation: 21,
    process_incarnation_id: 'native-w44-incarnation',
    source_sha: srcSha, installed_exe_sha256: exeDigest,
    proof_identity: p, observed_at: at(), authority_effect: false };
}
function fakeSql(state) {
  return { json: x => x, array: x => x, begin: async fn => fn({ unsafe: async (sql) => {
    if (sql.includes('FROM pg_catalog.pg_proc'))
      return RPC_ALLOWLIST.map(name => ({ name, defaults: 0, returnsSet: false,
        returnComposite: false, args: [] }));
    if (sql === OPERATOR_PG17_RESTART_ADMISSION_SQL)
      return [{ observed_at: new Date(), started_at: new Date(state.pgBorn + (state.pgRestart ? 10_000 : 0)),
        database_name: 'w44_synthetic', server_version_num: 170006,
        transaction_read_only: 'on', transaction_isolation: 'repeatable read',
        readable_relations: 5 }];
    if (sql.includes('pg_postmaster_start_time'))
      return [{ observed_at: new Date(), started_at: new Date(state.pgBorn), database_name: 'w44_synthetic' }];
    if (sql.includes('devos_runtime_capabilities_v1'))
      return [{ value: { schema: 'own.pg.w44' } }];
    if (sql === OPERATOR_OWN_PG_PROJECT_SQL)
      return [{ project_id: projectId, workspace_id: uuid(2), device_id: uuid(3),
        client_id: ownerId, admin_grant_epoch: state.epoch, total_tasks: 1, last_seq: 1,
        policy_generation: 1, observed_at: new Date() }];
    if (sql === OPERATOR_OWN_PG_TASK_CLAIM_SQL)
      return [{ task_seq: 1, task_id: uuid(4), task_state: 'RUNNING',
        lease_generation: 5, lease_agent_id: 'agent-w44',
        lease_agent_generation_epoch: state.epoch,
        lease_expires_at: new Date(Date.now() + 10_000).toISOString(), claim_id: 101,
        claim_state: 'ACTIVE', claim_agent_id: 'agent-w44',
        claim_generation: 5, claim_agent_generation: state.epoch,
        claim_workspace_id: uuid(2), claim_expires_at: new Date(Date.now() + 10_000).toISOString() }];
    if (sql === OPERATOR_OWN_PG_EVENT_SQL)
      return [{ seq: 1, event_type: 'TASK_PROGRESS', task_id: uuid(4),
        content: { secret: 'W44_TEST_SQL_SECRET' } }];
    return [];
  } }) };
}
function pgOwner(state) {
  return { schema: 'metaengine.operator.trusted-owner.v1',
    source: 'TRUSTED_OWNER_READBACK', verified: true,
    fixture_classification: 'SYNTHETIC', project_id: projectId,
    workspace_id: uuid(2), device_id: uuid(3), owner_id: ownerId,
    client_id: ownerId, admin_grant_epoch: state.epoch,
    owner_generation: 21, process_incarnation: 'native-w44-incarnation',
    observed_at: at(), heartbeat_at: at(), event_after_seq: 0 };
}
function makeVerifier(url, state) {
  let reads = 0;
  return {
    readOwner: async () => {
      reads++;
      return makeNativeOwner(state.nativeFlipAfter && reads >= state.nativeFlipAfter ? 8 : 7);
    },
    verifyKernelOwner: async owner => ({
      source: 'OS_PROCESS_INVENTORY', state: 'PRESENT', pid: owner.pid,
      process_incarnation_id: owner.process_incarnation_id,
      created_at: owner.created_at, observed_at: at(), authority_effect: false,
      fixture_classification: 'SYNTHETIC' }),
    readGuardian: async () => ({
      schema: 'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
      state: 'READY', owner_binding_proven: true, device_binding_proven: true,
      owner_id: ownerId, owner_generation: 21, owner_pid: 9212,
      owner_created_at: birth, owner_process_incarnation_id: 'native-w44-incarnation',
      observed_at: at(), authority_effect: false, fixture_classification: 'SYNTHETIC' }),
    verifyInstalledSource: async () => makeInstalled(state.nativeProof || proof),
    readGatewayCredential: async () => ({
      source: 'NATIVE_OWNER_SECRET_STORE', owner_id: ownerId, owner_generation: 21,
      api_key: key, gateway_base_url: url }),
    readPostgresBirth: async owner => ({
      source: 'OWN_PG_POSTMASTER_READBACK', owner_id: ownerId,
      owner_epoch: owner.epoch, postgres_started_at: birth, observed_at: at() }),
  };
}
async function harness(statePatch = {}) {
  const state = { epoch: 7, cursor: 1, pgBorn: Date.now() - 60_000,
    pgRestart: false, sourceSwap: false, ...statePatch };
  let sourceReads = 0;
  const api = await startDbApi({ apiKey: key, instanceId: ownerId, port: 0,
    sql: fakeSql(state), operatorOwnerReadback: () => pgOwner(state) });
  try {
    const gateway = await startOperatorReadOnlyGateway({
      apiKey: key, ownerId, upstreamBaseUrl: api.address,
      readRunIdentity: () => ({
        source: 'OWN_POSTGRES_READBACK', proven: true, owner_id: ownerId,
        project_id: projectId, run_id: 'run-w44', owner_epoch: state.epoch,
        event_seq: state.cursor, observed_at: at(), fixture_classification: 'SYNTHETIC' }),
      readInstalledSource: () => {
        sourceReads++;
        return makeInstalled(state.sourceSwap && sourceReads > 1 ? 'd'.repeat(64) : proof);
      },
    });
    return { state, api, gateway, async close() {
      await gateway.close(); await api.close();
    } };
  } catch (error) { await api.close(); throw error; }
}
function reader(h, state = h.state) {
  return createOperatorNativeContextReader({
    getTrustedBinding: createOperatorCanonicalNativeBindingReadback({
      nativeVerifier: () => makeVerifier(h.gateway.address, state),
    }),
  });
}
test('W44 SYNTHETIC cross-hop: native verifier -> authenticated Gateway -> own-PG -> canonical seven views', async () => {
  const h = await harness();
  try {
    const context = await reader(h).readContext();
    assert.equal(context.schema, 'metaengine.operator.context.v1');
    assert.equal(context.run_id, 'run-w44');
    assert.equal(context.owner_id, ownerId);
    assert.equal(context.owner_epoch, 7);
    assert.equal(context.event_seq, 1);
    assert.equal(context.source_sha, srcSha);
    assert.equal(context.proof_identity, proof);
    assert.equal(context.planes.source.state, 'AVAILABLE');
    assert.equal(context.planes.continuity.state, 'AVAILABLE');
    const ui = reduceOperatorObservatory(context);
    assert.equal(ui.cursor_state, 'VERIFIED_CURSOR');
    assert.equal(ui.views.Now.length, 7);
    assert.equal(ui.proof_identity, proof);
    assert.equal(context.authority_effect, false);
    assert.equal(context.automatic_retry_allowed, false);
    assert.doesNotMatch(JSON.stringify(context), /W44_TEST_SQL_SECRET|api_key|k{32}|postgres:\/\//);
  } finally { await h.close(); }
});
test('W44 absent verifier or untrusted shape cannot open network or invent Owner', async () => {
  let requests = 0;
  const binding = createOperatorCanonicalNativeBindingReadback({
    nativeVerifier: { verified: true, owner_pid: 9212, source_sha: srcSha },
  });
  assert.equal(await binding(), null);
  const context = await createOperatorNativeContextReader({
    getTrustedBinding: binding,
    fetchImpl: async () => { requests++; throw new Error('network forbidden'); },
  }).readContext();
  assert.equal(context.state, 'UNKNOWN');
  assert.equal(requests, 0);
});
test('W44 rejects unbound, malformed and legacy v1 EXE-only proofs before credentials, PG or network', async () => {
  const cases = [
    ['missing package verification', row => { delete row.package_code_verified; }],
    ['unverified package', row => { row.package_code_verified = false; }],
    ['truthy flag is not verification', row => { row.package_code_verified = 'true'; }],
    ['missing package digest', row => { delete row.package_code_sha256; }],
    ['malformed package digest', row => { row.package_code_sha256 = 'e'.repeat(63); }],
    ['v1 EXE-only receipt', row => {
      row.manifest_schema = 'metaengine.browser.installed-release-manifest.v1';
      delete row.package_code_verified; delete row.package_code_sha256;
    }],
  ];
  for (const [name, mutate] of cases) {
    const installed = makeInstalled(); mutate(installed);
    assert.equal(installed.fixture_classification, 'SYNTHETIC');
    assert.equal(installed.loaded_runtime_code_attested, false);
    let requests = 0, credentialReads = 0, postgresReads = 0;
    const verifier = makeVerifier('http://127.0.0.1:15432', {});
    verifier.verifyInstalledSource = async () => installed;
    verifier.readGatewayCredential = async () => { credentialReads++; throw Error('credential read forbidden'); };
    verifier.readPostgresBirth = async () => { postgresReads++; throw Error('PG read forbidden'); };
    const binding = createOperatorCanonicalNativeBindingReadback({ nativeVerifier: verifier });
    assert.equal(await binding(), null, name);
    const context = await createOperatorNativeContextReader({ getTrustedBinding: binding,
      fetchImpl: async () => { requests++; throw Error('network forbidden'); },
    }).readContext();
    assert.equal(context.state, 'UNKNOWN', name);
    assert.equal(context.context, null, name);
    assert.equal(context.run_id, null, name);
    assert.equal(context.proof_identity, null, name);
    assert.equal(context.authority_effect, false, name);
    assert.equal(context.automatic_retry_allowed, false, name);
    assert.equal(requests, 0, name);
    assert.equal(credentialReads, 0, name);
    assert.equal(postgresReads, 0, name);
  }
});
test('W44 independent source proof mismatch stays UNKNOWN in source/cursor, not a fabricated digest', async () => {
  const h = await harness();
  try {
    const context = await reader(h, { ...h.state, nativeProof: 'f'.repeat(64) }).readContext();
    assert.equal(context.source_sha, null);
    assert.equal(context.proof_identity, null);
    assert.equal(context.planes.source.state, 'UNKNOWN');
    assert.equal(reduceOperatorObservatory(context).cursor_state, 'UNKNOWN');
  } finally { await h.close(); }
});
test('W44 Gateway source proof changes during SQL+HTTP: no accepted context or retry', async () => {
  const h = await harness({ sourceSwap: true });
  try {
    const context = await reader(h).readContext();
    assert.equal(context.state, 'UNKNOWN');
    assert.equal(context.authority_effect, false);
    assert.equal(context.automatic_retry_allowed, false);
  } finally { await h.close(); }
});
test('W44 native Owner incarnation rolls between samples: no Gateway network', async () => {
  const h = await harness();
  try {
    let calls = 0;
    const nativeVerifier = makeVerifier(h.gateway.address, { nativeFlipAfter: 2 });
    const context = await createOperatorNativeContextReader({
      getTrustedBinding: createOperatorCanonicalNativeBindingReadback({ nativeVerifier }),
      fetchImpl: async () => { calls++; throw new Error('unexpected'); },
    }).readContext();
    assert.equal(context.state, 'UNKNOWN');
    assert.equal(calls, 0);
  } finally { await h.close(); }
});
test('W44 missing PostgreSQL incarnation evidence and restart remain fail closed', async () => {
  const h = await harness({ pgRestart: true });
  try {
    const context = await reader(h).readContext();
    assert.notEqual(context.planes.database.state, 'AVAILABLE');
    assert.notEqual(context.planes.continuity.state, 'AVAILABLE');
    assert.equal(context.proof_identity, null);
  } finally { await h.close(); }
});

test('W44 own-PG cursor != independently scoped Gateway run watermark refuses Source/Continuity colocation', async () => {
  const h = await harness({ cursor: 2 });
  try {
    const context = await reader(h).readContext();
    assert.equal(context.run_id, 'run-w44');
    assert.equal(context.event_seq, 2);
    assert.equal(context.planes.continuity.state, 'AVAILABLE');
    assert.equal(context.planes.source.state, 'UNKNOWN');
    assert.equal(context.proof_identity, null);
    assert.equal(reduceOperatorObservatory(context).cursor_state, 'UNKNOWN');
  } finally { await h.close(); }
});
