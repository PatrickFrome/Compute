import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {verifyOwnerOnlyWindowsStorage} from './private-windows-storage-acl.mjs';
import {nativeCodingCanonicalSha256 as digest} from './native-coding-task-context.mjs';

export const CODEX_EXECUTION_SCOPE_SCHEMA='metaengine.codex-cli.execution-scope.v2';
const fail=reason=>{throw Error('codex_cli_policy_'+reason);};
const check=signal=>{if(signal?.aborted)fail('request_cancelled');};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const modeValid=mode=>['workspace-write','read-only'].includes(mode);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&value.length<2048
  &&!/[\x00-\x1f]/.test(value)&&!value.startsWith('\\\\')&&!value.startsWith('//')&&same(path.resolve(value),value);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};

// Shared explicit bounds only. These do not erase configuration layers or
// establish equivalence between `exec` and `sandbox` configuration loading.
export function codexCliPermissionOverrides(mode) {
  if(!modeValid(mode))fail('mode_invalid');
  return ['-c','windows.sandbox="elevated"','-c',`sandbox_mode="${mode}"`,
    '-c','sandbox_workspace_write.writable_roots=[]','-c','sandbox_workspace_write.network_access=false'];
}

// Bind the actual invocation without persisting environment values, which may
// include credentials. This digest is data, never an authorization capability.
export function codexCliInvocationFingerprint({args,env,cwd}={}) {
  if(!absolute(cwd)||!Array.isArray(args)||args.length>256
    ||args.some(value=>typeof value!=='string'||value.includes('\0'))
    ||!env||typeof env!=='object'||Array.isArray(env))fail('invocation_invalid');
  const environment={};
  for(const [key,value]of Object.entries(env)){
    if(!key||/[\x00-\x1f=]/.test(key)||typeof value!=='string'||value.includes('\0'))fail('environment_invalid');
    const name=key.toUpperCase();
    if(Object.hasOwn(environment,name)&&environment[name]!==value)fail('environment_case_collision');
    environment[name]=value;
  }
  return digest({schema:'metaengine.codex-cli.invocation-fingerprint.v1',args,cwd,environment});
}

const fileInventory=stat=>['dev','ino','birthtimeNs','ctimeNs','mtimeNs','size','nlink'].map(key=>String(stat[key]));
async function sourceDirectoryIdentity(directory,signal) {
  // Some Linux overlay filesystems expose high-bit inode numbers through
  // signed bigint stats. Their exact nonzero value is still an identity. The
  // chosen writable roots retain the stricter shared Windows identity reader.
  check(signal);if(!absolute(directory))fail('path_unverified');
  const before=await fs.lstat(directory,{bigint:true});
  if(!before.isDirectory()||before.isSymbolicLink()||before.ino===0n||before.birthtimeNs<=0n)fail('path_unverified');
  for(let current=directory;;current=path.dirname(current)){
    check(signal);const stat=await fs.lstat(current);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!same(await fs.realpath(current),current))fail('path_unverified');
    if(path.dirname(current)===current)break;
  }
  const after=await fs.lstat(directory,{bigint:true});
  if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.birthtimeNs!==after.birthtimeNs)fail('path_changed');
  return digest(['configuration-directory',String(before.dev),String(before.ino),String(before.birthtimeNs)]);
}
async function fileIdentity(file,maximumBytes,signal) {
  check(signal);if(!absolute(file))fail('path_unverified');
  await sourceDirectoryIdentity(path.dirname(file),signal);check(signal);
  const stat=await fs.lstat(file,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.ino===0n||stat.dev<0n
    ||stat.birthtimeNs<0n||stat.size>BigInt(maximumBytes)||!same(await fs.realpath(file),file))fail('file_unverified');
  check(signal);return {identity_sha256:digest(fileInventory(stat)),stat};
}
async function readPinnedFile(file,maximumBytes,signal,{allowEmpty=false}={}) {
  const before=await fileIdentity(file,maximumBytes,signal);
  if(!allowEmpty&&before.stat.size===0n)fail('file_unverified');
  const handle=await fs.open(file,'r');
  try{
    if(digest(fileInventory(await handle.stat({bigint:true})))!==before.identity_sha256)fail('file_changed');
    const hash=createHash('sha256');let size=0;
    for await(const bytes of handle.createReadStream({autoClose:false,...(signal?{signal}:{})})){
      check(signal);size+=bytes.length;if(size>maximumBytes)fail('file_budget');hash.update(bytes);
    }
    if(BigInt(size)!==before.stat.size||(await fileIdentity(file,maximumBytes,signal)).identity_sha256!==before.identity_sha256)fail('file_changed');
    return {path:file,identity_sha256:before.identity_sha256,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}

async function directory(file,signal,{allowMissing=false}={}) {
  check(signal);if(!absolute(file))fail('path_unverified');
  try{return {path:file,exists:true,identity_sha256:await readDirectoryIdentity(file)};}
  catch(error){
    if(!allowMissing||error.code!=='ENOENT')throw error;
    let parent=path.dirname(file);
    for(;;){
      check(signal);
      try{return {path:file,exists:false,parent_path:parent,parent_identity_sha256:await readDirectoryIdentity(parent)};}
      catch(parentError){if(parentError.code!=='ENOENT')throw parentError;}
      const next=path.dirname(parent);if(next===parent)fail('missing_parent');parent=next;
    }
  }
}

async function localConfiguration({codexHome,workspaceRoot,environment,signal}) {
  // Inventory known local sources, including absent paths. Profiles may be
  // selected indirectly by a configuration layer, so hash every local profile.
  // Cloud/default/managed layers still require an authentic CLI observation.
  const candidates=new Set([path.join(codexHome,'config.toml'),path.join(workspaceRoot,'config.toml')]);
  for(let current=workspaceRoot;;current=path.dirname(current)){
    candidates.add(path.join(current,'.codex','config.toml'));
    if(path.dirname(current)===current)break;
  }
  check(signal);
  for(const name of await fs.readdir(codexHome))if(name.endsWith('.config.toml'))candidates.add(path.join(codexHome,name));
  const programDataKeys=Object.entries(environment).filter(([key])=>key.toUpperCase()==='PROGRAMDATA');
  if(new Set(programDataKeys.map(([,value])=>value)).size>1)fail('environment_case_collision');
  const system=process.platform==='win32'
    ?path.join(programDataKeys[0]?.[1]||String.raw`C:\ProgramData`,'OpenAI','Codex'):'/etc/codex';
  if(!absolute(system))fail('system_config_path_invalid');
  for(const name of ['config.toml','requirements.toml','managed_config.toml'])candidates.add(path.join(system,name));
  if(candidates.size>128)fail('configuration_budget');
  const inventory=[];
  for(const file of [...candidates].sort()){
    check(signal);
    try{inventory.push({state:'PRESENT',...await readPinnedFile(file,1024*1024,signal,{allowEmpty:true})});}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      // Even absent config paths must not hide a link in an existing ancestor.
      let parent=path.dirname(file),identity;
      for(;;){
        try{identity=await sourceDirectoryIdentity(parent,signal);break;}
        catch(parentError){if(parentError.code!=='ENOENT')throw parentError;}
        const next=path.dirname(parent);if(next===parent)fail('missing_parent');parent=next;
      }
      inventory.push({path:file,state:'ABSENT',parent:{path:parent,identity_sha256:identity}});
    }
  }
  check(signal);return {inventory,sha256:digest(inventory),exhaustive:false};
}

/**
 * Read-only physical/config-source snapshot. It deliberately cannot attest the
 * CLI's effective configuration: cloud-managed layers and the differing CLI
 * loaders are not recoverable from hashes of local files. A private native CLI
 * producer must bind actual resolved layers/policy to CLI identity, boot and
 * operator choices before these observations can support execution. Never
 * promote this snapshot, an injected test reader or a JSON flag to that role.
 */
export async function captureCodexCliPhysicalScope({cliPath,codexHome,scratchRoot,workspaceRoot,mode,
  environment=process.env,verifyStorage=verifyOwnerOnlyWindowsStorage,signal,allowMissingScratchRoot=false}={}) {
  check(signal);
  if(!modeValid(mode)||![cliPath,codexHome,scratchRoot,workspaceRoot].every(absolute)
    ||typeof verifyStorage!=='function'||!environment||typeof environment!=='object'||Array.isArray(environment)
    ||typeof allowMissingScratchRoot!=='boolean')fail('scope_arguments_invalid');
  const home=await directory(codexHome,signal),scratch=await directory(scratchRoot,signal,{allowMissing:allowMissingScratchRoot}),
    workspace=await directory(workspaceRoot,signal);
  for(const target of [home,scratch].filter(item=>item.exists)){
    check(signal);const acl=await verifyStorage(target.path,{operation:'VERIFY_DIRECTORY',...(signal?{signal}:{})});
    check(signal);if(acl?.owner_dacl_verified!==true)fail('storage_unverified');
  }
  const cli=await readPinnedFile(cliPath,512*1024*1024,signal);
  const local_configuration=await localConfiguration({codexHome,workspaceRoot,environment,signal});
  const after={home:await directory(codexHome,signal),scratch:await directory(scratchRoot,signal,{allowMissing:allowMissingScratchRoot}),
    workspace:await directory(workspaceRoot,signal)};
  if(digest({home,scratch,workspace})!==digest(after)
    ||(await fileIdentity(cliPath,512*1024*1024,signal)).identity_sha256!==cli.identity_sha256
    ||(await localConfiguration({codexHome,workspaceRoot,environment,signal})).sha256!==local_configuration.sha256)fail('scope_changed');
  check(signal);
  return freeze({schema:CODEX_EXECUTION_SCOPE_SCHEMA,mode,home,scratch,workspace,cli,
    operator_choices_sha256:digest({cliPath,codexHome,scratchRoot,workspaceRoot,mode}),
    permission_overrides:codexCliPermissionOverrides(mode),local_configuration,
    configuration_semantics:{runner:'IGNORE_USER_CONFIG',probe:'INCLUDE_USER_AND_MANAGED_CONFIG',equivalent:false},
    configuration_attestation:'UNAVAILABLE',authority_effect:false});
}
