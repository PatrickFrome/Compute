import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {classifyNativeSpaHydration as reduce} from '../src/native-spa-hydration-proof.mjs';
import {collectNativeSpaHydration} from '../src/native-spa-hydration-cdp.mjs';
import {DevFleetOperator} from '../src/operator-core.mjs';
const tab='tab_11111111-1111-4111-8111-111111111111';
const process_epoch='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const url='https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const identity={tab_id:tab,process_epoch,webcontents_id:50,
 target_id:'webcontents:50',renderer_pid:22012,
 renderer_generation:0,navigation_generation:7};
const flags={is_loading:false,main_frame_loading:false,waiting_for_response:false};
const net={sampled:true,overflow:false,requests:0,failed:0,blocked:0,http_4xx:0,http_5xx:0};
const evidence={target_stable:true,identity,url,before:flags,after:flags,
 renderer_crashed:false,counts:{busy:0,composer:0,turns:0},network:net};
test('URL, PID and HTTP/DOM-only readback cannot prove SPA hydrated or Send',()=>{
 for(const c of [{busy:0,composer:0,turns:0},{busy:0,composer:1,turns:4},
                  {busy:0,composer:2,turns:10}]){
  const v=reduce({...evidence,counts:c,network:{...net,requests:8}});
  assert.equal(v.state,'UNKNOWN');
  for(const k of ['hydration_proven','send_authorized','completion_proven',
                  'authority_effect','effect_authority'])assert.equal(v[k],false);
  assert.equal(v.read_only,true);
 }
});
test('native document versus SPA in-document progress versus response wait',()=>{
 assert.equal(reduce({...evidence,after:{...flags,is_loading:true}}).reason,
   'NATIVE_DOCUMENT_LOADING');
 assert.equal(reduce({...evidence,counts:{busy:2,composer:0,turns:0}}).reason,
   'SPA_BUSY_AFTER_DOCUMENT_LOAD');
 assert.equal(reduce({...evidence,before:{...flags,waiting_for_response:true}}).reason,
   'NATIVE_RESPONSE_WAIT');
 assert.equal(reduce({...evidence,network:{...net,failed:1,http_5xx:2}}).reason,
   'NETWORK_FAILURE_BUCKET_OBSERVED');
});
test('missing or forged native identity, scope, generation and signal are UNKNOWN',()=>{
 for(const c of [
 {...evidence,target_stable:false},
 {...evidence,identity:{...identity,renderer_pid:0}},
 {...evidence,identity:{...identity,renderer_generation:null}},
 {...evidence,identity:{...identity,process_epoch:'forged'}},
 {...evidence,identity:{...identity,target_id:'webcontents:900'}},
 {...evidence,url:'https://evil.example/c/aaaa'},
 {...evidence,url:url+'?token=secret'},
 {...evidence,before:{...flags,is_loading:null}},
 {...evidence,renderer_crashed:null},
 {...evidence,counts:{busy:999999,composer:0,turns:0}},
 {...evidence,counts:{busy:0,composer:NaN,turns:0}},
 {...evidence,network:{...net,failed:-1}}
 ]){
  const r=reduce(c);assert.equal(r.state,'UNKNOWN');
  assert.equal(r.identity,null);
  assert.equal(r.send_authorized,false);
 }
});
test('unknown network coverage not represented as zero verified traffic',()=>{
 const r=reduce({...evidence,network:{...net,sampled:false}});
 assert.deepEqual(r.network,{coverage:'UNKNOWN'});
});
function fixture(options={}){
 const d=new EventEmitter();
 const called=[], wc={id:50,debugger:d};
 let pid=22012,nav=7,renderer=0,current=true,loading=false,crashed=false;
 d.isAttached=()=>true;
 d.sendCommand=async (command,args)=>{
  called.push({command,args});
  if(options.onCommand)options.onCommand(command,control,d);
  if(command==='DOM.getDocument')return {root:{nodeId:100}};
  if(command==='DOM.querySelectorAll'){
   if(args.selector.includes('aria-busy'))return {nodeIds:options.busy?[1,2]:[]};
   if(args.selector.includes('contenteditable'))return {nodeIds:options.composer?[3]:[]};
   return {nodeIds:options.turns?[4,5]:[]};
  }
  if(command==='Network.enable'&&options.networkFails)throw Error('network_off');
  return {};
 };
 wc.isDestroyed=()=>false;
 wc.getURL=()=>options.url||url;
 wc.getOSProcessId=()=>pid;
 wc.isCrashed=()=>crashed;
 wc.isLoading=()=>loading;
 wc.isLoadingMainFrame=()=>false;
 wc.isWaitingForResponse=()=>false;
 const control={called,d,changePid:x=>pid=x,changeNav:()=>nav++,
   changeRenderer:()=>renderer++,setCurrent:x=>current=x,
   setLoading:x=>loading=x,setCrashed:x=>crashed=x};
 const ctx={tab_id:tab,process_epoch,webContents:wc,
   isCurrent:()=>current,rendererGeneration:()=>renderer,
   navigationGeneration:()=>nav};
 return {ctx,control};
}
test('native CDP adapter issues observational commands only; redacts network and prompt content',async()=>{
 const {ctx,control}=fixture({busy:true,onCommand:(command,c,d)=>{
  if(command==='DOM.getDocument'){
   d.emit('message',{},'Network.requestWillBeSent',
     {request:{url:'https://sensitive.example/PRIVATE_PROMPT',headers:{Cookie:'secret'}}});
   d.emit('message',{},'Network.loadingFailed',
     {errorText:'PRIVATE_PROMPT',blockedReason:'PRIVATE_SECRET'});
   d.emit('message',{},'Network.responseReceived',
     {response:{status:503,url:'https://PRIVATE_PROMPT'}});
  }
 }});
 const r=await collectNativeSpaHydration(ctx);
 assert.equal(r.reason,'SPA_BUSY_AFTER_DOCUMENT_LOAD');
 assert.equal(r.identity.renderer_pid,22012);
 assert.equal(r.network.failed,1);
 assert.equal(r.network.http_5xx,1);
 assert.equal(r.network.coverage,'WINDOW_ONLY');
 assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
 assert.equal(JSON.stringify(r).includes('secret'),false);
 assert.equal(JSON.stringify(r).includes(url),false);
 assert.equal(control.d.listenerCount('message'),0);
 assert.deepEqual(control.called.map(x=>x.command),
   ['Network.enable','DOM.enable','DOM.getDocument',
    'DOM.querySelectorAll','DOM.querySelectorAll','DOM.querySelectorAll','Network.disable']);
 assert.equal(control.called.some(x=>/Runtime|Input|Page|Fetch/i.test(x.command)),false);
});
test('PID reuse / renderer generation / navigation change during native CDP fail closed',async()=>{
 for(const mutate of [
   c=>c.changePid(22111),c=>c.changeRenderer(),c=>c.changeNav(),
   c=>c.setCurrent(false)]){
  const {ctx,control}=fixture({onCommand:(command,c)=>{
   if(command==='DOM.getDocument')mutate(c);
  }});
  const r=await collectNativeSpaHydration(ctx);
  assert.equal(r.reason,'TARGET_CHANGED_OR_UNBOUND');
  assert.equal(r.identity,null);
  assert.equal(r.send_authorized,false);
  assert.equal(control.d.listenerCount('message'),0);
 }
});
test('CDP failure and absent renderer identity fail closed and remove listeners',async()=>{
 const a=fixture({networkFails:true,composer:true});
 assert.equal((await collectNativeSpaHydration(a.ctx)).network.coverage,'UNKNOWN');
 const b=fixture({onCommand:(cmd,ctl)=>{
   if(cmd==='DOM.getDocument')throw Error('raw secret');
 }});
 // Error is swallowed and no caller-visible native exception or page text.
 const r=await collectNativeSpaHydration(b.ctx);
 assert.equal(r.reason,'CDP_READBACK_FAILED');
 assert.equal(b.control.d.listenerCount('message'),0);
 const c=fixture();c.control.changePid(0);
 assert.equal((await collectNativeSpaHydration(c.ctx)).reason,'NATIVE_PROCESS_IDENTITY_UNKNOWN');
 assert.equal(c.control.called.length,0);
});
test('event floods are explicitly capped; no arbitrary event body returned',async()=>{
 const {ctx}=fixture({onCommand:(cmd,c,d)=>{
  if(cmd==='DOM.getDocument')for(let i=0;i<300;i++)
   d.emit('message',{},'Network.loadingFailed',{errorText:'PRIVATE_'+i});
 }});
 const r=await collectNativeSpaHydration(ctx);
 assert.equal(r.reason,'NETWORK_EVENT_BUDGET_EXCEEDED');
 assert.equal(r.network.overflow,true);
 assert.ok(r.network.failed<=128);
 assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);
});
test('existing leased operator rejects forged positive hydration and cannot send on inspect',async()=>{
 let sends=0,probe=()=>reduce(evidence);
 const adapter={create:async(tab_id,u)=>({tab_id,url:u}),
  read:async()=>({}),send:async()=>{sends++;},
  hydrationProbe:async()=>probe()};
 const store={load:async()=>null,save:async()=>{}};
 const op=new DevFleetOperator({adapter,store});await op.init();
 const owned=(await op.create({request_id:'hydration-create-001',count:1})).sessions[0].tab_id;
 probe=()=>reduce({...evidence,identity:{...identity,tab_id:owned}});
 await assert.rejects(op.inspectHydration({tab_id:'tab_99999999-9999-4999-8999-999999999999'}),
   /operator_tab_not_owned/);
 const result=await op.inspectHydration({tab_id:owned});
 assert.equal(result.state,'UNKNOWN');assert.equal(sends,0);
 probe=()=>({...reduce(evidence),hydration_proven:true});
 await assert.rejects(op.inspectHydration({tab_id:owned}),/hydration_probe_invalid/);
 assert.equal(sends,0);
});
