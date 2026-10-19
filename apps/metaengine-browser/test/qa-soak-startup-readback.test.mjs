import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {summarizeSoakStartup,SOAK_READBACK_SCHEMA}
  from '../scripts/qa-soak-startup-readback.mjs';
const exec=promisify(execFile);
const secret='SECRET:my-project-owner-private-root-and-connection';
const boot='private-boot-token-'+secret;
const journal={current_boot_id:boot,secret,
  events:[
    {boot_id:boot,state:'RUNTIME_IMPORT_OK',details:{secret}},
    {boot_id:boot,state:'PRIMARY_WINDOW_STABLE_TIMEOUT',details:{
      visible:false,window_count:0,elapsed_ms:15000,timeout_ms:15000,window_id:9,
      error:secret,profile_path:secret}},
    {boot_id:'other-boot',state:'PRIMARY_WINDOW_STABLE',details:{visible:true}},
    {boot_id:boot,state:secret,details:{secret}}
  ]};
test('normal UI failure summary retains exact bounded readback and strips secrets and paths',()=>{
  const result=summarizeSoakStartup(journal,'SOAK_NORMAL_UI_NOT_STABLE_VISIBLE');
  assert.equal(result.schema,SOAK_READBACK_SCHEMA);
  assert.equal(result.state,'UNQUALIFIED');
  assert.equal(result.boot_event_count,3);
  assert.equal(result.event_flags.PRIMARY_WINDOW_STABLE_TIMEOUT,true);
  assert.equal(result.event_flags.PRIMARY_WINDOW_STABLE,false);
  assert.equal(result.event_flags.RUNTIME_IMPORT_OK,true);
  assert.equal(result.last_window_observation,'PRIMARY_WINDOW_STABLE_TIMEOUT');
  assert.equal(result.window_visible,false);
  assert.equal(result.window_count,0);
  assert.equal(result.elapsed_ms,15000);
  assert.equal(result.production_authorized,false);
  assert.equal(result.automatic_retry_allowed,false);
  assert.equal(result.authority_effect,false);
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal(JSON.stringify(result).includes('window_id'),false);
});
test('missing or adversarial journal and unbounded fields never manufacture success',()=>{
  for(const j of [null,{}, {current_boot_id:boot,events:'forged'},
    {current_boot_id:boot,events:[{boot_id:boot,state:'PRIMARY_WINDOW_STABLE',details:{visible:'true'}}]}]){
    const result=summarizeSoakStartup(j,'SOAK_OTHER_FAILURE');
    assert.equal(result.state,'UNQUALIFIED');
    assert.notEqual(result.window_visible,true);
  }
  const oversized=summarizeSoakStartup({current_boot_id:boot,events:[{
    boot_id:boot,state:'PRIMARY_WINDOW_STABLE_TIMEOUT',details:{
      window_count:10000000,elapsed_ms:-1,timeout_ms:10000000}}]},'SOAK_OTHER_FAILURE');
  assert.equal(oversized.window_count,null);
  assert.equal(oversized.elapsed_ms,null);
  assert.equal(oversized.timeout_ms,null);
  assert.throws(()=>summarizeSoakStartup(journal,'FORGED_GREEN'),/qa_soak_readback_stage_invalid/);
});
test('CLI writes exclusive private bounded evidence only into RUNNER_TEMP',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-soak-readback-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const inFile=path.join(dir,'journal.json'),outFile=path.join(dir,'soak-normal-ui-readback.json');
  const script=new URL('../scripts/qa-soak-startup-readback.mjs',import.meta.url);
  await fs.writeFile(inFile,JSON.stringify(journal));
  const run=async file=>exec(process.execPath,[fileURLToPath(script),inFile,file,'SOAK_NORMAL_UI_NOT_STABLE_VISIBLE'],{
    env:{...process.env,RUNNER_TEMP:dir},timeout:10000});
  const actual=await run(outFile);
  assert.match(actual.stdout,/qa_soak_startup_readback_captured/);
  assert.equal(JSON.parse(await fs.readFile(outFile,'utf8')).state,'UNQUALIFIED');
  assert.equal((await fs.readFile(outFile,'utf8')).includes(secret),false);
  await assert.rejects(run(outFile));
  await assert.rejects(run(path.join(dir,'unexpected.json')));
});
test('Windows soak CI catches failures and uploads diagnostic without relaxing stable gate',async()=>{
  const source=await fs.readFile(new URL('../scripts/windows-autonomous-session-soak.ps1',import.meta.url),'utf8');
  const workflow=await fs.readFile(new URL('../../../.github/workflows/browser-windows-autonomous-soak-v1.yml',import.meta.url),'utf8');
  assert.match(source,/soak_normal_ui_not_stable_visible/);
  assert.match(source,/SOAK_NORMAL_UI_NOT_STABLE_VISIBLE/);
  assert.match(source,/qa-soak-startup-readback\.mjs/);
  assert.match(source,/\n\s*throw\s*\n\s*}\s*finally/);
  assert.match(workflow,/\$\{\{ runner\.temp }}\/soak-normal-ui-readback\.json/);
});
