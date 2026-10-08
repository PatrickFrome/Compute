import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { CONTROL_PLANE_TOPOLOGY, authorizeClientControlPlaneRequest,
  requireLocalOnlySupervisorBase } from '../src/client-control-plane-topology.mjs';
import { resolveSelfHostedSupervisorConfig } from '../supabase/a2-browser-native-supervisor-v1/self-hosted-config.mjs';

const exec=promisify(execFile);
const supervisorUrl=new URL('../src/native-supervisor-endpoints.mjs',import.meta.url).href;

test('GitHub is source/CI/release only; PostgreSQL API and per-device Host Agent own execution',()=>{
  assert.equal(CONTROL_PLANE_TOPOLOGY.github_is_execution_authority,false);
  assert.equal(CONTROL_PLANE_TOPOLOGY.github_is_secret_store,false);
  assert.equal(CONTROL_PLANE_TOPOLOGY.task_and_lease_authority,'LOCAL_POSTGRES_API');
  assert.equal(CONTROL_PLANE_TOPOLOGY.automatic_cloud_fallback,false);
  const ready={localProviderReady:true,deviceBound:true,dbLeaseAttested:true,
    ownerScopeGranted:true,targetIdentityAttested:true};
  for(const source of ['GITHUB','GITHUB_ACTIONS','SUPABASE','MCP_UNPAIRED',undefined])
    assert.equal(authorizeClientControlPlaneRequest({...ready,source,operation:'EXECUTE_DEVICE_EFFECT'}).admitted,false);
  assert.equal(authorizeClientControlPlaneRequest({...ready,source:'LOCAL_POSTGRES_API',operation:'EXECUTE_DEVICE_EFFECT'}).admitted,true);
  for(const omitted of Object.keys(ready))assert.equal(authorizeClientControlPlaneRequest({
    ...ready,[omitted]:false,source:'LOCAL_POSTGRES_API',operation:'EXECUTE_DEVICE_EFFECT'}).admitted,false);
  assert.equal(authorizeClientControlPlaneRequest({source:'LOCAL_POSTGRES_API',operation:'READ_STATUS',localProviderReady:true}).admitted,true);
  assert.equal(authorizeClientControlPlaneRequest({source:'LOCAL_POSTGRES_API',operation:'SUBMIT_GOAL',
    localProviderReady:true,deviceBound:true,ownerScopeGranted:true}).admitted,true);
  assert.equal(authorizeClientControlPlaneRequest({source:'LOCAL_POSTGRES_API',operation:'RUN_SHELL',...ready}).admitted,false);
});

test('local-only API endpoint admits exactly loopback PostgreSQL Supervisor',()=>{
  assert.equal(requireLocalOnlySupervisorBase('http://127.0.0.1:15433/a2-browser-native-supervisor-v1/'),
    'http://127.0.0.1:15433/a2-browser-native-supervisor-v1');
  for(const url of [
    '', 'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v1',
    'http://localhost:15433/a2-browser-native-supervisor-v1',
    'http://0.0.0.0:15433/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:15433/another',
    'http://127.0.0.1:15433/a2-browser-native-supervisor-v1?x=1',
    'http://u:p@127.0.0.1:15433/a2-browser-native-supervisor-v1',
    'file:///C:/PGDATA',
  ])assert.throws(()=>requireLocalOnlySupervisorBase(url),/client_control_local_supervisor_required/);
});

test('installed client refuses legacy cloud even when historical default and fallback remain in source',async()=>{
  const script=[
    'const m=await import('+JSON.stringify(supervisorUrl)+');',
    'const assert=(condition,label)=>{if(!condition)throw new Error(label)};',
    "assert(m.NATIVE_SUPERVISOR_BASE==='http://127.0.0.1:15433/a2-browser-native-supervisor-v1','selected local base');",
    "for(const value of ['', 'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v1', 'http://127.0.0.1:15434/a2-browser-native-supervisor-v1']) {",
    "try {m.setNativeSupervisorBase(value);throw Error('INVALID_SWAP_ACCEPTED')}",
    "catch(error) {if(error.message==='INVALID_SWAP_ACCEPTED')throw error}}",
    "assert(m.nativeSupervisorRuntimeUrl('/v1/state')==='http://127.0.0.1:15433/a2-browser-native-supervisor-v1/v1/state','pinned URL');",
    "assert(m.NATIVE_SUPERVISOR_BASE==='http://127.0.0.1:15433/a2-browser-native-supervisor-v1','unchanged');",
  ].join('\n');
  const env={...process.env,METAENGINE_LOCAL_ONLY_CLIENT:'1',METAENGINE_STATE_PROVIDER:'LOCAL_POSTGRES',
    METAENGINE_SUPERVISOR_BASE_URL:'http://127.0.0.1:15433/a2-browser-native-supervisor-v1',
    METAENGINE_LOCAL_STATE_INSTANCE_ID:'bbc91d2a-44a7-4674-b4b4-5e265ebd2770'};
  delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
  const {stdout}=await exec(process.execPath,['--input-type=module','-e',script],{env,timeout:15000});
  assert.equal(stdout.trim(),'');
});

test('local-only supervisor requires owned PostgreSQL runtime, no hosted default fallback',()=>{
  const local={METAENGINE_LOCAL_ONLY_CLIENT:'1',LOCAL_STATE_RUNTIME:''};
  assert.throws(()=>resolveSelfHostedSupervisorConfig(k=>local[k]),/client_local_postgres_runtime_required/);
  const legacy=resolveSelfHostedSupervisorConfig(()=>undefined);
  assert.equal(legacy.local,false,'legacy tests remain isolated from packaged runtime');
  const ready={
    METAENGINE_LOCAL_ONLY_CLIENT:'1',LOCAL_STATE_RUNTIME:'LOCAL_POSTGRES',
    LOCAL_STATE_DATABASE_URL:'postgres://service:secret@127.0.0.1:15432/metaengine',
    LOCAL_STATE_API_BASE_URL:'http://127.0.0.1:15431/',
    LOCAL_STATE_API_KEY:'a'.repeat(64),
    LOCAL_STATE_INSTANCE_ID:'bbc91d2a-44a7-4674-b4b4-5e265ebd2770',
    LOCAL_STATE_EDGE_PORT:'15433',
  };
  const config=resolveSelfHostedSupervisorConfig(k=>ready[k]);
  assert.equal(config.local,true);
  assert.equal(config.serverOptions.hostname,'127.0.0.1');
});
