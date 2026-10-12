#!/usr/bin/env node
// Native local METAENGINE DevFleet operator. No ChatGPT or database credentials
// are passed in command-line arguments; only an own-user local bearer is read.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const [verb,...argv] = process.argv.slice(2);
if (!['create','read','assign','list','inspect','recover','model_probe','input_probe','close','batch_assign','batch_observe','batch_poll'].includes(verb)) throw new Error('usage: devfleet-cli.mjs create|read|assign|list [--count N] [--tab ID] [--file FILE] [--id REQUEST_ID]');
const flags={};
for(let i=0;i<argv.length;i+=2) {
  if(i+1>=argv.length || !['--count','--tab','--file','--id','--offset','--max-chars'].includes(argv[i])
    || Object.hasOwn(flags,argv[i])) throw new Error('invalid_option');
  flags[argv[i]]=argv[i+1];
}
const appData=process.env.APPDATA;
if(!appData)throw new Error('user_appdata_unavailable');
const manifest=JSON.parse(await fs.readFile(path.join(appData,'METAENGINE DevFleet','operator-rpc.json'),'utf8'));
const endpoint=new URL(manifest.url);
if (manifest.schema!=='metaengine.devfleet.loopback.v1' ||
    manifest.app!=='METAENGINE DevFleet' ||
    endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1' ||
    endpoint.pathname!=='/rpc' || endpoint.search || endpoint.hash ||
    typeof manifest.token!=='string' || !/^[0-9a-f]{64}$/.test(manifest.token))
  throw new Error('untrusted_devfleet_manifest');
const params={};
if(verb==='create'){params.request_id=flags['--id']||crypto.randomUUID();params.count=Number(flags['--count']||1);}
if(verb==='read'||verb==='assign'||verb==='inspect'||verb==='recover'||verb==='model_probe'||verb==='input_probe'||verb==='close'){
  if(!flags['--tab'])throw new Error('tab_required');
  params.tab_id=flags['--tab'];
}
if(verb==='close')params.request_id=flags['--id']||crypto.randomUUID();
if(verb==='assign'){
  if(!flags['--file'])throw new Error('prompt_file_required');
  const stat=await fs.stat(flags['--file']);
  if(!stat.isFile()||stat.size>45000)throw new Error('prompt_file_bounds');
  params.text=await fs.readFile(flags['--file'],'utf8');
  params.request_id=flags['--id']||crypto.randomUUID();
}
if(verb==='batch_assign'){
  if(!flags['--file'] || flags['--id'] || flags['--tab'])
    throw new Error('batch_file_only_required');
  const stat=await fs.stat(flags['--file']);
  if(!stat.isFile() || stat.size<2 || stat.size>45000)
    throw new Error('batch_file_bounds_invalid');
  const data=JSON.parse(await fs.readFile(flags['--file'],'utf8'));
  if(!data || typeof data!=='object' || Array.isArray(data) ||
      Object.keys(data).some(key=>key!=='assignments'))
    throw new Error('batch_file_schema_invalid');
  params.assignments=data.assignments;
}
if(verb==='batch_poll'){
  if(flags['--tab'] || flags['--id'] || flags['--count'] || flags['--offset'] || flags['--max-chars'])
    throw Error('batch_poll_flags_invalid');
  if(flags['--file']){
    const stat=await fs.stat(flags['--file']);
    if(!stat.isFile() || stat.size<2 || stat.size>5000)
      throw Error('batch_poll_file_bounds_invalid');
    const body=JSON.parse(await fs.readFile(flags['--file'],'utf8'));
    if(!body || typeof body!=='object' || Array.isArray(body) ||
        Object.keys(body).some(k=>k!=='tab_ids'))
      throw Error('batch_poll_file_schema_invalid');
    Object.assign(params,body);
  }
}
if(verb==='batch_observe'){
  if(flags['--tab'] || flags['--id'] || flags['--count'] || flags['--offset'] || flags['--max-chars'])
    throw Error('batch_observation_flags_invalid');
  if(flags['--file']){
    const stat=await fs.stat(flags['--file']);
    if(!stat.isFile() || stat.size<2 || stat.size>12000)
      throw Error('batch_observation_file_bounds_invalid');
    const body=JSON.parse(await fs.readFile(flags['--file'],'utf8'));
    if(!body || typeof body!=='object' || Array.isArray(body) ||
        Object.keys(body).some(k=>!['tab_ids','since','parallelism'].includes(k)))
      throw Error('batch_observation_file_schema_invalid');
    Object.assign(params,body);
  }
}
if(verb==='read'){
  if(flags['--offset'])params.offset=Number(flags['--offset']);
  if(flags['--max-chars'])params.max_chars=Number(flags['--max-chars']);
}
const result=await fetch(endpoint,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
  headers:{Authorization:'Bearer '+manifest.token,'Content-Type':'application/json'},
  body:JSON.stringify({method:'chat.'+verb,params})
});
const response=await result.json();
if(!result.ok||response.ok!==true){
  console.error(JSON.stringify({ok:false,error:response.error||'RPC_NOT_READY',status:result.status,automatic_retry_allowed:false}));
  process.exitCode=1;
}else{
  console.log(JSON.stringify({ok:true,result:response.result,request_id:params.request_id||null},null,2));
}
