import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixedWindowsNativeReadEnvironment} from './windows-native-read-environment.mjs';

export const NATIVE_TOOLS_MANIFEST='native-tools-manifest.json';
const SHA=/^[a-f0-9]{64}$/, HEAD=/^[a-f0-9]{40}$/;
const REQUIRED_FILES=['codex/bin/codex.exe','codex/bin/codex-code-mode-host.exe','codex/bin/codex-exec-server.exe',
  'codex/codex-path/rg.exe','codex/codex-resources/codex-command-runner.exe','codex/codex-resources/codex-windows-sandbox-setup.exe',
  'codex/codex-package.json','git/cmd/git.exe','git/mingw64/bin/git.exe','git/mingw64/libexec/git-core/git-remote-https.exe'];
const fail=reason=>{throw Error('native_tools_'+reason);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function relativeFile(value) {
  if(typeof value!=='string'||value.length>512||value.includes('\\')||value.includes(':')
    ||!value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\x00-\x1f<>"|?*]/.test(part)&&!/[. ]$/.test(part)
      &&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))fail('inventory_path_invalid');
  return value;
}
async function plainPath(target,kind) {
  if(typeof target!=='string'||!path.isAbsolute(target)||/[\x00-\x1f]/.test(target)||/^(?:\\\\|\/\/)/.test(target))fail('absolute_local_path_required');
  let current=path.parse(target).root;
  for(const segment of path.relative(current,target).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);
    const info=await fs.lstat(current);
    if(info.isSymbolicLink())fail('path_alias_denied');
    if(current!==target&&!info.isDirectory())fail('path_type_invalid');
    if(current===target&&(kind==='directory'?!info.isDirectory():!info.isFile()||info.nlink!==1))fail('path_type_invalid');
  }
}
async function boundedFile(target,max) {
  await plainPath(target,'file');
  const handle=await fs.open(target,'r');
  try {
    const info=await handle.stat();if(info.size>max||!info.isFile()||info.nlink!==1)fail('file_size_invalid');
    const bytes=Buffer.alloc(info.size+1),read=await handle.read(bytes,0,bytes.length,0);
    if(read.bytesRead!==info.size)fail('file_changed');
    return bytes.subarray(0,read.bytesRead);
  }finally{await handle.close();}
}

// The binding comes from integrity-protected package metadata. The adjacent
// manifest cannot appoint its own expected digest or authorize execution.
export async function verifyPackagedNativeTools({directory,binding}={}) {
  try {
    if(binding?.schema!=='metaengine.native-tools.package-binding.v1'||!HEAD.test(binding.source_head||'')
      ||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(binding.package_version||'')||!SHA.test(binding.manifest_sha256||'')
      ||!Number.isSafeInteger(binding.file_count)||binding.file_count<2||binding.file_count>20000||binding.authority_effect!==false)fail('binding_invalid');
    await plainPath(directory,'directory');
    const manifestBytes=await boundedFile(path.join(directory,NATIVE_TOOLS_MANIFEST),8*1024*1024);
    if(digest(manifestBytes)!==binding.manifest_sha256)fail('manifest_digest_mismatch');
    let manifest;try{manifest=JSON.parse(manifestBytes);}catch{fail('manifest_invalid');}
    if(manifest?.schema!=='metaengine.native-tools.manifest.v1'||manifest.platform!=='win32'||manifest.arch!=='x64'
      ||manifest.executables?.codex!=='codex/bin/codex.exe'||manifest.executables?.git!=='git/cmd/git.exe'
      ||manifest.authority_effect!==false||!Array.isArray(manifest.files)||manifest.files.length!==binding.file_count)fail('manifest_invalid');
    const expected=new Map();let total=0;
    for(const row of manifest.files) {
      const name=relativeFile(row.path),key=name.toLowerCase();
      if(!['codex','git'].includes(row.component)||!name.startsWith(row.component+'/')||expected.has(key)
        ||!Number.isSafeInteger(row.size)||row.size<0||row.size>1024**3||!SHA.test(row.sha256||''))fail('inventory_invalid');
      total+=row.size;if(total>2**31)fail('inventory_too_large');expected.set(key,row);
    }
    for(const name of REQUIRED_FILES)if(!expected.has(name))fail('required_helper_missing');
    const actual=[];
    const walk=async(dir,prefix='')=>{
      for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
        const name=prefix+entry.name,target=path.join(dir,entry.name);
        if(entry.isSymbolicLink())fail('path_alias_denied');
        if(entry.isDirectory()){
          if(![...expected.values()].some(row=>row.path.startsWith(name+'/')))fail('inventory_mismatch');
          await plainPath(target,'directory');await walk(target,name+'/');
        }
        else if(entry.isFile())actual.push(name);
        else fail('path_type_invalid');
      }
    };
    await walk(directory);
    const seen=new Set();
    for(const name of actual) {
      if(name===NATIVE_TOOLS_MANIFEST)continue;
      const key=name.toLowerCase(),row=expected.get(key);
      if(!row||row.path!==name||seen.has(key))fail('inventory_mismatch');seen.add(key);
      const target=path.join(directory,name);await plainPath(target,'file');
      const info=await fs.lstat(target);if(info.size!==row.size)fail('file_bytes_mismatch');
      const hash=createHash('sha256');for await(const bytes of createReadStream(target))hash.update(bytes);
      if(hash.digest('hex')!==row.sha256)fail('file_bytes_mismatch');
    }
    if(seen.size!==expected.size)fail('inventory_mismatch');
    if(!manifestBytes.equals(await boundedFile(path.join(directory,NATIVE_TOOLS_MANIFEST),8*1024*1024)))fail('manifest_changed');
    return Object.freeze({manifest,manifestSha256:binding.manifest_sha256,
      paths:Object.freeze({codexExecutable:path.join(directory,manifest.executables.codex),gitExecutable:path.join(directory,manifest.executables.git)}),
      external_login_required:true,execution_ready:false,authority_effect:false});
  }catch(error){if(String(error?.message).startsWith('native_tools_'))throw error;fail('resources_unavailable');}
}

export async function loadInstalledNativeTools({resourcesPath=process.resourcesPath,
  packageFile=new URL('../package.json',import.meta.url)}={}) {
  let pkg;try{pkg=JSON.parse(await fs.readFile(packageFile,'utf8'));}catch{fail('package_metadata_unavailable');}
  const binding=pkg.metaengineNativeTools;
  if(!binding||binding.package_version!==pkg.version||binding.source_head!==pkg.metaengineEmergencyTrustRoot?.build_sha)fail('package_identity_mismatch');
  if(typeof resourcesPath!=='string'||!path.isAbsolute(resourcesPath))fail('resources_path_invalid');
  return verifyPackagedNativeTools({directory:path.join(resourcesPath,'native-tools'),binding});
}

// Developer/test Node retains its explicit development dependency. A packaged
// Windows Browser has no PATH fallback, even if another Git is installed.
export async function installedGitExecutable() {
  if(process.platform==='win32'&&process.versions.electron&&process.defaultApp!==true)
    return (await loadInstalledNativeTools()).paths.gitExecutable;
  return 'git';
}

export function installedGitEnvironment(executable,source=process.env) {
  if(!(process.platform==='win32'&&process.versions.electron&&process.defaultApp!==true))return source;
  const image=path.win32.normalize(executable);
  if(!path.win32.isAbsolute(image)||image.includes(';')||path.win32.basename(image).toLowerCase()!=='git.exe'
    ||path.win32.basename(path.win32.dirname(image)).toLowerCase()!=='cmd')fail('git_path_invalid');
  const root=path.win32.dirname(path.win32.dirname(image)),context=fixedWindowsNativeReadEnvironment(source);
  return {...context,PATH:[path.win32.join(root,'cmd'),path.win32.join(root,'mingw64/bin'),path.win32.join(root,'usr/bin'),context.PATH].join(';')};
}
