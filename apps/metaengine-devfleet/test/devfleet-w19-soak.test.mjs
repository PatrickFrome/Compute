// W19: isolated source-only adversarial soak of the EXISTING DevFleetOperator.
// An explicit test driver submits each wave. This is NOT a runtime scheduler,
// queue, browser transport, ChatGPT send, or installed-device load test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DevFleetOperator, SCHEMA } from '../src/operator-core.mjs';

const HOT = 4;
const TASKS = 100;
const jobId = n => 'w19-coding-job-' + String(n).padStart(3, '0');
const rotateId = n => 'w19-rotate-old-' + String(n).padStart(3, '0');
const prompt = n => 'Implement independent source-only coding candidate ' +
  String(n).padStart(3, '0') + '; separate draft PR; no merge or deployment';
const assignment = (tab_id, n) => ({tab_id, request_id:jobId(n), text:prompt(n)});
const rotation = (tab_id, n) => ({
  tab_id, request_id:rotateId(n), replacement_request_id:jobId(n),
  text:prompt(n), acknowledge_unknown_delivery:true
});

// This fake intentionally cannot access Electron/OS/CDP/network. No timers,
// background agents or physical process effects. All behavior is synchronous
// apart from the operator's existing awaited persistence/serialization.
function hermetic({unknownJobs=[],invalidReceipts=[],unknownCloses=[]}={}) {
  let disk = null, failPersistAt = null;
  const live = new Set(), oldClose = new Set(unknownCloses);
  const unknown = new Set(unknownJobs), invalid = new Set(invalidReceipts);
  const fx = {
    live, creates:[], closes:[], sendAttempts:[], saveCount:0,
    peakHot:0, maxJournalBytes:0,
    setCloseUnknown: id => oldClose.add(id),
    failNextPersistAt: stage => { failPersistAt = stage; },
    processDied: () => live.clear(),
    setDisk: value => { disk = structuredClone(value); },
    get disk() { return structuredClone(disk); }
  };
  fx.adapter = {
    async create(tab_id, url) {
      assert.ok(!live.has(tab_id), 'no duplicate native WebContents identity');
      live.add(tab_id);
      fx.creates.push(tab_id);
      fx.peakHot = Math.max(fx.peakHot, live.size);
      assert.ok(live.size <= HOT, '4-hot source-harness resource ceiling');
      return {tab_id, url};
    },
    async closeTab(tab_id) {
      fx.closes.push(tab_id);
      if (oldClose.has(tab_id)) throw Error('unproven_native_close');
      assert.ok(live.delete(tab_id), 'physical close only on an owned fake tab');
      return {tab_id, closed:true, authority_effect:false};
    },
    async read(tab_id) {
      assert.ok(live.has(tab_id));
      return {tab_id, url:'https://chatgpt.com/', text:'',
        total_chars:0, authority_effect:false};
    },
    async inputProbe(tab_id) {
      assert.ok(live.has(tab_id));
      return {tab_id, mode:'CHAT', page_failure:null,
        unique_composer:true, generation_active:false, authority_effect:false};
    },
    async send(tab_id, text) {
      assert.ok(live.has(tab_id));
      const marker = /\[DevFleet request: ([^\]]+)\]$/.exec(text);
      assert.ok(marker, 'existing operator must attach native request marker');
      const id = marker[1];
      fx.sendAttempts.push({tab_id, request_id:id});
      if (unknown.has(id)) throw Error('unknown_transport_after_send');
      if (invalid.has(id)) return {tab_id, state:'UNVERIFIED',
        url:'https://chatgpt.com/'};
      return {tab_id, state:'PROVEN_SENT', url:'https://chatgpt.com/c/w19-'+id};
    }
  };
  fx.store = {
    async load() { return disk === null ? null : structuredClone(disk); },
    async save(state) {
      fx.saveCount++;
      if (failPersistAt && state.requests.some(r => r.operation === 'rotate' &&
          r.state === failPersistAt)) {
        failPersistAt = null;
        throw Error('injected_durable_write_crash');
      }
      const next = structuredClone(state);
      const bytes = Buffer.byteLength(JSON.stringify(next));
      fx.maxJournalBytes = Math.max(fx.maxJournalBytes, bytes);
      disk = next;
    }
  };
  return fx;
}
function oneAttemptEach(fx, ids) {
  for (const id of ids) {
    assert.equal(fx.sendAttempts.filter(x => x.request_id === id).length, 1,
      'unknown/known send may never be repeated: ' + id);
  }
}

test('W19 / 100 distinct coding admissions / 4 hot slots / bounded and fair waves', async t => {
  const start = performance.now();
  const injectedUnknown = Array.from({length:TASKS},(_,i)=>i)
    .filter(i=>i%11===0).map(jobId);
  const injectedInvalid = Array.from({length:TASKS},(_,i)=>i)
    .filter(i=>i%17===0 && i%11!==0).map(jobId);
  const f = hermetic({unknownJobs:injectedUnknown,
    invalidReceipts:injectedInvalid});
  let operator = new DevFleetOperator(f);
  await operator.init();
  const creation = await operator.create({
    request_id:'w19-create-four-hot-cells', count:HOT
  });
  assert.equal(creation.state, 'CREATED');
  const laneTabs = creation.sessions.map(s=>s.tab_id);
  assert.equal(new Set(laneTabs).size, HOT);
  const sourceAssignments = new Map();
  const producerAdmissions = Array(HOT).fill(0);
  const producerMaxWait = Array(HOT).fill(0);
  const lastAdmitWave = Array(HOT).fill(-1);

  for (let wave=0; wave<TASKS/HOT; wave++) {
    // The test OWNER supplies exactly one task per producer per wave. No
    // in-app queue or independent admission authority is constructed here.
    const ids = Array.from({length:HOT},(_,lane)=>wave*HOT+lane);
    let results;
    if (wave===0) {
      const requests = ids.map((id,lane)=>assignment(laneTabs[lane],id));
      requests.forEach(r=>sourceAssignments.set(r.request_id, r));
      const r = await operator.batchAssign({assignments:requests});
      assert.ok(['COMPLETED','PARTIAL_AMBIGUOUS'].includes(r.state));
      results = r.receipts.map((x,lane)=>({...x, new_tab_id:laneTabs[lane],
        assignment_state:x.state}));
    } else {
      const requests = ids.map((id,lane)=>rotation(laneTabs[lane],id));
      const r = await operator.batchRotate({rotations:requests});
      assert.equal(r.state,'BATCH_COMPLETED');
      assert.equal(r.capacity,HOT);
      results = r.results;
      requests.forEach((r,lane)=>sourceAssignments.set(
        r.replacement_request_id, assignment(results[lane].new_tab_id,ids[lane])));
    }
    for (let lane=0; lane<HOT; lane++) {
      const receipt=results[lane], job=ids[lane];
      assert.ok(['SENT','AMBIGUOUS'].includes(receipt.assignment_state),
        'no fabricated success and no stalled source-only lane');
      assert.ok(receipt.new_tab_id, 'each wave must own a tab');
      laneTabs[lane]=receipt.new_tab_id;
      producerAdmissions[lane]++;
      producerMaxWait[lane]=Math.max(producerMaxWait[lane],
        wave-lastAdmitWave[lane]-1);
      lastAdmitWave[lane]=wave;
    }
    const s=operator.snapshot();
    assert.equal(s.session_count,HOT);
    assert.equal(s.pipeline.active_slots,HOT);
    assert.equal(s.pipeline.capacity,4, 'initial target is configurable; W19 harness uses four slots');
    assert.equal(f.live.size,HOT);
    assert.ok(f.peakHot <= HOT);
    assert.ok(Math.max(...producerAdmissions)-Math.min(...producerAdmissions)<=1,
      'driver may not starve a producer');
  }
  assert.deepEqual(producerAdmissions,[25,25,25,25]);
  assert.deepEqual(producerMaxWait,[0,0,0,0]);
  assert.equal(f.creates.length,TASKS);
  assert.equal(f.closes.length,TASKS-HOT);
  assert.equal(f.sendAttempts.length,TASKS);
  assert.equal(new Set(f.sendAttempts.map(x=>x.request_id)).size,TASKS);
  oneAttemptEach(f, Array.from(sourceAssignments.keys()));
  const rows=f.disk.requests;
  assert.equal(rows.filter(x=>x.operation==='assign').length,TASKS);
  assert.equal(rows.filter(x=>x.operation==='rotate').length,TASKS-HOT);
  assert.equal(rows.length,1+TASKS+(TASKS-HOT));
  assert.ok(rows.length<500, 'bounded existing 500-receipt history budget');
  const expectedAmbiguous=new Set([...injectedUnknown,...injectedInvalid]);
  assert.equal(operator.receiptSummary().counts.AMBIGUOUS,expectedAmbiguous.size);
  const finalOwned = new Set(operator.snapshot().sessions.map(s=>s.tab_id));
  const expectedBlocked = new Set(rows.filter(r=>r.operation==='assign' &&
    r.state==='AMBIGUOUS' && finalOwned.has(r.tab_id)).map(r=>r.tab_id));
  assert.deepEqual(new Set(operator.receiptSummary().blocked_tabs),expectedBlocked);
  assert.equal(operator.snapshot().pipeline.total_rotations,TASKS-HOT);
  for(const row of rows.filter(r=>r.operation==='assign')) {
    assert.equal(row.state,expectedAmbiguous.has(row.request_id)?'AMBIGUOUS':'SENT');
    assert.equal(row.receipt.automatic_retry_allowed,false);
  }
  // Old IDs are durable even after their physical WebContents are gone.
  const old=sourceAssignments.get(jobId(0));
  const before=f.sendAttempts.length;
  assert.equal((await operator.assign(old)).state,'AMBIGUOUS');
  assert.equal(f.sendAttempts.length,before);
  await assert.rejects(operator.assign({...old,text:'modified prompt'}),
    /operator_request_collision/);
  assert.equal(f.sendAttempts.length,before);

  // Restart is a new process: all old WebContents disappear before restoration.
  f.processDied();
  operator=new DevFleetOperator(f);
  await operator.init();
  assert.equal(operator.snapshot().session_count,HOT);
  assert.equal((await operator.assign(old)).state,'AMBIGUOUS');
  assert.equal(f.sendAttempts.length,before);
  assert.equal(f.live.size,HOT);

  const report={
    scenario:'W19_HERMETIC_4_HOT_100', tasks:TASKS, producer_admissions:producerAdmissions,
    ambiguous_receipts:expectedAmbiguous.size, peak_fake_webcontents:f.peakHot,
    sends:f.sendAttempts.length, physical_closes:f.closes.length,
    durable_requests:rows.length, max_journal_bytes:f.maxJournalBytes,
    elapsed_ms:Number((performance.now()-start).toFixed(2)),
    installed_ram_evidence:'UNKNOWN', real_send_evidence:'UNKNOWN',
    operator_authority:'EXISTING_ONLY'
  };
  assert.ok(report.max_journal_bytes<512*1024,
    'soak journal must remain under explicit source-only budget');
  t.diagnostic(JSON.stringify(report));
});

test('W19 / unknown native close fences one lane, other three continue', async()=>{
  const f=hermetic({unknownJobs:[jobId(0)]});
  let operator=new DevFleetOperator(f);
  await operator.init();
  const tabs=(await operator.create({request_id:'w19-unknown-close-create',count:4}))
    .sessions.map(s=>s.tab_id);
  const first=await operator.batchAssign({assignments:
    tabs.map((tab,i)=>assignment(tab,i))});
  assert.equal(first.receipts[0].state,'AMBIGUOUS');
  f.setCloseUnknown(tabs[0]);
  const commands=tabs.map((tab,i)=>rotation(tab,i+4));
  const result=await operator.batchRotate({rotations:commands});
  assert.deepEqual(result.results.map(r=>r.state),
    ['RETIRE_UNKNOWN','ROTATION_FINISHED','ROTATION_FINISHED','ROTATION_FINISHED']);
  assert.equal(f.sendAttempts.length,7);
  assert.equal(f.creates.length,7);
  assert.ok(f.peakHot<=HOT);
  const before=f.sendAttempts.length;
  assert.equal((await operator.rotateFailed(commands[0])).state,'RETIRE_UNKNOWN');
  assert.equal(f.sendAttempts.length,before);
  f.processDied();
  operator=new DevFleetOperator(f);
  await operator.init();
  assert.equal(operator.snapshot().session_count,3);
  assert.equal((await operator.rotateFailed(commands[0])).state,
    'ROTATION_INTERRUPTED_UNKNOWN');
  assert.equal((await operator.assign(assignment(tabs[0],0))).state,'AMBIGUOUS');
  assert.equal(f.sendAttempts.length,before);
});

test('W19 / crash exactly after native close cannot replay old effect', async()=>{
  const f=hermetic({unknownJobs:[jobId(0)]});
  let operator=new DevFleetOperator(f);
  await operator.init();
  const oldTab=(await operator.create({
    request_id:'w19-after-close-initial',count:1})).sessions[0].tab_id;
  const old=assignment(oldTab,0);
  assert.equal((await operator.assign(old)).state,'AMBIGUOUS');
  const command=rotation(oldTab,1);
  f.failNextPersistAt('OLD_CHAT_CLOSED');
  await assert.rejects(operator.rotateFailed(command),/injected_durable_write_crash/);
  assert.deepEqual(f.closes,[oldTab]);
  assert.equal(f.creates.length,1,'replacement never attempted after crash');
  assert.equal(f.sendAttempts.length,1);
  assert.equal(f.disk.sessions[0].state,'RETIRING',
    'durable state predates the uncertain close');
  f.processDied();
  operator=new DevFleetOperator(f);
  await operator.init();
  assert.equal(operator.snapshot().session_count,0);
  assert.equal(operator.snapshot().pipeline.free_slots,operator.snapshot().pipeline.capacity);
  assert.equal((await operator.rotateFailed(command)).state,
    'ROTATION_INTERRUPTED_UNKNOWN');
  assert.equal((await operator.assign(old)).state,'AMBIGUOUS');
  assert.equal(f.closes.length,1);
  assert.equal(f.sendAttempts.length,1);
  // Explicitly new task identity is allowed; old unknown must not be replayed.
  const fresh=(await operator.create({
    request_id:'w19-after-crash-fresh-create',count:1})).sessions[0].tab_id;
  assert.equal((await operator.assign(assignment(fresh,2))).state,'SENT');
  assert.equal(f.sendAttempts.length,2);
});

test('W19 / collisions, four-wave batch and 500-receipt ceiling fail closed', async()=>{
  const f=hermetic();
  let operator=new DevFleetOperator(f);
  await operator.init();
  const tabs=(await operator.create({
    request_id:'w19-limit-create-four',count:HOT})).sessions.map(s=>s.tab_id);
  const a=rotation(tabs[0],4);
  await assert.rejects(operator.batchRotate({rotations:Array(5).fill(a)}),
    /pipeline_rotation_batch_budget_exceeded/);
  await assert.rejects(operator.batchRotate({rotations:[a,a]}),
    /pipeline_rotation_batch_identity_conflict/);
  assert.equal(f.closes.length,0);
  assert.equal(f.sendAttempts.length,0);
  f.processDied();
  const full = Array.from({length:500},(_,i)=>({
    request_id:'w19-history-' + String(i).padStart(4,'0'),
    operation:'assign',fingerprint:'synthetic-only',
    state:'AMBIGUOUS',receipt:{
      schema:SCHEMA,state:'AMBIGUOUS',automatic_retry_allowed:false}
  }));
  f.setDisk({schema:SCHEMA,sessions:[],requests:full});
  operator=new DevFleetOperator(f);
  await operator.init();
  const beyond=await operator.create({request_id:'w19-ledger-overflow-create',count:1});
  assert.equal(beyond.state,'CREATED');
  assert.equal(f.creates.length,5);
  assert.equal(f.sendAttempts.length,0);
  assert.equal(f.disk.requests.length,501);
});
