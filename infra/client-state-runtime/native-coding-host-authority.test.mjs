import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodingHostAuthority} from './native-coding-host-authority.mjs';
import {admissionFixture} from '../../apps/metaengine-browser/test/fixtures/native-coding-admission-fixture.mjs';
import {nativeCodingCanonicalSha256} from './native-coding-task-context.mjs';

async function fixture({role='state_owner',nativeChange=null}={}) {
  const f=admissionFixture(),calls=[];
  const native={artifact:f.permit.artifact,postgres:f.permit.postgres,worktree:f.permit.worktree,
    host_process:f.provider.payload.host_process,user_sid:f.permit.user_sid,sandbox:f.provider.payload.sandbox};
  if(nativeChange)nativeChange(native);
  const sql={unsafe:async(text,values=[])=>{
    calls.push({text,values});
    if(text.startsWith('select current_user'))return[{current_user:role,session_user:role}];
    if(text.includes('native_coding_admission_context_v1'))return[{context:f.context()}];
    if(text.startsWith('insert into destruktion_meta.native_coding_provider_registration'))return[{envelope_sha256:values[2]}];
    throw Error('unexpected_fixture_query');
  },begin:async(_mode,callback)=>callback({unsafe:async(text,values)=>{
    if(text.startsWith('set local synchronous_commit')){calls.push({text});return[];}
    return sql.unsafe(text,values);
  }})};
  const authority=await createNativeCodingHostAuthority({sql,readNativeScope:async()=>structuredClone(native),
    readNativeWorker:async()=>{throw Error('worker_not_observed');},readProtectedReceipt:async()=>{throw Error('receipt_not_observed');}});
  return {f,calls,sql,authority};
}

test('private authority requires the actual state_owner login and session identity',async()=>{
  await assert.rejects(fixture({role:'service_role'}),/state_owner_required/);
});

test('scope discovery prepares image bytes before the fresh native observation and stays closed during prepare',async()=>{
  const f=admissionFixture(),events=[];
  let hold=false,release;
  const readNativeScope=async()=>{events.push('fresh');return {postgres:f.permit.postgres,user_sid:f.permit.user_sid};};
  readNativeScope.prepare=async()=>{events.push('prepare');if(hold)await new Promise(resolve=>{release=resolve;});};
  const sql={unsafe:async text=>text.startsWith('select current_user')?[{current_user:'state_owner',session_user:'state_owner'}]:[],
    begin:async()=>{throw Error('readonly_only');}};
  const authority=await createNativeCodingHostAuthority({sql,readNativeScope,readNativeWorker:async()=>{},readProtectedReceipt:async()=>{}});
  assert.deepEqual((await authority.READ_SCOPE()).bindings,[]);
  assert.deepEqual(events,['prepare','fresh']);
  hold=true;const pending=authority.READ_SCOPE();await Promise.resolve();
  authority.close();release();
  await assert.rejects(pending,/native_coding_host_closed/);
  assert.deepEqual(events,['prepare','fresh','prepare']);
});

test('valid enrolled signature registers only after independent native scope and a synchronous transaction',async()=>{
  const {f,calls,authority}=await fixture();
  const ack=await authority.REGISTER_PROVIDER({descriptor:f.provider});
  assert.equal(ack.registered,true);assert.equal(ack.envelope_sha256,nativeCodingCanonicalSha256(f.provider));
  const insert=calls.find(row=>row.text.startsWith('insert'));
  assert.equal(nativeCodingCanonicalSha256(JSON.parse(insert.values[1])),insert.values[2]);
  assert.ok(calls.findIndex(row=>row.text==='set local synchronous_commit=on')<calls.indexOf(insert));
});

test('a correctly signed provider cannot override independently observed image or process scope',async()=>{
  for(const nativeChange of [n=>{n.artifact={...n.artifact,installed_asar_sha256:'f'.repeat(64)};},
    n=>{n.host_process={...n.host_process,pid:n.host_process.pid+1};},n=>{n.sandbox={...n.sandbox,evidence_sha256:'f'.repeat(64)};}]) {
    const {f,calls,authority}=await fixture({nativeChange});
    await assert.rejects(authority.REGISTER_PROVIDER({descriptor:f.provider}),error=>error.automatic_retry_allowed===false&&error.effect_outcome==='UNKNOWN');
    assert.equal(calls.some(row=>row.text.startsWith('insert')),false);
  }
});

test('caller checkpoint digests cannot enable completion before an independent verifier is connected',async()=>{
  const {authority,calls}=await fixture();const prior=calls.length;
  await assert.rejects(authority.ADVANCE_EXECUTION({scope:{},transition:{to:'CHECKPOINTED',critic_proof_sha256:'a'.repeat(64),checkpoint_sha256:'b'.repeat(64)}}),/verifier_unbound/);
  assert.equal(calls.length,prior);
});

test('a closed authority cannot open or replay a private registration transaction',async()=>{
  const {authority,f,calls}=await fixture();authority.close();const before=calls.length;
  await assert.rejects(authority.REGISTER_PROVIDER({descriptor:f.provider}),/host_closed/);
  assert.equal(calls.length,before);
});
