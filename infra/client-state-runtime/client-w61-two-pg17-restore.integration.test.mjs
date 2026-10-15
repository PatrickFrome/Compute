// Real TWO-CLUSTER PostgreSQL 17 W47 fixture on Linux. Docker image digest
// pinned; entirely new containers and generated archive/journal, never Owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {buildBackupEffectIntent,publishBackupEffectIntent,crossBackupEffectBarrier,
  readBackupEffectFence} from './pg17-backup-effect-barrier.mjs';
import {sealClientBackupRestoreStagingW47,readClientBackupRestoreStagingW47}
  from './client-backup-restore-staging-w47.mjs';
import {OWN_PG_BIRTH_SQL_W61,OWN_PG_OWNER_EPOCH_SQL_W61} from './own-postgres-birth-w61.mjs';

const exec=promisify(execFile);
const IMAGE='postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const enabled=process.env.W61_DOCKER_PG17==='1';
const required=process.env.W61_REQUIRE_REAL_PG17==='1';
const uuid=()=>randomBytes(5).toString('hex');
const SHA40=/^[a-f0-9]{40}$/;
const run=async(command,args,limit=90000)=> (await exec(command,args,{timeout:limit,windowsHide:true,
  maxBuffer:8*1024*1024,shell:false})).stdout;
const docker=(...args)=>run('docker',args);
const dbsql=(id,sql)=>docker('exec',id,'psql','-X','-v','ON_ERROR_STOP=1',
  '-U','postgres','-d','w61_db','-At','-c',sql);
const fingerprint=`SELECT count(*)::text || ':' || md5(
  coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),''))
  FROM public.w61_restore_rows t`;
async function hashFile(file){
  const h=createHash('sha256');
  for await(const b of createReadStream(file))h.update(b);
  return h.digest('hex');
}
async function ready(id){
  for(let n=0;n<70;n++){
    try {
      const version=(await dbsql(id,'SHOW server_version_num')).trim();
      if(Number(version)>=170000&&Number(version)<180000)return;
      throw Error('WRONG_POSTGRES_MAJOR');
    }catch(e){
      if(e.message==='WRONG_POSTGRES_MAJOR')throw e;
      await new Promise(r=>setTimeout(r,200));
    }
  }
  throw Error('GENERATED_POSTGRES_NOT_READY');
}
test('W61 generated W47 intent/barrier -> real dump -> independent single-transaction restore in TWO pinned PG17 clusters', {
  timeout:240000,skip:!enabled&&!required?'DISPOSABLE_DOCKER_PG17_UNKNOWN':false,
},async()=>{
  assert(enabled,'REAL_POSTGRES_REQUIRED_NO_SKIP');
  for(const key of ['PGDATA','PGHOST','PGPORT','PGPASSWORD','DATABASE_URL',
    'LOCAL_STATE_DATABASE_URL','METAENGINE_OWNER_FILE','LOCAL_STATE_TEST_PG_BIN_DIR']) {
    assert.equal(process.env[key],undefined,'REFUSE_AMBIENT_'+key);
  }
  assert.equal(process.platform,'linux','CI Linux only; Windows explicit UNKNOWN');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-w61-pg17-'));
  await fs.chmod(root,0o700);
  const pwd='generated_'+randomBytes(24).toString('hex');
  const from='w61-pg17-source-'+uuid(),to='w61-pg17-target-'+uuid();
  const started=[];
  try {
    for(const id of [from,to]){
      const cid=(await docker('run','--detach','--rm','--name',id,
        '--env','POSTGRES_USER=postgres','--env','POSTGRES_DB=w61_db',
        '--env','POSTGRES_PASSWORD='+pwd,
        '--publish','127.0.0.1::5432',
        '--label','metaengine.w61.disposable=true',IMAGE)).trim();
      assert.match(cid,/^[a-f0-9]{64}$/,'new generated container');
      started.push(id);
      await ready(id);
    }
    const srcCid=(await docker('inspect','-f','{{.Id}}',from)).trim();
    const dstCid=(await docker('inspect','-f','{{.Id}}',to)).trim();
    assert.notEqual(srcCid,dstCid,'distinct containers');
    const srcHostPid=Number((await docker('inspect','-f','{{.State.Pid}}',from)).trim());
    const dstHostPid=Number((await docker('inspect','-f','{{.State.Pid}}',to)).trim());
    assert(Number.isSafeInteger(srcHostPid)&&srcHostPid>0);
    assert(Number.isSafeInteger(dstHostPid)&&dstHostPid>0);
    assert.notEqual(srcHostPid,dstHostPid);
    assert.notEqual(srcHostPid,process.pid);
    assert.notEqual(dstHostPid,process.pid);
    const fixtureProject=randomUUID(),fixtureDevice=randomUUID();
    await dbsql(from,`CREATE SCHEMA destruktion_meta;
      CREATE TABLE destruktion_meta.project_run_h205f22(
        project_id uuid primary key,device_id uuid,client_id text,admin_grant_epoch bigint);
      INSERT INTO destruktion_meta.project_run_h205f22
        VALUES ('${fixtureProject}'::uuid,'${fixtureDevice}'::uuid,'owner-w61',9);
      CREATE TABLE public.w61_restore_rows(id integer PRIMARY KEY, body text NOT NULL);
      INSERT INTO public.w61_restore_rows VALUES (1,'alpha'),(2,'lambda-'||chr(1105)),(3,'omega');
      CREATE ROLE w61_fixture_reader NOLOGIN;
      REVOKE ALL ON public.w61_restore_rows FROM PUBLIC;
      GRANT SELECT ON public.w61_restore_rows TO w61_fixture_reader;`);
    await dbsql(to,'CREATE ROLE w61_fixture_reader NOLOGIN');
    const sourceVersion=Number((await dbsql(from,'SHOW server_version_num')).trim());
    const targetVersion=Number((await dbsql(to,'SHOW server_version_num')).trim());
    assert(sourceVersion>=170000&&sourceVersion<180000);
    assert(targetVersion>=170000&&targetVersion<180000);
    const birth=(await dbsql(from,OWN_PG_BIRTH_SQL_W61.replace(/\s+/g,' '))).trim();
    assert.match(birth,/w61_db\|17[0-9]+\|t\|t/);
    // Fixed W61 SQL with only generated test selectors; no Host/native claims.
    const scopedSql=OWN_PG_OWNER_EPOCH_SQL_W61
      .replace('$1::uuid',`'${fixtureProject}'::uuid`)
      .replace('$2::uuid',`'${fixtureDevice}'::uuid`)
      .replace('$3::text',"'owner-w61'::text")
      .replace('$4::bigint','9::bigint');
    assert.equal((await dbsql(from,scopedSql)).trim(),'1',
      'exact scoped project/device/client/epoch exists in generated catalog');
    assert.equal((await dbsql(from,scopedSql.replace('9::bigint','8::bigint'))).trim(),'0',
      'wrong Owner epoch cannot use same PG birth');
    const sourceIdentity=(await dbsql(from,'SELECT system_identifier::text FROM pg_control_system()')).trim();
    const destIdentity=(await dbsql(to,'SELECT system_identifier::text FROM pg_control_system()')).trim();
    assert.match(sourceIdentity,/^[1-9][0-9]{9,19}$/);
    assert.match(destIdentity,/^[1-9][0-9]{9,19}$/);
    assert.notEqual(sourceIdentity,destIdentity);
    const sourceBirth=(await dbsql(from,'SELECT pg_postmaster_start_time()')).trim();
    const rows=(await dbsql(from,fingerprint)).trim();
    assert.match(rows,/^3:[a-f0-9]{32}$/);
    assert.equal((await dbsql(from,`SELECT has_table_privilege('w61_fixture_reader',
      'public.w61_restore_rows','SELECT')::text`)).trim(),'true');
    const forbidden=(await dbsql(from,`SELECT has_table_privilege('w61_fixture_reader',
      'public.w61_restore_rows','INSERT')::text`)).trim();
    assert.equal(forbidden,'false');

    const sourceHead=(await run('git',['rev-parse','HEAD'])).trim();
    assert.match(sourceHead,SHA40);
    if(process.env.W61_SOURCE_SHA)assert.equal(sourceHead,process.env.W61_SOURCE_SHA);
    const ownerDigest=await hashFile(process.execPath);
    const pgDigest=(await docker('exec',from,'sha256sum','/usr/lib/postgresql/17/bin/postgres'))
      .trim().split(/\s+/)[0];
    assert.match(pgDigest,/^[a-f0-9]{64}$/);
    const rollbackPath=path.join(root,'rollback-preserved.bin');
    await fs.writeFile(rollbackPath,'GENERATED_ROLLBACK:'+rows,{flag:'wx',mode:0o600});
    const rollbackDigest=await hashFile(rollbackPath);
    const archive=path.join(root,'postgresql-17-snapshot.dump');
    const intent=buildBackupEffectIntent({
      ownerPid:process.pid,keeperPid:srcHostPid,sourceHead,
      ownerSha256:ownerDigest,postmasterSha256:pgDigest,archivePath:archive,
    });
    assert.equal((await publishBackupEffectIntent({journalDirectory:root,intent})).state,'PREPARED');
    assert.equal((await crossBackupEffectBarrier({journalDirectory:root,intent})).state,'EFFECT_MAY_HAVE_STARTED');
    await assert.rejects(crossBackupEffectBarrier({journalDirectory:root,intent}),
      /backup_effect_(?:write_ambiguous|archive_existing)/,'no duplicate dump after unknown ACK');
    // The only dump effect is on the newly allocated disposable source
    // container AFTER the durable W47 barrier. Never use host PostgreSQL env.
    await docker('exec',from,'pg_dump','-U','postgres','-d','w61_db',
      '--format=custom','--file=/tmp/w61-backup.dump','--no-password');
    await docker('cp',from+':/tmp/w61-backup.dump',archive);
    await fs.chmod(archive,0o600);
    const info=await fs.stat(archive);
    assert(info.size>1024);
    const archiveDigest=await hashFile(archive);
    assert.equal((await dbsql(from,'SELECT system_identifier::text FROM pg_control_system()')).trim(),
      sourceIdentity,'source cluster system identifier cannot drift across dump');
    assert.equal((await dbsql(from,'SELECT pg_postmaster_start_time()')).trim(),
      sourceBirth,'postmaster incarnation cannot change across physical archive');
    assert.equal((await dbsql(from,scopedSql)).trim(),'1',
      'Owner scoped project/device/client/epoch must survive source backup');
    const h=await fs.open(archive,'r');
    const magic=Buffer.alloc(5);
    try{await h.read(magic,0,5,0);}finally{await h.close();}
    assert.equal(magic.toString('ascii'),'PGDMP');

    await docker('cp',archive,to+':/tmp/w61-backup.dump');
    const toc=await docker('exec',to,'pg_restore','--list','/tmp/w61-backup.dump');
    assert.match(toc,/TABLE DATA public w61_restore_rows/);
    const archiveReceipt={
      schema:'metaengine.pg17.disposable-dump-readback.v1',state:'ARCHIVE_ONLY_VERIFIED',
      effect_intent_id:intent.intent_id,archive_verified:true,
      archive_sha256:archiveDigest,archive_bytes:info.size,
      toc_sha256:createHash('sha256').update(toc).digest('hex'),
      source_pg_system_identifier:sourceIdentity,source_pg_started_at:sourceBirth,
      upgrade_authorized:false,automatic_retry_allowed:false,authority_effect:false,
      physical_restore_proven:false,
    };
    await docker('exec',to,'pg_restore','--exit-on-error','--single-transaction',
      '--no-owner','--no-password','-U','postgres','-d','w61_db','/tmp/w61-backup.dump');
    assert.equal((await dbsql(to,scopedSql)).trim(),'1',
      'restored real catalog retains exact Owner/project/epoch fixture');
    const restoredRows=(await dbsql(to,fingerprint)).trim();
    assert.equal(restoredRows,rows,'full content digest and row counts');
    assert.equal((await dbsql(to,`SELECT has_table_privilege('w61_fixture_reader',
      'public.w61_restore_rows','SELECT')::text`)).trim(),'true','restored GRANT SELECT');
    assert.equal((await dbsql(to,`SELECT has_table_privilege('w61_fixture_reader',
      'public.w61_restore_rows','INSERT')::text`)).trim(),'false','no privilege elevation');
    assert.equal(await hashFile(archive),archiveDigest,'archive immutable across restore');
    assert.equal(await hashFile(rollbackPath),rollbackDigest,'rollback immutable across restore');
    const roleSql = `SELECT current_user || ':' ||
      has_database_privilege(current_user,current_database(),'CONNECT')::text || ':' ||
      has_table_privilege(current_user,'public.w61_restore_rows','SELECT')::text || ':' ||
      has_database_privilege(current_user,current_database(),'CREATE')::text`;
    const sourceRole=(await dbsql(from,roleSql)).trim().split(':');
    const restoreRole=(await dbsql(to,roleSql)).trim().split(':');
    assert.deepEqual(sourceRole,['postgres','true','true','true'],'source role rights measured in PG17');
    assert.deepEqual(restoreRole,['postgres','true','true','true'],'destination role rights measured in PG17');
    const staging=await sealClientBackupRestoreStagingW47({
      journalDirectory:root,intent,archiveReceipt,tocReadback:toc,
      rollbackSha256:rollbackDigest,
      sourceReadback:{
        source_head:sourceHead,owner_pid:process.pid,keeper_pid:srcHostPid,
        owner_sha256:ownerDigest,postmaster_sha256:pgDigest,
        pg_system_identifier:sourceIdentity,pg_started_at:sourceBirth,
        pg_version:sourceVersion,fingerprint:rows,
      },
      restoredReadback:{
        pg_system_identifier:destIdentity,pg_version:targetVersion,
        pg_pid:dstHostPid,fingerprint:restoredRows,
      },
      roleReadback:{
        source_role:sourceRole[0],restore_role:restoreRole[0],
        source_connect:sourceRole[1]==='true',source_select:sourceRole[2]==='true',
        restore_connect:restoreRole[1]==='true',restore_create:restoreRole[3]==='true',
      },
    });
    assert.equal(staging.state,'STAGING_PASSED');
    assert.equal(staging.archive_verified,true);
    assert.equal(staging.restore_data_compared,true);
    assert.equal(staging.rollback_preserved,true);
    assert.equal(staging.upgrade_authorized,false);
    assert.equal((await readClientBackupRestoreStagingW47({
      journalDirectory:root,intentId:intent.intent_id,
    })).state,'STAGING_SEALED');
    assert.equal((await readBackupEffectFence({
      journalDirectory:root,intentId:intent.intent_id,
    })).state,'EFFECT_UNKNOWN');
    console.log(JSON.stringify({kind:'W61_REAL_PG17_W47_STAGING',source_head:sourceHead,
      image:IMAGE,distinct_clusters:true,rows_equal:true,roles_grants_checked:true,
      archive_sha256:archiveDigest,rollback_sha256:rollbackDigest,installed_owner_proven:false,
      live_authority:false,upgrade_authorized:false}));
    await dbsql(to,"UPDATE public.w61_restore_rows SET body='tampered' WHERE id=2");
    assert.notEqual((await dbsql(to,fingerprint)).trim(),rows,
      'equal count but changed content must not pass independent restore compare');
  }finally{
    for(const id of started.reverse())await docker('rm','--force','--volumes',id).catch(()=>{});
    await fs.rm(root,{recursive:true,force:true});
  }
});
