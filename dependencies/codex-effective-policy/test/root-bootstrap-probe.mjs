#!/usr/bin/env node
// Root CLI bootstrap checks. All homes, env files, prompts and HTTP responses
// are synthetic fixtures. This does not qualify Windows/native custody.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {setTimeout as delay} from 'node:timers/promises';

const POLICY='metaengine.effective_policy.v1';
const ACCEPT='metaengine.effective_policy.accept.v1';
const UPSTREAM='3b01b36fa5eb96ba82a776bd3c2fc57f8969181f';
const HOLD_MS=250;
const PROMPT=Buffer.from('  METAENGINE root bootstrap witness Ω\npreserve trailing whitespace  \n','utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const PROMPT_SHA=hash(PROMPT);
const options=argv=>{
  const result={inspectOnly:false};
  while(argv.length){const flag=argv.shift();if(flag==='--inspect-only')result.inspectOnly=true;else if(flag==='--binary')result.binary=argv.shift();else if(flag==='--evidence-root')result.evidenceRoot=argv.shift();else throw Error('usage: root-bootstrap-probe.mjs --binary ABSOLUTE_ROOT_CODEX [--evidence-root DIR] [--inspect-only]');}
  assert.ok(path.isAbsolute(result.binary??''),'root binary must be an absolute path');
  assert.ok(process.platform==='linux','this fixture qualifies only the Linux root CLI');
  if(result.evidenceRoot)assert.ok(path.isAbsolute(result.evidenceRoot),'evidence root must be absolute');
  return result;
};
async function digest(file){const out=createHash('sha256');for await(const chunk of createReadStream(file))out.update(chunk);return out.digest('hex');}
function childEnvironment(profile,home,temp){
  const env={};const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','LANG','LC_ALL','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE']);
  for(const[key,value]of Object.entries(process.env))if(allowed.has(key.toUpperCase()))env[key]=value;
  return {...env,HOME:profile,USERPROFILE:profile,CODEX_HOME:home,
    APPDATA:path.join(profile,'appdata'),LOCALAPPDATA:path.join(profile,'localappdata'),TEMP:temp,TMP:temp,TMPDIR:temp,
    NO_COLOR:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
}
function killOwnedTestGroup(child){if(!child.pid)return;try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const sourceIdentity=home=>`sha256:${hash(JSON.stringify([path.join(home,'config.toml'),null]))}`;
function validatePolicy(event,nonce,mode,workspace,expectedHome){
  assert.equal(event.type,POLICY);assert.equal(event.nonce,nonce);assert.equal(event.mode,mode);
  assert.match(event.context_id??'',/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(event.policy?.upstream_commit,UPSTREAM);
  assert.equal(event.policy?.stage,'THREAD_START_RESOLVED_BEFORE_SPAWN');
  assert.equal(path.resolve(event.policy?.cwd??''),workspace);
  assert.equal(event.policy?.load_mode?.ignore_user_config,true);
  assert.equal(event.policy?.load_mode?.ignore_user_and_project_exec_policy_rules,true);
  assert.equal(event.policy?.load_mode?.ignore_managed_requirements,false,'the actual managed policy must remain enabled');
  const users=event.policy.layers.filter(layer=>layer.name==='user');
  assert.ok(users.length>0,'actual User source identity missing');
  assert.ok(users.every(layer=>layer.loader_ignored===true&&layer.content_scope==='IGNORED_EMPTY_PLACEHOLDER'));
  assert.ok(users.every(layer=>layer.source.identity_generation===sourceIdentity(expectedHome)),'resolved home does not match the observed root bootstrap');
}

async function scenario({spec,opts,evidence,binarySha}){
  const directory=path.join(evidence,spec.name);const profileA=path.join(directory,'profile-a');const profileB=path.join(directory,'profile-b');
  const homeA=path.join(profileA,'.codex');const homeB=path.join(profileB,'.codex');const forged=path.join(directory,'forged-codex-home');
  const workspace=path.join(directory,'workspace');const temp=path.join(directory,'temp');
  for(const dir of[directory,profileA,profileB,homeA,homeB,forged,workspace,temp,path.join(profileA,'appdata'),path.join(profileA,'localappdata')])await fs.mkdir(dir,{recursive:true,mode:0o700});
  const nonce=randomBytes(32).toString('hex');const canary=`synthetic-bootstrap-${randomBytes(16).toString('hex')}`;
  const env=childEnvironment(profileA,homeA,temp);
  if(spec.implicitHome)delete env.CODEX_HOME;
  const initialEnvSha=hash(JSON.stringify(Object.fromEntries(Object.entries(env).sort())));
  const initialHome=homeA;const expectedHome=spec.implicitHome?homeB:homeA;
  if(spec.dotenv){
    const fields=[`CODEX_HOME=${JSON.stringify(forged)}`,'CODEX_EXEC_SERVER_URL="none"','codex_filtered_case_sentinel="MUST_NOT_BECOME_CODEX_CONFIGURATION"'];
    if(spec.redirectHome)fields.push(`HOME=${JSON.stringify(profileB)}`);
    if(spec.mockAccept)fields.push(`METAENGINE_TEST_SENTINEL=${JSON.stringify(canary)}`);
    await fs.writeFile(path.join(homeA,'.env'),fields.join('\n')+'\n',{mode:0o600});
  }
  // Configuration is intentionally ignored; no authentication or user policy is supplied.
  await fs.writeFile(path.join(homeA,'config.toml'),'developer_instructions="SYNTHETIC_IGNORED_CONFIG"\n',{mode:0o600});
  const mode=spec.inspect?'inspect':'execute';const deadlineMs=spec.deadlineCancel?6000:30000;
  const launchedAt=Date.now();const deadlineAt=launchedAt+deadlineMs;
  const state={phase:'BOOTSTRAP_BEFORE_POLICY',ackCount:0,promptBytesSent:0,ackFrameSha256:null,stdinPayloadSha256:null,policyAt:null,ackAt:null,cancelledAt:null,deadlineAt};
  const observations=[];const capturedPromptHashes=[];
  const record=(request,websocket=false)=>{
    const target=new URL(request.url??'/','http://127.0.0.1');const canaryHeader=request.headers['x-metaengine-bootstrap'];
    const row={at:Date.now(),phase:state.phase,method:request.method,path:target.pathname,websocket,
      model_request:websocket||/(?:^|\/)responses(?:\/|$)|(?:^|\/)chat\/completions(?:\/|$)/.test(target.pathname),
      synthetic_header_sha256:typeof canaryHeader==='string'?hash(canaryHeader):null};
    observations.push(row);return row;
  };
  const sse=[
    {type:'response.created',response:{id:'resp-bootstrap-fixture'}},
    {type:'response.output_item.done',item:{type:'message',role:'assistant',id:'msg-bootstrap-fixture',content:[{type:'output_text',text:'bootstrap mock complete'}]}},
    {type:'response.completed',response:{id:'resp-bootstrap-fixture',usage:{input_tokens:0,input_tokens_details:null,output_tokens:0,output_tokens_details:null,total_tokens:0}}},
  ].map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const server=http.createServer((request,response)=>{
    const row=record(request);let chunks=[];let length=0;
    request.on('data',chunk=>{length+=chunk.length;if(length>1024*1024){request.destroy();return;}chunks.push(chunk);});
    request.on('end',()=>{
      if(row.model_request){
        if(!spec.mockAccept||state.phase!=='ACK_AND_PROMPT_SENT'){response.writeHead(503,{'content-type':'application/json'});response.end('{"error":"pre-ACK or unauthorized mock request"}');return;}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{row.body_decode_error=true;response.writeHead(400);response.end();return;}
        for(const item of body.input??[])if(item.role==='user')for(const content of item.content??[])if(typeof content.text==='string'&&content.text===PROMPT.toString('utf8'))capturedPromptHashes.push(hash(Buffer.from(content.text,'utf8')));
        response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});response.end(sse);
      }else{response.writeHead(200,{'content-type':'application/json'});response.end('{"models":[],"data":[]}');}
    });
  });
  server.on('upgrade',(request,socket)=>{record(request,true);socket.destroy();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const provider=`model_providers.bootstrap_mock={name="Bootstrap fixture",base_url=${JSON.stringify(baseUrl)},wire_api="responses",requires_openai_auth=false,supports_websockets=true,request_max_retries=0,stream_max_retries=0,websocket_connect_timeout_ms=1000,env_http_headers={X-Metaengine-Bootstrap="METAENGINE_TEST_SENTINEL"}}`;
  const args=['-a','never','--no-daemon','-c','windows.sandbox="elevated"','-c','sandbox_workspace_write.writable_roots=[]','-c','sandbox_workspace_write.network_access=false',
    'exec','--json','--color','never','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-C',workspace,
    '-c','model_provider="bootstrap_mock"','-c',provider,'-c','check_for_update_on_startup=false','--model','gpt-5.1-codex','--metaengine-effective-policy',nonce,
    ...(spec.inspect?['--metaengine-policy-only']:['--metaengine-prompt-sha256',PROMPT_SHA]),'-'];
  const binding={binary_sha256:binarySha,argv:args,initial_environment_sha256:initialEnvSha,initial_home:initialHome,expected_resolved_home:expectedHome,
    nonce,original_prompt_sha256:PROMPT_SHA,original_prompt_bytes:PROMPT.length,original_deadline_at:new Date(deadlineAt).toISOString(),deadline_ms:deadlineMs,
    mode,required_on_models_policy_changed:false,native_process_custody_qualified:false,windows_binary_qualified:false};
  await fs.writeFile(path.join(directory,'launch-binding.json'),JSON.stringify(binding,null,2)+'\n',{mode:0o600});
  const child=spawn(opts.binary,args,{cwd:workspace,env,shell:false,detached:true,stdio:['pipe','pipe','pipe']});
  const stdout=[];const stderr=[];const events=[];const decoder=new StringDecoder('utf8');let line='';let outputBytes=0;let stderrBytes=0;let policy;let closed=false;let streamError;
  let resolvePolicy,rejectPolicy;const policyPromise=new Promise((resolve,reject)=>{resolvePolicy=resolve;rejectPolicy=reject;});policyPromise.catch(()=>{});
  const completion=new Promise((resolve,reject)=>{
    child.once('error',error=>{streamError=error;rejectPolicy(error);reject(error);});
    child.once('close',(code,signal)=>{closed=true;if(!policy)rejectPolicy(Error('root CLI closed before policy event'));resolve({code,signal});});
  });
  child.stdin.on('error',error=>{streamError=error;killOwnedTestGroup(child);});
  child.stdout.on('data',chunk=>{
    stdout.push(chunk);outputBytes+=chunk.length;if(outputBytes>512*1024){streamError=Error('stdout bound exceeded');killOwnedTestGroup(child);return;}
    line+=decoder.write(chunk);let newline;
    while((newline=line.indexOf('\n'))>=0){const row=line.slice(0,newline);line=line.slice(newline+1);if(!row.trim())continue;
      try{const event=JSON.parse(row);events.push({at:Date.now(),phase:state.phase,type:event.type});
        if(event.type===POLICY){if(policy)throw Error('duplicate policy event');assert.ok(Buffer.byteLength(row)<=65536);policy=event;state.policyAt=Date.now();state.phase='POLICY_HELD_NO_ACK';resolvePolicy(event);}
        else if((event.type==='thread.started'||event.type?.startsWith('turn.'))&&state.ackCount===0)throw Error('thread or turn before ACK');
      }catch(error){streamError=error;rejectPolicy(error);killOwnedTestGroup(child);}
    }
  });
  child.stderr.on('data',chunk=>{stderr.push(chunk);stderrBytes+=chunk.length;if(stderrBytes>512*1024){streamError=Error('stderr bound exceeded');killOwnedTestGroup(child);}});
  const deadlineTimer=setTimeout(()=>{state.cancelledAt=Date.now();state.phase='CANCELLED_AT_ORIGINAL_DEADLINE';killOwnedTestGroup(child);},Math.max(1,deadlineAt-Date.now()));
  try{
    const event=await policyPromise;validatePolicy(event,nonce,mode,workspace,expectedHome);
    assert.equal(event.policy.effective.approval_policy,'never');
    assert.equal(hash(PROMPT),binding.original_prompt_sha256);assert.equal(state.deadlineAt,deadlineAt);
    if(spec.inspect){const result=await completion;assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(state.ackCount,0);assert.equal(state.promptBytesSent,0);}
    else{
      await delay(HOLD_MS);assert.equal(closed,false,'execute must remain behind the ACK barrier');
      assert.equal(observations.length,0,'no HTTP/model/prewarm activity before ACK');
      assert.ok(!events.some(row=>row.type==='thread.started'||row.type?.startsWith('turn.')));
      if(spec.deadlineCancel){const result=await completion;assert.equal(result.signal,'SIGKILL');assert.ok(state.cancelledAt>=deadlineAt);assert.equal(state.ackCount,0);assert.equal(state.promptBytesSent,0);}
      else{
        assert.ok(spec.mockAccept,'a valid ACK is allowed only for the explicitly scoped loopback mock fixture');
        const frame=Buffer.from(JSON.stringify({type:ACCEPT,nonce,context_id:event.context_id})+'\n','utf8');assert.ok(frame.length<=512);
        state.ackAt=Date.now();assert.ok(state.ackAt<deadlineAt);state.ackCount=1;state.promptBytesSent=PROMPT.length;state.phase='ACK_AND_PROMPT_SENT';
        const payload=Buffer.concat([frame,PROMPT]);state.ackFrameSha256=hash(frame);state.stdinPayloadSha256=hash(payload);
        child.stdin.end(payload);
        const result=await completion;assert.equal(result.code,0);assert.equal(result.signal,null);
        assert.ok(observations.some(row=>row.model_request),'loopback fixture never observed its post-ACK request');
        assert.ok(observations.filter(row=>row.model_request).every(row=>row.at>=state.ackAt&&row.phase==='ACK_AND_PROMPT_SENT'));
        assert.ok(observations.filter(row=>row.model_request).some(row=>row.synthetic_header_sha256===hash(canary)),'.env non-CODEX canary was not used by the actual root process');
        assert.ok(capturedPromptHashes.includes(PROMPT_SHA),'the original prompt bytes were not preserved into the mock request');
      }
    }
    assert.ifError(streamError);
    assert.ok(!Buffer.concat(stdout).includes(Buffer.from(canary)),'synthetic dotenv value leaked into CLI stdout instead of remaining private bootstrap state');
    assert.ok(!observations.some(row=>row.phase!=='ACK_AND_PROMPT_SENT'),'pre-ACK/root bootstrap HTTP or WebSocket activity observed');
    assert.equal(hash(PROMPT),PROMPT_SHA);assert.equal(state.ackCount,spec.mockAccept?1:0);assert.equal(state.deadlineAt,binding.deadline_ms+launchedAt);
    assert.ok(await exists(path.join(expectedHome,'tmp','arg0')),'bootstrap alias root missing from actual resolved home');
    assert.equal(await exists(path.join(forged,'tmp','arg0')),false,'dotenv CODEX_HOME escaped its filter');
    if(spec.implicitHome)assert.equal(await exists(path.join(homeA,'tmp','arg0')),false,'HOME redirection did not change the default home bootstrap');
    for(const home of[homeA,homeB,forged])for(const relative of['app-server-control/app-server-control.sock','app-server-daemon/daemon.pid','app-server-daemon/daemon-updater.pid'])assert.equal(await exists(path.join(home,relative)),false,'root exec unexpectedly used shared daemon state');
    return {name:spec.name,mode,policy_events:1,ack_count:state.ackCount,original_prompt_sha256:PROMPT_SHA,prompt_bytes_sent:state.promptBytesSent,
      nonce,context_id:event.context_id,original_deadline_at:binding.original_deadline_at,pre_ack_http_requests:0,pre_ack_websocket_requests:0,
      post_ack_mock_model_requests:observations.filter(row=>row.model_request).length,home_source_identity_matches:true,
      dotenv_codeX_keys_filtered:!!spec.dotenv,non_codeX_home_redirection_observed:!!spec.implicitHome,non_codeX_canary_header_observed:!!spec.mockAccept,
      cancelled_at_original_deadline:!!spec.deadlineCancel,shared_daemon_artifacts_absent:true};
  }finally{
    // Fence/terminate first: EOF after a valid ACK and complete task activates work.
    clearTimeout(deadlineTimer);if(!closed){killOwnedTestGroup(child);child.stdin.destroy();await completion.catch(()=>{});}
    await fs.writeFile(path.join(directory,'stdout.jsonl'),Buffer.concat(stdout),{mode:0o600});
    await fs.writeFile(path.join(directory,'stderr.log'),Buffer.concat(stderr),{mode:0o600});
    await fs.writeFile(path.join(directory,'observations.json'),JSON.stringify({binding,state,events,http:observations,captured_prompt_sha256:capturedPromptHashes},null,2)+'\n',{mode:0o600});
    await new Promise(resolve=>server.close(resolve));
  }
}

async function main(){
  const opts=options(process.argv.slice(2));const binarySha=await digest(opts.binary);const evidenceRoot=opts.evidenceRoot??os.tmpdir();
  await fs.mkdir(evidenceRoot,{recursive:true,mode:0o700});const evidence=await fs.mkdtemp(path.join(evidenceRoot,'metaengine-root-bootstrap-'));await fs.chmod(evidence,0o700);
  const specs=[
    {name:'explicit_home_no_dotenv',inspect:true},
    {name:'dotenv_codeX_keys_filtered',inspect:true,dotenv:true},
    {name:'dotenv_non_codeX_HOME_changes_implicit_home',inspect:true,dotenv:true,redirectHome:true,implicitHome:true},
    ...(!opts.inspectOnly?[
      {name:'dotenv_non_codeX_canary_after_ACK_loopback_mock',dotenv:true,mockAccept:true},
      {name:'held_execute_cancelled_at_original_deadline',deadlineCancel:true},
    ]:[]),
  ];
  const results=[];
  try{
    for(const spec of specs)results.push(await scenario({spec,opts,evidence,binarySha}));
    assert.equal(await digest(opts.binary),binarySha,'root binary changed during probes');
    const summary={status:opts.inspectOnly?'ROOT_BOOTSTRAP_INSPECT_CHECKS_PASS':'ROOT_BOOTSTRAP_CHECKS_PASS',platform:process.platform,
      binary_kind:'patched root codex',binary_sha256:binarySha,upstream_commit:UPSTREAM,inspect_only:opts.inspectOnly,cases:results,
      original_prompt_sha256:PROMPT_SHA,total_pre_ack_http_requests:0,total_pre_ack_websocket_requests:0,
      post_ack_transport:'LOOPBACK MOCK ONLY; no actual model or external API',
      actual_user_policy_changed:false,native_process_custody_qualified:false,windows_binary_qualified:false,evidence_directory:evidence};
    await fs.writeFile(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(summary)+'\n');
  }catch(error){
    const failure={status:'ROOT_BOOTSTRAP_CHECKS_FAILED',completed_cases:results,reason:String(error.message).slice(0,1000),evidence_directory:evidence};
    await fs.writeFile(path.join(evidence,'failure.json'),JSON.stringify(failure,null,2)+'\n',{mode:0o600});process.stderr.write(JSON.stringify(failure)+'\n');process.exitCode=1;
  }
}
await main();
