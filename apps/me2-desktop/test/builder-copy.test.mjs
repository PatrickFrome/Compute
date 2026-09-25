import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

test('builder copy mechanism: electron-builder must NOT drop root node_modules under our explicit rule', { timeout: 300000 }, (t) => {
  // Stage-2 physical probe — opt-in: ME2_RUN_COPY_PROBE=1 (CI packaging jobs set it;
  // default unit runs stay fast and honestly SKIP, never silent-green).
  if (process.env.ME2_RUN_COPY_PROBE !== '1') {
    t.skip('physical builder copy probe not enabled');
    console.log('[builder-copy] SKIP (opt-in): set ME2_RUN_COPY_PROBE=1 to run the physical electron-builder copy proof');
    assert.equal(existsSync(join(APP, 'scripts', 'verify-builder-copy.cjs')), true);
    return;
  }
  const r = spawnSync(process.execPath, [join(APP, 'scripts', 'verify-builder-copy.cjs')], {
    encoding: 'utf8',
    timeout: 280000,
  });
  console.log(r.stdout);
  if (r.status === 2) {
    // toolchain behavior changed (bug fixed upstream) — keep rule, flag loudly
    console.warn('[builder-copy] TOOLCHAIN CHANGED — revisit extraResources contract');
    return;
  }
  assert.equal(r.status, 0, `verify-builder-copy failed:\n${r.stderr || r.stdout}`);
});
