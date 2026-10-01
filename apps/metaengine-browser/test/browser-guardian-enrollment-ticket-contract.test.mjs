import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../../supabase/migrations/20261001033000_browser_guardian_enrollment_ticket_v1.sql', import.meta.url),
  'utf8',
);
const edge = fs.readFileSync(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);

test('Guardian enrollment ticket persists only a digest and is bounded to two minutes', () => {
  assert.match(migration, /ticket_sha256 text not null unique/i);
  assert.doesNotMatch(migration, /\bticket\s+text\b/i);
  assert.match(migration, /expires_at <= issued_at \+ interval '2 minutes'/i);
  assert.match(migration, /greatest\(30,least\(120,coalesce\(p_ttl_seconds,90\)\)\)/i);
  assert.match(migration, /plaintext_persisted',false/i);
});

test('ticket issue revalidates exact live ADMIN device grant', () => {
  for (const invariant of [
    /v_device\.active is not true/i,
    /v_device\.revoked_at is not null/i,
    /v_device\.access_tier is distinct from 'ADMIN'/i,
    /v_device\.admin_revoked_at is not null/i,
    /coalesce\(v_device\.admin_grant_epoch,0\) <> v_epoch/i,
    /\(v_device\.admin_scopes \? 'CONTROL_PLANE'\) is distinct from true/i,
  ]) assert.match(migration, invariant);
  assert.match(migration, /guardian_enrollment_ticket_admin_grant_invalid/i);
  assert.equal((migration.match(/limit 1 for share;/gi) || []).length, 2, 'hold device grant stable through ticket commit');
  assert.match(migration, /jsonb_typeof\(v_device.admin_scopes\) is distinct from 'array'/i);
});

test('ticket consume is single-use and revalidates revocation before committing consumption', () => {
  assert.match(migration, /consumed_at is null[\s\S]*expires_at > clock_timestamp\(\)[\s\S]*for update/i);
  assert.match(migration, /DEVICE_GRANT_REVOKED/);
  assert.match(migration, /update public\.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22[\s\S]*set consumed_at=clock_timestamp\(\)[\s\S]*where ticket_id=v_row\.ticket_id[\s\S]*and consumed_at is null/i);
  assert.match(migration, /TICKET_CONSUME_CONFLICT/);
  assert.match(migration, /consumer_owner_sid_sha256=v_owner_sid_sha/i);
  assert.match(migration, /where ticket_id=v_row.ticket_id[\s\S]*and expires_at > clock_timestamp\(\)/i);
});

test('ticket RPCs are service-role only and ordinary clients cannot read ticket table', () => {
  assert.match(migration, /revoke all on public\.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /client_v1_guardian_enrollment_ticket_issue_v1[\s\S]*to service_role/i);
  assert.match(migration, /client_v1_guardian_enrollment_ticket_consume_v1[\s\S]*to service_role/i);
  assert.match(migration, /alter table public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22 enable row level security/i);
});

test('Edge issue route runs after device ADMIN auth while redemption is the sole ticket pre-auth path', () => {
  const enrollmentStatus = edge.indexOf("path==='/v1/device/enrollment/status'");
  const redeem = edge.indexOf("path==='/v1/guardian/enrollment/redeem'");
  const authenticate = edge.indexOf('const identity=await authenticateDevice');
  const issue = edge.indexOf("path==='/v1/device/guardian-enrollment/ticket'");
  assert.ok(enrollmentStatus >= 0 && redeem > enrollmentStatus);
  assert.ok(authenticate > redeem, 'Guardian redemption must occur before device auth because LocalSystem holds no Browser private key');
  assert.ok(issue > authenticate, 'ticket issue must remain behind exact ADMIN device authentication');
  assert.match(edge, /identity\?\.admin_ready!==true\|\|identity\?\.access_tier!=='ADMIN'/);
  assert.match(edge, /p_admin_grant_epoch:Number\(identity\.admin_grant_epoch\)/);
});

test('Edge uses 256-bit random ticket, stores only SHA-256, and never returns ticket on redemption', () => {
  assert.match(edge, /const bytes=new Uint8Array\(32\);crypto\.getRandomValues\(bytes\)/);
  assert.match(edge, /p_ticket_sha256:ticketSha256/);
  assert.match(edge, /ticket_transport:'HTTPS_BODY_ONLY'/);
  assert.match(edge, /ticket_persisted_server_side:false/);
  assert.match(edge, /plaintext_ticket_returned:false/);
  assert.match(edge, /owner_sid_plaintext_returned:false/);
  assert.match(edge, /service_role_exposed:false/);
});

test('redemption accepts only exact bounded ticket, device fingerprint and SID digest', () => {
  assert.match(edge, /\^\[A-Za-z0-9_-\]\{43\}\$/);
  assert.match(edge, /p_ticket_sha256:await sha256\(ticket\)/);
  assert.match(edge, /p_key_fingerprint_sha256:fingerprint/);
  assert.match(edge, /p_owner_sid_sha256:ownerSidSha256/);
  assert.match(edge, /owner_sid_must_come_from_impersonated_pipe_token:true/);
});
