import crypto from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const TAB = /^tab_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeError = value => {
  const v=String(value||'observation_failed');
  return /^[a-z0-9_:-]{1,85}$/i.test(v) ? v : 'observation_failed';
};
export const OBSERVATION_SCHEMA='metaengine.devfleet.batch-observation.v1';

// A revision binds bounded page text to the *physical* WebContents incarnation.
// The hash is a change detector, never a proof of ChatGPT's reasoning or model.
export function fingerprintAxSnapshot({tab_id,process_epoch,target_id,navigation_generation,url,text}) {
  if (!TAB.test(tab_id||'') || typeof process_epoch!=='string' ||
      !/^[a-f0-9-]{36}$/i.test(process_epoch) ||
      typeof target_id!=='string' || !/^webcontents:[1-9][0-9]*$/.test(target_id) ||
      !Number.isSafeInteger(navigation_generation) || navigation_generation<0 ||
      typeof url!=='string' || typeof text!=='string' || text.length>180000)
    throw Error('observation_identity_invalid');
  const u=new URL(url);
  if(u.protocol!=='https:' || !['chatgpt.com','www.chatgpt.com'].includes(u.hostname) ||
      !(u.pathname==='/' || /^\/c\/[a-z0-9-]+\/?$/i.test(u.pathname)))
    throw Error('observation_origin_invalid');
  // No page text, cookie, URL query or private target internals are returned.
  const revision=crypto.createHash('sha256')
    .update(JSON.stringify([process_epoch,target_id,navigation_generation,u.origin+u.pathname,text]))
    .digest('hex');
  return {tab_id,revision,chars:text.length,complete:text.length<180000,
    authority_effect:false};
}
export function validateObservationRequest(params, ownedTabs) {
  if(!params || typeof params!=='object' || Array.isArray(params) ||
      Object.keys(params).some(k=>!['tab_ids','since','parallelism'].includes(k)))
    throw Error('observation_params_invalid');
  if(!Array.isArray(ownedTabs) || ownedTabs.length>16)throw Error('observation_ownership_invalid');
  const owned=new Set(ownedTabs);
  const ids=params.tab_ids===undefined?[...owned]:params.tab_ids;
  if(!Array.isArray(ids) || ids.length<1 || ids.length>16 ||
      new Set(ids).size!==ids.length || ids.some(id=>!TAB.test(id||'')||!owned.has(id)))
    throw Error('observation_tab_ids_invalid');
  const parallelism=params.parallelism===undefined?3:params.parallelism;
  if(!Number.isSafeInteger(parallelism)||parallelism<1||parallelism>4)
    throw Error('observation_parallelism_invalid');
  const since=params.since===undefined?[]:params.since;
  if(!Array.isArray(since) || since.length>16)throw Error('observation_since_invalid');
  const previous=new Map();
  for(const row of since) {
    if(!row||typeof row!=='object'||Array.isArray(row) ||
        Object.keys(row).some(k=>!['tab_id','revision'].includes(k)) ||
        !ids.includes(row.tab_id) || !HASH.test(row.revision||'') ||
        previous.has(row.tab_id))throw Error('observation_since_invalid');
    previous.set(row.tab_id,row.revision);
  }
  return {ids,parallelism,previous};
}
export async function runObservationBatch({params,ownedTabs,observe}) {
  if(typeof observe!=='function')throw Error('observation_adapter_missing');
  const {ids,parallelism,previous}=validateObservationRequest(params,ownedTabs);
  const result=new Array(ids.length);
  let next=0;
  const worker=async()=>{
    while(next<ids.length){
      const index=next++, tab_id=ids[index];
      try {
        const info=await observe(tab_id);
        if(info?.tab_id!==tab_id || !HASH.test(info?.revision||'') ||
            !Number.isSafeInteger(info?.chars) || info.chars<0 || info.chars>180000 ||
            typeof info.complete!=='boolean' || info.authority_effect!==false)
          throw Error('observation_readback_invalid');
        const prior=previous.get(tab_id);
        result[index]={tab_id,state:'OBSERVED',revision:info.revision,chars:info.chars,
          complete:info.complete,
          change:!info.complete?'TRUNCATED_UNVERIFIED':
            prior===undefined?'INITIAL':prior===info.revision?'UNCHANGED':'CHANGED',
          authority_effect:false};
      }catch(e){
        result[index]={tab_id,state:'UNKNOWN',change:'UNVERIFIED',
          error:safeError(e?.message),authority_effect:false};
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(ids.length,parallelism)},worker));
  return {schema:OBSERVATION_SCHEMA,scope:'READ_ONLY',source:'OWNED_WEB_CONTENTS',
    records:result,observed:result.filter(x=>x.state==='OBSERVED').length,
    unknown:result.filter(x=>x.state==='UNKNOWN').length,
    // Revision is a client-local bounded UI digest, not task completion proof.
    completion_proven:false,authority_effect:false,automatic_retry_allowed:false};
}
