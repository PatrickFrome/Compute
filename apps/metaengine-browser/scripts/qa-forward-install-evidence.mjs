#!/usr/bin/env node
// Read-only acquisition and byte binding for the manual-forward consumer.
// This is not a producer, installer, Owner provisioner or automatic updater.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {captureInstalledTreeFingerprint,INSTALLED_TREE_SCHEMA} from './qa-installed-tree-fingerprint.mjs';

export const FORWARD_INPUT_SCHEMA='metaengine.browser.manual-forward-inputs.v1';
export const FORWARD_SIDECAR_SCHEMA='metaengine.browser.forward-install-sidecar.v1';
export const FORWARD_VERIFIED_SCHEMA='metaengine.browser.manual-forward-verified-inputs.v1';
export const FORWARD_REPOSITORY='PatrickFrome/Compute';
export const FORWARD_PRODUCER='.github/workflows/browser-windows-package-smoke.yml';
const SHA=/^[a-f0-9]{64}$/,HEAD=/^[a-f0-9]{40}$/,ID=/^[1-9][0-9]{0,19}$/;
const VERSION=/^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const MAX_BYTES=12*1024**3,MAX_JSON=16*1024**2,MAX_ENTRIES=50000;
const UNINSTALLER='Uninstall METAENGINE Browser Test.exe';
const RUNTIME='resources/client-state-runtime',POSTGRES=RUNTIME+'/runtime/postgresql';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{const error=new Error('qa_forward_inputs_'+code);error.code=error.message;throw error;};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>record(value)&&Object.keys(value).every(k=>allowed.includes(k));
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const sameInfo=(a,b)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.nlink===b.nlink;

function relativeName(value){
  return typeof value==='string'&&value.length>0&&value.length<=512&&value.split('/').length<=40
    &&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\:\x00-\x1f<>"|?*]/.test(p)
      &&!/[. ]$/.test(p)&&! /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
function artifactPin(value,name){
  if(!keys(value,['id','name','sha256'])||(typeof value.id!=='string'||!ID.test(value.id))||value.name!==name||!SHA.test(value.sha256||''))fail('artifact_pin_invalid');
  return {id:value.id,name:value.name,sha256:value.sha256};
}
function packagePin(value){
  if(!keys(value,['source_head','package_version','producer_run_id','producer_run_attempt','installer_artifact','sidecar_artifact'])
    ||!HEAD.test(value.source_head||'')||!VERSION.test(value.package_version||'')||(typeof value.producer_run_id!=='string'||!ID.test(value.producer_run_id))
    ||!Number.isSafeInteger(value.producer_run_attempt)||value.producer_run_attempt<1)fail('package_pin_invalid');
  return {source_head:value.source_head,package_version:value.package_version,producer_run_id:value.producer_run_id,
    producer_run_attempt:value.producer_run_attempt,
    installer_artifact:artifactPin(value.installer_artifact,'metaengine-browser-windows-candidate-'+value.source_head),
    sidecar_artifact:artifactPin(value.sidecar_artifact,'metaengine-browser-windows-forward-sidecar-'+value.source_head)};
}
export function validateForwardInputPins(value,{expectedSourceHead}={}){
  if(!keys(value,['schema','candidate','predecessor'])||value.schema!==FORWARD_INPUT_SCHEMA||!HEAD.test(expectedSourceHead||''))fail('pins_invalid');
  const candidate=packagePin(value.candidate),predecessor=packagePin(value.predecessor);
  if(candidate.source_head!==expectedSourceHead)fail('candidate_source_mismatch');
  if(candidate.source_head===predecessor.source_head||candidate.package_version===predecessor.package_version
    ||candidate.producer_run_id===predecessor.producer_run_id)fail('predecessor_not_distinct');
  if(candidate.package_version==='0.7.0-dev.1784381341133.1')fail('consumed_candidate_forbidden');
  const ids=[candidate.installer_artifact.id,candidate.sidecar_artifact.id,predecessor.installer_artifact.id,predecessor.sidecar_artifact.id];
  if(new Set(ids).size!==ids.length)fail('artifact_alias');
  return {schema:FORWARD_INPUT_SCHEMA,candidate,predecessor};
}

export function assertForwardProducerMetadata(run,pin){
  if(!record(run)||String(run.id)!==pin.producer_run_id||run.repository?.full_name!==FORWARD_REPOSITORY
    ||run.path!==FORWARD_PRODUCER||run.head_sha!==pin.source_head||run.run_attempt!==pin.producer_run_attempt
    ||!Number.isSafeInteger(run.run_number)||run.run_number<1
    ||run.status!=='completed'||run.conclusion!=='success'
    ||!['push','pull_request','workflow_dispatch'].includes(run.event)
    ||!Number.isFinite(Date.parse(run.run_started_at))||!Number.isFinite(Date.parse(run.updated_at)))fail('producer_not_exact_terminal_success');
  return true;
}
export function assertForwardArtifactMetadata(artifact,pin,run){
  if(!record(artifact)||String(artifact.id)!==pin.id||artifact.name!==pin.name||artifact.expired!==false
    ||artifact.digest!=='sha256:'+pin.sha256||artifact.workflow_run?.id!==run.id
    ||artifact.workflow_run?.head_sha!==run.head_sha
    ||!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<=0||artifact.size_in_bytes>MAX_BYTES
    ||!Number.isFinite(Date.parse(artifact.created_at))||Date.parse(artifact.created_at)<Date.parse(run.run_started_at)
    ||Date.parse(artifact.created_at)>Date.parse(run.updated_at))fail('artifact_binding_mismatch');
  return true;
}
function validateInventory(image){
  if(!keys(image,['root','schema','tree_sha256','files'])||image.root!=='win-unpacked'||image.schema!==INSTALLED_TREE_SCHEMA
    ||!SHA.test(image.tree_sha256||'')||!Array.isArray(image.files)||!image.files.length||image.files.length>MAX_ENTRIES)fail('inventory_invalid');
  const seen=new Set();let previous='',bytes=0,files=0;
  for(const row of image.files){
    if(!Array.isArray(row)||!relativeName(row[0])||row[0]<=previous||seen.has(row[0].toLowerCase()))fail('inventory_path_invalid');
    previous=row[0];seen.add(row[0].toLowerCase());
    if(row.length===2&&row[1]==='DIRECTORY')continue;
    if(row.length!==3||!Number.isSafeInteger(row[1])||row[1]<0||!SHA.test(row[2]||''))fail('inventory_entry_invalid');
    bytes+=row[1];files++;
    if(bytes>MAX_BYTES||files>25000)fail('inventory_limit');
  }
  if(!files||digest(JSON.stringify({schema:INSTALLED_TREE_SCHEMA,files:image.files}))!==image.tree_sha256)fail('inventory_digest_mismatch');
  if(image.files.some(r=>r[0].toLowerCase()===UNINSTALLER.toLowerCase()))fail('unpacked_contains_uninstaller');
}
function subtreeDigest(image,prefix){
  const rows=image.files.filter(r=>r[0].startsWith(prefix+'/')).map(r=>[r[0].slice(prefix.length+1),...r.slice(1)]);
  if(!rows.some(r=>r.length===3))fail('runtime_inventory_missing');
  return digest(JSON.stringify({schema:INSTALLED_TREE_SCHEMA,files:rows}));
}
export function validateForwardSidecar(value,pin,{requireSchemaFixture=false}={}){
  if(!keys(value,['schema','source_head','package_version','producer','installer','installer_artifact','asar_sha256','runtime','image','installed_image','uninstaller','schema_fixture'])
    ||value.schema!==FORWARD_SIDECAR_SCHEMA||value.source_head!==pin.source_head||value.package_version!==pin.package_version
    ||!keys(value.producer,['repository','workflow','run_id','run_attempt','run_number','event'])||value.producer.repository!==FORWARD_REPOSITORY
    ||value.producer.workflow!==FORWARD_PRODUCER||value.producer.run_id!==pin.producer_run_id||value.producer.run_attempt!==pin.producer_run_attempt
    ||!Number.isSafeInteger(value.producer.run_number)||value.producer.run_number<1||!['push','pull_request','workflow_dispatch'].includes(value.producer.event)
    ||!keys(value.installer,['name','sha256'])||value.installer.name!==`METAENGINE-Browser-Test-Setup-${pin.package_version}-x64.exe`
    ||!SHA.test(value.installer.sha256||'')||!SHA.test(value.asar_sha256||'')
    ||!keys(value.runtime,['bundle_sha256','tree_sha256','postgres_tree_sha256'])
    ||!['bundle_sha256','tree_sha256','postgres_tree_sha256'].every(k=>SHA.test(value.runtime[k]||''))
    ||!keys(value.uninstaller,['name','sha256','measurement','installer_sha256'])||value.uninstaller.name!==UNINSTALLER
    ||!SHA.test(value.uninstaller.sha256||'')||value.uninstaller.measurement!=='NSIS_GENERATED_AFTER_FRESH_INSTALL'
    ||value.uninstaller.installer_sha256!==value.installer.sha256)fail('sidecar_binding_invalid');
  const recordedArtifact=artifactPin(value.installer_artifact,pin.installer_artifact.name);
  if(recordedArtifact.id!==pin.installer_artifact.id||recordedArtifact.sha256!==pin.installer_artifact.sha256)fail('sidecar_installer_artifact_mismatch');
  if(requireSchemaFixture||value.schema_fixture!==undefined){
    const schema=value.schema_fixture;
    if(!keys(schema,['file','sha256','source_head','kind','source_data_rows','synthetic_rpc_bodies'])
      ||schema.file!=='predecessor-empty-schema.dump'||!SHA.test(schema.sha256||'')||schema.source_head!==pin.source_head
      ||schema.kind!=='REVIEWED_OFFLINE_EMPTY_SCHEMA'||schema.source_data_rows!==0||schema.synthetic_rpc_bodies!==false)fail('schema_fixture_required');
  }
  validateInventory(value.image);
  const installed=value.installed_image,files=value.image.files.filter(row=>row.length===3),candidateBytes=files.reduce((sum,row)=>sum+row[1],0);
  if(!keys(installed,['schema','state','candidate_tree_sha256','installed_tree_sha256','file_count','total_bytes','uninstaller_sha256','full_tree_verified','production_authorized','authority_effect'])
    ||installed.schema!=='metaengine.operator.qa-installed-image-readback.v1'||installed.state!=='EXACT_CANDIDATE_IMAGE_VERIFIED'
    ||installed.candidate_tree_sha256!==value.image.tree_sha256||!SHA.test(installed.installed_tree_sha256||'')
    ||installed.uninstaller_sha256!==value.uninstaller.sha256||installed.full_tree_verified!==true
    ||installed.production_authorized!==false||installed.authority_effect!==false
    ||!Number.isSafeInteger(installed.file_count)||installed.file_count!==files.length+1||installed.file_count>25000
    ||!Number.isSafeInteger(installed.total_bytes)||installed.total_bytes<=candidateBytes||installed.total_bytes>MAX_BYTES)fail('producer_installed_image_invalid');
  const installedRows=[...value.image.files,[UNINSTALLER,installed.total_bytes-candidateBytes,value.uninstaller.sha256]].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  if(digest(JSON.stringify({schema:INSTALLED_TREE_SCHEMA,files:installedRows}))!==installed.installed_tree_sha256)fail('producer_installed_tree_mismatch');
  if(value.image.files.find(r=>r[0]==='resources/app.asar')?.[2]!==value.asar_sha256)fail('asar_inventory_mismatch');
  if(subtreeDigest(value.image,RUNTIME)!==value.runtime.tree_sha256||subtreeDigest(value.image,POSTGRES)!==value.runtime.postgres_tree_sha256)fail('runtime_inventory_mismatch');
  for(const file of ['METAENGINE Browser Test.exe',RUNTIME+'/offline-runtime-bundle.json',POSTGRES+'/bin/postgres.exe',
    POSTGRES+'/bin/psql.exe',POSTGRES+'/bin/initdb.exe',POSTGRES+'/bin/pg_ctl.exe',POSTGRES+'/lib/plpgsql.dll',POSTGRES+'/share/postgres.bki'])
    if(!value.image.files.some(r=>r[0]===file&&r.length===3))fail('offline_image_incomplete');
  return value;
}

// Check every existing ancestor. Reject links even when their target is inside
// the apparent input root, and reject non-single-linked regular input files.
export async function assertForwardInputPath(absolute,{directory=false,missingLeaf=false}={}){
  if(typeof absolute!=='string'||!path.isAbsolute(absolute)||absolute.startsWith('\\\\'))fail('path_invalid');
  const resolved=path.resolve(absolute),root=path.parse(resolved).root,parts=path.relative(root,resolved).split(path.sep).filter(Boolean);
  let current=root;
  for(let i=0;i<=parts.length;i++){
    if(i)current=path.join(current,parts[i-1]);
    let before;
    try{before=await fs.lstat(current,{bigint:true});}catch(error){if(missingLeaf&&i===parts.length&&error.code==='ENOENT')return;throw error;}
    const dir=i<parts.length||directory;
    if(before.isSymbolicLink()||(dir?!before.isDirectory():!before.isFile())||before.ino<=0n||(!dir&&before.nlink!==1n))fail('path_alias_forbidden');
    const real=await fs.realpath(current),other=await fs.lstat(real,{bigint:true}),after=await fs.lstat(current,{bigint:true});
    // Shared ancestors legitimately change mtime/size/link count when another
    // runner task creates a sibling. Directory custody is its stable kernel
    // identity and physical type; regular-file byte metadata remains strict.
    if(other.isSymbolicLink()||after.isSymbolicLink()||!sameIdentity(before,other)||!sameIdentity(before,after)
      ||(dir?(!other.isDirectory()||!after.isDirectory()):(!other.isFile()||!after.isFile()||other.nlink!==1n||!sameInfo(before,after))))fail('path_changed');
  }
}
export async function hashForwardInputFile(file,{maxBytes=MAX_BYTES}={}){
  await assertForwardInputPath(file);
  const before=await fs.lstat(file,{bigint:true});if(before.size>BigInt(maxBytes))fail('file_size_limit');
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  const after=await fs.lstat(file,{bigint:true});if(!sameInfo(before,after))fail('file_changed');
  await assertForwardInputPath(file);
  return hash.digest('hex');
}
async function readJson(file){
  const before=await hashForwardInputFile(file,{maxBytes:MAX_JSON});
  const bytes=await fs.readFile(file);if(digest(bytes)!==before)fail('json_changed');
  try{return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{fail('json_invalid');}
}
async function writeJson(file,value){await assertForwardInputPath(file,{missingLeaf:true});const h=await fs.open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}}

export async function verifyForwardArtifactImage({pin,roleRoot,requireSchemaFixture=false}){
  await assertForwardInputPath(roleRoot,{directory:true});
  const manifestFile=path.join(roleRoot,'sidecar','forward-install-sidecar.json');
  const archive=path.join(roleRoot,'sidecar.zip');
  if(await hashForwardInputFile(archive)!==pin.sidecar_artifact.sha256)fail('archive_digest_mismatch');
  const {stdout}=await promisify(execFile)(process.platform==='win32'?'python':'python3',['-c',READ_MANIFEST_PY,archive],{windowsHide:true,shell:false,timeout:30000,maxBuffer:MAX_JSON});
  if(digest(Buffer.from(stdout,'utf8'))!==await hashForwardInputFile(manifestFile,{maxBytes:MAX_JSON}))fail('sidecar_archive_binding_mismatch');
  if(await hashForwardInputFile(archive)!==pin.sidecar_artifact.sha256)fail('archive_changed_during_read');
  const sidecar=validateForwardSidecar(await readJson(manifestFile),pin,{requireSchemaFixture});
  const observed=await readJson(path.join(roleRoot,'producer-readback.json'));
  assertForwardProducerMetadata(observed.run,pin);
  for(const kind of ['installer','sidecar'])assertForwardArtifactMetadata(observed[kind],pin[kind+'_artifact'],observed.run);
  if(sidecar.producer.run_number!==observed.run.run_number||sidecar.producer.event!==observed.run.event)fail('sidecar_producer_readback_mismatch');
  const candidateRoot=path.join(roleRoot,'sidecar','win-unpacked'),installerFile=path.join(roleRoot,'installer',sidecar.installer.name);
  await assertForwardInputPath(candidateRoot,{directory:true});
  if(await hashForwardInputFile(installerFile)!==sidecar.installer.sha256)fail('installer_digest_mismatch');
  if((await captureInstalledTreeFingerprint(candidateRoot)).tree_sha256!==sidecar.image.tree_sha256)fail('image_digest_mismatch');
  const manifest=await readJson(path.join(candidateRoot,RUNTIME,'offline-runtime-bundle.json'));
  if(manifest.schema!=='compute.runtime-offline-bundle.v1'||manifest.bundle_sha256!==sidecar.runtime.bundle_sha256)fail('runtime_manifest_mismatch');
  let schemaFields={};
  if(sidecar.schema_fixture){
    const file=path.join(roleRoot,'sidecar',sidecar.schema_fixture.file);
    if(await hashForwardInputFile(file)!==sidecar.schema_fixture.sha256)fail('schema_fixture_digest_mismatch');
    schemaFields={schema_dump_file:file,schema_dump_sha256:sidecar.schema_fixture.sha256,schema_source_head:sidecar.schema_fixture.source_head,
      schema_fixture:{...sidecar.schema_fixture,file}};
  }
  return {...schemaFields,source_head:pin.source_head,package_version:pin.package_version,candidate_root:candidateRoot,installer_file:installerFile,
    installer_sha256:sidecar.installer.sha256,asar_sha256:sidecar.asar_sha256,uninstaller_sha256:sidecar.uninstaller.sha256,
    bundle_sha256:sidecar.runtime.bundle_sha256,image_tree_sha256:sidecar.image.tree_sha256,
    runtime_tree_sha256:sidecar.runtime.tree_sha256,pg_tree_sha256:sidecar.runtime.postgres_tree_sha256,
    producer_run_id:pin.producer_run_id,producer_run_attempt:pin.producer_run_attempt,producer_run_number:sidecar.producer.run_number,producer_event:sidecar.producer.event,
    producer_installed_image:sidecar.installed_image,installer_artifact:pin.installer_artifact,sidecar_artifact:pin.sidecar_artifact};
}
export async function verifyForwardInputDirectory({pins,inputRoot,expectedSourceHead}){
  pins=validateForwardInputPins(pins,{expectedSourceHead});await assertForwardInputPath(inputRoot,{directory:true});
  const result={schema:FORWARD_VERIFIED_SCHEMA,consumer_source_head:expectedSourceHead,input_root:path.resolve(inputRoot),pins,
    artifact_binding_sha256:digest(JSON.stringify(pins)),automatic_self_update_qualified:false,production_authorized:false};
  for(const role of ['predecessor','candidate']){
    const pin=pins[role],root=path.join(inputRoot,role),observed=await readJson(path.join(root,'producer-readback.json'));
    assertForwardProducerMetadata(observed.run,pin);
    for(const kind of ['installer','sidecar']){
      assertForwardArtifactMetadata(observed[kind],pin[kind+'_artifact'],observed.run);
      if(await hashForwardInputFile(path.join(root,kind+'.zip'))!==pin[kind+'_artifact'].sha256)fail('archive_digest_mismatch');
    }
    result[role]=await verifyForwardArtifactImage({pin,roleRoot:root,requireSchemaFixture:role==='predecessor'});
  }
  return result;
}

// Python's standard ZIP reader is available on hosted Windows and Linux. Entry
// validation happens before creating any extracted files; no shell is invoked.
const READ_MANIFEST_PY=String.raw`
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    matches = [r for r in z.infolist() if r.filename == 'forward-install-sidecar.json']
    if len(matches) != 1 or matches[0].orig_filename != matches[0].filename or matches[0].file_size > 16*1024**2: raise RuntimeError('sidecar_entry_invalid')
    sys.stdout.buffer.write(z.read(matches[0]))
`;
const EXTRACT_PY=String.raw`
import sys, os, stat, zipfile, re, shutil
archive, target = sys.argv[1:]
limit = 12 * 1024**3
with zipfile.ZipFile(archive) as z:
    rows = z.infolist()
    if not rows or len(rows) > 50000: raise RuntimeError('archive_entry_limit')
    seen, total = set(), 0
    for row in rows:
        # ZipInfo normalizes Windows separators and truncates NUL before exposing
        # filename. Validate the original central-directory name as well, so the
        # parser cannot silently turn forbidden metadata into an accepted path.
        if row.orig_filename != row.filename: raise RuntimeError('archive_path_normalized')
        name = row.orig_filename[:-1] if row.is_dir() else row.orig_filename
        parts = name.split('/')
        if not name or len(name) > 512 or len(parts) > 40 or any(not p or p in ('.','..') or re.search(r'[\\:\x00-\x1f<>"|?*]',p) or p.endswith(('.', ' ')) or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',p,re.I) for p in parts): raise RuntimeError('archive_path_invalid')
        key = name.lower()
        if key in seen: raise RuntimeError('archive_path_alias')
        seen.add(key)
        mode = row.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (row.external_attr & 0x400): raise RuntimeError('archive_link_forbidden')
        if row.flag_bits & 1 or row.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED): raise RuntimeError('archive_encoding_forbidden')
        total += row.file_size
        if total > limit: raise RuntimeError('archive_size_limit')
    os.mkdir(target)
    for row in rows:
        destination = os.path.join(target, *row.filename.rstrip('/').split('/'))
        if row.is_dir(): os.makedirs(destination, exist_ok=True); continue
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with z.open(row) as src, open(destination,'xb') as dst:
            count = 0
            while True:
                block = src.read(262144)
                if not block: break
                count += len(block)
                if count > row.file_size: raise RuntimeError('archive_size_mismatch')
                dst.write(block)
            if count != row.file_size: raise RuntimeError('archive_size_mismatch')
`;
export async function extractForwardArchive({archive,destination,expectedSha256}){
  if(!SHA.test(expectedSha256||''))fail('archive_pin_invalid');
  await assertForwardInputPath(destination,{directory:true,missingLeaf:true});
  if(await hashForwardInputFile(archive)!==expectedSha256)fail('archive_digest_mismatch');
  try{await promisify(execFile)(process.platform==='win32'?'python':'python3',['-c',EXTRACT_PY,archive,destination],{windowsHide:true,shell:false,timeout:300000,maxBuffer:16384});}
  catch{fail('archive_extraction_failed');}
  if(await hashForwardInputFile(archive)!==expectedSha256)fail('archive_changed_during_extraction');
  await captureInstalledTreeFingerprint(destination);
}
async function githubJson(route,token){
  const response=await fetch('https://api.github.com'+route,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)fail('github_read_failed');const text=await response.text();if(text.length>MAX_JSON)fail('github_response_limit');
  try{return JSON.parse(text);}catch{fail('github_response_invalid');}
}
async function downloadArchive({pin,metadata,file,token}){
  const signal=AbortSignal.timeout(600000);
  let response=await fetch(`https://api.github.com/repos/${FORWARD_REPOSITORY}/actions/artifacts/${pin.id}/zip`,{
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal,redirect:'manual'});
  if(response.status===302){
    const url=new URL(response.headers.get('location'));
    if(url.protocol!=='https:'||url.username||url.password
      ||!(url.hostname.endsWith('.blob.core.windows.net')||url.hostname.endsWith('.githubusercontent.com')||url.hostname==='results-receiver.actions.githubusercontent.com'))fail('archive_redirect_untrusted');
    response=await fetch(url,{signal,redirect:'error'}); // Never forward the API token to artifact storage.
  }
  if(!response.ok||!response.body)fail('artifact_download_failed');
  let bytes=0;const hash=createHash('sha256');
  const meter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>MAX_BYTES||bytes>metadata.size_in_bytes)return done(Error('qa_forward_inputs_archive_size_limit'));hash.update(chunk);done(null,chunk);}});
  await assertForwardInputPath(file,{missingLeaf:true});
  await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
  if(bytes!==metadata.size_in_bytes||hash.digest('hex')!==pin.sha256)fail('archive_digest_mismatch');
}
export async function acquireForwardInputs({pins,inputRoot,expectedSourceHead,token}){
  pins=validateForwardInputPins(pins,{expectedSourceHead});if(typeof token!=='string'||!token)fail('github_token_missing');
  await assertForwardInputPath(inputRoot,{directory:true,missingLeaf:true});
  const metadata={};
  // Resolve all exact prerequisite records before extracting any executable.
  for(const role of ['predecessor','candidate']){
    const pin=pins[role],run=await githubJson(`/repos/${FORWARD_REPOSITORY}/actions/runs/${pin.producer_run_id}`,token);
    assertForwardProducerMetadata(run,pin);
    const readback={run:{id:run.id,repository:{full_name:run.repository.full_name},path:run.path,head_sha:run.head_sha,
      run_attempt:run.run_attempt,run_number:run.run_number,status:run.status,conclusion:run.conclusion,event:run.event,
      run_started_at:run.run_started_at,updated_at:run.updated_at}};
    for(const kind of ['installer','sidecar']){
      const a=await githubJson(`/repos/${FORWARD_REPOSITORY}/actions/artifacts/${pin[kind+'_artifact'].id}`,token);
      assertForwardArtifactMetadata(a,pin[kind+'_artifact'],run);
      readback[kind]={id:a.id,name:a.name,expired:a.expired,digest:a.digest,size_in_bytes:a.size_in_bytes,
        workflow_run:{id:a.workflow_run.id,head_sha:a.workflow_run.head_sha},created_at:a.created_at};
    }
    metadata[role]=readback;
  }
  await assertForwardInputPath(inputRoot,{directory:true,missingLeaf:true});
  await fs.mkdir(inputRoot,{mode:0o700});
  await assertForwardInputPath(inputRoot,{directory:true});
  for(const role of ['predecessor','candidate']){
    const root=path.join(inputRoot,role);await assertForwardInputPath(root,{directory:true,missingLeaf:true});await fs.mkdir(root,{mode:0o700});
    await writeJson(path.join(root,'producer-readback.json'),metadata[role]);
    for(const kind of ['installer','sidecar']){
      const pin=pins[role][kind+'_artifact'],archive=path.join(root,kind+'.zip');
      await downloadArchive({pin,metadata:metadata[role][kind],file:archive,token});
      await extractForwardArchive({archive,destination:path.join(root,kind),expectedSha256:pin.sha256});
    }
  }
  const verified=await verifyForwardInputDirectory({pins,inputRoot,expectedSourceHead});
  await writeJson(path.join(inputRoot,'verified-inputs.json'),verified);
  return verified;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  (async()=>{
    const [mode,...args]=process.argv.slice(2),options={};
    if(mode!=='acquire'||args.length!==6)fail('arguments_invalid');
    for(let i=0;i<args.length;i+=2){if(!['--pins','--out','--expected-head'].includes(args[i])||options[args[i]])fail('arguments_invalid');options[args[i]]=args[i+1];}
    if(!Object.values(options).every(v=>typeof v==='string'&&v))fail('arguments_invalid');
    const pins=await readJson(path.resolve(options['--pins']));
    const verified=await acquireForwardInputs({pins,inputRoot:path.resolve(options['--out']),expectedSourceHead:options['--expected-head'],token:process.env.ME2_GITHUB_TOKEN});
    process.stdout.write(JSON.stringify({state:'INPUTS_VERIFIED',artifact_binding_sha256:verified.artifact_binding_sha256,consumer_source_head:verified.consumer_source_head,physical_migration_qualified:false})+'\n');
  })().catch(error=>{process.stderr.write(JSON.stringify({state:'BLOCKED',reason:/^qa_forward_inputs_[a-z_]+$/.test(error?.code||'')?error.code:'qa_forward_inputs_read_failed',physical_migration_qualified:false,automatic_retry_allowed:false})+'\n');process.exitCode=1;});
}
