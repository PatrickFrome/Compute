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
  emptySchemaPostgresStartOptions, classifyEmptySchemaPostmasterStartLog,
  prepareEmptySchemaPostmasterLogObservation,
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

test('canonical inspection pins ACL object type and uses PostgreSQL constraint deparsing',async () => {
  const reachedAcl=new Error('inspection boundary reached');
  let constraintQuery=false,aclQuery=false;
  const sql={unsafe:async statement => {
    if(statement.includes('server_version_num'))return [{value:170011}];
    if(statement.includes('pg_catalog.pg_roles'))return ['state_owner','anon','authenticated','service_role'].map(rolname=>({rolname}));
    if(statement.includes('pg_catalog.pg_largeobject_metadata'))return [{large_objects:0,event_triggers:0,foreign_servers:0,publications:0,subscriptions:0}];
    if(statement.includes('pg_catalog.pg_constraint c')) {
      assert.match(statement,/pg_get_constraintdef\(c\.oid,true\)/);
      constraintQuery=true;
    }
    if(statement.includes('pg_catalog.aclexplode')) {
      assert.match(statement,/d\.defaclobjtype::text/);
      aclQuery=true;throw reachedAcl;
    }
    return [];
  }};
  await assert.rejects(inspectCanonicalEmptySchema({sql,plan:{},verifyCatalogue:async()=>({})}),error=>error===reachedAcl);
  assert.equal(constraintQuery,true);assert.equal(aclQuery,true);
  const digest=definition=>emptySchemaCatalogueDigest({constraints:[{definition}]});
  assert.notEqual(digest('CHECK (x >= 16 AND x <= 160)'),digest('CHECK (x >= 16 OR x <= 160)'));
  assert.notEqual(digest('CHECK (x >= 16)'),digest('CHECK (x >= 15)'));
});

test('archive listing includes database metadata without restoring database creation',async () => {
  const source=await fs.readFile(new URL('./test/fresh-schema-disposable.mjs',import.meta.url),'utf8');
  assert.match(source,/command\('pg_restore',\['--list','--create',archiveOperation\.archive\]\)/);
  assert.match(source,/command\('pg_restore',\[\.\.\.privateConnectionArgs,'--single-transaction','--exit-on-error','--no-owner',archiveOperation\.archive\]/);
  assert.throws(()=>validateEmptySchemaToc(toc.replace('10; 1262 5 DATABASE - postgres state_owner\n',''),catalogue),/factory_database_required/);
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

test('canonical startup supplies an actual empty socket setting under Windows argument rules',() => {
  // For these fixed ASCII options, Windows argv splits whitespace and removes
  // double quotes only; single quotes are ordinary characters. pg_ctl inserts
  // -o into CMD.EXE verbatim (PostgreSQL17 pg_ctl.c start_postmaster).
  const setting = options => {
    const argv=options.match(/"[^"]*"|[^\s]+/g).map(value => value.replace(/^"(.*)"$/,'$1'));
    assert.deepEqual(argv.slice(0,4),['-h','127.0.0.1','-p','49152']);
    assert.equal(argv[4],'-c'); assert.equal(argv.length,6);
    const at=argv[5].indexOf('='); assert(at>=0);
    return {name:argv[5].slice(0,at),value:argv[5].slice(at+1)};
  };
  assert.deepEqual(setting(emptySchemaPostgresStartOptions(49152)),{name:'unix_socket_directories',value:''});
  assert.deepEqual(setting("-h 127.0.0.1 -p 49152 -c unix_socket_directories=''"),
    {name:'unix_socket_directories',value:"''"},'old POSIX quoting is a literal nonempty Windows setting');
  for(const port of [0,443,1023,65536,NaN,Infinity,1.5,'49152','49152 -c PRIVATE'])
    assert.throws(() => emptySchemaPostgresStartOptions(port),/disposable_port_invalid/);
});

test('startup log categories are finite and never publish raw lines, paths or SQL',() => {
  const input=Buffer.from("2026-10-27 UTC [123] FATAL: could not create lock file \"''/.s.PGSQL.49152.lock\": No such file or directory\n"
    + 'PRIVATE password=unpublished SELECT secret FROM private_table; C:\\PRIVATE\\PGDATA\n');
  const result=classifyEmptySchemaPostmasterStartLog(input);
  assert.deepEqual(result,{status:'CLASSIFIED',markers:['UNIX_SOCKET_FAILURE','FATAL_OR_PANIC'],bytes_examined:input.length});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|password|secret|PGDATA|49152|No such/);
  assert.equal(classifyEmptySchemaPostmasterStartLog(Buffer.from('unknown PRIVATE')).status,'UNCLASSIFIED');
  assert.deepEqual(classifyEmptySchemaPostmasterStartLog(Buffer.alloc(0)),{status:'EMPTY',markers:[],bytes_examined:0});
  assert.throws(() => classifyEmptySchemaPostmasterStartLog(Buffer.alloc(32769)),/postmaster_log_invalid/);
  for(const [line,marker] of [
    ['FATAL: Permission denied: PRIVATE','ACCESS_DENIED'],
    ['LOG: could not bind IPv4 address PRIVATE: Address already in use','PORT_BIND_FAILURE'],
    ['FATAL: invalid value for parameter PRIVATE','CONFIGURATION_FAILURE'],
    ['FATAL: data directory PRIVATE has invalid permissions','DATA_DIRECTORY_FAILURE'],
    ['FATAL: could not load library PRIVATE','EXECUTABLE_OR_LIBRARY_FAILURE'],
    ['FATAL: could not create shared memory PRIVATE','SHARED_MEMORY_FAILURE'],
    ['FATAL: lock file PRIVATE/postmaster.pid already exists','ALREADY_RUNNING_OR_PID_LOCK'],
    ['LOG: database system is ready to accept connections','DATABASE_READY'],
  ]) assert(classifyEmptySchemaPostmasterStartLog(Buffer.from(line)).markers.includes(marker));
});

const controlFailureFixture = () => Object.assign(new Error('PRIVATE control stderr and path'),{
  code:'owned_postgres_control_failed',control_outcome:Object.freeze({kind:'EXIT',exit_code:1,signal:null}),
});

test('only a fresh owned log is observed and its categories accompany the original control failure',async () => {
  await withDirectory(async root => {
    const observe=await prepareEmptySchemaPostmasterLogObservation(root);
    const bytes=Buffer.from('FATAL: Permission denied: C:\\PRIVATE\\PGDATA\n');
    await fs.writeFile(path.join(root,'postgres.log'),bytes,{flag:'wx'});
    const error=controlFailureFixture(); await observe(error);
    const receipt=emptySchemaFailureReceipt(await caughtFailure('SOURCE_START',error));
    assert.deepEqual(receipt.primary_failure,{stage:'SOURCE_START',error_category:'COMMAND',command_reason:'FAILED',
      control_kind:'EXIT',exit_code:1,signal:null,postmaster_log_status:'CLASSIFIED',
      postmaster_log_markers:['ACCESS_DENIED','FATAL_OR_PANIC'],postmaster_log_bytes_examined:bytes.length});
    assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|PGDATA|stderr/);
    receipt.primary_failure.postmaster_log_markers.push('TAMPERED');
    assert(!emptySchemaFailureMetadata(error).primary_failure.postmaster_log_markers.includes('TAMPERED'));
    await assert.rejects(prepareEmptySchemaPostmasterLogObservation(root),/postmaster_log_already_exists/);
  });
});

test('an absent startup log and spawn failure remain explicit without invented server errors',async () => {
  await withDirectory(async root => {
    const observe=await prepareEmptySchemaPostmasterLogObservation(root);
    const error=Object.assign(new Error('PRIVATE'),{code:'owned_postgres_control_failed',
      control_outcome:{kind:'SPAWN_ERROR',system_code:'ENOENT',PRIVATE:'do not copy'}});
    await observe(error);
    const receipt=emptySchemaFailureReceipt(await caughtFailure('RESTORE_START',error));
    assert.deepEqual(receipt.primary_failure,{stage:'RESTORE_START',error_category:'COMMAND',command_reason:'FAILED',
      control_kind:'SPAWN_ERROR',spawn_code:'ENOENT',postmaster_log_status:'ABSENT',postmaster_log_markers:[],
      postmaster_log_bytes_examined:0,postmaster_log_system_code:'ENOENT'});
    assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE/);
  });
});

for(const kind of ['junction','hardlink','oversize','directory']) test('startup log observation refuses '+kind+' without reading payload',async () => {
  await withDirectory(async root => {
    const owned=path.join(root,'owned');await fs.mkdir(owned);
    const observe=await prepareEmptySchemaPostmasterLogObservation(owned);
    const log=path.join(owned,'postgres.log'),outside=path.join(root,'outside');
    if(kind==='junction') { await fs.mkdir(outside);await fs.symlink(outside,log,process.platform==='win32'?'junction':'dir'); }
    if(kind==='hardlink') { await fs.writeFile(outside,'PRIVATE');await fs.link(outside,log); }
    if(kind==='oversize') await fs.writeFile(log,Buffer.alloc(32769,65));
    if(kind==='directory')await fs.mkdir(log);
    const originalOpen=fs.open;let opened=0;
    fs.open=async (...args) => {opened++;return originalOpen(...args);};
    try {
      const error=controlFailureFixture();await observe(error);
      const record=emptySchemaFailureMetadata(await caughtFailure('SOURCE_START',error)).primary_failure;
      assert.equal(record.postmaster_log_status,'REFUSED');
      assert.deepEqual(record.postmaster_log_markers,[]);assert.equal(record.postmaster_log_bytes_examined,0);
      assert.equal(opened,0);
    } finally {fs.open=originalOpen;}
  });
});

test('startup log custody rejects a root junction or replacement and in-read file mutation',async () => {
  await withDirectory(async root => {
    const owned=path.join(root,'owned'),alias=path.join(root,'alias');await fs.mkdir(owned);
    await fs.symlink(owned,alias,process.platform==='win32'?'junction':'dir');
    await assert.rejects(prepareEmptySchemaPostmasterLogObservation(alias),/root_alias/);
    const observe=await prepareEmptySchemaPostmasterLogObservation(owned);
    await fs.rename(owned,path.join(root,'moved'));await fs.mkdir(owned);
    await fs.writeFile(path.join(owned,'postgres.log'),'FATAL: PRIVATE');
    const replaced=controlFailureFixture();await observe(replaced);
    assert.equal(emptySchemaFailureMetadata(await caughtFailure('SOURCE_START',replaced)).primary_failure.postmaster_log_status,'REFUSED');
    const fresh=path.join(root,'fresh');await fs.mkdir(fresh);
    const next=await prepareEmptySchemaPostmasterLogObservation(fresh),log=path.join(fresh,'postgres.log');
    await fs.writeFile(log,'FATAL: PRIVATE');
    const originalOpen=fs.open;let mutated=false;
    fs.open=async (...args) => {
      const handle=await originalOpen(...args);const read=handle.read.bind(handle);
      handle.read=async (...readArgs) => {
        const result=await read(...readArgs);
        if(!mutated) {mutated=true;await fs.writeFile(log,'FATAL: CHANGED');const changed=new Date(Date.now()+2000);await fs.utimes(log,changed,changed);}
        return result;
      };
      return handle;
    };
    try {
      const error=controlFailureFixture();await next(error);
      const record=emptySchemaFailureMetadata(await caughtFailure('SOURCE_START',error)).primary_failure;
      assert.equal(record.postmaster_log_status,'UNSTABLE');assert.deepEqual(record.postmaster_log_markers,[]);
    } finally {fs.open=originalOpen;}
  });
});

test('control diagnostics ignore forged strings and do not read outcome getters',async () => {
  let reads=0;
  const outcome={kind:'EXIT',exit_code:'PRIVATE',signal:'PRIVATE',unrelated:'PRIVATE'};
  Object.defineProperty(outcome,'exit_code',{get(){reads++;throw new Error('PRIVATE');}});
  const error=Object.assign(new Error('PRIVATE'),{code:'owned_postgres_control_failed',control_outcome:outcome});
  const record=emptySchemaFailureMetadata(await caughtFailure('SOURCE_START',error)).primary_failure;
  assert.deepEqual(record,{stage:'SOURCE_START',error_category:'COMMAND',command_reason:'FAILED',control_kind:'EXIT'});
  assert.equal(reads,0);assert.doesNotMatch(JSON.stringify(record),/PRIVATE/);
});

test('spawn diagnostics publish the one validated descriptor snapshot only',async () => {
  let reads=0,gets=0;
  const outcome=new Proxy({kind:'SPAWN_ERROR'},{
    get(){gets++;throw new Error('PRIVATE getter must not execute');},
    getOwnPropertyDescriptor(target,key) {
      if(key==='system_code')return {configurable:true,enumerable:true,writable:true,
        value:++reads===1?'ENOENT':'PRIVATE_SENTINEL'};
      return Reflect.getOwnPropertyDescriptor(target,key);
    },
  });
  const error=Object.assign(new Error('PRIVATE'),{code:'owned_postgres_control_failed',control_outcome:outcome});
  const record=emptySchemaFailureMetadata(await caughtFailure('SOURCE_START',error)).primary_failure;
  assert.deepEqual(record,{stage:'SOURCE_START',error_category:'COMMAND',command_reason:'FAILED',
    control_kind:'SPAWN_ERROR',spawn_code:'ENOENT'});
  assert.equal(reads,1);assert.equal(gets,0);assert.doesNotMatch(JSON.stringify(record),/PRIVATE/);
});

test('throwing error or outcome descriptor traps cannot escape the sanitized CLI receipt',async () => {
  let descriptorReads=0,gets=0;
  const outcome=new Proxy({}, {
    getOwnPropertyDescriptor(){descriptorReads++;throw new Error('PRIVATE descriptor');},
    get(){gets++;throw new Error('PRIVATE getter');},
  });
  const control=Object.assign(new Error('PRIVATE'),{code:'owned_postgres_control_failed',control_outcome:outcome});
  const controlReceipt=emptySchemaFailureReceipt(await caughtFailure('SOURCE_START',control));
  assert.deepEqual(controlReceipt.primary_failure,{stage:'SOURCE_START',error_category:'COMMAND',command_reason:'FAILED'});
  assert.equal(descriptorReads,1);assert.equal(gets,0);
  const error=new Proxy({}, {getOwnPropertyDescriptor(){throw new Error('PRIVATE error descriptor');}});
  assert.equal(await caughtFailure('RESTORE_START',error),error,'original error identity is retained');
  const unknownReceipt=emptySchemaFailureReceipt(error);
  assert.deepEqual(unknownReceipt.primary_failure,{stage:'RESTORE_START',error_category:'UNKNOWN'});
  assert.doesNotMatch(JSON.stringify([controlReceipt,unknownReceipt]),/PRIVATE/);
});
