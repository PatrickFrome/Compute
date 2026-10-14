// DevFleet local-only immutable snapshot journal.
// A committed generation has a fresh filename. The legacy journal is read-only
// after first migration so external readers cannot block in-place replacement.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA='metaengine.devfleet.immutable-snapshot.v1';
const FILE_RE=/^operator-snapshot-g([0-9]{10})-([a-f0-9]{64})\.json$/;
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const fail=reason=>{throw Error('journal_'+reason)};
const stableJson=x=>JSON.stringify(x,null,2)+'\n';

export function createImmutableJournalStore({dataDir,io=fs,legacyName='operator-state.json'}={}) {
 if(typeof dataDir!=='string'||!path.isAbsolute(dataDir)||
    legacyName!=='operator-state.json')fail('path_invalid');
 const old=path.join(dataDir,legacyName);
 let loaded=false,seq=0,identity=null;
 const scan=async()=>{
  const all=await io.readdir(dataDir);
  const generations=[];
  for(const name of all){
    if(!name.startsWith('operator-snapshot-'))continue;
    const match=FILE_RE.exec(name);
    // Ignore uncommitted temp files only; unrecognized committed names
    // fail closed rather than silently losing evidence.
    if(!match){if(name.includes('.tmp-'))continue;fail('name_invalid');}
    const number=Number(match[1]);
    if(!Number.isSafeInteger(number)||number<1)fail('sequence_invalid');
    generations.push({seq:number,digest:match[2],name});
  }
  generations.sort((a,b)=>b.seq-a.seq||a.name.localeCompare(b.name));
  if(generations.length>1&&generations[0].seq===generations[1].seq)
    fail('generation_fork');
  return generations[0]||null;
 };
 const verify=async top=>{
  const raw=await io.readFile(path.join(dataDir,top.name),'utf8');
  if(digest(raw)!==top.digest)fail('digest_mismatch');
  let snapshot;
  try{snapshot=JSON.parse(raw);}catch{fail('json_invalid');}
  if(!snapshot||snapshot.schema!==SCHEMA||snapshot.seq!==top.seq||
     !snapshot.state||typeof snapshot.state!=='object'||Array.isArray(snapshot.state)||
     (snapshot.previous_digest!==null&&
       !/^[a-f0-9]{64}$/.test(snapshot.previous_digest)))
    fail('envelope_invalid');
  // The monotonically increasing source sequence and previous digest are
  // part of committed immutable bytes; no "SENT" can be inferred from them.
  return {snapshot,raw};
 };
 return {
  async load() {
   if(loaded)fail('double_load');
   const top=await scan();
   if(!top){
    let legacy;
    try{legacy=await io.readFile(old,'utf8');}
    catch(e){if(e?.code==='ENOENT'){loaded=true;return null;}throw e;}
    let state;try{state=JSON.parse(legacy);}catch{fail('legacy_invalid');}
    if(!state||typeof state!=='object'||Array.isArray(state))fail('legacy_invalid');
    loaded=true;seq=0;identity=null;
    return state;
   }
   const {snapshot}=await verify(top);
   seq=top.seq;identity=top.digest;loaded=true;
   return snapshot.state;
  },
  async save(state) {
   if(!loaded)fail('not_loaded');
   const top=await scan();
   if(top?.seq!==(seq||undefined)||top?.digest!==(identity||undefined))
     fail('generation_changed');
   if(seq>=9999999999)fail('sequence_exhausted');
   const next=seq+1;
   const body=stableJson({schema:SCHEMA,seq:next,
     previous_digest:identity,state});
   const hash=digest(body);
   const target=path.join(dataDir,
     'operator-snapshot-g'+String(next).padStart(10,'0')+'-'+hash+'.json');
   const tmp=target+'.tmp-'+crypto.randomUUID();
   try {
    await io.writeFile(tmp,body,{encoding:'utf8',mode:0o600,flag:'wx'});
    try {await io.rename(tmp,target);}
    catch(err) {
      // If the OS committed but reported an error, only exact byte readback
      // can reconcile the transaction. No attempt to re-run an effect.
      let actual=null;try{actual=await io.readFile(target,'utf8');}catch{}
      if(actual!==body)throw err;
    }
    const exact=await io.readFile(target,'utf8');
    if(exact!==body)fail('commit_readback_mismatch');
    // Check other incarnation did not create a competing generation.
    const newest=await scan();
    if(newest?.seq!==next||newest?.digest!==hash)fail('commit_conflict');
    seq=next;identity=hash;
    return {state:'COMMITTED',generation:next,digest:hash};
   } finally {
    await io.rm(tmp,{force:true}).catch(()=>{});
   }
  },
  readOnlyStatus() {
   return {schema:SCHEMA,generation:seq,
     initialized:loaded,source:'OWN_LOCAL_DISK',
     legacy_file_mutated:false,automatic_retry_allowed:false};
  }
 };
}
