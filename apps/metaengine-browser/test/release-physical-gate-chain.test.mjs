import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const readWorkflow = (name) => fs.readFileSync(path.join(repoRoot, '.github', 'workflows', name), 'utf8');

test('verified dev release is transitively fenced by exact-SHA bootstrap autostart physical proof', () => {
  const bootstrap = readWorkflow('metaengine-browser-bootstrap-autostart-e2e.yml');
  const fast = readWorkflow('metaengine-browser-self-update-fast-e2e.yml');
  const publisher = readWorkflow('metaengine-browser-fast-autorelease.yml');

  // Any release-chain workflow mutation must produce a bootstrap run for the same
  // exact SHA. App/test mutations already trigger this workflow through apps/**.
  assert.match(bootstrap, /metaengine-browser-bootstrap-autostart-e2e\.yml/);
  assert.match(bootstrap, /metaengine-browser-self-update-fast-e2e\.yml/);
  assert.match(bootstrap, /metaengine-browser-fast-autorelease\.yml/);

  assert.match(fast, /actions:\s*read/);
  assert.match(fast, /metaengine-browser-bootstrap-autostart-e2e\.yml/);
  assert.match(fast, /head_sha="\$EXPECTED_SHA"/);
  assert.match(fast, /exact_bootstrap_autostart_failed/);
  assert.match(fast, /exact_bootstrap_autostart_success_missing/);
  assert.match(fast, /needs:\s*\n\s*- contract\s*\n\s*- windows-published-n-to-one-build-target/);

  assert.match(publisher, /metaengine-browser-self-update-fast-e2e\.yml/);
  assert.match(publisher, /head_sha="\$EXPECTED_SHA"/);
  assert.match(publisher, /exact_fast_e2e_success_missing/);
});
