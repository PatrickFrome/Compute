import fs from 'node:fs/promises';
import nodeFs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {openCheckpointReconciliationFixture} from './native-coding-checkpoint-reconciliation-fixture.mjs';

// Test-only fault injection lives in a disposable child. No production hook,
// installed runtime, user repository, or native authority is used here.
const [seedPath,encoded]=process.argv.slice(2),options=JSON.parse(encoded);
const send=value=>new Promise((resolve,reject)=>process.send(value,error=>error?reject(error):resolve()));
process.on('message',()=>{});
let fixture;
const barrier=async phase=>{
  const continued=phase==='INTENT_RACE'?new Promise(resolve=>process.once('message',resolve)):new Promise(()=>{});
  await send({type:'BARRIER',phase});await continued;
};
try{
  const imported=options.serviceModule?await import(pathToFileURL(options.serviceModule)):await import('../native-coding-host-commit-service.mjs');
  fixture=await openCheckpointReconciliationFixture(seedPath,{
    createService:imported.createNativeCodingHostCommitService,ack:options.ack||'normal',
    beforeSql:options.phase==='AFTER_INTENT_BEFORE_SQL'?()=>barrier(options.phase):null,
    afterSql:options.phase==='AFTER_SQL_BEFORE_ACK'?()=>barrier(options.phase):null,
  });
  const originalSpawn=childProcess.spawn;
  childProcess.spawn=(executable,args,...rest)=>{
    if(args.includes('update-ref'))nodeFs.appendFileSync(fixture.eventFile,JSON.stringify({kind:'GIT_UPDATE_REF'})+'\n');
    const command=['update-ref','read-tree','update-index','write-tree','hash-object'].find(value=>args.includes(value));
    if(command&&(command!=='hash-object'||args.includes('-w')))
      nodeFs.appendFileSync(fixture.eventFile,JSON.stringify({kind:'GIT_WRITE_COMMAND',command})+'\n');
    const spawned=originalSpawn(executable,args,...rest);
    if(options.traceGit)spawned.once('close',code=>{
      if(code!==0)nodeFs.appendFileSync(fixture.eventFile,JSON.stringify({kind:'GIT_COMMAND_NONZERO',args,code})+'\n');
    });
    return spawned;
  };
  syncBuiltinESMExports();
  const originalOpen=fs.open;
  fs.open=async(file,flags,...rest)=>{
    if(['AFTER_GIT_BEFORE_INTENT','INTENT_RACE'].includes(options.phase)&&path.resolve(String(file))===fixture.sqlIntent&&flags==='wx')await barrier(options.phase);
    return originalOpen(file,flags,...rest);
  };
  const service=await fixture.make();
  let value;
  if(options.operation==='OBSERVER'){
    const module=options.observerModule?await import(pathToFileURL(options.observerModule)):
      await import('../../../apps/metaengine-browser/src/native-coding-project-commits.mjs');
    const observer=module.createNativeCodingProjectCommitObserver({ownPostgres:{
      readFinishCheckpoint:query=>service.READ_FINISH_CHECKPOINT(query),
      finishCheckpoint:async query=>{await fixture.appendEvent('OBSERVER_FINISH');return service.FINISH_CHECKPOINT(query);},
      reconcileFinishCheckpoint:async query=>{await fixture.appendEvent('OBSERVER_RECONCILE');return service.RECONCILE_FINISH_CHECKPOINT(query);},
    }});
    observer.observe([fixture.selector]);await observer.drain();value=observer.snapshot();observer.close();
  }else value=await service[options.operation||'FINISH_CHECKPOINT'](fixture.query);
  service.close();await send({type:'RESULT',value});process.disconnect();
}catch(error){await send({type:'ERROR',message:error.message,...(options.traceGit&&fixture?
  {gitFailures:(await fixture.events()).filter(event=>event.kind==='GIT_COMMAND_NONZERO')}:{} )});process.disconnect();process.exitCode=1;}
