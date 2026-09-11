import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/compat-config.js'), 'utf8');
const local = new Map();
const alarmListeners = [];
const installedListeners = [];
const startupListeners = [];
let servedEnvelope = null;

function assert(condition, message) { if (!condition) throw new Error(message); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const hashText = (text) => crypto.createHash('sha256').update(text).digest('hex');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
function storage(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
    },
    async set(items) { for (const [key, value] of Object.entries(items || {})) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const subtle = crypto.webcrypto.subtle;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicJwk = await subtle.exportKey('jwk', pair.publicKey);

async function makeEnvelope(epoch, payload, options = {}) {
  const created = options.created_at || new Date(Date.now() - 1000).toISOString();
  const expires = options.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const payloadHash = hashText(canonical(payload));
  const envelope = {
    schema: 'metaengine.a2-browser-operator.compat-pack.v1',
    epoch,
    created_at: created,
    expires_at: expires,
    min_extension_version: '0.6.0',
    max_extension_version: '0.6.99',
    payload,
    payload_sha256: payloadHash,
    signature_b64url: ''
  };
  const signedMaterial = canonical({
    schema: envelope.schema,
    epoch: envelope.epoch,
    created_at: envelope.created_at,
    expires_at: envelope.expires_at,
    min_extension_version: envelope.min_extension_version,
    max_extension_version: envelope.max_extension_version,
    payload_sha256: envelope.payload_sha256
  });
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signedMaterial));
  envelope.signature_b64url = b64url(new Uint8Array(signature));
  return envelope;
}

const chrome = {
  storage: { local: storage(local) },
  runtime: {
    getManifest: () => ({ version: '0.6.0' }),
    onInstalled: { addListener(fn) { installedListeners.push(fn); } },
    onStartup: { addListener(fn) { startupListeners.push(fn); } }
  },
  alarms: {
    async create() {},
    onAlarm: { addListener(fn) { alarmListeners.push(fn); } }
  }
};

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  crypto: crypto.webcrypto,
  TextEncoder,
  Uint8Array,
  atob,
  structuredClone,
  Date,
  JSON,
  Object,
  Array,
  Map,
  Set,
  Promise
});
context.globalThis = context;
context.A2_COMPAT_ROOT_JWK = publicJwk;
context.A2_BRIDGE_REQUEST = async (route) => {
  assert(route === '/v1/compatibility-pack', `unexpected route ${route}`);
  return new Response(JSON.stringify(servedEnvelope), { status: 200, headers: { 'content-type': 'application/json' } });
};
context.Response = Response;
vm.runInContext(source, context, { filename: 'compat-config.js' });

const payload1 = {
  features: { point_click_enabled: true, screenshot_sensor_enabled: true, prompt_gate_enabled: true },
  kill_switches: { autonomous_send_disabled: false, operator_actions_disabled: false },
  timeouts: { frame_max_age_ms: 30000, send_ready_ms: 2200 },
  adapters: {
    CHATGPT: { composer_selectors: ['#prompt-textarea'], send_selectors: ["button[data-testid='send-button']"], stop_labels: ['stop generating'] },
    GLM_ZAI: { composer_selectors: ['#chat-input'], send_selectors: ['#send-message-button'] }
  },
  protocol: { minimum_edge_protocol: 'A2_BROWSER_OPERATOR_EDGE_V7_CANARY' }
};

servedEnvelope = await makeEnvelope(1, payload1);
let result = await context.A2_COMPAT_REFRESH();
assert(result.applied === true && result.epoch === 1, 'valid signed pack was not applied');
assert(context.A2_COMPAT_GET('timeouts.frame_max_age_ms') === 30000, 'active config readback failed');
assert(local.get('a2OperatorCompatStatusV1')?.status === 'ACTIVE', 'active status missing');

const goodStored = structuredClone(local.get('a2OperatorCompatPackV1'));
servedEnvelope = await makeEnvelope(2, { ...payload1, features: { ...payload1.features, point_click_enabled: false } });
servedEnvelope.payload.features.point_click_enabled = true;
let tamperRejected = false;
try { await context.A2_COMPAT_REFRESH(); } catch (error) { tamperRejected = String(error?.message || error).includes('payload_hash_mismatch'); }
assert(tamperRejected, 'tampered payload was accepted');
assert(context.A2_COMPAT_GET('timeouts.frame_max_age_ms') === 30000, 'last-known-good config was lost after tamper');
assert(local.get('a2OperatorCompatPackV1')?.epoch === goodStored.epoch, 'rejected pack replaced persistent last-known-good');

servedEnvelope = await makeEnvelope(1, payload1);
let rollbackRejected = false;
try { await context.A2_COMPAT_REFRESH(); } catch (error) { rollbackRejected = String(error?.message || error).includes('epoch_not_monotonic'); }
assert(rollbackRejected, 'epoch rollback was accepted');

servedEnvelope = await makeEnvelope(2, { ...payload1, code: 'alert(1)' });
let codeRejected = false;
try { await context.A2_COMPAT_REFRESH(); } catch (error) { codeRejected = String(error?.message || error).includes('unknown_field:code'); }
assert(codeRejected, 'remote executable-like field was accepted');

servedEnvelope = await makeEnvelope(2, payload1, {
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
});
let expiryRejected = false;
try { await context.A2_COMPAT_REFRESH(); } catch (error) { expiryRejected = String(error?.message || error).includes('time_window_invalid'); }
assert(expiryRejected, 'expired pack was accepted');

assert(!source.includes('eval(') && !source.includes('new Function'), 'compat framework contains dynamic code execution');
console.log('A2 v0.6 Compatibility Pack Lab: PASS', JSON.stringify({ epoch: goodStored.epoch, status: local.get('a2OperatorCompatStatusV1')?.status }));
