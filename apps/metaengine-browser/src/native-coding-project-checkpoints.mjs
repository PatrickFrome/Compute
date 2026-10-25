const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const FIELDS=['project_id','writer_task_id','writer_lease_generation','critic_task_id','critic_lease_generation'];
const fail=reason=>{throw new Error('native_coding_checkpoint_observer_'+reason);};
const key=row=>FIELDS.map(field=>row[field]).join(':');
const same=(a,b)=>FIELDS.every(field=>a[field]===b?.[field]);
function selector(value) {
  if(!value||Object.keys(value).sort().join(',')!==[...FIELDS].sort().join(',')
    ||!['project_id','writer_task_id','critic_task_id'].every(field=>UUID.test(value[field]||''))
    ||!['writer_lease_generation','critic_lease_generation'].every(field=>Number.isSafeInteger(value[field])&&value[field]>0)
    ||value.writer_task_id===value.critic_task_id)fail('selector_invalid');
  return Object.freeze({...value});
}
function accepted(value,wanted) {
  return value?.schema==='metaengine.native-coding.project-checkpoint.v1'&&same(wanted,value)
    &&value.state==='CHECKPOINTED_PENDING_COMMIT'&&HASH.test(value.checkpoint_sha256||'')
    &&value.successor_admitted===false&&value.authority_effect===false;
}

// This is a stage of the existing heartbeat, with no timer. It starts at most
// one private Host operation pass and returns immediately. A timeout never
// causes another checkpoint write; subsequent observations only read PG.
export function createNativeCodingProjectCheckpointObserver({ownPostgres,maxEntries=128}={}) {
  if(!['reconcileProject','readProjectCheckpoint'].every(name=>typeof ownPostgres?.[name]==='function')
    ||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>128)fail('private_capability_required');
  let closed=false,running=null,capacityFenced=false,cursor=0;
  const entries=new Map();
  const snapshot=()=>Object.freeze({schema:'metaengine.native-coding.project-checkpoint-observer.v1',
    running:running!==null,closed,capacity_fenced:capacityFenced,
    pending:[...entries.values()].filter(row=>row.state==='PENDING').length,
    readback_required:[...entries.values()].filter(row=>row.state==='READBACK_REQUIRED').length,
    checkpointed:[...entries.values()].filter(row=>row.state==='CHECKPOINTED_PENDING_COMMIT').length,
    successor_admitted:false,automatic_retry_allowed:false,authority_effect:false});
  async function observeOne(wanted) {
    if(closed)return;
    const id=key(wanted);let entry=entries.get(id);
    if(entry?.state==='CHECKPOINTED_PENDING_COMMIT')return;
    if(!entry) {
      // Accepted checkpoints remain durable in own PG. Retire only their
      // local cache entries; never evict an unresolved write to make space.
      if(entries.size>=maxEntries)for(const [old,value] of entries){
        if(value.state==='CHECKPOINTED_PENDING_COMMIT'){entries.delete(old);break;}
      }
      if(entries.size>=maxEntries){capacityFenced=true;return;}
      capacityFenced=false;
      entry={selector:wanted,state:'PENDING',write_attempted:false,checkpoint_sha256:null};entries.set(id,entry);
    }
    let readback;
    try {readback=await ownPostgres.readProjectCheckpoint(wanted.project_id);}
    catch {if(!closed)entry.state=entry.write_attempted?'READBACK_REQUIRED':'PENDING';return;}
    if(closed)return;
    if(accepted(readback,wanted)) {
      entry.state='CHECKPOINTED_PENDING_COMMIT';entry.checkpoint_sha256=readback.checkpoint_sha256;capacityFenced=false;return;
    }
    if(entry.state==='READBACK_REQUIRED'||entry.write_attempted)return;
    // Null/another historical pair is not acceptance of this candidate. A
    // malformed readback also cannot authorize the first checkpoint write.
    if(readback!==null&&!(readback?.schema==='metaengine.native-coding.project-checkpoint.v1'
      &&readback.project_id===wanted.project_id&&readback.authority_effect===false
      &&readback.successor_admitted===false&&(readback.state==='PENDING'&&readback.checkpoint_sha256===null
        ||readback.state==='CHECKPOINTED_PENDING_COMMIT'&&HASH.test(readback.checkpoint_sha256||'')
          &&['writer_task_id','critic_task_id'].every(field=>UUID.test(readback[field]||''))
          &&['writer_lease_generation','critic_lease_generation'].every(field=>Number.isSafeInteger(readback[field])&&readback[field]>0)))) {
      entry.state='READBACK_REQUIRED';return;
    }
    entry.write_attempted=true;
    try {
      const value=await ownPostgres.reconcileProject(wanted.project_id);if(closed)return;
      if(accepted(value,wanted)){entry.state='CHECKPOINTED_PENDING_COMMIT';entry.checkpoint_sha256=value.checkpoint_sha256;}
      else if(value?.schema==='metaengine.native-coding.project-checkpoint.v1'&&value.project_id===wanted.project_id
        &&value.state==='PENDING'&&value.checkpoint_sha256===null&&value.successor_admitted===false&&value.authority_effect===false) {
        entry.state='PENDING';entry.write_attempted=false;
      } else entry.state='READBACK_REQUIRED';
    }catch {if(!closed)entry.state='READBACK_REQUIRED';}
  }
  return Object.freeze({
    observe(candidates=[]) {
      if(closed)return snapshot();
      if(!Array.isArray(candidates)||candidates.length>4)fail('candidate_budget');
      const selected=new Map(candidates.map(value=>{const row=selector(value);return [key(row),row];}));
      // Successful SQL completion removes RESULT_READY from the public sweep.
      // An unknown ACK still needs its retained private readback on later ticks.
      for(const [id,row] of entries)if(row.state==='READBACK_REQUIRED'||row.write_attempted&&row.state!=='CHECKPOINTED_PENDING_COMMIT')
        selected.set(id,row.selector);
      const wanted=[...selected.values()];
      if(!running&&wanted.length) {
        const row=wanted[cursor%wanted.length];cursor=(cursor+1)%wanted.length;
        running=Promise.resolve().then(()=>observeOne(row)).finally(()=>{running=null;});
      }
      return snapshot();
    },snapshot,
    close(){closed=true;for(const row of entries.values())if(row.write_attempted&&row.state!=='CHECKPOINTED_PENDING_COMMIT')row.state='READBACK_REQUIRED';return snapshot();},
    drain(){return running||Promise.resolve();},
  });
}
