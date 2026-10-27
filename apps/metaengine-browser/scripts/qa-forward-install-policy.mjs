// Explicit operator migration; no renderer, agent, or automatic update entry.
// Retire the old registration/image without executing its uninstaller. This is
// forward-only: retain uncertain effects, never restore or retry them blindly.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {captureInstalledTreeFingerprint} from './qa-installed-tree-fingerprint.mjs';

export const forwardDigest = b => createHash('sha256').update(b).digest('hex');
const fail = x => {throw new Error('qa_forward_install_'+x);};
const same = (a,b) => path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
export async function writeForwardEvidence(file,value) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
  const h=await fs.open(file,'wx',0o600);
  try {await h.writeFile(bytes);await h.sync();} finally {await h.close();}
  return forwardDigest(bytes);
}
export function assertForwardScope({installedRoot,stateDirectory,retiredRoot},env=process.env) {
  if(!path.isAbsolute(env.LOCALAPPDATA||'')||![installedRoot,stateDirectory,retiredRoot].every(p=>typeof p==='string'&&path.isAbsolute(p)))fail('scope_invalid');
  const parent=path.join(env.LOCALAPPDATA,'METAENGINE');
  if(!same(installedRoot,path.join(env.LOCALAPPDATA,'Programs','METAENGINE Browser Test'))
    ||!same(path.dirname(stateDirectory),parent)
    ||!/^client-state-qa-upgrade-[a-f0-9-]{36}$/.test(path.basename(stateDirectory))
    ||!same(retiredRoot,path.join(stateDirectory,'retired-installation')))fail('scope_invalid');
  return true;
}
const physicalKey = p => process.platform==='win32'?p.toLowerCase():p;
const within = (root,file) => {
  const relative=path.relative(physicalKey(root),physicalKey(file));
  return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));
};
const sameIdentity = (a,b) => a?.dev===b?.dev&&a?.ino===b?.ino;
const sameFile = (a,b) => sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs
  &&a.ctimeNs===b.ctimeNs&&a.birthtimeNs===b.birthtimeNs&&a.nlink===b.nlink;
// Resolve every existing ancestor, not just the leaf: a junction above an
// apparently external PGDATA/Owner can otherwise point into the retired image.
// Missing suffixes are permitted only for effect destinations. Permission,
// lookup, type and identity uncertainty always stops the operation.
async function physicalForwardPath(file,{required,kind,filesystem}) {
  if(typeof file!=='string'||!path.isAbsolute(file))fail('preserved_path_invalid');
  const absolute=path.resolve(file),root=path.parse(absolute).root;
  const parts=path.relative(root,absolute).split(path.sep).filter(Boolean),ancestors=[];
  let current=root,canonical=root;
  for(let i=0;i<=parts.length;i++) {
    if(i)current=path.join(current,parts[i-1]);
    let before;
    try {before=await filesystem.lstat(current,{bigint:true});}
    catch(cause) {
      if(cause?.code==='ENOENT'&&!required&&i>0)
        return {canonical:path.join(canonical,...parts.slice(i-1)),identity:null,ancestors};
      throw new Error('qa_forward_install_preserved_path_unverified',{cause});
    }
    if(before.isSymbolicLink())fail('preserved_path_reparse_forbidden');
    if(typeof before.dev!=='bigint'||typeof before.ino!=='bigint'||before.ino<=0n)fail('preserved_path_identity_unknown');
    const directory=i<parts.length||kind==='directory';
    if(directory?!before.isDirectory():!before.isFile())fail('preserved_path_type_invalid');
    if(!directory&&before.nlink!==1n)fail('preserved_path_hardlink_forbidden');
    try {
      canonical=await filesystem.realpath(current);
      if(typeof canonical!=='string'||!path.isAbsolute(canonical))fail('preserved_path_alias_unverified');
      const resolved=await filesystem.lstat(canonical,{bigint:true});
      const after=await filesystem.lstat(current,{bigint:true});
      if(resolved.isSymbolicLink()||after.isSymbolicLink()
        ||!sameIdentity(before,resolved)||!sameIdentity(before,after)
        ||(directory?(!resolved.isDirectory()||!after.isDirectory()):(!resolved.isFile()||!after.isFile()))
        ||(!directory&&(resolved.nlink!==1n||after.nlink!==1n)))fail('preserved_path_alias_unverified');
    }catch(cause) {
      throw new Error('qa_forward_install_preserved_path_unverified',{cause});
    }
    ancestors.push({dev:before.dev,ino:before.ino});
  }
  return {canonical,identity:ancestors.at(-1),ancestors};
}
const overlaps = (a,b) => within(a.canonical,b.canonical)||within(b.canonical,a.canonical)
  ||(a.identity&&b.ancestors.some(x=>sameIdentity(a.identity,x)))
  ||(b.identity&&a.ancestors.some(x=>sameIdentity(b.identity,x)));
export async function assertForwardPreservedPaths(scope,{env=process.env,filesystem=fs}={}) {
  assertForwardScope(scope,env);
  const targets={};
  for(const name of ['installedRoot','stateDirectory','retiredRoot'])
    targets[name]=await physicalForwardPath(scope[name],{required:false,kind:'directory',filesystem});
  if(overlaps(targets.installedRoot,targets.stateDirectory)
    ||physicalKey(targets.retiredRoot.canonical)!==physicalKey(path.join(targets.stateDirectory.canonical,'retired-installation')))
    fail('physical_scope_overlap');
  for(const [name,kind] of [['keeperExecutable','file'],['pgDataDirectory','directory'],
    ['ownerFile','file'],['configFile','file'],['statusFile','file'],['predecessorStateDirectory','directory'],
    ['candidateRoot','directory'],['installerFile','file']]) {
    const preserved=await physicalForwardPath(scope[name],{required:true,kind,filesystem});
    if(Object.values(targets).some(target=>overlaps(preserved,target)))fail('preserved_path_overlap_'+name);
  }
  return true;
}
// Re-read the actual bytes at effect boundaries, not only the input plan or
// pathname. The tree verifier rejects linked children and unstable file reads.
export async function assertForwardArtifactsUnchanged({candidateRoot,installerFile,expectedTreeSha256,expectedInstallerSha256}) {
  if(![expectedTreeSha256,expectedInstallerSha256].every(x=>/^[a-f0-9]{64}$/.test(x||'')))fail('artifact_pin_invalid');
  await physicalForwardPath(candidateRoot,{required:true,kind:'directory',filesystem:fs});
  await physicalForwardPath(installerFile,{required:true,kind:'file',filesystem:fs});
  const before=await fs.lstat(installerFile,{bigint:true}),hash=createHash('sha256');
  for await(const chunk of createReadStream(installerFile))hash.update(chunk);
  const after=await fs.lstat(installerFile,{bigint:true});
  if(!sameFile(before,after)||!after.isFile()||after.isSymbolicLink()||after.nlink!==1n
    ||hash.digest('hex')!==expectedInstallerSha256)fail('installer_changed');
  if((await captureInstalledTreeFingerprint(candidateRoot)).tree_sha256!==expectedTreeSha256)fail('candidate_changed');
  return true;
}
async function absentForward(file,filesystem=fs) {
  try {await filesystem.lstat(file);}catch(error){if(error?.code==='ENOENT')return;throw error;}
  fail('existing_attempt_requires_readback');
}
export async function assertForwardInstallNotAttempted(stateDirectory) {
  for(const name of ['image-retirement','registration-retirement','installer','owner-publication'])
    await absentForward(path.join(stateDirectory,name+'-attempt.json'));
}
// An exclusive durable intent is consumed once, including across process
// restarts. A missing acknowledgement never authorizes repeating the callback.
// HOLD describes only what this process observed; it does not invent an exit.
export async function runForwardEffect({stateDirectory,effect,identity},
  {verifyBefore=async()=>{},invoke,verifyAfter=async()=>{},write=writeForwardEvidence}={}) {
  if(!['installer','owner-publication'].includes(effect)||!path.isAbsolute(stateDirectory||'')
    ||typeof invoke!=='function')fail('effect_arguments_invalid');
  await physicalForwardPath(stateDirectory,{required:true,kind:'directory',filesystem:fs});
  const file=suffix=>path.join(stateDirectory,effect+'-'+suffix+'.json');
  await absentForward(file('attempt'));await absentForward(file('completed'));await absentForward(file('hold'));
  await verifyBefore();
  await write(file('attempt'),{...identity,schema:'metaengine.operator.forward-effect.v1',effect,
    state:'EFFECT_PENDING',automatic_retry_allowed:false,authority_effect:false});
  let invocationStarted=false;
  try {
    await verifyBefore();
    invocationStarted=true;
    const result=await invoke();
    await verifyAfter(result);
    await write(file('completed'),result);
    return result;
  }catch(cause){
    const hold={schema:'metaengine.operator.forward-effect.v1',effect,state:'HOLD',
      invocation_started:invocationStarted,effect_outcome:invocationStarted?'UNKNOWN':'NOT_INVOKED',
      completion_verified:false,automatic_retry_allowed:false,authority_effect:false};
    try{await write(file('hold'),hold);}
    catch(recordError){throw new AggregateError([cause,recordError],'qa_forward_install_'+effect+'_hold_not_recorded');}
    throw new Error('qa_forward_install_'+effect+'_hold_requires_readback',{cause});
  }
}
async function readForwardDescriptor(file,filesystem=fs) {
  await physicalForwardPath(file,{required:true,kind:'file',filesystem});
  const before=await filesystem.lstat(file,{bigint:true});
  if(before.size<1n||before.size>65536n)fail('descriptor_size_invalid');
  const bytes=await filesystem.readFile(file),after=await filesystem.lstat(file,{bigint:true});
  if(!sameFile(before,after)||BigInt(bytes.length)!==before.size)fail('descriptor_changed');
  return bytes;
}
// Forward-only publication retains the captured descriptor on any ambiguity.
// Unlike generic runtime-upgrade recovery, it never automatically restores an
// old Owner after the old installation has been retired.
export async function publishForwardOwner({stateDirectory,ownerFile,stagedFile,oldBytes,nextBytes},
  {verify=async()=>{},filesystem=fs}={}) {
  if(![stateDirectory,ownerFile,stagedFile].every(x=>typeof x==='string'&&path.isAbsolute(x))
    ||!same(path.dirname(stagedFile),stateDirectory)||!Buffer.isBuffer(oldBytes)||!Buffer.isBuffer(nextBytes)
    ||path.parse(stagedFile).root.toLowerCase()!==path.parse(ownerFile).root.toLowerCase())fail('publication_scope_invalid');
  const custody=path.join(stateDirectory,'owner-publication-custody'),captured=path.join(custody,'preimage.json');
  const verifyBefore=async()=>{
    await absentForward(custody,filesystem);
    if(!(await readForwardDescriptor(ownerFile,filesystem)).equals(oldBytes))fail('owner_preimage_changed');
    if(!(await readForwardDescriptor(stagedFile,filesystem)).equals(nextBytes))fail('owner_stage_changed');
    await verify();
  };
  return runForwardEffect({stateDirectory,effect:'owner-publication',identity:{
    old_owner_sha256:forwardDigest(oldBytes),next_owner_sha256:forwardDigest(nextBytes),custody_file:captured}}, {
    verifyBefore,
    invoke:async()=>{
      await filesystem.mkdir(custody,{mode:0o700});
      await filesystem.rename(ownerFile,captured);
      if(!(await readForwardDescriptor(captured,filesystem)).equals(oldBytes))fail('captured_owner_changed');
      // link is an atomic absent-only publication; a concurrent descriptor is
      // never overwritten. This temporary two-link pair is checked explicitly.
      await filesystem.link(stagedFile,ownerFile);
      const a=await filesystem.lstat(stagedFile,{bigint:true}),b=await filesystem.lstat(ownerFile,{bigint:true});
      if(!a.isFile()||a.isSymbolicLink()||!b.isFile()||b.isSymbolicLink()||a.nlink!==2n||b.nlink!==2n
        ||!sameIdentity(a,b)||!(await filesystem.readFile(stagedFile)).equals(nextBytes)
        ||!(await filesystem.readFile(ownerFile)).equals(nextBytes))fail('publication_effect_unknown');
      await filesystem.unlink(stagedFile);
      return {schema:'metaengine.operator.forward-owner-publication.v1',state:'PUBLISHED_VERIFIED',
        owner_sha256:forwardDigest(nextBytes),old_owner_sha256:forwardDigest(oldBytes),
        automatic_rollback_attempted:false,automatic_retry_allowed:false,authority_effect:false};
    },
    verifyAfter:async()=>{
      if(!(await readForwardDescriptor(ownerFile,filesystem)).equals(nextBytes))fail('publication_effect_unknown');
      await verify();
    },
  });
}
// Keep the first publication fence subject to the same physical custody check
// as image retirement. Invalid preserved paths must not leave even a gate.
export async function writeForwardPreservedGate(file,value,scope,options={}) {
  if(typeof scope?.ownerFile!=='string'||!same(file,scope.ownerFile+'.qa-upgrade-gate.json'))fail('gate_scope_invalid');
  await assertForwardPreservedPaths(scope,options);
  const digest=await writeForwardEvidence(file,value);
  await assertForwardPreservedPaths(scope,options);
  return digest;
}
export async function retireForwardImage({installedRoot,stateDirectory,retiredRoot,expectedTreeSha256,preservedPaths},
  {verify=async()=>{},fingerprint=captureInstalledTreeFingerprint,move=fs.rename,env=process.env,filesystem=fs}={}) {
  assertForwardScope({installedRoot,stateDirectory,retiredRoot},env);
  const preserve=()=>assertForwardPreservedPaths({...preservedPaths,installedRoot,stateDirectory,retiredRoot},{env,filesystem});
  await preserve();
  if(!/^[a-f0-9]{64}$/.test(expectedTreeSha256||''))fail('image_pin_invalid');
  const evidence=path.join(stateDirectory,'image-retirement-attempt.json');
  await fs.lstat(retiredRoot).then(()=>fail('retired_target_exists'),e=>{if(e.code!=='ENOENT')throw e;});
  await verify();
  await preserve();
  if((await fingerprint(installedRoot)).tree_sha256!==expectedTreeSha256)fail('image_preimage_changed');
  await preserve();
  await writeForwardEvidence(evidence,{schema:'metaengine.operator.forward-image.v1',state:'EFFECT_PENDING',
    nonce:randomUUID(),expected_tree_sha256:expectedTreeSha256,automatic_retry_allowed:false,authority_effect:false});
  await verify();
  await preserve();
  try {
    await move(installedRoot,retiredRoot);
    await fs.lstat(installedRoot).then(()=>fail('canonical_image_still_present'),e=>{if(e.code!=='ENOENT')throw e;});
    if((await fingerprint(retiredRoot)).tree_sha256!==expectedTreeSha256)fail('retired_image_changed');
    await verify();
    await preserve();
  } catch(cause) {throw new Error('qa_forward_install_image_effect_unknown_requires_readback',{cause});}
  const receipt={schema:'metaengine.operator.forward-image.v1',state:'RETIRED_VERIFIED',
    expected_tree_sha256:expectedTreeSha256,canonical_image_absent:true,predecessor_preserved:true,
    image_copy_created:false,rollback_attempted:false,automatic_retry_allowed:false,authority_effect:false};
  await writeForwardEvidence(path.join(stateDirectory,'image-retirement-completed.json'),receipt);
  return receipt;
}
