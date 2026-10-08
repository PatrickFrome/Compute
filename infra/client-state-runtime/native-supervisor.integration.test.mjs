import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { collectRuntimeBindings, finishRuntimeBindings } from './runtime-verification-bindings.mjs';

const adminUrl = process.env.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;
const endpoint = process.env.LOCAL_STATE_TEST_SUPERVISOR_URL;
const PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';
const MARKER = '/a2-browser-native-supervisor-v1';
const sha = (value) => createHash('sha256').update(value).digest('hex');

function nonce() {
  // Avoid the production nonce routine's optional expired-row maintenance branch.
  let value;
  do { value = randomBytes(24).toString('base64url'); } while (sha(value).startsWith('00'));
  return value;
}

test('signed local Native Supervisor enforces enrollment, role, replay and admission fences', { skip: !adminUrl || !endpoint }, async () => {
  const target = new URL(endpoint);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(adminUrl).hostname));
  const sql = postgres(adminUrl, { max: 1, prepare: false });
  const clientId = 'native-local-test-' + randomUUID();
  const deviceId = randomUUID();
  const pairing = randomBytes(32).toString('hex');
  const probes = [];
  const protectedTables = ['destruktion_meta.devos_fleet_task_h205f22', 'destruktion_meta.devos_fleet_claim_h205f22',
    'destruktion_meta.devos_fleet_runtime_control_h205f22', 'public.compute_fabric_a2_browser_supervisor_state_h205f22',
    'public.compute_fabric_a2_browser_supervisor_command_h205f22'];
  const digest = async () => {
    const result = {};
    for (const table of protectedTables) {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS rows, md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text))) AS digest FROM ${table} t`);
      result[table] = row;
    }
    return result;
  };
  const before = await digest();
  let success = false;
  let failure;
  let bindingsBefore;
  let bindings;
  const bindingConfig = {
    repoRoot: fileURLToPath(new URL('../..', import.meta.url)), workspaceRoot: fileURLToPath(new URL('../../../..', import.meta.url)),
    endpoint, expectedInstanceId: process.env.LOCAL_STATE_TEST_EXPECTED_INSTANCE_ID,
    apiEndpoint: process.env.LOCAL_STATE_TEST_API_URL, apiKey: process.env.LOCAL_STATE_TEST_API_KEY,
    paths: { restore: process.env.LOCAL_STATE_TEST_RESTORE_REPORT_PATH, migrations: process.env.LOCAL_STATE_TEST_MIGRATION_REPORT_PATH,
      runtime: process.env.LOCAL_STATE_TEST_RUNTIME_STATUS_PATH, startup: process.env.LOCAL_STATE_TEST_STARTUP_MANIFEST_PATH,
      launcher: process.env.LOCAL_STATE_TEST_LAUNCHER_ENTRY_PATH, deno: process.env.LOCAL_STATE_TEST_DENO_PATH },
  };
  try {
    bindingsBefore = await collectRuntimeBindings(bindingConfig);
    const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const exported = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
    const publicJwk = { crv: exported.crv, ext: true, key_ops: ['verify'], kty: exported.kty, x: exported.x, y: exported.y };
    const fingerprint = sha(JSON.stringify(publicJwk));
    const signature = async (material) => Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, Buffer.from(material))).toString('base64url');
    const signed = async (path, { method = 'GET', body, timestamp = new Date().toISOString(), requestNonce = nonce() } = {}) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      const bodyHash = sha(text);
      const material = [PROFILE, `device_id:${deviceId}`, `method:${method}`, `path:${MARKER}${path}`, `timestamp:${timestamp}`, `nonce:${requestNonce}`, `body_sha256:${bodyHash}`].join('\n');
      return { method, body: body === undefined ? undefined : text, headers: {
        'content-type': 'application/json', 'x-a2-chat-bridge-client': clientId, 'x-a2-device-profile': PROFILE,
        'x-a2-device-id': deviceId, 'x-a2-device-timestamp': timestamp, 'x-a2-device-nonce': requestNonce,
        'x-a2-device-body-sha256': bodyHash, 'x-a2-device-signature': await signature(material),
      } };
    };
    const invoke = async (path, request, label, expectedStatus, expectedReason) => {
      const response = await fetch(endpoint + path, request);
      const value = await response.json();
      assert.equal(response.status, expectedStatus, label + ':' + JSON.stringify({ error: value.error, reason: value.reason }));
      if (expectedReason) assert.equal(value.reason || value.error, expectedReason, label);
      probes.push({ probe: label, status: response.status, ...(expectedReason ? { fence: expectedReason } : {}) });
      return value;
    };
    const health = await invoke('/health', {}, 'live_local_health', 200);
    assert.equal(health.state_provider, 'LOCAL_POSTGRES');
    assert.equal(health.hosted_supabase_required, false);
    assert.equal(health.runtime_ready, true);
    assert.equal(health.capability_health.state, 'ATTESTED');
    const enrollmentBody = { profile: PROFILE, public_jwk: publicJwk, key_fingerprint_sha256: fingerprint, metadata: { test_only: true } };
    const text = JSON.stringify(enrollmentBody);
    const timestamp = new Date().toISOString();
    const enrollmentNonce = nonce();
    const enrollmentMaterial = ['METAENGINE_NATIVE_ENROLLMENT_V1', `client_id:${clientId}`, `profile:${PROFILE}`, `fingerprint:${fingerprint}`,
      `timestamp:${timestamp}`, `nonce:${enrollmentNonce}`, `body_sha256:${sha(text)}`].join('\n');
    const enrollment = await invoke('/v1/device/enrollment/request', { method: 'POST', body: text, headers: { 'content-type': 'application/json',
      'x-a2-chat-bridge-client': clientId, 'x-metaengine-enroll-timestamp': timestamp, 'x-metaengine-enroll-nonce': enrollmentNonce,
      'x-metaengine-enroll-signature': await signature(enrollmentMaterial) } }, 'signed_enrollment_requires_approval', 202, 'APPROVAL_REQUIRED');
    assert.equal(enrollment.status, 'PENDING');
    await invoke('/v1/admin/status', await signed('/v1/admin/status'), 'unapproved_device_is_not_authority', 401, 'DEVICE_NOT_FOUND');

    await sql.begin(async (tx) => {
      await tx.unsafe('INSERT INTO public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash,label) VALUES($1,$2)', [pairing, clientId]);
      await tx.unsafe(`INSERT INTO public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash)
        VALUES($1::uuid,$2,$3::jsonb,$4,$5)`, [deviceId, clientId, sql.json(publicJwk), fingerprint, pairing]);
    });
    const replayRequest = await signed('/v1/admin/status');
    const admin = await invoke('/v1/admin/status', replayRequest, 'signed_admin_exact_grant_readback', 200);
    assert.equal(admin.connected, true);
    assert.equal(admin.device_id, deviceId);
    assert.equal(admin.admin_ready, true);
    assert.equal(admin.master_secret_embedded, false);
    await invoke('/v1/admin/status', replayRequest, 'durable_nonce_replay_rejected', 401, 'NONCE_REPLAY');
    const [storedNonce] = await sql.unsafe('SELECT count(*)::int AS count FROM public.compute_fabric_a2_browser_device_nonce_h205f22 WHERE device_id=$1::uuid AND nonce_sha256=$2', [deviceId, sha(replayRequest.headers['x-a2-device-nonce'])]);
    assert.equal(storedNonce.count, 1);
    const concurrentRequest = await signed('/v1/admin/status');
    const concurrent = await Promise.all([fetch(endpoint + '/v1/admin/status', concurrentRequest), fetch(endpoint + '/v1/admin/status', concurrentRequest)]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 401]);
    const concurrentBodies = await Promise.all(concurrent.map((response) => response.json()));
    assert.equal(concurrentBodies.find((body) => body.reason)?.reason, 'NONCE_REPLAY');
    probes.push({ probe: 'concurrent_nonce_only_one_admission', statuses: [200, 401], fence: 'NONCE_REPLAY' });
    await invoke('/v1/admin/status', await signed('/v1/admin/status', { timestamp: new Date(Date.now() - 5 * 60000).toISOString() }), 'expired_signed_request_rejected', 401, 'TIMESTAMP_OUT_OF_WINDOW');
    const invalidSignature = await signed('/v1/admin/status');
    invalidSignature.headers['x-a2-device-signature'] = ('A' === invalidSignature.headers['x-a2-device-signature'][0] ? 'B' : 'A') + invalidSignature.headers['x-a2-device-signature'].slice(1);
    await invoke('/v1/admin/status', invalidSignature, 'invalid_signature_rejected', 401, 'INVALID_SIGNATURE');
    const tampered = await signed('/v1/devos/environment-state', { method: 'POST', body: {} });
    tampered.body = '{"unexpected":true}';
    await invoke('/v1/devos/environment-state', tampered, 'body_hash_tampering_rejected', 401, 'BODY_HASH_MISMATCH');
    await sql.unsafe('UPDATE public.compute_fabric_a2_browser_device_h205f22 SET admin_scopes=$1::jsonb WHERE device_id=$2::uuid AND client_id=$3', [sql.json(['DIAGNOSTICS']), deviceId, clientId]);
    await invoke('/v1/admin/status', await signed('/v1/admin/status'), 'missing_control_plane_grant_rejected', 401, 'ADMIN_GRANT_REQUIRED');
    await sql.unsafe('UPDATE public.compute_fabric_a2_browser_device_h205f22 SET admin_scopes=$1::jsonb WHERE device_id=$2::uuid AND client_id=$3', [sql.json(['CONTROL_PLANE', 'DEVOS', 'FLEET', 'DIAGNOSTICS']), deviceId, clientId]);
    await sql.unsafe('UPDATE public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 SET active=false WHERE token_hash=$1 AND label=$2', [pairing, clientId]);
    await invoke('/v1/admin/status', await signed('/v1/admin/status'), 'revoked_owned_pairing_rejected', 401, 'PAIRING_REVOKED');
    await sql.unsafe('UPDATE public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 SET active=true WHERE token_hash=$1 AND label=$2', [pairing, clientId]);
    await sql.unsafe('UPDATE public.compute_fabric_a2_browser_device_h205f22 SET active=false, revoked_at=clock_timestamp() WHERE device_id=$1::uuid AND client_id=$2', [deviceId, clientId]);
    await invoke('/v1/admin/status', await signed('/v1/admin/status'), 'revoked_owned_device_rejected', 401, 'DEVICE_REVOKED');
    await sql.unsafe('UPDATE public.compute_fabric_a2_browser_device_h205f22 SET active=true, revoked_at=NULL WHERE device_id=$1::uuid AND client_id=$2', [deviceId, clientId]);
    const environment = await invoke('/v1/devos/environment-state', await signed('/v1/devos/environment-state', { method: 'POST', body: {} }), 'admission_state_readback', 200);
    assert.equal(environment.authoritative, true);
    assert.equal(environment.authority_effect, false);
    await invoke('/v1/devos/resume-admission', await signed('/v1/devos/resume-admission', { method: 'POST', body: { confirm: false } }), 'unconfirmed_admission_resume_rejected', 400, 'devos_resume_confirmation_required');
    if (environment.continuous_service_allowed === false) {
      const cycle = await invoke('/v1/devos/cycle', await signed('/v1/devos/cycle', { method: 'POST', body: {} }), 'closed_admission_cycle_has_no_lease_attempts', 200);
      assert.equal(cycle.state, 'ADMISSION_FENCED');
      assert.equal(cycle.lease_attempts, 0);
      assert.deepEqual(cycle.leases, []);
      assert.equal(cycle.reconcile, null);
    } else probes.push({ probe: 'closed_admission_cycle_has_no_lease_attempts', status: 'NOT_RUN_ENVIRONMENT_OPEN' });
    const inspection = await invoke('/v1/db/inspect', await signed('/v1/db/inspect', { method: 'POST', body: {} }), 'bounded_read_only_database_inspection', 200);
    assert.equal(inspection.writes_allowed, false);
    assert.ok(inspection.tables_counted > 0);
    const missingReceipt = await invoke('/v1/commands/' + randomUUID() + '/receipt', await signed('/v1/commands/' + '00000000-0000-4000-8000-000000000000' + '/receipt'), 'signed_path_tampering_rejected', 401, 'INVALID_SIGNATURE');
    assert.equal(missingReceipt.error, 'device_auth_required');
    const missingCommandId = randomUUID();
    const receipt = await invoke('/v1/commands/' + missingCommandId + '/receipt', await signed('/v1/commands/' + missingCommandId + '/receipt'), 'missing_command_receipt_is_not_authority', 200);
    assert.equal(receipt.found, false);
    assert.equal(receipt.terminal, false);
    assert.equal(receipt.execution_authority, false);
    success = true;
  } catch (error) { failure = error; }
  finally {
    await sql.begin(async (tx) => {
      await tx.unsafe('DELETE FROM public.compute_fabric_a2_browser_device_enrollment_request_h205f22 WHERE client_id=$1', [clientId]);
      await tx.unsafe('DELETE FROM public.compute_fabric_a2_browser_device_nonce_h205f22 WHERE device_id=$1::uuid', [deviceId]);
      await tx.unsafe('DELETE FROM public.compute_fabric_a2_browser_device_h205f22 WHERE device_id=$1::uuid AND client_id=$2', [deviceId, clientId]);
      await tx.unsafe('DELETE FROM public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 WHERE token_hash=$1 AND label=$2', [pairing, clientId]);
    });
    const after = await digest();
    try { assert.deepEqual(after, before, 'task, claim, admission, supervisor and command tables must remain byte-equivalent'); }
    catch (error) { failure ||= error; success = false; }
    if (bindingsBefore) {
      try { bindings = finishRuntimeBindings(bindingsBefore, await collectRuntimeBindings(bindingConfig)); }
      catch (error) { failure ||= error; success = false; }
    }
    const reportPath = process.env.LOCAL_STATE_TEST_REPORT_PATH;
    if (reportPath) {
      assert.ok(isAbsolute(reportPath));
      await writeFile(reportPath, JSON.stringify({ schema: 'compute.local-native-supervisor-verification.v1', verified_at: new Date().toISOString(),
        status: success && !failure ? 'PASS' : 'FAIL', evidence_level: bindings?.level || 'SMOKE_ONLY', candidate_bindings: bindings || null,
        endpoint, instance_id: bindings?.before?.health?.instance_id || null, probe_source: 'generated-own-fixtures-with-P256-signatures', probes,
        protected_database_digest_before: before, protected_database_digest_after: after, task_and_admission_data_unchanged: JSON.stringify(before) === JSON.stringify(after),
        owned_fixtures_removed: true, private_keys_persisted: false, hosted_requests: false }, null, 2) + '\n');
    }
    await sql.end({ timeout: 5 });
  }
  if (failure) throw failure;
});
