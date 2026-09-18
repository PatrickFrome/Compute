import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../supabase/a2-browser-native-supervisor-v1/index.ts'), 'utf8');

test('health liveness remains HTTP 200 while readiness comes only from bounded DB attestation', () => {
  assert.match(source, /projectNativeSupervisorRuntimeCapabilityHealth/);
  assert.match(source, /runtimeCapabilityHealthResponseFields/);
  assert.match(source, /HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS\s*=\s*1500/);
  assert.match(source, /async function boundedRpc\(name:string,args:any,ms:number\)[\s\S]*Promise\.race\([\s\S]*rpc\(name,args\)[\s\S]*setTimeout\([\s\S]*rpc_deadline[\s\S]*clearTimeout\(timer\)/);
  assert.match(source, /name==='devos_runtime_capabilities_v1'\?boundedRpc\(name,args,HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS\)/);
  assert.match(source, /if\(req\.method==='GET'&&path==='\/health'\)return json\(200,await health\(\)\)/);
});

test('health route has no local capability-envelope fallback or scheduler loop', () => {
  assert.doesNotMatch(source, /NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /const sleep=\(ms:number\)=>new Promise\(resolve=>setTimeout\(resolve,ms\)\)/);
  assert.match(source, /if\(!REALTIME_API_KEY\|\|!REALTIME_ACCESS_TOKEN\)\{[\s\S]*postgresWakeHub\.open\(\{clientId:client,timeoutMs:waitMs\}\)/);
  assert.match(source, /if\(joined\?\.ok!==true\)\{[\s\S]*await sleep\(waitMs\);[\s\S]*const fallback=await leaseBatch\(req,body\)/,
    'LISTEN failure must retain bounded idle wait before durable DB polling fallback');
  assert.match(source, /const wake=await subscription\.wake;\s*const afterWake=await leaseBatch\(req,body\)/s,
    'wake transport never replaces durable DB lease authority');
  assert.doesNotMatch(source, /automatic_retry_allowed\s*:\s*true/);
  assert.doesNotMatch(source, /physical_dispatch_allowed\s*:\s*true/);
});
