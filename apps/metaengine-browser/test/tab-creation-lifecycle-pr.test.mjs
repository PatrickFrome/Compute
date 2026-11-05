import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {TabRegistry} from '../src/tab-registry.mjs';
import {createAttachedTabView} from '../src/tab-creation-lifecycle.mjs';
import {ExactBrowserTabViewMap,clearWebContentsTabIndex,resolveTabIdForWebContents} from '../src/browser-webcontents-tab-index.mjs';
import {reconcileDestroyedTabView} from '../src/tab-view-lifecycle.mjs';

// Exercise the real Main wireRemoteView and createTabWithRecoveryAdmission
// declarations inside a VM; no Electron process or client is launched.
const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const begin=main.indexOf('function wireRemoteView(');
const end=main.indexOf('async function loadTab(',begin);
assert.ok(begin>=0&&end>begin);
const actual=main.slice(begin,end);
let sequence=20000;
const fakeView=()=>{
 const wc=new EventEmitter();let destroyed=false;
 wc.id=++sequence;wc.destroyCalls=0;wc.isDestroyed=()=>destroyed;
 wc.getURL=()=>'';wc.getTitle=()=>'';wc.setWindowOpenHandler=()=>{};
 wc.destroy=()=>{wc.destroyCalls++;if(!destroyed){destroyed=true;wc.emit('destroyed');}};
 return {webContents:wc};
};
async function scenario(t,phase){
 clearWebContentsTabIndex();
 const registry=new TabRegistry({readResources:()=>({physical_start_allowed:true,memory_headroom:4})});
 const views=new ExactBrowserTabViewMap();
 const previous=[];
 for(let i=0;i<2;i++){
  const tab=registry.create({url:'https://example.com/existing-'+i});
  const view=fakeView();views.set(tab.tab_id,view);previous.push({tab,view});
 }
 registry.select(previous[0].tab.tab_id);
 const allocated=[],detached=[],fleet=[],mutations=[];
 const env={
  registry,views,AGENT_PLATFORM_HOME_URL:'https://chatgpt.com/',
  userSession:{},REMOTE_WEB_PREFERENCES:{},createAttachedTabView,
  navigationDecision:url=>({allow:true,normalized_url:url,kind:'CHATGPT'}),
  newWindowDecision:()=>({allow:false}),
  WebContentsView:class{constructor(){
   if(phase==='constructor')throw Error('inert_constructor_failure');
   const view=fakeView();
   if(phase==='wiring')view.webContents.setWindowOpenHandler=()=>{throw Error('inert_wiring_failure');};
   allocated.push(view);return view;
  }},
  installHumanTakeoverAccelerator:()=>{},
  agentObservationPlane:{observe:()=>{}},
  attachSelected:()=>{
   const selected=registry.selected();
   if(selected&&views.has(selected.tab_id))mutations.push(views.get(selected.tab_id));
   if(phase==='attach')throw Error('inert_attach_failure');
  },
  windowRef:{contentView:{removeChildView:view=>detached.push(view)}},
  publishSnapshot:async()=>{},
  invalidatePerception:()=>{},
  boundedNavigation:async()=>({state:'CONFIRMED'}),
  fleet:{onTabClosed:async id=>fleet.push(id)},
  reconcileDestroyedTabView,
  setImmediate,
  runInterruptedSetupPhysicalMutation:async(_action,work)=>work(),
 };
 const api=vm.runInNewContext(actual+'\n({createTabWithRecoveryAdmission})',env);
 t.after(()=>{views.clear();clearWebContentsTabIndex();});
 return {api,registry,views,previous,allocated,detached,fleet,mutations};
}
for(const phase of ['constructor','wiring','attach'])test('real Main creation compensates '+phase+' without foreign effects',async t=>{
 const f=await scenario(t,phase);
 await assert.rejects(f.api.createTabWithRecoveryAdmission('https://chatgpt.com/',{load:false}),new RegExp('inert_'+phase+'_failure'));
 assert.equal(f.registry.snapshot().tabs.length,2);
 assert.equal(f.registry.selected().tab_id,f.previous[0].tab.tab_id);
 assert.equal(f.views.size,2);
 for(const {tab,view} of f.previous){
  assert.equal(f.registry.get(tab.tab_id).browser_cell_id,tab.browser_cell_id);
  assert.equal(f.views.get(tab.tab_id),view);
  assert.equal(resolveTabIdForWebContents(view.webContents),tab.tab_id);
  assert.equal(view.webContents.destroyCalls,0);
 }
 for(const view of f.allocated){
  assert.equal(view.webContents.destroyCalls,1);
  assert.equal(resolveTabIdForWebContents(view.webContents),null);
 }
 assert.ok(f.detached.every(view=>f.allocated.includes(view)));
 assert.equal(f.detached.length,phase==='attach'?1:0);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.fleet,[]);
});
test('real Main successful view survives without navigation or retry',async t=>{
 const f=await scenario(t,'none');
 const response=await f.api.createTabWithRecoveryAdmission('https://chatgpt.com/',{load:false,role:'FLEET'});
 assert.equal(response.effect_outcome,'CONFIRMED');
 assert.equal(response.automatic_retry_allowed,false);
 assert.equal(f.registry.get(response.tab_id).role,'FLEET');
 assert.ok(f.views.get(response.tab_id));
 assert.equal(f.allocated[0].webContents.destroyCalls,0);
});
