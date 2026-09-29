import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929020000_client_v1_native_device_enrollment_v1.sql', import.meta.url),
  'utf8',
);

test('fresh project enrollment plane is durable, explicit-approval only, and service-role only', () => {
  assert.match(sql, /create table if not exists public\.compute_fabric_a2_browser_device_enrollment_request_h205f22/i);
  assert.match(sql, /status in \('PENDING','APPROVED','REJECTED','EXPIRED','CLAIMED'\)/i);
  assert.match(sql, /h205f22_a2_browser_device_enrollment_approve_v1/i);
  assert.match(sql, /h205f22_a2_browser_device_activate_approved_v1/i);
  assert.match(sql, /revoke all on function public\.h205f22_a2_browser_device_enrollment_approve_v1\(uuid\)[\s\S]*from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.h205f22_a2_browser_device_enrollment_approve_v1\(uuid\)[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /status\s*=\s*'APPROVED'[\s\S]*insert into public\.compute_fabric_a2_browser_device_h205f22/i);
});

test('activation is exact-request bound and reuses the proven device-enroll primitive', () => {
  for (const token of [
    'v_request.client_id<>p_client_id',
    'v_request.profile<>p_profile',
    'v_request.key_fingerprint_sha256<>p_key_fingerprint_sha256',
    'v_request.public_jwk<>p_public_jwk',
    'v_request.approved_pairing_token_hash is null',
  ]) assert.ok(sql.includes(token), `missing binding fence: ${token}`);

  assert.match(sql, /public\.h205f22_a2_browser_device_enroll_v1\s*\(/i);
  assert.match(sql, /set status='CLAIMED'/i);
  assert.match(sql, /authority_effect\s*=\s*false/i);
});
