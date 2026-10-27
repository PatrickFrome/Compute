import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {createCheckpointReconciliationFixture} from './test/native-coding-checkpoint-reconciliation-fixture.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const childFile=fileURLToPath(new URL('./test/native-coding-checkpoint-reconciliation-child.mjs',import.meta.url));
const baseline=process.env.METAENGINE_RECONCILIATION_BASELINE==='1';
const baseModules=baseline?{serviceModule:process.env.METAENGINE_RECONCILIATION_BASE_SERVICE,
  observerModule:process.env.METAENGINE_RECONCILIATION_BASE_OBSERVER}:{};

async function child(f,options={}){
  const process=fork(childFile,[f.seedPath,JSON.stringify({...baseModules,...options})],{stdio:['ignore','ignore','pipe','ipc']});
  return new Promise((resolve,reject)=>{
    let result=null,barrier=null,stderr='';
    const timer=setTimeout(()=>{process.kill('SIGKILL');reject(Error('disposable_reconciliation_child_timeout'));},30000);
    process.stderr.on('data',bytes=>{stderr+=bytes.toString();});
    process.on('error',error=>{clearTimeout(timer);reject(error);});
    process.on('message',message=>{
      if(message.type==='BARRIER'){barrier=message;process.kill('SIGKILL');}
      else result=message;
    });
    process.on('exit',(code,signal)=>{
      clearTimeout(timer);
      if(barrier){assert.equal(signal,'SIGKILL');resolve(barrier);}
      else if(result)resolve({...result,code});
      else reject(Error('disposable_child_missing_result:'+code+':'+signal+':'+stderr.slice(0,1000)));
    });
  });
}
async function absent(file){await assert.rejects(fs.stat(file),error=>error.code==='ENOENT');}
async function counts(f){const events=await f.events();return Object.fromEntries(['GIT_UPDATE_REF','SQL_DISPATCH','SQL_COMMITTED','OBSERVER_FINISH','OBSERVER_RECONCILE']
  .map(kind=>[kind,events.filter(event=>event.kind===kind).length]));}
async function noAdditionalGitWrites(f){
  assert.equal((await f.events()).filter(event=>event.kind==='GIT_WRITE_COMMAND').length,f.initialGitWriteCount);
}
const anchor=f=>path.join(f.stateDirectory,'native-coding-checkpoint-reconciliation-'+f.query.checkpoint_sha256+'.json');
async function files(root){
  const rows=[];
  async function walk(directory){
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const target=path.join(directory,entry.name),name=path.relative(root,target);
      if(entry.isDirectory()){rows.push([name,'DIRECTORY']);await walk(target);}
      else rows.push([name,hash(await fs.readFile(target))]);
    }
  }
  await walk(root);return rows;
}
async function race(f,{operation='RECONCILE_FINISH_CHECKPOINT',operations=null}={}){
  return new Promise((resolve,reject)=>{
    const children=[],answers=[],ready=new Set();let exits=0;
    const timer=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');reject(Error('reconciliation_intent_race_timeout'));},30000);
    for(let index=0;index<2;index++){
      const worker=fork(childFile,[f.seedPath,JSON.stringify({operation:operations?.[index]||operation,phase:'INTENT_RACE'})],{stdio:['ignore','ignore','ignore','ipc']});children.push(worker);
      worker.on('error',error=>{clearTimeout(timer);for(const other of children)other.kill('SIGKILL');reject(error);});
      worker.on('message',message=>{
        if(message.type==='BARRIER'){ready.add(index);if(ready.size===2)for(const other of children)other.send({continue:true});}
        else answers[index]=message;
      });
      worker.on('exit',()=>{if(++exits===2){clearTimeout(timer);resolve(answers);}});
    }
  });
}
async function crashAfterGit(f){
  const killed=await child(f,{phase:'AFTER_GIT_BEFORE_INTENT'});assert.equal(killed.phase,'AFTER_GIT_BEFORE_INTENT',JSON.stringify(killed));
  await absent(f.sqlIntent);assert.equal(await f.readStore(),null);
  const receipt=JSON.parse(await fs.readFile(path.join(f.gitJournal,'completed.json'),'utf8'));
  assert.equal(receipt.state,'COMMITTED');assert.notEqual(receipt.head,f.proof.head);
  assert.equal(await f.git(['rev-parse','--verify',f.operator.bindings[0].branch_ref]),receipt.head);
  assert.equal(await f.git(['rev-parse',receipt.head+'^{tree}']),receipt.tree);
  assert.equal(await f.git(['status','--porcelain']),'');assert.equal(await f.git(['rev-list','--count','HEAD']),'2');
  const plan=JSON.parse(await fs.readFile(path.join(f.gitJournal,'plan.json'),'utf8'));
  assert.equal(hash(await fs.readFile(path.join(f.gitDir,'index'))),plan.index_sha256);
  assert.deepEqual(await counts(f),{GIT_UPDATE_REF:1,SQL_DISPATCH:0,SQL_COMMITTED:0,OBSERVER_FINISH:0,OBSERVER_RECONCILE:0});
  f.initialGitWriteCount=(await f.events()).filter(event=>event.kind==='GIT_WRITE_COMMAND').length;
  return receipt;
}

test('BASE reproduction: killed child after durable Git receipt leaves COMMITTED/PENDING and observer HOLD',{skip:!baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t),receipt=await crashAfterGit(f);
  const read=await child(f,{operation:'READ_FINISH_CHECKPOINT'});
  assert.equal(read.type,'RESULT');assert.equal(read.value.state,'PENDING_COMMIT');assert.equal(read.value.git_readback.state,'COMMITTED');
  const observed=await child(f,{operation:'OBSERVER'});assert.equal(observed.type,'RESULT');
  assert.equal(observed.value.readback_required,1);assert.equal(observed.value.committed,0);
  assert.deepEqual(await counts(f),{GIT_UPDATE_REF:1,SQL_DISPATCH:0,SQL_COMMITTED:0,OBSERVER_FINISH:0,OBSERVER_RECONCILE:0});
  t.diagnostic(JSON.stringify({source:'BASE_SHA:9d7527683060e314eb1d39fec9ce2304a57103c4',
    proof:'REAL_GIT_AND_KILLED_CHILD_COMPONENT_FIXTURE',checkpoint_sha256:f.query.checkpoint_sha256,
    previous_head:receipt.previous_head,head:receipt.head,tree:receipt.tree,index_sha256:hash(await fs.readFile(path.join(f.gitDir,'index'))),
    outcome:'SAFE_HOLD_REPRODUCED',counts:await counts(f),native_pg17:false,windows_installed:false}));
});

test('initial READ is physically read-only and never creates journal directories or an anchor',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t),before=await files(f.stateDirectory);
  await absent(f.operator.journal_root);await absent(anchor(f));
  const result=await child(f,{operation:'READ_FINISH_CHECKPOINT'});assert.equal(result.type,'RESULT',result.message);
  assert.equal(result.value.state,'PENDING_COMMIT');assert.equal(result.value.git_readback.state,'NOT_ATTEMPTED');
  assert.deepEqual(await files(f.stateDirectory),before);await absent(f.operator.journal_root);await absent(anchor(f));
  assert.deepEqual(await counts(f),{GIT_UPDATE_REF:0,SQL_DISPATCH:0,SQL_COMMITTED:0,OBSERVER_FINISH:0,OBSERVER_RECONCILE:0});
});

test('READ remains eligible after worktree mtime-only change and preserves the exact live index',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t);await crashAfterGit(f);
  const index=path.join(f.gitDir,'index'),before=await fs.readFile(index),journal=await files(f.operator.journal_root);
  const file=path.join(f.root,'review.txt'),bytes=await fs.readFile(file),changed=new Date(Date.now()+2000);
  await fs.utimes(file,changed,changed);assert.deepEqual(await fs.readFile(file),bytes);
  const result=await child(f,{operation:'READ_FINISH_CHECKPOINT',traceGit:true});assert.equal(result.type,'RESULT',JSON.stringify(result));
  assert.equal(result.value.state,'GIT_COMMITTED_SQL_NOT_ATTEMPTED');assert.deepEqual(await fs.readFile(index),before);
  assert.deepEqual(await files(f.operator.journal_root),journal);await absent(f.sqlIntent);
  assert.equal((await counts(f)).SQL_DISPATCH,0);await noAdditionalGitWrites(f);
});

test('committed Git crash permits exactly one first SQL finalization and one fixture successor across two restarts',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t);f.seed.wantSuccessor=true;await f.saveSeed();
  const receipt=await crashAfterGit(f),before=await files(f.operator.journal_root),originalAnchor=await fs.readFile(anchor(f));
  const read=await child(f,{operation:'READ_FINISH_CHECKPOINT'});assert.equal(read.type,'RESULT',read.message);
  assert.equal(read.value.state,'GIT_COMMITTED_SQL_NOT_ATTEMPTED');assert.equal(read.value.git_readback.head,receipt.head);
  const proof=read.value.reconciliation;assert.equal(proof.schema,'metaengine.native-coding.checkpoint-reconciliation.v1');
  assert.equal(proof.operation,'RECONCILE_FINISH_CHECKPOINT');assert.equal(proof.git_receipt_sha256,sha(receipt));
  assert.equal(proof.sql_intent_state,'ABSENT');assert.equal(proof.sql_commit_state,'ABSENT');
  assert.equal(proof.observation_only,true);assert.equal(proof.git_effect_allowed,false);assert.equal(proof.sql_retry_allowed,false);
  for(const [key,value] of Object.entries(f.selector))assert.equal(proof[key],value);
  assert.deepEqual(await files(f.operator.journal_root),before);assert.deepEqual(await fs.readFile(anchor(f)),originalAnchor);
  const recovered=await child(f,{operation:'OBSERVER'});assert.equal(recovered.type,'RESULT',recovered.message);assert.equal(recovered.value.committed,1);
  assert.equal(recovered.value.successors_observed,1);assert.equal(recovered.value.readback_required,0);
  const committed=await f.readStore();assert.equal(committed.state,'SUCCESSOR_ADMITTED');assert.equal(committed.receipt.head,receipt.head);
  for(const operation of ['READ_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','FINISH_CHECKPOINT','OBSERVER','OBSERVER']){
    const repeat=await child(f,{operation});assert.equal(repeat.type,'RESULT');
    if(operation!=='OBSERVER')assert.equal(repeat.value.commit.head,receipt.head);
  }
  assert.equal(await f.git(['rev-parse','HEAD']),receipt.head);
  const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,1);assert.equal(events.SQL_COMMITTED,1);
  assert.equal(events.OBSERVER_FINISH,0);assert.equal(events.OBSERVER_RECONCILE,1);
  assert.equal((await f.events()).filter(event=>event.kind==='SQL_COMMITTED'&&event.successor_task_id!==null).length,1);
  await noAdditionalGitWrites(f);
});

test('durable SQL intent followed by a killed child before SQL stays HOLD with zero SQL dispatches',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t);await crashAfterGit(f);
  const killed=await child(f,{operation:'RECONCILE_FINISH_CHECKPOINT',phase:'AFTER_INTENT_BEFORE_SQL'});
  assert.equal(killed.type,'BARRIER');assert.equal(killed.phase,'AFTER_INTENT_BEFORE_SQL');
  assert.ok(JSON.parse(await fs.readFile(f.sqlIntent,'utf8')));assert.equal(await f.readStore(),null);
  for(const operation of ['READ_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','FINISH_CHECKPOINT','OBSERVER']){
    const result=await child(f,{operation});assert.equal(result.type,'RESULT');
    if(operation==='OBSERVER')assert.equal(result.value.readback_required,1);else assert.equal(result.value.state,'SQL_FINALIZE_UNKNOWN');
  }
  const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,0);assert.equal(events.SQL_COMMITTED,0);
  await noAdditionalGitWrites(f);
});

test('committed SQL before killed/lost ACK recovers authoritative receipt without another SQL or Git effect',{skip:baseline,timeout:90000},async t=>{
  for(const mode of ['killed','lost'])await t.test(mode,async t=>{
    const f=await createCheckpointReconciliationFixture(t);await crashAfterGit(f);
    const result=await child(f,{operation:'RECONCILE_FINISH_CHECKPOINT',...(mode==='killed'?{phase:'AFTER_SQL_BEFORE_ACK'}:{ack:'lost'})});
    assert.equal(result.type,mode==='killed'?'BARRIER':'RESULT');assert.equal((await f.readStore()).state,'COMMITTED_NO_SUCCESSOR');
    for(const operation of ['READ_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','OBSERVER'])assert.equal((await child(f,{operation})).type,'RESULT');
    const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,1);assert.equal(events.SQL_COMMITTED,1);
    await noAdditionalGitWrites(f);
  });
});

test('two real observer processes racing exclusive SQL intent dispatch only one SQL finalization',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t);await crashAfterGit(f);
  const replies=await race(f,{operation:'OBSERVER'});assert.equal(replies.length,2);
  assert.ok(replies.every(reply=>reply?.type==='RESULT'));assert.ok(replies.some(reply=>reply.value.committed===1));
  for(let restart=0;restart<2;restart++)assert.equal((await child(f,{operation:'OBSERVER'})).value.committed,1);
  const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,1);assert.equal(events.SQL_COMMITTED,1);
  await noAdditionalGitWrites(f);
});

test('ordinary FINISH after completed Git uses the same SQL-only boundary and never repeats a Git write command',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t),receipt=await crashAfterGit(f);
  const result=await child(f,{operation:'FINISH_CHECKPOINT'});assert.equal(result.type,'RESULT',result.message);
  assert.equal(result.value.state,'COMMITTED_NO_SUCCESSOR');assert.equal(result.value.commit.head,receipt.head);
  const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,1);assert.equal(events.SQL_COMMITTED,1);
  await noAdditionalGitWrites(f);
});

test('ordinary FINISH and explicit RECONCILE racing in two Hosts share one first-SQL claim',{skip:baseline,timeout:90000},async t=>{
  const f=await createCheckpointReconciliationFixture(t);await crashAfterGit(f);
  const replies=await race(f,{operations:['FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT']});assert.equal(replies.length,2);
  assert.ok(replies.every(reply=>reply?.type==='RESULT'));assert.ok(replies.some(reply=>reply.value.state==='COMMITTED_NO_SUCCESSOR'));
  const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,1);assert.equal(events.SQL_COMMITTED,1);
  await noAdditionalGitWrites(f);
});

// Each of the 25 controls creates a fresh Git fixture and several child processes.
// Bound the serial group separately from each control; child I/O retains its 30s cap.
test('unknown SQL intent, missing/replaced journals and changed physical/authority pins preserve HOLD',{skip:baseline,timeout:600000},async t=>{
  const changes=[
    ['falsy null intent',f=>fs.writeFile(f.sqlIntent,'null')],
    ['falsy false intent',f=>fs.writeFile(f.sqlIntent,'false')],
    ['falsy zero intent',f=>fs.writeFile(f.sqlIntent,'0')],
    ['malformed intent',f=>fs.writeFile(f.sqlIntent,'{')],
    ['unknown intent schema',f=>fs.writeFile(f.sqlIntent,'{"schema":"unknown"}')],
    ['missing anchor',f=>fs.unlink(anchor(f))],
    ['missing SQL checkpoint journal',f=>fs.rm(path.dirname(f.sqlIntent),{recursive:true})],
    ['replaced SQL checkpoint journal',async f=>{const directory=path.dirname(f.sqlIntent);await fs.rename(directory,directory+'.old');await fs.mkdir(directory);}],
    ['missing SQL journal root',f=>fs.rm(path.dirname(path.dirname(f.sqlIntent)),{recursive:true})],
    ['changed ref',async(f,r)=>f.git(['update-ref',f.operator.bindings[0].branch_ref,r.previous_head])],
    ['foreign ref',async(f,r)=>{await f.git(['update-ref','refs/heads/foreign',r.head]);await f.git(['symbolic-ref','HEAD','refs/heads/foreign']);}],
    ['changed clean index bytes',async f=>{const file=path.join(f.gitDir,'index'),before=hash(await fs.readFile(file)),changed=new Date(Date.now()+2000);
      await fs.utimes(path.join(f.root,'review.txt'),changed,changed);await f.git(['update-index','--refresh']);
      assert.notEqual(hash(await fs.readFile(file)),before);assert.equal(await f.git(['status','--porcelain']),'');}],
    ['changed worktree bytes',f=>fs.writeFile(path.join(f.root,'review.txt'),'unreviewed changed bytes\n')],
    ['changed commit object bytes',async(f,r)=>{const file=path.join(f.commonDir,'objects',r.head.slice(0,2),r.head.slice(2));
      await fs.chmod(file,0o600);await fs.writeFile(file,'corrupt generated object');}],
    ['changed reviewed Git blob bytes',async(f,r)=>{const oid=await f.git(['rev-parse',r.head+':review.txt']);
      const file=path.join(f.commonDir,'objects',oid.slice(0,2),oid.slice(2)),bytes=Buffer.from('forged reviewed generated blob\n');
      await fs.chmod(file,0o600);await fs.writeFile(file,deflateSync(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])));}],
    ['changed protected Git receipt',async f=>{const file=path.join(f.gitJournal,'completed.json'),value=JSON.parse(await fs.readFile(file,'utf8'));
      value.tree='a'.repeat(40);await fs.writeFile(file,JSON.stringify(value));}],
    ['changed checkpoint canonical',async f=>{f.seed.record.canonical_checkpoint+=' ';await f.saveSeed();}],
    ['changed operator generation',async f=>{f.seed.operator.generation++;await fs.writeFile(f.operatorFile,JSON.stringify(f.seed.operator));}],
    ['changed current Host owner',async f=>{f.seed.nativeOverrides={user_sid:'foreign-generated-sid'};await f.saveSeed();}],
    ['missing current Host proof',async f=>{f.seed.nativeOverrides={host_process:null};await f.saveSeed();}],
    ['changed current artifact',async f=>{f.seed.nativeOverrides={artifact:{...f.seed.artifact,installed_asar_sha256:'f'.repeat(64)}};await f.saveSeed();}],
    ['changed workspace identity',async f=>{f.seed.nativeOverrides={worktree:{...f.seed.worktree,root_identity_sha256:'f'.repeat(64)}};await f.saveSeed();}],
    ['unknown SQL read outcome',async f=>{f.seed.sqlReadError=true;await f.saveSeed();}],
    ['mismatched SQL receipt',async(f,r)=>{await fs.writeFile(f.storeFile,JSON.stringify({schema:'metaengine.native-coding.commit-checkpoint.v1',
      project_id:f.query.project_id,checkpoint_id:f.checkpoint.checkpoint_id,checkpoint_sha256:f.query.checkpoint_sha256,receipt:{...r,checkpoint_sha256:'f'.repeat(64)}}));}],
    ['conflicting successor receipt',async(f,r)=>{await fs.writeFile(f.storeFile,JSON.stringify({schema:'metaengine.native-coding.commit-checkpoint.v1',
      project_id:f.query.project_id,checkpoint_id:f.checkpoint.checkpoint_id,checkpoint_sha256:f.query.checkpoint_sha256,state:'SUCCESSOR_ADMITTED',
      receipt:r,canonical_receipt:json(r),commit_receipt_sha256:sha(r),previous_head:r.previous_head,head:r.head,tree:r.tree,
      next_writer_permit_id:'bbbb1111-2222-4333-8444-555555555555',next_critic_permit_id:'cccc1111-2222-4333-8444-555555555555',
      successor_task_id:null,successor_admitted:true,root_fence_released:true,production_qualified:false,automatic_retry_allowed:false,authority_effect:false}));}],
  ];
  for(const [name,change] of changes)await t.test(name,{timeout:90000},async t=>{
    const f=await createCheckpointReconciliationFixture(t),receipt=await crashAfterGit(f);await change(f,receipt);
    const read=await child(f,{operation:'READ_FINISH_CHECKPOINT'});
    assert.ok(read.type==='ERROR'||read.value.state!=='GIT_COMMITTED_SQL_NOT_ATTEMPTED');
    const observed=await child(f,{operation:'OBSERVER'});
    if(observed.type==='RESULT')assert.equal(observed.value.readback_required,1);else assert.equal(observed.type,'ERROR');
    const direct=await child(f,{operation:'RECONCILE_FINISH_CHECKPOINT'});assert.ok(direct.type==='ERROR'||!['SUCCESSOR_ADMITTED','COMMITTED_NO_SUCCESSOR'].includes(direct.value.state));
    const events=await counts(f);assert.equal(events.GIT_UPDATE_REF,1);assert.equal(events.SQL_DISPATCH,0);assert.equal(events.SQL_COMMITTED,0);
    await noAdditionalGitWrites(f);
  });
});
