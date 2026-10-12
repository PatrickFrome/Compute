#!/usr/bin/env node
// Safe first real DevFleet mission, limited to ONE newly created ChatGPT tab.
// Idempotent create, exact model+effort+input gates, single Send attempt maximum.
// Never repeats an ambiguous Send.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const [flag]=process.argv.slice(2);
if(flag!==undefined&&flag!=='--execute')throw Error('usage: qualify-first-roadmap-chat.mjs [--execute]');
if(!process.env.APPDATA)throw Error('APPDATA_required');
const root=path.join(process.env.APPDATA,'METAENGINE DevFleet');
const manifest=JSON.parse(await fs.readFile(path.join(root,'operator-rpc.json'),'utf8'));
const u=new URL(String(manifest.url||''));
if(manifest.schema!=='metaengine.devfleet.loopback.v1'||manifest.app!=='METAENGINE DevFleet'
  ||manifest.version!=='0.1.0-dev.5'
  ||u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/rpc'
  ||u.search||u.hash||u.username||u.password
  ||typeof manifest.token!=='string'||!/^[a-f0-9]{64}$/i.test(manifest.token))throw Error('local_operator_identity_unverified');
const call=async(method,params)=>{
 const res=await fetch(u,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
  headers:{Authorization:'Bearer '+manifest.token,'Content-Type':'application/json'},
  body:JSON.stringify({method:'chat.'+method,params})});
 const j=await res.json();
 if(!res.ok||j.ok!==true)throw Error('rpc_refused_'+method+'_'+String(j.error||res.status).slice(0,90));
 return j.result;
};
const createId='devfleet-first-clean-20261012-v5';
const created=await call('create',{request_id:createId,count:1});
if(created.state!=='CREATED'||created.sessions?.length!==1) {
 console.log(JSON.stringify({status:'CREATE_AMBIGUOUS_NO_RETRY',receipt:created.state||null}));
 process.exitCode=2;
} else {
 const tab_id=created.sessions[0].tab_id;
 const proof={schema:'metaengine.devfleet.first-mission.v1',tab_id,created_request_id:createId,
  model_proven:false,high_proven:false,input_ready:false,send_attempted:false,
  state:'NEEDS_MODEL_READBACK'};
 try {
  const initial=await call('inspect',{tab_id});
  if(initial.page_failure) {
    const recovered=await call('recover',{tab_id});
    proof.recovery_state=recovered.state;
    if(recovered.page_failure)throw Error('chat_page_error_unrecovered');
  }
  let model;
  try { model=await call('model_probe',{tab_id}); }
  catch(error) { proof.model_error=String(error?.message||error).slice(0,80); }
  if(model) {
   proof.mode=model.mode;
   proof.model_status=model.status;
   proof.model_proven=model.model_selection_proven===true;
   proof.high_proven=model.high_selection_proven===true;
   proof.model_menu=(model.picker_menu_controls||[]).slice(0,18)
     .map(x=>({name:x.name,role:x.role,selected:x.selected}));
   proof.submenu_opened=model.submenu_opened===true;
  }
  const input=await call('input_probe',{tab_id});
  proof.input_ready=input.mode==='CHAT'&&!input.page_failure&&input.unique_composer===true
    &&input.unique_send===true&&input.composer_nonempty===false;
  proof.draft_present=input.composer_nonempty===true;
  if(!proof.model_proven||!proof.high_proven||!proof.input_ready) {
   proof.state='BLOCKED_MODEL_OR_COMPOSER_UNVERIFIED';
  } else if(flag!=='--execute') {
   proof.state='READY_NOT_SENT';
  } else {
   // A single idempotent request ID is bound to this exact tab and task hash.
   const promptFile=path.resolve('coordination/operator-control/devfleet-prompts/01-P0_truth_host.txt');
   const prompt=await fs.readFile(promptFile,'utf8');
   const id='devfleet-p0-host-20261012-'+crypto.createHash('sha256').update(prompt).digest('hex').slice(0,12);
   proof.task_sha256=crypto.createHash('sha256').update(prompt).digest('hex');
   proof.task_request_id=id;
   proof.send_attempted=true;
   const receipt=await call('assign',{tab_id,request_id:id,text:prompt});
   proof.state=receipt.state==='SENT'?'PROVEN_SENT':receipt.state==='AMBIGUOUS'?'SEND_AMBIGUOUS_DO_NOT_RETRY':'SEND_NOT_PROVEN';
   proof.conversation_url=receipt.conversation_url||null;
  }
 } catch(error) {
  proof.state=proof.send_attempted?'SEND_UNKNOWN_DO_NOT_RETRY':'PREFLIGHT_REFUSED';
  proof.error_code=String(error?.message||error).slice(0,110);
 }
 console.log(JSON.stringify(proof,null,2));
 if(proof.state!=='PROVEN_SENT'&&proof.state!=='READY_NOT_SENT')process.exitCode=3;
}
