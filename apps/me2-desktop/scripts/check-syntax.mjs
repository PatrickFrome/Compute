#!/usr/bin/env node
/**
 * check-syntax — npm run check: node --check over every JS entry in the app.
 * From-scratch client: the check list is derived from the filesystem, not hand-maintained.
 */
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist-desktop' || name === 'me2-ui-dist' || name === '.next') continue;
      walk(full);
    } else if (/\.(mjs|cjs)$/.test(name)) {
      files.push(full);
    }
  }
}
walk(join(APP, 'src'));
walk(join(APP, 'scripts'));
walk(join(APP, 'test'));

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`SYNTAX FAIL ${relative(APP, f)}\n${r.stderr}`);
  }
}
if (failed) {
  console.error(`[check-syntax] FAIL: ${failed} file(s)`);
  process.exit(1);
}
console.log(`[check-syntax] OK: ${files.length} files`);
