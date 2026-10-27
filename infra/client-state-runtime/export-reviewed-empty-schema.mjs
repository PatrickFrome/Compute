// Produce a reviewed EMPTY schema fixture; never install, enroll or attach.
// Usage requires explicit ATOMIC_SLICE and two exact Git commit identities.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  EMPTY_SCHEMA_FILES, EMPTY_SCHEMA_INPUT_PATHS, EMPTY_SCHEMA_MAX_ARCHIVE_BYTES,
  assertEmptySchemaOptions, parseEmptySchemaArguments, assertNewEmptySchemaOutputDirectory,
  validateEmptySchemaSourceBinding, emptySchemaSha256,
  runEmptySchemaStage, combineEmptySchemaCleanupFailure, emptySchemaFailureMetadata,
} from './canonical-empty-schema-contract.mjs';

const repositoryRoot = fileURLToPath(new URL('../../',import.meta.url));

export function emptySchemaFailureReceipt(error) {
  return {event:'reviewed_empty_schema_export_failed',...emptySchemaFailureMetadata(error)};
}

export function assertPublishableEmptySchemaEvidence({archive,evidence}) {
  if (!Buffer.isBuffer(archive) || archive.length < 5 || archive.length > EMPTY_SCHEMA_MAX_ARCHIVE_BYTES
    || archive.subarray(0,5).toString('ascii') !== 'PGDMP'
    || evidence?.archive_sha256 !== emptySchemaSha256(archive) || evidence?.archive_bytes !== archive.length)
    throw Error('empty_schema_publish_archive_invalid');
  if (evidence.classification !== 'NATIVE_PG17' || evidence.status !== 'CANONICAL_EMPTY_SCHEMA_ROUNDTRIP_PASSED'
    || evidence.production_qualified !== false || evidence.runtime_ready !== false || evidence.owner_enrollment_qualified !== false
    || evidence.application_rows_seeded !== false || evidence.application_rows !== 0
    || !Number.isSafeInteger(evidence.empty_tables) || evidence.empty_tables < 1
    || !Number.isSafeInteger(evidence.postgres_version_num) || Math.floor(evidence.postgres_version_num / 10000) !== 17
    || evidence.independent_disposable_clusters !== 2 || evidence.independent_identities_verified !== true || evidence.cleanup_complete !== true
    || evidence.source_identity_sha256 === evidence.restore_identity_sha256
    || !/^[a-f0-9]{64}$/.test(evidence.source_identity_sha256 || '') || !/^[a-f0-9]{64}$/.test(evidence.restore_identity_sha256 || '')
    || !/^[a-f0-9]{64}$/.test(evidence.catalogue_sha256 || '') || !/^[a-f0-9]{64}$/.test(evidence.acl_sha256 || '')
    || evidence.restored_catalogue_sha256 !== evidence.catalogue_sha256 || evidence.restored_acl_sha256 !== evidence.acl_sha256
    || evidence.toc?.data_entries !== 0 || evidence.toc?.sequence_set_entries !== 0
    || evidence.toc?.temporary_api_or_fixture_objects !== 0 || evidence.toc?.acl_preserved !== true
    || !Number.isSafeInteger(evidence.catalogue_check?.exact_rpc_signatures) || evidence.catalogue_check.exact_rpc_signatures < 1
    || evidence.catalogue_check?.public_function_execute !== false
    || evidence.catalogue_check?.default_environment_fenced !== true)
    throw Error('empty_schema_publish_unqualified');
}

export async function exportReviewedEmptySchema(options) {
  const {destination,candidateBytes,candidateJson} = await runEmptySchemaStage('INPUT_PREFLIGHT',async () => {
  assertEmptySchemaOptions(options);
  const destination = await assertNewEmptySchemaOutputDirectory(options.outputDir);
  const candidateStat = await fs.lstat(new URL('./fresh-schema-candidate-plan.json',import.meta.url));
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size > 1024 * 1024)
    throw Error('empty_schema_candidate_plan_invalid');
  const candidateBytes = await fs.readFile(new URL('./fresh-schema-candidate-plan.json',import.meta.url));
  const candidateJson = JSON.parse(candidateBytes);
  if (candidateJson.schema !== 'compute.fresh-schema-candidate.v1' || !Array.isArray(candidateJson.baseline)
    || !Array.isArray(candidateJson.upgrades) || !candidateJson.baseline.length || !candidateJson.upgrades.length
    || candidateJson.baseline.length > 128 || candidateJson.upgrades.length > 128)
    throw Error('empty_schema_candidate_plan_invalid');
  return {destination,candidateBytes,candidateJson};
  });
  const inputPaths = [...EMPTY_SCHEMA_INPUT_PATHS,...candidateJson.baseline.map(row=>row.path),...candidateJson.upgrades.map(row=>row.path)];
  const bindingArgs = {repositoryRoot,inputPaths,schemaSourceHead:options.schemaSourceHead,exporterSourceHead:options.exporterSourceHead};
  const sourceBinding = await runEmptySchemaStage('SOURCE_BINDING',() => validateEmptySchemaSourceBinding(bindingArgs));
  // Import executable loaders only after their exact actual bytes are bound.
  const {candidate,plan,roundtripCanonicalEmptySchemaNative} = await runEmptySchemaStage('PLAN_LOAD',async () => {
  const {loadFreshSchemaCandidatePlan} = await import('./fresh-schema-plan.mjs');
  const {loadFreshSchemaApplicationPlan} = await import('./fresh-schema-application-plan.mjs');
  const candidate = await loadFreshSchemaCandidatePlan(), plan = await loadFreshSchemaApplicationPlan();
  const {roundtripCanonicalEmptySchemaNative} = await import('./test/fresh-schema-disposable.mjs');
  return {candidate,plan,roundtripCanonicalEmptySchemaNative};
  });
  const {archive,evidence} = await runEmptySchemaStage('NATIVE_ROUNDTRIP',() => roundtripCanonicalEmptySchemaNative({
    bin:options.bin,driver:options.driver,applicationMode:options.applicationMode,
  }));
  await runEmptySchemaStage('EVIDENCE_COMPARE',() => {
  assertPublishableEmptySchemaEvidence({archive,evidence});
  assert.equal(evidence.source_manifest_sha256,plan.source_manifest_sha256);
  assert.equal(evidence.upgrade_sources_sha256,candidate.upgrade_sources_sha256);
  assert.equal(candidate.candidate_sha256,emptySchemaSha256(candidateBytes));
  });
  await runEmptySchemaStage('SOURCE_RECHECK',async () => assert.deepEqual(await validateEmptySchemaSourceBinding(bindingArgs),sourceBinding));
  await runEmptySchemaStage('PUBLICATION_PREFLIGHT',() => assertNewEmptySchemaOutputDirectory(destination));
  const manifest = {
    schema:'compute.reviewed-empty-schema-export.v1',application_mode:'ATOMIC_SLICE',
    artifact_kind:'REVIEWED_CANONICAL_EMPTY_SCHEMA_FIXTURE',schema_only:true,custom_archive:true,
    owner_commands_restored:false,acl_preserved:true,installed_data_exported:false,
    installation_authorized:false,production_qualified:false,runtime_ready:false,
    ...sourceBinding,
    source_plan:{
      candidate_sha256:candidate.candidate_sha256,selection_sha256:plan.selection_sha256,
      source_manifest_sha256:plan.source_manifest_sha256,upgrade_sources_sha256:candidate.upgrade_sources_sha256,
      prerequisite_sha256:plan.prerequisite_sha256,post_upgrade_acl_sha256:plan.post_upgrade_acl_sha256,
      ordered_baseline_applications:candidate.baseline.length,
      unique_baseline_sources:new Set(candidate.baseline.map(row=>row.path)).size,
      upgrade_resources:candidate.upgrades.length,exact_rpc_signatures:plan.rpc_signatures.length,
    },
    archive:{file:EMPTY_SCHEMA_FILES.archive,sha256:emptySchemaSha256(archive),bytes:archive.length},
    qualification:evidence,
  };
  // No output directory exists until both independent factory cleanups returned.
  // mkdir is the exclusive publication claim. A manifest is written last.
  const claimed = await runEmptySchemaStage('PUBLICATION_CLAIM',async () => {
    await fs.mkdir(destination,{mode:0o700});
    return fs.lstat(destination);
  });
  const assertClaim = async () => runEmptySchemaStage('PUBLICATION_IDENTITY',async () => {
    const actual = await fs.lstat(destination);
    if (!actual.isDirectory() || actual.isSymbolicLink() || actual.dev !== claimed.dev || actual.ino !== claimed.ino)
      throw Error('empty_schema_output_identity_changed');
  });
  try {
    await assertClaim();
    await runEmptySchemaStage('PUBLICATION_ARCHIVE_WRITE',() => fs.writeFile(path.join(destination,EMPTY_SCHEMA_FILES.archive),archive,{flag:'wx',mode:0o600}));
    await assertClaim();
    await runEmptySchemaStage('PUBLICATION_ARCHIVE_READBACK',async () => {
      const readback = await fs.readFile(path.join(destination,EMPTY_SCHEMA_FILES.archive));
      if (!readback.equals(archive)) throw Error('empty_schema_output_readback_mismatch');
    });
    await runEmptySchemaStage('PUBLICATION_MANIFEST_WRITE',() => fs.writeFile(path.join(destination,EMPTY_SCHEMA_FILES.manifest),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600}));
    await assertClaim();
    return manifest;
  } catch (error) {
    try {
      await runEmptySchemaStage('PUBLICATION_CLEANUP',async () => {
        await assertClaim();
        await fs.rm(destination,{recursive:true,force:true});
      });
    } catch (cleanup) { throw combineEmptySchemaCleanupFailure(error,cleanup); }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = await runEmptySchemaStage('CLI_ARGUMENTS',() => parseEmptySchemaArguments(process.argv.slice(2)));
    const manifest = await exportReviewedEmptySchema(options);
    console.log(JSON.stringify({event:'reviewed_empty_schema_exported',status:manifest.qualification.status,
      schema_source_head:manifest.schema_source_head,exporter_source_head:manifest.exporter_source_head,
      archive_sha256:manifest.archive.sha256,archive_bytes:manifest.archive.bytes,production_qualified:false,runtime_ready:false}));
  } catch (error) {
    // Never print driver errors, SQL, credentials, local paths or child stderr.
    console.error(JSON.stringify(emptySchemaFailureReceipt(error)));
    process.exitCode = 1;
  }
}
