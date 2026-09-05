import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-store.cpp'), 'utf8');
const header = fs.readFileSync(path.join(root, 'native/browser-guardian-scm/browser-guardian-owner-enrollment-store.hpp'), 'utf8');
const source = `${header}\n${cpp}`;

test('durable owner store uses bounded same-directory stage -> flush -> source-handle fail-if-exists rename -> readback', () => {
  for (const token of [
    'CREATE_NEW',
    'FILE_FLAG_WRITE_THROUGH',
    'FlushFileBuffers',
    'SetFileInformationByHandle',
    'FileRenameInfo',
    'ReplaceIfExists = FALSE',
    'GetFinalPathNameByHandleW',
    'GetSecurityInfo',
    'FILE_ATTRIBUTE_REPARSE_POINT',
    'OWNER_STORE_CREATE_IF_ABSENT_COMMITTED',
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${token} missing`);

  assert.doesNotMatch(source, /MOVEFILE_REPLACE_EXISTING|ReplaceFileW|CreateFileTransactedW|CommitTransaction|MoveFileExW/);
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

test('absolute target ancestor chain is held without delete sharing across the create-if-absent commit boundary', () => {
  const opener = cpp.match(/Handle openDirectoryFence\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(opener, /FILE_SHARE_READ \| FILE_SHARE_WRITE/);
  assert.doesNotMatch(opener, /FILE_SHARE_DELETE/);

  const fence = cpp.match(/RootFence openSecureRootFence\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(fence, /fence\.program_data = openDirectoryFence\(pd\)/);
  assert.match(fence, /fence\.metaengine = openDirectoryFence\(metaengine\)/);
  assert.match(fence, /fence\.root = openDirectoryFence\(actual, extraAccess, true\)/);
  assert.match(cpp, /"root_delete_share_fenced\\":true/);
  assert.match(cpp, /"ancestor_delete_share_fenced\\":true/);
  assert.match(cpp, /"absolute_target_ancestor_chain_fenced\\":true/);
  assert.match(cpp, /"commit_under_fenced_root\\":true/);

  const create = cpp.match(/OwnerEnrollmentStoreResult OwnerEnrollmentStore::createIfAbsent\([\s\S]*?\n\}/)?.[0] || '';
  const guard = create.indexOf('RootFence rootFence = openSecureRootFence');
  const before = create.indexOf('const auto before = classify');
  const rename = create.indexOf('renameUnderFencedRootFailIfExists');
  const readback = create.indexOf('auto readback = classify');
  assert.ok(guard >= 0, 'trusted absolute-target ancestor fence missing');
  assert.ok(before > guard, 'ancestor fence must precede absence classification');
  assert.ok(rename > before, 'source-handle rename must follow absence classification');
  assert.ok(readback > rename, 'ancestor fence must remain in scope through exact readback');
});

test('commit renames the exclusive source handle under the fenced root and never replaces an existing winner', () => {
  const rename = cpp.match(/bool renameUnderFencedRootFailIfExists\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(rename, /const std::wstring target = fullPath\(absolute_name\)/);
  assert.match(rename, /info->ReplaceIfExists = FALSE/);
  assert.match(rename, /info->RootDirectory = nullptr/);
  assert.match(rename, /SetFileInformationByHandle\(file, FileRenameInfo/);
  assert.match(cpp, /"commit_source_handle_rename\\":true/);
  assert.match(cpp, /"commit_handle_relative_rename\\":false/);
  assert.doesNotMatch(rename, /ReplaceIfExists = TRUE/);
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
  assert.ok(cpp.includes('commitError == ERROR_ALREADY_EXISTS || commitError == ERROR_FILE_EXISTS'));
  assert.match(cpp, /OWNER_STORE_OWNER_MISMATCH/);
  assert.match(cpp, /OWNER_STORE_OWNER_EXACT_DIFFERENT_PROVENANCE/);
  assert.match(cpp, /readback\.exact && readback\.provenance_exact/);
  assert.match(cpp, /OWNER_STORE_POST_COMMIT_READBACK_MISMATCH/);
  assert.doesNotMatch(cpp, /DeleteFileW\(final\.c_str\(\)\)|ReplaceIfExists = TRUE/);
});

test('stage cleanup happens only after the exclusive stage handle leaves scope', () => {
  const create = cpp.match(/DWORD stageError = ERROR_SUCCESS;([\s\S]*?)auto readback = classify/)?.[1] || '';
  const normalizedCreate = create.replace(/\r\n/g, '\n');
  const handleStart = normalizedCreate.indexOf('Handle h(CreateFileW');
  const scopeClose = normalizedCreate.indexOf('}\n    if (!out.staging_flushed)');
  const cleanup = normalizedCreate.indexOf('DeleteFileW(stage.c_str())');
  assert.ok(handleStart >= 0, 'exclusive stage handle missing');
  assert.ok(scopeClose > handleStart, 'stage handle scope must close before cleanup');
  assert.ok(cleanup > scopeClose, 'DeleteFileW must execute only after stage handle closes');
  assert.match(normalizedCreate, /ERROR_WRITE_FAULT/);
});
