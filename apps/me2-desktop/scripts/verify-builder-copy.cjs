#!/usr/bin/env node
/**
 * verify-builder-copy — THE physical proof of the R77 fix mechanism.
 *
 * electron-builder's createFilter() (app-builder-lib/out/util/filter.js) hard-drops
 * the ROOT node_modules of every copied directory set:
 *     if (relative === "node_modules") return false;
 * Confirmed present in 26.15.7 AND 26.16.1 (latest stable as of 2026-09-25).
 * This script builds a real fixture app with electron-builder --dir and asserts:
 *   1. WITHOUT the explicit node_modules rule → resources/me2-ui/node_modules is
 *      ABSENT (documents the toolchain defect),
 *   2. WITH the explicit second rule (our electron-builder.yml) → node_modules
 *      SURVIVES (documents the fix).
 * Exit 0 only when both facts hold. Exit≠0 = the packaging contract is broken.
 */
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, cpSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');

const scriptDir = __dirname;
const BUILDER_VERSION = process.env.ME2_EB_VERSION || '26.16.1';

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.stderr || r.stdout}`.slice(0, 2000));
  }
  return r;
}

function makeFixture(root, withNodeModulesRule) {
  // minimal electron app
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'eb-copy-fixture', productName: 'EB Copy Fixture', version: '1.0.0', main: 'main.js' }, null, 2),
  );
  writeFileSync(join(root, 'main.js'), `const {app}=require('electron');app.whenReady().then(()=>app.quit());\n`);
  // fixture "standalone UI" with node_modules at the ROOT of the copy set
  const ui = join(root, 'me2-ui-dist');
  mkdirSync(join(ui, 'node_modules', 'next'), { recursive: true });
  writeFileSync(join(ui, 'server.js'), 'process.exit(0);\n');
  writeFileSync(join(ui, 'node_modules', 'next', 'package.json'), JSON.stringify({ name: 'next', version: '0.0.0-fixture' }));
  writeFileSync(join(ui, 'node_modules', 'next', 'index.js'), 'module.exports=1;\n');
  const extra = withNodeModulesRule
    ? [{ from: 'me2-ui-dist/node_modules', to: 'me2-ui/node_modules', filter: ['**/*'] }]
    : [];
  writeFileSync(
    join(root, 'eb.json'),
    JSON.stringify(
      {
        appId: 'fixture.copy',
        productName: 'EB Copy Fixture',
        asar: true,
        directories: { output: 'out' },
        files: ['main.js', 'package.json'],
        electronVersion: process.env.ME2_EB_ELECTRON_VERSION || '44.4.5',
        extraResources: [{ from: 'me2-ui-dist', to: 'me2-ui', filter: ['**/*'] }, ...extra],
      },
      null,
      2,
    ),
  );
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'eb-copy-probe-'));
  const results = {};
  try {
    for (const variant of ['without-rule', 'with-rule']) {
      const root = join(work, variant);
      mkdirSync(root, { recursive: true });
      makeFixture(root, variant === 'with-rule');
      sh('npx', ['--yes', `electron-builder@${BUILDER_VERSION}`, '--dir', '--config', 'eb.json'], { cwd: root, env: { ...process.env, ELECTRON_BUILDER_CACHE: join(work, 'cache') } });
      const res = join(root, 'out', 'linux-unpacked', 'resources', 'me2-ui');
      // On Windows/other the unpacked dir name differs; find it honestly:
      let target = res;
      if (!existsSync(target)) {
        const outDir = join(root, 'out');
        const unpacked = readdirSync(outDir).find((n) => n.endsWith('-unpacked'));
        target = unpacked ? join(outDir, unpacked, 'resources', 'me2-ui') : res;
      }
      results[variant] = {
        serverJs: existsSync(join(target, 'server.js')),
        nodeModules: existsSync(join(target, 'node_modules')),
        nextPkg: existsSync(join(target, 'node_modules', 'next', 'package.json')),
      };
    }
    const defectDocumented = results['without-rule'].nodeModules === false;
    const fixProven = results['with-rule'].nodeModules === true && results['with-rule'].nextPkg === true && results['with-rule'].serverJs === true;
    console.log('[verify-builder-copy]', JSON.stringify(results, null, 2));
    if (!defectDocumented) {
      console.error('[verify-builder-copy] TOOLCHAIN BEHAVIOR CHANGED: root node_modules no longer dropped — revisit the extraResources contract (keep the rule: it is harmless).');
      process.exit(2);
    }
    if (!fixProven) {
      console.error('[verify-builder-copy] FIX NOT PROVEN: explicit node_modules rule did not survive the copy.');
      process.exit(1);
    }
    console.log('[verify-builder-copy] OK: defect documented, explicit-rule fix proven physically.');
    rmSync(work, { recursive: true, force: true });
  } catch (err) {
    console.error('[verify-builder-copy] FAIL:', err.message);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {}
    process.exit(1);
  }
}

main();
