// Build producer only. Client startup consumes packaged bytes and never calls
// this downloader/extractor. No archive member or downloaded tool is executed.
import fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {extractPrivateToolZip, extractPrivateToolTarGz} from './private-tool-zip.mjs';

const buildRoot = fileURLToPath(new URL('../build/', import.meta.url));
const lockPath = path.join(buildRoot, 'private-native-tools.lock.json');
const HASH = /^[a-f0-9]{64}$/;
const fail = code => { throw Error('private_native_tools_stage_' + code); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const relative = name => typeof name === 'string' && name.length < 1024 && name.split('/').every(part =>
  /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..' && !/[. ]$/.test(part));
const same = (a,b) => ['dev','ino','size','mtimeNs','ctimeNs','nlink'].every(key => a[key] === b[key]);
const identity = (a,b) => a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory();
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

async function physicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory
    || /^(?:\\\\|\/\/)/.test(directory) || directory.includes('\0')) fail('absolute_local_directory_required');
  let current = path.parse(directory).root;
  for (const part of path.relative(current,directory).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    const info = await fs.lstat(current,{bigint:true});
    if (!info.isDirectory() || info.isSymbolicLink()) fail('directory_alias');
  }
  const resolved = await fs.realpath(directory);
  if ((process.platform === 'win32' ? resolved.toLowerCase() !== directory.toLowerCase() : resolved !== directory)) fail('directory_alias');
  return fs.lstat(directory,{bigint:true});
}

async function stableBytes(file, maximum) {
  await physicalDirectory(path.dirname(file));
  const before = await fs.lstat(file,{bigint:true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum)) fail('source_file_invalid');
  const handle = await fs.open(file,'r');
  try {
    if (!same(before,await handle.stat({bigint:true}))) fail('source_file_changed');
    const bytes = await handle.readFile();
    if (BigInt(bytes.length) !== before.size || !same(before,await handle.stat({bigint:true}))
      || !same(before,await fs.lstat(file,{bigint:true}))) fail('source_file_changed');
    return bytes;
  } finally { await handle.close(); }
}

export async function readPrivateNativeToolsLock() {
  const doc = JSON.parse((await stableBytes(lockPath,128 * 1024)).toString('utf8'));
  if (!exact(doc,['schema','platform','arch','components']) || doc.schema !== 'metaengine.private-native-tools.lock.v1'
    || doc.platform !== 'win32' || doc.arch !== 'x64' || !Array.isArray(doc.components)
    || doc.components.length !== 2 || doc.components.map(row=>row?.id).join(',') !== 'git,codex') fail('lock_invalid');
  const repositories = {git:'git-for-windows/git',codex:'openai/codex'};
  for (const row of doc.components) {
    if (!exact(row,['id','version','repository','tag','release_id','asset_id','archive_name','archive_sha256','archive_bytes','inventory_sha256','url','format','entrypoint','required_files','notices'])
      || row.repository !== repositories[row.id] || !/^[A-Za-z0-9._-]+$/.test(row.tag)
      || !/^[A-Za-z0-9._-]+$/.test(row.version) || !relative(row.archive_name) || row.archive_name.includes('/')
      || !HASH.test(row.archive_sha256) || !HASH.test(row.inventory_sha256) || !Number.isSafeInteger(row.archive_bytes) || row.archive_bytes < 1 || row.archive_bytes > 512 * 1024 ** 2
      || !Number.isSafeInteger(row.release_id) || row.release_id < 1 || !Number.isSafeInteger(row.asset_id) || row.asset_id < 1
      || row.url !== `https://github.com/${row.repository}/releases/download/${row.tag}/${row.archive_name}`
      || !['zip','tar.gz'].includes(row.format) || !relative(row.entrypoint)
      || !Array.isArray(row.required_files) || !row.required_files.includes(row.entrypoint) || !row.required_files.every(relative)
      || !Array.isArray(row.notices)) fail('lock_component_invalid');
    for (const notice of row.notices) {
      if (!exact(notice,['source','path','url','sha256']) || !relative(notice.source) || !relative(notice.path)
        || !notice.source.startsWith('third-party/codex/') || !HASH.test(notice.sha256)
        || !/^https:\/\/raw\.githubusercontent\.com\/(?:openai\/codex|BurntSushi\/ripgrep)\//.test(notice.url)) fail('lock_notice_invalid');
    }
  }
  return freeze(doc);
}

function inventoryDigest(files) {
  if(!Array.isArray(files)||!files.length||files.length>50000)fail('inventory_invalid');
  let previous='';
  const canonical=files.map(file=>{
    if(!exact(file,['path','bytes','sha256'])||typeof file.path!=='string'||file.path<=previous
      ||!Number.isSafeInteger(file.bytes)||file.bytes<0||!HASH.test(file.sha256))fail('inventory_invalid');
    previous=file.path;return {path:file.path,bytes:file.bytes,sha256:file.sha256};
  });
  return digest(Buffer.from(JSON.stringify(canonical)));
}

// Build-only check for safely reusing an already staged distribution. A
// self-consistent, truncated tree cannot be reblessed by copying old metadata.
// Runtime physical tree validation remains the consumer's responsibility.
export async function assertPrivateNativeToolsManifestPins(manifest) {
  const lock=await readPrivateNativeToolsLock();
  if(!exact(manifest,['schema','platform','arch','components'])||manifest.schema!=='metaengine.private-native-tools.v1'
    ||manifest.platform!==lock.platform||manifest.arch!==lock.arch||!Array.isArray(manifest.components)
    ||manifest.components.length!==lock.components.length)fail('manifest_pin_mismatch');
  const fields=['id','version','repository','tag','release_id','asset_id','archive_name','archive_sha256','archive_bytes','entrypoint'];
  for(let index=0;index<lock.components.length;index++){
    const actual=manifest.components[index],expected=lock.components[index];
    if(!exact(actual,[...fields,'files'])||fields.some(key=>actual[key]!==expected[key])
      ||inventoryDigest(actual.files)!==expected.inventory_sha256)fail('manifest_pin_mismatch');
  }
  return manifest;
}

async function checkArchive(file,row,{hash=false}={}) {
  await physicalDirectory(path.dirname(file));
  const before = await fs.lstat(file,{bigint:true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(row.archive_bytes)) fail('archive_file_invalid');
  if (hash) {
    const handle=await fs.open(file,'r');
    try {
      if(!same(before,await handle.stat({bigint:true})))fail('archive_file_changed');
      const value=createHash('sha256');let size=0;
      for await (const bytes of handle.createReadStream({autoClose:false})) {size+=bytes.length;if(size>row.archive_bytes)fail('archive_file_changed');value.update(bytes);}
      if(size!==row.archive_bytes||!same(before,await handle.stat({bigint:true}))
        ||!same(before,await fs.lstat(file,{bigint:true}))||value.digest('hex')!==row.archive_sha256)fail('archive_digest_mismatch');
    }finally{await handle.close();}
  }
}

// Acquisition happens in the trusted build stage, without npm/winget/Git/Node
// on the end user's machine. Only reviewed exact release URLs can be fetched.
export async function acquirePrivateNativeToolArchives({archiveDirectory}={}) {
  const lock = await readPrivateNativeToolsLock();
  const directoryPin = await physicalDirectory(archiveDirectory);
  for (const row of lock.components) {
    const target=path.join(archiveDirectory,row.archive_name);
    if (await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;})) {
      await checkArchive(target,row,{hash:true}); continue;
    }
    const pending=target+'.'+randomUUID()+'.download';
    const output=await fs.open(pending,'wx',0o600); const pin=await output.stat({bigint:true});
    let written=0, success=false;
    try {
      let url=row.url,response;
      for (let redirect=0;redirect<6;redirect++) {
        const parsed=new URL(url);
        if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port
          ||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname)) fail('download_redirect_refused');
        response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(180000)});
        if(![301,302,303,307,308].includes(response.status))break;
        const location=response.headers.get('location');await response.body?.cancel();
        if(!location)fail('download_redirect_invalid');url=new URL(location,url).href;response=null;
      }
      if(!response?.ok||!response.body)fail('download_failed');
      const contentLength=response.headers.get('content-length');
      if(contentLength!==null&&Number(contentLength)!==row.archive_bytes){await response.body.cancel();fail('download_size_mismatch');}
      const hash=createHash('sha256');
      for await(const chunk of response.body){
        written+=chunk.length;if(written>row.archive_bytes)fail('download_size_mismatch');hash.update(chunk);
        let offset=0;while(offset<chunk.length){const {bytesWritten}=await output.write(chunk,offset,chunk.length-offset);if(!bytesWritten)fail('download_write_failed');offset+=bytesWritten;}
      }
      if(written!==row.archive_bytes||hash.digest('hex')!==row.archive_sha256)fail('download_digest_mismatch');
      await output.sync();
      if(!identity(directoryPin,await physicalDirectory(archiveDirectory))||!identity(pin,await fs.lstat(pending,{bigint:true})))fail('download_directory_changed');
      // No concurrent writer may turn a cache acquisition into an overwrite.
      await fs.link(pending,target);await fs.unlink(pending);success=true;
      await checkArchive(target,row,{hash:true});
    } finally {
      await output.close();
      if(!success){const current=await fs.lstat(pending,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(current){if(!identity(pin,current))fail('download_cleanup_refused');await fs.unlink(pending);}}
    }
  }
  return Object.freeze({archiveDirectory,components:lock.components.length});
}

export async function stagePrivateNativeTools({archiveDirectory,outputDirectory}={}) {
  const lock=await readPrivateNativeToolsLock();
  const sourcePin=await physicalDirectory(archiveDirectory);
  if(typeof outputDirectory!=='string'||!path.isAbsolute(outputDirectory)||path.resolve(outputDirectory)!==outputDirectory||outputDirectory.includes('\0'))fail('output_path_invalid');
  const parent=path.dirname(outputDirectory),parentPin=await physicalDirectory(parent);
  // Validate all prerequisites before creating output. The extractors verify
  // each complete archive digest before creating their component directory.
  for(const row of lock.components)await checkArchive(path.join(archiveDirectory,row.archive_name),row);
  const notices=new Map();
  for(const row of lock.components)for(const notice of row.notices){
    const bytes=await stableBytes(path.join(buildRoot,...notice.source.split('/')),1024*1024);
    if(digest(bytes)!==notice.sha256)fail('notice_digest_mismatch');notices.set(notice.source,bytes);
  }
  // mkdir without recursive and without reuse provides exclusive ownership.
  await fs.mkdir(outputDirectory,{mode:0o700});
  const outputPin=await physicalDirectory(outputDirectory);
  let primary;
  try {
    const components=[];
    for(const row of lock.components){
      const componentDirectory=path.join(outputDirectory,row.id);
      const extract=row.format==='zip'?extractPrivateToolZip:extractPrivateToolTarGz;
      const files=[...await extract({archivePath:path.join(archiveDirectory,row.archive_name),outputDirectory:componentDirectory,expectedSha256:row.archive_sha256})];
      const names=new Set(files.map(file=>file.path));
      if(row.required_files.some(name=>!names.has(name)))fail('required_payload_missing');
      for(const notice of row.notices){
        if(names.has(notice.path)||files.some(file=>file.path.toLowerCase()===notice.path.toLowerCase()))fail('notice_path_collision');
        const file=path.join(componentDirectory,...notice.path.split('/')),bytes=notices.get(notice.source);
        await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
        files.push({path:notice.path,bytes:bytes.length,sha256:notice.sha256});names.add(notice.path);
      }
      const {id,version,repository,tag,release_id,asset_id,archive_name,archive_sha256,archive_bytes,entrypoint}=row;
      components.push({id,version,repository,tag,release_id,asset_id,archive_name,archive_sha256,archive_bytes,entrypoint,
        files:files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)});
      if(inventoryDigest(components.at(-1).files)!==row.inventory_sha256)fail('inventory_pin_mismatch');
    }
    if(!identity(sourcePin,await physicalDirectory(archiveDirectory))||!identity(parentPin,await physicalDirectory(parent))
      ||!identity(outputPin,await physicalDirectory(outputDirectory)))fail('staging_directory_changed');
    const manifest=freeze({schema:'metaengine.private-native-tools.v1',platform:lock.platform,arch:lock.arch,components});
    const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    const manifestPath=path.join(outputDirectory,'manifest.json');
    await fs.writeFile(manifestPath,manifestBytes,{flag:'wx',mode:0o600});
    if(!(await stableBytes(manifestPath,32*1024*1024)).equals(manifestBytes))fail('manifest_readback_failed');
    return Object.freeze({manifest,manifestPath,manifestSha256:digest(manifestBytes)});
  }catch(error){primary=error;throw error;}
  finally{
    if(primary){
      try{if(!identity(outputPin,await physicalDirectory(outputDirectory))||!identity(parentPin,await physicalDirectory(parent)))fail('cleanup_refused');await fs.rm(outputDirectory,{recursive:true});}
      catch(cleanup){throw new AggregateError([primary,cleanup],'private_native_tools_stage_cleanup_refused',{cause:primary});}
    }
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),acquire=args[0]==='--acquire';if(acquire)args.shift();
  if(args.length!==4||args[0]!=='--archives'||args[2]!=='--output')fail('arguments_invalid');
  const archiveDirectory=args[1],outputDirectory=args[3];
  if(acquire)await acquirePrivateNativeToolArchives({archiveDirectory});
  const result=await stagePrivateNativeTools({archiveDirectory,outputDirectory});
  console.log(JSON.stringify({schema:result.manifest.schema,manifest_sha256:result.manifestSha256,
    components:result.manifest.components.map(row=>({id:row.id,version:row.version,files:row.files.length})),executed:false}));
}
