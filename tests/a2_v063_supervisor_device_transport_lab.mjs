import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = fs.readFileSync(path.join(process.cwd(), "coordination/chat-control-plane/extension/supervisor-device-transport-v063.js"), "utf8");
const LEGACY = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary";
const V4 = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4-canary";
const secret = "s".repeat(48);
const client = "client-device-auth-v063";
let enrolled = false;
let enrollCalls = 0;
let clearCalls = 0;
let signCalls = 0;
let nativeMode = "ok";
let recoverableSeen = false;
const nativeCalls = [];
const signedPaths = [];

const nativeFetch = async (input, init = {}) => {
  const url = String(input);
  const headers = new Headers(init.headers || {});
  nativeCalls.push({ url, method: String(init.method || "GET"), headers: Object.fromEntries(headers.entries()), body: init.body ?? "" });
  if (url.startsWith("https://example.com/")) return new Response(null, { status: 204 });
  if (!url.startsWith(V4)) throw new Error(`unexpected_native_url:${url}`);
  if (nativeMode === "invalid_signature") return new Response(JSON.stringify({ error: "supervisor_device_auth_required", reason: "INVALID_SIGNATURE" }), { status: 401, headers: { "content-type": "application/json" } });
  if (nativeMode === "pairing_revoked") return new Response(JSON.stringify({ error: "supervisor_device_auth_required", reason: "PAIRING_REVOKED" }), { status: 401, headers: { "content-type": "application/json" } });
  if (nativeMode === "recover_once" && !recoverableSeen) {
    recoverableSeen = true;
    return new Response(JSON.stringify({ error: "supervisor_device_auth_required", reason: "DEVICE_NOT_FOUND" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
};

const context = vm.createContext({ console, URL, Headers, Response, setTimeout, clearTimeout, fetch: nativeFetch });
context.globalThis = context;
context.A2_DEVICE_STATUS = async () => ({ enrolled, device_id: enrolled ? "11111111-1111-4111-8111-111111111111" : null });
context.A2_DEVICE_ENROLL = async (base, actualClient, actualSecret) => {
  assert.equal(base, V4);
  assert.equal(actualClient, client);
  assert.equal(actualSecret, secret);
  enrollCalls += 1;
  enrolled = true;
  return { accepted: true };
};
context.A2_DEVICE_CLEAR_ENROLLMENT = async () => { clearCalls += 1; enrolled = false; };
context.A2_DEVICE_SIGN_REQUEST = async (method, requestPath, body) => {
  signCalls += 1;
  signedPaths.push(requestPath);
  assert.ok(requestPath.startsWith("/a2-browser-supervisor-v4-canary/"), `signature path not runtime-service-bound: ${requestPath}`);
  assert.ok(!requestPath.startsWith("/functions/v1/"), `gateway-only prefix leaked into runtime signature path: ${requestPath}`);
  return {
    profile: "A2_DEVICE_HTTP_SIGNATURE_V1",
    device_id: "11111111-1111-4111-8111-111111111111",
    timestamp: "2026-08-27T13:20:00.000Z",
    nonce: `nonce_${String(signCalls).padStart(20, "0")}`,
    body_sha256: "a".repeat(64),
    signature_b64url: "A".repeat(86)
  };
};

vm.runInContext(source, context, { filename: "supervisor-device-transport-v063.js" });

const pass = await context.fetch("https://example.com/passthrough", { method: "POST", headers: { "x-test": "1" }, body: "x" });
assert.equal(pass.status, 204);
assert.equal(nativeCalls[0].url, "https://example.com/passthrough");
assert.equal(enrollCalls, 0);
assert.equal(signCalls, 0);

const headers = { "content-type": "application/json", "x-a2-chat-bridge-secret": secret, "x-a2-chat-bridge-client": client };
const first = await context.fetch(`${LEGACY}/v1/state`, { method: "POST", headers, body: "{}" });
assert.equal(first.status, 200);
assert.equal(enrollCalls, 1, "first signed request did not enroll device");
assert.equal(signCalls, 1);
assert.equal(signedPaths[0], "/a2-browser-supervisor-v4-canary/v1/state");
const firstWire = nativeCalls.at(-1);
assert.equal(firstWire.url, `${V4}/v1/state`);
assert.equal(firstWire.headers["x-a2-chat-bridge-secret"], undefined, "pairing bearer leaked onto privileged signed request");
assert.equal(firstWire.headers["x-a2-chat-bridge-client"], client);
assert.equal(firstWire.headers["x-a2-device-profile"], "A2_DEVICE_HTTP_SIGNATURE_V1");
assert.equal(firstWire.headers["x-a2-device-id"], "11111111-1111-4111-8111-111111111111");
assert.ok(firstWire.headers["x-a2-device-signature"]);

nativeMode = "invalid_signature";
const enrollBeforeInvalid = enrollCalls;
const clearBeforeInvalid = clearCalls;
const signBeforeInvalid = signCalls;
const invalid = await context.fetch(`${LEGACY}/v1/status`, { method: "GET", headers });
assert.equal(invalid.status, 401);
assert.equal(enrollCalls, enrollBeforeInvalid, "INVALID_SIGNATURE triggered forbidden re-enroll fallback");
assert.equal(clearCalls, clearBeforeInvalid, "INVALID_SIGNATURE cleared trusted enrollment");
assert.equal(signCalls, signBeforeInvalid + 1, "invalid signature request was unexpectedly retried");

nativeMode = "pairing_revoked";
const enrollBeforePairingRevoke = enrollCalls;
const clearBeforePairingRevoke = clearCalls;
const signBeforePairingRevoke = signCalls;
const revoked = await context.fetch(`${LEGACY}/v1/status`, { method: "GET", headers });
assert.equal(revoked.status, 401);
assert.equal(enrollCalls, enrollBeforePairingRevoke, "PAIRING_REVOKED triggered forbidden re-enroll fallback");
assert.equal(clearCalls, clearBeforePairingRevoke, "PAIRING_REVOKED cleared local enrollment and attempted recovery");
assert.equal(signCalls, signBeforePairingRevoke + 1, "PAIRING_REVOKED request was unexpectedly retried");

nativeMode = "recover_once";
recoverableSeen = false;
const enrollBeforeRecovery = enrollCalls;
const clearBeforeRecovery = clearCalls;
const signBeforeRecovery = signCalls;
const recovered = await context.fetch(`${LEGACY}/v1/commands/next`, { method: "POST", headers, body: JSON.stringify({ supervisor_mode: "CONTROL" }) });
assert.equal(recovered.status, 200);
assert.equal(clearCalls, clearBeforeRecovery + 1, "recoverable device loss did not clear stale enrollment");
assert.equal(enrollCalls, enrollBeforeRecovery + 1, "recoverable device loss did not re-enroll exactly once");
assert.equal(signCalls, signBeforeRecovery + 2, "recoverable request did not produce exactly one fresh signed retry");
const recoveryWire = nativeCalls.at(-1);
assert.equal(recoveryWire.url, `${V4}/v1/commands/next`);
assert.equal(recoveryWire.headers["x-a2-chat-bridge-secret"], undefined);

assert.match(source, /DEVICE_SIGNED_NO_BEARER_FALLBACK/);
assert.match(source, /headers\.delete\("x-a2-chat-bridge-secret"\)/);
assert.match(source, /SIGNED_RUNTIME_PREFIX/);
assert.match(source, /signaturePath: `\$\{SIGNED_RUNTIME_PREFIX\}/);
assert.doesNotMatch(source, /PAIRING_REVOKED/);
assert.doesNotMatch(source, /INVALID_SIGNATURE["']\s*\)/);

console.log("a2_v063_supervisor_device_transport_lab: PASS", {
  enrollCalls,
  clearCalls,
  signCalls,
  runtimeServiceBoundPaths: signedPaths.length,
  pairingKillSwitchNoFallback: true,
  supervisorWireCalls: nativeCalls.filter((call) => call.url.startsWith(V4)).length
});
