import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync,gunzipSync} from 'node:zlib';

export const NATIVE_TOOLS_SOURCE_LOCK_SCHEMA='metaengine.native-tools.source-lock.v1';
export const NATIVE_TOOLS_MANIFEST_SCHEMA='metaengine.native-tools.manifest.v1';
const MAX_ARCHIVE=512*1024*1024,MAX_EXPANDED=2*1024*1024*1024,MAX_FILES=20000;
const SHA=/^[a-f0-9]{64}$/,utf8=new TextDecoder('utf-8',{fatal:true});
const fail=reason=>{throw Error('native_tools_'+reason);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');
const EXECUTABLES=Object.freeze({codex:'codex/bin/codex.exe',git:'git/cmd/git.exe'});
const CODEX_EXECUTABLES=['bin/codex.exe','bin/codex-code-mode-host.exe','bin/codex-exec-server.exe',
  'codex-path/rg.exe','codex-resources/codex-command-runner.exe','codex-resources/codex-windows-sandbox-setup.exe'];
const GIT_EXECUTABLES=['cmd/git.exe','mingw64/bin/git.exe','mingw64/libexec/git-core/git-remote-https.exe'];
const REQUIRED_EXECUTABLES=[...CODEX_EXECUTABLES.map(x=>'codex/'+x),...GIT_EXECUTABLES.map(x=>'git/'+x)];

// The build caller selects a reviewed immutable release. There is deliberately
// no "latest", npm/global CLI lookup, executable download or runtime installer.
export function validateNativeToolsSourceLock(lock) {
  if(!exactKeys(lock,['schema','codex','git'])||lock.schema!==NATIVE_TOOLS_SOURCE_LOCK_SCHEMA)fail('source_lock_invalid');
  for(const component of ['codex','git']) {
    const row=lock[component];
    if(!exactKeys(row,['version','release_tag','url','archive_sha256','archive_size'])
      ||!SHA.test(row.archive_sha256||'')||!Number.isSafeInteger(row.archive_size)||row.archive_size<22||row.archive_size>MAX_ARCHIVE)fail('source_identity_invalid');
    if(typeof row.version!=='string'||!/^\d+\.\d+\.\d+(?:\.\d+|-[a-z0-9.]+)?$/.test(row.version))fail('source_version_invalid');
    let expected;
    if(component==='codex') {
      if(row.release_tag!==`rust-v${row.version}`)fail('source_tag_invalid');
      expected=`https://github.com/openai/codex/releases/download/${row.release_tag}/codex-package-x86_64-pc-windows-msvc.tar.gz`;
    }else {
      const m=/^(\d+\.\d+\.\d+)(?:\.(\d+))?$/.exec(row.version);
      if(!m||row.release_tag!==`v${m[1]}.windows.${m[2]||'1'}`)fail('source_tag_invalid');
      expected=`https://github.com/git-for-windows/git/releases/download/${row.release_tag}/MinGit-${row.version}-64-bit.zip`;
    }
    if(row.url!==expected)fail('source_url_invalid');
  }
  return structuredClone(lock);
}

function relativePath(name) {
  if(typeof name!=='string'||!name||name.length>1024||name.includes('\\')||name.startsWith('/')
    ||/[\x00-\x1f\x7f:<>"|?*]/.test(name))fail('archive_path_invalid');
  const clean=name.endsWith('/')?name.slice(0,-1):name;
  const segments=clean.split('/');
  if(segments.some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('archive_path_invalid');
  return clean;
}

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

// Only store/deflate ZIPs are required by the official Windows distributions.
// No executable SFX/7zip, shell, PATH tool or native library is invoked.
export function readNativeToolsZip(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>MAX_ARCHIVE)fail('archive_invalid');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
    if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  }
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))fail('archive_directory_invalid');
  const count=bytes.readUInt16LE(end+10),directorySize=bytes.readUInt32LE(end+12),directoryStart=bytes.readUInt32LE(end+16);
  if(!count||count>MAX_FILES||count!==bytes.readUInt16LE(end+8)||directoryStart+directorySize!==end)fail('archive_directory_invalid');
  const rows=[],names=new Map(),ranges=[];let cursor=directoryStart,expanded=0;
  const need=(start,length,bound=bytes.length)=>{if(start<0||length<0||start+length>bound)fail('archive_truncated');};
  for(let n=0;n<count;n++) {
    need(cursor,46,end);if(bytes.readUInt32LE(cursor)!==0x02014b50)fail('archive_directory_invalid');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16);
    const compressed=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24),nameSize=bytes.readUInt16LE(cursor+28);
    const extraSize=bytes.readUInt16LE(cursor+30),commentSize=bytes.readUInt16LE(cursor+32),disk=bytes.readUInt16LE(cursor+34);
    const attributes=bytes.readUInt32LE(cursor+38),offset=bytes.readUInt32LE(cursor+42);
    need(cursor+46,nameSize+extraSize+commentSize,end);
    if(!nameSize||disk||(flags&~0x080e)||![0,8].includes(method)||[compressed,size,offset].includes(0xffffffff))fail('archive_feature_unsupported');
    const rawName=bytes.subarray(cursor+46,cursor+46+nameSize);let name;
    try{name=utf8.decode(rawName);}catch{fail('archive_name_encoding_invalid');}
    if(!(flags&0x800)&&rawName.some(x=>x>127))fail('archive_name_encoding_invalid');
    const clean=relativePath(name),key=clean.toLowerCase(),directory=name.endsWith('/');
    const type=(attributes>>>16)&0xf000;
    if((type&&type!==(directory?0x4000:0x8000))||(attributes&0x400))fail('archive_link_or_special_file');
    if(names.has(key))fail('archive_duplicate_path');
    names.set(key,directory);
    need(offset,30,directoryStart);if(bytes.readUInt32LE(offset)!==0x04034b50)fail('archive_local_header_invalid');
    const localNameSize=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28);
    need(offset+30,localNameSize+localExtra,directoryStart);
    if(bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method
      ||!bytes.subarray(offset+30,offset+30+localNameSize).equals(rawName))fail('archive_local_header_mismatch');
    if(!(flags&8)&&(bytes.readUInt32LE(offset+14)!==crc||bytes.readUInt32LE(offset+18)!==compressed||bytes.readUInt32LE(offset+22)!==size))fail('archive_local_header_mismatch');
    const dataStart=offset+30+localNameSize+localExtra;
    need(dataStart,compressed,directoryStart);ranges.push([offset,dataStart+compressed]);
    expanded+=size;if(expanded>MAX_EXPANDED)fail('archive_expansion_limit');
    if(directory){if(size||compressed)fail('archive_directory_content_invalid');}
    else {
      let data;
      try{data=method===0?Buffer.from(bytes.subarray(dataStart,dataStart+compressed))
        :inflateRawSync(bytes.subarray(dataStart,dataStart+compressed),{maxOutputLength:Math.max(1,size)});}catch{fail('archive_decompression_invalid');}
      if(data.length!==size||crc32(data)!==crc)fail('archive_content_invalid');
      rows.push({path:clean,bytes:data});
    }
    cursor+=46+nameSize+extraSize+commentSize;
  }
  if(cursor!==end)fail('archive_directory_invalid');
  ranges.sort((a,b)=>a[0]-b[0]);
  if(ranges.some((row,i)=>i&&row[0]<ranges[i-1][1]))fail('archive_entries_overlap');
  for(const name of names.keys())for(let cut=name.indexOf('/');cut!==-1;cut=name.indexOf('/',cut+1))
    if(names.get(name.slice(0,cut))===false)fail('archive_path_conflict');
  return rows;
}

function tarNumber(bytes) {
  const value=bytes.toString('ascii').replace(/\0.*$/s,'').trim();
  if(!/^[0-7]+$/.test(value))fail('tar_number_invalid');
  const number=Number.parseInt(value,8);if(!Number.isSafeInteger(number)||number<0)fail('tar_number_invalid');return number;
}
function tarText(bytes) {
  const end=bytes.indexOf(0),content=end<0?bytes:bytes.subarray(0,end);
  if(end>=0&&bytes.subarray(end).some(x=>x!==0))fail('tar_text_invalid');
  try{return utf8.decode(content);}catch{fail('tar_text_invalid');}
}
function paxMetadata(bytes) {
  const out={};let offset=0;
  while(offset<bytes.length) {
    const space=bytes.indexOf(32,offset);if(space<0||space-offset>10)fail('tar_pax_invalid');
    const text=bytes.toString('ascii',offset,space);if(!/^[1-9][0-9]*$/.test(text))fail('tar_pax_invalid');
    const length=Number(text),end=offset+length;
    if(!Number.isSafeInteger(length)||end>bytes.length||end<=space+1||bytes[end-1]!==10)fail('tar_pax_invalid');
    let entry;try{entry=utf8.decode(bytes.subarray(space+1,end-1));}catch{fail('tar_pax_invalid');}
    const equals=entry.indexOf('='),key=entry.slice(0,equals),value=entry.slice(equals+1);
    if(equals<1||Object.hasOwn(out,key)||!['path','mtime','atime','ctime','uid','gid','uname','gname'].includes(key))fail('tar_pax_unsupported');
    if(key==='path')relativePath(value);
    out[key]=value;offset=end;
  }
  return out;
}

// Python's canonical Codex release builder emits PAX tar archives. Only regular
// files/directories and operation-local PAX path/time metadata are supported.
// Hardlinks, symlinks, global metadata, devices and sparse files are refused.
export function readNativeToolsTarGz(archive) {
  if(!Buffer.isBuffer(archive)||archive.length>MAX_ARCHIVE)fail('archive_invalid');
  let bytes;try{bytes=gunzipSync(archive,{maxOutputLength:MAX_EXPANDED});}catch{fail('tar_gzip_invalid');}
  const rows=[],names=new Map();let offset=0,pax=null,headers=0,finished=false;
  while(offset+512<=bytes.length) {
    const header=bytes.subarray(offset,offset+512);
    if(header.every(x=>x===0)) {
      if(offset+1024>bytes.length||bytes.subarray(offset).some(x=>x!==0)||pax)fail('tar_terminator_invalid');
      finished=true;break;
    }
    if(++headers>MAX_FILES*2)fail('tar_entry_limit');
    const checksum=tarNumber(header.subarray(148,156));let actual=0;
    for(let i=0;i<512;i++)actual+=(i>=148&&i<156)?32:header[i];
    if(actual!==checksum)fail('tar_checksum_invalid');
    if(header.toString('ascii',257,262)!=='ustar')fail('tar_format_unsupported');
    const size=tarNumber(header.subarray(124,136)),type=header[156],dataStart=offset+512,next=dataStart+Math.ceil(size/512)*512;
    if(size>MAX_EXPANDED||next>bytes.length)fail('tar_truncated');
    const content=bytes.subarray(dataStart,dataStart+size);
    const short=tarText(header.subarray(0,100)),prefix=tarText(header.subarray(345,500));
    const name=prefix?`${prefix}/${short}`:short;
    if(type===120) {
      if(pax||size>65536)fail('tar_pax_invalid');pax=paxMetadata(content);offset=next;continue;
    }
    if(![0,48,53].includes(type)||header.subarray(157,257).some(x=>x!==0))fail('tar_link_or_special_file');
    const relative=relativePath(pax?.path||name),key=relative.toLowerCase(),directory=type===53;pax=null;
    if(names.has(key))fail('archive_duplicate_path');names.set(key,directory);
    if(directory){if(size)fail('archive_directory_content_invalid');}
    else rows.push({path:relative,bytes:Buffer.from(content)});
    offset=next;
  }
  if(!finished||!rows.length)fail('tar_terminator_invalid');
  for(const name of names.keys())for(let cut=name.indexOf('/');cut!==-1;cut=name.indexOf('/',cut+1))
    if(names.get(name.slice(0,cut))===false)fail('archive_path_conflict');
  return rows;
}

async function obtain(source,fetchImpl) {
  const response=await fetchImpl(source.url,{redirect:'follow',signal:AbortSignal.timeout(120000)});
  if(!response?.ok||!response.body)fail('download_failed');
  if(response.url) {
    const final=new URL(response.url);
    if(final.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname)||final.username||final.password)fail('download_origin_invalid');
  }
  const declared=response.headers?.get('content-length');
  if(declared&&Number(declared)!==source.archive_size)fail('download_size_mismatch');
  const chunks=[];let size=0;
  for await(const chunk of response.body) {
    const bytes=Buffer.from(chunk);size+=bytes.length;if(size>source.archive_size)fail('download_size_mismatch');chunks.push(bytes);
  }
  if(size!==source.archive_size)fail('download_size_mismatch');
  const archive=Buffer.concat(chunks,size);if(digest(archive)!==source.archive_sha256)fail('download_digest_mismatch');
  return archive;
}

async function noAliases(directory) {
  const absolute=path.resolve(directory);let current=path.parse(absolute).root;
  for(const segment of path.relative(current,absolute).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);const stat=await fs.lstat(current);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('directory_untrusted');
  }
}

function mappedFiles(component,archive) {
  const names=new Set();return (component==='codex'?readNativeToolsTarGz(archive):readNativeToolsZip(archive)).map(row=>{
    const mapped=`${component}/${row.path}`,key=mapped.toLowerCase();
    if(names.has(key))fail('mapped_path_duplicate');names.add(key);
    return {path:mapped,component,sha256:digest(row.bytes),size:row.bytes.length,bytes:row.bytes};
  });
}

export async function stageNativeTools({lock,outputDirectory,fetchImpl=globalThis.fetch}={}) {
  const source=validateNativeToolsSourceLock(lock);
  if(typeof outputDirectory!=='string'||!path.isAbsolute(outputDirectory)||path.resolve(outputDirectory)===path.parse(outputDirectory).root)fail('output_directory_invalid');
  const output=path.resolve(outputDirectory),parent=path.dirname(output);await noAliases(parent);
  try{await fs.lstat(output);fail('output_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  // Finish both downloads and archive checks before publishing any output.
  const files=[];
  for(const component of ['codex','git'])files.push(...mappedFiles(component,await obtain(source[component],fetchImpl)));
  for(const executable of REQUIRED_EXECUTABLES) {
    const row=files.find(x=>x.path===executable);
    if(!row||row.size<2||row.bytes.toString('ascii',0,2)!=='MZ')fail('required_executable_missing');
  }
  const metadata=files.find(x=>x.path==='codex/codex-package.json');let packageMetadata;
  try{packageMetadata=JSON.parse(metadata?.bytes);}catch{fail('codex_package_metadata_invalid');}
  if(packageMetadata.layoutVersion!==1||packageMetadata.version!==source.codex.version||packageMetadata.target!=='x86_64-pc-windows-msvc'
    ||packageMetadata.variant!=='codex'||packageMetadata.entrypoint!=='bin/codex.exe'||packageMetadata.execServer!=='bin/codex-exec-server.exe'
    ||packageMetadata.resourcesDir!=='codex-resources'||packageMetadata.pathDir!=='codex-path')fail('codex_package_metadata_invalid');
  const manifest={schema:NATIVE_TOOLS_MANIFEST_SCHEMA,platform:'win32',arch:'x64',
    sources:{codex:source.codex,git:source.git},executables:{...EXECUTABLES},
    files:files.map(({bytes,...row})=>row).sort((a,b)=>a.path.localeCompare(b.path,'en')),authority_effect:false};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const temporary=await fs.mkdtemp(path.join(parent,'.native-tools-stage-')),identity=await fs.lstat(temporary);
  try {
    for(const row of files){const file=path.join(temporary,row.path);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,row.bytes,{flag:'wx'});}
    await fs.writeFile(path.join(temporary,'native-tools-manifest.json'),manifestBytes,{flag:'wx'});
    await verifyStagedNativeTools({directory:temporary,expectedManifestSha256:digest(manifestBytes)});
    await noAliases(parent);
    try{await fs.lstat(output);fail('output_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.rename(temporary,output);
  }finally {
    const current=await fs.lstat(temporary).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(current){if(current.ino!==identity.ino||current.dev!==identity.dev||current.isSymbolicLink())fail('staging_cleanup_refused');await fs.rm(temporary,{recursive:true});}
  }
  return {manifest,manifestPath:path.join(output,'native-tools-manifest.json'),manifestSha256:digest(manifestBytes),outputDirectory:output};
}

export async function verifyStagedNativeTools({directory,expectedManifestSha256}={}) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||!SHA.test(expectedManifestSha256||''))fail('verification_arguments_invalid');
  await noAliases(directory);
  const manifestPath=path.join(directory,'native-tools-manifest.json'),stat=await fs.lstat(manifestPath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)fail('manifest_invalid');
  const bytes=await fs.readFile(manifestPath);if(digest(bytes)!==expectedManifestSha256)fail('manifest_digest_mismatch');
  let manifest;try{manifest=JSON.parse(bytes);}catch{fail('manifest_invalid');}
  if(!exactKeys(manifest,['schema','platform','arch','sources','executables','files','authority_effect'])||manifest.schema!==NATIVE_TOOLS_MANIFEST_SCHEMA
    ||manifest.platform!=='win32'||manifest.arch!=='x64'||manifest.authority_effect!==false
    ||!exactKeys(manifest.sources,['codex','git'])||JSON.stringify(manifest.executables)!==JSON.stringify(EXECUTABLES)
    ||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>MAX_FILES*2)fail('manifest_invalid');
  validateNativeToolsSourceLock({schema:NATIVE_TOOLS_SOURCE_LOCK_SCHEMA,...manifest.sources});
  const expected=new Set(['native-tools-manifest.json']),seen=new Set();let expanded=0;
  for(const row of manifest.files) {
    if(!exactKeys(row,['path','component','sha256','size'])||!['codex','git'].includes(row.component)
      ||relativePath(row.path)!==row.path||!row.path.startsWith(row.component+'/')||!SHA.test(row.sha256||'')
      ||!Number.isSafeInteger(row.size)||row.size<0||row.size>MAX_EXPANDED||seen.has(row.path.toLowerCase()))fail('manifest_file_invalid');
    seen.add(row.path.toLowerCase());expected.add(row.path);expanded+=row.size;if(expanded>MAX_EXPANDED*2)fail('manifest_expansion_limit');
  }
  async function inspect(relative='') {
    for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})) {
      const name=relative?`${relative}/${entry.name}`:entry.name;relativePath(name);
      if(entry.isSymbolicLink())fail('staged_link_forbidden');
      if(entry.isDirectory()){if(![...expected].some(file=>file.startsWith(name+'/')))fail('staged_extra_directory');await inspect(name);continue;}
      if(!entry.isFile()||!expected.has(name))fail('staged_extra_file');
    }
  }
  await inspect();
  for(const row of manifest.files) {
    const file=path.join(directory,row.path),s=await fs.lstat(file);
    if(!s.isFile()||s.isSymbolicLink()||s.size!==row.size||digest(await fs.readFile(file))!==row.sha256)fail('staged_file_mismatch');
  }
  for(const executable of REQUIRED_EXECUTABLES)if(!expected.has(executable))fail('required_executable_missing');
  return {manifest,manifestSha256:expectedManifestSha256,paths:{codexExecutable:path.join(directory,EXECUTABLES.codex),gitExecutable:path.join(directory,EXECUTABLES.git)}};
}
