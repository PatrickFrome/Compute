#!/usr/bin/env node
// One-time, evidence-gated assignment of seven independent roadmap lanes.
// Defaults to read-only preflight. --execute never overrides model/Chat gates.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const execute=process.argv.length===3 && process.argv[2]==='--execute';
if(process.argv.length>2 && !execute)throw Error('usage: node dispatch-verified-roadmap.mjs [--execute]');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const tasksDir=path.join(root,'coordination','operator-control','devfleet-prompts');
const appData=process.env.APPDATA;
if(!appData)throw Error('appdata_unavailable');
const profile=path.join(appData,'METAENGINE DevFleet');
const manifest=JSON.parse(await fs.readFile(path.join(profile,'operator-rpc.json'),'utf8'));
const state=JSON.parse(await fs.readFile(path.join(profile,'operator-state.json'),'utf8'));
const endpoint=new URL(String(manifest.url));
if(manifest.schema!=='metaengine.devfleet.loopback.v1' || manifest.app!=='METAENGINE DevFleet'
  || endpoint.protocol!=='http:' ||endpoint.hostname!=='127.0.0.1'
  || endpoint.pathname!=='/rpc'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password
  || !/^[a-f0-9]{64}$/i.test(String(manifest.token||'')) ||manifest.version!=='0.1.0-dev.5'
  ||!Array.isArray(state.sessions)||!Array.isArray(state.requests))throw Error('operator_local_identity_invalid');
const skip=new Set(state.requests.filter(r=>r.operation==='assign'&&r.state==='AMBIGUOUS').map(r=>r.tab_id));
const available=state.sessions.filter(s=>!skip.has(s.tab_id) && s.state==='OPEN');
const files=(await fs.readdir(tasksDir)).filter(n=>/^\d\d-[a-z0-9-]+\.txt$/.test(n)).sort();
if(files.length!==7||available.length!==7)throw Error('fleet_task_or_session_count_unexpected');
async function rpc(method,params) {
 const res=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(80000),
  headers:{Authorization:'Bearer '+manifest.token,'Content-Type':'application/json'},
  body:JSON.stringify({method:'chat.'+method,params})});
 const value=await res.json();
 if(!res.ok||value?.ok!==true)throw Error('rpc_'+method+'_refused_'+String(value?.error||res.status).slice(0,80));
 return value.result;
}
const summary={schema:'metaengine.devfleet.dispatch-qualification.v1',
  version:manifest.version,installed_pid:manifest.pid,
  request_count:files.length,execute_requested:execute,
  forbidden_db:'Supabase',records:[],sent:0,blocked:0,ambiguous:0};
for(let i=0;i<files.length;i++) {
 const tab_id=available[i].tab_id;
 const filename=files[i],full=path.join(tasksDir,filename);
 const prompt=await fs.readFile(full,'utf8');
 if(!prompt.trim()||prompt.length>12000)throw Error('task_prompt_bounds');
 const short=crypto.createHash('sha256').update(prompt).digest('hex').slice(0,12);
 const request_id='devfleet-roadmap-20261012-'+String(i+1).padStart(2,'0')+'-'+short;
 const record={lane:filename.replace(/\.txt$/,''),tab_id,request_id,
   task_sha256:crypto.createHash('sha256').update(prompt).digest('hex'),state:'BLOCKED'};
 try {
  // First obtain the actual model selection and UI state. UI prose is not authority.
  const model=await rpc('model_probe',{tab_id});
  const input=await rpc('input_probe',{tab_id});
  record.mode=model.mode;record.model_state=model.status;
  record.gpt6_selected=model.model_selection_proven===true;
  record.high_selected=model.high_selection_proven===true;
  record.high_label_seen=model.effort?.high_label_visible===true;
  record.unique_composer=input.unique_composer===true;
  record.unique_send=input.unique_send===true;
  record.draft_present=input.composer_nonempty===true;
  const ready=record.mode==='CHAT'&&record.gpt6_selected&&record.high_selected
    && record.unique_composer&&record.unique_send&&!record.draft_present
    && !input.page_failure;
  if(!ready){
   record.reason='verified_gpt6_high_and_empty_composer_required';
   summary.blocked++;
  } else if(!execute){
   record.state='READY_BUT_NOT_SENT';
  } else {
   const result=await rpc('assign',{tab_id,request_id,text:prompt});
   record.state=result.state;
   record.conversation_url=result.conversation_url||null;
   if(result.state==='SENT')summary.sent++;
   else if(result.state==='AMBIGUOUS')summary.ambiguous++;
   else summary.blocked++;
  }
 }catch(error){
  record.reason=String(error?.message||error).slice(0,120);
  record.state='PROBE_REFUSED';
  summary.blocked++;
 }
 summary.records.push(record);
 console.log(JSON.stringify(record));
 if(summary.ambiguous)break; // never pile on effects after an unexpected send
}
console.log(JSON.stringify({summary:{...summary,records:undefined}},null,2));
