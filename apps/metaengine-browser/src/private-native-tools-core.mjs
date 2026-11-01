// Package-data verification only, shared by build Node, installed Node Host and Electron.
// Bindings come from their original package authority; this module is not a trust root.
import nodeFs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {createHash} from 'node:crypto';
// original-fs selects physical filesystem semantics, not developer authority.
const fs = (process.versions.electron ? createRequire(import.meta.url)('original-fs') : nodeFs).promises;
export const PRIVATE_NATIVE_TOOLS_SCHEMA = 'metaengine.private-native-tools.v1';
export const PRIVATE_NATIVE_TOOLS_BINDING_SCHEMA = 'metaengine.private-native-tools.binding.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const fail = reason => {throw Error('private_native_tools_' + reason);};
const exact = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const same = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const part = value => typeof value==='string' && value && value !== '.' && value !== '..' && value.normalize('NFC') === value
  && Buffer.byteLength(value)<=255 && !/[<>:"\\\\/|?*\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(value) && !/[. ]$/.test(value)
  && !/^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:[ .]|$)/i.test(value)
  && !/^[^.]{1,6}~[1-9][0-9]*(?:\.|$)/i.test(value);
const relative = value => typeof value === 'string' && Buffer.byteLength(value) < 1024 && value.split('/').every(part);
const fold = value => value.toUpperCase().normalize('NFC');
const capabilities = new WeakSet();
export function assertPrivateNativeToolsCapability(value) {
  if(!capabilities.has(value))fail('capability_required');
  return value;
}
export const PRIVATE_NATIVE_TOOL_REQUIRED_FILES = Object.freeze({
  git:Object.freeze(['ucrt64/bin/git.exe','ucrt64/bin/git-remote-https.exe','ucrt64/bin/libcurl-4.dll',
    'ucrt64/bin/libcrypto-3-x64.dll','ucrt64/bin/libssl-3-x64.dll','ucrt64/bin/zlib1.dll',
    'ucrt64/etc/ssl/certs/ca-bundle.crt','etc/gitconfig','usr/bin/sh.exe','usr/bin/msys-2.0.dll',
    'LICENSE.txt','ucrt64/share/licenses/openssl/LICENSE','ucrt64/share/licenses/curl/LICENSE']),
  codex:Object.freeze(['bin/codex.exe','bin/codex-exec-server.exe','bin/codex-code-mode-host.exe','codex-package.json',
    'codex-path/rg.exe','codex-resources/codex-command-runner.exe','codex-resources/codex-windows-sandbox-setup.exe',
    'codex-resources/voice/NOTICE.md','codex-resources/voice/windows-crt.json','LICENSE','NOTICE',
    'codex-path/licenses/LICENSE-MIT','codex-path/licenses/UNLICENSE']),
});
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const signature = stat => ['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'].map(k=>String(stat[k])).join(':');
async function physical(file, directory) {
  const stat = await fs.lstat(file,{bigint:true});
  if(stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
    || !same(await fs.realpath(file),file)) fail('path_alias');
  return stat;
}
async function ancestors(root) {
  for(let current=root;;current=path.dirname(current)) {
    await physical(current,true);
    if(current===path.dirname(current))break;
  }
}
async function stableRead(file,maxBytes) {
  const before=await physical(file,false);
  if(before.size>BigInt(maxBytes))fail('file_budget');
  const handle=await fs.open(file,'r');
  try {
    if(signature(before)!==signature(await handle.stat({bigint:true})))fail('file_changed');
    const bytes=await handle.readFile();
    if(BigInt(bytes.length)!==before.size || signature(before)!==signature(await handle.stat({bigint:true}))
      ||signature(before)!==signature(await physical(file,false)))fail('file_changed');
    return bytes;
  }finally{await handle.close();}
}
async function stableHash(file,before) {
  const handle=await fs.open(file,'r');
  try {
    if(signature(before)!==signature(await handle.stat({bigint:true})))fail('file_changed');
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let size=0;
    for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;
      size+=bytesRead;if(size>Number(before.size))fail('file_changed');hash.update(buffer.subarray(0,bytesRead));}
    if(BigInt(size)!==before.size || signature(before)!==signature(await handle.stat({bigint:true}))
      ||signature(before)!==signature(await physical(file,false)))fail('file_changed');
    return hash.digest('hex');
  }finally{await handle.close();}
}
export function validatePrivateNativeToolsManifest(doc) {
  if(!exact(doc,['schema','platform','arch','components']) || doc.schema!==PRIVATE_NATIVE_TOOLS_SCHEMA
    ||doc.platform!=='win32'||doc.arch!=='x64'||!Array.isArray(doc.components)||doc.components.length!==2)fail('manifest_schema');
  const expected={git:'ucrt64/bin/git.exe',codex:'bin/codex.exe'},seen=new Set();let count=0,total=0;
  for(const component of doc.components){
    if(!exact(component,['id','version','repository','tag','release_id','asset_id','archive_name','archive_sha256','archive_bytes','entrypoint','files'])
      ||!Object.hasOwn(expected,component.id)||seen.has(component.id)||component.entrypoint!==expected[component.id]
      ||!/^\d+\.\d+\.\d+(?:\.(?:windows\.)?\d+)?$/.test(component.version||'')
      ||component.repository!==(component.id==='git'?'git-for-windows/git':'openai/codex')
      ||!/^[-a-zA-Z0-9._]+$/.test(component.tag||'')||!part(component.archive_name)
      ||!Number.isSafeInteger(component.release_id)||component.release_id<1||!Number.isSafeInteger(component.asset_id)||component.asset_id<1
      ||!HASH.test(component.archive_sha256||'')||!Number.isSafeInteger(component.archive_bytes)||component.archive_bytes<1||component.archive_bytes>512*1024**2
      ||!Array.isArray(component.files)||!component.files.length)fail('component_schema');
    seen.add(component.id);let previous='';const folded=new Set(),pathSpellings=new Map();
    for(const row of component.files){
      if(!exact(row,['path','bytes','sha256'])||!relative(row.path)||compare(previous,row.path)>=0
        ||folded.has(fold(row.path))||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>512*1024**2
        ||!HASH.test(row.sha256||''))fail('file_schema');
      previous=row.path;
      // Prefix aliases also collide on Windows even when complete paths differ.
      const prefixes=row.path.split('/');let prefix='';
      for(const segment of prefixes){prefix=prefix?prefix+'/'+segment:segment;
        const key=fold(prefix),prior=pathSpellings.get(key);
        if(prior&&prior!==prefix)fail('file_path_alias');pathSpellings.set(key,prefix);}
      folded.add(fold(row.path));
      if(++count>50000||(total+=row.bytes)>2*1024**3)fail('inventory_budget');
    }
    if(PRIVATE_NATIVE_TOOL_REQUIRED_FILES[component.id].some(name=>!component.files.some(row=>row.path===name&&row.bytes>0)))fail('required_dependency_missing');
  }
  return doc;
}
export function privateNativeToolsBinding(manifestBytes) {
  const doc=validatePrivateNativeToolsManifest(JSON.parse(manifestBytes.toString('utf8')));
  return Object.freeze({schema:PRIVATE_NATIVE_TOOLS_BINDING_SCHEMA,manifest_sha256:sha(manifestBytes),
    manifest_bytes:manifestBytes.length,file_count:doc.components.reduce((n,c)=>n+c.files.length,0)});
}
export function validatePrivateNativeToolsBinding(binding){
  if(!exact(binding,['schema','manifest_sha256','manifest_bytes','file_count'])||binding.schema!==PRIVATE_NATIVE_TOOLS_BINDING_SCHEMA
    ||!HASH.test(binding.manifest_sha256||'')||!Number.isSafeInteger(binding.manifest_bytes)||binding.manifest_bytes<1||binding.manifest_bytes>16*1024**2
    ||!Number.isSafeInteger(binding.file_count)||binding.file_count<2||binding.file_count>50000)fail('binding_invalid');
  return Object.freeze({schema:binding.schema,manifest_sha256:binding.manifest_sha256,
    manifest_bytes:binding.manifest_bytes,file_count:binding.file_count});
}
// Build and runtime share the same complete byte verification. Caller supplies
// the binding from integrity-protected package metadata, never adjacent userData.
export async function resolvePrivateNativeTools({toolsRoot,binding}={}) {
  binding=validatePrivateNativeToolsBinding(binding);
  if(typeof toolsRoot!=='string'||!path.isAbsolute(toolsRoot)||path.resolve(toolsRoot)!==toolsRoot||/^(?:\\\\|\/\/)/.test(toolsRoot))fail('root_invalid');
  await ancestors(toolsRoot);
  const bytes=await stableRead(path.join(toolsRoot,'manifest.json'),16*1024**2);
  if(bytes.length!==binding.manifest_bytes||sha(bytes)!==binding.manifest_sha256)fail('manifest_binding_mismatch');
  const manifest=validatePrivateNativeToolsManifest(JSON.parse(bytes.toString('utf8')));
  if(manifest.components.reduce((n,c)=>n+c.files.length,0)!==binding.file_count)fail('file_count_mismatch');
  const expected=new Map(manifest.components.flatMap(c=>c.files.map(row=>[c.id+'/'+row.path,row])));
  const snapshot=new Map();let entries=0;const actual=[];
  async function walk(dir,prefix,hashFiles){
    const before=await physical(dir,true);snapshot.set(dir,signature(before));
    for(const name of (await fs.readdir(dir)).sort(compare)){
      if(!part(name)||++entries>60000)fail('inventory_path');
      const file=path.join(dir,name),rel=prefix?prefix+'/'+name:name;
      const stat=await fs.lstat(file,{bigint:true});
      if(stat.isDirectory())await walk(file,rel,hashFiles);
      else {
        const checked=await physical(file,false);snapshot.set(file,signature(checked));
        if(rel==='manifest.json')continue;
        const row=expected.get(rel);if(!row||checked.size!==BigInt(row.bytes))fail('inventory_mismatch');
        if(hashFiles&&await stableHash(file,checked)!==row.sha256)fail('file_digest_mismatch');
        actual.push(rel);
      }
    }
    if(signature(before)!==signature(await physical(dir,true)))fail('directory_changed');
  }
  await walk(toolsRoot,'',true);
  // Fence the originally bound manifest through the tree walk as well.
  if(!(await stableRead(path.join(toolsRoot,'manifest.json'),16*1024**2)).equals(bytes))fail('manifest_changed');
  if(actual.length!==expected.size)fail('inventory_incomplete');
  let invalid=false,capability;
  const revalidate=async()=>{
    if(invalid)fail('invalidated');
    try{
      await ancestors(toolsRoot);
      for(const [file,before]of snapshot){
        const stat=await fs.lstat(file,{bigint:true});
        if(stat.isSymbolicLink()||signature(stat)!==before||!same(await fs.realpath(file),file))fail('inventory_changed');
      }
      // A sibling may have invalidated this same selection during the final
      // awaited filesystem read. No late success can revive its capability.
      if(invalid)fail('invalidated');
    }catch(error){invalid=true;if(capability)capabilities.delete(capability);throw error;}
  };
  await revalidate();
  const gitRoot=path.join(toolsRoot,'git'),codexRoot=path.join(toolsRoot,'codex');
  const gitExecutable=path.join(gitRoot,'ucrt64','bin','git.exe'),cliExecutable=path.join(codexRoot,'bin','codex.exe');
  // Child-only PATH. No inherited user/system PATH, config, helper or CA override.
  // OS roots match the existing fixed Windows native-reader environment.
  const environment=Object.freeze({SYSTEMROOT:'C:\\Windows',WINDIR:'C:\\Windows',COMSPEC:'C:\\Windows\\System32\\cmd.exe',
    PATH:[path.join(codexRoot,'bin'),path.join(codexRoot,'codex-path'),path.join(gitRoot,'ucrt64','bin'),path.join(gitRoot,'usr','bin'),
      'C:\\Windows\\System32','C:\\Windows','C:\\Windows\\System32\\WindowsPowerShell\\v1.0'].join(';'),PATHEXT:'.COM;.EXE',
    GIT_EXEC_PATH:path.join(gitRoot,'ucrt64','libexec','git-core'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0',
    GCM_INTERACTIVE:'never',GCM_GUI_PROMPT:'0',GIT_SSL_CAINFO:path.join(gitRoot,'ucrt64','etc','ssl','certs','ca-bundle.crt'),
    SSL_CERT_FILE:path.join(gitRoot,'ucrt64','etc','ssl','cert.pem'),OPENSSL_CONF:path.join(gitRoot,'ucrt64','etc','ssl','openssl.cnf'),
    OPENSSL_MODULES:path.join(gitRoot,'ucrt64','lib','ossl-modules'),GIT_PAGER:'cat',NO_COLOR:'1'});
  capability=Object.freeze({gitExecutable,cliExecutable,
    gitExecutableSha256:expected.get('git/ucrt64/bin/git.exe').sha256,cliExecutableSha256:expected.get('codex/bin/codex.exe').sha256,
    environment,revalidate});
  capabilities.add(capability);
  return capability;
}
