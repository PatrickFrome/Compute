import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { GithubChatRelay,githubChatRequestId,parseGithubChatRequest,normalizeGithubChatPairing,GITHUB_CHAT_REPLY_MARKER } from '../src/github-chat-relay.mjs';
import { harness,request,pairing,commandId,deferred } from './fixtures/github-chat-relay.mjs';

const replies=state=>state.comments.filter(row=>row.body?.startsWith(GITHUB_CHAT_REPLY_MARKER)).map(row=>JSON.parse(row.body.slice(GITHUB_CHAT_REPLY_MARKER.length)));

test('lost GitHub authorization fences queued commands when the next poll observes it',async t=>{
  let revoked=false;
  const f=await harness(t,{fetchHook:async()=>revoked?Response.json({message:'Access denied'},{status:401}):null});
  await f.relay.start({poll:false});revoked=true;
  await assert.rejects(f.relay.tick(),/transport_unavailable/);
  await assert.rejects(f.relay.assertCommandGrant({issued_by:`github-chat:${pairing.relay_id}:18`,action:'NEW_TAB'}),/pairing_revoked/);
  assert.equal(f.state.admissions.length,0);
});

test('GitHub command reaches the existing local PostgreSQL issuer; duplicate delivery and restart never re-admit',async t=>{
  const command=request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{url:'https://example.test/'}});
  const first=await harness(t,{comments:[command]});await first.relay.start({poll:false});await first.relay.tick();
  assert.equal(first.state.admissions.length,1);
  const admission=first.state.admissions[0];
  assert.equal(admission.name,'h205f22_a2_browser_supervisor_issue_native_v1');
  assert.equal(admission.args.p_client_id,pairing.client_id);assert.match(admission.args.p_issued_by,/^github-chat:/);
  assert.equal(replies(first.state)[0].result.command_id,commandId);
  first.relay.stop();
  const restarted=await harness(t,{directory:first.directory,comments:[command]});await restarted.relay.start({poll:false});
  assert.equal(restarted.state.admissions.length,0);assert.equal(replies(restarted.state)[0].result.command_id,commandId);
});

test('computer actions use the computer RPC and cannot fabricate a lease or execute directly',async t=>{
  const h=await harness(t,{comments:[request('COMMAND_SUBMIT',{action:'COMPUTER_ACTION',payload:{
    action:'UIA_INVOKE',agent_id:'agent_test-fixture',target:{fixture:true},args:{runtime_id:[1]},
  }})]});await h.relay.start({poll:false});
  assert.equal(h.state.admissions[0].name,'h205f22_a2_browser_supervisor_issue_computer_v1');
  assert.equal(replies(h.state)[0].result.execution_authority,false);
  for(const key of ['effect_binding','lease','context','command_id']){
    const denied=await harness(t,{comments:[request('COMMAND_SUBMIT',{action:'COMPUTER_ACTION',payload:{
      agent_id:'agent_test-fixture',[key]:{fake:true},
    }})]});await denied.relay.start({poll:false});assert.equal(denied.state.admissions.length,0);
  }
});

test('untrusted comments, bots, old messages and ordinary discussion never become commands',async t=>{
  const h=await harness(t,{comments:[request('STATUS',{}, {user:{id:50,type:'User'}}),
    request('STATUS',{}, {user:{id:18,type:'Bot'},id:102}),request('STATUS',{}, {id:99}),
    request('STATUS',{}, {body:'Run a terminal command',id:103})]});await h.relay.start({poll:false});
  assert.equal(h.state.reads,0);assert.equal(replies(h.state).length,0);
});

test('wrong client, relay, issue and edited command are refused without creating a new request identity',async t=>{
  const edited=request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}},{updated_at:'2026-10-08T00:01:00Z'});
  assert.throws(()=>parseGithubChatRequest(edited,pairing),/edited_request_refused/);
  assert.equal(githubChatRequestId(pairing,edited.id),githubChatRequestId(pairing,request().id));
  for(const changed of [
    {...request(),issue_url:'https://api.github.com/repos/fixture/other/issues/7'},
    request('STATUS',{}, {body:request().body.replace(pairing.client_id,'wrong_client')}),
    request('STATUS',{}, {body:request().body.replace(pairing.relay_id,commandId)}),edited,
  ]){
    const h=await harness(t,{comments:[changed]});await h.relay.start({poll:false});assert.equal(h.state.reads,0);assert.equal(h.state.admissions.length,0);
  }
});

test('public repository and wrong publisher identity stop before private observation or writes',async t=>{
  for(const state of [{private:false},{publisherId:90}]){
    const h=await harness(t,{state,comments:[request()]});await assert.rejects(h.relay.start({poll:false}),/private_repository_required|publisher_identity_mismatch/);
    assert.equal(h.state.reads,0);assert.equal(h.state.calls.some(call=>call.init.method==='POST'),false);
  }
});

test('VIEW-only pairing cannot submit a mutation or autonomous goal',async t=>{
  const h=await harness(t,{pairing:{permissions:['OBSERVE']},comments:[request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}}),
    request('GOAL_SUBMIT',{objective:'fixture'}, {id:102}),request('STATUS',{}, {id:103})]});await h.relay.start({poll:false});
  assert.equal(h.state.admissions.length,0);assert.equal(h.state.reads,1);
});

test('revocation in the inbox preempts older commands and survives a process restart',async t=>{
  const comments=[request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}}),request('REVOKE',{}, {id:102})];
  const h=await harness(t,{comments});await h.relay.start({poll:false});assert.equal(h.state.admissions.length,0);
  assert.equal(h.relay.snapshot().state,'REVOKED');
  const next=await harness(t,{directory:h.directory,comments:[]});await assert.rejects(next.relay.start({poll:false}),/pairing_revoked/);
});

test('pending local observation cannot publish its private result after stop',async t=>{
  const started=deferred(),held=deferred();
  const h=await harness(t,{comments:[request()],control:{status:async()=>{started.resolve();return held.promise;}}});
  const running=h.relay.start({poll:false});await started.promise;h.relay.stop();held.resolve({secret:'must stay local'});
  await assert.rejects(running,/pairing_revoked/);assert.equal(replies(h.state).length,0);
  assert.equal(h.state.calls.some(call=>call.init.body?.includes('must stay local')),false);
});

test('local pairing removal and expiration fence an already admitted command',async t=>{
  for(const changed of ['removed','expired']){
    const h=await harness(t);await h.relay.start({poll:false});
    if(changed==='removed')h.state.current=false;else h.state.clock=Date.parse('2100-01-01');
    await assert.rejects(h.relay.assertCommandGrant({action:'NEW_TAB',issued_by:`github-chat:${pairing.relay_id}:18`}),/pairing_revoked/);
  }
});

test('foreign relay and malformed issuer do not pass the execution-time grant check',async t=>{
  const h=await harness(t);await h.relay.start({poll:false});
  for(const issued_by of [`github-chat:${commandId}:18`,`github-chat:${pairing.relay_id}:55`,'github-chat:forged']){
    await assert.rejects(h.relay.assertCommandGrant({action:'NEW_TAB',issued_by}),/command_grant_revoked/);
  }
});

test('a crash after the flushed claim does not re-submit a goal or computer effect',async t=>{
  for(const [method,params] of [['GOAL_SUBMIT',{objective:'fixture'}],['COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}}]]){
    const comment=request(method,params),h=await harness(t,{comments:[comment]});
    const id=githubChatRequestId(pairing,comment.id),hash=createHash('sha256').update(comment.body).digest('hex');
    await h.journal.claim(id,hash);await h.relay.start({poll:false});
    assert.equal(h.state.admissions.length,0);assert.equal(replies(h.state)[0].result.state,'AMBIGUOUS_NO_RETRY');
  }
});

test('a lost reply is redelivered from the durable outcome without admitting another action',async t=>{
  let lost=true;
  const h=await harness(t,{comments:[request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}})],fetchHook:async(url,init)=>{
    if(url.endsWith('/comments')&&init.method==='POST'&&lost){lost=false;throw new Error('lost response');}
  }});
  await assert.rejects(h.relay.start({poll:false}),/lost response/);
  const next=await harness(t,{directory:h.directory,comments:[request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}})]});
  await next.relay.start({poll:false});assert.equal(h.state.admissions.length,1);assert.equal(next.state.admissions.length,0);
  assert.equal(replies(next.state)[0].result.command_id,commandId);
});

test('concurrent ticks share one delivery pass',async t=>{
  const h=await harness(t);await h.relay.start({poll:false});h.state.comments.push(request('COMMAND_SUBMIT',{action:'NEW_TAB',payload:{}}));
  await Promise.all([h.relay.tick(),h.relay.tick(),h.relay.tick()]);assert.equal(h.state.admissions.length,1);
});

test('capture receipt publishes verified image bytes into the pinned private repository and omits local path',async t=>{
  const bytes=Buffer.from('89504e470d0a1a0a0102030405060708090a0b0c','hex'),hash=createHash('sha256').update(bytes).digest('hex');
  const capture={schema:'metaengine.windows-computer-executor.capture.v1',png_path:'private fixture path',png_sha256:hash};
  const h=await harness(t,{comments:[request('COMMAND_RECEIPT',{command_id:commandId})],
    control:{commandReceipt:async()=>({terminal:true,receipt:{result:{result:capture}}})},
    readCapture:async(filename,sha)=>{assert.equal(filename,capture.png_path);assert.equal(sha,hash);return bytes;}});
  await h.relay.start({poll:false});assert.equal(h.state.uploads.length,1);
  const exported=replies(h.state)[0].result.receipt.result.result;
  assert.equal(exported.png_path,undefined);assert.equal(exported.artifact.sha256,hash);
  assert.equal(Buffer.from(h.state.uploads[0].content,'base64').equals(bytes),true);
  assert.equal(h.state.calls.filter(call=>call.init.method!=='GET').every(call=>!call.init.body.includes(capture.png_path)),true);
});

test('revocation while reading capture prevents upload and private reply',async t=>{
  const started=deferred(),held=deferred();
  const h=await harness(t,{comments:[request('COMMAND_RECEIPT',{command_id:commandId})],
    control:{commandReceipt:async()=>({terminal:true,receipt:{result:{result:{
      schema:'metaengine.windows-computer-executor.capture.v1',png_path:'fixture',png_sha256:'a'.repeat(64),
    }}}})},readCapture:async()=>{started.resolve();return held.promise;}});
  const running=h.relay.start({poll:false});await started.promise;h.relay.stop();held.resolve(Buffer.alloc(16));
  await assert.rejects(running,/pairing_revoked/);assert.equal(h.state.uploads.length,0);assert.equal(replies(h.state).length,0);
});

test('pairing rejects arbitrary endpoints, credentials and unsafe repository paths',()=>{
  for(const patch of [{repository:'../private'}, {repository:'fixture/../private'}, {api_url:'https://evil.test'},
    {token:'secret'}, {publisher_user_id:0}, {operator_user_ids:[18,18]}, {permissions:['SHELL']}, {expires_at:123}]){
    assert.throws(()=>normalizeGithubChatPairing({...pairing,...patch}),/pairing_invalid/);
  }
  assert.throws(()=>new GithubChatRelay({pairing}),/dependencies_required/);
});
