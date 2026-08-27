#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '../coordination/chat-control-plane/extension');
const source = readFileSync(resolve(EXT, 'content.js'), 'utf8');
const compat = readFileSync(resolve(EXT, 'platform-dom-compat.js'), 'utf8');
const trustedGpt = readFileSync(resolve(EXT, 'trusted-chatgpt.js'), 'utf8');
const trustedGlm = readFileSync(resolve(EXT, 'trusted-glm.js'), 'utf8');
const promptGate = readFileSync(resolve(EXT, 'prompt-gate.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(EXT, 'manifest.json'), 'utf8'));

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

// Execute only the pure semantic-button functions in a tiny fake DOM. The
// content layer is otherwise treated as read-only source and must never send.
const normalizeSrc = 'const normalize = (value) => String(value ?? "").replace(/\\r\\n?/g, "\\n").trim();';
const fns = [extractFn('semanticFields'), extractFn('buttonMatches')].join('\n');
const factory = new Function(`
${normalizeSrc}
${fns}
return { semanticFields, buttonMatches };
`);
const { buttonMatches } = factory();

function button(fields) {
  return {
    getAttribute: (name) => fields[name] ?? null,
    textContent: fields.text ?? ''
  };
}

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

// F7 semantic false-positive resistance remains mandatory.
check('Resend is rejected', !buttonMatches(button({ 'aria-label': 'Resend' }), 'send'));
check('Send feedback is rejected', !buttonMatches(button({ text: 'Send feedback' }), 'send'));
check('Send later is rejected', !buttonMatches(button({ 'aria-label': 'Send later' }), 'send'));
check('Send matches', buttonMatches(button({ 'aria-label': 'Send' }), 'send'));
check('Send prompt matches', buttonMatches(button({ 'aria-label': 'Send prompt' }), 'send'));
check('Russian Send matches', buttonMatches(button({ 'aria-label': 'Отправить' }), 'send'));
check('Stop generating matches', buttonMatches(button({ 'aria-label': 'Stop generating' }), 'stop'));
check('Stop sharing is rejected', !buttonMatches(button({ 'aria-label': 'Stop sharing' }), 'stop'));

// v0.6 content script is a sensor only. It may resolve/read composer and
// messages, but must contain no physical send or composer-write path.
check('content keeps composer ambiguity fence', source.includes('composer_ambiguous'));
check('content keeps exact message node identity', source.includes('dom_node_key') && source.includes('nodeKey(node'));
check('content emits SHA-256 identities', source.includes('sha256Text') && source.includes('text_sha256'));
check('content has no executeSend', !source.includes('executeSend('));
check('content has no synthetic click', !source.includes('.click('));
check('content has no CDP input', !source.includes('Input.insertText') && !source.includes('Input.dispatchMouseEvent'));
check('content has no composer writer', !source.includes('writeComposerExact') && !source.includes('nativeValueSetter'));
check('content runtime listener is snapshot-only', source.includes('message?.type !== "GET_CHAT_SNAPSHOT"'));

// Compatibility layer remains selector marking only, never transport/actuation.
check('compat has ChatGPT exact anchor', compat.includes('markExactSendButton("#composer-submit-button")'));
check('compat has ZAI exact anchor', compat.includes('markExactSendButton("#send-message-button")'));
check('compat has no runtime messaging', !compat.includes('runtime.sendMessage'));
check('compat has no click', !compat.includes('.click('));

// Prompt Gate starts before idle DOM sensor and blocks/re-writes user intent;
// it is not an autonomous synthetic Send implementation.
check('Prompt Gate loads at document_start', manifest.content_scripts[0].run_at === 'document_start' && manifest.content_scripts[0].js.includes('prompt-gate.js'));
check('read-only sensor loads after compat', JSON.stringify(manifest.content_scripts[1].js) === JSON.stringify(['platform-dom-compat.js', 'content.js']));
check('Prompt Gate has bridge capability path', promptGate.includes('A2_PROMPT_GATE_BRIDGE_BYPASS'));
check('Prompt Gate has no chrome.debugger authority', !promptGate.includes('chrome.debugger'));

// GPT autonomous Send: exact bridge-owned scope, broker-only CDP, trusted Enter.
check('GPT accepts only bridge-owned prompt', trustedGpt.includes('bridge_job_target=GPT') && trustedGpt.includes('transport=WEB_CHAT_INTERACTIVE_REMOTE'));
check('GPT uses debugger broker', trustedGpt.includes('A2_DEBUGGER_RUN'));
check('GPT has no direct debugger attach', !trustedGpt.includes('chrome.debugger.attach') && !trustedGpt.includes('chrome.debugger.detach') && !trustedGpt.includes('chrome.debugger.getTargets'));
check('GPT uses trusted text input', trustedGpt.includes('"Input.insertText"'));
check('GPT uses trusted Enter', trustedGpt.includes('"Input.dispatchKeyEvent"') && trustedGpt.includes('key: "Enter"') && trustedGpt.includes('windowsVirtualKeyCode: 13'));
check('GPT has no mouse Send', !trustedGpt.includes('"Input.dispatchMouseEvent"'));
check('GPT rejects ambiguous Send', trustedGpt.includes('send_ambiguous'));
check('GPT durable boundary precedes Enter', trustedGpt.indexOf('PRE_ENTER_DURABLE') < trustedGpt.indexOf('key: "Enter"'));
check('GPT ambiguity is no-retry', trustedGpt.includes('AMBIGUOUS_NO_RETRY'));

// GLM autonomous Send: broker-owned trusted text + physical CDP mouse; no
// synthetic DOM click/value-setter resurrection.
check('GLM uses debugger broker hold/run', trustedGlm.includes('A2_DEBUGGER_HOLD') && trustedGlm.includes('A2_DEBUGGER_RUN'));
check('GLM has no direct debugger attach', !trustedGlm.includes('chrome.debugger.attach') && !trustedGlm.includes('chrome.debugger.detach') && !trustedGlm.includes('chrome.debugger.getTargets'));
check('GLM uses trusted text input', trustedGlm.includes('Input.insertText'));
check('GLM uses trusted physical mouse', trustedGlm.includes('type: "mousePressed"') && trustedGlm.includes('type: "mouseReleased"'));
check('GLM has no synthetic DOM click', !trustedGlm.includes('.click('));
check('GLM has no native value setter', !trustedGlm.includes("Object.getOwnPropertyDescriptor(proto, 'value')"));
check('GLM durable DISPATCHED precedes mouse release', trustedGlm.indexOf('state: "DISPATCHED"') < trustedGlm.indexOf('type: "mouseReleased", x: point.x'));
check('GLM ambiguity is no-retry', trustedGlm.includes('AMBIGUOUS_NO_RETRY'));

check('manifest is v0.6 Browser Operator', manifest.version === '0.6.0' && Number(manifest.minimum_chrome_version) >= 125);
check('incognito remains disabled', manifest.incognito === 'not_allowed');

let passed = 0;
for (const [name, ok] of checks) {
  console.log(ok ? 'PASS' : 'FAIL', name);
  if (!ok) process.exitCode = 1;
  else passed += 1;
}
console.log(`\n${passed}/${checks.length} v0.6 adversarial DOM/operator checks passed`);
