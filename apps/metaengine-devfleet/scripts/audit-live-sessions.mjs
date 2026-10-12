#!/usr/bin/env node
// Read-only qualification of the exact installed DevFleet sessions.
// Prints no ChatGPT transcript, auth token, prompt or cookie.
import fs from 'node:fs/promises';
import path from 'node:path';

const directory=path.join(process.env.APPDATA||'','METAENGINE DevFleet');
const manifest=JSON.parse(await fs.readFile(path.join(directory,'operator-rpc.json'),'utf8'));
const snapshot=JSON.parse(await fs.readFile(path.join(directory,'operator-state.json'),'utf8'));
const url=new URL(String(manifest.url||''));
if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' ||
   url.pathname!=='/rpc' || url.search || url.hash || url.username || url.password ||
   manifest.schema!=='metaengine.devfleet.loopback.v1' ||
   typeof manifest.token!=='string'|| !/^[a-f0-9]{64}$/i.test(manifest.token) ||
   !Array.isArray(snapshot.sessions) || snapshot.sessions.length>16){
 throw new Error('devfleet_local_binding_invalid');
}
const sessions=snapshot.sessions.map(s=>s.tab_id);
async function inspect(tabId){
 try{
  const res=await fetch(url,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(20_000),
    headers:{Authorization:'Bearer '+manifest.token,'Content-Type':'application/json'},
    body:JSON.stringify({method:'chat.inspect',params:{tab_id:tabId}}),
  });
  const body=await res.json();
  if(!res.ok||body?.ok!==true)
   return {tab_id:tabId,verdict:'INSPECTION_REFUSED',error_code:String(body?.error||res.status).slice(0,70)};
  const c=body.result;
  const verdict=c.page_failure?'PAGE_ERROR'
    :c.mode==='WORK'?'WORK_DENIED'
    :c.mode==='CHAT'&&c.high_label_visible&&c.gpt6_label_visible?'READY_GPT6_HIGH':'MODEL_OR_MODE_UNVERIFIED';
  return {tab_id:tabId,mode:c.mode,page_failure:c.page_failure||null,
    high_label_visible:c.high_label_visible===true,
    gpt6_label_visible:c.gpt6_label_visible===true,verdict};
 }catch(error){
  return {tab_id:tabId,verdict:'INSPECTION_FAILED',error_code:String(error?.name||'ERROR').slice(0,50)};
 }
}
const rows=[];
for(let i=0;i<sessions.length;i+=3){
 rows.push(...await Promise.all(sessions.slice(i,i+3).map(inspect)));
}
const byVerdict=Object.fromEntries([...new Set(rows.map(r=>r.verdict))].map(k=>
 [k,rows.filter(r=>r.verdict===k).length]));
console.log(JSON.stringify({schema:'metaengine.devfleet.fleet-readiness.v1',
 installed_version:manifest.version,live_process_pid:manifest.pid,
 total:sessions.length,by_verdict:byVerdict,rows,
 no_send:true,automatic_retry:false,hosted_database:false},null,2));
