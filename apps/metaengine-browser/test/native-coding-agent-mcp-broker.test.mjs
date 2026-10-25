import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createNativeCodingAgentMcpBroker,connectNativeCodingAgentMcpBroker,NATIVE_AGENT_MCP_TOOLS,nativeCodingAgentMcpIntentBodySha256} from '../src/native-coding-agent-mcp-broker.mjs';
import {createNativeCodingAgentMcpLaunch} from '../src/native-coding-agent-mcp-launch.mjs';
import {NATIVE_AGENT_MCP_ENV} from '../src/native-coding-agent-mcp-entry.mjs';

const entry=fileURLToPath(new URL('../src/native-coding-agent-mcp-entry.mjs',import.meta.url));
const binding=()=>({run_id:randomUUID(),workspace_id:randomUUID(),project_id:randomUUID(),task_id:randomUUID(),lease_generation:2,
  agent_id:'agent_native-mcp-broker',agent_generation_epoch:3,provider_id:randomUUID(),role:'IMPLEMENTER'});
// Structurally representative only; the authorization callback below is a test
// fixture and does not claim this PID exists or belongs to a real native Job.
const job=b=>({job_id:b.run_id,pid:12345,process_incarnation_id:'pid:12345:created_100ns:134374467032387720',executable_sha256:'a'.repeat(64)});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const endpoint=()=>process.platform==='win32'?`\\\\.\\pipe\\METAENGINE-NativeMcp-${randomUUID()}`:path.join(os.tmpdir(),`me-mcp-${randomUUID()}.sock`);
const message=()=>({request_id:randomUUID(),target_agent_id:'agent_native-mcp-peer',message:'full addressed message'});
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
async function fixture(t,options={}){
  const calls=[],authorizations=[];
  const operations=Object.fromEntries(NATIVE_AGENT_MCP_TOOLS.map(name=>[name,async(args,context)=>{calls.push({name,args,context});return {project_id:context.binding.project_id,task_id:context.binding.task_id,tool:name};}]));
  const broker=await createNativeCodingAgentMcpBroker({endpoint:endpoint(),...options,operations:{...operations,...options.operations},
    // Fixture callbacks are not evidence of physical lease/Job authority.
    ...(options.assertInvocationAuthorized?{}:{assertInvocationAuthorized:async context=>{authorizations.push(context);await options.authorize?.(context);}})});
  const issued=[];t.after(async()=>{await broker.close();if(process.platform!=='win32')for(const value of issued)await fs.rm(value.endpoint,{force:true});});
  const issue=(overrides={})=>{const b=overrides.binding??binding();const value=broker.issueRun({binding:b,jobBinding:job(b),
    expiresAt:Date.now()+60000,...overrides});issued.push(value);return value;};
  const connect=async registration=>{const client=await connectNativeCodingAgentMcpBroker(registration);t.after(()=>client.close());return client;};
  return {broker,issue,connect,calls,authorizations};
}
function subprocess(t,registration,extraEnv={}){
  const child=spawn(process.execPath,[entry],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,
    [NATIVE_AGENT_MCP_ENV.endpoint]:registration.endpoint,[NATIVE_AGENT_MCP_ENV.capability]:registration.capability,...extraEnv}});
  let pending='',stderr='',next=1;const waiters=new Map(),frames=[];
  const completion=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.stdout.on('data',chunk=>{pending+=chunk;let index;while((index=pending.indexOf('\n'))!==-1){
    const frame=JSON.parse(pending.slice(0,index));pending=pending.slice(index+1);frames.push(frame);
    const item=waiters.get(frame.id);if(item){clearTimeout(item.timer);waiters.delete(frame.id);item.resolve(frame);}
  }});
  const request=(method,params={})=>{const id=next++;const result=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('fixture_stdio_timeout')),5000);waiters.set(id,{resolve,timer});});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params:{...params,_meta:meta}})+'\n');return result;};
  t.after(async()=>{for(const item of waiters.values())clearTimeout(item.timer);child.stdin.destroy();if(child.exitCode===null)child.kill();await completion;});
  return {child,completion,request,frames,stderr:()=>stderr};
}

test('real Node stdio entrypoint reaches only the private registered Host scope and closes at EOF',async t=>{
  const f=await fixture(t),registration=f.issue(),p=subprocess(t,registration);
  const discovery=await p.request('server/discover');assert.ok(discovery.result.supportedVersions.includes('2026-07-28'));
  const catalog=await p.request('tools/list');assert.deepEqual(catalog.result.tools.map(x=>x.name),['project_overview','project_history_page']);
  const overview=await p.request('tools/call',{name:'project_overview',arguments:{}});
  assert.equal(overview.result.structuredContent.project_id,registration.binding.project_id);
  assert.equal(f.calls.length,1);assert.equal(f.authorizations.length,1);
  assert.deepEqual(f.calls[0].context.jobBinding,job(registration.binding));
  assert.equal(Object.isFrozen(f.calls[0].context.binding),true);
  assert.equal(Object.isFrozen(f.calls[0].context.jobBinding),true);
  assert.equal(f.calls[0].context.binding.lease_generation,2);
  p.child.stdin.end();const done=await p.completion;assert.equal(done.code,0);assert.equal(p.stderr(),'');
  assert.equal(JSON.stringify(p.frames).includes(registration.capability),false);
  assert.equal(JSON.stringify(registration).includes(registration.capability),false);
});

test('random capability, fixed argument schemas, separate run scopes, and readonly defaults prevent caller identity injection',async t=>{
  const f=await fixture(t),first=f.issue(),second=f.issue(),a=await f.connect(first),b=await f.connect(second);
  await assert.rejects(connectNativeCodingAgentMcpBroker({...first,capability:'b'.repeat(64),timeoutMs:100}),/authentication_failed/);
  await assert.rejects(a.invoke('project_overview',{run_id:second.binding.run_id,project_id:second.binding.project_id}),/arguments/);
  await assert.rejects(a.invoke('agent_send_message',message()),/tool_denied/);
  assert.equal((await a.invoke('project_overview',{})).project_id,first.binding.project_id);
  assert.equal((await b.invoke('project_overview',{})).project_id,second.binding.project_id);
  assert.equal(f.calls.length,2);assert.equal(f.authorizations.length,2);
});

test('a capability prepared before spawn remains unusable until one exact suspended Job binding is supplied',async t=>{
  const f=await fixture(t),registration=f.issue({jobBinding:null});
  await assert.rejects(connectNativeCodingAgentMcpBroker(registration),/authentication_failed/);
  assert.equal(f.broker.bindRun(registration.binding.run_id,job(registration.binding)),true);
  assert.throws(()=>f.broker.bindRun(registration.binding.run_id,job(registration.binding)),/job_binding_denied/);
  const client=await f.connect(registration);await client.invoke('project_overview',{});assert.equal(f.calls.length,1);
  const other=f.issue({jobBinding:null}),actualJob={...job(other.binding),job_id:randomUUID()};
  assert.equal(f.broker.bindRun(other.binding.run_id,actualJob),true);
  const second=await f.connect(other);await second.invoke('project_overview',{});assert.equal(f.calls[1].context.jobBinding.job_id,actualJob.job_id);
  assert.throws(()=>f.broker.bindRun(randomUUID(),actualJob),/job_binding_denied/);
});

test('current private lease and native Job assertion runs for every tool and every cached write readback',async t=>{
  let valid=true;const f=await fixture(t,{authorize:()=>{if(!valid)throw Error('PRIVATE_RAW_DETAIL');}});
  const registration=f.issue({allowedTools:[...NATIVE_AGENT_MCP_TOOLS]}),client=await f.connect(registration),args=message();
  await client.invoke('agent_send_message',args);await client.invoke('agent_send_message',args);
  assert.equal(f.calls.length,1);assert.equal(f.authorizations.length,2);
  valid=false;await assert.rejects(client.invoke('agent_send_message',args),/host_unconfirmed/);
  await assert.rejects(client.invoke('project_overview',{}),/host_unconfirmed/);
  assert.equal(f.authorizations.length,4);assert.equal(f.calls.length,1);
});

test('real stdio duplicate write requests revalidate the Host after the lease changes while executing the effect only once',async t=>{
  let valid=true;const f=await fixture(t,{authorize:()=>{if(!valid)throw Error('lease fixture revoked');}});
  const registration=f.issue({allowedTools:[...NATIVE_AGENT_MCP_TOOLS]}),p=subprocess(t,registration),args=message();
  const request=()=>p.request('tools/call',{name:'agent_send_message',arguments:args});
  assert.equal((await request()).result.isError,false);assert.equal((await request()).result.isError,false);
  assert.equal(f.calls.length,1);assert.equal(f.authorizations.length,2);
  valid=false;const denied=await request();assert.equal(denied.result.isError,true);
  assert.equal(f.calls.length,1);assert.equal(f.authorizations.length,3);
});

test('real pipe and stdio preserve a complete large history page without a duplicated payload or truncated message',async t=>{
  const entries=Array.from({length:16},(_,index)=>({seq:index+1,content:'full history '.repeat(850)}));
  const full={entries,cursor:{next_seq:16,through_seq:32},truncated:false};
  const f=await fixture(t,{operations:{project_history_page:async()=>full}}),registration=f.issue(),p=subprocess(t,registration);
  const response=await p.request('tools/call',{name:'project_history_page',arguments:{after_seq:0,limit:16,through_seq:32}});
  assert.equal(response.result.isError,false);assert.equal(Object.hasOwn(response.result,'structuredContent'),false);
  assert.deepEqual(JSON.parse(response.result.content[0].text),full);
  assert.equal(Buffer.byteLength(JSON.stringify(response))<256*1024,true);
});

test('mutual nonce-bound pipe authentication rejects an impersonated Host without exposing the capability on the wire',async t=>{
  const address=endpoint(),capability='c'.repeat(64),captured=[];let socket;
  const server=net.createServer(peer=>{socket=peer;let pending='';peer.on('data',chunk=>{pending+=chunk;let index;
    while((index=pending.indexOf('\n'))!==-1){const frame=JSON.parse(pending.slice(0,index));pending=pending.slice(index+1);captured.push(frame);
      const value=frame.action==='AUTHENTICATE'?{challenge:'d'.repeat(64)}:{binding:binding(),allowed_tools:['project_overview'],timeout_ms:100,
        expires_at:new Date(Date.now()+60000).toISOString(),server_proof:'0'.repeat(64)};
      peer.write(JSON.stringify({schema:frame.schema,id:frame.id,ok:true,value})+'\n');
    }
  });});
  await new Promise(resolve=>server.listen(address,resolve));
  t.after(async()=>{socket?.destroy();await new Promise(resolve=>server.close(resolve));if(process.platform!=='win32')await fs.rm(address,{force:true});});
  await assert.rejects(connectNativeCodingAgentMcpBroker({endpoint:address,capability}),/handshake/);
  assert.equal(captured.length,2);assert.equal(JSON.stringify(captured).includes(capability),false);
  assert.equal(captured[0].action,'AUTHENTICATE');assert.equal(captured[1].action,'PROVE');
});

test('Host timeout persists an UNKNOWN write across stdio reconnect and late acknowledgements never replay or upgrade it',async t=>{
  let release,count=0;const f=await fixture(t,{timeoutMs:25,maxIntents:1,operations:{agent_send_message:async()=>{count++;return new Promise(resolve=>{release=resolve;});}}});
  const registration=f.issue({allowedTools:[...NATIVE_AGENT_MCP_TOOLS]}),client=await f.connect(registration),args=message();
  await assert.rejects(client.invoke('agent_send_message',args),/host_unconfirmed/);assert.equal(count,1);assert.equal(f.broker.snapshot().inflight,1);
  client.close();const next=await f.connect(registration);
  await assert.rejects(next.invoke('agent_send_message',args),/host_unconfirmed/);assert.equal(count,1);
  await assert.rejects(next.invoke('agent_send_message',{...args,message:'changed'}),/host_unconfirmed/);
  await assert.rejects(next.invoke('agent_send_message',message()),/host_unconfirmed/);assert.equal(count,1);
  release({accepted:true});await sleep(5);assert.equal(f.broker.snapshot().inflight,0);
  await assert.rejects(next.invoke('agent_send_message',args),/host_unconfirmed/);assert.equal(count,1);
});

test('lost connection freezes an in-flight write in the Host registry before a second entrypoint can resend it',async t=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});let count=0;
  const f=await fixture(t,{operations:{agent_send_message:async()=>{count++;entered();return new Promise(resolve=>{release=resolve;});}}});
  const registration=f.issue({allowedTools:[...NATIVE_AGENT_MCP_TOOLS]}),client=await f.connect(registration),args=message();
  const result=client.invoke('agent_send_message',args);await started;client.close();await assert.rejects(result,/channel_closed/);
  await sleep(5);const next=await f.connect(registration);await assert.rejects(next.invoke('agent_send_message',args),/host_unconfirmed/);
  release({accepted:true});await sleep(5);assert.equal(count,1);
});

test('a changed UUID cannot replay an UNKNOWN semantic body before a private saved receipt readback; a different body remains independent',async t=>{
  let calls=0,receipt=null;const f=await fixture(t,{readIntentReceipt:async()=>receipt,
    operations:{agent_send_message:async args=>{calls++;if(calls===1)throw Error('generated ambiguous transport');return {state:'CAPACITY_WAIT',message:args.message};}}});
  const registration=f.issue({allowedTools:[...NATIVE_AGENT_MCP_TOOLS]}),p=subprocess(t,registration),args=message();
  const request=body=>p.request('tools/call',{name:'agent_send_message',arguments:body});
  assert.equal((await request(args)).result.isError,true);assert.equal(calls,1);
  assert.equal((await request({...args,request_id:randomUUID()})).result.isError,true);assert.equal(calls,1);
  await assert.rejects(f.broker.reconcileIntent(registration.binding.run_id,args.request_id),/readback_denied/);
  assert.equal((await request({...args,request_id:randomUUID(),message:'a genuinely different task body'})).result.isError,false);assert.equal(calls,2);
  const semantic=nativeCodingAgentMcpIntentBodySha256('agent_send_message',args);
  assert.equal(semantic,nativeCodingAgentMcpIntentBodySha256('agent_send_message',{...args,request_id:randomUUID()}));
  // This generated private saved receipt tests the transport contract only; it
  // is not presented as a PG or installed-client authority receipt.
  receipt={schema:'metaengine.native-coding.agent-tool-receipt.v1',run_id:registration.binding.run_id,tool:'agent_send_message',
    request_id:args.request_id,intent_body_sha256:semantic,state:'NO_EFFECT',result:{state:'CAPACITY_WAIT',authority_effect:false},authority_effect:false};
  const saved=await f.broker.reconcileIntent(registration.binding.run_id,args.request_id);assert.equal(saved.state,'NO_EFFECT');
  assert.equal((await request({...args,request_id:randomUUID()})).result.isError,false);assert.equal(calls,3);
  // Known CAPACITY_WAIT has no ambiguous effect and does not fence a fresh check.
  assert.equal((await request({...args,request_id:randomUUID()})).result.isError,false);assert.equal(calls,4);
});

test('a fulfilled Host callback carrying an explicit UNKNOWN outcome still fences a new UUID with the same body',async t=>{
  let calls=0;const f=await fixture(t,{operations:{project_propose_children:async()=>{calls++;return {state:'READBACK_REQUIRED',effect_outcome:'UNKNOWN'};}}});
  const registration=f.issue({allowedTools:[...NATIVE_AGENT_MCP_TOOLS]}),client=await f.connect(registration);
  const args={request_id:randomUUID(),children:[{role:'IMPLEMENTER',objective:'one child proposal'}]};
  await assert.rejects(client.invoke('project_propose_children',args),/host_unconfirmed/);
  await assert.rejects(client.invoke('project_propose_children',{...args,request_id:randomUUID()}),/host_unconfirmed/);
  assert.equal(calls,1);
});

test('revoke and expiry abort current callbacks, reject reconnect, and never expose raw Host failures',async t=>{
  let signal,entered;const started=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{operations:{project_overview:async(_args,context)=>{signal=context.signal;entered();return new Promise(()=>{});}}});
  const registration=f.issue(),client=await f.connect(registration),call=client.invoke('project_overview',{});await started;
  f.broker.revokeRun(registration.binding.run_id);await assert.rejects(call,/channel_closed|host_unconfirmed/);assert.equal(signal.aborted,true);
  await assert.rejects(connectNativeCodingAgentMcpBroker(registration),/authentication_failed/);
  const short=f.issue({expiresAt:Date.now()+30});await sleep(45);
  await assert.rejects(connectNativeCodingAgentMcpBroker(short),/authentication_failed/);
  assert.equal(f.broker.snapshot().active_runs,0);
});

test('unauthenticated malformed and oversized local pipe frames are closed without invoking Host callbacks',async t=>{
  const f=await fixture(t,{maxFrameBytes:1024}),registration=f.issue();
  for(const bytes of [Buffer.from([0xff,10]),Buffer.from('x'.repeat(1025)),Buffer.from(JSON.stringify({schema:'wrong',id:randomUUID(),action:'AUTHENTICATE',capability:registration.capability})+'\n')]){
    const socket=net.createConnection(registration.endpoint);socket.on('error',()=>{});
    const done=new Promise(resolve=>socket.once('close',resolve));socket.write(bytes);await done;
  }
  assert.equal(f.calls.length,0);assert.equal(f.authorizations.length,0);
});

test('explicit launch hook pins local code, preserves the sanitized environment, and keeps the capability out of argv and metadata',async t=>{
  const f=await fixture(t),registration=f.issue({jobBinding:null});
  const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const bridgeSha256={entrypoint:await sha(entry),broker:await sha(path.join(path.dirname(entry),'native-coding-agent-mcp-broker.mjs')),
    adapter:await sha(path.join(path.dirname(entry),'native-coding-agent-mcp-stdio.mjs'))};
  const options={registration,nodeExecutable:process.execPath,nodeSha256:await sha(process.execPath),entrypointPath:entry,bridgeSha256,shellEnvironmentExcludes:['EXISTING_SECRET_*']};
  const launch=await createNativeCodingAgentMcpLaunch(options),sanitized={PATH:'generated-path',CODEX_HOME:'generated-protected-auth',TEMP:'generated-private-temp'};
  const env=launch.createEnvironment(sanitized);
  assert.deepEqual(Object.keys(env).sort(),[...Object.keys(sanitized),...Object.values(NATIVE_AGENT_MCP_ENV)].sort());
  assert.equal(env.CODEX_HOME,sanitized.CODEX_HOME);assert.equal(env.TEMP,sanitized.TEMP);assert.equal(Object.isFrozen(env),true);
  assert.equal(env[NATIVE_AGENT_MCP_ENV.capability],registration.capability);
  assert.equal(JSON.stringify(launch).includes(registration.capability),false);assert.equal(launch.argv.join(' ').includes(registration.capability),false);
  assert.match(launch.argv.join(' '),/env_vars=/);assert.match(launch.argv.join(' '),/EXISTING_SECRET_\*/);assert.match(launch.argv.join(' '),/METAENGINE_NATIVE_MCP_\*/);
  assert.throws(()=>launch.createEnvironment({...sanitized,metaengine_native_mcp_capability:'injected'}),/launch_denied/);
  await assert.rejects(createNativeCodingAgentMcpLaunch({...options,bridgeSha256:{...bridgeSha256,entrypoint:'0'.repeat(64)}}),/launch_denied/);
});
