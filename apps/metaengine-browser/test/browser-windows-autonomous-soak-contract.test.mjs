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


test('activation latency boundary excludes post-ACK harness journal parsing', () => {
  const launch = source.indexOf('$activationStarted = [Diagnostics.Stopwatch]::StartNew()');
  const waitExit = source.indexOf('$second.WaitForExit(18000)', launch);
  const stop = source.indexOf('$activationStarted.Stop()', waitExit);
  const readAck = source.indexOf('$line = Get-Content $secondOut', stop);
  const journalRead = source.indexOf('$startup = Get-Content $journal -Raw | ConvertFrom-Json', readAck);
  const addLatency = source.indexOf('$activationLatencies.Add($activationElapsedMs)', journalRead);
  assert.ok(launch >= 0 && waitExit > launch && stop > waitExit, 'latency must span the secondary process lifetime');
  assert.ok(readAck > stop, 'stdout parsing must be outside the latency clock');
  assert.ok(journalRead > readAck, 'durable journal verification remains mandatory');
  assert.ok(addLatency > journalRead, 'latency is admitted only after exact journal verification succeeds');
  assert.match(source, /activation_latency_measurement_boundary/);
  assert.match(source, /SECONDARY_PROCESS_LAUNCH_TO_VALID_DURABLE_ACK_EXIT/);
  assert.doesNotMatch(source.slice(journalRead, addLatency), /\$activationStarted\.Stop\(\)/);
});


test('latency evidence partitions process startup, primary activation and durable ACK exit without relaxing SLO', () => {
  assert.match(source, /launch_requested_at/);
  assert.match(source, /process_started_at/);
  assert.match(source, /primary_activation_at/);
  assert.match(source, /process_exited_at/);
  assert.match(source, /launch_to_process_start_ms/);
  assert.match(source, /process_start_to_primary_activation_ms/);
  assert.match(source, /primary_activation_to_process_exit_ms/);
  assert.match(source, /activation_latency_samples/);
  assert.match(source, /activation_latency_p50_ms/);
  assert.match(source, /activation_latency_max_ms/);
  assert.match(source, /activation_latency_over_budget_count/);
  assert.match(source, /activation_latency_longest_consecutive_over_budget/);
  assert.match(source, /activation_process_start_to_primary_event_p95_ms/);
  assert.match(source, /activation_primary_event_to_secondary_exit_p95_ms/);
  assert.match(source, /activation_latency_phase_boundaries/);

  // Diagnostics explain a red gate; they never convert it to success.
  assert.match(source, /if \(\$p95Ms -gt \$ActivationP95BudgetMs\) \{ throw "soak_activation_p95_budget_exceeded/);
  assert.doesNotMatch(source, /ActivationP95BudgetMs\s*=\s*[2-9][0-9]{3,}/);
});
