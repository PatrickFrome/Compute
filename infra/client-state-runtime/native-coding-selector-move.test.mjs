import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {publishNativeSeedSelectorWindows as move} from './native-coding-selector-move.mjs';
const source='C:\\fixture\\.native-seed-selector-11111111-1111-4111-8111-111111111111.tmp';
const destination='C:\\fixture\\native-coding-seed-operator-v1.json';
const options={platform:'win32',env:{SystemRoot:'C:\\Windows',SECRET:'must-not-forward'}};

test('native selector move uses a fixed non-overwriting script and sanitized environment',async()=>{
 let calls=0;
 const result=await move(source,destination,{...options,run:async(exe,args,config)=>{
  calls++;assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(config.shell,false);assert.equal(config.env.SECRET,undefined);assert.equal(config.env.METAENGINE_SELECTOR_SOURCE,source);
  assert.equal(config.env.METAENGINE_SELECTOR_DESTINATION,destination);assert.ok(config.timeout>0&&config.timeout<=30000);
  const script=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert.match(script,/\[System.IO.File\]::Move\(\$env:METAENGINE_SELECTOR_SOURCE,\$env:METAENGINE_SELECTOR_DESTINATION\)/);
  assert.doesNotMatch(script,/Remove-Item|Delete\(|Replace\(|Move-Item|Invoke-Expression/);
  return {stdout:'METAENGINE_SELECTOR_PUBLISHED\r\n'};
 }});assert.equal(result,true);assert.equal(calls,1);
 assert.equal(await move(source,destination,{...options,run:async()=>({stdout:'METAENGINE_SELECTOR_EXISTS'})}),false);
});
test('invalid selector move paths, unsupported OS and cancelled requests start no native process',async()=>{
 let calls=0;const run=async()=>{calls++;};
 for(const [from,to] of [[source,'C:\\other\\native-coding-seed-operator-v1.json'],[source,destination+':stream'],['\\\\server\\x.tmp',destination],
  [source.replace('.native-seed-selector-','foreign-'),destination],[source.replace('fixture','fixture\\..\\fixture'),destination]]){
  await assert.rejects(move(from,to,{...options,run}),/paths_invalid/);
 }
 await assert.rejects(move(source,destination,{...options,run,platform:'linux'}),/windows_required/);
 await assert.rejects(move(source,destination,{...options,run,env:{SystemRoot:'C:\\untrusted'}}),/system_root_unverified/);
 const controller=new AbortController();controller.abort();await assert.rejects(move(source,destination,{...options,run,requestContext:{signal:controller.signal}}),/request_cancelled/);
 await assert.rejects(move(source,destination,{...options,run,requestContext:{deadlineAt:Date.now()-1}}),/deadline_exceeded/);assert.equal(calls,0);
});
test('unknown or late native move outcome is never retried or reported as confirmed',async()=>{
 let calls=0;await assert.rejects(move(source,destination,{...options,run:async()=>{calls++;throw Error('/private/token=secret');}}),e=>e.message==='native_coding_selector_move_native_operation_unconfirmed');
 assert.equal(calls,1);
 await assert.rejects(move(source,destination,{...options,run:async()=>({stdout:'PUBLISHED\nprivate text'})}),/native_result_unconfirmed/);
 const controller=new AbortController();await assert.rejects(move(source,destination,{...options,requestContext:{signal:controller.signal},run:async()=>{controller.abort();return {stdout:'METAENGINE_SELECTOR_PUBLISHED'};}}),/request_cancelled/);
});
test('Windows native selector move publishes one-link bytes and preserves existing bytes after lost acknowledgement',{
 skip:process.platform!=='win32',timeout:120000,
},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-selector-move-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const target=path.join(root,'native-coding-seed-operator-v1.json'),staged=()=>path.join(root,`.native-seed-selector-${randomUUID()}.tmp`);
 const first=staged();await fs.writeFile(first,'{"verified_fixture":true}',{flag:'wx'});
 // A restart may not know the first reply; it independently reads the final
 // object and never overwrites it. No post-move unlink is needed to be valid.
 let nativeCalls=0;const execute=promisify(execFile);
 await assert.rejects(move(first,target,{run:async(...args)=>{nativeCalls++;await execute(...args);throw Error('GENERATED_LOST_NATIVE_ACK');}}),/native_operation_unconfirmed/);
 assert.equal(nativeCalls,1);await assert.rejects(fs.stat(first),{code:'ENOENT'});
 assert.equal((await fs.stat(target)).nlink,1);assert.equal(await fs.readFile(target,'utf8'),'{"verified_fixture":true}');
 const later=staged();await fs.writeFile(later,'different fixture bytes',{flag:'wx'});
 assert.equal(await move(later,target),false);assert.equal(await fs.readFile(target,'utf8'),'{"verified_fixture":true}');
 assert.equal(await fs.readFile(later,'utf8'),'different fixture bytes');assert.equal((await fs.stat(target)).nlink,1);
});
