// Controller observations are generated fixtures, NOT Windows qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createNativeManagedProjectGitExecutor} from '../src/managed-task-project-native-executor.mjs';
import {joinedSettlementFixture} from './fixtures/codex-cli-joined-settlement-fixture.mjs';
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{resolve,promise};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({beforeSpawn=async()=>{},badTerminal=false,output=Buffer.from('ok'),exitCode=0}={}){
 const root=path.join(os.tmpdir(),'native-git-fixture'),job={},abort=new AbortController(),calls=[];
 const plan={schema:'metaengine.devos.workspace-git-plan.v1',executable:'git',shell:false,cwd:root,workspace_id:randomUUID(),task_id:randomUUID(),lease_generation:1,
  effect:'WORKTREE_CREATE_LOCKED',expected_initial_head_sha:'a'.repeat(40)};
 plan.argv=['worktree','add','--lock','--reason',`METAENGINE:${plan.workspace_id}:task:${plan.task_id}:lease:1`,'-b','work/test',path.join(os.tmpdir(),'native-git-target'),plan.expected_initial_head_sha];
 const tools={gitExecutable:path.join(os.tmpdir(),'private','git.exe'),gitExecutableSha256:'b'.repeat(64),environment:{PATH:'private-only',GIT_SSL_CAINFO:'private-ca'},async revalidate(){calls.push('tools');}};
 let spec;
 const controller={async spawn(value){calls.push('spawn');spec=value;await beforeSpawn();const f=joinedSettlementFixture(value),stdout=new PassThrough(),stderr=new PassThrough(),done=gate();let ended=false;
  const end=(cancelled=false)=>{if(ended)return;ended=true;stdout.end(cancelled?Buffer.alloc(0):output);stderr.end();done.resolve(badTerminal?{exit_code:0,tree_cleanup_confirmed:true}:f.complete(cancelled?{exit_code:125,cancellation:{id:randomUUID()},reason:'CANCELLED'}:{exit_code:exitCode}));};
  return {proof:f.proof,stdout,stderr,completion:done.promise,async resume(){calls.push('resume');end();},async terminate(){calls.push('terminate');end(true);}};
 }};
 const executor=createNativeManagedProjectGitExecutor({privateTools:tools,processController:controller});
 const options={originalJob:job,signal:abort.signal,deadlineAt:Date.now()+30000,revalidateBeforeBirth:async()=>{calls.push('before-birth');},revalidateBeforeResume:async()=>{calls.push('before-resume');},assertOwnerCurrent:()=>{calls.push('owner');}};
 return{plan,job,abort,calls,tools,executor,options,get spec(){return spec;}};
}
test('native fixed Git executor uses original environment and joins only original result and job',async()=>{
 const f=fixture(),result=await f.executor.execute(f.plan,f.options);
 assert.equal(result.stdout,'ok');assert.equal(f.spec.executablePath,f.tools.gitExecutable);assert.equal(f.spec.env.GIT_SSL_CAINFO,'private-ca');
 assert.deepEqual(f.calls,['tools','before-birth','owner','spawn','tools','before-resume','owner','resume','tools']);
 await f.executor.execute.joinOriginalDrain(result,f.job);
 await assert.rejects(f.executor.execute.joinOriginalDrain({...result},f.job),/original_resource_required/);
 await assert.rejects(f.executor.execute.joinOriginalDrain(result,{}),/original_resource_required/);
 f.executor.close();await f.executor.drainResources();
});
test('close during original spawn fences resume and waits for original suspended child completion',async()=>{
 const ready=gate(),f=fixture({beforeSpawn:()=>ready.promise});let drained=false;
 const work=f.executor.execute(f.plan,f.options);await tick();assert(f.calls.includes('spawn'));
 f.executor.close();const drain=f.executor.drainResources().then(()=>{drained=true;});await tick();assert.equal(drained,false);
 ready.resolve();await assert.rejects(work,/cancelled/);await drain;assert.equal(f.calls.includes('resume'),false);assert.equal(f.calls.filter(x=>x==='terminate').length,1);
});
test('close during pending pre-birth verification cannot report drain or spawn early',async()=>{
 const waiting=gate(),f=fixture();f.options.revalidateBeforeBirth=()=>waiting.promise;
 const work=f.executor.execute(f.plan,f.options);await tick();f.executor.close();let done=false;const drain=f.executor.drainResources().then(()=>{done=true;});
 await tick();assert.equal(done,false);assert.equal(f.calls.includes('spawn'),false);waiting.resolve();await assert.rejects(work,/cancelled/);await drain;
});
test('revoked authority after child readiness cancels the original child without resume',async()=>{
 const f=fixture();f.options.revalidateBeforeResume=async()=>{throw Error('owner_lost');};
 let error;try{await f.executor.execute(f.plan,f.options);}catch(e){error=e;}
 assert.match(error.message,/owner_lost/);assert.equal(f.calls.includes('resume'),false);await f.executor.execute.joinOriginalDrain(error,f.job);
});
test('missing or fabricated native terminal remains HOLD even after request has left pending set',async()=>{
 const f=fixture({badTerminal:true});let error;try{await f.executor.execute(f.plan,f.options);}catch(e){error=e;}
 assert(error);await assert.rejects(f.executor.execute.joinOriginalDrain(error,f.job),/join_unconfirmed/);
 f.executor.close();await assert.rejects(f.executor.drainResources(),/join_unconfirmed/);
});
test('asynchronous Owner veto never reaches native birth',async()=>{
 const f=fixture();f.options.assertOwnerCurrent=async()=>{};
 await assert.rejects(f.executor.execute(f.plan,f.options),/not_synchronous/);assert.equal(f.calls.includes('spawn'),false);
});
test('changed private executable digest never falls back to ambient Git',async()=>{
 const f=fixture();f.tools.gitExecutableSha256='c'.repeat(64);
 await assert.rejects(f.executor.execute(f.plan,f.options),/tools_changed/);assert.equal(f.calls.includes('spawn'),false);
});
test('nonzero Git and invalid UTF8 reject while retaining original cleanup join',async()=>{
 for(const config of [{exitCode:1},{output:Buffer.from([0xff])}]){
  const f=fixture(config);let error;try{await f.executor.execute(f.plan,f.options);}catch(e){error=e;}
  assert(error);await f.executor.execute.joinOriginalDrain(error,f.job);
 }
});
test('output overflow cancels and drains without retaining unlimited bytes',async()=>{
 const f=fixture({output:Buffer.alloc(8*1024*1024+1)});let error;try{await f.executor.execute(f.plan,f.options);}catch(e){error=e;}
 assert(error);assert(f.calls.includes('terminate'));await f.executor.execute.joinOriginalDrain(error,f.job);
});
