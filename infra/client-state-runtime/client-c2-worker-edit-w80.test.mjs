import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DevelopmentPlane} from '../../apps/metaengine-browser/src/development-plane.mjs';
import {runW80GeneratedFixtureEdit} from './client-c2-worker-edit-w80.mjs';
import fixed from '../../apps/metaengine-browser/src/development-plane-fixed-sandbox-edit.cjs';
const {SCHEMA,BEFORE,AFTER,CLAIM_FIELDS,sha256}=fixed;
const workerPath=fileURLToPath(new URL('../../apps/metaengine-browser/src/development-plane-worker.cjs',import.meta.url));
const SOURCE=`
 const {parentPort,workerData}=require('node:worker_threads');
 process.parentPort={postMessage:data=>parentPort.postMessage(data),on:(event,fn)=>parentPort.on(event,data=>fn({data}))};
 process.env.METAENGINE_REPO_ROOT=workerData.root;
 process.env.METAENGINE_GIT_REPOSITORY='PatrickFrome/Compute';
 require(workerData.workerPath);
`;
function git(cwd,...args){return execFileSync('git',args,{cwd,encoding:'utf8',
  env:{PATH:process.env.PATH,HOME:cwd,USERPROFILE:cwd,GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:'NUL'},timeout:10_000}).trim();}
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'metaengine-w56-own-pg17-'));
 const seed=path.join(root,'seed');
 await mkdir(seed);
 git(seed,'init','-q');
 await writeFile(path.join(seed,'calc.mjs'),BEFORE);
 git(seed,'add','--','calc.mjs');
 git(seed,'-c','user.name=W80 Fixture','-c','user.email=w80@example.invalid','commit','-qm','red');
 const bare=path.join(root,'repo.git');
 git(root,'clone','-q','--bare',seed,bare);
 const work=path.join(root,'unique-git');
 git(root,'--git-dir',bare,'worktree','add','--detach',work,'HEAD');
 git(root,'--git-dir',bare,'worktree','lock',work);
 return {root,work,head:git(work,'rev-parse','HEAD')};
}
const keys=generateKeyPairSync('ed25519');
const publicPem=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const signClaim=c=>({claim:c,signature:sign(null,Buffer.from(JSON.stringify(CLAIM_FIELDS.map(k=>c[k]))),
 keys.privateKey).toString('base64')});
const baseClaim=({work,head},overrides={})=>({
 schema:SCHEMA,task_id:randomUUID(),run_id:randomUUID(),effect_id:randomUUID(),
 workspace_id:randomUUID(),source_sha:head,lease_generation:1,
 owner_generation:1,owner_epoch:1,owner_pid:process.pid,
 owner_birth:'GENERATED_STAGING_NOT_NATIVE_HOST_BIRTH',
 issued_at_ms:Date.now()-500,expires_at_ms:Date.now()+12000,
 worktree_sha256:sha256(work),relative_path:'calc.mjs',
 preimage_sha256:sha256(BEFORE),postimage_sha256:sha256(AFTER),
 ...overrides,
});
function harness(work,{authorized=null,key=publicPem}={}){
 let thread;
 const plane=new DevelopmentPlane({timeout_ms:8000,
   authorizeFixedSandboxSourceEdit:authorized,
   spawnWorker:()=>{
     thread=new Worker(SOURCE,{eval:true,workerData:{root:work,workerPath,
       w80:{trustedSourceEditPublicKey:key}},
       env:{HOME:path.dirname(work),USERPROFILE:path.dirname(work),
         TMP:os.tmpdir(),TEMP:os.tmpdir(),TMPDIR:os.tmpdir(),
         METAENGINE_REPO_ROOT:work,METAENGINE_GIT_REPOSITORY:'PatrickFrome/Compute'}});
     thread.kill=()=>{void thread.terminate();return true;};
     return thread;
   }});
 return plane;
}
async function withPlane(plane,cb){try{await plane.start();return await cb(plane);}
 finally{await plane.stopAndWait(5000).catch(()=>{});}}
test('W80 fixed worker actually edits red to green in generated locked Git; production default denies', {timeout:50000},async()=>{
 const f=await fixture();
 try{
   assert.equal((await readFile(path.join(f.work,'calc.mjs'),'utf8')),BEFORE);
   assert.equal((1-2),-1); // red requirement under generated source
   const claim=baseClaim(f);
   const defaultPlane=harness(f.work);
   await withPlane(defaultPlane,async plane=>{
     await assert.rejects(plane.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:claim.task_id}),
       /owner_capability_absent/);
   });
   assert.equal((await readFile(path.join(f.work,'calc.mjs'),'utf8')),BEFORE);
   const plane=harness(f.work,{authorized:request=>{
     assert.deepEqual(request,{task_id:claim.task_id});
     return signClaim(claim); // generated authenticated STAGING only
   }});
   await withPlane(plane,async plane=>{
     const caps=await plane.request('CAPABILITIES');
     assert.equal(caps.fixed_sandbox_source_edit_default_authorized,false);
     const receipt=await plane.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:claim.task_id});
     assert.equal(receipt.state,'SOURCE_EDIT_APPLIED_STAGING');
     assert.equal(receipt.origin,'SYNTHETIC/STAGING');
     assert.equal(receipt.postimage_sha256,sha256(AFTER));
     assert.equal(receipt.live_completion_verified,false);
     assert.equal(receipt.automatic_retry_allowed,false);
     await assert.rejects(plane.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:claim.task_id}),
       /duplicate_or_ambiguous|stale_preimage/);
     await assert.rejects(plane.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:claim.task_id,
       claim,signature:'forged'}),/untrusted_authorization/);
   });
   assert.equal(await readFile(path.join(f.work,'calc.mjs'),'utf8'),AFTER);
   assert.match(git(f.work,'status','--porcelain'),/^M calc\.mjs$/);
   git(f.work,'add','--','calc.mjs');
   git(f.work,'-c','user.name=W80 Fixture','-c','user.email=w80@example.invalid','commit','-qm','generated green');
   assert.notEqual(git(f.work,'rev-parse','HEAD'),f.head);
   assert.equal(git(f.work,'status','--porcelain'),'');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('W80 signed claim independent negatives: bogus signature, expiry, epoch, SHA, path, preimage and absent key', {timeout:60000},async()=>{
 const f=await fixture();
 try{
  const attempts=[
    {label:'signature',signed:()=>({...signClaim(baseClaim(f)),signature:'AAAA'})},
    {label:'lease',signed:()=>signClaim(baseClaim(f,{expires_at_ms:Date.now()-10,issued_at_ms:Date.now()-1000}))},
    {label:'source',signed:()=>signClaim(baseClaim(f,{source_sha:'a'.repeat(40)}))},
    {label:'root',signed:()=>signClaim(baseClaim(f,{worktree_sha256:'a'.repeat(64)}))},
    {label:'path',signed:()=>signClaim(baseClaim(f,{relative_path:'../secrets.txt'}))},
    {label:'preimage',signed:()=>signClaim(baseClaim(f,{preimage_sha256:'c'.repeat(64)}))},
    {label:'epoch',signed:()=>signClaim(baseClaim(f,{owner_epoch:0}))},
  ];
  for(const {label,signed} of attempts){
    const plane=harness(f.work,{authorized:()=>signed()});
    await withPlane(plane,async x=>{
      await assert.rejects(x.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:randomUUID()}),
       /fixed_sandbox_source_edit_/,'denied '+label);
    });
    assert.equal(await readFile(path.join(f.work,'calc.mjs'),'utf8'),BEFORE);
  }
  const noKey=harness(f.work,{authorized:()=>signClaim(baseClaim(f)),key:null});
  await withPlane(noKey,x=>assert.rejects(x.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:randomUUID()}),/trusted_key_absent/));
  assert.equal(git(f.work,'status','--porcelain'),'');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('W80 rejects reparse/symlink/foreign Git and unrelated user worktree', {timeout:40000},async()=>{
 const f=await fixture();
 try{
  const dest=path.join(f.work,'calc.mjs');
  const backing=path.join(f.root,'backing.mjs');
  await writeFile(backing,BEFORE); await rm(dest);
  let linked=false;
  try {await symlink(backing,dest,'file');linked=true;}catch(error){
   if (!['EPERM','EACCES','ENOTSUP'].includes(error.code)) throw error;
  }
  if(linked){
   const plane=harness(f.work,{authorized:()=>signClaim(baseClaim(f))});
   await withPlane(plane,x=>assert.rejects(x.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:randomUUID()}),
    /file_type_or_size|file_alias/));
   assert.equal(await readFile(backing,'utf8'),BEFORE);
  }
  await rm(dest,{force:true}); await writeFile(dest,BEFORE);
  const foreign=harness(f.root,{authorized:()=>signClaim(baseClaim(f))});
  await withPlane(foreign,x=>assert.rejects(x.request('FIXED_SANDBOX_SOURCE_EDIT',{task_id:randomUUID()}),
   /non_disposable_root/));
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('W80 own-PG bridge executes inside existing worker and binds receipt to same generated task/effect', {timeout:40000},async()=>{
 const f=await fixture();
 try{
   const task_id=randomUUID(),workspace_id=randomUUID(),run_id=randomUUID(),effect_id=randomUUID();
   const r=await runW80GeneratedFixtureEdit({sourceDir:f.work,head:f.head,
     task_id,run_id,workspace_id,effect_id,lease_generation:3,owner_generation:8,owner_epoch:8});
   assert.equal(r.state,'SOURCE_EDIT_APPLIED_STAGING');
   assert.equal(r.task_id,task_id);assert.equal(r.run_id,run_id);
   assert.equal(r.effect_id,effect_id);assert.equal(r.lease_generation,3);
   assert.equal(r.owner_generation,8);assert.equal(r.owner_epoch,8);
   assert.equal(r.postimage_sha256,sha256(AFTER));
   assert.equal(await readFile(path.join(f.work,'calc.mjs'),'utf8'),AFTER);
   assert.equal(r.authority_effect,false);assert.equal(r.live_completion_verified,false);
 } finally {await rm(f.root,{recursive:true,force:true});}
});
