import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = name => fs.readFileSync(new URL(`../apps/metaengine-browser/src/${name}`, import.meta.url), 'utf8');
const cycle = read('devos-native-task-cycle.mjs');
const core = read('devos-native-task-cycle-core.mjs');
const bridge = read('fleet-runtime-bridge.mjs');
const fleet = read('fleet-provisioner.mjs');
const submit = read('chatgpt-fenced-submit.mjs');
const readiness = read('fleet-submit-readiness.mjs');

assert.doesNotMatch(cycle, /setInterval\s*\(|setTimeout\s*\(/, 'second_scheduler_loop_detected');
for (const source of [cycle, bridge, fleet]) {
  assert.match(source, /PRECONVERSATION_ROOT/, 'preconversation_contract_missing');
  assert.doesNotMatch(source, /\beval\s*\(/, 'arbitrary_eval_surface_detected');
}
assert.match(cycle, /bound_unverified_dispatch_allowed:\s*false/, 'bound_unverified_dispatch_fence_missing');
for (const source of [cycle, bridge]) assert.match(source, /UPGRADED_CONVERSATION/, 'canonical_upgrade_gate_missing');
for (const source of [cycle, core]) assert.match(source, /await submitFencedChatGptPrompt\(/, 'fenced_chatgpt_dispatch_missing');
for (const source of [cycle, core, submit]) {
  assert.doesNotMatch(source, /submit_after_type:\s*true/, 'single_phase_submit_resurrected');
  assert.doesNotMatch(source, /ENTER_KEY_EVENT_DRIVEN_READBACK/, 'legacy_enter_lane_resurrected');
}
const typeAt = submit.indexOf("action: 'SEMANTIC_TYPE'");
const readAt = submit.indexOf("action: 'CAPTURE'", typeAt);
const draftAt = submit.indexOf('chatgpt_submit_typed_draft_not_exact', readAt);
const sendAt = submit.indexOf("action: 'TYPED_CLICK'", draftAt);
assert.ok(typeAt >= 0 && readAt > typeAt && draftAt > readAt && sendAt > draftAt, 'type_fresh_draft_send_order_missing');
assert.match(submit, /submit_after_type:\s*false/, 'type_without_submit_contract_missing');
assert.match(submit, /typedComposer\.value_length !== prompt\.length/, 'typed_length_fence_missing');
assert.match(submit, /typedComposer\.value_sha256 !== promptHash/, 'typed_hash_fence_missing');
assert.match(submit, /chatgpt_submit_tab_binding_mismatch/, 'exact_tab_fence_missing');
assert.match(submit, /chatgpt_submit_target_binding_mismatch/, 'exact_target_fence_missing');
assert.match(submit, /chatgpt_submit_conversation_drift/, 'exact_conversation_fence_missing');
assert.match(submit, /chatgpt_submit_send_not_unique/, 'unique_send_fence_missing');
assert.match(submit, /chatgpt_submit:\s*true/, 'native_send_readback_lane_missing');
assert.match(readiness, /LEGACY_AGENT_PLATFORM_READ_ONLY/, 'legacy_active_dispatch_not_fenced');
assert.match(readiness, /PRE_TYPE.*PRE_CLICK/, 'two_phase_readiness_contract_missing');
console.log('root_transport_static_fence_pass: active ChatGPT type -> exact fresh readback -> one Send; legacy read-only');
