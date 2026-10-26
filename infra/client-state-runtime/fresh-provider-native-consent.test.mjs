import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {confirmFreshProviderNativeConsent} from './fresh-provider-native-consent.mjs';
const selection={stateDirectory:path.join(os.tmpdir(),'consent-test','runtime'),ownerFile:path.join(os.tmpdir(),'consent-test','owner.json')};
const options={platform:'win32',env:{SystemRoot:'C:\\Windows',PATH:'untrusted',PSModulePath:'untrusted'}};
test('native consent uses fixed absolute executable, program and safe environment; default is No',async()=>{
 let calls=0;
 await confirmFreshProviderNativeConsent(selection,{...options,run:async(exe,args,opts)=>{
  calls++;assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert(args.includes('-NoProfile'));assert.equal(opts.shell,false);assert.equal(opts.timeout,300000);assert.equal(opts.cwd,'C:\\Windows\\System32');
  assert.equal(opts.env.PATH,undefined);assert.notEqual(opts.env.PSModulePath,'untrusted');
  assert.equal(opts.env.METAENGINE_CONSENT_STATE,selection.stateDirectory);
  const program=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert.match(program,/MessageBoxDefaultButton\]::Button2/);assert.match(program,/UserInteractive/);
  assert.match(program,/FIRST local ADMIN/);assert.match(program,/Guardian verification, project admission and native execution permits remain separate/);
  assert(!program.includes(selection.stateDirectory));
  return {stdout:'METAENGINE_FRESH_NATIVE_OWNER_CONFIRMED\r\n'};
 }});assert.equal(calls,1);
});
test('native cancellation, timeout, absent or malformed decision deny without retry',async()=>{
 for(const result of [null,{stdout:''},{stdout:'yes'},{stdout:'METAENGINE_FRESH_NATIVE_OWNER_CONFIRMED\nextra'}]){
  let calls=0;await assert.rejects(confirmFreshProviderNativeConsent(selection,{...options,run:async()=>{calls++;if(result===null)throw Error('cancel or timeout');return result;}}),/not_confirmed/);assert.equal(calls,1);
 }
});
test('unverified OS executable fails before native launch',async()=>{
 for(const env of [{SystemRoot:'relative'},{SystemRoot:'D:\\Windows'},{SystemRoot:'C:\\Windows',WINDIR:'D:\\Windows'},{SystemRoot:'C:\\Windows',SYSTEMROOT:'D:\\Windows'}]){
  let calls=0;await assert.rejects(confirmFreshProviderNativeConsent(selection,{...options,env,run:async()=>{calls++;}}),/unavailable/);assert.equal(calls,0);
 }
});
test('production factory cannot accept injected consent and private mutator is not exported',async()=>{
 const api=await import('./fresh-client-provider.mjs');assert.equal(api.populateFreshClientSchema,undefined);assert.equal(api.enrollFreshLocalDeviceOwner,undefined);
 const source=await readFile(new URL('./fresh-client-provider.mjs',import.meta.url),'utf8');
 const decision=source.indexOf('await confirmFreshProviderNativeConsent(selected)');assert(decision>0);
 assert(decision<source.indexOf('await deviceIdentity.ensure()'));
 assert.match(source,/await confirmFreshProviderNativeConsent\(selected\);[\s\S]*requireActiveInstall\(\);[\s\S]*await deviceIdentity.ensure\(\)/);
 for(const mutation of ['await fs.mkdir(path.dirname(selected.root)','randomBytes(32)','await initializeFreshClientPg17'])assert(decision<source.indexOf(mutation));
 assert.doesNotMatch(source,/options\.(?:consent|confirm|run|verifyIdentity|connection|plan)/);
 assert.match(source,/await confirmFreshProviderNativeConsent\(selected\);[\s\S]*await absent\(selected.root\);await absent\(selected.ownerFile\);/);
});

test('native consent diagnostics distinguish a pending decision without publishing paths or granting readiness', async () => {
 const rows=[];const original=console.error;let release;
 console.error=value=>rows.push(JSON.parse(value));
 try {
  const waiting=confirmFreshProviderNativeConsent(selection,{...options,run:()=>new Promise(resolve=>{release=resolve;})});
  assert.deepEqual(rows.map(row=>row.state),['NATIVE_CONSENT_REQUESTED']);
  release({stdout:'no private raw output'});
  await assert.rejects(waiting,/not_confirmed/);
  assert.deepEqual(rows.map(row=>row.state),['NATIVE_CONSENT_REQUESTED','NATIVE_CONSENT_NOT_CONFIRMED']);
  for(const row of rows){assert.equal(row.parent_pid,process.pid);assert.equal(row.diagnostic_only,true);
   assert.equal(row.authority_effect,false);assert.equal(row.browser_runtime_started,false);}
  assert.doesNotMatch(JSON.stringify(rows),/private raw|consent-test|owner.json|runtime_ready/);
 }finally{console.error=original;}
});

test('only a genuine native No receipt and exact unsignaled exit 2 classify as declined', async () => {
 const declined={code:2,stdout:'METAENGINE_FRESH_NATIVE_OWNER_DECLINED\r\n'};
 for(const [patch,reason] of [[{},/consent_declined$/],[{code:1},/not_confirmed$/],
  [{killed:true},/not_confirmed$/],[{signal:'SIGTERM'},/not_confirmed$/],
  [{stdout:'METAENGINE_FRESH_NATIVE_OWNER_DECLINED\nextra'},/not_confirmed$/],
  [{stdout:''},/not_confirmed$/]]) {
  await assert.rejects(confirmFreshProviderNativeConsent(selection,{...options,run:async()=>{throw {...declined,...patch};}}),reason);
 }
 const source=await readFile(new URL('./fresh-provider-native-consent.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(\$result -eq \[System.Windows.Forms.DialogResult\]::No\)\{Write-Output 'METAENGINE_FRESH_NATIVE_OWNER_DECLINED';exit 2\}/);
 assert.match(source,/if\(\$result -ne \[System.Windows.Forms.DialogResult\]::Yes\)\{exit 3\}/);
});
