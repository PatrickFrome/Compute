import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {assertGeneratedFirstRunCi,assertNativeConsentDenialInteraction,declineInstalledFreshProviderConsent} from '../scripts/qa-decline-fresh-provider-consent.mjs';
const root=path.join(os.tmpdir(),'generated-native-no');
const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'123456',RUNNER_TEMP:os.tmpdir(),PATH:'hostile',NODE_OPTIONS:'hostile'};
const receipt=()=>({schema:'metaengine.browser.native-consent-denial-interaction.v1',browser_pid:712,
 browser_birth:'134000000000000000',consent_pid:713,consent_birth:'134000000000000001',native_control_id:7,
 native_no_activated:true,exact_process_tree_bound:true,generated_fixture_bound:true,authority_effect:false});
const options=()=>{const startedMs=Date.now();return {browserPid:712,executable:path.join(root,'installed.exe'),fixtureRoot:path.join(root,'first-run'),
 nonce:'11111111-2222-4333-8444-555555555555',startedMs,deadlineMs:startedMs+90000};};
test('native No helper refuses non-CI and unbound/foreign/stale identities',()=>{
 for(const value of [{},{...env,GITHUB_ACTIONS:'false'},{...env,GITHUB_RUN_ID:''},{...env,RUNNER_TEMP:'relative'}])assert.throws(()=>assertGeneratedFirstRunCi(value),/generated_ci_required/);
 assert.equal(assertGeneratedFirstRunCi(env),undefined);
 for(const patch of [{browser_pid:undefined},{private_extra:'never publish'},{browser_birth:134000000000000000},{browser_pid:713},{consent_pid:712},{consent_pid:null},{consent_birth:'133000000000000000'},
  {native_control_id:6},{native_no_activated:false},{exact_process_tree_bound:false},{generated_fixture_bound:false},{authority_effect:true}]){
  assert.throws(()=>assertNativeConsentDenialInteraction({...receipt(),...patch},{browserPid:712}),/interaction_unbound/);
 }
});
test('helper invokes only fixed native program with generated CI, exact child and one shared deadline',async()=>{
 const input=options();let calls=0;
 const row=await declineInstalledFreshProviderConsent(input,{env,run:async(exe,args,opts)=>{
  calls++;assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-File']);
  assert.match(args.at(-1),/qa-decline-fresh-provider-consent\.ps1$/);
  assert.equal(opts.shell,false);assert.equal(opts.env.PATH,undefined);assert.equal(opts.env.NODE_OPTIONS,undefined);
  assert.equal(opts.env.TEMP,path.join(input.fixtureRoot,'Temp'));assert.equal(opts.env.TMP,opts.env.TEMP);
  assert.equal(opts.env.METAENGINE_QA_BROWSER_PID,'712');assert.equal(opts.env.METAENGINE_QA_QUALIFIER_PID,String(process.pid));
  assert.equal(opts.env.METAENGINE_QA_DEADLINE_MS,String(input.deadlineMs));
  assert(opts.timeout<=90000&&opts.timeout>0);return {stdout:JSON.stringify(receipt())};
 }});
 assert.equal(calls,1);assert.equal(row.native_control_id,7);
 let forbidden=0;
 await assert.rejects(declineInstalledFreshProviderConsent({...options(),fixtureRoot:path.dirname(os.tmpdir())},{env,run:async()=>{forbidden++;}}),/fixture_unbound/);
 assert.equal(forbidden,0);
});
test('helper errors, timeout and malformed readback remain HOLD, never simulated denial',async()=>{
 for(const returned of ['',JSON.stringify({...receipt(),native_control_id:6})]){
  await assert.rejects(declineInstalledFreshProviderConsent(options(),{env,run:async()=>({stdout:returned})}),/interaction_unbound/);
 }
 await assert.rejects(declineInstalledFreshProviderConsent(options(),{env,run:async()=>{throw {stdout:'SECRET private error',message:'SECRET'};}}),{message:'installed_launch_native_no_readback_unavailable'});
 await assert.rejects(declineInstalledFreshProviderConsent(options(),{env,run:async()=>{throw {stdout:JSON.stringify({schema:'metaengine.browser.native-consent-denial-hold.v1',
  reason:'native_no_dialog_timeout',native_no_activated:false,authority_effect:false})};}}),{message:'installed_launch_native_no_dialog_timeout'});
});
test('Windows helper retains exact process handles and can activate only the bound native No',async()=>{
 const source=await readFile(new URL('../scripts/qa-decline-fresh-provider-consent.ps1',import.meta.url),'utf8');
 for(const expression of [/browserHandle\.Handle/,/qualifierHandle\.Handle/,/consentHandle\.Handle/,
  /ParentProcessId/,/ExecutablePath/,/CreationDate/,/ReparsePoint/,/generated-first-run-fixture/,
  /GetParent\(no\)!=h/,/GetDlgCtrlID\(no\)!=7/,/GetDlgItem\(h,7\)/,
  /SendMessageTimeoutW\(no,0x00f5/,/ChildText\(no\)\.Replace\("&",""\)!="No"/,
  /ReadTextMessage\(h,0x000d/,/0x534b/])assert.match(source,expression);
 assert.doesNotMatch(source,/SendKeys|SetForegroundWindow|SendMessageTimeoutW\(yes|BM_CLICK.*6/);
});


test('native denial fixture uses one clock sample for its exact ninety-second budget', () => {
 let tick=1700000000000;
 const generate=vm.runInNewContext('('+options.toString()+')',{path,root,Date:{now:()=>tick++}});
 const value=generate();
 assert.equal(value.deadlineMs-value.startedMs,90000);
});
