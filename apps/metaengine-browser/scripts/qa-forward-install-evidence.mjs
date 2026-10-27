#!/usr/bin/env node
// Read-only acquisition and byte binding for the manual-forward consumer.
// This is not a producer, installer, Owner provisioner or automatic updater.
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyOfflineRuntimeBundle} from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import {validateForwardSidecar as validateCandidateManifest,validateForwardSidecarBinding,captureForwardInventory,hashForwardFile,
  validateForwardRelativePath} from './qa-forward-candidate-sidecar.mjs';
import {materializeForwardSidecar,materializeForwardArchive,verifyForwardArchiveFiles,
  readForwardArchiveMember} from './qa-forward-candidate-archive.mjs';
import {validateForwardPredecessorPin,verifyStrictForwardInstaller,verifyPredecessorMaterialization,
  materializePredecessorDirectories,readPredecessorArchiveDirectories,PREDECESSOR_CONFIG_SHA256,
  PREDECESSOR_CONFIG_CONTRACT,PREDECESSOR_ORIGIN} from './qa-forward-install-predecessor.mjs';
import {ORIGINAL_PREDECESSOR,PREDECESSOR_QUALIFIER_REFS} from './qualify-predecessor-materialization.mjs';
import {validateForwardSchemaPin,assertForwardSchemaQualification,verifyForwardSchemaDirectory,
  FORWARD_SCHEMA_FILES} from './qa-forward-install-schema.mjs';

export const FORWARD_INPUT_SCHEMA='metaengine.browser.manual-forward-inputs.v2';
export {FORWARD_SIDECAR_SCHEMA} from './qa-forward-candidate-sidecar.mjs';
export const FORWARD_VERIFIED_SCHEMA='metaengine.browser.manual-forward-verified-inputs.v2';
export const FORWARD_REPOSITORY='PatrickFrome/Compute';
export const FORWARD_PRODUCER='.github/workflows/browser-windows-package-smoke.yml';
const SHA=/^[a-f0-9]{64}$/,HEAD=/^[a-f0-9]{40}$/,ID=/^[1-9][0-9]{0,19}$/;
const VERSION=/^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const MAX_BYTES=13*1024**3,MAX_JSON=32*1024**2;
const CANDIDATE_CONFIG=fileURLToPath(new URL('../electron-builder.test.json',import.meta.url));
const ORIGINAL_CONFIG_SOURCE=PREDECESSOR_CONFIG_CONTRACT.source_path;
const ORIGINAL_CONFIG_FILE='original-electron-builder.test.json';
const ORIGINAL_CONFIG_SOURCE_FILE='original-electron-builder.source.json';
const ORIGINAL_CONFIG_READBACK_FILE='original-config-readback.json';
const ORIGINAL_CONFIG_SOURCE_SHA256=PREDECESSOR_CONFIG_CONTRACT.source_sha256;
const MAX_CONFIG=1024**2;
const RUNTIME='resources/client-state-runtime';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{const error=new Error('qa_forward_inputs_'+code);error.code=error.message;throw error;};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>record(value)&&Object.keys(value).every(k=>allowed.includes(k));
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const sameInfo=(a,b)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.nlink===b.nlink;

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
  if(!keys(value,['schema','candidate','predecessor','schema_fixture'])||Object.keys(value).length!==4
    ||value.schema!==FORWARD_INPUT_SCHEMA||!HEAD.test(expectedSourceHead||''))fail('pins_invalid');
  const candidate=packagePin(value.candidate),predecessor=validateForwardPredecessorPin(value.predecessor),schemaFixture=validateForwardSchemaPin(value.schema_fixture);
  if(candidate.source_head!==expectedSourceHead)fail('candidate_source_mismatch');
  if(candidate.source_head===predecessor.source_head||candidate.package_version===predecessor.package_version
    ||candidate.producer_run_id===predecessor.producer_run_id)fail('predecessor_not_distinct');
  if(candidate.package_version==='0.7.0-dev.1784381341133.1')fail('consumed_candidate_forbidden');
  const ids=[candidate.installer_artifact.id,candidate.sidecar_artifact.id,predecessor.installer_artifact.id,
    predecessor.qualification.artifact.id,schemaFixture.qualification.artifact.id];
  if(new Set(ids).size!==ids.length)fail('artifact_alias');
  const runs=[candidate.producer_run_id,predecessor.producer_run_id,predecessor.qualification.run_id,schemaFixture.qualification.run_id];
  if(new Set(runs).size!==runs.length)fail('qualification_origin_alias');
  return {schema:FORWARD_INPUT_SCHEMA,candidate,predecessor,schema_fixture:schemaFixture};
}

export function assertForwardProducerMetadata(run,pin){
  if(!record(run)||String(run.id)!==pin.producer_run_id||run.repository?.full_name!==FORWARD_REPOSITORY
    ||run.path!==FORWARD_PRODUCER||run.head_sha!==pin.source_head||run.run_attempt!==pin.producer_run_attempt
    ||!Number.isSafeInteger(run.run_number)||run.run_number<1
    ||run.status!=='completed'||run.conclusion!=='success'
    ||!['push','pull_request','workflow_dispatch'].includes(run.event)
    ||!Number.isFinite(Date.parse(run.run_started_at))||!Number.isFinite(Date.parse(run.updated_at))
    ||Date.parse(run.updated_at)<Date.parse(run.run_started_at))fail('producer_not_exact_terminal_success');
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
// Candidate schema and inventory authority lives in the shared Stream6 module.
// This small compatibility wrapper only compares the consumer's explicit pins.
export function validateForwardSidecar(value,pin){
  validateCandidateManifest(value);
  if(pin&&(value.source_head!==pin.source_head||value.package_version!==pin.package_version
    ||value.producer.run_id!==pin.producer_run_id||value.producer.run_attempt!==pin.producer_run_attempt
    ||['id','name','sha256'].some(k=>value.installer_artifact[k]!==pin.installer_artifact[k])))fail('sidecar_binding_invalid');
  return value;
}
export function assertForwardArtifactCollection(collection,expectedPins,run){
  if(!record(collection)||!Number.isSafeInteger(collection.total_count)||collection.total_count<1||collection.total_count>10000
    ||!Array.isArray(collection.artifacts)||collection.artifacts.length!==collection.total_count)fail('artifact_collection_incomplete');
  const ids=new Set();
  for(const artifact of collection.artifacts){
    if(!record(artifact)||!ID.test(String(artifact.id))||typeof artifact.name!=='string'||!artifact.name||ids.has(String(artifact.id)))fail('artifact_collection_ambiguous');
    ids.add(String(artifact.id));
  }
  for(const pin of expectedPins){
    const matches=collection.artifacts.filter(a=>a.name===pin.name);
    if(matches.length!==1)fail('artifact_collection_ambiguous');
    assertForwardArtifactMetadata(matches[0],pin,run);
  }
  return collection;
}
export function assertForwardQualifierMetadata(run,pin){
  if(!record(run)||String(run.id)!==pin.run_id||run.repository?.full_name!==FORWARD_REPOSITORY||pin.repository!==FORWARD_REPOSITORY
    ||run.path!==pin.workflow||run.head_sha!==pin.source_head||run.run_attempt!==pin.run_attempt
    ||!Number.isSafeInteger(run.run_number)||run.run_number<1||run.status!=='completed'||run.conclusion!=='success'
    ||!['push','pull_request','workflow_dispatch'].includes(run.event)
    ||!Number.isFinite(Date.parse(run.run_started_at))||!Number.isFinite(Date.parse(run.updated_at))
    ||Date.parse(run.updated_at)<Date.parse(run.run_started_at))fail('qualifier_not_exact_terminal_success');
  return true;
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
  // Keep the consumer's path diagnostics, but share Stream6's descriptor-based
  // no-follow, single-link, bounded hash and held ancestor-custody checks.
  return hashForwardFile(file,{maxBytes});
}
async function readJson(file){
  const before=await hashForwardInputFile(file,{maxBytes:MAX_JSON});
  const bytes=await fs.readFile(file);if(digest(bytes)!==before)fail('json_changed');
  try{return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{fail('json_invalid');}
}
async function writeInputFile(file,bytes){await assertForwardInputPath(file,{missingLeaf:true});const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function writeJson(file,value){await writeInputFile(file,JSON.stringify(value,null,2)+'\n');}

export async function verifyForwardArtifactImage({pin,roleRoot,producerReadback,configFile=CANDIDATE_CONFIG}){
  await assertForwardInputPath(roleRoot,{directory:true});
  if(!record(producerReadback))fail('producer_readback_required');
  const observed=producerReadback;
  assertForwardProducerMetadata(observed.run,pin);
  assertForwardArtifactCollection(observed.artifacts,[pin.installer_artifact,pin.sidecar_artifact],observed.run);
  await verifyForwardArchive({archive:path.join(roleRoot,'installer.zip'),destination:path.join(roleRoot,'installer'),expectedSha256:pin.installer_artifact.sha256});
  const sidecarDirectory=path.join(roleRoot,'sidecar'),manifestFile=path.join(sidecarDirectory,'forward-install-sidecar.json');
  const manifestSha=await assertForwardArchiveMember({archive:path.join(roleRoot,'sidecar.zip'),file:manifestFile,
    relative:'forward-install-sidecar.json',expectedSha256:pin.sidecar_artifact.sha256});
  const sidecarBytes=await fs.readFile(manifestFile);if(digest(sidecarBytes)!==manifestSha)fail('archive_member_changed');
  const sidecar=validateForwardSidecar(JSON.parse(sidecarBytes.toString('utf8')),pin);
  const expectedSidecarNames=['forward-install-sidecar.json','win-unpacked',...(sidecar.schema_fixture?[sidecar.schema_fixture.file]:[])].sort();
  const checkSidecarRoot=async()=>{
    await assertForwardInputPath(sidecarDirectory,{directory:true});
    if(JSON.stringify((await fs.readdir(sidecarDirectory)).sort())!==JSON.stringify(expectedSidecarNames))fail('sidecar_root_changed');
    if(await hashForwardInputFile(manifestFile,{maxBytes:MAX_JSON})!==manifestSha)fail('archive_member_changed');
    if(sidecar.schema_fixture&&await hashForwardInputFile(path.join(sidecarDirectory,sidecar.schema_fixture.file),{maxBytes:4*1024**3})!==sidecar.schema_fixture.sha256)fail('sidecar_schema_digest_mismatch');
  };
  await checkSidecarRoot();
  const candidateRoot=path.join(sidecarDirectory,'win-unpacked'),installerFile=path.join(roleRoot,'installer',sidecar.installer.name);
  const captured=await captureForwardInventory(candidateRoot);
  if(captured.tree_sha256!==sidecar.image.tree_sha256||JSON.stringify(captured.files)!==JSON.stringify(sidecar.image.files))fail('image_digest_mismatch');
  await verifyOfflineRuntimeBundle({bundleDirectory:path.join(candidateRoot,RUNTIME),expectedBundleDigest:sidecar.runtime.bundle_sha256});
  const installerEvidence=await verifyStrictForwardInstaller({pin,producerRun:observed.run,installerDirectory:path.join(roleRoot,'installer'),configFile});
  validateForwardSidecarBinding({manifest:sidecar,pin,producerRun:observed.run,artifacts:observed.artifacts.artifacts,
    artifactCount:observed.artifacts.total_count,installerEvidence});
  if(await hashForwardInputFile(installerFile)!==sidecar.installer.sha256)fail('installer_digest_mismatch');
  await verifyForwardArchive({archive:path.join(roleRoot,'installer.zip'),destination:path.join(roleRoot,'installer'),expectedSha256:pin.installer_artifact.sha256});
  if((await captureForwardInventory(candidateRoot)).tree_sha256!==sidecar.image.tree_sha256)fail('image_digest_mismatch');
  await checkSidecarRoot();
  return {source_head:pin.source_head,package_version:pin.package_version,candidate_root:candidateRoot,installer_file:installerFile,
    installer_sha256:sidecar.installer.sha256,asar_sha256:sidecar.asar_sha256,uninstaller_sha256:sidecar.uninstaller.sha256,
    bundle_sha256:sidecar.runtime.bundle_sha256,image_tree_sha256:sidecar.image.tree_sha256,
    runtime_tree_sha256:sidecar.runtime.tree_sha256,pg_tree_sha256:sidecar.runtime.postgres_tree_sha256,
    producer_run_id:pin.producer_run_id,producer_run_attempt:pin.producer_run_attempt,producer_run_number:sidecar.producer.run_number,producer_event:sidecar.producer.event,
    producer_installed_image:sidecar.installed_image,installer_artifact:pin.installer_artifact,sidecar_artifact:pin.sidecar_artifact,
    strict_installer_evidence:installerEvidence};
}
export async function verifyForwardInputDirectory({pins,inputRoot,expectedSourceHead,token=process.env.ME2_GITHUB_TOKEN}){
  pins=validateForwardInputPins(pins,{expectedSourceHead});await assertForwardInputPath(inputRoot,{directory:true});
  // Every consumption obtains live terminal/attempt readback. A serialized
  // descriptor or saved metadata is never a substitute for current provenance.
  const observed=await readForwardInputMetadata({pins,expectedSourceHead,token});
  const predecessorRoot=path.join(inputRoot,'predecessor'),schemaRoot=path.join(inputRoot,'schema-fixture');
  await verifyForwardArchive({archive:path.join(predecessorRoot,'installer.zip'),destination:path.join(predecessorRoot,'installer'),expectedSha256:pins.predecessor.installer_artifact.sha256});
  const qualificationDirectory=path.join(predecessorRoot,'qualification');
  const addedDirectories=await readPredecessorArchiveDirectories({pin:pins.predecessor,roleRoot:predecessorRoot});
  await verifyForwardArchive({archive:path.join(predecessorRoot,'qualification.zip'),destination:qualificationDirectory,
    expectedSha256:pins.predecessor.qualification.artifact.sha256,addedDirectories});
  const materializationSha256=await assertForwardArchiveMember({archive:path.join(predecessorRoot,'qualification.zip'),file:path.join(qualificationDirectory,'predecessor-materialization.json'),
    relative:'predecessor-materialization.json',expectedSha256:pins.predecessor.qualification.artifact.sha256});
  const originalConfigFile=path.join(predecessorRoot,ORIGINAL_CONFIG_FILE);
  const originalBuilderConfig=await verifyForwardOriginalConfig({roleRoot:predecessorRoot});
  const predecessor=await verifyPredecessorMaterialization({pin:pins.predecessor,roleRoot:predecessorRoot,materializationSha256,
    producerRun:observed.predecessor.run,qualificationRun:observed.predecessorQualification.run,
    configFile:originalConfigFile});
  await verifyForwardArchive({archive:path.join(predecessorRoot,'qualification.zip'),destination:qualificationDirectory,
    expectedSha256:pins.predecessor.qualification.artifact.sha256,addedDirectories});
  await verifyForwardArchive({archive:path.join(predecessorRoot,'installer.zip'),destination:path.join(predecessorRoot,'installer'),expectedSha256:pins.predecessor.installer_artifact.sha256});
  await verifyForwardArchive({archive:path.join(schemaRoot,'qualification.zip'),destination:path.join(schemaRoot,'qualification'),expectedSha256:pins.schema_fixture.qualification.artifact.sha256});
  const schemaManifestSha256=await assertForwardArchiveMember({archive:path.join(schemaRoot,'qualification.zip'),
    file:path.join(schemaRoot,'qualification',FORWARD_SCHEMA_FILES.manifest),relative:FORWARD_SCHEMA_FILES.manifest,
    expectedSha256:pins.schema_fixture.qualification.artifact.sha256});
  const schemaFixture=await verifyForwardSchemaDirectory({directory:path.join(schemaRoot,'qualification'),pin:pins.schema_fixture,
    run:observed.schemaQualification.run,artifacts:observed.schemaQualification.artifacts,manifestSha256:schemaManifestSha256});
  await verifyForwardArchive({archive:path.join(schemaRoot,'qualification.zip'),destination:path.join(schemaRoot,'qualification'),expectedSha256:pins.schema_fixture.qualification.artifact.sha256});
  const candidate=await verifyForwardArtifactImage({pin:pins.candidate,roleRoot:path.join(inputRoot,'candidate'),producerReadback:observed.candidate});
  await verifyForwardOriginalConfig({roleRoot:predecessorRoot});
  // Full tree/archive reads can take time. A newly queued rerun, expired or
  // removed artifact must also refuse after those reads and before return.
  await readForwardInputMetadata({pins,expectedSourceHead,token});
  return {schema:FORWARD_VERIFIED_SCHEMA,consumer_source_head:expectedSourceHead,input_root:path.resolve(inputRoot),pins,
    artifact_binding_sha256:digest(JSON.stringify(pins)),candidate,predecessor,schema_fixture:schemaFixture,
    original_builder_config:originalBuilderConfig,
    automatic_self_update_qualified:false,production_authorized:false};
}

// All generic archives share Stream6's raw ZIP/ZIP64 parser and physical-file
// guards. These wrappers preserve consumer diagnostics without a second parser.
export async function extractForwardArchive({archive,destination,expectedSha256}){
  if(!SHA.test(expectedSha256||''))fail('archive_pin_invalid');
  try{return await materializeForwardArchive({archiveFile:archive,archiveSha256:expectedSha256,destination});}
  catch{fail('archive_extraction_failed');}
}
export async function verifyForwardArchive({archive,destination,expectedSha256,addedDirectories=[]}){
  if(!SHA.test(expectedSha256||''))fail('archive_pin_invalid');
  try{await verifyForwardArchiveFiles({archiveFile:archive,archiveSha256:expectedSha256,directory:destination,addedDirectories});}
  catch{fail('archive_materialization_changed');}
  return true;
}
export async function assertForwardArchiveMember({archive,file,relative,expectedSha256}){
  validateForwardRelativePath(relative);
  if(!SHA.test(expectedSha256||''))fail('archive_pin_invalid');
  let member;
  try{member=await readForwardArchiveMember({archiveFile:archive,archiveSha256:expectedSha256,memberName:relative,maxBytes:MAX_JSON});}
  catch{fail('archive_member_invalid');}
  if(member.sha256!==await hashForwardInputFile(file,{maxBytes:MAX_JSON}))fail('archive_member_changed');
  if(await hashForwardInputFile(archive)!==expectedSha256)fail('archive_changed_during_read');
  return member.sha256;
}
async function githubJson(route,token){
  const response=await fetch('https://api.github.com'+route,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)fail('github_read_failed');const text=await response.text();if(text.length>MAX_JSON)fail('github_response_limit');
  try{return JSON.parse(text);}catch{fail('github_response_invalid');}
}
function materializeOriginalConfig(sourceBytes){
  if(sourceBytes.length!==PREDECESSOR_CONFIG_CONTRACT.source_bytes||digest(sourceBytes)!==ORIGINAL_CONFIG_SOURCE_SHA256||sourceBytes.includes(13)
    ||sourceBytes.reduce((n,b)=>n+Number(b===10),0)!==PREDECESSOR_CONFIG_CONTRACT.materialized_bytes-PREDECESSOR_CONFIG_CONTRACT.source_bytes
    ||sourceBytes.at(-1)!==10)fail('original_config_source_digest_mismatch');
  let sourceText;
  try{sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(sourceBytes);}catch{fail('original_config_source_invalid');}
  if(!Buffer.from(sourceText,'utf8').equals(sourceBytes))fail('original_config_source_invalid');
  // Explicit original Windows-checkout representation, authorized by the
  // two-hash contract. No generic newline fallback or JSON reserialization.
  const bytes=Buffer.from(sourceText.replace(/\n/g,'\r\n'),'utf8');
  if(bytes.length!==PREDECESSOR_CONFIG_CONTRACT.materialized_bytes||digest(bytes)!==PREDECESSOR_CONFIG_SHA256)fail('original_config_digest_mismatch');
  const readback={schema:'metaengine.browser.forward-original-builder-config.v1',
    source:{repository:FORWARD_REPOSITORY,source_head:PREDECESSOR_ORIGIN.source_head,path:ORIGINAL_CONFIG_SOURCE,
      git_blob_sha1:createHash('sha1').update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest('hex'),
      sha256:ORIGINAL_CONFIG_SOURCE_SHA256,bytes:sourceBytes.length},
    materialization:{mode:PREDECESSOR_CONFIG_CONTRACT.materialization,sha256:PREDECESSOR_CONFIG_SHA256,bytes:bytes.length}};
  return {sourceBytes,bytes,readback};
}
export async function readForwardOriginalConfig({token}){
  if(typeof token!=='string'||!token)fail('github_token_missing');
  const response=await githubJson(`/repos/${FORWARD_REPOSITORY}/contents/${ORIGINAL_CONFIG_SOURCE}?ref=${PREDECESSOR_ORIGIN.source_head}`,token);
  if(!record(response)||response.type!=='file'||response.path!==ORIGINAL_CONFIG_SOURCE||response.name!=='electron-builder.test.json'
    ||response.encoding!=='base64'||typeof response.content!=='string'||!HEAD.test(response.sha||'')
    ||!Number.isSafeInteger(response.size)||response.size<1||response.size>MAX_CONFIG)fail('original_config_source_invalid');
  const encoded=response.content.replace(/\r?\n/g,'');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('original_config_source_invalid');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==response.size||bytes.toString('base64')!==encoded
    ||createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==response.sha)fail('original_config_source_invalid');
  return materializeOriginalConfig(bytes);
}
export async function verifyForwardOriginalConfig({roleRoot}){
  const sourceFile=path.join(roleRoot,ORIGINAL_CONFIG_SOURCE_FILE),configFile=path.join(roleRoot,ORIGINAL_CONFIG_FILE);
  const sourceDigest=await hashForwardInputFile(sourceFile,{maxBytes:MAX_CONFIG}),sourceBytes=await fs.readFile(sourceFile);
  if(digest(sourceBytes)!==sourceDigest)fail('original_config_changed');
  const expected=materializeOriginalConfig(sourceBytes);
  if(await hashForwardInputFile(configFile,{maxBytes:MAX_CONFIG})!==PREDECESSOR_CONFIG_SHA256
    ||!(await fs.readFile(configFile)).equals(expected.bytes))fail('original_config_digest_mismatch');
  if(JSON.stringify(await readJson(path.join(roleRoot,ORIGINAL_CONFIG_READBACK_FILE)))!==JSON.stringify(expected.readback))fail('original_config_readback_mismatch');
  if(await hashForwardInputFile(sourceFile,{maxBytes:MAX_CONFIG})!==ORIGINAL_CONFIG_SOURCE_SHA256
    ||await hashForwardInputFile(configFile,{maxBytes:MAX_CONFIG})!==PREDECESSOR_CONFIG_SHA256)fail('original_config_changed');
  return expected.readback;
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
function sanitizeReadback(run,collection){
  return {run:{id:run.id,repository:{full_name:run.repository.full_name},path:run.path,head_sha:run.head_sha,head_branch:run.head_branch,
    run_attempt:run.run_attempt,run_number:run.run_number,status:run.status,conclusion:run.conclusion,event:run.event,
    run_started_at:run.run_started_at,updated_at:run.updated_at},
    artifacts:{total_count:collection.total_count,artifacts:collection.artifacts.map(a=>({id:a.id,name:a.name,expired:a.expired,digest:a.digest,
      size_in_bytes:a.size_in_bytes,workflow_run:a.workflow_run?{id:a.workflow_run.id,head_sha:a.workflow_run.head_sha}:null,created_at:a.created_at}))}};
}
async function completeArtifacts(runId,token){
  const artifacts=[];let expected;
  for(let page=1;page<=100;page++){
    const response=await githubJson(`/repos/${FORWARD_REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,token);
    if(!Number.isSafeInteger(response.total_count)||response.total_count<1||response.total_count>10000||!Array.isArray(response.artifacts)
      ||(expected!==undefined&&expected!==response.total_count))fail('artifact_collection_changed');
    expected=response.total_count;artifacts.push(...response.artifacts);
    if(artifacts.length>expected||(!response.artifacts.length&&artifacts.length<expected))fail('artifact_collection_incomplete');
    if(artifacts.length===expected)return {total_count:expected,artifacts};
  }
  fail('artifact_collection_incomplete');
}
export async function readForwardInputMetadata({pins,expectedSourceHead,token}){
  pins=validateForwardInputPins(pins,{expectedSourceHead});if(typeof token!=='string'||!token)fail('github_token_missing');
  const read=async(runId,validate,expectedArtifacts)=>{
    const run=await githubJson(`/repos/${FORWARD_REPOSITORY}/actions/runs/${runId}`,token);validate(run);
    const collection=await completeArtifacts(runId,token);assertForwardArtifactCollection(collection,expectedArtifacts,run);
    // A run can be rerun while its artifact catalog is read. Require the same
    // terminal observation again before any artifact bytes become executable.
    const final=await githubJson(`/repos/${FORWARD_REPOSITORY}/actions/runs/${runId}`,token);validate(final);
    for(const key of ['id','head_sha','head_branch','run_attempt','run_number','event','run_started_at','updated_at'])if(final[key]!==run[key])fail('run_changed_during_catalog_read');
    return sanitizeReadback(final,collection);
  };
  const candidate=await read(pins.candidate.producer_run_id,r=>assertForwardProducerMetadata(r,pins.candidate),[pins.candidate.installer_artifact,pins.candidate.sidecar_artifact]);
  const predecessor=await read(pins.predecessor.producer_run_id,r=>{
    assertForwardProducerMetadata(r,pins.predecessor);
    if(r.run_number!==ORIGINAL_PREDECESSOR.run_number||r.event!==ORIGINAL_PREDECESSOR.event)fail('original_producer_identity_mismatch');
  },[pins.predecessor.installer_artifact]);
  if(predecessor.artifacts.artifacts.find(a=>String(a.id)===pins.predecessor.installer_artifact.id).size_in_bytes!==ORIGINAL_PREDECESSOR.artifact_bytes)fail('original_artifact_size_mismatch');
  const predecessorQualification=await read(pins.predecessor.qualification.run_id,r=>{
    assertForwardQualifierMetadata(r,pins.predecessor.qualification);
    if(!PREDECESSOR_QUALIFIER_REFS.includes('refs/heads/'+r.head_branch)||!['push','workflow_dispatch'].includes(r.event))fail('qualifier_branch_or_event_unapproved');
  },[pins.predecessor.qualification.artifact]);
  const schemaQualification=await read(pins.schema_fixture.qualification.run_id,r=>assertForwardQualifierMetadata(r,pins.schema_fixture.qualification),[pins.schema_fixture.qualification.artifact]);
  assertForwardSchemaQualification({pin:pins.schema_fixture,run:schemaQualification.run,artifacts:schemaQualification.artifacts});
  return {candidate,predecessor,predecessorQualification,schemaQualification};
}
export async function acquireForwardInputs({pins,inputRoot,expectedSourceHead,token}){
  pins=validateForwardInputPins(pins,{expectedSourceHead});
  await assertForwardInputPath(inputRoot,{directory:true,missingLeaf:true});
  const observed=await readForwardInputMetadata({pins,expectedSourceHead,token});
  const originalConfig=await readForwardOriginalConfig({token});
  // All four origins and complete catalogs must qualify before writing inputs.
  await assertForwardInputPath(inputRoot,{directory:true,missingLeaf:true});await fs.mkdir(inputRoot,{mode:0o700});
  const roles=[['candidate',observed.candidate],['predecessor',observed.predecessor],['schema-fixture',observed.schemaQualification]];
  for(const [role,readback] of roles){const root=path.join(inputRoot,role);await fs.mkdir(root,{mode:0o700});await writeJson(path.join(root,'producer-readback.json'),readback);}
  await writeInputFile(path.join(inputRoot,'predecessor',ORIGINAL_CONFIG_SOURCE_FILE),originalConfig.sourceBytes);
  await writeInputFile(path.join(inputRoot,'predecessor',ORIGINAL_CONFIG_FILE),originalConfig.bytes);
  await writeJson(path.join(inputRoot,'predecessor',ORIGINAL_CONFIG_READBACK_FILE),originalConfig.readback);
  await writeJson(path.join(inputRoot,'predecessor','qualification-readback.json'),observed.predecessorQualification);
  const materialize=async(root,kind,pin,readback,sidecar=false)=>{
    const archive=path.join(root,kind+'.zip'),metadata=readback.artifacts.artifacts.find(a=>String(a.id)===pin.id);
    await downloadArchive({pin,metadata,file:archive,token});
    if(sidecar)await materializeForwardSidecar({archiveFile:archive,archiveSha256:pin.sha256,destination:path.join(root,kind)});
    else await extractForwardArchive({archive,destination:path.join(root,kind),expectedSha256:pin.sha256});
  };
  const candidateRoot=path.join(inputRoot,'candidate'),predecessorRoot=path.join(inputRoot,'predecessor');
  await materialize(candidateRoot,'installer',pins.candidate.installer_artifact,observed.candidate);
  await materialize(candidateRoot,'sidecar',pins.candidate.sidecar_artifact,observed.candidate,true);
  await materialize(predecessorRoot,'installer',pins.predecessor.installer_artifact,observed.predecessor);
  await materialize(predecessorRoot,'qualification',pins.predecessor.qualification.artifact,observed.predecessorQualification);
  await materializePredecessorDirectories({pin:pins.predecessor,roleRoot:predecessorRoot});
  await materialize(path.join(inputRoot,'schema-fixture'),'qualification',pins.schema_fixture.qualification.artifact,observed.schemaQualification);
  const verified=await verifyForwardInputDirectory({pins,inputRoot,expectedSourceHead,token});
  await writeJson(path.join(inputRoot,'verified-inputs.json'),verified);
  return verified;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  (async()=>{
    const [mode,...args]=process.argv.slice(2),options={};
    if(mode!=='acquire'||args.length!==6)fail('arguments_invalid');
    for(let i=0;i<args.length;i+=2){if(!['--pins','--out','--expected-head'].includes(args[i])||options[args[i]])fail('arguments_invalid');options[args[i]]=args[i+1];}
    if(!Object.values(options).every(v=>typeof v==='string'&&v))fail('arguments_invalid');
    const token=process.env.ME2_GITHUB_TOKEN;delete process.env.ME2_GITHUB_TOKEN;
    const pins=await readJson(path.resolve(options['--pins']));
    const verified=await acquireForwardInputs({pins,inputRoot:path.resolve(options['--out']),expectedSourceHead:options['--expected-head'],token});
    process.stdout.write(JSON.stringify({state:'INPUTS_VERIFIED',artifact_binding_sha256:verified.artifact_binding_sha256,consumer_source_head:verified.consumer_source_head,physical_migration_qualified:false})+'\n');
  })().catch(error=>{process.stderr.write(JSON.stringify({state:'BLOCKED',reason:/^qa_forward_inputs_[a-z_]+$/.test(error?.code||'')?error.code:'qa_forward_inputs_read_failed',physical_migration_qualified:false,automatic_retry_allowed:false})+'\n');process.exitCode=1;});
}
