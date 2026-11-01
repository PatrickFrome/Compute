import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync,gzipSync} from 'node:zlib';
import {stageNativeTools,verifyStagedNativeTools,validateNativeToolsSourceLock,readNativeToolsZip,readNativeToolsTarGz} from '../scripts/stage-native-tools.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
function crc32(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function zip(rows) {
  const locals=[],centrals=[];let offset=0;
  for(const [name,content,attributes=0,method=8] of rows) {
    const raw=Buffer.from(name),bytes=Buffer.from(content),compressed=method===8?deflateRawSync(bytes):bytes;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(method,8);local.writeUInt32LE(crc32(bytes),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(raw.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
    central.writeUInt16LE(method,10);central.writeUInt32LE(crc32(bytes),16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(bytes.length,24);
    central.writeUInt16LE(raw.length,28);central.writeUInt32LE(attributes>>>0,38);central.writeUInt32LE(offset,42);
    locals.push(local,raw,compressed);centrals.push(central,raw);offset+=local.length+raw.length+compressed.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
function tarGz(rows) {
  const chunks=[];
  for(const [name,content,type=48,link=''] of rows) {
    const bytes=Buffer.from(content),header=Buffer.alloc(512);
    header.write(name,0,100);header.write('0000644\0',100,8);header.write('0000000\0',108,8);header.write('0000000\0',116,8);
    header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124,12);header.write('00000000000\0',136,12);
    header.fill(32,148,156);header[156]=type;header.write(link,157,100);header.write('ustar\0',257,6);header.write('00',263,2);
    let sum=0;for(const byte of header)sum+=byte;header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);
    chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
const packageMetadata=JSON.stringify({layoutVersion:1,version:'0.166.0',target:'x86_64-pc-windows-msvc',variant:'codex',
  entrypoint:'bin/codex.exe',execServer:'bin/codex-exec-server.exe',resourcesDir:'codex-resources',pathDir:'codex-path'});
const codexRows=[['bin/codex.exe','MZ fixture Codex'],['bin/codex-code-mode-host.exe','MZ fixture code host'],
  ['bin/codex-exec-server.exe','MZ fixture executor'],['codex-path/rg.exe','MZ fixture rg'],
  ['codex-resources/codex-command-runner.exe','MZ fixture runner'],['codex-resources/codex-windows-sandbox-setup.exe','MZ fixture sandbox'],
  ['codex-package.json',packageMetadata],['LICENSE','synthetic license']];
const codex=tarGz(codexRows);
const git=zip([['cmd/git.exe','MZ fixture Git'],['mingw64/bin/git.exe','MZ fixture actual Git'],['mingw64/libexec/git-core/git-remote-https.exe','MZ fixture helper'],['mingw64/bin/libcurl.dll','MZ fixture library'],['LICENSE.txt','synthetic license']]);
function lock(archives={codex,git}) {
  return {schema:'metaengine.native-tools.source-lock.v1',
    codex:{version:'0.166.0',release_tag:'rust-v0.166.0',url:'https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-package-x86_64-pc-windows-msvc.tar.gz',archive_sha256:sha(archives.codex),archive_size:archives.codex.length},
    git:{version:'2.55.0.4',release_tag:'v2.55.0.windows.4',url:'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.4/MinGit-2.55.0.4-64-bit.zip',archive_sha256:sha(archives.git),archive_size:archives.git.length}};
}
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-tools-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,output:path.join(root,'tools')};
}
function fetcher(archives={codex,git}) {return async url=>new Response(url.includes('/openai/')?archives.codex:archives.git,{status:200});}

test('official exact source identities are required; mutable tags, foreign sources and unpinned archives fail',()=>{
  assert.equal(validateNativeToolsSourceLock(lock()).codex.version,'0.166.0');
  for(const mutate of [x=>x.codex.url='https://evil.example/codex.zip',x=>x.codex.url=x.codex.url.replace('rust-v0.166.0','latest'),
    x=>x.codex.release_tag='latest',x=>x.codex.archive_sha256='a',x=>x.git.archive_size=0,x=>x.git.version='2.55.0.5',
    x=>x.codex.extra='allowed?',x=>x.codex.url+='?token=synthetic']) {
    const bad=lock();mutate(bad);assert.throws(()=>validateNativeToolsSourceLock(bad),/native_tools_source/);
  }
});

test('real ZIP parser preserves helpers/libraries/license and atomically stages without shell or PATH tools',async t=>{
  const f=await fixture(t),calls=[];
  const staged=await stageNativeTools({lock:lock(),outputDirectory:f.output,fetchImpl:async(url,options)=>{calls.push({url,options});return fetcher()(url);}});
  assert.equal(calls.length,2);assert.equal(staged.manifest.files.length,13);
  assert.deepEqual(staged.manifest.executables,{codex:'codex/bin/codex.exe',git:'git/cmd/git.exe'});
  assert.equal(await fs.readFile(path.join(f.output,'codex/bin/codex.exe'),'utf8'),'MZ fixture Codex');
  assert.equal(await fs.readFile(path.join(f.output,'git/mingw64/bin/libcurl.dll'),'utf8'),'MZ fixture library');
  assert.equal(staged.manifest.files.some(x=>x.path==='codex/codex-resources/codex-command-runner.exe'),true);
  assert.equal(staged.manifest.files.some(x=>x.path==='git/LICENSE.txt'),true);
  const verified=await verifyStagedNativeTools({directory:f.output,expectedManifestSha256:staged.manifestSha256});
  assert.equal(verified.paths.gitExecutable,path.join(f.output,'git/cmd/git.exe'));
  assert.equal(staged.manifest.authority_effect,false);
  assert.deepEqual(await fs.readdir(f.root),['tools']);
});

test('second-component download failure never publishes a partial native tools output',async t=>{
  const f=await fixture(t);await assert.rejects(stageNativeTools({lock:lock(),outputDirectory:f.output,
    fetchImpl:async url=>url.includes('/openai/')?new Response(codex):new Response('offline',{status:503})}),/native_tools_download_failed/);
  assert.deepEqual(await fs.readdir(f.root),[]);
});

test('truncated, oversized, wrong hash, declared length mismatch and interrupted responses fail before output',async t=>{
  const f=await fixture(t);
  for(const [response,error] of [
    [()=>new Response(codex.subarray(0,-1)),/download_size_mismatch/],
    [()=>new Response(Buffer.concat([codex,Buffer.from('x')])),/download_size_mismatch/],
    [()=>new Response(Buffer.alloc(codex.length)),/download_digest_mismatch/],
    [()=>new Response(codex,{headers:{'content-length':'1'}}),/download_size_mismatch/],
    [()=>({ok:true,body:(async function*(){yield codex.subarray(0,4);throw Error('fixture transport interrupted');})()}),/fixture transport interrupted/]
  ]) {
    await assert.rejects(stageNativeTools({lock:lock(),outputDirectory:f.output,fetchImpl:async()=>response()}),error);
    assert.deepEqual(await fs.readdir(f.root),[]);
  }
});

test('archive traversal, Windows aliases, links, duplicate case paths and file/directory conflicts are rejected',()=>{
  for(const name of ['../escape.exe','/absolute.exe','C:/evil.exe','a\\b.exe','a/./b.exe','a//b.exe','NUL.txt','a./b.exe','a /b.exe','a:stream','wild*.dll','question?.dll','a<bad>.exe','a|bad.exe'])
    assert.throws(()=>readNativeToolsZip(zip([[name,'x']])),/archive_path_invalid/);
  for(const attrs of [(0xa000<<16)>>>0,(0x1000<<16)>>>0,0x400])
    assert.throws(()=>readNativeToolsZip(zip([['link','x',attrs]])),/archive_link_or_special_file/);
  assert.throws(()=>readNativeToolsZip(zip([['A','x'],['a','y']])),/archive_duplicate_path/);
  assert.throws(()=>readNativeToolsZip(zip([['a','x'],['a/b','y']])),/archive_path_conflict/);
});

test('local-header identity drift, content corruption and malformed central directories are rejected',()=>{
  const header=Buffer.from(git);header[30]^=1;assert.throws(()=>readNativeToolsZip(header),/archive_local_header_mismatch/);
  const stored=zip([['a','hello',0,0]]);stored[31]^=1;assert.throws(()=>readNativeToolsZip(stored),/archive_content_invalid/);
  const end=Buffer.from(git);end.writeUInt32LE(0,end.length-22);assert.throws(()=>readNativeToolsZip(end),/archive_directory_invalid/);
});

test('missing executable or required native helper and wrong Codex package metadata prevent staging',async t=>{
  const f=await fixture(t);
  for(const archive of [tarGz([['bin/codex.exe','not PE']]),tarGz(codexRows.filter(x=>x[0]!=='codex-resources/codex-windows-sandbox-setup.exe')),
    tarGz(codexRows.map(x=>x[0]==='codex-package.json'?[x[0],packageMetadata.replace('0.166.0','0.0.0')]:x))]) {
    const archives={codex:archive,git};await assert.rejects(stageNativeTools({lock:lock(archives),outputDirectory:f.output,fetchImpl:fetcher(archives)}),/native_tools_(required_executable_missing|codex_package_metadata_invalid)/);
    assert.deepEqual(await fs.readdir(f.root),[]);
  }
  const archives={codex,git:zip([['cmd/git.exe','MZ launcher only']])};
  await assert.rejects(stageNativeTools({lock:lock(archives),outputDirectory:f.output,fetchImpl:fetcher(archives)}),/required_executable_missing/);
  assert.deepEqual(await fs.readdir(f.root),[]);
});

test('tar.gz preserves full canonical package including safe PAX and rejects links, traversal and corruption',()=>{
  assert.equal(readNativeToolsTarGz(codex).length,8);
  const paxValue='mtime=1700000000.1234567\n';let pax='';
  for(let length=1;length<100;length++){const candidate=length+' '+paxValue;if(Buffer.byteLength(candidate)===length){pax=candidate;break;}}
  assert.equal(readNativeToolsTarGz(tarGz([['@PaxHeader',pax,120],['a','x']]))[0].path,'a');
  for(const type of [49,50,51,52,54,103])assert.throws(()=>readNativeToolsTarGz(tarGz([['bad','x',type,'target']])),/tar_link_or_special_file/);
  for(const name of ['../escape','/absolute','a/../b','C:/escape'])assert.throws(()=>readNativeToolsTarGz(tarGz([[name,'x']])),/archive_path_invalid/);
  assert.throws(()=>readNativeToolsTarGz(tarGz([['A','x'],['a','y']])),/archive_duplicate_path/);
  assert.throws(()=>readNativeToolsTarGz(tarGz([['a','x'],['a/b','y']])),/archive_path_conflict/);
  assert.throws(()=>readNativeToolsTarGz(codex.subarray(0,-1)),/tar_gzip_invalid/);
});

test('verification rejects changed file bytes, unexpected files, symlinks and wrong ASAR binding',async t=>{
  const f=await fixture(t),staged=await stageNativeTools({lock:lock(),outputDirectory:f.output,fetchImpl:fetcher()});
  await assert.rejects(verifyStagedNativeTools({directory:f.output,expectedManifestSha256:'f'.repeat(64)}),/manifest_digest_mismatch/);
  const file=path.join(f.output,'codex/bin/codex.exe');await fs.writeFile(file,'MZ tampered executable');
  await assert.rejects(verifyStagedNativeTools({directory:f.output,expectedManifestSha256:staged.manifestSha256}),/staged_file_mismatch/);
  await fs.writeFile(file,'MZ fixture Codex');await fs.writeFile(path.join(f.output,'extra.exe'),'x');
  await assert.rejects(verifyStagedNativeTools({directory:f.output,expectedManifestSha256:staged.manifestSha256}),/staged_extra_file/);
  await fs.unlink(path.join(f.output,'extra.exe'));await fs.symlink(file,path.join(f.output,'alias.exe'));
  await assert.rejects(verifyStagedNativeTools({directory:f.output,expectedManifestSha256:staged.manifestSha256}),/staged_link_forbidden/);
});

test('existing output and aliased parent are never overwritten or repaired',async t=>{
  const f=await fixture(t);await fs.mkdir(f.output);await fs.writeFile(path.join(f.output,'preserve'),'original');
  await assert.rejects(stageNativeTools({lock:lock(),outputDirectory:f.output,fetchImpl:()=>{throw Error('network must not run');}}),/output_exists/);
  assert.equal(await fs.readFile(path.join(f.output,'preserve'),'utf8'),'original');
  await fs.symlink(f.output,path.join(f.root,'alias'),'dir');
  await assert.rejects(stageNativeTools({lock:lock(),outputDirectory:path.join(f.root,'alias','new'),fetchImpl:fetcher()}),/directory_untrusted/);
});
