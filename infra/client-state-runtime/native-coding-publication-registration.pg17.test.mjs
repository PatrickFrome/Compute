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
function publicationRows(receipt){
  const sources=['native-coding-callback-publication-v1.sql','native-coding-initial-anchor-task-fence-v1.sql'];
  const indices=sources.map(source=>receipt.migrations.findIndex(row=>row.source===source));
  assert.ok(indices[0]>=0&&indices[1]===indices[0]+1,'reviewed publication migrations must remain adjacent and ordered');
  for(const source of sources)assert.equal(receipt.migrations.filter(row=>row.source===source).length,1);
  return indices.map(index=>receipt.migrations[index]);
}


// Real SQL / casts / locks / transactions in a NEW disposable PG17 cluster.
// Genuine existing provisioning/authentication on generated disposable identities.
// This test claims no installed authorization or user work.
test('registered publication schema fresh/attached/replay/rollback on disposable PG17',{
  skip:!bin||!driver,timeout:240000,
},async t=>{
  const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
  const directory=await fs.mkdtemp(path.join(base,'native-publication-registry-'));
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
    let initialReceipt;
    await sql.begin(async tx=>{
      await tx.unsafe(plan.prerequisite_sql);
      for(const row of plan.statements)await tx.unsafe(row.sql);
      initialReceipt=await applyLocalRuntimeMigrations({sql:{unsafe:tx.unsafe.bind(tx),begin:fn=>fn(tx)},expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
    });
    const run=async(name,fn)=>t.test(name,async()=>{await fn();passed++;});
    const schema=async(tx=sql)=>(await tx.unsafe(`select
      exists(select 1 from pg_attribute where attrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and attname='callback_publication' and not attisdropped) as anchor,
      exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and conname='native_execution_one_task_v1') as task_fence`))[0];
    await run('fresh registry applies both protections in reviewed order inside baseline transaction',async()=>{
      assert.deepEqual(publicationRows(initialReceipt).map(x=>x.source),['native-coding-callback-publication-v1.sql','native-coding-initial-anchor-task-fence-v1.sql']);
      assert(publicationRows(initialReceipt).every(x=>x.existing_bodies_attested&&x.status==='APPLIED_LOCAL_ONLY'));
      assert.deepEqual({...await schema()},{anchor:true,task_fence:true});
    });
    await sql.begin(tx=>tx.unsafe(plan.post_upgrade_acl_sql));
    await run('canonical OWNER_ONLY schema permits NEW onboarding registry before API provisioning without granting access',async()=>{
      const acl=async()=>(await sql.unsafe("select proacl::text as acl from pg_proc where oid='public.native_coding_execution_context_v1(uuid,text,uuid,bigint)'::regprocedure"))[0].acl;
      const before=await acl();await applyLocalRuntimeMigrations({sql,expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});assert.equal(await acl(),before);
    });
    for(const principal of ['public','foreign_owner_only_probe'])await run('OWNER_ONLY profile rejects unexpected '+principal+' grant',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        if(principal!=='public')await tx.unsafe('create role foreign_owner_only_probe login noinherit');
        await tx.unsafe('grant execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to '+principal);
        await applyLocalRuntimeMigrations({sql:{unsafe:tx.unsafe.bind(tx),begin:fn=>fn(tx)}});
      }),/function_requires_review/);
    });
    await provisionLocalApiLogin({sql,databaseName:'postgres',login:'actual_registry_api',password:'generated-disposable-only-'.repeat(3),roleMode:'direct'});
    api=postgres({host:'127.0.0.1',port,user:'actual_registry_api',database:'postgres',max:1,connect_timeout:5,onnotice:()=>{}});
    await inspectAttachedApiAdmission({sql:api,apiLogin:'actual_registry_api'});
    const attest=()=>attestNativeMigrationApiIdentity({apiSql:api,ownerSql:sql,apiLogin:'actual_registry_api'});
    const apply=(ticket,db=sql)=>applyLocalRuntimeMigrations({sql:db,authenticatedApiIdentity:ticket,expectedMigrationSourcesSha256:plan.upgrade_sources_sha256});
    const originals=[];
    for(const name of ['20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql']){
      const source=await fs.readFile(new URL(name,migrations),'utf8');
      for(const match of source.matchAll(/create(?: or replace)? function ((?:destruktion_meta|public)\.(?:native_coding_reserve_v1|native_coding_advance_v1|native_coding_read_v1|native_coding_execution_context_v1))\([\s\S]*?\$\$;/g))originals.push(match[0].replace(/^create function/,'create or replace function'));
    }
    assert.equal(originals.length,4);
    // Owner-only GENERATED old-install reconstruction; never a production downgrade.
    const predecessor=async tx=>{
      for(const [name,table] of [['native_execution_task_fence_v1','native_coding_execution_h205f22'],['native_job_initial_anchor_v1','native_coding_job_registration_h205f22'],['native_claim_task_history_v1','devos_fleet_claim_h205f22'],['native_running_anchor_v1','devos_fleet_task_h205f22']]){
        await tx.unsafe('drop trigger aa_'+name+' on destruktion_meta.'+table);await tx.unsafe('drop function destruktion_meta.'+name+'()');
      }
      await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 drop constraint native_execution_one_task_v1');
      await tx.unsafe('drop trigger native_callback_publication_guard_v1 on destruktion_meta.native_coding_execution_h205f22');
      await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 drop column callback_publication cascade');
      for(const signature of ['native_coding_callback_publication_cas_v1(uuid,bigint,uuid,jsonb,jsonb)','native_coding_callback_publication_read_v1(uuid,bigint,uuid)','native_coding_callback_publication_guard_v1()','native_coding_callback_publication_valid_v1(jsonb)'])await tx.unsafe('drop function destruktion_meta.'+signature);
      for(const original of originals)await tx.unsafe(original);
    };
    const nested=tx=>({unsafe:tx.unsafe.bind(tx),begin:fn=>fn(tx)});
    await run('fresh genuine provisioning then authenticated full-registry replay preserves direct ACL',async()=>{
      const acl=async()=>(await sql.unsafe("select proacl::text as acl from pg_proc where oid='public.native_coding_execution_context_v1(uuid,text,uuid,bigint)'::regprocedure"))[0].acl;
      const before=await acl();const receipt=await apply(await attest());
      assert(receipt.migrations.every(x=>x.status==='ALREADY_PRESENT_NOT_MODIFIED'));assert.equal(await acl(),before);
      assert(publicationRows(receipt).every(x=>x.existing_bodies_attested));
    });
    await run('missing and fabricated API identities remain blocked',async()=>{
      await assert.rejects(apply(undefined),/function_requires_review/);await assert.rejects(apply({}),/identity_unattested/);
      assert.deepEqual({...await schema()},{anchor:true,task_fence:true});
    });
    await run('authenticated API evidence cannot downgrade to OWNER_ONLY after its grant is revoked',async()=>{
      const ticket=await attest();await assert.rejects(sql.begin(async tx=>{
        await bindNativeMigrationApiIdentity(tx,ticket);
        await tx.unsafe('revoke execute on function public.native_coding_execution_context_v1(uuid,text,uuid,bigint) from actual_registry_api');
        const callback=await fs.readFile(new URL('./native-coding-callback-publication-v1.sql',import.meta.url),'utf8');
        await tx.unsafe(callback);
      }),/function_requires_review/);
    });
    await run('attached old direct-login schema upgrades atomically through actual registry',async()=>{
      const ticket=await attest();await sql.begin(async tx=>{
        await predecessor(tx);assert.deepEqual({...await schema(tx)},{anchor:false,task_fence:false});
        const receipt=await apply(ticket,nested(tx));assert(publicationRows(receipt).every(x=>x.status==='APPLIED_LOCAL_ONLY'));
        assert.deepEqual({...await schema(tx)},{anchor:true,task_fence:true});
      });
      await inspectAttachedApiAdmission({sql:api,apiLogin:'actual_registry_api'});
    });
    await run('duplicate historical generations roll back callback DDL and preserve both evidence rows',async()=>{
      const ticket=await attest();await assert.rejects(sql.begin(async tx=>{
        await predecessor(tx);
        // Generated historical evidence bypasses only the unrelated worktree fixture producer, restored BEFORE migration.
        await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 disable trigger native_coding_execution_worktree_fence_trg');
        await tx.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,base_sha,task_spec,task_spec_sha256,idempotency_key)
          values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','generated-history','IMPLEMENTER',repeat('a',40),'{}',repeat('b',64),'generated-duplicate-history')`);
        await tx.unsafe(`insert into destruktion_meta.native_coding_execution_h205f22(workspace_id,task_id,lease_generation,reservation_id,agent_id,target_id,agent_generation_epoch,host_incarnation,scope_sha256)
          select '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',n,gen_random_uuid(),'fixture-agent','codex-cli:33333333-3333-4333-8333-333333333333',1,'pid:1:created_100ns:134000000000000000',repeat('a',64) from generate_series(1,2)n`);
        await tx.unsafe('alter table destruktion_meta.native_coding_execution_h205f22 enable trigger native_coding_execution_worktree_fence_trg');
        await assert.rejects(tx.savepoint(sp=>apply(ticket,nested(sp))),/duplicate_history_hold/);
        assert.deepEqual({...await schema(tx)},{anchor:false,task_fence:false});
        assert.equal((await tx.unsafe('select count(*)::int as n from destruktion_meta.native_coding_execution_h205f22'))[0].n,2);
        throw Error('generated_history_rollback');
      }),/generated_history_rollback/);
    });
    for(const [name,change,error] of [
      ['partial callback', 'drop function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid)',/partial_install/],
      ['tampered fence trigger','alter table destruktion_meta.native_coding_execution_h205f22 disable trigger aa_native_execution_task_fence_v1',/existing_requires_review/],
      ['widened private ACL','grant execute on function destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid) to service_role',/function_requires_review/],
      ['tampered callback trigger','alter table destruktion_meta.native_coding_execution_h205f22 disable trigger native_callback_publication_guard_v1',/trigger_requires_review/],
    ])await run(name+' is rejected rather than skipped or repaired',async()=>{
      const ticket=await attest();await assert.rejects(sql.begin(async tx=>{await tx.unsafe(change);await apply(ticket,nested(tx));}),error);
    });
    await run('interrupted registry transaction rolls back both protections on predecessor schema',async()=>{
      const ticket=await attest();await assert.rejects(sql.begin(async tx=>{
        await predecessor(tx);
        const db={begin:fn=>tx.savepoint(async sp=>{const receipt=await fn(sp);throw Error('injected_precommit_interruption');})};
        await assert.rejects(apply(ticket,db),/injected_precommit_interruption/);
        assert.deepEqual({...await schema(tx)},{anchor:false,task_fence:false});throw Error('generated_history_rollback');
      }),/generated_history_rollback/);
    });
    await run('lost COMMIT ACK remains an error; installed evidence is read back and token is not replayable',async()=>{
      const ticket=await attest();const db={begin:async fn=>{await sql.begin(fn);throw Error('injected_lost_commit_ack_unknown');}};
      await assert.rejects(apply(ticket,db),/lost_commit_ack_unknown/);
      assert.deepEqual({...await schema()},{anchor:true,task_fence:true});
      await assert.rejects(apply(ticket),/identity_unattested/);
    });
    assert.equal(passed,15);
  }finally{
    if(api)await api.end({timeout:5});
    if(sql)await sql.end({timeout:5});
    if(started&&await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null))await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    assert.equal(await fs.stat(path.join(data,'postmaster.pid')).catch(()=>null),null);
    if(qualifiedData){assert.equal(path.dirname(data),directory);assert.ok(path.basename(directory).startsWith('native-publication-registry-'));assert.equal(await fs.realpath(data),data);assert.equal((await fs.readFile(path.join(data,'PG_VERSION'),'utf8')).trim(),'17');await fs.rm(data,{recursive:true});
      await fs.writeFile(path.join(directory,'cleanup-receipt.json'),JSON.stringify({state:'STOPPED',postgres_system_identifier:cluster,postmaster_pid_file_absent:true,generated_data_removed:true}));}
  }
});
