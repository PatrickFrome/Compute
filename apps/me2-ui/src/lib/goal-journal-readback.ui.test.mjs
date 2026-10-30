import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the callbacks actually mounted by GoalComposer. These inert bridge
// observations exercise UI correlation and failures, not installed Owner proof.
const url = new URL('../components/me2/shell/me2-shell.tsx', import.meta.url);
const source = ts.createSourceFile(url.pathname, await readFile(url, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const composer = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GoalComposer');
assert.ok(composer?.body);
const declarations = composer.body.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations]);
function callback(name, context) {
  const declaration = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name);
  assert.ok(declaration && ts.isCallExpression(declaration.initializer)
    && ts.isIdentifier(declaration.initializer.expression) && declaration.initializer.expression.text === 'useCallback'
    && ts.isArrowFunction(declaration.initializer.arguments[0]), `${name} must be an actual useCallback arrow`);
  const executable = ts.transpileModule(`(${declaration.initializer.arguments[0].getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return vm.runInContext(executable, context);
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOT = '11111111-1111-4111-8111-111111111111';
function receipt(requestId = A) {
  return { schema: 'metaengine.native-coding.goal-admission.v1', request_id: requestId,
    state: 'ADMITTED', root_task_id: ROOT, project_id: '11111111-2222-4333-8444-555555555555',
    physical_execution_proven: false, production_qualified: false, automatic_retry_allowed: false, authority_effect: false };
}
function entry(requestId = A, admitted = receipt(requestId)) {
  return { schema: 'metaengine.client.goal-journal-entry.v1', request_id: requestId,
    kind: 'NATIVE_CODING', goal: 'An isolated UI observation', state: admitted ? 'ADMITTED' : 'FAILED',
    receipt: admitted, progress: null, execution_proof: null,
    last_error: admitted ? null : 'native_goal_rejected_before_dispatch',
    automatic_retry_allowed: false, authority_effect: false };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
function fixture(initial = entry()) {
  const observations = { errors: [], statusRequests: [], submissions: [], pending: [] };
  const mode = { schema: 'metaengine.client.goal-submission-mode.v1', kind: 'NATIVE_CODING',
    state: 'HOST_VERIFICATION_REQUIRED', reason: null, authority_effect: false, automatic_retry_allowed: false };
  const bridge = {
    latestGoal: async () => initial,
    goalStatus: async requestId => { observations.statusRequests.push(requestId); return {}; },
    goalSubmissionMode: async () => mode,
    workReadiness: async () => ({ execution_ready: true }),
    submitGoal: async goal => { observations.submissions.push(goal); throw new Error('native_goal_rejected_before_dispatch'); },
    typed_positive_api: true, generic_command_exposed: false,
  };
  const context = vm.createContext({
    receipt: initial?.receipt ?? null, journalEntry: initial, error: null, goal: 'Next isolated goal',
    mounted: { current: true }, loadSequence: { current: 0 }, operation: { current: null },
    clientControlBridge: () => bridge,
    modeObserver: { refresh: async () => mode },
    loadReadiness: async () => ({ execution_ready: true }),
    setJournalEntry(value) { context.journalEntry = value; },
    setReceipt(value) { context.receipt = value; },
    setError(value) { context.error = value; observations.errors.push(value); },
    setRefreshing() {},
    setPending(value) { observations.pending.push(value); },
    setGoal(value) { context.goal = value; },
  });
  context.loadLatest = callback('loadLatest', context);
  return { context, bridge, observations, load: context.loadLatest,
    refresh: callback('refreshProgress', context), submit: callback('submit', context) };
}

test('a newer admitted goal replaces its receipt and journal together', async () => {
  const f = fixture(), latest = entry(B);
  f.bridge.latestGoal = async () => latest;
  await f.load();
  assert.equal(f.context.journalEntry, latest);
  assert.equal(f.context.receipt, latest.receipt);
  assert.deepEqual(f.observations.submissions, []);
});

test('a newer pre-dispatch rejection clears the older task and project receipt', async () => {
  const f = fixture(), rejected = entry(B, null);
  f.bridge.latestGoal = async () => rejected;
  await f.load();
  assert.equal(f.context.journalEntry, rejected);
  assert.equal(f.context.receipt, null, 'a failed new request cannot inherit the previous project');
  await f.refresh();
  assert.deepEqual(f.observations.statusRequests, [B]);
  assert.deepEqual(f.observations.submissions, []);
});

test('an observed empty journal clears both the previous entry and its receipt', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => null;
  await f.load();
  assert.equal(f.context.journalEntry, null);
  assert.equal(f.context.receipt, null);
  await f.refresh();
  assert.deepEqual(f.observations.statusRequests, []);
  assert.deepEqual(f.observations.submissions, []);
});

for (const [name, change] of [
  ['receipt from another request', value => { value.receipt.request_id = A; }],
  ['progress from another request', value => { value.progress = { schema: 'metaengine.client.native-coding-goal-progress.v1', request_id: A }; }],
  ['result proof from another request', value => { value.execution_proof = { schema: 'metaengine.client.goal-execution-proof.v1', request_id: A, user_goal_to_result_readback: true }; }],
  ['unknown journal schema', value => { value.schema = 'unrecognized'; }],
  ['unknown receipt schema', value => { value.receipt.schema = 'unrecognized'; }],
]) test(`journal rejects ${name} and reports that retained details may be stale`, async () => {
  const original = entry(), f = fixture(original), malformed = entry(B);
  change(malformed);
  f.bridge.latestGoal = async () => malformed;
  await f.load();
  assert.equal(f.context.journalEntry, original);
  assert.equal(f.context.receipt, original.receipt);
  assert.match(f.context.error || '', /unavailable|invalid|stale/i);
  assert.deepEqual(f.observations.submissions, []);
});

test('a rejected journal read settles the fire-and-forget mount path with an explicit error', async () => {
  const original = entry(), f = fixture(original);
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await assert.doesNotReject(f.load());
  assert.equal(f.context.journalEntry, original);
  assert.equal(f.context.receipt, original.receipt);
  assert.match(f.context.error || '', /unavailable|stale/i);
});

test('a status refresh cannot clear the error from its failed journal readback', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await f.refresh();
  assert.match(f.context.error || '', /unavailable|stale/i);
  assert.equal(f.context.operation.current, null);
  assert.deepEqual(f.observations.statusRequests, [A]);
  assert.deepEqual(f.observations.submissions, []);
});

test('status refresh follows the newest journal request even when a previous receipt remains', async () => {
  const f = fixture();
  f.context.journalEntry = entry(B, null);
  f.bridge.latestGoal = async () => f.context.journalEntry;
  await f.refresh();
  assert.deepEqual(f.observations.statusRequests, [B]);
  assert.equal(f.context.receipt, null);
  assert.deepEqual(f.observations.submissions, []);
});

test('a later successful status read clears the prior observation error', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await f.refresh();
  assert.match(f.context.error || '', /unavailable|stale/i);
  f.bridge.latestGoal = async () => entry(B);
  await f.refresh();
  assert.equal(f.context.error, null);
  assert.equal(f.context.journalEntry.request_id, B);
  assert.equal(f.context.receipt.request_id, B);
});

for (const reject of [false, true]) test(`a superseded ${reject ? 'rejection' : 'read'} cannot replace a newer observation`, async () => {
  const f = fixture(), old = deferred();
  f.bridge.latestGoal = () => old.promise;
  const first = f.load();
  f.bridge.latestGoal = async () => entry(B, null);
  await f.load();
  if (reject) old.reject(new Error('late IPC failure')); else old.resolve(entry(A));
  await first;
  assert.equal(f.context.journalEntry.request_id, B);
  assert.equal(f.context.receipt, null);
  assert.equal(f.context.error, null);
});

for (const reject of [false, true]) test(`an unmounted ${reject ? 'rejection' : 'read'} cannot publish presentation state`, async () => {
  const original = entry(), f = fixture(original), pending = deferred();
  f.bridge.latestGoal = () => pending.promise;
  const reading = f.load();
  f.context.mounted.current = false;
  f.context.loadSequence.current++;
  if (reject) pending.reject(new Error('late IPC failure')); else pending.resolve(entry(B));
  await reading;
  assert.equal(f.context.journalEntry, original);
  assert.equal(f.context.receipt, original.receipt);
  assert.deepEqual(f.observations.errors, []);
});

test('a failed submit plus failed readonly reconciliation settles without resending the effect', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await assert.doesNotReject(f.submit());
  assert.deepEqual(f.observations.submissions, ['Next isolated goal']);
  assert.deepEqual(f.observations.pending, [true, false]);
  assert.equal(f.context.operation.current, null);
  assert.match(f.context.error || '', /unavailable|stale/i);
  await f.refresh();
  assert.deepEqual(f.observations.submissions, ['Next isolated goal']);
});

function actualStatus(context){
 const labels=declarations.find(node=>node.name?.text==='labels');
 const status=declarations.find(node=>node.name?.text==='status');
 assert.ok(labels?.initializer&&status?.initializer);
 const executable=ts.transpileModule(`const labels=${labels.initializer.getText(source)}; (${status.initializer.getText(source)});`,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 return vm.runInNewContext(executable,{journalEntry:entry(),error:null,proof:null,isNative:true,receipt:receipt(),nativeReceipt:receipt(),...context});
}

test('goal status distinguishes suspended waiting from a rejected native review',()=>{
 assert.equal(actualStatus({progress:{found:true,task_state:'SUSPENDED'}}),'Waiting for child tasks');
 for(const task_state of ['RUNNING','SUSPENDED','RESULT_READY'])assert.equal(
  actualStatus({progress:{found:true,task_state,blocked_reason:'NATIVE_REVIEW_REJECTED'}}),
  'CRITIC rejected result · repair required');
 assert.equal(actualStatus({journalEntry:{...entry(),project_error:'unavailable'},progress:{found:true,task_state:'SUSPENDED',blocked_reason:'NATIVE_REVIEW_REJECTED'}}),
  'Native observation unavailable','stale observations must remain labelled unavailable');
});

function pendingEntry(requestId=B){
 return {...entry(requestId),kind:'PREPARED_GOAL',state:'PENDING_ACTIVATION',receipt:{
  schema:'metaengine.native-coding.pending-goal-admission.v1',state:'PENDING_ACTIVATION',request_id:requestId,
  root_task_id:ROOT,project_id:'11111111-2222-4333-8444-555555555555',root_state:'BLOCKED',project_state:'PAUSED',
  owner_incarnation_verified:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false}};
}
test('actual pending readback renders Owner activation, never queued/running/completed, and refresh never submits',async()=>{
 const f=fixture(),pending=pendingEntry();f.bridge.latestGoal=async()=>pending;
 assert.equal(await f.load(),true);assert.equal(f.context.receipt,pending.receipt);
 assert.equal(actualStatus({journalEntry:pending,receipt:pending.receipt,nativeReceipt:null,progress:null}),'Project awaiting Owner activation · not running');
 await f.refresh();assert.deepEqual(f.observations.statusRequests,[B]);assert.deepEqual(f.observations.submissions,[]);
});
test('actual pending unknown readback removes previous positive receipt but retains request for readonly recovery',async()=>{
 const f=fixture(pendingEntry()),unknown={...pendingEntry(),state:'RECONCILE_REQUIRED'};f.bridge.latestGoal=async()=>unknown;
 await f.load();assert.equal(f.context.receipt,null);assert.equal(f.context.journalEntry.request_id,B);
 await f.submit();assert.deepEqual(f.observations.submissions,[]);
 await f.refresh();assert.deepEqual(f.observations.statusRequests,[B]);assert.equal(f.context.receipt,null);
 assert.equal(actualStatus({journalEntry:unknown,receipt:null,nativeReceipt:null,progress:null}),'Needs reconciliation');
});
for(const mutate of [v=>v.receipt.execution_ready=true,v=>v.receipt.owner_incarnation_verified=true,v=>v.receipt.root_state='READY',
 v=>v.receipt.project_state='ACTIVE',v=>v.receipt.schema='metaengine.native-coding.goal-admission.v1',v=>v.state='RUNNING'])
 test('actual pending journal UI rejects a forged execution/active projection',async()=>{
  const f=fixture(null),pending=pendingEntry();mutate(pending);f.bridge.latestGoal=async()=>pending;
  assert.equal(await f.load(),false);assert.equal(f.context.receipt,null);assert.match(f.context.error,/unavailable/);
 });
test('actual prepared submit sends user text once, skips execution readiness, then reads pending receipt',async()=>{
 const f=fixture(null),pending=pendingEntry();
 f.context.modeObserver.refresh=async()=>({schema:'metaengine.client.goal-submission-mode.v1',kind:'PREPARED_GOAL',state:'HOST_VERIFICATION_REQUIRED',reason:null,automatic_retry_allowed:false,authority_effect:false});
 f.context.loadReadiness=async()=>{throw Error('pending is not execution');};
 f.bridge.submitGoal=async goal=>{f.observations.submissions.push(goal);return pending.receipt;};f.bridge.latestGoal=async()=>pending;
 await f.submit();assert.deepEqual(f.observations.submissions,['Next isolated goal']);assert.equal(f.context.receipt.state,'PENDING_ACTIVATION');
 await f.refresh();assert.equal(f.observations.submissions.length,1);
});
test('navigation during prepared mode read cancels before dispatch, without clearing an older pending journal',async()=>{
 const pending=pendingEntry(),f=fixture(pending),read=deferred();f.context.modeObserver.refresh=()=>read.promise;
 const submitted=f.submit();f.context.mounted.current=false;f.context.loadSequence.current++;
 read.resolve({schema:'metaengine.client.goal-submission-mode.v1',kind:'PREPARED_GOAL',state:'HOST_VERIFICATION_REQUIRED',reason:null,automatic_retry_allowed:false,authority_effect:false});
 await submitted;assert.deepEqual(f.observations.submissions,[]);assert.equal(f.context.journalEntry,pending);
});
test('navigation after dispatch never retries or clears pending intent on subsequent read',async()=>{
 const f=fixture(null),ack=deferred(),pending=pendingEntry();let started;
 const sent=new Promise(r=>started=r);
 f.context.modeObserver.refresh=async()=>({schema:'metaengine.client.goal-submission-mode.v1',kind:'PREPARED_GOAL',state:'HOST_VERIFICATION_REQUIRED',reason:null,automatic_retry_allowed:false,authority_effect:false});
 f.bridge.submitGoal=async goal=>{f.observations.submissions.push(goal);started();return ack.promise;};f.bridge.latestGoal=async()=>pending;
 const submission=f.submit();await sent;f.context.mounted.current=false;f.context.loadSequence.current++;ack.resolve(pending.receipt);await submission;
 assert.equal(f.observations.submissions.length,1);assert.equal(f.context.journalEntry,null);
 f.context.mounted.current=true;await f.load();assert.equal(f.context.journalEntry,pending);await f.refresh();assert.equal(f.observations.submissions.length,1);
});

function jsxByTestId(id){
 let found;function visit(node){
  if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='data-testid'&&p.initializer&&ts.isStringLiteral(p.initializer)&&p.initializer.text===id))found=node;
  ts.forEachChild(node,visit);
 }visit(composer);assert.ok(found,`shipped ${id} element`);return found;
}
function renderElement(node,context){
 const executable=ts.transpileModule(`(${node.getText(source)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 return vm.runInNewContext(executable,{React:{createElement:(tag,props,...children)=>({tag,props,children})},...context});
}
test('actual prepared button says Save goal, HOLD disables it, Enter invokes the same callback',async()=>{
 let submissions=0;const submit=async()=>{submissions++;};
 const context={pending:false,refreshing:false,recoveryPending:false,modeRefreshing:false,goal:'My objective',journalEntry:null,
  goalMode:{kind:'PREPARED_GOAL',state:'HOST_VERIFICATION_REQUIRED'},submit};
 const button=renderElement(jsxByTestId('client-goal-submit'),context);assert.equal(button.children[0],'Save goal');assert.equal(button.props.disabled,false);
 button.props.onClick();assert.equal(submissions,1);
 const held=renderElement(jsxByTestId('client-goal-submit'),{...context,goalMode:{kind:'PREPARED_GOAL',state:'HOLD'}});assert.equal(held.props.disabled,true);
 let input;function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='data-testid'&&p.initializer?.text==='client-goal-input'))input=n;ts.forEachChild(n,visit);}visit(composer);
 assert.ok(input);const rendered=renderElement(input,{...context,setGoal(){}});let prevented=false;
 rendered.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(submissions,2);
 rendered.props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:true},preventDefault(){}});assert.equal(submissions,2);
});

for(const outcome of ['ACK','ERROR'])test(`newer observed request survives late prepared submit ${outcome}`,async()=>{
 const f=fixture(null),ack=deferred(),older=pendingEntry(A),newer=pendingEntry(B);let started;
 const sent=new Promise(r=>started=r);
 f.context.modeObserver.refresh=async()=>({schema:'metaengine.client.goal-submission-mode.v1',kind:'PREPARED_GOAL',state:'HOST_VERIFICATION_REQUIRED',reason:null,automatic_retry_allowed:false,authority_effect:false});
 f.bridge.submitGoal=async goal=>{f.observations.submissions.push(goal);started();return ack.promise;};
 let reads=0;f.bridge.latestGoal=async()=>{reads++;return newer;};
 const submission=f.submit();await sent;
 await f.load();assert.equal(f.context.receipt,newer.receipt);const previousError=f.context.error;
 if(outcome==='ACK')ack.resolve(older.receipt);else ack.reject(Error('late old error'));
 await submission;
 assert.equal(f.context.receipt,newer.receipt);assert.equal(f.context.journalEntry,newer);assert.equal(f.context.error,previousError);
 assert.equal(f.context.goal,'Next isolated goal');assert.equal(reads,1,'obsolete completion must not start a newer read');
 assert.equal(f.observations.submissions.length,1);assert.equal(f.context.operation.current,null);
});
