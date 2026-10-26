// Disposable TEST child only. Fault barriers are injected around real native
// PostgreSQL transactions and real Git commands, never into production source.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nodeFs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createNativeCodingHostCommitService} from '../native-coding-host-commit-service.mjs';
import {readNativeCodingGitCommitOperator} from '../native-coding-git-commit-operator.mjs';
import {createNativeCodingProjectCommitObserver} from '../../../apps/metaengine-browser/src/native-coding-project-commits.mjs';

const [seedPath,encoded]=process.argv.slice(2),options=JSON.parse(encoded);
const send=value=>new Promise((resolve,reject)=>process.send(value,error=>error?reject(error):resolve()));
process.on('message',()=>{});
const barrier=async phase=>{
  const continued=phase==='INTENT_RACE'?new Promise(resolve=>process.once('message',resolve)):new Promise(()=>{});
  await send({type:'BARRIER',phase});await continued;
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let raw,service;
try{
  const seed=JSON.parse(await fs.readFile(seedPath,'utf8')),{connection:c,query,checkpoint:k}=seed;
  assert.equal(seed.schema,'metaengine.native-coding.checkpoint-reconciliation.pg-fixture.v1');
  assert.equal(c.host,'127.0.0.1');assert.equal(c.user,'state_owner');assert.equal(c.database,'postgres');
  assert.ok(Number.isSafeInteger(c.port)&&c.port>1024&&c.port<65536);
  assert.ok(path.isAbsolute(c.driver)&&path.isAbsolute(c.data_directory));
  const postgres=(await import(pathToFileURL(c.driver))).default;
  raw=postgres({host:c.host,port:c.port,user:c.user,database:c.database,max:1,onnotice:()=>{},
    connect_timeout:5,idle_timeout:5,connection:{application_name:'METAENGINE_RECONCILIATION_CHILD_QA',statement_timeout:18000,lock_timeout:5000}});
  const [identity]=await raw.unsafe(`select current_user::text as current_user,session_user::text as session_user,
    current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
    (select system_identifier::text from pg_control_system()) as system_identifier`);
  assert.equal(identity.current_user,'state_owner');assert.equal(identity.session_user,'state_owner');
  assert.ok(identity.version>=170000&&identity.version<180000);
  assert.equal(await fs.realpath(identity.data_directory),await fs.realpath(c.data_directory));
  assert.equal(identity.system_identifier,c.system_identifier);
  const eventFile=path.join(seed.directory,'checkpoint-reconciliation-pg-events.jsonl');
  const event=(kind,extra={})=>nodeFs.appendFileSync(eventFile,JSON.stringify({kind,pid:process.pid,...extra})+'\n',{mode:0o600});
  const sqlIntent=path.join(seed.journalRoot,'sql-finalize',query.checkpoint_sha256,'intent.json');
  const originalSpawn=childProcess.spawn;
  childProcess.spawn=(executable,args,...rest)=>{
    if(args.includes('update-ref'))event('GIT_UPDATE_REF');
    const command=['update-ref','read-tree','update-index','write-tree','hash-object'].find(value=>args.includes(value));
    if(command&&(command!=='hash-object'||args.includes('-w')))event('GIT_WRITE_COMMAND',{command});
    return originalSpawn(executable,args,...rest);
  };syncBuiltinESMExports();
  const originalOpen=fs.open;
  fs.open=async(file,flags,...rest)=>{
    if(['AFTER_GIT_BEFORE_INTENT','INTENT_RACE'].includes(options.phase)
      &&path.resolve(String(file))===sqlIntent&&flags==='wx')await barrier(options.phase);
    return originalOpen(file,flags,...rest);
  };
  const sql={unsafe:raw.unsafe.bind(raw),begin:async(isolation,operation)=>{
    // Reached only after the actual Host has synced its exclusive intent.
    const intent=JSON.parse(await fs.readFile(sqlIntent,'utf8'));
    assert.equal(intent.checkpoint_sha256,query.checkpoint_sha256);
    if(options.phase==='AFTER_INTENT_BEFORE_SQL')await barrier(options.phase);
    const value=await raw.begin(isolation,async tx=>operation({unsafe:async(text,values)=>{
      if(text.includes('native_coding_finish_checkpoint_v1'))event('SQL_DISPATCH');
      return tx.unsafe(text,values);
    }}));
    // postgres.js resolves begin only after the transaction COMMIT ACK.
    event('SQL_COMMITTED');
    if(options.phase==='AFTER_SQL_BEFORE_ACK')await barrier(options.phase);
    if(options.ack==='lost')throw Error('GENERATED_LOST_ACK_AFTER_REAL_PG_COMMIT');
    return value;
  }};
  const execute=promisify(childProcess.execFile),git=async args=>(await execute(seed.gitExecutable,
    ['-c','core.fsmonitor=false','-C',seed.root,...args],{windowsHide:true,timeout:30000,
      env:{PATH:path.dirname(seed.gitExecutable),SystemRoot:process.env.SystemRoot,GIT_CONFIG_NOSYSTEM:'1',
        GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'}})).stdout.trim();
  const readProtectedJson=async file=>{
    const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
    assert.equal(await fs.realpath(file),path.resolve(file));
    const bytes=await fs.readFile(file);return {value:JSON.parse(bytes),sha256:hash(bytes)};
  };
  service=await createNativeCodingHostCommitService({sql,stateDirectory:seed.stateDirectory,readProtectedJson,
    readOperator:directory=>readNativeCodingGitCommitOperator(directory,{readProtectedJson}),
    protectStorage:async directory=>fs.chmod(directory,0o700),verifyStorage:async()=>({owner_dacl_verified:false}),
    readProtectedReceipt:async({scope})=>{assert.equal(scope.task_id,k.writer_task_id);return structuredClone(seed.writer);},
    readNativeScope:async(_permit,includeSandbox)=>{assert.equal(includeSandbox,false);return {
      artifact:structuredClone(seed.permit.artifact),postgres:structuredClone(seed.permit.postgres),user_sid:seed.permit.user_sid,
      host_process:structuredClone(seed.host_process),worktree:{...structuredClone(seed.permit.worktree),base_sha:await git(['rev-parse','HEAD'])}};}});
  let value;
  if(options.operation==='OBSERVER'){
    const observer=createNativeCodingProjectCommitObserver({ownPostgres:{
      readFinishCheckpoint:q=>service.READ_FINISH_CHECKPOINT(q),
      finishCheckpoint:q=>{event('OBSERVER_FINISH');return service.FINISH_CHECKPOINT(q);},
      reconcileFinishCheckpoint:q=>{event('OBSERVER_RECONCILE');return service.RECONCILE_FINISH_CHECKPOINT(q);},
    }});
    const selector={...query,checkpoint_id:k.checkpoint_id,writer_task_id:k.writer_task_id,writer_lease_generation:k.writer_lease_generation,
      critic_task_id:k.critic_task_id,critic_lease_generation:k.critic_lease_generation};
    observer.observe([selector]);await observer.drain();value=observer.snapshot();observer.close();
  }else value=await service[options.operation||'FINISH_CHECKPOINT'](query);
  service.close();await raw.end({timeout:5});raw=null;
  await send({type:'RESULT',value});process.disconnect();
}catch(error){
  service?.close();if(raw)await raw.end({timeout:5}).catch(()=>{});
  await send({type:'ERROR',message:error.message});process.disconnect();process.exitCode=1;
}
