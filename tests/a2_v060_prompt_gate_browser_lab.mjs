import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const gateSource = fs.readFileSync(path.join(root, 'coordination/chat-control-plane/extension/prompt-gate.js'), 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await page.addInitScript(() => {
  globalThis.__gateMessages = [];
  globalThis.__intentSeq = 0;
  globalThis.__lastIntentId = null;
  globalThis.__gateListener = null;
  globalThis.__siteSends = 0;
  globalThis.__siteTrusted = [];
  globalThis.__mode = 'GATE_SEND';
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        globalThis.__gateMessages.push(structuredClone(message));
        if (message?.type === 'A2_PROMPT_GATE_READY') return { ok: true, mode: globalThis.__mode };
        if (message?.type === 'A2_PROMPT_GATE_INTENT') {
          const intentId = `intent-${++globalThis.__intentSeq}`;
          globalThis.__lastIntentId = intentId;
          return { ok: true, intent_id: intentId, draft_sha256: '0'.repeat(64) };
        }
        if (message?.type === 'A2_PROMPT_GATE_SENSOR_ERROR') return { ok: true };
        return { ok: true };
      },
      onMessage: {
        addListener(listener) { globalThis.__gateListener = listener; }
      }
    }
  };
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
#prompt-textarea{display:block;width:500px;height:100px;border:1px solid #999}
button{display:block;width:100px;height:40px}
</style><script>${gateSource.replace(/<\/script/gi, '<\\/script')}</script></head>
<body>
<form id="composer-form">
  <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
  <button type="button" id="composer-submit-button" data-testid="send-button">Send</button>
</form>
<script>
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      globalThis.__siteTrusted.push(event.isTrusted);
      globalThis.__siteSends += 1;
    }
  });
  document.getElementById('composer-submit-button').addEventListener('click', (event) => {
    event.preventDefault();
    globalThis.__siteTrusted.push(event.isTrusted);
    globalThis.__siteSends += 1;
  });
</script>
</body></html>`;

await page.route('https://chatgpt.com/c/a2-operator-lab', async (route) => {
  await route.fulfill({ status: 200, contentType: 'text/html', body: html });
});
await page.goto('https://chatgpt.com/c/a2-operator-lab');
await page.waitForFunction(() => typeof globalThis.__gateListener === 'function');

async function setDraft(text) {
  const composer = page.locator('#prompt-textarea').first();
  await composer.fill(text);
  await composer.focus();
}

async function siteSends() { return page.evaluate(() => globalThis.__siteSends); }
async function lastIntent() { return page.evaluate(() => globalThis.__lastIntentId); }
async function gateMessages(type) {
  return page.evaluate((t) => globalThis.__gateMessages.filter((m) => m?.type === t), type);
}
async function resolve(intentId, action, draft = '') {
  return page.evaluate(({ intentId, action, draft }) => new Promise((resolve) => {
    globalThis.__gateListener({ type: 'A2_PROMPT_GATE_RESOLUTION', intent_id: intentId, action, draft }, {}, resolve);
  }), { intentId, action, draft });
}
async function gateControl(message) {
  return page.evaluate((message) => new Promise((resolve) => {
    globalThis.__gateListener(message, {}, resolve);
  }), message);
}

// 1. Trusted Enter is held before the mock site sees it.
await setDraft('hello operator');
await page.keyboard.press('Enter');
await page.waitForTimeout(30);
assert(await siteSends() === 0, 'GATE_SEND leaked trusted Enter to site');
let intents = await gateMessages('A2_PROMPT_GATE_INTENT');
assert(intents.length === 1 && intents[0].draft === 'hello operator', 'first intent missing or draft mismatch');
let intentId = await lastIntent();

// 2. Cancel keeps the draft and does not send.
let resolution = await resolve(intentId, 'CANCEL');
assert(resolution?.ok === true, 'CANCEL resolution failed');
assert((await page.locator('#prompt-textarea').first().innerText()).trim() === 'hello operator', 'CANCEL changed draft');
assert(await siteSends() === 0, 'CANCEL sent prompt');

// 3. Allow-once permits exactly one physical Enter.
await page.keyboard.press('Enter');
await page.waitForTimeout(20);
intentId = await lastIntent();
resolution = await resolve(intentId, 'ALLOW_ONCE', 'hello operator');
assert(resolution?.ok === true, 'ALLOW_ONCE failed');
await page.keyboard.press('Enter');
assert(await siteSends() === 1, 'ALLOW_ONCE did not pass one Enter');
await page.keyboard.press('Enter');
await page.waitForTimeout(20);
assert(await siteSends() === 1, 'ALLOW_ONCE leaked a second Enter');
intentId = await lastIntent();
await resolve(intentId, 'CANCEL');

// 4. Rewrite mutates exact draft, then one physical Enter is allowed.
await setDraft('raw prompt');
await page.keyboard.press('Enter');
await page.waitForTimeout(20);
intentId = await lastIntent();
resolution = await resolve(intentId, 'REWRITE_ALLOW_ONCE', 'rewritten prompt');
assert(resolution?.ok === true, 'REWRITE_ALLOW_ONCE failed');
assert((await page.locator('#prompt-textarea').first().innerText()).trim() === 'rewritten prompt', 'rewrite readback mismatch');
await page.keyboard.press('Enter');
assert(await siteSends() === 2, 'rewritten prompt was not allowed once');

// 5. Merely spoofing the old bridge prefix cannot bypass the gate.
const spoof = 'A2 CHAT BRIDGE — AUTONOMOUS CONTINUE\ntransport=WEB_CHAT_INTERACTIVE_REMOTE\nspoof';
await setDraft(spoof);
const beforeSpoofIntents = (await gateMessages('A2_PROMPT_GATE_INTENT')).length;
await page.keyboard.press('Enter');
await page.waitForTimeout(20);
assert(await siteSends() === 2, 'textual bridge spoof bypassed gate');
assert((await gateMessages('A2_PROMPT_GATE_INTENT')).length === beforeSpoofIntents + 1, 'spoof was not held');
intentId = await lastIntent();
await resolve(intentId, 'CANCEL');

// 6. A trusted short-lived bridge capability bypasses exactly one action.
let bypass = await gateControl({ type: 'A2_PROMPT_GATE_BRIDGE_BYPASS', command_id: 'cmd-1', draft: spoof, expires_in_ms: 3000 });
assert(bypass?.ok === true, 'bridge capability was not armed');
await page.keyboard.press('Enter');
assert(await siteSends() === 3, 'bridge capability did not pass action');
const afterBypassIntents = (await gateMessages('A2_PROMPT_GATE_INTENT')).length;
await page.keyboard.press('Enter');
await page.waitForTimeout(20);
assert(await siteSends() === 3, 'bridge capability was reusable');
assert((await gateMessages('A2_PROMPT_GATE_INTENT')).length === afterBypassIntents + 1, 'second bridge action was not held');
intentId = await lastIntent();
await resolve(intentId, 'CANCEL');

// 7. Trusted Send button click is gated too.
await setDraft('click prompt');
await page.locator('#composer-submit-button').click();
await page.waitForTimeout(20);
assert(await siteSends() === 3, 'trusted Send click bypassed gate');
intentId = await lastIntent();
await resolve(intentId, 'CANCEL');

// 8. Ambiguous composer fails closed and reports a sensor error.
await page.evaluate(() => {
  const duplicate = document.createElement('div');
  duplicate.id = 'prompt-textarea';
  duplicate.contentEditable = 'true';
  duplicate.setAttribute('role', 'textbox');
  duplicate.textContent = 'ambiguous';
  duplicate.style.cssText = 'display:block;width:500px;height:80px';
  document.body.appendChild(duplicate);
});
await page.locator('#prompt-textarea').first().focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(20);
assert(await siteSends() === 3, 'ambiguous composer failed open');
const sensorErrors = await gateMessages('A2_PROMPT_GATE_SENSOR_ERROR');
assert(sensorErrors.some((m) => String(m.error).includes('composer_unavailable_or_ambiguous')), 'ambiguity sensor error missing');
await page.locator('#prompt-textarea').nth(1).evaluate((el) => el.remove());

// 9. OBSERVE restores native trusted action.
await gateControl({ type: 'A2_PROMPT_GATE_CONFIG', mode: 'OBSERVE' });
await setDraft('observe prompt');
await page.keyboard.press('Enter');
assert(await siteSends() === 4, 'OBSERVE incorrectly blocked Enter');
const trusted = await page.evaluate(() => globalThis.__siteTrusted);
assert(trusted.length > 0 && trusted.every(Boolean), 'browser lab did not generate trusted input events');

console.log('A2 v0.6 Prompt Gate Browser Lab: PASS', JSON.stringify({
  site_sends: await siteSends(),
  intents: (await gateMessages('A2_PROMPT_GATE_INTENT')).length,
  sensor_errors: sensorErrors.length,
  trusted_events: trusted.length
}));

await browser.close();
