#!/usr/bin/env node
/**
 * ME2 UI packer (R52, фаза C7 — план electron-rebuild §7).
 *
 * Собирает самодостаточный каталог me2-ui-dist/ из production-сборки Next
 * (output:"standalone"): server.js + .next(+static) + public + обрезанные node_modules.
 * Формат = контракт me2-ui-host браузера (R50): каталог с package.json, спавн `bun run start`,
 * health-probe GET / → text/html; при отсутствии каталога — честный фолбэк GET /ui.
 *
 * Паттерн (research/2026/r52-analogues.md): «один SHA → один релиз» (VS Code), каталог как
 * релиз (code-server), манифест версии внутри каталога (Chromium resources.pak).
 *
 * Запуск: node scripts/pack-me2-ui.mjs  (после `bun run build`).
 * Выход: me2-ui-dist/ + me2-ui-manifest.json; exit≠0 при нарушении контракта сборки.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const STANDALONE = join(ROOT, '.next', 'standalone');
const DIST = join(ROOT, 'me2-ui-dist');
const SCHEMA = 'me2.ui-bundle-manifest.v1';

function fail(msg) { console.error(`[pack-me2-ui] FAIL: ${msg}`); process.exit(1); }

// 1) предусловия сборки (честный фейл, не тихий)
if (!existsSync(join(STANDALONE, 'server.js'))) fail('.next/standalone/server.js отсутствует — сначала `bun run build`');
const buildIdPath = join(STANDALONE, '.next', 'BUILD_ID');
if (!existsSync(buildIdPath)) fail('.next/standalone/.next/BUILD_ID отсутствует — сборка неполна');
const staticDir = join(STANDALONE, '.next', 'static');
if (!existsSync(staticDir)) fail('.next/standalone/.next/static отсутствует — build-скрипт не скопировал static');
const buildId = readFileSync(buildIdPath, 'utf8').trim();
if (!/^[A-Za-z0-9_-]{6,64}$/.test(buildId)) fail(`BUILD_ID в неожиданном формате: ${buildId.slice(0, 20)}…`);

// 2) чистая сборка каталога
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(STANDALONE, DIST, { recursive: true, dereference: false });

// 3) контракт ui-host: package.json со скриптом start (пути standalone сдвигаются на корень каталога)
const pkgPath = join(DIST, 'package.json');
if (!existsSync(pkgPath)) fail('standalone не содержит package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = pkg.name || 'me2-ui';
pkg.scripts = { ...(pkg.scripts || {}), start: 'NODE_ENV=production bun server.js' };
delete pkg.scripts.dev; delete pkg.scripts.build; delete pkg.scripts.lint;
delete pkg.scripts['db:push']; delete pkg.scripts['db:generate']; delete pkg.scripts['db:migrate']; delete pkg.scripts['db:reset'];
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 4) манифест (версия/SHA/размер) — версионируется вместе с релизом (Chromium-паттерн)
function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const dir = stack.pop();
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push(full);
      else total += st.size;
    }
  }
  return total;
}

let gitSha = process.env.ME2_BUILD_SHA || 'unknown';
if (!gitSha || gitSha === 'unknown') {
  try { gitSha = readFileSync(join(ROOT, '.git-sha'), 'utf8').trim() || 'unknown'; } catch { /* вне CI — ок */ }
}

const manifest = {
  schema: SCHEMA,
  ui_version: pkg.version || '0.0.0',
  build_id: buildId,
  git_sha: gitSha,
  built_at: new Date().toISOString(),
  entry: 'server.js',
  start_script: 'NODE_ENV=production bun server.js',
  health_path: '/',
  fallback: 'GET /ui (daemon, R50)',
  size_bytes: dirSize(DIST),
};
manifest.content_sha256 = createHash('sha256')
  .update(JSON.stringify({ ...manifest, size_bytes: 0 }) + buildId)
  .digest('hex');
writeFileSync(join(DIST, 'me2-ui-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 5) верификация контракта (пост-проверка)
for (const rel of ['server.js', 'package.json', '.next/BUILD_ID', '.next/static', 'me2-ui-manifest.json']) {
  if (!existsSync(join(DIST, rel))) fail(`в me2-ui-dist отсутствует ${rel}`);
}
const finalPkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!finalPkg.scripts?.start || !/server\.js$/.test(finalPkg.scripts.start)) fail('package.json start не указывает на server.js');

console.log(`[pack-me2-ui] OK: me2-ui-dist ready (build_id=${buildId}, size=${(manifest.size_bytes / 1048576).toFixed(1)} MiB)`);
