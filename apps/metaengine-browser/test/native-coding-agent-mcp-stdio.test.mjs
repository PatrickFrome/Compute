import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createNativeCodingAgentMcpStdioAdapter} from '../src/native-coding-agent-mcp-stdio.mjs';

const binding=()=>({run_id:randomUUID(),workspace_id:randomUUID(),project_id:randomUUID(),task_id:randomUUID(),lease_generation:1,
  agent_id:'agent_native-mcp-test',agent_generation_epoch:1,provider_id:randomUUID(),role:'IMPLEMENTER'});
const modernMeta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
const all=['project_overview','project_history_page','agent_send_message','project_propose_children','client_control_intent'];
function fixture(t,options={}) {
  const input=new PassThrough(),output=new PassThrough(),scope=binding(),calls=[],authorizations=[],messages=[],waiters=new Map();
  let pending='',next=1;
  output.on('data',chunk=>{pending+=chunk;let i;while((i=pending.indexOf('\n'))!==-1){
    const value=JSON.parse(pending.slice(0,i));pending=pending.slice(i+1);messages.push(value);const item=waiters.get(value.id);
    if(item){waiters.delete(value.id);clearTimeout(item.timer);item.resolve(value);}
  }});
  const operations=Object.fromEntries(all.map(name=>[name,async(args,context)=>{calls.push({name,args,context});return {project_id:context.binding.project_id,value:'generated fixture'};}]));
  const adapter=createNativeCodingAgentMcpStdioAdapter({binding:scope,input,output,allowedTools:all,
    assertInvocationAuthorized:async context=>{authorizations.push(context);},...options,operations:{...operations,...options.operations}});
  t.after(()=>{adapter.close();input.destroy();output.destroy();for(const w of waiters.values())clearTimeout(w.timer);});
  const raw=(method,params={},meta=true)=>{
    const id=next++;const response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_response_timeout')),2000);waiters.set(id,{resolve,timer});});
    input.write(JSON.stringify({jsonrpc:'2.0',id,method,params:{...params,...(meta?{_meta:modernMeta}:{})}})+'\n');return response;
  };
  const call=(name,args)=>raw('tools/call',{name,arguments:args});
  return {input,output,scope,calls,authorizations,messages,adapter,raw,call};
}
const detail=response=>JSON.parse(response.result.content[0].text);

test('modern per-request MCP discovery and legacy initialization expose only trusted fixed tools',async t=>{
  const f=fixture(t,{allowedTools:['project_overview','project_history_page']});
  const discover=await f.raw('server/discover');assert.ok(discover.result.supportedVersions.includes('2026-07-28'));
  assert.equal(discover.result.resultType,'complete');
  const list=await f.raw('tools/list');assert.deepEqual(list.result.tools.map(tool=>tool.name),['project_overview','project_history_page']);
  assert.ok(list.result.tools.every(tool=>tool.inputSchema.additionalProperties===false));
  assert.equal((await f.raw('tools/list',{},false)).error.code,-32602);
  const initialized=await f.raw('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'generated-test',version:'1'}},false);
  assert.equal(initialized.result.protocolVersion,'2025-11-25');
  f.input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.equal((await f.raw('tools/list',{},false)).result.tools.length,2);
  const unsupported=await f.raw('tools/list',{_meta:{...modernMeta,'io.modelcontextprotocol/protocolVersion':'unknown'}},false);
  assert.equal(unsupported.error.code,-32022);assert.equal(f.calls.length,0);
});

test('model arguments cannot select Host identity, project, raw SQL or unrestricted client-control actions',async t=>{
  const f=fixture(t);
  for(const [name,args] of [['project_overview',{project_id:randomUUID()}],
    ['agent_send_message',{request_id:randomUUID(),target_agent_id:'agent_native-peer01',message:'hello',agent_id:'agent_forged-owner'}],
    ['client_control_intent',{request_id:randomUUID(),action:'EXEC_SQL',sql:'select 1'}],
    ['client_control_intent',{request_id:randomUUID(),action:'OPEN_PROJECT_FILE',relative_path:'../private.json'}]])
    assert.equal((await f.call(name,args)).error.code,-32602);
  assert.equal(f.calls.length,0);assert.equal(f.authorizations.length,0);
  const good=await f.call('project_overview',{});assert.equal(good.result.structuredContent.project_id,f.scope.project_id);
  assert.equal(f.authorizations[0].binding.task_id,f.scope.task_id);assert.equal(Object.isFrozen(f.authorizations[0].binding),true);
  assert.equal((await f.raw('sql.query',{query:'select 1'})).error.code,-32601);
});

test('history pages preserve full bounded content and pass a stable cursor without excerpts',async t=>{
  const complete='full message '.repeat(600),f=fixture(t,{operations:{project_history_page:async()=>({entries:[{seq:1,content:complete}],cursor:{next_seq:1,through_seq:10}})}});
  const response=await f.call('project_history_page',{after_seq:0,limit:16,through_seq:10});
  assert.equal(response.result.structuredContent.entries[0].content,complete);
  assert.equal(response.result.structuredContent.cursor.next_seq,1);
});

test('peer overview pagination and UTF8 message budgets match the private Host SQL contract',async t=>{
  const f=fixture(t);
  await f.call('project_overview',{after_seq:32,limit:32});assert.deepEqual(f.calls[0].args,{after_seq:32,limit:32});
  assert.equal((await f.call('project_overview',{limit:33})).error.code,-32602);
  assert.equal((await f.call('project_history_page',{after_seq:0,limit:17})).error.code,-32602);
  const args={request_id:randomUUID(),target_agent_id:'agent_native-peer01',message:'я'.repeat(4097)};
  assert.equal((await f.call('agent_send_message',args)).error.code,-32602);
  assert.equal(f.calls.length,1);
});

test('a timeout fences a write intent, retains the physical slot, and never upgrades a late acknowledgement',async t=>{
  let release,count=0;
  const f=fixture(t,{timeoutMs:20,maxInflight:1,operations:{agent_send_message:async()=>{count++;return new Promise(resolve=>{release=resolve;});}}});
  const args={request_id:randomUUID(),target_agent_id:'agent_native-peer01',message:'one durable intent'};
  const timed=await f.call('agent_send_message',args);assert.equal(detail(timed).effect_outcome,'UNKNOWN');assert.equal(detail(timed).readback_required,true);
  assert.equal(f.adapter.snapshot().inflight,1);
  assert.equal(detail(await f.call('agent_send_message',args)).reason,'TOOL_TIMEOUT');assert.equal(count,1);
  assert.equal(detail(await f.call('agent_send_message',{...args,message:'different intent body'})).reason,'INTENT_BODY_CHANGED');
  assert.equal(detail(await f.call('project_overview',{})).reason,'INFLIGHT_LIMIT');
  release({accepted:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.adapter.snapshot().inflight,0);
  assert.equal(detail(await f.call('agent_send_message',args)).reason,'TOOL_TIMEOUT');assert.equal(count,1);
});

test('intent capacity never evicts an ambiguous write to admit a duplicate',async t=>{
  const f=fixture(t,{maxIntents:1});
  const message={request_id:randomUUID(),target_agent_id:'agent_native-peer01',message:'first'};
  await f.call('agent_send_message',message);
  assert.equal(detail(await f.call('agent_send_message',{...message,request_id:randomUUID()})).reason,'INTENT_CAPACITY_FENCED');
  assert.equal(f.calls.length,1);
});

test('callback errors and private data never reach model-visible output',async t=>{
  const secret='postgresql://generated:do-not-expose@private.invalid/db';
  const f=fixture(t,{operations:{project_overview:async()=>{throw Error(secret);},project_history_page:async()=>({dsn:secret})}});
  assert.equal(detail(await f.call('project_overview',{})).reason,'HOST_OPERATION_UNCONFIRMED');
  assert.equal(detail(await f.call('project_history_page',{after_seq:0,limit:1})).reason,'HOST_OPERATION_UNCONFIRMED');
  assert.equal((await f.call('agent_send_message',{request_id:randomUUID(),target_agent_id:'agent_native-peer01',message:secret})).error.code,-32602);
  assert.equal(JSON.stringify(f.messages).includes(secret),false);
});

test('input closure aborts active calls without stdout after close or waiting for the tool deadline',async t=>{
  let authorized,signal;const entered=new Promise(resolve=>{authorized=resolve;});
  const f=fixture(t,{timeoutMs:20000,operations:{project_overview:async(_args,context)=>{signal=context.signal;authorized();return new Promise(()=>{});}}});
  f.input.write(JSON.stringify({jsonrpc:'2.0',id:99,method:'tools/call',params:{name:'project_overview',arguments:{},_meta:modernMeta}})+'\n');
  await entered;f.input.end();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.adapter.snapshot().closed,true);assert.equal(signal.aborted,true);assert.equal(f.messages.length,0);
});

test('framing rejects oversized and invalid UTF-8 input without invoking Host operations',async t=>{
  const f=fixture(t,{maxFrameBytes:1024});
  f.input.write(Buffer.from([0xff,0x0a]));assert.equal(f.messages[0].error.code,-32700);
  f.input.write('x'.repeat(1025));assert.equal(f.adapter.snapshot().closed,true);assert.equal(f.calls.length,0);
});

test('a real child stdio process supports discovery/list/call and exits on EOF without model/API calls',{timeout:20000},async()=>{
  const moduleUrl=new URL('../src/native-coding-agent-mcp-stdio.mjs',import.meta.url).href,scope=binding();
  const source=`import {createNativeCodingAgentMcpStdioAdapter} from ${JSON.stringify(moduleUrl)};
    createNativeCodingAgentMcpStdioAdapter({binding:${JSON.stringify(scope)},input:process.stdin,output:process.stdout,
      allowedTools:['project_overview'],assertInvocationAuthorized:async()=>{},operations:{project_overview:async()=>({source:'GENERATED_STDIO_FIXTURE',model_calls:0})}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
  let stdout='',stderr='';child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});
  const close=once(child,'close');
  for(const [id,method,params] of [[1,'server/discover',{}],[2,'tools/list',{}],[3,'tools/call',{name:'project_overview',arguments:{}}]])
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params:{...params,_meta:modernMeta}})+'\n');
  const deadline=Date.now()+10000;
  while(stdout.split('\n').filter(Boolean).length<3&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  child.stdin.end();const [code]=await close;
  assert.equal(code,0);assert.equal(stderr,'');const rows=stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.id).sort(),[1,2,3]);
  assert.equal(rows.find(row=>row.id===3).result.structuredContent.model_calls,0);
});
