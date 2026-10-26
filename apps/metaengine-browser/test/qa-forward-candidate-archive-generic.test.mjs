// All fixtures are inert source/filesystem controls; no installer or PG runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {zip} from './fixtures/forward-archive-zip.mjs';
import {materializeForwardArchive,verifyForwardArchiveFiles,readForwardArchiveMember}
  from '../scripts/qa-forward-candidate-archive.mjs';


const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const proof=Buffer.from('{"immutable":"proof"}\n');
const base=[{name:'manifest.json',bytes:proof},{name:'nested/payload.bin',bytes:Buffer.from([0,255,128,1,2,13,10])}];
async function fixture(t,entries=base,options={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'forward-generic-proposal-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const archiveFile=path.join(root,'artifact.zip'),destination=path.join(root,'output'),built=zip(entries,options);
  await fs.writeFile(archiveFile,built.bytes);
  const pins={archiveFile,archiveSha256:digest(built.bytes)};
  return {root,destination,built,pins,
    materialize:extra=>materializeForwardArchive({...pins,destination,...extra}),
    verify:extra=>verifyForwardArchiveFiles({...pins,directory:destination,...extra}),
    member:extra=>readForwardArchiveMember({...pins,memberName:'manifest.json',...extra})};
}

for(const [name,options,edit] of [
  ['stored',{},row=>row],
  ['deflate streaming signed',{},row=>({...row,method:8,descriptor:true})],
  ['deflate streaming unsigned',{},row=>({...row,method:8,descriptor:true,signedDescriptor:false})],
  ['ZIP64 stored',{zip64:true},row=>row],
  ['ZIP64 streaming',{zip64:true},row=>({...row,method:8,descriptor:true})],
  ['ZIP64 central',{zip64CentralOnly:true},row=>row],
  ['ZIP64 end records',{zip64EndOnly:true},row=>row],
  ['EOCD comment',{comment:Buffer.from('inert comment')},row=>row],
])test('shared generic roundtrip: '+name,async t=>{
  const f=await fixture(t,base.map(edit),options),m=await f.materialize(),v=await f.verify(),member=await f.member();
  assert.equal(m.tree_sha256,v.tree_sha256);assert.deepEqual(m.files,v.files);
  assert.equal(v.full_archive_file_membership_verified,true);assert.equal(m.authority_effect,false);
  assert.equal(v.production_authorized,false);assert.equal(member.sha256,digest(proof));
  assert.deepEqual(member.bytes,proof);assert.equal(member.size,proof.length);
  const binary=await f.member({memberName:'nested/payload.bin'});
  assert.deepEqual(binary.bytes,base[1].bytes);
});

test('explicit ZIP empty directories are preserved and verified',async t=>{
  const f=await fixture(t,[...base,{name:'empty/',bytes:''}]);
  await f.materialize();assert.deepEqual(await fs.readdir(path.join(f.destination,'empty')),[]);
  assert.equal((await f.verify()).file_count,2);
});
test('generic materialization refuses an existing target without overwriting it',async t=>{
  const f=await fixture(t);await fs.mkdir(f.destination);await fs.writeFile(path.join(f.destination,'marker'),'retained');
  await assert.rejects(f.materialize(),/destination_exists/);
  assert.equal(await fs.readFile(path.join(f.destination,'marker'),'utf8'),'retained');
});
test('wrong archive digest refuses both materialization and member reads',async t=>{
  const f=await fixture(t),bad={archiveSha256:'f'.repeat(64)};
  await assert.rejects(f.materialize(bad),/archive_digest_mismatch/);
  await assert.rejects(f.member(bad),/archive_digest_mismatch/);
  await assert.rejects(fs.lstat(f.destination),{code:'ENOENT'});
});

for(const [name,extra] of [
  ['traversal',[{name:'../escaped',bytes:'x'}]],
  ['drive',[{name:'C:/escaped',bytes:'x'}]],
  ['backslash',[{name:'nested\\escaped',bytes:'x'}]],
  ['NUL raw name',[{name:'visible\0hidden',bytes:'x'}]],
  ['Windows reserved',[{name:'con.txt',bytes:'x'}]],
  ['short-name alias',[{name:'LONGNA~1.txt',bytes:'x'}]],
  ['case alias',[{name:'Upper',bytes:'x'},{name:'UPPER',bytes:'y'}]],
  ['Unicode uppercase alias',[{name:'S',bytes:'x'},{name:'ſ',bytes:'y'}]],
  ['non-NFC',[{name:'e\u0301',bytes:'x'}]],
  ['directory case alias',[{name:'Other/a',bytes:'x'},{name:'other/b',bytes:'y'}]],
  ['file-directory prefix',[{name:'file',bytes:'x'},{name:'file/child',bytes:'y'}]],
  ['Unix symlink',[{name:'link',bytes:'target',mode:0o120777}]],
  ['DOS reparse',[{name:'link',bytes:'target',attributes:0x400}]],
  ['local central name mismatch',[{name:'other',localName:'changed',bytes:'x'}]],
  ['alternate unicode metadata',[{name:'other',bytes:'x',centralExtra:Buffer.from([0x75,0x70,0,0])}]],
  ['encrypted flags',[{name:'other',bytes:'x',flags:0x801}]],
  ['legacy non-ASCII encoding',[{name:'é',bytes:'x',flags:0}]],
  ['directory payload',[{name:'empty/',bytes:'data'}]],
])test('all generic entry points reject unsafe raw ZIP metadata: '+name,async t=>{
  const f=await fixture(t,[...base,...extra]);
  await assert.rejects(f.materialize(),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(f.member(),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(f.verify(),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(fs.lstat(f.destination),{code:'ENOENT'});
  await assert.rejects(fs.lstat(path.join(f.root,'escaped')),{code:'ENOENT'});
});

test('CRC corruption never produces a success receipt or a raw member',async t=>{
  const f=await fixture(t,[{name:'manifest.json',bytes:proof,crc:1234}]);
  await assert.rejects(f.materialize(),/zip_size_or_crc_mismatch/);
  await assert.rejects(f.member(),/zip_size_or_crc_mismatch/);
  await assert.rejects(f.verify(),/zip_size_or_crc_mismatch/);
});
test('member byte limit is bounded and a missing/oversized entry remains refusal',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.member({maxBytes:0}),/member_byte_limit_invalid/);
  await assert.rejects(f.member({maxBytes:33*1024**2}),/member_byte_limit_invalid/);
  await assert.rejects(f.member({maxBytes:proof.length-1}),/member_missing_or_oversize/);
  await assert.rejects(f.member({memberName:'absent'}),/member_missing_or_oversize/);
  await assert.rejects(fs.lstat(f.destination),{code:'ENOENT'});
});
for(const [name,limits] of [
  ['file count',{maxFiles:1}],['file bytes',{maxFileBytes:2}],['total bytes',{maxBytes:2}],
  ['entries including implicit dirs',{maxEntries:2}],['depth',{maxDepth:1}],['archive bytes',{maxArchiveBytes:22}],
])test('generic bounds reject before creating output: '+name,async t=>{
  const f=await fixture(t);await assert.rejects(f.materialize({limits}),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(fs.lstat(f.destination),{code:'ENOENT'});
});

test('read-only verification refuses changed bytes, extra files and missing files without repairs',async t=>{
  const f=await fixture(t);await f.materialize();const payload=path.join(f.destination,'nested/payload.bin');
  await fs.writeFile(payload,Buffer.from('tainted'));
  await assert.rejects(f.verify(),/materialized_bytes_changed/);
  assert.equal(await fs.readFile(payload,'utf8'),'tainted');
  await fs.writeFile(payload,base[1].bytes);await fs.writeFile(path.join(f.destination,'extra'),'retained');
  await assert.rejects(f.verify(),/materialized_unlisted_entry/);
  assert.equal(await fs.readFile(path.join(f.destination,'extra'),'utf8'),'retained');
  await fs.unlink(path.join(f.destination,'extra'));await fs.unlink(payload);
  await assert.rejects(f.verify(),/materialized_entry_missing/);
  await assert.rejects(fs.lstat(payload),{code:'ENOENT'});
});
test('explicit authenticated directory rows allow only already-existing additional empty directories',async t=>{
  const f=await fixture(t);await f.materialize();const addedDirectories=['extra','extra/deep'];
  await assert.rejects(f.verify({addedDirectories}),/materialized_entry_missing/);
  await assert.rejects(fs.lstat(path.join(f.destination,'extra')),{code:'ENOENT'});
  await fs.mkdir(path.join(f.destination,'extra/deep'),{recursive:true});
  await assert.rejects(f.verify(),/materialized_unlisted_entry/);
  assert.deepEqual((await f.verify({addedDirectories})).added_directories,addedDirectories);
  await fs.writeFile(path.join(f.destination,'extra/deep/not-archived'),'x');
  await assert.rejects(f.verify({addedDirectories}),/materialized_unlisted_entry/);
});
test('directory exceptions cannot authorize files, aliases, duplicates or traversal',async t=>{
  const f=await fixture(t);await f.materialize();
  for(const addedDirectories of [['manifest.json'],['nested','NESTED'],['nested','nested'],['../escaped'],['nested\\bad'],['ſ','S']])
    await assert.rejects(f.verify({addedDirectories}),/qa_forward_(archive|sidecar)_/);
  assert.deepEqual(await fs.readFile(path.join(f.destination,'manifest.json')),proof);
});
test('read-only verification and member reads never call a filesystem mutator',async t=>{
  const f=await fixture(t);await f.materialize();const open=fs.open;
  for(const name of ['mkdir','writeFile','rename','unlink','rm'])t.mock.method(fs,name,()=>{throw new Error('unexpected mutator '+name);});
  t.mock.method(fs,'open',(...args)=>{
    assert.equal(typeof args[1],'number');assert.equal(args[1]&(constants.O_WRONLY|constants.O_RDWR|constants.O_CREAT|constants.O_TRUNC|constants.O_APPEND),0);
    return open(...args);
  });
  try {await f.verify();await f.member();}finally{t.mock.restoreAll();}
});
test('materialized hardlinks are rejected before byte consumption',async t=>{
  const f=await fixture(t);await f.materialize();const file=path.join(f.destination,'manifest.json');
  await fs.link(file,path.join(f.root,'outside-link'));
  await assert.rejects(f.verify(),/materialized_regular_file_required/);
});
test('hardlinked archives and native source-path aliases cannot become an input',async t=>{
  const f=await fixture(t);await fs.link(f.pins.archiveFile,path.join(f.root,'archive-link'));
  await assert.rejects(f.materialize(),/archive_not_regular/);await fs.unlink(path.join(f.root,'archive-link'));
  if(process.platform==='win32'){
    // Native junctions need no optional Developer Mode/file-symlink privilege.
    const actual=path.join(f.root,'real-source'),alias=path.join(f.root,'source-alias');await fs.mkdir(actual);
    await fs.rename(f.pins.archiveFile,path.join(actual,'artifact.zip'));await fs.symlink(actual,alias,'junction');
    await assert.rejects(f.member({archiveFile:path.join(alias,'artifact.zip')}),/directory_alias_or_reparse/);
  }else{
    const real=path.join(f.root,'real.zip');await fs.rename(f.pins.archiveFile,real);await fs.symlink(real,f.pins.archiveFile,'file');
    await assert.rejects(f.member(),/archive_not_regular/);
  }
});
test('native directory junctions and symlink ancestors are rejected',async t=>{
  const f=await fixture(t);await f.materialize();const actual=path.join(f.root,'actual-nested'),nested=path.join(f.destination,'nested');
  await fs.rename(nested,actual);await fs.symlink(actual,nested,process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.verify(),/materialized_link_or_reparse/);
  const alias=path.join(f.root,'output-alias');await fs.symlink(f.destination,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.verify({directory:alias}),/directory_alias_or_reparse/);
});
test('actual regular-file replacement after initial inspection cannot inherit its byte identity',async t=>{
  const f=await fixture(t);await f.materialize();const target=path.join(f.destination,'manifest.json'),open=fs.open;let replaced=false;
  t.mock.method(fs,'open',async(...args)=>{
    if(args[0]===target&&!replaced){replaced=true;await fs.rename(target,path.join(f.root,'retained-manifest'));await fs.writeFile(target,proof);}
    return open(...args);
  });
  await assert.rejects(f.verify(),/materialized_file_changed/);assert.equal(replaced,true);
});
test('archive replacement with identical bytes during a read still fails its held identity',async t=>{
  const f=await fixture(t);await f.materialize();const target=path.join(f.destination,'manifest.json'),open=fs.open;let replaced=false;
  t.mock.method(fs,'open',async(...args)=>{
    if(args[0]===target&&!replaced){replaced=true;await fs.rename(f.pins.archiveFile,path.join(f.root,'retained-archive'));await fs.writeFile(f.pins.archiveFile,f.built.bytes);}
    return open(...args);
  });
  await assert.rejects(f.verify(),/archive_changed/);assert.equal(replaced,true);
});
for(const mode of ['verify','materialize'])test('target custody survives the final archive scan: '+mode,async t=>{
  const f=await fixture(t);if(mode==='verify')await f.materialize();
  const target=path.join(f.destination,'manifest.json'),open=fs.open;let targetSeen=false,changed=false;
  t.mock.method(fs,'open',async(...args)=>{
    const handle=await open(...args);
    if(args[0]===target)targetSeen=true;
    if(args[0]===f.pins.archiveFile){
      const read=handle.read.bind(handle);
      handle.read=async(...args)=>{
        if(targetSeen&&!changed&&args[2]===f.built.bytes.length&&args[3]===0){
          changed=true;await fs.writeFile(target,Buffer.alloc(proof.length,120));
        }
        return read(...args);
      };
    }
    return handle;
  });
  await assert.rejects(mode==='verify'?f.verify():f.materialize(),/materialized_file_changed/);assert.equal(changed,true);
});
test('unrelated concurrent sibling activity is compatible with held ancestor identity',async t=>{
  const f=await fixture(t);await f.materialize();const realpath=fs.realpath;let changed=false;
  t.mock.method(fs,'realpath',async(...args)=>{
    if(args[0]===f.root&&!changed){changed=true;await fs.mkdir(path.join(f.root,'unrelated-sibling'));}
    return realpath(...args);
  });
  assert.equal((await f.verify()).file_count,2);assert.equal(changed,true);
});

// The shared sidecar parser has explicit manifest/image overhead allowances.
// Every generic entry point must additionally apply the same generic ceilings,
// including a read that selects only one small member from a larger archive.
for(const [name,entries,limits,memberName] of [
  ['maxFiles', [{name:'first',bytes:'1234567'},{name:'second',bytes:'x'}], {maxFiles:1}, 'first'],
  ['maxBytes', [{name:'first',bytes:'1234567'}], {maxBytes:1}, 'first'],
  ['maxDepth including win-unpacked prefix', [{name:'win-unpacked/first',bytes:'1234567'}], {maxDepth:1}, 'win-unpacked/first'],
  ['maxEntries without sidecar overhead', [{name:'first',bytes:'1234567'},{name:'second',bytes:'x'}], {maxEntries:1}, 'first'],
  ['maxEntries including implied directory', [{name:'parent/first',bytes:'1234567'}], {maxEntries:1}, 'parent/first'],
  ['maxFileBytes including special manifest', [{name:'forward-install-sidecar.json',bytes:'1234567'}], {maxFileBytes:1}, 'forward-install-sidecar.json'],
  ['maxManifestBytes', [{name:'forward-install-sidecar.json',bytes:'1234567'}], {maxManifestBytes:1}, 'forward-install-sidecar.json'],
  ['maxArchiveBytes', [{name:'first',bytes:'1234567'}], {maxArchiveBytes:22}, 'first'],
  ['aggregate maxBytes despite a small selected member', [{name:'first',bytes:'x'},{name:'second',bytes:'1234567'}], {maxBytes:7}, 'first'],
])test('all three generic APIs enforce '+name,async t=>{
  const f=await fixture(t,entries),accepted=await f.materialize(),refusedDestination=path.join(f.root,'over-limit');
  await assert.rejects(f.materialize({destination:refusedDestination,limits}),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(f.verify({limits}),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(f.member({memberName,limits}),/qa_forward_(archive|sidecar)_/);
  await assert.rejects(fs.lstat(refusedDestination),{code:'ENOENT'});
  assert.equal((await f.verify()).tree_sha256,accepted.tree_sha256);
});
test('all three generic APIs accept the exact common ceiling boundary',async t=>{
  const f=await fixture(t,[{name:'first',bytes:'1234567'}]);
  const limits={maxFiles:1,maxEntries:1,maxDepth:1,maxBytes:7,maxFileBytes:7,maxManifestBytes:7,maxArchiveBytes:f.built.bytes.length};
  const materialized=await f.materialize({limits}),verified=await f.verify({limits}),member=await f.member({memberName:'first',limits,maxBytes:7});
  assert.equal(materialized.tree_sha256,verified.tree_sha256);assert.equal(member.size,7);assert.equal(member.bytes.toString(),'1234567');
});
