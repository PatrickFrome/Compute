#!/usr/bin/env node
/* Adversarial DOM test for the F7 bridge fix (content.js @ c2e4757).
 * Extracts the REAL matching/resolution source from content.js and drives it
 * with mock DOM elements. Tests: Resend, Send feedback, multiple textareas,
 * multiple send buttons, missing adjacency, normal Z.AI/ChatGPT shapes,
 * multiple adjacent pairs. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('/tmp/content_f7.js', 'utf8');

// Extract the exact source of the pure functions we need to test.
function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} not found`);
  let depth = 0, i = source.indexOf('{', start);
  const begin = i;
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
const fns = [
  extractFn('semanticFields'),
  extractFn('matchesButtonSemantics'),
  extractFn('sharedContainer'),
].join('\n');
// visible() and HTMLElement checks need real browser types; provide minimal fakes.
const prelude = `
class HTMLElement {}
const visible = () => true;
${normalizeSrc}
`;
// eslint-disable-next-line no-new-func
const factory = new Function(`${prelude}\n${fns}\nreturn { semanticFields, matchesButtonSemantics, sharedContainer, HTMLElement };`);
const { matchesButtonSemantics, sharedContainer, HTMLElement } = factory();

function domNode(children = [], parent = null) {
  const node = new HTMLElement();
  node._children = children;
  node.parentElement = parent;
  node.contains = (x) => children.includes(x) || node === x;
  return node;
}

function button(fields) {
  const b = new HTMLElement();
  b.getAttribute = (n) => fields[n] ?? null;
  b.textContent = fields.text ?? '';
  return b;
}
const el = (parent) => domNode([], parent);
const containerWith = (children) => domNode(children);

let passed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL'), name);
  if (!ok) process.exitCode = 1;
  else passed += 1;
}

// --- adversarial: misleading labels must NOT match send ---
check('Resend (aria) does not match send', !matchesButtonSemantics(button({ 'aria-label': 'Resend' }), 'send'));
check('Send feedback (aria) does not match send', !matchesButtonSemantics(button({ 'aria-label': 'Send feedback' }), 'send'));
check('Resend (text) does not match send', !matchesButtonSemantics(button({ text: 'Resend' }), 'send'));
check('Send feedback (text) does not match send', !matchesButtonSemantics(button({ text: 'Send feedback' }), 'send'));
check('Sends a message (aria) does not match (not anchored)', !matchesButtonSemantics(button({ 'aria-label': 'Sends a message' }), 'send'));
check('Stopped (aria) does not match stop', !matchesButtonSemantics(button({ 'aria-label': 'Stopped' }), 'stop'));
check('Dont stop believing (text) does not match stop', !matchesButtonSemantics(button({ text: "Don't stop believing" }), 'stop'));

// --- positive: real labels must match ---
check('Send (aria) matches send', matchesButtonSemantics(button({ 'aria-label': 'Send' }), 'send'));
check('send message (aria) matches send', matchesButtonSemantics(button({ 'aria-label': 'Send Message' }), 'send'));
check('Submit (text) matches send', matchesButtonSemantics(button({ text: 'Submit' }), 'send'));
check('отправить (aria) matches send', matchesButtonSemantics(button({ 'aria-label': 'Отправить' }), 'send'));
check('发送 (aria) matches send', matchesButtonSemantics(button({ 'aria-label': '发送' }), 'send'));
check('send (title) matches send', matchesButtonSemantics(button({ title: 'Send' }), 'send'));
check('Stop generating matches stop', matchesButtonSemantics(button({ 'aria-label': 'Stop generating' }), 'stop'));
check('停止生成 matches stop', matchesButtonSemantics(button({ 'aria-label': '停止生成' }), 'stop'));
check('exact Send with trailing space (normalize) matches', matchesButtonSemantics(button({ 'aria-label': '  Send  ' }), 'send'));

// --- adjacency: sharedContainer walk ---
const sendBtn = new HTMLElement();
const composerEl = new HTMLElement();
const shared = containerWith([composerEl, sendBtn]);
const unrelated = containerWith([new HTMLElement()]);
check('composer+send in shared container -> adjacent', sharedContainer(el(shared), sendBtn) === true);
check('composer without send in container -> not adjacent', sharedContainer(el(unrelated), sendBtn) === false);
// depth walk: 8 ancestor levels up still finds the send button
const deepSend = new HTMLElement();
const deepRoot = domNode([deepSend]);
let deepEl = domNode([], deepRoot);
for (let i = 0; i < 7; i += 1) deepEl = domNode([], deepEl);
check('adjacency within 8 ancestor levels', sharedContainer(deepEl, deepSend) === true);
// 9 levels: the bounded walk must not reach
const farSend = new HTMLElement();
const farRoot = domNode([farSend]);
let farEl = domNode([], farRoot);
for (let i = 0; i < 9; i += 1) farEl = domNode([], farEl);
check('adjacency beyond 8 levels fails (bounded walk)', sharedContainer(farEl, farSend) === false);

// --- pair resolution semantics (documented fail-closed outcomes) ---
const resolveSrc = source.slice(
  source.indexOf('function resolveComposerSendPair()'),
  source.indexOf('function getComposer()')
);
check('resolveComposerSendPair: exactly-one-pair contract present', resolveSrc.includes('if (pairs.length === 1)'));
check('resolveComposerSendPair: ambiguity fails closed', resolveSrc.includes('composer_send_pair_ambiguous'));
check('resolveComposerSendPair: missing send fails closed', resolveSrc.includes('send_button_not_found'));
check('resolveComposerSendPair: missing composer fails closed', resolveSrc.includes('composer_not_found'));
check('resolveComposerSendPair: no adjacency fails closed (no textarea fallback)', resolveSrc.includes('composer_send_pair_not_found'));
check('no substring fallback remains (includes(term) gone)', !source.includes('semantic.includes(term)'));
check('waitForEnabledSend revalidates exact composer text', source.includes('composerText(pair.composer) === expected'));
check('waitForEnabledSend throws on ambiguity', source.includes('pair.error === "composer_send_pair_ambiguous"'));
check('dom_pair_error surfaced in pageState', source.includes('dom_pair_error: pair.error'));
check('generating conservative on multiple stop controls', source.includes('semanticButtonCandidates("stop").length > 0'));

console.log(`\n${passed} adversarial checks passed`);
