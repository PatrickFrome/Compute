import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOperatorNativeHostWitnessCodec,
  OPERATOR_NATIVE_HOST_WITNESS_SCHEMA,
  OPERATOR_NATIVE_HOST_SOURCE_SCHEMA,
} from './operator-native-host-witness.mjs';

const T = Date.parse('2026-10-14T10:16:00.000Z');
const at = offset => new Date(T + offset).toISOString();
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const SOURCE = () => ({
  schema: OPERATOR_NATIVE_HOST_SOURCE_SCHEMA, origin: 'NATIVE_IN_PROCESS',
  authority_effect: false, observed_at: at(-100),
  source_sha: SHA, owner_id: 'owner-instance-0003', device_id: 'device-instance-7',
  owner_generation: 3, owner_process_incarnation_id: 'owner-incarnation-3',
});
const OWNER = () => ({
  schema: 'metaengine.host.owner-incarnation.v1', source: 'LOCAL_HOST_OWNER',
  authority_effect: false, source_sha: SHA, observed_at: at(-120),
  owner_id: 'owner-instance-0003', device_id: 'device-instance-7', generation: 3,
  pid: 9001, created_at: at(-60_000), process_incarnation_id: 'owner-incarnation-3',
});
const GUARDIAN = () => ({
  schema: 'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
  authority_effect: false, automatic_retry_allowed: false,
  source_sha: SHA, observed_at: at(-90), state: 'READY', ready: true, stale: false,
  guardian_service_ready: true, owner_binding_proven: true, device_binding_proven: true,
  owner_id: 'owner-instance-0003', device_id: 'device-instance-7', owner_generation: 3,
  owner_pid: 9001, owner_created_at: at(-60_000),
  owner_process_incarnation_id: 'owner-incarnation-3',
  browser_pid: 5001, browser_created_at: at(-30_000),
  browser_process_incarnation_id: 'browser-incarnation-8',
});
const RELEASE = { release_id: 'release-native-host-witness', artifact_sha256: 'd'.repeat(64) };
const HEALTH = () => ({
  schema: 'metaengine.guardian.host-health.v1',
  source: 'GUARDIAN_NATIVE_READBACK', authority_effect: false,
  source_sha: SHA, observed_at: at(-80),
  owner_id: 'owner-instance-0003', device_id: 'device-instance-7', owner_generation: 3,
  child: {pid: 5001, created_at: at(-30_000), process_incarnation_id: 'browser-incarnation-8',
    source_sha: SHA, observed_at: at(-60)},
  release: RELEASE, sequence_fence: {startup: 4, liveness: 4, readiness: 4, progress: 4},
  heartbeats: Object.fromEntries(['startup','liveness','readiness','progress'].map(channel => [channel,{
    sequence: 5, observed_at_ms: T-80, pid:5001, process_incarnation_id:'browser-incarnation-8',
    release_id:RELEASE.release_id, artifact_sha256:RELEASE.artifact_sha256,
  }])),
});
const OS = pid => ({
  source:'OS_PROCESS_INVENTORY', authority_effect:false,
  pid, created_at: pid===9001 ? at(-60_000) : at(-30_000),
  observed_at:at(-50), state:'PRESENT',
});
function codec(overrides={}) {
  const state = {source: SOURCE(), owner: OWNER(), guardian: GUARDIAN(), health: HEALTH()};
  if (overrides.change) overrides.change(state);
  let clock = T;
  return {
    state,
    instance: createOperatorNativeHostWitnessCodec({
      expectedSourceSha: SHA,
      readSource: overrides.readSource ?? (async () => state.source),
      readOwner: overrides.readOwner ?? (async () => state.owner),
      readGuardian: overrides.readGuardian ?? (async () => state.guardian),
      readGuardianHealth: overrides.readGuardianHealth ?? (async () => state.health),
      readOsProcess: overrides.readOsProcess ?? (async pid => OS(pid)),
      now: () => overrides.time ? overrides.time() : clock,
      maxReadMs: overrides.maxReadMs ?? 750,
    }),
    advance(ms) {clock += ms;},
  };
}
async function run(overrides={}) {
  const c=codec(overrides);
  const token=await c.instance.capture();
  return {c,token,result:c.instance.decode(token)};
}
test('exact source/birth/Guardian/release/split-channel witness allows process AVAILABLE only', async()=>{
  const {result,token}=await run();
  assert.equal(result.schema,OPERATOR_NATIVE_HOST_WITNESS_SCHEMA);
  assert.equal(result.state,'AVAILABLE');
  assert.equal(result.source_sha,SHA);
  assert.equal(result.details.owner_pid,9001);
  assert.equal(result.details.browser_pid,5001);
  assert.equal(result.details.product_readiness_proven,false);
  assert.equal(result.authority_effect,false);
  assert.equal(result.automatic_retry_allowed,false);
  assert.deepEqual(JSON.parse(JSON.stringify(token)),{});
});
test('unconnected production sources must remain UNKNOWN', async()=>{
  const c=createOperatorNativeHostWitnessCodec({expectedSourceSha:SHA});
  assert.equal(c.decode(await c.capture()).state,'UNKNOWN');
});
test('claimed verified fields and copied JSON cannot impersonate in-process source token', async()=>{
  const {c,token,result}=await run();
  const forged={...result, verified:true, process_incarnation_id:'forged',state:'READY'};
  assert.equal(c.instance.decode(forged).state,'UNKNOWN');
  assert.equal(c.instance.decode({...token}).state,'UNKNOWN');
  assert.equal(c.instance.decode(JSON.parse(JSON.stringify(token))).state,'UNKNOWN');
  assert.equal(c.instance.decode(Object.freeze({})).state,'UNKNOWN');
});
test('witness token belongs to exactly one codec instance', async()=>{
  const {token}=await run();
  assert.equal(codec().instance.decode(token).state,'UNKNOWN');
});
test('capture supersedes previous token, prohibiting replay', async()=>{
  const c=codec();
  const old=await c.instance.capture();
  const fresh=await c.instance.capture();
  assert.equal(c.instance.decode(old).state,'STALE');
  assert.equal(c.instance.decode(fresh).state,'AVAILABLE');
});
test('expiration and backwards clock prevent positive truth', async()=>{
  const c=codec();
  const token=await c.instance.capture();
  c.advance(10_001);
  assert.equal(c.instance.decode(token).state,'STALE');
  const d=codec();const t=await d.instance.capture();d.advance(-1);
  assert.equal(d.instance.decode(t).state,'STALE');
});
test('missing or fabricated in-process source binding remains UNKNOWN', async()=>{
  assert.equal((await run({readSource:async()=>null})).result.state,'UNKNOWN');
  assert.equal((await run({change:s=>{s.source.origin='HTTP_CLAIM';}})).result.state,'UNKNOWN');
  assert.equal((await run({change:s=>{delete s.source.owner_process_incarnation_id;}})).result.state,'UNKNOWN');
});
test('exact source SHA must match all native and Guardian evidence', async()=>{
  for(const mutate of [
    s=>{s.source.source_sha=OTHER_SHA;},
    s=>{s.owner.source_sha=OTHER_SHA;},
    s=>{s.guardian.source_sha=OTHER_SHA;},
    s=>{s.health.source_sha=OTHER_SHA;},
    s=>{s.health.child.source_sha=OTHER_SHA;},
  ]){
    assert.equal((await run({change:mutate})).result.state,'AMBIGUOUS');
  }
});
test('source SHA pins are strict, no branch name, partial, or uppercase impersonation',()=>{
  for(const value of ['main','',SHA.slice(0,20),'A'.repeat(40)]){
    assert.throws(()=>createOperatorNativeHostWitnessCodec({expectedSourceSha:value}),/exact_source_sha_required/);
  }
});
test('owner incarnation, epoch and device conflicts fail closed', async()=>{
  for(const mutate of [
    s=>{s.source.owner_generation=7;},
    s=>{s.guardian.owner_process_incarnation_id='owner-replaced-5';},
    s=>{s.guardian.device_id='other-device';},
    s=>{s.health.owner_generation=4;},
    s=>{s.guardian.owner_created_at=at(-4_000);},
    s=>{s.guardian.browser_process_incarnation_id='another-child-7';},
  ]) assert.equal((await run({change:mutate})).result.state,'AMBIGUOUS');
});
test('OS PID reuse for Owner or Browser fails even with READY Guardian',async()=>{
  for(const pidToReplace of [9001,5001]){
    const {result}=await run({readOsProcess:async pid=>({...OS(pid),
      created_at:pid===pidToReplace?at(-1_000):OS(pid).created_at})});
    assert.equal(result.state,'AMBIGUOUS');
  }
});
test('PID recycling between independent OS samples is detected',async()=>{
  let count=0;
  const {result}=await run({readOsProcess:async pid=>{
    count++;return {...OS(pid),created_at:count===3?at(-10_000):OS(pid).created_at};
  }});
  assert.equal(result.state,'AMBIGUOUS');
});
test('OS absent/unknown/untrusted inventory does not grant AVAILABLE',async()=>{
  assert.equal((await run({readOsProcess:async pid=>({...OS(pid),state:'ABSENT'})})).result.state,'OFFLINE');
  assert.equal((await run({readOsProcess:async pid=>({...OS(pid),state:'UNKNOWN'})})).result.state,'UNKNOWN');
  assert.equal((await run({readOsProcess:async pid=>({...OS(pid),source:'HTTP_STATUS'})})).result.state,'UNKNOWN');
});
test('Guardian READY alone is insufficient when owner bind or process proof is missing',async()=>{
  assert.equal((await run({change:s=>{s.guardian.owner_binding_proven=false;}})).result.state,'BLOCKED');
  assert.equal((await run({change:s=>{s.health.child.created_at=at(-999);}})).result.state,'AMBIGUOUS');
  assert.equal((await run({change:s=>{delete s.guardian.owner_created_at;}})).result.state,'AMBIGUOUS');
});
test('split heartbeat lacks channel, regresses sequence or changes release: fail closed',async()=>{
  for(const mutate of [
    s=>{delete s.health.heartbeats.readiness;},
    s=>{s.health.heartbeats.progress.sequence=3;},
    s=>{s.health.heartbeats.liveness.artifact_sha256='f'.repeat(64);},
    s=>{s.health.heartbeats.startup.process_incarnation_id='reused-incarnation-5';},
  ]) assert.notEqual((await run({change:mutate})).result.state,'AVAILABLE');
});
test('fresh native status cannot substitute for stale heartbeat or Guardian observation',async()=>{
  assert.equal((await run({change:s=>{s.guardian.observed_at=at(-10_001);}})).result.state,'STALE');
  assert.equal((await run({change:s=>{s.health.heartbeats.readiness.observed_at_ms=T-10_001;}})).result.state,'STALE');
});
test('future process creation and impossible timestamp fail closed',async()=>{
  assert.equal((await run({change:s=>{s.owner.created_at=at(+5_000);s.guardian.owner_created_at=at(+5_000);}})).result.state,'UNVERIFIED');
  assert.notEqual((await run({change:s=>{s.source.observed_at='no-date';}})).result.state,'AVAILABLE');
});
test('source reader errors, absent readback and bounded hanging provider fail UNKNOWN',async()=>{
  assert.equal((await run({readSource:async()=>{throw Error('secret');}})).result.state,'UNKNOWN');
  assert.equal((await run({readOwner:async()=>null})).result.state,'UNKNOWN');
  const c=codec({readSource:async()=>new Promise(()=>{}),maxReadMs:15});
  assert.equal(c.instance.decode(await c.instance.capture()).state,'UNKNOWN');
});
test('secrets and raw owner/child incarnation IDs stay out of the projection',async()=>{
  const {result,token}=await run({change:s=>{
    s.owner.token='SECRET_SHOULD_NEVER_ESCAPE';
    s.guardian.command_line='SECRET_SHOULD_NEVER_ESCAPE';
    s.health.raw_path='SECRET_SHOULD_NEVER_ESCAPE';
    s.source.private_key='SECRET_SHOULD_NEVER_ESCAPE';
  }});
  const output=JSON.stringify({result,token});
  for(const secret of ['SECRET_SHOULD_NEVER_ESCAPE','owner-instance-0003',
    'device-instance-7','owner-incarnation-3','browser-incarnation-8']){
    assert.equal(output.includes(secret),false);
  }
  assert.match(result.details.incarnation_sha256,/^[0-9a-f]{64}$/);
});

test('absent source SHA in any native layer stays UNKNOWN, not a fabricated conflict',async()=>{
  for(const change of [
    s=>{delete s.source.source_sha;},
    s=>{delete s.owner.source_sha;},
    s=>{delete s.guardian.source_sha;},
    s=>{delete s.health.source_sha;},
    s=>{delete s.health.child.source_sha;},
  ]) assert.equal((await run({change})).result.state,'UNKNOWN');
});
test('string-coerced heartbeat numbers do not become trusted native evidence',async()=>{
  assert.equal((await run({change:s=>{s.health.heartbeats.readiness.sequence='5';}})).result.state,'UNKNOWN');
  assert.equal((await run({change:s=>{s.health.heartbeats.liveness.observed_at_ms=String(T-80);}})).result.state,'UNKNOWN');
});
test('OS inventory born after its own observed_at cannot confirm a process',async()=>{
  assert.equal((await run({readOsProcess:async pid=>({
    ...OS(pid),created_at:at(-10),observed_at:at(-50),
  })})).result.state,'UNKNOWN');
});
