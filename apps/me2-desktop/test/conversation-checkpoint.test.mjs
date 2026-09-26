import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { ConversationCheckpoint } from '../src/me2/conversation-checkpoint.mjs';
import { FleetTabs } from '../src/me2/fleet-tabs.mjs';
const url = 'https://chat.z.ai/c/resume-me';
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'me2-checkpoint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'sessions.json');
  return { file, checkpoint: new ConversationCheckpoint({ file }) };
}
function fleet(checkpoint, { hang = false } = {}) {
  const views = []; let activations = 0;
  const registry = new FleetTabs({ checkpoint, loadTimeoutMs: 10, activate: () => activations++, viewFactory: () => {
    const wc = new EventEmitter(); wc.id = views.length + 1;
    wc.getURL = () => wc.url; wc.isDestroyed = () => !!wc.dead;
    wc.loadURL = async url => { if (hang) return new Promise(() => {}); wc.url = url; wc.emit('did-navigate'); };
    wc.close = () => { wc.dead = true; wc.emit('destroyed'); };
    const view = { webContents: wc }; views.push(view); return view;
  } });
  return { registry, views, activations: () => activations };
}
test('checkpoint validates origins, strips query data, deduplicates and bounds input', t => {
  const { file } = setup(t);
  writeFileSync(file, JSON.stringify({ schema: 'me2-conversations.v1', urls: ['https://evil/c/x', url+'?secret=1', url, 'https://chat.z.ai/c/other'] }));
  const saved = new ConversationCheckpoint({ file, ceiling: 1 });
  assert.deepEqual(saved.list(), [url]); saved.save();
  assert.equal(readFileSync(file, 'utf8').includes('secret'), false);
});
test('restart restores only addresses with fresh native readback and no focus stealing', async t => {
  const { file, checkpoint } = setup(t);
  const first = fleet(checkpoint); await first.registry.openAgent({ conversation_url: url });
  first.registry.stop();
  const second = fleet(new ConversationCheckpoint({ file }));
  assert.deepEqual(await second.registry.restore(), { restored: 1, failed: 0 });
  assert.equal(second.activations(), 0);
  assert.equal(second.registry.list()[0].execution_authority, false);
  second.registry.closeAgent(second.registry.list()[0].tab_id);
  assert.deepEqual(new ConversationCheckpoint({ file }).list(), []);
});
test('load timeout releases native capacity but retains resume address', async t => {
  const { checkpoint } = setup(t); checkpoint.remember(url);
  const { registry, views } = fleet(checkpoint, { hang: true });
  assert.deepEqual(await registry.restore(), { restored: 0, failed: 1 });
  assert.equal(registry.list().length, 0); assert.equal(views[0].webContents.dead, true);
  assert.deepEqual(checkpoint.list(), [url]);
});
test('stopped restore cannot create replacement tabs', async t => {
  const { checkpoint } = setup(t); checkpoint.remember(url);
  const { registry, views } = fleet(checkpoint); registry.stop();
  await registry.restore(); assert.equal(views.length, 0);
  assert.equal((await registry.openAgent({ conversation_url: url })).reason, 'fleet_stopped');
});
