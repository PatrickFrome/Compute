#!/usr/bin/env node
/**
 * verify-installed-bundle — post-install (post-pack) verification of the deployed
 * client. Checks the four R77 blind spots that all-green CI missed:
 *   1. exact SHA: me2-ui-manifest.json git_sha === expected (arg/env),
 *   2. dependencies inside the package: resources/me2-ui/node_modules (+ next),
 *   3. HTML + JS resources: server.js, .next/BUILD_ID, static assets present,
 *   4. runnable through the PACKAGED electron in node mode:
 *        ELECTRON_RUN_AS_NODE=1 <packaged electron> resources/me2-ui/server.js probe
 *      (Windows: <install>\METAENGINE Desktop.exe; Linux --dir: out/*-unpacked/electron)
 * Exit 0 only if everything holds. This is the test that would have caught R77.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { probeInstalledUi } from './probe-installed-ui.mjs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const appRootArgIdx = args.indexOf('--app');
const appRoot = appRootArgIdx >= 0 ? resolve(args[appRootArgIdx + 1]) : process.cwd();
const expectedSha = args.find((a) => a.startsWith('--sha='))?.slice(6) ?? process.env.ME2_EXPECTED_SHA ?? null;
const resourcesDir = join(appRoot, 'resources');
const uiDir = join(resourcesDir, 'me2-ui');

function fail(msg) {
  console.error(`[verify-installed-bundle] FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(uiDir)) fail(`me2-ui отсутствует в ${resourcesDir} — Mission Control не в установщике (R77)`);
for (const rel of ['server.js', 'package.json', join('.next', 'BUILD_ID')]) {
  if (!existsSync(join(uiDir, rel))) fail(`me2-ui/${rel} отсутствует`);
}
const nm = join(uiDir, 'node_modules');
if (!existsSync(nm)) fail('me2-ui/node_modules отсутствует — MODULE_NOT_FOUND гарантирован (точный дефект R77)');
if (!existsSync(join(nm, 'next', 'package.json'))) fail('node_modules/next отсутствует — Next.js не доехал');

const manifest = JSON.parse(readFileSync(join(uiDir, 'me2-ui-manifest.json'), 'utf8'));
if (manifest.schema !== 'me2.ui-bundle-manifest.v1') fail('manifest schema invalid');
if (expectedSha && manifest.git_sha !== expectedSha) fail(`sha mismatch: bundle=${manifest.git_sha} expected=${expectedSha}`);

// static assets present (HTML/JS plane)
const staticDir = join(uiDir, '.next', 'static');
if (!existsSync(staticDir) || readdirSync(staticDir).length === 0) fail('.next/static пуст — UI не отрендерится');

// runnable via packaged electron as node
const candidates = [];
for (const name of readdirSync(appRoot)) {
  if (name.endsWith('-unpacked') || /\.exe$/i.test(name)) candidates.push(join(appRoot, name));
}
const { accessSync, constants: fsConstants } = await import('node:fs');
const isExecFile = (p) => {
  try {
    return statSync(p).isFile() && Boolean(accessSync(p, fsConstants.X_OK) ?? true);
  } catch {
    return false;
  }
};
const topLevelExecs = existsSync(appRoot) ? readdirSync(appRoot).map((n) => join(appRoot, n)).filter(isExecFile) : [];
const electronBin =
  process.env.ME2_PACKAGED_ELECTRON ??
  [
    join(appRoot, 'electron'),
    join(appRoot, 'METAENGINE Desktop.exe'),
    ...candidates.flatMap((c) => (existsSync(c) && statIsFile(c) ? [c] : existsSync(join(c, 'electron')) ? [join(c, 'electron')] : [])),
    ...topLevelExecs,
  ].find((p) => existsSync(p));
if (!electronBin) fail('packaged electron binary не найден — нечем проверить запуск');

try {
  if (readFileSync(join(uiDir, '.next', 'BUILD_ID'), 'utf8').trim() !== manifest.build_id) fail('build_id mismatch');
  function contentBytes(dir) {
    return readdirSync(dir).reduce((sum, name) => {
      const full = join(dir, name);
      if (full === join(uiDir, 'me2-ui-manifest.json')) return sum;
      const stat = statSync(full);
      return sum + (stat.isDirectory() ? contentBytes(full) : stat.size);
    }, 0);
  }
  const size = contentBytes(uiDir);
  if (size !== manifest.size_bytes) fail(`installed size mismatch: ${size} != ${manifest.size_bytes}`);
  const proof = await probeInstalledUi({ executable: electronBin, uiDir });
  console.log(JSON.stringify({ ok: true, git_sha: manifest.git_sha, build_id: manifest.build_id, size_bytes: size, ...proof }));
} catch (error) { fail(error.message); }

function statIsFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
