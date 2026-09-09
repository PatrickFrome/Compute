import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_RESULT_BATCH_MAX_JSON_CHARS,
  assertNativeSupervisorBatchCompletion,
  partitionNativeSupervisorBatchResults,
} from '../src/native-supervisor-result-batch.mjs';

const IDS = Object.freeze([
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
]);

function result(commandId, payloadChars = 140_000) {
  return {
    command_id: commandId,
    ok: true,
    receipt: {
      schema: 'metaengine.native-browser-command-receipt.v1',
      result: { snapshot: { padding: 'x'.repeat(payloadChars) } },
      authority_effect: false,
    },
    error: null,
    authority_effect: false,
  };
}

function completion(chunk) {
  return {
    schema: 'metaengine.native-browser-supervisor.complete-batch.v1',
    results: chunk.map((row) => ({
      command_id: row.command_id,
      accepted: true,
      status: 'COMPLETED',
      authority_effect: false,
    })),
    authority_effect: false,
  };
}

test('four live-sized POLL receipts are delivered in bounded chunks without changing execution membership', () => {
  const rows = IDS.map((id) => result(id));
  assert.ok(JSON.stringify(rows).length > 524_288, 'fixture must reproduce the production overflow');

  const chunks = partitionNativeSupervisorBatchResults(rows);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 1]);
  assert.deepEqual(chunks.flat().map((row) => row.command_id), IDS);
  for (const chunk of chunks) {
    assert.ok(JSON.stringify(chunk).length <= NATIVE_SUPERVISOR_RESULT_BATCH_MAX_JSON_CHARS);
  }
  assert.equal(rows[0].receipt.result.snapshot.padding.length, 140_000);
});

test('one receipt larger than the transport envelope fails closed instead of truncating evidence', () => {
  assert.throws(
    () => partitionNativeSupervisorBatchResults([result(IDS[0], 500_000)]),
    /native_supervisor_batch_result_item_too_large/,
  );
});

test('completion acknowledgement requires exact accepted terminal rows', () => {
  const chunk = [result(IDS[0], 100), result(IDS[1], 100)];
  const ack = assertNativeSupervisorBatchCompletion(completion(chunk), chunk);
  assert.deepEqual(ack.map((row) => row.command_id), IDS.slice(0, 2));
  assert.deepEqual(ack.map((row) => row.status), ['COMPLETED', 'COMPLETED']);

  const rejected = completion(chunk);
  rejected.results[1].accepted = false;
  assert.throws(
    () => assertNativeSupervisorBatchCompletion(rejected, chunk),
    /native_supervisor_batch_completion_not_accepted/,
  );
});

test('completion acknowledgement rejects missing, duplicate, drifted and authority-bearing evidence', () => {
  const chunk = [result(IDS[0], 100), result(IDS[1], 100)];

  const missing = completion(chunk);
  missing.results.pop();
  assert.throws(
    () => assertNativeSupervisorBatchCompletion(missing, chunk),
    /cardinality_mismatch/,
  );

  const duplicate = completion(chunk);
  duplicate.results[1].command_id = IDS[0];
  assert.throws(
    () => assertNativeSupervisorBatchCompletion(duplicate, chunk),
    /identity_mismatch/,
  );

  const drifted = completion(chunk);
  drifted.results[1].command_id = IDS[2];
  assert.throws(
    () => assertNativeSupervisorBatchCompletion(drifted, chunk),
    /identity_mismatch/,
  );

  const authoritative = completion(chunk);
  authoritative.authority_effect = true;
  assert.throws(
    () => assertNativeSupervisorBatchCompletion(authoritative, chunk),
    /completion_invalid/,
  );
});

test('partitioning rejects duplicate command ids and preserves no retry or execution surface', () => {
  assert.throws(
    () => partitionNativeSupervisorBatchResults([result(IDS[0], 100), result(IDS[0], 100)]),
    /duplicate_command/,
  );
  const source = partitionNativeSupervisorBatchResults.toString();
  assert.doesNotMatch(source, /fetch|executeCommand|retry|setTimeout|setInterval/);
});
