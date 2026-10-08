import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { enrollInstalledGithubChat,GITHUB_CHAT_ENROLLMENT_CLAIM_FILE,githubChatInboxBody } from '../src/github-chat-setup.mjs';
import { GITHUB_CHAT_PAIRING_FILE,GITHUB_CHAT_TOKEN_FILE,startInstalledGithubChatRelay,revokeInstalledGithubChatPairing } from '../src/github-chat-relay-bootstrap.mjs';
import { GithubChatRelayJournal,readPrivateRelayFile } from '../src/github-chat-relay-journal.mjs';
import { normalizeGithubChatPairing,parseGithubChatRequest } from '../src/github-chat-relay.mjs';
import { pairing,request } from './fixtures/github-chat-relay.mjs';

const secret='test-only-token-not-a-real-credential';
const storage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test_encrypted',
  encryptString:()=>Buffer.from('test-encrypted-opaque-credential'),decryptString:()=>secret};
async function fixture(t,overrides={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'github-chat-enrollment-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});
    if(overrides.hook){const result=await overrides.hook(url,init);if(result)return result;}
    if(url==='https://api.github.com/user')return Response.json({id:18,type:'User'});
    if(url==='https://api.github.com/repos/fixture/private-control')return Response.json({
      id:12345,private:true,full_name:'fixture/private-control',has_issues:true,default_branch:'main',...overrides.repo});
    if(url.endsWith('/issues')&&init.method==='POST')return Response.json({number:7,state:'open',user:{id:18}});
    if(url.endsWith('/issues/7'))return Response.json({number:7,state:'open'});
    if(url.endsWith('/comments?per_page=100&page=1'))return Response.json([]);
    assert.fail('unexpected enrollment endpoint: '+url);
  };
  const input={userDataPath:root,clientId:pairing.client_id,localProvider:true,safeStorage:storage,
    repository:pairing.repository,token:secret,fetchImpl};
  return{root,calls,input};
}

test('local form enrolls a pinned private inbox, encrypts token, and teaches chat the exact binding',async t=>{
  const f=await fixture(t);
  const result=await enrollInstalledGithubChat(f.input);
  assert.equal(result.state,'PAIRED');assert.equal(result.per_action_prompts,false);
  assert.equal(JSON.stringify(result).includes(secret),false);
  const config=normalizeGithubChatPairing(JSON.parse((await readPrivateRelayFile(path.join(f.root,GITHUB_CHAT_PAIRING_FILE))).toString()));
  assert.equal(config.relay_id,result.relay_id);assert.equal(config.client_id,pairing.client_id);
  assert.deepEqual(config.operator_user_ids,[18]);assert.equal(config.repository_id,12345);
  assert.deepEqual(config.permissions,['OBSERVE','CONTROL','GOALS']);
  assert.equal((await readPrivateRelayFile(path.join(f.root,GITHUB_CHAT_TOKEN_FILE))).toString(),'test-encrypted-opaque-credential');
  const posted=JSON.parse(f.calls.find(c=>c.init.method==='POST').init.body);
  assert.ok(posted.body.includes(config.relay_id));assert.ok(posted.body.includes('COMMAND_RECEIPT'));
  assert.equal(posted.body.includes(secret),false);
  for(const call of f.calls){assert.equal(call.init.redirect,'error');assert.equal(call.init.headers.authorization,`Bearer ${secret}`);}
  const relay=await startInstalledGithubChatRelay({...f.input,control:{status:async()=>({}),capabilities:async()=>({}),
    commandSubmit:async()=>assert.fail('startup delivered a command'),commandLookup:async()=>({}),commandReceipt:async()=>({}),
    goalSubmit:async()=>({}),goalProgress:async()=>({}),goalProof:async()=>({})}});
  t.after(()=>relay.stop());assert.equal(relay.snapshot().state,'ACTIVE');
  await fs.writeFile(path.join(f.root,GITHUB_CHAT_TOKEN_FILE),'changed-encrypted-token',{mode:0o600});
  await assert.rejects(relay.assertCommandGrant({issued_by:`github-chat:${config.relay_id}:18`,action:'POLL'}),/pairing_revoked/);
});

test('pairing refuses hosted mode, unencrypted storage, public repository and missing issue support before remote mutation',async t=>{
  for(const override of [{localProvider:false},{safeStorage:{...storage,getSelectedStorageBackend:()=> 'basic_text'}},
    {safeStorage:{...storage,isEncryptionAvailable:()=>false}}]){
    const f=await fixture(t);await assert.rejects(enrollInstalledGithubChat({...f.input,...override}),/github_chat_setup_/);
    assert.equal(f.calls.length,0);
  }
  for(const repo of [{private:false},{has_issues:false},{id:999,full_name:'other/private-control'}]){
    const f=await fixture(t,{repo});await assert.rejects(enrollInstalledGithubChat(f.input),/private_repository_required/);
    assert.equal(f.calls.some(c=>c.init.method==='POST'),false);
  }
});

test('lost issue-creation response leaves a durable claim and refuses a second remote mutation',async t=>{
  const f=await fixture(t,{hook:async(url,init)=>{if(init.method==='POST')throw new Error('fixture_response_lost');}});
  await assert.rejects(enrollInstalledGithubChat(f.input),/fixture_response_lost/);
  const claim=JSON.parse((await readPrivateRelayFile(path.join(f.root,GITHUB_CHAT_ENROLLMENT_CLAIM_FILE))).toString());
  assert.equal(claim.automatic_retry_allowed,false);assert.equal(JSON.stringify(claim).includes(secret),false);
  const count=f.calls.length;
  await assert.rejects(enrollInstalledGithubChat(f.input),/existing_pairing_retained/);
  assert.equal(f.calls.length,count);
});

test('local window close before or during GitHub read cannot create an inbox or token',async t=>{
  const f=await fixture(t);await assert.rejects(enrollInstalledGithubChat({...f.input,shouldContinue:()=>false}),/window_closed/);
  assert.equal(f.calls.length,0);
  let current=true;
  const g=await fixture(t,{hook:async()=>{current=false;}});
  await assert.rejects(enrollInstalledGithubChat({...g.input,shouldContinue:()=>current}),/window_closed/);
  assert.equal(g.calls.some(c=>c.init.method==='POST'),false);
  assert.deepEqual(await fs.readdir(g.root),[]);
});

test('active pairing is retained; explicit re-enrollment archives only a persistently revoked grant',async t=>{
  const f=await fixture(t);
  const first=await enrollInstalledGithubChat(f.input);
  await assert.rejects(enrollInstalledGithubChat(f.input),/existing_pairing_retained/);
  const journal=await new GithubChatRelayJournal(path.join(f.root,'github-chat-delivery-journal')).initialize();
  await journal.revoke(first.relay_id);
  const second=await enrollInstalledGithubChat(f.input);
  assert.notEqual(second.relay_id,first.relay_id);
  const archive=(await fs.readdir(f.root)).find(name=>name.startsWith('github-chat-retired-'));
  assert.ok(archive);
  assert.equal(JSON.parse((await readPrivateRelayFile(path.join(f.root,archive,GITHUB_CHAT_PAIRING_FILE))).toString()).relay_id,first.relay_id);
  assert.equal(await journal.revoked(first.relay_id),true);
});

test('bootstrap with no pairing makes no network request and cannot invent an authorized client',async t=>{
  const f=await fixture(t);
  assert.equal(await startInstalledGithubChatRelay(f.input),null);assert.equal(f.calls.length,0);
  await fs.writeFile(path.join(f.root,GITHUB_CHAT_PAIRING_FILE),JSON.stringify(pairing),{mode:0o600});
  await assert.rejects(startInstalledGithubChatRelay({...f.input,clientId:'client_wrong'}),/client_mismatch/);
  await assert.rejects(startInstalledGithubChatRelay({...f.input,localProvider:false}),/local_postgres_required/);
  assert.equal(f.calls.length,0);
});

test('inbox example can be parsed by the paired relay without owner copying local identifiers',()=>{
  const body=githubChatInboxBody({relayId:pairing.relay_id,clientId:pairing.client_id,operatorUserId:18});
  const marker='<!-- metaengine-chat-request:v1 -->\n';
  const example=body.slice(body.indexOf(marker)).split('\n\n')[0];
  const parsed=parseGithubChatRequest(request('STATUS',{}, {body:example}),pairing);
  assert.equal(parsed.method,'STATUS');assert.deepEqual(parsed.params,{});
});

test('local revocation survives an unavailable GitHub transport and can renew from the interface',async t=>{
  const f=await fixture(t);
  const first=await enrollInstalledGithubChat(f.input),count=f.calls.length;
  await assert.rejects(revokeInstalledGithubChatPairing({userDataPath:f.root,clientId:'client_other'}),/client_mismatch/);
  const revoked=await revokeInstalledGithubChatPairing(f.input);
  assert.equal(revoked.state,'REVOKED');assert.equal(f.calls.length,count);
  const journal=await new GithubChatRelayJournal(path.join(f.root,'github-chat-delivery-journal')).initialize();
  assert.equal(await journal.revoked(first.relay_id),true);
  const second=await enrollInstalledGithubChat(f.input);
  assert.notEqual(second.relay_id,first.relay_id);
});
