// Disposable PG18 WASM + actual Edge source/signature verification + actual SQL
// approval/activation/ADMIN. Supplemental: no Windows consent, DPAPI, PG17 or
// independent transport/session qualification is claimed by this fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {populateFreshClientSchema,enrollFreshLocalDeviceOwner} from './test/fresh-provider-private-loader.mjs';
import {freshOwnerEdgeHarness} from './test/fresh-owner-edge-harness.mjs';
import {loadFreshSchemaApplicationPlan} from './fresh-schema-application-plan.mjs';
import {RPC_ALLOWLIST} from './db-api-core.mjs';
import {withFreshOwnerNativeFixture} from './test/fresh-owner-native-fixture.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
const wasm=process.env.METAENGINE_PGLITE_MODULE,cryptoModule=process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE;
const table='public.compute_fabric_a2_browser_device_enrollment_request_h205f22';
const devices='public.compute_fabric_a2_browser_device_h205f22';

test('first-owner producer uses actual signed Edge and private SQL approval, never synthetic ADMIN',{skip:!wasm||!cryptoModule,timeout:180000},async t=>{
  const {PGlite}=await import(wasm),{pgcrypto}=await import(cryptoModule);
  const db=new PGlite({extensions:{pgcrypto}});
  const sql={unsafe:async(q,args)=>args?.length?(await db.query(q,args)).rows:(await db.exec(q)).at(-1)?.rows||[]};
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'first-owner-fixture-'));
  let edge;
  try {
    await sql.unsafe('CREATE ROLE state_owner SUPERUSER; SET SESSION AUTHORIZATION state_owner');
    const check=async()=>{
      const [row]=await sql.unsafe('select current_user as login,session_user as session_login');
      assert.equal(row.login,'state_owner');assert.equal(row.session_login,'state_owner');
    };
    await populateFreshClientSchema({connection:sql,plan:await loadFreshSchemaApplicationPlan(),apiPassword:randomBytes(32).toString('hex'),verifyIdentity:check});
    edge=await freshOwnerEdgeHarness(sql);
    const profiles=new WeakMap();
    const secureStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
    const freshIdentity=async()=>{
      const statePath=path.join(dir,randomBytes(16).toString('hex')+'.json');
      const identity=new SupervisorDeviceIdentity({statePath,
        secureStorage});
      await identity.ensure();profiles.set(identity,statePath);return identity;
    };
    const reset=async()=>sql.unsafe(`TRUNCATE ${table},${devices},public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 CASCADE`);
    const options=identity=>({connection:sql,deviceIdentity:identity,baseUrl:edge.base,verifyIdentity:check,
      verifyRuntime:async()=>{},record:async()=>{},fetchImpl:edge.fetch});
    await t.test('real protected-profile signer to PENDING → exact private approve → CLAIMED → signed ADMIN',async()=>{
      const identity=await freshIdentity(),original=identity.snapshot(),stages=[];
      const receipt=await enrollFreshLocalDeviceOwner({...options(identity),record:async(stage,binding)=>stages.push({stage,binding:structuredClone(binding)})});
      assert.equal(receipt.device_enrolled,true);assert.equal(receipt.admin_ready,true);
      assert.equal(receipt.guardian_ready,false);assert.equal(receipt.runtime_ready,false);
      assert.equal(receipt.client_id,original.client_id);assert.equal(receipt.key_fingerprint_sha256,original.key_fingerprint_sha256);
      assert.equal(identity.snapshot().device_id,receipt.device_id);
      const [row]=await sql.unsafe(`select status,device_id,public_jwk from ${table}`);
      assert.equal(row.status,'CLAIMED');assert.equal(row.device_id,receipt.device_id);assert.deepEqual(row.public_jwk,original.public_jwk);
      assert.deepEqual(stages.map(s=>s.stage),['DEVICE_REQUEST_OUTCOME_PENDING','DEVICE_APPROVAL_OUTCOME_PENDING','DEVICE_ACTIVATION_OUTCOME_PENDING','DEVICE_ADMIN_SIGNED_READBACK_PENDING','DEVICE_ADMIN_VERIFIED']);
      assert.equal(edge.calls.length,3);
      const signedAdmin=edge.calls.at(-1);assert(signedAdmin.headers['x-a2-device-signature']);
      // Actual server nonce replay is still refused; readback is not a bypass.
      const replay=await edge.fetch(signedAdmin.url,{...signedAdmin,redirect:'error'});assert.equal(replay.status,401);
      // Actual Edge rejects request made with a tampered body under the real signature.
      const request=edge.calls[0];const invalid=await edge.fetch(request.url,{...request,body:request.body+' ',redirect:'error'});
      assert.equal(invalid.status,401);assert.equal((await invalid.json()).reason,'INVALID_SIGNATURE');
      assert(!RPC_ALLOWLIST.includes('h205f22_a2_browser_device_enrollment_approve_v1'));
      const statePath=profiles.get(identity),stored=await fs.readFile(statePath);
      // Separate module/class instance models main's later reload; key/client/
      // device bindings remain byte-identical, no second bootstrap identity.
      const {SupervisorDeviceIdentity:MainIdentity}=await import('../../apps/metaengine-browser/src/supervisor-device-identity.mjs?main-reload-fixture');
      const mainIdentity=new MainIdentity({statePath,secureStorage}),main=await mainIdentity.ensure();
      assert.equal(main.client_id,receipt.client_id);assert.equal(main.device_id,receipt.device_id);
      assert.equal(main.key_fingerprint_sha256,receipt.key_fingerprint_sha256);assert.deepEqual(await fs.readFile(statePath),stored);
      const adminHeaders=await mainIdentity.deviceHeaders('GET','/a2-browser-native-supervisor-v1/v1/admin/status','');
      assert.equal((await edge.fetch(edge.base+'/v1/admin/status',{method:'GET',headers:adminHeaders,redirect:'error'})).status,200);

    });

    await t.test('another profile cannot autoapprove a second owner in the initialized database',async()=>{
      const identity=await freshIdentity(),calls=edge.calls.length;
      const before=await sql.unsafe(`select request_id,status,device_id from ${table}`);
      await assert.rejects(enrollFreshLocalDeviceOwner(options(identity)),/requires_review/);
      assert.equal(edge.calls.length,calls);assert.equal(identity.snapshot().device_id,null);
      assert.deepEqual(await sql.unsafe(`select request_id,status,device_id from ${table}`),before);
    });
    await t.test('existing bound identity refuses without key/ID clearing or another send',async()=>{
      await reset();const identity=await freshIdentity();await identity.bindEnrollmentRequest('22222222-2222-4222-8222-222222222222');
      const before=identity.snapshot(),calls=edge.calls.length;
      await assert.rejects(enrollFreshLocalDeviceOwner(options(identity)),/existing_device_binding/);
      assert.deepEqual(identity.snapshot(),before);assert.equal(edge.calls.length,calls);
    });
    await t.test('wrong pending fingerprint refuses before private approval',async()=>{
      await reset();const identity=await freshIdentity();
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),fetchImpl:async(url,init)=>{
        const response=await edge.fetch(url,init),body=await response.json();body.key_fingerprint_sha256='b'.repeat(64);
        return new Response(JSON.stringify(body),{status:response.status});
      }}),/requires_review/);
      assert.equal(identity.snapshot().device_id,null);
      assert.equal((await sql.unsafe(`select 1 from ${devices}`)).length,0);
    });

    await t.test('expired response or mismatched exact expiry cannot approve the pending row',async()=>{
      for(const expired of [true,false]) {
        await reset();const identity=await freshIdentity();
        await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),fetchImpl:async(url,init)=>{
          const response=await edge.fetch(url,init),body=await response.json();
          body.expires_at=new Date(expired?Date.now()-1000:Date.parse(body.expires_at)+1000).toISOString();
          return new Response(JSON.stringify(body),{status:response.status});
        }}),/requires_review/);
        assert.equal(identity.snapshot().device_id,null);assert.equal((await sql.unsafe(`select 1 from ${devices}`)).length,0);
      }
    });
    await t.test('full public JWK including extra fields must match before approval',async()=>{
      await reset();const identity=await freshIdentity();
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),fetchImpl:async(url,init)=>{
        const response=await edge.fetch(url,init);
        await sql.unsafe(`update ${table} set public_jwk=public_jwk||'{"alg":"ES256"}'::jsonb`);
        return response;
      }}),/requires_review/);
      assert.equal(identity.snapshot().device_id,null);assert.equal((await sql.unsafe(`select 1 from ${devices}`)).length,0);
    });
    await t.test('a competing signed pending request is not approved or silently selected',async()=>{
      await reset();const identity=await freshIdentity(),competitor=await freshIdentity(),state=competitor.snapshot();
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),fetchImpl:async(url,init)=>{
        const response=await edge.fetch(url,init);
        const body=JSON.stringify({profile:state.profile,public_jwk:state.public_jwk,key_fingerprint_sha256:state.key_fingerprint_sha256});
        assert.equal((await edge.fetch(url,{method:'POST',body,headers:await competitor.enrollmentHeaders(body),redirect:'error'})).status,202);
        return response;
      }}),/requires_review/);
      assert.equal(identity.snapshot().device_id,null);assert.equal(competitor.snapshot().device_id,null);
      assert.equal((await sql.unsafe(`select 1 from ${devices}`)).length,0);
    });
    await t.test('runtime/cluster drift before approval leaves no ADMIN and no activation send',async()=>{
      await reset();const identity=await freshIdentity();let checks=0,requests=0;
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),verifyRuntime:async()=>{if(++checks===3)throw Error('fixture_changed_cluster');},
        fetchImpl:async(...args)=>{requests++;return edge.fetch(...args);}}),/requires_review/);
      assert.equal(requests,1);assert.equal(identity.snapshot().device_id,null);
      assert.equal((await sql.unsafe(`select 1 from ${devices}`)).length,0);
    });
    await t.test('ambiguous approval COMMIT never retries or sends activation',async()=>{
      await reset();const identity=await freshIdentity();let commits=0,requests=0;
      const connection={unsafe:async(q,args)=>{const value=await sql.unsafe(q,args);if(q==='COMMIT'){commits++;throw Error('fixture_lost_commit_ack');}return value;}};
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),connection,
        fetchImpl:async(...args)=>{requests++;return edge.fetch(...args);}}),/device_approval_outcome_unknown/);
      assert.equal(commits,1);assert.equal(requests,1);assert.equal(identity.snapshot().device_id,null);
      const [row]=await sql.unsafe(`select status,request_id from ${table}`);assert.equal(row.status,'APPROVED');
      assert.equal(identity.snapshot().enrollment_request_id,row.request_id);
      await assert.rejects(enrollFreshLocalDeviceOwner(options(identity)),/existing_device_binding/);
    });
    await t.test('activation response loss retains exact binding and never repeats the request',async()=>{
      await reset();const identity=await freshIdentity();let calls=0;
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),fetchImpl:async(...args)=>{
        const response=await edge.fetch(...args);if(++calls===2)throw Error('fixture_lost_activation_ack');return response;
      }}),/lost_activation_ack/);
      assert.equal(calls,2);assert.equal(identity.snapshot().device_id,null);assert(identity.snapshot().enrollment_request_id);
      const [row]=await sql.unsafe(`select status,device_id from ${table}`);assert.equal(row.status,'CLAIMED');assert(row.device_id);
      await assert.rejects(enrollFreshLocalDeviceOwner(options(identity)),/existing_device_binding/);
    });
    await t.test('wrong signed ADMIN receipt cannot become readiness',async()=>{
      await reset();const identity=await freshIdentity();let calls=0;
      await assert.rejects(enrollFreshLocalDeviceOwner({...options(identity),fetchImpl:async(url,init)=>{
        const response=await edge.fetch(url,init);calls++;if(!url.endsWith('/v1/admin/status'))return response;
        const body=await response.json();body.device_id='33333333-3333-4333-8333-333333333333';return new Response(JSON.stringify(body),{status:200});
      }}),/device_signed_admin_unconfirmed/);
      assert.equal(calls,3);assert(identity.snapshot().device_id);
      await assert.rejects(enrollFreshLocalDeviceOwner(options(identity)),/existing_device_binding/);
    });
  }finally{edge?.close();await db.close();await fs.rm(dir,{recursive:true,force:true});}
});


test('factory-owned native PG17 enrolls via independent restricted API login and real Edge signatures',{
 skip:!process.env.METAENGINE_PG_TEST_BIN||!process.env.METAENGINE_PG_TEST_DRIVER,timeout:240000,
},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'first-owner-native-identity-'));
 try {await withFreshOwnerNativeFixture({bin:process.env.METAENGINE_PG_TEST_BIN,driver:process.env.METAENGINE_PG_TEST_DRIVER},async({sql,edgeSql,check})=>{
  await t.test('native typed JSON preserves object/array/boolean values rather than a JSON scalar',async()=>{
   const value={kty:'EC',key_ops:['verify'],ext:true};
   const [serialized]=await edgeSql.unsafe('select jsonb_typeof($1::jsonb) as kind',[JSON.stringify(value)]);
   assert.equal(serialized.kind,'string','regression witness: pre-serialized JSON is encoded twice by postgres.js');
   const [typed]=await edgeSql.unsafe('select jsonb_typeof($1::jsonb) as kind,$1::jsonb as value',[edgeSql.json(value)]);
   assert.equal(typed.kind,'object');assert.deepEqual(typed.value,value);
  });
  const edge=await freshOwnerEdgeHarness(sql,{edgeSql});
  try {
   const identity=new SupervisorDeviceIdentity({statePath:path.join(dir,'device.json'),secureStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
   const before=await identity.ensure();
   const receipt=await enrollFreshLocalDeviceOwner({connection:sql,deviceIdentity:identity,baseUrl:edge.base,verifyIdentity:check,
    verifyRuntime:async()=>{},record:async()=>{},fetchImpl:edge.fetch});
   assert.equal(receipt.device_enrolled,true);assert.equal(receipt.admin_ready,true);assert.equal(receipt.guardian_ready,false);assert.equal(receipt.runtime_ready,false);
   assert.equal(receipt.client_id,before.client_id);assert.equal(receipt.key_fingerprint_sha256,before.key_fingerprint_sha256);
   const [row]=await sql.unsafe(`select status,device_id,public_jwk from ${table}`);
   assert.equal(row.status,'CLAIMED');assert.equal(row.device_id,receipt.device_id);assert.deepEqual(row.public_jwk,before.public_jwk);
   assert.equal(edge.calls.length,3);
   const signed=edge.calls.at(-1);assert.equal((await edge.fetch(signed.url,{...signed,redirect:'error'})).status,401);
   await assert.rejects(enrollFreshLocalDeviceOwner({connection:sql,deviceIdentity:identity,baseUrl:edge.base,verifyIdentity:check,
    verifyRuntime:async()=>{},record:async()=>{},fetchImpl:edge.fetch}),/existing_device_binding/);
   // Native-only: the API has its OWN committed transaction, unlike PGlite's
   // supplemental single-session adapter. Owner rollback cannot erase it.
   for(const outcome of ['BEFORE_APPROVAL','COMMIT_ACK_LOST','ACTIVATION_ACK_LOST'])await t.test(`independent native API preserves exact custody on ${outcome}`,async()=>{
    await sql.unsafe(`TRUNCATE ${table},${devices},public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 CASCADE`);
    const next=new SupervisorDeviceIdentity({statePath:path.join(dir,outcome+'.json'),secureStorage:{isEncryptionAvailable:()=>true,
     encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
    const original=await next.ensure();let runtimeChecks=0,sends=0,commits=0;
    const connection={unsafe:async(query,args)=>{
     const result=await sql.unsafe(query,args);
     if(query==='COMMIT'){commits++;if(outcome==='COMMIT_ACK_LOST')throw Error('fixture_lost_native_commit_ack');}
     return result;
    }};
    const fetchImpl=async(...args)=>{
     const response=await edge.fetch(...args);sends++;
     if(outcome==='ACTIVATION_ACK_LOST'&&sends===2)throw Error('fixture_lost_native_activation_ack');
     return response;
    };
    const operation={connection,deviceIdentity:next,baseUrl:edge.base,verifyIdentity:check,
     verifyRuntime:async()=>{if(outcome==='BEFORE_APPROVAL'&&++runtimeChecks===3)throw Error('fixture_native_owner_changed');},
     record:async()=>{},fetchImpl};
    await assert.rejects(enrollFreshLocalDeviceOwner(operation),outcome==='COMMIT_ACK_LOST'?/device_approval_outcome_unknown/
      :outcome==='ACTIVATION_ACK_LOST'?/lost_native_activation_ack/:/requires_review/);
    const [pending]=await sql.unsafe(`select request_id,status,device_id,client_id,key_fingerprint_sha256 from ${table}`);
    assert.equal(pending.status,{BEFORE_APPROVAL:'PENDING',COMMIT_ACK_LOST:'APPROVED',ACTIVATION_ACK_LOST:'CLAIMED'}[outcome]);
    assert.equal(pending.client_id,original.client_id);assert.equal(pending.key_fingerprint_sha256,original.key_fingerprint_sha256);
    assert.equal(next.snapshot().enrollment_request_id,pending.request_id);assert.equal(next.snapshot().device_id,null);
    assert.equal(sends,outcome==='ACTIVATION_ACK_LOST'?2:1);assert.equal(commits,outcome==='BEFORE_APPROVAL'?0:1);
    assert.equal((await sql.unsafe(`select device_id from ${devices}`)).length,outcome==='ACTIVATION_ACK_LOST'?1:0);
    const sent=sends;await assert.rejects(enrollFreshLocalDeviceOwner(operation),/existing_device_binding/);assert.equal(sends,sent);
   });

  }finally{edge.close();}
 });}finally{await fs.rm(dir,{recursive:true,force:true});}
});
