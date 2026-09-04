import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-store.cpp'), 'utf8');
const header = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-store.hpp'), 'utf8');
const source = `${header}\n${cpp}`;

test('durable owner store uses bounded same-directory stage -> flush -> fail-if-exists move -> readback', () => {
  for (const token of [
    'CREATE_NEW',
    'FILE_FLAG_WRITE_THROUGH',
    'FlushFileBuffers',
    'MoveFileExW',
    'MOVEFILE_WRITE_THROUGH',
    'GetFinalPathNameByHandleW',
    'GetSecurityInfo',
    'FILE_ATTRIBUTE_REPARSE_POINT',
    'OWNER_STORE_CREATE_IF_ABSENT_COMMITTED',
  ]) assert.match(source, new RegExp(token), `${token} missing`);

  assert.doesNotMatch(source, /MOVEFILE_REPLACE_EXISTING|ReplaceFileW|CreateFileTransactedW|CommitTransaction/);
});

test('machine store ACL allowlists write authority to SYSTEM and Administrators only', () => {
  assert.match(cpp, /FOLDERID_ProgramData/);
  assert.match(cpp, /METAENGINE\\\\Guardian/);
  assert.match(cpp, /WinLocalSystemSid/);
  assert.match(cpp, /WinBuiltinAdministratorsSid/);
  assert.match(cpp, /FILE_DELETE_CHILD/);
  assert.match(cpp, /\(ace->Mask & kForbiddenWrite\) != 0 && !machineOwner\(sid\)/);
  assert.match(cpp, /header->AceType != ACCESS_ALLOWED_ACE_TYPE\) return false/);
  assert.doesNotMatch(cpp, /WinWorldSid|WinBuiltinUsersSid|WinAuthenticatedUserSid/);
  assert.match(cpp, /"non_machine_write_acl_forbidden\\":true/);
  assert.match(cpp, /D:P\(A;;FA;;;SY\)\(A;;FA;;;BA\)/);
});

test('durable record binds SID and immutable evidence hashes, never transient session id', () => {
  const recordStruct = header.match(/struct OwnerEnrollmentDurableRecord \{([\s\S]*?)\};/)?.[1] || '';
  const serializer = cpp.match(/std::string serializeRecord\([\s\S]*?\n\}/)?.[0] || '';
  for (const field of [
    'expected_owner_sid',
    'enrollment_evidence_sha256',
    'device_key_fingerprint_sha256',
  ]) {
    assert.match(recordStruct, new RegExp(field));
    assert.match(serializer, new RegExp(field));
  }
  assert.doesNotMatch(recordStruct, /token_session_id|session_id/);
  assert.doesNotMatch(serializer, /token_session_id|session_id/);
  assert.match(cpp, /"token_session_id_persisted\\":false/);
});

test('store cannot become WTS, process, SCM, scheduler, retry, or Browser authority', () => {
  assert.doesNotMatch(source, /WTSQueryUserToken|CreateProcessAsUserW|CreateProcessWithTokenW|StartServiceW|ChangeServiceConfigW/);
  assert.doesNotMatch(source, /SetTimer|CreateTimerQueueTimer|sleep_for|Sleep\s*\(/);
  for (const fragment of [
    '"owner_replacement_allowed\\":false',
    '"journal_mutation_allowed\\":false',
    '"wts_execution_allowed\\":false',
    '"process_effect_allowed\\":false',
    '"scm_effect_allowed\\":false',
    '"browser_authority\\":false',
    '"scheduler_authority\\":false',
    '"automatic_retry_allowed\\":false',
    '"second_scheduler_loop\\":false',
    '"authority_effect\\":false',
  ]) assert.ok(cpp.includes(fragment), `${fragment} missing`);
});

test('existing record is classified; no overwrite/replacement path exists', () => {
  assert.ok(cpp.includes('error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS'));
  assert.match(cpp, /OWNER_STORE_OWNER_MISMATCH/);
  assert.match(cpp, /OWNER_STORE_OWNER_EXACT_DIFFERENT_PROVENANCE/);
  assert.match(cpp, /readback\.exact && readback\.provenance_exact/);
  assert.match(cpp, /OWNER_STORE_POST_COMMIT_READBACK_MISMATCH/);
  assert.doesNotMatch(cpp, /DeleteFileW\(final\.c_str\(\)\)|MoveFileExW\([^\n]*MOVEFILE_REPLACE_EXISTING/);
});

test('stage cleanup happens after the exclusive file handle leaves scope', () => {
  const create = cpp.match(/DWORD stageError = ERROR_SUCCESS;([\s\S]*?)if \(!MoveFileExW/)?.[1] || '';
  const scopeEnd = create.indexOf('\n    }\n    if (!out.staging_flushed)');
  const cleanup = create.indexOf('DeleteFileW(stage.c_str())');
  assert.ok(scopeEnd >= 0, 'stage handle scope boundary missing');
  assert.ok(cleanup > scopeEnd, 'stage cleanup must happen after handle destruction');
  assert.match(create, /ERROR_HANDLE_EOF|ERROR_WRITE_FAULT/);
});
