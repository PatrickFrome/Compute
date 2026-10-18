import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA='metaengine.devfleet.journal-snapshot.v1';
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const digest=obj=>sha(JSON.stringify(obj));
// Snapshot files are append-only. No fixed generation ceiling. Disk exhaustion
// remains a real fail-closed error; historical receipts must not be discarded.
const emptyHash=sha('EMPTY_PRIMARY');
const snapshotName=(file,seq)=>path.basename(file)+'.snapshot-v1-'+String(seq).padStart(8,'0')+'.json';
function verify(envelope,seq,baseHash,previousHash){
 if(!envelope||envelope.schema!==SCHEMA||envelope.seq!==seq||
    envelope.base_sha256!==baseHash||envelope.previous_sha256!==previousHash||
    !envelope.state||typeof envelope.state!=='object'||
    envelope.state_sha256!==digest(envelope.state))
    throw Error('journal_snapshot_integrity_invalid');
 const {entry_sha256,...body}=envelope;
 if(entry_sha256!==digest(body))throw Error('journal_snapshot_digest_invalid');
 return entry_sha256;
}
export function createJournalSnapshotStore({file,atomicWrite,io=fs}){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof atomicWrite!=='function')
  throw Error('journal_store_contract_invalid');
 let initialized=false,baseHash=emptyHash,seq=0,lastHash=emptyHash,latest=null;
 async function readPrimary(){
  try{return await io.readFile(file,'utf8');}
  catch(error){if(error?.code==='ENOENT')return null;throw error;}
 }
 async function verifyBase(){
  const data=await readPrimary();
  if((data===null?emptyHash:sha(data))!==baseHash)
    throw Error('journal_primary_concurrent_drift');
 }
 return {
  async load(){
   if(initialized)throw Error('journal_store_already_loaded');
   const primary=await readPrimary();
   baseHash=primary===null?emptyHash:sha(primary);
   let baseState=null;
   if(primary!==null){
     try{baseState=JSON.parse(primary);}catch{throw Error('journal_primary_json_invalid');}
   }
   let names;
   try{names=await io.readdir(path.dirname(file));}
   catch(error){if(error?.code==='ENOENT')names=[];else throw error;}
   const prefix=path.basename(file)+'.snapshot-v1-';
   const snapshots=names.filter(name=>name.startsWith(prefix) &&
     !/^\d{8}\.json\.tmp-[0-9a-f-]{36}$/.test(name.slice(prefix.length)));
   if(snapshots.some(name=>!/^\d{8,}\.json$/.test(name.slice(prefix.length))))
     throw Error('journal_snapshot_catalog_invalid');
   snapshots.sort();
   let prior=emptyHash;
   for(let i=0;i<snapshots.length;i++){
     const expected=snapshotName(file,i+1);
     if(snapshots[i]!==expected)throw Error('journal_snapshot_sequence_gap');
     let item;
     try{item=JSON.parse(await io.readFile(path.join(path.dirname(file),expected),'utf8'));}
     catch{throw Error('journal_snapshot_unreadable');}
     prior=verify(item,i+1,baseHash,prior);
     latest=item.state;
   }
   seq=snapshots.length;lastHash=prior;initialized=true;
   return structuredClone(latest??baseState);
  },
  async save(state){
   if(!initialized)throw Error('journal_store_uninitialized');
   if(!state||typeof state!=='object')throw Error('journal_store_state_invalid');
   const stable=JSON.stringify(state);
   if(!seq){
     try{
       await atomicWrite(file,JSON.stringify(state,null,2)+'\n');
       const final=await readPrimary();
       if(final===null||JSON.stringify(JSON.parse(final))!==stable)
         throw Error('journal_primary_write_readback_mismatch');
       baseHash=sha(final);
       return;
     }catch(error){
       if(!['EPERM','EBUSY','EACCES'].includes(error?.code))throw error;
       // Rename might have committed before reporting failure. Do not anchor
       // a new snapshot to a changed/unknown primary generation.
       await verifyBase();
     }
   }else await verifyBase();
   if(!Number.isSafeInteger(seq+1))throw Error('journal_snapshot_sequence_unrepresentable');
   const next=seq+1;
   const body={schema:SCHEMA,seq:next,base_sha256:baseHash,
     previous_sha256:lastHash,state_sha256:sha(stable),state:structuredClone(state)};
   const entry={...body,entry_sha256:digest(body)};
   const destination=path.join(path.dirname(file),snapshotName(file,next));
   const bytes=JSON.stringify(entry)+'\n';
   const staging=destination+'.tmp-'+crypto.randomUUID();
   let handle;
   try{
     // Staging is never mistaken for a committed generation after power loss.
     handle=await io.open(staging,'wx',0o600);
     await handle.writeFile(bytes,'utf8');
     await handle.sync();
     await handle.close();handle=null;
     // NTFS hard-link create is atomic and exclusive. Unlike rename, it
     // cannot overwrite another process incarnation's same-seq commit.
     try{await io.link(staging,destination);}
     catch(error){
       let actual=null;try{actual=await io.readFile(destination,'utf8');}catch{}
       if(actual!==bytes)throw error;
     }
   }finally{
     if(handle)await handle.close().catch(()=>{});
     await io.rm(staging,{force:true}).catch(()=>{});
   }
   // An interrupted/partial append must fail closed, never authorize effects.
   const observed=await io.readFile(destination,'utf8');
   if(observed!==bytes)throw Error('journal_snapshot_readback_mismatch');
   let parsed;
   try{parsed=JSON.parse(observed);}catch{throw Error('journal_snapshot_unreadable');}
   const newHash=verify(parsed,next,baseHash,lastHash);
   seq=next;lastHash=newHash;latest=structuredClone(state);
  },
  snapshotStatus(){return {schema:SCHEMA,snapshot_count:seq,
    append_mode:seq>0,read_only:true,authority_effect:false};}
 };
}
