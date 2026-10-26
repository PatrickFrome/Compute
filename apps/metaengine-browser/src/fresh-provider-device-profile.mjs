import fs from 'node:fs/promises';
import path from 'node:path';

// Read-only canonical binding of Electron's actual profile to its OS owner root.
export async function validateInstalledFreshIdentityDirectory(userData,appData) {
  const inside=(parent,child)=>{
    const relative=path.relative(parent,child);
    return relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
  };
  if(![userData,appData].every(value=>typeof value==='string'&&path.isAbsolute(value)
    &&! /^(?:\\\\|\/\/)/.test(value)&&!/[\x00-\x1f]/.test(value))) {
    throw Error('installed_fresh_provider_identity_profile_mismatch');
  }
  const physicalCandidate=async target=>{
    let current=path.parse(path.resolve(target)).root;
    const segments=path.relative(current,path.resolve(target)).split(path.sep).filter(Boolean);
    for(let index=0;index<segments.length;index++) {
      const next=path.join(current,segments[index]);let stat;
      try{stat=await fs.lstat(next);}catch(error){
        if(error.code!=='ENOENT')throw error;
        return path.join(await fs.realpath(current),...segments.slice(index));
      }
      if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('installed_fresh_provider_identity_alias_forbidden');
      current=next;
    }
    return fs.realpath(current);
  };
  // Compare PHYSICAL roots, not product-name guesses or lexical Windows 8.3
  // spellings. Nonexistent profile tails remain below the last real directory.
  const physicalParent=await physicalCandidate(appData);
  await fs.realpath(appData); // The OS application-data root must already exist.
  const physicalChild=await physicalCandidate(userData);
  if(!inside(physicalParent,physicalChild))throw Error('installed_fresh_provider_identity_profile_mismatch');
  return userData;
}

