import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,'../../..');
const migration=fs.readFileSync(path.join(repoRoot,'supabase/migrations/20260831120500_devos_fleet_reconcile_v1.sql'),'utf8');

test('reconcile RPC fences expired work ambiguous and never requeues it',()=>{
  assert.match(migration,/create or replace function public\.devos_fleet_reconcile_v1\(p_workspace uuid\)/i);
  assert.match(migration,/security definer/i);
  assert.match(migration,/set search_path to 'pg_catalog', 'destruktion_meta'/i);
  assert.match(migration,/for update skip locked/ig);
  assert.match(migration,/set state = 'AMBIGUOUS'/);
  assert.match(migration,/LEASE_EXPIRED_EFFECT_UNKNOWN/);
  assert.match(migration,/set state = 'EXPIRED'/);
  assert.match(migration,/TASK_LEASE_EXPIRED_AMBIGUOUS/);
  assert.match(migration,/CLAIM_EXPIRED/);
  assert.match(migration,/'requeued_tasks', 0/);
  assert.match(migration,/'automatic_retry_allowed', false/);
  assert.match(migration,/'authority_effect', false/);
  assert.doesNotMatch(migration,/set\s+state\s*=\s*'READY'/i);
  assert.doesNotMatch(migration,/task_spec|\bprompt\b|page_text|model_text/i);
});

test('reconcile RPC is service-role only',()=>{
  assert.match(migration,/revoke all on function public\.devos_fleet_reconcile_v1\(uuid\) from public/i);
  assert.match(migration,/revoke all on function public\.devos_fleet_reconcile_v1\(uuid\) from anon/i);
  assert.match(migration,/revoke all on function public\.devos_fleet_reconcile_v1\(uuid\) from authenticated/i);
  assert.match(migration,/grant execute on function public\.devos_fleet_reconcile_v1\(uuid\) to service_role/i);
});
