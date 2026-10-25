import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {nativeCodingAsarQualificationMode as select} from './fixtures/native-coding-asar-qualification-mode.mjs';

const electron=path.resolve('fixture-electron');
test('ASAR filesystem qualification keeps MAIN_PROCESS as the direct/default mode',()=>{
  for(const platform of ['linux','win32','darwin'])
    assert.deepEqual(select({platform,electron}),{mode:'MAIN_PROCESS',skip:false});
  assert.equal(typeof select({}).skip,'string','default missing-Electron behavior remains explicit');
});
test('ASAR_NODE requires an exact explicit mode, Linux and an available executable selection',()=>{
  assert.deepEqual(select({mode:'ASAR_NODE',platform:'linux',electron}),{mode:'ASAR_NODE',skip:false});
  for(const mode of ['',null,'node','ASAR_NODE ','INVALID'])
    assert.throws(()=>select({mode,platform:'linux',electron}),/qualification_mode_invalid/);
  for(const platform of ['win32','darwin'])
    assert.throws(()=>select({mode:'ASAR_NODE',platform,electron}),/qualification_requires_linux/);
});
test('an explicit ASAR qualification cannot silently skip or fall back when its Electron selection is missing or invalid',()=>{
  for(const mode of ['MAIN_PROCESS','ASAR_NODE'])for(const electron of [undefined,null,'','relative-electron'])
    assert.throws(()=>select({mode,platform:'linux',electron}),/qualification_electron_required/);
  assert.throws(()=>select({explicitExecutable:true,electron:''}),/qualification_electron_required/);
});

test('all three active Linux Browser suites select filesystem-only mode in the intended step while Windows retains MAIN_PROCESS',async()=>{
  const matrixMode="${{ matrix.os == 'ubuntu-24.04' && 'ASAR_NODE' || 'MAIN_PROCESS' }}";
  for(const [file,step,command,matrix] of [
    ['metaengine-browser-self-update-e2e.yml','Parse and contract gates','npm test',false],
    ['browser-agent-result-installer-source-qualification.yml','Prove full Browser regression','npm test',true],
    ['client-live-mechanics-recovery-v1.yml','Exercise all Browser mechanics including real local IPC',
      'node --test --test-concurrency=4 test/*.test.mjs',true],
  ]){
    const source=await fs.readFile(new URL('../../../.github/workflows/'+file,import.meta.url),'utf8');
    const marker='      - name: '+step+'\n',start=source.indexOf(marker);
    assert.notEqual(start,-1,file);assert.equal(source.indexOf(marker,start+1),-1,file);
    const following=source.indexOf('\n      - ',start+marker.length);
    const section=source.slice(start,following===-1?source.length:following);
    assert.equal((source.match(/\n\s*METAENGINE_TEST_ELECTRON_MODE:/g)||[]).length,1,file+' must not leak mode to other steps/jobs');
    assert.ok(section.includes('        working-directory: apps/metaengine-browser\n'),file);
    assert.ok(section.includes('          METAENGINE_TEST_ELECTRON_MODE: '+(matrix?matrixMode:'ASAR_NODE')+'\n'),file);
    assert.ok(section.includes(command),file+' must retain its full test command');
    if(matrix)assert.ok(source.includes('os: [ubuntu-24.04, windows-2025]'),file);
    else{
      const contract=source.slice(source.indexOf('  contract:\n'),source.indexOf('\n  windows-published-n-to-one-build-target:'));
      assert.ok(contract.includes('    runs-on: ubuntu-24.04\n')&&contract.includes(marker),file);
    }
  }
});
