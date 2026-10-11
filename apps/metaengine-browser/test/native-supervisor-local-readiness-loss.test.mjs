import assert from 'node:assert/strict';
import test from 'node:test';
import { localStateProviderConnectionReady } from '../src/local-state-provider-policy.mjs';

// Use the existing offline entrypoint boundary before transitive imports.
const previousArgv = process.argv;
let NativeSupervisorClient;
try {
  process.argv = [...previousArgv, '--metaengine-version-probe'];
  ({ NativeSupervisorClient } = await import('../src/native-supervisor-client-base.mjs'));
} finally { process.argv = previousArgv; }

test('a live scheduler does not advertise a stopped local provider as execution ready', async t => {
  const previous={provider:process.env.METAENGINE_STATE_PROVIDER,boot:process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE};
  t.after(()=>{for(const [key,value] of [['METAENGINE_STATE_PROVIDER',previous.provider],['METAENGINE_LOCAL_PROVIDER_BOOT_STATE',previous.boot]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  process.env.METAENGINE_STATE_PROVIDER='LOCAL_POSTGRES';
  process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE='READY';
  const client=new NativeSupervisorClient({
    identity:{ensure:async()=>{throw Error('offline_identity_fixture');},snapshot:()=>({device_id:'fixture-device'})},
    fetchImpl:async()=>{throw Error('unexpected_network');},
    getState:async()=>({tabs:[],fleet:{agents:[]}}),
    executeCommand:async()=>{throw Error('unexpected_effect');},version:'fixture',
  });
  t.after(()=>client.stop());
  await assert.rejects(client.start(),/offline_identity_fixture/);
  assert.equal(client.snapshot().running,true);
  assert.equal(client.connectionStatus().local_runtime_ready,true);
  process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE='BLOCKED';
  const status=client.connectionStatus();
  assert.equal(client.snapshot().running,true);
  assert.equal(status.local_runtime_ready,false);
  assert.equal(status.admin_ready,false);
  assert.equal(status.access_tier,null);
  assert.deepEqual(status.admin_scopes,[]);
  assert.notEqual(status.cloud_control_state,'CONNECTED');
  assert.equal(status.automatic_effect_retry_allowed,false);
});

test('unattested local startup and unknown providers cannot turn scheduler liveness into readiness', () => {
  for(const state of [undefined,'STARTING','BLOCKED','FAILED','STOPPED']) {
    assert.equal(localStateProviderConnectionReady(true,{METAENGINE_STATE_PROVIDER:'LOCAL_POSTGRES',METAENGINE_LOCAL_PROVIDER_BOOT_STATE:state}),false);
  }
  assert.equal(localStateProviderConnectionReady(true,{METAENGINE_STATE_PROVIDER:'OTHER',METAENGINE_LOCAL_PROVIDER_BOOT_STATE:'READY'}),false);
  assert.equal(localStateProviderConnectionReady(false,{METAENGINE_STATE_PROVIDER:'LOCAL_POSTGRES',METAENGINE_LOCAL_PROVIDER_BOOT_STATE:'READY'}),false);
  assert.equal(localStateProviderConnectionReady(true,{}),true);
});
