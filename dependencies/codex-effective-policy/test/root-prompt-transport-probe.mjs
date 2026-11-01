#!/usr/bin/env node
// Root-CLI transport experiments use disposable homes and a loopback model fixture.
// They are not native Windows process/lease/custody qualification.
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

const POLICY = 'metaengine.effective_policy.v1';
const ACK = 'metaengine.effective_policy.accept.v1';
const UPSTREAM = '3b01b36fa5eb96ba82a776bd3c2fc57f8969181f';
const ORIGINAL_PROMPT = Buffer.from('Transport fixture: Привет λ\r\nRetain this trailing whitespace \t\r\n', 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ORIGINAL_SHA256 = sha256(ORIGINAL_PROMPT);
const HOLD_MS = 200;
const MAX_STDOUT = 1024 * 1024;
const MAX_STDERR = 512 * 1024;
const MAX_HTTP_BODY = 4 * 1024 * 1024;

function options(argv) {
  const value = {legacyRed:false};
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--legacy-red') value.legacyRed = true;
    else if (flag === '--binary' && argv[0]) value.binary = argv.shift();
    else if (flag === '--evidence-root' && argv[0]) value.evidenceRoot = argv.shift();
    else throw new Error('usage: root-prompt-transport-probe.mjs --binary ABSOLUTE_PATH [--evidence-root ABSOLUTE_DIR] [--legacy-red]');
  }
  assert.ok(path.isAbsolute(value.binary ?? ''), 'binary must be an absolute root CLI path');
  if (value.evidenceRoot) assert.ok(path.isAbsolute(value.evidenceRoot), 'evidence root must be absolute');
  return value;
}

async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function childEnvironment(directory, codexHome) {
  const environment = {};
  const allowed = new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','LANG','LC_ALL','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE']);
  for (const [name,value] of Object.entries(process.env)) {
    if (allowed.has(name.toUpperCase())) environment[name] = value;
  }
  return {...environment, HOME:directory, USERPROFILE:directory, CODEX_HOME:codexHome,
    APPDATA:path.join(directory,'appdata'), LOCALAPPDATA:path.join(directory,'localappdata'),
    TEMP:path.join(directory,'temp'), TMP:path.join(directory,'temp'), TMPDIR:path.join(directory,'temp'),
    NO_COLOR:'1', GIT_TERMINAL_PROMPT:'0', GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform === 'win32' ? 'NUL' : '/dev/null'};
}

function fixtureSse() {
  // Matches core_test_support::responses::{ev_response_created,ev_assistant_message,ev_completed}.
  return [
    {type:'response.created',response:{id:'resp_transport_fixture'}},
    {type:'response.output_item.done',item:{type:'message',role:'assistant',id:'msg_transport_fixture',content:[{type:'output_text',text:'Synthetic transport fixture complete.'}]}},
    {type:'response.completed',response:{id:'resp_transport_fixture',usage:{input_tokens:0,input_tokens_details:null,output_tokens:0,output_tokens_details:null,total_tokens:0}}}
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function userTexts(body) {
  return Array.isArray(body?.input) ? body.input
    .filter(item => item.role === 'user' && Array.isArray(item.content))
    .flatMap(item => item.content)
    .filter(span => (span.type === 'input_text' || span.type === 'text') && typeof span.text === 'string')
    .map(span => span.text) : [];
}

function hasThreadOrTurn(state) {
  return state.events.some(event => event.type === 'thread.started' || event.type?.startsWith('turn.'));
}

function assertNoStartup(state) {
  assert.equal(state.requests.length,0,'HTTP/WebSocket/model/prewarm must remain absent before the task bytes qualify');
  assert.equal(state.connections.length,0,'TCP prewarm must remain absent before the task bytes qualify');
  assert.equal(hasThreadOrTurn(state),false,'thread/turn must not start before the task bytes qualify');
}

function mark(state, field) {
  state[field] = Date.now();
  state.timeline.push({name:field,at:state[field],since_launch_ms:state[field]-state.launched_at});
}

async function runScenario(opts, evidence, serverState, baseUrl, scenario) {
  const directory = path.join(evidence,scenario.name);
  const codexHome = path.join(directory,'owned-codex-home');
  const workspace = path.join(directory,'workspace');
  for (const subdir of [directory,codexHome,workspace,...['temp','appdata','localappdata'].map(name=>path.join(directory,name))]) {
    await fs.mkdir(subdir,{recursive:true,mode:0o700});
  }
  const nonce = randomBytes(32).toString('hex');
  const state = {name:scenario.name,directory,nonce,original_prompt_sha256:ORIGINAL_SHA256,
    declared_prompt_sha256:scenario.invalidDigest ? 'Z'.repeat(64) : scenario.wrongDigest ? '0'.repeat(64) : ORIGINAL_SHA256,
    launched_at:Date.now(),policy_at:null,ack_at:null,prompt_at:null,closed_at:null,
    deadline_at:null,deadline_expired:false,requests:[],connections:[],events:[],timeline:[],stdout:[],stderr:[],stdin:[],
    pendingRequests:new Set(),controllerError:null};
  const budget = scenario.deadlineBeforeAck || scenario.deadlineAfterAck ? 3000 : 45000;
  state.deadline_at = state.launched_at + budget;
  // This is the ORIGINAL absolute deadline. No phase replaces/restarts this timer.
  state.timeline.push({name:'launch',at:state.launched_at,since_launch_ms:0},{name:'fixed_deadline',at:state.deadline_at,since_launch_ms:budget});
  const caseBaseUrl = `${baseUrl.replace(/\/v1$/, '')}/case/${nonce}/v1`;
  const websocketEligible = !scenario.success && !opts.legacyRed;
  const args = ['-a','never','--no-daemon','exec','--json','--color','never','--ignore-user-config','--ignore-rules','--ephemeral',
    '--skip-git-repo-check','--sandbox','read-only','-C',workspace,
    '-c','model_provider="mock"',
    '-c',`model_providers.mock={name="TransportFixture",base_url=${JSON.stringify(caseBaseUrl)},wire_api="responses",requires_openai_auth=false,supports_websockets=${websocketEligible}}`,
    '-c','check_for_update_on_startup=false','--model','gpt-5.1-codex','--metaengine-effective-policy',nonce,
    ...(!opts.legacyRed && !scenario.missingDigest ? ['--metaengine-prompt-sha256',state.declared_prompt_sha256] : []),'-'];
  state.argv = args;
  serverState.cases.set(nonce,state);
  serverState.current = state;
  const child = spawn(opts.binary,args,{cwd:workspace,env:childEnvironment(directory,codexHome),shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:process.platform !== 'win32'});
  state.child_pid = child.pid ?? null;
  const decoder = new StringDecoder('utf8');
  let partial = '', stdoutBytes = 0, stderrBytes = 0, closed = false, policy, resolvePolicy, rejectPolicy;
  const policyPromise = new Promise((resolve,reject)=>{resolvePolicy=resolve;rejectPolicy=reject;});
  policyPromise.catch(()=>{});
  const completion = new Promise((resolve,reject)=>{
    child.once('error',error=>{state.controllerError=error.message;rejectPolicy(error);reject(error);});
    child.once('close',(code,signal)=>{
      closed=true;state.closed_at=Date.now();
      if (!policy) rejectPolicy(new Error('root CLI closed before policy event'));
      resolve({code,signal});
    });
  });
  completion.catch(()=>{});
  const terminateOwnedGroup = () => {
    // Fence/terminate first. EOF alone can activate a fully delivered valid task.
    if (!closed) {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid,'SIGKILL');
      } catch(error) { if(error.code!=='ESRCH')state.controllerError=`owned-group termination failed: ${error.code??'unknown'}`; }
    }
    child.stdin.destroy();
  };
  const cancel = reason => {
    if (!state.controllerError) state.controllerError=reason;
    terminateOwnedGroup();
  };
  const deadlineTimer = setTimeout(()=>{
    state.deadline_expired=true;mark(state,'deadline_cancel_at');
    terminateOwnedGroup();
  },Math.max(1,state.deadline_at-Date.now()));
  child.stdin.on('error',error=>{if(error.code!=='EPIPE')cancel(`stdin error: ${error.code??'unknown'}`);});
  child.stdout.on('data',chunk=>{
    state.stdout.push(chunk);stdoutBytes+=chunk.length;
    if(stdoutBytes>MAX_STDOUT){cancel('stdout limit exceeded');return;}
    partial+=decoder.write(chunk);
    let newline;
    while((newline=partial.indexOf('\n'))>=0){
      const line=partial.slice(0,newline);partial=partial.slice(newline+1);
      if(!line.trim())continue;
      try{
        const event=JSON.parse(line);state.events.push(event);
        if(event.type===POLICY){
          assert.ok(!policy,'duplicate policy event');
          assert.equal(state.events.length,1,'policy must be the first JSONL event');
          assert.ok(Buffer.byteLength(line)<=65536,'policy frame exceeds limit');
          assert.equal(event.nonce,nonce);assert.equal(event.mode,'execute');
          assert.equal(event.policy?.schema,'metaengine.codex.effective-policy.v1');
          assert.equal(event.policy?.stage,'THREAD_START_RESOLVED_BEFORE_SPAWN');
          assert.equal(event.policy?.upstream_commit,UPSTREAM);
          assert.match(event.context_id??'',/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
          policy=event;state.context_id=event.context_id;mark(state,'policy_at');resolvePolicy(event);
        }
      }catch(error){cancel(`JSONL protocol error: ${error.message}`);rejectPolicy(error);}
    }
  });
  child.stderr.on('data',chunk=>{
    state.stderr.push(chunk);stderrBytes+=chunk.length;
    if(stderrBytes>MAX_STDERR)cancel('stderr limit exceeded');
  });
  const send = bytes => {state.stdin.push(Buffer.from(bytes));child.stdin.write(bytes);};
  let result;
  try{
    if(scenario.missingDigest || scenario.invalidDigest){
      result=await completion;
      assert.equal(policy,undefined,'invalid/missing digest must refuse before policy emission');
      assertNoStartup(state);assert.notEqual(result.code,0);
    }else if(scenario.deadlineBeforeAck){
      // The original deadline can expire during bootstrap or while awaiting ACK.
      await Promise.race([policyPromise.catch(()=>undefined),completion]);
      if(policy){assertNoStartup(state);assert.equal(state.ack_at,null);}
      result=await completion;
      assert.equal(state.deadline_expired,true,'original absolute deadline must cancel');
      assertNoStartup(state);assert.equal(state.ack_at,null);assert.equal(state.prompt_at,null);
    }else{
      await policyPromise;
      await delay(HOLD_MS);
      assert.equal(closed,false,'process must wait before ACK');
      assertNoStartup(state);
      const ack=Buffer.from(`${JSON.stringify({type:ACK,nonce,context_id:policy.context_id})}\n`);
      state.ack_sha256=sha256(ack);state.ack_bytes=ack.length;mark(state,'ack_at');send(ack);
      if(scenario.deadlineAfterAck){
        result=await completion;
        assert.equal(state.deadline_expired,true,'ACK must not reset/extend the original deadline');
        assertNoStartup(state);assert.equal(state.prompt_at,null);
      }else{
        if(!opts.legacyRed){
          await delay(HOLD_MS);
          assert.equal(closed,false,'ACK without prompt/EOF must remain blocked');
          assertNoStartup(state);
        }
        let prompt=Buffer.from(ORIGINAL_PROMPT);
        if(scenario.duplicateAck || opts.legacyRed)prompt=Buffer.concat([ack,prompt]);
        if(scenario.tamper)prompt=Buffer.concat([prompt,Buffer.from('\n')]);
        if(scenario.oversize)prompt=Buffer.concat([prompt,Buffer.alloc(32001,'x'.charCodeAt(0))]);
        if(scenario.emptyPrompt)prompt=Buffer.alloc(0);
        state.transmitted_prompt_sha256=sha256(prompt);state.transmitted_prompt_bytes=prompt.length;
        mark(state,'prompt_at');state.stdin.push(prompt);child.stdin.end(prompt);
        result=await completion;
        if(scenario.success || opts.legacyRed){
          assert.equal(result.code,0,'accepted loopback fixture must finish successfully');
          const modelRequests=state.requests.filter(request=>request.model_request && !request.websocket);
          assert.equal(modelRequests.length,1,'fixture expects one model POST after admission');
          assert.equal(modelRequests[0].method,'POST','model request must be a POST');
          assert.ok(state.events.some(event=>event.type==='turn.completed'),'mock task must complete a turn');
          const texts=modelRequests.flatMap(request=>request.user_texts??[]);
          if(opts.legacyRed){
            assert.ok(texts.some(text=>Buffer.from(text).equals(prompt)),'legacy root must reproduce second ACK in model task');
            assert.ok(!texts.some(text=>Buffer.from(text).equals(ORIGINAL_PROMPT)),'legacy contamination must not be mistaken for original task');
            assert.notEqual(state.transmitted_prompt_sha256,ORIGINAL_SHA256);
          }else{
            assert.ok(texts.some(text=>Buffer.from(text).equals(ORIGINAL_PROMPT)),'model must receive exact original Unicode/CRLF task bytes');
            assert.equal(state.transmitted_prompt_sha256,ORIGINAL_SHA256,'original digest must not be rewritten');
          }
          assert.ok(state.requests.every(request=>request.after_ack),'HTTP/model/prewarm before ACK is forbidden');
          assert.ok(state.requests.every(request=>request.after_prompt),'thread/prewarm must wait for the verified prompt/EOF');
          assert.ok(state.connections.every(connection=>state.ack_at!==null&&connection.at>=state.ack_at),'TCP prewarm before ACK is forbidden');
          if(!opts.legacyRed)assert.ok(state.connections.every(connection=>state.prompt_at!==null&&connection.at>=state.prompt_at),'TCP prewarm must wait for verified prompt/EOF');
        }else{
          assert.notEqual(result.code,0,'task integrity failure must refuse');
          assertNoStartup(state);
        }
      }
    }
    const deadlineCase = scenario.deadlineBeforeAck || scenario.deadlineAfterAck;
    if(!deadlineCase){
      assert.equal(state.deadline_expired,false,'a hung normal case cannot pass by timeout cancellation');
      assert.equal(result.signal,null,'normal accept/refuse must exit without test-controller kill');
      assert.ok(Number.isInteger(result.code),'normal case must produce a concrete exit code');
    }
    assert.equal((partial+decoder.end()).trim(),'','root CLI must not leave a truncated JSONL record');
    assert.equal(state.controllerError,null,state.controllerError??'controller protocol error');
    assert.equal(state.requests.filter(request=>!request.after_ack).length,0,'no HTTP/model/prewarm before ACK');
    assert.equal(state.deadline_at,state.launched_at+budget,'deadline must remain the launch deadline');
    if(state.deadline_expired)assert.ok(state.closed_at<=state.deadline_at+1500,'test cancellation must be bounded');
    return {name:scenario.name,exit_code:result.code,signal:result.signal,
      original_prompt_sha256:ORIGINAL_SHA256,transmitted_prompt_sha256:state.transmitted_prompt_sha256??null,
      nonce,context_id:state.context_id??null,launched_at:state.launched_at,deadline_at:state.deadline_at,
      policy_at:state.policy_at,ack_at:state.ack_at,prompt_at:state.prompt_at,closed_at:state.closed_at,
      deadline_expired:state.deadline_expired,deadline_resets:0,policy_events:policy?1:0,
      pre_ack_http_or_websocket_requests:state.requests.filter(request=>!request.after_ack).length,
      post_ack_http_requests:state.requests.filter(request=>request.after_ack&&!request.websocket).length,
      model_post_requests:state.requests.filter(request=>request.model_request&&!request.websocket).length,
      websocket_requests:state.requests.filter(request=>request.websocket).length,
      tcp_connections:state.connections.length,pre_ack_tcp_connections:state.connections.filter(connection=>state.ack_at===null||connection.at<state.ack_at).length};
  }finally{
    clearTimeout(deadlineTimer);
    if(!closed){terminateOwnedGroup();await completion.catch(()=>{});}
    await Promise.allSettled([...state.pendingRequests]);
    state.requests.forEach(request=>{delete request.user_texts;});
    await fs.writeFile(path.join(directory,'stdout.jsonl'),Buffer.concat(state.stdout),{mode:0o600});
    await fs.writeFile(path.join(directory,'stderr.log'),Buffer.concat(state.stderr),{mode:0o600});
    await fs.writeFile(path.join(directory,'stdin-transcript.bin'),Buffer.concat(state.stdin),{mode:0o600});
    const record={...state,stdout:undefined,stderr:undefined,stdin:undefined,pendingRequests:undefined};
    await fs.writeFile(path.join(directory,'transport-observations.json'),`${JSON.stringify(record,null,2)}\n`,{mode:0o600});
    serverState.current=null;
  }
}

async function main(){
  const opts=options(process.argv.slice(2));
  const binarySha=await fileDigest(opts.binary);
  const evidenceRoot=opts.evidenceRoot??os.tmpdir();await fs.mkdir(evidenceRoot,{recursive:true,mode:0o700});
  const evidence=await fs.mkdtemp(path.join(evidenceRoot,opts.legacyRed?'root-transport-legacy-red-':'root-transport-hardened-'));
  await fs.chmod(evidence,0o700);
  await fs.writeFile(path.join(evidence,'original-prompt.bin'),ORIGINAL_PROMPT,{mode:0o600});
  const serverState={current:null,cases:new Map(),connections:[],orphanTraffic:[],socketEntries:new WeakMap()};
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url??'/','http://127.0.0.1').pathname;
    const caseToken=/^\/case\/([0-9a-f]{64})\/v1(?:\/|$)/.exec(pathname)?.[1];
    const state=serverState.cases.get(caseToken);
    if(!state){serverState.orphanTraffic.push({kind:'http',at:Date.now(),path_sha256:sha256(Buffer.from(pathname))});request.resume();response.writeHead(503);response.end();return;}
    const connection=serverState.socketEntries.get(request.socket);
    if(connection){
      if(connection.owner_nonce!==null&&connection.owner_nonce!==state.nonce)serverState.orphanTraffic.push({kind:'cross_case_connection',at:Date.now()});
      if(connection.owner_nonce===null){connection.owner_nonce=state.nonce;state.connections.push(connection);}
      connection.request_nonce=state.nonce;
    }
    if(state.closed_at!==null)serverState.orphanTraffic.push({kind:'late_case_http',at:Date.now(),nonce:state.nonce});
    const model=/\/(?:responses|chat\/completions)(?:\/|$)/.test(pathname);
    const entry={method:request.method,path:pathname,at:Date.now(),after_ack:state.ack_at!==null,
      after_prompt:state.prompt_at!==null,model_request:model,websocket:false};
    state.requests.push(entry);
    const number=state.requests.length;
    const operation=(async()=>{
      const chunks=[];let length=0;
      for await(const chunk of request){length+=chunk.length;if(length>MAX_HTTP_BODY)throw new Error('mock request body limit');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);entry.body_sha256=sha256(bytes);entry.body_bytes=bytes.length;
      if(bytes.length){
        await fs.writeFile(path.join(state.directory,`http-${String(number).padStart(3,'0')}.body.json`),bytes,{mode:0o600});
        try{entry.user_texts=userTexts(JSON.parse(bytes.toString('utf8')));entry.user_text_sha256=entry.user_texts.map(text=>sha256(Buffer.from(text)));}catch{entry.user_texts=[];}
      }
      if(model){response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});response.end(fixtureSse());}
      else if(/models/.test(pathname)){response.writeHead(200,{'content-type':'application/json'});response.end('{"models":[],"data":[]}');}
      else{response.writeHead(503,{'content-type':'application/json'});response.end('{"error":{"message":"Loopback fixture rejects unknown endpoint"}}');}
    })().catch(error=>{state.controllerError=`loopback fixture error: ${error.message}`;response.destroy();});
    state.pendingRequests.add(operation);operation.finally(()=>state.pendingRequests.delete(operation));
  });
  server.on('connection',socket=>{
    const state=serverState.current;
    const connection={at:Date.now(),owner_nonce:state?.nonce??null,request_nonce:null};
    serverState.connections.push(connection);serverState.socketEntries.set(socket,connection);
    if(state)state.connections.push(connection);
    else serverState.orphanTraffic.push({kind:'unattributed_tcp_connection',at:connection.at});
  });
  server.on('upgrade',(request,socket)=>{
    const pathname=new URL(request.url??'/','http://127.0.0.1').pathname;
    const caseToken=/^\/case\/([0-9a-f]{64})\/v1(?:\/|$)/.exec(pathname)?.[1];
    const state=serverState.cases.get(caseToken);
    if(state){
      const connection=serverState.socketEntries.get(socket);
      if(connection){
        if(connection.owner_nonce!==null&&connection.owner_nonce!==state.nonce)serverState.orphanTraffic.push({kind:'cross_case_websocket_connection',at:Date.now()});
        if(connection.owner_nonce===null){connection.owner_nonce=state.nonce;state.connections.push(connection);}
        connection.request_nonce=state.nonce;
      }
      if(state.closed_at!==null)serverState.orphanTraffic.push({kind:'late_case_websocket',at:Date.now(),nonce:state.nonce});
      state.requests.push({method:request.method,path:pathname,at:Date.now(),after_ack:state.ack_at!==null,after_prompt:state.prompt_at!==null,model_request:true,websocket:true});
    }else serverState.orphanTraffic.push({kind:'websocket',at:Date.now(),path_sha256:sha256(Buffer.from(pathname))});
    socket.destroy();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const cases=opts.legacyRed?[{name:'legacy_duplicate_ack_contaminates_prompt'}]:[
    {name:'exact_prompt_after_ack',success:true},
    {name:'ack_then_eof_without_original_prompt',emptyPrompt:true},
    {name:'duplicate_ack_rejected',duplicateAck:true},
    {name:'tampered_prompt_rejected',tamper:true},
    {name:'wrong_original_digest_rejected',wrongDigest:true},
    {name:'oversize_prompt_rejected',oversize:true},
    {name:'missing_digest_argument_rejected',missingDigest:true},
    {name:'malformed_digest_argument_rejected',invalidDigest:true},
    {name:'fixed_deadline_before_ack',deadlineBeforeAck:true},
    {name:'fixed_deadline_after_ack_before_prompt',deadlineAfterAck:true}
  ];
  const results=[];
  try{
    for(const scenario of cases)results.push(await runScenario(opts,evidence,serverState,baseUrl,scenario));
    assert.equal(await fileDigest(opts.binary),binarySha,'root CLI binary changed during probe');
    assert.equal(serverState.orphanTraffic.length,0,'unattributed/late/cross-case fixture traffic is forbidden');
    assert.ok(serverState.connections.every(connection=>connection.owner_nonce!==null&&connection.request_nonce===connection.owner_nonce),'unbound TCP prewarm or cross-case connection is forbidden');
    const summary={status:opts.legacyRed?'EXPECTED_LEGACY_DUPLICATE_ACK_CONTAMINATION_REPRODUCED':'ROOT_PROMPT_TRANSPORT_CHECKS_PASS',
      platform:process.platform,binary_kind:'root codex --no-daemon exec',binary_sha256:binarySha,
      upstream_commit:UPSTREAM,original_prompt_sha256:ORIGINAL_SHA256,cases:results,
      pre_ack_http_or_websocket_requests:results.reduce((sum,value)=>sum+value.pre_ack_http_or_websocket_requests,0),
      real_model_calls:0,network_capture_scope:'configured loopback provider; not a general OS egress attestation',mock_model_post_requests:results.reduce((sum,value)=>sum+value.model_post_requests,0),
      pre_ack_tcp_connections:results.reduce((sum,value)=>sum+value.pre_ack_tcp_connections,0),orphan_fixture_traffic:serverState.orphanTraffic.length,
      deadline_enforcement:process.platform==='win32'
        ? 'disposable Node child termination before pipe close; no Windows Job Object/descendant-cleanup proof'
        : 'disposable Node child test controller with private process-group termination before pipe close; native Windows watchdog qualification remains separate',
      native_process_custody_qualified:false,windows_binary_qualified:false,evidence_directory:evidence};
    await fs.writeFile(path.join(evidence,'network-observations.json'),`${JSON.stringify({connections:serverState.connections,orphan_traffic:serverState.orphanTraffic},null,2)}\n`,{mode:0o600});
    await fs.writeFile(path.join(evidence,'summary.json'),`${JSON.stringify(summary,null,2)}\n`,{mode:0o600});
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }catch(error){
    await fs.writeFile(path.join(evidence,'failure.json'),`${JSON.stringify({completed_cases:results,reason:error.message},null,2)}\n`,{mode:0o600});
    process.stderr.write(`${JSON.stringify({status:'ROOT_PROMPT_TRANSPORT_CHECKS_FAILED',completed_cases:results.length,
      reason:String(error.message).slice(0,500),evidence_directory:evidence})}\n`);process.exitCode=1;
  }finally{
    server.closeIdleConnections?.();
    await new Promise(resolve=>server.close(resolve));
  }
}

await main();
