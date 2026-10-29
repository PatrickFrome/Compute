import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { AutonomousProjectTaskRuntime } from '../src/autonomous-project-task-runtime.mjs';
import { createAutonomousProjectJournal } from '../src/autonomous-project-journal.mjs';
import { createAutonomousProjectProviderFixture } from './fixtures/autonomous-project-provider.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const rootTask = () => ({ task_id: '22222222-2222-4222-8222-222222222222', parent_task_id: null,
  root_task_id: '22222222-2222-4222-8222-222222222222', agent_id: 'agent_root-fixture-001',
  claim_id: 10, lease_generation: 1, depth: 0, role: 'CODER', state: 'RUNNING' });
const spawnRequest = (request_id = 'fixture:spawn:one') => ({ request_id, action: 'PROJECT_SPAWN',
  payload: { children: [{ objective: 'Implement one useful child task with independent evidence', role: 'CODER' }] } });
async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-autonomous-project-')));
  const journalPath = path.join(root, 'effects.sqlite'), providerPath = path.join(root, 'provider.sqlite');
  const provider = createAutonomousProjectProviderFixture({ filePath: providerPath, projectId, rootTask: rootTask(), ...options });
  const journal = createAutonomousProjectJournal({ filePath: journalPath });
  const runtime = new AutonomousProjectTaskRuntime({ journal, request: input => provider.request(input), materializeProject: async () => ({ state: 'PROVEN' }) });
  const resources = [runtime];
  const own = resource => { resources.push(resource); return resource; };
  // after hooks run in registration order. Reopened SQLite handles belong to
  // this teardown, not a later hook that would run after directory removal.
  t.after(async () => {
    for (const resource of resources.toReversed()) await resource.close();
    provider.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, journalPath, providerPath, provider, journal, runtime, own };
}

test('fixture closes reopened journals and runtimes before removing their directory', async t => {
  const f = await fixture(t);
  let restored, runtimeJournal;
  f.own({ async close() {
    await assert.rejects(restored.pending(), /autonomous_project_journal_closed/);
    await assert.rejects(runtimeJournal.pending(), /autonomous_project_journal_closed/);
    assert.equal((await fs.stat(f.journalPath)).isFile(), true, 'close handles before removing the database');
  } });
  await f.runtime.close();
  restored = f.own(createAutonomousProjectJournal({ filePath: f.journalPath }));
  runtimeJournal = createAutonomousProjectJournal({ filePath: f.journalPath });
  f.own(new AutonomousProjectTaskRuntime({ journal: runtimeJournal,
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
  t.after(async () => {
    await assert.rejects(restored.pending(), /autonomous_project_journal_closed/);
    await assert.rejects(runtimeJournal.pending(), /autonomous_project_journal_closed/);
    await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
  });
});

test('recursive root/child/grandchild admission shares committed history while external ChatGPT creation remains unclaimed', async t => {
  const f = await fixture(t);
  assert.equal((await f.runtime.prepareLease(rootTask())).project_id, projectId);
  assert.match(f.runtime.contextForLease(rootTask()), /PROJECT_HISTORY/);
  await f.runtime.serveToolRequests({ lease: rootTask(), requests: [spawnRequest()] });
  const child = f.provider.read().tasks[1];
  await f.runtime.prepareLease(child);
  await f.runtime.serveToolRequests({ lease: child, requests: [spawnRequest('fixture:spawn:grandchild')] });
  const grandchild = f.provider.read().tasks[2];
  assert.equal(grandchild.depth, 2); assert.equal(grandchild.parent_task_id, child.task_id);
  const history = await f.runtime.serveToolRequests({ lease: grandchild,
    requests: [{ request_id: 'fixture:history:one', action: 'PROJECT_HISTORY', payload: { after_seq: 0, limit: 16 } }] });
  const readback = JSON.parse(history[0].summary);
  assert.deepEqual(readback.entries.map(row => row.seq), [1, 2]);
  assert.equal(readback.cursor.commit_ordered, true);
  assert.equal(f.provider.read().physical_provider_creations, 0);
  assert.equal(f.runtime.snapshot().physical_provider_creation_claimed, false);
  assert.equal((await f.runtime.waitForChildren(rootTask())).waiting, true);
  f.provider.update(state => { state.tasks[1].state = 'FAILED'; });
  assert.equal((await f.runtime.waitForChildren(rootTask())).failed, true);
});

for (const [role, state] of [['CODER', 'FAILED'], ['CRITIC', 'BLOCKED'], ['CRITIC', 'AMBIGUOUS'], ['CODER', 'FENCED']]) {
  test(`blocking ${role} child ${state} takes priority over open children and pending proposals`, async t => {
    const f = await fixture(t);
    await f.runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(), payload: { children: [
      { objective: 'Produce or independently verify one child result', role },
      { objective: 'Unfinished sibling work', role: 'CODER' },
    ] } }] });
    f.provider.update(value => {
      value.tasks[1].state = state;
      // Match the PostgreSQL projection: every non-COMPLETED child remains
      // open, including a failed/rejected verifier, alongside queued work.
      value.tasks[0].open_children = 2;
      value.tasks[0].blocking_children = 1;
      value.tasks[0].pending_proposals = 1;
    });
    const before = f.provider.read();
    const result = await f.runtime.waitForChildren(rootTask());
    assert.equal(result.failed, true);
    assert.equal(result.waiting, false, 'the parent must reach its existing BLOCKED path instead of waiting indefinitely');
    assert.deepEqual(result.children, before.tasks.slice(1).map(child => ({ task_id: child.task_id, state: child.state, role: child.role })));
    assert.equal(result.authority_effect, false);
    assert.equal(result.automatic_retry_allowed, false);
    assert.deepEqual(f.provider.read(), before, 'readback must not repair, replay or promote a failed/unknown child');
  });
}

for (const signal of ['blocking_children', 'selected_task_children_failed']) {
  test(`blocking aggregate ${signal} takes priority when failed children are outside the resident page`, async t => {
    const f = await fixture(t);
    f.provider.update(value => {
      value.tasks[0].open_children = 2;
      value.tasks[0].pending_proposals = 1;
      if (signal === 'blocking_children') value.tasks[0].blocking_children = 1;
      else value.selected_task_children_failed = true;
    });
    const before = f.provider.read();
    const result = await f.runtime.waitForChildren(rootTask());
    assert.equal(result.failed, true);
    assert.equal(result.waiting, false);
    assert.deepEqual(result.children, []);
    assert.deepEqual(f.provider.read(), before);
  });
}

test('open and queued children without a blocking result still make the parent wait', async t => {
  const f = await fixture(t);
  f.provider.update(value => { value.tasks[0].open_children = 2; value.tasks[0].pending_proposals = 1; });
  const result = await f.runtime.waitForChildren(rootTask());
  assert.equal(result.failed, false);
  assert.equal(result.waiting, true);
});

test('a rejected verifier in the visible child page blocks even without aggregate counters', async t => {
  const f = await fixture(t);
  await f.runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(),
    payload: { children: [{ objective: 'Independently verify the proposed result', role: 'CRITIC' }] } }] });
  f.provider.update(value => { value.tasks[1].state = 'BLOCKED'; });
  const before = f.provider.read();
  const result = await f.runtime.waitForChildren(rootTask());
  assert.equal(result.failed, true);
  assert.equal(result.waiting, false);
  assert.equal(result.children[0].role, 'CRITIC');
  assert.equal(result.children[0].state, 'BLOCKED');
  assert.deepEqual(f.provider.read(), before);
});

test('physical process crash after provider COMMIT reconciles immutable batch without another child', async t => {
  const f = await fixture(t); await f.runtime.close();
  const script = fileURLToPath(new URL('./fixtures/autonomous-project-crash-child.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, f.journalPath, f.providerPath, projectId, JSON.stringify(rootTask())], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes; }); child.stdout.resume();
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 66, errors); assert.equal(f.provider.read().tasks.length, 2);
  const restarted = new AutonomousProjectTaskRuntime({ journal: createAutonomousProjectJournal({ filePath: f.journalPath }),
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'PROVEN' }) });
  try {
    const result = await restarted.serveToolRequests({ lease: rootTask(), requests: [spawnRequest('fixture:spawn:crash')] });
    assert.equal(result[0].status, 'COMPLETED'); assert.equal(f.provider.read().tasks.length, 2);
    assert.equal(f.provider.read().entries.length, 1);
  } finally { await restarted.close(); }
});

test('malformed proposals, stale parent claims and owner stop prevent child admission', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(), payload: { children: [{ role: 'CODER', objective: 'Task', claim_id: 999 }] } }] }), /proposal_invalid/);
  await assert.rejects(f.runtime.serveToolRequests({ lease: { ...rootTask(), claim_id: 999 }, requests: [spawnRequest()] }), /claim_drift/);
  f.provider.update(state => { state.policy.owner_stop = true; });
  await assert.rejects(f.runtime.serveToolRequests({ lease: rootTask(), requests: [spawnRequest()] }), /owner_stopped/);
  assert.equal(f.provider.read().tasks.length, 1);
});

test('same task continuation journals one send and a crash before receipt never blindly resends', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask());
  let sends = 0; const results = [{ request_id: 'fixture:tool:done', status: 'COMPLETED', summary: 'verified tool readback' }];
  const send = async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; };
  const observedBoundary = { observeTranscriptFloor: async () => 1200 };
  const delivered = await f.runtime.continueConversation(rootTask(), results, send, observedBoundary);
  assert.equal(delivered.state, 'DELIVERED'); assert.equal(delivered.transcript_floor, 1200);
  assert.equal((await f.runtime.continueConversation(rootTask(), results, send)).state, 'ALREADY_DELIVERED');
  assert.equal((await f.runtime.latestTurnForLease(rootTask())).transcript_floor, 1200);
  assert.equal(sends, 1);
  const ambiguousResults = [{ ...results[0], request_id: 'fixture:tool:ambiguous' }];
  await assert.rejects(f.runtime.continueConversation(rootTask(), ambiguousResults, async () => { sends++; throw new Error('fixture_process_loss_after_send'); }, observedBoundary), /fixture_process_loss/);
  assert.equal((await f.runtime.continueConversation(rootTask(), ambiguousResults, send)).state, 'AMBIGUOUS');
  assert.equal((await f.runtime.latestTurnForLease(rootTask())).state, 'AMBIGUOUS');
  assert.equal(sends, 2);
});

test('confirmed continuation transcript boundary survives journal restart and is scoped to its exact lease', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask());
  const originalContext = f.runtime.contextForLease(rootTask());
  await assert.rejects(f.runtime.continueConversation(rootTask(), [{ request_id: 'fixture:boundary:missing' }], async () => {
    assert.fail('boundaryless turn must never send');
  }), /continuation_boundary_required/);
  const results = [{ request_id: 'fixture:boundary:done', status: 'COMPLETED', summary: 'observed result' }];
  let originalPrompt;
  await f.runtime.continueConversation(rootTask(), results, async prompt => {
    originalPrompt = prompt; return { effect_state: 'PROVEN_COMPOSER_CLEARED' };
  },
    { observeTranscriptFloor: async () => 4096 });
  const originalTurn = await f.journal.latestConversationTurn(rootTask());
  await f.runtime.close();
  let materialized = 0;
  const restartedJournal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const restarted = new AutonomousProjectTaskRuntime({ journal: restartedJournal,
    request: input => f.provider.request(input), materializeProject: async () => { materialized++; return { state: 'PROVEN' }; } });
  try {
    assert.equal((await restarted.latestTurnForLease(rootTask())).transcript_floor, 4096);
    assert.equal(await restarted.latestTurnForLease({ ...rootTask(), lease_generation: 2 }), null);
    const replay = await restarted.continueConversation(rootTask(), results, async () => { assert.fail('confirmed send must not be repeated'); });
    assert.equal(replay.state, 'ALREADY_DELIVERED'); assert.equal(replay.transcript_floor, 4096);
    assert.equal(restarted.contextForLease(rootTask()), originalContext);
    assert.ok(originalPrompt.includes(originalContext));
    assert.deepEqual(await restartedJournal.latestConversationTurn(rootTask()), originalTurn);
    assert.equal(materialized, 0);

    // A changed authoritative project identity cannot reuse the old receipt.
    f.provider.update(state => { state.root_task_id = '33333333-3333-4333-8333-333333333333'; });
    await assert.rejects(restarted.continueConversation(rootTask(), results, async () => {
      assert.fail('changed project context must never resend a confirmed turn');
    }), /continuation_binding_drift/);
    assert.deepEqual(await restartedJournal.latestConversationTurn(rootTask()), originalTurn);
  } finally { await restarted.close(); }
});

test('unfinished continuation recovers its context after restart and never repeats the uncertain send', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask());
  const originalContext = f.runtime.contextForLease(rootTask());
  const results = [{ request_id: 'fixture:boundary:uncertain', status: 'COMPLETED', summary: 'observed result' }];
  let sends = 0;
  await assert.rejects(f.runtime.continueConversation(rootTask(), results, async () => {
    sends++; throw new Error('fixture_process_loss_after_send');
  }, { observeTranscriptFloor: async () => 2048 }), /fixture_process_loss_after_send/);
  const originalTurn = await f.journal.latestConversationTurn(rootTask());
  await f.runtime.close();
  const restartedJournal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const restarted = new AutonomousProjectTaskRuntime({ journal: restartedJournal,
    request: input => f.provider.request(input), materializeProject: async () => { assert.fail('recovery must not rematerialize the worktree'); } });
  try {
    const replay = await restarted.continueConversation(rootTask(), results, async () => { sends++; assert.fail('uncertain send must not be repeated'); });
    assert.equal(replay.state, 'AMBIGUOUS');
    assert.equal(replay.physical_effect_replayed, false);
    assert.equal(restarted.contextForLease(rootTask()), originalContext);
    assert.equal((await restarted.latestTurnForLease(rootTask())).state, 'AMBIGUOUS');
    assert.deepEqual(await restartedJournal.latestConversationTurn(rootTask()), originalTurn);
    assert.equal(sends, 1);
  } finally { await restarted.close(); }
});

test('current project context is recovered after runtime restart without rematerializing a running worktree', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask()); await f.runtime.close();
  let materialized = 0;
  const restarted = new AutonomousProjectTaskRuntime({ journal: createAutonomousProjectJournal({ filePath: f.journalPath }),
    request: input => f.provider.request(input), materializeProject: async () => { materialized++; return { state: 'PROVEN' }; } });
  try {
    await restarted.refreshContext(rootTask());
    assert.match(restarted.contextForLease(rootTask()), /PROJECT CONTINUITY V1/);
    assert.equal(materialized, 0);
  } finally { await restarted.close(); }
});

test('foreign SQLite schema is refused before changing its mode or bytes', async t => {
  const f = await fixture(t); const foreign = path.join(f.root, 'foreign.sqlite');
  const db = new DatabaseSync(foreign); db.exec('CREATE TABLE foreign_table(value TEXT)'); db.close();
  const before = await fs.readFile(foreign);
  assert.throws(() => createAutonomousProjectJournal({ filePath: foreign }), /schema_invalid/);
  assert.deepEqual(await fs.readFile(foreign), before);
});

for (const outcome of ['LOST_ACK','HTTP_500','MALFORMED_ACCEPTED']) {
  test(`delivering ${outcome} tool result never releases UNKNOWN effect custody, including SQLite restart`, async t => {
    const { AgentToolbelt } = await import('../src/agent-toolbelt-core.mjs');
    const { BrowserParentSuspension } = await import('../src/browser-parent-suspension.mjs');
    const f=await fixture(t);const lease=rootTask();let issues=0,captures=0;
    const tools=new AgentToolbelt({signedRequest:async()=>{issues++;
      if(outcome==='LOST_ACK')throw Error('lost_issue_ack');
      return {ok:outcome!=='HTTP_500',status:outcome==='HTTP_500'?500:200,json:async()=>({accepted:true})};}});
    await tools.serveToolRequests({lease,requests:[{request_id:'unknown:effect:one',action:'CAPTURE',payload:{}}]});
    assert.equal(tools.pendingCount(lease),0,'terminal display result is not pending command acknowledgement');
    const results=tools.resultsForLease(lease);assert.equal(results[0].effect_unknown,true);
    await f.runtime.continueConversation(lease,results,async()=>({effect_state:'PROVEN_COMPOSER_CLEARED'}),{observeTranscriptFloor:async()=>12});
    assert.equal((await f.journal.conversationCheckpoint(lease)).state,'UNKNOWN_TOOL_EFFECT_REQUIRES_READBACK');
    await f.runtime.close();const restored=f.own(createAutonomousProjectJournal({filePath:f.journalPath}));
    assert.equal(await restored.hasPendingTaskEffect(lease),true,'confirmed display never converts UNKNOWN operation to resolved');
    const suspension=new BrowserParentSuspension({journal:restored,request:async()=>assert.fail('no SQL suspension'),
      transport:{withQuiescentParent:async()=>{captures++;}},readControl:()=>({authoritative:true,state:'OPEN',continuous_service_allowed:true,generation_floor:1}),
      taskSnapshot:async()=>({snapshot:{project_id:projectId},task:{claim_class:'READ_ONLY',claim_id:10}})});
    assert.equal((await suspension.suspend(lease)).state,'UNKNOWN_TOOL_EFFECT_REQUIRES_READBACK');
    assert.equal(captures,0);assert.equal(issues,1);
  });
}

for(const accepted of [false,true]) {
 test(`tool issue custody survives crash BEFORE continuation (${accepted?'accepted command':'lost issue ACK'}) without reissue`,async t=>{
  const {AgentToolbelt}=await import('../src/agent-toolbelt-core.mjs');const f=await fixture(t),lease=rootTask();let issues=0;
  // A prior confirmed wait checkpoint must not hide a subsequently issued effect.
  await f.runtime.continueConversation(lease,[{request_id:'prior:ack',status:'COMPLETED',summary:'waiting'}],async()=>({effect_state:'PROVEN_COMPOSER_CLEARED'}),{observeTranscriptFloor:async()=>0});
  const commandId='44444444-4444-4444-8444-444444444444';
  const first=new AgentToolbelt({signedRequest:async()=>{issues++;assert.equal(await f.journal.hasPendingTaskEffect(lease),true,'write-ahead custody precedes issue');
    if(!accepted)throw Error('committed_issue_ack_lost');return {ok:true,status:200,json:async()=>({accepted:true,command_id:commandId})};}});
  first.bindProjectRuntime(f.runtime);
  const requests=[{request_id:'crash:before:continuation',action:'CAPTURE',payload:{}}];await first.serveToolRequests({lease,requests});
  assert.equal((await f.journal.conversationCheckpoint(lease)).state,'PENDING_EFFECT_REQUIRES_READBACK');
  await f.runtime.close();const journal=createAutonomousProjectJournal({filePath:f.journalPath});
  const runtime=f.own(new AutonomousProjectTaskRuntime({journal,request:i=>f.provider.request(i),materializeProject:async()=>({state:'NOT_REQUIRED'})}));
  const recovered=new AgentToolbelt({signedRequest:async endpoint=>{assert(!endpoint.includes('issue-tool'),'pending issue is never replayed');
    assert(endpoint.includes(commandId));return {ok:true,status:200,json:async()=>({found:true,terminal:true,status:'COMPLETED',receipt:{result:'exact terminal readback'}})};}});
  recovered.bindProjectRuntime(runtime);await recovered.serveToolRequests({lease,requests});assert.equal(issues,1);
  if(accepted){assert.equal(recovered.pendingCount(lease),1);await recovered.harvestResults({lease});assert.equal(await journal.hasPendingTaskEffect(lease),false);}
  else {assert.equal(recovered.resultsForLease(lease)[0].effect_unknown,true);assert.equal(await journal.hasPendingTaskEffect(lease),true);}
 });
}

test('concurrent tool custody acquisition grants exactly one issue barrier',async t=>{
 const f=await fixture(t),request={request_id:'concurrent:one',action:'CAPTURE',payload:{}};
 const results=await Promise.all([f.runtime.beginToolEffect(rootTask(),request),f.runtime.beginToolEffect(rootTask(),request)]);
 assert.equal(results.filter(r=>r.state==='NEW').length,1);assert.equal(results.filter(r=>r.state==='UNKNOWN').length,1);
});

async function buriedPendingSpawn(t) {
 let committed=0;
 const f=await fixture(t,{afterCommit:async()=>{committed++;throw Error('fixture_spawn_ack_lost');}});
 for(let n=0;n<12;n++)await f.journal.begin(`child-retire:unrelated-${String(n).padStart(2,'0')}`,{
  schema:'fixture.held-unrelated-effect',task_id:`unrelated-${n}`,lease_generation:1});
 const request=spawnRequest('fixture:spawn:buried');
 await assert.rejects(f.runtime.serveToolRequests({lease:rootTask(),requests:[request]}),/fixture_spawn_ack_lost/);
 const key=`spawn:${projectId}:${rootTask().task_id}:${request.request_id}`;
 assert.equal(f.provider.read().tasks.length,2);assert.equal((await f.journal.find(key)).receipt,null);
 return {...f,key,commits:()=>committed};
}

test('current-parent spawn readback is reachable behind more than8 unrelated durable UNKNOWN holds',async t=>{
 const f=await buriedPendingSpawn(t);
 assert.equal((await f.journal.pending({limit:8})).every(row=>row.effect_key.startsWith('child-retire:')),true);
 await f.runtime.waitForChildren(rootTask());assert.equal((await f.journal.find(f.key)).receipt.task_admission_proven,true);
 await f.runtime.waitForChildren(rootTask());assert.equal(f.commits(),1);assert.equal(f.provider.read().tasks.length,2);
 assert.equal(f.provider.read().entries.length,1,'idempotent readback cannot create a second batch');
 for(let n=0;n<12;n++)assert.equal((await f.journal.find(`child-retire:unrelated-${String(n).padStart(2,'0')}`)).receipt,null);
});

test('parent-scoped pending spawn recovery survives journal restart without duplicate child admission',async t=>{
 const f=await buriedPendingSpawn(t);await f.runtime.close();
 const journal=createAutonomousProjectJournal({filePath:f.journalPath});
 const runtime=f.own(new AutonomousProjectTaskRuntime({journal,request:i=>f.provider.request(i),materializeProject:async()=>({state:'NOT_REQUIRED'})}));
 await runtime.waitForChildren(rootTask());assert.equal((await journal.find(f.key)).receipt.task_admission_proven,true);
 assert.equal(f.commits(),1);assert.equal(f.provider.read().tasks.length,2);
});

for(const fence of ['OWNER_STOP','CLAIM_CHANGED','GENERATION_CHANGED']) {
 test(`scoped pending spawn never bypasses ${fence}`,async t=>{
  const f=await buriedPendingSpawn(t);
  f.provider.update(state=>{if(fence==='OWNER_STOP')state.policy.owner_stop=true;
   else if(fence==='CLAIM_CHANGED')state.tasks[0].claim_id=999;else state.tasks[0].lease_generation=2;});
  await assert.rejects(f.runtime.waitForChildren(rootTask()),/owner_stopped|claim_drift|parent_lease_not_current/);
  assert.equal((await f.journal.find(f.key)).receipt,null);assert.equal(f.commits(),1);assert.equal(f.provider.read().tasks.length,2);
 });
}

async function buriedSameParentSpawn(t) {
 const f=await buriedPendingSpawn(t),pending=await f.journal.find(f.key),keys=[];
 for(let n=0;n<12;n++) {
  const requestId=`aaa:old:${String(n).padStart(2,'0')}`,intent=structuredClone(pending.intent);
  intent.local_request_id=requestId;intent.body.request_id=fixtureSpawnWireId(requestId);intent.body.lease_generation=99;intent.body.claim_id=999;
  const key=`spawn:${projectId}:${rootTask().task_id}:${requestId}`;
  await f.journal.begin(key,intent);keys.push(key);
 }
 return {...f,oldKeys:keys};
}

for(const restart of [false,true])test(`current lease progresses beyond same-parent old-lease UNKNOWN holds (restart=${restart})`,async t=>{
 const f=await buriedSameParentSpawn(t);let runtime=f.runtime,journal=f.journal;
 await runtime.waitForChildren(rootTask());assert.equal((await journal.find(f.key)).receipt,null,'first bounded page only sees old leases');
 if(restart) {
  await runtime.close();journal=createAutonomousProjectJournal({filePath:f.journalPath});
  runtime=f.own(new AutonomousProjectTaskRuntime({journal,request:i=>f.provider.request(i),materializeProject:async()=>({state:'NOT_REQUIRED'})}));
  await runtime.waitForChildren(rootTask());assert.equal((await journal.find(f.key)).receipt,null,'restart safely rescans first page');
 }
 await runtime.waitForChildren(rootTask());assert.equal((await journal.find(f.key)).receipt.task_admission_proven,true);
 for(let n=0;n<4;n++)await runtime.waitForChildren(rootTask());
 assert.equal(f.commits(),1);assert.equal(f.provider.read().tasks.length,2);assert.equal(f.provider.read().entries.length,1);
 for(const key of f.oldKeys)assert.equal((await journal.find(key)).receipt,null,'old lease UNKNOWN custody must not be replayed or deleted');
});

test('same-parent scan does not advance past a page when final Owner validation fails',async t=>{
 const f=await buriedSameParentSpawn(t);let snapshots=0,stopAtEnd=true;
 const runtime=new AutonomousProjectTaskRuntime({journal:f.journal,materializeProject:async()=>({state:'NOT_REQUIRED'}),request:async input=>{
  if(input.path.endsWith('/snapshot')&&++snapshots===2&&stopAtEnd)f.provider.update(state=>{state.policy.owner_stop=true;});
  return f.provider.request(input);
 }});f.own(runtime);
 await assert.rejects(runtime.waitForChildren(rootTask()),/owner_stopped/);
 stopAtEnd=false;f.provider.update(state=>{state.policy.owner_stop=false;});
 await runtime.waitForChildren(rootTask());assert.equal((await f.journal.find(f.key)).receipt,null,'failed page cannot advance cursor');
 await runtime.waitForChildren(rootTask());assert.equal((await f.journal.find(f.key)).receipt.task_admission_proven,true);
 for(const key of f.oldKeys)assert.equal((await f.journal.find(key)).receipt,null);
 assert.equal(f.commits(),1);
});

function fixtureSpawnWireId(id) {
 const hash=crypto.createHash('sha256').update(JSON.stringify(['spawn',projectId,rootTask().task_id,id])).digest('hex');
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
test('optional caller claim cannot conceal final authoritative claim drift or advance cursor',async t=>{
 const f=await buriedSameParentSpawn(t);let snapshots=0;
 const runtime=new AutonomousProjectTaskRuntime({journal:f.journal,materializeProject:async()=>({state:'NOT_REQUIRED'}),request:async input=>{
  if(input.path.endsWith('/snapshot')&&++snapshots===2)f.provider.update(state=>{state.tasks[0].claim_id=999;});
  return f.provider.request(input);
 }});f.own(runtime);const lease=rootTask();delete lease.claim_id;
 await assert.rejects(runtime.waitForChildren(lease),/parent_claim_drift/);
 f.provider.update(state=>{state.tasks[0].claim_id=rootTask().claim_id;});
 await runtime.waitForChildren(lease);assert.equal((await f.journal.find(f.key)).receipt,null);
 await runtime.waitForChildren(lease);assert.equal((await f.journal.find(f.key)).receipt.task_admission_proven,true);
});
for(const tamper of ['children','wire_id','hash','flags','claim','generation','request_id','extra'])test(`whole spawn page preflight rejects later malformed ${tamper} before earlier readback`,async t=>{
 const f=await buriedPendingSpawn(t),intent=structuredClone((await f.journal.find(f.key)).intent);
 intent.local_request_id='zzz:malformed';intent.body.request_id=fixtureSpawnWireId(intent.local_request_id);
 if(tamper==='children')intent.body.children[0].role='INVALID';
 if(tamper==='wire_id')intent.body.request_id='bad';
 if(tamper==='hash')intent.proposal_sha256='bad';
 if(tamper==='flags')intent.authority_effect=true;
 if(tamper==='claim')intent.body.claim_id=0;
 if(tamper==='generation')intent.body.lease_generation=0;
 if(tamper==='request_id')intent.local_request_id='zzz:invalid!';
 if(tamper==='extra')intent.body.extra=true;
 const key=`spawn:${projectId}:${rootTask().task_id}:${intent.local_request_id}`;
 // Invalid key characters are tested through a valid journal key with mismatched local ID.
 await f.journal.begin(tamper==='request_id'?key.replace('!','_'):key,intent);
 let posts=0;const runtime=new AutonomousProjectTaskRuntime({journal:f.journal,materializeProject:async()=>({state:'NOT_REQUIRED'}),request:input=>{
  if(input.path.endsWith('/spawn'))posts++;return f.provider.request(input);
 }});f.own(runtime);
 await assert.rejects(runtime.waitForChildren(rootTask()),/spawn_pending_page_invalid|proposal_invalid/);
 assert.equal(posts,0,'whole-page preflight precedes every spawn POST');
 assert.equal((await f.journal.find(f.key)).receipt,null,'earlier valid intent cannot be confirmed before full page validation');
 assert.equal(f.commits(),1);
});

 test('pending spawn recovery pins project before journal write or POST, not only final readback',async t=>{
 const f=await buriedPendingSpawn(t);let snapshots=0,posts=0;
 const otherProject='33333333-3333-4333-8333-333333333333';
 const runtime=new AutonomousProjectTaskRuntime({journal:f.journal,materializeProject:async()=>({state:'NOT_REQUIRED'}),request:input=>{
  if(input.path.endsWith('/snapshot')&&++snapshots===2)f.provider.update(state=>{state.project_id=otherProject;});
  if(input.path.endsWith('/spawn'))posts++;
  return f.provider.request(input);
 }});f.own(runtime);
 await assert.rejects(runtime.waitForChildren(rootTask()),/parent_project_drift/);
 assert.equal(posts,0);assert.equal(f.commits(),1);assert.equal(f.provider.read().tasks.length,2);
 assert.equal((await f.journal.find(f.key)).receipt,null);
 assert.equal(await f.journal.find(f.key.replace(projectId,otherProject)),null);
});

for (const sameRequest of [true, false]) {
  test(`concurrent continuation contenders receive one durable send barrier (same request=${sameRequest})`, async t => {
    const f = await fixture(t);
    const competingJournal = createAutonomousProjectJournal({ filePath: f.journalPath });
    const competing = f.own(new AutonomousProjectTaskRuntime({ journal: competingJournal,
      request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
    let observed = 0, release;
    const bothObserved = new Promise(resolve => { release = resolve; });
    const boundary = { observeTranscriptFloor: async () => {
      if (++observed === 2) release();
      await bothObserved;
      return 100;
    } };
    let sends = 0;
    const send = async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; };
    const first = [{ request_id: 'fixture:concurrent:first', status: 'COMPLETED', summary: 'verified result' }];
    const second = sameRequest ? first : [{ ...first[0], request_id: 'fixture:concurrent:second' }];
    const results = await Promise.all([
      f.runtime.continueConversation(rootTask(), first, send, boundary),
      competing.continueConversation(rootTask(), second, send, boundary),
    ]);
    assert.equal(sends, 1, 'only the transaction that acquires the current continuation barrier may send');
    assert.deepEqual(results.map(row => row.state).sort(), ['AMBIGUOUS', 'DELIVERED']);
    assert.ok(results.every(row => row.automatic_retry_allowed === false));
    assert.equal((await f.journal.pending()).length, 0, 'a losing contender must not create another intent');
  });
}

test('a delayed transcript observation cannot adopt a predecessor confirmed after that observation began', async t => {
  const f = await fixture(t);
  const journal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const competing = f.own(new AutonomousProjectTaskRuntime({ journal,
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  let sends = 0;
  const send = async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; };
  const result = id => [{ request_id: id, status: 'COMPLETED', summary: 'observed result' }];
  const losingTurn = competing.continueConversation(rootTask(), result('fixture:delayed:successor'), send,
    { observeTranscriptFloor: async () => { enter(); await delayed; return 100; } });
  await entered;
  const winner = await f.runtime.continueConversation(rootTask(), result('fixture:delayed:first'), send,
    { observeTranscriptFloor: async () => 100 });
  const confirmed = await f.journal.latestConversationTurn(rootTask());
  release();
  const loser = await losingTurn;
  assert.equal(winner.state, 'DELIVERED');
  assert.equal(loser.state, 'AMBIGUOUS', 'the predecessor must be pinned before the asynchronous floor observation');
  assert.equal(sends, 1);
  assert.deepEqual(await f.journal.latestConversationTurn(rootTask()), confirmed);
});

test('restart preserves an uncertain turn HOLD when a different successor request arrives', async t => {
  const f = await fixture(t);
  let sends = 0;
  const uncertain = [{ request_id: 'fixture:prior:unknown', status: 'COMPLETED', summary: 'observed result' }];
  await assert.rejects(f.runtime.continueConversation(rootTask(), uncertain, async () => {
    sends++;
    throw new Error('fixture_process_loss_after_send');
  }, { observeTranscriptFloor: async () => 90 }), /fixture_process_loss_after_send/);
  const pendingTurn = await f.journal.latestConversationTurn(rootTask());
  await f.runtime.close();
  const journal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const restarted = f.own(new AutonomousProjectTaskRuntime({ journal,
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
  const result = await restarted.continueConversation(rootTask(),
    [{ request_id: 'fixture:new:successor', status: 'COMPLETED', summary: 'another observed result' }],
    async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; },
    { observeTranscriptFloor: async () => 120 });
  assert.equal(result.state, 'AMBIGUOUS', 'new request bytes cannot supersede unresolved physical delivery');
  assert.equal(sends, 1);
  assert.equal(result.automatic_retry_allowed, false);
  assert.deepEqual(await journal.latestConversationTurn(rootTask()), pendingTurn);
  assert.equal((await restarted.latestTurnForLease(rootTask())).state, 'AMBIGUOUS');
});

test('an older UNKNOWN turn remains fenced after a pre-fix journal already recorded a newer confirmed turn', async t => {
  const f = await fixture(t);
  const results = [{ request_id: 'fixture:legacy:unknown', status: 'COMPLETED', summary: 'observed result' }];
  let sends = 0;
  await assert.rejects(f.runtime.continueConversation(rootTask(), results, async () => {
    sends++; throw new Error('fixture_process_loss_after_send');
  }, { observeTranscriptFloor: async () => 30 }), /fixture_process_loss_after_send/);
  const unknown = await f.journal.latestConversationTurn(rootTask());
  // Model a journal produced by the old implementation, which could append
  // and confirm another turn despite the unresolved predecessor. No new
  // physical send is simulated for this historical fixture record.
  const laterKey = `turn:${rootTask().task_id}:1:legacy-later`;
  const laterIntent = { ...unknown.intent, transcript_floor: 60 };
  await f.journal.begin(laterKey, laterIntent);
  await f.journal.confirm(laterKey, { effect_state: 'PROVEN_COMPOSER_CLEARED',
    prompt_sha256: laterIntent.prompt_sha256, transcript_floor: 60 });
  await f.runtime.close();
  const journal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const restarted = f.own(new AutonomousProjectTaskRuntime({ journal,
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
  const recovered = await restarted.latestTurnForLease(rootTask());
  assert.equal(recovered.state, 'AMBIGUOUS', 'older UNKNOWN must hold before the running cycle serves tools');
  assert.equal(recovered.transcript_floor, undefined);
  assert.equal(recovered.delivered_tool_results, undefined);
  const result = await restarted.continueConversation(rootTask(),
    [{ ...results[0], request_id: 'fixture:legacy:successor' }],
    async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; },
    { observeTranscriptFloor: async () => 90 });
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(sends, 1);
  assert.equal((await journal.latestConversationTurn(rootTask())).effect_key, laterKey);
  assert.deepEqual(await journal.find(unknown.effect_key), unknown, 'old UNKNOWN custody stays immutable');
  assert.equal((await journal.pending()).length, 1);
});

for (const foreign of ['agent_id', 'project_id']) {
  test(`a successor refuses hash-valid predecessor history from a foreign ${foreign} before transcript observation`, async t => {
    const f = await fixture(t);
    const key = `turn:${rootTask().task_id}:1:foreign-history`;
    const intent = { schema: 'metaengine.devos.project-conversation-turn.v1',
      project_id: projectId, task_id: rootTask().task_id, agent_id: rootTask().agent_id,
      lease_generation: 1, transcript_floor: 100, prompt_sha256: 'a'.repeat(64),
      delivered_tool_results: [{ request_id: 'fixture:foreign:delivered', result_sha256: 'b'.repeat(64) }],
      unresolved_tool_effects: ['fixture:foreign:unknown'], delivery_history_complete: true,
      authority_effect: false, scheduler_authority: false, second_scheduler_loop: false, automatic_retry_allowed: false };
    intent[foreign] = foreign === 'agent_id' ? 'agent_foreign-fixture-001' : '33333333-3333-4333-8333-333333333333';
    // The generic journal correctly hashes these bytes. Integrity of the local
    // record alone does not bind another agent/project's history to this lease.
    await f.journal.begin(key, intent);
    await f.journal.confirm(key, { effect_state: 'PROVEN_COMPOSER_CLEARED',
      prompt_sha256: intent.prompt_sha256, transcript_floor: intent.transcript_floor });
    const before = await f.journal.latestConversationTurn(rootTask());
    const recovered = await f.runtime.latestTurnForLease(rootTask());
    assert.equal(recovered.state, 'AMBIGUOUS');
    assert.equal(recovered.transcript_floor, undefined, 'foreign history cannot grant a transcript window');
    assert.equal(recovered.delivered_tool_results, undefined, 'foreign delivered identities cannot be adopted');
    let observations = 0, sends = 0;
    await assert.rejects(f.runtime.continueConversation(rootTask(),
      [{ request_id: 'fixture:bound:successor', status: 'COMPLETED', summary: 'observed result' }],
      async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; },
      { observeTranscriptFloor: async () => { observations++; return 120; } }), /continuation_binding_drift/);
    assert.equal(observations, 0);
    assert.equal(sends, 0);
    assert.deepEqual(await f.journal.latestConversationTurn(rootTask()), before,
      'foreign delivered identities and unresolved custody must not be inherited into a new turn');
  });
}

for (const pendingCheck of ['MISSING', 'UNPROVEN']) {
  test(`recovered admission requires a complete proven pending-turn check: ${pendingCheck}`, async t => {
    const f = await fixture(t);
    await f.runtime.continueConversation(rootTask(),
      [{ request_id: 'fixture:admission:known', status: 'COMPLETED', summary: 'observed result' }],
      async () => ({ effect_state: 'PROVEN_COMPOSER_CLEARED' }), { observeTranscriptFloor: async () => 40 });
    const before = await f.journal.latestConversationTurn(rootTask());
    const journal = { ...f.journal, hasPendingConversationTurn: pendingCheck === 'MISSING' ? undefined : async () => 0 };
    const recoveredRuntime = f.own(new AutonomousProjectTaskRuntime({ journal,
      request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
    const recovered = await recoveredRuntime.latestTurnForLease(rootTask());
    assert.equal(recovered.state, 'AMBIGUOUS');
    assert.equal(recovered.transcript_floor, undefined);
    assert.equal(recovered.delivered_tool_results, undefined);
    assert.deepEqual(await f.journal.latestConversationTurn(rootTask()), before);
  });
}

for (const objective of ['x'.repeat(4001), '😀'.repeat(4001)]) {
  test('oversized child objective is rejected before durable intent or provider dispatch', async t => {
    const f = await fixture(t);
    await assert.rejects(f.runtime.serveToolRequests({ lease: rootTask(), requests: [{
      ...spawnRequest(), payload: { children: [{ role: 'IMPLEMENTER', objective }] },
    }] }), /proposal_invalid/);
    assert.equal((await f.journal.pending()).length, 0);
    assert.equal(f.provider.read().tasks.length, 1);
  });
}

test('child objective length follows PostgreSQL character count and space trimming', async t => {
  const f = await fixture(t);
  const objective = '  ' + '😀'.repeat(4000) + '  ';
  const result = await f.runtime.serveToolRequests({ lease: rootTask(), requests: [{
    ...spawnRequest(), payload: { children: [{ role: 'IMPLEMENTER', objective }] },
  }] });
  assert.equal(result[0].status, 'COMPLETED');
  assert.equal(f.provider.read().tasks.length, 2);
});

test('capacity-wait proposals do not claim task admission', async t => {
  const f = await fixture(t, { capacity: 1 });
  const [result] = await f.runtime.serveToolRequests({ lease: rootTask(), requests: [spawnRequest()] });
  const receipt = JSON.parse(result.summary);
  assert.equal(receipt.children[0].status, 'CAPACITY_WAIT');
  assert.equal(receipt.task_admission_proven, false);
  assert.equal((await f.journal.pending()).length, 1);
});

for (const corruption of ['duplicate_task', 'parent_task', 'wait_with_task', 'admitted_with_wait_reason', 'wrong_depth', 'wrong_role', 'missing_role']) {
  test(`spawn receipt rejects ${corruption} and leaves durable intent unresolved`, async t => {
    const f = await fixture(t);
    const runtime = f.own(new AutonomousProjectTaskRuntime({ journal: f.journal,
      materializeProject: async () => ({ state: 'NOT_REQUIRED' }), request: async input => {
        const result = await f.provider.request(input);
        if (input.path.endsWith('/spawn')) {
          if (corruption === 'duplicate_task') result.children[1].task_id = result.children[0].task_id;
          if (corruption === 'parent_task') result.children[0].task_id = rootTask().task_id;
          if (corruption === 'wait_with_task') result.children[0].status = 'CAPACITY_WAIT';
          if (corruption === 'admitted_with_wait_reason') result.children[0].wait_reason = 'NO_CAPACITY';
          if (corruption === 'wrong_depth') result.children[0].depth = 99;
          if (corruption === 'wrong_role') result.children[0].role = 'RESEARCHER';
          if (corruption === 'missing_role') delete result.children[0].role;
        }
        return result;
      } }));
    await assert.rejects(runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(),
      payload: { children: [{ role: 'IMPLEMENTER', objective: 'First task' }, { role: 'CRITIC', objective: 'Second task' }] },
    }] }), /spawn_readback_invalid/);
    assert.equal((await f.journal.pending()).length, 1);
  });
}

test('chat-led planner cannot persist a review without an exact writer subject',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.runtime.serveToolRequests({lease:{...rootTask(),task_spec:{coordination_mode:'CHAT_LED'}},requests:[{
  ...spawnRequest(),payload:{children:[{role:'CRITIC',objective:'Review arbitrary work'}]},
 }]}),/native_review_subject_required/);
 assert.equal((await f.journal.pending()).length,0);assert.equal(f.provider.read().tasks.length,1);
});

test('a bound rejected native review is a blocker rather than endless child waiting',async t=>{
 const f=await fixture(t);await f.runtime.serveToolRequests({lease:rootTask(),requests:[spawnRequest()]});
 const writer=f.provider.read().tasks[1];
 f.provider.update(state=>{
  state.tasks[1].state='RESULT_READY';state.tasks[0].open_children=1;
  state.native_review_rejection={schema:'metaengine.native-coding.review-rejection.v1',project_id:projectId,verdict:'REJECT',
   writer_task_id:writer.task_id,writer_lease_generation:1,critic_task_id:'55555555-5555-4555-8555-555555555555',critic_lease_generation:1,
   result_sha256:'a'.repeat(64),automatic_retry_allowed:false,authority_effect:false};
 });
 const before=f.provider.read(),result=await f.runtime.waitForChildren(rootTask());
 assert.equal(result.waiting,false);assert.equal(result.failed,true);assert.equal(result.reason,'NATIVE_REVIEW_REJECTED');
 assert.deepEqual(f.provider.read(),before,'observation itself must not retry, complete or release child custody');
});
