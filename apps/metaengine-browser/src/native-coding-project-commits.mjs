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
  // A protected physical NOT_ATTEMPTED readback is the only permission for
  // the first dispatch. Any existing intent or uncertain result stays read-only,
  // including after a Browser restart that lost its in-memory entry.
  const git=value.git_readback;
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
    if(entry&&FIELDS.some(field=>entry.selector[field]!==wanted[field])){entry.state='READBACK_REQUIRED';entry.write_attempted=true;return;}
    if(entry&&['SUCCESSOR_ADMITTED','COMMITTED_NO_SUCCESSOR'].includes(entry.state))return;
    if(!entry){
      if(entries.size>=maxEntries)for(const [old,row] of entries)if(COMMITTED.has(row.state)){entries.delete(old);break;}
      if(entries.size>=maxEntries){capacityFenced=true;return;}
      capacityFenced=false;entry={selector:wanted,state:'PENDING',write_attempted:false};entries.set(id,entry);
    }
    const query={project_id:wanted.project_id,checkpoint_sha256:wanted.checkpoint_sha256};
    let observed;
    try{observed=classify(await ownPostgres.readFinishCheckpoint(query),wanted);}
    catch{if(!closed)entry.state='READBACK_REQUIRED';return;}
    if(closed)return;
    if(COMMITTED.has(observed)){entry.state=observed;return;}
    if(observed!=='NOT_ATTEMPTED'||entry.write_attempted){entry.state='READBACK_REQUIRED';return;}
    // A failed read before the first write has no effect. A subsequent exact
    // NOT_ATTEMPTED physical read may establish that first dispatch is safe.
    entry.write_attempted=true;
    try{const value=await ownPostgres.finishCheckpoint(query);if(!closed){
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
    close(){closed=true;for(const row of entries.values())if(row.write_attempted&&!COMMITTED.has(row.state))row.state='READBACK_REQUIRED';return snapshot();},
    drain(){return running||Promise.resolve();},
  });
}
