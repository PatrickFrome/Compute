import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bun's store/module singleton and fetch guards must not cross test files.
// Node-only source tests use node:module APIs that Bun does not implement.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const bun = process.env.METAENGINE_TEST_BUN || (typeof Bun !== 'undefined' ? process.execPath : null);
if (!bun) throw new Error('daemon_tests_require_bun_or_METAENGINE_TEST_BUN');
const node = process.env.METAENGINE_TEST_NODE || 'node';
const root = mkdtempSync(join(tmpdir(), 'metaengine-daemon-tests-'));
const isolated = Object.fromEntries(['profile', 'temp', 'data', 'contour', 'repo'].map((name) => [name, join(root, name)]));
for (const path of Object.values(isolated)) mkdirSync(path, { recursive: true });
const baseEnv = {
  ...process.env,
  HOME: isolated.profile, USERPROFILE: isolated.profile, APPDATA: isolated.profile, LOCALAPPDATA: isolated.profile,
  TMP: isolated.temp, TEMP: isolated.temp, TMPDIR: isolated.temp,
  ME2_DATA_DIR: isolated.data, ME2_CONTOUR_HOME: isolated.contour, ME2_REPO_ROOT: isolated.repo,
  ME2_LOCK_FILE: join(root, 'test.lock'), METAENGINE_TEST_BUN: bun,
};
function freshEnv() {
  const caseRoot = mkdtempSync(join(root, 'case-'));
  const casePaths = Object.fromEntries(['profile', 'temp', 'data', 'contour', 'repo'].map((name) => [name, join(caseRoot, name)]));
  for (const path of Object.values(casePaths)) mkdirSync(path, { recursive: true });
  return {
    ...baseEnv,
    HOME: casePaths.profile, USERPROFILE: casePaths.profile, APPDATA: casePaths.profile, LOCALAPPDATA: casePaths.profile,
    TMP: casePaths.temp, TEMP: casePaths.temp, TMPDIR: casePaths.temp,
    ME2_DATA_DIR: casePaths.data, ME2_CONTOUR_HOME: casePaths.contour, ME2_REPO_ROOT: casePaths.repo,
    ME2_LOCK_FILE: join(caseRoot, 'test.lock'),
  };
}
function run(binary, args) {
  const result = spawnSync(binary, args, { cwd, env: freshEnv(), windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.error) process.stderr.write(`daemon_test_process_error:${result.error.code ?? result.error.message}\n`);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const files = readdirSync(join(cwd, 'test')).sort();
for (const name of files.filter((name) => name.endsWith('.test.ts'))) run(bun, ['test', join('test', name)]);
for (const name of files.filter((name) => name.endsWith('.test.mjs'))) run(node, ['--test', join('test', name)]);
