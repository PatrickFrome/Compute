import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {inspectPostgres} from './launcher.mjs';
import {startOwnedWindowsPostgres} from './owned-postgres-process.mjs';
import {createPostgresContinuityInspector} from './postgres-continuity-inspector.mjs';
import {startDbApi} from './db-api.mjs';
import postgres from 'postgres';

const execute=promisify(execFile),bin=process.env.LOCAL_STATE_TEST_PG_BIN_DIR;
const executable=name=>path.join(bin,name+'.exe');
async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

// A fresh, generated SCRAM cluster is the only database this test can address.
// Never load an installed Owner, URL, protected configuration or Keeper data.
test('real PG17 continuity uses the same JSON identity as independent psql and one connection',{
  skip:!bin||process.platform!=='win32',timeout:180000,
},async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-pg-continuity-')));
  const data=path.join(root,'cluster'),password=randomBytes(24).toString('hex'),port=await freePort();
  assert.ok(![55432,55433,55434].includes(port));
  const env={...process.env};for(const key of Object.keys(env))if(/^PG/i.test(key))delete env[key];
  Object.assign(env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGPASSWORD:password,
    PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'3',PGSSLMODE:'disable'});
  let owned=null,inspector=null,finished=false;
  t.after(async()=>{
    await inspector?.close();
    if(owned)assert.equal((await owned.stop()).cleanup_confirmed,true);
    if(finished){
      const actual=await fs.realpath(root),parent=await fs.realpath(os.tmpdir());
      assert.ok(actual.startsWith(parent+path.sep)&&path.basename(actual).startsWith('metaengine-pg-continuity-'));
      await fs.rm(actual,{recursive:true,force:false});
    }
  });
  const passwordFile=path.join(root,'generated-password');await fs.writeFile(passwordFile,password,{flag:'wx',mode:0o600});
  await execute(executable('initdb'),['-D',data,'--username=postgres','--auth=scram-sha-256',
    '--pwfile='+passwordFile,'--encoding=UTF8','--no-locale'],{env,timeout:120000,windowsHide:true,maxBuffer:1024*1024});
  owned=await startOwnedWindowsPostgres({pgBinDir:bin,pgDataDir:data,databasePort:port,env,startupTimeoutMs:60000});
  const sql=async query=>(await execute(executable('psql'),['-X','--no-password','-v','ON_ERROR_STOP=1','-At','-c',query],
    {env,timeout:10000,windowsHide:true,maxBuffer:65536})).stdout.trim();
  const systemIdentifier=await sql('select system_identifier::text from pg_catalog.pg_control_system()');
  const config={pgBinDir:bin,pgDataDir:data,databasePort:port,expectedClusterSystemIdentifier:systemIdentifier,
    inspectDatabaseUrl:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`};
  config.inspectDatabase=new URL(config.inspectDatabaseUrl);
  const startup=await inspectPostgres(config);
  assert.match(startup.started_at,/\d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2}$/);
  inspector=await createPostgresContinuityInspector(config);
  for(let read=0;read<25;read++)assert.deepEqual(await inspector.inspect(),startup);
  assert.equal(await sql("select count(*) from pg_stat_activity where application_name='metaengine-runtime-continuity'"),'1');
  assert.deepEqual(await inspectPostgres(config),startup,'independent psql identity remains unchanged');
  await inspector.close();inspector=null;
  assert.equal(await sql("select count(*) from pg_stat_activity where application_name='metaengine-runtime-continuity'"),'0');
  // Exercise the production API driver's actual pool, without a mocked SQL
  // pool that could hide health starvation behind six open transactions.
  await sql("create role service_role nologin; create role continuity_api_login login password '"+password+"'; "+
    "grant service_role to continuity_api_login; "+
    "create function public.devos_environment_state_v1() returns jsonb language plpgsql as $body$ "+
    "begin perform pg_advisory_xact_lock(7718045821); return '{\"fixture\":true}'::jsonb; end $body$; "+
    "create function public.devos_runtime_capabilities_v1() returns jsonb language sql as $body$ select '{\"fixture\":true}'::jsonb $body$");
  const holder=postgres(config.inspectDatabaseUrl,{max:1,prepare:false,connect_timeout:3});
  let api=null,pending=[];
  try{
    await holder.unsafe('select pg_advisory_lock(7718045821)');
    const key=randomBytes(32).toString('hex');
    api=await startDbApi({databaseUrl:`postgresql://continuity_api_login:${password}@127.0.0.1:${port}/postgres`,apiKey:key,port:0});
    const headers={apikey:key,'content-type':'application/json'};
    pending=Array.from({length:6},()=>fetch(api.address+'/rest/v1/rpc/devos_environment_state_v1',
      {method:'POST',headers,body:'{}'}));
    const deadline=Date.now()+6000;let occupied='0';
    do{
      occupied=await sql("select count(*) from pg_stat_activity where usename='continuity_api_login' and wait_event='advisory'");
      if(occupied==='6')break;await new Promise(resolve=>setTimeout(resolve,25));
    }while(Date.now()<deadline);
    assert.equal(occupied,'6','all six application transactions physically occupy their SQL connections');
    const response=await fetch(api.address+'/health',{headers:{apikey:key},signal:AbortSignal.timeout(5000)});
    const body=await response.json();
    // The intentionally minimal catalog cannot assert runtime readiness. It
    // must nevertheless execute its DB read while the six app reads are held.
    assert.equal(response.status,503);assert.equal(body.schema,'metaengine.client-state.health.v1');
    assert.deepEqual(body.runtime_capabilities,{fixture:true});assert.equal(body.error,undefined);
    assert.equal(await sql("select count(*) from pg_stat_activity where usename='continuity_api_login'"),'7');
  }finally{
    await holder.unsafe('select pg_advisory_unlock_all()');
    await Promise.allSettled(pending);await api?.close();await holder.end({timeout:5});
  }
  finished=true;
});
