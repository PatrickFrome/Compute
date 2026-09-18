import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/windows-autonomous-session-soak.ps1', import.meta.url), 'utf8');

test('installed UI resource growth baseline is taken only after background startup settles', () => {
  for (const subsystem of [
    'OWNER_SAFETY_GATES',
    'USER_SESSION',
    'INITIAL_TAB_CREATE',
    'FLEET',
    'SHELL_SNAPSHOT',
    'DEVELOPMENT_PLANE',
    'NATIVE_SUPERVISOR',
    'INITIAL_REMOTE_LOAD',
  ]) assert.match(source, new RegExp(`'${subsystem}'`));

  assert.match(source, /metaengine\.browser-startup-subsystem\.v1/);
  assert.match(source, /SUBSYSTEM_READY/);
  assert.match(source, /SUBSYSTEM_DEGRADED/);
  const settle = source.indexOf('soak_startup_resource_baseline_unsettled');
  const handleBaseline = source.indexOf('$handlesBefore =');
  assert.ok(settle >= 0 && handleBaseline > settle, 'handle baseline must follow startup settle proof');
});

test('activation handle budget remains strict and failure artifacts keep measured resource evidence', () => {
  assert.match(source, /\[int64\]\$MaxHandleGrowth = 24/);
  const captured = source.indexOf('resource_budget_evidence_captured');
  const handleBudget = source.indexOf('soak_handle_growth_budget_exceeded');
  assert.ok(captured >= 0 && handleBudget > captured, 'resource evidence must be persisted before budget enforcement');
  assert.match(source, /handle_growth_budget/);
  assert.match(source, /working_set_growth_budget_bytes/);
  assert.match(source, /activation_latency_p95_budget_ms/);
});
