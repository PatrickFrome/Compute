import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const ext=path.join(root,'coordination/chat-control-plane/extension');
const html=fs.readFileSync(path.join(ext,'sidepanel.html'),'utf8');
const css=fs.readFileSync(path.join(ext,'sidepanel.css'),'utf8');
const js=fs.readFileSync(path.join(ext,'sidepanel.js'),'utf8');
const sup=fs.readFileSync(path.join(ext,'sidepanel-supervisor.js'),'utf8');
const client=fs.readFileSync(path.join(ext,'supervisor-client.js'),'utf8');

function idsFrom(source){return [...source.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]);}
const required=new Set([...idsFrom(js),...idsFrom(sup)]);
for(const id of required) assert.match(html,new RegExp(`id=["']${id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']`),`sidepanel missing #${id}`);

for(const id of ['supervisorBadge','supervisorOff','supervisorMonitor','supervisorControl','supervisorLink','supervisorCommand','supervisorReceipt','supervisorTimeline','bridgePulse','supervisorPulse','gatePulse']) assert.ok(required.has(id),`supervisor UI not wired: ${id}`);
assert.match(html,/Strict causal lane/);
assert.match(html,/Chat Supervisor/);
assert.match(html,/Live timeline/);
assert.match(css,/\.causal-lane/);
assert.match(css,/\.timeline-item/);
assert.match(client,/supervisor_local_control_required/);
assert.match(client,/new Set\(\[\s*"ARM"/);
assert.doesNotMatch(client,/SEMANTIC_CLICK["']/);
assert.doesNotMatch(client,/EXECUTE_JS/);
assert.doesNotMatch(client,/eval\(command/);
assert.match(client,/A2_GET_PAIRING_SECRET/);
assert.match(client,/A2_BRIDGE_CLIENT_ID/);

console.log('a2_v060_sidepanel_board_lab: PASS',{requiredIds:required.size});
