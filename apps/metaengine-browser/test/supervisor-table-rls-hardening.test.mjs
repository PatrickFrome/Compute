import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260831005000_h205f22_supervisor_table_rls_hardening_v1.sql', import.meta.url),
  'utf8',
).toLowerCase().replace(/\s+/g, ' ').trim();

const tables = [
  'public.compute_fabric_a2_supervisor_mesh_instance_h205f22',
  'public.compute_fabric_a2_supervisor_actuation_lease_h205f22',
  'public.compute_fabric_development_gate_policy_h205f22',
];

for (const table of tables) {
  test(`${table} is RLS protected and browser roles have no direct table privileges`, () => {
    assert.ok(migration.includes(`alter table ${table} enable row level security;`));
    assert.ok(migration.includes(`revoke all privileges on table ${table} from public, anon, authenticated;`));
    assert.ok(migration.includes(`grant select, insert, update, delete on table ${table} to service_role;`));
    for (const role of ['anon', 'authenticated']) {
      assert.equal(migration.includes(`grant select on table ${table} to ${role};`), false);
      assert.equal(migration.includes(`grant insert on table ${table} to ${role};`), false);
      assert.equal(migration.includes(`grant update on table ${table} to ${role};`), false);
      assert.equal(migration.includes(`grant delete on table ${table} to ${role};`), false);
    }
  });
}
