import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('losing secondary pre-lock graph is read-only and excludes startup journal writer machinery', async () => {
  const entry = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const guardAt = entry.indexOf('const guard = acquirePrimaryInstance(app');
  const primaryAt = entry.indexOf('} else {', entry.indexOf('if (!guard.primary)'));
  assert.ok(guardAt >= 0 && primaryAt > guardAt);

  const preLock = entry.slice(0, guardAt);
  assert.doesNotMatch(preLock, /from ['"]\.\/browser-startup-observability\.mjs['"]/);
  assert.match(preLock, /from ['"]\.\/browser-startup-activation-readback\.mjs['"]/);
  assert.match(preLock, /from ['"]\.\/browser-primary-window-activation\.mjs['"]/);

  const writerImportAt = entry.indexOf("import('./browser-startup-observability.mjs')", primaryAt);
  assert.ok(writerImportAt > primaryAt, 'durable startup writer must load only after primary ownership');

  const readback = await fs.readFile(new URL('../src/browser-startup-activation-readback.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(readback, /durable-json-file|writeFile|rename\(|createHash|randomUUID|preserveCorrupt/i);
  assert.match(readback, /readFile\(target, 'utf8'\)/);
  assert.match(readback, /PRIMARY_ACTIVATION_ACK_EXACT/);

  const activation = await fs.readFile(new URL('../src/browser-primary-window-activation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(activation, /node:fs|node:crypto|durable-json|writeFile|rename\(/i);
  assert.match(activation, /activateExistingPrimaryWindow/);
  assert.match(activation, /waitForStablePrimaryWindow/);
});
