import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {nativeCodingAsarQualificationMode} from './fixtures/native-coding-asar-qualification-mode.mjs';

const run=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let electron=process.env.METAENGINE_TEST_ELECTRON_EXECUTABLE;
if(electron===undefined)try{electron=createRequire(import.meta.url)('electron');}catch{}
const qualification=nativeCodingAsarQualificationMode({mode:process.env.METAENGINE_TEST_ELECTRON_MODE,electron,
  explicitExecutable:process.env.METAENGINE_TEST_ELECTRON_EXECUTABLE!==undefined});

// A real ASAR header and real Electron fs implementations exercise the bug.
// Executable/resource/process identities below are isolated fixtures: this regression
// does not install a client, start a Host, contact PG or run an agent/model.
// MAIN_PROCESS remains the default. Explicit Linux ASAR_NODE uses Electron's
// supported Node mode and its genuine ASAR/original-fs implementations, without
// qualifying GUI/main-process startup or changing Chromium sandbox settings.
function archive(files){
  const header={files:{}},contents=[];let offset=0;
  for(const [name,bytes] of Object.entries(files)){
    let parent=header;const parts=name.split('/');
    for(const part of parts.slice(0,-1))parent=(parent.files[part]??={files:{}});
    parent.files[parts.at(-1)]={offset:String(offset),size:bytes.length};contents.push(bytes);offset+=bytes.length;
  }
  const json=Buffer.from(JSON.stringify(header)),pickle=Buffer.alloc(8+Math.ceil(json.length/4)*4);
  pickle.writeUInt32LE(pickle.length-4,0);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);
  const size=Buffer.alloc(8);size.writeUInt32LE(4,0);size.writeUInt32LE(pickle.length,4);
  return Buffer.concat([size,pickle,...contents]);
}

test('real Electron '+qualification.mode+' qualifies physical ASAR bytes while retaining archive package and bridge reads',{
  timeout:60000,skip:qualification.skip,
},async t=>{
  const temp=await fs.realpath(os.tmpdir());
  const root=await fs.realpath(await fs.mkdtemp(path.join(temp,'metaengine-native-asar-regression-')));
  const real=await fs.realpath(root);
  assert.equal(path.dirname(real).toLowerCase(),temp.toLowerCase());
  assert(path.basename(real).startsWith('metaengine-native-asar-regression-'));
  t.after(async()=>{
    assert.equal((await fs.realpath(root)).toLowerCase(),real.toLowerCase());
    await fs.rm(real,{recursive:true,force:true});
  });
  const resources=path.join(root,'resources'),bundle=path.join(resources,'client-state-runtime');
  await fs.mkdir(path.join(bundle,'runtime','node'),{recursive:true});
  const exe=path.join(root,'fixture.exe'),cli=path.join(root,'codex.exe'),asar=path.join(resources,'app.asar');
  const packageJson=Buffer.from(JSON.stringify({version:'asar-regression',metaengineClientStateRuntime:{
    bundle_sha256:'a'.repeat(64),source_head_sha:'b'.repeat(40),package_version:'asar-regression'}}));
  const bridge={entrypoint:'native-coding-agent-mcp-entry.mjs',broker:'native-coding-agent-mcp-broker.mjs',adapter:'native-coding-agent-mcp-stdio.mjs'};
  const sources=Object.fromEntries(Object.values(bridge).map(name=>['src/'+name,Buffer.from('// real ASAR fixture '+name+'\n')]));
  const bytes=archive({'package.json':packageJson,...sources});
  await Promise.all([[exe,'fixture exe'],[cli,'fixture cli'],[asar,bytes],[path.join(bundle,'runtime','node','node.exe'),'fixture node']]
    .map(([file,value])=>fs.writeFile(file,value)));
  const sourceUrl=new URL('../src/native-coding-host-observers.mjs',import.meta.url).href;
  const resultPath=path.join(root,'result.json'),entry=path.join(root,'entry.mjs');
  await fs.writeFile(entry,`
import nodeFs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {createNativeCodingHostObservers} from ${JSON.stringify(sourceUrl)};
const physicalFs=createRequire(import.meta.url)('original-fs');
const root=${JSON.stringify(root)},resources=${JSON.stringify(resources)},bundle=${JSON.stringify(bundle)},asar=${JSON.stringify(asar)};
const exe=${JSON.stringify(exe)},cli=${JSON.stringify(cli)},resultPath=${JSON.stringify(resultPath)};
const qualificationMode=${JSON.stringify(qualification.mode)};
let finish=code=>{process.exitCode=code;};
async function qualify(){
 try{
  let verifications=0;
  const observers=createNativeCodingHostObservers({app:{isPackaged:true,getPath:()=>exe,getAppPath:()=>asar},
   resourcesPath:resources,cliPath:cli,gitExecutable:process.execPath,identity:{snapshot:()=>({})},
   ownPostgres:{readScope:async()=>{},readLease:async()=>{}},permitRegistry:{readProvider:async()=>{}},
   readNativeWorker:async()=>{},readCriticSubject:async()=>{},readProcess:async()=>({exe_path:exe}),
   verifyResources:async()=>{verifications++;return {manifest:{files:[{path:'runtime/node/node.exe',sha256:'c'.repeat(64)}]},
    paths:{nodeExecutable:path.join(bundle,'runtime','node','node.exe')}};}});
  const virtualIsDirectory=(await nodeFs.promises.lstat(asar)).isDirectory();
  const physicalIsFile=(await physicalFs.promises.lstat(asar)).isFile();
  await observers.prepareInstalledImage();
  const observed=await observers.readInstalledImage(),pins=await observers.readAgentMcpLaunchPins();
  await physicalFs.promises.appendFile(asar,'changed archive bytes');
  let changedRejected=false,permanentlyFenced=false;
  try{await observers.readInstalledImage();}catch(error){changedRejected=/guard_changed/.test(error.message);}
  try{await observers.prepareInstalledImage();}catch(error){permanentlyFenced=/invalidated/.test(error.message);}
  await physicalFs.promises.writeFile(resultPath,JSON.stringify({electron:process.versions.electron,virtualIsDirectory,physicalIsFile,
   qualification_mode:qualificationMode,main_process_started:process.type==='browser',process_type:process.type??null,
   artifact:observed.value,bridgeSha256:pins.bridgeSha256,verifications,changedRejected,permanentlyFenced,
   installed_runtime_qualified:false,model_calls:0}));finish(0);
 }catch(error){await physicalFs.promises.writeFile(resultPath,JSON.stringify({error:error.stack}));finish(1);}
}
if(qualificationMode==='MAIN_PROCESS'){
 const {app}=await import('electron');
 app.setPath('userData',path.join(root,'electron-user-data'));app.disableHardwareAcceleration();
 finish=code=>app.exit(code);app.whenReady().then(qualify);
}else{
 if(process.env.ELECTRON_RUN_AS_NODE!=='1'||process.type!==undefined)throw Error('asar_node_mode_unconfirmed');
 await qualify();
}
`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  if(qualification.mode==='ASAR_NODE'){env.ELECTRON_RUN_AS_NODE='1';delete env.ELECTRON_NO_ASAR;}
  // This isolated MAIN_PROCESS fixture loads no renderer or remote content.
  // Ubuntu's runner does not configure Electron's setuid helper. The product
  // launch and its renderer sandbox settings remain outside this fixture.
  const args=process.platform==='linux'&&qualification.mode==='MAIN_PROCESS'?['--no-sandbox',entry]:[entry];
  const pending=run(electron,args,{windowsHide:true,shell:false,timeout:45000,maxBuffer:256*1024,env});
  pending.child?.stdin?.end();
  try{await pending;}catch(error){
    const result=await fs.readFile(resultPath,'utf8').catch(()=>null);
    throw new Error('real Electron observer regression failed: '+(result||error.stderr||error.message));
  }
  const result=JSON.parse(await fs.readFile(resultPath,'utf8'));
  assert.match(result.electron,/^\d+\./);assert.equal(result.virtualIsDirectory,true);assert.equal(result.physicalIsFile,true);
  assert.equal(result.qualification_mode,qualification.mode);
  assert.equal(result.main_process_started,qualification.mode==='MAIN_PROCESS');
  assert.equal(result.process_type,qualification.mode==='MAIN_PROCESS'?'browser':null);
  assert.equal(result.artifact.installed_asar_sha256,hash(bytes));assert.equal(result.artifact.installed_exe_sha256,hash('fixture exe'));
  assert.equal(result.artifact.cli_executable_sha256,hash('fixture cli'));assert.equal(result.artifact.source_sha,'b'.repeat(40));
  for(const [key,name]of Object.entries(bridge))assert.equal(result.bridgeSha256[key],hash(sources['src/'+name]));
  assert.equal(result.verifications,1);assert.equal(result.changedRejected,true);assert.equal(result.permanentlyFenced,true);
  assert.equal(result.installed_runtime_qualified,false);assert.equal(result.model_calls,0);
  t.diagnostic(JSON.stringify({classification:'REAL_ELECTRON_'+qualification.mode+'_ASAR_FILESYSTEM',electron:result.electron,
    main_process_started:result.main_process_started,virtual_asar_and_physical_original_fs:true,
    digest_and_tamper_guards_verified:true,installed_runtime_qualified:false,model_calls:0}));
});
