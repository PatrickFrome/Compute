import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAutonomousProjectJournal } from '../src/autonomous-project-journal.mjs';
import { BrowserParentSuspension } from '../src/browser-parent-suspension.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const flags={authority_effect:false,automatic_retry_allowed:false};
const lease={task_id:id(1),agent_id:'agent_parent-worker',lease_generation:1};
const control={authoritative:true,state:'OPEN',continuous_service_allowed:true,generation_floor:1};
async function fixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'parent-suspension-'));const filePath=path.join(dir,'journal.sqlite');
 let journal=createAutonomousProjectJournal({filePath}),receipt=null,mode='ok',posted=0,captured=0,closed=0,resumePosts=0;
 const checkpoint={schema:'metaengine.browser.parent-checkpoint.v1',agent_id:lease.agent_id,agent_generation_epoch:1,
   conversation_url:'https://chatgpt.com/c/'+id(9),conversation_url_sha256:'a'.repeat(64),agent_surface_sha256:'b'.repeat(64),
   transcript_floor:12,transcript_total_chars:25,transcript_sha256:'c'.repeat(64),delivered_tool_results:[],worktree_custody:null};
 const transport={withQuiescentParent:async({checkpointContext},cb)=>{captured++;const r=await cb({...checkpoint,...checkpointContext});closed++;return r;},
  hibernateStored:async()=>{closed++;},resumeStored:async(_,cb)=>cb({schema:'metaengine.devos.browser-parent-restoration.v1'})};
 const request=async({path:route,body})=>{
  if(route.endsWith('/suspend-browser')){posted++;receipt={schema:'metaengine.devos.browser-parent-suspension.v1',suspension_id:body.suspension_id,
   project_id:id(2),task_id:lease.task_id,old_claim_id:5,old_lease_generation:1,checkpoint:body.checkpoint,checkpoint_sha256:'d'.repeat(64),
   status:'SUSPENDED',state:'WAITING_CHILDREN',lease:null,...flags};if(mode.startsWith('lost'))throw Error('lost_ack');return receipt;}
  if(route.endsWith('/suspension-read')){if(mode==='lost-unknown')throw Error('unavailable');return receipt||{found:false,...flags};}
  if(route.endsWith('/suspension-list'))return {schema:'metaengine.devos.browser-parent-suspension-list.v1',entries:receipt?[receipt]:[],cursor:{next_seq:0,has_more:false},...flags};
  if(route.endsWith('/resume-browser')){resumePosts++;receipt={...receipt,status:'RESUMED',state:'RESUMED',lease:{...lease,lease_generation:2,agent_generation_epoch:2,conversation_url_sha256:checkpoint.conversation_url_sha256}};return receipt;}
  assert.fail(route);
 };
 const open=()=>new BrowserParentSuspension({journal,request,transport,readControl:()=>control,
  taskSnapshot:async()=>({task:{claim_class:'READ_ONLY',claim_id:5},snapshot:{project_id:id(2)}})});
 t.after(async()=>{await journal.close();await fs.rm(dir,{recursive:true,force:true});});
 const confirm=async(extra={})=>{await journal.begin(`turn:${lease.task_id}:1:first`,{task_id:lease.task_id,agent_id:lease.agent_id,
  lease_generation:1,transcript_floor:12,delivery_history_complete:true,delivered_tool_results:[{request_id:'tool:one',result_sha256:'e'.repeat(64)}],...extra});
  await journal.confirm(`turn:${lease.task_id}:1:first`,{transcript_floor:12});};
 return {open,confirm,journal:()=>journal,counts:()=>({posted,captured,closed,resumePosts}),mode:m=>{mode=m;},ready:(state='READY_TO_RESUME')=>{receipt.state=state;},
 restart:async()=>{await journal.close();journal=createAutonomousProjectJournal({filePath});return open();}};
}
test('durable suspension lost ACK reconciles exact checkpoint without repeating capture/write; restored turn preserves result delivery',async t=>{
 const f=await fixture(t);await f.confirm();f.mode('lost-known');let runtime=f.open();
 assert.equal((await runtime.suspend(lease)).status,'SUSPENDED');assert.equal(f.counts().posted,1);
 runtime=await f.restart();await runtime.suspend(lease);assert.equal(f.counts().posted,1);assert.equal(f.counts().captured,1);
 f.ready();await runtime.tick();const turn=await f.journal().latestConversationTurn({...lease,lease_generation:2});
 assert.equal(turn.receipt.effect_state,'RESTORED_EXISTING_CONVERSATION');assert.equal(turn.intent.transcript_floor,12);
 assert.equal(turn.intent.delivered_tool_results[0].request_id,'tool:one');
 await runtime.tick();assert.equal(f.counts().resumePosts,1,'confirmed resume is readback-only');
});
test('unknown suspend leaves pending journal and never authorizes slot close or automatic resend',async t=>{
 const f=await fixture(t);await f.confirm();f.mode('lost-unknown');await assert.rejects(f.open().suspend(lease),/lost_ack/);
 assert.equal(f.counts().closed,0);const runtime=await f.restart();await assert.rejects(runtime.suspend(lease),/unavailable/);
 assert.equal(f.counts().posted,1);assert.equal(f.counts().captured,1);
});
test('legacy delivery journal and unresolved independent effect both retain the physical parent',async t=>{
 const f=await fixture(t);await f.confirm({delivery_history_complete:false});
 assert.equal((await f.open().suspend(lease)).state,'DURABLE_DELIVERY_CHECKPOINT_REQUIRED');assert.equal(f.counts().captured,0);
});
test('confirmed turn cannot hide a pending independent task effect',async t=>{
 const f=await fixture(t);await f.confirm();await f.journal().begin('pending:effect',{task_id:lease.task_id,lease_generation:1});
 assert.equal((await f.open().suspend(lease)).state,'PENDING_EFFECT_REQUIRES_READBACK');assert.equal(f.counts().captured,0);
});

test('lost child retirement certificate ACK keeps physical custody; heartbeat reconciles exact immutable hold after restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'child-retire-'));const filePath=path.join(dir,'journal.sqlite');let journal=createAutonomousProjectJournal({filePath});
 const child={...lease,parent_task_id:id(2),claim_class:'READ_ONLY',state:'COMPLETED',tab_id:'tab_'+id(3),target_id:'webcontents:3',agent_generation_epoch:1,active_claim_count:0,active_workspace_binding_count:0};
 let attempts=0,closed=0,lost=true;const receipt={...child,schema:'metaengine.devos.browser-child-retirement.v1',retired:true,retirement_id:id(4),...flags};
 const request=async({path:route,body})=>{
  if(route.endsWith('/snapshot'))return {schema:'metaengine.devos.project-snapshot.v1',found:true,selected_task:child,...flags};
  if(route.endsWith('/release-browser-child')){attempts++;assert.equal(body.task_id,child.task_id);if(lost)throw Error('retirement_ack_lost');return {...receipt,replayed:true};}
  if(route.endsWith('/suspension-list'))return {schema:'metaengine.devos.browser-parent-suspension-list.v1',entries:[],cursor:{next_seq:0,has_more:false},...flags};
  assert.fail(route);
 };
 const open=()=>new BrowserParentSuspension({journal,request,readControl:()=>control,transport:{releaseCompletedBrowserChild:async({receipt:r})=>{
  assert.equal(r.retirement_id,receipt.retirement_id);assert.equal(r.replayed,undefined);closed++;return true;}}});
 t.after(async()=>{await journal.close();await fs.rm(dir,{recursive:true,force:true});});
 await assert.rejects(open().releaseCompleted(child,{state:'COMPLETED'}),/retirement_ack_lost/);assert.equal(closed,0);
 await journal.close();journal=createAutonomousProjectJournal({filePath});lost=false;await open().tick();
 assert.equal(attempts,2);assert.equal(closed,1);assert.equal((await journal.pending()).length,0);
});

function sweepReceipt(n) {
 return {schema:'metaengine.devos.browser-parent-suspension.v1',suspension_id:id(n+100),task_id:id(n),project_id:id(90),
  old_claim_id:n,old_lease_generation:1,checkpoint_sha256:'a'.repeat(64),status:'SUSPENDED',state:'READY_TO_RESUME',lease:null,
  checkpoint:{schema:'metaengine.browser.parent-checkpoint.v1',agent_id:`agent_parent-${n}`,agent_generation_epoch:1,
   conversation_url_sha256:'b'.repeat(64),transcript_floor:0,delivered_tool_results:[]},...flags};
}
function sweepFixture({count=2,hold=()=>{},pending=[],bulkHold=null,mutatePage=p=>p}={}) {
 const rows=Array.from({length:count},(_,i)=>sweepReceipt(i+1));const seen=[],after=[],posts=[];let current={...control};
 const runtime=new BrowserParentSuspension({journal:{pending:async()=>pending,begin:async()=>{},confirm:async()=>{}},
  readControl:()=>current,transport:{reconcileCompletedBrowserChildren:async()=>{if(bulkHold)throw Error(bulkHold);},
   hibernateStored:async r=>{await hold(r,(change={owner_stop:true})=>{current={...current,...change};});},
   resumeStored:async({receipt})=>{seen.push(receipt.task_id);return receipt;}},
  request:async({path:route,body})=>{posts.push(route);assert(route.endsWith('/suspension-list'));
   after.push(body.after_seq);const entries=rows.slice(body.after_seq,body.after_seq+body.limit);
   return mutatePage({schema:'metaengine.devos.browser-parent-suspension-list.v1',entries,
    cursor:{next_seq:body.after_seq+entries.length,has_more:body.after_seq+entries.length<rows.length},...flags});}});
 return {runtime,seen,after,posts};
}

test('a retained physical parent hold cannot starve another parent or later SQL pages',async()=>{
 const h=sweepFixture({count:35,hold:r=>{if(r.task_id===id(1))throw Error('fleet_parent_resume_physical_readback_required');}});
 const first=await h.runtime.tick();assert.equal(first.held.count,1);assert.equal(first.held.items[0].task_id,id(1));
 assert.equal(h.seen.length,31);assert(!h.seen.includes(id(1)),'held parent is never resumed, closed or declared complete');
 await h.runtime.tick();assert.deepEqual(h.after,[0,32]);assert(h.seen.includes(id(35)));
 await h.runtime.tick();assert.deepEqual(h.after,[0,32,0],'cursor returns fairly without discarding the held parent');
});

test('bulk and pending-retirement physical holds do not prevent independent suspended-parent reconciliation',async()=>{
 const pending=[{intent:{schema:'metaengine.browser.child-retirement-intent.v1',lease:{task_id:id(71)},completion:{state:'COMPLETED'}}},
  {intent:{schema:'metaengine.browser.child-retirement-intent.v1',lease:{task_id:id(72)},completion:{state:'COMPLETED'}}}];
 const h=sweepFixture({pending,bulkHold:'browser_parent_close_destroy_readback_required'});let retired=[];
 h.runtime.releaseCompleted=async l=>{retired.push(l.task_id);if(l.task_id===id(71))throw Error('browser_parent_transport_completed_close_unconfirmed');return true;};
 const result=await h.runtime.tick();assert.deepEqual(retired,[id(71),id(72)]);assert.equal(h.seen.length,2);assert.equal(result.held.count,2);
});

for(const reason of ['PROJECT_CONTINUITY_HTTP_403','PROJECT_CONTINUITY_HTTP_401','PROJECT_CONTINUITY_HTTP_503',
 'autonomous_project_journal_corrupt','browser_parent_transport_owner_control_changed','unclassified transport error containing private data']) {
 test(`global or unclassified failure still fences the sweep: ${reason}`,async()=>{
  const h=sweepFixture({hold:()=>{throw Error(reason);}});await assert.rejects(h.runtime.tick(),e=>e.message===reason);
  assert.equal(h.seen.length,0);
 });
}

test('task-local hold followed by Owner stop still aborts before the next parent',async()=>{
 const h=sweepFixture({hold:(_r,stop)=>{stop();throw Error('browser_parent_transport_not_quiescent');}});
 await assert.rejects(h.runtime.tick(),/owner_control_fenced/);assert.equal(h.seen.length,0);
});

test('a malformed later list entry fences the whole page before any physical action',async()=>{
 let observed=0;const h=sweepFixture({hold:()=>{observed++;},mutatePage:p=>({...p,entries:[p.entries[0],{...p.entries[1],checkpoint_sha256:'bad'}]})});
 await assert.rejects(h.runtime.tick(),/receipt_invalid/);assert.equal(observed,0);assert.equal(h.seen.length,0);
});

test('held diagnostics are bounded, while the following page still progresses',async()=>{
 const h=sweepFixture({count:33,hold:r=>{if(r.task_id!==id(33))throw Error('browser_parent_transport_restoration_changed');}});
 const first=await h.runtime.tick();assert.equal(first.held.count,32);assert.equal(first.held.items.length,16);assert.equal(first.held.truncated,true);
 assert(first.held.items.every(row=>row.reason==='browser_parent_transport_restoration_changed'));
 await h.runtime.tick();assert.deepEqual(h.after,[0,32]);assert.deepEqual(h.seen,[id(33)]);
});

test('non-progressing has-more cursor is a global list-integrity fence',async()=>{
 let effects=0;const h=sweepFixture({hold:()=>{effects++;},mutatePage:p=>({...p,cursor:{next_seq:0,has_more:true}})});
 await assert.rejects(h.runtime.tick(),/list_invalid/);assert.equal(effects,0);
});

test('generation changes remain global even when the view reports a task-local hold',async()=>{
 const h=sweepFixture({hold:(_r,change)=>{change({generation_floor:2});throw Error('fleet_parent_resume_physical_readback_required');}});
 await assert.rejects(h.runtime.tick(),/owner_generation_changed/);assert.equal(h.seen.length,0);
});

async function retirementPagesFixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'retirement-pages-')),filePath=path.join(dir,'journal.sqlite');
 let journal=createAutonomousProjectJournal({filePath}),current={...control};const tasks=new Map(),released=[],issued=[];
 const key=n=>`child-retire:${id(n)}:1`;
 for(let n=1;n<=37;n++) {
  const l={task_id:id(n),lease_generation:1,agent_id:`agent_fixture-${String(n).padStart(8,'0')}`,
   tab_id:'tab_'+id(n+100),target_id:`webcontents:${n}`,agent_generation_epoch:1};
  tasks.set(l.task_id,{...l,parent_task_id:id(99),claim_class:'READ_ONLY',state:'COMPLETED',active_claim_count:0,active_workspace_binding_count:0});
  await journal.begin(key(n),{schema:'metaengine.browser.child-retirement-intent.v1',lease:l,completion:{state:'COMPLETED'},
   ...flags,scheduler_authority:false});
  if(n<=35)await journal.begin(`tool-issue:${id(n)}:1:unknown`,{task_id:id(n),lease_generation:1,request_id:'unknown:effect',schema:'fixture.unknown-tool-effect'});
 }
 const request=async({path:route,body})=>{
  if(route.endsWith('/suspension-list'))return {schema:'metaengine.devos.browser-parent-suspension-list.v1',entries:[],cursor:{next_seq:0,has_more:false},...flags};
  issued.push({route,task_id:body.task_id});
  if(route.endsWith('/snapshot'))return {schema:'metaengine.devos.project-snapshot.v1',found:true,selected_task:tasks.get(body.task_id),...flags};
  if(route.endsWith('/release-browser-child'))return {...body,schema:'metaengine.devos.browser-child-retirement.v1',retired:true,retirement_id:id(200),claim_class:'READ_ONLY',state:'COMPLETED',...flags};
  assert.fail(route);
 };
 const open=()=>new BrowserParentSuspension({journal,request,readControl:()=>current,
  transport:{releaseCompletedBrowserChild:async({lease:l})=>{released.push(l.task_id);return true;}}});
 t.after(async()=>{await journal.close();await fs.rm(dir,{recursive:true,force:true});});
 return {open,key,released,issued,journal:()=>journal,control:value=>{current={...current,...value};},
  restart:async()=>{await journal.close();journal=createAutonomousProjectJournal({filePath});return open();}};
}

test('real SQLite retirement pagination passes more than32 UNKNOWN holds without retrying their effects',async t=>{
 const f=await retirementPagesFixture(t),runtime=f.open();
 const first=await runtime.tick();assert.equal(first.held.count,32);assert.equal(f.issued.length,0);
 await runtime.tick();assert.deepEqual(f.released,[id(36),id(37)]);
 assert(f.issued.every(row=>[id(36),id(37)].includes(row.task_id)),'UNKNOWN tasks perform no issue, retirement SQL or physical action');
 for(let n=1;n<=35;n++)assert.equal((await f.journal().find(f.key(n))).receipt,null,'held retirement custody remains unresolved');
 assert.equal((await f.journal().find(`tool-issue:${id(1)}:1:unknown`)).receipt,null);
 await runtime.tick();assert.deepEqual(f.released,[id(36),id(37)],'wrap revisits holds, never replays acknowledged retirement');
});

test('restart loses only advisory cursor and resumes bounded scans without losing UNKNOWN custody',async t=>{
 const f=await retirementPagesFixture(t);await f.open().tick();let runtime=await f.restart();
 await runtime.tick();assert.equal(f.released.length,0,'restart safely re-observes initial pending page');
 await runtime.tick();assert.deepEqual(f.released,[id(36),id(37)],'later work remains reachable after restart');
 runtime=await f.restart();await runtime.tick();await runtime.tick();assert.deepEqual(f.released,[id(36),id(37)]);
 assert.equal((await f.journal().find(f.key(1))).receipt,null);
});

test('pending-page keyset is read-only, handles confirmed boundaries and validates pagination input',async t=>{
 const f=await retirementPagesFixture(t),j=f.journal();
 const first=await j.pendingPage({prefix:'child-retire:',limit:32});assert.equal(first.entries.length,32);assert.equal(first.cursor.has_more,true);
 assert.equal(first.cursor.next_key,f.key(32));
 await j.confirm(f.key(32),{fixture:true});
 const second=await j.pendingPage({prefix:'child-retire:',limit:32,after_key:first.cursor.next_key});
 assert.deepEqual(second.entries.map(row=>row.effect_key),[33,34,35,36,37].map(f.key));assert.equal(second.cursor.has_more,false);
 assert.equal((await j.find(f.key(33))).receipt,null);
 const empty=await j.pendingPage({prefix:'child-retire:',after_key:f.key(37)});assert.equal(empty.entries.length,0);assert.equal(empty.cursor.next_key,f.key(37));
 await assert.rejects(j.pendingPage({limit:0}),/limit_invalid/);await assert.rejects(j.pendingPage({after_key:'bad key'}),/key_invalid/);
 await assert.rejects(j.pendingPage({prefix:'*'}),/key_invalid/);
});

test('local retirement page corruption is global and validated before any retirement',async()=>{
 let called=0;const row={effect_key:`child-retire:${id(1)}:1`,receipt:null,
  intent:{schema:'metaengine.browser.child-retirement-intent.v1',lease:{task_id:id(1),lease_generation:1},completion:{state:'COMPLETED'}}};
 const runtime=new BrowserParentSuspension({readControl:()=>control,transport:{},request:async()=>assert.fail('no SQL after corrupt page'),
  journal:{pendingPage:async()=>({schema:'metaengine.project.pending-effect-page.v1',entries:[row,{...row,effect_key:`child-retire:${id(2)}:1`}],
   cursor:{after_key:null,next_key:`child-retire:${id(2)}:1`,has_more:false},...flags})}});
 runtime.releaseCompleted=async()=>{called++;};
 await assert.rejects(runtime.tick(),/retirement_page_invalid/);assert.equal(called,0);
});

test('global authorization failure does not advance local retirement cursor',async t=>{
 const f=await retirementPagesFixture(t);const starts=[],underlying=f.journal();let deny=true;
 const journal={...underlying,pendingPage:async args=>{starts.push(args.after_key);return underlying.pendingPage(args);}};
 const runtime=new BrowserParentSuspension({journal,readControl:()=>control,transport:{},request:async()=>{
  if(deny)throw Error('PROJECT_CONTINUITY_HTTP_403');
  return {schema:'metaengine.devos.browser-parent-suspension-list.v1',entries:[],cursor:{next_seq:0,has_more:false},...flags};}});
 runtime.releaseCompleted=async()=>({state:'PENDING_EFFECT_REQUIRES_READBACK'});
 await assert.rejects(runtime.tick(),/HTTP_403/);deny=false;await runtime.tick();await runtime.tick();
 assert.deepEqual(starts,[null,null,f.key(32)]);assert.equal((await underlying.find(f.key(1))).receipt,null);
});

 test('message-ready suspension resumes through the existing durable callback once',async t=>{
  const f=await fixture(t);await f.confirm();let runtime=f.open();await runtime.suspend(lease);
  f.ready('READY_FOR_MESSAGE');runtime=await f.restart();await runtime.tick();
  assert.equal(f.counts().resumePosts,1);await runtime.tick();assert.equal(f.counts().resumePosts,1);
  const turn=await f.journal().latestConversationTurn({...lease,lease_generation:2});
  assert.equal(turn.receipt.effect_state,'RESTORED_EXISTING_CONVERSATION');
 });
