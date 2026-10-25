import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {sourceClosure} from '../../../infra/client-state-runtime/startup-source-manifest.mjs';
import {buildNativeCodingExecutionScope as browserScope} from '../src/native-coding-task-context.mjs';
import {buildNativeCodingExecutionScope as hostScope} from '../../../infra/client-state-runtime/native-coding-task-context.mjs';

test('native Browser modules load at the real packaged relative layout and ASAR retains their exact source bytes',async t=>{
  const asar=createRequire(import.meta.url)('@electron/asar');
  const temporary=await fs.realpath(os.tmpdir());
  const directory=await fs.realpath(await fs.mkdtemp(path.join(temporary,'metaengine-native-packaged-closure-')));
  t.after(async()=>{const actual=await fs.realpath(directory);assert.equal(actual,directory);assert.equal(path.dirname(actual),temporary);
    assert(path.basename(actual).startsWith('metaengine-native-packaged-closure-'));await fs.rm(actual,{recursive:true,force:true});});
  const app=path.join(directory,'app'),src=path.join(app,'src'),archive=path.join(directory,'app.asar');
  await fs.mkdir(app);await fs.cp(new URL('../src/',import.meta.url),src,{recursive:true});
  await fs.writeFile(path.join(app,'package.json'),'{"type":"module"}');
  const offline=path.join(app,'infra','client-state-runtime');await fs.mkdir(offline,{recursive:true});
  await fs.copyFile(new URL('../../../infra/client-state-runtime/offline-runtime-bundle.mjs',import.meta.url),path.join(offline,'offline-runtime-bundle.mjs'));
  // Node cannot execute an ASAR. This import qualifies the same source layout;
  // actual Electron/installed readiness remains a separate qualification.
  const runtime=await import(pathToFileURL(path.join(src,'native-coding-runtime.mjs')));
  const operator=await import(pathToFileURL(path.join(src,'native-coding-operator-paths.mjs')));
  assert.equal(typeof runtime.createNativeCodingRuntime,'function');assert.equal(typeof operator.readNativeCodingOperatorPaths,'function');
  await asar.createPackage(app,archive);
  for(const name of ['native-coding-task-context.mjs','native-coding-fs-identity.mjs','native-coding-operator-paths.mjs',
    'native-coding-agent-host-contract.mjs','native-coding-agent-run-bridge.mjs','native-coding-agent-mcp-launch.mjs'])
    assert.deepEqual(asar.extractFile(archive,'src/'+name),await fs.readFile(new URL('../src/'+name,import.meta.url)));
  const config=JSON.parse(await fs.readFile(new URL('../electron-builder.test.json',import.meta.url),'utf8'));
  const resource=config.extraResources.find(row=>row.to==='native-coding/agent-mcp');
  assert.deepEqual(resource,{from:'src',to:'native-coding/agent-mcp',filter:['native-coding-agent-mcp-entry.mjs','native-coding-agent-mcp-broker.mjs','native-coding-agent-mcp-stdio.mjs']});
  for(const name of resource.filter)assert(asar.extractFile(archive,'src/'+name).length>0);
  for(const name of ['main.mjs','native-coding-runtime.mjs','native-coding-host-observers.mjs'])
    assert(!/from\s*['"]\.\.\/\.\.\/\.\.\/infra\//.test(await fs.readFile(new URL('../src/'+name,import.meta.url),'utf8')));
  assert.equal(hostScope,browserScope,'Host and Browser must use the exact same canonical scope implementation');
});

test('reviewed Host source closure includes shared contract and all real stdio dependencies, without tests',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const closure=await sourceClosure([path.join(root,'infra/client-state-runtime/runtime-host.mjs')],root);
  const paths=closure.files.map(file=>path.relative(root,file).split(path.sep).join('/'));
  for(const name of ['native-coding-task-context.mjs','native-coding-fs-identity.mjs','native-coding-operator-paths.mjs',
    'native-coding-agent-host-contract.mjs','native-coding-agent-mcp-broker.mjs','native-coding-agent-mcp-entry.mjs','native-coding-agent-mcp-stdio.mjs','native-coding-agent-mcp-launch.mjs'])
    assert(paths.includes('apps/metaengine-browser/src/'+name),name);
  assert(!paths.some(name=>/\.test\.|\/test\//.test(name)));
});
