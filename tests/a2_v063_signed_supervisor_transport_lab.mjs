import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const transportSource = fs.readFileSync(path.join(ROOT,"coordination/chat-control-plane/extension/supervisor-transport-v063.js"),"utf8");
const routerSource = fs.readFileSync(path.join(ROOT,"coordination/chat-control-plane/extension/supervisor-fetch-router-v063.js"),"utf8");

const network = [];
const signCalls = [];
let enrolled = false;
let enrollCalls = 0;

const context = vm.createContext({
  console, Headers, Request, Response, URL, setTimeout, clearTimeout,
  fetch: async (input, init={}) => {
    network.push({url:String(input),init,headers:Object.fromEntries(new Headers(init.headers||{}).entries())});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json"}});
  }
});
context.globalThis = context;
context.A2_DEVICE_STATUS = async () => ({enrolled,device_id:enrolled?"11111111-1111-4111-8111-111111111111":null});
context.A2_GET_PAIRING_SECRET = async () => "PAIRING_SECRET_MUST_NOT_REACH_SUPERVISOR_1234567890";
context.A2_BRIDGE_CLIENT_ID = async () => "client-signed-v063";
context.A2_DEVICE_ENROLL = async (base,client,secret) => {
  enrollCalls += 1;
  assert.match(base,/a2-browser-device-auth-v2-canary$/);
  assert.equal(client,"client-signed-v063");
  assert.match(secret,/PAIRING_SECRET/);
  enrolled = true;
  return {device_id:"11111111-1111-4111-8111-111111111111"};
};
context.A2_DEVICE_SIGN_REQUEST = async (method,path,body) => {
  signCalls.push({method,path,body});
  return {
    profile:"A2_DEVICE_HTTP_SIGNATURE_V1",
    device_id:"11111111-1111-4111-8111-111111111111",
    timestamp:"2026-08-27T12:00:00.000Z",
    nonce:"abcdefghijklmnopQRSTUVWX",
    body_sha256:"a".repeat(64),
    signature_b64url:"B".repeat(86)
  };
};

vm.runInContext(transportSource,context,{filename:"supervisor-transport-v063.js"});
vm.runInContext(routerSource,context,{filename:"supervisor-fetch-router-v063.js"});

const legacy="https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v2-canary";
await context.fetch(`${legacy}/v1/state`,{
  method:"POST",
  headers:{"x-a2-chat-bridge-secret":"LEAK_ME_NOT","x-a2-chat-bridge-client":"spoofed"},
  body:'{"state":{"armed":false}}'
});

assert.equal(enrollCalls,1,"first signed supervisor request must enroll device exactly once");
assert.equal(signCalls.length,1);
assert.deepEqual(signCalls[0],{method:"POST",path:"/v1/state",body:'{"state":{"armed":false}}'});
assert.equal(network.length,1);
assert.equal(network[0].url,"https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4-auth-canary/v1/state");
assert.equal(network[0].headers["x-a2-chat-bridge-secret"],undefined,"pairing secret leaked into supervisor transport");
assert.equal(network[0].headers["x-a2-chat-bridge-client"],"client-signed-v063","router preserved spoofed client id");
assert.equal(network[0].headers["x-a2-device-id"],"11111111-1111-4111-8111-111111111111");
assert.equal(network[0].headers["x-a2-device-profile"],"A2_DEVICE_HTTP_SIGNATURE_V1");
assert.equal(network[0].headers["x-a2-device-signature"],"B".repeat(86));

await context.fetch("https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary/v1/commands/bootstrap-next",{method:"POST",body:"{}"});
assert.equal(enrollCalls,1,"already enrolled device was enrolled again");
assert.equal(signCalls.at(-1).path,"/v1/commands/bootstrap-next");
assert.match(network.at(-1).url,/a2-browser-supervisor-v4-auth-canary\/v1\/commands\/bootstrap-next$/);

await context.fetch("https://example.com/not-supervisor",{method:"GET"});
assert.equal(network.at(-1).url,"https://example.com/not-supervisor","router intercepted unrelated fetch");

console.log("a2_v063_signed_supervisor_transport_lab: PASS",{enrollCalls,signCalls:signCalls.length,network:network.length});
