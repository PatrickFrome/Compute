import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileMetaObjectivePlan } from '../src/meta-objective-compiler.mjs';

const authority = Object.freeze({
  roadmap_id: 'metaengine-client-v1',
  active_milestone_key: 'C4',
  integration_line: 'work/client-v1-c4-admission-reconciliation-v1',
  baseline_sha: '1fde1e53549eafefd6c28b50cdcd384e86d14512',
  alignment_epoch: 3,
});

test('retired generation remains the CAS watermark for the next objective', () => {
  const compiled = compileMetaObjectivePlan({
    authority,
    planState: { found: false, plan_generation: 1 },
    objective: 'Qualify the next signed Client V1 goal',
  });

  assert.equal(compiled.expected_current_generation, 1);
  assert.equal(compiled.plan.plan_generation, 2);
});

test('a workspace with no plan history still starts at generation one', () => {
  const compiled = compileMetaObjectivePlan({
    authority,
    planState: { found: false, plan_generation: 0 },
    objective: 'Create the first Client V1 plan',
  });

  assert.equal(compiled.expected_current_generation, 0);
  assert.equal(compiled.plan.plan_generation, 1);
});

test('ACTIVE plan state cannot claim generation zero and found must be explicit', () => {
  assert.throws(
    () => compileMetaObjectivePlan({
      authority,
      planState: { found: true, plan_generation: 0 },
      objective: 'Reject an impossible active generation',
    }),
    /meta_objective_plan_state_generation_invalid/,
  );
  assert.throws(
    () => compileMetaObjectivePlan({
      authority,
      planState: { plan_generation: 1 },
      objective: 'Reject ambiguous plan presence',
    }),
    /meta_objective_plan_state_found_invalid/,
  );
});

test('snapshot fallback reports the durable max generation instead of resetting to zero', async () => {
  const source = await readFile(
    new URL('../../../supabase/migrations/20260929203000_client_v1_plan_generation_watermark_v1.sql', import.meta.url),
    'utf8',
  );

  assert.match(source, /coalesce\(max\(plan_generation\),\s*0\)::bigint/i);
  assert.match(source, /'found',false[\s\S]*'plan_generation',w\.plan_generation/i);
  assert.doesNotMatch(source, /'found',false[\s\S]{0,400}'plan_generation',0/i);
  assert.match(source, /revoke all on function public\.meta_orchestrator_plan_snapshot_v1\(uuid,text\) from public, anon, authenticated/i);
  assert.match(source, /grant execute on function public\.meta_orchestrator_plan_snapshot_v1\(uuid,text\) to service_role/i);
});
