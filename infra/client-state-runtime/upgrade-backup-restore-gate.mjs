// Consumer-side gate for a separately executed, physically isolated pg_restore.
// Pure classification only. Caller must independently attest the executor and
// source/target ownership; matching JSON alone is never physical authority.
const SHA=/^[a-f0-9]{64}$/;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const validPort=n=>Number.isSafeInteger(n)&&n>=1024&&n<=65535;
const result=(reason,consistent=false)=>Object.freeze({
  schema:'metaengine.installed-upgrade-restore-gate.v1',
  restore_receipt_consistent:consistent, restore_verified:false,
  physical_restore_proven:false, reason,
  upgrade_authorized:false,automatic_retry_allowed:false,authority_effect:false,
});
export function qualifyIndependentDisposableRestore({receipt,backupReceipt,tocReadback,expected}={}) {
  if(!receipt||receipt.schema!=='metaengine.disposable-pg17.restore-qualification.v1'
    ||receipt.state!=='PASSED')return result('RESTORE_RECEIPT_MISSING_OR_UNQUALIFIED');
  if(!backupReceipt||!expected||!SHA.test(String(expected.qualifiedExecutorSha256||''))
    ||!validPort(expected.sourcePgPort))
    return result('RESTORE_EXPECTED_IDENTITY_INVALID');
  const tableDataEntries=typeof tocReadback==='string'
    ?tocReadback.split(/\r?\n/).filter(line=>/^\d+;/.test(line)&&/ TABLE DATA /.test(line)).length:0;
  if(!tableDataEntries||!positive(backupReceipt.bytes)
    ||!SHA.test(String(backupReceipt.file_sha256||''))
    ||!SHA.test(String(backupReceipt.toc_sha256||'')))
    return result('RESTORE_ARCHIVE_INPUT_INVALID');
  if(receipt.archive_sha256!==backupReceipt.file_sha256
    ||receipt.archive_bytes!==backupReceipt.bytes
    ||receipt.toc_sha256!==backupReceipt.toc_sha256
    ||receipt.source_keeper_pid!==expected.keeperPid
    ||receipt.source_postmaster_sha256!==expected.postmasterSha256
    ||receipt.installed_primary_pid!==expected.ownerPid
    ||receipt.executor_sha256!==expected.qualifiedExecutorSha256)
    return result('RESTORE_SOURCE_BINDING_MISMATCH');
  if(!validPort(receipt.disposable_pg_port)
    ||receipt.disposable_pg_port===expected.sourcePgPort
    ||!positive(receipt.disposable_pg_pid)
    ||receipt.disposable_pg_pid===expected.keeperPid
    ||receipt.disposable_pg_pid===expected.ownerPid
    ||!SHA.test(String(receipt.disposable_postmaster_sha256||''))
    ||receipt.disposable_postmaster_sha256===expected.postmasterSha256)
    return result('RESTORE_DISPOSABLE_TARGET_UNPROVEN');
  if(receipt.disposable_only!==true
    ||receipt.source_connection_attempted!==false
    ||receipt.source_data_modified!==false
    ||receipt.working_profile_modified!==false
    ||receipt.installer_started!==false
    ||receipt.disposable_runtime_isolated!==true
    ||receipt.disposable_postmaster_identity_proven!==true
    ||receipt.pg_restore_exit_on_error!==true
    ||receipt.pg_restore_exit_code!==0
    ||receipt.archive_digest_rechecked_after_restore!==true
    ||receipt.restore_completed!==true
    ||receipt.restore_data_verified!==true
    ||receipt.independent_evaluator!==true
    ||receipt.disposable_cleanup_confirmed!==true
    ||receipt.automatic_retry_allowed!==false
    ||receipt.authority_effect!==false)
    return result('RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE');
  if(!Number.isSafeInteger(receipt.table_data_items_restored)
    ||receipt.table_data_items_restored!==tableDataEntries
    ||!positive(receipt.restored_table_count)
    ||!positive(receipt.verified_nonempty_table_count)
    ||receipt.verified_nonempty_table_count>receipt.restored_table_count
    ||!SHA.test(String(receipt.row_count_digest_sha256||'')))
    return result('RESTORE_DATA_READBACK_INCOMPLETE');
  // These fields are self-asserted unless independently read back from the
  // trusted disposable executor. A coherent JSON receipt is never physical
  // restore proof and can never unlock a production upgrade.
  return result('RESTORE_RECEIPT_CONSISTENT_PHYSICAL_PROOF_REQUIRED',true);
}
