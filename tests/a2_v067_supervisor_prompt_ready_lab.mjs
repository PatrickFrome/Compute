import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('coordination/chat-control-plane/extension/trusted-supervisor-chat-v067.js', 'utf8');
const pos = (needle) => {
  const i = source.indexOf(needle);
  assert.ok(i >= 0, `missing contract fragment: ${needle}`);
  return i;
};

assert.ok(source.includes('const COMPOSER_SELECTORS'));
assert.ok(source.includes("#prompt-textarea"));
assert.ok(source.includes("[data-testid='composer-text-input'] textarea"));
assert.ok(source.includes("[role='textbox'][contenteditable='true']"));

const composerReady = pos('const before = await waitComposerReady(session)');
const insert = pos('await session.send("Input.insertText", { text: prompt })');
const readback = pos('if (normalize(afterInsert.text) !== normalize(prompt))');
const sendReady = pos('await waitReadySend(session)');
const bypass = pos('await armBypass(tabId, valid.incidentId, prompt)');
const pre = pos('await remember(valid.incidentId, scope.epoch, "PRE_ENTER_DURABLE")');
const down = pos('type: "rawKeyDown", key: "Enter"');
const up = pos('type: "keyUp", key: "Enter"');
const actuated = pos('await remember(valid.incidentId, scope.epoch, "ACTUATED")');

assert.ok(composerReady < insert, 'composer readiness must precede insert');
assert.ok(insert < readback, 'exact readback must follow insert');
assert.ok(readback < sendReady, 'send readiness must follow exact readback');
assert.ok(sendReady < bypass, 'prompt gate bypass may arm only after send-ready');
assert.ok(bypass < pre, 'bypass must be armed before durable pre-enter');
assert.ok(pre < down && down < up && up < actuated, 'durable PRE_ENTER -> trusted keyDown/keyUp -> ACTUATED ordering violated');

assert.ok(source.includes('supervisor_chat_enter_ambiguous_no_retry'));
assert.ok(source.includes('AMBIGUOUS_NO_RETRY'));
assert.ok(source.includes('SENT_ALREADY_DURABLE'));
assert.ok(source.includes('FAILED_DURABLE_AMBIGUOUS_NO_RETRY'));
assert.ok(!/new\s+Function\s*\(|\beval\s*\(/.test(source));

console.log('A2 v0.6.7 supervisor prompt readiness/actuation contract: PASS');
