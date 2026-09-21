// E2E-клиент локальной командной плоскости METAENGINE (T5-репетиция).
// Полный device-контур против edge на http://127.0.0.1:3031:
//   enrollment (P-256 proof) -> [оператор-гейт: DB approve] -> activation
//   -> signed /v1/state -> DB issue -> signed /v1/commands/next-batch (lease)
//   -> signed /v1/commands/result-batch (receipt) -> readback.
// Запуск: bun test-e2e.ts

const EDGE = process.env.A2_EDGE_URL || 'http://127.0.0.1:3031';
const MARKER = '/a2-browser-native-supervisor-v1';
const PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';
const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'; // канонический workspace edge

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(new Uint8Array(buf as Uint8Array)).toString('base64url');
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (v: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(v)));

async function sha256Buf(v: string) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(v)));
}

// --- БД-хелперы (оператор-гейт эмулируется локальным psql) ---
const PSQL = ['psql', '-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'postgres', '-qAtc'];
async function db(sqlText: string): Promise<string> {
  const proc = Bun.spawnSync([...PSQL, sqlText], {
    env: { ...process.env, PGPASSWORD: 'postgres' },
  });
  return proc.stdout.toString().trim();
}

// --- ключ устройства ---
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pubJwkRaw = await crypto.subtle.exportKey('jwk', kp.publicKey);
const publicJwk = { crv: 'P-256', ext: true, key_ops: ['verify'], kty: 'EC', x: pubJwkRaw.x, y: pubJwkRaw.y }; // порядок ключей = канонизации edge (canonicalJwk)
const fingerprint = await sha256(JSON.stringify(publicJwk));
const clientId = `e2e-local-${Date.now().toString(36)}`;
const clientSecret = b64u(crypto.getRandomValues(new Uint8Array(24))); // nonce-entropy

async function signEnroll(path: string, bodyText: string, ts: string, nonce: string) {
  const material = [
    'METAENGINE_NATIVE_ENROLLMENT_V1',
    `client_id:${clientId}`,
    `profile:${PROFILE}`,
    `fingerprint:${fingerprint}`,
    `timestamp:${ts}`,
    `nonce:${nonce}`,
    `body_sha256:${await sha256(bodyText)}`,
  ].join('\n');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc.encode(material));
  return sig;
}

async function signDevice(deviceId: string, method: string, path: string, bodyText: string, ts: string, nonce: string) {
  const bodyHash = await sha256(bodyText);
  const material = [
    PROFILE,
    `device_id:${deviceId}`,
    `method:${method}`,
    `path:${path}`,
    `timestamp:${ts}`,
    `nonce:${nonce}`,
    `body_sha256:${bodyHash}`,
  ].join('\n');
  return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc.encode(material));
}

function enrollHeaders(ts: string, nonce: string, sig: ArrayBuffer, bodyHash: string) {
  return {
    'content-type': 'application/json',
    'x-a2-chat-bridge-client': clientId,
    'x-metaengine-enroll-timestamp': ts,
    'x-metaengine-enroll-nonce': nonce,
    'x-metaengine-enroll-signature': b64u(sig),
  };
}

function deviceHeaders(deviceId: string, ts: string, nonce: string, sig: ArrayBuffer, bodyHash: string) {
  return {
    'content-type': 'application/json',
    'x-a2-chat-bridge-client': clientId,
    'x-a2-device-profile': PROFILE,
    'x-a2-device-id': deviceId,
    'x-a2-device-timestamp': ts,
    'x-a2-device-nonce': nonce,
    'x-a2-device-body-sha256': bodyHash,
    'x-a2-device-signature': b64u(sig),
  };
}

const results: Array<[string, boolean, string]> = [];
const ok = (name: string, pass: boolean, detail = '') => {
  results.push([name, pass, detail]);
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

// === 1. health ===
const health = await (await fetch(`${EDGE}${MARKER}/health`)).json();
ok('T2 health', health?.ok === true && health?.backend_transport === 'DIRECT_POSTGRES', `wait=${health?.command_wait_batch}`);

// === 2. enrollment request ===
{
  const body = JSON.stringify({
    public_jwk: publicJwk,
    profile: PROFILE,
    key_fingerprint_sha256: fingerprint,
    metadata: { shell_version: '0.7.0-dev.35532004761.1', client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE' },
  });
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const sig = await signEnroll('/v1/device/enrollment/request', body, ts, nonce);
  const res = await fetch(`${EDGE}${MARKER}/v1/device/enrollment/request`, {
    method: 'POST', headers: enrollHeaders(ts, nonce, sig, await sha256(body)), body,
  });
  const j = await res.json();
  if (!j?.request_id) console.error('[e2e] enrollment response:', res.status, JSON.stringify(j).slice(0, 300));
  ok('T2 enrollment request', res.status === 202 && j?.accepted === true && j?.status === 'PENDING', `request_id=${j?.request_id}`);
  (globalThis as any).__req = j;
}

// === 3. оператор-гейт (локальный оператор одобряет заявку в БД) ===
{
  const reqId = (globalThis as any).__req.request_id;
  const n = await db(
    `update public.compute_fabric_a2_browser_device_enrollment_request_h205f22 set status='APPROVED', approved_at=now() where request_id='${reqId}' returning request_id;`,
  );
  ok('OP operator-approve gate', n === reqId, 'status=APPROVED (zero-authority: gate is operator-only, here emulated in DB)');
}

// === 4. enrollment status -> activation (ACTIVATE_RPC) ===
{
  const reqId = (globalThis as any).__req.request_id;
  const body = JSON.stringify({ request_id: reqId, public_jwk: publicJwk, profile: PROFILE, key_fingerprint_sha256: fingerprint });
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const sig = await signEnroll('/v1/device/enrollment/status', body, ts, nonce);
  const res = await fetch(`${EDGE}${MARKER}/v1/device/enrollment/status`, {
    method: 'POST', headers: enrollHeaders(ts, nonce, sig, await sha256(body)), body,
  });
  const j = await res.json();
  ok('T2 device activation', res.status === 200 && j?.accepted === true && /^[0-9a-f-]{36}$/.test(j?.device_id || ''), `device_id=${j?.device_id}`);
  (globalThis as any).__dev = j;
}

const deviceId = (globalThis as any).__dev.device_id;

// === 5. signed heartbeat /v1/state ===
{
  const body = JSON.stringify({
    state: {
      shell_version: '0.7.0-dev.35532004761.1',
      supervisor_mode: 'CONTROL',
      armed: true,
      operator_mode: 'OPERATOR_LOCAL_E2E',
    },
  });
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const sig = await signDevice(deviceId, 'POST', MARKER + '/v1/state', body, ts, nonce);
  const res = await fetch(`${EDGE}${MARKER}/v1/state`, {
    method: 'POST', headers: deviceHeaders(deviceId, ts, nonce, sig, await sha256(body)), body,
  });
  const j = await res.json();
  ok('T2 signed heartbeat', res.status === 202 && j?.accepted === true, 'state upsert via edge (per-plane merge)');
}

// === 6. issue (эмуляция chat-plane: команда в БД) -> lease через edge ===
let leaseEnvelope: any = null;
let myCommandId = '';
{
  myCommandId = await db(
    `insert into public.compute_fabric_a2_browser_supervisor_command_h205f22 (workspace_id, issued_by, action, payload)
     values ('${WORKSPACE_ID}','e2e-local-chat','POLL','{}') returning command_id;`,
  );
  const body = JSON.stringify({ supervisor_mode: 'CONTROL', max_batch: 16, max_tab_mutations: 8 });
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const sig = await signDevice(deviceId, 'POST', MARKER + '/v1/commands/next-batch', body, ts, nonce);
  const res = await fetch(`${EDGE}${MARKER}/v1/commands/next-batch`, {
    method: 'POST', headers: deviceHeaders(deviceId, ts, nonce, sig, await sha256(body)), body,
  });
  leaseEnvelope = await res.json();
  if (!leaseEnvelope?.schema) console.error('[e2e] lease raw:', res.status, JSON.stringify(leaseEnvelope).slice(0, 400));
  const leased = Array.isArray(leaseEnvelope?.commands) ? leaseEnvelope.commands.length : 0;
  const mine = (leaseEnvelope?.commands || []).find((c: any) => c.command_id === myCommandId);
  ok('T5 lease via edge', res.status === 200 && leased >= 1 && !!mine, `leased=${leased}, своя команда в батче=${!!mine}`);
}

// === 7. result-batch (receipt) -> readback ===
{
  const cmd = (leaseEnvelope?.commands || []).find((c: any) => c.command_id === myCommandId);
  if (!cmd) throw new Error(`своя команда ${myCommandId} не в батче`);
  const body = JSON.stringify({
    results: [{
      command_id: cmd.command_id,
      action: cmd.action,
      ok: true,
      status: 'COMPLETED',
      receipt: { schema: 'metaengine.e2e.receipt.v1', ok: true, effect_outcome: 'CONFIRMED', note: 'local edge e2e' },
    }],
  });
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const sig = await signDevice(deviceId, 'POST', MARKER + '/v1/commands/result-batch', body, ts, nonce);
  const res = await fetch(`${EDGE}${MARKER}/v1/commands/result-batch`, {
    method: 'POST', headers: deviceHeaders(deviceId, ts, nonce, sig, await sha256(body)), body,
  });
  const j = await res.json();
  ok('T5 result-batch receipt', res.status === 200, JSON.stringify(j).slice(0, 80));
  const row = await db(
    `select status||' ok='||(receipt->>'ok')::text from public.compute_fabric_a2_browser_supervisor_command_h205f22 where command_id='${cmd.command_id}';`,
  );
  ok('T5 readback COMPLETED', row === 'COMPLETED ok=true', row);
}


// === 8. T11 POSTGRES_NOTIFY wake (wait-batch просыпается от pg_notify) ===
{
  const body = JSON.stringify({ supervisor_mode: 'CONTROL', wait_ms: 6000, max_batch: 16 });
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const sig = await signDevice(deviceId, 'POST', MARKER + '/v1/commands/wait-batch', body, ts, nonce);
  const t0 = Date.now();
  const pending = fetch(`${EDGE}${MARKER}/v1/commands/wait-batch`, {
    method: 'POST', headers: deviceHeaders(deviceId, ts, nonce, sig, await sha256(body)), body,
  }).then((r) => r.json());
  await Bun.sleep(1500); // wait-batch уже в long-poll (LISTEN glm_browser_pulse)
  const wakeCmdId = await db(
    `insert into public.compute_fabric_a2_browser_supervisor_command_h205f22 (workspace_id, target_client_id, issued_by, action, payload)
     values ('${WORKSPACE_ID}','${clientId}','e2e-local-chat','POLL','{}') returning command_id;`,
  );
  const j: any = await pending;
  const dt = Date.now() - t0;
  const wokeWithCommand = Array.isArray(j?.commands) && j.commands.some((c: any) => c.command_id === wakeCmdId);
  ok('T11 pg_notify wake', wokeWithCommand && dt < 5000, `wake за ${dt}ms (insert на ~1500ms, wait_ms=6000) wake_reason=${j?.wake_reason}`);
  // завершить разбуженную команду
  const ts2 = new Date().toISOString();
  const nonce2 = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const body2 = JSON.stringify({
    results: [{ command_id: wakeCmdId, action: 'POLL', ok: true, status: 'COMPLETED', receipt: { schema: 'metaengine.e2e.receipt.v1', ok: true, effect_outcome: 'CONFIRMED', note: 'wake test' } }],
  });
  const sig2 = await signDevice(deviceId, 'POST', MARKER + '/v1/commands/result-batch', body2, ts2, nonce2);
  const res2 = await fetch(`${EDGE}${MARKER}/v1/commands/result-batch`, {
    method: 'POST', headers: deviceHeaders(deviceId, ts2, nonce2, sig2, await sha256(body2)), body: body2,
  });
  const st = await db(`select status from public.compute_fabric_a2_browser_supervisor_command_h205f22 where command_id='${wakeCmdId}';`);
  ok('T11 woken command completed', res2.status === 200 && st === 'COMPLETED', st);
}

// === 8. статус-сводка ===
console.log('\n=== ИТОГ ===');
const pass = results.filter((r) => r[1]).length;
console.log(`${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
