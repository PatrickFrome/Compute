import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client.mjs';
import { ENROLLMENT_SIGNATURE_PROFILE, SupervisorDeviceIdentity, SUPERVISOR_DEVICE_PROFILE } from '../src/supervisor-device-identity.mjs';

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8').replace(/^enc:/, ''),
};

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function verifyP1363(publicJwk, material, signature) {
  return crypto.verify('sha256', Buffer.from(material, 'utf8'), {
    key: crypto.createPublicKey({ key: publicJwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }, Buffer.from(signature, 'base64url'));
}

test('native supervisor device identity persists encrypted private key and signs enrollment/device requests', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-supervisor-'));
  const statePath = path.join(dir, 'device.json');
  const identity = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const first = await identity.ensure();
  assert.equal(first.profile, SUPERVISOR_DEVICE_PROFILE);
  assert.equal(first.enrolled, false);
  assert.match(first.key_fingerprint_sha256, /^[0-9a-f]{64}$/);

  const stored = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.ok(stored.encrypted_private_key_b64);
  assert.equal(JSON.stringify(stored).includes('PRIVATE KEY'), false);

  const bodyText = JSON.stringify({ hello: 'enroll' });
  const timestamp = '2026-08-29T12:00:00.000Z';
  const nonce = 'abcdefghijklmnopqrstuvwx';
  const headers = await identity.enrollmentHeaders(bodyText, { timestamp, nonce });
  const material = [
    ENROLLMENT_SIGNATURE_PROFILE,
    `client_id:${first.client_id}`,
    `profile:${SUPERVISOR_DEVICE_PROFILE}`,
    `fingerprint:${first.key_fingerprint_sha256}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `body_sha256:${hash(bodyText)}`,
  ].join('\n');
  assert.equal(verifyP1363(first.public_jwk, material, headers['x-metaengine-enroll-signature']), true);

  const deviceId = crypto.randomUUID();
  await identity.bindDevice(deviceId);
  const deviceBody = JSON.stringify({ state: true });
  const deviceHeaders = await identity.deviceHeaders('POST', '/a2-browser-native-supervisor-v1/v1/state', deviceBody, { timestamp, nonce });
  const deviceMaterial = [
    SUPERVISOR_DEVICE_PROFILE,
    `device_id:${deviceId}`,
    'method:POST',
    'path:/a2-browser-native-supervisor-v1/v1/state',
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
    `body_sha256:${hash(deviceBody)}`,
  ].join('\n');
  assert.equal(verifyP1363(first.public_jwk, deviceMaterial, deviceHeaders['x-a2-device-signature']), true);

  const reloaded = new SupervisorDeviceIdentity({ statePath, secureStorage });
  assert.equal((await reloaded.ensure()).device_id, deviceId);
});

test('native supervisor client completes approval enrollment then executes leased local DISARM', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-supervisor-client-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  const requestId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const seen = [];
  let statusCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    seen.push({ pathname, method: init.method, body: init.body || '' });
    if (pathname.endsWith('/v1/device/enrollment/request')) return new Response(JSON.stringify({ accepted:true, request_id:requestId, status:'PENDING' }), { status:202, headers:{'content-type':'application/json'} });
    if (pathname.endsWith('/v1/device/enrollment/status')) {
      statusCalls += 1;
      return new Response(JSON.stringify({ accepted:true, request_id:requestId, device_id:deviceId, status:'CLAIMED' }), { status:200, headers:{'content-type':'application/json'} });
    }
    if (pathname.endsWith('/v1/state')) return new Response(JSON.stringify({ accepted:true }), { status:202, headers:{'content-type':'application/json'} });
    if (pathname.endsWith('/v1/commands/next')) return new Response(JSON.stringify({ command:{ command_id:crypto.randomUUID(), action:'DISARM', payload:{}, issued_at:new Date().toISOString(), expires_at:new Date(Date.now()+60000).toISOString() } }), { status:200, headers:{'content-type':'application/json'} });
    if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) return new Response(JSON.stringify({ accepted:true }), { status:200, headers:{'content-type':'application/json'} });
    throw new Error(`unexpected_fetch:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version:'0.6.0',
    intervalMs:60000,
    getState: async () => ({ tabs:[], active_tab:null, development_plane:null, fleet:null, perception:null }),
    executeCommand: async () => { throw new Error('external executor must not handle DISARM'); },
  });
  await client.cycle();
  assert.equal(client.snapshot().enrollment_status, 'PENDING');
  await client.cycle();
  assert.equal(statusCalls, 1);
  assert.equal(client.snapshot().identity.device_id, deviceId);
  assert.equal(client.snapshot().armed, false);
  assert.equal(client.snapshot().last_command_status, 'COMPLETED');
  assert.ok(seen.some((row) => row.pathname.endsWith('/v1/state')));
  assert.ok(seen.some((row) => row.pathname.endsWith('/v1/commands/next')));
});

test('CONTROL_CAPABILITIES is handled locally as read-only and never delegated to page executor', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-supervisor-capabilities-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  await identity.ensure();
  await identity.bindDevice(crypto.randomUUID());
  let commandIssued = false;
  let postedReceipt = null;
  const commandId = crypto.randomUUID();
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return new Response('{}', { status:202, headers:{'content-type':'application/json'} });
    if (pathname.endsWith('/v1/commands/next')) {
      if (commandIssued) return new Response(JSON.stringify({ command:null }), { status:200, headers:{'content-type':'application/json'} });
      commandIssued = true;
      return new Response(JSON.stringify({ command:{ command_id:commandId, action:'CONTROL_CAPABILITIES', payload:{}, issued_at:new Date().toISOString(), expires_at:new Date(Date.now()+60000).toISOString() } }), { status:200, headers:{'content-type':'application/json'} });
    }
    if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) {
      postedReceipt = JSON.parse(init.body || '{}');
      return new Response('{}', { status:200, headers:{'content-type':'application/json'} });
    }
    throw new Error(`unexpected_fetch:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version:'0.6.0',
    intervalMs:60000,
    getState: async () => ({ tabs:[], active_tab:null, development_plane:null, fleet:null, perception:null }),
    executeCommand: async () => { throw new Error('CONTROL_CAPABILITIES must remain local'); },
  });
  await client.cycle();
  assert.equal(client.snapshot().last_command_status, 'COMPLETED');
  assert.equal(postedReceipt?.ok, true);
  assert.equal(postedReceipt?.receipt?.result?.schema, 'metaengine.browser-control-capabilities.v2');
  assert.equal(postedReceipt?.receipt?.result?.authority_effect, false);
  assert.ok(postedReceipt?.receipt?.result?.implemented?.some((row) => row.action === 'CONTROL_CAPABILITIES' && row.effect === 'READ_ONLY'));
  assert.equal(postedReceipt?.receipt?.result?.invariants?.arbitrary_eval, false);
  await fs.rm(dir, { recursive:true, force:true });
});

test('native semantic perception exposes unique accessibility targets and typed click uses CDP point actuation', async () => {
  const calls = [];
  const nodes = [
    { ignored:false, role:{value:'button'}, name:{value:'Send'}, backendDOMNodeId:42 },
    { ignored:false, role:{value:'textbox'}, name:{value:'Message'}, backendDOMNodeId:43 },
    { ignored:false, role:{value:'StaticText'}, name:{value:'Visible response text'}, backendDOMNodeId:44 },
  ];
  const dbg = {
    attached:false,
    isAttached() { return this.attached; },
    attach() { this.attached=true; calls.push(['attach']); },
    detach() { this.attached=false; calls.push(['detach']); },
    async sendCommand(method, params) {
      calls.push([method, params || null]);
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport:{ clientWidth:1000, clientHeight:700, pageX:0, pageY:0, scale:1 } };
      if (method === 'DOM.getBoxModel') return { model:{ content:[10,20,110,20,110,70,10,70] } };
      return {};
    },
  };
  const webContents = { debugger:dbg, isDestroyed:()=>false, getURL:()=> 'https://chatgpt.com/c/test', getTitle:()=> 'ChatGPT' };
  const frame = await captureSemanticFrame(webContents);
  assert.equal(frame.semantic_targets.length, 2);
  assert.equal(frame.text_excerpt, 'Visible response text');
  const result = await executeSemanticCommand(webContents, { action:'TYPED_CLICK', payload:{ role:'button', accessible_name:'Send' } });
  assert.equal(result.target.backend_node_id, 42);
  assert.equal(result.point.x, 60);
  assert.equal(result.point.y, 45);
  assert.ok(calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
});

test('dedicated STOP_GENERATION recognizes current Russian ChatGPT stop-response control', async () => {
  const calls = [];
  const nodes = [
    { ignored:false, role:{value:'button'}, name:{value:'Остановить ответ'}, backendDOMNodeId:77 },
  ];
  const dbg = {
    attached:false,
    isAttached() { return this.attached; },
    attach() { this.attached=true; },
    detach() { this.attached=false; },
    async sendCommand(method, params) {
      calls.push([method, params || null]);
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      if (method === 'DOM.getBoxModel') return { model:{ content:[0,0,100,0,100,40,0,40] } };
      return {};
    },
  };
  const webContents = { debugger:dbg, isDestroyed:()=>false };
  const result = await executeSemanticCommand(webContents, { action:'STOP_GENERATION', payload:{} });
  assert.equal(result.target.name, 'Остановить ответ');
  assert.equal(result.target.backend_node_id, 77);
  assert.equal(result.authority_effect, true);
  assert.ok(calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
});
