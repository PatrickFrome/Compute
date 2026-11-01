import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {loadLocalRuntimeMigrationPlan} from './local-runtime-migrations.mjs';

const source=await fs.readFile(new URL('./native-coding-physical-custody-v1.sql',import.meta.url),'utf8');
const tables=['request','closure','fence','resolution'].map(kind=>'destruktion_meta.native_coding_physical_'+kind+'_h205f22');
test('physical custody registration pins all private history/cache relations and guards',async()=>{
 const migration=(await loadLocalRuntimeMigrationPlan()).migrations.find(m=>m.source==='native-coding-physical-custody-v1.sql');
 assert.ok(migration);assert.deepEqual(migration.relations,tables);assert.equal(migration.triggers.length,8);
 assert.deepEqual(migration.signatures,['destruktion_meta.native_coding_physical_write_guard_v1()']);
 const body=/create or replace function destruktion_meta\.native_coding_physical_write_guard_v1\(\)\nreturns trigger language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as \$\$([\s\S]*?)\$\$;/.exec(source)?.[1];
 assert.ok(body);assert.ok(source.includes(createHash('sha256').update(body).digest('hex')));
 assert.doesNotMatch(source,/security definer|create role|bypassrls|disable row level security/i);
});

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
test('physical custody PG17 preserves immutable receipts and rejects weakened schema or unowned writes',{
 skip:!bin||!driver,timeout:120000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-physical-sql-')),data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:'ignore',shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},60000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let started=false,sql,api;
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
  await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  const postgres=(await import(pathToFileURL(driver))).default;
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:2,onnotice:()=>{},connect_timeout:5,idle_timeout:10});
  const [identity]=await sql.unsafe("select current_setting('server_version_num')::int as version,(select system_identifier::text from pg_control_system()) as system_identifier");
  assert.ok(identity.version>=170000&&identity.version<180000);
  await sql.unsafe('create role anon;create role authenticated;create role service_role;create role physical_api login;create schema extensions;create extension pgcrypto with schema extensions;create schema destruktion_meta;grant usage on schema destruktion_meta to physical_api');
  const transaction=body=>sql.begin('isolation level serializable',body);
  await transaction(tx=>tx.unsafe(source));await transaction(tx=>tx.unsafe(source));
  const requestId=randomUUID(),request={schema:'GENERATED_TEST_REQUEST',frame:{request_id:requestId},original_digest:'a'.repeat(64)},terminal={state:'SETTLED',cleanup_confirmed:true};
  const insertRequest=tx=>tx.unsafe('insert into destruktion_meta.native_coding_physical_request_h205f22(request_id,request) values($1,$2::text::jsonb)',[requestId,JSON.stringify(request)]);
  await t.test('original request and terminal persist exactly once; full history cannot be rewritten or truncated',async()=>{
   await transaction(insertRequest);
   await assert.rejects(sql.begin(tx=>tx.unsafe('insert into destruktion_meta.native_coding_physical_request_h205f22(request_id,request) values($1,$2::text::jsonb)',[randomUUID(),JSON.stringify(request)])),/native_physical_durable_transaction_required/);
   await assert.rejects(transaction(async tx=>{await tx.unsafe('set local synchronous_commit=off');await tx.unsafe('insert into destruktion_meta.native_coding_physical_request_h205f22(request_id,request) values($1,$2::text::jsonb)',[randomUUID(),JSON.stringify(request)]);}),/native_physical_durable_transaction_required/);
   await assert.rejects(transaction(tx=>tx.unsafe('insert into destruktion_meta.native_coding_physical_request_h205f22(request_id,request,terminal,settled_at) values($1,$2::text::jsonb,$3::text::jsonb,clock_timestamp())',[randomUUID(),JSON.stringify(request),JSON.stringify(terminal)])),/native_physical_initial_terminal_forbidden/);
   await transaction(tx=>tx.unsafe('update destruktion_meta.native_coding_physical_request_h205f22 set terminal=$2::text::jsonb where request_id=$1',[requestId,JSON.stringify(terminal)]));
   const [row]=await sql.unsafe('select * from destruktion_meta.native_coding_physical_request_h205f22 where request_id=$1',[requestId]);
   assert.deepEqual(row.request,request);assert.deepEqual(row.terminal,terminal);assert.ok(row.settled_at>=row.created_at);
   for(const statement of ["update destruktion_meta.native_coding_physical_request_h205f22 set request='{}'::jsonb",'update destruktion_meta.native_coding_physical_request_h205f22 set terminal=null','update destruktion_meta.native_coding_physical_request_h205f22 set terminal=terminal','delete from destruktion_meta.native_coding_physical_request_h205f22','truncate destruktion_meta.native_coding_physical_request_h205f22'])await assert.rejects(transaction(tx=>tx.unsafe(statement)),/native_physical_(?:request_immutable|request_retained|history_retained)/);
   assert.deepEqual(Array.from(await sql.unsafe('select * from destruktion_meta.native_coding_physical_request_h205f22 where request_id=$1',[requestId])),[row]);
  });
  await t.test('SETUP and TASK closures and run fences are append-only; only private observation cache is removable',async()=>{
   const device=randomUUID(),host=randomUUID(),run=randomUUID();
   await transaction(async tx=>{
    await tx.unsafe("insert into destruktion_meta.native_coding_physical_closure_h205f22(kind,key,closure) values('SETUP','scope','{}'),('TASK','scope','{}')");
    await tx.unsafe('insert into destruktion_meta.native_coding_physical_fence_h205f22(run_id,host_instance_id) values($1,$2)',[run,host]);
    await tx.unsafe("insert into destruktion_meta.native_coding_physical_resolution_h205f22(device_id,client_id,admin_grant_epoch,device_key_fingerprint_sha256,host_instance_id,generation,observed_at,postgres_scope_sha256,kind,key,durable_sha256,proof_sha256) values($1,'fixture-client',1,$3,$2,1,clock_timestamp(),$3,'TASK','scope',$3,$3)",[device,host,'b'.repeat(64)]);
   });
   for(const table of [tables[1],tables[2]])for(const statement of [`update ${table} set created_at=created_at`,`delete from ${table}`,`truncate ${table}`])await assert.rejects(transaction(tx=>tx.unsafe(statement)),/native_physical_history_retained/);
   await assert.rejects(transaction(tx=>tx.unsafe('update destruktion_meta.native_coding_physical_resolution_h205f22 set generation=2')),/native_physical_resolution_immutable/);
   await transaction(tx=>tx.unsafe('delete from destruktion_meta.native_coding_physical_resolution_h205f22'));
   const [count]=await sql.unsafe('select count(*)::int as count from destruktion_meta.native_coding_physical_closure_h205f22');assert.equal(count.count,2);
  });
  await t.test('API identity cannot read or modify physical custody',async()=>{
   api=postgres({host:'127.0.0.1',port,user:'physical_api',database:'postgres',max:1,onnotice:()=>{},connect_timeout:5});
   for(const table of tables){await assert.rejects(api.unsafe('select * from '+table),/permission denied/);await assert.rejects(api.unsafe('delete from '+table),/permission denied/);}
   // Granting table access still cannot bypass the independent session check.
   await sql.unsafe('grant insert on destruktion_meta.native_coding_physical_request_h205f22 to physical_api');
   await assert.rejects(api.begin('isolation level serializable',tx=>tx.unsafe('insert into destruktion_meta.native_coding_physical_request_h205f22(request_id,request) values($1,\'{}\')',[randomUUID()])),/row-level security|native_physical_state_owner_required/);
   await sql.unsafe('revoke insert on destruktion_meta.native_coding_physical_request_h205f22 from physical_api');
  });
  await t.test('every replay rejects partial, changed function/table/trigger/index/ACL/RLS schema rather than repairing it',async()=>{
   for(const change of [
    'grant select on destruktion_meta.native_coding_physical_request_h205f22 to physical_api',
    'alter table destruktion_meta.native_coding_physical_request_h205f22 disable row level security',
    "create policy physical_widened on destruktion_meta.native_coding_physical_request_h205f22 for select using(true)",
    'alter table destruktion_meta.native_coding_physical_request_h205f22 alter column created_at drop default',
    'alter table destruktion_meta.native_coding_physical_request_h205f22 drop constraint native_coding_physical_request_h205f22_check',
    'create index physical_extra_index on destruktion_meta.native_coding_physical_request_h205f22(created_at)',
    'alter table destruktion_meta.native_coding_physical_request_h205f22 disable trigger native_physical_write_guard_v1',
    "create or replace function destruktion_meta.native_coding_physical_write_guard_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$begin return new;end$$",
    'drop table destruktion_meta.native_coding_physical_resolution_h205f22',
   ]){
    await assert.rejects(transaction(async tx=>{await tx.unsafe(change);await tx.unsafe(source);}),/native_physical_(?:function_requires_review|relation_authority_requires_review|columns_require_review|constraints_require_review|indexes_require_review|triggers_require_review|partial_install)/,change);
    await transaction(tx=>tx.unsafe(source));
   }
  });
  await fs.writeFile(path.join(directory,'qualification.json'),JSON.stringify({schema:'metaengine.native-physical-custody.sql-qualification.v1',platform:process.platform,
   postgres_version:identity.version,system_identifier:identity.system_identifier,sql_sha256:createHash('sha256').update(source).digest('hex'),generated_fixtures:true,windows_qualified:false,authority_effect:false},null,2)+'\n');
 }finally{await api?.end({timeout:5});await sql?.end({timeout:5});if(started)await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
});
