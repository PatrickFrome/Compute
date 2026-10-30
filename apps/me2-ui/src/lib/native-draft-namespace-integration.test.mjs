import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readClientDraftScope} from '../../../metaengine-browser/src/client-draft-scope.mjs';
import {createDraftScopeResource} from './draft-scope.mjs';
import {createPhysicalReadGate} from './ui-read-flight.mjs';
import {createGoalDraftStore,goalDraftStorageKey} from './goal-draft.mjs';
import {clock,deferred,flush,harness,loadUi} from './ui-reliability-harness.mjs';

// Shipped producer -> actual Main handler -> actual preload -> production Page
// and hooks. OS/authority observations here are explicitly fixtures, not PG or
// Windows evidence. The separate PG17 test joins the actual signed PG producer.
async function nativeFixture(){
 const time=clock(),device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64),enrolled:true};
 const repository={coordination_workspace_id:randomUUID(),repo_id:'fixture:integration',repo_root:'/fixture/repo',managed_root:'/fixture/worktrees'};
 const state={configured:true,authorized:true,hold:true,identity:device,gate:null};const records=new Map(),calls=[],effects=[];let handler;
 const trusted={},main=fs.readFileSync(new URL('../../../metaengine-browser/src/main.mjs',import.meta.url),'utf8');
 const start=main.indexOf("ipcMain.handle('metaengine:client:draft-scope'"),end=main.indexOf("ipcMain.handle('metaengine:client:goal-submission-mode'",start);
 vm.runInNewContext(main.slice(start,end),{ipcMain:{handle:(_name,fn)=>{handler=fn;}},assertShellSender:event=>{if(event!==trusted)throw Error('untrusted');},
  readCurrentClientDraftScope:()=>readClientDraftScope({identity:{snapshot:()=>state.identity},now:time.now,monotonicNow:time.now,
   readRepository:async()=>state.configured?repository:null,
   readVerifiedRoute:async()=>{if(state.gate)await state.gate.promise;if(!state.authorized)throw Error('private grant denied');return{retained_intent:state.hold,scope_resolved:true,authority_effect:false};}})});
 const exposed={},preload=fs.readFileSync(new URL('../../../metaengine-browser/src/preload-shell.cjs',import.meta.url),'utf8');
 vm.runInNewContext(preload,{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{exposed[key]=value;}},ipcRenderer:{on(){},invoke:(channel,...args)=>{
  calls.push([channel,...args]);if(channel==='metaengine:client:draft-scope')return handler(trusted,...args);effects.push(channel);return Promise.resolve(null);
 }}};},location:{protocol:'http:',hostname:'127.0.0.1',port:'8137'},process:{env:{}}});
 const mount=()=>{
  const ui=harness(),pageUi=harness(),pageState={page:'browser',init(){},paletteOpen:false,recentPages:[],setPage(){}};
  const document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  const context={...ui,...time,createPhysicalReadGate,performance:{now:time.now},Date:class extends Date{static now=time.now;},document,queueMicrotask,
   useMe2:select=>select(pageState),useToast:()=>({toast(){}}),TopBar:'topbar',CommandPalette:'palette',
   window:{...time,metaengineClient:exposed.metaengineClient,addEventListener(){},removeEventListener(){}},goalDraftStorageKey,
   createGoalDraftStore:scope=>createGoalDraftStore(scope,{storage:()=>({getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)})})};
  context.useGoalDraft=loadUi('../hooks/use-goal-draft.ts',['useGoalDraft'],context).useGoalDraft;
  const shell=loadUi('../components/me2/shell/me2-shell.tsx',['Me2Shell','GoalComposer'],context);
  const pageContext={...context,...pageUi,createDraftScopeResource:options=>createDraftScopeResource({...options,now:time.now,monotonicNow:time.now,schedule:time.setTimeout,cancel:time.clearTimeout})};
  const {useDraftScope}=loadUi('../hooks/use-draft-scope.ts',['useDraftScope'],pageContext);
  const {Page}=loadUi('../app/page.tsx',['Page'],{...pageContext,useDraftScope,Me2Shell:shell.Me2Shell});let key;
  const render=()=>{const page=pageUi.render();if(page.props.key!==key){if(key!==undefined)ui.unmount();key=page.props.key;ui.mount(page.tag,page.props);}else ui.render(page.props);
   return ui.render().children.flat(Infinity).find(child=>child?.tag===shell.GoalComposer)?.props.draft;};
  pageUi.mount(Page);return{render,pageState,close(){ui.unmount();pageUi.unmount();}};
 };
 return {time,state,records,calls,effects,device,repository,mount};
}
test('actual Main/preload producer reaches production Page and restores a HOLD-scoped draft after renderer restart without effects',async()=>{
 const f=await nativeFixture(),first=f.mount();assert.equal(first.render().draftStorage,'UNBOUND');await flush();
 assert.equal(first.render().draftStorage,'SAVED');first.render().setGoal('Saved locally, not submitted');
 for(const page of ['system','tasks']){first.pageState.page=page;assert.equal(first.render(),undefined);}first.pageState.page='browser';assert.equal(first.render().goal,'Saved locally, not submitted');
 first.close();const next=f.mount();assert.equal(next.render().goal,'');await flush();assert.equal(next.render().goal,'Saved locally, not submitted');
 assert.ok(f.calls.length>=2);assert.ok(f.calls.every(args=>args.length===1&&args[0]==='metaengine:client:draft-scope'));assert.deepEqual(f.effects,[]);
 for(const key of f.records.keys()){assert.ok(!key.includes(f.device.device_id));assert.ok(!key.includes(f.device.client_id));}next.close();
});
for(const changed of ['missing-config','revoked','unenrolled','changed-device'])test(`actual namespace ${changed} hides prior draft without effect or old callback revival`,async()=>{
 const f=await nativeFixture(),page=f.mount();page.render();await flush();page.render().setGoal('Original private namespace');const old=page.render().acknowledgeGoal;
 if(changed==='missing-config')f.state.configured=false;else if(changed==='revoked')f.state.authorized=false;else if(changed==='unenrolled')f.state.identity={...f.device,enrolled:false};else f.state.identity={...f.device,device_id:randomUUID()};
 await f.time.advance(2000);assert.equal(page.render().goal,'');assert.equal(old(),false);
 f.state.configured=true;f.state.authorized=true;f.state.identity=f.device;await f.time.advance(2000);
 assert.equal(page.render().goal,'Original private namespace');page.render().setGoal('Newer draft after return');assert.equal(old(),false);assert.equal(page.render().goal,'Newer draft after return');
 assert.deepEqual(f.effects,[]);page.close();
});
test('coupled expired physical read neither restores a stale draft nor overlaps/retries an effect',async()=>{
 const f=await nativeFixture(),page=f.mount();page.render();await flush();page.render().setGoal('Confirmed only');
 f.state.gate=deferred();await f.time.advance(8000);assert.equal(page.render().goal,'');assert.equal(f.calls.length,2);
 const gate=f.state.gate;f.state.gate=null;gate.resolve();await flush();assert.equal(page.render().goal,'');
 await f.time.advance(2000);assert.equal(page.render().goal,'Confirmed only');assert.deepEqual(f.effects,[]);page.close();
});
