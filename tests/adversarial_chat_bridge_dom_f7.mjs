#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, '../coordination/chat-control-plane/extension/content.js'), 'utf8');
const compat = readFileSync(resolve(HERE, '../coordination/chat-control-plane/extension/platform-dom-compat.js'), 'utf8');
const trusted = readFileSync(resolve(HERE, '../coordination/chat-control-plane/extension/trusted-chatgpt.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(HERE, '../coordination/chat-control-plane/extension/manifest.json'), 'utf8'));

function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} not found`);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const normalizeSrc = 'const normalize = (value) => String(value ?? "").replace(/\\r\\n/g, "\\n").trim();';
const fns = [extractFn('semanticFields'), extractFn('matchesButtonSemantics'), extractFn('sharedContainer')].join('\n');
const factory = new Function(`
class HTMLElement {}
const visible = () => true;
${normalizeSrc}
${fns}
return { semanticFields, matchesButtonSemantics, sharedContainer, HTMLElement };
`);
const { matchesButtonSemantics, sharedContainer, HTMLElement } = factory();

function button(fields) {
  const b = new HTMLElement();
  b.getAttribute = (n) => fields[n] ?? null;
  b.textContent = fields.text ?? '';
  return b;
}
function node(children = [], parent = null) {
  const n = new HTMLElement();
  n.parentElement = parent;
  n.contains = (x) => n === x || children.includes(x);
  return n;
}

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('Resend is rejected', !matchesButtonSemantics(button({ 'aria-label': 'Resend' }), 'send'));
check('Send feedback is rejected', !matchesButtonSemantics(button({ text: 'Send feedback' }), 'send'));
check('Send matches', matchesButtonSemantics(button({ 'aria-label': 'Send' }), 'send'));
check('Send prompt matches', matchesButtonSemantics(button({ 'aria-label': 'Send prompt' }), 'send'));
check('Russian Send matches', matchesButtonSemantics(button({ 'aria-label': 'Отправить' }), 'send'));
check('Stop generating matches', matchesButtonSemantics(button({ 'aria-label': 'Stop generating' }), 'stop'));

const send = new HTMLElement();
const root = node([send]);
const composer = node([], root);
check('shared container accepted', sharedContainer(composer, send));
check('unrelated send rejected', !sharedContainer(node([]), send));

const execute = source.split('async function executeSend(command)')[1].split('async function emitSnapshot')[0];
const gptBlock = execute.split('if (platform() === "CHATGPT")')[1].split('} else {')[0];
const glmBlock = execute.split('} else {')[1];
check('GPT uses one trusted send', gptBlock.includes('await callTrustedChatgpt(text);'));
check('GPT has no PRIME phase', !source.includes('A2_CHATGPT_TRUSTED_PRIME'));
check('GPT has no CLICK phase', !source.includes('A2_CHATGPT_TRUSTED_CLICK'));
check('GPT avoids DOM writer', !gptBlock.includes('writeComposerExact'));
check('GPT avoids synthetic click', !gptBlock.includes('sendButton.click'));
check('GPT avoids duplicate Send wait', !gptBlock.includes('waitForEnabledSend'));
check('GLM keeps DOM writer', glmBlock.includes('await writeComposerExact(text);'));
check('GLM keeps real DOM click', glmBlock.includes('sendButton.click();'));
check('GPT requires empty composer', gptBlock.includes('chatgpt_composer_not_empty_before_send'));
check('verification timeout still fails closed', source.includes('send_click_not_observed_in_dom'));

check('compat loads before content', JSON.stringify(manifest.content_scripts[0].js) === JSON.stringify(['platform-dom-compat.js', 'content.js']));
check('compat has ChatGPT exact anchor', compat.includes('markExactSendButton("#composer-submit-button")'));
check('compat has ZAI exact anchor', compat.includes('markExactSendButton("#send-message-button")'));
check('compat has no runtime messaging', !compat.includes('runtime.sendMessage'));
check('compat has no click', !compat.includes('.click('));

check('trusted worker accepts only bridge-owned GPT prompt', trusted.includes('bridge_job_target=GPT') && trusted.includes('transport=WEB_CHAT_INTERACTIVE_REMOTE'));
check('trusted worker has one message type', trusted.includes('A2_CHATGPT_TRUSTED_SEND') && !trusted.includes('A2_CHATGPT_TRUSTED_PRIME') && !trusted.includes('A2_CHATGPT_TRUSTED_CLICK'));
check('trusted worker uses CDP input', trusted.includes('"Input.insertText"'));
check('trusted worker waits for enabled Send in same session', trusted.includes('waitForReadySend(tabId, text)'));
check('trusted worker uses CDP mouse', trusted.includes('"Input.dispatchMouseEvent"'));
check('trusted worker rejects ambiguous Send', trusted.includes('send_ambiguous'));
check('trusted worker rejects obscured Send', trusted.includes('send_obscured') && trusted.includes('document.elementFromPoint(x, y)'));
check('trusted worker canonicalizes ProseMirror readback', trusted.includes('canon(text) !== canon(expected)'));
check('trusted worker detaches debugger', trusted.includes('chrome.debugger.detach'));
check('trusted worker has no session lease', !trusted.includes('chrome.storage.session'));
check('trusted worker never targets ZAI', !trusted.includes('chat.z.ai'));
check('fast send ready budget', trusted.includes('const SEND_READY_TIMEOUT_MS = 3000;'));
check('fast verification budget', source.includes('const SEND_VERIFY_TIMEOUT_MS = 6000;'));

let passed = 0;
for (const [name, ok] of checks) {
  console.log(ok ? 'PASS' : 'FAIL', name);
  if (!ok) process.exitCode = 1;
  else passed += 1;
}
console.log(`\n${passed}/${checks.length} adversarial checks passed`);
