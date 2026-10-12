import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPostgresUtilityFailure } from './postgres-utility-diagnostic.mjs';

const samples = [
  ['FATAL: password authentication failed for user "SENSITIVE_USER"', 'auth_failed'],
  ['fe_sendauth: no password supplied', 'auth_failed'],
  ['ERROR: permission denied for table SENSITIVE_TABLE', 'permission_denied'],
  ['ERROR: must be superuser to access pg_control_system', 'permission_denied'],
  ['pg_dump: error: query failed: ERROR: query would be affected by row-level security policy', 'row_security_denied'],
  ['connection to server at "127.0.0.1", port 55432 failed: Connection refused', 'connection_refused'],
  ['FATAL: the database system is starting up', 'server_unavailable'],
  ['ERROR: canceling statement due to statement timeout', 'query_timeout'],
  ['FATAL: database "SENSITIVE_DB" does not exist', 'database_missing'],
  ['SENSITIVE_PASSWORD=do-not-store', 'query_failed'],
];
for (const [stderr, expected] of samples) {
  test(`PostgreSQL stderr -> sanitized ${expected} without raw text`, () => {
    for (const operation of ['inspection','backup']) {
      const result = classifyPostgresUtilityFailure(stderr,operation);
      assert.equal(result.code,`postgres_${operation}_${expected}`);
      assert.equal(result.retry_authorized,false);
      assert.equal(result.authority_effect,false);
      assert.equal(result.raw_stderr_retained,false);
      for(const s of ['SENSITIVE_', 'do-not-store','55432','127.0.0.1'])
        assert.equal(JSON.stringify(result).includes(s),false);
    }
  });
}
test('invalid operations are rejected, not coerced into authority',()=>{
  assert.throws(()=>classifyPostgresUtilityFailure('x','execute'),/operation_invalid/);
});
test('oversized, binary, empty and hostile diagnostics stay finite',()=>{
  for(const stderr of ['',Buffer.alloc(2e5,0xff),'x'.repeat(200000),null,{password:'private'}]){
    const result=classifyPostgresUtilityFailure(stderr);
    assert.match(result.code,/^postgres_inspection_[a-z_]+$/);
    assert.ok(JSON.stringify(result).length<320);
  }
});
