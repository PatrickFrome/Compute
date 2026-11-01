import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readMainPrivateNativeTools,readPackagedPrivateNativeTools} from '../src/private-native-tools.mjs';

// Source composition and ordinary-Node behavior tests. These do not launch
// Electron, qualify Windows custody or turn generated evidence into authority.
const read=relative=>fs.readFile(new URL(relative,import.meta.url),'utf8');
const ordered=(text,needles)=>{
  let previous=-1;
  for(const needle of needles){const current=text.indexOf(needle,previous+1);assert.ok(current>previous,needle);previous=current;}
};

test('the default Main adapter does not classify ordinary Node as development',async()=>{
  assert.equal(process.versions.electron,undefined);
  await assert.rejects(readMainPrivateNativeTools(),/private_native_tools_main_context_required/);
  await assert.rejects(readPackagedPrivateNativeTools(),/private_native_tools_main_context_invalid/);
  const adapter=await read('../src/private-native-tools.mjs');
  assert.match(adapter,/const \{app\}=await import\('electron'\)/);
  assert.match(adapter,/readPackagedPrivateNativeTools\(\{app,resourcesPath:process\.resourcesPath\}\)/);
});

test('original Main mount admits and shares one capability within generation and cleanup custody',async()=>{
  const source=await read('../src/main.mjs');
  const start=source.indexOf('function ensureNativeCodingRuntimeMounted()');
  assert.ok(start>=0);
  const end=source.indexOf('if(!cleanupConfirmed){',start);assert.ok(end>start);
  const mount=source.slice(start,end);
  ordered(mount,[
    'const operator=await readNativeCodingOperatorPaths(directory)',
    'const privateTools=await readMainPrivateNativeTools();assertOpen(summary)',
    'validateNativeCodingInstalledPathScope(operator,{resourcesPath:process.resourcesPath,stateDirectory:directory,privateTools})',
    'const capability=createOwnedNativeCodingHostCapability(summary)',
    'nativeCodingRuntimeMountCustody=custody',
    'try{',
    'await prepareNativeWorkspaceFromStage(',
    'const scope=await capability.readScope()',
    'native_coding_protected_permits_required',
    'privateTools.cliExecutableSha256!==hashes[0]',
    'await privateTools.revalidate();assertOpen(summary)',
    'const current=await readOwnedLocalRuntimeHostRecoveryObservation()',
    'assertNativeCodingRuntimeMountGeneration(current,summary,generation)',
    'candidate=createNativeCodingRuntime(',
  ]);
  assert.match(mount,/observerOptions:\{[^\n]+sandboxReceipts,privateTools\}/);
  assert.match(mount,/runnerOptions:\{[^\n]+\n[^\n]+workerTempRoot:operator\.worker_temp_root,privateTools\}/);
  assert.match(mount,/await candidate\.close\(\)/);
  assert.match(mount,/capability\.drainPhysical\(\{wait:false\}\)/);
  assert.match(mount,/if\(cleanupConfirmed\)\{capability\.close\(\);custody\.cleaned=true;\}/);
});

test('installed Node context follows actual bundle and execution-resource checks, not hooks or Electron absence',async()=>{
  const source=await read('../../../infra/client-state-runtime/runtime-host.mjs');
  const start=source.indexOf('export async function startManagedRuntimeHost(');
  ordered(source.slice(start),[
    'const verified = await (hooks.verifyBundle || verifyOfflineRuntimeBundle)',
    'runtime_host_execution_resource_mismatch',
    'const installedBundle = hooks.verifyBundle || hooks.modulePath || hooks.executablePath ? null : verified;',
    'createNativeCodingHostOsScope({config,sql:nativeCodingSql,parentPid:process.ppid,installedBundle})',
  ]);
  const scope=await read('../../../infra/client-state-runtime/native-coding-host-os-scope.mjs');
  const retained=scope.slice(scope.indexOf('  async function readProtectedReceipt('),scope.indexOf("  Object.defineProperty(readNativeScope,'prepare'"));
  assert.match(retained,/readNativeCodingOperatorPaths\(config\.state_directory,options\)/);
  assert.doesNotMatch(retained,/readInstalledOperator\(|readPrivateTools\(|readNativeCodingSandboxEvidence\(|image\.read\(/);
  assert.match(scope,/if\(permit===null\) return/);
  assert.match(scope,/scratchRoot:operator\.worker_temp_root,privateTools/);
});

test('default producer carries one tools binding through offline hashing and ASAR agreement',async()=>{
  const stage=await read('../scripts/stage-client-state-runtime.mjs');
  ordered(stage,[
    'await assertPrivateNativeToolsManifestPins(',
    'const privateToolsBinding = privateNativeToolsBinding(privateManifestBytes)',
    'const privateTools = await resolvePrivateNativeTools(',
    'privateNativeToolsBinding: privateToolsBinding',
  ]);
  const beforePack=await read('../scripts/electron-builder-before-pack.cjs');
  ordered(beforePack,[
    'const privateToolsBinding = privateNativeToolsBinding(privateManifestBytes)',
    'repoRoot, sourceHead: trustRoot.build_sha, packageVersion, privateToolsBinding',
    'metaenginePrivateNativeTools: privateToolsBinding',
  ]);
  const binding=await read('../scripts/offline-runtime-package-binding.cjs');
  assert.match(binding,/privateToolsBinding\[key\] !== manifest\.private_native_tools\[key\]/);
  assert.match(binding,/client_state_runtime_private_native_tools_binding_mismatch/);
});
