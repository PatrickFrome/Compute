import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanSecurityStaticGate } from '../scripts/security-static-gate.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-security-gate-'));
  for (const required of [
    'src/verification-sandbox-plan.cjs',
    'src/development-plane-worker.cjs',
    'smoke/dp/main.cjs',
  ]) {
    files[required] ??= 'module.exports = Object.freeze({ authority_effect: false });\n';
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return root;
}

test('current production Browser source satisfies the executable static security gate', async () => {
  const result = await scanSecurityStaticGate({ rootDir: APP_ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.violation_count, 0);
  assert.equal(result.tests_excluded_from_production_scan, true);
  assert.equal(result.production_process_primitives_globally_forbidden, false);
  assert.equal(result.authority_effect, false);
});

test('production renderer escape hatch is a real failing violation', async () => {
  const root = await fixture({
    'src/main.mjs': "contents.executeJavaScript('document.body.textContent')\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((row) => [row.file, row.rule]), [
    ['src/main.mjs', 'EXECUTE_JAVASCRIPT'],
  ]);
});

test('test-only diagnostic JavaScript evaluation does not redefine the production boundary', async () => {
  const root = await fixture({
    'test/diagnostic.test.mjs': "contents.executeJavaScript('document.fonts.ready')\n",
    'src/main.mjs': 'export const safe = true;\n',
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test('effect-poor sandbox and Development Plane worker boundaries reject process actuation primitives', async () => {
  const root = await fixture({
    'src/verification-sandbox-plan.cjs': "const { spawn } = require('node:child_process'); spawn('cmd');\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, false);
  const rules = new Set(result.violations.map((row) => row.rule));
  assert.equal(rules.has('CHILD_PROCESS_IMPORT'), true);
  assert.equal(rules.has('SPAWN_PRIMITIVE'), true);
});

test('legitimate Sentinel process authority is not accidentally banned by a repo-wide child_process rule', async () => {
  const root = await fixture({
    'src/browser-sentinel.mjs': "import { spawn } from 'node:child_process'; export const launch = () => spawn('browser.exe');\n",
  });
  const result = await scanSecurityStaticGate({ rootDir: root });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});
