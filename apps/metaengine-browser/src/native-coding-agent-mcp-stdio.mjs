import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const AGENT=/^agent_[a-z0-9-]{8,64}$/;
const MODERN='2026-07-28',LEGACY=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const INFO={name:'metaengine-native-agent-tools',version:'1.0.0'};
const TOOLS=['project_overview','project_history_page','agent_send_message','project_propose_children','client_control_intent'];
const WRITES=new Set(TOOLS.slice(2));
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const keys=(x,required,optional=[])=>plain(x)&&required.every(key=>Object.hasOwn(x,key))&&Object.keys(x).every(key=>required.includes(key)||optional.includes(key));
const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&!x.includes('\0');
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const fail=reason=>{throw Error('native_agent_mcp_'+reason);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function canonical(value,depth=0) {
  if(depth>16)fail('json_budget');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
  if(Array.isArray(value)){if(value.length>256)fail('json_budget');return '['+value.map(x=>canonical(x,depth+1)).join(',')+']';}
  if(!plain(value)||Object.keys(value).length>128)fail('json_type');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function noSecrets(value,depth=0) {
  if(depth>16)fail('json_budget');
  if(typeof value==='string'&&/(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\//i.test(value))fail('private_data_denied');
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)) {
    if(/^(?:dsn|database_url|connection_string|password|api_key|private_key)$/i.test(key))fail('private_data_denied');
    noSecrets(child,depth+1);
  }
}
const objectSchema=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const requestProperty={type:'string',format:'uuid'};
function toolDefinition(name) {
  const descriptions={project_overview:'Read the Host-scoped project and peer task overview.',
    project_history_page:'Read complete committed project history one bounded page at a time; use the returned cursor.',
    agent_send_message:'Store one durable message for a native or chat peer in this project; preserve request_id after an unknown outcome. Storage does not prove reading and does not wake a suspended chat peer.',
    project_propose_children:'Propose child work to the existing project allocator; this does not create a process or grant a lease.',
    client_control_intent:'Submit a fixed client-control intent for Host authorization and journaling; this is not arbitrary PC or shell access.'};
  const schemas={project_overview:objectSchema({after_seq:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:32}},[]),
    project_history_page:objectSchema({after_seq:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16},through_seq:{type:'integer',minimum:0}},['after_seq','limit']),
    agent_send_message:objectSchema({request_id:requestProperty,target_agent_id:{type:'string',pattern:AGENT.source},message:{type:'string',minLength:1,maxLength:8192,description:'UTF-8 body must fit 8192 bytes; Host may reject a complete serialized row that exceeds its durable page budget.'}}),
    project_propose_children:objectSchema({request_id:requestProperty,children:{type:'array',minItems:1,maxItems:16,
      items:objectSchema({role:{type:'string',enum:['IMPLEMENTER','CRITIC']},objective:{type:'string',minLength:1,maxLength:1000}})}}),
    client_control_intent:objectSchema({request_id:requestProperty,action:{type:'string',enum:['CLIENT_STATUS','OPEN_PROJECT_FILE','PREPARE_CLIENT_RESTART']},
      relative_path:{type:'string',minLength:1,maxLength:500}},['request_id','action'])};
  return {name,description:descriptions[name],inputSchema:schemas[name],annotations:{readOnlyHint:!WRITES.has(name),openWorldHint:false}};
}
function argumentsFor(name,args) {
  noSecrets(args);
  if(name==='project_overview'){if(!keys(args,[],['after_seq','limit'])
    ||Object.hasOwn(args,'after_seq')&&!integer(args.after_seq,0,Number.MAX_SAFE_INTEGER)
    ||Object.hasOwn(args,'limit')&&!integer(args.limit,1,32))fail('arguments');}
  else if(name==='project_history_page') {
    if(!keys(args,['after_seq','limit'],['through_seq'])||!integer(args.after_seq,0,Number.MAX_SAFE_INTEGER)||!integer(args.limit,1,16)
      ||Object.hasOwn(args,'through_seq')&&!integer(args.through_seq,args.after_seq,Number.MAX_SAFE_INTEGER))fail('arguments');
  }else {
    if(!UUID.test(args?.request_id||''))fail('arguments');
    if(name==='agent_send_message'&&(!keys(args,['request_id','target_agent_id','message'])||!AGENT.test(args.target_agent_id||'')
      ||!text(args.message,8192)||Buffer.byteLength(args.message)>8192))fail('arguments');
    if(name==='project_propose_children'&&(!keys(args,['request_id','children'])||!Array.isArray(args.children)||!args.children.length||args.children.length>16
      ||args.children.some(child=>!keys(child,['role','objective'])||!['IMPLEMENTER','CRITIC'].includes(child.role)||!text(child.objective,1000))))fail('arguments');
    if(name==='client_control_intent') {
      if(!keys(args,['request_id','action'],['relative_path'])||!['CLIENT_STATUS','OPEN_PROJECT_FILE','PREPARE_CLIENT_RESTART'].includes(args.action))fail('arguments');
      if(args.action==='OPEN_PROJECT_FILE') {
        if(!text(args.relative_path,500)||/^[\\/]|^[a-z]:/i.test(args.relative_path)||args.relative_path.split(/[\\/]/).some(part=>!part||part==='..'||part==='.')
          ||/[\x00-\x1f<>:"|?*]/.test(args.relative_path))fail('arguments');
      }else if(Object.hasOwn(args,'relative_path'))fail('arguments');
    }
  }
  return structuredClone(args);
}

// Protocol adapter ONLY. It has no CLI launcher, broker, credentials, socket,
// SQL, scheduler, OS-effect producer, or production activation entry point.
// assertInvocationAuthorized and operations MUST be private live Host closures
// before deployment. ClientInfo/_meta and model arguments never select scope.
export function createNativeCodingAgentMcpStdioAdapter({binding,operations,assertInvocationAuthorized,
  allowedTools=['project_overview','project_history_page'],input,output,timeoutMs=63000,maxInflight=8,maxFrameBytes=256*1024,maxIntents=256,
  writeIntentAuthority='LOCAL_ADAPTER'}={}) {
  if(!keys(binding,['run_id','workspace_id','project_id','task_id','lease_generation','agent_id','agent_generation_epoch','provider_id','role'])
    ||['run_id','workspace_id','project_id','task_id','provider_id'].some(key=>!UUID.test(binding[key]||''))
    ||!AGENT.test(binding.agent_id||'')||!['IMPLEMENTER','CRITIC'].includes(binding.role)
    ||!integer(binding.lease_generation,1,Number.MAX_SAFE_INTEGER)||!integer(binding.agent_generation_epoch,1,Number.MAX_SAFE_INTEGER)
    ||typeof assertInvocationAuthorized!=='function'||!Array.isArray(allowedTools)||!allowedTools.length||allowedTools.length>TOOLS.length
    ||new Set(allowedTools).size!==allowedTools.length||allowedTools.some(name=>!TOOLS.includes(name)||typeof operations?.[name]!=='function')
    ||typeof input?.on!=='function'||typeof output?.write!=='function'||!integer(timeoutMs,1,68000)||!integer(maxInflight,1,16)
    ||!integer(maxFrameBytes,1024,256*1024)||!integer(maxIntents,1,1024)
    ||!['LOCAL_ADAPTER','PRIVATE_HOST_BROKER'].includes(writeIntentAuthority))fail('private_capabilities_required');
  const scope=Object.freeze(structuredClone(binding)),allowed=new Set(allowedTools),intents=new Map(),active=new Map();
  let closed=false,legacyVersion=null,legacyReady=false,pending=Buffer.alloc(0),inflight=0;
  const resultFor=(modern,result)=>modern?{...result,resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':INFO}}:result;
  function send(frame) {
    if(closed)return;
    const bytes=JSON.stringify(frame)+'\n';
    if(Buffer.byteLength(bytes)>maxFrameBytes||(output.writableLength??0)>maxFrameBytes*16){close();return;}
    output.write(bytes);
  }
  const error=(id,code,message,data)=>send({jsonrpc:'2.0',...(id===undefined?{}:{id}),error:{code,message,...(data?{data}:{})}});
  function outcome(reason,write,requestId=null) {
    return {isError:true,content:[{type:'text',text:JSON.stringify({reason,effect_outcome:write?'UNKNOWN':'NONE',
      readback_required:write,automatic_retry_allowed:false,request_id:requestId})}]};
  }
  function close() {
    if(closed)return;closed=true;input.off('data',onData);input.off('end',onEnd);input.off('error',onEnd);output.off?.('error',onEnd);
    for(const item of active.values()){item.cancelled=true;item.controller.abort();
      if(item.intent)item.intent.result=outcome('CHANNEL_CLOSED',true,item.intent.requestId);item.finish?.('CHANNEL_CLOSED');}
    pending=Buffer.alloc(0);
  }
  async function call(frame,modern,args,name) {
    const write=WRITES.has(name),requestId=write?args.request_id:null,bodySha=digest({name,args});
    let intent=null;
    // In the trusted broker entrypoint every call, including a duplicate intent,
    // must reach Host lease/Job revalidation. Its registry owns deduplication.
    if(write&&writeIntentAuthority==='LOCAL_ADAPTER') {
      intent=intents.get(requestId);
      if(intent) {
        const result=intent.bodySha!==bodySha?outcome('INTENT_BODY_CHANGED',true,requestId)
          :intent.result??outcome('INTENT_READBACK_REQUIRED',true,requestId);
        send({jsonrpc:'2.0',id:frame.id,result:resultFor(modern,result)});return;
      }
      // No eviction: forgotten ambiguous writes must never become executable.
      if(intents.size>=maxIntents){send({jsonrpc:'2.0',id:frame.id,result:resultFor(modern,outcome('INTENT_CAPACITY_FENCED',true,requestId))});return;}
      intent={requestId,bodySha,result:null};intents.set(requestId,intent);
    }
    if(inflight>=maxInflight){const result=outcome('INFLIGHT_LIMIT',write,requestId);if(intent)intent.result=result;
      send({jsonrpc:'2.0',id:frame.id,result:resultFor(modern,result)});return;}
    const item={controller:new AbortController(),intent,cancelled:false};active.set(frame.id,item);inflight++;
    let timer,timedOut=false;
    const work=(async()=>{
      const context=Object.freeze({binding:scope,tool:name,request_id:requestId,arguments_sha256:bodySha,signal:item.controller.signal});
      await assertInvocationAuthorized(context);
      if(closed||item.cancelled||item.controller.signal.aborted)fail('operation_aborted');
      const value=await operations[name](freeze(args),context);
      if(!plain(value))fail('host_result_invalid');noSecrets(value);canonical(value);
      const result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};
      // Preserve complete pages in text; duplicating a large page as structured
      // content would exceed the same wire budget without adding information.
      if(Buffer.byteLength(JSON.stringify({...result,structuredContent:value}))<=maxFrameBytes-1024)result.structuredContent=value;
      if(Buffer.byteLength(JSON.stringify(result))>maxFrameBytes-1024)fail('output_budget');return result;
    })();
    // Physical work retains its slot until it settles, even after timeout.
    work.catch(()=>{}).finally(()=>{inflight--;});
    const timeout=new Promise(resolve=>{
      item.finish=reason=>{clearTimeout(timer);item.controller.abort();resolve(outcome(reason,write,requestId));};
      timer=setTimeout(()=>{timedOut=true;item.finish('TOOL_TIMEOUT');},timeoutMs);
    });
    let result;
    try{result=await Promise.race([work,timeout]);}catch{result=outcome('HOST_OPERATION_UNCONFIRMED',write,requestId);}
    clearTimeout(timer);if(intent)intent.result=result;active.delete(frame.id);
    if(!closed&&!item.cancelled)send({jsonrpc:'2.0',id:frame.id,result:resultFor(modern,result)});
    if(timedOut)work.catch(()=>{}); // Never execute, retry, or upgrade a late acknowledgement.
  }
  function frame(line) {
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));canonical(value);}catch{error(undefined,-32700,'Invalid JSON');return;}
    if(!keys(value,['jsonrpc','method'],['id','params'])||value.jsonrpc!=='2.0'||typeof value.method!=='string'
      ||Object.hasOwn(value,'id')&&!(typeof value.id==='string'&&text(value.id,128)||Number.isSafeInteger(value.id))) {error(value?.id,-32600,'Invalid request');return;}
    const notification=!Object.hasOwn(value,'id'),params=value.params??{};
    if(!plain(params)){if(!notification)error(value.id,-32602,'Invalid params');return;}
    if(notification) {
      if(value.method==='notifications/initialized'&&legacyVersion)legacyReady=true;
      if(value.method==='notifications/cancelled') {
        const item=active.get(params.requestId);if(item){item.cancelled=true;item.controller.abort();if(item.intent)item.intent.result=outcome('REQUEST_CANCELLED',true,item.intent.requestId);item.finish?.('REQUEST_CANCELLED');}
      }
      return;
    }
    if(active.has(value.id)){error(value.id,-32600,'Request ID already active');return;}
    const meta=params._meta,requested=meta?.['io.modelcontextprotocol/protocolVersion'],modern=requested!==undefined;
    if(modern&&(requested!==MODERN||!plain(meta['io.modelcontextprotocol/clientCapabilities']))) {
      if(requested!==MODERN)error(value.id,-32022,'Unsupported protocol version',{supported:[MODERN,...LEGACY],requested});
      else error(value.id,-32602,'Required protocol metadata missing');return;
    }
    if(value.method==='initialize') {
      if(modern||legacyVersion||!keys(params,['protocolVersion','capabilities','clientInfo'],['_meta'])
        ||!LEGACY.includes(params.protocolVersion)||!plain(params.capabilities)||!plain(params.clientInfo)) {error(value.id,-32602,'Invalid initialization');return;}
      legacyVersion=params.protocolVersion;send({jsonrpc:'2.0',id:value.id,result:{protocolVersion:legacyVersion,capabilities:{tools:{}},serverInfo:INFO}});return;
    }
    if(!modern&&!legacyReady){error(value.id,-32602,'Protocol initialization required');return;}
    if(value.method==='server/discover'&&modern){send({jsonrpc:'2.0',id:value.id,result:resultFor(true,{supportedVersions:[MODERN,...LEGACY],capabilities:{tools:{}},cacheScope:'private',ttlMs:0})});return;}
    if(value.method==='ping'){send({jsonrpc:'2.0',id:value.id,result:resultFor(modern,{})});return;}
    if(value.method==='tools/list') {
      if(!keys(params,[],['_meta'])){error(value.id,-32602,'Invalid params');return;}
      send({jsonrpc:'2.0',id:value.id,result:resultFor(modern,{tools:allowedTools.map(toolDefinition)})});return;
    }
    if(value.method!=='tools/call'){error(value.id,-32601,'Method not found');return;}
    if(!keys(params,['name','arguments'],['_meta'])||!allowed.has(params.name)){error(value.id,-32602,'Tool unavailable');return;}
    let args;try{args=argumentsFor(params.name,params.arguments);}catch{error(value.id,-32602,'Invalid tool arguments');return;}
    void call(value,modern,args,params.name);
  }
  function onData(chunk) {
    if(closed)return;pending=Buffer.concat([pending,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
    let index;
    while((index=pending.indexOf(10))!==-1){const line=pending.subarray(0,index);pending=pending.subarray(index+1);
      if(line.length>maxFrameBytes){error(undefined,-32600,'Frame budget exceeded');close();return;}if(line.length)frame(line);if(closed)return;}
    if(pending.length>maxFrameBytes){error(undefined,-32600,'Frame budget exceeded');close();}
  }
  function onEnd(){close();}
  input.on('data',onData);input.once('end',onEnd);input.once('error',onEnd);output.once?.('error',onEnd);
  return Object.freeze({close,snapshot:()=>({closed,inflight,intents:intents.size,legacy_ready:legacyReady,
    broker_connected:false,production_activated:false,authority_effect:false})});
}
