#!/usr/bin/env node
// Persistent, single-tool MCP transport for local developer-authenticated
// DevFleet administration. Native executable owns all trust decisions.
// No shell, remote code execution, bearer-token export or hosted fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
const APP='METAENGINE DevFleet';
const SCHEMA='metaengine.devfleet.developer-rpc.v1';
const protocols=new Set(['2025-03-26','2025-06-18','2025-11-25']);
const methods=new Set([
  'dev.status','dev.overview','dev.stage','dev.activate','dev.rollback','dev.reconcile',
  'dev.contract.status','dev.contract.stage','dev.contract.activate',
  'dev.contract.rollback','dev.contract.reconcile',
  'dev.source.status','dev.source.inspect','dev.source.patch','dev.source.reconcile',
  'dev.receipt.status','dev.receipt.inspect','dev.receipt.reconcile','dev.receipt.abandon','dev.surface.inspect','dev.pipeline.rotate','dev.pipeline.rotate_batch','dev.pipeline.retire','dev.pipeline.retire_batch'
]);
const tools=[
  {name:'devfleet_overview',description:'One bounded, read-only observation of owned ChatGPT cells, exact receipts and native policy; never proves task completion',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false}},
  {name:'devfleet_admin',description:'Trusted local DevFleet hot administration: CAS edits in pinned source workspace, live contract generations, UI stage/activate/rollback, and native receipt reconciliation. Separate local developer capability required; no shell.',
    inputSchema:{type:'object',properties:{
      method:{type:'string',minLength:5,maxLength:80},
      params:{type:'object',additionalProperties:true}},
      required:['method'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}}
];
function errorText(error) {
  const message=String(error?.message||'devfleet_admin_error');
  return /^[a-z0-9_:-]{1,100}$/i.test(message)?message:'devfleet_admin_error';
}
async function native(method,params={}) {
  if(!methods.has(method))throw Error('developer_method_not_allowed');
  const appData=process.env.APPDATA;
  if(!appData)throw Error('appdata_unavailable');
  const manifest=JSON.parse(await fs.readFile(
    path.join(appData,APP,'developer-rpc.json'),'utf8'));
  const url=new URL(manifest.url);
  if(manifest.schema!==SCHEMA||manifest.app!==APP||manifest.workspace_pinned!==true||
    url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/rpc'||
    url.username||url.password||url.search||url.hash||
    typeof manifest.token!=='string'||!/^[0-9a-f]{64}$/.test(manifest.token))
    throw Error('untrusted_developer_manifest');
  const body=JSON.stringify({method,params});
  if(Buffer.byteLength(body)>350000)throw Error('admin_payload_budget_exceeded');
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+manifest.token,'Content-Type':'application/json'},
    body});
  const result=await response.json();
  if(!response.ok||result.ok!==true) {
    const msg=String(result.error||'admin_rpc_refused');
    throw Error(/^[a-z0-9_:-]{1,100}$/i.test(msg)?msg:'admin_rpc_refused');
  }
  return result.result;
}
const respond=(id,result,error)=>{
  const msg={jsonrpc:'2.0',id};
  if(error)msg.error={code:-32603,message:errorText(error)};
  else msg.result=result;
  process.stdout.write(JSON.stringify(msg)+'\n');
};
async function handle(input){
  if(!input||input.jsonrpc!=='2.0'||typeof input.method!=='string')return;
  if(input.id===undefined)return;
  try{
    if(input.method==='initialize')
      return respond(input.id,{
        protocolVersion:protocols.has(input.params?.protocolVersion)?input.params.protocolVersion:'2025-06-18',
        capabilities:{tools:{}},
        serverInfo:{name:'METAENGINE-DevFleet-LiveAdmin',version:'1.0.0'}});
    if(input.method==='ping')return respond(input.id,{});
    if(input.method==='tools/list')return respond(input.id,{tools});
    if(input.method==='tools/call'){
      const {name,arguments:args={}}=input.params||{};
      if(!args||typeof args!=='object'||Array.isArray(args))throw Error('admin_arguments_invalid');
      let output;
      if(name==='devfleet_overview'){
        if(Object.keys(args).length)throw Error('admin_arguments_invalid');
        output=await native('dev.overview');
      }else if(name==='devfleet_admin'){
        if(Object.keys(args).some(x=>!['method','params'].includes(x)))
          throw Error('admin_arguments_invalid');
        output=await native(args.method,args.params||{});
      }else throw Error('unknown_admin_tool');
      return respond(input.id,{content:[{type:'text',text:JSON.stringify(output)}],
        isError:false});
    }
    return respond(input.id,null,Error('method_not_found'));
  }catch(err) {
    if(input.method==='tools/call')
      return respond(input.id,{content:[{type:'text',text:JSON.stringify({
        error:errorText(err),automatic_retry_allowed:false})}],isError:true});
    return respond(input.id,null,err);
  }
}
let buffer='',chain=Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  buffer+=chunk;
  if(buffer.length>1048576){buffer='';return;}
  let offset;
  while((offset=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,offset).trim();
    buffer=buffer.slice(offset+1);
    if(!line)continue;
    // Serialize native administrative side effects; no overlapping writes.
    chain=chain.then(()=>handle(JSON.parse(line))).catch(()=>{});
  }
});
