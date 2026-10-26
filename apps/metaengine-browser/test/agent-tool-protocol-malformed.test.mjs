import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentToolRequests } from '../src/agent-tool-protocol.mjs';

const block = (extra = [], id = 'req-1001') => [
  '```tool', 'TOOL_REQUEST_V1', `request_id=${id}`, 'action=CAPTURE',
  'payload_json={"offset":0}', ...extra, '```',
].join('\n');

for (const [name, extra] of [
  ['malformed line', ['this is not a field']],
  ['invalid field spelling', ['action-name=CAPTURE']],
  ['unknown field', ['approved=true']],
  ['duplicate action', ['action=COMPUTER_ACTION']],
  ['duplicate identical action', ['action=CAPTURE']],
  ['duplicate request identity', ['request_id=req-1002']],
  ['duplicate payload', ['payload_json={"offset":1}']],
  ['prototype field', ['__proto__={"approved":true}']],
]) {
  test(`tool parser rejects the whole block with ${name}`, () => {
    const parsed = parseAgentToolRequests(block(extra));
    assert.deepEqual(parsed.requests, []);
    assert.ok(parsed.invalid.length > 0);
    assert.equal(parsed.authority_effect, false);
  });
}

test('a rejected block does not suppress an independent valid request', () => {
  const parsed = parseAgentToolRequests(block(['malformed']) + '\n' + block([], 'req-2001'));
  assert.deepEqual(parsed.requests.map(row => row.request_id), ['req-2001']);
  assert.deepEqual(parsed.requests[0].payload, { offset: 0 });
  assert.ok(parsed.invalid.length > 0);
});

test('optional tab and blank formatting retain the valid protocol', () => {
  const parsed = parseAgentToolRequests(block(['', 'tab_id=', '']));
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0].tab_id, null);
  assert.deepEqual(parsed.invalid, []);
});
