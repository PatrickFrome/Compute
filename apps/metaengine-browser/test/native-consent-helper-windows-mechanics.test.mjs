import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertGeneratedFirstRunCi, assertGeneratedFirstRunFixtureRoot,
  declineInstalledFreshProviderConsent } from '../scripts/qa-decline-fresh-provider-consent.mjs';

const runner=fileURLToPath(new URL('./fixtures/native-consent-mechanics-runner.mjs',import.meta.url));
const windowsCi=process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true';
const bounded=(promise,ms,reason)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error(reason)),Math.max(1,ms));
  promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
});

test('native-helper mechanics: genuine native No in generated Windows CI, NOT installed Browser qualification',
  {skip:!windowsCi,timeout:110000},async t=>{
  assertGeneratedFirstRunCi();
  const runnerTemp=await fs.realpath(process.env.RUNNER_TEMP);
  const fixtureRoot=await fs.mkdtemp(path.join(runnerTemp,'native-consent-mechanics-'));
  assertGeneratedFirstRunFixtureRoot(fixtureRoot);
  const nonce=randomUUID();
  let launch=null,closed=null,cleanupConfirmed=false,stdout='',stderr='';
  try {
    await fs.writeFile(path.join(fixtureRoot,'generated-first-run-fixture.json'),JSON.stringify({
      schema:'metaengine.browser.generated-first-run-fixture.v1',nonce}),{flag:'wx',mode:0o600});
    for(const name of ['Local','Roaming','Temp'])await fs.mkdir(path.join(fixtureRoot,name));
    const env=Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','GITHUB_ACTIONS','GITHUB_RUN_ID','RUNNER_TEMP']
      .filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
    Object.assign(env,{TEMP:path.join(fixtureRoot,'Temp'),TMP:path.join(fixtureRoot,'Temp')});
    const startedMs=Date.now(),deadlineMs=startedMs+90000;
    launch=spawn(process.execPath,[runner,fixtureRoot,nonce],{env,shell:false,windowsHide:true,
      cwd:fixtureRoot,stdio:['ignore','pipe','pipe','ipc']});
    launch.stdout.on('data',bytes=>{stdout=(stdout+bytes.toString('utf8')).slice(-16384);});
    launch.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString('utf8')).slice(-16384);});
    closed=new Promise((resolve,reject)=>{launch.once('error',reject);launch.once('close',(code,signal)=>resolve({code,signal}));});
    closed.catch(()=>{});
    const interaction=await declineInstalledFreshProviderConsent({browserPid:launch.pid,
      executable:process.execPath,fixtureRoot,nonce,startedMs,deadlineMs});
    const exit=await bounded(closed,deadlineMs-Date.now(),'native_helper_mechanics_denial_exit_timeout');
    assert.deepEqual(exit,{code:0,signal:null});
    const rows=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert.equal(rows.length,1);
    const outcome=rows[0];
    assert.equal(outcome.schema,'metaengine.test.native-consent-mechanics-result.v1');
    assert.equal(outcome.harness_pid,launch.pid);
    assert.equal(outcome.native_child_spawned,true);
    assert.equal(outcome.native_child_cleanup_confirmed,true);
    cleanupConfirmed=true;
    assert.equal(outcome.native_process.pid,interaction.consent_pid);
    assert.equal(outcome.native_process.exit_code,2);
    assert.equal(outcome.native_process.signal,null);
    assert.equal(outcome.native_process.killed,false);
    assert.equal(outcome.native_process.exact_declined_sentinel,true);
    assert.equal(outcome.reason,'fresh_provider_native_consent_declined');
    assert.equal(outcome.declined,true);
    for(const key of ['installed_browser_qualification','owner_boot_qualification',
      'database_provisioning_qualification','guardian_qualification','authority_effect'])assert.equal(outcome[key],false,key);
    const nativeRows=stderr.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert.deepEqual(nativeRows.map(row=>row.state),['NATIVE_CONSENT_REQUESTED','NATIVE_CONSENT_DECLINED']);
    for(const row of nativeRows){
      assert.equal(row.schema,'metaengine.browser.fresh-provider-native-consent.v1');
      assert.equal(row.parent_pid,launch.pid);assert.equal(row.diagnostic_only,true);
      assert.equal(row.browser_runtime_started,false);assert.equal(row.authority_effect,false);
    }
    // Only compiler scratch files in Temp are permitted. The real consent call
    // cannot publish Owner, device identity, private setup, database or journal.
    for(const name of ['Local','Roaming'])assert.deepEqual(await fs.readdir(path.join(fixtureRoot,name)),[]);
    const sources={};
    for(const [name,url] of [
      ['native_consent',new URL('../../../infra/client-state-runtime/fresh-provider-native-consent.mjs',import.meta.url)],
      ['native_no_helper',new URL('../scripts/qa-decline-fresh-provider-consent.ps1',import.meta.url)],
      ['native_no_controller',new URL('../scripts/qa-decline-fresh-provider-consent.mjs',import.meta.url)],
      ['inert_harness',new URL('./fixtures/native-consent-mechanics-runner.mjs',import.meta.url)],
    ])sources[name]=createHash('sha256').update(await fs.readFile(url)).digest('hex');
    t.diagnostic(JSON.stringify({schema:'metaengine.test.native-consent-helper-mechanics-proof.v1',
      github_run_id:process.env.GITHUB_RUN_ID,source_sha256:sources,
      scope:'GENERATED_NODE_PARENT_NATIVE_NO_ONLY',harness_pid:launch.pid,consent_pid:interaction.consent_pid,
      exact_process_tree_bound:interaction.exact_process_tree_bound,native_control_id:interaction.native_control_id,
      actual_native_exit_code:outcome.native_process.exit_code,exact_declined_sentinel:true,
      generated_local_and_roaming_unchanged:true,process_cleanup_confirmed:true,
      installed_browser_qualification:false,owner_boot_qualification:false,
      database_provisioning_qualification:false,guardian_qualification:false,authority_effect:false}));
  }catch(error){
    const states=stderr.split(/\r?\n/).flatMap(line=>{
      try {const row=JSON.parse(line);return row.schema==='metaengine.browser.fresh-provider-native-consent.v1'
        &&['NATIVE_CONSENT_REQUESTED','NATIVE_CONSENT_DECLINED','NATIVE_CONSENT_NOT_CONFIRMED','NATIVE_CONSENT_CONFIRMED'].includes(row.state)
        ?[row.state]:[];}catch{return [];}
    });
    t.diagnostic(JSON.stringify({schema:'metaengine.test.native-consent-helper-mechanics-hold.v1',
      reason:/^installed_launch_native_no_[a-z_]+$/.test(error?.message||'')?error.message:'native_helper_mechanics_contract_unproven',
      harness_pid:launch?.pid??null,harness_exit_code:launch?.exitCode??null,native_states:states,
      installed_browser_qualification:false,authority_effect:false}));
    throw error;
  }finally{
    if(launch&&closed&&!cleanupConfirmed){
      if(launch.connected)launch.send({schema:'metaengine.test.native-consent-mechanics-stop.v1',nonce});
      await bounded(closed,10000,'native_helper_mechanics_cleanup_unconfirmed');
      let terminal;
      try {terminal=JSON.parse(stdout.trim());}catch{}
      // A harness exit/crash is not proof that its native child is gone.
      cleanupConfirmed=terminal?.schema==='metaengine.test.native-consent-mechanics-result.v1'
        &&terminal.harness_pid===launch.pid&&terminal.native_child_cleanup_confirmed===true;
      if(!cleanupConfirmed)throw Error('native_helper_mechanics_cleanup_unconfirmed');
    }
    // Keep evidence on an unconfirmed cleanup; never erase an active namespace.
    if(!launch||cleanupConfirmed)await fs.rm(fixtureRoot,{recursive:true,force:true});
  }
});

test('inert harness refuses a missing generated IPC contract before any native launch',async()=>{
  const execute=promisify(execFile);
  const env=Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP']
    .filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
  await assert.rejects(execute(process.execPath,[runner],{env,shell:false,windowsHide:true,timeout:5000,maxBuffer:4096}),error=>{
    assert.equal(error.code,1);
    const outcome=JSON.parse(String(error.stdout).trim());
    assert.equal(outcome.schema,'metaengine.test.native-consent-mechanics-result.v1');
    assert.equal(outcome.native_process,null);assert.equal(outcome.declined,false);
    assert.equal(outcome.native_child_spawned,false);assert.equal(outcome.native_child_cleanup_confirmed,true);
    assert.equal(outcome.reason,'native_helper_mechanics_fixture_unconfirmed');
    assert.equal(String(error.stderr),'');
    return true;
  });
});

test('native mechanics smoke uses the real consent call and real subprocess observation, never canned consent',async()=>{
  const source=await fs.readFile(runner,'utf8');
  assert.match(source,/import \{ confirmFreshProviderNativeConsent \} from/);
  assert.match(source,/const operation=execute\(executable,args,options\)/);
  assert.match(source,/await confirmFreshProviderNativeConsent\(selection,\{run:observeNativeProcess\}\)/);
  assert.match(source,/nativeOutcome\?\.exit_code===2/);
  assert.match(source,/process\.once\('disconnect',cancel\)/);
  assert.doesNotMatch(source,/Object\.defineProperty|registerHooks|provisionFreshClientProvider|setupInstalledFreshProvider|verified\s*:\s*true/);
});
