import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260906172500_supervisor_complete_authority_order_v1.sql'),
  'utf8',
);

function indexOfOrFail(token) {
  const index = migration.indexOf(token);
  assert.ok(index >= 0, `${token} missing`);
  return index;
}

test('single completion proves current lease before consulting semantic binding evidence', () => {
  const leaseStatus = indexOfOrFail("v_row.status <> 'LEASED'");
  const expiry = indexOfOrFail('v_row.expires_at <= v_now');
  const semanticBinding = indexOfOrFail('if coalesce(p_ok,false) and v_row.action = any(v_bound_effect_actions) then');
  assert.ok(leaseStatus < semanticBinding, 'lease status/holder must be checked before binding evidence');
  assert.ok(expiry < semanticBinding, 'lease expiry must be checked before binding evidence');
  assert.match(migration, /v_row\.leased_by is distinct from v_client/);
});

test('successful semantic completion requires exact immutable digest-bound intent', () => {
  assert.match(migration, /effect-binding\.v1/);
  assert.match(migration, /effect-binding\.v2/);
  assert.match(migration, /v_row\.idempotency_key is null/);
  assert.match(migration, /effect_binding->>'idempotency_key' is distinct from v_row\.idempotency_key/);
  assert.match(migration, /page_data_authority/);
  assert.match(migration, /automatic_retry_allowed/);
  assert.match(migration, /extensions\.digest\(v_row\.effect_binding::text,'sha256'/);
  assert.match(migration, /supervisor_effect_binding_digest_mismatch/);
});

test('completion closes lease-expiry TOCTOU without retry authority', () => {
  assert.match(migration, /status='LEASED' and leased_by=v_client[\s\S]*expires_at>clock_timestamp\(\)[\s\S]*leased_at>clock_timestamp\(\)-interval '10 minutes'/);
  assert.match(migration, /The lease can expire between the precheck and completion UPDATE/);
  assert.match(migration, /never retry the physical effect/);
  assert.match(migration, /revoke all[^;]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute[^;]+to service_role/i);
});
