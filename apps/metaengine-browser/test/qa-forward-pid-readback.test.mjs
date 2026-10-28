import test from 'node:test';
import assert from 'node:assert/strict';
import {createForwardPriorPidReadback} from '../scripts/qa-forward-pid-readback.mjs';

test('manual forward readback distinguishes only a pinned later unrelated process', {skip:process.platform!=='win32'},async()=>{
 const config={bundle_directory:'C:\\METAENGINE\\resources\\client-state-runtime',state_directory:'C:\\METAENGINE\\state',expected_bundle_sha256:'a'.repeat(64)};
 const status={state:'READY',runtime_ready:true,bundle_sha256:'a'.repeat(64),checked_at:'2026-01-01T00:00:00.000Z',host_pid:101,children:[{name:'api',pid:102},{name:'edge',pid:103}]};
 const actual={state:'PRESENT',source:'OS_PROCESS_INVENTORY',pid:103,created_at:'2026-01-02T00:00:00.000Z',exe_path:'C:\\other\\node.exe',authority_effect:false};
 const read=(native,changes={})=>createForwardPriorPidReadback({config,status,...changes,pidState:()=> 'PRESENT',readNative:async()=>native,now:()=>Date.parse('2026-01-03T00:00:00.000Z')})(103);
 assert.equal(await read(actual),'ABSENT');
 for(const bad of [null,{...actual,pid:102},{...actual,source:'UNTRUSTED'},{...actual,authority_effect:true},{...actual,created_at:'2025-12-31T23:59:00Z'},{...actual,created_at:'2027-01-01T00:00:00Z'},
  {...actual,created_at:status.checked_at},{...actual,exe_path:'C:\\METAENGINE\\resources\\client-state-runtime\\runtime\\deno\\deno.exe'},
  {...actual,exe_path:'C:\\METAENGINE\\state\\deno-runtime\\digest\\deno.exe'},
  {...actual,exe_path:'relative.exe'},{...actual,exe_path:'\\\\server\\share\\node.exe'}])assert.equal(await read(bad),'PRESENT');
 assert.equal(await read(actual,{status:{...status,checked_at:'bad'}}),'PRESENT');
 assert.equal(await read(actual,{status:{...status,bundle_sha256:'b'.repeat(64)}}),'PRESENT');
 assert.equal(await read(actual,{status:{...status,children:[{name:'api',pid:102},{name:'api',pid:103}]}}),'PRESENT');
 assert.equal(await read(actual,{status:{...status,checked_at:'2027-01-01T00:00:00Z'}}),'PRESENT');
 const absent=createForwardPriorPidReadback({config,status,pidState:()=> 'ABSENT',readNative:async()=>{throw Error('unnecessary');}});
 assert.equal(await absent(103),'ABSENT');
});
