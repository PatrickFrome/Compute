import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {RUN_OWNER_CONTROL_SQL} from './native-coding-run-owner-read.mjs';
import {runOwnerControl} from '../../apps/metaengine-browser/src/native-coding-run-owner-phase.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
test('actual disposable PG17 control locks fence stop/reset and stale SERIALIZABLE snapshots', {skip:!bin||!driver,timeout:120000},async t=>{
 const base=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(base,'owner-control-pg17-')),data=path.join(root,'data');
 const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});
 const port=listener.address().port;await new Promise(r=>listener.close(r));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{shell:false,windowsHide:true,stdio:'ignore'});
  const timer=setTimeout(()=>{child.kill();reject(Error('disposable command timeout'));},60000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',c=>{clearTimeout(timer);c===0?resolve():reject(Error('disposable command failed '+name));});
 });
 let started=false,sql;
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");started=true;
  await command('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:3,onnotice:()=>{},connection:{statement_timeout:10000,lock_timeout:1000}});
  assert.equal(Math.floor(Number((await sql.unsafe("select current_setting('server_version_num') as v"))[0].v)/10000),17);
  const source=await fs.readFile(new URL('../../supabase/migrations/20260929010000_client_v1_fresh_project_bootstrap_v1.sql',import.meta.url),'utf8');
  const start=source.indexOf('create table if not exists destruktion_meta.devos_fleet_runtime_control_h205f22');
  assert.ok(start>=0);await sql.unsafe('create schema destruktion_meta');
  await sql.unsafe(source.slice(start,source.indexOf(';',start)+1));
  const id=randomUUID();await sql.unsafe('insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id,refill_enabled,supervisor_admission_enabled)values($1,true,true)',[id]);
  const parse=r=>runOwnerControl({...r,generation_floor:Number(r.generation_floor),reset_at:r.reset_at?.toISOString()??null,updated_at:r.updated_at.toISOString()});
  await t.test('original reader lock prevents a concurrent committed stop or reset until transaction completion',async()=>{
   await sql.begin('isolation level serializable',async tx=>{
    parse((await tx.unsafe(RUN_OWNER_CONTROL_SQL,[id]))[0]);
    for(const set of ['refill_enabled=false','generation_floor=generation_floor+1,reset_at=clock_timestamp()']){
     await assert.rejects(sql.begin(async other=>{await other.unsafe("set local lock_timeout='70ms'");await other.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set '+set+' where workspace_id=$1',[id]);}),e=>e.code==='55P03');
    }
    assert.equal(parse((await tx.unsafe(RUN_OWNER_CONTROL_SQL,[id]))[0]).refill_enabled,true);
   });
  });
  for(const set of ['refill_enabled=false','generation_floor=generation_floor+1,reset_at=clock_timestamp(),updated_at=clock_timestamp()'])
   await t.test('locking read rejects an old snapshot after committed '+set,async()=>{
    await assert.rejects(sql.begin('isolation level serializable',async tx=>{
     await tx.unsafe('select generation_floor from destruktion_meta.devos_fleet_runtime_control_h205f22 where workspace_id=$1',[id]);
     await sql.unsafe('update destruktion_meta.devos_fleet_runtime_control_h205f22 set '+set+' where workspace_id=$1',[id]);
     await tx.unsafe(RUN_OWNER_CONTROL_SQL,[id]);
    }),e=>e.code==='40001');
   });
  await t.test('fresh transaction sees committed stop and cannot validate current admission',async()=>{
   await sql.begin('isolation level serializable',async tx=>{const [row]=await tx.unsafe(RUN_OWNER_CONTROL_SQL,[id]);assert.equal(row.refill_enabled,false);assert.throws(()=>parse(row));});
  });
 }finally{
  if(sql)await sql.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  const resolved=await fs.realpath(root);assert.ok(resolved.startsWith(base+path.sep));assert.equal(path.dirname(resolved),base);await fs.rm(resolved,{recursive:true,force:true});
 }
});
