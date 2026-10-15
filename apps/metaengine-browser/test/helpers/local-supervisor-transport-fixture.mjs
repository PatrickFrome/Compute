// Transport unit tests use the actual local-provider bootstrap and pinning
// policy with generated files and a health double. This is not installed Owner
// evidence, and no PostgreSQL, Host, listener or hosted service is started.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { localStateProviderOwnerFile } from '../../src/local-state-provider-policy.mjs';

const testPort = Number(process.env.METAENGINE_TEST_LOCAL_SUPERVISOR_PORT || 15433);
assert.ok(Number.isSafeInteger(testPort) && testPort >= 1024 && testPort <= 65535);
export const LOCAL_SUPERVISOR_FIXTURE_BASE = `http://127.0.0.1:${testPort}/a2-browser-native-supervisor-v1`;
export const LOCAL_SUPERVISOR_FIXTURE_INSTANCE = randomUUID();
export const localSupervisorFixtureHealth = () => ({
  ok:true, instance_id:LOCAL_SUPERVISOR_FIXTURE_INSTANCE,
  state_provider:'LOCAL_POSTGRES', hosted_supabase_required:false,
  runtime_ready:true, capability_health:{state:'ATTESTED',authority_effect:false},
});

const root = await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-local-transport-unit-'));
const environmentKeys = ['APPDATA','XDG_CONFIG_HOME','METAENGINE_STATE_PROVIDER',
  'METAENGINE_SUPERVISOR_BASE_URL','METAENGINE_LOCAL_STATE_INSTANCE_ID',
  'METAENGINE_LOCAL_PROVIDER_BOOT_STATE','METAENGINE_LOCAL_PROVIDER_BOOT_REASON',
  'METAENGINE_FALLBACK_SUPERVISOR_BASE_URL'];
const previous = new Map(environmentKeys.map(key=>[key,process.env[key]]));
process.env.APPDATA = root;
process.env.XDG_CONFIG_HOME = root;
for (const key of environmentKeys.slice(2)) delete process.env[key];
const ownerFile = localStateProviderOwnerFile();
const identityFile = path.join(root,'generated-runtime-identity.json');
await fs.mkdir(path.dirname(ownerFile),{recursive:true});
await fs.writeFile(ownerFile,JSON.stringify({
  schema:'metaengine.browser.local-state-provider-config.v1',version:1,
  profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',
  base_url:LOCAL_SUPERVISOR_FIXTURE_BASE,runtime_identity_file:identityFile,
  authority_effect:false,
}),{mode:0o600});
await fs.writeFile(identityFile,JSON.stringify({
  schema:'metaengine.client-state.runtime-status.v1',state:'READY',
  endpoint:LOCAL_SUPERVISOR_FIXTURE_BASE,instance_id:LOCAL_SUPERVISOR_FIXTURE_INSTANCE,
  runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,
  automatic_cloud_fallback:false,capability_health:{state:'ATTESTED',authority_effect:false},
  authority_effect:false,
}),{mode:0o600});
const originalFetch = globalThis.fetch;
let probes = 0;
try {
  globalThis.fetch = async (url,init) => {
    assert.equal(url,LOCAL_SUPERVISOR_FIXTURE_BASE+'/health');
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    probes++;
    return Response.json(localSupervisorFixtureHealth());
  };
  const bootstrap = await import('../../src/local-state-provider-bootstrap.mjs');
  // A test may have imported an offline module first. Revalidation still uses
  // the real zero-input bootstrap; setting READY in env alone never works.
  if (bootstrap.persistentLocalProviderBootstrap.state !== 'READY')
    await bootstrap.revalidatePersistentLocalProviderAfterAttach();
  assert.equal(bootstrap.persistentLocalProviderBootstrap.state,'READY');
  assert.equal(bootstrap.persistentLocalProviderBootstrap.base_url,LOCAL_SUPERVISOR_FIXTURE_BASE);
  assert.ok(probes > 0);
} finally {
  globalThis.fetch = originalFetch;
}
after(async()=>{
  for (const [key,value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root,{recursive:true,force:true});
});
