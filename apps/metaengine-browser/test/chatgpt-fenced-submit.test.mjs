import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitFencedChatGptPrompt } from '../src/chatgpt-fenced-submit.mjs';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const ref = (id) => ({ schema:'metaengine.native-browser.semantic-ref.v1', semantic_ref_id:'semref_' + id.repeat(64) });
const PROMPT = 'Independent critic: review task 19.';
function frame(draft = '', extra = {}) {
  return {
    tab_id:'tab_critic', target_id:'webcontents:91', process_incarnation_id:'process-one', state_revision_id:'rev-' + draft.length,
    url:'https://chatgpt.com/c/critic-session', viewport:{ width:0, height:0 }, authority_effect:false,
    semantic_targets:[
      { role:'textbox', name:'Message ChatGPT', backend_node_id:3, semantic_ref:ref('a'), value_length:draft.length, value_sha256:draft ? sha256(draft) : null },
      ...(draft ? [{ role:'button', name:'Send prompt', backend_node_id:4, semantic_ref:ref('b') }] : []),
    ], ...extra,
  };
}
function harness({ mutate = (row) => row, sendThrows = false, sendOutcome = 'PROVEN_GENERATING', suppressType = false } = {}) {
  let draft = '';
  const commands = [];
  return { commands, executeCommand: async (command) => {
    commands.push(structuredClone(command));
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type,false);
      if (suppressType) return { suppressed:true, reason:'CHATGPT_SERVICE_THROTTLED' };
      draft = command.payload.text;
      return { replace_verified:true, authority_effect:true };
    }
    if (command.action === 'CAPTURE') return mutate(frame(draft));
    if (command.action === 'TYPED_CLICK') {
      assert.equal(command.payload.chatgpt_submit,true);
      assert.equal(command.payload.prompt_sha256,sha256(PROMPT));
      if (sendThrows) throw new Error('transport_lost_after_send');
      return { effect_state:sendOutcome, authority_effect:true, automatic_retry_allowed:false };
    }
    throw new Error('unexpected action');
  } };
}

test('ChatGPT draft type is followed by exact fresh capture and one Send, without foreground geometry or Enter', async () => {
  const h = harness();
  const out = await submitFencedChatGptPrompt({ ...h, tab_id:'tab_critic', frame:frame(), text:PROMPT });
  assert.equal(out.effect_state,'PROVEN_GENERATING');
  assert.deepEqual(h.commands.map((row) => row.action),['SEMANTIC_TYPE','CAPTURE','TYPED_CLICK']);
  assert.equal(h.commands[2].payload.accessible_name,'Send prompt');
});

for (const [label, mutate, reason] of [
  ['target drift', (row) => ({ ...row, target_id:'webcontents:92' }), 'target_binding_mismatch'],
  ['tab drift', (row) => ({ ...row, tab_id:'tab_implementer' }), 'tab_binding_mismatch'],
  ['conversation drift', (row) => ({ ...row, url:'https://chatgpt.com/c/implementer-session' }), 'conversation_drift'],
  ['process drift', (row) => ({ ...row, process_incarnation_id:'process-two' }), 'process_incarnation_drift'],
  ['legacy provider URL', (row) => ({ ...row, url:'https://chat.z.ai/c/legacy' }), 'origin_invalid'],
  ['wrong draft', () => frame('stale draft'), 'typed_draft_not_exact'],
  ['missing draft hash', (row) => ({ ...row, semantic_targets:row.semantic_targets.map((target) => ({ ...target, value_sha256:null })) }), 'typed_draft_not_exact'],
  ['duplicate Send', (row) => ({ ...row, semantic_targets:[...row.semantic_targets,row.semantic_targets[1]] }), 'send_not_unique'],
  ['missing Send ref', (row) => ({ ...row, semantic_targets:row.semantic_targets.map((target) => target.role === 'button' ? { ...target, semantic_ref:null } : target) }), 'send_semantic_ref_required'],
  ['generation starts before Send', (row) => ({ ...row, semantic_targets:[...row.semantic_targets,{ role:'button', name:'Stop generating' }] }), 'generation_already_active'],
]) {
  test(`ChatGPT ${label} blocks Send after typing`, async () => {
    const h = harness({ mutate });
    await assert.rejects(() => submitFencedChatGptPrompt({ ...h, tab_id:'tab_critic', frame:frame(), text:PROMPT }), new RegExp(reason));
    assert.equal(h.commands.filter((row) => row.action === 'TYPED_CLICK').length,0);
  });
}

test('ChatGPT throttled type and a revoked durable lease both block Send', async () => {
  const throttled = harness({ suppressType:true });
  await assert.rejects(() => submitFencedChatGptPrompt({ ...throttled, tab_id:'tab_critic', frame:frame(), text:PROMPT }), /CHATGPT_SERVICE_THROTTLED/);
  assert.equal(throttled.commands.length,1);
  const h = harness();
  await assert.rejects(() => submitFencedChatGptPrompt({ ...h, tab_id:'tab_critic', frame:frame(), text:PROMPT, validateTypedFrame:async () => { throw new Error('lease revoked'); } }), /lease revoked/);
  assert.equal(h.commands.filter((row) => row.action === 'TYPED_CLICK').length,0);
});

test('ChatGPT ambiguous Send never falls back to another click or Enter', async () => {
  const h = harness({ sendThrows:true });
  await assert.rejects(() => submitFencedChatGptPrompt({ ...h, tab_id:'tab_critic', frame:frame(), text:PROMPT }), /transport_lost_after_send/);
  assert.deepEqual(h.commands.map((row) => row.action),['SEMANTIC_TYPE','CAPTURE','TYPED_CLICK']);
});
