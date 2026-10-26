// Synthetic byte/metadata fixtures qualify the consumer's fences only. They are
// never passed to NSIS, PostgreSQL or the physical migration harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {captureInstalledTreeFingerprint,INSTALLED_TREE_SCHEMA} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {FORWARD_INPUT_SCHEMA,FORWARD_SIDECAR_SCHEMA,FORWARD_REPOSITORY,FORWARD_PRODUCER,
  validateForwardInputPins,validateForwardSidecar,assertForwardProducerMetadata,assertForwardArtifactMetadata,
  verifyForwardInputDirectory,verifyForwardArtifactImage,hashForwardInputFile,extractForwardArchive,acquireForwardInputs}
  from '../scripts/qa-forward-install-evidence.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),sha='a'.repeat(64),head='a'.repeat(40),oldHead='b'.repeat(40);
const exec=promisify(execFile),python=process.platform==='win32'?'python':'python3';
const tree=rows=>hash(JSON.stringify({schema:INSTALLED_TREE_SCHEMA,files:rows}));
function pin(source,run,version,id){return {source_head:source,package_version:version,producer_run_id:String(run),producer_run_attempt:1,
  installer_artifact:{id:String(id),name:'metaengine-browser-windows-candidate-'+source,sha256:sha},
  sidecar_artifact:{id:String(id+1),name:'metaengine-browser-windows-forward-sidecar-'+source,sha256:sha}};}
function pins(){return {schema:FORWARD_INPUT_SCHEMA,candidate:pin(head,200,'0.7.0-dev.180.1',20),predecessor:pin(oldHead,100,'0.7.0-dev.179.1',10)};}
function run(pin){return {id:Number(pin.producer_run_id),repository:{full_name:FORWARD_REPOSITORY},path:FORWARD_PRODUCER,
  head_sha:pin.source_head,run_attempt:pin.producer_run_attempt,run_number:50,status:'completed',conclusion:'success',event:'push',
  run_started_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:10:00Z'};}
function artifact(pin,run,bytes=100){return {id:Number(pin.id),name:pin.name,digest:'sha256:'+pin.sha256,expired:false,size_in_bytes:bytes,
  workflow_run:{id:run.id,head_sha:run.head_sha},created_at:'2026-10-27T00:05:00Z'};}
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'forward-evidence-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function json(file,v){await fs.writeFile(file,JSON.stringify(v,null,2)+'\n');}
async function zipTree(root,out){await exec(python,['-c',`import zipfile,os,sys
with zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED) as z:
 for root,dirs,files in os.walk(sys.argv[1]):
  for name in sorted(dirs+files):
   p=os.path.join(root,name);z.write(p,os.path.relpath(p,sys.argv[1]).replace(os.sep,'/'))`,root,out]);}
async function zipRows(file,rows){
  const {stdout}=await exec(python,['-c',`import zipfile,sys,json
with zipfile.ZipFile(sys.argv[1],'x') as z:
 for row in json.loads(sys.argv[2]):
  info=zipfile.ZipInfo(row[0])
  # The constructor normalizes backslashes on Windows and NUL on every OS.
  # Preserve deliberately malicious central-directory bytes in this fixture.
  info.filename=row[0];info.orig_filename=row[0];info.create_system=3
  info.external_attr=row[2] if len(row)>2 else 0
  z.writestr(info,row[1])
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps([row.orig_filename for row in z.infolist()]))`,file,JSON.stringify(rows)]);
  assert.deepEqual(JSON.parse(stdout),rows.map(row=>row[0]),'fixture must retain exact raw ZIP names on every platform');
}
async function imageFixture(root,pin){
  const image=path.join(root,'sidecar','win-unpacked');await fs.mkdir(image,{recursive:true});
  const files={
    'METAENGINE Browser Test.exe':'synthetic-browser',
    'resources/app.asar':'synthetic-asar',
    'resources/client-state-runtime/offline-runtime-bundle.json':JSON.stringify({schema:'compute.runtime-offline-bundle.v1',bundle_sha256:sha}),
    'resources/client-state-runtime/runtime/postgresql/bin/postgres.exe':'synthetic-pg',
    'resources/client-state-runtime/runtime/postgresql/bin/psql.exe':'synthetic-psql',
    'resources/client-state-runtime/runtime/postgresql/bin/initdb.exe':'synthetic-initdb',
    'resources/client-state-runtime/runtime/postgresql/bin/pg_ctl.exe':'synthetic-ctl',
    'resources/client-state-runtime/runtime/postgresql/lib/plpgsql.dll':'synthetic-lib',
    'resources/client-state-runtime/runtime/postgresql/share/postgres.bki':'synthetic-share',
  };
  for(const [rel,bytes] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(image,rel)),{recursive:true});await fs.writeFile(path.join(image,rel),bytes);}
  const dirs=new Set();for(const file of Object.keys(files)){let d=path.posix.dirname(file);while(d!=='.'){dirs.add(d);d=path.posix.dirname(d);}}
  const rows=[...[...dirs].map(d=>[d,'DIRECTORY']),...Object.entries(files).map(([file,bytes])=>[file,Buffer.byteLength(bytes),hash(bytes)])].sort((a,b)=>a[0]<b[0]?-1:1);
  const sub=p=>tree(rows.filter(r=>r[0].startsWith(p+'/')).map(r=>[r[0].slice(p.length+1),...r.slice(1)]));
  const installerName=`METAENGINE-Browser-Test-Setup-${pin.package_version}-x64.exe`;
  const result={schema:FORWARD_SIDECAR_SCHEMA,source_head:pin.source_head,package_version:pin.package_version,
    producer:{repository:FORWARD_REPOSITORY,workflow:FORWARD_PRODUCER,run_id:pin.producer_run_id,run_attempt:pin.producer_run_attempt,run_number:50,event:'push'},
    installer_artifact:{...pin.installer_artifact},
    installer:{name:installerName,sha256:hash('synthetic-installer')},asar_sha256:hash(files['resources/app.asar']),
    runtime:{bundle_sha256:sha,tree_sha256:sub('resources/client-state-runtime'),postgres_tree_sha256:sub('resources/client-state-runtime/runtime/postgresql')},
    image:{root:'win-unpacked',schema:INSTALLED_TREE_SCHEMA,tree_sha256:tree(rows),files:rows},
    installed_image:{schema:'metaengine.operator.qa-installed-image-readback.v1',state:'EXACT_CANDIDATE_IMAGE_VERIFIED',
      candidate_tree_sha256:tree(rows),installed_tree_sha256:tree([...rows,['Uninstall METAENGINE Browser Test.exe',Buffer.byteLength('synthetic-uninstaller'),hash('synthetic-uninstaller')]].sort((a,b)=>a[0]<b[0]?-1:1)),
      file_count:rows.filter(r=>r.length===3).length+1,total_bytes:rows.filter(r=>r.length===3).reduce((n,r)=>n+r[1],0)+Buffer.byteLength('synthetic-uninstaller'),
      uninstaller_sha256:hash('synthetic-uninstaller'),full_tree_verified:true,production_authorized:false,authority_effect:false},
    uninstaller:{name:'Uninstall METAENGINE Browser Test.exe',sha256:hash('synthetic-uninstaller'),measurement:'NSIS_GENERATED_AFTER_FRESH_INSTALL',installer_sha256:hash('synthetic-installer')},
    schema_fixture:{file:'predecessor-empty-schema.dump',sha256:hash('synthetic-schema'),source_head:pin.source_head,kind:'REVIEWED_OFFLINE_EMPTY_SCHEMA',source_data_rows:0,synthetic_rpc_bodies:false}};
  assert.equal((await captureInstalledTreeFingerprint(image)).tree_sha256,result.image.tree_sha256);
  await json(path.join(root,'sidecar','forward-install-sidecar.json'),result);
  await fs.writeFile(path.join(root,'sidecar','predecessor-empty-schema.dump'),'synthetic-schema');
  await fs.mkdir(path.join(root,'installer'));await fs.writeFile(path.join(root,'installer',installerName),'synthetic-installer');
  return result;
}
async function inputFixture(t){
  const root=await temp(t),p=pins(),sidecars={};
  for(const role of ['candidate','predecessor']){
    const rr=path.join(root,role);await fs.mkdir(rr);sidecars[role]=await imageFixture(rr,p[role]);
    await zipTree(path.join(rr,'installer'),path.join(rr,'installer.zip'));
    p[role].installer_artifact.sha256=await hashForwardInputFile(path.join(rr,'installer.zip'));
    sidecars[role].installer_artifact={...p[role].installer_artifact};
    await json(path.join(rr,'sidecar','forward-install-sidecar.json'),sidecars[role]);
    await zipTree(path.join(rr,'sidecar'),path.join(rr,'sidecar.zip'));
    p[role].sidecar_artifact.sha256=await hashForwardInputFile(path.join(rr,'sidecar.zip'));
    const r=run(p[role]);await json(path.join(rr,'producer-readback.json'),{run:r,...Object.fromEntries(await Promise.all(['installer','sidecar'].map(async kind=>[kind,artifact(p[role][kind+'_artifact'],r,(await fs.stat(path.join(rr,kind+'.zip'))).size)])))});
  }
  return {root,p,sidecars};
}

test('explicit source, attempts and distinct immutable artifact pins are mandatory',()=>{
  assert.equal(validateForwardInputPins(pins(),{expectedSourceHead:head}).candidate.source_head,head);
  for(const mutate of [p=>p.candidate.source_head='main',p=>p.candidate.producer_run_id='latest',p=>p.candidate.producer_run_attempt=0,
    p=>p.candidate.installer_artifact.id=20,p=>p.candidate.sidecar_artifact.sha256='',p=>p.predecessor=p.candidate,
    p=>p.candidate.package_version='0.7.0-dev.1784381341133.1',p=>p.extra='https://untrusted.invalid',
    p=>p.candidate.sidecar_artifact.id=p.candidate.installer_artifact.id]){
    const p=pins();mutate(p);assert.throws(()=>validateForwardInputPins(p,{expectedSourceHead:head}),/qa_forward_inputs_/);
  }
  assert.throws(()=>validateForwardInputPins(pins(),{expectedSourceHead:oldHead}),/candidate_source_mismatch/);
});
test('run metadata rejects nonterminal, failed, changed-attempt, wrong-source and other-producer runs',()=>{
  const pin=pins().candidate;assert.equal(assertForwardProducerMetadata(run(pin),pin),true);
  for(const mutate of [r=>r.status='in_progress',r=>r.conclusion='failure',r=>r.run_attempt=2,r=>r.head_sha=oldHead,
    r=>r.path='.github/workflows/another-producer.yml',r=>r.repository.full_name='other/repo']){
    const r=run(pin);mutate(r);assert.throws(()=>assertForwardProducerMetadata(r,pin),/producer_not_exact_terminal_success/);
  }
});
test('artifact metadata must bind current run attempt window, ID, archive digest and source',()=>{
  const p=pins().candidate,r=run(p),a=artifact(p.sidecar_artifact,r);assert.equal(assertForwardArtifactMetadata(a,p.sidecar_artifact,r),true);
  for(const mutate of [a=>a.workflow_run.id++,a=>a.workflow_run.head_sha=oldHead,a=>a.digest='sha256:'+'b'.repeat(64),
    a=>a.created_at='2026-10-26T00:00:00Z',a=>a.created_at='2026-10-28T00:00:00Z',a=>a.expired=true,a=>a.id++,a=>a.size_in_bytes=0]){
    const v=structuredClone(a);mutate(v);assert.throws(()=>assertForwardArtifactMetadata(v,p.sidecar_artifact,r),/artifact_binding_mismatch/);
  }
});
test('real files and pinned ZIP manifests produce a routing descriptor, not installed proof',async t=>{
  const {root,p}=await inputFixture(t),r=await verifyForwardInputDirectory({pins:p,inputRoot:root,expectedSourceHead:head});
  assert.equal(r.consumer_source_head,head);assert.equal(r.automatic_self_update_qualified,false);assert.equal(r.production_authorized,false);
  assert.equal(r.predecessor.schema_fixture.file,path.join(root,'predecessor','sidecar','predecessor-empty-schema.dump'));
  assert.equal(r.predecessor.pg_tree_sha256,(await captureInstalledTreeFingerprint(path.join(r.predecessor.candidate_root,'resources','client-state-runtime','runtime','postgresql'))).tree_sha256);
  assert.equal(r.physical_migration_qualified,undefined);
});
test('sidecar requires complete inventory, separately measured uninstaller and reviewed empty schema',async t=>{
  const {p,sidecars}=await inputFixture(t),original=sidecars.predecessor;
  for(const mutate of [v=>v.uninstaller.measurement='COPIED_FROM_SUCCESSOR',v=>v.uninstaller.installer_sha256=sha,
    v=>delete v.schema_fixture,v=>v.schema_fixture.source_data_rows=1,v=>v.schema_fixture.synthetic_rpc_bodies=true,
    v=>v.schema_fixture.source_head=head,v=>v.runtime.postgres_tree_sha256=sha,v=>v.asar_sha256=sha,
    v=>v.image.files.push(['../escape',1,sha]),v=>v.image.files.reverse(),
    v=>delete v.installer_artifact,v=>v.installer_artifact.id='10000',v=>v.installer_artifact.sha256=sha,
    v=>v.producer.run_number=0,v=>v.producer.event='schedule',v=>delete v.installed_image,
    v=>v.installed_image.full_tree_verified=false,v=>v.installed_image.production_authorized=true,v=>v.installed_image.file_count--,
    v=>v.installed_image.uninstaller_sha256=sha,v=>v.installed_image.installed_tree_sha256=sha]){
    const v=structuredClone(original);mutate(v);assert.throws(()=>validateForwardSidecar(v,p.predecessor,{requireSchemaFixture:true}),/qa_forward_inputs_/);
  }
});
test('sidecar producer run number and event agree with independent saved GitHub readback',async t=>{
  const {root,p}=await inputFixture(t),file=path.join(root,'candidate','producer-readback.json'),original=JSON.parse(await fs.readFile(file,'utf8'));
  for(const mutate of [v=>v.run.run_number++,v=>v.run.event='workflow_dispatch']){
    const changed=structuredClone(original);mutate(changed);await json(file,changed);
    await assert.rejects(verifyForwardArtifactImage({pin:p.candidate,roleRoot:path.join(root,'candidate')}),/sidecar_producer_readback_mismatch/);
  }
});
test('mutation after acquisition invalidates installer, payload, schema dump and retained archives',async t=>{
  const {root,p}=await inputFixture(t),verified=await verifyForwardInputDirectory({pins:p,inputRoot:root,expectedSourceHead:head});
  for(const file of [verified.candidate.installer_file,path.join(verified.candidate.candidate_root,'resources','app.asar'),
    verified.predecessor.schema_dump_file,path.join(root,'candidate','sidecar.zip')]){
    const before=await fs.readFile(file);await fs.appendFile(file,'changed');
    await assert.rejects(verifyForwardInputDirectory({pins:p,inputRoot:root,expectedSourceHead:head}),/qa_forward_inputs_/);
    await fs.writeFile(file,before);
  }
});
test('rewriting the extracted sidecar and payload together cannot escape the pinned archive',async t=>{
  const {root,p,sidecars}=await inputFixture(t),v=sidecars.candidate;
  v.uninstaller.sha256=sha;await json(path.join(root,'candidate','sidecar','forward-install-sidecar.json'),v);
  await assert.rejects(verifyForwardArtifactImage({pin:p.candidate,roleRoot:path.join(root,'candidate')}),/sidecar_archive_binding_mismatch/);
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
test('hardlinked installer and physical directory alias are refused',async t=>{
  const {root,p}=await inputFixture(t),r=await verifyForwardInputDirectory({pins:p,inputRoot:root,expectedSourceHead:head});
  const linked=path.join(root,'hardlink');await fs.link(r.candidate.installer_file,linked);
  await assert.rejects(verifyForwardInputDirectory({pins:p,inputRoot:root,expectedSourceHead:head}),/path_alias_forbidden/);await fs.unlink(linked);
  const link=path.join(root,'alias');await fs.symlink(path.join(root,'candidate'),link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(verifyForwardArtifactImage({pin:p.candidate,roleRoot:link}),/path_alias_forbidden/);
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
test('missing producer sidecar remains BLOCKED before creating the acquisition root',async t=>{
  const root=await temp(t),inputRoot=path.join(root,'input'),p=pins(),requests=[];
  t.mock.method(globalThis,'fetch',async url=>{
    requests.push(String(url));
    if(String(url).endsWith('/actions/runs/100'))return new Response(JSON.stringify(run(p.predecessor)));
    if(String(url).endsWith('/actions/artifacts/10'))return new Response(JSON.stringify(artifact(p.predecessor.installer_artifact,run(p.predecessor))));
    return new Response('{}',{status:404});
  });
  await assert.rejects(acquireForwardInputs({pins:p,inputRoot,expectedSourceHead:head,token:'synthetic-token'}),/github_read_failed/);
  await assert.rejects(fs.lstat(inputRoot),{code:'ENOENT'});
  assert.equal(requests.length,3);assert.equal(requests.some(s=>s.endsWith('/zip')),false);
});
