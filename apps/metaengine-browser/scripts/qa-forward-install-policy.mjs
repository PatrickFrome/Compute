// Explicit operator migration; no renderer, agent, or automatic update entry.
// Retire the old registration/image without executing its uninstaller. This is
// forward-only: retain uncertain effects, never restore or retry them blindly.
import fs from 'node:fs/promises';
import path from 'node:path';
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
