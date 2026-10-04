import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/native-browser-control.mjs', import.meta.url), 'utf8');

test('semantic submit uses persistent CDP events instead of 100ms polling', () => {
  assert.match(source, /openCdpOutcomeLatch/);
  assert.match(source, /nativeBrowserCdpPool\.subscribe\(webContents, listener\)/);
  assert.doesNotMatch(source, /observeChatGptSubmit/);
  assert.doesNotMatch(source, /attempts\s*=\s*20/);
  assert.doesNotMatch(source, /intervalMs\s*=\s*100/);
  assert.doesNotMatch(source, /const sleep\s*=|await sleep\(/);
});

test('subscribe happens before final runtime fence and single ChatGPT Send activation', () => {
  const latch = source.indexOf('const latch = openChatGptSubmitOutcomeLatch');
  const fence = source.indexOf('assertCurrentEffectRuntime(webContents, dbg, effectBinding);', latch);
  const activation = source.indexOf('const activation = await activateBackendNode(dbg, target.backend_node_id', latch);
  const wait = source.indexOf('await latch.wait()', fence);
  assert.ok(latch >= 0, 'outcome latch must be opened');
  assert.ok(fence > latch, 'runtime fence must run after subscription');
  assert.ok(activation > latch && fence > activation, 'activation must invoke the final runtime fence');
  assert.ok(wait > fence, 'readback waits after physical submit');
});

test('ambiguous deadline cannot create an automatic retry authority', () => {
  assert.match(source, /effect_state: 'AMBIGUOUS_AFTER_ENTER'/);
  assert.match(source, /automatic_retry_allowed: false/);
  assert.match(source, /readback_poll_timer_required: false/);
});
