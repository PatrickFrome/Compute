import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SECONDARY_DIAGNOSTIC_REFUSAL_SCHEMA,SECONDARY_DIAGNOSTIC_REFUSAL_EXIT_CODE,
  secondaryDiagnosticRefusal} from '../src/secondary-diagnostic-refusal.mjs';

test('secondary singleton denial is an exact nonzero refusal and cannot be a success',()=>{
  assert.equal(SECONDARY_DIAGNOSTIC_REFUSAL_EXIT_CODE,6);
  const row=secondaryDiagnosticRefusal({argv:['--metaengine-single-instance-probe'],
    version:'0.7.0-dev.1107139874575.1'});
  assert.equal(row.schema,SECONDARY_DIAGNOSTIC_REFUSAL_SCHEMA);
  assert.equal(row.state,'PRIMARY_INSTANCE_REQUIRED');
  for(const field of [
    'primary_instance','original_primary_terminated','browser_runtime_started',
    'network_started','owner_bootstrap_started','submit_effect_attempted',
    'automatic_retry_allowed','authority_effect'
  ])assert.equal(row[field],false,field);
  assert.equal(row.requested_probe,'--metaengine-single-instance-probe');
});
test('physical SelfUpdate test demands exit 6 and validates all secondary refusal fences',()=>{
  const source=readFileSync(new URL('./self-update-fast-physical.ps1',import.meta.url),'utf8');
  assert.match(source,/Wait-CapturedProcessOrThrow -Capture \$second -TimeoutMs 5000 -Label 'singleton_secondary' -ExpectedExitCode 6/);
  assert.match(source,/\$exitCode -ne \$ExpectedExitCode/);
  assert.match(source,/\$secondRow\.schema -ne 'metaengine\.browser\.secondary-diagnostic-refusal\.v1'/);
  assert.match(source,/\$secondRow\.state -ne 'PRIMARY_INSTANCE_REQUIRED'/);
  for(const field of [
    'primary_instance','original_primary_terminated','browser_runtime_started',
    'network_started','owner_bootstrap_started','submit_effect_attempted',
    'automatic_retry_allowed','authority_effect'
  ])assert.ok(source.includes('$secondRow.'+field+' -ne $false'),field);
  // Secondary diagnostic denial is emitted on console.error (stderr).
  // Stdout must never be accepted as its refusal proof.
  const entry=readFileSync(new URL('../src/main-entry.mjs',import.meta.url),'utf8');
  assert.match(entry,/console\.error\(JSON\.stringify\(secondaryDiagnosticRefusal\(/);
  assert.match(source,/\$secondRow\s*=\s*Read-LastJsonLine\s+\$secondErr/);
  assert.doesNotMatch(source,/\$secondRow\s*=\s*Read-LastJsonLine\s+\$secondOut/);
  assert.match(source,/singleton_secondary_displaced_primary/);
  assert.match(source,/singleton_secondary_refusal_invalid/);
});
