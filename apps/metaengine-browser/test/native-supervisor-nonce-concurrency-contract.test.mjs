import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (rel) => fs.readFile(new URL(rel, import.meta.url), 'utf8');
const migration = () => read('../../../supabase/migrations/20261006173000_browser_device_nonce_concurrency_v3.sql');

function nonceV3Body(sql) {
  const match = sql.match(
    /create or replace function public\.h205f22_a2_browser_device_consume_nonce_v3\([\s\S]*?\r?\nend;\r?\n\$\$;/i,
  );
  assert.ok(match, 'nonce v3 function must exist');
  return match[0];
}

test('nonce v3 preserves exact binding and durable anti-replay without exclusive device hot-row lock', async () => {
  const sql = await migration();
  const body = nonceV3Body(sql);

  assert.match(body, /p_request_timestamp < v_now - interval '2 minutes'/);
  assert.match(body, /p_request_timestamp > v_now \+ interval '2 minutes'/);
  assert.match(body, /where device_id = p_device_id\s+for share;/i,
    'authenticated requests may share the enrolled device row');
  assert.doesNotMatch(
    body,
    /where\s+device_id\s*=\s*p_device_id\s+for\s+update\s*;/i,
    'nonce admission must not exclusively lock the device row',
  );
  assert.match(body, /v_device\.active is not true or v_device\.revoked_at is not null/);
  assert.match(body, /v_device\.client_id <> p_client_id/);
  assert.match(body, /v_device\.profile <> 'A2_DEVICE_HTTP_SIGNATURE_V1'/);

  assert.match(body, /insert into public\.compute_fabric_a2_browser_device_nonce_h205f22/);
  assert.match(body, /exception when unique_violation then[\s\S]*'NONCE_REPLAY'/i,
    'the unique nonce key remains the durable replay authority');
});

test('nonce authentication hot path contains no telemetry update or expiry sweep', async () => {
  const body = nonceV3Body(await migration());

  assert.doesNotMatch(
    body,
    /update public\.compute_fabric_a2_browser_device_h205f22[\s\S]*last_used_at/i,
    'last_used_at telemetry must not upgrade every shared auth lock into an exclusive write',
  );
  assert.doesNotMatch(
    body,
    /delete from public\.compute_fabric_a2_browser_device_nonce_h205f22/i,
    'global expiry cleanup must not run inside every signed request',
  );
});

test('nonce cleanup is bounded, skip-locked and explicitly non-authoritative', async () => {
  const sql = await migration();
  const cleanup = sql.match(
    /create or replace function destruktion_meta\.a2_browser_device_nonce_cleanup_h205f22\(\)[\s\S]*?\r?\nend;\r?\n\$\$;/i,
  )?.[0];
  assert.ok(cleanup, 'bounded cleanup function must exist');
  assert.match(cleanup, /pg_try_advisory_xact_lock\(20522, 82703\)/);
  assert.match(cleanup, /limit 4096\s+for update skip locked/i);
  assert.match(cleanup, /'scheduler_authority',false/);
  assert.match(cleanup, /'browser_authority',false/);
  assert.match(cleanup, /'authority_effect',false/);

  assert.match(sql, /metaengine-h205f22-browser-device-nonce-cleanup/);
  assert.match(sql, /'5 minutes'/);
  assert.match(sql, /select destruktion_meta\.a2_browser_device_nonce_cleanup_h205f22\(\);/);
});

test('canonical Native Supervisor Edge consumes nonce v3 after signature and pairing checks', async () => {
  const edge = await read('../supabase/a2-browser-native-supervisor-v1/index.ts');
  assert.match(edge, /const NONCE_RPC='h205f22_a2_browser_device_consume_nonce_v3';/);
  assert.doesNotMatch(edge, /const NONCE_RPC='h205f22_a2_browser_device_consume_nonce_v2';/);

  const verify = edge.indexOf("verifyP256");
  const pairing = edge.indexOf("PAIRING_REVOKED");
  const consume = edge.indexOf("rpc(NONCE_RPC");
  assert.ok(verify >= 0 && pairing > verify && consume > pairing,
    'signature verification and pairing kill switch must precede durable nonce admission');
});
