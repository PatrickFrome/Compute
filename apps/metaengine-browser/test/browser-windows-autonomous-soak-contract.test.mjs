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


test('activation evidence records distribution shape instead of a lone p95 sample', () => {
  for (const field of [
    'activation_latency_sample_count',
    'activation_latency_min_ms',
    'activation_latency_p50_ms',
    'activation_latency_p90_ms',
    'activation_latency_p95_ms',
    'activation_latency_p99_ms',
    'activation_latency_max_ms',
    'activation_latency_mean_ms',
    'concurrent_activation_individual_p95_ms',
  ]) assert.match(source, new RegExp(field));

  const sort = source.indexOf('$latencySorted = @($activationLatencies | Sort-Object)');
  const p50 = source.indexOf('$p50Index =', sort);
  const p90 = source.indexOf('$p90Index =', p50);
  const p95 = source.indexOf('$p95Index =', p90);
  const p99 = source.indexOf('$p99Index =', p95);
  const mean = source.indexOf('Measure-Object -Average', p99);
  const persist = source.indexOf('activation_latency_sample_count', mean);
  const enforce = source.indexOf('soak_activation_p95_budget_exceeded', persist);
  assert.ok(sort >= 0 && p50 > sort && p90 > p50 && p95 > p90 && p99 > p95);
  assert.ok(mean > p99 && persist > mean && enforce > persist, 'distribution evidence must persist before the unchanged p95 gate');
});


test('activation evidence fingerprints the hosted measurement environment without changing the gate', () => {
  for (const field of [
    'measurement_runner_os',
    'measurement_runner_arch',
    'measurement_image_os',
    'measurement_image_version',
    'measurement_processor_identifier',
    'measurement_processor_count',
  ]) assert.match(source, new RegExp(field));

  const boundary = source.indexOf('activation_latency_measurement_boundary');
  const fingerprint = source.indexOf('measurement_runner_os', boundary);
  const gate = source.indexOf('soak_activation_p95_budget_exceeded', fingerprint);
  assert.ok(boundary >= 0 && fingerprint > boundary && gate > fingerprint);
  assert.match(source, /\[Environment\]::ProcessorCount/);
});
