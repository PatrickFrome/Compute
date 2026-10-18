import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const script=new URL('../scripts/devfleet-admin-mcp.mjs',import.meta.url);
test('stable MCP admin handshake exposes one fast overview and a bounded live-control tool',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'devfleet-admin-mcp-'));
 const child=spawn(process.execPath,[fileURLToPath(script)],{
   env:{...process.env,APPDATA:dir},stdio:['pipe','pipe','pipe'],
   windowsHide:true
 });
 const messages=[];
 let tail='';
 const done=new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Error('mcp_handshake_timeout')),10000);
   child.stdout.on('data',data=>{
     tail+=data.toString();
     while(tail.includes('\n')) {
       const end=tail.indexOf('\n'),line=tail.slice(0,end);tail=tail.slice(end+1);
       if(!line.trim())continue;
       messages.push(JSON.parse(line));
       if(messages.length===3){clearTimeout(deadline);resolve();}
     }
   });
   child.once('error',reject);
   child.once('exit',code=>{
     if(messages.length<3)reject(Error('mcp_early_exit_'+code));
   });
 });
 const send=obj=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...obj})+'\n');
 try {
   send({id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
   send({id:2,method:'tools/list',params:{}});
   send({id:3,method:'tools/call',params:{name:'devfleet_overview',arguments:{}}});
   await done;
   const init=messages.find(x=>x.id===1),listing=messages.find(x=>x.id===2),
     refused=messages.find(x=>x.id===3);
   assert.equal(init.result.serverInfo.name,'METAENGINE-DevFleet-LiveAdmin');
   assert.deepEqual(listing.result.tools.map(x=>x.name),['devfleet_overview','devfleet_admin']);
   assert.equal(listing.result.tools[0].annotations.readOnlyHint,true);
   assert.equal(listing.result.tools[1].annotations.destructiveHint,true);
   assert.equal(refused.result.isError,true);
   assert.match(refused.result.content[0].text,/ENOENT|devfleet_admin_error/);
   assert(!JSON.stringify(messages).includes('Bearer '));
 } finally {
   child.kill();
   await fs.rm(dir,{recursive:true,force:true});
 }
});
test('packaged admin MCP is an explicit extraResource, not an implicit code evaluator',async()=>{
 const cfg=JSON.parse(await fs.readFile(new URL('../electron-builder.json',import.meta.url),'utf8'));
 assert(cfg.extraResources.some(x=>x.from==='scripts/devfleet-admin-mcp.mjs'&&
     x.to==='devfleet-admin-mcp.mjs'));
 const source=await fs.readFile(script,'utf8');
 assert(!source.includes('eval('));
 assert(!source.includes('exec('));
 assert(!source.includes('spawn('));
 assert.match(source,/developer-rpc\.json/);
 assert.match(source,/workspace_pinned/);
 assert(source.includes("'dev.pipeline.conveyor_status'"));
 // This adapter repair adds observation only, not a new Send path.
 assert(!source.includes("'dev.pipeline.conveyor_start'"));
});
