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
export async function retireForwardImage({installedRoot,stateDirectory,retiredRoot,expectedTreeSha256},
  {verify=async()=>{},fingerprint=captureInstalledTreeFingerprint,move=fs.rename,env=process.env}={}) {
  assertForwardScope({installedRoot,stateDirectory,retiredRoot},env);
  if(!/^[a-f0-9]{64}$/.test(expectedTreeSha256||''))fail('image_pin_invalid');
  const evidence=path.join(stateDirectory,'image-retirement-attempt.json');
  await fs.lstat(retiredRoot).then(()=>fail('retired_target_exists'),e=>{if(e.code!=='ENOENT')throw e;});
  await verify();
  if((await fingerprint(installedRoot)).tree_sha256!==expectedTreeSha256)fail('image_preimage_changed');
  await writeForwardEvidence(evidence,{schema:'metaengine.operator.forward-image.v1',state:'EFFECT_PENDING',
    nonce:randomUUID(),expected_tree_sha256:expectedTreeSha256,automatic_retry_allowed:false,authority_effect:false});
  await verify();
  try {
    await move(installedRoot,retiredRoot);
    await fs.lstat(installedRoot).then(()=>fail('canonical_image_still_present'),e=>{if(e.code!=='ENOENT')throw e;});
    if((await fingerprint(retiredRoot)).tree_sha256!==expectedTreeSha256)fail('retired_image_changed');
    await verify();
  } catch(cause) {throw new Error('qa_forward_install_image_effect_unknown_requires_readback',{cause});}
  const receipt={schema:'metaengine.operator.forward-image.v1',state:'RETIRED_VERIFIED',
    expected_tree_sha256:expectedTreeSha256,canonical_image_absent:true,predecessor_preserved:true,
    image_copy_created:false,rollback_attempted:false,automatic_retry_allowed:false,authority_effect:false};
  await writeForwardEvidence(path.join(stateDirectory,'image-retirement-completed.json'),receipt);
  return receipt;
}
