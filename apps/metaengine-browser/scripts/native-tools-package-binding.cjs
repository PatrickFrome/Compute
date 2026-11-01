'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

// Build dependency provisioning belongs to package creation. End users never
// need npm, Node, Git, an archive extractor or a previous Codex installation.
async function prepareNativeToolsPackage({appRoot,sourceHead,packageVersion},{stage:stageOverride}={}) {
  if(!/^[a-f0-9]{40}$/.test(sourceHead||'')||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(packageVersion||''))throw Error('native_tools_build_identity_invalid');
  const {stageNativeTools,verifyStagedNativeTools,validateNativeToolsSourceLock}=await import(pathToFileURL(path.join(__dirname,'stage-native-tools.mjs')).href);
  const lock=validateNativeToolsSourceLock(JSON.parse(await fs.readFile(path.join(appRoot,'build/native-tools-lock.json'),'utf8')));
  const outputDirectory=path.join(appRoot,'native-dist/native-tools');
  await fs.mkdir(path.dirname(outputDirectory),{recursive:true});
  const stage=stageOverride||stageNativeTools;
  if(typeof stage!=='function')throw Error('native_tools_build_stage_invalid');
  // Never derive an expected digest from the mutable staging manifest itself.
  // Re-extract exact pinned archives into our own disposable directory for each
  // package build, then compare any reusable output to that independent result.
  // The optional composition hook is build-test-only; production passes none.
  const proofRoot=await fs.mkdtemp(path.join(path.dirname(outputDirectory),'.native-tools-proof-'));
  const proofIdentity=await fs.lstat(proofRoot),proofDirectory=path.join(proofRoot,'payload');
  try {
    const archiveDerived=await stage({lock,outputDirectory:proofDirectory});
    const proof=await verifyStagedNativeTools({directory:proofDirectory,expectedManifestSha256:archiveDerived.manifestSha256});
    if(JSON.stringify(proof.manifest.sources)!==JSON.stringify({codex:lock.codex,git:lock.git}))throw Error('native_tools_source_lock_mismatch');
    let existing;
    try{existing=await fs.lstat(outputDirectory);}catch(error){if(error.code!=='ENOENT')throw error;}
    let staged;
    if(existing) {
      // Preserve unknown/partial/forged output for review. Only exact genuine
      // archive-derived bytes are reusable, without trusting their own hashes.
      if(!existing.isDirectory()||existing.isSymbolicLink())throw Error('native_tools_staged_directory_invalid');
      staged=await verifyStagedNativeTools({directory:outputDirectory,expectedManifestSha256:proof.manifestSha256});
    }else {
      await fs.rename(proofDirectory,outputDirectory);
      staged=await verifyStagedNativeTools({directory:outputDirectory,expectedManifestSha256:proof.manifestSha256});
    }
    return Object.freeze({schema:'metaengine.native-tools.package-binding.v1',source_head:sourceHead,package_version:packageVersion,
      manifest_sha256:staged.manifestSha256,file_count:staged.manifest.files.length,authority_effect:false});
  }finally {
    const current=await fs.lstat(proofRoot);
    if(!current.isDirectory()||current.isSymbolicLink()||current.ino!==proofIdentity.ino||current.dev!==proofIdentity.dev)
      throw Error('native_tools_proof_cleanup_refused');
    await fs.rm(proofRoot,{recursive:true});
  }
}
module.exports={prepareNativeToolsPackage};
