import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/supervisor-lifecycle-runtime-core.mjs', import.meta.url), 'utf8');

test('supervisor lifecycle exposes no fixed useful-work cycle budget', () => {
  assert.doesNotMatch(source, /AUTO_ROLLOVER_CYCLES/);
  assert.doesNotMatch(source, /MAX_CYCLES_PER_EPOCH/);
  assert.doesNotMatch(source, /maxCyclesPerEpoch\s*:/);
  assert.match(source, /auto_rollover_cycles:\s*null/);
  assert.match(source, /work_cycle_limit:\s*null/);
  assert.match(source, /automatic_rollover_cycle_limit_enabled:\s*false/);
  assert.match(source, /external_confirmation_required_for_continuation:\s*false/);
});

test('lifecycle does not synthesize trusted rollover authority from a deferred page-derived reason', () => {
  assert.doesNotMatch(source, /autoReleaseDeterministicRollover/);
  assert.doesNotMatch(source, /approveRollover\(/);
  assert.match(source, /LIMIT_RE\.test[\s\S]*?requestRollover\('CHATGPT_CONVERSATION_LIMIT_HINT'\)/);
  assert.match(source, /if \(ks\.state === 'ROLLOVER_REQUIRED'\) await this\.#rollover\(\)/);
});

test('terminal continuation remains autonomous but effect retries stay fenced elsewhere', () => {
  assert.match(source, /await this\.#ensureContinuousWake\(\)/);
  assert.match(source, /const prepared = await this\.#keepalive\.prepareNextWake\(\)/);
  assert.match(source, /if \(prepared\?\.ok\) await this\.#sendWake\(prepared\)/);
  assert.doesNotMatch(source, /rollover_deferred[\s\S]*?#rollover\(\)/);
});
