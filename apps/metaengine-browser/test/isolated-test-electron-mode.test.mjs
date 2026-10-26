import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile),runner=fileURLToPath(new URL('../scripts/run-isolated-tests.mjs',import.meta.url));
test('real isolated test child retains the explicit filesystem mode while excluding installed-runtime selectors',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-isolated-mode-'));
 try{
  const fixture=path.join(root,'probe.mjs');await fs.writeFile(fixture,`import assert from 'node:assert/strict';
assert.equal(process.env.METAENGINE_TEST_ELECTRON_MODE,'ASAR_NODE');
assert.equal(process.env.METAENGINE_SUPERVISOR_URL,undefined);
assert.equal(process.env.METAENGINE_TEST_ELECTRON_EXECUTABLE,undefined);
assert.notEqual(process.env.HOME,process.env.TEST_ORIGINAL_HOME);
`);
  await run(process.execPath,[runner,fixture],{windowsHide:true,timeout:15000,env:{...process.env,
   METAENGINE_TEST_ELECTRON_MODE:'ASAR_NODE',METAENGINE_SUPERVISOR_URL:'http://installed.invalid',
   METAENGINE_TEST_ELECTRON_EXECUTABLE:'untrusted-test-executable',TEST_ORIGINAL_HOME:process.env.HOME||'original'}});
  await assert.rejects(run(process.execPath,[runner,fixture],{windowsHide:true,timeout:15000,env:{...process.env,METAENGINE_TEST_ELECTRON_MODE:'unexpected'}}),/isolated_test_electron_mode_invalid/);
 }finally{const actual=await fs.realpath(root),temp=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual).toLowerCase(),temp.toLowerCase());assert.ok(path.basename(actual).startsWith('metaengine-isolated-mode-'));await fs.rm(actual,{recursive:true,force:true});}
});
