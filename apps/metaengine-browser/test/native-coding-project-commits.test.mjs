import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeCodingProjectCommitObserver} from '../src/native-coding-project-commits.mjs';
import {AutonomousProjectTaskRuntime} from '../src/autonomous-project-task-runtime.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from '../src/native-coding-task-context.mjs';
const flags={production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
const candidate=()=>({project_id:randomUUID(),checkpoint_id:randomUUID(),checkpoint_sha256:sha(randomUUID()),
  writer_task_id:randomUUID(),writer_lease_generation:1,critic_task_id:randomUUID(),critic_lease_generation:2});
const base=row=>({schema:'metaengine.native-coding.host-commit-service.v1',project_id:row.project_id,
  checkpoint_sha256:row.checkpoint_sha256,...flags,successor_admitted:false});
const pending=(row,state='NOT_ATTEMPTED')=>({...base(row),checkpoint_id:row.checkpoint_id,state:'PENDING_COMMIT',
  git_readback:{schema:'metaengine.native-coding.git-commit-receipt.v1',project_id:row.project_id,checkpoint_id:row.checkpoint_id,
    checkpoint_sha256:row.checkpoint_sha256,state,...flags,successor_admitted:false}});
const committed=(row,state='SUCCESSOR_ADMITTED')=>{
  const receipt={...pending(row).git_readback,state:'COMMITTED',previous_head:'a'.repeat(40),head:'b'.repeat(40),tree:'c'.repeat(40),
    working_tree_preserved:true,index_clean:true,ref_update_cas_verified:true,commit_object_readback_verified:true};
  return {...base(row),state,successor_admitted:state==='SUCCESSOR_ADMITTED',commit:{
    schema:'metaengine.native-coding.commit-checkpoint.v1',project_id:row.project_id,checkpoint_id:row.checkpoint_id,
    checkpoint_sha256:row.checkpoint_sha256,state,...flags,root_fence_released:true,receipt,canonical_receipt:json(receipt),
    commit_receipt_sha256:sha(receipt),previous_head:receipt.previous_head,head:receipt.head,tree:receipt.tree,
    next_writer_permit_id:randomUUID(),next_critic_permit_id:randomUUID(),
    successor_task_id:state==='SUCCESSOR_ADMITTED'?randomUUID():null,successor_admitted:state==='SUCCESSOR_ADMITTED'}};
};
const reconcilable=row=>{
  const git={...committed(row).commit.receipt,branch_ref:'refs/heads/native-checkpoint',root_identity_sha256:'1'.repeat(64),
    reviewed_git_artifact_sha256:'2'.repeat(64),intent_sha256:'3'.repeat(64)};
  return {...base(row),checkpoint_id:row.checkpoint_id,state:'GIT_COMMITTED_SQL_NOT_ATTEMPTED',git_readback:git,
    reconciliation:{schema:'metaengine.native-coding.checkpoint-reconciliation.v1',state:'FIRST_SQL_FINALIZATION_ELIGIBLE',
      operation:'RECONCILE_FINISH_CHECKPOINT',...row,git_receipt_sha256:sha(git),operator_sha256:'4'.repeat(64),
      sql_journal_identity_sha256:'5'.repeat(64),sql_intent_state:'ABSENT',sql_commit_state:'ABSENT',
      physical_git_readback_verified:true,current_authority_verified:true,observation_only:true,
      git_effect_allowed:false,sql_retry_allowed:false,successor_admitted:false,...flags}};
};
const drain=async observer=>{for(let i=0;i<100&&observer.snapshot().running;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(observer.snapshot().running,false);};

test('the existing heartbeat starts one nonblocking exact-selector commit and observes its successor',async()=>{
  const row=candidate();let release,writes=0;const gate=new Promise(resolve=>{release=resolve;});
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>pending(row),
    finishCheckpoint:async query=>{assert.deepEqual(query,{project_id:row.project_id,checkpoint_sha256:row.checkpoint_sha256});writes++;await gate;return committed(row);}}});
  observer.observe([row]);for(let i=0;i<10;i++)observer.observe([row]);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);assert.equal(observer.snapshot().running,true);
  release();await drain(observer);assert.equal(observer.snapshot().committed,1);assert.equal(observer.snapshot().successors_observed,1);
  observer.observe([row]);await drain(observer);assert.equal(writes,1);observer.close();
});

test('a lost write ACK retains its selectors after the public sweep disappears and never dispatches twice',async()=>{
  const row=candidate();let current=pending(row),writes=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
    finishCheckpoint:async()=>{writes++;throw Error('lost_ack');}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().readback_required,1);
  observer.observe([]);await drain(observer);assert.equal(writes,1);
  current=committed({...row,checkpoint_sha256:'d'.repeat(64)});observer.observe([]);await drain(observer);
  assert.equal(observer.snapshot().readback_required,1);assert.equal(observer.snapshot().committed,0);
  current=committed(row);observer.observe([]);await drain(observer);
  assert.equal(observer.snapshot().committed,1);assert.equal(writes,1);observer.close();
});

test('a fresh observer never resumes an existing uncertain Git or SQL intent',async()=>{
  const row=candidate();let writes=0;
  for(const current of [pending(row,'READBACK_REQUIRED'),pending(row,'COMMITTED_INDEX_PENDING'),
    pending(row,'COMMITTED'),{...base(row),state:'SQL_FINALIZE_UNKNOWN',checkpoint_id:row.checkpoint_id}]){
    const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
      finishCheckpoint:async()=>{writes++;return committed(row);}}});
    observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().readback_required,1);observer.close();
  }
  assert.equal(writes,0);
});

test('typed committed-Git readback dispatches only one selector-only first SQL reconciliation',async()=>{
  const row=candidate(),done=committed(row);let release,finishes=0,reconciliations=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>reconcilable(row),
    finishCheckpoint:async()=>{finishes++;throw Error('must_not_repeat_git');},
    reconcileFinishCheckpoint:async query=>{
      assert.deepEqual(query,{project_id:row.project_id,checkpoint_sha256:row.checkpoint_sha256});
      reconciliations++;await gate;return done;
    }}});
  observer.observe([row]);await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<12;i++)observer.observe([row]);
  assert.equal(reconciliations,1);assert.equal(finishes,0);assert.equal(observer.snapshot().running,true);
  release();await drain(observer);
  assert.equal(observer.snapshot().successors_observed,1);
  observer.observe([row]);await drain(observer);assert.equal(reconciliations,1);assert.equal(finishes,0);observer.close();
});

test('typed reconciliation remains HOLD when the optional private capability is absent',async()=>{
  const row=candidate();let finishes=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>reconcilable(row),
    finishCheckpoint:async()=>{finishes++;throw Error('must_not_fallback_to_git');}}});
  observer.observe([row]);await drain(observer);observer.observe([]);await drain(observer);
  assert.equal(observer.snapshot().readback_required,1);assert.equal(finishes,0);observer.close();
});

test('malformed, foreign and ambiguous reconciliation observations never authorize a mutation',async()=>{
  const row=candidate();let mutations=0;
  const changes=[
    v=>{v.reconciliation.schema='metaengine.native-coding.checkpoint-reconciliation.v2';},
    v=>{v.reconciliation.state='RETRY_ALLOWED';},v=>{v.reconciliation.operation='FINISH_CHECKPOINT';},
    v=>{v.reconciliation.project_id=randomUUID();},v=>{v.reconciliation.checkpoint_id=randomUUID();},
    v=>{v.reconciliation.checkpoint_sha256='e'.repeat(64);},v=>{v.reconciliation.writer_task_id=randomUUID();},
    v=>{v.reconciliation.critic_task_id=randomUUID();},v=>{v.reconciliation.writer_lease_generation++;},
    v=>{v.reconciliation.critic_lease_generation++;},v=>{v.reconciliation.git_receipt_sha256='f'.repeat(64);},
    v=>{delete v.reconciliation.operator_sha256;},v=>{v.reconciliation.sql_journal_identity_sha256='unknown';},
    v=>{v.reconciliation.sql_intent_state='EXISTS';},v=>{v.reconciliation.sql_commit_state='UNKNOWN';},
    v=>{v.reconciliation.current_authority_verified=false;},v=>{v.reconciliation.physical_git_readback_verified=false;},
    v=>{v.reconciliation.observation_only=false;},v=>{v.reconciliation.git_effect_allowed=true;},
    v=>{v.reconciliation.sql_retry_allowed=true;},v=>{v.reconciliation.automatic_retry_allowed=true;},
    v=>{v.reconciliation.authority_effect=true;},v=>{v.reconciliation.production_qualified=true;},
    v=>{v.reconciliation.successor_admitted=true;},v=>{v.successor_admitted=true;},
    v=>{v.git_readback.checkpoint_id=randomUUID();},v=>{v.git_readback.head=v.git_readback.previous_head;},
    v=>{v.git_readback.branch_ref='HEAD';},v=>{delete v.git_readback.intent_sha256;},
    v=>{v.git_readback.index_clean=false;},v=>{v.git_readback.commit_object_readback_verified=false;},
  ];
  for(const change of changes){
    const current=reconcilable(row);change(current);
    const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
      finishCheckpoint:async()=>{mutations++;return committed(row);},
      reconcileFinishCheckpoint:async()=>{mutations++;return committed(row);}}});
    observer.observe([row]);await drain(observer);
    assert.equal(observer.snapshot().readback_required,1);assert.equal(observer.snapshot().committed,0);observer.close();
  }
  assert.equal(mutations,0);
});

test('lost first SQL reconciliation ACK remains read-only until authoritative completion',async()=>{
  const row=candidate(),done=committed(row);let current=reconcilable(row),finishes=0,reconciliations=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
    finishCheckpoint:async()=>{finishes++;throw Error('must_not_write');},
    reconcileFinishCheckpoint:async()=>{reconciliations++;throw Error('lost_ack');}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().readback_required,1);
  for(let i=0;i<3;i++){observer.observe([]);await drain(observer);}
  current=pending(row);observer.observe([]);await drain(observer);
  assert.equal(reconciliations,1);assert.equal(finishes,0);assert.equal(observer.snapshot().readback_required,1);
  current={...base(row),state:'SQL_FINALIZE_UNKNOWN',checkpoint_id:row.checkpoint_id};
  observer.observe([]);await drain(observer);assert.equal(reconciliations,1);
  current=done;observer.observe([]);await drain(observer);
  assert.equal(observer.snapshot().successors_observed,1);assert.equal(reconciliations,1);assert.equal(finishes,0);observer.close();
});

test('a lost ordinary FINISH ACK can resume through the distinct proven first SQL transition',async()=>{
  const row=candidate();let current=pending(row),finishes=0,reconciliations=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
    finishCheckpoint:async()=>{finishes++;current=reconcilable(row);throw Error('git_committed_before_lost_ack');},
    reconcileFinishCheckpoint:async()=>{reconciliations++;current=committed(row);return current;}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().readback_required,1);
  observer.observe([]);await drain(observer);assert.equal(observer.snapshot().successors_observed,1);
  observer.observe([row]);await drain(observer);assert.equal(finishes,1);assert.equal(reconciliations,1);observer.close();
});

test('reconciliation denial after a stale eligibility observation retains HOLD without another attempt',async()=>{
  const row=candidate();let reconciliations=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>reconcilable(row),
    finishCheckpoint:async()=>{throw Error('must_not_repeat_git');},
    reconcileFinishCheckpoint:async()=>{reconciliations++;return {...base(row),checkpoint_id:row.checkpoint_id,state:'SQL_FINALIZE_UNKNOWN'};}}});
  observer.observe([row]);await drain(observer);observer.observe([]);await drain(observer);
  assert.equal(observer.snapshot().readback_required,1);assert.equal(reconciliations,1);observer.close();
});

test('restart with an existing SQL intent holds and a second restart only reads its durable successor',async()=>{
  const row=candidate(),done=committed(row);let mutations=0;
  for(const current of [{...base(row),state:'SQL_FINALIZE_UNKNOWN',checkpoint_id:row.checkpoint_id},done,done]){
    const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
      finishCheckpoint:async()=>{mutations++;throw Error('must_not_write');},
      reconcileFinishCheckpoint:async()=>{mutations++;throw Error('must_not_write');}}});
    observer.observe([row]);await drain(observer);
    assert.equal(observer.snapshot().successors_observed,current===done?1:0);
    assert.equal(observer.snapshot().readback_required,current===done?0:1);observer.close();
  }
  assert.equal(mutations,0);
});

test('close during a delayed reconciliation eligibility read prevents dispatch',async()=>{
  const row=candidate();let release,mutations=0;const gate=new Promise(resolve=>{release=resolve;});
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>{await gate;return reconcilable(row);},
    finishCheckpoint:async()=>{mutations++;throw Error('must_not_write');},
    reconcileFinishCheckpoint:async()=>{mutations++;throw Error('must_not_write');}}});
  observer.observe([row]);await new Promise(resolve=>setImmediate(resolve));observer.close();release();await drain(observer);
  assert.equal(mutations,0);
});

test('close and drain join an in-flight first SQL reconciliation while its result stays fenced',async()=>{
  const row=candidate();let release,reconciliations=0;const gate=new Promise(resolve=>{release=resolve;});
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>reconcilable(row),
    finishCheckpoint:async()=>{throw Error('must_not_repeat_git');},
    reconcileFinishCheckpoint:async()=>{reconciliations++;await gate;return committed(row);}}});
  observer.observe([row]);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reconciliations,1);assert.equal(observer.close().readback_required,1);
  let drained=false;const joined=observer.drain().then(()=>{drained=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
  release();await joined;assert.equal(observer.snapshot().readback_required,1);assert.equal(observer.snapshot().committed,0);
  assert.equal(reconciliations,1);
});

test('a fresh observer reads a durable commit without any Git or SQL dispatch',async()=>{
  const row=candidate();let writes=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>committed(row),
    finishCheckpoint:async()=>{writes++;throw Error('must_not_write');}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().successors_observed,1);assert.equal(writes,0);observer.close();
});

test('known policy wait is refreshed by readback after the existing reconciler admits its successor',async()=>{
  const row=candidate();let current=committed(row,'COMMITTED_PENDING_SUCCESSOR'),writes=0;
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
    finishCheckpoint:async()=>{writes++;throw Error('must_not_write');}}});
  observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().policy_wait,1);
  current=committed(row);observer.observe([]);await drain(observer);assert.equal(observer.snapshot().successors_observed,1);assert.equal(writes,0);observer.close();
});

test('altered commit receipt, missing independent scope and unproven successor cannot claim completion',async()=>{
  const row=candidate();let writes=0;
  for(const change of [v=>{v.commit.receipt.head='e'.repeat(40);},v=>{v.commit.checkpoint_id=randomUUID();},
    v=>{v.commit.successor_task_id=null;},v=>{v.commit.receipt.index_clean=false;},v=>{v.production_qualified=true;}]){
    const current=committed(row);change(current);
    const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>current,
      finishCheckpoint:async()=>{writes++;return current;}}});
    observer.observe([row]);await drain(observer);assert.equal(observer.snapshot().readback_required,1);assert.equal(observer.snapshot().committed,0);observer.close();
  }
  assert.equal(writes,0);
});

test('bounded cache retires only durable commits across an open logical task history',async()=>{
  let current;const observer=createNativeCodingProjectCommitObserver({maxEntries:2,ownPostgres:{
    readFinishCheckpoint:async()=>committed(current),finishCheckpoint:async()=>{throw Error('must_not_write');}}});
  for(let i=0;i<20;i++){current=candidate();observer.observe([current]);await drain(observer);}
  assert.equal(observer.snapshot().committed,2);assert.equal(observer.snapshot().capacity_fenced,false);observer.close();
});

test('full unknown cache never erases an old intent to make another physical commit',async()=>{
  const first=candidate(),second=candidate(),third=candidate();let current=null,writes=0;
  const observer=createNativeCodingProjectCommitObserver({maxEntries:2,ownPostgres:{
    readFinishCheckpoint:async query=>current?.checkpoint_sha256===query.checkpoint_sha256?committed(current):pending(
      [first,second,third].find(row=>row.checkpoint_sha256===query.checkpoint_sha256)),
    finishCheckpoint:async()=>{writes++;throw Error('lost_ack');}}});
  for(const row of [first,second]){observer.observe([row]);await drain(observer);}
  for(let i=0;i<6&&!observer.snapshot().capacity_fenced;i++){observer.observe([third]);await drain(observer);}
  assert.equal(writes,2);assert.equal(observer.snapshot().capacity_fenced,true);
  current=first;for(let i=0;i<6&&!observer.snapshot().committed;i++){observer.observe([]);await drain(observer);}
  assert.equal(observer.snapshot().committed,1);assert.equal(observer.snapshot().readback_required,1);observer.close();
});

test('close during a delayed read prevents a late commit dispatch',async()=>{
  const row=candidate();let release,writes=0;const gate=new Promise(resolve=>{release=resolve;});
  const observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>{await gate;return pending(row);},
    finishCheckpoint:async()=>{writes++;return committed(row);}}});
  observer.observe([row]);await new Promise(resolve=>setImmediate(resolve));observer.close();release();await drain(observer);assert.equal(writes,0);
});

test('candidate ingestion rejects paths, forged selector generations and unbounded batches',()=>{
  const row=candidate(),observer=createNativeCodingProjectCommitObserver({ownPostgres:{readFinishCheckpoint:async()=>pending(row),finishCheckpoint:async()=>committed(row)}});
  for(const invalid of [{...row,path:'C:/foreign'},{...row,writer_lease_generation:0},{...row,critic_task_id:row.writer_task_id}])assert.throws(()=>observer.observe([invalid]),/selector_invalid/);
  assert.throws(()=>observer.observe(Array.from({length:5},candidate)),/candidate_budget/);observer.close();
});

test('the actual project heartbeat forwards only bounded native commit candidates to its private runtime',async()=>{
  const row=candidate();let observed;
  const runtime=new AutonomousProjectTaskRuntime({journal:{find(){},begin(){},confirm(){}},materializeProject:async()=>{},
    request:async()=>({schema:'metaengine.devos.project-reconcile.v1',project_id:null,bounded_projects:4,
      projects:[{project_id:row.project_id,native_commit_pending:true,native_commit_candidate:
        Object.fromEntries(Object.entries(row).filter(([key])=>key!=='project_id'))}],authority_effect:false})});
  runtime.bindNativeCodingRuntime({observeProjectCheckpoints:()=>null,observeProjectCommits:candidates=>{observed=candidates;return {running:true};}});
  assert.deepEqual((await runtime.tick()).native_commits,{running:true});assert.deepEqual(observed,[row]);await runtime.close();
});
