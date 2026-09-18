import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT=process.cwd();
const file=path.join(ROOT,'coordination/chat-control-plane/extension/supervisor-client.js');
const source=fs.readFileSync(file,'utf8');

const local=new Map();
const session=new Map();
const messageListeners=[];
const alarmListeners=[];
const fetchCalls=[];
let queuedCommand=null;
let lastResult=null;
const sidepanelUrl='chrome-extension://unit/sidepanel.html';

function storageArea(map){return{
  async get(keys){const out={};for(const k of (Array.isArray(keys)?keys:[keys]))if(map.has(k))out[k]=map.get(k);return out;},
  async set(obj){for(const [k,v] of Object.entries(obj))map.set(k,v);},
  async remove(keys){for(const k of (Array.isArray(keys)?keys:[keys]))map.delete(k);}
}}
const chrome={
  runtime:{id:'unit',getURL:(p)=>`chrome-extension://unit/${p}`,getManifest:()=>({version:'0.6.0'}),onMessage:{addListener:(fn)=>messageListeners.push(fn)},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}},sendMessage:async()=>({ok:true})},
  storage:{local:storageArea(local),session:storageArea(session),onChanged:{addListener:()=>{}}},
  alarms:{create:()=>{},onAlarm:{addListener:(fn)=>alarmListeners.push(fn)}},
  tabs:{query:async()=>[],sendMessage:async()=>({ok:true})}
};

const context=vm.createContext({
  console,chrome,Headers,Response,Request,URL,TextEncoder,Uint8Array,crypto:globalThis.crypto,setTimeout,clearTimeout,
  fetch:async(input,init={})=>{
    const url=String(input);fetchCalls.push({url,init});
    if(url.endsWith('/v1/state'))return new Response(JSON.stringify({accepted:true}),{status:202,headers:{'content-type':'application/json'}});
    if(url.endsWith('/v1/commands/next')){const c=queuedCommand;queuedCommand=null;return new Response(JSON.stringify({command:c}),{status:200,headers:{'content-type':'application/json'}});}
    if(/\/v1\/commands\/[^/]+\/result$/.test(url)){lastResult=JSON.parse(String(init.body||'{}'));return new Response(JSON.stringify({accepted:true}),{status:200,headers:{'content-type':'application/json'}});}
    return new Response('{}',{status:404});
  }
});
context.globalThis=context;
context.A2_GET_PAIRING_SECRET=async()=> 'x'.repeat(64);
context.A2_BRIDGE_CLIENT_ID=async()=> 'client-test';
context.A2_OPERATOR_STOP_GENERATION=async()=>({ok:true,verification:'STOP_CONTROL_DISAPPEARED_OR_IDLE'});
context.A2_OPERATOR_SCROLL=async()=>({ok:true});
context.A2_OPERATOR_CAPTURE_PERCEPTION=async()=>({captured_at:new Date().toISOString(),url:'https://chatgpt.com/c/x',frame_token:'f',hashes:{},page:{body_text:'hello'},accessibility:[]});
context.A2_OPERATOR_SEMANTIC_ACTION=async()=>({ok:true});

vm.runInContext(source,context,{filename:file});
await new Promise(r=>setTimeout(r,20));

async function send(message,sender){
  for(const fn of messageListeners){
    let settled=false;let result;
    const ret=fn(message,sender,(value)=>{settled=true;result=value;});
    if(ret===true){for(let i=0;i<50&&!settled;i++)await new Promise(r=>setTimeout(r,2));return result;}
    if(settled)return result;
  }
  return undefined;
}

// Default is OFF; chat cannot execute a queued command merely because it exists.
assert.equal(local.get('a2SupervisorModeV1'),'OFF');
queuedCommand={command_id:'00000000-0000-4000-8000-000000000001',action:'ARM',platform:null,payload:{}};
await context.A2_SUPERVISOR_POLL();
assert.notEqual(local.get('armed'),true,'OFF mode executed remote ARM');
assert.ok(queuedCommand,'OFF mode should not lease the command');

// Untrusted extension/page sender cannot grant supervisor authority.
const denied=await send({type:'A2_SUPERVISOR_SET_MODE',mode:'CONTROL'},{id:'unit',url:'chrome-extension://unit/options.html'});
assert.equal(denied?.ok,false);
assert.equal(local.get('a2SupervisorModeV1'),'OFF');

// Trusted side panel locally enables CONTROL.
const granted=await send({type:'A2_SUPERVISOR_SET_MODE',mode:'CONTROL'},{id:'unit',url:sidepanelUrl});
assert.equal(granted?.ok,true);
assert.equal(local.get('a2SupervisorModeV1'),'CONTROL');

// Now a fixed ARM command can execute and is receipt-backed.
queuedCommand={command_id:'00000000-0000-4000-8000-000000000002',action:'ARM',platform:null,payload:{}};
await context.A2_SUPERVISOR_POLL();
assert.equal(local.get('armed'),true);
assert.equal(lastResult?.ok,true);
assert.equal(lastResult?.receipt?.action,'ARM');

// Supervisor v1 intentionally has no free-form click / JS execution command.
queuedCommand={command_id:'00000000-0000-4000-8000-000000000003',action:'SEMANTIC_CLICK',platform:'CHATGPT',payload:{role:'button',accessible_name:'Send'}};
await context.A2_SUPERVISOR_POLL();
assert.equal(lastResult?.ok,false);
assert.match(lastResult?.error||'',/action_not_allowed/);
assert.ok(!source.includes('EXECUTE_JS'));
assert.ok(!source.includes('eval(command'));

console.log('a2_v060_supervisor_control_lab: PASS',{fetchCalls:fetchCalls.length,mode:local.get('a2SupervisorModeV1'),armed:local.get('armed')});
