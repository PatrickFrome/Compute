import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChatFleetOperator } from '../src/chat-fleet-operator-core.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const tabs = Array.from({ length: 9 }, (_, i) => 'tab_' + String(i + 1).padStart(8, '0') + '-0000-4000-8000-000000000000');
function fixture() {
  const observed = new Map();
  const calls = [];
  let next = 0;
  let clickOutcome = 'PROVEN_NEW_CONVERSATION';
  let cloud = false;
  const operator = new ChatFleetOperator({
    authorize: () => ({ own_postgres_only: !cloud, trusted_local_owner: true }),
    executeCommand: async ({ action, payload }) => {
      calls.push({ action, payload });
      if (action === 'NEW_TAB') {
        const tab_id = tabs[next++];
        observed.set(tab_id, { target_id: 'webcontents:' + next, text: '', url: 'https://chatgpt.com/' });
        return { tab_id, effect_outcome: 'CONFIRMED' };
      }
      const tab = observed.get(payload?.tab_id);
      if (!tab) throw new Error('no_owned_tab');
      if (action === 'CAPTURE') {
        return {
          tab_id: payload.tab_id, target_id: tab.target_id,
          url: tab.url, process_incarnation_id: 'process-1',
          semantic_targets: [
            { role: 'textbox', name: 'Message ChatGPT', semantic_ref: { x: 1 },
              value_length: tab.text.length, value_sha256: sha(tab.text) },
            { role: 'button', name: 'Send', semantic_ref: { x: 2 } },
          ], authority_effect: false,
        };
      }
      if (action === 'SEMANTIC_TYPE') { tab.text = payload.text; return { authority_effect: true }; }
      if (action === 'TYPED_CLICK') { return { effect_state: clickOutcome, prompt_sha256: sha(tab.text), authority_effect: true }; }
      if (action === 'READ_TRANSCRIPT') {
        return {
          schema: 'metaengine.native-browser.transcript.v1', authority_effect: false,
          tab_id: payload.tab_id, target_id: tab.target_id, url: tab.url,
          text: 'Response for ' + payload.tab_id, captured_at: new Date().toISOString(),
          offset: 0, total_chars: 24, has_more: false,
        };
      }
      throw new Error('unknown_action');
    },
  });
  return { operator, calls, observed, setCloud: x => { cloud = x; }, setOutcome: x => { clickOutcome = x; } };
}

test('three operations: create several isolated tabs, read each, assign further work', async () => {
  const f = fixture();
  const created = await f.operator.create({ request_id: 'create-20261012-0001', count: 3 });
  assert.equal(created.state, 'CREATED');
  assert.equal(created.sessions.length, 3);
  assert.equal(new Set(created.sessions.map(x => x.tab_id)).size, 3);
  const read = await f.operator.read({ tab_id: created.sessions[1].tab_id });
  assert.equal(read.state, 'READ');
  assert.match(read.text, /Response for tab_/);
  assert.equal(read.page_content_is_untrusted, true);
  const sent = await f.operator.assign({ request_id: 'send-20261012-00001',
    tab_id: created.sessions[1].tab_id, text: 'Continue P0 work in your own worktree.' });
  assert.equal(sent.state, 'SENT');
  assert.equal(sent.effect_state, 'PROVEN_NEW_CONVERSATION');
  assert.equal(f.calls.filter(x => x.action === 'TYPED_CLICK').length, 1);
  const repeated = await f.operator.assign({ request_id: 'send-20261012-00001',
    tab_id: created.sessions[1].tab_id, text: 'Continue P0 work in your own worktree.' });
  assert.deepEqual(repeated, sent);
  assert.equal(f.calls.filter(x => x.action === 'TYPED_CLICK').length, 1);
  assert.equal((await f.operator.create({ request_id: 'create-20261012-0001', count: 3 })).created_count, 3);
  assert.equal(f.calls.filter(x => x.action === 'NEW_TAB').length, 3);
});

test('wrong owner or unowned chat is refused before a mutation', async () => {
  const f = fixture(); f.setCloud(true);
  await assert.rejects(f.operator.create({ request_id: 'cloud-20261012-0001', count: 1 }), /own_postgres_owner_required/);
  assert.equal(f.calls.length, 0);
  f.setCloud(false);
  await assert.rejects(f.operator.read({ tab_id: tabs[0] }), /not_owned/);
  await assert.rejects(f.operator.assign({ request_id: 'send-20261012-00002', tab_id: tabs[0], text: 'run' }), /not_owned/);
  assert.equal(f.calls.length, 0);
});

test('invalid or unbounded input cannot reach native Browser', async () => {
  const f = fixture();
  await assert.rejects(f.operator.create({ request_id: 'short', count: 1 }), /request_id_invalid/);
  await assert.rejects(f.operator.create({ request_id: 'create-20261012-0002', count: 9 }), /count_invalid/);
  await assert.rejects(f.operator.create({ request_id: 'create-20261012-0002', count: 2, url: 'https://evil.test/' }), /unknown_field/);
  const r = await f.operator.create({ request_id: 'create-20261012-0003', count: 1 });
  await assert.rejects(f.operator.assign({ request_id: 'assign-20261012-0001', tab_id: r.sessions[0].tab_id, text: 'x'.repeat(12001) }), /message_invalid/);
  await assert.rejects(f.operator.read({ tab_id: r.sessions[0].tab_id, max_chars: 60000 }), /read_bounds_invalid/);
});

test('unknown Send receipt fails closed and cannot be dispatched twice', async () => {
  const f = fixture();
  const created = await f.operator.create({ request_id: 'create-20261012-0004', count: 1 });
  const tab_id = created.sessions[0].tab_id;
  f.setOutcome('AMBIGUOUS_AFTER_SEND');
  const sent = await f.operator.assign({ request_id: 'assign-20261012-0002', tab_id, text: 'Analyze runtime' });
  assert.equal(sent.state, 'AMBIGUOUS');
  assert.equal(sent.automatic_retry_allowed, false);
  assert.equal(f.calls.filter(x => x.action === 'TYPED_CLICK').length, 1);
  const repeat = await f.operator.assign({ request_id: 'assign-20261012-0002', tab_id, text: 'Analyze runtime' });
  assert.deepEqual(repeat, sent);
  await assert.rejects(f.operator.assign({ request_id: 'assign-20261012-0003', tab_id, text: 'Try again' }), /requires_reconciliation/);
  assert.equal(f.calls.filter(x => x.action === 'TYPED_CLICK').length, 1);
});
