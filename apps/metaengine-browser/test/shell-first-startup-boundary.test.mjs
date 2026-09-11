import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../src/main.mjs');

async function source() {
  return fs.readFile(sourcePath, 'utf8');
}

test('local packaged shell is the only normal-start readiness boundary', async () => {
  const text = await source();
  const createAt = text.indexOf('async function createWindow()');
  const shellLoadAt = text.indexOf("await shellView.webContents.loadURL('metaengine://shell/')", createAt);
  const showAt = text.indexOf('windowRef.show()', shellLoadAt);
  const backgroundAt = text.indexOf('void bootstrapDegradableSubsystems()', showAt);
  assert.ok(createAt >= 0 && shellLoadAt > createAt, 'local shell load must exist inside createWindow');
  assert.ok(showAt > shellLoadAt, 'window must be shown only after the packaged local shell loaded');
  assert.ok(backgroundAt > showAt, 'degradable subsystem bootstrap must start only after the local shell is visible');
  assert.match(text.slice(createAt, shellLoadAt), /show:\s*false/);
  assert.match(text.slice(showAt, backgroundAt + 160), /remote_network_required:\s*false/);
  assert.match(text.slice(showAt, backgroundAt + 160), /fleet_state_required:\s*false/);
});

test('initial remote navigation and Fleet persistence cannot close a healthy local shell', async () => {
  const text = await source();
  const bootstrapAt = text.indexOf('async function bootstrapDegradableSubsystems()');
  const createWindowAt = text.indexOf('async function createWindow()', bootstrapAt);
  const bootstrap = text.slice(bootstrapAt, createWindowAt);
  assert.match(bootstrap, /runDegradableStartupStep\('USER_SESSION'/);
  assert.match(bootstrap, /createTab\('https:\/\/chatgpt\.com\/',\s*\{\s*select:\s*true,\s*load:\s*false\s*\}\)/);
  assert.match(bootstrap, /setImmediate\(\(\)\s*=>\s*\{[\s\S]*loadTab\(initialTab\.tab_id,\s*'https:\/\/chatgpt\.com\/'\)/);
  assert.match(bootstrap, /runDegradableStartupStep\('FLEET'/);
  assert.match(bootstrap, /fleet\s*=\s*null/);
  assert.doesNotMatch(bootstrap, /resetFailedWindow\(/);
});

test('startup retry remains process-live and fatal local-shell failure is user-visible', async () => {
  const text = await source();
  const retryAt = text.indexOf('function scheduleBrowserRuntimeRetry(error)');
  const resetAt = text.indexOf('function resetFailedWindow()', retryAt);
  const retry = text.slice(retryAt, resetAt);
  assert.match(retry, /timer_keeps_process_alive:\s*true/);
  assert.doesNotMatch(retry, /startupRetryTimer\.unref/);

  const presentAt = text.indexOf('async function presentBrowserStartupFailure(error)');
  const degradableAt = text.indexOf('async function runDegradableStartupStep', presentAt);
  const presenter = text.slice(presentAt, degradableAt);
  assert.match(presenter, /dialog\.showErrorBox/);
  assert.match(presenter, /metaengine-browser-startup-journal-v1\.json/);
  assert.match(presenter, /LOCAL_SHELL_START_FAILED/);
});

test('normal start no longer configures the persistent remote session before local shell creation', async () => {
  const text = await source();
  const startAfterReadyAt = text.indexOf('async function startAfterReady()');
  const startAfterHostAt = text.indexOf('async function startAfterHostResilience()', startAfterReadyAt);
  const block = text.slice(startAfterReadyAt, startAfterHostAt);
  assert.match(block, /if \(isDevelopmentPlaneSmoke \|\| isSmoke\) configureUserSession\(\)/);
  const normalWindowAt = block.indexOf('await createWindow()');
  const unconditionalConfigureAt = block.indexOf('\n  configureUserSession();');
  assert.ok(normalWindowAt >= 0);
  assert.equal(unconditionalConfigureAt, -1, 'persistent user session must not be a normal local-shell prerequisite');
});
