import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile);
const runner=fileURLToPath(new URL('./test/fresh-provider-consent-denial-runner.mjs',import.meta.url));
const digest='a'.repeat(64);
async function launch(t,{entry='operator',reason='fresh_provider_native_consent_declined',mode='denial'}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'fresh-consent-propagation-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const appData=path.join(root,'Roaming'),localAppData=path.join(root,'Local'),profile=path.join(appData,'BrowserProfile');
  const resourcesPath=path.join(root,'resources'),bundleDirectory=path.join(resourcesPath,'client-state-runtime');
  for(const directory of [appData,localAppData,profile,bundleDirectory])await fs.mkdir(directory,{recursive:true});
  const packageFile=path.join(root,'package.json');
  await fs.writeFile(packageFile,JSON.stringify({version:'fixture',metaengineClientStateRuntime:{package_version:'fixture',bundle_sha256:digest}}));
  const env=Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','PATH','Path','TEMP','TMP']
    .filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
  const result=await execute(process.execPath,[runner,JSON.stringify({entry,reason,mode,digest,appData,localAppData,profile,resourcesPath,bundleDirectory,packageFile})],
    {env,windowsHide:true,shell:false,timeout:10000,maxBuffer:16384});
  const rows=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(rows.length,1,result.stderr);
  const row=rows[0];assert.equal(row.schema,'metaengine.test.fresh-provider-consent-denial.v1');
  assert.equal(row.setup_root_absent,true);assert.equal(row.owner_absent,true);assert.equal(row.profile_identity_absent,true);
  assert.equal(row.native_consent_qualified,false);assert.equal(row.database_started,false);assert.equal(row.authority_effect,false);
  assert.equal(row.events.some(event=>event.startsWith('unexpected-effect:')),false,JSON.stringify(row));
  return row;
}

for(const entry of ['operator','installed']){
  test(entry+': real production operator preserves exact native decline through no-mutation cleanup',async t=>{
    const row=await launch(t,{entry});
    assert.equal(row.reason,entry==='installed'?'installed_fresh_provider_consent_declined':'fresh_provider_native_consent_declined');
    assert.deepEqual(row.events,entry==='installed'
      ?['installed-bundle-read','app-ready','bundle-read','schema-read','native-consent-boundary']
      :['bundle-read','schema-read','native-consent-boundary']);
  });
  test(entry+': missing, timeout or arbitrary native decision remains requires-review, never denial',async t=>{
    for(const reason of ['fresh_provider_native_consent_not_confirmed','fresh_provider_native_consent_unavailable','private raw native error']){
      const row=await launch(t,{entry,reason});
      assert.equal(row.reason,entry==='installed'?'installed_fresh_provider_setup_requires_review':'fresh_provider_setup_requires_review');
      assert.doesNotMatch(row.reason,/private|declined/);
    }
  });
}

test('the same error text after native identity acquisition is not reclassified as pre-mutation decline',async t=>{
  const row=await launch(t,{mode:'post-consent-identity'});
  assert.equal(row.reason,'fresh_provider_setup_requires_review');
  assert.deepEqual(row.events,['bundle-read','schema-read','native-consent-boundary','identity-object-created','identity-ensure-denied-without-write']);
});

test('decline preservation is fenced on every owned/mutated state and still enters finally cleanup',async()=>{
  const source=await fs.readFile(new URL('./fresh-client-provider.mjs',import.meta.url),'utf8');
  assert.match(source,/if\(error\?\.message==='fresh_provider_native_consent_declined'&&!journal&&!rootIdentity&&!deviceIdentity\s*&&!owned&&!sql&&!api&&!reserved&&!hostAttempted\)throw error;/);
  assert.match(source,/finally\s*\{\s*try \{await cleanupFreshClientResources\(\{api,reserved,sql,owned,hostAttempted\}\);\}\s*finally \{await journal\?\.close\(\);\}/);
});
