import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

test('test build exposes the visible development console surfaces', () => {
  for (const id of ['devConsole', 'runSelfTest', 'dpState', 'gatewayState', 'securityState', 'selfTest', 'events']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(index, /Development Browser <b>TEST<\/b>/);
  assert.match(app, /TEST_RUN_SELF_CHECK/);
  assert.match(app, /TEST_TOGGLE_CONSOLE/);
  assert.match(app, /TEST_CLEAR_EVENTS/);
});

test('diagnostics surface keeps advisory and execution authority visibly false', () => {
  assert.match(main, /advisory_evidence_network_dispatch === false/);
  assert.match(main, /advisory_evidence_browser_authority === false/);
  assert.match(main, /advisory_evidence_promotion_authority === false/);
  assert.match(main, /verification_sandbox_execution === false/);
  assert.match(main, /direct_promote_current === false/);
});

test('test console does not add remote eval or debug-port backdoors', () => {
  for (const source of [main, app]) {
    assert.doesNotMatch(source, /executeJavaScript|Runtime\.evaluate|new Function|\beval\s*\(|--remote-debugging-port|--no-sandbox/);
  }
});
