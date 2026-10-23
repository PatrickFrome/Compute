import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { readUpgradeAsarPackage, readUpgradeAsarVerifier, readPredecessorImage } from '../scripts/qa-owner-runtime-upgrade.mjs';

// Required dependency: never turn a missing real ASAR regression into SKIP.
// NODE_PATH can point to the frozen Browser dependencies when this worktree
// has no node_modules. createRequire uses the same resolver as the operator.
const require=createRequire(import.meta.url), asar=require('@electron/asar');
const verifierEntry=path.join('infra','client-state-runtime','offline-runtime-bundle.mjs');
const pkg=number=>({name:'qa-physical-upgrade',version:`0.7.0-dev.${number}.1`,
  metaengineClientStateRuntime:{source_head_sha:String(number).at(-1).repeat(40),bundle_sha256:'a'.repeat(64)}});

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-asar-replacement-'));
  t.after(async()=>{
    asar.uncacheAll();
    const actual=await fs.realpath(root), parent=await fs.realpath(os.tmpdir());
    assert.ok(actual.startsWith(parent+path.sep)&&path.basename(actual).startsWith('metaengine-asar-replacement-'));
    await fs.rm(actual,{recursive:true,force:true});
  });
  const resources=path.join(root,'installed','resources');await fs.mkdir(resources,{recursive:true});
  await fs.writeFile(path.join(root,'installed','METAENGINE Browser Test.exe'),'disposable-native-image-fixture');
  const archive=path.join(resources,'app.asar');
  async function make(number,{padding=false,manifestBytes=null}={}) {
    const source=path.join(root,`source-${number}`), output=path.join(root,`version-${number}.asar`);
    await fs.mkdir(path.join(source,path.dirname(verifierEntry)),{recursive:true});
    const verifier=Buffer.from(`export const QA_VERIFIER_GENERATION = ${number};\n`);
    await fs.writeFile(path.join(source,'package.json'),manifestBytes??JSON.stringify(pkg(number)));
    await fs.writeFile(path.join(source,verifierEntry),verifier);
    if(padding){
      await fs.writeFile(path.join(source,'000-header-and-offset-padding.txt'),'NEW_ARCHIVE_PADDING_'.repeat(256));
      for(let i=0;i<16;i++)await fs.writeFile(path.join(source,`extra-${i}-${'different-header-'.repeat(5)}.txt`),String(number));
    }
    await asar.createPackage(source,output);
    return {output,verifier,manifest:pkg(number)};
  }
  async function replace(file) {await fs.unlink(archive).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.rename(file,archive);}
  return {root,resources,archive,make,replace};
}

test('real ASAR cache cannot mix old header offsets with a replaced package and verifier',async t=>{
  const f=await fixture(t), first=await f.make(111);await f.replace(first.output);
  assert.deepEqual(JSON.parse(asar.extractFile(f.archive,'package.json')),first.manifest);
  assert.deepEqual(asar.extractFile(f.archive,verifierEntry),first.verifier);
  const oldHeaderSize=asar.getRawHeader(f.archive).headerSize;
  const second=await f.make(222,{padding:true});await f.replace(second.output);
  assert.notEqual(asar.getRawHeader(f.archive).headerSize,oldHeaderSize);
  let stale;
  try{stale=JSON.parse(asar.extractFile(f.archive,'package.json'));}catch{stale='OLD_CACHED_HEADER_CANNOT_READ_NEW_PACKAGE';}
  assert.notDeepEqual(stale,second.manifest,'the test must reproduce the real pinned ASAR cache defect');
  assert.deepEqual(await readUpgradeAsarPackage(f.archive),second.manifest);
  assert.deepEqual(await readUpgradeAsarVerifier(f.archive),second.verifier);

  // A later independent verifier read also invalidates a previously cached
  // header; it must not merely benefit from the package read above.
  const third=await f.make(333);await f.replace(third.output);
  assert.deepEqual(await readUpgradeAsarVerifier(f.archive),third.verifier);
  assert.deepEqual(await readUpgradeAsarPackage(f.archive),third.manifest);
});

test('predecessor image reads the replacement identity and still enforces offline bundle verification',async t=>{
  const f=await fixture(t), first=await f.make(444);await f.replace(first.output);
  asar.extractFile(f.archive,'package.json');
  const second=await f.make(555,{padding:true});await f.replace(second.output);
  // No runtime bundle exists in this disposable image. Reaching this exact
  // failure proves the real predecessor path read the new valid identity,
  // while retaining the existing manifest gate.
  await assert.rejects(readPredecessorImage(f.resources,'a'.repeat(64)),/qa_upgrade_predecessor_bundle_unverified/);
});

test('fresh ASAR package reads remain bounded before allocation',async t=>{
  const f=await fixture(t), oversized=await f.make(666,{manifestBytes:' '.repeat(65537)});
  await f.replace(oversized.output);
  await assert.rejects(readUpgradeAsarPackage(f.archive),/qa_upgrade_asar_entry_invalid/);
});
