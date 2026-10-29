import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {createClientProjectTasksView,readNativeProjectTaskPage,PROJECT_TASK_GROUPS,projectTaskMatchesGroup} from './client-project-tasks.ts';

function project(){const root=randomUUID(),id=randomUUID(),request=randomUUID();return {id,root,request,
  page(after=0,count=2,total=2){const rows=Array.from({length:count},(_,index)=>({task_seq:after+index+1,task_id:after+index===0?root:randomUUID(),root_task_id:root,
    parent_task_id:after+index===0?null:root,depth:after+index===0?0:1,state:after+index===0?'RUNNING':'READY',role:'IMPLEMENTER',objective:'Actual generated task fixture',
    agent_id:null,lease_generation:0,lease_expires_at:null}));
    return {schema:'metaengine.devos.project-snapshot.v1',found:true,project_id:id,root_task_id:root,request_id:request,state:'ACTIVE',goal:'A generated fixture goal',
      total_tasks:total,last_seq:7,tasks:rows,task_cursor:{after_seq:after,next_seq:after+count,has_more:after+count<total},
      filesystem_paths_exposed:false,automatic_retry_allowed:false,scheduler_authority:false,authority_effect:false};}};}
const resource=(t,bridge,options={})=>{const value=createClientProjectTasksView({bridge:()=>bridge,...options});t.after(()=>value.close());return value;};

test('native task pages retain real identities, task states and cursors while rejecting probe data and forged scope',()=>{
  const p=project(),page=p.page();const parsed=readNativeProjectTaskPage(page);
  assert.equal(parsed.project_id,p.id);assert.equal(parsed.tasks[0].state,'RUNNING');assert.equal(parsed.tasks[1].state,'READY');
  assert.equal(Object.isFrozen(parsed.tasks[0]),true);
  for(const changed of [{...page,schema:'probe'},{...page,scheduler_authority:true},{...page,filesystem_paths_exposed:true},
    {...page,task_cursor:{after_seq:0,next_seq:999,has_more:false}},{...page,tasks:[page.tasks[0],page.tasks[0]]},
    {...page,tasks:[{...page.tasks[0],root_task_id:randomUUID()}]},{...page,tasks:[{...page.tasks[0],state:'IMAGINARY_READY'}]}])assert.throws(()=>readNativeProjectTaskPage(changed));
  assert.throws(()=>readNativeProjectTaskPage(page,{projectId:randomUUID()}));
});

test('tasks and queue read the native project API without a socket or legacy snapshot; a second caller shares one read',async t=>{
  const p=project();let release,calls=0;
  const view=resource(t,{projectOverview:()=>{calls++;return new Promise(resolve=>{release=resolve;});},projectSnapshot:async()=>{throw Error('not paged');}});
  const first=view.refresh(),second=view.refresh();assert.equal(first,second);await Promise.resolve();release(p.page());await first;
  assert.equal(calls,1);assert.equal(view.getSnapshot().state,'OBSERVED');assert.equal(view.getSnapshot().page.tasks.length,2);
  assert.equal(view.selectTask(p.root),true);assert.equal(view.getSnapshot().selectedTaskId,p.root);assert.equal(view.selectTask(randomUUID()),false);
});

test('bounded explicit pages preserve the SQL cursor and reset when the actual latest project changes',async t=>{
  const first=project(),second=project();let current=first,calls=[];
  const view=resource(t,{projectOverview:async()=>current.page(0,2,4),projectSnapshot:async request=>{calls.push(request);return current.page(request.task_after_seq,2,4);}});
  await view.refresh();await view.nextPage();assert.deepEqual(calls[0],{project_id:first.id,task_after_seq:2,limit:128});
  assert.equal(view.getSnapshot().page.cursor.after_seq,2);assert.equal(view.getSnapshot().canGoBack,true);
  current=second;await view.refresh();assert.equal(view.getSnapshot().page.project_id,second.id);assert.equal(view.getSnapshot().page.cursor.after_seq,0);assert.equal(view.getSnapshot().canGoBack,false);
});

test('timeout or wrong-page identity retains old observations as stale instead of inventing READY or an empty queue',async t=>{
  const p=project();let unavailable=false;
  const view=resource(t,{projectOverview:async()=>{if(unavailable)return new Promise(()=>{});return p.page(0,2,4);},projectSnapshot:async()=>({...p.page(2,2,4),project_id:randomUUID()})},{deadlineMs:15});
  await view.refresh();const old=view.getSnapshot().page;
  await view.nextPage();assert.equal(view.getSnapshot().state,'DEGRADED');assert.equal(view.getSnapshot().page,old);
  unavailable=true;await view.refresh();assert.equal(view.getSnapshot().state,'DEGRADED');assert.equal(view.getSnapshot().page,old);assert.equal(view.getSnapshot().busy,false);
});

test('closing the view fences a late native response and observation release stops polling',async t=>{
  let release,calls=0;const view=resource(t,{projectOverview:()=>{calls++;return new Promise(resolve=>{release=resolve;});},projectSnapshot:async()=>null},{deadlineMs:100});
  const unsubscribe=view.observe(()=>true);await Promise.resolve();const before=view.getSnapshot();view.close();release(project().page());
  await new Promise(resolve=>setImmediate(resolve));assert.equal(view.getSnapshot(),before);unsubscribe();assert.equal(calls,1);
});

test('retained primary UI has no decorative legacy screens, command bus, token editor or generic shell controls',async()=>{
  const component=async file=>fs.readFile(new URL('../components/me2/'+file,import.meta.url),'utf8');
  const files=await Promise.all(['pages/code.tsx','pages/system.tsx','pages/tasks.tsx','shell/command-palette.tsx','shell/me2-shell.tsx','store.tsx'].map(component));
  assert.equal(files.some(text=>/XTransformPort|sendCommand\(|mcxOp|BUDGET_FLUSH|ENVIRONMENT_RESET|TERMINAL_RUN|tokens-add|pages\/supervisor|pages\/memory|pages\/observability/.test(text)),false);
  assert.match(files[0],/ManagedProjects/);assert.match(files[0],/ManagedProjectHistory/);assert.match(files[1],/activateGuardian/);
  assert.match(files[2],/useClientProjectTasks/);assert.match(files[3],/useClientProjectTasks/);
  assert.equal(/s\.snap|state\.snap|openTask\(/.test(files[2]+files[3]),false);
});

 test('every accepted task state has a specific filter; suspension is not queued or completed',()=>{
  const expected={READY:'Очередь',LEASED:'В работе',RUNNING:'В работе',RESULT_READY:'В работе',SUSPENDED:'Приостановлены',
    BLOCKED:'Требуют внимания',FAILED:'Требуют внимания',AMBIGUOUS:'Требуют внимания',FENCED:'Требуют внимания',COMPLETED:'Завершены'};
  for(const [state,group] of Object.entries(expected)){
    const raw=project().page();raw.tasks[0].state=state;
    assert.equal(readNativeProjectTaskPage(raw).tasks[0].state,state);
    assert.equal(projectTaskMatchesGroup(state,'Все'),true);
    assert.deepEqual(PROJECT_TASK_GROUPS.filter(g=>g!=='Все'&&projectTaskMatchesGroup(state,g)),[group]);
  }
  assert.equal(projectTaskMatchesGroup('IMAGINARY_READY','В работе'),false);
  assert.equal(projectTaskMatchesGroup('toString','В работе'),false);
 });

 test('suspended project readback stays observed and preserves selection through resume',async t=>{
  const p=project(),raw=p.page();
  const view=resource(t,{projectOverview:async()=>raw,projectSnapshot:async()=>null});
  await view.refresh();assert.equal(view.selectTask(p.root),true);
  for(const state of ['SUSPENDED','RUNNING']){
    raw.tasks[0].state=state;await view.refresh();
    assert.equal(view.getSnapshot().state,'OBSERVED');
    assert.equal(view.getSnapshot().page.tasks[0].state,state);
    assert.equal(view.getSnapshot().selectedTaskId,p.root);
  }
 });

function rejection(page){return {schema:'metaengine.native-coding.review-rejection.v1',project_id:page.project_id,verdict:'REJECT',
  writer_task_id:page.tasks[0].task_id,writer_lease_generation:1,critic_task_id:page.tasks[1].task_id,critic_lease_generation:2,
  result_sha256:'a'.repeat(64),automatic_retry_allowed:false,authority_effect:false};}
test('project tasks retain an exact rejected pair without inventing task failure or execution authority',()=>{
  const raw=project().page();raw.native_review_rejection=rejection(raw);
  const parsed=readNativeProjectTaskPage(raw);
  assert.deepEqual(parsed.native_review_rejection,raw.native_review_rejection);
  assert.equal(parsed.tasks[0].state,'RUNNING');
  assert.equal(Object.isFrozen(parsed.native_review_rejection),true);
  assert.equal(readNativeProjectTaskPage(project().page()).native_review_rejection,null);
  for(const change of [{project_id:randomUUID()},{verdict:'ACCEPT'},{writer_lease_generation:0},{critic_lease_generation:1.5},
    {critic_task_id:raw.tasks[0].task_id},{result_sha256:'bad'},{automatic_retry_allowed:true},{authority_effect:true},{repair_authorized:true}]){
    assert.throws(()=>readNativeProjectTaskPage({...raw,native_review_rejection:{...raw.native_review_rejection,...change}}));
  }
});
test('rejection readback survives pagination without requiring both tasks on the current page',async t=>{
  const p=project(),first=p.page(0,2,4),review=rejection(first);first.native_review_rejection=review;
  const view=resource(t,{projectOverview:async()=>first,projectSnapshot:async()=>({...p.page(2,2,4),native_review_rejection:review})});
  await view.refresh();await view.nextPage();
  assert.equal(view.getSnapshot().state,'OBSERVED');
  assert.deepEqual(view.getSnapshot().page.native_review_rejection,review);
  assert.equal(view.selectTask(review.writer_task_id),false);
});
test('rejected pair panel only selects confirmed page rows and exposes no repair/retry effect',async()=>{
  const text=await fs.readFile(new URL('../components/me2/pages/tasks.tsx',import.meta.url),'utf8');
  assert.match(text,/page\.native_review_rejection/);
  assert.match(text,/page\.tasks\.some\(task=>task\.task_id===id\)/);
  assert.match(text,/setFilter\('Все'\);setQuery\(''\);resource\.selectTask\(id\)/);
  assert.match(text,/Автоматическое исправление пока недоступно/);
  assert.doesNotMatch(text,/\.retry\(|\.repair\(|\.send\(|\.enqueue\(/);
});

test('task presentation does not impose an extra logical depth ceiling',()=>{
 const p=project(),page=p.page();page.tasks[1].depth=2147483647;
 const parsed=readNativeProjectTaskPage(page);assert.equal(parsed.tasks[1].depth,2147483647);
 for(const depth of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>readNativeProjectTaskPage({...page,tasks:page.tasks.map((row,index)=>index?{...row,depth}:row)}));
 }
});
