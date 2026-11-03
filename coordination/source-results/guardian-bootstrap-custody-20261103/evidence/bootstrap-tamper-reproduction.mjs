// Inert regression: temporary bytes and a spy only; never starts a process.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const {createBrowserGuardianMachineBootstrapLauncher} = await import(pathToFileURL(process.argv[2]));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bootstrap-binding-negative-'));
try {
  const version='0.7.0-dev.99.1', source='1'.repeat(40), bytes=Buffer.alloc(80*1024,7);
  const name=`METAENGINE-Guardian-Bootstrap-${version}-x64.exe`;
  const dir=path.join(root,'guardian-bootstrap'), exe=path.join(dir,name);
  await fs.mkdir(dir); await fs.writeFile(exe,bytes);
  const binding={schema:'metaengine.browser-guardian.machine-bootstrap-binding.v1',
    source_head:source,package_version:version,slot_id:`${source.slice(0,16)}-${'3'.repeat(16)}`,
    bootstrap_name:name,bootstrap_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    bootstrap_size:bytes.length,guardian_manifest_sha256:'4'.repeat(64),service_sha256:'5'.repeat(64),
    configurator_sha256:'6'.repeat(64),embedded_assets_only:true,explicit_elevated_install_required:true,
    automatic_retry_allowed:false,authority_effect:false};
  let launches=0;
  const launcher=createBrowserGuardianMachineBootstrapLauncher({platform:'win32',isPackaged:true,
    resourcesPath:root,version,identity:{randomNonce:()=> 'a'.repeat(40),
      guardianOwnerChallenge:async()=>({}),guardianUpdateActuatorProof:async()=>({})},
    bindingLoader:()=>binding,trustRootLoader:()=>({build_sha:source}),
    openPath:async()=>{launches++; return 'inert spy refuses every launch';},
    actuatorFactory:()=>({observeOwner:async()=>{
      await fs.writeFile(exe,Buffer.alloc(bytes.length,9));
      throw Object.assign(new Error('missing'),{code:'GUARDIAN_PIPE_NOT_FOUND'});
    }})});
  const result=await launcher.activate();
  console.log(JSON.stringify({launch_callbacks:launches,state:result.state,reason:result.reason,
    installer_processes_started:0,scope:'SYNTHETIC_JS_ONLY_NOT_WINDOWS_CUSTODY'}));
  assert.equal(launches,0,'changed file reached launch callback');
} finally { await fs.rm(root,{recursive:true,force:true}); }
