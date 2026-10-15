// W80 GENERATED-ONLY bridge into the existing DevelopmentPlane worker.
// It is NOT a Host credential producer, native installed Owner, scheduler or
// production admission route. Never call with a real user Git workspace.
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {realpath,readFile} from 'node:fs/promises';
import {DevelopmentPlane} from '../../apps/metaengine-browser/src/development-plane.mjs';
import fixed from '../../apps/metaengine-browser/src/development-plane-fixed-sandbox-edit.cjs';
const {SCHEMA,BEFORE,AFTER,CLAIM_FIELDS,sha256,verifyDisposableLockedWorktree}=fixed;
const workerPath=fileURLToPath(new URL('../../apps/metaengine-browser/src/development-plane-worker.cjs',import.meta.url));
const SOURCE=`
 const {parentPort,workerData}=require('node:worker_threads');
 process.parentPort={postMessage:data=>parentPort.postMessage(data),on:(event,fn)=>parentPort.on(event,data=>fn({data}))};
 process.env.METAENGINE_REPO_ROOT=workerData.root;
 process.env.METAENGINE_GIT_REPOSITORY='PatrickFrome/Compute';
 require(workerData.workerPath);
`;
export async function runW80GeneratedFixtureEdit({sourceDir,head,task_id,run_id,workspace_id,
  effect_id=randomUUID(),lease_generation=3,owner_generation=8,owner_epoch=8}={}){
  const realDir=await realpath(sourceDir);
  const source=await verifyDisposableLockedWorktree(realDir);
  assert.equal(source.head,head,'exact generated detached source HEAD');
  assert.equal(await readFile(path.join(realDir,'calc.mjs'),'utf8'),BEFORE);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const publicPem=publicKey.export({format:'pem',type:'spki'}).toString();
  const now=Date.now();
  const claim={schema:SCHEMA,task_id,run_id,workspace_id,effect_id,
    source_sha:head,lease_generation,owner_generation,owner_epoch,
    owner_pid:process.pid,owner_birth:'GENERATED_W80_STAGING_NOT_NATIVE_OWNER_BIRTH',
    issued_at_ms:now-50,expires_at_ms:now+14000,
    worktree_sha256:sha256(realDir),relative_path:'calc.mjs',
    preimage_sha256:sha256(BEFORE),postimage_sha256:sha256(AFTER)};
  const authorization={claim,signature:sign(null,Buffer.from(JSON.stringify(
    CLAIM_FIELDS.map(k=>claim[k]))),privateKey).toString('base64')};
  let spawned=null;
  const plane=new DevelopmentPlane({timeout_ms:10_000,
    // This simulated scoped task is TEST ONLY and cannot attest native W30.
    authorizeFixedSandboxSourceEdit:async request=>{
      assert.deepEqual(request,{task_id,effect_id});
      return authorization;
    },
    spawnWorker:()=>{
      spawned=new Worker(SOURCE,{eval:true,workerData:{root:realDir,workerPath,
        w80:{trustedSourceEditPublicKey:publicPem}},
        env:{HOME:path.dirname(realDir),USERPROFILE:path.dirname(realDir),
          TMP:os.tmpdir(),TEMP:os.tmpdir(),TMPDIR:os.tmpdir(),
          METAENGINE_REPO_ROOT:realDir,METAENGINE_GIT_REPOSITORY:'PatrickFrome/Compute'}});
      spawned.kill=()=>{void spawned.terminate();return true;};
      return spawned;
    }});
  try {
    assert.equal((await plane.start()).state,'READY');
    assert.equal((await plane.request('REPO_HEAD_READ')).head,head);
    const receipt=await plane.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id,effect_id});
    assert.equal(receipt.state,'SOURCE_EDIT_APPLIED_STAGING');
    assert.equal(receipt.task_id,task_id);
    assert.equal(receipt.effect_id,effect_id);
    assert.equal(receipt.owner_epoch,owner_epoch);
    assert.equal(receipt.postimage_sha256,sha256(AFTER));
    assert.equal(await readFile(path.join(realDir,'calc.mjs'),'utf8'),AFTER);
    return receipt;
  } finally {
    try {await plane.stopAndWait(5000);}
    catch {if(spawned)await spawned.terminate();}
  }
}
