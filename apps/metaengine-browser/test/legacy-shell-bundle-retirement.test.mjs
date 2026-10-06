import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const main = await readFile(path.join(appRoot, 'src', 'main.mjs'), 'utf8');
const builder = JSON.parse(await readFile(path.join(appRoot, 'electron-builder.test.json'), 'utf8'));

test('deprecated renderer bundle is absent from source and package inputs', async () => {
  await assert.rejects(access(path.join(appRoot, 'ui')), (error) => error?.code === 'ENOENT');
  assert.equal(builder.files.includes('ui/**/*'), false);
  assert.doesNotMatch(main, /metaengine-dark-workspace-v2|dark-workspace\.css|metaengine:\/\/shell\/|LEGACY_RECOVERY|UI_ROOT/);
});

test('packaged ME2 is the only product UI and recovery is fail-closed', () => {
  assert.match(main, /let primaryShellMode = 'FAIL_CLOSED_RECOVERY'/);
  assert.match(main, /primaryShellMode = 'ME2_PRIMARY'/);
  assert.match(main, /metaengine:\/\/recovery\/\?reason=ME2_INTEGRATION_DISABLED/);
  assert.match(main, /metaengine:\/\/recovery\/\?reason=ME2_PRIMARY_DEGRADED/);
  assert.match(main, /metaengine:\/\/recovery\/\?reason=ME2_PRIMARY_LOAD_FAILED/);
  assert.match(main, /METAENGINE_FAIL_CLOSED_RECOVERY_PROTOCOL/);
  assert.match(main, /deprecated_shell_bundle_present: false/);
  assert.match(main, /recovery_surface_authority: false/);
});

test('generated recovery document exposes no execution or network controls', () => {
  const start = main.indexOf('function failClosedRecoveryDocument');
  const end = main.indexOf('async function registerRecoveryProtocol', start);
  assert.ok(start >= 0 && end > start);
  const source = main.slice(start, end);
  assert.match(source, /data-metaengine-recovery="fail-closed"/);
  assert.match(source, /No execution, scheduling, browser-control, provider, retry, or update controls/);
  assert.match(source, /default-src 'none'/);
  assert.match(source, /form-action 'none'/);
  assert.doesNotMatch(source, /<script|<button|<form|<input|fetch\s*\(|WebSocket|EventSource|metaengineClient|metaengineShell/i);
});

test('metaengine recovery protocol is GET-only and serves no asset namespace', () => {
  const start = main.indexOf('async function registerRecoveryProtocol');
  const end = main.indexOf('function configureUserSession', start);
  assert.ok(start >= 0 && end > start);
  const source = main.slice(start, end);
  assert.match(source, /url\.hostname !== 'recovery' \|\| url\.pathname !== '\/'/);
  assert.match(source, /request\.method !== 'GET'/);
  assert.doesNotMatch(source, /readFile|app\.js|app\.css|dark-workspace|index\.html/);
});
