import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureElectronPreReady } from '../src/electron-pre-ready-bootstrap.mjs';

test('sandbox and privileged scheme are registered once before ready, including delayed main import', () => {
  let ready=false;const calls=[];
  const app={isReady:()=>ready,enableSandbox:()=>calls.push('sandbox')};
  const protocol={registerSchemesAsPrivileged:rows=>{assert.equal(ready,false);calls.push(rows);}};
  ensureElectronPreReady({app,protocol});ready=true;
  ensureElectronPreReady({app,protocol});ensureElectronPreReady({app,protocol});
  assert.deepEqual(calls,['sandbox',[{scheme:'metaengine',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:false}}]]);
});
test('late initial call refuses without pretending scheme or sandbox readiness', () => {
  let effects=0;
  assert.throws(()=>ensureElectronPreReady({app:{isReady:()=>true,enableSandbox:()=>effects++},protocol:{registerSchemesAsPrivileged:()=>effects++}}),/initialization_missed/);
  assert.equal(effects,0);
});
test('partial bootstrap failure is not retried or promoted to ready', () => {
  let calls=0;const app={isReady:()=>false,enableSandbox:()=>calls++};
  const protocol={registerSchemesAsPrivileged:()=>{calls++;throw Error('native refusal');}};
  assert.throws(()=>ensureElectronPreReady({app,protocol}),/initialization_failed/);
  assert.throws(()=>ensureElectronPreReady({app,protocol}),/initialization_incomplete/);
  assert.equal(calls,2);
});
test('pre-ready rail remains synchronous and precedes setup/module awaits', async () => {
  const helper=await readFile(new URL('../src/electron-pre-ready-bootstrap.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/^import\s|\bawait\b|fetch\(/m);
  for(const file of ['final-runtime-entry.mjs','main-entry.mjs']){
    const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
    const call=source.indexOf('ensureElectronPreReady({ app, protocol });');
    assert(call>=0&&call<source.indexOf('await '),file);
  }
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  assert.match(main,/ensureElectronPreReady\(\{ app, protocol \}\)/);
  assert.doesNotMatch(main,/protocol\.registerSchemesAsPrivileged\(/);
});
