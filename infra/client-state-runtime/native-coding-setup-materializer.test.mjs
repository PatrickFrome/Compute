// Real disposable Git + FULL SQLite receipts. Admission and Owner callbacks are
// generated fixtures: this does not qualify Windows/native custody or install.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createNativeCodingSetupMaterializer} from './native-coding-setup-materializer.mjs';
import {createManagedTaskProjectSqliteJournal} from '../../apps/metaengine-browser/src/managed-task-project-sqlite-journal.mjs';
import {createShellFreeGitExecutor} from '../../apps/metaengine-browser/src/managed-task-project-runtime.mjs';
import {createWorkspaceReservation} from '../../apps/metaengine-browser/src/workspace-manager.mjs';
import {managedProjectEffectKey} from '../../apps/metaengine-browser/src/managed-task-project-authority-resolver.mjs';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {runNativePhysicalSettlementScope,markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
const exec=promisify(execFile),tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'setup-materializer-'))),repo=path.join(root,'repo'),managed=path.join(root,'managed');
 await fs.mkdir(repo);await fs.mkdir(managed);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 const git=args=>exec('git',args,{cwd:repo,env});
 await git(['init','-q']);await fs.writeFile(path.join(repo,'source.txt'),'original\n');await git(['add','source.txt']);
 await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','source']);
 const source=await readNativeCodingGitProof(repo,{env}),workspace=randomUUID(),operation=randomUUID();
 const actor={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'1'.repeat(64),admin_grant_epoch:1};
 const claim={coordination_workspace_id:workspace,task_id:randomUUID(),claim_id:1,point_id:'setup.materialization',claim_class:'MUTATING',
  base_sha:source.head,branch_name:'work/setup-'+randomUUID(),agent_id:'agent_'+randomUUID(),tab_id:'tab_'+randomUUID(),target_id:'webcontents:7',
  agent_generation_epoch:1,lease_generation:1,lease_expires_at:new Date(Date.now()+600000).toISOString()};
 const binding=createWorkspaceReservation({claim,trusted_repo:{repo_id:'fixture:setup',repo_root:repo},workspace_root:managed});
 const request={idempotency_key:'setup:'+operation,...Object.fromEntries(['coordination_workspace_id','task_id','agent_id','claim_id','lease_generation','workspace_id','workspace_generation'].map(key=>[key,binding[key]]))};
 let jobDrained=false;
 const abort=new AbortController(),scope={operation_id:operation,custody_id:randomUUID(),input:{operation_id:operation,workspace_id:workspace},actor,
  observation:{workspace_id:workspace,repository:{repo_id:'fixture:setup',repo_root:repo,managed_root:managed}},signal:abort.signal,
  revalidate:async()=>{if(abort.signal.aborted)throw Error('fixture_cancelled');},
  assertJobDrained:()=>{if(!jobDrained)throw Error('fixture_original_job_not_drained');}};
 const journalFile=path.join(root,'effects.sqlite');let journal=createManagedTaskProjectSqliteJournal({filePath:journalFile});
 t.after(()=>journal.close());
 const executor=createShellFreeGitExecutor();let creates=0,ownerChecks=0;
 const deps={
  readAdmittedRequest:async()=>({request,source:{head:source.head,artifact_sha256:source.artifact_sha256}}),
  resolveProjectBinding:async()=>({schema:'metaengine.devos.managed-project-admission.v1',authoritative:true,active:true,
   device_id:actor.device_id,client_id:actor.client_id,admin_grant_epoch:actor.admin_grant_epoch,claim,workspace_binding:binding,authority_effect:false}),
  withOwnerCustody:async(_input,effect)=>effect(()=>{ownerChecks++;}),
  executePlan:async(plan)=>{if(plan.effect==='WORKTREE_CREATE_LOCKED')creates++;return executor.execute(plan);},
  journal:{find:(...args)=>journal.find(...args),append:(...args)=>journal.append(...args)},
  reserveBinding:async()=>{},finalizeBinding:async()=>{},readSource:({repo_root,signal})=>readNativeCodingGitProof(repo_root,{env,signal}),
 };
 return {root,repo,git,binding,scope,abort,request,deps,receipt:()=>journal.find(managedProjectEffectKey(request)),setJobDrained:()=>{jobDrained=true;},
  reopen:async()=>{await journal.close();journal=createManagedTaskProjectSqliteJournal({filePath:journalFile});},
  get creates(){return creates;},get ownerChecks(){return ownerChecks;}};
}

// Explicitly UNQUALIFIED producer double. The private registry accepts only
// result/error object identities returned by its own real Git invocations.
// Resolving these generated joins never qualifies Windows descendant custody.
function originalDrainDouble(f,{execute=f.deps.executePlan,join=async()=>{}}={}){
 const originals=new WeakMap(),joined=[];
 const executePlan=async(...args)=>{
  try{const result=await execute(...args);originals.set(result,args[0]);return result;}
  catch(error){originals.set(error,args[0]);throw error;}
 };
 Object.defineProperty(executePlan,'joinOriginalDrain',{writable:true,configurable:true,value:async original=>{
  assert.equal(originals.has(original),true,'native drain must receive its exact original result/error object');
  const plan=originals.get(original);joined.push({original,plan});return join(original,plan);
 }});
 return {executePlan,joined};
}

test('cold admitted setup creates the existing locked worktree; restart and changed caller key only read its exact durable receipt',async t=>{
 const f=await fixture(t),worker=createNativeCodingSetupMaterializer(f.deps);
 assert.deepEqual(await worker(f.scope),{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'});
 const original=await f.receipt();assert.equal(original.state,'PROVEN');assert.equal(f.creates,1);assert.equal(f.ownerChecks,1);
 assert.equal(await fs.readFile(path.join(f.binding.worktree_path,'source.txt'),'utf8'),'original\n');
 assert.match((await f.git(['worktree','list','--porcelain'])).stdout,/locked METAENGINE:/);
 await f.reopen();f.request.idempotency_key='another-caller-key';
 await createNativeCodingSetupMaterializer(f.deps)(f.scope);
 assert.equal(f.creates,1);assert.deepEqual(await f.receipt(),original);
});

test('missing Main admission selects no task or effect and creates no journal record',async t=>{
 const f=await fixture(t),worker=createNativeCodingSetupMaterializer({...f.deps,readAdmittedRequest:async()=>null});
 assert.deepEqual(await worker(f.scope),{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'});
 assert.equal(f.creates,0);assert.equal(await f.receipt(),null);
});

test('foreign workspace, principal or source selector cannot enter the existing materializer',async t=>{
 for(const change of ['workspace','principal','source']){
  const f=await fixture(t),deps={...f.deps};
  if(change==='workspace')deps.readAdmittedRequest=async()=>({request:{...f.request,coordination_workspace_id:randomUUID()},source:{head:f.binding.base_sha,artifact_sha256:'2'.repeat(64)}});
  if(change==='principal')deps.resolveProjectBinding=async()=>({...await f.deps.resolveProjectBinding(),device_id:randomUUID()});
  if(change==='source')deps.readAdmittedRequest=async()=>({request:f.request,source:{head:'a'.repeat(40),artifact_sha256:'2'.repeat(64)}});
  await assert.rejects(createNativeCodingSetupMaterializer(deps)(f.scope),/workspace_changed|principal_changed|repository_or_source_changed/);
  assert.equal(f.creates,0);assert.equal(await f.receipt(),null);
 }
});

test('fresh Owner rejection and dirty source after reservation prevent physical create and retain ambiguity without retry',async t=>{
 for(const change of ['owner','source']){
  const f=await fixture(t),deps={...f.deps};
  if(change==='owner')deps.withOwnerCustody=async(_input,effect)=>effect(()=>{throw Error('fixture_owner_stopped');});
  if(change==='source')deps.reserveBinding=async()=>fs.writeFile(path.join(f.repo,'source.txt'),'changed after admission\n');
  const worker=createNativeCodingSetupMaterializer(deps);await worker(f.scope);
  const original=await f.receipt();assert.equal(original.state,'AMBIGUOUS');assert.equal(f.creates,0);
  assert.match(original.reason,/fixture_owner_stopped|source_changed/);
  await assert.rejects(worker(f.scope),/effect_ambiguous/);assert.equal(f.creates,0);assert.deepEqual(await f.receipt(),original);
 }
});

test('partial materialization preserves original AMBIGUOUS receipt and never repeats Git add',async t=>{
 const f=await fixture(t),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:async plan=>{
  const result=await f.deps.executePlan(plan);if(plan.effect==='WORKTREE_CREATE_LOCKED')throw Error('fixture_lost_git_result');return result;
 }});
 await worker(f.scope);const original=await f.receipt();assert.equal(original.state,'AMBIGUOUS');assert.equal(f.creates,1);
 assert.equal(await fs.readFile(path.join(f.binding.worktree_path,'source.txt'),'utf8'),'original\n');
 await f.reopen();await assert.rejects(worker(f.scope),/effect_ambiguous/);assert.equal(f.creates,1);assert.deepEqual(await f.receipt(),original);
});

test('lost durable terminal ACK recovers by readback and preserves the committed receipt',async t=>{
 const f=await fixture(t);let lost=false;
 const worker=createNativeCodingSetupMaterializer({...f.deps,journal:{...f.deps.journal,append:async entry=>{
  const value=await f.deps.journal.append(entry);if(entry.state==='PROVEN'&&!lost){lost=true;throw Error('fixture_terminal_ack_lost');}return value;
 }}});
 await assert.rejects(worker(f.scope),/terminal_ack_lost/);const original=await f.receipt();assert.equal(original.state,'PROVEN');
 await f.reopen();await createNativeCodingSetupMaterializer(f.deps)(f.scope);
 assert.equal(f.creates,1);assert.deepEqual(await f.receipt(),original);
});

test('cancellation waits for the already-started physical plan and retains its receipt',async t=>{
 const f=await fixture(t),entered=gate(),finished=gate();let settled=false;
 const worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:async plan=>{
  const result=await f.deps.executePlan(plan);if(plan.effect==='WORKTREE_CREATE_LOCKED'){entered.resolve();await finished.promise;}return result;
 }});
 const pending=worker(f.scope).finally(()=>{settled=true;});await entered.promise;f.abort.abort();await tick();
 assert.equal(settled,false);assert.equal((await f.receipt()).state,'RESERVED');finished.resolve();await pending;
 assert.equal(f.creates,1);assert.equal((await f.receipt()).state,'PROVEN');
 await assert.rejects(worker(f.scope),/cancelled/);assert.equal(f.creates,1);
});

test('concurrent duplicate admission shares the canonical durable effect identity',async t=>{
 const f=await fixture(t),worker=createNativeCodingSetupMaterializer(f.deps);
 const results=await Promise.allSettled([worker(f.scope),worker(f.scope)]);
 assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(f.creates,1);assert.equal((await f.receipt()).state,'PROVEN');
});

test('source mutation during the final scope check is observed before Git create',async t=>{
 const f=await fixture(t);let inside=false,reads=0;
 f.scope.revalidate=async()=>{if(inside&&++reads===2)await fs.writeFile(path.join(f.repo,'source.txt'),'late source change\n');};
 const worker=createNativeCodingSetupMaterializer({...f.deps,withOwnerCustody:async(_input,effect)=>{
  inside=true;try{return await effect(()=>{});}finally{inside=false;}
 }});
 await worker(f.scope);assert.equal(f.creates,0);assert.equal((await f.receipt()).state,'AMBIGUOUS');
 assert.match((await f.receipt()).reason,/source_changed/);
});

test('Owner custody cannot skip, replay, or outlive its callback',async t=>{
 for(const behavior of ['missing','double','early','async-assertion']){
  const f=await fixture(t);let late=null;
  const worker=createNativeCodingSetupMaterializer({...f.deps,withOwnerCustody:async(_input,effect)=>{
   if(behavior==='missing'){late=effect;return;}
   if(behavior==='double'){const first=effect(()=>{});try{return await effect(()=>{});}finally{await first.catch(()=>{});}}
   if(behavior==='early'){void effect(()=>{}).catch(()=>{});return;}
   return effect(async()=>{});
  }});
  await worker(f.scope);
  assert.equal((await f.receipt()).state,'AMBIGUOUS');assert.ok(f.creates<=1);
  if(behavior!=='double')assert.equal(f.creates,0);
  if(late)assert.throws(()=>late(()=>{}),/owner_callback_replayed/);
 }
});

test('final Owner-scoped admission must still be active, mutable and unfenced',async t=>{
 for(const change of ['inactive','untrusted','frozen','dirty','ambiguous','advisory']){
  const f=await fixture(t);let changed=false;
  const worker=createNativeCodingSetupMaterializer({...f.deps,withOwnerCustody:async(_input,effect)=>{changed=true;return effect(()=>{});},
   resolveProjectBinding:async()=>{
    const value=structuredClone(await f.deps.resolveProjectBinding());if(!changed)return value;
    if(change==='inactive')value.active=false;
    if(change==='untrusted')value.authoritative=false;
    if(change==='frozen')value.workspace_binding.state='FROZEN';
    if(change==='dirty')value.workspace_binding.dirty_hold=true;
    if(change==='ambiguous')value.workspace_binding.ambiguity_code='UNKNOWN_EFFECT';
    if(change==='advisory')value.claim.claim_class='ADVISORY';
    return value;
   }});
  await worker(f.scope);assert.equal(f.creates,0,change+' admission must prevent the physical effect');
  assert.equal((await f.receipt()).state,'AMBIGUOUS');
 }
});

test('PROVEN Git/SQLite and cleanup booleans cannot manufacture an original-job drain without a native facet',async t=>{
 const f=await fixture(t),worker=createNativeCodingSetupMaterializer(f.deps);
 assert.equal(worker.takeJobDrain(f.scope),null);
 assert.deepEqual(await worker(f.scope),{cleanup_confirmed:true,reason:'EVIDENCE_REQUIRED'});f.setJobDrained();
 assert.equal((await f.receipt()).state,'PROVEN');assert.equal(f.creates,1);assert.equal(worker.takeJobDrain(f.scope),null);
 const restarted=createNativeCodingSetupMaterializer(f.deps);await restarted(f.scope);assert.equal(restarted.takeJobDrain(f.scope),null);assert.equal(f.creates,1);
});

test('original native output and cancellation joins precede a drain token even after real Git has finished',async t=>{
 const f=await fixture(t),entered=gate(),output=gate(),cancellation=gate();let finished=false;
 const native=originalDrainDouble(f,{join:async(_original,plan)=>{if(plan.effect==='WORKTREE_CREATE_LOCKED'){entered.resolve();await output.promise;await cancellation.promise;}}});
 const worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 const pending=worker(f.scope).finally(()=>{finished=true;});await entered.promise;
 assert.equal((await f.receipt()).state,'PROVEN');assert.equal(f.creates,1);assert.equal(finished,false);assert.equal(worker.takeJobDrain(f.scope),null);
 f.abort.abort();f.setJobDrained();assert.equal(worker.takeJobDrain(f.scope),null,'even an early service assertion cannot skip original native joins');
 output.resolve();await tick();assert.equal(finished,false);assert.equal(worker.takeJobDrain(f.scope),null);
 cancellation.resolve();await pending;assert.equal(native.joined.length,3);assert.ok(worker.takeJobDrain(f.scope));
});

test('a rejected native drain joins every other original output before retaining physical HOLD',async t=>{
 const f=await fixture(t),allEntered=gate(),outputs=gate();let entered=0,finished=false;
 const native=originalDrainDouble(f,{join:async(_original,plan)=>{
  if(++entered===3)allEntered.resolve();
  if(plan.effect==='WORKTREE_CREATE_LOCKED')throw Error('fixture_native_cancel_drain_unknown');
  await outputs.promise;
 }});
 const worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan}),physical=runNativePhysicalSettlementScope(()=>worker(f.scope));
 const pending=physical.promise.then(value=>({value}),error=>({error})).finally(()=>{finished=true;});await allEntered.promise;
 assert.equal(finished,false);f.setJobDrained();assert.equal(worker.takeJobDrain(f.scope),null);
 outputs.resolve();await pending;assert.equal(native.joined.length,3);assert.equal(physical.unconfirmed(),true);assert.equal(worker.takeJobDrain(f.scope),null);
});

test('successful original native joins cannot replace the service original-job drain assertion',async t=>{
 const f=await fixture(t),native=originalDrainDouble(f),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 await worker(f.scope);assert.equal(native.joined.length,3);assert.equal(worker.takeJobDrain(f.scope),null);
 assert.equal(worker.takeJobDrain({...f.scope}),null,'equal identifiers are not the original service scope');
 f.setJobDrained();const token=worker.takeJobDrain(f.scope);
 assert.ok(token);assert.equal(Object.isFrozen(token),true);assert.equal(Object.getPrototypeOf(token),null);assert.deepEqual(Reflect.ownKeys(token),[]);
 assert.equal(worker.takeJobDrain(f.scope),null);
 await assert.rejects(Promise.resolve().then(()=>worker(f.scope)));assert.equal(worker.takeJobDrain(f.scope),null);assert.equal(f.creates,1);
});

test('original-job drain is consumed once before an asynchronous consumer or a lost acknowledgement can finish',async t=>{
 const f=await fixture(t),native=originalDrainDouble(f),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 await worker(f.scope);f.setJobDrained();const token=worker.takeJobDrain(f.scope),entered=gate(),release=gate();let calls=0;
 const pending=worker.consumeJobDrain(token,f.scope,async projection=>{
  calls++;assert.equal(Object.isFrozen(projection),true);assert.equal(projection.scope,f.scope);
  assert.deepEqual(Object.keys(projection).sort(),['authority_effect','automatic_retry_allowed','materialization_outcome','scope']);
  assert.equal(projection.materialization_outcome,'UNKNOWN');assert.equal(projection.automatic_retry_allowed,false);assert.equal(projection.authority_effect,false);
  entered.resolve();await release.promise;throw Error('fixture_consumer_ack_lost');
 });
 await entered.promise;
 try{await assert.rejects(Promise.resolve().then(()=>worker.consumeJobDrain(token,f.scope,()=>{calls++;})));assert.equal(calls,1);}
 finally{release.resolve();}
 await assert.rejects(pending,/consumer_ack_lost/);
 await assert.rejects(Promise.resolve().then(()=>worker.consumeJobDrain(token,f.scope,()=>{calls++;})));assert.equal(calls,1);assert.equal(worker.takeJobDrain(f.scope),null);
});

test('foreign scope, cross-factory, cloned and JSON drain objects cannot call a consumer or be recovered after restart',async t=>{
 const f=await fixture(t),native=originalDrainDouble(f),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 await worker(f.scope);f.setJobDrained();const token=worker.takeJobDrain(f.scope);let calls=0;
 const consume=()=>{calls++;},restarted=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 for(const [owner,candidate,scope] of [[worker,Object.freeze(Object.create(null)),f.scope],[worker,structuredClone(token),f.scope],
  [worker,JSON.parse(JSON.stringify(token)),f.scope],[worker,token,{...f.scope}],[restarted,token,f.scope]]){
  await assert.rejects(Promise.resolve().then(()=>owner.consumeJobDrain(candidate,scope,consume)));
 }
 await restarted(f.scope);assert.equal(restarted.takeJobDrain(f.scope),null,'current inventory readback cannot adopt an earlier mutation drain');
 await assert.rejects(Promise.resolve().then(()=>restarted.consumeJobDrain(token,f.scope,consume)));assert.equal(calls,0);assert.equal(f.creates,1);
});

test('partial effect passes the exact original native error to drain and retains UNKNOWN through one-use consumption',async t=>{
 const f=await fixture(t),originalError=Error('fixture_original_effect_result_unknown');
 const native=originalDrainDouble(f,{execute:async plan=>{const value=await f.deps.executePlan(plan);if(plan.effect==='WORKTREE_CREATE_LOCKED')throw originalError;return value;}});
 const worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});await worker(f.scope);
 assert.ok(native.joined.some(entry=>entry.original===originalError));assert.equal((await f.receipt()).state,'AMBIGUOUS');assert.equal(f.creates,1);
 f.setJobDrained();const token=worker.takeJobDrain(f.scope);assert.ok(token);
 assert.equal(await worker.consumeJobDrain(token,f.scope,projection=>projection.materialization_outcome),'UNKNOWN');
 assert.equal((await f.receipt()).state,'AMBIGUOUS');assert.equal(f.creates,1);
});

test('native drain flags and swallowed private physical HOLD cannot mint an original-job capability',async t=>{
 for(const result of [true,false,{cleanup_confirmed:true},'swallowed_hold']){
  const f=await fixture(t),native=originalDrainDouble(f,{join:async()=>{
   if(result==='swallowed_hold'){try{throw markNativePhysicalSettlementUnconfirmed(Error('fixture_native_original_drain_hold'));}catch{}return;}
   return result;
  }}),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
  let physical;const assertServiceDrained=f.scope.assertJobDrained;
  // Match the actual service's original closure: row.finished and local drain
  // cannot override a physical HOLD retained by this original job's scope.
  f.scope.assertJobDrained=()=>{assertServiceDrained();if(physical.unconfirmed())throw Error('fixture_original_job_physical_hold');};
  physical=runNativePhysicalSettlementScope(()=>worker(f.scope));
  await physical.promise.catch(()=>{});f.setJobDrained();assert.equal(physical.unconfirmed(),true);assert.equal(worker.takeJobDrain(f.scope),null);
 }
});

test('a service physical veto after take burns the token before it can invoke or retry a consumer',async t=>{
 const f=await fixture(t);let held=false,calls=0;const assertServiceDrained=f.scope.assertJobDrained;
 f.scope.assertJobDrained=()=>{assertServiceDrained();if(held)throw Error('fixture_original_job_late_physical_hold');};
 const native=originalDrainDouble(f),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 await worker(f.scope);f.setJobDrained();const token=worker.takeJobDrain(f.scope);assert.ok(token);
 held=true;await assert.rejects(Promise.resolve().then(()=>worker.consumeJobDrain(token,f.scope,()=>{calls++;})),/late_physical_hold/);
 held=false;await assert.rejects(Promise.resolve().then(()=>worker.consumeJobDrain(token,f.scope,()=>{calls++;})));
 assert.equal(calls,0);assert.equal(worker.takeJobDrain(f.scope),null);
});

test('a physical veto in the consume microtask gap prevents the consumer and leaves its token burned',async t=>{
 const f=await fixture(t);let held=false,calls=0;const assertServiceDrained=f.scope.assertJobDrained;
 f.scope.assertJobDrained=()=>{assertServiceDrained();if(held)throw Error('fixture_original_job_microtask_physical_hold');};
 const native=originalDrainDouble(f),worker=createNativeCodingSetupMaterializer({...f.deps,executePlan:native.executePlan});
 await worker(f.scope);f.setJobDrained();const token=worker.takeJobDrain(f.scope);assert.ok(token);
 const pending=worker.consumeJobDrain(token,f.scope,()=>{calls++;return 'fixture_unexpected_consumer';});
 held=true;
 await assert.rejects(pending,/microtask_physical_hold/);assert.equal(calls,0);
 held=false;await assert.rejects(Promise.resolve().then(()=>worker.consumeJobDrain(token,f.scope,()=>{calls++;})));
 assert.equal(calls,0);assert.equal(worker.takeJobDrain(f.scope),null);
});

test('native facet qualification is captured at construction and cannot be added or replaced afterward',async t=>{
 const absent=await fixture(t);let forgedCalls=0;
 const executeWithoutFacet=(...args)=>absent.deps.executePlan(...args),unqualified=createNativeCodingSetupMaterializer({...absent.deps,executePlan:executeWithoutFacet});
 executeWithoutFacet.joinOriginalDrain=async()=>{forgedCalls++;};
 await unqualified(absent.scope);absent.setJobDrained();assert.equal(unqualified.takeJobDrain(absent.scope),null);assert.equal(forgedCalls,0);
 const original=await fixture(t),native=originalDrainDouble(original),captured=createNativeCodingSetupMaterializer({...original.deps,executePlan:native.executePlan});
 native.executePlan.joinOriginalDrain=async()=>{forgedCalls++;throw Error('fixture_replaced_native_facet');};
 await captured(original.scope);original.setJobDrained();assert.equal(native.joined.length,3);assert.ok(captured.takeJobDrain(original.scope));assert.equal(forgedCalls,0);
});
