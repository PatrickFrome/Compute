import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec=promisify(execFile);
const SHA=/^[0-9a-f]{64}$/;
const CONFIG_KEYS=['schema','version','bundle_directory','expected_bundle_sha256','state_directory',
  'pg_data_directory','database_url','inspect_database_url','api_port','edge_port','startup_timeout_ms'];
const local=p=>typeof p==='string'&&p.length<2048&&path.isAbsolute(p)
  && !/^(?:\\\\|\/\/)/.test(p)&&!/[\x00-\x1f]/.test(p);
const fail=x=>{throw new Error('pg17_auto_prepare_'+x);};
const same=(a,b)=>process.platform==='win32'?
  path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const prefix=(root,other)=>{
  const rel=path.relative(root,other);
  return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));
};
async function absent(filename) {
  try{await fs.lstat(filename);fail('existing_destination_requires_review');}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
async function physical(p,type) {
  if(!local(p))fail('local_path_required');
  let current=path.parse(path.resolve(p)).root;
  for(const part of path.relative(current,p).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    const st=await fs.lstat(current);
    if(st.isSymbolicLink() || (current===p
      ? type==='file'?!st.isFile()||st.nlink!==1:!st.isDirectory()
      : !st.isDirectory()))fail('path_alias_or_type_forbidden');
  }
  return fs.realpath(p);
}
async function hashFile(filename) {
  const h=createHash('sha256');
  for await(const chunk of createReadStream(filename))h.update(chunk);
  return h.digest('hex');
}
async function inspectCluster(executable,data,run,{stopped=false}={}) {
  let stdout;
  try{({stdout}=await run(executable,['-D',data],{
    windowsHide:true,shell:false,timeout:15000,maxBuffer:128*1024,
    // Windows owners may have Russian or another locale. PostgreSQL
    // control state is a machine-read protocol: force stable C messages.
    env:{...process.env,LANG:'C',LC_ALL:'C',LC_MESSAGES:'C'},
  }));}
  catch{fail('pg_control_state_unverified');}
  const identifier=/^\s*Database system identifier:\s*(\d{10,25})\s*$/im.exec(stdout)?.[1];
  if(!identifier)fail('pg_system_identity_unverified');
  // Original PGDATA may still say 'in production' due to its historic stale
  // postmaster state. It is read-only identity evidence, never a copy source.
  if(stopped && !/^\s*Database cluster state:\s*shut down\s*$/im.test(stdout))
    fail('pg_control_not_cleanly_shut_down');
  return identifier;
}
async function filesIn(data,{maxFiles=100000,maxBytes=20*1024**3,directories=null}={}){
  const found=[],stack=[{at:data,rel:''}];
  let total=0;
  while(stack.length){
    const {at,rel}=stack.pop();
    const rows=(await fs.readdir(at,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
    for(const item of rows){
      if(!item.name||item.name==='.'||item.name==='..'||item.name.includes(':'))fail('path_invalid');
      const sub=rel?rel+'/'+item.name:item.name;
      const absolute=path.join(at,item.name);
      const st=await fs.lstat(absolute);
      if(st.isSymbolicLink())fail('linked_pgdata_forbidden');
      if(st.isDirectory()){
        if(directories)directories.push(sub);
        if(sub==='pg_tblspc'&& (await fs.readdir(absolute)).length)fail('external_tablespace_forbidden');
        stack.push({at:absolute,rel:sub});
      } else if(st.isFile()&&st.nlink===1){
        total+=st.size;
        if(total>maxBytes||found.length>=maxFiles)fail('database_size_limit');
        found.push({rel:sub,size:st.size,mtimeMs:st.mtimeMs});
      }else fail('unsupported_pgdata_entry');
    }
  }
  return found.sort((a,b)=>a.rel.localeCompare(b.rel,'en'));
}
function validatePreviousConfig(config) {
  if(!config||Array.isArray(config)||Object.keys(config).sort().join('|')!==[...CONFIG_KEYS].sort().join('|')
    ||config.schema!=='compute.runtime-host-config.v1'||config.version!==1
    ||!SHA.test(config.expected_bundle_sha256||'')
    ||![config.bundle_directory,config.state_directory,config.pg_data_directory].every(local)
    || !['database_url','inspect_database_url'].every(k=>{
      try{const url=new URL(config[k]);return ['postgresql:','postgres:'].includes(url.protocol)&&url.hostname==='127.0.0.1';}
      catch{return false;}
    })
    || ![config.api_port,config.edge_port].every(x=>Number.isSafeInteger(x)&&x>=1024&&x<=65535)
    || !Number.isSafeInteger(config.startup_timeout_ms)
    || config.startup_timeout_ms<1000||config.startup_timeout_ms>300000
    || !prefix(config.state_directory,config.pg_data_directory)
    || same(config.state_directory,config.pg_data_directory)
    || prefix(config.bundle_directory,config.state_directory)
    || prefix(config.state_directory,config.bundle_directory)
    || new Set([config.api_port,config.edge_port,
      Number(new URL(config.database_url).port)]).size!==3
    || !['database_url','inspect_database_url'].every(k=>Number(new URL(config[k]).port)>0)
    || new URL(config.database_url).port!==new URL(config.inspect_database_url).port
    || new URL(config.database_url).pathname!==new URL(config.inspect_database_url).pathname
    || new URL(config.database_url).username===new URL(config.inspect_database_url).username)
    fail('old_private_config_unverified');
  return config;
}
async function readOldConfig(filename){
  await physical(filename,'file');
  const stat=await fs.lstat(filename);
  if(stat.size>16384||stat.size<1)fail('old_private_config_unverified');
  const old=await fs.readFile(filename);
  if((await fs.lstat(filename)).mtimeMs!==stat.mtimeMs)fail('old_config_changed');
  try{return validatePreviousConfig(JSON.parse(old.toString('utf8')));}
  catch{fail('old_private_config_unverified');}
}

/**
 * First run: copy exactly one cleanly stopped temporary PG17 copy into a
 * permanent owner directory, then produce a NEW private config bound to the
 * sealed current installation. Never read original live PGDATA to copy.
 *
 * The restore report + independent digest remain mandatory at the next stage.
 * Nothing is uploaded, restored, initialized, wiped, or rewritten in-place.
 * All failures leave original files and partial target for manual review.
 */
export async function prepareDurableRestoredPg17({
  oldConfigFile, localAppData, bundleDirectory, bundleDigest,
  restoreReceiptFile, restoreReceiptSha256,
  postgresBinDirectory, tempDirectory=os.tmpdir(), platform=process.platform,
  run=exec, sourceOverride=null,
  protectStorage=protectOwnerOnlyWindowsDirectory, verifyStorage=verifyOwnerOnlyWindowsStorage,
}={}){
  if(platform!=='win32'||![oldConfigFile,localAppData,bundleDirectory,
    postgresBinDirectory,tempDirectory,restoreReceiptFile].every(local)
    ||![bundleDigest,restoreReceiptSha256].every(x=>SHA.test(x||'')))fail('arguments_invalid');
  // Independent existing restore report and its caller-supplied pin are
  // prerequisites for any persistent copy, not post-copy diagnostics.
  await physical(restoreReceiptFile,'file');
  const reportStat=await fs.lstat(restoreReceiptFile);
  if(reportStat.size<1||reportStat.size>4*1024*1024)fail('restore_report_invalid');
  const reportBytes=await fs.readFile(restoreReceiptFile);
  if(createHash('sha256').update(reportBytes).digest('hex')!==restoreReceiptSha256
    ||(await fs.lstat(restoreReceiptFile)).mtimeMs!==reportStat.mtimeMs)
    fail('restore_report_pin_unverified');
  let report;
  try{report=JSON.parse(reportBytes.toString('utf8'));}
  catch{fail('restore_report_invalid');}
  if(report?.schema!=='metaengine.database-restore-report.v1'
    ||report.data_verified!==true||report.schema_verified!==true
    ||!Array.isArray(report.errors)||report.errors.length!==0
    ||!Array.isArray(report.ddl_adaptations)||!SHA.test(report.source_dump_sha256||''))
    fail('restore_report_unverified');
  const prior=await readOldConfig(oldConfigFile);
  await physical(tempDirectory,'directory');
  await physical(localAppData,'directory');
  // Ensure no private database is ever copied into the sealed app bundle,
  // into source checkout, or into the selected original PGDATA directory.
  const parent=path.join(localAppData,'METAENGINE');
  const state=path.join(parent,'restored-postgres-17');
  const destination=path.join(state,'data');
  if(prefix(prior.pg_data_directory,state)||prefix(state,prior.pg_data_directory)
    ||prefix(bundleDirectory,state)||prefix(state,bundleDirectory))fail('private_state_overlap');
  await absent(state);
  let sources=[];
  if(sourceOverride!==null){
    if(!local(sourceOverride)||!prefix(tempDirectory,sourceOverride))fail('source_not_temporary');
    sources=[sourceOverride];
  }else{
    const dirs=await fs.readdir(tempDirectory,{withFileTypes:true});
    for(const item of dirs){
      if(!item.isDirectory()||!/^compute-restored-provider-[A-Za-z0-9_-]{4,40}$/.test(item.name))continue;
      const candidate=path.join(tempDirectory,item.name,'data');
      try {
        await physical(candidate,'directory');
        const version=(await fs.readFile(path.join(candidate,'PG_VERSION'),'utf8')).trim();
        if(version==='17')sources.push(candidate);
      }catch{}
    }
  }
  if(sources.length!==1)fail(sources.length?'multiple_candidates_requires_review':'stopped_copy_not_found');
  const source=path.resolve(sources[0]);
  // The old config must identify an independent original cluster, not the
  // chosen temporary clone itself. Comparing a clone to itself would make
  // the PostgreSQL/Vault origin attestation meaningless.
  if(same(source,prior.pg_data_directory)
    ||prefix(source,prior.pg_data_directory)
    ||prefix(prior.pg_data_directory,source))
    fail('independent_original_required');
  await physical(source,'directory');
  const reference=prior.pg_data_directory;
  await physical(reference,'directory');
  await physical(path.join(reference,'global','pg_control'),'file');
  await physical(path.join(reference,'client-vault.key'),'file');
  if((await fs.readFile(path.join(reference,'PG_VERSION'),'utf8')).trim()!=='17')
    fail('original_major_mismatch');
  const vaultReference=await fs.readFile(path.join(reference,'client-vault.key'));
  if(!/^[a-f0-9]{64}\n$/.test(vaultReference.toString()))
    fail('original_vault_unverified');
  const controlExe=path.join(postgresBinDirectory,'pg_controldata.exe');
  const referenceIdentity=await inspectCluster(controlExe,reference,run);
  await physical(path.join(source,'global','pg_control'),'file');
  await physical(path.join(source,'client-vault.key'),'file');
  if((await fs.readFile(path.join(source,'PG_VERSION'),'utf8')).trim()!=='17')fail('postgres_major_mismatch');
  const sourceVault=await fs.readFile(path.join(source,'client-vault.key'));
  if(!/^[a-f0-9]{64}\n$/.test(sourceVault.toString())||!sourceVault.equals(vaultReference))
    fail('vault_identity_mismatch');
  await absent(path.join(source,'postmaster.pid'));
  if((await inspectCluster(controlExe,source,run,{stopped:true}))!==referenceIdentity)
    fail('postgres_system_identity_mismatch');
  const directories=[];
  const files=await filesIn(source,{directories});
  for(const name of ['PG_VERSION','global/pg_control','client-vault.key']){
    if(!files.some(f=>f.rel===name))fail('required_cluster_file_missing');
  }
  // Fail rather than adopting a partial/unreviewed destination or overwriting
  // an existing owner config. Exclusive writes and no cleanup/retry on failure.
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  await physical(parent,'directory');
  await absent(state);
  await fs.mkdir(state,{mode:0o700});
  // mode=0700 is not a Windows DACL. Verify a restricted, inheritance-enabled
  // owner/SYSTEM/Administrators security descriptor before any copied private
  // PGDATA or database credentials can be created under this directory.
  const protection=await protectStorage(state);
  if(protection?.owner_dacl_verified!==true)fail('private_storage_acl_unverified');
  const staging=path.join(state,'.data-copy-pending');
  await fs.mkdir(staging,{mode:0o700});
  if((await verifyStorage(staging,{operation:'VERIFY_DIRECTORY'}))?.owner_dacl_verified!==true)
    fail('private_storage_acl_unverified');
  const digests=[];
  for(const dir of directories.sort((a,b)=>a.split('/').length-b.split('/').length))
    await fs.mkdir(path.join(staging,dir),{recursive:true,mode:0o700});
  for(const item of files){
    const sourceFile=path.join(source,item.rel);
    const target=path.join(staging,item.rel);
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    const before=await fs.lstat(sourceFile);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1
      ||before.size!==item.size||before.mtimeMs!==item.mtimeMs)fail('source_changed');
    const original=await hashFile(sourceFile);
    // Node's Win32 CopyFile may preserve the TEMP source's permissive DACL.
    // An exclusive NEW file stream inherits the protected target directory's
    // ACL instead; verify file hashes after the copy and rehash the source.
    await pipeline(createReadStream(sourceFile),
      createWriteStream(target,{flags:'wx',mode:0o600}));
    const dest=await fs.lstat(target);
    if(dest.size!==item.size || (await hashFile(target))!==original
      || (await hashFile(sourceFile))!==original)fail('copy_verification_failed');
    digests.push({path:item.rel,size:item.size,sha256:original});
  }
  // Source remains cleanly shut down even after a potentially lengthy copy.
  await absent(path.join(source,'postmaster.pid'));
  if((await inspectCluster(controlExe,source,run,{stopped:true}))!==referenceIdentity
    ||(await inspectCluster(controlExe,staging,run,{stopped:true}))!==referenceIdentity)
    fail('postgres_system_identity_mismatch');
  if(!(await fs.readFile(path.join(reference,'client-vault.key'))).equals(vaultReference))
    fail('original_vault_changed');
  if(JSON.stringify((await filesIn(source)).map(x=>[x.rel,x.size,x.mtimeMs])) !==
      JSON.stringify(files.map(x=>[x.rel,x.size,x.mtimeMs])))fail('source_changed');
  for(let index=0;index<files.length;index++){
    const filename=path.join(source,files[index].rel);
    if((await hashFile(filename))!==digests[index].sha256)
      fail('source_digest_changed_after_copy');
  }
  const targetDirs=[];
  if((await filesIn(staging,{directories:targetDirs})).length!==files.length
    ||JSON.stringify(targetDirs.sort())!==JSON.stringify(directories.sort()))fail('copy_file_count_mismatch');
  await fs.rename(staging,destination);
  if((await verifyStorage(destination,{operation:'VERIFY_DIRECTORY'}))?.owner_dacl_verified!==true)
    fail('private_storage_acl_unverified');
  const updated={...prior,bundle_directory:bundleDirectory,expected_bundle_sha256:bundleDigest,
    state_directory:state,pg_data_directory:destination};
  const configFile=path.join(state,'runtime-host-config.json');
  const configBytes=JSON.stringify(updated,null,2)+'\n';
  // Never rewrite or publish source config. This is PRIVATE host state, not a
  // resource inside app.asar, GitHub or CI artifacts.
  await fs.writeFile(configFile,configBytes,{flag:'wx',mode:0o600});
  const privatePaths=[configFile,path.join(destination,'client-vault.key'),
    path.join(destination,'global','pg_control')];
  for(const entry of privatePaths){
    const checked=await verifyStorage(entry);
    if(checked?.owner_dacl_verified!==true)fail('private_file_acl_unverified');
  }
  const proof=path.join(state,'pg17-copy-proof.json');
  const manifestHash=createHash('sha256').update(JSON.stringify(digests)).digest('hex');
  await fs.writeFile(proof,JSON.stringify({
    schema:'metaengine.pg17-copy-proof.v1',state:'COPIED_AND_VERIFIED',
    file_count:digests.length,bytes:digests.reduce((n,r)=>n+r.size,0),
    file_digest_manifest_sha256:manifestHash,vault_key_preserved:true,
    pg_control_stopped_verified:true,source_system_identity_matched_original:true,
    vault_key_matched_original:true,external_tablespaces_accepted:false,
    original_source_modified:false,automatic_retry_allowed:false,
  },null,2)+'\n',{flag:'wx',mode:0o600});
  if((await verifyStorage(proof))?.owner_dacl_verified!==true)
    fail('private_file_acl_unverified');
  return Object.freeze({configFile,stateDirectory:state,pgDataDirectory:destination,
    fileCount:digests.length,copyVerified:true,vaultPreserved:true,automaticRetryAllowed:false});
}
