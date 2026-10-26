// TEST ONLY: creates one new native PG17 cluster; never accepts an existing DSN.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {populateFreshClientSchema} from './fresh-provider-private-loader.mjs';
import {loadFreshSchemaApplicationPlan} from '../fresh-schema-application-plan.mjs';
import {verifyFreshConnectionIdentity} from '../fresh-client-provider.mjs';
const exec=promisify(execFile);

export async function withFreshOwnerNativeFixture({bin,driver},exercise) {
  assert(path.isAbsolute(bin)&&path.isAbsolute(driver));
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'first-owner-pg17-')),data=path.join(root,'pg17');
  const ownerPassword=randomBytes(32).toString('hex'),apiPassword=randomBytes(32).toString('hex');
  const passwordFile=path.join(root,'initdb-password');await fs.writeFile(passwordFile,ownerPassword+'\n',{flag:'wx',mode:0o600});
  const command=(name,args)=>exec(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
    {env:Object.fromEntries(Object.entries({...process.env,LC_ALL:'C',LANG:'C'}).filter(([key])=>!/^PG/i.test(key))),shell:false,windowsHide:true,timeout:120000,maxBuffer:65536});
  let started=false,owner,api,reserved;
  try {
    const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    await command('initdb',['-D',data,'--username=state_owner','--auth=scram-sha-256',`--pwfile=${passwordFile}`,'--no-locale','--encoding=UTF8','--no-sync']);
    const identifier=/Database system identifier:\s*([0-9]+)/.exec((await command('pg_controldata',['-D',data])).stdout)?.[1];assert(identifier);
    started=true;await command('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`,'-w','start']);
    const postgres=(await import(pathToFileURL(driver))).default;
    const connect=(user,password)=>postgres({host:'127.0.0.1',port,user,password,database:'postgres',max:1,prepare:false,connect_timeout:5,
      onnotice:()=>{},debug:false,onparameter:()=>{}});
    owner=connect('state_owner',ownerPassword);reserved=await owner.reserve();
    const pidBytes=await fs.readFile(path.join(data,'postmaster.pid'),'utf8');
    const expected={directory:await fs.realpath(data),systemIdentifier:identifier,postmasterStartIdentity:pidBytes.trim().split(/\r?\n/)[2]};
    const check=async (connection,identity=expected)=>{
      assert.equal(await fs.readFile(path.join(data,'postmaster.pid'),'utf8'),pidBytes);
      const [row]=await connection.unsafe(`select current_user as login,session_user as session_login,current_database() as database,
        current_setting('data_directory') as directory,system_identifier::text,pg_backend_pid() as backend_pid,
        extract(epoch from pg_postmaster_start_time()) as started_at,current_setting('server_version_num')::integer as version from pg_control_system()`);
      row.directory=await fs.realpath(row.directory);verifyFreshConnectionIdentity(row,identity);identity.backendPid??=row.backend_pid;
    };
    await check(reserved);
    await populateFreshClientSchema({connection:reserved,plan:await loadFreshSchemaApplicationPlan(),apiPassword,verifyIdentity:check});
    api=connect('local_state_api',apiPassword);
    const [login]=await api.unsafe('select current_user as login,session_user as session_login');
    assert.equal(login.login,'local_state_api');assert.equal(login.session_login,'local_state_api');
    await assert.rejects(api.unsafe('select public.h205f22_a2_browser_device_enrollment_approve_v1(null)'),e=>e.code==='42501');
    await exercise({sql:reserved,edgeSql:api,check:()=>check(reserved),
      // Additional independent owner backend can only target this freshly
      // generated cluster; no caller DSN/user/password/database is accepted.
      withOwnerLane:async exerciseLane=>{
        const pool=connect('state_owner',ownerPassword);let lane;
        try{lane=await pool.reserve();const identity={...expected,backendPid:undefined};await check(lane,identity);
          await exerciseLane({sql:lane,check:()=>check(lane,identity)});await check(lane,identity);
        }finally{try{await lane?.release();}finally{await pool.end({timeout:5});}}
      }});
    await check(reserved);
  }finally{
    try{await api?.end({timeout:5});}finally{
      try{await reserved?.release();}finally{
        try{await owner?.end({timeout:5});}finally{
          if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
          // An unconfirmed stop throws above, preserving the owned cluster.
          await fs.rm(root,{recursive:true,force:true});
        }
      }
    }
  }
}
