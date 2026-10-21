import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const argv=process.argv;
process.argv=[...argv,'--metaengine-profile-probe'];
const {bootstrapPersistentLocalProvider}=await import('../src/local-state-provider-bootstrap.mjs');
process.argv=argv;

test('pending installer gate prevents Owner reads and network even with a forged READY environment',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-upgrade-gate-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const ownerFile=path.join(root,'owner.json'),gate=ownerFile+'.qa-upgrade-gate.json';
  await fs.writeFile(ownerFile,'not JSON; must not be read');
  for(const directory of [false,true]) {
    if(directory)await fs.mkdir(gate);else await fs.writeFile(gate,'untrusted gate');
    const env={METAENGINE_LOCAL_PROVIDER_BOOT_STATE:'READY',METAENGINE_SUPERVISOR_BASE_URL:'http://127.0.0.1:1/',
      METAENGINE_LOCAL_STATE_INSTANCE_ID:'forged',METAENGINE_FALLBACK_SUPERVISOR_BASE_URL:'https://example.invalid/'};
    let requests=0;
    await assert.rejects(bootstrapPersistentLocalProvider({ownerFile,env,fetchImpl:()=>{requests++;throw Error('network forbidden');}}),/upgrade_install_pending/);
    assert.equal(requests,0);assert.equal(env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE,'BLOCKED');
    assert.equal(env.METAENGINE_SUPERVISOR_BASE_URL,undefined);assert.equal(env.METAENGINE_LOCAL_STATE_INSTANCE_ID,undefined);
    assert.equal(env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL,undefined);
    if(directory)await fs.rmdir(gate);else await fs.unlink(gate);
  }
  const observed=await bootstrapPersistentLocalProvider({ownerFile:path.join(root,'missing-owner'),env:{}});
  assert.equal(observed.state,'NO_OWNER_CONFIG');
});
