#!/usr/bin/env node
/**
 * pack-me2-ui — pack the Mission Control Next standalone into me2-ui-dist/ for
 * this app (R78 zero-based; same release contract as the rail's packer:
 * server.js + .next(+static) + public + trimmed node_modules + manifest).
 * Fail-loud: exit≠0 on any contract breach (R77: config without artifact is a
 * dead letter — the artifact itself is the contract).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_APP = resolve(APP, '..', 'me2-ui');
const STANDALONE = join(UI_APP, '.next', 'standalone');
const DIST = join(APP, 'me2-ui-dist');
const SCHEMA = 'me2.ui-bundle-manifest.v1';

function fail(msg) {
  console.error(`[pack-me2-ui] FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(STANDALONE, 'server.js'))) {
  fail(`${join(STANDALONE, 'server.js')} отсутствует — сначала \`bun run build\` в apps/me2-ui`);
}
const buildId = readFileSync(join(STANDALONE, '.next', 'BUILD_ID'), 'utf8').trim();
if (!/^[A-Za-z0-9_-]{6,64}$/.test(buildId)) fail(`BUILD_ID в неожиданном формате: ${buildId.slice(0, 20)}…`);
if (!existsSync(join(STANDALONE, '.next', 'static'))) fail('standalone/.next/static отсутствует — сборка неполна');
if (!existsSync(join(STANDALONE, 'node_modules'))) fail('standalone/node_modules отсутствует — Next.js не уедет в установщик (R77 урок)');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(STANDALONE, DIST, { recursive: true, dereference: false });

const pkgPath = join(DIST, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = pkg.name || 'me2-ui';
pkg.scripts = { ...(pkg.scripts || {}), start: 'NODE_ENV=production server.js' };
delete pkg.scripts.dev;
delete pkg.scripts.build;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const dir = stack.pop();
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else total += st.size;
    }
  }
  return total;
}

let gitSha = process.env.ME2_BUILD_SHA || 'unknown';
const manifest = {
  schema: SCHEMA,
  ui_version: pkg.version || '0.0.0',
  build_id: buildId,
  git_sha: gitSha,
  built_at: new Date().toISOString(),
  entry: 'server.js',
  health_path: '/',
  fallback: 'daemon GET /ui (R50)',
  node_modules_included: existsSync(join(DIST, 'node_modules')),
  size_bytes: dirSize(DIST),
};
manifest.content_sha256 = createHash('sha256').update(JSON.stringify({ ...manifest, size_bytes: 0 }) + buildId).digest('hex');
writeFileSync(join(DIST, 'me2-ui-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const rel of ['server.js', 'package.json', '.next/BUILD_ID', '.next/static', 'me2-ui-manifest.json', 'node_modules']) {
  if (!existsSync(join(DIST, rel))) fail(`в me2-ui-dist отсутствует ${rel}`);
}
console.log(`[pack-me2-ui] OK: build_id=${buildId} size=${(manifest.size_bytes / 1048576).toFixed(1)} MiB node_modules=${manifest.node_modules_included}`);
