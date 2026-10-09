import { createHash } from 'node:crypto';
import { controlActionDescriptor } from './control-actions-manifest.mjs';
import { CHAT_COMMAND_ACTIONS } from './chat-command-policy.mjs';
import { projectGithubChatReplyResult } from './github-chat-egress-policy.mjs';

export const GITHUB_CHAT_PAIRING_SCHEMA='metaengine.github-chat-pairing.v1';
export const GITHUB_CHAT_REQUEST_MARKER='<!-- metaengine-chat-request:v1 -->';
export const GITHUB_CHAT_REPLY_MARKER='<!-- metaengine-chat-reply:v1 -->';
export const GITHUB_CHAT_METHODS=Object.freeze([
  'STATUS','CAPABILITIES','COMMAND_SUBMIT','COMMAND_LOOKUP','COMMAND_RECEIPT',
  'GOAL_SUBMIT','GOAL_PROGRESS','GOAL_PROOF','REVOKE',
]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(`github_chat_${code}`);};
const integer=value=>Number.isSafeInteger(value)&&value>0;

export function normalizeGithubChatPairing(value) {
  const fields=['schema','relay_id','client_id','repository','repository_id','issue_number',
    'operator_user_ids','publisher_user_id','after_comment_id','permissions','expires_at','owner_action'];
  if (!object(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key))
      ||value.schema!==GITHUB_CHAT_PAIRING_SCHEMA||!uuid.test(value.relay_id||'')
      ||typeof value.client_id!=='string'||!/^[A-Za-z0-9._:-]{3,160}$/.test(value.client_id)
      ||typeof value.repository!=='string'||value.repository.length>200||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value.repository)
      ||!integer(value.repository_id)||!integer(value.issue_number)||!integer(value.publisher_user_id)
      ||!Number.isSafeInteger(value.after_comment_id)||value.after_comment_id<0
      ||!Array.isArray(value.operator_user_ids)||!value.operator_user_ids.length||value.operator_user_ids.length>32
      ||!value.operator_user_ids.every(integer)||new Set(value.operator_user_ids).size!==value.operator_user_ids.length
      ||!Array.isArray(value.permissions)||!value.permissions.length||value.permissions.length>3
      ||!value.permissions.every(scope=>['OBSERVE','CONTROL','GOALS'].includes(scope))
      ||new Set(value.permissions).size!==value.permissions.length
      ||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at))
      ||value.owner_action!=='ENABLE_GITHUB_CHAT_CONTROL') fail('pairing_invalid');
  return Object.freeze(structuredClone(value));
}

export function githubChatRequestId(pairing,commentId) {
  if(!integer(commentId))fail('comment_id_invalid');
  const bytes=createHash('sha256').update(`${pairing.repository_id}:${pairing.issue_number}:${pairing.relay_id}:${pairing.client_id}:${commentId}`).digest();
  bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;
  const hex=bytes.subarray(0,16).toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function parseGithubChatRequest(comment,pairing) {
  if(!integer(comment?.id)||comment.id<=pairing.after_comment_id
      ||!pairing.operator_user_ids.includes(comment.user?.id)||comment.user?.type!=='User'
      ||typeof comment.body!=='string'||!comment.body.startsWith(GITHUB_CHAT_REQUEST_MARKER+'\n')
      ||Buffer.byteLength(comment.body)>60_000)return null;
  if(comment.issue_url!==`https://api.github.com/repos/${pairing.repository}/issues/${pairing.issue_number}`)fail('inbox_mismatch');
  // Edited command messages must never acquire a fresh identity on replay.
  if(!comment.created_at||comment.updated_at!==comment.created_at)fail('edited_request_refused');
  let value;
  try{value=JSON.parse(comment.body.slice(GITHUB_CHAT_REQUEST_MARKER.length));}catch{fail('request_invalid');}
  const fields=['schema','relay_id','client_id','method','params'];
  if(!object(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key))
      ||value.schema!=='metaengine.github-chat-request.v1'||value.relay_id!==pairing.relay_id
      ||value.client_id!==pairing.client_id||!GITHUB_CHAT_METHODS.includes(value.method)||!object(value.params))fail('request_invalid');
  return Object.freeze({...value,params:structuredClone(value.params),request_id:githubChatRequestId(pairing,comment.id),
    comment_id:comment.id,operator_user_id:comment.user.id,body_sha256:digest(comment.body)});
}

function validateParams(request) {
  const p=request.params;
  const exact=fields=>Object.keys(p).length===fields.length&&fields.every(key=>Object.hasOwn(p,key));
  if(['STATUS','CAPABILITIES','REVOKE'].includes(request.method)){if(!exact([]))fail('params_invalid');}
  else if(request.method==='COMMAND_SUBMIT'){
    const descriptor=controlActionDescriptor(p.action);
    if(!exact(['action','payload'])||!descriptor?.browser_implemented||!CHAT_COMMAND_ACTIONS.includes(p.action)||!object(p.payload))fail('params_invalid');
  }else if(['COMMAND_LOOKUP','GOAL_PROGRESS','GOAL_PROOF'].includes(request.method)){
    if(!exact(['request_id'])||!uuid.test(p.request_id||''))fail('params_invalid');
  }else if(request.method==='COMMAND_RECEIPT'){
    if(!exact(['command_id'])||!uuid.test(p.command_id||''))fail('params_invalid');
  }else if(request.method==='GOAL_SUBMIT'){
    if(!exact(['objective'])||typeof p.objective!=='string'||!p.objective.trim()||p.objective.trim().length>480)fail('params_invalid');
  }
}

async function boundedJson(response) {
  const reader=response.body?.getReader();
  if(!reader)fail('response_invalid');
  const chunks=[];let total=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;
      if(total>8*1024*1024)fail('response_too_large');chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{await reader.cancel().catch(()=>{});}
}

export class GithubChatRelay {
  #pairing;#control;#journal;#token;#fetch;#current;#now;#capture;#branch;#state='STOPPED';#generation=0;
  #timer=null;#pending=null;#abort=null;#processed=new Set();#lastError=null;
  constructor({pairing,control,journal,getToken,isPairingCurrent,readCapture=null,fetchImpl=globalThis.fetch,now=Date.now}={}){
    this.#pairing=normalizeGithubChatPairing(pairing);
    if(!control||['status','capabilities','commandSubmit','commandLookup','commandReceipt','goalSubmit','goalProgress','goalProof'].some(name=>typeof control[name]!=='function')
        ||!journal||['claim','complete','revoked','revoke'].some(name=>typeof journal[name]!=='function')
        ||![getToken,isPairingCurrent,fetchImpl,now].every(fn=>typeof fn==='function'))fail('dependencies_required');
    this.#control=control;this.#journal=journal;this.#token=getToken;this.#current=isPairingCurrent;this.#fetch=fetchImpl;this.#now=now;
    this.#capture=readCapture;
  }
  #active(generation=this.#generation){return this.#state==='ACTIVE'&&generation===this.#generation&&Date.parse(this.#pairing.expires_at)>this.#now();}
  async #assertCurrent(generation){
    if(!this.#active(generation)||!await this.#current()||!this.#active(generation)){
      this.stop();fail('pairing_revoked');
    }
  }
  async #api(suffix,{method='GET',body=null,account=false}={}){
    const generation=this.#generation;
    await this.#assertCurrent(generation);
    const token=await this.#token();
    if(typeof token!=='string'||!/^\S{20,512}$/.test(token))fail('credential_unavailable');
    await this.#assertCurrent(generation);
    const response=await this.#fetch(account?'https://api.github.com/user':`https://api.github.com/repos/${this.#pairing.repository}${suffix}`,{
      method,redirect:'error',cache:'no-store',signal:AbortSignal.any([this.#abort.signal,AbortSignal.timeout(15_000)]),
      headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2026-03-10',
        ...(body===null?{}:{'content-type':'application/json'})},...(body===null?{}:{body:JSON.stringify(body)}),
    });
    if(!response.ok){
      if([401,403,404].includes(response.status))this.stop();
      fail('transport_unavailable');
    }
    const decoded=await boundedJson(response);
    await this.#assertCurrent(generation);
    return decoded;
  }
  async #repository(){
    const repo=await this.#api('');
    if(repo.id!==this.#pairing.repository_id||repo.private!==true
        ||String(repo.full_name||'').toLowerCase()!==this.#pairing.repository.toLowerCase()){
      this.stop();fail('private_repository_required');
    }
    this.#branch=repo.default_branch;
  }
  async #comments(){
    await this.#repository();
    const issue=await this.#api(`/issues/${this.#pairing.issue_number}`);
    if(issue.number!==this.#pairing.issue_number||issue.state!=='open'||issue.pull_request){this.stop();fail('inbox_closed');}
    const rows=[];
    for(let page=1;page<=16;page++){
      const chunk=await this.#api(`/issues/${this.#pairing.issue_number}/comments?per_page=100&page=${page}`);
      if(!Array.isArray(chunk))fail('comments_invalid');rows.push(...chunk);
      if(chunk.length<100)return rows;
    }
    // Never silently omit a tail containing a revocation or completed reply.
    this.stop();fail('inbox_rotation_required');
  }
  #permission(request){
    let scope='OBSERVE';
    // Revocation is always available to an authenticated, paired operator.
    // A read-only grant must be able to withdraw itself without CONTROL.
    if(request.method==='GOAL_SUBMIT')scope='GOALS';
    if(request.method==='COMMAND_SUBMIT'&&controlActionDescriptor(request.params.action)?.effect==='MUTATING')scope='CONTROL';
    if(request.method==='REVOKE')return;
    if(!this.#pairing.permissions.includes(scope))fail('scope_denied');
  }
  async #invoke(request){
    const p=request.params;
    if(request.method==='STATUS')return this.#control.status();
    if(request.method==='CAPABILITIES')return this.#control.capabilities();
    if(request.method==='COMMAND_SUBMIT')return this.#control.commandSubmit({
      request_id:request.request_id,relay_id:this.#pairing.relay_id,operator_user_id:request.operator_user_id,
      action:p.action,payload:p.payload,
    });
    if(request.method==='COMMAND_LOOKUP')return this.#control.commandLookup({request_id:p.request_id,relay_id:this.#pairing.relay_id});
    if(request.method==='COMMAND_RECEIPT')return this.#control.commandReceipt(p);
    if(request.method==='GOAL_SUBMIT')return this.#control.goalSubmit({request_id:request.request_id,objective:p.objective});
    if(request.method==='GOAL_PROGRESS')return this.#control.goalProgress(p);
    if(request.method==='GOAL_PROOF')return this.#control.goalProof(p);
    if(request.method==='REVOKE'){
      return this.revoke();
    }
    fail('method_invalid');
  }
  async #reply(request,result){
    await this.#repository();
    // No arbitrary Supervisor/Host Agent result is eligible for private
    // GitHub publication until it passes the bounded secret/path projector.
    // The original receipt stays in the owner's local PostgreSQL journal.
    const projected=projectGithubChatReplyResult(result);
    const value={schema:'metaengine.github-chat-reply.v1',relay_id:this.#pairing.relay_id,client_id:this.#pairing.client_id,
      request_comment_id:request.comment_id,request_id:request.request_id,body_sha256:request.body_sha256,
      result:projected,transport_delivery_is_authority:false,automatic_retry_allowed:false,authority_effect:false};
    const reply=await this.#api(`/issues/${this.#pairing.issue_number}/comments`,{method:'POST',body:{body:GITHUB_CHAT_REPLY_MARKER+'\n'+JSON.stringify(value)}});
    if(!integer(reply?.id)||reply.user?.id!==this.#pairing.publisher_user_id)fail('reply_identity_unverified');
    this.#processed.add(request.comment_id);
  }
  async #transferCapture(request,result){
    if(request.method!=='COMMAND_RECEIPT'||result?.terminal!==true||!this.#capture)return result;
    const capture=result?.receipt?.result?.result;
    if(!['metaengine.windows-computer-executor.capture.v1','metaengine.windows-computer-executor.window-capture.v1'].includes(capture?.schema))return result;
    const generation=this.#generation;
    const bytes=await this.#capture(capture.png_path,capture.png_sha256);
    await this.#assertCurrent(generation);
    await this.#repository();
    const artifactPath=`metaengine-chat-artifacts/${this.#pairing.relay_id}/${request.request_id}/${capture.png_sha256}.png`;
    const written=await this.#api(`/contents/${artifactPath}`,{method:'PUT',body:{
      message:'Record verified METAENGINE chat capture',content:bytes.toString('base64'),branch:this.#branch,
    }});
    const gitSha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(written?.content?.sha!==gitSha)fail('capture_upload_unverified');
    const projected=structuredClone(result);
    const exported=projected.receipt.result.result;
    delete exported.png_path;
    exported.artifact={repository:this.#pairing.repository,path:artifactPath,sha256:capture.png_sha256,
      bytes:bytes.length,mime_type:'image/png',private_repository:true};
    return projected;
  }
  async #process(request,generation){
    validateParams(request);this.#permission(request);
    await this.#assertCurrent(generation);
    const claim=await this.#journal.claim(request.request_id,request.body_sha256);
    await this.#assertCurrent(generation);
    let result=claim.outcome;
    if(!claim.claimed&&!result)result={state:'AMBIGUOUS_NO_RETRY',request_id:request.request_id,
      reconcile_with:request.method==='GOAL_SUBMIT'?'GOAL_PROGRESS':request.method==='COMMAND_SUBMIT'?'COMMAND_LOOKUP':'NEW_OBSERVATION_REQUEST',
      automatic_retry_allowed:false,authority_effect:false};
    if(claim.claimed){
      try{result=await this.#transferCapture(request,await this.#invoke(request));}
      catch{result={state:'ADMISSION_OR_RESULT_UNCONFIRMED',request_id:request.request_id,automatic_retry_allowed:false,authority_effect:false};}
      // Flush even when stopped during admission. It is local reconciliation
      // evidence and must not cause an effect or a revoked private publication.
      await this.#journal.complete(request.request_id,request.body_sha256,result);
    }
    await this.#assertCurrent(generation);
    await this.#reply(request,result);
  }
  tick(){
    if(this.#pending)return this.#pending;
    const generation=this.#generation;
    this.#pending=(async()=>{
      await this.#assertCurrent(generation);
      const comments=await this.#comments();
      const replies=new Set();
      for(const row of comments){
        if(row.user?.id!==this.#pairing.publisher_user_id||typeof row.body!=='string'||!row.body.startsWith(GITHUB_CHAT_REPLY_MARKER+'\n'))continue;
        try{const reply=JSON.parse(row.body.slice(GITHUB_CHAT_REPLY_MARKER.length));
          if(reply.schema==='metaengine.github-chat-reply.v1'&&reply.relay_id===this.#pairing.relay_id
            &&reply.client_id===this.#pairing.client_id)replies.add(`${reply.request_comment_id}:${reply.body_sha256}`);
        }catch{}
      }
      const requests=[];
      for(const row of comments){
        if(this.#processed.has(row.id))continue;
        try{const request=parseGithubChatRequest(row,this.#pairing);if(request&&!replies.has(`${row.id}:${request.body_sha256}`))requests.push(request);}
        catch{this.#processed.add(row.id);this.#lastError='REQUEST_REJECTED';}
      }
      // Revocation preempts the ordinary queue, including unread older commands.
      const revocation=requests.find(request=>request.method==='REVOKE');
      if(revocation){validateParams(revocation);this.#permission(revocation);await this.#invoke(revocation);return;}
      for(const request of requests.slice(0,16)){
        await this.#assertCurrent(generation);
        try{await this.#process(request,generation);}
        catch(error){this.#lastError=/^github_chat_/.test(error?.message||'')?error.message:'OPERATION_UNCONFIRMED';
          if(!this.#active(generation))throw error;
          if(/(?:params_invalid|scope_denied|journal_unverified)/.test(error?.message||''))this.#processed.add(request.comment_id);
          else throw error;
        }
      }
      this.#lastError=null;
    })().finally(()=>{this.#pending=null;});
    return this.#pending;
  }
  async start({poll=true,processInitial=true}={}){
    if(this.#state!=='STOPPED')fail('new_relay_required');
    if(Date.parse(this.#pairing.expires_at)<=this.#now()||await this.#journal.revoked(this.#pairing.relay_id))fail('pairing_revoked');
    this.#state='ACTIVE';this.#generation++;this.#abort=new AbortController();
    try{
      const publisher=await this.#api('',{account:true});
      if(publisher.id!==this.#pairing.publisher_user_id)fail('publisher_identity_mismatch');
      if(processInitial)await this.tick();
      else {
        const comments=await this.#comments();
        for(const comment of comments){
          let request;try{request=parseGithubChatRequest(comment,this.#pairing);}catch{continue;}
          if(request?.method==='REVOKE'){validateParams(request);this.#permission(request);await this.#invoke(request);break;}
        }
      }
    }catch(error){this.stop();throw error;}
    if(poll&&this.#active()){
      this.#timer=setInterval(()=>{void this.tick().catch(error=>{this.#lastError=/^github_chat_/.test(error?.message||'')?error.message:'TRANSPORT_UNAVAILABLE';});},5000);
      this.#timer.unref?.();
    }
    return this.snapshot();
  }
  stop(){this.#generation++;this.#state='REVOKED';clearInterval(this.#timer);this.#timer=null;this.#abort?.abort();return this.snapshot();}
  async revoke(){this.stop();await this.#journal.revoke(this.#pairing.relay_id);return this.snapshot();}
  async assertCommandGrant(command){
    const match=/^github-chat:([0-9a-f-]{36}):([0-9]+)$/.exec(String(command?.issued_by||''));
    if(!match){if(String(command?.issued_by||'').startsWith('github-chat:'))fail('command_grant_revoked');return;}
    await this.#assertCurrent(this.#generation);
    const scope=controlActionDescriptor(command.action)?.effect==='MUTATING'?'CONTROL':'OBSERVE';
    if(match[1]!==this.#pairing.relay_id||!this.#pairing.operator_user_ids.includes(Number(match[2]))
        ||!this.#pairing.permissions.includes(scope))fail('command_grant_revoked');
  }
  snapshot(){return Object.freeze({schema:'metaengine.github-chat-relay.v1',state:this.#state,
    relay_id:this.#pairing.relay_id,client_id:this.#pairing.client_id,repository:this.#pairing.repository,
    issue_number:this.#pairing.issue_number,permissions:[...this.#pairing.permissions],expires_at:this.#pairing.expires_at,
    last_error:this.#lastError,private_repository_required:true,task_state_provider:'LOCAL_POSTGRES',
    command_authority:'EXISTING_DB_ISSUE_LEASE_EFFECT_RECEIPT',token_exposed:false,
    second_scheduler:false,automatic_effect_retry_allowed:false,transport_delivery_is_authority:false,authority_effect:false});}
}
