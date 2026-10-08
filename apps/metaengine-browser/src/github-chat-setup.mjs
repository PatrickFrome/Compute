import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertPhysicalDirectory,readPrivateRelayFile,GithubChatRelayJournal } from './github-chat-relay-journal.mjs';
import { GITHUB_CHAT_PAIRING_FILE,GITHUB_CHAT_TOKEN_FILE } from './github-chat-relay-bootstrap.mjs';
import { normalizeGithubChatPairing,GITHUB_CHAT_REQUEST_MARKER } from './github-chat-relay.mjs';

const fail=code=>{throw new Error('github_chat_setup_'+code);};
export const GITHUB_CHAT_ENROLLMENT_CLAIM_FILE='github-chat-enrollment-claim-v1.json';
async function writeExclusive(filename,bytes){
  const handle=await fs.open(filename,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}

async function retireRevokedPairing(root,clientId){
  let previous;
  try{previous=normalizeGithubChatPairing(JSON.parse((await readPrivateRelayFile(path.join(root,GITHUB_CHAT_PAIRING_FILE))).toString('utf8')));}
  catch(error){if(error.code==='ENOENT')return;throw error;}
  if(previous.client_id!==clientId)fail('existing_pairing_retained');
  const journal=await new GithubChatRelayJournal(path.join(root,'github-chat-delivery-journal')).initialize();
  if(!await journal.revoked(previous.relay_id))fail('existing_pairing_retained');
  const archive=path.join(root,'github-chat-retired-'+randomUUID());
  await fs.mkdir(archive,{mode:0o700});
  for(const name of [GITHUB_CHAT_PAIRING_FILE,GITHUB_CHAT_TOKEN_FILE,GITHUB_CHAT_ENROLLMENT_CLAIM_FILE]){
    try{await readPrivateRelayFile(path.join(root,name));await fs.rename(path.join(root,name),path.join(archive,name));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

export function githubChatInboxBody({relayId,clientId,operatorUserId}){
  const example={schema:'metaengine.github-chat-request.v1',relay_id:relayId,client_id:clientId,method:'STATUS',params:{}};
  return `Private METAENGINE client and PC command inbox.\n\n`+
    `Paired client: ${clientId}\nRelay: ${relayId}\nAuthorized GitHub user ID: ${operatorUserId}\n\n`+
    `Chat agents: post a NEW issue comment using the exact marker and JSON below. Read the client's reply comments. Do not edit or replay commands after an uncertain result. `+
    `The paired local PostgreSQL owns commands, shared desktop leases and receipts; this repository only delivers requests and results.\n\n`+
    `${GITHUB_CHAT_REQUEST_MARKER}\n${JSON.stringify(example)}\n\n`+
    `Methods: STATUS and CAPABILITIES use {}; COMMAND_SUBMIT uses {"action":"...","payload":{...}}; `+
    `COMMAND_LOOKUP uses {"request_id":"<UUID returned for the original comment>"}; COMMAND_RECEIPT uses {"command_id":"<UUID>"}; `+
    `GOAL_SUBMIT uses {"objective":"<up to 480 characters>"}; GOAL_PROGRESS and GOAL_PROOF use {"request_id":"<UUID>"}; REVOKE uses {}. `+
    `Read CAPABILITIES before actions. Screenshots are exported only to this private repository. `+
    `REVOKE ends this grant persistently and fences queued chat commands; already admitted goals retain their existing PostgreSQL lifecycle. `+
    `Control is enabled until local or chat revocation, without per-action prompts. Credentials must never be posted here.`;
}

// Token is supplied ONLY in the isolated local form. It never enters a chat,
// shell command line, Browser state projection, log or repository file.
export async function enrollInstalledGithubChat({userDataPath,clientId,localProvider,safeStorage,
  repository,token,fetchImpl=globalThis.fetch,shouldContinue=()=>true}={}){
  if(localProvider!==true||!/^[A-Za-z0-9._:-]{3,160}$/.test(clientId||''))fail('local_client_required');
  if(typeof repository!=='string'||repository.length>200||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repository)
      ||typeof token!=='string'||!/^\S{20,512}$/.test(token))fail('input_invalid');
  if(!safeStorage?.isEncryptionAvailable?.()||typeof safeStorage.encryptString!=='function'
      ||safeStorage.getSelectedStorageBackend?.()==='basic_text')fail('secure_storage_required');
  const root=await assertPhysicalDirectory(userDataPath);
  if(shouldContinue()!==true)fail('window_closed');
  await retireRevokedPairing(root,clientId);
  for(const name of [GITHUB_CHAT_PAIRING_FILE,GITHUB_CHAT_TOKEN_FILE,GITHUB_CHAT_ENROLLMENT_CLAIM_FILE]){
    try{await fs.lstat(path.join(root,name));fail('existing_pairing_retained');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const check=()=>{if(shouldContinue()!==true)fail('window_closed');};
  const api=async(endpoint,{method='GET',body=null}={})=>{
    check();
    const response=await fetchImpl('https://api.github.com'+endpoint,{method,redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(15_000),headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,
        'x-github-api-version':'2026-03-10',...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)fail('github_access_unconfirmed');
    // These fixed account/repository/issue endpoints have small metadata bodies.
    if(Number(response.headers.get('content-length')||0)>128*1024)fail('response_invalid');
    const text=await response.text();if(Buffer.byteLength(text)>128*1024)fail('response_invalid');
    check();return JSON.parse(text);
  };
  const account=await api('/user');
  if(!Number.isSafeInteger(account.id)||account.id<=0||account.type!=='User')fail('user_identity_unverified');
  const repo=await api('/repos/'+repository);
  if(repo.private!==true||!Number.isSafeInteger(repo.id)||repo.id<=0
      ||String(repo.full_name||'').toLowerCase()!==repository.toLowerCase()||repo.has_issues!==true)fail('private_repository_required');
  const encrypted=Buffer.from(safeStorage.encryptString(token));
  if(!encrypted.length||encrypted.length>4096)fail('encrypted_credential_unverified');
  const relayId=randomUUID();
  check();
  await writeExclusive(path.join(root,GITHUB_CHAT_ENROLLMENT_CLAIM_FILE),JSON.stringify({
    schema:'metaengine.github-chat-enrollment-claim.v1',relay_id:relayId,client_id:clientId,
    repository:repo.full_name,repository_id:repo.id,operator_user_id:account.id,automatic_retry_allowed:false})+'\n');
  const issue=await api(`/repos/${repo.full_name}/issues`,{method:'POST',body:{
    title:`METAENGINE client control — ${clientId}`,
    body:githubChatInboxBody({relayId,clientId,operatorUserId:account.id}),
  }});
  if(!Number.isSafeInteger(issue.number)||issue.number<=0||issue.state!=='open'
      ||issue.user?.id!==account.id||issue.pull_request)fail('inbox_unverified');
  const pairing={schema:'metaengine.github-chat-pairing.v1',relay_id:relayId,client_id:clientId,
    repository:repo.full_name,repository_id:repo.id,issue_number:issue.number,
    operator_user_ids:[account.id],publisher_user_id:account.id,after_comment_id:0,
    permissions:['OBSERVE','CONTROL','GOALS'],expires_at:'9999-12-31T23:59:59.999Z',owner_action:'ENABLE_GITHUB_CHAT_CONTROL'};
  // A partial write is retained; never overwrite another token or silently
  // repeat issue creation/registration after a possibly committed attempt.
  check();await writeExclusive(path.join(root,GITHUB_CHAT_TOKEN_FILE),encrypted);
  check();await writeExclusive(path.join(root,GITHUB_CHAT_PAIRING_FILE),JSON.stringify(pairing,null,2)+'\n');
  return {state:'PAIRED',repository:repo.full_name,issue_number:issue.number,relay_id:relayId,
    token_returned:false,per_action_prompts:false,authority_effect:false};
}

export async function showInstalledGithubChatSetup({BrowserWindow,ipcMain,userDataPath,clientId,localProvider,safeStorage}={}){
  if(localProvider!==true)fail('local_client_required');
  const win=new BrowserWindow({width:640,height:650,minWidth:560,minHeight:560,show:false,
    title:'METAENGINE — Управление из чата',autoHideMenuBar:true,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
      partition:'github-chat-setup-'+randomUUID(),
      preload:fileURLToPath(new URL('./github-chat-setup-preload.cjs',import.meta.url))}});
  win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  const channel='metaengine:github-chat-setup:connect';
  let claimed=false,closed=false,receipt=null,resolve;
  const completed=new Promise(done=>{resolve=done;});
  const current=event=>!closed&&!win.isDestroyed()&&event.sender.id===win.webContents.id&&event.senderFrame===win.webContents.mainFrame;
  ipcMain.handle(channel,async(event,args)=>{
    if(!current(event)||claimed)return{state:'BLOCKED',reason:'ATTEMPT_ALREADY_CLAIMED'};
    if(!args||Object.keys(args).length!==2||typeof args.repository!=='string'||typeof args.token!=='string')return{state:'BLOCKED',reason:'INPUT_INVALID'};
    claimed=true;
    try{
      receipt=await enrollInstalledGithubChat({userDataPath,clientId,localProvider,safeStorage,
        repository:args.repository,token:args.token,shouldContinue:()=>current(event)});
      return receipt;
    }catch{return{state:'BLOCKED',reason:'CONNECTION_UNCONFIRMED_NO_AUTOMATIC_RETRY'};}
  });
  win.on('closed',()=>{closed=true;ipcMain.removeHandler(channel);resolve(receipt);});
  try{await win.loadFile(fileURLToPath(new URL('./github-chat-setup.html',import.meta.url)));win.show();}
  catch(error){win.destroy();throw error;}
  return completed;
}
