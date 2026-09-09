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

test('subscribe happens before final v2 runtime fence and Enter dispatch', () => {
  const latch = source.indexOf('const outcomeLatch = openChatGptSubmitOutcomeLatch');
  const fence = source.indexOf('assertCurrentEffectRuntime(webContents, dbg, effectBinding);', latch);
  const enter = source.indexOf("type:'rawKeyDown', key:'Enter'", fence);
  const wait = source.indexOf('await outcomeLatch.wait()', enter);
  assert.ok(latch >= 0, 'outcome latch must be opened');
  assert.ok(fence > latch, 'runtime fence must run after subscription');
  assert.ok(enter > fence, 'Enter must dispatch only after final runtime fence');
  assert.ok(wait > enter, 'readback waits after physical submit');
});

test('ambiguous deadline cannot create an automatic retry authority', () => {
  assert.match(source, /effect_state: 'AMBIGUOUS_AFTER_ENTER'/);
  assert.match(source, /automatic_retry_allowed: false/);
  assert.match(source, /readback_poll_timer_required: false/);
});
