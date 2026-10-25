import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ClientGoalJournal} from '../src/client-goal-journal.mjs';
import {createClientNativeCodingGoalRouter,normalizeNativeCodingSeedResult,normalizeNativeCodingGoalProgress,readClientGoalSubmissionMode} from '../src/client-native-coding-goal.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
  const input={request_id:randomUUID(),objective:'Implement a useful project increment'};
  const receipt={schema:'metaengine.native-coding.goal-admission.v1',state:'ADMITTED',...input,profile_id:randomUUID(),
    profile_sha256:'1'.repeat(64),workspace_id:randomUUID(),project_id:randomUUID(),root_task_id:randomUUID(),goal_id:randomUUID(),
    goal_sha256:'2'.repeat(64),task_spec_sha256:'3'.repeat(64),permit_ids:[randomUUID(),randomUUID()],
    logical_policy:{max_depth:100,max_tasks:10000,max_children:16},physical_execution_proven:false,global_actuation_granted:false,
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  const body=JSON.stringify(input),canonical=JSON.stringify(receipt);
  const result={state:'ADMITTED',admission:{schema:'metaengine.native-coding.seed-readback.v1',profile_id:receipt.profile_id,
    request_id:input.request_id,body:input,canonical_body_text:body,body_sha256:hash(body),receipt,
    canonical_receipt:canonical,receipt_sha256:hash(canonical),readback_only:true,physical_effect_replayed:false,authority_effect:false},
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  const task={task_id:receipt.root_task_id,parent_task_id:null,depth:0,state:'RUNNING',role:'IMPLEMENTER'};
  const snapshot={schema:'metaengine.devos.project-snapshot.v1',found:true,project_id:receipt.project_id,root_task_id:receipt.root_task_id,
    request_id:input.request_id,state:'ACTIVE',goal:input.objective,last_seq:5,total_tasks:1,tasks:[task],selected_task:task,
    immediate_children:[],task_cursor:{after_seq:0,next_seq:1,has_more:false},authority_effect:false};
  let durable=null,writes=0;
  const storage={loadState:async()=>structuredClone(durable),saveState:async v=>{durable=structuredClone(v);writes++;}};
  const journal=new ClientGoalJournal(storage);
  return {input,receipt,result,snapshot,journal,storage,getDurable:()=>structuredClone(durable),getWrites:()=>writes};
}

test('native admission uses its own schema, exact canonical body and complete receipt digest',()=>{
  const f=fixture();const out=normalizeNativeCodingSeedResult(f.result,f.input);
  assert.equal(out.schema,'metaengine.native-coding.goal-admission.v1');assert.equal(out.physical_execution_proven,false);
  for(const mutate of [r=>r.admission.body.objective+='different',r=>r.admission.receipt.logical_policy.max_children++,
    r=>r.admission.receipt.project_id=randomUUID(),r=>r.admission.receipt_sha256='f'.repeat(64),r=>r.admission.physical_effect_replayed=true,
    r=>r.authority_effect=true,r=>r.extra='untyped']){
    const value=structuredClone(f.result);mutate(value);assert.throws(()=>normalizeNativeCodingSeedResult(value,f.input),/client_native_goal_/);
  }
});

test('native journal admission survives restart, keeps real project/root binding and rejects legacy substitution',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'NATIVE_CODING'});
  await f.journal.recordNativeAdmission(f.receipt);
  const restored=new ClientGoalJournal(f.storage);await restored.load();
  assert.equal(restored.latest().kind,'NATIVE_CODING');assert.equal(restored.latest().project.schema,'metaengine.client.native-coding-project.v1');
  assert.equal(restored.latest().project.root_task_id,f.receipt.root_task_id);assert.equal(restored.latest().admitted_task_id,f.receipt.root_task_id);
  await assert.rejects(()=>restored.recordSubmission({schema:'metaengine.client.goal-submission.v1',request_id:f.input.request_id,exact_request_correlation:true}),/kind_mismatch/);
  await assert.rejects(()=>restored.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'BROWSER'}),/request_collision/);
  const forged=f.getDurable();forged.entries[0].receipt.root_task_id=randomUUID();
  await assert.rejects(()=>new ClientGoalJournal({...f.storage,loadState:async()=>forged}).load(),/native_project_drift/);
});

test('old kindless goal journal remains browser data, never a native admission',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective});
  const saved=f.getDurable();delete saved.entries[0].kind;
  const old=new ClientGoalJournal({...f.storage,loadState:async()=>saved});await old.load();assert.equal(old.latest().kind,'BROWSER');
  await assert.rejects(()=>old.recordNativeAdmission(f.receipt),/native_request_missing/);
});

test('one native effect starts only after durable request and reads actual projectSnapshot progress',async()=>{
  const f=fixture(),calls=[];let mounted=0;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async(op,input)=>{
    assert.equal(f.getDurable().entries[0].state,'SUBMITTING');calls.push({op,input});return f.result;},
    projectSnapshot:async input=>{assert.deepEqual(input,{project_id:f.receipt.project_id,task_after_seq:0,limit:1});return f.snapshot;},onAdmitted:async()=>{mounted++;}});
  const receipt=await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.equal(receipt.project_id,f.receipt.project_id);assert.deepEqual(calls.map(c=>c.op),['SEED_GOAL']);assert.equal(mounted,1);
  assert.equal(f.journal.latest().progress.schema,'metaengine.client.native-coding-goal-progress.v1');assert.equal(f.journal.latest().state,'RUNNING');
  assert.equal(f.journal.latest().progress.physical_execution_proven,false);assert.equal(f.journal.latest().execution_proof,null);
});

test('committed admission with unbounded logical policy mounts and survives journal reload',async()=>{
  const f=fixture();let mounted=0;
  f.receipt.logical_policy={max_depth:null,max_tasks:null,max_children:null};
  f.result.admission.receipt=structuredClone(f.receipt);
  f.result.admission.canonical_receipt=JSON.stringify(f.receipt);
  f.result.admission.receipt_sha256=hash(f.result.admission.canonical_receipt);
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>f.result,
    projectSnapshot:async()=>f.snapshot,onAdmitted:async()=>{mounted++;}});
  const receipt=await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.deepEqual(receipt.logical_policy,{max_depth:null,max_tasks:null,max_children:null});
  assert.equal(mounted,1);assert.equal(f.journal.latest().state,'RUNNING');
  const restored=new ClientGoalJournal(f.storage);await restored.load();
  assert.deepEqual(restored.latest().receipt.logical_policy,receipt.logical_policy);
  for(const value of [-1,0,1.5,Infinity,'unlimited',undefined]){
    const bad=structuredClone(f.result);bad.admission.receipt.logical_policy.max_tasks=value;
    bad.admission.canonical_receipt=JSON.stringify(bad.admission.receipt);
    bad.admission.receipt_sha256=hash(bad.admission.canonical_receipt);
    assert.throws(()=>normalizeNativeCodingSeedResult(bad,f.input),/client_native_goal_/);
  }
});

test('unknown seed effect stays durably fenced across router instances and refresh never replays it',async()=>{
  const f=fixture(),calls=[];const request=async(op)=>{calls.push(op);if(op==='SEED_GOAL')throw Error('lost reply');return {...f.result,state:'READBACK_ONLY',admission:null};};
  const build=journal=>createClientNativeCodingGoalRouter({journal,request,projectSnapshot:async()=>f.snapshot});
  await assert.rejects(()=>build(f.journal).submit({request_id:f.input.request_id,goal:f.input.objective}),/submit_requires_reconciliation/);
  assert.equal(f.journal.latest().state,'RECONCILE_REQUIRED');
  const restarted=new ClientGoalJournal(f.storage);await restarted.load();
  await build(restarted).refresh(restarted.latest());
  await assert.rejects(()=>build(restarted).submit({request_id:randomUUID(),goal:'another task'}),/previous_request_requires_readback/);
  assert.deepEqual(calls,['SEED_GOAL','READ_SEED','READ_SEED']);assert.equal(restarted.latest().automatic_retry_allowed,false);
});

test('lost acknowledgement reconciles committed admission by READ_SEED and still mounts runtime once',async()=>{
  const f=fixture(),calls=[];let mounts=0;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async op=>{calls.push(op);if(op==='SEED_GOAL')throw Error('timeout');return {...f.result,state:'READBACK_ONLY'};},
    projectSnapshot:async()=>f.snapshot,onAdmitted:async()=>{mounts++;}});
  await assert.rejects(()=>router.submit({request_id:f.input.request_id,goal:f.input.objective}),/submit_requires_reconciliation/);
  assert.equal(f.journal.latest().receipt.root_task_id,f.receipt.root_task_id);assert.equal(f.journal.latest().state,'RUNNING');
  await router.refresh(f.journal.latest());assert.equal(mounts,1);assert.deepEqual(calls,['SEED_GOAL','READ_SEED','READ_SEED']);
});

test('runtime mount or project observation failure preserves committed admission, without execution claim',async()=>{
  const f=fixture();const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>f.result,
    projectSnapshot:async()=>{throw Error('not mounted');},onAdmitted:async()=>{throw Error('mount blocked');}});
  await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.equal(f.journal.latest().state,'ADMITTED');assert.equal(f.journal.latest().progress,null);assert.equal(f.journal.latest().receipt.physical_execution_proven,false);
  assert.equal(f.journal.latest().project_error,'Native project observation unavailable');
});

test('unavailable observations mark saved progress stale and clear only after a matching fresh snapshot',async()=>{
  const f=fixture();let failProject=false,failHost=false;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>{if(failHost)throw Error('IPC unavailable');return f.result;},
    projectSnapshot:async()=>{if(failProject)throw Error('read unavailable');return f.snapshot;}});
  await router.submit({request_id:f.input.request_id,goal:f.input.objective});const original=f.journal.latest().progress;
  failProject=true;await router.refresh(f.journal.latest());assert.deepEqual(f.journal.latest().progress,original);
  assert.equal(f.journal.latest().project_error,'Native project observation unavailable');
  failHost=true;await assert.rejects(()=>router.refresh(f.journal.latest()),/IPC unavailable/);
  assert.equal(f.journal.latest().project_error,'Native goal observation unavailable');
  failHost=false;failProject=false;await router.refresh(f.journal.latest());assert.equal(f.journal.latest().project_error,null);
});

test('two routers sharing one durable journal cannot issue concurrent native seeds',async()=>{
  const f=fixture();let release;const wait=new Promise(resolve=>{release=resolve;});let sends=0;
  const options={journal:f.journal,request:async()=>{sends++;await wait;return f.result;},projectSnapshot:async()=>f.snapshot};
  const a=createClientNativeCodingGoalRouter(options).submit({request_id:f.input.request_id,goal:f.input.objective});
  await assert.rejects(()=>createClientNativeCodingGoalRouter(options).submit({request_id:randomUUID(),goal:'Concurrent'}),/operation_pending/);
  release();await a;assert.equal(sends,1);
});

test('projectSnapshot root/project/request drift is rejected as progress',async()=>{
  const f=fixture();const entry={request_id:f.input.request_id,goal:f.input.objective,receipt:f.receipt};
  for(const mutate of [s=>s.project_id=randomUUID(),s=>s.root_task_id=randomUUID(),s=>s.request_id=randomUUID(),s=>s.selected_task.task_id=randomUUID(),s=>s.goal+='x']){
    const value=structuredClone(f.snapshot);mutate(value);assert.throws(()=>normalizeNativeCodingGoalProgress(value,entry),/client_(?:native_goal|project)_/);
  }
});

test('native profile presence chooses native/HOLD; stopped Host and inaccessible presence never choose browser',async()=>{
  const summary={status_file:'C:/private/runtime/status.json'};const readSummary=()=>summary;
  assert.equal((await readClientGoalSubmissionMode({readSummary:()=>null})).kind,'UNAVAILABLE');
  assert.equal((await readClientGoalSubmissionMode({readSummary,lstat:async()=>{throw Object.assign(Error(),{code:'ENOENT'});}})).kind,'BROWSER');
  const good=await readClientGoalSubmissionMode({readSummary,lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1})});
  assert.equal(good.kind,'NATIVE_CODING');assert.equal(good.state,'HOST_VERIFICATION_REQUIRED');
  const bad=await readClientGoalSubmissionMode({readSummary,lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>true,nlink:1})});
  assert.equal(bad.kind,'NATIVE_CODING');assert.equal(bad.state,'HOLD');
  assert.equal((await readClientGoalSubmissionMode({readSummary,lstat:async()=>{throw Object.assign(Error(),{code:'EACCES'});}})).state,'HOLD');
});

test('busy native profile is an admission HOLD and failed capacity read cannot choose another route',async()=>{
  const readSummary=()=>({status_file:'C:/private/runtime/status.json'}),lstat=async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1});
  const project_id=randomUUID();const busy=await readClientGoalSubmissionMode({readSummary,lstat,readNativeBusy:async()=>({busy:true,project_id})});
  assert.equal(busy.kind,'NATIVE_CODING');assert.equal(busy.state,'HOLD');assert.equal(busy.reason,'NATIVE_PROFILE_BUSY');assert.equal(busy.project_id,project_id);
  const unknown=await readClientGoalSubmissionMode({readSummary,lstat,readNativeBusy:async()=>{throw Error('readback lost');}});
  assert.equal(unknown.kind,'NATIVE_CODING');assert.equal(unknown.state,'HOLD');assert.equal(unknown.reason,'NATIVE_PROFILE_STATUS_UNAVAILABLE');
});

test('actual main submit function preserves an admitted busy project before any new UUID/journal/effect',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'NATIVE_CODING'});await f.journal.recordNativeAdmission(f.receipt);
  const writes=f.getWrites(),before=f.getDurable();let ids=0,sends=0;
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  const source=main.slice(main.indexOf('async function submitClientGoal('),main.indexOf('async function latestClientGoal('));
  const submit=vm.runInNewContext('('+source+')',{ensureClientGoalJournal:async()=>f.journal,
    readNativeGoalSubmissionMode:async()=>({kind:'NATIVE_CODING',state:'HOLD',reason:'NATIVE_PROFILE_BUSY'}),
    randomUUID:()=>{ids++;return randomUUID();},nativeSupervisor:{clientGoalSubmit:async()=>{sends++;}},Error});
  await assert.rejects(()=>submit('A second user goal'),/client_goal_submission_hold:NATIVE_PROFILE_BUSY/);
  assert.equal(ids,0);assert.equal(sends,0);assert.equal(f.getWrites(),writes);assert.deepEqual(f.getDurable(),before);
  assert.equal(f.journal.latest().project.project_id,f.receipt.project_id);
});

test('primary product routing has fixed native IPC/signing paths and separate admission UI',async()=>{
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await readFile(new URL('../src/preload-shell.cjs',import.meta.url),'utf8');
  const ui=await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx',import.meta.url),'utf8');
  assert.match(main,/signNativeCodingDeviceRequest\(\{identity:ensureSupervisorIdentity\(\),binding:capability\.snapshot\(\),operation,input\}\)/);
  assert.match(main,/operation==='SEED_GOAL'\?await capability\.seedGoal\(signed\):await capability\.readSeed\(signed\)/);
  assert.match(main,/if\(!owned\)capability\.close\(\)/);assert.match(preload,/goalSubmissionMode:clientGoalSubmissionMode/);
  assert.match(ui,/mode\.kind==="BROWSER"/);assert.match(ui,/metaengine\.native-coding\.goal-admission\.v1/);
  assert.match(ui,/data-testid="client-native-goal-progress"/);assert.match(ui,/Execution proof is separate from admission/);
});
