import assert from 'node:assert/strict';
import test from 'node:test';
import {createManagedProjectsView} from './client-managed-projects.ts';
import {clock, deferred, flush, harness, loadUi} from './ui-reliability-harness.mjs';

function fixture() {
  const time = clock(), effect = deferred(), calls = [];
  let reads = 0;
  const status = () => ({schema:'metaengine.client.managed-project-status.v1',state:'AVAILABLE',host_state:'READY',
    observed_at:new Date(time.now()).toISOString(),reason:null,authority_effect:false,
    projects:[{workspace_id:'workspace-a',task_id:'task-a',agent_id:'agent-a',state:'READY',workspace_generation:1,
      repo_id:'repo-a',branch_name:'task/a',can_create:true,can_open:true,in_flight:false,reason:null}]});
  const bridge = {projectStatus:async()=>{reads++;return status();},
    createProject:request=>{calls.push(['create',request]);return effect.promise;},
    openProject:request=>{calls.push(['open',request]);return effect.promise;}};
  const view = createManagedProjectsView({bridge:()=>bridge,now:time.now,schedule:time.setTimeout,cancel:time.clearTimeout});
  const receipt = action => ({schema:'metaengine.client.managed-project-result.v1',ok:true,state:'PROVEN',
    action:action==='open'?'PROJECT_OPEN':'PROJECT_CREATE',workspace_id:'workspace-a',task_id:'task-a',workspace_generation:1,
    head_sha:'a'.repeat(40),replayed:false,opened:action==='open',authority_effect:false,automatic_retry_allowed:false});
  return {time,effect,calls,view,status,receipt,bridge,reads:()=>reads};
}

for (const action of ['create','open']) test(`${action} observation deadline reports unknown without releasing effect custody`, async()=>{
  const f=fixture();await f.view.refresh();
  const operation=f.view[action]('workspace-a');
  await f.time.advance(8_000);
  assert.equal(f.view.getSnapshot().pending.outcomeUnknown,true);
  assert.equal(f.view.getSnapshot().error,'managed_project_client_outcome_unknown');
  assert.equal(f.view.getSnapshot().completed,null);
  assert.equal(await f.view.create('workspace-a'),false);
  assert.equal(await f.view.open('workspace-a'),false);
  await f.view.refresh();
  assert.equal(f.reads(),2,'readonly refresh remains available while original invoke is unsettled');
  assert.equal(f.view.getSnapshot().pending.outcomeUnknown,true,'status does not substitute for the original receipt');
  assert.equal(f.calls.length,1);
  f.effect.resolve(f.receipt(action));assert.equal(await operation,true);
  assert.equal(f.view.getSnapshot().pending,null);
  assert.equal(f.view.getSnapshot().error,null);
  assert.deepEqual(f.view.getSnapshot().completed,{action,workspaceId:'workspace-a'});
  assert.equal(f.calls.length,1);
});

test('a late mismatched receipt cannot turn an unknown operation into confirmed completion',async()=>{
  const f=fixture();await f.view.refresh();const operation=f.view.create('workspace-a');
  await f.time.advance(8_000);
  assert.equal(f.view.getSnapshot().pending.outcomeUnknown,true);
  f.effect.resolve({...f.receipt('create'),workspace_generation:2});
  assert.equal(await operation,false);
  assert.equal(f.view.getSnapshot().completed,null);
  assert.equal(f.view.getSnapshot().error,'managed_project_client_result_invalid');
  assert.equal(f.calls.length,1);
});

function buttons(tree) {
  return [tree,...(tree?.children??[]).flat(Infinity).flatMap(child=>child&&typeof child==='object'?buttons(child):[])].filter(node=>node?.tag==='button');
}

test('shipped project component exposes unknown outcome and readonly refresh while effect buttons stay held',async()=>{
  const f=fixture(), hooks=harness(), listeners=new Map();
  const document={visibilityState:'visible',addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
  const {ManagedProjects}=loadUi('../components/me2/managed-projects.tsx',['ManagedProjects'],{
    ...hooks,createManagedProjectsView:()=>f.view,GitBranch:'GitBranch',RefreshCw:'RefreshCw',Sec:'section',document,
    window:{metaengineClient:f.bridge,setInterval:f.time.setInterval,clearInterval:f.time.clearInterval},
  });
  hooks.mount(ManagedProjects);await flush();let tree=hooks.render();
  const operation=f.view.create('workspace-a');await f.time.advance(8_000);tree=hooks.render();
  assert.match(JSON.stringify(tree),/Результат операции неизвестен/);
  assert.match(JSON.stringify(tree),/Повтор заблокирован/);
  assert.doesNotMatch(JSON.stringify(tree),/Операция выполняется/);
  assert.equal(tree.props.right.props.disabled,false,'explicit read-only refresh remains enabled');
  assert.ok(buttons(tree).every(button=>button.props.disabled===true),'all operation buttons remain disabled');
  const before=f.reads();tree.props.right.props.onClick();await flush();
  assert.equal(f.reads(),before+1);assert.equal(f.calls.length,1);
  await f.time.advance(2_000);assert.equal(f.reads(),before+2,'normal readonly polling also continues during unknown outcome');
  f.effect.resolve(f.receipt('create'));assert.equal(await operation,true);tree=hooks.render();
  assert.doesNotMatch(JSON.stringify(tree),/Результат операции неизвестен/);
  assert.match(JSON.stringify(tree),/Создание проекта подтверждено/);
  hooks.unmount();
});
