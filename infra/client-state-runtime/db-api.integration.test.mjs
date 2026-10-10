import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';
import postgres from 'postgres';
import { startDbApi } from './db-api.mjs';
import { RPC_ALLOWLIST, RPC_CATALOG_QUERY } from './db-api-core.mjs';
import { NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES } from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/runtime-capabilities.mjs';

const databaseUrl = process.env.LOCAL_STATE_TEST_DATABASE_URL;
const adminUrl = process.env.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;
const enrollment = 'compute_fabric_a2_browser_device_enrollment_request_h205f22';
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

test('restored local PostgreSQL preserves HTTP, SQL and named RPC semantics', { skip: !databaseUrl || !adminUrl }, async () => {
  for (const value of [databaseUrl, adminUrl]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname));
  const admin = postgres(adminUrl, { max: 1, prepare: false });
  const key = randomBytes(32).toString('hex');
  const clientId = 'local-api-test-' + randomUUID();
  let runtime;
  try {
    const catalog = await admin.unsafe(RPC_CATALOG_QUERY, [JSON.stringify(RPC_ALLOWLIST)]);
    assert.equal(new Set(catalog.map((row) => row.name)).size, RPC_ALLOWLIST.length);
    runtime = await startDbApi({ databaseUrl, apiKey: key, port: 0, instanceId: clientId });
    const request = (path, init = {}) => fetch(runtime.address + path, { ...init, headers: { apikey: key, ...init.headers } });
    const rpc = (name, args) => request('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    const health = await request('/health');
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.instance_id, clientId);
    assert.deepEqual(healthBody.runtime_capabilities, NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
    assert.deepEqual(healthBody.rpc_catalog.missing, []);

    for (const [table, select, filter] of [
      [enrollment, 'request_id,status', 'client_id=eq.' + clientId],
      ['compute_fabric_a2_browser_device_h205f22', 'device_id,client_id', 'client_id=eq.' + clientId],
      ['compute_fabric_a2_chat_bridge_remote_pairing_h205f22', 'token_hash', 'token_hash=eq.' + key],
      ['compute_fabric_a2_browser_supervisor_state_h205f22', 'client_id,workspace_id', 'workspace_id=eq.' + workspaceId],
      ['compute_fabric_a2_browser_supervisor_command_h205f22', 'command_id,status', 'workspace_id=eq.' + workspaceId],
    ]) {
      const response = await request('/rest/v1/' + table + '?' + filter + '&select=' + select + '&limit=1');
      assert.equal(response.status, 200, table + ':' + await response.clone().text());
      assert.ok(Array.isArray(await response.json()));
    }

    const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
    const fingerprint = randomBytes(32).toString('hex');
    const body = { client_id: clientId, profile: 'A2_DEVICE_HTTP_SIGNATURE_V1', public_jwk: publicJwk, key_fingerprint_sha256: fingerprint,
      status: 'PENDING', metadata: { test_only: true, parameterized: "'); SELECT pg_sleep(30); --" }, authority_effect: false };
    const inserted = await request('/rest/v1/' + enrollment + '?select=request_id,status,requested_at,expires_at,key_fingerprint_sha256', {
      method: 'POST', headers: { 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body),
    });
    assert.equal(inserted.status, 201, await inserted.clone().text());
    const [row] = await inserted.json();
    assert.equal(row.status, 'PENDING');
    assert.equal(row.key_fingerprint_sha256, fingerprint);
    const readback = await request('/rest/v1/' + enrollment + '?client_id=eq.' + clientId + '&key_fingerprint_sha256=eq.' + fingerprint + '&status=in.(PENDING,APPROVED)&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&select=request_id,status&order=requested_at.desc&limit=1');
    assert.deepEqual(await readback.json(), [{ request_id: row.request_id, status: 'PENDING' }]);
    const direct = await admin.unsafe('SELECT metadata, public_jwk FROM public.compute_fabric_a2_browser_device_enrollment_request_h205f22 WHERE request_id = $1::uuid', [row.request_id]);
    assert.deepEqual(direct[0].metadata, body.metadata);
    assert.deepEqual(direct[0].public_jwk, publicJwk);
    const activation = await rpc('h205f22_a2_browser_device_activate_approved_v1', { p_request_id: row.request_id, p_client_id: clientId,
      p_profile: body.profile, p_key_fingerprint_sha256: fingerprint, p_public_jwk: publicJwk });
    assert.equal(activation.status, 200, await activation.clone().text());
    const activationBody = await activation.json();
    assert.equal(activationBody.accepted, false);
    assert.equal(activationBody.status, 'PENDING');

    const arrayResponse = await rpc('meta_orchestrator_frontier_admit_v1', { p_workspace_id: workspaceId, p_roadmap_id: 'local-test-no-roadmap', p_plan_generation: 0, p_point_ids: ['injection-looking-\"), --'] });
    assert.ok([400, 409].includes(arrayResponse.status), await arrayResponse.clone().text());
    const arrayError = await arrayResponse.json();
    assert.notEqual(arrayError.code, '42601');
    assert.notEqual(arrayError.code, '42883');
    const unknown = await rpc('query', { sql: 'SELECT 1' });
    assert.equal(unknown.status, 404);
    const invalid = await rpc('devos_environment_state_v1', { p_workspace: 'not-a-uuid' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, '22P02');
    const valid = await rpc('devos_environment_state_v1', { p_workspace: workspaceId });
    assert.equal(valid.status, 200, await valid.clone().text());
    assert.equal((await valid.json()).workspace_id, workspaceId);

    const controllerWorkspace = randomUUID();
    const controllerRoadmap = 'local-test-' + randomUUID();
    try {
      const owner = await rpc('meta_orchestrator_controller_lease_v1', { p_workspace_id: controllerWorkspace, p_roadmap_id: controllerRoadmap, p_client_id: clientId });
      assert.equal(owner.status, 200, await owner.clone().text());
      const ownerBody = await owner.json();
      assert.equal(ownerBody.leased, true);
      const contender = await rpc('meta_orchestrator_controller_lease_v1', { p_workspace_id: controllerWorkspace, p_roadmap_id: controllerRoadmap, p_client_id: clientId + '-other' });
      assert.equal(contender.status, 200, await contender.clone().text());
      assert.equal((await contender.json()).leased, false);
      const frontier = await rpc('meta_orchestrator_frontier_admit_v2', { p_workspace_id: controllerWorkspace, p_roadmap_id: controllerRoadmap,
        p_plan_generation: 1, p_point_ids: ['test-point'], p_holder_client_id: clientId + '-other', p_leader_epoch: ownerBody.leader_epoch });
      assert.equal(frontier.status, 409);
      assert.equal((await frontier.json()).message, 'meta_frontier_leader_fenced');
    } finally {
      await admin.unsafe('DELETE FROM destruktion_meta.meta_orchestrator_controller_lease_h205f22 WHERE workspace_id = $1::uuid AND roadmap_id = $2::text', [controllerWorkspace, controllerRoadmap]);
    }
    const ambiguity = await rpc('devos_fleet_reconcile_ambiguous_v2', { p_workspace: workspaceId, p_client: clientId, p_task: randomUUID(),
      p_agent: 'agent_localtest123', p_generation: 1, p_tab: 'tab_' + randomUUID(), p_target: 'webcontents:123', p_epoch: 1,
      p_recovery: { recovery_class: 'PRE_EFFECT_ABORTED', prompt_sha256: key, automatic_retry_allowed: false, authority_effect: false } });
    assert.equal(ambiguity.status, 409, await ambiguity.clone().text());
    assert.equal((await ambiguity.json()).message, 'devos_ambiguity_supervisor_client_fenced');
  } finally {
    if (runtime) await runtime.close();
    await admin.unsafe('DELETE FROM public.compute_fabric_a2_browser_device_enrollment_request_h205f22 WHERE client_id = $1 AND metadata @> $2::jsonb', [clientId, admin.json({ test_only: true })]);
    await admin.end({ timeout: 5 });
  }
});
