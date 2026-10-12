import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {startOwnedWindowsPostgres} from './owned-postgres-process.mjs';
import {classifyPostgresUtilityFailure} from './postgres-utility-diagnostic.mjs';
import {buildBackupEffectIntent,crossBackupEffectBarrier,readBackupEffectFence} from './pg17-backup-effect-barrier.mjs';
import {executeDisposableOneShotPg17Dump} from './pg17-one-shot-disposable-dump-executor.mjs';

const exec=promisify(execFile);
const bin=process.env.LOCAL_STATE_TEST_PG_BIN_DIR;
const executable=name=>path.join(bin,process.platform==='win32'?name+'.exe':name);
const hash=async file=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
const fail=code=>Object.assign(new Error('disposable_restore_'+code),{code:'disposable_restore_'+code});

async function freePort(){
  const s=net.createServer();
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  const number=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return number;
}
async function command(name,args,env,stage,timeout=30000){
  try{
    return await exec(executable(name),args,{
      env,timeout,windowsHide:true,shell:false,maxBuffer:8*1024*1024,
    });
  }catch(error){
    const kind=classifyPostgresUtilityFailure(String(error?.stderr||''),'backup').code;
    throw fail(stage+'_'+kind);
  }
}
async function initialize(root,password,env){
  await fs.mkdir(root,{recursive:true});
  const passwordFile=path.join(root,'password');
  const data=path.join(root,'cluster');
  await fs.writeFile(passwordFile,password,{flag:'wx',mode:0o600});
  await command('initdb',[
    '-D',data,'--username=postgres','--auth=scram-sha-256',
    '--pwfile='+passwordFile,'--encoding=UTF8','--no-locale',
  ],env,'initdb',120000);
  return data;
}
function pgEnv(port,password){
  const env={...process.env};
  for(const key of Object.keys(env))if(/^PG/i.test(key))delete env[key];
  return {...env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',
    PGPASSWORD:password,PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'3',PGSSLMODE:'disable'};
}
async function selectScalar(sql,env){
  const result=await command('psql',[
    '-X','--no-password','-v','ON_ERROR_STOP=1',
    '-v','VERBOSITY=sqlstate','-At','-c',sql,
  ],env,'sql_readback',10000);
  return result.stdout.trim();
}
const tableFingerprint=String.raw`SELECT count(*)::text || ':' ||
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n'
    order by to_jsonb(t)::text),''))
  FROM public.metaengine_disposable_restore_probe t`;

// Every OS effect in this test targets brand-new disposable directories and
// reserved loopback ports, NOT an installed Owner, Keeper or user project.
test('real PostgreSQL17 custom dump -> separate postmaster restore -> exact data readback', {
  skip:!bin||process.platform!=='win32',timeout:300000,
},async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-disposable-restore-')));
  const password=randomBytes(24).toString('hex');
  const env0=pgEnv(60000,password);
  let source=null,destination=null;
  t.after(async()=>{
    for(const item of [destination,source])if(item){
      const stopped=await item.stop();
      assert.equal(stopped.cleanup_confirmed,true,'temporary postmasters must be stopped');
    }
    await fs.rm(root,{recursive:true,force:false});
  });
  const from=await initialize(path.join(root,'from'),password,env0);
  const to=await initialize(path.join(root,'to'),password,env0);
  const sourcePort=await freePort(),destinationPort=await freePort();
  assert.notEqual(sourcePort,destinationPort);
  for(const forbidden of [55432,55433,55434]){
    assert.notEqual(sourcePort,forbidden);
    assert.notEqual(destinationPort,forbidden);
  }
  const sourceEnv=pgEnv(sourcePort,password),destinationEnv=pgEnv(destinationPort,password);
  source=await startOwnedWindowsPostgres({
    pgBinDir:bin,pgDataDir:from,databasePort:sourcePort,env:sourceEnv,startupTimeoutMs:60000,
  });
  await command('psql',[
    '-X','--no-password','-v','ON_ERROR_STOP=1','-c',
    "CREATE TABLE public.metaengine_disposable_restore_probe(id integer PRIMARY KEY, body text NOT NULL);"+
    "INSERT INTO public.metaengine_disposable_restore_probe VALUES (1,'first'),(2,'unicode-'||chr(1105)),(3,'last');",
  ],sourceEnv,'source_seed');
  const fingerprint=await selectScalar(tableFingerprint,sourceEnv);
  assert.match(fingerprint,/^3:[a-f0-9]{32}$/);
  const archive=path.join(root,'postgresql-17-snapshot.dump');
  // Source/Owner identities below are isolated test-fixture pins, NOT an
  // installed Owner or its private Keeper authority.
  const intent=buildBackupEffectIntent({
    ownerPid:process.pid,keeperPid:source.pid,
    sourceHead:'f5b1b1a802ef5af74d188675b0df3fbc3d4963a9',
    ownerSha256:'a'.repeat(64),postmasterSha256:'b'.repeat(64),
    archivePath:archive,
  });
  const archiveProof=await executeDisposableOneShotPg17Dump({
    intent,journalDirectory:root,pgBinDir:bin,
    expectedPgDumpSha256:await hash(executable('pg_dump')),
    sourceDataDirectory:from,sourcePort,connectionEnv:sourceEnv,
  });
  assert.equal(archiveProof.state,'ARCHIVE_ONLY_VERIFIED');
  assert.equal(archiveProof.physical_restore_proven,false);
  assert.equal(archiveProof.upgrade_authorized,false);
  await assert.rejects(crossBackupEffectBarrier({journalDirectory:root,intent}),
    /backup_effect_(?:archive_existing|write_ambiguous)/);
  const before=(await fs.stat(archive)).size;
  assert(before>1024,'real custom-format dump must not be empty');
  const digestBefore=await hash(archive);
  const signature=Buffer.alloc(5);
  const fh=await fs.open(archive,'r');
  try{await fh.read(signature,0,5,0);}finally{await fh.close();}
  assert.equal(signature.toString('ascii'),'PGDMP');
  const listed=await command('pg_restore',['--list',archive],destinationEnv,'toc');
  assert.match(listed.stdout,/TABLE DATA public metaengine_disposable_restore_probe/);
  const sourceIdentity=await selectScalar("SELECT system_identifier::text FROM pg_control_system()",sourceEnv);
  const targetIdentity=await selectScalar("SELECT system_identifier::text FROM pg_control_system()",
    destinationEnv).catch(()=>null);
  // Destination is not online yet: do not take pre-start SQL success as proof.
  assert.equal(targetIdentity,null);
  destination=await startOwnedWindowsPostgres({
    pgBinDir:bin,pgDataDir:to,databasePort:destinationPort,
    env:destinationEnv,startupTimeoutMs:60000,
  });
  assert.notEqual(source.pid,destination.pid);
  const destinationIdentity=await selectScalar("SELECT system_identifier::text FROM pg_control_system()",destinationEnv);
  assert.notEqual(sourceIdentity,destinationIdentity,'two physically different PG17 clusters');
  await command('pg_restore',[
    '--exit-on-error','--single-transaction','--no-owner','--no-acl','--no-password',
    '--dbname=postgres','--host=127.0.0.1','--port='+destinationPort,
    '--username=postgres',archive,
  ],destinationEnv,'restore',90000);
  const restored=await selectScalar(tableFingerprint,destinationEnv);
  assert.equal(restored,fingerprint,'restored row count and contents must match source readback');
  assert.equal(await hash(archive),digestBefore);
  assert.equal((await fs.stat(archive)).size,before);
  const receipt=Object.freeze({
    schema:'metaengine.disposable-pg17.restore-physical-fixture.v1',
    archive_sha256:digestBefore,archive_bytes:before,
    source_port:sourcePort,destination_port:destinationPort,
    distinct_pg17_clusters:true,independent_sql_readback:true,
    content_digest_matched:true,archive_unchanged:true,
    source_data_modified:false,installed_owner_touched:false,
    promotion_authorized:false,automatic_retry_allowed:false,authority_effect:false,
  });
  assert.equal(receipt.promotion_authorized,false);
  assert.equal(receipt.independent_sql_readback,true);
  assert.equal((await readBackupEffectFence({journalDirectory:root,intentId:intent.intent_id})).state,'EFFECT_UNKNOWN');
  // Same number of rows after corruption is NOT preserved data. The
  // independent readback must reject a one-cell content drift too.
  await command('psql',[
    '-X','--no-password','-v','ON_ERROR_STOP=1','-c',
    "UPDATE public.metaengine_disposable_restore_probe SET body='altered' WHERE id=2",
  ],destinationEnv,'target_mutation_fixture');
  const altered=await selectScalar(tableFingerprint,destinationEnv);
  assert.match(altered,/^3:[a-f0-9]{32}$/);
  assert.notEqual(altered,fingerprint,'equal row count must not conceal changed data');
});
