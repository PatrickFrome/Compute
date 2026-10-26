// Only the generated installed negative fixture can invoke native No. A readback
// or native interaction alone is never a denied-consent or runtime qualification.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const execute=promisify(execFile);
const helper=fileURLToPath(new URL('./qa-decline-fresh-provider-consent.ps1',import.meta.url));
const pid=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const fail=reason=>{throw Error('installed_launch_'+reason);};

export function assertGeneratedFirstRunCi(env=process.env) {
  if(env.GITHUB_ACTIONS!=='true'||! /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID||'')||!path.isAbsolute(env.RUNNER_TEMP||''))fail('first_run_generated_ci_required');
}
export function assertGeneratedFirstRunFixtureRoot(fixtureRoot,env=process.env) {
  assertGeneratedFirstRunCi(env);
  if(!path.isAbsolute(fixtureRoot||''))fail('native_no_fixture_unbound');
  const relative=path.relative(path.resolve(env.RUNNER_TEMP),path.resolve(fixtureRoot));
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('native_no_fixture_unbound');
}
export function assertNativeConsentDenialInteraction(row,{browserPid}) {
  const keys=['schema','browser_pid','browser_birth','consent_pid','consent_birth','native_control_id',
    'native_no_activated','exact_process_tree_bound','generated_fixture_bound','authority_effect'];
  if(!pid(browserPid)||!row||Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))
    ||row?.schema!=='metaengine.browser.native-consent-denial-interaction.v1'||row.browser_pid!==browserPid
    ||!pid(row.consent_pid)||row.consent_pid===browserPid||![row.browser_birth,row.consent_birth].every(value=>typeof value==='string'&&/^[1-9][0-9]{16,18}$/.test(value))
    ||BigInt(row.consent_birth)<BigInt(row.browser_birth)||row.native_control_id!==7||row.native_no_activated!==true
    ||row.exact_process_tree_bound!==true||row.generated_fixture_bound!==true||row.authority_effect!==false)fail('native_no_interaction_unbound');
  return Object.freeze({...row});
}
export async function declineInstalledFreshProviderConsent({browserPid,executable,fixtureRoot,nonce,startedMs,deadlineMs},
  {run=execute,env=process.env}={}) {
  assertGeneratedFirstRunCi(env);
  if(!pid(browserPid)||![executable,fixtureRoot].every(value=>typeof value==='string'&&path.isAbsolute(value))
    ||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce||'')
    ||!Number.isSafeInteger(startedMs)||!Number.isSafeInteger(deadlineMs)||deadlineMs<=Date.now()||deadlineMs-startedMs>90000)fail('native_no_arguments_invalid');
  assertGeneratedFirstRunFixtureRoot(fixtureRoot,env);
  const root='C:\\Windows',safeEnv={SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
    TEMP:path.join(fixtureRoot,'Temp'),TMP:path.join(fixtureRoot,'Temp'),
    PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'),
    GITHUB_ACTIONS:'true',GITHUB_RUN_ID:env.GITHUB_RUN_ID,RUNNER_TEMP:env.RUNNER_TEMP,
    METAENGINE_QA_BROWSER_PID:String(browserPid),METAENGINE_QA_QUALIFIER_PID:String(process.pid),
    METAENGINE_QA_BROWSER_EXE:executable,METAENGINE_QA_QUALIFIER_EXE:process.execPath,
    METAENGINE_QA_STARTED_MS:String(startedMs),METAENGINE_QA_DEADLINE_MS:String(deadlineMs),
    METAENGINE_QA_FIXTURE_ROOT:fixtureRoot,METAENGINE_QA_FIXTURE_NONCE:nonce};
  let result;
  try {result=await run(path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File',helper],{env:safeEnv,shell:false,windowsHide:true,
      timeout:Math.max(1,deadlineMs-Date.now()),maxBuffer:4096});}
  catch(error){
    let hold;try{hold=JSON.parse(String(error.stdout||'').trim());}catch{}
    if(hold?.schema==='metaengine.browser.native-consent-denial-hold.v1'
      &&/^native_no_[a-z_]+$/.test(hold.reason||'')&&hold.native_no_activated===false&&hold.authority_effect===false)fail(hold.reason);
    fail('native_no_readback_unavailable');
  }
  let row;try{row=JSON.parse(String(result.stdout||'').trim());}catch{fail('native_no_interaction_unbound');}
  return assertNativeConsentDenialInteraction(row,{browserPid});
}
