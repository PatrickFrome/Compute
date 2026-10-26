import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCheckpointReconciliationPgFixture} from './test/native-coding-checkpoint-reconciliation-pg-fixture.mjs';
import {nativeCodingCanonicalJson as canonical,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const required=process.env.METAENGINE_REQUIRE_RECONCILIATION_PG17==='1';
const childFile=fileURLToPath(new URL('./test/native-coding-checkpoint-reconciliation-pg-child.mjs',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Every Host call below runs in a NEW child with its own native PG connection.
// Only the exact owned child is killed. No existing Owner/PGDATA is accepted.
async function child(f,options={}){
  const worker=fork(childFile,[f.seedPath,JSON.stringify(options)],{stdio:['ignore','ignore','pipe','ipc']});
  return new Promise((resolve,reject)=>{
    let result=null,barrier=null,stderr='';
    const timer=setTimeout(()=>{worker.kill('SIGKILL');reject(Error('native_reconciliation_child_timeout'));},40000);
    worker.stderr.on('data',bytes=>{if(stderr.length<4096)stderr+=bytes.toString();});
    worker.on('error',error=>{clearTimeout(timer);reject(error);});
    worker.on('message',message=>{
      if(message.type==='BARRIER'){barrier=message;worker.kill('SIGKILL');}else result=message;
    });
    worker.on('exit',(code,signal)=>{
      clearTimeout(timer);
      if(barrier){assert.equal(signal,'SIGKILL');resolve(barrier);}
      else if(result)resolve({...result,code});
      else reject(Error('native_reconciliation_child_missing_result:'+code+':'+signal+':'+stderr));
    });
  });
}
async function race(f,operations=['RECONCILE_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT']){
  return new Promise((resolve,reject)=>{
    const children=[],answers=[],ready=new Set();let exits=0;
    const stop=error=>{for(const worker of children)worker.kill('SIGKILL');reject(error);};
    const timer=setTimeout(()=>stop(Error('native_reconciliation_intent_race_timeout')),40000);
    for(let index=0;index<2;index++){
      const worker=fork(childFile,[f.seedPath,JSON.stringify({operation:operations[index],phase:'INTENT_RACE'})],
        {stdio:['ignore','ignore','ignore','ipc']});children.push(worker);
      worker.on('error',error=>{clearTimeout(timer);stop(error);});
      worker.on('message',message=>{
        if(message.type==='BARRIER'){ready.add(index);if(ready.size===2)for(const other of children)other.send({continue:true});}
        else answers[index]=message;
      });
      worker.on('exit',()=>{if(++exits===2){clearTimeout(timer);resolve(answers);}});
    }
  });
}
async function events(f){
  let bytes;try{bytes=await fs.readFile(f.eventFile,'utf8');}catch(error){if(error.code==='ENOENT')return[];throw error;}
  return bytes.trim().split('\n').filter(Boolean).map(JSON.parse);
}
async function counts(f){
  const rows=await events(f);return Object.fromEntries(['GIT_UPDATE_REF','SQL_DISPATCH','SQL_COMMITTED','OBSERVER_FINISH','OBSERVER_RECONCILE']
    .map(kind=>[kind,rows.filter(row=>row.kind===kind).length]));
}
async function assertNoGitWrites(f){
  assert.ok(Number.isSafeInteger(f.initialGitWriteCount)&&f.initialGitWriteCount>0,'initial_real_git_writes_observed');
  assert.equal((await events(f)).filter(row=>row.kind==='GIT_WRITE_COMMAND').length,f.initialGitWriteCount,
    'restart/reconciliation must issue no Git write command');
}
async function absent(file){await assert.rejects(fs.lstat(file),error=>error.code==='ENOENT');}
async function journalFiles(root){
  const rows=[];
  async function walk(directory){for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(directory,entry.name),relative=path.relative(root,file);
    if(entry.isDirectory()){rows.push([relative,'DIRECTORY']);await walk(file);}else rows.push([relative,hash(await fs.readFile(file))]);
  }}
  await walk(root);return rows;
}
const value=result=>{assert.equal(result.type,'RESULT',result.message);return result.value;};
async function readCommit(pg,f){
  const [row]=await pg.sql.unsafe('select destruktion_meta.native_coding_read_commit_v1($1::uuid) as value',[f.k.checkpoint_id]);return row.value;
}
async function nativeCounts(pg,f){
  const [row]=await pg.sql.unsafe(`select
    (select count(*)::int from destruktion_meta.native_coding_commit_h205f22 where checkpoint_id=$1) as commits,
    (select count(*)::int from destruktion_meta.devos_fleet_task_h205f22 where workspace_id=$2 and idempotency_key=$3) as successor_tasks,
    (select count(*)::int from destruktion_meta.project_event_h205f22 where project_id=$4 and event_type='NATIVE_COMMIT_RECORDED') as commit_events,
    (select count(*)::int from destruktion_meta.project_event_h205f22 where project_id=$4 and event_type='NATIVE_SUCCESSOR_TASK_ADMITTED') as successor_events`,
    [f.k.checkpoint_id,f.k.workspace_id,'native-successor:'+f.k.checkpoint_id,f.k.project_id]);return row;
}
async function crashAfterGit(pg,f){
  const killed=await child(f,{phase:'AFTER_GIT_BEFORE_INTENT'});assert.equal(killed.phase,'AFTER_GIT_BEFORE_INTENT');
  await absent(f.sqlIntent);assert.equal(await readCommit(pg,f),null);
  const receipt=JSON.parse(await fs.readFile(path.join(f.gitJournal,'completed.json'),'utf8'));
  assert.equal(receipt.state,'COMMITTED');assert.notEqual(receipt.head,f.k.source_head);
  assert.equal((await f.physical.git(['rev-parse','--verify','refs/heads/managed-checkpoint'])).trim(),receipt.head);
  assert.equal((await f.physical.git(['rev-parse',receipt.head+'^{tree}'])).trim(),receipt.tree);
  assert.equal((await f.physical.git(['status','--porcelain'])).trim(),'');
  const plan=JSON.parse(await fs.readFile(path.join(f.gitJournal,'plan.json'),'utf8'));
  assert.equal(hash(await fs.readFile(path.join(f.physical.gitDir,'index'))),plan.index_sha256);
  assert.deepEqual(await counts(f),{GIT_UPDATE_REF:1,SQL_DISPATCH:0,SQL_COMMITTED:0,OBSERVER_FINISH:0,OBSERVER_RECONCILE:0});
  assert.deepEqual(await nativeCounts(pg,f),{commits:0,successor_tasks:0,commit_events:0,successor_events:0});
  f.initialGitWriteCount=(await events(f)).filter(row=>row.kind==='GIT_WRITE_COMMAND').length;
  assert.ok(f.initialGitWriteCount>0);
  return receipt;
}
async function assertNoReplay(pg,f,{dispatches=1,commits=1,successors=1}={}){
  await assertNoGitWrites(f);
  const observed=await counts(f);assert.equal(observed.GIT_UPDATE_REF,1);assert.equal(observed.SQL_DISPATCH,dispatches);
  assert.equal(observed.SQL_COMMITTED,commits);
  assert.deepEqual(await nativeCounts(pg,f),{commits,successor_tasks:successors,commit_events:commits,successor_events:commits?successors:0});
  assert.equal((await f.physical.git(['rev-list','--count','HEAD'])).trim(),'2');
}

test('native PG17 checkpoint reconciliation: real crash intervals, concurrent first finalize, ACK loss and negative controls',{
  skip:!required&&(!bin||!driver)?'NATIVE_DISPOSABLE_PG17_NOT_CONFIGURED':false,timeout:240000,
},async t=>{
  assert.ok(bin&&driver,'required_native_pg17_inputs_missing');
  const pg=await createCheckpointReconciliationPgFixture(t,{bin,driver}),proof=[];
  async function subtest(name,run){await t.test(name,async sub=>{const observation=await run(sub);proof.push({name,...observation,state:'PASS'});});}

  await subtest('killed Git-complete child resumes through observer once, repeated selector and second restart are read-only',async t=>{
    const f=await pg.ready(t),receipt=await crashAfterGit(pg,f);
    const before=await journalFiles(f.physical.journalRoot);
    const eligible=value(await child(f,{operation:'READ_FINISH_CHECKPOINT'}));
    assert.equal(eligible.state,'GIT_COMMITTED_SQL_NOT_ATTEMPTED');
    assert.equal(eligible.reconciliation.schema,'metaengine.native-coding.checkpoint-reconciliation.v1');
    assert.equal(eligible.reconciliation.sql_intent_state,'ABSENT');assert.equal(eligible.reconciliation.sql_commit_state,'ABSENT');
    assert.equal(eligible.reconciliation.observation_only,true);assert.equal(eligible.git_readback.head,receipt.head);
    assert.deepEqual(await journalFiles(f.physical.journalRoot),before);
    const resumed=value(await child(f,{operation:'OBSERVER'}));assert.equal(resumed.successors_observed,1);assert.equal(resumed.readback_required,0);
    const committed=await readCommit(pg,f);assert.equal(committed.state,'SUCCESSOR_ADMITTED');assert.equal(committed.receipt.head,receipt.head);
    for(const operation of ['OBSERVER','READ_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','FINISH_CHECKPOINT','OBSERVER']){
      const repeated=value(await child(f,{operation}));
      if(operation==='OBSERVER')assert.equal(repeated.successors_observed,1);else assert.equal(repeated.commit.successor_task_id,committed.successor_task_id);
    }
    assert.equal((await f.physical.git(['rev-parse','HEAD'])).trim(),receipt.head);await assertNoReplay(pg,f);
    assert.equal((await counts(f)).OBSERVER_FINISH,0);assert.equal((await counts(f)).OBSERVER_RECONCILE,1);
    return {checkpoint_sha256:f.query.checkpoint_sha256,head:receipt.head,tree:receipt.tree,successor_task_id:committed.successor_task_id,
      effects:await counts(f),sql_rows:await nativeCounts(pg,f)};
  });

  await subtest('two independent Host processes race at exclusive intent creation and invoke native SQL once',async t=>{
    const f=await pg.ready(t);await crashAfterGit(pg,f);
    const answers=await race(f);assert.equal(answers.length,2);
    assert.ok(answers.some(answer=>answer?.type==='RESULT'&&answer.value.state==='SUCCESSOR_ADMITTED'),JSON.stringify(answers));
    const observed=value(await child(f,{operation:'READ_FINISH_CHECKPOINT'}));assert.equal(observed.state,'SUCCESSOR_ADMITTED');
    await assertNoReplay(pg,f);
    return {effects:await counts(f),sql_rows:await nativeCounts(pg,f)};
  });

  await subtest('ordinary FINISH and RECONCILE race in separate Hosts without Git writes and finalize SQL once',async t=>{
    const f=await pg.ready(t);await crashAfterGit(pg,f);
    const answers=await race(f,['FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT']);assert.equal(answers.length,2);
    assert.ok(answers.some(answer=>answer?.type==='RESULT'&&answer.value.state==='SUCCESSOR_ADMITTED'),JSON.stringify(answers));
    const confirmed=value(await child(f,{operation:'READ_FINISH_CHECKPOINT'}));assert.equal(confirmed.state,'SUCCESSOR_ADMITTED');
    await assertNoReplay(pg,f);
    return {effects:await counts(f),sql_rows:await nativeCounts(pg,f),post_crash_git_write_commands:0};
  });

  await subtest('killed child after synced intent but before SQL remains HOLD across fresh Hosts',async t=>{
    const f=await pg.ready(t);await crashAfterGit(pg,f);
    const killed=await child(f,{operation:'RECONCILE_FINISH_CHECKPOINT',phase:'AFTER_INTENT_BEFORE_SQL'});
    assert.equal(killed.phase,'AFTER_INTENT_BEFORE_SQL');assert.ok(JSON.parse(await fs.readFile(f.sqlIntent,'utf8')));
    assert.equal(await readCommit(pg,f),null);
    for(const operation of ['READ_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','FINISH_CHECKPOINT','OBSERVER']){
      const result=value(await child(f,{operation}));
      if(operation==='OBSERVER')assert.equal(result.readback_required,1);else assert.equal(result.state,'SQL_FINALIZE_UNKNOWN');
    }
    await assertNoReplay(pg,f,{dispatches:0,commits:0,successors:0});
    return {effects:await counts(f),sql_rows:await nativeCounts(pg,f)};
  });

  for(const ack of ['killed','lost'])await subtest('real PostgreSQL COMMIT followed by '+ack+' ACK is recovered without another SQL invocation',async t=>{
    const f=await pg.ready(t);await crashAfterGit(pg,f);
    const result=await child(f,{operation:'RECONCILE_FINISH_CHECKPOINT',...(ack==='killed'?{phase:'AFTER_SQL_BEFORE_ACK'}:{ack:'lost'})});
    if(ack==='killed')assert.equal(result.phase,'AFTER_SQL_BEFORE_ACK');else assert.equal(value(result).state,'SUCCESSOR_ADMITTED');
    const committed=await readCommit(pg,f);assert.equal(committed.state,'SUCCESSOR_ADMITTED');
    for(const operation of ['OBSERVER','RECONCILE_FINISH_CHECKPOINT','FINISH_CHECKPOINT','READ_FINISH_CHECKPOINT']){
      const recovered=value(await child(f,{operation}));
      if(operation==='OBSERVER')assert.equal(recovered.successors_observed,1);else assert.equal(recovered.commit.successor_task_id,committed.successor_task_id);
    }
    await assertNoReplay(pg,f);return {effects:await counts(f),sql_rows:await nativeCounts(pg,f)};
  });

  await subtest('mismatched authoritative SQL receipt stays HOLD with no Host SQL or Git replay',async t=>{
    const f=await pg.ready(t),receipt=await crashAfterGit(pg,f);
    // Deliberately corrupt a GENERATED negative-control row using actual PG
    // constraints; no successful receipt is fabricated or counted as a Host effect.
    const mismatched={...receipt,checkpoint_sha256:'0'.repeat(64)};
    await pg.sql.unsafe(`insert into destruktion_meta.native_coding_commit_h205f22
      (checkpoint_id,workspace_id,project_id,root_identity_sha256,previous_head,head,tree,receipt,canonical_receipt,receipt_sha256,
       next_writer_permit_id,next_critic_permit_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [f.k.checkpoint_id,f.k.workspace_id,f.k.project_id,f.k.root_identity_sha256,receipt.previous_head,receipt.head,receipt.tree,
        pg.sql.json(mismatched),canonical(mismatched),sha(mismatched),f.f.writer.permit_id,f.f.critic.permit_id]);
    for(const operation of ['READ_FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','FINISH_CHECKPOINT']){
      const result=await child(f,{operation});assert.equal(result.type,'ERROR');assert.match(result.message,/git_receipt_unverified/);
    }
    assert.equal(value(await child(f,{operation:'OBSERVER'})).readback_required,1);
    await assertNoGitWrites(f);
    const observed=await counts(f);assert.equal(observed.GIT_UPDATE_REF,1);assert.equal(observed.SQL_DISPATCH,0);assert.equal(observed.SQL_COMMITTED,0);
    await absent(f.sqlIntent);assert.equal((await nativeCounts(pg,f)).successor_tasks,0);
    return {effects:observed,negative_fixture_rows:1,host_sql_commits:0};
  });

  await subtest('conflicting existing successor rolls back the first SQL transaction and permanently fences its retry',async t=>{
    const f=await pg.ready(t);await crashAfterGit(pg,f);
    const spec={schema:'metaengine.devos.project-task-spec.v1',objective:'Generated conflicting successor negative control',claim_class:'MUTATING',
      native_coding:{permit_id:f.f.writer.permit_id,goal_id:f.k.goal_id,goal_sha256:f.k.goal_sha256,project_id:f.k.project_id}};
    const [enqueued]=await pg.sql.unsafe('select public.devos_fleet_enqueue_v1($1,$2,$3,$4,$5,$6,null,50) as value',
      [f.k.workspace_id,'generated.conflicting.successor','IMPLEMENTER',f.k.source_head,pg.sql.json(spec),'native-successor:'+f.k.checkpoint_id]);
    // The colliding task is already linked outside the expected writer lineage.
    // An open descendant would be refused earlier by commit-gate; this control
    // deliberately reaches the real atomic successor insertion/rollback.
    assert.equal(enqueued.value.accepted,true);await f.f.link(enqueued.value.task_id,null);
    const conflictBefore=await pg.sql.unsafe('select task_id,base_sha,task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[enqueued.value.task_id]);
    const answer=value(await child(f,{operation:'RECONCILE_FINISH_CHECKPOINT'}));assert.equal(answer.state,'SQL_FINALIZE_UNKNOWN');
    assert.equal(await readCommit(pg,f),null);assert.ok(JSON.parse(await fs.readFile(f.sqlIntent,'utf8')));
    for(const operation of ['READ_FINISH_CHECKPOINT','FINISH_CHECKPOINT','RECONCILE_FINISH_CHECKPOINT','OBSERVER']){
      const result=value(await child(f,{operation}));
      if(operation==='OBSERVER')assert.equal(result.readback_required,1);else assert.equal(result.state,'SQL_FINALIZE_UNKNOWN');
    }
    const conflictAfter=await pg.sql.unsafe('select task_id,base_sha,task_spec from destruktion_meta.devos_fleet_task_h205f22 where task_id=$1',[enqueued.value.task_id]);
    assert.deepEqual([...conflictAfter],[...conflictBefore]);
    await assertNoReplay(pg,f,{dispatches:1,commits:0,successors:1});
    const [fence]=await pg.sql.unsafe('select state from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=$1',[f.k.writer_task_id]);
    assert.equal(fence.state,'CHECKPOINTED_PENDING_COMMIT');
    return {effects:await counts(f),sql_rows:await nativeCounts(pg,f),existing_conflicting_successors:1,new_successors:0};
  });

  assert.equal(proof.length,8);
  const evidence={schema:'metaengine.native-coding.checkpoint-reconciliation.native-pg17.qa.v1',state:'PASS',
    source_head:process.env.METAENGINE_RECONCILIATION_SOURCE_SHA||'UNSEALED_WORKTREE',
    source_files:{host_sha256:hash(await fs.readFile(new URL('./native-coding-host-commit-service.mjs',import.meta.url))),
      observer_sha256:hash(await fs.readFile(new URL('../../apps/metaengine-browser/src/native-coding-project-commits.mjs',import.meta.url)))},
    postgres_version_num:pg.identity.version,postgres_system_identifier:pg.cluster,migration_sha256:pg.appliedMigrationSha,subtests:proof,
    real_git:true,real_child_crash:true,real_pg_transactions:true,zero_git_write_replay_verified:true,generated_authority_callbacks:true,
    installed_keeper_used:false,windows_acl_qualified:false,installed_autonomy_proven:false,production_qualified:false,authority_effect:false};
  const evidencePath=path.join(pg.directory,'reconciliation-receipt.json');await fs.writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  t.diagnostic('native_reconciliation_receipt='+evidencePath);
});
