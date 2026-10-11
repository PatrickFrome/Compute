import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  secondaryDiagnosticRefusal,
  SECONDARY_DIAGNOSTIC_REFUSAL_SCHEMA,
  SECONDARY_DIAGNOSTIC_REFUSAL_EXIT_CODE,
} from '../src/secondary-diagnostic-refusal.mjs';

const FLAGS = [
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-client-goal-journal-probe',
  '--metaengine-single-instance-probe',
];

test('all exact secondary diagnostic modes produce explicit non-successful, inert readback', () => {
  assert.equal(SECONDARY_DIAGNOSTIC_REFUSAL_EXIT_CODE, 6);
  for (const requested_probe of FLAGS) {
    const result = secondaryDiagnosticRefusal({ argv: ['browser.exe', requested_probe], version: '0.7.0-dev.56.1' });
    assert.deepEqual(result, {
      schema: SECONDARY_DIAGNOSTIC_REFUSAL_SCHEMA,
      state: 'PRIMARY_INSTANCE_REQUIRED',
      requested_probe,
      process_version: '0.7.0-dev.56.1',
      primary_instance: false,
      original_primary_terminated: false,
      browser_runtime_started: false,
      network_started: false,
      owner_bootstrap_started: false,
      submit_effect_attempted: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
    assert.equal(Object.isFrozen(result), true);
  }
});

test('ambiguous, lookalike and missing diagnostic requests cannot claim primary authority', () => {
  for (const args of [
    [],
    ['--metaengine-version-probe=1'],
    ['--metaengine-version-probe','--metaengine-profile-probe'],
    ['--metaengine-client-goal-journal-probe-extra'],
    ['--metaengine-smoke'],
    ['--metaengine-installer-shutdown'],
  ]) {
    assert.throws(() => secondaryDiagnosticRefusal({argv:args,version:'0.7.0-dev.56.1'}), /secondary_diagnostic_request_invalid/);
  }
  for (const version of ['', null, 'x'.repeat(121)]) {
    assert.throws(() => secondaryDiagnosticRefusal({argv:FLAGS.slice(0,1),version}), /secondary_diagnostic_request_invalid/);
  }
});

test('only failed singleton acquisition emits secondary refusal before loading the Browser runtime', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const secondary = source.indexOf('} else if (!guard.primary) {');
  const diagnostic = source.indexOf('secondaryDiagnosticRefusal({', secondary);
  const exit = source.indexOf('app.exit(SECONDARY_DIAGNOSTIC_REFUSAL_EXIT_CODE)', diagnostic);
  const primary = source.indexOf('const prepareAdmittedPrimary = async () => {', diagnostic);
  assert.ok(secondary >= 0 && diagnostic > secondary && exit > diagnostic && primary > exit);
  const region = source.slice(secondary,primary);
  assert.doesNotMatch(region, /import\('\.\/main\.mjs'\)/);
  assert.doesNotMatch(region, /bootstrapPersistentLocalProvider\(/);
  assert.doesNotMatch(region, /requestSingleInstanceLock\(/);
  assert.doesNotMatch(region, /^\s*app\.quit\(\)/m);
  assert.match(region, /app\.exit\(0\)/, 'smoke and updater-successor retain their existing nonprobe path');
});
