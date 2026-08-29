import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const snapshot = await readFile(new URL('../../../supabase/functions/metaengine-live-peer-broker-h205f22/index.live-v11.ts', import.meta.url), 'utf8');

function incompleteReasoning(id, raw, normalization) {
  if (id !== 'nemotron' || normalization !== 'none') return false;
  const value = raw.trim();
  return !/<\/think>|<final>[\s\S]*<\/final>/i.test(value)
    && value.length > 180
    && (/^(?:here(?:'|’)s a thinking process:|<think>)/i.test(value)
      || /\*\*analy(?:ze|sis)|\*\*identify|\*\*apply the rules|\*\*perform calculation/i.test(value));
}

test('v11 snapshot separates transport availability from quality quorum', () => {
  assert.match(snapshot, /metaengine\.live-peer-broker\.v11/);
  assert.match(snapshot, /tinyllama:\{[^\n]*quality:"availability-only"[^\n]*quorum_eligible:false/);
  assert.match(snapshot, /const ADVISORY_PRIMARY=\["gemma2","nemotron"\]/);
  assert.match(snapshot, /ADVISORY_BACKUPS=\["llama32","llama2"\]/);
  assert.match(snapshot, /AUTO_POOL=\["gemma2","nemotron","llama32","tinyllama","llama2"\]/);
  assert.match(snapshot, /results\.filter\(x=>x\.ok&&PEERS\[x\.model\]\?\.quorum_eligible\)\.length/);
});

test('Nemotron requested output tokens are floored at the live Space minimum', () => {
  assert.match(snapshot, /nemotron:\{[^\n]*min_output_tokens:64/);
  assert.match(snapshot, /Math\.max\(p\.min_output_tokens,Math\.min\(p\.max_tokens_cap,Math\.trunc\(n\)\)\)/);
});

test('unfinished long Nemotron reasoning is rejected', () => {
  const raw = "Here's a thinking process:\n1. **Analyze User Input:** The user asks for a calculation.\n2. **Perform Calculation:** We should carefully compute the requested value and then ensure the requested formatting.\n3. **Check Constraints:** Continue reasoning, but the generation is cut off before any final marker or answer is produced.";
  assert.equal(incompleteReasoning('nemotron', raw, 'none'), true);
  assert.match(snapshot, /incomplete_generation:reasoning_without_final/);
  assert.match(snapshot, /kind:"incomplete",ms:15_000/);
});

test('completed Nemotron reasoning remains eligible', () => {
  assert.equal(incompleteReasoning('nemotron', "Here's a thinking process:\nanalysis\n</think>144", 'after_think_end'), false);
  assert.equal(incompleteReasoning('nemotron', '<final>144</final>', 'final_tag'), false);
});

test('availability-only TinyLlama cannot increment quality quorum', () => {
  assert.match(snapshot, /if\(PEERS\[id\]\.quorum_eligible\)successes\+\+/);
  assert.match(snapshot, /quality_success_count:successes,transport_success_count:results\.filter\(x=>x\.ok\)\.length/);
});

test('OpenAI-compatible and structured paths survive v11 hardening', () => {
  assert.match(snapshot, /u\.pathname\.endsWith\("\/v1\/chat\/completions"\)/);
  assert.match(snapshot, /STRUCTURED_PRIMARY=\["gemma2","llama32"\]/);
  assert.match(snapshot, /structured_json_missing/);
  assert.match(snapshot, /upstream_served_model:r\.served_model/);
  assert.match(snapshot, /authority_effect:false/);
});
