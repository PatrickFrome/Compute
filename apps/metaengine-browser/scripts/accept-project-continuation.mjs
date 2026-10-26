#!/usr/bin/env node
// Source/fixture acceptance only. Installed qualification is an explicit HOLD
// until the coordinator supplies the one-producer candidate and native inputs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash,writeNewJson,resolveFixtureGit,runContinuationSourceFixture,runContinuationContractSuites,CONTINUATION_CONTRACT_FILES}
  from '../test/fixtures/project-continuation-support.mjs';

const args=process.argv.slice(2),requireInstalled=args.includes('--require-installed');
const positional=args.filter(arg=>arg!=='--require-installed');
if(positional.length!==2||positional[0]!=='--output'||!path.isAbsolute(positional[1])){
  process.stderr.write('Usage: node apps/metaengine-browser/scripts/accept-project-continuation.mjs --output <new-absolute-directory> [--require-installed]\n');
  process.exit(64);
}
const output=path.resolve(positional[1]);
// An existing output is deliberately never reused: pending effects and old
// evidence cannot become a new acceptance run by changing their labels.
await fs.mkdir(output,{mode:0o700});
const physical=await fs.realpath(output);
if(physical!==output)throw Error('continuation_acceptance_output_must_be_physical');
const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url));
const journal=await fs.open(path.join(output,'ledger.jsonl'),'wx',0o600);
let previous='0'.repeat(64),sequence=0;
async function append(record){
  const body={sequence:++sequence,previous_sha256:previous,...record};
  const sha256=hash(JSON.stringify(body));await journal.writeFile(JSON.stringify({...body,sha256})+'\n');await journal.sync();previous=sha256;
}
const installed={state:'BLOCKED',physical_execution_proven:false,production_qualified:false,
  prerequisites:['Coordinator-issued single-producer installer with exact source/version/run/attempt/artifact identity and SHA-256',
    'Disposable Windows with fresh installation and producer-bound installed image inventory',
    'Real protected native Host/own-PG identities, provider/CLI credentials, enrolled providers and independent IMPLEMENTER/CRITIC permits',
    'Approved capsules and evaluator custody where required; advisory skills confer no authority or credit',
    'Qualified native successor admission and physical restart; Git-complete/SQL-missing window retains HOLD'],
  fixture_evidence_qualifies_installed:false,automatic_retry_allowed:false,authority_effect:false};
let summary;
try{
  const git=await resolveFixtureGit(),execute=promisify(execFile);
  // Source attribution must not inherit a caller's GIT_DIR/GIT_WORK_TREE or
  // executable/config overrides and accidentally describe another checkout.
  const gitEnv={PATH:path.dirname(git),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',
    GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',LC_ALL:'C'};
  for(const key of ['SystemRoot','SYSTEMROOT','WINDIR'])if(process.env[key])gitEnv[key]=process.env[key];
  const sourceGit=(...command)=>execute(git,['--no-pager','-c','core.fsmonitor=false','-c','diff.external=',...command],
    {cwd:repositoryRoot,env:gitEnv,maxBuffer:8*1024*1024});
  const revision=(await sourceGit('rev-parse','HEAD')).stdout.trim();
  const diff=(await sourceGit('diff','--binary','--no-ext-diff','--no-textconv','HEAD')).stdout;
  const files=['apps/metaengine-browser/scripts/accept-project-continuation.mjs',
    ...['critic','process','support'].map(name=>`apps/metaengine-browser/test/fixtures/project-continuation-${name}.mjs`),
    ...['client-native-coding-goal','client-goal-journal','autonomous-project-host','autonomous-project-journal','autonomous-project-task-runtime',
      'native-coding-git-proof','native-coding-project-commits'].map(name=>`apps/metaengine-browser/src/${name}.mjs`),
    ...['native-coding-git-commit','native-coding-checkpoint-verifier','native-coding-host-commit-service'].map(name=>`infra/client-state-runtime/${name}.mjs`),
    ...CONTINUATION_CONTRACT_FILES];
  const source={head_sha:revision,worktree_diff_sha256:hash(diff),tracked_worktree_dirty:diff.length>0,
    runtime:{node_version:process.version,platform:process.platform,arch:process.arch},
    claim:'LOCAL_SOURCE_FIXTURE_NOT_INSTALLED_OR_CI_QUALIFICATION',
    files:await Promise.all(files.map(async name=>({path:name,sha256:hash(await fs.readFile(path.join(repositoryRoot,name)))})))};
  await append({name:'source_identity',status:'OBSERVED',evidence:source});
  const fixture=await runContinuationSourceFixture({directory:output,onCheck:append});
  const contracts=await runContinuationContractSuites({directory:output,repositoryRoot});
  for(const file of source.files)if(hash(await fs.readFile(path.join(repositoryRoot,file.path)))!==file.sha256)
    throw Error('continuation_acceptance_source_changed_during_run:'+file.path);
  if((await sourceGit('rev-parse','HEAD')).stdout.trim()!==revision
    ||hash((await sourceGit('diff','--binary','--no-ext-diff','--no-textconv','HEAD')).stdout)!==source.worktree_diff_sha256)
    throw Error('continuation_acceptance_git_source_changed_during_run');
  source.source_capture_before_and_after_match=true;
  await append({name:'source_identity_stability',status:'PASS',evidence:{head_sha:revision,
    worktree_diff_sha256:source.worktree_diff_sha256,covered_files:source.files.length,changed_during_run:false}});
  await append({name:'production_contract_suites',status:'PASS',evidence:contracts});
  await append({name:'installed_qualification',status:'BLOCKED',evidence:installed});
  summary={schema:'metaengine.continuation.acceptance-ledger.v1',overall_state:'HOLD',source_fixture:{state:'PASS',
    evidence_class:'CONTROLLED_SOURCE_FIXTURE',check_count:fixture.checks.length,contracts,...fixture},source,installed,
    ledger_tail_sha256:previous,automatic_retry_allowed:false,authority_effect:false};
}catch(error){
  const reason=error instanceof Error?error.message.slice(0,4000):'continuation_acceptance_failed';
  await append({name:'source_fixture_failure',status:'FAIL',evidence:{reason}});
  summary={schema:'metaengine.continuation.acceptance-ledger.v1',overall_state:'HOLD',source_fixture:{state:'FAIL',reason},
    installed,ledger_tail_sha256:previous,automatic_retry_allowed:false,authority_effect:false};
  process.exitCode=1;
}finally{await journal.close();}
summary.ledger_sha256=hash(await fs.readFile(path.join(output,'ledger.jsonl')));
await writeNewJson(path.join(output,'summary.json'),summary);
await fs.writeFile(path.join(output,'summary.sha256'),hash(await fs.readFile(path.join(output,'summary.json')))+'  summary.json\n',{flag:'wx',mode:0o600});
await fs.chmod(path.join(output,'ledger.jsonl'),0o400);
process.stdout.write(JSON.stringify({source_fixture:summary.source_fixture.state,overall_state:summary.overall_state,
  installed:summary.installed.state,output,ledger_sha256:summary.ledger_sha256})+'\n');
if(requireInstalled&&process.exitCode!==1)process.exitCode=2;
