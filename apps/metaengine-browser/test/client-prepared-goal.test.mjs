import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ClientGoalJournal} from '../src/client-goal-journal.mjs';
import {createClientPreparedGoalRouter,preparedGoalInput,normalizePreparedGoalAdmission,normalizePreparedGoalResult,readVerifiedPreparedGoalSelector} from '../src/client-prepared-goal.mjs';
import {readClientGoalSubmissionMode} from '../src/client-native-coding-goal.mjs';
import {SupervisorDeviceIdentity} from '../src/supervisor-device-identity.mjs';
import {validateNativeCodingDeviceRequest,signNativeCodingDeviceRequest} from '../src/native-coding-device-request.mjs';
function fixture(){
 const selector={preparation_id:randomUUID(),configuration_sha256:'a'.repeat(64),workspace_id:randomUUID(),preparation_grant_epoch:1};
 const input={request_id:randomUUID(),goal:'Implement the actual user objective'};
 const receipt={schema:'metaengine.native-coding.pending-goal-admission.v1',state:'PENDING_ACTIVATION',...selector,request_id:input.request_id,objective:input.goal,
  project_id:randomUUID(),root_task_id:randomUUID(),task_spec_sha256:'b'.repeat(64),root_state:'BLOCKED',project_state:'PAUSED',
  owner_incarnation_verified:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 const result={schema:'metaengine.native-coding.pending-goal-result.v1',state:'PENDING_ACTIVATION',admission:receipt,automatic_retry_allowed:false,authority_effect:false};
 let durable=null;const storage={loadState:async()=>structuredClone(durable),saveState:async v=>{durable=structuredClone(v);}};
 const journal=new ClientGoalJournal(storage),calls=[];
 const request=async(op,v)=>{calls.push({op,input:v});return result;};
 const router=createClientPreparedGoalRouter({journal,request,readSelector:async()=>selector});
 return {selector,input,receipt,result,storage,journal,calls,request,router,durable:()=>durable};
}
test('pending goal persists complete immutable selector before the only dispatch, never admits execution',async()=>{
 const f=fixture();const router=createClientPreparedGoalRouter({journal:f.journal,readSelector:async()=>f.selector,request:async(op,input)=>{
  assert.equal(f.durable().entries[0].state,'SUBMITTING');assert.deepEqual(f.durable().entries[0].prepared_selector,f.selector);
  return f.request(op,input);
 }});
 assert.deepEqual(await router.submit(f.input),f.receipt);assert.deepEqual(f.calls.map(x=>x.op),['ADMIT_PREPARED_GOAL_V1']);
 const saved=f.journal.latest();assert.equal(saved.state,'PENDING_ACTIVATION');assert.equal(saved.project,null);assert.equal(saved.admitted_task_id,null);
 assert.equal(saved.progress,null);assert.equal(saved.execution_proof,null);assert.equal(saved.receipt.permit_ids,undefined);
 await assert.rejects(f.journal.recordNativeAdmission(f.receipt),/native_request_missing/);
 await assert.rejects(f.router.submit({request_id:randomUUID(),goal:'Another goal'}),/previous_request/);
});
for(const state of ['READBACK_REQUIRED','NOT_STARTED'])test(`lost ACK then ${state}, restart and refresh cannot resend or mint another identity`,async()=>{
 const f=fixture();const request=async(op,input)=>{f.calls.push({op,input});if(op==='ADMIT_PREPARED_GOAL_V1')throw Error('lost');return {...f.result,state,admission:null};};
 await assert.rejects(createClientPreparedGoalRouter({journal:f.journal,readSelector:async()=>f.selector,request}).submit(f.input),/requires_reconciliation/);
 assert.equal(f.journal.latest().state,'RECONCILE_REQUIRED');const saved=f.durable();
 const restored=new ClientGoalJournal(f.storage);await restored.load();
 const router=createClientPreparedGoalRouter({journal:restored,request,readSelector:async()=>{throw Error('must not rediscover');}});
 await router.refresh(restored.latest());await assert.rejects(router.submit(f.input),/previous_request/);
 assert.deepEqual(f.calls.map(x=>x.op),['ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1']);
 assert.ok(f.calls.every(x=>JSON.stringify(x.input)===JSON.stringify(f.calls[0].input)));assert.deepEqual(restored.latest().prepared_selector,saved.entries[0].prepared_selector);
});
test('lost ACK can recover a receipt only through same-identity readback; submit still reports reconciliation',async()=>{
 const f=fixture();await assert.rejects(createClientPreparedGoalRouter({journal:f.journal,readSelector:async()=>f.selector,request:async(op,input)=>{
  f.calls.push({op,input});if(op==='ADMIT_PREPARED_GOAL_V1')throw Error('lost');return f.result;
 }}).submit(f.input),/requires_reconciliation/);
 assert.equal(f.journal.latest().state,'PENDING_ACTIVATION');assert.equal(f.calls.length,2);
});
test('write failure fences before transport, changed preparation after persistence only reads',async()=>{
 const f=fixture();const journal=new ClientGoalJournal({...f.storage,saveState:async()=>{throw Error('fsync unknown');}});
 await assert.rejects(createClientPreparedGoalRouter({journal,readSelector:async()=>f.selector,request:f.request}).submit(f.input),/fsync/);
 assert.equal(f.calls.length,0);
 let reads=0;const g=fixture();await assert.rejects(createClientPreparedGoalRouter({journal:g.journal,request:async(op,input)=>{
  g.calls.push({op,input});return {...g.result,state:'NOT_STARTED',admission:null};},
  readSelector:async()=>({...g.selector,configuration_sha256:++reads===1?g.selector.configuration_sha256:'f'.repeat(64)})}).submit(g.input),/requires_reconciliation/);
 assert.deepEqual(g.calls.map(x=>x.op),['READ_PREPARED_GOAL_V1']);assert.equal(g.journal.latest().state,'RECONCILE_REQUIRED');
});
test('closed or revoked Host readback removes positive current state while preserving durable evidence',async()=>{
 const f=fixture();await f.router.submit(f.input);
 const router=createClientPreparedGoalRouter({journal:f.journal,readSelector:async()=>f.selector,request:async()=>{throw Error('OPERATION_FAILED raw secret');}});
 await assert.rejects(router.refresh(f.journal.latest()));assert.equal(f.journal.latest().state,'RECONCILE_REQUIRED');
 assert.equal(f.journal.latest().receipt.project_id,f.receipt.project_id);assert.doesNotMatch(f.journal.latest().last_error,/secret/);
 const restored=new ClientGoalJournal(f.storage);await restored.load();assert.equal(restored.latest().state,'RECONCILE_REQUIRED');
});
for(const [name,mutate] of [
 ['foreign workspace',v=>v.workspace_id=randomUUID()],['foreign preparation',v=>v.preparation_id=randomUUID()],
 ['changed config',v=>v.configuration_sha256='f'.repeat(64)],['changed epoch',v=>v.preparation_grant_epoch++],
 ['foreign request',v=>v.request_id=randomUUID()],['changed objective',v=>v.objective+=' different'],
 ['permits',v=>v.permit_ids=[]],['execution',v=>v.execution_ready=true],['Owner',v=>v.owner_incarnation_verified=true],
 ['ready root',v=>v.root_state='READY'],['active project',v=>v.project_state='ACTIVE'],['admitted state',v=>v.state='ADMITTED'],
 ['retry',v=>v.automatic_retry_allowed=true],['authority',v=>v.authority_effect=true],['extra',v=>v.extra=true],
 ])test(`pending receipt rejects ${name}`,()=>{
 const f=fixture(),entry={...f.input,prepared_selector:f.selector};const receipt=structuredClone(f.receipt);mutate(receipt);
 assert.throws(()=>normalizePreparedGoalAdmission(receipt,entry),/receipt_invalid/);
});
test('result state cannot contradict receipt; persisted receipt may not drift',async()=>{
 const f=fixture(),entry={...f.input,prepared_selector:f.selector};
 for(const v of [{...f.result,state:'NOT_STARTED'},{...f.result,admission:null},{...f.result,extra:true}])assert.throws(()=>normalizePreparedGoalResult(v,entry));
 await f.router.submit(f.input);await assert.rejects(f.journal.recordPreparedAdmission({...f.receipt,project_id:randomUUID()}),/drift/);
});
test('concurrent click and a restarted router cannot resend pending journal effect',async()=>{
 const f=fixture();let release;const gate=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
 const router=createClientPreparedGoalRouter({journal:f.journal,readSelector:async()=>f.selector,request:async(op,input)=>{entered();await gate;return f.request(op,input);}});
 const pending=router.submit(f.input);await started;
 await assert.rejects(router.submit(f.input),/operation_pending/);release();await pending;assert.equal(f.calls.length,1);
});
test('mode requires verified prepared readback; mere operator presence is HOLD and v1 route unchanged',async()=>{
 const base={readSummary:()=>({status_file:'/state/status.json'}),lstat:async file=>{
  if(file.endsWith('native-coding-seed-operator-v1.json'))throw Object.assign(Error('missing'),{code:'ENOENT'});return {isFile:()=>true};}};
 assert.equal((await readClientGoalSubmissionMode(base)).state,'HOLD');
 assert.equal((await readClientGoalSubmissionMode({...base,readPreparedGoal:async()=>{throw Error('revoked');}})).state,'HOLD');
 assert.equal((await readClientGoalSubmissionMode({...base,readPreparedGoal:async()=>fixture().selector})).kind,'PREPARED_GOAL');
 assert.equal((await readClientGoalSubmissionMode({...base,lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1}),readPreparedGoal:async()=>{throw Error('must not run');}})).kind,'NATIVE_CODING');
});
test('readonly selector uses actual signed preparation request; revoked or malformed readback is not a route',async t=>{
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'prepared-goal-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const identity=new SupervisorDeviceIdentity({statePath:path.join(directory,'identity.json'),secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});
 await identity.ensure();await identity.bindDevice(randomUUID());const f=fixture(),input={preparation_id:f.selector.preparation_id,configuration_sha256:f.selector.configuration_sha256};
 let mutate=()=>{};let reads=0;
 const options={identity,stateDirectory:directory,readStage:async()=>({input,configuration:{workspace_id:f.selector.workspace_id}}),
  capability:{snapshot:()=>({instance_id:randomUUID(),host_pid:123}),readWorkspacePreparation:async signed=>{
   validateNativeCodingDeviceRequest(signed,'READ_WORKSPACE_PREPARATION_V1');reads++;
   const result={schema:'metaengine.native-coding.workspace-preparation-readback.v1',...input,state:'PREPARED',preparation_grant_epoch:1,current_grant_valid:true,
    owner_incarnation_verified:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};mutate(result);return result;
  }}};
 assert.deepEqual(await readVerifiedPreparedGoalSelector(options),f.selector);
 for(const change of [v=>v.state='UNKNOWN',v=>v.current_grant_valid=false,v=>v.configuration_sha256='f'.repeat(64),v=>v.extra=true,v=>v.owner_incarnation_verified=true]){
  mutate=change;await assert.rejects(readVerifiedPreparedGoalSelector(options),/preparation_unverified/);
 }
 assert.equal(reads,6);
});

const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
function mainFunction(name,next,context){
 const start=main.indexOf(`async function ${name}(`)>=0?main.indexOf(`async function ${name}(`):main.indexOf(`function ${name}(`);
 const end=main.indexOf(next,start);assert.ok(start>=0&&end>start);
 return vm.runInNewContext(`(${main.slice(start,end).trim()})`,context);
}
test('actual main routes user goal to pending only, latest and status are same-entry reads',async()=>{
 const f=fixture(),events=[],custody=[];
 const context={ensureClientGoalJournal:async()=>f.journal,readNativeGoalSubmissionMode:async()=>({kind:'PREPARED_GOAL',state:'HOST_VERIFICATION_REQUIRED'}),
  normalizeClientGoalIntent:v=>({goal:v}),randomUUID:()=>f.input.request_id,createPreparedGoalRouter:()=>f.router,
  continuePreparedGoalOwnerCustody:async(entry,write)=>{custody.push({entry,write});return {owner:{private:'NEVER_PUBLIC'}};},
  createNativeGoalRouter:()=>{throw Error('native mount forbidden');},nativeSupervisor:null,structuredClone,
  normalizeClientGoalRequestId:v=>v};
 const submit=mainFunction('submitClientGoal','async function latestClientGoal',context);
 const latest=mainFunction('latestClientGoal','async function refreshClientGoal',context);
 const refresh=mainFunction('refreshClientGoal','function assertNativeCodingRuntimeMountOpen',context);
 await f.journal.load();assert.deepEqual(await submit(f.input.goal),f.receipt);
 events.push(await latest(),await refresh(f.input.request_id));
 assert.deepEqual(f.calls.map(c=>c.op),['ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1']);
 assert.equal(events[0].state,'PENDING_ACTIVATION');assert.equal(events[1].execution_ready,false);
 assert.deepEqual(custody.map(v=>v.write),[true,false]);assert.equal(JSON.stringify(events).includes('NEVER_PUBLIC'),false);
 await assert.rejects(submit('another goal'),/previous_request/);
});
test('actual main signs only selected pending operation and closes ephemeral capability; shutdown fences response',async()=>{
 const f=fixture(),operations=[];let closed=false,closeCount=0;
 const summary={status_file:'/runtime/status.json'},capability={snapshot:()=>({}),admitPreparedGoal:async()=>f.result,
  readPreparedGoal:async()=>f.result,close:()=>closeCount++};
 const context={createClientPreparedGoalRouter,readPreparedGoalSelector:async()=>f.selector,readOwnedLocalRuntimeHostSummary:()=>summary,
  assertNativeCodingRuntimeMountOpen:()=>{if(closed)throw Error('closing');},managedTaskProjectHostClosing:Promise.resolve(),
  createOwnedNativeCodingHostCapability:()=>capability,ensureSupervisorIdentity:()=>({snapshot:()=>({device_id:'device',client_id:'client',key_fingerprint_sha256:'key'})}),
  signNativeCodingDeviceRequest:async({operation,input})=>{operations.push({operation,input});return {operation,input};}};
 const factory=mainFunction('createPreparedGoalRouter','async function readNativeGoalSubmissionMode',context);
 await factory(f.journal).submit(f.input);assert.equal(closeCount,1);assert.equal(operations[0].operation,'ADMIT_PREPARED_GOAL_V1');
 capability.readPreparedGoal=async()=>{closed=true;return f.result;};
 await assert.rejects(factory(f.journal).refresh(f.journal.latest()),/closing/);assert.equal(closeCount,2);
 assert.equal(f.journal.latest().state,'RECONCILE_REQUIRED');assert.equal(operations.length,2);
});
test('journal reload rejects injected active/proof or changed selector state and preserves v1 kind boundaries',async()=>{
 const f=fixture();await f.router.submit(f.input);
 for(const mutate of [v=>v.state='RUNNING',v=>v.progress={found:true},v=>v.execution_proof={},v=>v.admitted_task_id=randomUUID(),
  v=>v.prepared_selector.workspace_id=randomUUID(),v=>v.kind='NATIVE_CODING',v=>v.kind='BROWSER']){
  const raw=structuredClone(f.durable());mutate(raw.entries[0]);
  await assert.rejects(new ClientGoalJournal({loadState:async()=>raw,saveState:async()=>{}}).load());
 }
});

for(const operation of ['ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1'])for(const key of ['device_id','client_id','key_fingerprint_sha256'])
 test(`actual main fences ${key} rotation while awaiting ${operation} ACK`,async()=>{
  const f=fixture(),calls=[];let closes=0;
  if(operation==='READ_PREPARED_GOAL_V1')await f.router.submit(f.input);
  let device={device_id:'original-device',client_id:'original-client',key_fingerprint_sha256:'original-key'};
  const capability={snapshot:()=>({}),close:()=>closes++,
   admitPreparedGoal:async()=>{calls.push('ADMIT');device={...device,[key]:'rotated'};return f.result;},
   readPreparedGoal:async()=>{calls.push('READ');if(operation==='ADMIT_PREPARED_GOAL_V1')throw Error('OPERATION_FAILED');device={...device,[key]:'rotated'};return f.result;}};
  const summary={status_file:'/runtime/status.json'};
  const context={createClientPreparedGoalRouter,readPreparedGoalSelector:async()=>f.selector,readOwnedLocalRuntimeHostSummary:()=>summary,
   assertNativeCodingRuntimeMountOpen:()=>{},managedTaskProjectHostClosing:Promise.resolve(),createOwnedNativeCodingHostCapability:()=>capability,
   ensureSupervisorIdentity:()=>({snapshot:()=>({...device})}),signNativeCodingDeviceRequest:async({operation,input})=>({operation,input})};
  const router=mainFunction('createPreparedGoalRouter','async function readNativeGoalSubmissionMode',context)(f.journal);
  await assert.rejects(operation==='ADMIT_PREPARED_GOAL_V1'?router.submit(f.input):router.refresh(f.journal.latest()),/requires_reconciliation|identity_changed/);
  assert.equal(f.journal.latest().state,'RECONCILE_REQUIRED');
  assert.deepEqual(f.journal.latest().receipt,operation==='ADMIT_PREPARED_GOAL_V1'?null:f.receipt);
  assert.deepEqual(f.journal.latest().prepared_selector,f.selector);
  assert.deepEqual(calls,operation==='ADMIT_PREPARED_GOAL_V1'?['ADMIT','READ']:['READ']);assert.equal(closes,calls.length);
 });

for(const write of [true,false])test(`actual main pending Owner ${write?'submission':'recovery'} binds native producers and exact signed selector`,async()=>{
 const f=fixture();await f.router.submit(f.input);const calls=[];let binding,unbound=false,closed=false;
 const device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64)};
 const identity={ensure:async()=>{},snapshot:()=>({...device}),bindHostOwnerGenesisW74:options=>{
  calls.push('BIND');binding=options;return async()=>{unbound=true;calls.push('UNBIND');};},
  establishHostOwnerW74:async()=>{calls.push('CREATE');await binding.readNativeKernel(123);await binding.readSourceProof();
   await binding.withOwnerScope('WRITE_CUSTODY',async()=>true);await binding.withOwnerScope('READ_CUSTODY',async()=>true);return{owner:true};},
  readTrustedHostOwnerIncarnationW74:async()=>{calls.push('RECOVER');await binding.withOwnerScope('READ_CUSTODY',async()=>true);return{owner:true};}};
 const capability={snapshot:()=>({instance_id:randomUUID(),host_pid:123,closed}),readPreparedGoal:async()=>f.result,
  withPendingOwnerScope:async(operation,signed,body)=>{assert.equal(signed.operation,operation);assert.deepEqual(signed.input,preparedGoalInput(f.journal.latest()));calls.push(operation);return body({});},
  close:()=>{assert.equal(unbound,true);closed=true;}};
 const app={isPackaged:true};const summary={instance_id:'fixed'};
 const context={managedTaskProjectHostClosing:Promise.resolve(),pendingOwnerInitializationsByBarrier:new Map(),
  runNativeInitialization:(_closing,_map,body)=>body(),assertNativeSupervisorInitializationOpen:()=>{},assertNativeCodingRuntimeMountOpen:()=>{},
  preparedGoalInput,normalizePreparedGoalResult,readOwnedLocalRuntimeHostSummary:()=>summary,ensureSupervisorIdentity:()=>identity,
  createOwnedNativeCodingHostCapability:()=>capability,ensureGuardianBootstrapLauncher:()=>calls.push('GUARDIAN'),app,
  readWindowsKernelProcessW60:async pid=>{assert.equal(pid,123);calls.push('KERNEL');},
  readVerifiedInstalledExecutableW68:async actual=>{assert.equal(actual,app);calls.push('W68');},
  signNativeCodingDeviceRequest:async({operation,input})=>{calls.push('SIGN:'+operation);return{operation,input};}};
 const run=mainFunction('continuePreparedGoalOwnerCustody','async function readPreparedGoalSelector',context);
 const result=await run(f.journal.latest(),write);
 assert.equal(result.state,'CUSTODY_VERIFIED');assert.equal(result.loaded_runtime_code_attested,false);
 assert.equal(result.execution_ready,false);assert.equal(result.production_qualified,false);assert.equal(closed,true);
 assert.equal(calls.filter(x=>x==='ESTABLISH_PENDING_OWNER_V1').length,write?1:0);
 assert.equal(calls.filter(x=>x==='READ_PENDING_OWNER_V1').length,1);
 assert.equal(calls[0],'SIGN:READ_PREPARED_GOAL_V1');assert.equal(calls.at(-1),'UNBIND');
 if(write){assert(calls.includes('KERNEL'));assert(calls.includes('W68'));}
});

test('pending Owner signed inputs reject renderer Owner/epoch/project/SQL/path extensions',async t=>{
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pending-owner-input-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const identity=new SupervisorDeviceIdentity({statePath:path.join(directory,'identity.json'),secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});
 await identity.ensure();await identity.bindDevice(randomUUID());const f=fixture();await f.router.submit(f.input);
 const binding={instance_id:randomUUID(),host_pid:123},input=preparedGoalInput(f.journal.latest());
 for(const operation of ['ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1']){
  const signed=await signNativeCodingDeviceRequest({identity,binding,operation,input});
  assert.deepEqual(validateNativeCodingDeviceRequest(signed,operation).body.input,input);
  for(const key of ['owner','owner_epoch','project_id','sql','path','host_generation']){
   const forged=structuredClone(signed);forged.body.input[key]='renderer selected';
   assert.throws(()=>validateNativeCodingDeviceRequest(forged,operation),/input_invalid/);
  }
 }
});

test('actual main lost admission ACK, startup/latest and refresh never start a pending Owner seal',async()=>{
 const f=fixture(),custody=[];
 const router=createClientPreparedGoalRouter({journal:f.journal,readSelector:async()=>f.selector,request:async operation=>{
  if(operation==='ADMIT_PREPARED_GOAL_V1')throw Error('TEST_ADMISSION_ACK_LOST');return f.result;
 }});
 const context={ensureClientGoalJournal:async()=>f.journal,readNativeGoalSubmissionMode:async()=>({kind:'PREPARED_GOAL',state:'READY'}),
  normalizeClientGoalIntent:v=>({goal:v}),randomUUID:()=>f.input.request_id,createPreparedGoalRouter:()=>router,
  continuePreparedGoalOwnerCustody:async(_entry,write)=>{custody.push(write);return {state:'HOLD'};},
  nativeSupervisor:null,structuredClone,publishSnapshot:async()=>{},safeClientGoalEntry:entry=>entry,normalizeClientGoalRequestId:v=>v};
 const submit=mainFunction('submitClientGoal','async function latestClientGoal',context);
 const latest=mainFunction('latestClientGoal','async function refreshClientGoal',context);
 const refresh=mainFunction('refreshClientGoal','function assertNativeCodingRuntimeMountOpen',context);
 await f.journal.load();await assert.rejects(submit(f.input.goal),/requires_reconciliation/);
 assert.equal(f.journal.latest().state,'PENDING_ACTIVATION');assert.deepEqual(custody,[]);
 await latest();assert.deepEqual(custody,[],'startup/latest does not manufacture a custody attempt');
 await refresh(f.input.request_id);assert.deepEqual(custody,[false],'only READ-only recovery after unknown admission');
});
