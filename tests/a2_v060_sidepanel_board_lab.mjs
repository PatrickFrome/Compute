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
const activeClientName=entry.includes('supervisor-client-v063-authority.js')
  ? 'supervisor-client-v063-authority.js'
  : entry.includes('supervisor-client-v063.js')
    ? 'supervisor-client-v063.js'
    : 'supervisor-client.js';
const client=fs.readFileSync(path.join(ext,activeClientName),'utf8');

function idsFrom(source){return [...source.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]);}
const required=new Set([...idsFrom(js),...idsFrom(sup)]);
for(const id of required) assert.match(html,new RegExp(`id=["']${id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']`),`sidepanel missing #${id}`);

for(const id of ['supervisorBadge','supervisorOff','supervisorMonitor','supervisorControl','supervisorLink','supervisorCommand','supervisorReceipt','supervisorTimeline','bridgePulse','supervisorPulse','gatePulse']) assert.ok(required.has(id),`supervisor UI not wired: ${id}`);
assert.match(html,/Strict causal lane/);
assert.match(html,/Chat Supervisor/);
assert.match(html,/Live timeline/);
assert.match(html,/<script src="sidepanel\.js"><\/script>\s*<script src="sidepanel-supervisor\.js"><\/script>/);

const semanticImport='importScripts("./operator-semantic-actions.js");';
const sessionImport='importScripts("./supervisor-chat-session-v063.js");';
const clientImport=`importScripts("./${activeClientName}");`;
const semanticIndex=entry.indexOf(semanticImport);
const sessionIndex=entry.indexOf(sessionImport);
const clientIndex=entry.indexOf(clientImport);
assert.ok(semanticIndex>=0,'operator semantic actions must be active');
assert.ok(clientIndex>semanticIndex,'supervisor authority client must load after semantic actions');
if(sessionIndex>=0){
  assert.ok(sessionIndex>semanticIndex,'supervisor session manager must load after semantic actions');
  assert.ok(clientIndex>sessionIndex,'supervisor authority client must load after supervisor session manager');
}

assert.match(css,/\.causal-lane/);
assert.match(css,/\.timeline-item/);
assert.match(client,/supervisor_(?:local_)?control_required/);
assert.match(client,/new Set\(\[\s*"ARM"/);
assert.match(client,/A2_SUPERVISOR_SET_MODE/);
assert.match(client,/CONTROL/);
assert.doesNotMatch(client,/SEMANTIC_CLICK["']/);
assert.doesNotMatch(client,/CLICK_POINT["']/);
assert.doesNotMatch(client,/EXECUTE_JS/);
assert.doesNotMatch(client,/eval\(command/);
assert.match(client,/A2_GET_PAIRING_SECRET/);
assert.match(client,/A2_BRIDGE_CLIENT_ID/);

if(activeClientName==='supervisor-client-v063-authority.js'){
  assert.match(client,/SET_SUPERVISOR_MODE/);
  assert.match(client,/BOOTSTRAP_ACTIONS/);
  assert.match(client,/a2-browser-supervisor-v3-canary/);
  assert.doesNotMatch(client,/body_excerpt/);
  assert.ok(sessionIndex>=0,'v0.6.3 authority client requires the self-healing supervisor session manager');
}

console.log('a2_v060_sidepanel_board_lab: PASS',{requiredIds:required.size,activeClientName,sessionManager:sessionIndex>=0});