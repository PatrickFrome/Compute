import assert from "node:assert/strict";
import fs from "node:fs";

const supervisor=fs.readFileSync("supabase/functions/a2-browser-supervisor-v4-auth-canary/index.ts","utf8");
const device=fs.readFileSync("supabase/functions/a2-browser-device-auth-v2-canary/index.ts","utf8");
const entry=fs.readFileSync("coordination/chat-control-plane/extension/background-entry.js","utf8");

assert.match(supervisor,/h205f22_a2_browser_device_consume_nonce_v2/);
assert.match(supervisor,/device_signature_required/);
assert.match(supervisor,/SIGNED_BODY_HASH_MISMATCH/);
assert.match(supervisor,/SIGNED_DEVICE_INVALID/);
assert.match(supervisor,/authenticated_device_id/);
assert.match(supervisor,/h205f22_a2_browser_supervisor_lease_bootstrap_v3/);
assert.doesNotMatch(supervisor,/x-a2-chat-bridge-secret/);
assert.doesNotMatch(supervisor,/PAIRING_TABLE/);

assert.match(device,/h205f22_a2_browser_device_enroll_v1/);
assert.match(device,/h205f22_a2_browser_device_consume_nonce_v2/);
assert.match(device,/p_request_timestamp:timestamp/);
assert.match(device,/device_private_material_rejected|device_public_jwk_invalid/);

const transportIndex=entry.indexOf('importScripts("./supervisor-transport-v063.js");');
const routerIndex=entry.indexOf('importScripts("./supervisor-fetch-router-v063.js");');
const clientIndex=entry.indexOf('importScripts("./supervisor-client-v063.js");');
const bootstrapIndex=entry.indexOf('importScripts("./supervisor-bootstrap-v063.js");');
assert.ok(transportIndex>=0&&routerIndex>transportIndex&&clientIndex>routerIndex&&bootstrapIndex>clientIndex,"signed supervisor load order invalid");

console.log("a2_v063_signed_supervisor_edge_contract_lab: PASS");
