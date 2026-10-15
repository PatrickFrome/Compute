import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_AGENT_ALLOWED_OPS } from '../src/host-agent-protocol.mjs';
import { hostAgentOperationDeadlineMs, HOST_BACKUP_ACL_READ_TIMEOUT_MS,
  NATIVE_BACKUP_ACL_SAMPLE_TIMEOUT_MS } from '../src/host-agent-operation-deadlines.mjs';

test('native ACL envelope covers both independent OS samples without widening other operations',()=>{
  assert.ok(hostAgentOperationDeadlineMs('BACKUP_ACL_READBACK') > 2 * NATIVE_BACKUP_ACL_SAMPLE_TIMEOUT_MS);
  assert.equal(hostAgentOperationDeadlineMs('BACKUP_ACL_READBACK',Infinity),HOST_BACKUP_ACL_READ_TIMEOUT_MS);
  assert.equal(hostAgentOperationDeadlineMs('BACKUP_ACL_READBACK',250),250);
  for (const op of HOST_AGENT_ALLOWED_OPS.filter(op=>op!=='BACKUP_ACL_READBACK')) {
    assert.equal(hostAgentOperationDeadlineMs(op),5000,op);
    assert.equal(hostAgentOperationDeadlineMs(op,Infinity),60000,op);
    assert.equal(hostAgentOperationDeadlineMs(op,-1),100,op);
  }
});
