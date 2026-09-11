import assert from 'node:assert/strict';
import test from 'node:test';
import { FastControlGatewayCore, fastControlToolManifest } from '../src/fast-control-gateway-core.mjs';

function gateway() {
  const calls = [];
  return {
    calls,
    instance: new FastControlGatewayCore({
      contextGet: async () => ({ authority_effect: false }),
      devQuery: async (input) => { calls.push(input); return { status: 'OK', hits: [], authority_effect: false }; },
      issueBatch: async () => ({ authority_effect: false }),
      resultDelta: async () => ({ authority_effect: false }),
      issueEmergency: async () => ({ authority_effect: false }),
    }),
  };
}

test('dev_query advertises schema-bounded validation with no full input serialization', () => {
  const manifest = fastControlToolManifest();
  assert.equal(manifest.dev_query_schema_bounded_input, true);
  assert.equal(manifest.dev_query_full_input_serialization, false);
  assert.equal(manifest.command_leasing_authority, false);
  assert.equal(manifest.authority_effect, false);
});

test('warm dev_query path does not JSON.stringify the whole request before dispatch', async () => {
  const h = gateway();
  const input = {
    query: 'warm cache next action',
    kinds: ['SOURCE', 'CI'],
    limit: 4,
    if_none_match: 'dq:cached',
    max_bytes: 4096,
  };
  Object.defineProperty(input, 'toJSON', {
    enumerable: false,
    value() { throw new Error('whole_request_serialized'); },
  });

  const result = await h.instance.invoke('dev_query', input);
  assert.equal(result.indexed_read_only, true);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], {
    query: 'warm cache next action',
    kinds: ['SOURCE', 'CI'],
    limit: 4,
    if_none_match: 'dq:cached',
    max_bytes: 4096,
    authority_effect: false,
  });
});

test('schema-bounded path fails closed on fields that could bypass the removed generic byte guard', async () => {
  const h = gateway();
  await assert.rejects(
    () => h.instance.invoke('dev_query', { query: 'x', if_none_match: 'q'.repeat(97) }),
    /if_none_match_invalid/,
  );
  await assert.rejects(
    () => h.instance.invoke('dev_query', { query: 123 }),
    /dev_query_invalid/,
  );
  await assert.rejects(
    () => h.instance.invoke('dev_query', { query: 'x', kinds: ['SOURCE', 123] }),
    /dev_query_kinds_invalid/,
  );
  await assert.rejects(
    () => h.instance.invoke('dev_query', { query: 'x', unknown: 'x'.repeat(100_000) }),
    /dev_query_field_unknown/,
  );
  assert.equal(h.calls.length, 0);
});
