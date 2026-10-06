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

test('nonce authentication removes hot-row telemetry mutation and unconditional expiry sweep', async () => {
  const body = nonceV3Body(await migration());

  assert.doesNotMatch(
    body,
    /update public\.compute_fabric_a2_browser_device_h205f22[\s\S]*last_used_at/i,
    'last_used_at telemetry must not upgrade every shared auth lock into an exclusive write',
  );
  assert.match(
    body,
    /if left\(p_nonce_sha256, 2\) = '00'\s+and pg_try_advisory_xact_lock\(20522, 82703\) then/i,
    'expiry cleanup must be amortized and non-blocking rather than unconditional',
  );
});

test('nonce cleanup is indexed, bounded, skip-locked and scheduler-free', async () => {
  const sql = await migration();
  const body = nonceV3Body(sql);

  assert.match(
    sql,
    /create index if not exists compute_fabric_a2_browser_device_nonce_expires_idx\s+on public\.compute_fabric_a2_browser_device_nonce_h205f22\(expires_at\)/i,
  );
  assert.match(body, /pg_try_advisory_xact_lock\(20522, 82703\)/);
  assert.match(body, /limit 1024\s+for update skip locked/i);
  assert.match(
    body,
    /delete from public\.compute_fabric_a2_browser_device_nonce_h205f22 n\s+using victims v/i,
  );
  assert.doesNotMatch(sql, /cron\.schedule|cron\.job|cron\.unschedule/i,
    'nonce maintenance must not add a second scheduler/event source');
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
