import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,'../../..');
const migration=fs.readFileSync(path.join(repoRoot,'supabase/migrations/20260902182500_devos_continuous_baseline_refill_v1.sql'),'utf8');

test('meta continuous refill is scoped to the authoritative current baseline',()=>{
  assert.match(migration,/devos_meta_refill_h205f22/i);
  assert.match(migration,/t\.base_sha=v_base/i);
  assert.match(migration,/DEVOS_META_REFILL_PREDICATE_DRIFT/);
});

test('maintenance refill keeps active stale mutating work as the cross-baseline fence',()=>{
  assert.match(migration,/devos_maintenance_refill_h205f22/i);
  assert.match(migration,/t\.base_sha=v_base or \(t\.claim_class='MUTATING' and t\.state in\('LEASED','RUNNING'\)\)/i);
  assert.match(migration,/DEVOS_MAINTENANCE_REFILL_PREDICATE_DRIFT/);
});

test('migration is fail-closed and contains no retry authorization',()=>{
  assert.match(migration,/raise exception 'DEVOS_META_REFILL_PREDICATE_DRIFT'/);
  assert.match(migration,/raise exception 'DEVOS_MAINTENANCE_REFILL_PREDICATE_DRIFT'/);
  assert.equal(migration.includes('automatic_retry_allowed'),false);
});
