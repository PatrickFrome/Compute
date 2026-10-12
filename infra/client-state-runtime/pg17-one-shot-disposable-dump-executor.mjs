// Disposable-fixture only; no installed Owner/production authorization.
// Any error after crossing the durable barrier remains EFFECT_UNKNOWN.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishBackupEffectIntent,crossBackupEffectBarrier,readBackupEffectFence}
  from './pg17-backup-effect-barrier.mjs';
import {classifyPostgresUtilityFailure} from './postgres-utility-diagnostic.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const SHA=/^[a-f0-9]{64}$/;
const exe=name=>process.platform==='win32'?name+'.exe':name;
const hash=async file=>{
  const h=createHash('sha256');
  for await (const b of createReadStream(file))h.update(b);
  return h.digest('hex');
};
async function regular(file){
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)
    throw fail('pg17_disposable_binary_untrusted');
  return fs.realpath(file);
}
async function childOutput(binary,args,env,ms,operation){
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn(binary,args,{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});}
    catch{reject(fail('pg17_'+operation+'_spawn_unconfirmed'));return;}
    let ended=false,outLength=0,errLength=0;
    const out=[],errors=[];
    let timer;
    const finish=(error,value)=>{
      if(ended)return;ended=true;clearTimeout(timer);
      error?reject(error):resolve(value);
    };
    const abort=reason=>{
      finish(fail(reason));
      try{child.kill();}catch{}
    };
    timer=setTimeout(()=>abort('pg17_'+operation+'_timeout_unknown'),ms);
    child.stdout.on('data',b=>{
      if(ended)return;
      outLength+=b.length;
      if(outLength>1024*1024)return abort('pg17_'+operation+'_stdout_limit_unknown');
      out.push(b);
    });
    child.stderr.on('data',b=>{
      if(ended)return;
      errLength+=b.length;
      if(errLength>16384)return abort('pg17_'+operation+'_stderr_limit_unknown');
      errors.push(b);
    });
    child.stdout.once('error',()=>abort('pg17_'+operation+'_stdout_unknown'));
    child.stderr.once('error',()=>abort('pg17_'+operation+'_stderr_unknown'));
    child.once('error',()=>finish(fail('pg17_'+operation+'_spawn_unconfirmed')));
    child.once('close',(code,signal)=>{
      if(code!==0||signal){
        const category=classifyPostgresUtilityFailure(Buffer.concat(errors),'backup').code;
        return finish(fail('pg17_'+operation+'_failed_'+category));
      }
      // PostgreSQL warns that pg_dump stderr warnings need examination;
      // do not treat an unreviewed warning as an acceptable archive.
      if(operation==='dump'&&errLength>0)
        return finish(fail('pg17_dump_warning_unqualified'));
      finish(null,Buffer.concat(out).toString('utf8'));
    });
  });
}
function environment(input,port){
  if(!input||input.PGHOST!=='127.0.0.1'||input.PGPORT!==String(port)
    ||input.PGDATABASE!=='postgres'||input.PGUSER!=='postgres'
    ||input.PGSSLMODE!=='disable'||typeof input.PGPASSWORD!=='string'
    ||input.PGPASSWORD.length<16)
    throw fail('pg17_disposable_connection_invalid');
  const result={};
  for(const k of ['SystemRoot','WINDIR','PATH','PATHEXT','COMSPEC','TEMP','TMP'])
    if(typeof process.env[k]==='string')result[k]=process.env[k];
  for(const k of ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE'])
    result[k]=input[k];
  result.PGCONNECT_TIMEOUT='3';
  return result;
}
const identitySql="SELECT json_build_object('system_identifier',"+
  "(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),"+
  "'version',current_setting('server_version_num')::int,"+
  "'port',inet_server_port(),'started_at',pg_postmaster_start_time())::text";
async function inspect(psql,env,port){
  const s=await childOutput(psql,['-X','--no-password','-v','ON_ERROR_STOP=1',
    '-v','VERBOSITY=sqlstate','-At','-c',identitySql],env,10000,'identity');
  let p;
  try{p=JSON.parse(s.trim());}catch{throw fail('pg17_disposable_identity_invalid');}
  if(!p||typeof p.system_identifier!=='string'
    ||!/^[1-9][0-9]{9,19}$/.test(p.system_identifier)
    ||p.version<170000||p.version>=180000||p.port!==port
    ||typeof p.started_at!=='string'||!Number.isFinite(Date.parse(p.started_at)))
    throw fail('pg17_disposable_identity_invalid');
  return p;
}
export async function executeDisposableOneShotPg17Dump({
  intent,journalDirectory,pgBinDir,expectedPgDumpSha256,
  sourceDataDirectory,sourcePort,connectionEnv,timeoutMs=90000,
}={}){
  if(process.platform!=='win32'||!Number.isSafeInteger(sourcePort)
    ||sourcePort<1024||sourcePort>65535||[55432,55433,55434].includes(sourcePort)
    ||!SHA.test(expectedPgDumpSha256||'')
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)
    throw fail('pg17_disposable_authority_invalid');
  if(!intent||typeof sourceDataDirectory!=='string'
    ||!path.isAbsolute(sourceDataDirectory)||typeof journalDirectory!=='string'
    ||!path.isAbsolute(journalDirectory)||!path.isAbsolute(pgBinDir))
    throw fail('pg17_disposable_paths_invalid');
  const source=await fs.realpath(sourceDataDirectory);
  const journal=await fs.realpath(journalDirectory);
  const temp=await fs.realpath(os.tmpdir());
  const within=p=>{
    const rel=path.relative(temp,p);
    return rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);
  };
  if(!within(source)||!within(journal)||intent.keeper_pid===process.pid)
    throw fail('pg17_disposable_scope_invalid');
  const bin=await fs.realpath(pgBinDir);
  const dump=await regular(path.join(bin,exe('pg_dump')));
  const psql=await regular(path.join(bin,exe('psql')));
  const restore=await regular(path.join(bin,exe('pg_restore')));
  if(await hash(dump)!==expectedPgDumpSha256)throw fail('pg17_disposable_binary_digest_mismatch');
  const env=environment(connectionEnv,sourcePort);
  const pidBefore=await fs.readFile(path.join(source,'postmaster.pid'),'utf8');
  const pidRows=pidBefore.trim().split(/\r?\n/);
  if(Number(pidRows[0])!==intent.keeper_pid
    ||Number(pidRows[3])!==sourcePort||Number(pidRows[2])<=0)
    throw fail('pg17_disposable_pid_identity_mismatch');
  const before=await inspect(psql,env,sourcePort);
  await publishBackupEffectIntent({journalDirectory:journal,intent});
  await crossBackupEffectBarrier({journalDirectory:journal,intent});
  // No attempt from this point can be retried following ambiguous outcomes.
  await childOutput(dump,['--format=custom','--no-owner','--no-acl','--no-password',
    '--lock-wait-timeout=5000','--host=127.0.0.1','--port='+sourcePort,
    '--username=postgres','--dbname=postgres','--file='+intent.archive_path],
    env,timeoutMs,'dump');
  const after=await inspect(psql,env,sourcePort);
  if(before.system_identifier!==after.system_identifier
    ||before.started_at!==after.started_at
    ||await fs.readFile(path.join(source,'postmaster.pid'),'utf8')!==pidBefore)
    throw fail('pg17_disposable_source_epoch_changed');
  const file=await fs.lstat(intent.archive_path);
  if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size<1024)
    throw fail('pg17_disposable_archive_unqualified');
  const fd=await fs.open(intent.archive_path,'r');
  const header=Buffer.alloc(5);
  try{await fd.read(header,0,5,0);}finally{await fd.close();}
  if(header.toString('ascii')!=='PGDMP')throw fail('pg17_disposable_archive_unqualified');
  const archiveHash=await hash(intent.archive_path);
  const toc=await childOutput(restore,['--list',intent.archive_path],env,30000,'toc');
  if(!/^.*TABLE DATA .*$/m.test(toc))throw fail('pg17_disposable_toc_incomplete');
  if((await fs.stat(intent.archive_path)).size!==file.size
    ||await hash(intent.archive_path)!==archiveHash)
    throw fail('pg17_disposable_archive_changed');
  const fence=await readBackupEffectFence({journalDirectory:journal,intentId:intent.intent_id});
  if(fence.state!=='EFFECT_UNKNOWN'||fence.barrier_found!==true)
    throw fail('pg17_disposable_barrier_lost');
  return Object.freeze({schema:'metaengine.pg17.disposable-dump-readback.v1',
    state:'ARCHIVE_ONLY_VERIFIED',archive_sha256:archiveHash,archive_bytes:file.size,
    toc_sha256:createHash('sha256').update(toc).digest('hex'),
    source_pg_system_identifier:before.system_identifier,
    source_pg_started_at:before.started_at,effect_intent_id:intent.intent_id,
    archive_verified:true,physical_restore_proven:false,
    upgrade_authorized:false,automatic_retry_allowed:false,authority_effect:false});
}
