import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,createPublicKey} from 'node:crypto';
import {RESERVED_PACKAGE_IDENTITIES_W68} from '../src/client-package-identity-w68.mjs';
import {serializeReleaseManifestW77} from '../scripts/release-proof-producer-w77.mjs';

// Explicit native test executable, never a production capability or installer.
// Compile the adjacent C++ test with a reviewed local OpenSSL development lib.
const binary=process.env.METAENGINE_GUARDIAN_RELEASE_SIGNATURE_TEST_BINARY;
const options={skip:!binary?'native C++ test binary not provided':false,timeout:15000};
const manifest=()=>({schema:'metaengine.browser.installed-release-manifest.v2',source_sha:'a'.repeat(40),
 package_version:'0.7.0-dev.12345.1',exe_name:'METAENGINE Browser Test.exe',exe_sha256:'b'.repeat(64),
 signer_thumbprint:'c'.repeat(40),installer_sha256:'d'.repeat(64),slsa_bundle_sha256:'e'.repeat(64),
 slsa_evidence_sha256:'f'.repeat(64),package_code_sha256:'0'.repeat(64)});
const run=(args,input)=>execFileSync(binary,args,{input,timeout:5000,maxBuffer:8192});

test('native primitive RFC vector and pinned-production-root rejection stay distinct',options,()=>{
 assert.equal(run([]).toString(),'native_release_signature_checks=PASS; production_positive=UNAVAILABLE; loaded_code=NOT_ATTESTED\n');
});
test('native compiled root is exactly existing public Ed25519 SPKI, not a fixture root',options,()=>{
 const root=createPublicKey(readFileSync(new URL('../build/emergency-maintenance-public-key.pem',import.meta.url)));
 assert.equal(root.asymmetricKeyType,'ed25519');const der=root.export({type:'spki',format:'der'});
 assert.deepEqual(run(['--public-spki']),der);
 assert.equal(createHash('sha256').update(der).digest('hex'),'dd1fba3d431890eadb54a411c8af69c9c0145b576fe8a9ee9988c600c132f41f');
});
for(const exe of ['METAENGINE Browser Test.exe','METAENGINE-Browser.exe'])test('native W68 domain/canonical bytes equal actual W77 serializer: '+exe,options,()=>{
 const value={...manifest(),exe_name:exe};const canonical=Buffer.from(JSON.stringify(value));
 assert.deepEqual(run(['--canonical'],canonical),serializeReleaseManifestW77(value));
});
const invalids={
 duplicate:s=>s.replace('{','{"schema":"duplicate",'),
 reordered:()=>{const m=manifest();return JSON.stringify({...{source_sha:m.source_sha},...m});},
 extra:s=>s.slice(0,-1)+',"verified":true}',trailing:s=>s+'\n',concatenated:s=>s+'{}',
 escaped:s=>s.replace('METAENGINE','\\u004dETAENGINE'),nul:s=>s+'\0',oversize:()=>'{'+ 'a'.repeat(2048),
 upperhex:s=>s.replace('a'.repeat(40),'A'.repeat(40)),versionzero:s=>s.replace('12345','0'),
 negative:s=>s.replace('12345','-1'),path:s=>s.replace('METAENGINE Browser Test.exe','C:\\\\foreign.exe'),
 nonstring:s=>s.replace('"'+ 'b'.repeat(64)+'"','true'),missing:s=>s.replace(',"package_code_sha256":"'+'0'.repeat(64)+'"',''),
};
for(const [name,change] of Object.entries(invalids))test('native canonical refuses '+name,options,()=>{
 const result=spawnSync(binary,['--canonical'],{input:change(JSON.stringify(manifest())),timeout:5000,maxBuffer:8192});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,2);
 assert.equal(result.stdout.length,0);
});

for(const package_version of RESERVED_PACKAGE_IDENTITIES_W68)test('native preserves W77 reserved identity refusal: '+package_version,options,()=>{
 const value={...manifest(),package_version};assert.throws(()=>serializeReleaseManifestW77(value),/reserved_or_invalid_version/);
 const result=spawnSync(binary,['--canonical'],{input:JSON.stringify(value),timeout:5000,maxBuffer:8192});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,2);assert.equal(result.stdout.length,0);
});
