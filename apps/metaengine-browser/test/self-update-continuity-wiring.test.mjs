import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');

async function read(name) { return fs.readFile(path.join(src, name), 'utf8'); }

test('self-update continuity is persisted before lock release and restored before lifecycle starts', async () => {
  const source = await read('native-supervisor-client.mjs');
  const persistAt = source.indexOf('await this.#persistSessionContinuity(app, receipt)');
  const stopAt = source.indexOf('this.stop();', persistAt);
  const releaseAt = source.indexOf('app.releaseSingleInstanceLock();', persistAt);
  assert.ok(persistAt >= 0 && stopAt > persistAt && releaseAt > stopAt);

  const restoreAt = source.indexOf('await this.#restoreSessionContinuity()');
  const lifecycleAt = source.indexOf('await this.#lifecycle.start()', restoreAt);
  assert.ok(restoreAt >= 0 && lifecycleAt > restoreAt);
});

test('updater gate does not require ChatGPT/model quiescence', async () => {
  const client = await read('native-supervisor-client.mjs');
  const gate = await read('self-update-restart-safety.mjs');
  assert.equal(client.includes('this.#lifecycle?.isQuiescent()'), false);
  assert.equal(gate.includes('chatGptControlMatches'), false);
  assert.equal(gate.includes('network_active'), false);
  assert.equal(gate.includes('queued_wakes'), false);
  assert.ok(gate.includes('state?.downloads?.active == null'));
});

test('continuity capsule explicitly excludes chat text, tab titles and credentials', async () => {
  const source = await read('self-update-session-continuity.mjs');
  assert.ok(source.includes('persisted_chat_text: false'));
  assert.ok(source.includes('persisted_tab_titles: false'));
  assert.ok(source.includes('persisted_credentials: false'));
  assert.equal(source.includes("title: clip(tab?.title"), false);
});
