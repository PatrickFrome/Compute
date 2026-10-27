// Native PG17, real first-owner/Edge signatures, separate restricted API login.
// Process SID/DACL observations below are SYNTHETIC test inputs, not Windows or
// installed Guardian/native-broker authentication evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {withFreshOwnerNativeFixture} from './test/fresh-owner-native-fixture.mjs';
import {freshOwnerEdgeHarness} from './test/fresh-owner-edge-harness.mjs';
import {enrollFreshLocalDeviceOwner} from './test/fresh-provider-private-loader.mjs';
import {createGuardianConsumeTransaction,verifyGuardianOwnerDatabase} from './test/guardian-owner-consume-private-loader.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const hash=value=>createHash('sha256').update(value).digest('hex');
const ticketTable='public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22';
const deviceTable='public.compute_fabric_a2_browser_device_h205f22';
const binding={host_instance_id:randomUUID(),host_pid:12345,parent_pid:12344,launch_nonce:randomUUID()};
const sid=hash('S-1-5-21-123-456-789-1000');
const secureStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};

test('private Guardian consume: real PG17 current grant, single use, key and synthetic SID binding',
  {skip:!bin||!driver,timeout:180000},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'guardian-owner-native-'));
  try{await withFreshOwnerNativeFixture({bin,driver},async({sql,edgeSql,check,withOwnerLane})=>{
    const edge=await freshOwnerEdgeHarness(sql,{edgeSql});
    try{
      const identity=new SupervisorDeviceIdentity({statePath:path.join(dir,'device.json'),secureStorage});await identity.ensure();
      const enrollment=await enrollFreshLocalDeviceOwner({connection:sql,deviceIdentity:identity,baseUrl:edge.base,
        verifyIdentity:check,verifyRuntime:async()=>{},record:async()=>{},fetchImpl:edge.fetch});
      const [original]=await sql.unsafe(`select * from ${deviceTable} where device_id=$1::uuid`,[enrollment.device_id]);
      const [native]=await sql.unsafe(`select pg_postmaster_start_time()::text as started_at,current_setting('data_directory') as data_directory,
        current_setting('server_version_num')::int as version,inet_server_port() as port,system_identifier::text from pg_control_system()`);
      const pid=Number((await fs.readFile(path.join(native.data_directory,'postmaster.pid'),'utf8')).split('\n')[0]);
      const expected={identity:{...native,pid},systemIdentifier:native.system_identifier,port:native.port,directory:await fs.realpath(native.data_directory)};
      const databasePin=await verifyGuardianOwnerDatabase(sql,expected);
      const custody=async()=>{await check();await verifyGuardianOwnerDatabase(sql,{...expected,prior:databasePin});return {owner_sid_sha256:sid};};
      const create=(options={})=>createGuardianConsumeTransaction({sql,binding,verifyCustody:custody,...options});
      const sign=async(body,signer=identity)=>({body,headers:await signer.deviceHeaders('POST','/private/guardian/owner-ticket/consume',json(body))});
      async function issue(){
        const route='/v1/device/guardian-enrollment/ticket',headers=await identity.deviceHeaders('POST',new URL(edge.base).pathname+route,'{}');
        const response=await edge.fetch(edge.base+route,{method:'POST',headers,body:'{}',redirect:'error'});
        assert.equal(response.status,200);const value=await response.json();assert.equal(value.accepted,true);return value;
      }
      async function request(override={},ticket){
        ticket??=await issue();return sign({schema:'metaengine.private.guardian-owner-consume.v1',request_id:randomUUID(),...binding,
          challenge_sha256:hash(randomBytes(32)),ticket:ticket.ticket,ticket_sha256:ticket.ticket_sha256,
          owner_sid_sha256:sid,key_fingerprint_sha256:enrollment.key_fingerprint_sha256,admin_grant_epoch:Number(original.admin_grant_epoch),...override});
      }
      const consumed=async input=>(await sql.unsafe(`select consumed_at,consumer_owner_sid_sha256 from ${ticketTable} where ticket_sha256=$1`,[input.body.ticket_sha256]))[0];
      await t.test('real action-time PG proof pins backend, cluster, postmaster, directory, both login roles',async()=>{
        assert.deepEqual(await verifyGuardianOwnerDatabase(sql,{...expected,prior:databasePin}),databasePin);
        for(const changed of [
          {...expected,systemIdentifier:'1'.repeat(19)},
          {...expected,port:expected.port+1},
          {...expected,directory:dir},
          {...expected,identity:{...expected.identity,started_at:new Date(0).toISOString()}},
          {...expected,identity:{...expected.identity,pid:pid+1}},
          {...expected,prior:{...databasePin,backend_pid:databasePin.backend_pid+1}},
        ])await assert.rejects(verifyGuardianOwnerDatabase(sql,changed));
        await sql.unsafe('SET ROLE local_state_api');
        try{await assert.rejects(verifyGuardianOwnerDatabase(sql,expected));}finally{await sql.unsafe('RESET ROLE');}
        await sql.unsafe('SET SESSION AUTHORIZATION local_state_api');
        try{await assert.rejects(verifyGuardianOwnerDatabase(sql,expected));}finally{await sql.unsafe('RESET SESSION AUTHORIZATION');}
        await custody();
      });
      await t.test('positive readback is DB-only and replay cannot consume twice',async()=>{
        const service=create(),input=await request(),value=await service.consume(input);
        assert.equal(value.state,'DB_TICKET_CONSUMED');assert.equal(value.device_id,enrollment.device_id);
        assert.equal(value.guardian_ready,false);assert.equal(value.native_bridge_authenticated,false);assert.equal(value.automatic_retry_allowed,false);
        assert.equal((await consumed(input)).consumer_owner_sid_sha256,sid);
        const replay=await service.consume(input);assert.equal(replay.state,'UNKNOWN');
        const freshSignature=await request({}, {ticket:input.body.ticket,ticket_sha256:input.body.ticket_sha256});
        assert.equal((await create().consume(freshSignature)).state,'REJECTED');await service.close();
      });
      for(const [name,update,restore] of [
        ['revoked ADMIN',"admin_revoked_at=now()","admin_revoked_at=null"],
        ['changed epoch',"admin_grant_epoch=admin_grant_epoch+1",`admin_grant_epoch=${original.admin_grant_epoch}`],
        ['inactive device','active=false','active=true'],
        ['missing CONTROL_PLANE','admin_scopes=\'["DEVOS"]\'::jsonb',`admin_scopes='${JSON.stringify(original.admin_scopes)}'::jsonb`],
      ])await t.test(name+' is denied under current locked grant',async()=>{
        const input=await request();await sql.unsafe(`update ${deviceTable} set ${update} where device_id=$1::uuid`,[enrollment.device_id]);
        try{assert.equal((await create().consume(input)).state,'REJECTED');assert.equal((await consumed(input)).consumed_at,null);}
        finally{await sql.unsafe(`update ${deviceTable} set ${restore} where device_id=$1::uuid`,[enrollment.device_id]);}
      });
      for(const [name,override] of [['wrong SID',{owner_sid_sha256:'b'.repeat(64)}],['wrong key',{key_fingerprint_sha256:'b'.repeat(64)}],
        ['wrong epoch',{admin_grant_epoch:Number(original.admin_grant_epoch)+1}]])await t.test(name+' is never consumed',async()=>{
        const input=await request(override);assert.equal((await create().consume(input)).state,'REJECTED');assert.equal((await consumed(input)).consumed_at,null);
      });
      await t.test('another real signing key cannot claim the enrolled device',async()=>{
        const impostor=new SupervisorDeviceIdentity({statePath:path.join(dir,'impostor.json'),secureStorage});await impostor.ensure();await impostor.bindDevice(enrollment.device_id);
        const input=await request(),wrong=await sign(input.body,impostor);
        wrong.headers['x-a2-chat-bridge-client']=enrollment.client_id;
        assert.equal((await create().consume(wrong)).state,'REJECTED');assert.equal((await consumed(input)).consumed_at,null);
      });
      await t.test('wrong client, stale signature and reused signing nonce cannot consume',async()=>{
        const clientInput=await request();clientInput.headers['x-a2-chat-bridge-client']=randomUUID();
        assert.equal((await create().consume(clientInput)).state,'REJECTED');assert.equal((await consumed(clientInput)).consumed_at,null);
        const stale=await request();stale.headers=await identity.deviceHeaders('POST','/private/guardian/owner-ticket/consume',json(stale.body),
          {timestamp:new Date(Date.now()-60000).toISOString()});
        assert.equal((await create().consume(stale)).state,'REJECTED');assert.equal((await consumed(stale)).consumed_at,null);
        const service=create(),first=await request();assert.equal((await service.consume(first)).state,'DB_TICKET_CONSUMED');
        const second=await request();second.headers=await identity.deviceHeaders('POST','/private/guardian/owner-ticket/consume',json(second.body),
          {nonce:first.headers['x-a2-device-nonce']});
        assert.equal((await service.consume(second)).state,'REJECTED');assert.equal((await consumed(second)).consumed_at,null);await service.close();
      });
      await t.test('expired ticket is denied without renewal',async()=>{
        const input=await request();await sql.unsafe(`update ${ticketTable} set issued_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' where ticket_sha256=$1`,[input.body.ticket_sha256]);
        assert.equal((await create().consume(input)).state,'REJECTED');assert.equal((await consumed(input)).consumed_at,null);
      });
      for(const field of ['host_instance_id','launch_nonce','host_pid','parent_pid'])await t.test('wrong '+field+' does not reach SQL',async()=>{
        const input=await request({[field]:field.endsWith('pid')?binding[field]+1:randomUUID()});let queries=0;
        await assert.rejects(create({sql:{unsafe(){queries++;throw Error('unexpected SQL');}}}).consume(input),/request_invalid/);assert.equal(queries,0);
      });
      await t.test('simultaneous requests for same ticket allow exactly one effect',async()=>{
        const service=create(),input=await request(),other=await sign({...input.body,request_id:randomUUID()});
        const values=await Promise.all([service.consume(input),service.consume(other)]);
        assert.deepEqual(values.map(v=>v.state).sort(),['DB_TICKET_CONSUMED','REJECTED']);await service.close();
      });
      await t.test('independent API backend racing locked private consume has exactly one success',async()=>{
        const input=await request();let race;
        const proxy={unsafe:async(q,args)=>{
          const rows=await sql.unsafe(q,args);
          if(q.includes('where ticket_sha256=$1::text for update')){
            // Private owner now holds the exact row lock. The real API login
            // competes through the existing SECURITY DEFINER function.
            race=edgeSql.unsafe('select public.client_v1_guardian_enrollment_ticket_consume_v1($1,$2,$3) as value',
              [input.body.ticket_sha256,input.body.key_fingerprint_sha256,sid]);
            race.catch(()=>{});
          }return rows;
        }};
        const service=create({sql:proxy}),receipt=await service.consume(input),[other]=await race;
        assert.equal(receipt.state,'DB_TICKET_CONSUMED');assert.equal(other.value.accepted,false);
        assert.equal((await consumed(input)).consumer_owner_sid_sha256,sid);await service.close();
      });
      for(const stage of ['before_dispatch','during_sql','commit_ack_lost','after_commit','final_sql_stop'])await t.test(stage+' remains fail-closed with no automatic retry',async()=>{
        const input=await request();let checks=0,commits=0,service;
        const proxy={unsafe:async(q,args)=>{
          const value=await sql.unsafe(q,args);
          if(q==='COMMIT'){commits++;if(stage==='commit_ack_lost')throw Error('lost acknowledgement');}
          if(stage==='during_sql'&&q.includes(' as value')||stage==='final_sql_stop'&&q.includes('and admin_grant_epoch=$4::bigint'))void service.close();
          return value;
        }};
        service=create({sql:proxy,verifyCustody:async()=>{checks++;await custody();if(stage==='after_commit'&&checks===4)throw Error('disconnected');return {owner_sid_sha256:sid};}});
        if(stage==='before_dispatch')await service.close();
        const value=await service.consume(input),committed=['commit_ack_lost','after_commit','final_sql_stop'].includes(stage),unknown=committed||stage==='during_sql';
        assert.equal(value.state,unknown?'UNKNOWN':'REJECTED');assert.equal(value.automatic_retry_allowed,false);
        assert.equal(Boolean((await consumed(input)).consumed_at),committed);assert.equal(commits,committed?1:0);
        assert.equal((await service.consume(input)).state,stage==='before_dispatch'?'REJECTED':'UNKNOWN');await service.close();
      });
      await t.test('independent pairing revocation waits for exact row lock and invalidates post-COMMIT receipt',async()=>withOwnerLane(async({sql:revoker})=>{
        const input=await request(),[api]=await revoker.unsafe('select pg_backend_pid() as pid');let revocation,settled=false;
        const proxy={unsafe:async(q,args)=>{const value=await sql.unsafe(q,args);
          if(q.includes('where token_hash=$1::text for share')){
            revocation=revoker.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',
              [original.enrollment_pairing_token_hash]).then(value=>{settled=true;return value;});revocation.catch(()=>{});
            let blocked=false;
            for(let attempt=0;attempt<100&&!settled;attempt++){
              const [state]=await sql.unsafe('select wait_event_type from pg_stat_activity where pid=$1',[api.pid]);
              if(state?.wait_event_type==='Lock'){blocked=true;break;}
              await new Promise(resolve=>setTimeout(resolve,5));
            }
            assert.equal(blocked,true);assert.equal(settled,false);
          }
          if(q==='COMMIT')await revocation;return value;
        }};
        const service=create({sql:proxy});
        try{assert.equal((await service.consume(input)).state,'UNKNOWN');assert((await consumed(input)).consumed_at);assert.equal(settled,true);}
        finally{await sql.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=true where token_hash=$1',[original.enrollment_pairing_token_hash]);await service.close();}
      }));
      await t.test('revocation immediately after COMMIT returns UNKNOWN, never an admission receipt',async()=>{
        const input=await request(),proxy={unsafe:async(q,args)=>{const value=await sql.unsafe(q,args);
          if(q==='COMMIT')await sql.unsafe(`update ${deviceTable} set admin_revoked_at=now() where device_id=$1::uuid`,[enrollment.device_id]);
          return value;}};
        const service=create({sql:proxy});
        try{assert.equal((await service.consume(input)).state,'UNKNOWN');assert((await consumed(input)).consumed_at);}
        finally{await sql.unsafe(`update ${deviceTable} set admin_revoked_at=null where device_id=$1::uuid`,[enrollment.device_id]);await service.close();}
      });
      await t.test('post-COMMIT JWK replacement cannot reuse the old fingerprint receipt',async()=>{
        const input=await request(),replacement=generateKeyPairSync('ec',{namedCurve:'P-256'}).publicKey.export({format:'jwk'});
        const proxy={unsafe:async(q,args)=>{const value=await sql.unsafe(q,args);
          if(q==='COMMIT')await sql.unsafe(`update ${deviceTable} set public_jwk=$1::jsonb where device_id=$2::uuid`,[sql.json(replacement),enrollment.device_id]);
          return value;}};
        const service=create({sql:proxy});
        try{assert.equal((await service.consume(input)).state,'UNKNOWN');assert((await consumed(input)).consumed_at);}
        finally{await sql.unsafe(`update ${deviceTable} set public_jwk=$1::jsonb where device_id=$2::uuid`,[sql.json(original.public_jwk),enrollment.device_id]);await service.close();}
      });
      await t.test('current reserved owner/backend check drift refuses before consume',async()=>{
        for(const stage of [1,2,3]){
          const input=await request();let checks=0;const service=create({verifyCustody:async()=>{await custody();if(++checks===stage)throw Error('cluster/backend changed');return {owner_sid_sha256:sid};}});
          assert.equal((await service.consume(input)).state,stage===3?'UNKNOWN':'REJECTED');assert.equal((await consumed(input)).consumed_at,null);await service.close();
        }
      });
    }finally{edge.close();}
  });}finally{await fs.rm(dir,{recursive:true,force:true});}
});
