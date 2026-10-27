import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/,HEAD=/^[0-9a-f]{40}$/;
const FIELDS=['project_id','checkpoint_id','checkpoint_sha256','writer_task_id','writer_lease_generation','critic_task_id','critic_lease_generation'];
const COMMITTED=new Set(['SUCCESSOR_ADMITTED','COMMITTED_NO_SUCCESSOR','COMMITTED_PENDING_SUCCESSOR']);
const fail=reason=>{throw Error('native_coding_commit_observer_'+reason);};
function select(value){
  if(!value||Object.keys(value).sort().join('\0')!==[...FIELDS].sort().join('\0')
    ||!['project_id','checkpoint_id','writer_task_id','critic_task_id'].every(field=>UUID.test(value[field]||''))
    ||!HASH.test(value.checkpoint_sha256||'')||value.writer_task_id===value.critic_task_id
    ||!['writer_lease_generation','critic_lease_generation'].every(field=>Number.isSafeInteger(value[field])&&value[field]>0))fail('selector_invalid');
  return Object.freeze({...value});
}
const sameQuery=(value,wanted)=>value?.project_id===wanted.project_id&&value.checkpoint_sha256===wanted.checkpoint_sha256;
const safe=value=>['production_qualified','automatic_retry_allowed','authority_effect'].every(field=>value?.[field]===false);
function classify(value,wanted){
  if(value?.schema!=='metaengine.native-coding.host-commit-service.v1'||!sameQuery(value,wanted)||!safe(value))return 'READBACK_REQUIRED';
  if(COMMITTED.has(value.state)){
    const c=value.commit,r=c?.receipt;
    if(c?.schema!=='metaengine.native-coding.commit-checkpoint.v1'||!sameQuery(c,wanted)||!safe(c)
      ||c.checkpoint_id!==wanted.checkpoint_id||c.state!==value.state||c.root_fence_released!==true
      ||![c.previous_head,c.head,c.tree].every(head=>HEAD.test(head||''))||c.head===c.previous_head
      ||![c.next_writer_permit_id,c.next_critic_permit_id].every(id=>UUID.test(id||''))
      ||c.successor_admitted!==(value.state==='SUCCESSOR_ADMITTED')||value.successor_admitted!==c.successor_admitted
      ||c.successor_admitted!==(c.successor_task_id!==null)||c.successor_task_id!==null&&!UUID.test(c.successor_task_id||'')
      ||r?.schema!=='metaengine.native-coding.git-commit-receipt.v1'||r.state!=='COMMITTED'||!sameQuery(r,wanted)
      ||r.checkpoint_id!==wanted.checkpoint_id||!safe(r)||r.successor_admitted!==false
      ||r.previous_head!==c.previous_head||r.head!==c.head||r.tree!==c.tree
      ||!['working_tree_preserved','index_clean','ref_update_cas_verified','commit_object_readback_verified'].every(field=>r[field]===true)
      ||c.canonical_receipt!==json(r)||c.commit_receipt_sha256!==sha(r))return 'READBACK_REQUIRED';
    return value.state;
  }
  const git=value.git_readback;
  if(value.state==='GIT_COMMITTED_SQL_NOT_ATTEMPTED'){
    const proof=value.reconciliation;
    if(value.checkpoint_id!==wanted.checkpoint_id||value.successor_admitted!==false
      ||git?.schema!=='metaengine.native-coding.git-commit-receipt.v1'||git.state!=='COMMITTED'||!sameQuery(git,wanted)
      ||git.checkpoint_id!==wanted.checkpoint_id||!safe(git)||git.successor_admitted!==false
      ||![git.previous_head,git.head,git.tree].every(head=>HEAD.test(head||''))||git.head===git.previous_head
      ||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,160}$/.test(git.branch_ref||'')
      ||!['root_identity_sha256','reviewed_git_artifact_sha256','intent_sha256'].every(field=>HASH.test(git[field]||''))
      ||!['working_tree_preserved','index_clean','ref_update_cas_verified','commit_object_readback_verified'].every(field=>git[field]===true)
      ||proof?.schema!=='metaengine.native-coding.checkpoint-reconciliation.v1'
      ||proof.state!=='FIRST_SQL_FINALIZATION_ELIGIBLE'||proof.operation!=='RECONCILE_FINISH_CHECKPOINT'
      ||FIELDS.some(field=>proof[field]!==wanted[field])||!safe(proof)
      ||!['git_receipt_sha256','operator_sha256','sql_journal_identity_sha256'].every(field=>HASH.test(proof[field]||''))
      ||proof.git_receipt_sha256!==sha(git)||proof.sql_intent_state!=='ABSENT'||proof.sql_commit_state!=='ABSENT'
      ||!['physical_git_readback_verified','current_authority_verified','observation_only'].every(field=>proof[field]===true)
      ||!['git_effect_allowed','sql_retry_allowed','successor_admitted'].every(field=>proof[field]===false))return 'READBACK_REQUIRED';
    return 'GIT_COMMITTED_SQL_NOT_ATTEMPTED';
  }
  // NOT_ATTEMPTED permits only the ordinary first Git dispatch. A committed Git
  // result without the separate first-SQL observation above remains read-only.
  if(value.state==='PENDING_COMMIT'&&value.checkpoint_id===wanted.checkpoint_id&&value.successor_admitted===false
    &&git?.schema==='metaengine.native-coding.git-commit-receipt.v1'&&sameQuery(git,wanted)
    &&git.checkpoint_id===wanted.checkpoint_id&&git.state==='NOT_ATTEMPTED'&&safe(git)&&git.successor_admitted===false)return 'NOT_ATTEMPTED';
  return 'READBACK_REQUIRED';
}

// One nonblocking stage of the existing Supervisor heartbeat. The private Host
// independently verifies the reviewed bytes, performs the Git CAS and commits
// its own-PG receipt. This observer supplies selectors only, never Git arguments.
export function createNativeCodingProjectCommitObserver({ownPostgres,maxEntries=128}={}){
  if(!['finishCheckpoint','readFinishCheckpoint'].every(name=>typeof ownPostgres?.[name]==='function')
    ||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>128)fail('private_capability_required');
  const entries=new Map();let closed=false,running=null,cursor=0,capacityFenced=false;
  const snapshot=()=>Object.freeze({schema:'metaengine.native-coding.project-commit-observer.v1',closed,running:running!==null,
    capacity_fenced:capacityFenced,pending:[...entries.values()].filter(row=>row.state==='PENDING').length,
    readback_required:[...entries.values()].filter(row=>row.state==='READBACK_REQUIRED').length,
    committed:[...entries.values()].filter(row=>COMMITTED.has(row.state)).length,
    successors_observed:[...entries.values()].filter(row=>row.state==='SUCCESSOR_ADMITTED').length,
    policy_wait:[...entries.values()].filter(row=>row.state==='COMMITTED_PENDING_SUCCESSOR').length,
    automatic_retry_allowed:false,authority_effect:false});
  async function observeOne(wanted){
    if(closed)return;const id=wanted.checkpoint_sha256;let entry=entries.get(id);
    if(entry&&FIELDS.some(field=>entry.selector[field]!==wanted[field])){
      entry.state='READBACK_REQUIRED';entry.write_attempted=true;entry.reconciliation_attempted=true;return;
    }
    if(entry&&['SUCCESSOR_ADMITTED','COMMITTED_NO_SUCCESSOR'].includes(entry.state))return;
    if(!entry){
      if(entries.size>=maxEntries)for(const [old,row] of entries)if(COMMITTED.has(row.state)){entries.delete(old);break;}
      if(entries.size>=maxEntries){capacityFenced=true;return;}
      capacityFenced=false;entry={selector:wanted,state:'PENDING',write_attempted:false,reconciliation_attempted:false};entries.set(id,entry);
    }
    const query={project_id:wanted.project_id,checkpoint_sha256:wanted.checkpoint_sha256};
    let observed;
    try{observed=classify(await ownPostgres.readFinishCheckpoint(query),wanted);}
    catch{if(!closed)entry.state='READBACK_REQUIRED';return;}
    if(closed)return;
    if(COMMITTED.has(observed)){entry.state=observed;return;}
    const reconcile=observed==='GIT_COMMITTED_SQL_NOT_ATTEMPTED';
    if(reconcile){
      if(entry.reconciliation_attempted||typeof ownPostgres.reconcileFinishCheckpoint!=='function'){
        entry.state='READBACK_REQUIRED';return;
      }
      // This observation authorizes a distinct first SQL finalization after Git,
      // including a lost ordinary FINISH ACK. Host revalidates every pin and
      // absent intent at dispatch; this observer never resubmits reconciliation.
      entry.reconciliation_attempted=true;
    }else{
      if(observed!=='NOT_ATTEMPTED'||entry.write_attempted||entry.reconciliation_attempted){entry.state='READBACK_REQUIRED';return;}
      // A failed read before the first write has no effect. A subsequent exact
      // NOT_ATTEMPTED physical read may establish that first dispatch is safe.
      entry.write_attempted=true;
    }
    try{const value=await (reconcile?ownPostgres.reconcileFinishCheckpoint(query):ownPostgres.finishCheckpoint(query));if(!closed){
      const result=classify(value,wanted);entry.state=COMMITTED.has(result)?result:'READBACK_REQUIRED';
    }}catch{if(!closed)entry.state='READBACK_REQUIRED';}
  }
  return Object.freeze({
    observe(candidates=[]){
      if(closed)return snapshot();if(!Array.isArray(candidates)||candidates.length>4)fail('candidate_budget');
      const selected=new Map(candidates.map(value=>{const row=select(value);return [row.checkpoint_sha256,row];}));
      for(const [id,row] of entries)if(row.state==='READBACK_REQUIRED'||row.state==='COMMITTED_PENDING_SUCCESSOR')selected.set(id,row.selector);
      const wanted=[...selected.values()];
      if(!running&&wanted.length){const row=wanted[cursor%wanted.length];cursor=(cursor+1)%wanted.length;
        running=Promise.resolve().then(()=>observeOne(row)).finally(()=>{running=null;});}
      return snapshot();
    },snapshot,
    close(){closed=true;for(const row of entries.values())if((row.write_attempted||row.reconciliation_attempted)&&!COMMITTED.has(row.state))row.state='READBACK_REQUIRED';return snapshot();},
    drain(){return running||Promise.resolve();},
  });
}
