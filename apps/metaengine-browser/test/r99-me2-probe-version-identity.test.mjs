import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('R99 read-only Browser probe reports source version without mutating SQLite metadata', () => {
  const store = read('me2-daemon/store.ts');
  const daemon = read('me2-daemon/index.ts');

  assert.match(store, /meta:\s*\{\s*version:\s*getMeta\("version"\)\s*\?\?\s*VERSION/);
  assert.match(daemon, /if \(!PROBE_MODE\) \{\s*setMeta\("boot", BOOT_TS\);\s*setMeta\("version", VERSION\);\s*\}/s);
  assert.match(daemon, /browser_probe:\s*PROBE_MODE \? PROBE_POLICY : null/);
  assert.match(daemon, /PROBE_MODE \? \{ \.\.\.state, browser_probe: PROBE_POLICY \} : state/);
});

test('R99 Browser probe version fallback grants no model or command authority', () => {
  const daemon = read('me2-daemon/index.ts');
  for (const contract of [
    /read_only:\s*true/,
    /model_execution_enabled:\s*false/,
    /provider_api_enabled:\s*false/,
    /agentchat_mutation_enabled:\s*false/,
    /scheduler_authority:\s*false/,
    /browser_actuation_authority:\s*false/,
    /command_mutation_enabled:\s*false/,
    /token_mutation_enabled:\s*false/,
    /authority_effect:\s*false/,
  ]) assert.match(daemon, contract);
});
