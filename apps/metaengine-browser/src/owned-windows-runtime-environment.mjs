import path from 'node:path';
import {fixedWindowsNativeReadEnvironment} from './windows-native-read-environment.mjs';

const fail=()=>{throw Error('owned_runtime_environment_paths_invalid');};
function localPath(value) {
  // PATH uses semicolons even when an executable is launched without a shell.
  // A legal Windows filename containing one cannot become a search directory.
  if(typeof value!=='string'||value.includes(';'))fail();
  try {return fixedWindowsNativeReadEnvironment({TEMP:value}).TEMP;}
  catch {fail();}
}
const same=(first,second)=>first.toLowerCase()===second.toLowerCase();

// Runtime context, not resource attestation. Call only after the existing
// offline bundle verifier has checked the complete immutable resource set.
// Never consult inherited executable/module discovery or credential variables.
export function ownedWindowsRuntimeEnvironment(verified,source=process.env) {
  const selected=verified?.paths;
  if(!selected)fail();
  const sourceRoot=localPath(selected.sourceRoot);
  if(!same(path.win32.basename(sourceRoot),'source'))fail();
  const bundle=path.win32.dirname(sourceRoot);
  const expected={
    nodeExecutable:path.win32.join(bundle,'runtime','node','node.exe'),
    denoExecutable:path.win32.join(bundle,'runtime','deno','deno.exe'),
    postgresBinDirectory:path.win32.join(bundle,'runtime','postgresql','bin'),
  };
  for(const [name,value] of Object.entries(expected))
    if(!same(localPath(selected[name]),value))fail();
  const context=fixedWindowsNativeReadEnvironment(source);
  return Object.freeze({...context,PATH:[expected.postgresBinDirectory,
    path.win32.dirname(expected.nodeExecutable),path.win32.dirname(expected.denoExecutable),context.PATH].join(';')});
}

// runClientInitdb receives the exact verified initdb image from the bundle.
// Derivation retains that existing image boundary; this does not search PATH,
// select a different cluster or attest an unverified caller-supplied image.
export function ownedWindowsInitdbEnvironment(executable,source=process.env) {
  const image=localPath(executable);
  const bin=path.win32.dirname(image);
  const bundle=path.win32.resolve(bin,'..','..','..');
  if(!same(image,path.win32.join(bundle,'runtime','postgresql','bin','initdb.exe')))fail();
  return ownedWindowsRuntimeEnvironment({paths:{sourceRoot:path.win32.join(bundle,'source'),
    nodeExecutable:path.win32.join(bundle,'runtime','node','node.exe'),
    denoExecutable:path.win32.join(bundle,'runtime','deno','deno.exe'),postgresBinDirectory:bin}},source);
}
