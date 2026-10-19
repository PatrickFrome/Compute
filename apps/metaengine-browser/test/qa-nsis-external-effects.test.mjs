import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNsisEffectsObserved,assertNsisEffectsRestored,observeWindowsNsisEffects,NSIS_EFFECTS_SCHEMA}
  from '../scripts/qa-nsis-external-effects.mjs';
const version='0.7.0-dev.1107139874568.1';
const baseline={schema:NSIS_EFFECTS_SCHEMA,state:'OBSERVED',version,
  registry_entry_count:1,shortcut_count:1,shortcut_target_bound:true,uninstaller_present:true,
  registry_sha256:'a'.repeat(64),shortcut_sha256:'b'.repeat(64),mutation:false,authority_effect:false};
test('external NSIS proof requires unique version-matched registry record and real shortcut',()=>{
  assert.equal(assertNsisEffectsObserved(baseline,version),true);
  for(const changed of [
    {registry_entry_count:2},{shortcut_count:0},{shortcut_target_bound:false},
    {uninstaller_present:false},{version:'0.7.0-dev.1107139874569.1'},
    {registry_sha256:'INVALID'},{shortcut_sha256:'INVALID'},
    {mutation:true},{authority_effect:true},{state:'BLOCKED'}
  ]) assert.throws(()=>assertNsisEffectsObserved({...baseline,...changed},version),
    /qa_nsis_effects_observation_unverified/);
});
test('NSIS rollback readback rejects registry or Start Menu shortcut drift',()=>{
  assert.equal(assertNsisEffectsRestored(baseline,{...baseline}),true);
  assert.throws(()=>assertNsisEffectsRestored(baseline,
    {...baseline,registry_sha256:'c'.repeat(64)}),/qa_nsis_effects_external_effects_not_restored/);
  assert.throws(()=>assertNsisEffectsRestored(baseline,
    {...baseline,shortcut_sha256:'c'.repeat(64)}),/qa_nsis_effects_external_effects_not_restored/);
  assert.throws(()=>assertNsisEffectsRestored(baseline,
    {...baseline,uninstaller_present:false}),/qa_nsis_effects_observation_unverified/);
  assert.throws(()=>assertNsisEffectsRestored(baseline,null),
    /qa_nsis_effects_restored_effects_unknown/);
});
test('only fixed Windows native read-only registry and shortcut query is allowed',async()=>{
  const env={SystemRoot:'C:\\Windows',APPDATA:'C:\\Users\\QA\\AppData\\Roaming',
    LOCALAPPDATA:'C:\\Users\\QA\\AppData\\Local'};
  let called=0;
  const run=async(exe,args,options)=>{
    called++;
    assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(args[0],'-NoLogo');assert.equal(args[1],'-NoProfile');
    assert.equal(args[2],'-NonInteractive');assert.equal(args[3],'-EncodedCommand');
    const source=Buffer.from(args[4],'base64').toString('utf16le');
    assert.ok(source.includes('Registry::HKEY_CURRENT_USER'));
    assert.ok(source.includes('CreateShortcut'));
    assert.equal(source.includes('Set-ItemProperty'),false);
    assert.equal(options.shell,false);
    assert.equal(options.env.METAENGINE_QA_NSIS_EXPECTED_VERSION,version);
    return {stdout:JSON.stringify(baseline)};
  };
  const actual=await observeWindowsNsisEffects({expectedVersion:version,platform:'win32',env,run});
  assert.equal(called,1);assert.deepEqual(actual,baseline);
  await assert.rejects(observeWindowsNsisEffects({expectedVersion:version,platform:'linux',env,run}),
    /qa_nsis_effects_windows_environment_unverified/);
  await assert.rejects(observeWindowsNsisEffects({expectedVersion:'latest',platform:'win32',env,run}),
    /qa_nsis_effects_windows_environment_unverified/);
  assert.equal(called,1);
});
test('unverified native observations fail closed with no claim about installed effects',async()=>{
  const env={SystemRoot:'C:\\Windows',APPDATA:'C:\\Users\\QA\\AppData\\Roaming',
    LOCALAPPDATA:'C:\\Users\\QA\\AppData\\Local'};
  for(const run of [
    async()=>({stdout:JSON.stringify({...baseline,state:'BLOCKED'})}),
    async()=>({stdout:'unexpected native stdout'}),
    async()=>{throw Error('host-error-with-private-values');}
  ]) await assert.rejects(observeWindowsNsisEffects({expectedVersion:version,platform:'win32',env,run}),
    /qa_nsis_effects_(observation_unverified|native_json_invalid|native_readback_unverified)/);
});
