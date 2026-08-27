import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const ext=path.join(root,'coordination/chat-control-plane/extension');
const html=fs.readFileSync(path.join(ext,'sidepanel.html'),'utf8');
const css=fs.readFileSync(path.join(ext,'sidepanel.css'),'utf8');
const js=fs.readFileSync(path.join(ext,'sidepanel.js'),'utf8');
const sup=fs.readFileSync(path.join(ext,'sidepanel-supervisor.js'),'utf8');
const entry=fs.readFileSync(path.join(ext,'background-entry.js'),'utf8');
const activeClientName=entry.includes('supervisor-client-v063.js')?'supervisor-client-v063.js':'supervisor-client.js';
const client=fs.readFileSync(path.join(ext,activeClientName),'utf8');
const signedTransport=entry.includes('supervisor-transport-v063.js')?fs.readFileSync(path.join(ext,'supervisor-transport-v063.js'),'utf8'):'';

function idsFrom(source){return [...source.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]);}
const required=new Set([...idsFrom(js),...idsFrom(sup)]);
for(const id of required) assert.match(html,new RegExp(`id=["']${id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']`),`sidepanel missing #${id}`);

for(const id of ['supervisorBadge','supervisorOff','supervisorMonitor','supervisorControl','supervisorLink','supervisorCommand','supervisorReceipt','supervisorTimeline','bridgePulse','supervisorPulse','gatePulse']) assert.ok(required.has(id),`supervisor UI not wired: ${id}`);
assert.match(html,/Strict causal lane/);
assert.match(html,/Chat Supervisor/);
assert.match(html,/Live timeline/);
assert.match(html,/<script src="sidepanel\.js"><\/script>\s*<script src="sidepanel-supervisor\.js"><\/script>/);
if(signedTransport){
  assert.match(entry,/importScripts\("\.\/operator-semantic-actions\.js"\);\s*importScripts\("\.\/supervisor-transport-v063\.js"\);\s*importScripts\("\.\/supervisor-fetch-router-v063\.js"\);\s*importScripts\("\.\/supervisor-client-v063\.js"\);/);
  assert.match(signedTransport,/A2_DEVICE_SIGN_REQUEST/);
  assert.match(signedTransport,/headers\.delete\("x-a2-chat-bridge-secret"\)/);
}else{
  assert.match(entry,/importScripts\("\.\/operator-semantic-actions\.js"\);\s*importScripts\("\.\/supervisor-client(?:-v063)?\.js"\);/);
}
assert.match(css,/\.causal-lane/);
assert.match(css,/\.timeline-item/);
assert.match(client,/supervisor_local_control_required/);
assert.match(client,/new Set\(\[\s*"ARM"/);
assert.match(client,/A2_SUPERVISOR_SET_MODE/);
assert.match(client,/CONTROL/);
assert.doesNotMatch(client,/SEMANTIC_CLICK["']/);
assert.doesNotMatch(client,/CLICK_POINT["']/);
assert.doesNotMatch(client,/EXECUTE_JS/);
assert.doesNotMatch(client,/eval\(command/);
assert.match(client,/A2_BRIDGE_CLIENT_ID/);

console.log('a2_v060_sidepanel_board_lab: PASS',{requiredIds:required.size,activeClientName,signedTransport:Boolean(signedTransport)});
