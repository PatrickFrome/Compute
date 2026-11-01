#!/usr/bin/env node
// TEST ONLY: the published Windows controller's protocol is bridged to a real
// Linux root CLI. Synthetic helper frames are never native Windows evidence.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

const TRANSPORT_COMMIT='6145546e00ab81139e4a7698c8d45863e580efba';
const TRANSPORT_TREE='8e81f6ae5925b273232ef792b4739c73aa56433b';
const ROOT_SHA='be8e0db3ad73bd0ff96150959565eb527f236564e77376997a928d433c9bd8e4';
const UPSTREAM='3b01b36fa5eb96ba82a776bd3c2fc57f8969181f';
const POLICY='metaengine.effective_policy.v1',ACK='metaengine.effective_policy.accept.v1';
const PROMPT=Buffer.from('Transport fixture: Привет λ\r\nRetain this trailing whitespace \t\r\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const PROMPT_SHA=sha(PROMPT),realSpawn=childProcess.spawn;
const writePrivate=(file,bytes)=>fs.writeFileSync(file,bytes,{mode:0o600});
async function fileSha(file){const hash=createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex');}
const json=object=>JSON.stringify(object,null,2)+'\n';
const exact=(object,keys)=>assert.deepEqual(Object.keys(object).sort(),keys.split(' ').sort());
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']'
  :'{'+Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sourceFiles=['codex-cli-windows-process-controller.mjs','codex-cli-physical-settlement.mjs',
  'native-coding-task-context.mjs','native-coding-windows-process-observer.mjs','windows-native-read-environment.mjs'];

function options(argv){
  const result={};
  while(argv.length){const key=argv.shift();
    if(!['--binary','--transport-worktree','--evidence-root'].includes(key)||!argv[0])throw Error('usage: joint-root-policy-transport-probe.mjs --binary ABS --transport-worktree ABS [--evidence-root ABS]');
    result[key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv.shift();
  }
  for(const key of ['binary','transportWorktree'])assert.ok(path.isAbsolute(result[key]??''),key+' must be absolute');
  if(result.evidenceRoot)assert.ok(path.isAbsolute(result.evidenceRoot));
  assert.equal(process.platform,'linux','this protocol-only probe is qualified only on Linux');
  return result;
}
function verifyTransport(worktree){
  const git=args=>childProcess.execFileSync('git',['-C',worktree,...args],{maxBuffer:8*1024*1024});
  const [commit,tree]=git(['rev-parse','HEAD','HEAD^{tree}']).toString().trim().split('\n');
  assert.equal(commit,TRANSPORT_COMMIT);assert.equal(tree,TRANSPORT_TREE);
  assert.equal(git(['status','--porcelain','--untracked-files=no']).toString(),'','transport tracked source must be clean');
  const files=sourceFiles.map(name=>{
    const relative='apps/metaengine-browser/src/'+name,bytes=fs.readFileSync(path.join(worktree,relative));
    assert.ok(bytes.equals(git(['show',TRANSPORT_COMMIT+':'+relative])),'import source differs from pinned Git object: '+relative);
    return {file:relative,sha256:sha(bytes)};
  });
  return {commit,tree,files};
}
function environment(directory){
  const result={};
  for(const name of ['PATH','LANG','LC_ALL'])if(process.env[name]!==undefined)result[name]=process.env[name];
  return {...result,HOME:directory,USERPROFILE:directory,CODEX_HOME:path.join(directory,'codex-home'),
    APPDATA:path.join(directory,'appdata'),LOCALAPPDATA:path.join(directory,'localappdata'),
    TMPDIR:path.join(directory,'temp'),TMP:path.join(directory,'temp'),TEMP:path.join(directory,'temp'),
    NO_COLOR:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
}
function fixtureSse(){
  // Pinned core/tests/common/responses.rs event shapes; no model is called.
  return [{type:'response.created',response:{id:'resp_joint_fixture'}},
    {type:'response.output_item.done',item:{type:'message',role:'assistant',id:'msg_joint_fixture',content:[{type:'output_text',text:'Synthetic joint transport fixture complete.'}]}},
    {type:'response.completed',response:{id:'resp_joint_fixture',usage:{input_tokens:0,input_tokens_details:null,output_tokens:0,output_tokens_details:null,total_tokens:0}}}
  ].map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
function userTexts(body){return (Array.isArray(body?.input)?body.input:[]).filter(item=>item.role==='user'&&Array.isArray(item.content))
  .flatMap(item=>item.content).filter(item=>['input_text','text'].includes(item.type)&&typeof item.text==='string').map(item=>item.text);}
function createFixture(){
  const fixture={current:null,cases:new Map(),connections:[],orphans:[],sockets:new WeakMap()};
  function owner(request,kind){
    const pathname=new URL(request.url??'/','http://127.0.0.1').pathname;
    const nonce=/^\/case\/([a-f0-9]{64})\/v1(?:\/|$)/.exec(pathname)?.[1],state=fixture.cases.get(nonce);
    if(!state){fixture.orphans.push({kind,at:Date.now(),path_sha256:sha(pathname)});return {};}
    const connection=fixture.sockets.get(request.socket);
    if(connection){connection.request_nonce=nonce;if(connection.owner_nonce!==nonce)fixture.orphans.push({kind:'cross_case_connection',at:Date.now()});}
    if(state.root_closed_at!==null)fixture.orphans.push({kind:'late_'+kind,at:Date.now(),nonce});
    return {state,pathname};
  }
  const server=http.createServer((request,response)=>{
    const {state,pathname}=owner(request,'http');
    if(!state){request.resume();response.writeHead(503);response.end();return;}
    const entry={at:Date.now(),sequence:mark(state,'loopback_http_observed').sequence,method:request.method,path:pathname,after_ack:state.ack_delivered_at!==null,
      after_prompt:state.prompt_delivered_at!==null,after_prompt_eof_issued:state.prompt_eof_issued_at!==null,
      websocket:false,model_request:/\/(responses|chat\/completions)(?:\/|$)/.test(pathname)};
    state.requests.push(entry);
    const operation=(async()=>{
      let length=0;const chunks=[];
      for await(const chunk of request){length+=chunk.length;assert.ok(length<=4*1024*1024,'mock HTTP body budget');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);entry.body_sha256=sha(bytes);entry.body_bytes=bytes.length;
      writePrivate(path.join(state.directory,`http-${String(state.requests.length).padStart(3,'0')}.body.json`),bytes);
      if(bytes.length){entry.user_texts=userTexts(JSON.parse(bytes.toString()));entry.user_text_sha256=entry.user_texts.map(sha);}
      if(entry.model_request){response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});response.end(fixtureSse());}
      else if(/models/.test(pathname)){response.writeHead(200,{'content-type':'application/json'});response.end('{"models":[],"data":[]}');}
      else{response.writeHead(503);response.end();}
    })().catch(error=>{state.fixture_error=error.message;response.destroy();});
    state.pendingRequests.add(operation);operation.finally(()=>state.pendingRequests.delete(operation));
  });
  server.on('connection',socket=>{
    const state=fixture.current,connection={at:Date.now(),sequence:state?mark(state,'loopback_tcp_observed').sequence:null,owner_nonce:state?.nonce??null,request_nonce:null};
    fixture.connections.push(connection);fixture.sockets.set(socket,connection);
    if(state)state.connections.push(connection);else fixture.orphans.push({kind:'unattributed_tcp',at:connection.at});
  });
  server.on('upgrade',(request,socket)=>{
    const {state,pathname}=owner(request,'websocket');
    if(state)state.requests.push({at:Date.now(),sequence:mark(state,'loopback_websocket_observed').sequence,method:request.method,path:pathname,after_ack:state.ack_delivered_at!==null,
      after_prompt:state.prompt_delivered_at!==null,after_prompt_eof_issued:state.prompt_eof_issued_at!==null,websocket:true,model_request:true});
    socket.destroy();
  });
  fixture.server=server;return fixture;
}

// This is deliberately a narrow fixture assertion, NOT the private production
// consumer's missing policy-admission implementation. Nonfixture policy refuses.
function checkFixtureProjection(raw,state){
  assert.ok(raw.length>0&&raw.length<=65536);const event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  exact(event,'type nonce context_id mode strict_config thread_start_overrides policy');
  assert.equal(event.type,POLICY);assert.equal(event.nonce,state.nonce);assert.equal(event.mode,'execute');assert.equal(event.strict_config,false);
  assert.match(event.context_id,/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const overrides=event.thread_start_overrides;
  exact(overrides,'scope approval_policy approvals_reviewer sandbox_mode permission_profile default_permissions persisted_permission_profile_id cwd workspace_roots additional_writable_roots');
  assert.deepEqual(overrides,{scope:'TYPED_THREAD_START_OVERRIDES',approval_policy:'never',approvals_reviewer:'user',sandbox_mode:'read-only',
    permission_profile:null,default_permissions:null,persisted_permission_profile_id:null,cwd:state.workspace,workspace_roots:[state.workspace],additional_writable_roots:[]});
  const policy=event.policy;
  exact(policy,'schema upstream_commit stage cwd load_mode effective requirements layers origins origins_scope');
  assert.equal(policy.schema,'metaengine.codex.effective-policy.v1');assert.equal(policy.upstream_commit,UPSTREAM);
  assert.equal(policy.stage,'THREAD_START_RESOLVED_BEFORE_SPAWN');assert.equal(policy.cwd,state.workspace);
  assert.deepEqual(policy.load_mode,{ignore_user_config:true,ignore_project_config:false,ignore_managed_requirements:false,
    ignore_login_requirements:false,ignore_user_and_project_exec_policy_rules:true,user_config_profile:null,user_config_path_override:false});
  const effective=policy.effective;
  exact(effective,'permission_profile active_permission_profile explicit_permission_profile_mode approval_policy approvals_reviewer allow_login_shell workspace_roots permission_workspace_roots profile_workspace_roots windows');
  assert.equal(effective.approval_policy,'never');assert.equal(effective.approvals_reviewer,'user');assert.equal(typeof effective.allow_login_shell,'boolean');
  assert.equal(effective.active_permission_profile,null);assert.equal(effective.explicit_permission_profile_mode,false);
  assert.deepEqual(effective.permission_profile,{type:'managed',file_system:{type:'restricted',entries:[{path:{type:'special',value:{kind:'root'}},access:'read'}]},network:'restricted'});
  assert.deepEqual(effective.workspace_roots,[state.workspace]);assert.deepEqual(effective.permission_workspace_roots,[state.workspace]);assert.deepEqual(effective.profile_workspace_roots,[]);
  assert.deepEqual(effective.windows,{configured_mode:null,configured_backend:'none',effective_local_backend:'none'});
  const requirements=policy.requirements,keys='allowed_approval_policies allowed_approvals_reviewers allowed_sandbox_modes allowed_permission_profiles default_permissions allow_login_shell windows.allowed_sandbox_implementations permission_profile permissions.filesystem experimental_network';
  exact(requirements,'values sources source_scope generation');exact(requirements.values,keys);exact(requirements.sources,keys);
  // This disposable fixture has no constraints. A real nonempty constraint is
  // neither cleared nor rewritten to pass: this narrow probe fails instead.
  assert.ok(Object.values(requirements.values).every(value=>value===null));assert.ok(Object.values(requirements.sources).every(value=>value===null));
  assert.equal(requirements.source_scope,'NORMALIZED_CONSTRAINT');
  assert.equal(requirements.generation,'sha256:'+sha(canonical({values:requirements.values,sources:requirements.sources})));
  const layerNames=['packaged_defaults','mdm','system','enterprise_managed','user','project','session_flags','legacy_managed_file','legacy_managed_mdm'];
  const checkOrigin=value=>{exact(value,'name source version');assert.ok(layerNames.includes(value.name));exact(value.source,'kind identity_generation');
    assert.ok(layerNames.includes(value.source.kind));assert.match(value.source.identity_generation,/^sha256:[a-f0-9]{64}$/);assert.match(value.version,/^sha256:[a-f0-9]{64}$/);};
  assert.ok(Array.isArray(policy.layers)&&policy.layers.length>0);
  for(const layer of policy.layers){exact(layer,'name source version enabled loader_ignored content_scope');
    checkOrigin({name:layer.name,source:layer.source,version:layer.version});assert.equal(typeof layer.enabled,'boolean');assert.equal(typeof layer.loader_ignored,'boolean');
    assert.equal(layer.content_scope,layer.loader_ignored?'IGNORED_EMPTY_PLACEHOLDER':'RESOLVED_LAYER_CONTENT');if(layer.loader_ignored)assert.equal(layer.name,'user');}
  assert.ok(policy.layers.some(layer=>layer.name==='user'&&layer.loader_ignored));
  assert.equal(policy.origins_scope,'CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES');
  assert.ok(policy.origins&&typeof policy.origins==='object'&&!Array.isArray(policy.origins));Object.values(policy.origins).forEach(checkOrigin);
  return event;
}
function noStartup(state){
  assert.equal(state.connections.length,0,'no loopback TCP/prewarm before full task qualifies');assert.equal(state.requests.length,0,'no mock request before full task qualifies');
  assert.ok(!state.events.some(event=>event.type==='thread.started'||event.type?.startsWith('turn.')),'no thread/turn before full task qualifies');
}
function mark(state,name){const entry={sequence:state.timeline.length+1,name,at:Date.now()};state.timeline.push(entry);return entry;}
async function until(predicate,state,label){while(!predicate()){if(Date.now()>state.deadline_at+4000)throw Error(label+' exceeded fixed deadline plus cleanup budget');await delay(10);}}

function bridge(state,scenario,modules){
  const helper=new EventEmitter();helper.pid=122;helper.stdin=new PassThrough();helper.stdout=new PassThrough();helper.stderr=new PassThrough();
  const helperBytes=Buffer.from('TEST ONLY Linux root protocol bridge; never a native Windows helper.\n');
  const helperPath=path.join(state.directory,'TEST-ONLY-helper.ps1'),powershellPath=path.join(state.directory,'TEST-ONLY-powershell.exe');writePrivate(helperPath,helperBytes);
  const birth='133333333333333332',workerBirth='133333333333333333';
  const dateOf=value=>new Date(Number((BigInt(value)-116444736000000000n)/10000n)).toISOString();
  const helperIdentity={pid:122,created_at:dateOf(birth),process_incarnation_id:'pid:122:created_100ns:'+birth};
  let root=null,closed=false,helperClosed=false,partial='',queue=Promise.resolve(),timer=null,identity=null;
  let resolveRoot;const rootCompletion=new Promise(resolve=>{resolveRoot=resolve;});
  const frames=[],commands=[],physicalStdin=[],rawStdout=[],rawStderr=[],decoder=new StringDecoder('utf8');let stdoutPartial='',stdoutBytes=0,stderrBytes=0;
  const frame=value=>{
    if(value.type==='policy_ack_written')state.ack_notification_sequence=mark(state,'test_ack_notification_emitted').sequence;
    frames.push({at:Date.now(),test_only:true,frame:value});helper.stdout.write(JSON.stringify(value)+'\n');
  };
  const output=(channel,bytes)=>{for(let offset=0;offset<bytes.length;offset+=4096)frame({type:'output',channel,data_b64:bytes.subarray(offset,offset+4096).toString('base64')});};
  const closeHelper=()=>{if(helperClosed)return;helperClosed=true;mark(state,'test_helper_close_without_native_terminal');helper.emit('close',1,null);};
  function terminate(reason){
    mark(state,'terminate_requested_'+reason);
    if(root&&!closed){
      mark(state,'root_group_sigkill_requested');
      try{process.kill(-root.pid,'SIGKILL');mark(state,'root_group_sigkill_sent');}catch(error){if(error.code!=='ESRCH')state.bridge_error='group kill failed: '+error.code;}
      // EOF can activate a complete task. Kill/fence FIRST, then close pipes.
      mark(state,'root_stdin_destroy_after_group_kill');root.stdin.destroy();
    }else if(!root){resolveRoot({code:null,signal:null});closeHelper();}
  }
  helper.kill=()=>{terminate('controller_helper_kill');return true;};
  const childWrite=bytes=>new Promise((resolve,reject)=>{physicalStdin.push(Buffer.from(bytes));root.stdin.write(bytes,error=>error?reject(error):resolve());});
  const childEnd=bytes=>new Promise((resolve,reject)=>{physicalStdin.push(Buffer.from(bytes));root.stdin.end(bytes,error=>error?reject(error):resolve());});
  async function command(received){
    const {line}=received;assert.ok(Buffer.byteLength(line)<=131072,'helper command budget');
    if(!identity){
      const wire=JSON.parse(line),launch={schema:wire.schema,canonical_body:Buffer.from(wire.body_b64,'base64').toString(),request_sha256:wire.request_sha256};
      const body=modules.validateCodexCliLaunch(launch,state.spec);identity=modules.codexCliLaunchIdentity(launch);
      state.launch=launch;state.launch_identity=identity;assert.equal(body.deadline_ms,String(state.deadline_at));assert.equal(body.prompt_sha256,PROMPT_SHA);
      assert.equal(body.policy_nonce,state.nonce);assert.equal(body.input_protocol,'EFFECTIVE_POLICY_ACK_V1');
      frame({type:'ready',launch:identity,helper_process:helperIdentity,pid:123,started_at:dateOf(workerBirth),
        process_incarnation_id:'pid:123:created_100ns:'+workerBirth,executable_path:state.spec.executablePath,
        executable_sha256:state.spec.expectedExecutableSha256,user_sid:'S-1-5-21-111-1001',job_id:state.spec.runId,
        tree_control_bound:true,started_suspended:true,job_bound_before_resume:true,process_tree_control:'WINDOWS_JOB_OBJECT'});
      return;
    }
    const parts=line.split(' '),kind=parts[0];mark(state,'helper_command_'+kind);
    if(kind==='CANCEL'||kind==='CANCEL_SUSPENDED'){terminate('controller_cancel');return;}
    assert.equal(parts[1],identity.request_id);assert.equal(parts[2],identity.request_sha256);
    if(kind==='BOOTSTRAP'){
      assert.equal(root,null);assert.equal(parts.length,4);assert.equal(Number(parts[3]),state.deadline_at);
      state.bootstrap_deadline_at=Number(parts[3]);state.deadline_resets=0;
      root=realSpawn(state.spec.executablePath,state.spec.args,{cwd:state.workspace,env:state.spec.env,shell:false,detached:true,stdio:['pipe','pipe','pipe']});
      state.root_pid=root.pid??null;mark(state,'physical_root_spawn');
      root.stdin.on('error',error=>{if(!['EPIPE','ERR_STREAM_DESTROYED'].includes(error.code)){state.bridge_error='root stdin: '+error.code;terminate('root_stdin_error');}});
      root.once('error',error=>{state.bridge_error='root spawn: '+error.message;terminate('root_spawn_error');});
      root.stdout.on('data',bytes=>{
        rawStdout.push(bytes);stdoutBytes+=bytes.length;if(stdoutBytes>1024*1024){state.bridge_error='stdout limit';terminate('stdout_limit');return;}
        stdoutPartial+=decoder.write(bytes);let index;
        while((index=stdoutPartial.indexOf('\n'))>=0){const line=stdoutPartial.slice(0,index);stdoutPartial=stdoutPartial.slice(index+1);
          if(line.length)try{const event=JSON.parse(line);state.events.push(event);
            state.root_event_observations.push({type:event.type,sequence:mark(state,'physical_root_event_'+event.type).sequence,at:Date.now(),
              after_ack:state.ack_delivered_at!==null,after_prompt_eof_issued:state.prompt_eof_issued_at!==null});
            if(event.type===POLICY){state.policy_observed_at=Date.now();state.policy_line_sha256=sha(Buffer.from(line));}
          }catch{state.bridge_error='non JSONL root output';terminate('root_protocol');}}
        output('stdout',bytes);
      });
      root.stderr.on('data',bytes=>{rawStderr.push(bytes);stderrBytes+=bytes.length;if(stderrBytes>512*1024){state.bridge_error='stderr limit';terminate('stderr_limit');return;}output('stderr',bytes);});
      root.once('close',(code,signal)=>{
        closed=true;clearTimeout(timer);state.root_closed_at=Date.now();state.root_exit={code,signal};
        stdoutPartial+=decoder.end();if(stdoutPartial.length)state.bridge_error='truncated root JSONL';
        mark(state,'physical_root_close_drained');resolveRoot({code,signal});closeHelper();
      });
      timer=setTimeout(()=>{state.deadline_expired=true;mark(state,'original_deadline_expired');terminate('fixed_deadline');},Math.max(1,state.deadline_at-Date.now()));
      frame({type:'resumed',request_id:identity.request_id,request_sha256:identity.request_sha256});return;
    }
    assert.ok(root&&!closed,'root must be live for a write');assert.equal(parts.length,4);
    const bytes=Buffer.from(parts[3],'base64');assert.equal(bytes.toString('base64'),parts[3]);
    if(kind==='POLICY_ACK'){
      assert.equal(state.ack_delivered_at,null);const ack=JSON.parse(bytes.toString());exact(ack,'type nonce context_id');assert.equal(ack.type,ACK);assert.equal(ack.nonce,state.nonce);
      await childWrite(bytes);state.ack_delivered_at=Date.now();state.ack_sha256=sha(bytes);state.ack_bytes=bytes.length;mark(state,'physical_ack_write_callback');
      if(!scenario.holdAckNotification)frame({type:'policy_ack_written',request_id:identity.request_id,request_sha256:identity.request_sha256,nonce:ack.nonce,
        context_id:scenario.forgeAckNotification?'019a0000-0000-7000-8000-000000000001':ack.context_id});
    }else if(kind==='PROMPT'){
      assert.ok(state.ack_notification_sequence&&received.arrival_sequence>state.ack_notification_sequence,
        'PROMPT command arrival must follow the ACK-written notification; command queue must not hide premature writes');
      assert.equal(state.prompt_delivered_at,null);assert.ok(bytes.equals(PROMPT),'controller must deliver exact original UTF8 prompt');
      let physical=bytes;
      if(scenario.injectDuplicateAck){const event=state.events.find(event=>event.type===POLICY);physical=Buffer.concat([Buffer.from(JSON.stringify({type:ACK,nonce:state.nonce,context_id:event.context_id})+'\n'),bytes]);}
      state.transmitted_prompt_sha256=sha(physical);state.transmitted_prompt_bytes=physical.length;
      // In normal activation EOF follows the exact complete original task.
      state.prompt_eof_issued_at=Date.now();state.prompt_eof_issued_sequence=mark(state,'physical_prompt_eof_issued').sequence;
      await childEnd(physical);state.prompt_delivered_at=Date.now();mark(state,'physical_prompt_end_callback');
      frame({type:'prompt_written',request_id:identity.request_id,request_sha256:identity.request_sha256});
    }else throw Error('unexpected helper command '+kind);
  }
  helper.stdin.on('data',bytes=>{
    partial+=bytes.toString();let index;
    while((index=partial.indexOf('\n'))>=0){const line=partial.slice(0,index);partial=partial.slice(index+1);
      // Capture arrival BEFORE serial processing so the bridge cannot repair a
      // controller regression that sends PROMPT ahead of ACK confirmation.
      const received={at:Date.now(),arrival_sequence:mark(state,'helper_command_arrival_'+line.split(' ')[0]).sequence,line};commands.push(received);
      queue=queue.then(()=>command(received)).catch(error=>{state.bridge_error=error.message;terminate('bridge_failure');});}
    if(partial.length>131072){state.bridge_error='helper command pending budget';terminate('bridge_budget');}
  });
  return {helper,helperPath,powershellPath,helperSha:sha(helperBytes),helperIdentity,rootCompletion,commands,terminate,
    readProcess:async()=>({...helperIdentity,user_sid:'S-1-5-21-111-1001',exe_path:powershellPath}),
    async save(){await queue;writePrivate(path.join(state.directory,'TEST-ONLY-helper-frames.jsonl'),frames.map(json=>JSON.stringify(json)+'\n').join(''));
      writePrivate(path.join(state.directory,'controller-commands.jsonl'),commands.map(value=>JSON.stringify(value)+'\n').join(''));
      writePrivate(path.join(state.directory,'physical-root-stdin.bin'),Buffer.concat(physicalStdin));
      writePrivate(path.join(state.directory,'physical-root-stdout.jsonl'),Buffer.concat(rawStdout));writePrivate(path.join(state.directory,'physical-root-stderr.log'),Buffer.concat(rawStderr));}
  };
}

async function controllerHandle(state,bridge,modules){
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform'),originalSpawn=childProcess.spawn;
  let intercepted=0,pending;
  try{
    // Scoped TEST ONLY shim. Restored before any physical Linux root is spawned.
    Object.defineProperty(process,'platform',{...descriptor,value:'win32'});
    childProcess.spawn=(executable,args)=>{
      assert.equal(executable,bridge.powershellPath);assert.deepEqual(args,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',bridge.helperPath]);
      intercepted++;assert.equal(intercepted,1);return bridge.helper;
    };syncBuiltinESMExports();
    const controller=modules.createCodexCliWindowsProcessController({helperPath:bridge.helperPath,expectedHelperSha256:bridge.helperSha,
      powershellPath:bridge.powershellPath,readProcess:bridge.readProcess,startupTimeoutMs:5000});
    pending=controller.spawn(state.spec);
  }finally{childProcess.spawn=originalSpawn;syncBuiltinESMExports();Object.defineProperty(process,'platform',descriptor);}
  assert.equal(process.platform,'linux');assert.equal(intercepted,1);return pending;
}
async function runCase(options,evidence,fixture,baseUrl,scenario,modules){
  const directory=path.join(evidence,scenario.name),workspace=path.join(directory,'workspace');
  for(const sub of ['', 'workspace','codex-home','appdata','localappdata','temp'])fs.mkdirSync(path.join(directory,sub),{recursive:true,mode:0o700});
  const launchedAt=Date.now(),budget=scenario.deadline?3000:45000,nonce=randomBytes(32).toString('hex');
  const state={name:scenario.name,directory,workspace,nonce,original_prompt_sha256:PROMPT_SHA,launched_at:launchedAt,deadline_at:launchedAt+budget,
    deadline_expired:false,deadline_resets:0,root_closed_at:null,policy_observed_at:null,ack_delivered_at:null,prompt_delivered_at:null,prompt_eof_issued_at:null,
    events:[],root_event_observations:[],requests:[],connections:[],timeline:[],pendingRequests:new Set(),test_only_fault_injection:scenario.injectDuplicateAck?'duplicate ACK inserted by protocol-double before original prompt':
      scenario.forgeAckNotification?'wrong context in protocol-double ACK-written notification':null};
  const args=['-a','never','--no-daemon','exec','--json','--color','never','--ignore-user-config','--ignore-rules','--ephemeral',
    '--skip-git-repo-check','--sandbox','read-only','-C',workspace,'-c','model_provider="mock"','-c',
    `model_providers.mock={name="JointTransportFixture",base_url=${JSON.stringify(baseUrl+'/case/'+nonce+'/v1')},wire_api="responses",requires_openai_auth=false,supports_websockets=${!scenario.success}}`,
    '-c','check_for_update_on_startup=false','--model','gpt-5.1-codex','--metaengine-effective-policy',nonce,
    '--metaengine-prompt-sha256',scenario.wrongRootDigest?'0'.repeat(64):PROMPT_SHA,'-'];
  state.spec={executablePath:options.binary,expectedExecutableSha256:ROOT_SHA,cwd:workspace,args,env:environment(directory),timeoutMs:budget+1000,
    deadlineAt:new Date(state.deadline_at).toISOString(),runId:randomUUID(),promptSha256:PROMPT_SHA,inputProtocol:'EFFECTIVE_POLICY_ACK_V1',policyNonce:nonce};
  fixture.current=state;fixture.cases.set(nonce,state);mark(state,'original_absolute_deadline_set');
  const owner=bridge(state,scenario,modules),guard=setTimeout(()=>{state.test_guard_expired=true;owner.terminate('test_cleanup_guard');},budget+5000);
  let handle,accepted,outcome;
  try{
    handle=await controllerHandle(state,owner,modules);let exposed='';
    handle.stdout.on('data',bytes=>{exposed+=bytes.toString();});handle.stderr.on('data',()=>{});
    const raw=await handle.bootstrap({deadlineAt:state.spec.deadlineAt});
    state.policy=checkFixtureProjection(raw,state);writePrivate(path.join(directory,'policy-original-record.bin'),raw);
    assert.equal(sha(raw),state.policy_line_sha256,'bootstrap must preserve the exact original physical policy JSON bytes');
    assert.equal(state.events.length,1);assert.equal(state.events[0].type,POLICY);
    assert.equal(state.bootstrap_deadline_at,state.deadline_at);assert.equal(state.launch_identity.prompt_sha256,PROMPT_SHA);
    await delay(200);noStartup(state);assert.equal(exposed,'','policy frame must not leak into execution transcript');
    const ack=Buffer.from(JSON.stringify({type:ACK,nonce,context_id:state.policy.context_id})+'\n');
    if(scenario.rejectPrompt||scenario.rejectSecondAck){
      const suppliedAck=scenario.rejectSecondAck?Buffer.concat([ack,ack]):ack;
      const suppliedPrompt=scenario.rejectPrompt?PROMPT.toString()+'tampered':PROMPT.toString();
      await assert.rejects(handle.acceptPolicy(suppliedAck,suppliedPrompt),/policy_accept_invalid/);
      assert.equal(owner.commands.filter(value=>value.line.startsWith('POLICY_ACK ')).length,0);noStartup(state);
      await handle.terminate('CANCELLED');
    }else if(scenario.noAck){
      assert.equal(state.ack_delivered_at,null);if(!scenario.deadline)await handle.terminate('CANCELLED');
    }else{
      accepted=handle.acceptPolicy(ack,PROMPT.toString());accepted.catch(()=>{});
      if(scenario.holdAckNotification){
        await until(()=>state.ack_delivered_at!==null,state,'ACK delivery');await delay(200);noStartup(state);
        assert.equal(owner.commands.filter(value=>value.line.startsWith('PROMPT ')).length,0);
        await assert.rejects(handle.acceptPolicy(ack,PROMPT.toString()),/policy_accept_invalid/);
        if(!scenario.deadline)await handle.terminate('CANCELLED');
      }else{
        state.accept_outcome=await accepted.then(()=>({resolved:true}),error=>({resolved:false,error:error.message}));
        if(scenario.success){assert.equal(state.accept_outcome.resolved,true);await assert.rejects(handle.acceptPolicy(ack,PROMPT.toString()),/policy_accept_invalid/);}
      }
    }
    await owner.rootCompletion;outcome=await handle.completion;
    if(accepted&&scenario.holdAckNotification)await assert.rejects(accepted,/CONTROLLER_POLICY_ACK_UNCONFIRMED|policy_accept_cancelled/);
    await Promise.all(state.pendingRequests);
    assert.equal(state.bridge_error,undefined);assert.equal(state.fixture_error,undefined);assert.equal(state.test_guard_expired,undefined);
    assert.equal(outcome.tree_cleanup_confirmed,false);assert.equal(outcome.joined_settlement,undefined);
    assert.equal(outcome.exit_code,1,'test helper close is deliberately unproven, even when root succeeds');
    assert.ok(!exposed.includes(POLICY),'reserved producer frame must remain separate');
    if(scenario.success){
      assert.deepEqual(state.root_exit,{code:0,signal:null});assert.equal(state.deadline_expired,false);
      const posts=state.requests.filter(value=>value.model_request&&!value.websocket);assert.equal(posts.length,1);assert.equal(posts[0].method,'POST');
      assert.ok(posts[0].user_texts.some(text=>Buffer.from(text).equals(PROMPT)),'physical model request must contain exact original Unicode/CRLF task');
      assert.equal(state.transmitted_prompt_sha256,PROMPT_SHA);assert.ok(state.events.some(value=>value.type==='turn.completed'));
      for(const kind of ['POLICY_ACK','PROMPT'])assert.equal(owner.commands.filter(value=>value.line.startsWith(kind+' ')).length,1);
    }else{
      noStartup(state);
      if(scenario.wrongRootDigest||scenario.injectDuplicateAck){assert.deepEqual(state.root_exit,{code:1,signal:null});assert.equal(state.deadline_expired,false);}
      else{
        assert.deepEqual(state.root_exit,{code:null,signal:'SIGKILL'});assert.equal(state.deadline_expired,!!scenario.deadline);
        if(scenario.deadline){assert.ok(state.root_closed_at>=state.deadline_at,'watchdog must not cancel before the original deadline');
          assert.ok(state.root_closed_at<=state.deadline_at+1500,'original deadline must terminate and drain within 1500 ms');}
        const killed=state.timeline.find(value=>value.name==='root_group_sigkill_sent'),pipe=state.timeline.find(value=>value.name==='root_stdin_destroy_after_group_kill');
        assert.ok(killed&&pipe&&killed.sequence<pipe.sequence,'root group must be killed before closing stdin');
      }
    }
    assert.equal(state.deadline_resets,0);assert.ok(state.connections.every(value=>value.at>=state.ack_delivered_at));
    assert.ok(state.connections.every(value=>value.sequence>state.prompt_eof_issued_sequence),'no TCP/prewarm before complete task EOF issuance');
    assert.ok(state.requests.every(value=>value.after_ack&&value.after_prompt_eof_issued));
    assert.ok(state.root_event_observations.filter(value=>value.type==='thread.started'||value.type?.startsWith('turn.'))
      .every(value=>value.after_ack&&value.after_prompt_eof_issued),'physical root thread/turn cannot start before ACK and complete task EOF');
    for(const kind of ['POLICY_ACK','PROMPT'])assert.ok(owner.commands.filter(value=>value.line.startsWith(kind+' ')).length<=1,'commands cannot be replayed');
    if(scenario.forgeAckNotification){assert.equal(outcome.reason,'CONTROLLER_PROTOCOL_INVALID');assert.equal(state.prompt_eof_issued_at,null);}
    const result={name:scenario.name,status:'PASS',nonce,context_id:state.policy.context_id,request_id:state.launch_identity.request_id,
      request_sha256:state.launch_identity.request_sha256,original_prompt_sha256:PROMPT_SHA,original_deadline_at:state.deadline_at,
      bootstrap_deadline_at:state.bootstrap_deadline_at,deadline_resets:0,deadline_expired:state.deadline_expired,root_exit:state.root_exit,
      deadline_close_delay_ms:state.deadline_expired?state.root_closed_at-state.deadline_at:null,
      pre_ack_tcp:state.connections.filter(value=>state.ack_delivered_at===null||value.at<state.ack_delivered_at).length,
      pre_ack_http_or_websocket:state.requests.filter(value=>!value.after_ack).length,
      pre_prompt_eof_tcp:state.connections.filter(value=>!state.prompt_eof_issued_sequence||value.sequence<state.prompt_eof_issued_sequence).length,
      premature_thread_or_turn:state.root_event_observations.filter(value=>(value.type==='thread.started'||value.type?.startsWith('turn.'))&&(!value.after_ack||!value.after_prompt_eof_issued)).length,
      mock_model_posts:state.requests.filter(value=>value.model_request&&!value.websocket).length,
      controller_completion:outcome,joined_settlement_emitted:false};
    return result;
  }finally{
    clearTimeout(guard);
    if(state.root_closed_at===null){owner.terminate('finally_cleanup');await owner.rootCompletion;}
    await Promise.all(state.pendingRequests);await owner.save();
    const {spec,pendingRequests,...receipt}=state;
    writePrivate(path.join(directory,'observations.json'),json({...receipt,argv:spec.args,controller_completion:outcome}));
    fixture.current=null;
  }
}
async function main(){
  const optionsValue=options(process.argv.slice(2)),transport=verifyTransport(optionsValue.transportWorktree);
  const harnessSha=sha(fs.readFileSync(new URL(import.meta.url)));
  assert.equal(await fileSha(optionsValue.binary),ROOT_SHA,'root binary must match reviewed physical fixture');
  const binaryBytes=fs.statSync(optionsValue.binary).size;
  const base=optionsValue.evidenceRoot??os.tmpdir();fs.mkdirSync(base,{recursive:true,mode:0o700});
  const evidence=fs.mkdtempSync(path.join(base,'joint-root-policy-transport-'));fs.chmodSync(evidence,0o700);
  writePrivate(path.join(evidence,'original-prompt.bin'),PROMPT);writePrivate(path.join(evidence,'source-readback.json'),json(transport));
  const src=name=>pathToFileURL(path.join(optionsValue.transportWorktree,'apps/metaengine-browser/src',name)).href;
  const modules={...await import(src('codex-cli-windows-process-controller.mjs')),...await import(src('codex-cli-physical-settlement.mjs'))};
  const fixture=createFixture();await new Promise((resolve,reject)=>{fixture.server.once('error',reject);fixture.server.listen(0,'127.0.0.1',resolve);});
  const baseUrl='http://127.0.0.1:'+fixture.server.address().port;
  const scenarios=[{name:'exact_original_task',success:true},{name:'no_ack_cancel',noAck:true},
    {name:'controller_wrong_original_prompt_rejected',rejectPrompt:true},{name:'controller_second_ack_record_rejected',rejectSecondAck:true},
    {name:'root_wrong_immutable_digest_rejected',wrongRootDigest:true},{name:'root_duplicate_ack_injected_by_double_rejected',injectDuplicateAck:true},
    {name:'forged_ack_written_context_rejected',forgeAckNotification:true},
    {name:'cancel_after_physical_ack_before_notification',holdAckNotification:true},
    {name:'fixed_deadline_before_ack',noAck:true,deadline:true},{name:'fixed_deadline_after_physical_ack',holdAckNotification:true,deadline:true}];
  const results=[];
  try{
    for(const scenario of scenarios)results.push(await runCase(optionsValue,evidence,fixture,baseUrl,scenario,modules));
    assert.equal(await fileSha(optionsValue.binary),ROOT_SHA);assert.deepEqual(verifyTransport(optionsValue.transportWorktree),transport);
    assert.equal(sha(fs.readFileSync(new URL(import.meta.url))),harnessSha,'joint harness changed during physical run');
    assert.equal(fixture.orphans.length,0);assert.ok(fixture.connections.every(value=>value.owner_nonce!==null&&value.owner_nonce===value.request_nonce));
    const summary={status:'JOINT_LINUX_ROOT_CONTROLLER_PROTOCOL_PASS',scope:'TEST_ONLY_PUBLISHED_JS_CONTROLLER_PLUS_REAL_LINUX_ROOT_PROTOCOL',
      transport,harness_sha256:harnessSha,root_binary_sha256:ROOT_SHA,root_binary_bytes:binaryBytes,upstream_commit:UPSTREAM,original_prompt_sha256:PROMPT_SHA,cases:results,
      pre_ack_tcp:results.reduce((sum,value)=>sum+value.pre_ack_tcp,0),pre_ack_http_or_websocket:results.reduce((sum,value)=>sum+value.pre_ack_http_or_websocket,0),
      pre_prompt_eof_tcp:results.reduce((sum,value)=>sum+value.pre_prompt_eof_tcp,0),premature_thread_or_turn:results.reduce((sum,value)=>sum+value.premature_thread_or_turn,0),
      mock_model_posts:results.reduce((sum,value)=>sum+value.mock_model_posts,0),orphan_fixture_traffic:fixture.orphans.length,real_model_calls:0,
      network_capture_scope:'configured loopback provider only; no general OS egress attestation',
      fixture_policy_checks:'test-scoped closed projection checks; production private consumer policy admission NOT exercised',
      deadline_owner:'TEST_ONLY Node bridge private Linux process-group SIGKILL before closing root stdin; same original absolute deadline',
      helper_ready_frames:'SYNTHETIC TEST ONLY; required to exercise published controller parser; not Windows/native proof',
      native_terminal_frames_emitted:0,joined_settlement_emitted:false,native_windows_qualified:false,
      physical_scope_capture_exercised:false,production_executable_cap_bytes:512*1024*1024,
      root_fixture_exceeds_production_capture_cap:binaryBytes>512*1024*1024,
      remaining_blockers:['Production private-consumer effective-policy validator/bootstrap wiring','Native Windows Job Object, watchdog and process custody qualification','Artifact distribution qualification: this debug root binary exceeds the existing 512 MiB capture cap'],
      evidence_directory:evidence};
    writePrivate(path.join(evidence,'summary.json'),json(summary));writePrivate(path.join(evidence,'network-observations.json'),json({connections:fixture.connections,orphans:fixture.orphans}));
    process.stdout.write(JSON.stringify(summary)+'\n');
  }catch(error){
    writePrivate(path.join(evidence,'failure.json'),json({reason:error.stack,completed_cases:results}));
    process.stderr.write(JSON.stringify({status:'JOINT_LINUX_ROOT_CONTROLLER_PROTOCOL_FAILED',reason:error.message,evidence_directory:evidence})+'\n');process.exitCode=1;
  }finally{fixture.server.closeAllConnections?.();await new Promise(resolve=>fixture.server.close(resolve));}
}
await main();
