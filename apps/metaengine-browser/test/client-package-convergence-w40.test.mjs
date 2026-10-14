import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluatePackageBuildReservation, reservationArtifactName, deriveDistinctCandidatePackageVersion } from '../scripts/package-build-reservation.mjs';

const require = createRequire(import.meta.url);
const { assertWindowsSourceIdentity, assertUnsignedCandidateProvenance } = require('../scripts/client-windows-source-identity.cjs');
const { createBuildIdentityV3, sha256String, canonicalJson } = require('../scripts/build-identity.cjs');
const V='0.7.0-dev.37781000062.1', S='a'.repeat(40), PREV='46d215039ee2b9725827ff9a98b1843e152812bc';
const digest = x => createHash('sha256').update(x).digest('hex');
const node = (name,version,dependencies={}) => ({ name, version, dependencies });
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'me-w40-'));
  const installerPath=join(dir,'METAENGINE-Browser-Test-Setup-'+V+'-x64.exe');
  const data=Buffer.from('MZ-source-only-W40-fixture');
  writeFileSync(installerPath,data);
  const manifest={name:'@metaengine/browser-shell',version:V,dependencies:{'electron-updater':'6.8.9','socket.io-client':'4.8.1'}};
  const lock={name:manifest.name,version:V,lockfileVersion:3,packages:{
    '':{name:manifest.name,version:V,dependencies:{...manifest.dependencies}},
    'node_modules/electron-updater':{version:'6.8.9',dependencies:{'builder-util-runtime':'9.7.0'}},
    'node_modules/builder-util-runtime':{version:'9.7.0',dependencies:{debug:'^4.3.4'}},
    'node_modules/debug':{version:'4.4.3'},
    'node_modules/socket.io-client':{version:'4.8.1'},
  }};
  const tree=node(manifest.name,V,{
    'electron-updater':node('electron-updater','6.8.9',{
      'builder-util-runtime':node('builder-util-runtime','9.7.0',{debug:node('debug','4.4.3')}),
    }),
    'socket.io-client':node('socket.io-client','4.8.1'),
  });
  const input={manifest,installed:undefined,identity:undefined,packageLockBytes:undefined,installerPath,
    expectedInstallerSha256:digest(data),expectedInstallerBytes:data.length,expectedSourceHead:S};
  function seal() {
    const payload={schema:'metaengine.browser.dependency-resolution.v1',
      root_name:manifest.name,root_version:V,node_version:process.version,npm_version:'11.9.0',
      dependency_count:4,tree};
    function count(n){return Object.values(n.dependencies).reduce((k,c)=>k+1+count(c),0);}
    payload.dependency_count=count(tree);
    input.dependency={...payload,dependency_resolution_sha256:sha256String(canonicalJson(payload)),authority_effect:false};
    input.packageLockBytes=Buffer.from(JSON.stringify(lock));
    input.identity=createBuildIdentityV3({
      repository:'PatrickFrome/Compute',repository_id:'1341371143',source_head:S,
      workflow:'browser-windows-package-smoke.yml',run_id:'987654',run_attempt:1,package_version:V,
      platform:'win32',arch:'x64',builder_config_sha256:'b'.repeat(64),
      dependency_resolution_sha256:input.dependency.dependency_resolution_sha256,
      package_lock_sha256:digest(input.packageLockBytes),npm_version:'11.9.0',bun_version:'1.3.3',
      me2_ui_bun_lock_sha256:'d'.repeat(64),electron_builder_version:'26.15.7',node_version:process.version,
    });
  }
  seal();
  return {dir,input,lock,tree,seal,cleanup(){rmSync(dir,{recursive:true,force:true});}};
}
function check(mutator,regex){
  const f=fixture();
  try { mutator(f); assert.throws(()=>assertWindowsSourceIdentity(f.input),regex); }
  finally {f.cleanup();}
}
test('W40 exact-head/lock/installed deep runtime closure produces observational only proof',()=>{
  const f=fixture();
  try {
    const p=assertWindowsSourceIdentity(f.input);
    assert.equal(p.required_runtime_resolutions_verified,4);
    assert.equal(p.package_lock_sha256,digest(f.input.packageLockBytes));
    assert.equal(p.source_head,S);
    assert.equal(p.signed_attestation_verified,false);
    assert.equal(p.installed_runtime_verified,false);
    assert.equal(p.promotion_authorized,false);
    assert.equal(p.authority_effect,false);
  }finally{f.cleanup();}
});
test('W40 cannot claim complete tree when transitive debug absent even with self-rehashed proof',()=>{
  check(f=>{delete f.tree.dependencies['electron-updater'].dependencies['builder-util-runtime'].dependencies.debug; f.seal();},
    /client_package_w40_runtime_transitive_dependency_missing/);
});
test('W40 orphaned resolution under a different parent cannot substitute a missing runtime edge',()=>{
  check(f=>{
    const grandchild=f.tree.dependencies['electron-updater'].dependencies['builder-util-runtime'].dependencies.debug;
    delete f.tree.dependencies['electron-updater'].dependencies['builder-util-runtime'].dependencies.debug;
    f.tree.dependencies.debug=grandchild;
    f.seal();
  },/client_package_w40_runtime_transitive_dependency_missing/);
});
test('W40 lockfile missing required transitive leaf fails even with self-rehashed lock and identity',()=>{
  check(f=>{delete f.lock.packages['node_modules/debug'];f.seal();},/client_package_w40_transitive_lock_missing/);
});
test('W40 changed transitive version under rehashed lock and identity fails installed resolution match',()=>{
  check(f=>{f.lock.packages['node_modules/debug'].version='4.4.1';f.seal();},/client_package_w40_runtime_transitive_dependency_missing/);
});
test('W40 manifest and root lock runtime dependency drift fail closed',()=>{
  check(f=>{f.lock.packages[''].dependencies['socket.io-client']='4.8.0';f.seal();},/client_package_w40_lock_manifest_dependency_drift/);
});
test('W40 source SHA drift is not accepted even if candidate recomputes a valid Build Identity digest',()=>{
  check(f=>{f.input.identity=createBuildIdentityV3({...f.input.identity,source_head:'c'.repeat(40)});},
    /client_package_w40_source_head_drift/);
});
test('W40 missing independent exact-head expectation cannot be substituted by identity self-claim',()=>{
  check(f=>{delete f.input.expectedSourceHead;},/client_package_w40_expected_source_missing/);
});
test('W40 lockfile byte drift rejects stale package even if parse result is unchanged',()=>{
  check(f=>{f.input.packageLockBytes=Buffer.concat([f.input.packageLockBytes,Buffer.from(' ')]);},
    /client_package_w40_lock_digest_drift/);
});
test('W40 arbitrary second EXE is also a duplicate installer output',()=>{
  check(f=>{writeFileSync(join(f.dir,'another-setup.EXE'),'MZ-wrong');},
    /client_windows_installer_cardinality_invalid/);
});
test('W40 signed promotion assertion is untrusted independent of matched source/lock bytes',()=>{
  assert.throws(()=>assertUnsignedCandidateProvenance({signed:true,promotion_authorized:false}),
    /client_windows_untrusted_signature_or_promotion_claim/);
  assert.throws(()=>assertUnsignedCandidateProvenance({signed:false,promotion_authorized:true}),
    /client_windows_untrusted_signature_or_promotion_claim/);
  for (const forged of ['signed_attestation_verified','installed_runtime_verified',
    'physical_package_build_allowed','authority_effect']) {
    assert.throws(()=>assertUnsignedCandidateProvenance({signed:false,promotion_authorized:false,[forged]:true}),
      /client_windows_untrusted_signature_or_promotion_claim/);
  }
});
test('W40 required peer resolution absent from installed tree fails closed',()=>{
  check(f=>{f.lock.packages['node_modules/electron-updater'].peerDependencies={peerhelper:'*'};
    f.lock.packages['node_modules/peerhelper']={version:'1.0.0'};f.seal();},
    /client_package_w40_runtime_transitive_dependency_missing/);
});
test('W40 optional peer is not fabricated as mandatory installed runtime',()=>{
  const f=fixture();try {
    f.lock.packages['node_modules/electron-updater'].peerDependencies={optionalpeer:'*'};
    f.lock.packages['node_modules/electron-updater'].peerDependenciesMeta={optionalpeer:{optional:true}};
    f.seal();assert.equal(assertWindowsSourceIdentity(f.input).required_runtime_resolutions_verified,4);
  }finally{f.cleanup();}
});
test('W40 package reservation collisions remain immutable, candidate hash never authorizes packaging',()=>{
  const prior={id:11737587692,name:reservationArtifactName(V),expired:false,workflow_run:{id:38229120450,head_sha:PREV}};
  assert.throws(()=>evaluatePackageBuildReservation({
    repository:'PatrickFrome/Compute',sourceHead:S,packageVersion:V,runId:42,runAttempt:1,
    versionArtifacts:[prior],
  }),e=>e.code==='PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED');
  const candidate=deriveDistinctCandidatePackageVersion({packageVersion:V,sourceHead:S,slot:0});
  assert.notEqual(candidate,V);
  assert.throws(()=>evaluatePackageBuildReservation({
    repository:'PatrickFrome/Compute',sourceHead:S,packageVersion:candidate,runId:42,runAttempt:1,
    versionArtifacts:[{...prior,name:reservationArtifactName(candidate)}],
  }),e=>e.code==='PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED');
});
