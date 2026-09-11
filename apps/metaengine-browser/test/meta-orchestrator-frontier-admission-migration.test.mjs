import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const sql=readFileSync(resolve(here,'../../../supabase/migrations/20260901030000_meta_orchestrator_frontier_admission_v1.sql'),'utf8');

const expect=(pattern,message)=>assert.match(sql,pattern,message);

test('frontier admission is one bounded all-or-none transaction',()=>{
  expect(/create\s+or\s+replace\s+function\s+public\.meta_orchestrator_frontier_admit_v1\s*\(/i);
  expect(/v_count\s*<\s*1\s+or\s+v_count\s*>\s*8/i,'frontier must be bounded');
  expect(/pg_advisory_xact_lock[\s\S]*meta-frontier-admit:/i,'frontier needs one transaction lock');
  expect(/atomic_transaction'\s*,\s*true/i);
  expect(/all_or_none_new_admission'\s*,\s*true/i);
});

test('frontier reuses canonical task admission and never becomes a scheduler',()=>{
  expect(/public\.meta_orchestrator_task_admit_v1\s*\(/i);
  assert.doesNotMatch(sql,/devos_fleet_lease_v1\s*\(/i);
  assert.doesNotMatch(sql,/devos_fleet_mark_running_v1\s*\(/i);
  assert.doesNotMatch(sql,/devos_fleet_complete_v1\s*\(/i);
  assert.doesNotMatch(sql,/create\s+(?:or\s+replace\s+)?function\s+[^\n]*(?:lease|scheduler|poll)/i);
  expect(/second_scheduler_loop'\s*,\s*false/i);
});

test('frontier rejects duplicate semantic points and returns no privileged task or scheduler identity',()=>{
  expect(/v_point\s*=\s*any\(v_seen\)/i);
  expect(/meta_frontier_duplicate_point/i);
  expect(/task_payload_returned'\s*,\s*false/i);
  expect(/scheduler_identity_returned'\s*,\s*false/i);
  for(const field of ['task_content_authority','scheduler_authority','browser_authority','release_authority','authority_effect']){
    expect(new RegExp(`${field}'\\s*,\\s*false`,'i'));
  }
});

test('frontier has no per-point exception swallowing that could commit a partial group',()=>{
  const loop=sql.slice(sql.indexOf('foreach v_point_raw'),sql.indexOf("return jsonb_build_object"));
  assert.doesNotMatch(loop,/exception\s+when/i);
  expect(/grant execute on function public\.meta_orchestrator_frontier_admit_v1\(uuid,text,bigint,text\[\]\) to service_role/i);
});
