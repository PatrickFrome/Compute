import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-store.cpp'), 'utf8');
const header = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-store.hpp'), 'utf8');
const source = `${header}\n${cpp}`;

function between(text, start, end) {
  const normalized = text.replace(/\r\n/g, '\n');
  const from = normalized.indexOf(start);
  assert.ok(from >= 0, `${start} missing`);
  const to = normalized.indexOf(end, from + start.length);
  assert.ok(to > from, `${end} missing after ${start}`);
  return normalized.slice(from, to);
}

test('durable owner store uses stage -> flush -> fail-if-exists source-handle rename -> readback', () => {
  for (const token of [
    'CREATE_NEW', 'FILE_FLAG_WRITE_THROUGH', 'FlushFileBuffers', 'SetFileInformationByHandle',
    'FileRenameInfo', 'ReplaceIfExists = FALSE', 'GetFinalPathNameByHandleW', 'GetSecurityInfo',
    'FILE_ATTRIBUTE_REPARSE_POINT', 'OWNER_STORE_CREATE_IF_ABSENT_COMMITTED',
  ]) assert.ok(source.includes(token), `${token} missing`);
  assert.doesNotMatch(source, /MOVEFILE_REPLACE_EXISTING|ReplaceFileW|CreateFileTransactedW|CommitTransaction|MoveFileExW/);
});

test('machine store ACL allowlists write authority to SYSTEM and Administrators only', () => {
  for (const token of [
    'FOLDERID_ProgramData', 'WinLocalSystemSid', 'WinBuiltinAdministratorsSid', 'FILE_DELETE_CHILD',
    'D:P(A;;FA;;;SY)(A;;FA;;;BA)', 'non_machine_write_acl_forbidden',
  ]) assert.ok(cpp.includes(token), `${token} missing`);
  assert.match(cpp, /\(ace->Mask & kForbiddenWrite\) != 0 && !machineOwner\(sid\)/);
  assert.match(cpp, /header->AceType != ACCESS_ALLOWED_ACE_TYPE\) return false/);
  assert.doesNotMatch(cpp, /WinWorldSid|WinBuiltinUsersSid|WinAuthenticatedUserSid/);
});

test('absolute commit target keeps ProgramData, METAENGINE, and Guardian identities fenced', () => {
  const fence = between(cpp, 'RootFence openSecureRootFence(', '\n\nbool hash64');
  assert.ok(fence.includes('fence.program_data = openDirectoryFence(pd)'));
  assert.ok(fence.includes('fence.metaengine = openDirectoryFence(metaengine)'));
  assert.ok(fence.includes('fence.root = openDirectoryFence(actual, extraAccess, true)'));
  const opener = between(cpp, 'Handle openDirectoryFence(', '\nRootFence openSecureRootFence');
  assert.ok(opener.includes('FILE_SHARE_READ | FILE_SHARE_WRITE'));
  assert.ok(!opener.includes('FILE_SHARE_DELETE'));
  for (const field of ['root_delete_share_fenced', 'ancestor_delete_share_fenced', 'absolute_target_ancestor_chain_fenced', 'commit_under_fenced_root']) {
    assert.ok(cpp.includes(field), `${field} missing`);
  }

  const create = between(cpp, 'OwnerEnrollmentStoreResult OwnerEnrollmentStore::createIfAbsent(', '\nstd::wstring browserGuardianOwnerEnrollmentStoreDefaultRoot()');
  const guard = create.indexOf('RootFence rootFence = openSecureRootFence');
  const before = create.indexOf('const auto before = classify');
  const rename = create.indexOf('renameUnderFencedRootFailIfExists');
  const failedReadback = create.indexOf('auto failureReadback = classify');
  const successReadback = create.indexOf('auto readback = classify');
  assert.ok(guard >= 0, 'trusted absolute-target ancestor fence missing');
  assert.ok(before > guard, 'ancestor fence must precede absence classification');
  assert.ok(rename > before, 'source-handle rename must follow absence classification');
  assert.ok(failedReadback > rename, 'failed commit barrier must be reconciled under the same fence');
  assert.ok(successReadback > failedReadback, 'ancestor fence must remain in scope through successful exact readback');
});

test('rename is fail-if-exists and source-handle bound', () => {
  const rename = between(cpp, 'bool renameUnderFencedRootFailIfExists(', '\n\n}  // namespace');
  assert.ok(rename.includes('const std::wstring target = fullPath(absolute_name)'));
  assert.ok(rename.includes('info->ReplaceIfExists = FALSE'));
  assert.ok(rename.includes('info->RootDirectory = nullptr'));
  assert.ok(rename.includes('SetFileInformationByHandle(file, FileRenameInfo'));
  assert.ok(!rename.includes('ReplaceIfExists = TRUE'));
  assert.ok(cpp.includes('commit_source_handle_rename'));
  assert.ok(cpp.includes('commit_handle_relative_rename'));
});

test('durable record binds owner SID and immutable provenance but not transient session id', () => {
  const record = between(header, 'struct OwnerEnrollmentDurableRecord {', '\n};');
  const serializer = between(cpp, 'std::string serializeRecord(', '\nbool line(');
  for (const field of ['expected_owner_sid', 'enrollment_evidence_sha256', 'device_key_fingerprint_sha256']) {
    assert.ok(record.includes(field), `${field} missing from durable record`);
    assert.ok(serializer.includes(field), `${field} missing from serializer`);
  }
  assert.doesNotMatch(record, /token_session_id|session_id/);
  assert.doesNotMatch(serializer, /token_session_id|session_id/);
  assert.ok(cpp.includes('token_session_id_persisted'));
});

test('store exposes the common five-state durable-effect outcome algebra', () => {
  const outcome = between(header, 'enum class OwnerEnrollmentStoreOutcome', '\n};');
  for (const token of ['NoEffectProven', 'EffectExact', 'Conflict', 'Corrupt', 'Ambiguous']) {
    assert.ok(outcome.includes(token), `${token} outcome missing`);
  }
  for (const wire of ['NO_EFFECT_PROVEN', 'EFFECT_EXACT', 'CONFLICT', 'CORRUPT', 'AMBIGUOUS']) {
    assert.ok(cpp.includes(`return "${wire}"`), `${wire} wire outcome missing`);
  }
  assert.ok(header.includes('DWORD commit_win32_error = ERROR_SUCCESS'));
  assert.ok(cpp.includes('effect_outcome_algebra'));
});

test('store remains effect-poor and never gains retry/scheduler/process authority', () => {
  assert.doesNotMatch(source, /WTSQueryUserToken|CreateProcessAsUserW|CreateProcessWithTokenW|StartServiceW|ChangeServiceConfigW/);
  assert.doesNotMatch(source, /SetTimer|CreateTimerQueueTimer|sleep_for|Sleep\s*\(/);
  for (const field of [
    'owner_replacement_allowed', 'journal_mutation_allowed', 'wts_execution_allowed', 'process_effect_allowed',
    'scm_effect_allowed', 'browser_authority', 'scheduler_authority', 'automatic_retry_allowed',
    'commit_unknown_result_automatic_retry_allowed', 'second_scheduler_loop', 'authority_effect',
  ]) assert.ok(cpp.includes(field), `${field} contract field missing`);
});

test('every failed physical commit barrier is reconciled by fresh durable readback', () => {
  const create = between(cpp, 'OwnerEnrollmentStoreResult OwnerEnrollmentStore::createIfAbsent(', '\nstd::wstring browserGuardianOwnerEnrollmentStoreDefaultRoot()');
  const failed = between(create, 'if (!renameCommitted) {', '\n    auto readback = classify');
  for (const token of [
    'auto failureReadback = classify(root_path_, final, &normalized)',
    'failureReadback.commit_win32_error = commitError',
    'OwnerEnrollmentStoreOutcome::NoEffectProven', 'OWNER_STORE_COMMIT_NO_EFFECT_PROVEN',
    'OwnerEnrollmentStoreOutcome::EffectExact', 'OWNER_STORE_COMMIT_RESULT_EXACT_AFTER_ERROR',
    'OwnerEnrollmentStoreOutcome::Conflict', 'OwnerEnrollmentStoreOutcome::Corrupt',
    'OwnerEnrollmentStoreOutcome::Ambiguous', 'OWNER_STORE_COMMIT_RESULT_AMBIGUOUS',
  ]) assert.ok(failed.includes(token), `${token} missing from failed-commit reconciliation`);
  assert.ok(!failed.includes('commitError == ERROR_ALREADY_EXISTS'));
  assert.ok(!failed.includes('commitError == ERROR_FILE_EXISTS'));
  assert.ok(!failed.includes('OWNER_STORE_COMMIT_RENAME_FAILED'));
  assert.ok(cpp.includes('commit_failure_readback_required'));
  assert.ok(cpp.includes('ambiguous_commit_outcome_fail_closed'));
});

test('exact durable state after an errored commit never claims this invocation committed', () => {
  const create = between(cpp, 'OwnerEnrollmentStoreResult OwnerEnrollmentStore::createIfAbsent(', '\nstd::wstring browserGuardianOwnerEnrollmentStoreDefaultRoot()');
  const exact = between(create, 'if (failureReadback.outcome == OwnerEnrollmentStoreOutcome::EffectExact) {', '\n        if (failureReadback.outcome == OwnerEnrollmentStoreOutcome::Conflict');
  assert.ok(exact.includes('failureReadback.committed = false'));
  assert.ok(exact.includes('OWNER_STORE_COMMIT_RESULT_EXACT_AFTER_ERROR'));
});

test('successful rename still requires exact durable readback before committed=true', () => {
  assert.ok(cpp.includes('readback.committed = readback.outcome == OwnerEnrollmentStoreOutcome::EffectExact'));
  assert.ok(cpp.includes('&& readback.exact && readback.provenance_exact'));
  assert.ok(cpp.includes('OWNER_STORE_POST_COMMIT_READBACK_MISMATCH'));
  assert.doesNotMatch(cpp, /DeleteFileW\(final\.c_str\(\)\)|ReplaceIfExists = TRUE/);
});

test('stage cleanup occurs only after the exclusive stage handle leaves scope', () => {
  const create = between(cpp, 'OwnerEnrollmentStoreResult OwnerEnrollmentStore::createIfAbsent(', '\nstd::wstring browserGuardianOwnerEnrollmentStoreDefaultRoot()');
  const handleStart = create.indexOf('Handle h(CreateFileW');
  const scopeClose = create.indexOf('}\n    if (!out.staging_flushed)');
  const cleanup = create.indexOf('DeleteFileW(stage.c_str())');
  assert.ok(handleStart >= 0, 'exclusive stage handle missing');
  assert.ok(scopeClose > handleStart, 'stage handle scope must close before cleanup');
  assert.ok(cleanup > scopeClose, 'stage cleanup must execute after handle close');
  assert.ok(create.includes('ERROR_WRITE_FAULT'));
});
