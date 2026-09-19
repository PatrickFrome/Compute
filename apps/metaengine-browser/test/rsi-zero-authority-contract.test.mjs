import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RSI_ZERO_AUTHORITY_SCHEMA,
  assertRsiZeroAuthority,
  rsiZeroAuthorityTrustRootSnapshot,
  rsiZeroAuthorityVector,
} from '../src/rsi-zero-authority-contract.mjs';

test('RSI zero-authority vector is explicit for Browser task execution and retry surfaces',()=>{
  const vector=rsiZeroAuthorityVector();
  assert.equal(vector.execution_authority,false);
  assert.equal(vector.browser_authority,false);
  assert.equal(vector.task_authority,false);
  assert.equal(vector.scheduler_authority,false);
  assert.equal(vector.production_mutation_authority,false);
  assert.equal(vector.promotion_authority,false);
  assert.equal(vector.self_update_authority,false);
  assert.equal(vector.automatic_retry_allowed,false);
  assert.equal(vector.authority_effect,false);
  assert.equal(assertRsiZeroAuthority(vector),vector);
});

test('RSI zero-authority contract rejects missing explicit Browser or task authority',()=>{
  const vector={...rsiZeroAuthorityVector()};
  delete vector.browser_authority;
  assert.throws(()=>assertRsiZeroAuthority(vector,{error_prefix:'rsi_zero_authority_test'}),/browser_authority_invalid/);
  const task={...rsiZeroAuthorityVector()};
  delete task.task_authority;
  assert.throws(()=>assertRsiZeroAuthority(task,{error_prefix:'rsi_zero_authority_test'}),/task_authority_invalid/);
});

test('RSI zero-authority contract rejects retry and optional authority escalation',()=>{
  assert.throws(()=>assertRsiZeroAuthority({...rsiZeroAuthorityVector(),automatic_retry_allowed:true},{error_prefix:'rsi_zero_authority_test'}),/retry_invalid/);
  assert.throws(()=>assertRsiZeroAuthority({...rsiZeroAuthorityVector(),signing_authority:true},{error_prefix:'rsi_zero_authority_test'}),/signing_authority_invalid/);
  assert.throws(()=>assertRsiZeroAuthority({...rsiZeroAuthorityVector(),direct_tool_execution_authority:true},{error_prefix:'rsi_zero_authority_test'}),/direct_tool_execution_authority_invalid/);
});

test('RSI zero-authority trust root freezes explicit non-authority semantics',()=>{
  const root=rsiZeroAuthorityTrustRootSnapshot();
  assert.equal(root.contract_schema,RSI_ZERO_AUTHORITY_SCHEMA);
  assert.equal(root.automatic_retry_allowed,false);
  assert.equal(root.browser_authority_must_be_explicit,false);
  assert.equal(root.task_authority_must_be_explicit,false);
  assert.equal(root.implicit_missing_authority_is_not_zero,true);
  assert.ok(root.required_false_fields.includes('browser_authority'));
  assert.ok(root.required_false_fields.includes('task_authority'));
});
