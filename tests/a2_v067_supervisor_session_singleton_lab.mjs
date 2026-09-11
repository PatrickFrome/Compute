import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('coordination/chat-control-plane/extension/supervisor-chat-session-v067.js', 'utf8');

for (const required of [
  'const CREATE_LEASE_KEY = "a2SupervisorChatCreateLeaseV2"',
  'const CREATE_LEASE_MS = 60_000',
  'let ensurePromise = null',
  'let recoverPromise = null',
  'if (ensurePromise) return ensurePromise',
  'if (recoverPromise) return recoverPromise',
  'chrome.tabs.create({ url: CHATGPT_ROOT, active: false })',
  'await waitContent(Number(tab.id))',
  'composer_present === true',
  'IDLE_NO_SUPERVISOR_TAB',
  'maintainIfProvisioned("browser_start")',
  'writeHealth("IDLE", "install_lazy"'
]) assert.ok(source.includes(required), `missing singleton/lazy-session contract: ${required}`);

const maintainStart = source.indexOf('async function maintainIfProvisioned');
const maintainEnd = source.indexOf('chrome.alarms.onAlarm.addListener', maintainStart);
assert.ok(maintainStart >= 0 && maintainEnd > maintainStart);
const maintain = source.slice(maintainStart, maintainEnd);
assert.ok(maintain.includes('if (meta.tab_id || lease?.tab_id) return ensure(reason)'));
assert.ok(!maintain.includes('createRoot('), 'maintenance must not eagerly create a supervisor chat');

const createStart = source.indexOf('async function createRoot');
const ensureStart = source.indexOf('async function ensure', createStart);
const createRoot = source.slice(createStart, ensureStart);
assert.ok(createRoot.includes('existing?.tab_id') || createRoot.includes('existing.tab_id'));
assert.ok(createRoot.includes('expires > now'));
assert.ok(createRoot.includes('CREATE_LEASE_KEY'));
assert.ok(createRoot.includes('finally'));
assert.ok(createRoot.includes('current?.token === lease.token'));

const ensure = source.slice(ensureStart, source.indexOf('async function recover', ensureStart));
assert.ok(ensure.includes('if (!tab) return createRoot(`${reason}:missing_tab`)'));
assert.ok(ensure.includes('probeExhaustion(tab.id)'));
assert.ok(ensure.includes('snapshotFresh(snap)'));

assert.ok(!/setInterval\s*\(/.test(source), 'session lifecycle must use event/alarm driven maintenance, not tight interval polling');

console.log('A2 v0.6.7 supervisor singleton/lazy lifecycle contract: PASS');
