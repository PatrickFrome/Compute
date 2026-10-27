import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  parseEmptySchemaArguments, assertEmptySchemaOptions, assertNewEmptySchemaOutputDirectory,
  validateEmptySchemaSourceBinding, validateEmptySchemaToc, emptySchemaCatalogueDigest,
  assertEmptySchemaRoundtrip, emptySchemaSha256, emptySchemaProcessEnvironment,
  runEmptySchemaStage, combineEmptySchemaCleanupFailure, emptySchemaFailureMetadata,
  inspectCanonicalEmptySchema, runEmptySchemaCommand,
} from './canonical-empty-schema-contract.mjs';
import { assertPublishableEmptySchemaEvidence, emptySchemaFailureReceipt } from './export-reviewed-empty-schema.mjs';

const head = 'a'.repeat(40), prior = 'b'.repeat(40);
const directory = path.resolve(os.tmpdir());
const validOptions = () => ({
  applicationMode:'ATOMIC_SLICE',bin:path.join(directory,'pg-bin'),driver:path.join(directory,'driver.mjs'),
  outputDir:path.join(directory,'new-export'),schemaSourceHead:prior,exporterSourceHead:head,
});
const validArgs = () => Object.entries({
  '--application-mode':'ATOMIC_SLICE','--bin':path.join(directory,'pg-bin'),'--driver':path.join(directory,'driver.mjs'),
  '--output-dir':path.join(directory,'new-export'),'--schema-source-head':prior,'--exporter-source-head':head,
}).flat();
async function withDirectory(action) {
  const temporary = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'empty-schema-contract-'));
  try { return await action(temporary); }
  finally { await fs.rm(temporary,{recursive:true,force:true}); }
}

test('export requires explicit ATOMIC_SLICE, exact commits and absolute file paths', () => {
  assert.deepEqual(parseEmptySchemaArguments(validArgs()),validOptions());
  for (const applicationMode of ['HISTORICAL_CANDIDATE','WASM_SQL18_ONLY','',undefined]) {
    assert.throws(() => assertEmptySchemaOptions({...validOptions(),applicationMode}));
  }
  for (const schemaSourceHead of ['main','601532ca','a'.repeat(39),'A'.repeat(40),'a'.repeat(64)]) {
    assert.throws(() => assertEmptySchemaOptions({...validOptions(),schemaSourceHead}),/exact_source_heads/);
  }
  for (const key of ['bin','driver','outputDir']) assert.throws(() => assertEmptySchemaOptions({...validOptions(),[key]:'relative/path'}));
});

test('no existing database, PGDATA, archive, credentials, callback or hidden mode is accepted', () => {
  for (const key of ['sql','databaseUrl','pgdata','archive','password','base','exercise','archiveOperation','beforeApiProvision']) {
    assert.throws(() => assertEmptySchemaOptions({...validOptions(),[key]:'ignored-would-be-dangerous'}),/options_invalid/);
  }
  for (const flag of ['--database-url','--pgdata','--archive','--password','--base','--exercise','--no-acl','--reuse']) {
    assert.throws(() => parseEmptySchemaArguments([...validArgs(),flag,'untrusted']),/arguments_invalid/);
  }
  assert.throws(() => parseEmptySchemaArguments([...validArgs(),'--bin','second']),/arguments_invalid/);
  assert.throws(() => parseEmptySchemaArguments([...validArgs(),'--driver']),/arguments_invalid/);
  assert.throws(() => parseEmptySchemaArguments(validArgs().slice(2)));
});

test('publication refuses existing output and a symlink/junction ancestor', async () => {
  await withDirectory(async temporary => {
    const output = path.join(temporary,'new');
    assert.equal(await assertNewEmptySchemaOutputDirectory(output),output);
    await fs.mkdir(output);
    await assert.rejects(assertNewEmptySchemaOutputDirectory(output),/already_exists/);
    const alias = path.join(temporary,'alias');
    await fs.symlink(output,alias,process.platform==='win32'?'junction':'dir');
    await assert.rejects(assertNewEmptySchemaOutputDirectory(path.join(alias,'new')),/parent_alias/);
  });
});

test('inherited PG service and password environment cannot choose a target', () => {
  const previous = process.env.PGSERVICE, previousPassword = process.env.PGPASSWORD;
  process.env.PGSERVICE = 'external-connection'; process.env.PGPASSWORD = 'test-value-never-log';
  try {
    const env = emptySchemaProcessEnvironment();
    assert.equal(Object.keys(env).some(key=>/^PG/i.test(key)),false);
    assert.equal(env.LC_ALL,'C'); assert.equal(env.LANG,'C'); assert.equal(env.TZ,'UTC');
    const owned = emptySchemaProcessEnvironment({PGPASSWORD:'owned-child-only',PGCONNECT_TIMEOUT:'5'});
    assert.equal(owned.PGPASSWORD,'owned-child-only'); assert.equal(owned.PGSERVICE,undefined);
  } finally {
    if (previous === undefined) delete process.env.PGSERVICE; else process.env.PGSERVICE=previous;
    if (previousPassword === undefined) delete process.env.PGPASSWORD; else process.env.PGPASSWORD=previousPassword;
  }
});

const catalogue = {functionIdentities:['public.reviewed_read_v1(uuid)'],relationIdentities:['public.reviewed_state','public.reviewed_state_id_seq']};
// This small TOC is parser-only data, never a database, dump or native receipt.
const toc = [
  '; Archive created at 2026-10-27 00:00:00',
  '; Format: CUSTOM',
  '; Dumped from database version: 17.11',
  '; Dumped by pg_dump version: 17.11',
  '10; 1262 5 DATABASE - postgres state_owner',
  '1; 2615 2200 SCHEMA - public pg_database_owner',
  '2; 1255 20001 FUNCTION public reviewed_read_v1(uuid) state_owner',
  '3; 1259 20002 TABLE public reviewed_state state_owner',
  '4; 1259 20003 SEQUENCE public reviewed_state_id_seq state_owner',
  '5; 0 0 ACL public FUNCTION reviewed_read_v1(uuid) state_owner',
  '6; 826 20004 DEFAULT ACL - DEFAULT PRIVILEGES FOR FUNCTIONS state_owner',
].join('\n')+'\n';

test('schema-only custom PG17 TOC retains ACL/default ACL and matches full source identities', () => {
  const result=validateEmptySchemaToc(toc,catalogue);
  assert.equal(result.entries,7);assert.equal(result.counts.ACL,1);assert.equal(result.counts['DEFAULT ACL'],1);
  assert.equal(result.counts.DATABASE,1);assert.equal(result.database_creation_restored,false);
  assert.equal(result.data_entries,0);assert.equal(result.acl_preserved,true);
  assert.match(result.raw_sha256,/^[a-f0-9]{64}$/);
  assert.equal(result.raw_sha256,emptySchemaSha256(toc));
});

test('TOC rejects data, sequence values, large objects and external effects', () => {
  for (const kind of ['TABLE DATA','SEQUENCE SET','MATERIALIZED VIEW DATA','BLOB','BLOBS','LARGE OBJECT',
    'FOREIGN TABLE','SERVER','USER MAPPING','PUBLICATION','SUBSCRIPTION','EVENT TRIGGER','DATABASE']) {
    assert.throws(() => validateEmptySchemaToc(toc+'7; 0 20005 '+kind+' public reviewed_state state_owner\n',catalogue),/non_schema_content/);
  }
  assert.throws(() => validateEmptySchemaToc(toc+'7; 0 20005 UNKNOWN public object state_owner\n',catalogue),/unreviewed_content/);
});

test('TOC rejects temporary API/probe and unreviewed function identity/signature', () => {
  for (const name of ['atomic_fresh_api','fresh_candidate_api','fresh_candidate_probe','fresh_default_acl_probe','synthetic_rpc','fixture_rpc']) {
    assert.throws(() => validateEmptySchemaToc(toc+'7; 0 20005 FUNCTION public '+name+'() state_owner\n',catalogue));
  }
  assert.throws(() => validateEmptySchemaToc(toc.replace('reviewed_read_v1(uuid) state_owner','reviewed_read_v1(text) state_owner'),catalogue),/catalogue_mismatch/);
  assert.throws(() => validateEmptySchemaToc(toc.replace('reviewed_read_v1(uuid) state_owner','reviewed_read_v1(uuid) other_owner'),catalogue),/owner_or_identity/);
  assert.throws(() => validateEmptySchemaToc(toc+'7; 0 20005 TABLE public foreign_table state_owner\n',catalogue),/catalogue_mismatch/);
  assert.throws(() => validateEmptySchemaToc(toc.replace(/^2;.*\n/m,''),catalogue),/catalogue_mismatch/);
});

test('TOC rejects missing ACL, incompatible format/version, duplicate IDs and truncated entries', () => {
  assert.throws(() => validateEmptySchemaToc(toc.replace(/^5;.*\n/m,''),catalogue),/acl_missing/);
  assert.throws(() => validateEmptySchemaToc(toc.replace(/^6;.*\n/m,''),catalogue),/acl_missing/);
  assert.throws(() => validateEmptySchemaToc(toc.replace('CUSTOM','PLAIN'),catalogue),/pg17_custom/);
  assert.throws(() => validateEmptySchemaToc(toc.replace(/^10;.*\n/m,''),catalogue),/factory_database/);
  assert.throws(() => validateEmptySchemaToc(toc.replace('DATABASE - postgres state_owner','DATABASE - installed_db state_owner'),catalogue),/non_schema_content/);
  assert.throws(() => validateEmptySchemaToc(toc.replaceAll('17.11','18.1'),catalogue),/pg17_custom/);
  assert.throws(() => validateEmptySchemaToc(toc.replace('pg_dump version: 17.11','pg_dump version: 17.10'),catalogue),/pg17_custom/);
  assert.throws(() => validateEmptySchemaToc(toc+'1; 0 0 COMMENT - SCHEMA public pg_database_owner\n',catalogue),/entry_invalid/);
  assert.throws(() => validateEmptySchemaToc(toc+'truncated\n',catalogue),/entry_invalid/);
});

test('semantic catalogue digest ignores row/key order but detects body and ACL changes', () => {
  const initial = {functions:[{name:'one',definition:'select 1'},{name:'two',definition:'select 2'}],relations:[{name:'table',rls:true}]};
  const reordered = {relations:[{rls:true,name:'table'}],functions:[{definition:'select 2',name:'two'},{definition:'select 1',name:'one'}]};
  assert.equal(emptySchemaCatalogueDigest(initial),emptySchemaCatalogueDigest(reordered));
  assert.notEqual(emptySchemaCatalogueDigest(initial),emptySchemaCatalogueDigest({...initial,functions:[{name:'one',definition:'select true'}]}));
  assert.notEqual(emptySchemaCatalogueDigest({acls:[{grantee:'PUBLIC',execute:false}]}),emptySchemaCatalogueDigest({acls:[{grantee:'PUBLIC',execute:true}]}));
});

const roundtripEvidence = () => ({
  catalogue_sha256:'1'.repeat(64),acl_sha256:'2'.repeat(64),table_rows_sha256:'3'.repeat(64),sequence_state_sha256:'4'.repeat(64),
  postgres_version_num:170011,empty_tables:10,application_rows:0,catalogue_check:{exact_rpc_signatures:57},
});
test('roundtrip refuses body/ACL/empty-row/sequence/version mismatches', () => {
  const source=roundtripEvidence();assert.doesNotThrow(()=>assertEmptySchemaRoundtrip(source,{...source}));
  for(const key of ['catalogue_sha256','acl_sha256','table_rows_sha256','sequence_state_sha256','postgres_version_num']) {
    assert.throws(()=>assertEmptySchemaRoundtrip(source,{...source,[key]:'changed'}),/roundtrip/);
  }
  assert.throws(()=>assertEmptySchemaRoundtrip(source,{...source,application_rows:1}),/empty_tables/);
  assert.throws(()=>assertEmptySchemaRoundtrip(source,{...source,empty_tables:0}),/empty_tables/);
  assert.throws(()=>assertEmptySchemaRoundtrip(source,{...source,catalogue_check:{exact_rpc_signatures:56}}));
});

// Pure publisher contract fixture only; never emitted as native qualification.
const archive = Buffer.from('PGDMP-not-a-real-archive-pure-unit-contract');
function publishEvidence() {
  return {...roundtripEvidence(),archive_sha256:emptySchemaSha256(archive),archive_bytes:archive.length,
    classification:'NATIVE_PG17',status:'CANONICAL_EMPTY_SCHEMA_ROUNDTRIP_PASSED',production_qualified:false,
    runtime_ready:false,owner_enrollment_qualified:false,application_rows_seeded:false,
    independent_disposable_clusters:2,independent_identities_verified:true,cleanup_complete:true,
    source_identity_sha256:'5'.repeat(64),restore_identity_sha256:'6'.repeat(64),
    restored_catalogue_sha256:'1'.repeat(64),restored_acl_sha256:'2'.repeat(64),
    toc:{data_entries:0,sequence_set_entries:0,temporary_api_or_fixture_objects:0,acl_preserved:true},
    catalogue_check:{exact_rpc_signatures:57,public_function_execute:false,default_environment_fenced:true}};
}
test('publication requires native roundtrip, independent identities and completed cleanup', () => {
  const evidence=publishEvidence();assert.doesNotThrow(()=>assertPublishableEmptySchemaEvidence({archive,evidence}));
  for(const [key,value] of Object.entries({classification:'WASM_SQL18_ONLY',postgres_version_num:180001,
    status:'SCHEMA_CANDIDATE_CHECKS_PASSED',production_qualified:true,runtime_ready:true,owner_enrollment_qualified:true,
    application_rows_seeded:true,application_rows:1,empty_tables:0,independent_disposable_clusters:1,
    independent_identities_verified:false,cleanup_complete:false,restore_identity_sha256:evidence.source_identity_sha256,
    restored_catalogue_sha256:'7'.repeat(64),restored_acl_sha256:'7'.repeat(64)})) {
    assert.throws(()=>assertPublishableEmptySchemaEvidence({archive,evidence:{...evidence,[key]:value}}),/unqualified/);
  }
  assert.throws(()=>assertPublishableEmptySchemaEvidence({archive:Buffer.from('other'),evidence}),/archive_invalid/);
  assert.throws(()=>assertPublishableEmptySchemaEvidence({archive,evidence:{...evidence,toc:{...evidence.toc,acl_preserved:false}}}),/unqualified/);
});

async function gitFixture(temporary) {
  const repository = path.join(temporary,'repository');
  await fs.mkdir(repository);await fs.mkdir(path.join(repository,'module'));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
  Object.assign(env,{GIT_AUTHOR_NAME:'Contract Test',GIT_AUTHOR_EMAIL:'contract@example.invalid',
    GIT_COMMITTER_NAME:'Contract Test',GIT_COMMITTER_EMAIL:'contract@example.invalid'});
  const git=async(args,input)=>new Promise((resolve,reject)=>{
    const child=execFile('git',['-C',repository,...args],{env,encoding:'utf8',maxBuffer:1024*1024,timeout:5000},(error,stdout)=>{
      if(error)reject(error);else resolve(stdout.trim());
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
  await git(['init','--quiet']);
  const writeTree = async(schema,exporter) => {
    const schemaBlob=await git(['hash-object','-w','--stdin'],schema);
    const exporterBlob=await git(['hash-object','-w','--stdin'],exporter);
    const subtree=await git(['mktree'],'100644 blob '+schemaBlob+'\tplan.sql\n100644 blob '+exporterBlob+'\texporter.mjs\n');
    return git(['mktree'],'040000 tree '+subtree+'\tmodule\n');
  };
  // Disposable Git object fixtures, never a commit/ref in the project repository.
  const schemaHead=await git(['commit-tree',await writeTree('reviewed-source\n','old-exporter\n')], 'schema fixture\n');
  const exporterHead=await git(['commit-tree',await writeTree('reviewed-source\n','new-exporter\n'),'-p',schemaHead], 'exporter fixture\n');
  await git(['update-ref','HEAD',exporterHead]);
  await fs.writeFile(path.join(repository,'module','plan.sql'),'reviewed-source\n');
  await fs.writeFile(path.join(repository,'module','exporter.mjs'),'new-exporter\n');
  const args={repositoryRoot:repository,schemaSourceHead:schemaHead,exporterSourceHead:exporterHead,
    inputPaths:['module/plan.sql'],exporterPaths:['module/exporter.mjs']};
  return {repository,args,git,writeTree};
}

test('separate source/exporter commits require equal schema Git blobs plus actual file bytes', async () => {
  await withDirectory(async temporary=>{
    const {args}=await gitFixture(temporary);
    const bound=await validateEmptySchemaSourceBinding(args);
    assert.notEqual(bound.schema_source_head,bound.exporter_source_head);
    assert.equal(bound.schema_inputs_equal_at_both_heads,true);
    assert.equal(bound.actual_working_bytes_verified,true);
    assert.equal(bound.schema_inputs[0].sha256,emptySchemaSha256('reviewed-source\n'));
    assert.equal(bound.exporter_inputs[0].sha256,emptySchemaSha256('new-exporter\n'));
  });
});

test('caller labels, changed schema Git blobs and dirty executable/schema bytes cannot qualify', async () => {
  await withDirectory(async temporary=>{
    const {repository,args,git,writeTree}=await gitFixture(temporary);
    await assert.rejects(validateEmptySchemaSourceBinding({...args,exporterSourceHead:args.schemaSourceHead}),/exporter_head_mismatch/);
    await fs.writeFile(path.join(repository,'module','plan.sql'),'dirty-source\n');
    await assert.rejects(validateEmptySchemaSourceBinding(args),/working_source_changed/);
    await fs.writeFile(path.join(repository,'module','plan.sql'),'reviewed-source\n');
    await fs.writeFile(path.join(repository,'module','exporter.mjs'),'dirty-code\n');
    await assert.rejects(validateEmptySchemaSourceBinding(args),/working_source_changed/);
    const changed=await git(['commit-tree',await writeTree('changed-canonical-source\n','new-exporter\n'),'-p',args.exporterSourceHead],'changed schema fixture\n');
    await git(['update-ref','HEAD',changed]);
    await fs.writeFile(path.join(repository,'module','plan.sql'),'changed-canonical-source\n');
    await fs.writeFile(path.join(repository,'module','exporter.mjs'),'new-exporter\n');
    await assert.rejects(validateEmptySchemaSourceBinding({...args,exporterSourceHead:changed}),/predecessor_inputs_changed/);
  });
});

test('source path traversal and physical file aliases are refused', async () => {
  await withDirectory(async temporary=>{
    const {repository,args}=await gitFixture(temporary);
    await assert.rejects(validateEmptySchemaSourceBinding({...args,inputPaths:['../outside.sql']}),/source_path_invalid/);
    const file=path.join(repository,'module','plan.sql');
    await fs.link(file,path.join(repository,'linked.sql'));
    await assert.rejects(validateEmptySchemaSourceBinding(args),/source_file_alias/);
  });
});

test('CLI failure receipts cannot reveal arguments, credentials, SQL or local paths', () => {
  let refusal;
  try { parseEmptySchemaArguments([...validArgs(),'--database-url','postgres://owner:DO_NOT_PRINT@localhost/db']); }
  catch(error) { refusal=error; }
  assert.deepEqual(emptySchemaFailureReceipt(refusal),{event:'reviewed_empty_schema_export_failed',code:'empty_schema_arguments_invalid',
    primary_failure:{stage:'UNCLASSIFIED',error_category:'CONTRACT',contract_code:'empty_schema_arguments_invalid'},
    cleanup_failures:[],cleanup_failures_truncated:false});
  for(const message of ['postgres://owner:DO_NOT_PRINT@localhost/db','select secret from installed_data',
    'C:\\Users\\Private\\PGDATA','empty_schema_failed\nDO_NOT_PRINT']) {
    const receipt=emptySchemaFailureReceipt(new Error(message));
    assert.deepEqual(receipt,{event:'reviewed_empty_schema_export_failed',code:'empty_schema_qualification_failed',
      primary_failure:{stage:'UNCLASSIFIED',error_category:'UNKNOWN'},cleanup_failures:[],cleanup_failures_truncated:false});
  }
});

async function caughtFailure(stage,error) {
  try { await runEmptySchemaStage(stage,() => { throw error; }); }
  catch (caught) { return caught; }
  assert.fail('fixture failure must propagate');
}
const postgresFailure = code => Object.assign(new Error('PRIVATE SQL and connection arguments'),{
  name:'PostgresError',code,query:'PRIVATE SQL',parameters:['PRIVATE PASSWORD'],
  detail:'PRIVATE DETAIL',file:'C:\\Private\\PGDATA',stderr:'PRIVATE STDERR',
});

test('diagnostic stages preserve success values and expected original refusals',async () => {
  const value=Object.freeze({unchanged:true});
  assert.equal(await runEmptySchemaStage('SOURCE_BASELINE',() => value),value);
  const refusal=new Error('intentional_atomic_rollback');
  await assert.rejects(runEmptySchemaStage('SOURCE_BASELINE',() => { throw refusal; }),error => error===refusal);
  await assert.rejects(runEmptySchemaStage('SOURCE_BASELINE',() => { throw refusal; }),/intentional_atomic_rollback/);
  let invoked=false;
  await assert.rejects(runEmptySchemaStage('PRIVATE PATH',() => { invoked=true; }),/diagnostic_stage_invalid/);
  assert.equal(invoked,false);
});

test('SQLSTATE diagnostics never read message, stack, query, args, paths or stderr',async () => {
  const error=postgresFailure('42601');
  let reads=0;
  for(const key of ['message','stack','query','parameters','detail','file','stderr'])
    Object.defineProperty(error,key,{get(){reads++;throw new Error('PRIVATE getter must not run');}});
  const caught=await caughtFailure('SOURCE_INSPECT_ACL',error);
  const receipt=emptySchemaFailureReceipt(caught);
  assert.deepEqual(receipt,{event:'reviewed_empty_schema_export_failed',code:'empty_schema_qualification_failed',
    primary_failure:{stage:'SOURCE_INSPECT_ACL',error_category:'POSTGRES',sqlstate:'42601'},
    cleanup_failures:[],cleanup_failures_truncated:false});
  assert.equal(reads,0);
  assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|password|PGDATA|query|stderr/i);
  for(const invalid of ['42601 PRIVATE','4260','426011','lower']) {
    const invalidReceipt=emptySchemaFailureReceipt(await caughtFailure('SOURCE_BASELINE',postgresFailure(invalid)));
    assert.deepEqual(invalidReceipt.primary_failure,{stage:'SOURCE_BASELINE',error_category:'UNKNOWN'});
  }
  const forged=Object.assign(new Error('empty_schema_PRIVATE'),{code:'empty_schema_private_password',
    primary_failure:{stage:'PRIVATE',error_category:'PRIVATE'}});
  assert.equal(emptySchemaFailureReceipt(forged).code,'empty_schema_qualification_failed');
});

test('unexpected SQL rejection retains its inner boundary through assert.rejects',async () => {
  const original=postgresFailure('42P01');
  await assert.rejects(runEmptySchemaStage('SOURCE_ROLLBACK_CHECK',() =>
    assert.rejects(runEmptySchemaStage('SOURCE_BASELINE',() => { throw original; }),/intentional_atomic_rollback/)),error => {
      assert.deepEqual(emptySchemaFailureMetadata(error).primary_failure,
        {stage:'SOURCE_BASELINE',error_category:'POSTGRES',sqlstate:'42P01'});
      return true;
    });
});

test('an accepted negative SQL control cannot become a later unrelated assertion cause',async () => {
  const expected=postgresFailure('42501');
  await assert.rejects(runEmptySchemaStage('SOURCE_API_PROBES',() => { throw expected; }),error => error.code==='42501');
  await assert.rejects(runEmptySchemaStage('EVIDENCE_COMPARE',() => {
    assert.equal('actual-catalogue','expected-catalogue','PRIVATE later assertion');
  }),error => {
    const receipt=emptySchemaFailureReceipt(error);
    assert.deepEqual(receipt.primary_failure,{stage:'EVIDENCE_COMPARE',error_category:'ASSERTION'});
    assert.deepEqual(receipt.cleanup_failures,[]);
    assert.doesNotMatch(JSON.stringify(receipt),/42501|SOURCE_API_PROBES|PRIVATE/);
    return true;
  });
});

test('primary native failure and independent cleanup failures retain separate bounded records',async () => {
  const primary=await caughtFailure('RESTORE_INSPECT_COLUMNS',postgresFailure('42703'));
  const stop=await caughtFailure('RESTORE_STOP',Object.assign(new Error('PRIVATE stop path'),{code:'EPERM'}));
  const workspace=await caughtFailure('WORKSPACE_CLEANUP',Object.assign(new Error('PRIVATE directory'),{code:'ENOTEMPTY'}));
  const combined=combineEmptySchemaCleanupFailure(combineEmptySchemaCleanupFailure(primary,stop),workspace);
  const receipt=emptySchemaFailureReceipt(combined);
  assert.deepEqual(receipt.primary_failure,{stage:'RESTORE_INSPECT_COLUMNS',error_category:'POSTGRES',sqlstate:'42703'});
  assert.deepEqual(receipt.cleanup_failures,[
    {stage:'RESTORE_STOP',error_category:'FILESYSTEM',system_code:'EPERM'},
    {stage:'WORKSPACE_CLEANUP',error_category:'FILESYSTEM',system_code:'ENOTEMPTY'},
  ]);
  assert.equal(receipt.cleanup_failures_truncated,false);
  assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE/);
  receipt.cleanup_failures[0].stage='TAMPERED';
  assert.equal(emptySchemaFailureMetadata(combined).cleanup_failures[0].stage,'RESTORE_STOP');
  let overflow=combined;
  for(let i=0;i<12;i++)overflow=combineEmptySchemaCleanupFailure(overflow,workspace);
  assert.equal(emptySchemaFailureMetadata(overflow).cleanup_failures.length,8);
  assert.equal(emptySchemaFailureMetadata(overflow).cleanup_failures_truncated,true);
});

test('cleanup-only refusal does not invent a primary operation failure',async () => {
  const cleanup=await caughtFailure('SOURCE_DIRECTORY_CLEANUP',Object.assign(new Error('PRIVATE'),{code:'EBUSY'}));
  const metadata=emptySchemaFailureMetadata(combineEmptySchemaCleanupFailure(null,cleanup));
  assert.equal(metadata.primary_failure,null);
  assert.deepEqual(metadata.cleanup_failures,[{stage:'SOURCE_DIRECTORY_CLEANUP',error_category:'FILESYSTEM',system_code:'EBUSY'}]);
  assert.equal(metadata.cleanup_failures_truncated,false);
});

test('assertion, filesystem, network and unrecognized errors have closed categories',async () => {
  for(const [error,expected] of [
    [Object.assign(new Error('PRIVATE'),{code:'ERR_ASSERTION'}),{error_category:'ASSERTION'}],
    [Object.assign(new Error('PRIVATE'),{code:'ENOENT'}),{error_category:'FILESYSTEM',system_code:'ENOENT'}],
    [Object.assign(new Error('PRIVATE'),{code:'ECONNREFUSED'}),{error_category:'NETWORK',system_code:'ECONNREFUSED'}],
    [Object.assign(new Error('PRIVATE'),{code:'PRIVATE_CODE'}),{error_category:'UNKNOWN'}],
  ]) assert.deepEqual(emptySchemaFailureMetadata(await caughtFailure('SOURCE_DRIVER_CONNECT',error)).primary_failure,
    {stage:'SOURCE_DRIVER_CONNECT',...expected});
});

test('actual inspection query failure identifies its boundary without exposing catalogue data',async () => {
  // Pure driver-shaped refusal, not a PostgreSQL/schema qualification fixture.
  const error=postgresFailure('42P01');
  const sql={unsafe:async statement => {
    if(statement.startsWith('set search_path'))return [];
    if(statement.includes('server_version_num'))return [{value:170011}];
    if(statement.includes('pg_catalog.pg_namespace n where'))return [{name:'public',owner:'state_owner'}];
    if(statement.includes('pg_catalog.pg_roles'))throw error;
    assert.fail('no query may follow the refused inspection boundary');
  }};
  await assert.rejects(inspectCanonicalEmptySchema({sql,plan:{},verifyCatalogue:async () => ({}),phase:'RESTORE'}),caught => {
    assert.equal(caught,error);
    assert.deepEqual(emptySchemaFailureMetadata(caught).primary_failure,
      {stage:'RESTORE_INSPECT_ROLES',error_category:'POSTGRES',sqlstate:'42P01'});
    return true;
  });
});

test('owned command refusal reports a closed reason without child args or stderr',async () => {
  await assert.rejects(runEmptySchemaStage('SOURCE_INITDB',() => runEmptySchemaCommand(
    path.join(directory,'missing-empty-schema-command-PRIVATE'),['PRIVATE_PASSWORD'])),error => {
      const receipt=emptySchemaFailureReceipt(error);
      assert.deepEqual(receipt.primary_failure,{stage:'SOURCE_INITDB',error_category:'COMMAND',command_reason:'FAILED'});
      assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE/);
      return true;
    });
});

test('bounded child output is classified as output limit even when the child is killed',async () => {
  await assert.rejects(runEmptySchemaStage('SOURCE_TOC_READ',() => runEmptySchemaCommand(
    process.execPath,['-e',"process.stdout.write('PRIVATE_OUTPUT'.repeat(10000))"],{maxBytes:32})),error => {
      const receipt=emptySchemaFailureReceipt(error);
      assert.deepEqual(receipt.primary_failure,{stage:'SOURCE_TOC_READ',error_category:'COMMAND',command_reason:'OUTPUT_LIMIT'});
      assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_OUTPUT/);
      return true;
    });
});
