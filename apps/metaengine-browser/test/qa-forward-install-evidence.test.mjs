// Inert source fixtures test acquisition fences only; no NSIS or PG executes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {zip} from './fixtures/forward-archive-zip.mjs';
import {FORWARD_INPUT_SCHEMA,FORWARD_REPOSITORY,FORWARD_PRODUCER,
  validateForwardInputPins,assertForwardProducerMetadata,assertForwardArtifactMetadata,
  assertForwardQualifierMetadata,assertForwardArtifactCollection,readForwardInputMetadata,
  verifyForwardArtifactImage,verifyForwardInputDirectory,hashForwardInputFile,extractForwardArchive,verifyForwardArchive,
  assertForwardArchiveMember,readForwardOriginalConfig,verifyForwardOriginalConfig,acquireForwardInputs} from '../scripts/qa-forward-install-evidence.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),sha='a'.repeat(64),head='a'.repeat(40);
const oldHead='601532ca50db02aa9089783dde157a93f484adf2';
// Immutable original source config captured from the exact oldHead Contents API.
// This is fixture data, independent of any later consumer-checkout config drift.
const originalConfigLf=Buffer.from("{\n  \"appId\": \"com.metaengine.browser.test\",\n  \"productName\": \"METAENGINE Browser Test\",\n  \"asar\": true,\n  \"electronFuses\": {\n    \"enableEmbeddedAsarIntegrityValidation\": true,\n    \"onlyLoadAppFromAsar\": true\n  },\n  \"asarUnpack\": [\n    \"src/browser-sentinel-worker.cjs\",\n    \"src/browser-sentinel-liveness.cjs\",\n    \"src/browser-sentinel-action-journal.cjs\",\n    \"src/durable-json-file.cjs\",\n    \"src/compute-bridge-worker.cjs\"\n  ],\n  \"directories\": {\n    \"output\": \"dist-test\"\n  },\n  \"compression\": \"store\",\n  \"files\": [\n    \"src/**/*\",\n    \"package.json\",\n    {\n      \"from\": \"../../infra/client-state-runtime\",\n      \"to\": \"infra/client-state-runtime\",\n      \"filter\": [\"offline-runtime-bundle.mjs\"]\n    },\n    {\n      \"from\": \"native-dist/codex-cli/asar\",\n      \"to\": \".\",\n      \"filter\": [\"native-coding-job-runtime.json\"]\n    }\n  ],\n  \"beforePack\": \"./scripts/electron-builder-before-pack.cjs\",\n  \"afterAllArtifactBuild\": \"./scripts/electron-builder-after-all-artifact-build.cjs\",\n  \"extraResources\": [\n    {\n      \"from\": \"src\",\n      \"to\": \"native-coding/agent-mcp\",\n      \"filter\": [\"native-coding-agent-mcp-entry.mjs\", \"native-coding-agent-mcp-broker.mjs\", \"native-coding-agent-mcp-stdio.mjs\"]\n    },\n    {\n      \"from\": \"native-dist/codex-cli/codex-cli-job-runner.ps1\",\n      \"to\": \"native-coding/codex-cli-job-runner.ps1\"\n    },\n    {\n      \"from\": \"client-state-runtime-dist\",\n      \"to\": \"client-state-runtime\",\n      \"filter\": [\"**/*\"]\n    },\n    {\n      \"from\": \"native-dist/guardian\",\n      \"to\": \"guardian-native\",\n      \"filter\": [\n        \"**/*\"\n      ]\n    },\n    {\n      \"from\": \"native-dist/guardian-bootstrap\",\n      \"to\": \"guardian-bootstrap\",\n      \"filter\": [\n        \"**/*\"\n      ]\n    },\n    {\n      \"from\": \"devos-source-snapshot\",\n      \"to\": \"devos-source-snapshot\",\n      \"filter\": [\n        \"**/*\"\n      ]\n    },\n    {\n      \"from\": \"../../coordination/browser-compute\",\n      \"to\": \"a2-compute-browser\",\n      \"filter\": [\n        \"package.json\",\n        \"protocol-v1.json\",\n        \"engine-lock.json\",\n        \"src/**/*\"\n      ]\n    },\n    {\n      \"from\": \"../../coordination/browser-shared\",\n      \"to\": \"browser-shared\",\n      \"filter\": [\n        \"action-contract.mjs\",\n        \"node-registry.mjs\",\n        \"receipt-contract.mjs\",\n        \"semantic-perception-compiler.mjs\"\n      ]\n    },\n    {\n      \"from\": \"me2-daemon-dist\",\n      \"to\": \"me2-daemon\",\n      \"filter\": [\n        \"**/*\"\n      ]\n    },\n    {\n      \"from\": \"me2-ui-dist\",\n      \"to\": \"me2-ui\",\n      \"filter\": [\n        \"**/*\"\n      ]\n    },\n    {\n      \"from\": \"me2-ui-dist/node_modules\",\n      \"to\": \"me2-ui/node_modules\",\n      \"filter\": [\n        \"**/*\"\n      ]\n    }\n  ],\n  \"publish\": [\n    {\n      \"provider\": \"github\",\n      \"owner\": \"PatrickFrome\",\n      \"repo\": \"Compute\",\n      \"releaseType\": \"prerelease\",\n      \"channel\": \"dev\"\n    }\n  ],\n  \"win\": {\n    \"icon\": \"build/icon.ico\",\n    \"target\": [\n      {\n        \"target\": \"nsis\",\n        \"arch\": [\n          \"x64\"\n        ]\n      }\n    ],\n    \"artifactName\": \"METAENGINE-Browser-Test-Setup-${version}-${arch}.${ext}\"\n  },\n  \"nsis\": {\n    \"differentialPackage\": true,\n    \"installerHeader\": \"build/installerHeader.bmp\",\n    \"installerSidebar\": \"build/installerSidebar.bmp\",\n    \"uninstallerSidebar\": \"build/installerSidebar.bmp\",\n    \"oneClick\": false,\n    \"perMachine\": false,\n    \"allowToChangeInstallationDirectory\": false,\n    \"createDesktopShortcut\": true,\n    \"createStartMenuShortcut\": true,\n    \"shortcutName\": \"METAENGINE Browser Test\",\n    \"runAfterFinish\": true,\n    \"deleteAppDataOnUninstall\": false\n  }\n}\n",'utf8');
function pins(){return {schema:FORWARD_INPUT_SCHEMA,
  candidate:{source_head:head,package_version:'0.7.0-dev.180.1',producer_run_id:'200',producer_run_attempt:1,
    installer_artifact:{id:'20',name:'metaengine-browser-windows-candidate-'+head,sha256:sha},
    sidecar_artifact:{id:'21',name:'metaengine-browser-windows-forward-sidecar-'+head,sha256:sha}},
  predecessor:{kind:'IMMUTABLE_INSTALLER_WITH_INDEPENDENT_QUALIFICATION',source_head:oldHead,package_version:'0.7.0-dev.1784381341133.1',
    producer_run_id:'40382079975',producer_run_attempt:1,
    installer_artifact:{id:'12679249312',name:'metaengine-browser-windows-candidate-'+oldHead,sha256:'28126ee94d99c59040b1e2f5f215556d148da3f1933198ced5919323ce0881f4'},
    installer_sha256:'018cc4a4adf515b5cfc2b829b765aa14d171eaf1bf0e72ebd6e822df1f52d0dd',
    code_manifest_sha256:'6ad0cf0b0af0affd77888c6881e83784027ecd4a6be7711a656169822c8214c9',
    qualification:{repository:FORWARD_REPOSITORY,workflow:'.github/workflows/browser-windows-predecessor-qualification.yml',source_head:'c'.repeat(40),run_id:'300',run_attempt:1,
      artifact:{id:'30',name:'metaengine-browser-predecessor-materialization-'+oldHead+'-'+'c'.repeat(40),sha256:sha}}},
  schema_fixture:{schema_source_head:oldHead,exporter_source_head:'d'.repeat(40),source_plan_sha256:sha,upgrade_sources_sha256:sha,archive_sha256:sha,toc_sha256:sha,
    qualification:{repository:FORWARD_REPOSITORY,workflow:'.github/workflows/client-reviewed-empty-schema.yml',source_head:'d'.repeat(40),run_id:'400',run_attempt:1,
      artifact:{id:'40',name:'metaengine-reviewed-empty-schema-'+oldHead+'-'+'d'.repeat(40),sha256:sha}}}};}
function run(origin){return {id:Number(origin.producer_run_id||origin.run_id),repository:{full_name:FORWARD_REPOSITORY},path:origin.workflow||FORWARD_PRODUCER,
  head_sha:origin.source_head,head_branch:'work/preinstall-shared-inputs-20261027',run_attempt:origin.producer_run_attempt||origin.run_attempt,
  run_number:origin.producer_run_id==='40382079975'?3927:50,status:'completed',conclusion:'success',
  event:origin.producer_run_id==='40382079975'?'pull_request':origin.workflow?'workflow_dispatch':'push',
  run_started_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:10:00Z'};}
function artifact(pin,run,bytes=pin.id==='12679249312'?257692297:100){return {id:Number(pin.id),name:pin.name,digest:'sha256:'+pin.sha256,expired:false,size_in_bytes:bytes,
  workflow_run:{id:run.id,head_sha:run.head_sha},created_at:'2026-10-27T00:05:00Z'};}
function metadata(p){const entries=[
  [p.candidate,[p.candidate.installer_artifact,p.candidate.sidecar_artifact]],
  [p.predecessor,[p.predecessor.installer_artifact]],
  [p.predecessor.qualification,[p.predecessor.qualification.artifact]],
  [p.schema_fixture.qualification,[p.schema_fixture.qualification.artifact]]];
  return Object.fromEntries(entries.map(([origin,pins])=>{const r=run(origin);return [String(r.id),{run:r,artifacts:{total_count:pins.length,artifacts:pins.map(pin=>artifact(pin,r))}}];}));}
function mockGithub(t,records,{changeRun,changePage}={}){
  const requests=[],reads=new Map();
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url),match=/\/actions\/runs\/(\d+)(\/artifacts)?$/.exec(u.pathname);requests.push(u.pathname+u.search);
    if(!match||!records[match[1]])return new Response('{}',{status:404});
    const record=records[match[1]];
    if(match[2]){const page=Number(u.searchParams.get('page'));let out={total_count:record.artifacts.total_count,artifacts:record.artifacts.artifacts.slice((page-1)*100,page*100)};
      if(changePage)out=changePage(out,match[1],page);return new Response(JSON.stringify(out));}
    const n=(reads.get(match[1])||0)+1;reads.set(match[1],n);let out=structuredClone(record.run);if(changeRun)out=changeRun(out,n);
    return new Response(JSON.stringify(out));
  });return requests;
}
async function temp(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'forward-evidence-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function json(file,v){await fs.writeFile(file,JSON.stringify(v,null,2)+'\n');}
function configResponse(bytes=originalConfigLf){return {type:'file',name:'electron-builder.test.json',
  path:'apps/metaengine-browser/electron-builder.test.json',encoding:'base64',content:bytes.toString('base64'),size:bytes.length,
  sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};}
async function zipRows(file,rows){
  const built=zip(rows.map(([name,bytes,attributes])=>({name,bytes,...(attributes===undefined?{}:{attributes})})));
  for(let i=0;i<rows.length;i++){
    const raw=Buffer.from(rows[i][0],'utf8'),start=built.offsets[i].central+46;
    assert.deepEqual(built.bytes.subarray(start,start+raw.length),raw,'fixture must retain exact raw ZIP names on every platform');
  }
  await fs.writeFile(file,built.bytes,{flag:'wx'});
}

test('v2 separates original producer, independent qualification and canonical schema origins',()=>{
  const p=pins(),actual=validateForwardInputPins(p,{expectedSourceHead:head});assert.deepEqual(actual,p);
  assert.equal(actual.predecessor.package_version,'0.7.0-dev.1784381341133.1');
  assert.equal(actual.candidate.kind,undefined);assert.equal(actual.predecessor.sidecar_artifact,undefined);
});
test('v1 symmetric fallback and candidate use of the predecessor exception are rejected',()=>{
  for(const change of [p=>p.schema='metaengine.browser.manual-forward-inputs.v1',p=>p.candidate=p.predecessor,
    p=>p.candidate.kind='IMMUTABLE_INSTALLER_WITH_INDEPENDENT_QUALIFICATION',p=>p.candidate.qualification=p.predecessor.qualification,
    p=>delete p.schema_fixture,p=>p.predecessor.sidecar_artifact=p.candidate.sidecar_artifact,
    p=>p.candidate.package_version='0.7.0-dev.1784381341133.1',p=>p.candidate.source_head='main',
    p=>p.candidate.producer_run_id='latest',p=>p.candidate.installer_artifact.id=20]){
    const p=pins();change(p);assert.throws(()=>validateForwardInputPins(p,{expectedSourceHead:head}));
  }
});
test('original .178 pins cannot be rewritten or impersonated by its independent qualifier',()=>{
  for(const change of [p=>p.predecessor.installer_sha256=sha,p=>p.predecessor.code_manifest_sha256=sha,
    p=>p.predecessor.installer_artifact.sha256=sha,p=>p.predecessor.producer_run_attempt=2,
    p=>p.predecessor.qualification.run_id=p.predecessor.producer_run_id,p=>p.predecessor.qualification.source_head=oldHead,
    p=>p.predecessor.qualification.workflow=FORWARD_PRODUCER,p=>p.predecessor.qualification.artifact.id=p.predecessor.installer_artifact.id,
    p=>p.schema_fixture.qualification.run_id=p.candidate.producer_run_id,p=>p.schema_fixture.qualification.artifact.id=p.candidate.installer_artifact.id]){
    const p=pins();change(p);assert.throws(()=>validateForwardInputPins(p,{expectedSourceHead:head}));
  }
});
test('run metadata rejects nonterminal, failed, changed-attempt, wrong-source and other-producer runs',()=>{
  const pin=pins().candidate;assert.equal(assertForwardProducerMetadata(run(pin),pin),true);
  for(const change of [r=>r.status='in_progress',r=>r.conclusion='failure',r=>r.run_attempt=2,r=>r.head_sha=oldHead,
    r=>r.path='.github/workflows/another-producer.yml',r=>r.repository.full_name='other/repo']){
    const r=run(pin);change(r);assert.throws(()=>assertForwardProducerMetadata(r,pin),/producer_not_exact_terminal_success/);
  }
  const q=pins().predecessor.qualification;assert.equal(assertForwardQualifierMetadata(run(q),q),true);
  for(const change of [r=>r.status='queued',r=>r.conclusion='cancelled',r=>r.run_attempt++,r=>r.path=FORWARD_PRODUCER]){
    const r=run(q);change(r);assert.throws(()=>assertForwardQualifierMetadata(r,q),/qualifier_not_exact_terminal_success/);
  }
});
test('artifact metadata binds run attempt window, exact ID, archive digest and source',()=>{
  const p=pins().candidate,r=run(p),a=artifact(p.sidecar_artifact,r);assert.equal(assertForwardArtifactMetadata(a,p.sidecar_artifact,r),true);
  for(const change of [a=>a.workflow_run.id++,a=>a.workflow_run.head_sha=oldHead,a=>a.digest='sha256:'+'b'.repeat(64),
    a=>a.created_at='2026-10-26T00:00:00Z',a=>a.created_at='2026-10-28T00:00:00Z',a=>a.expired=true,a=>a.id++,a=>a.size_in_bytes=0]){
    const v=structuredClone(a);change(v);assert.throws(()=>assertForwardArtifactMetadata(v,p.sidecar_artifact,r),/artifact_binding_mismatch/);
  }
});
test('complete artifact catalogs reject filtered pages and duplicate names or IDs',()=>{
  const p=pins(),m=metadata(p)['200'];
  for(const change of [c=>c.total_count++,c=>c.artifacts.push({...c.artifacts[0],id:999}),c=>c.artifacts.push({...c.artifacts[0],name:'other'}),
    c=>c.artifacts[1].name='missing']){
    const c=structuredClone(m.artifacts);change(c);if(c.artifacts.length!==2)c.total_count=c.artifacts.length;
    assert.throws(()=>assertForwardArtifactCollection(c,[p.candidate.installer_artifact,p.candidate.sidecar_artifact],m.run),/artifact_collection_/);
  }
});
test('live acquisition pages the full catalog for all four origins and rechecks run attempts',async t=>{
  const p=pins(),m=metadata(p);
  for(let n=0;n<101;n++)m['200'].artifacts.artifacts.push({id:1000+n,name:'unrelated-'+n});
  m['200'].artifacts.total_count=m['200'].artifacts.artifacts.length;
  const requests=mockGithub(t,m),r=await readForwardInputMetadata({pins:p,expectedSourceHead:head,token:'inert-token'});
  assert.equal(r.candidate.artifacts.total_count,103);assert.equal(r.candidate.artifacts.artifacts.length,103);
  assert.equal(requests.filter(s=>/page=2$/.test(s)).length,1);
  assert.equal(requests.filter(s=>!/artifacts/.test(s)).length,8);
  assert.equal(r.predecessorQualification.run.path,p.predecessor.qualification.workflow);
  assert.equal(r.predecessorQualification.run.head_branch,'work/preinstall-shared-inputs-20261027');
});
test('a producer rerun during catalog reading is refused without reading artifact bytes',async t=>{
  const p=pins(),requests=mockGithub(t,metadata(p),{changeRun:(r,n)=>({...r,run_attempt:n>1?2:r.run_attempt})});
  await assert.rejects(readForwardInputMetadata({pins:p,expectedSourceHead:head,token:'inert-token'}),/producer_not_exact_terminal_success/);
  assert.equal(requests.length,3);assert.equal(requests.some(s=>s.endsWith('/zip')),false);
});
test('missing independent qualifier remains BLOCKED before creating an acquisition root',async t=>{
  const root=await temp(t),inputRoot=path.join(root,'input'),p=pins(),m=metadata(p);delete m['300'];const requests=mockGithub(t,m);
  await assert.rejects(acquireForwardInputs({pins:p,inputRoot,expectedSourceHead:head,token:'inert-token'}),/github_read_failed/);
  await assert.rejects(fs.lstat(inputRoot),{code:'ENOENT'});assert.equal(requests.some(s=>s.endsWith('/zip')),false);
});
test('fixed original identity and independent qualifier branch are checked before acquisition writes',async t=>{
  for(const [name,change,reason] of [
    ['original run number',m=>m['40382079975'].run.run_number++,/original_producer_identity_mismatch/],
    ['original event',m=>m['40382079975'].run.event='push',/original_producer_identity_mismatch/],
    ['original ZIP byte count',m=>m['40382079975'].artifacts.artifacts[0].size_in_bytes++,/original_artifact_size_mismatch/],
    ['independent qualifier branch',m=>m['300'].run.head_branch='unreviewed-branch',/qualifier_branch_or_event_unapproved/],
  ])await t.test(name,async t=>{
    const root=await temp(t),inputRoot=path.join(root,'input'),p=pins(),m=metadata(p);change(m);const requests=mockGithub(t,m);
    await assert.rejects(acquireForwardInputs({pins:p,inputRoot,expectedSourceHead:head,token:'inert-token'}),reason);
    await assert.rejects(fs.lstat(inputRoot),{code:'ENOENT'});assert.equal(requests.some(s=>s.endsWith('/zip')),false);
  });
});
test('saved routing metadata cannot replace live qualification at consumption',async t=>{
  const root=await temp(t);await json(path.join(root,'producer-readback.json'),metadata(pins()));
  await assert.rejects(verifyForwardInputDirectory({pins:pins(),inputRoot:root,expectedSourceHead:head,token:''}),/github_token_missing/);
});
test('original builder config binds exact source LF bytes and only the fixed Windows materialization',async t=>{
  assert.equal(hash(originalConfigLf),'001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd');
  const crlf=Buffer.from(originalConfigLf.toString('utf8').replace(/\n/g,'\r\n'),'utf8');
  assert.equal(hash(crlf),'021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203');
  let response=configResponse(originalConfigLf),url;
  t.mock.method(globalThis,'fetch',async request=>{url=request;return new Response(JSON.stringify(response));});
  const acquired=await readForwardOriginalConfig({token:'inert-token'});
  assert.deepEqual(acquired.bytes,crlf);assert.deepEqual(acquired.sourceBytes,originalConfigLf);
  assert.equal(acquired.readback.source.bytes,3580);assert.equal(acquired.readback.materialization.bytes,3729);
  assert.equal(acquired.readback.materialization.mode,'LF_TO_CRLF_ONLY');
  assert.equal(acquired.readback.source.sha256,hash(originalConfigLf));assert.equal(acquired.readback.materialization.sha256,hash(crlf));
  assert.equal(url,`https://api.github.com/repos/${FORWARD_REPOSITORY}/contents/apps/metaengine-browser/electron-builder.test.json?ref=${oldHead}`);
  const reserialized=Buffer.from(JSON.stringify(JSON.parse(originalConfigLf.toString('utf8'))));
  for(const changed of [crlf,Buffer.concat([originalConfigLf,Buffer.from('\n')]),reserialized]){
    response=configResponse(changed);
    await assert.rejects(readForwardOriginalConfig({token:'inert-token'}),/original_config_source_digest_mismatch/);
  }
  for(const change of [r=>r.type='symlink',r=>r.path='apps/other/config.json',r=>r.encoding='none',r=>r.content+='!',r=>r.size++,r=>r.sha='e'.repeat(40)]){
    response=configResponse(originalConfigLf);change(response);
    await assert.rejects(readForwardOriginalConfig({token:'inert-token'}),/original_config_source_invalid/);
  }
});
test('original config revalidation binds both retained byte representations and their readback',async t=>{
  const root=await temp(t);t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(configResponse())));
  const acquired=await readForwardOriginalConfig({token:'inert-token'});
  const sourceFile=path.join(root,'original-electron-builder.source.json'),configFile=path.join(root,'original-electron-builder.test.json'),readbackFile=path.join(root,'original-config-readback.json');
  await fs.writeFile(sourceFile,acquired.sourceBytes);await fs.writeFile(configFile,acquired.bytes);await json(readbackFile,acquired.readback);
  assert.deepEqual(await verifyForwardOriginalConfig({roleRoot:root}),acquired.readback);
  await fs.writeFile(configFile,acquired.sourceBytes);
  await assert.rejects(verifyForwardOriginalConfig({roleRoot:root}),/original_config_digest_mismatch/);
  await fs.writeFile(configFile,acquired.bytes);await json(readbackFile,{...acquired.readback,materialization:{...acquired.readback.materialization,sha256:sha}});
  await assert.rejects(verifyForwardOriginalConfig({roleRoot:root}),/original_config_readback_mismatch/);
  await json(readbackFile,acquired.readback);await fs.writeFile(sourceFile,acquired.bytes);
  await assert.rejects(verifyForwardOriginalConfig({roleRoot:root}),/original_config_source_digest_mismatch/);
});
test('an unpinned original-source config blocks acquisition before writes or artifact downloads',async t=>{
  const root=await temp(t),inputRoot=path.join(root,'input'),p=pins(),requests=mockGithub(t,metadata(p));
  const runFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(...args)=>new URL(args[0]).pathname.includes('/contents/')
    ?new Response(JSON.stringify(configResponse(Buffer.from('{}\n')))):runFetch(...args));
  await assert.rejects(acquireForwardInputs({pins:p,inputRoot,expectedSourceHead:head,token:'inert-token'}),/original_config_source_digest_mismatch/);
  await assert.rejects(fs.lstat(inputRoot),{code:'ENOENT'});assert.equal(requests.some(s=>s.endsWith('/zip')),false);
});
test('low-level candidate revalidation cannot promote a saved producer readback',async t=>{
  const root=await temp(t);await json(path.join(root,'producer-readback.json'),metadata(pins())['200']);
  await assert.rejects(verifyForwardArtifactImage({pin:pins().candidate,roleRoot:root}),/producer_readback_required/);
});
test('read-only archive binding rejects jointly rewritten extracted provenance and code metadata',async t=>{
  const root=await temp(t),archive=path.join(root,'original.zip'),destination=path.join(root,'out');
  await zipRows(archive,[['installer-provenance.json','original provenance'],['metaengine-installed-package-code.v1.json','original code']]);
  const pin=await hashForwardInputFile(archive);await extractForwardArchive({archive,destination,expectedSha256:pin});
  assert.equal(await verifyForwardArchive({archive,destination,expectedSha256:pin}),true);
  await fs.writeFile(path.join(destination,'installer-provenance.json'),'forged provenance');await fs.writeFile(path.join(destination,'metaengine-installed-package-code.v1.json'),'forged code');
  await assert.rejects(verifyForwardArchive({archive,destination,expectedSha256:pin}),/archive_materialization_changed/);
});
test('a pinned archive member supplies its immutable digest and rejects a replaced manifest',async t=>{
  const root=await temp(t),archive=path.join(root,'qualification.zip'),destination=path.join(root,'out'),name='predecessor-materialization.json';
  await zipRows(archive,[[name,'{"pinned":true}']]);const pin=await hashForwardInputFile(archive);
  await extractForwardArchive({archive,destination,expectedSha256:pin});const file=path.join(destination,name);
  assert.equal(await assertForwardArchiveMember({archive,file,relative:name,expectedSha256:pin}),hash('{"pinned":true}'));
  await fs.writeFile(file,'{"pinned":false}');await assert.rejects(assertForwardArchiveMember({archive,file,relative:name,expectedSha256:pin}),/archive_member_changed/);
});
test('unrelated concurrent sibling creation cannot masquerade as ancestor replacement',async t=>{
  const root=await temp(t),file=path.join(root,'artifact.zip');await fs.writeFile(file,'pinned archive bytes');
  const originalRealpath=fs.realpath;let siblingCreated=false;
  t.mock.method(fs,'realpath',async (...args)=>{
    if(path.resolve(args[0])===root&&!siblingCreated){
      siblingCreated=true;
      // A concurrent test or hosted-runner process may legitimately create a
      // sibling while this verifier checks the shared ancestor's file identity.
      await fs.mkdir(path.join(root,'unrelated-sibling'));
    }
    return originalRealpath(...args);
  });
  assert.equal(await hashForwardInputFile(file),hash('pinned archive bytes'));
  assert.equal(siblingCreated,true);
});
test('actual ancestor replacement between identity reads is still refused',async t=>{
  const root=await temp(t),boundary=path.join(root,'input');await fs.mkdir(boundary);
  const file=path.join(boundary,'artifact.zip');await fs.writeFile(file,'same bytes');
  const originalRealpath=fs.realpath;let replaced=false;
  t.mock.method(fs,'realpath',async (...args)=>{
    if(path.resolve(args[0])===boundary&&!replaced){
      replaced=true;await fs.rename(boundary,path.join(root,'retained-original'));
      await fs.mkdir(boundary);await fs.writeFile(file,'same bytes');
    }
    return originalRealpath(...args);
  });
  await assert.rejects(hashForwardInputFile(file),/qa_forward_inputs_path_changed/);
  assert.equal(replaced,true);
});
test('regular-file mutation between identity reads is still refused',async t=>{
  const root=await temp(t),file=path.join(root,'artifact.zip');await fs.writeFile(file,'original');
  const originalRealpath=fs.realpath;let changed=false;
  t.mock.method(fs,'realpath',async (...args)=>{
    if(path.resolve(args[0])===file&&!changed){changed=true;await fs.appendFile(file,'changed');}
    return originalRealpath(...args);
  });
  await assert.rejects(hashForwardInputFile(file),/qa_forward_inputs_path_changed/);
  assert.equal(changed,true);
});
test('ZIP traversal, case aliases and symlinks are rejected before any payload extraction',async t=>{
  const root=await temp(t);
  const cases=[[['../escape','x']],[['C:/escape','x']],[['good','x'],['GOOD','y']],[['link','target',0o120777*65536]],
    [['dir\\escape','x']],[['con.txt','x']],[['visible\0hidden','x']],[['reparse','target',0x400]]];
  for(let n=0;n<cases.length;n++){
    const archive=path.join(root,`bad-${n}.zip`),destination=path.join(root,`out-${n}`);await zipRows(archive,cases[n]);
    await assert.rejects(extractForwardArchive({archive,destination,expectedSha256:await hashForwardInputFile(archive)}),/archive_extraction_failed/,'raw ZIP case '+n+': '+JSON.stringify(cases[n]));
    await assert.rejects(fs.lstat(destination),{code:'ENOENT'});
  }
});
test('bounded extraction preserves exact bytes and never overwrites an existing directory',async t=>{
  const root=await temp(t),archive=path.join(root,'good.zip'),destination=path.join(root,'out');
  await zipRows(archive,[['resources/app.asar','bytes'],['METAENGINE Browser Test.exe','exe']]);
  const pin=await hashForwardInputFile(archive);await extractForwardArchive({archive,destination,expectedSha256:pin});
  assert.equal(await fs.readFile(path.join(destination,'resources','app.asar'),'utf8'),'bytes');
  await assert.rejects(extractForwardArchive({archive,destination,expectedSha256:pin}),/archive_extraction_failed/);
  assert.equal(await fs.readFile(path.join(destination,'resources','app.asar'),'utf8'),'bytes');
});
