#!/usr/bin/env node
// CI-only disposable binaries and proof checks; never starts a PostgreSQL server.
import assert from 'node:assert/strict';
import {appendFile, mkdir, mkdtemp, readFile, realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {RUNTIME_ORIGINS, externalBuildWorkDirectory, obtainRuntimeArchive, unpackRuntimeArchive}
  from '../apps/metaengine-browser/scripts/stage-client-state-runtime.mjs';

const execute=promisify(execFile);
export const WINDOWS_NATIVE_GUARDS=Object.freeze([
  'production PGDATA path is forbidden even when a matching fake intent exists',
  'invalid digest never crosses backup barrier',
  'connection must not be silently retargeted',
  'physical journal alias fails closed without being relabelled as verified when unavailable',
]);

export function assertWindowsNativeGuardProof(tap) {
  assert.equal(typeof tap,'string','native guard TAP must be present');
  const records=tap.split(/\r?\n/).map(line=>line.trim())
    .filter(line=>/^(?:not )?ok \d+ - /.test(line));
  for(const name of WINDOWS_NATIVE_GUARDS) {
    const matches=records.filter(line=>line.replace(/^(?:not )?ok \d+ - /,'')
      .replace(/\s+#.*$/,'')===name);
    assert.equal(matches.length,1,'native guard must have one outcome: '+name);
    assert.match(matches[0],/^ok \d+ - /,'native guard failed: '+name);
    assert.equal(matches[0].replace(/^ok \d+ - /,''),name,
      'native guard cannot be skipped or TODO: '+name);
  }
  return {schema:'metaengine.runtime-contract-native-guards.v1',
    windows_native_guards_qualified:true,required_guards:WINDOWS_NATIVE_GUARDS.length};
}

export async function prepareWindowsGuardBinaries() {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('runtime_guard_windows_x64_required');
  const runnerTemp=process.env.RUNNER_TEMP;
  if(typeof runnerTemp!=='string'||!path.isAbsolute(runnerTemp)||/[\r\n]/.test(runnerTemp))
    throw Error('runtime_guard_runner_temp_required');
  const repository=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  const temporary=externalBuildWorkDirectory(repository,await realpath(runnerTemp));
  const work=await mkdtemp(path.join(temporary,'metaengine-runtime-guards-pg17-'));
  const archives=path.join(work,'archives');
  await mkdir(archives);
  // Share the exact reviewed origin and hash/extraction checks with Package Smoke.
  const origin=RUNTIME_ORIGINS.postgresql;
  const archive=await obtainRuntimeArchive(archives,origin);
  const destination=path.join(work,'postgresql');
  await unpackRuntimeArchive(archive,destination,{postgresOnly:true});
  const binDirectory=await realpath(path.join(destination,'pgsql','bin'));
  const expectedVersion=origin.version.split('.').slice(0,2).join('.');
  for(const name of ['pg_dump','pg_restore','psql']) {
    const result=await execute(path.join(binDirectory,name+'.exe'),['--version'],
      {windowsHide:true,shell:false,timeout:15000,maxBuffer:4096});
    assert.equal(result.stderr.trim(),'','unexpected native version diagnostics');
    assert.equal(result.stdout.trim(),name+' (PostgreSQL) '+expectedVersion,
      'pinned PostgreSQL version must execute before native guards');
  }
  if(process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV,'LOCAL_STATE_TEST_PG_BIN_DIR='+binDirectory+'\n','utf8');
  }
  return {schema:'metaengine.runtime-contract-pg17-binaries.v1',bin_directory:binDirectory,
    version:origin.version,archive_sha256:origin.archive_sha256,
    database_started:false,installed_state_used:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode,file,...extra]=process.argv.slice(2);
    let result;
    if(extra.length||!['prepare','verify'].includes(mode)||(mode==='prepare'&&file)||(mode==='verify'&&!file))
      throw Error('runtime_guard_arguments_invalid');
    if(process.platform==='win32') {
      result=mode==='prepare'?await prepareWindowsGuardBinaries()
        :assertWindowsNativeGuardProof(await readFile(file,'utf8'));
    } else if(process.platform==='linux') {
      result={schema:'metaengine.runtime-contract-native-guards.v1',
        windows_native_guards_qualified:false,reason:'WINDOWS_NATIVE_PROOF_UNAVAILABLE_ON_LINUX'};
    } else throw Error('runtime_guard_platform_unsupported');
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error(String(error?.message||error));
    process.exitCode=1;
  }
}
