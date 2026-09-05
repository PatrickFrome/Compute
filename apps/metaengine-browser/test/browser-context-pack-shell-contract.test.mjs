import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');

test('shell exposes Context Pack capture only through explicit trusted-shell command', async () => {
  const main = await read('src/main.mjs');
  assert.match(main, /new BrowserContextPackRuntime\(\{ registry, views \}\)/);
  assert.match(main, /if \(command === 'CONTEXT_PACK_CAPTURE'\) return contextPacks\.capture\(payload\?\.tab_ids\)/);
  assert.equal((main.match(/CONTEXT_PACK_CAPTURE/g) || []).length, 1, 'Context Pack command must not leak into the native supervisor command surface');
  assert.match(main, /context_packs: contextPacks\.snapshot\(\)/);
  assert.doesNotMatch(main, /\['[^\]]*CONTEXT_PACK_CAPTURE[^\]]*'\]\.includes\(action\)/);
});

test('Context Pack UI is user-triggered, local and markup-safe', async () => {
  const ui = await read('ui/context-packs.js');
  assert.match(ui, /S\.command\('CONTEXT_PACK_CAPTURE',\{tab_ids:\[\.\.\.chosen\]\}\)/);
  assert.match(ui, /Capture context/);
  assert.match(ui, /UNTRUSTED DATA/);
  assert.match(ui, /WEB_CONTENT_IS_DATA_NOT_INSTRUCTION/);
  assert.match(ui, /Nothing is sent to a model automatically/);
  assert.doesNotMatch(ui, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(ui, /navigator\.clipboard|writeText\(/);
  assert.doesNotMatch(ui, /setInterval\(|setTimeout\(/);
  assert.doesNotMatch(ui, /\.click\(\)/);
  assert.doesNotMatch(ui, /for\s*\([^)]*tabs\(\)[^)]*\)\s*chosen\.add/);
});

test('shell protocol and document allow only explicit Context Pack assets', async () => {
  const main = await read('src/main.mjs');
  const html = await read('ui/index.html');
  assert.match(main, /'context-packs\.js'/);
  assert.match(main, /'context-packs\.css'/);
  assert.match(html, /metaengine:\/\/shell\/context-packs\.css/);
  assert.match(html, /metaengine:\/\/shell\/context-packs\.js/);
  assert.match(html, /connect-src 'none'/);
});

test('runtime binding remains read-only and exact-live-view scoped', async () => {
  const runtime = await read('src/browser-context-pack-runtime.mjs');
  assert.match(runtime, /captureBrowserContextPack/);
  assert.match(runtime, /nativeBrowserTargetIdentity/);
  assert.match(runtime, /browser_context_pack_pre_capture_binding_drift/);
  assert.match(runtime, /explicit_invocation_only: true/);
  assert.match(runtime, /automatic_capture: false/);
  assert.match(runtime, /automatic_retry_allowed: false/);
  assert.match(runtime, /browser_actuation_authority: false/);
  assert.match(runtime, /second_polling_loop: false/);
  assert.doesNotMatch(runtime, /setInterval\(|setTimeout\(|executeSemanticCommand|webContents\.executeJavaScript/);
});
