import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../src/main-entry.mjs'), 'utf8');

test('ambiguous updated successor boot stays live and cannot qualify', () => {
  assert.match(source, /METAENGINE_SELF_UPDATE_HOLD_REASON = 'SUCCESSOR_RECEIPT_AMBIGUOUS'/);
  assert.match(source, /recovery_state: 'LIVE_HOLD'/);
  assert.match(source, /automatic_retry_allowed: false/);
  assert.match(source, /const qualificationRequested = \(updatedLaunch && Boolean\(updateHandoff\)\)/);
  assert.match(source, /\|\| \(!updatedLaunch && resumeSuccessorQualification\)/);
  assert.doesNotMatch(source, /self-update-successor-boot-failure[\s\S]{0,900}app\.exit\(7\)/);
});

test('Browser runtime import failure preserves host recovery plane', () => {
  assert.match(source, /METAENGINE_BROWSER_RUNTIME_HOLD_REASON = 'RUNTIME_LOAD_ERROR'/);
  assert.match(source, /recovery_state: 'HOST_ALIVE'/);
  assert.match(source, /host_resilience_bootstrapped: true/);
  assert.doesNotMatch(source, /browserRuntimeLoadError[\s\S]{0,1200}app\.exit\(1\)/);
});
