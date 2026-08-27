import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "supabase/functions/a2-browser-supervisor-v4-canary/index.ts");
const source = fs.readFileSync(file, "utf8");

assert.match(source, /DEVICE_PROFILE='A2_DEVICE_HTTP_SIGNATURE_V1'/);
assert.match(source, /h205f22_a2_browser_device_enroll_v1/);
assert.match(source, /h205f22_a2_browser_device_consume_nonce_v2/);
assert.match(source, /crypto\.subtle\.importKey\('jwk'/);
assert.match(source, /crypto\.subtle\.verify\(\{name:'ECDSA',hash:'SHA-256'\}/);
assert.match(source, /BODY_HASH_MISMATCH/);
assert.match(source, /INVALID_SIGNATURE/);
assert.match(source, /NONCE_REJECTED/);
assert.match(source, /device_auth_required:true/);
assert.match(source, /transport_identity/);
assert.match(source, /key_fingerprint_sha256:fingerprint/);
assert.match(source, /fingerprint=await sha256\(JSON\.stringify\(jwk\)\)/, "enrollment fingerprint must be server-derived");

const verifyIndex = source.indexOf("crypto.subtle.verify");
const nonceIndex = source.indexOf("h205f22_a2_browser_device_consume_nonce_v2");
assert.ok(verifyIndex > 0 && nonceIndex > verifyIndex, "nonce must be consumed only after signature verification");

const enrollRoute = source.indexOf("path==='/v1/device/enroll'");
const signedAuth = source.indexOf("authenticateDevice(req,path,bodyText)");
assert.ok(enrollRoute > 0 && signedAuth > enrollRoute, "pairing enrollment must be handled before signed-only privileged routes");

const serveTail = source.slice(source.indexOf("Deno.serve"));
assert.match(serveTail, /path==='\/health'/);
assert.match(serveTail, /path==='\/v1\/device\/enroll'/);
assert.match(serveTail, /authenticateDevice\(req,path,bodyText\)/);
assert.doesNotMatch(serveTail.slice(signedAuth), /pairingTokenHash\(req\)/, "privileged routes must not bearer-fallback after signed authentication starts");

for (const header of [
  "x-a2-device-profile", "x-a2-device-id", "x-a2-device-timestamp",
  "x-a2-device-nonce", "x-a2-device-body-sha256", "x-a2-device-signature"
]) assert.match(source, new RegExp(header));

console.log("a2_v063_supervisor_device_edge_contract_lab: PASS", {
  signatureBeforeNonce: verifyIndex < nonceIndex,
  serverDerivedFingerprint: true,
  privilegedBearerFallback: false
});
