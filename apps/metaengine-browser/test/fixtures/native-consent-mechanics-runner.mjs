// Genuine native consent mechanics only. This inert generated Node parent never
// imports Browser entry, provisioning, database, identity, Guardian or runtime.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertGeneratedFirstRunFixtureRoot } from '../../scripts/qa-decline-fresh-provider-consent.mjs';
import { confirmFreshProviderNativeConsent } from '../../../../infra/client-state-runtime/fresh-provider-native-consent.mjs';

const execute=promisify(execFile);
const [fixtureRoot,nonce,...extra]=process.argv.slice(2);
let nativeChild=null, nativeOutcome=null, cancelled=false, nativeSpawned=false, nativeClosed=false;
const cancel=()=>{
  cancelled=true;
  // This exact ChildProcess owns its native handle. No PID/name lookup or global
  // window close is used, including if the test parent disconnects unexpectedly.
  if(nativeChild&&nativeChild.exitCode===null&&nativeChild.signalCode===null)nativeChild.kill();
};
process.on('message',message=>{
  if(message?.schema==='metaengine.test.native-consent-mechanics-stop.v1'&&message.nonce===nonce)cancel();
});
process.once('disconnect',cancel);
let reason='native_helper_mechanics_unconfirmed';
try {
  if(process.platform!=='win32'||extra.length||!process.connected
    ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce||''))throw Error('native_helper_mechanics_ci_required');
  assertGeneratedFirstRunFixtureRoot(fixtureRoot);
  const marker=JSON.parse(await fs.readFile(path.join(fixtureRoot,'generated-first-run-fixture.json'),'utf8'));
  if(marker.schema!=='metaengine.browser.generated-first-run-fixture.v1'||marker.nonce!==nonce)throw Error('native_helper_mechanics_fixture_unbound');
  const selection={stateDirectory:path.join(fixtureRoot,'Local','METAENGINE','client-first-run-v1','runtime'),
    ownerFile:path.join(fixtureRoot,'Roaming','@metaengine','browser-shell','metaengine-state-provider-v1.json')};
  // A read-only observation wrapper around real execFile: no canned result,
  // argv/env mutation, platform override or consent injection is permitted.
  const observeNativeProcess=async(executable,args,options)=>{
    if(cancelled)throw Error('native_helper_mechanics_cancelled');
    const operation=execute(executable,args,options);
    nativeChild=operation.child;
    nativeChild.once('spawn',()=>{nativeSpawned=true;});
    nativeChild.once('close',()=>{nativeClosed=true;});
    try {
      const result=await operation;
      nativeOutcome={pid:nativeChild.pid,exit_code:0,signal:null,killed:false,
        exact_declined_sentinel:false};
      return result;
    }catch(error){
      nativeOutcome={pid:nativeChild.pid,exit_code:Number.isSafeInteger(error.code)?error.code:null,
        signal:error.signal??null,killed:error.killed===true,
        exact_declined_sentinel:String(error.stdout||'').trim()==='METAENGINE_FRESH_NATIVE_OWNER_DECLINED'};
      throw error;
    }
  };
  try {
    await confirmFreshProviderNativeConsent(selection,{run:observeNativeProcess});
    reason='native_helper_mechanics_unexpected_confirmation';
  }catch(error){
    reason=error?.message==='fresh_provider_native_consent_declined'
      ? error.message : 'native_helper_mechanics_native_decision_unconfirmed';
  }
}catch{
  reason='native_helper_mechanics_fixture_unconfirmed';
}finally{
  if(nativeChild&&!nativeClosed){
    if(nativeChild.exitCode===null&&nativeChild.signalCode===null)cancel();
    await new Promise(resolve=>nativeChild.once('close',resolve));
  }
}
const denied=!cancelled&&reason==='fresh_provider_native_consent_declined'
  &&nativeOutcome?.exit_code===2&&nativeOutcome.signal===null&&nativeOutcome.killed===false
  &&nativeOutcome.exact_declined_sentinel===true;
console.log(JSON.stringify({schema:'metaengine.test.native-consent-mechanics-result.v1',
  harness_pid:process.pid,native_process:nativeOutcome,reason,declined:denied,
  native_child_spawned:nativeSpawned,native_child_cleanup_confirmed:!nativeChild||nativeClosed,
  installed_browser_qualification:false,owner_boot_qualification:false,
  database_provisioning_qualification:false,guardian_qualification:false,authority_effect:false}));
process.exitCode=denied?0:1;
if(process.connected)process.disconnect();
