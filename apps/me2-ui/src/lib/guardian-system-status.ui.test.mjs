import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {clock, deferred, element, flush, harness, loadUi} from './ui-reliability-harness.mjs';
import {createBrowserGuardianStatusObserver} from '../../../metaengine-browser/src/browser-guardian-status-observer.mjs';

// Execute the shipped settings component with a deterministic clock and inert
// native IPC. These checks qualify UI observation only, never Windows/Owner.
function fixture(read) {
  const ui = harness(), time = clock(), listeners = new Map(), effects = [];
  let reads = 0, mutations = 0, updates = 0;
  const status = () => ({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',state:'READY',reason:'READY',ready:true,
    guardian_service_ready:true,owner_binding_proven:true,device_binding_proven:true,
    observed_at:new Date(time.now()).toISOString(),expires_at:new Date(time.now()+10_000).toISOString(),stale:false,
    explicit_user_action_required:false,uac_consent_required:false,fixed_packaged_bootstrap:true,
    caller_supplied_path_used:false,caller_supplied_arguments_used:false,arbitrary_shell_used:false,
    automatic_retry_allowed:false,authority_effect:false});
  const api = {guardianStatus:() => {reads++;return read ? read(status,reads) : Promise.resolve(status());},
    activateGuardian:async()=>{mutations++;return status();},
    githubRepositoryStatus:async()=>{effects.push('repository-read');return null;},
    githubChatStatus:async()=>{effects.push('chat-read');return null;}};
  const document = {visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const context = {...ui,...time,useState:initial=>{const [value,set]=ui.useState(initial);return [value,next=>{updates++;set(next);}];},
    Date:class extends Date{static now=time.now;},document,
    window:{...time,metaengineClient:api},useMe2:fn=>fn({setPage(){}}),PAGES:[],
    useClientRuntimeStatus:()=>({readback:{connection:{admin_ready:true},work:null}}),
    refreshClientRuntimeStatus:async()=>{},capabilityLabel:()=> 'Unavailable',InterruptedSetupRecovery:'recovery'};
  const {SystemPage} = loadUi('../components/me2/pages/system.tsx',['SystemPage'],context);
  const section = () => element(ui.render(),'guardian-runtime-status');
  const text = () => JSON.stringify(section());
  const button = () => section().children.flat(Infinity).find(child=>child?.tag==='button');
  const refreshButton = () => ui.render().children[0].children.find(child=>child?.tag==='button');
  return {ui,time,api,status,effects,section,text,button,refreshButton,reads:()=>reads,mutations:()=>mutations,updates:()=>updates,
    mount:()=>ui.mount(SystemPage),
    visibility(value){document.visibilityState=value;listeners.get('visibilitychange')?.();}};
}

test('settings expires a cached Guardian READY while the next physical read is hung',async()=>{
  const hung=deferred();const f=fixture((status,n)=>n===1?Promise.resolve(status()):hung.promise);
  f.mount();await flush();assert.match(f.text(),/READY/);assert.match(f.text(),/подтверждён/);
  await f.time.advance(10_001);
  assert.doesNotMatch(f.text(),/READY|"подтверждён"/);
  assert.equal(f.button().props.disabled,true);assert.equal(f.reads(),2);
  assert.deepEqual(f.effects,['repository-read','chat-read'],'polling Guardian never polls GitHub');
  await f.time.advance(20_000);assert.equal(f.reads(),2,'deadline is not physical IPC cancellation');
  f.ui.unmount();hung.resolve(f.status());await flush();
});

for(const change of [value=>{value.stale=true;},value=>{value.expires_at=new Date(0).toISOString();},
  value=>{value.observed_at=new Date(Date.now()+1_000_000_000_000).toISOString();},
  value=>{delete value.expires_at;},value=>{value.owner_binding_proven=false;},
  value=>{value.automatic_retry_allowed=true;}])test('settings suppresses stale or inconsistent positive Guardian proof: '+change,async()=>{
  const f=fixture(status=>{const value=status();change(value);return Promise.resolve(value);});
  f.mount();await flush();assert.doesNotMatch(f.text(),/READY/);assert.equal(f.button().props.disabled,true);f.ui.unmount();
});

test('backgrounding clears cached Guardian proof and foreground reads never replay activation',async()=>{
  const f=fixture();f.mount();await flush();assert.match(f.text(),/READY/);
  f.visibility('hidden');assert.doesNotMatch(f.text(),/READY/);
  const reads=f.reads();await f.time.advance(30_000);assert.equal(f.reads(),reads);
  f.visibility('visible');await flush();assert.match(f.text(),/READY/);assert.equal(f.reads(),reads+1);
  assert.equal(f.mutations(),0);f.ui.unmount();
});

test('deadline discards late READY and retains the physical slot until settlement',async()=>{
  const hung=deferred();const f=fixture((status,n)=>n===1?Promise.resolve(status()):hung.promise);
  f.mount();await flush();await f.time.advance(8_000);
  assert.equal(f.reads(),2);assert.doesNotMatch(f.text(),/READY/);
  hung.resolve(f.status());await flush();assert.doesNotMatch(f.text(),/READY/);
  f.ui.unmount();
});

test('unmount and remount fence late Guardian observation from the previous lifetime',async()=>{
  const hung=deferred();const f=fixture((status,n)=>n===1?hung.promise:Promise.resolve(status()));
  f.mount();await flush();f.ui.unmount();f.mount();await flush();
  assert.match(f.text(),/READY/);hung.resolve({...f.status(),state:'HOLD',ready:false,reason:'old-result',owner_binding_proven:false,device_binding_proven:false});
  await flush();assert.match(f.text(),/READY/);assert.doesNotMatch(f.text(),/old-result/);f.ui.unmount();
});

test('Guardian action invalidates prior proof and read-only polling cannot race its pending result',async()=>{
  const pending=deferred();const f=fixture(status=>Promise.resolve({...status(),state:'ACTIVATION_REQUIRED',ready:false,
    guardian_service_ready:false,owner_binding_proven:false,device_binding_proven:false,explicit_user_action_required:true,uac_consent_required:true}));
  let calls=0;f.api.activateGuardian=()=>{calls++;return pending.promise;};
  f.mount();await flush();assert.equal(f.button().props.disabled,false);
  f.button().props.onClick();await flush();assert.equal(calls,1);
  await f.time.advance(20_000);assert.equal(f.reads(),1);
  f.button().props.onClick();assert.equal(calls,1,'repeated actions share the existing physical operation');
  pending.reject(Error('private failure'));await flush();assert.equal(calls,1);assert.equal(f.reads(),2);
  assert.doesNotMatch(f.text(),/private failure/);f.ui.unmount();
});

test('settings accepts the existing native Guardian observer output without manufacturing Owner proof',async()=>{
  let f;const observer=createBrowserGuardianStatusObserver({readStatus:async()=>f.status(),now:()=>f.time.now()});
  f=fixture(()=>observer.observe({force:true}));f.mount();await flush();
  assert.match(f.text(),/READY/);assert.match(f.text(),/"подтверждён"/);
  assert.equal(f.mutations(),0);f.ui.unmount();
});

test('actual R97 absent-profile IPC satisfies the actual settings wait only as unavailable with actions held',async t=>{
  const source=await readFile(new URL('../../../metaengine-browser/test/me2-r85-visual-evidence.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function registerPresentationIpc() {'),end=source.indexOf('\nasync function waitFor(',start);
  assert.ok(start>=0&&end>start);
  const handlers=new Map();
  vm.runInNewContext(source.slice(start,end)+'\nregisterPresentationIpc();',{
    ipcMain:{handle(channel,handler){assert.equal(handlers.has(channel),false);handlers.set(channel,handler);}},
  });
  const invoke=channel=>{assert.ok(handlers.has(channel),channel);return handlers.get(channel)();};
  const readGuardian=()=>invoke('metaengine:client:guardian-status');
  const absent=readGuardian();
  assert.equal(absent.state,'HOLD');assert.equal(absent.reason,'GUARDIAN_OBSERVATION_NOT_YET_AVAILABLE');
  assert.equal(absent.stale,true);assert.equal(absent.observed_at,null);assert.equal(absent.expires_at,null);
  assert.equal(absent.guardian_service_ready,false);assert.equal(absent.owner_binding_proven,false);assert.equal(absent.device_binding_proven,false);
  for(const channel of ['activate-guardian','github-repository-connect','github-chat-connect','github-chat-disconnect']){
    assert.equal(handlers.has('metaengine:client:'+channel),false,'presentation fixture has no mutation endpoint');
  }
  const f=fixture(readGuardian);t.after(()=>f.ui.unmount());
  f.api.githubRepositoryStatus=()=>invoke('metaengine:client:github-repository-status');
  f.api.githubChatStatus=()=>invoke('metaengine:client:github-chat-status');
  f.mount();await flush();
  const nodes=node=>!node||typeof node!=='object'?[]:[node,...(node.children??[]).flat(Infinity).flatMap(nodes)];
  const text=node=>node===null||node===undefined?'':typeof node==='object'?(node.children??[]).flat(Infinity).map(text).join(''):String(node);
  const queryAll=selector=>{
    const match=/^\[data-testid="([^"]+)"\](?: (\[role=status\]|button))?$/.exec(selector);
    assert.ok(match,'supported actual R97 settings selector: '+selector);
    const section=element(f.ui.render(),match[1]);
    const found=!section?[]:!match[2]?[section]:nodes(section).filter(node=>match[2]==='button'?node.tag==='button':node.props?.role==='status');
    return found.map(node=>({textContent:text(node),disabled:node.props?.disabled}));
  };
  const document={querySelector:selector=>queryAll(selector)[0]??null,querySelectorAll:queryAll};
  const opened=source.indexOf("markPhase('OPEN_SETTINGS');");
  const wait=/await waitFor\(shellView\.webContents, `([\s\S]*?)`\);/.exec(source.slice(opened));
  assert.ok(opened>=0&&wait,'execute the visual harness predicate against the shipped component');
  assert.equal(document.querySelector('[data-testid="guardian-runtime-status"] [role=status]').textContent,'UNAVAILABLE · Нет текущего подтверждения');
  assert.match(document.querySelector('[data-testid="guardian-runtime-status"]').textContent,/Служба: не подтверждена · Owner: не подтверждён · device: не подтверждён/);
  assert.equal(f.button().props.disabled,true);
  assert.equal(vm.runInNewContext(wait[1],{document}),true,'actual absent-profile renderer must satisfy the R97 negative-state wait');
  f.button().props.onClick();await flush();await f.time.advance(15_000);
  assert.equal(f.mutations(),0,'stale proof cannot dispatch or retry activation');
  assert.equal(vm.runInNewContext(wait[1],{document}),true,'read-only polling cannot promote the unchanged stale receipt');
  assert.equal(readGuardian().stale,true);assert.equal(readGuardian().observed_at,null);assert.equal(readGuardian().expires_at,null);
});

test('a retained activation callback cannot dispatch after its Guardian receipt expires',async()=>{
  const hung=deferred();const f=fixture((status,n)=>n===1?Promise.resolve({...status(),state:'ACTIVATION_REQUIRED',ready:false,
    guardian_service_ready:false,owner_binding_proven:false,device_binding_proven:false,explicit_user_action_required:true,uac_consent_required:true}):hung.promise);
  f.mount();await flush();const click=f.button().props.onClick;
  assert.equal(f.button().props.disabled,false);await f.time.advance(10_001);
  click();await flush();assert.equal(f.mutations(),0);f.ui.unmount();hung.resolve(f.status());await flush();
});

test('a hung unrelated connection action cannot retain expired Guardian proof',async()=>{
  const pending=deferred();const f=fixture();f.api.connectGithubRepository=()=>pending.promise;
  f.mount();await flush();assert.match(f.text(),/READY/);
  const repository=element(f.ui.render(),'github-repository-connection');
  repository.children.flat(Infinity).find(child=>child?.tag==='button').props.onClick();await flush();
  const updates=f.updates();
  await f.time.advance(10_001);assert.ok(f.updates()>updates,'expiry must schedule a render while the action is hung');
  assert.doesNotMatch(f.text(),/READY|"подтверждён"/);
  assert.equal(f.reads(),1);pending.resolve(null);await flush();f.ui.unmount();
});

test('a settled read releases its busy state after backgrounding without publishing the old response',async()=>{
  const pending=deferred();const f=fixture((status,n)=>n===2?pending.promise:Promise.resolve(status()));
  f.mount();await flush();await f.time.advance(5_000);assert.equal(f.reads(),2);
  f.visibility('hidden');f.visibility('visible');await flush();assert.equal(f.reads(),2);
  pending.resolve(f.status());await flush();assert.doesNotMatch(f.text(),/READY/);
  assert.equal(f.refreshButton().props.disabled,false);
  await f.time.advance(5_000);assert.match(f.text(),/READY/);assert.equal(f.reads(),3);f.ui.unmount();
});

test('a settled action releases its busy state after backgrounding without a mutation retry',async()=>{
  const pending=deferred();const f=fixture(status=>Promise.resolve({...status(),state:'ACTIVATION_REQUIRED',ready:false,
    guardian_service_ready:false,owner_binding_proven:false,device_binding_proven:false,explicit_user_action_required:true,uac_consent_required:true}));
  let calls=0;f.api.activateGuardian=()=>{calls++;return pending.promise;};
  f.mount();await flush();f.button().props.onClick();await flush();
  f.visibility('hidden');f.visibility('visible');pending.reject(Error('unknown result'));await flush();
  assert.equal(f.refreshButton().props.disabled,false);assert.equal(calls,1);
  await f.time.advance(5_000);assert.equal(f.reads(),2);assert.equal(calls,1);f.ui.unmount();
});
