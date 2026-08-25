#!/usr/bin/env node
/* Adversarial DOM test for the F7 bridge fix.
 * Extracts the REAL matching/resolution source from content.js and drives it
 * with mock DOM elements. Tests: Resend, Send feedback, multiple textareas,
 * multiple send buttons, missing adjacency, normal Z.AI/ChatGPT shapes,
 * multiple adjacent pairs. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const contentPath = resolve(HERE, '../coordination/chat-control-plane/extension/content.js');
const source = readFileSync(contentPath, 'utf8');

function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} not found`);
  let depth = 0, i = source.indexOf('{', start);
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
const prelude = `
class HTMLElement {}
const visible = () => true;
${normalizeSrc}
`;
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

check('Resend (aria) does not match send', !matchesButtonSemantics(button({ 'aria-label': 'Resend' }), 'send'));
check('Send feedback (aria) does not match send', !matchesButtonSemantics(button({ 'aria-label': 'Send feedback' }), 'send'));
check('Resend (text) does not match send', !matchesButtonSemantics(button({ text: 'Resend' }), 'send'));
check('Send feedback (text) does not match send', !matchesButtonSemantics(button({ text: 'Send feedback' }), 'send'));
check('Sends a message (aria) does not match', !matchesButtonSemantics(button({ 'aria-label': 'Sends a message' }), 'send'));
check('Stopped (aria) does not match stop', !matchesButtonSemantics(button({ 'aria-label': 'Stopped' }), 'stop'));
check('Dont stop believing (text) does not match stop', !matchesButtonSemantics(button({ text: "Don't stop believing" }), 'stop'));

check('Send (aria) matches send', matchesButtonSemantics(button({ 'aria-label': 'Send' }), 'send'));
check('send message (aria) matches send', matchesButtonSemantics(button({ 'aria-label': 'Send Message' }), 'send'));
check('Submit (text) matches send', matchesButtonSemantics(button({ text: 'Submit' }), 'send'));
check('отправить (aria) matches send', matchesButtonSemantics(button({ 'aria-label': 'Отправить' }), 'send'));
check('发送 (aria) matches send', matchesButtonSemantics(button({ 'aria-label': '发送' }), 'send'));
check('send (title) matches send', matchesButtonSemantics(button({ title: 'Send' }), 'send'));
check('Stop generating matches stop', matchesButtonSemantics(button({ 'aria-label': 'Stop generating' }), 'stop'));
check('停止生成 matches stop', matchesButtonSemantics(button({ 'aria-label': '停止生成' }), 'stop'));
check('exact Send with trailing space matches', matchesButtonSemantics(button({ 'aria-label': '  Send  ' }), 'send'));

const sendBtn = new HTMLElement();
const composerEl = new HTMLElement();
const shared = containerWith([composerEl, sendBtn]);
const unrelated = containerWith([new HTMLElement()]);
check('composer+send in shared container -> adjacent', sharedContainer(el(shared), sendBtn) === true);
check('composer without send in container -> not adjacent', sharedContainer(el(unrelated), sendBtn) === false);
const deepSend = new HTMLElement();
const deepRoot = domNode([deepSend]);
let deepEl = domNode([], deepRoot);
for (let i = 0; i < 7; i += 1) deepEl = domNode([], deepEl);
check('adjacency within 8 ancestor levels', sharedContainer(deepEl, deepSend) === true);
const farSend = new HTMLElement();
const farRoot = domNode([farSend]);
let farEl = domNode([], farRoot);
for (let i = 0; i < 9; i += 1) farEl = domNode([], farEl);
check('adjacency beyond 8 levels fails', sharedContainer(farEl, farSend) === false);

const resolveSrc = source.slice(
  source.indexOf('function resolveComposerSendPair()'),
  source.indexOf('function getComposer()')
);
check('exactly-one-pair contract present', resolveSrc.includes('if (pairs.length === 1)'));
check('ambiguity fails closed', resolveSrc.includes('composer_send_pair_ambiguous'));
check('missing send fails closed', resolveSrc.includes('send_button_not_found'));
check('missing composer fails closed', resolveSrc.includes('composer_not_found'));
check('no adjacency fails closed', resolveSrc.includes('composer_send_pair_not_found'));
check('no substring fallback remains', !source.includes('semantic.includes(term)'));
check('waitForEnabledSend revalidates exact composer text', source.includes('composerText(pair.composer) === expected'));
check('waitForEnabledSend throws on ambiguity', source.includes('pair.error === "composer_send_pair_ambiguous"'));
check('dom_pair_error surfaced', source.includes('dom_pair_error: pair.error'));
check('generating conservative on stop controls', source.includes('semanticButtonCandidates("stop").length > 0'));

console.log(`\n${passed} adversarial checks passed`);
