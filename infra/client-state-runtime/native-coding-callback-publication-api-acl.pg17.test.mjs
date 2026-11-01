import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {loadFreshSchemaApplicationPlan} from './fresh-schema-application-plan.mjs';
import {applyLocalRuntimeMigrations} from './local-runtime-migrations.mjs';
import {provisionLocalApiLogin} from './db-api-grants.mjs';
import {inspectAttachedApiAdmission} from './attached-postgres-onboarding.mjs';
import {attestNativeMigrationApiIdentity,bindNativeMigrationApiIdentity} from './native-coding-migration-api-identity.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const migrations=new URL('../../supabase/migrations/',import.meta.url);

// Real SQL / casts / locks / transactions in a NEW disposable PG17 cluster.
// Genuine existing provisioning/authentication on generated disposable identities.
// This test claims no installed authorization or user work.
test('authenticated direct API compatibility on actual disposable PG17',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'native-api-acl-'));
  const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  assert.ok(![55432,55433,55434].includes(port));
  const command=(name,args)=>new Promise((resolve,reject)=>{
    // pg_ctl postmaster children MUST inherit no captured pipes on Windows.
    const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
      {windowsHide:true,stdio:'ignore',shell:false});
    const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},90000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
  });
  let started=false,sql,api,cluster,passed=0,qualifiedData=false;
  try {
    await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
    started=true;await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:1,onnotice:()=>{},
      connect_timeout:5,idle_timeout:10,connection:{application_name:'METAENGINE_HOST_AUTHORITY_DISPOSABLE_QA',statement_timeout:18000,lock_timeout:5000}});
    const [identity]=await sql.unsafe(`select current_user::text as current_user,session_user::text as session_user,
      current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
      (select system_identifier::text from pg_control_system()) as system_identifier`);
    assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');
    assert.ok(identity.version>=170000&&identity.version<180000);
    assert.equal(path.resolve(identity.data_directory).toLowerCase(),path.resolve(data).toLowerCase());
    cluster=identity.system_identifier;qualifiedData=true;
    const plan=await loadFreshSchemaApplicationPlan();
    await sql.begin(async tx=>{
      await tx.unsafe(plan.prerequisite_sql);
      for(const row of plan.statements)await tx.unsafe(row.sql);
      await applyLocalRuntimeMigrations({sql:{unsafe:tx.unsafe.bind(tx),begin:fn=>fn(tx)}});
    });
    const migration=await fs.readFile(new URL('./native-coding-callback-publication-v1.sql',import.meta.url),'utf8');
    const run=async(name,fn)=>t.test(name,async()=>{await fn();passed++;});
    await run('fresh absent API principal installs strictly',()=>sql.begin(tx=>tx.unsafe(migration)));
    await sql.begin(tx=>tx.unsafe(plan.post_upgrade_acl_sql));
    await provisionLocalApiLogin({sql,databaseName:'postgres',login:'actual_direct_api',password:'generated-disposable-only-'.repeat(3),roleMode:'direct'});
    api=postgres({host:'127.0.0.1',port,user:'actual_direct_api',database:'postgres',max:1,connect_timeout:5,onnotice:()=>{}});
    await inspectAttachedApiAdmission({sql:api,apiLogin:'actual_direct_api'});
    const attest=()=>attestNativeMigrationApiIdentity({apiSql:api,ownerSql:sql,apiLogin:'actual_direct_api'});
    const apply=async(ticket,afterBind=async()=>{})=>sql.begin(async tx=>{
      await bindNativeMigrationApiIdentity(tx,ticket);
      await afterBind(tx);await tx.unsafe(migration);
    });
    await run('provisioned API grant without authenticated evidence stays rejected',()=>assert.rejects(sql.begin(tx=>tx.unsafe(migration)),/function_requires_review/));
    await run('genuine authenticated provisioning permits replay without ACL mutation',async()=>{
      const before=await sql.unsafe("select proacl::text as acl from pg_proc where oid='public.native_coding_execution_context_v1(uuid,text,uuid,bigint)'::regprocedure");
      await apply(await attest());await apply(await attest());
      const after=await sql.unsafe("select proacl::text as acl from pg_proc where oid='public.native_coding_execution_context_v1(uuid,text,uuid,bigint)'::regprocedure");
      assert.equal(after[0].acl,before[0].acl);
    });
    await run('attached existing direct-login predecessor upgrades with the same exact ACL',async()=>{
      const originals=[];
      for(const name of ['20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql']){
        const source=await fs.readFile(new URL(name,migrations),'utf8');
        for(const match of source.matchAll(/create(?: or replace)? function ((?:destruktion_meta|public)\.(?:native_coding_reserve_v1|native_coding_advance_v1|native_coding_read_v1|native_coding_execution_context_v1))\([\s\S]*?\$\$;/g))originals.push(match[0].replace(/^create function/,'create or replace function'));
      }
      assert.equal(originals.length,4);
      await apply(await attest(),async tx=>{
        await tx.unsafe('drop trigger native_callback_publication_guard_v1 on destruktion_meta.native_coding_execution_h205f22');
        await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 drop column callback_publication cascade');
        for(const signature of ['native_coding_callback_publication_cas_v1(uuid,bigint,uuid,jsonb,jsonb)','native_coding_callback_publication_read_v1(uuid,bigint,uuid)','native_coding_callback_publication_guard_v1()','native_coding_callback_publication_valid_v1(jsonb)'])await tx.unsafe('drop function destruktion_meta.'+signature);
        for(const original of originals)await tx.unsafe(original);
      });
    });
    await run('cross-backend identity ticket cannot bind another owner connection',async()=>{
      const other=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:1,onnotice:()=>{}});
      try{const ticket=await attest();await assert.rejects(other.begin(tx=>bindNativeMigrationApiIdentity(tx,ticket)),/identity_unattested/);}finally{await other.end({timeout:5});}
    });
    await run('API-owned pg_temp evidence is not visible as owner compatibility evidence',async()=>{
      await api.unsafe('create temporary table native_callback_migration_api_identity_v1(forged boolean)');
      try{await assert.rejects(sql.begin(tx=>tx.unsafe(migration)),/function_requires_review/);}finally{await api.unsafe('drop table pg_temp.native_callback_migration_api_identity_v1');}
    });
    await run('cloned JSON and reused private ticket are rejected',async()=>{
      await assert.rejects(apply({}),/identity_unattested/);
      const ticket=await attest();await apply(ticket);await assert.rejects(apply(ticket),/identity_unattested/);
    });
    for(const alteration of ['alter role actual_direct_api inherit','alter role actual_direct_api createdb','grant service_role to actual_direct_api',
      'grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to actual_direct_api with grant option']){
      await run('role or grant alteration after authentication fails: '+alteration.split(' ').slice(0,4).join(' '),async()=>{
        const ticket=await attest();await assert.rejects(apply(ticket,async tx=>{await tx.unsafe(alteration);}),/api_evidence_requires_review|function_requires_review/);
      });
    }
    await run('committed role drift after authentication is rejected before evidence creation',async()=>{
      const ticket=await attest();await sql.unsafe('alter role actual_direct_api inherit');
      try{await assert.rejects(apply(ticket),/identity_unattested/);}finally{await sql.unsafe('alter role actual_direct_api noinherit');}
      const [r]=await sql.unsafe("select to_regclass('pg_temp.native_callback_migration_api_identity_v1') is null as absent");assert.equal(r.absent,true);
    });
    await run('forged wrong-shape owner temp evidence cannot authorize compatibility',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe('create temporary table native_callback_migration_api_identity_v1(forged boolean) on commit drop');
        await tx.unsafe(migration);
      }),/api_evidence_requires_review/);
    });
    await run('authenticated direct grant cannot be replaced by service_role grant',async()=>{
      await assert.rejects(apply(await attest(),async tx=>{
        await tx.unsafe('revoke execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) from actual_direct_api');
        await tx.unsafe('grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to service_role');
      }),/function_requires_review/);
    });
    await run('API role cannot delegate authenticated grant through inbound membership',async()=>{
      await assert.rejects(apply(await attest(),async tx=>{
        await tx.unsafe('create role foreign_role_member login noinherit');
        await tx.unsafe('grant actual_direct_api to foreign_role_member');
      }),/api_evidence_requires_review/);
    });
    await run('foreign restricted principal never inherits compatibility',async()=>{
      const ticket=await attest();await assert.rejects(apply(ticket,async tx=>{
        await tx.unsafe('create role foreign_direct_api login noinherit');
        await tx.unsafe('grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to foreign_direct_api');
      }),/function_requires_review/);
    });
    await run('PUBLIC execution stays forbidden with authentic evidence',async()=>{
      await assert.rejects(apply(await attest(),tx=>tx.unsafe('grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to public')),/function_requires_review/);
    });
    for(const change of ["update pg_temp.native_callback_migration_api_identity_v1 set transaction_id=transaction_id-1",
      "update pg_temp.native_callback_migration_api_identity_v1 set backend=backend+1",
      "update pg_temp.native_callback_migration_api_identity_v1 set database_oid=0",
      "update pg_temp.native_callback_migration_api_identity_v1 set postmaster=postmaster-interval '1 second'",
      "update pg_temp.native_callback_migration_api_identity_v1 set role_name='foreign_direct_api'",
      "alter table pg_temp.native_callback_migration_api_identity_v1 add column extra boolean",
      "grant select on pg_temp.native_callback_migration_api_identity_v1 to public",
      "alter table pg_temp.native_callback_migration_api_identity_v1 owner to actual_direct_api"]){
      await run('malformed/stale temp evidence fails '+change.split(' ').slice(0,4).join(' '),async()=>{
        await assert.rejects(apply(await attest(),tx=>tx.unsafe(change)),/api_evidence_requires_review/);
      });
    }
    await run('one authenticated SQL evidence row cannot authorize two preflights',async()=>{
      await assert.rejects(apply(await attest(),async tx=>{await tx.unsafe(migration);}),/api_evidence_requires_review/);
    });
    await run('API temp catalog shadows cannot forge authenticated identity',async()=>{
      for(const name of ['pg_roles','pg_database','pg_auth_members','pg_proc'])await api.unsafe('create temporary table '+name+'(forged boolean)');
      try{await apply(await attest());}finally{for(const name of ['pg_roles','pg_database','pg_auth_members','pg_proc'])await api.unsafe('drop table pg_temp.'+name);}
    });
    await run('wrong session owner cannot run migration',async()=>{
      await assert.rejects(api.begin(tx=>tx.unsafe(migration)),/migration_owner_required/);
    });
    await run('wrong authenticated API identity cannot produce token',async()=>{
      await assert.rejects(attestNativeMigrationApiIdentity({apiSql:sql,ownerSql:sql,apiLogin:'actual_direct_api'}),/identity_unattested/);
    });
    await run('post-commit evidence is absent and cannot authorize next transaction',async()=>{
      await apply(await attest());
      const [r]=await sql.unsafe("select to_regclass('pg_temp.native_callback_migration_api_identity_v1') is null as absent");assert.equal(r.absent,true);
      await assert.rejects(sql.begin(tx=>tx.unsafe(migration)),/function_requires_review/);
    });
    assert.equal(passed,30);
  }finally{
    if(api)await api.end({timeout:5});
    if(sql)await sql.end({timeout:5});
    if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
    if(qualifiedData){assert.equal(path.dirname(data),directory);assert.ok(path.basename(directory).startsWith('native-api-acl-'));assert.equal(await fs.realpath(data),data);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');await fs.rm(data,{recursive:true});
      await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:cluster,postmaster_pid_file_absent:true,generated_data_removed:true}));}
  }
});
