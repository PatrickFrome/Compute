import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,'../../..');
const migration=fs.readFileSync(path.join(repoRoot,'supabase/migrations/20260831121500_devos_fleet_priority_aging_v1.sql'),'utf8');

function effectivePriority(priority, ageMinutes) {
  const ageBoost=Math.min(24,Math.max(0,Math.floor(ageMinutes/15)));
  return {ageBoost,effective:priority+ageBoost};
}

test('lease RPC keeps exact binding, mutating-claim fence and SKIP LOCKED',()=>{
  assert.match(migration,/create or replace function public\.devos_fleet_lease_v1/i);
  assert.match(migration,/t\.role = upper\(p_role\)/i);
  assert.match(migration,/c\.agent_id = lower\(p_agent\)/i);
  assert.match(migration,/t\.claim_class <> 'MUTATING'/i);
  assert.match(migration,/c\.point_id = t\.point_id/i);
  assert.match(migration,/c\.base_sha = t\.base_sha/i);
  assert.match(migration,/for update skip locked/i);
  assert.match(migration,/lease_tab_id = p_tab/i);
  assert.match(migration,/lease_target_id = lower\(p_target\)/i);
  assert.match(migration,/lease_agent_generation_epoch = p_epoch/i);
  assert.match(migration,/lease_generation = t\.lease_generation \+ 1/i);
});

test('aging is bounded, deterministic and cannot erase a priority gap above the cap',()=>{
  assert.match(migration,/least\(\s*24,/i);
  assert.match(migration,/extract\(epoch from \(v_now - t\.created_at\)\) \/ 900\.0/i);
  assert.match(migration,/t\.priority desc,\s*t\.created_at,\s*t\.task_id/i);
  assert.deepEqual(effectivePriority(50,0),{ageBoost:0,effective:50});
  assert.deepEqual(effectivePriority(50,15),{ageBoost:1,effective:51});
  assert.deepEqual(effectivePriority(50,360),{ageBoost:24,effective:74});
  assert.deepEqual(effectivePriority(50,1440),{ageBoost:24,effective:74});
  assert.ok(effectivePriority(50,1440).effective < effectivePriority(75,0).effective);
  assert.ok(effectivePriority(50,360).effective > effectivePriority(70,0).effective);
});

test('lease result and event expose scheduler trace without authorizing retry',()=>{
  for (const field of ['raw_priority','age_boost','effective_priority','scheduler_policy']) {
    assert.match(migration,new RegExp(`'${field}'`));
  }
  assert.match(migration,/priority_plus_bounded_age_v1/);
  assert.match(migration,/'automatic_retry_allowed', false/);
  assert.match(migration,/'authority_effect', false/);
  assert.doesNotMatch(migration,/automatic_retry_allowed'\s*,\s*true/i);
});

test('lease RPC remains service-role only',()=>{
  assert.match(migration,/revoke all on function public\.devos_fleet_lease_v1\(uuid,text,text,text,text,bigint,integer\) from public/i);
  assert.match(migration,/revoke all on function public\.devos_fleet_lease_v1\(uuid,text,text,text,text,bigint,integer\) from anon/i);
  assert.match(migration,/revoke all on function public\.devos_fleet_lease_v1\(uuid,text,text,text,text,bigint,integer\) from authenticated/i);
  assert.match(migration,/grant execute on function public\.devos_fleet_lease_v1\(uuid,text,text,text,text,bigint,integer\) to service_role/i);
});
