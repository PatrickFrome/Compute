import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edgePath = new URL('../../../supabase/functions/metaengine-live-peer-broker-h205f22/index.ts', import.meta.url);
const source = await readFile(edgePath, 'utf8');

function normalize(raw) {
  const value = raw.trim();
  const end = value.lastIndexOf('</think>');
  if (end >= 0 && value.slice(end + 8).trim()) return { text: value.slice(end + 8).trim(), normalization: 'after_think_end' };
  const final = value.match(/<final>([\s\S]*?)<\/final>/i);
  if (final?.[1]?.trim()) return { text: final[1].trim(), normalization: 'final_tag' };
  return { text: value, normalization: 'none' };
}

function incompleteNemotron(raw, normalization = 'none') {
  if (normalization !== 'none') return false;
  const value = raw.trim();
  const end = value.lastIndexOf('</think>');
  const hasThinkFinal = end >= 0 && Boolean(value.slice(end + 8).trim());
  const hasFinalTag = /<final>[\s\S]+<\/final>/i.test(value);
  return !hasThinkFinal && !hasFinalTag && value.length > 180
    && (/^(?:here(?:'|’)s a thinking process:|<think>)/i.test(value)
      || /\*\*analy(?:ze|sis)|\*\*identify|\*\*apply the rules|\*\*perform calculation/i.test(value));
}

function extractJsonEnvelope(text) {
  const value = text.trim().replace(/^```(?:json|javascript|python)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { text: JSON.stringify(parsed), normalization: 'json_exact' };
  } catch {}
  for (let start = 0; start < value.length; start++) {
    if (value[start] !== '{') continue;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < value.length; i++) {
      const ch = value[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        const candidate = value.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { text: JSON.stringify(parsed), normalization: 'json_embedded' };
        } catch {}
        break;
      }
    }
  }
  return null;
}

test('live broker v12 exposes separated advisory and structured actor pools', () => {
  assert.match(source, /metaengine\.live-peer-broker\.v12/);
  for (const id of ['gemma2', 'llama32', 'nemotron', 'tinyllama', 'llama2']) assert.match(source, new RegExp(`id:\\"${id}\\"`));
  assert.match(source, /ADVISORY_PRIMARY=\["gemma2","nemotron"\]/);
  assert.match(source, /ADVISORY_BACKUPS=\["llama32","llama2"\]/);
  assert.match(source, /STRUCTURED_PRIMARY=\["gemma2","llama32"\]/);
});

test('availability-only TinyLlama cannot satisfy committee quorum', () => {
  assert.match(source, /tinyllama:\{[^\n]*quality:"availability-only"[^\n]*quorum_eligible:false/);
  assert.match(source, /results\.filter\(x=>x\.ok&&PEERS\[x\.model\]\?\.quorum_eligible\)\.length/);
});

test('Nemotron is advisory-only and has the live Space 64-token minimum', () => {
  assert.match(source, /nemotron:\{[^\n]*structured_capable:false[^\n]*quorum_eligible:true[^\n]*min_output_tokens:64/);
  assert.match(source, /Math\.max\(p\.min_output_tokens,Math\.min\(p\.max_tokens_cap,Math\.trunc\(n\)\)\)/);
});

test('reasoning normalization accepts a non-empty final tail', () => {
  assert.deepEqual(normalize('analysis\n</think>169'), { text: '169', normalization: 'after_think_end' });
  assert.deepEqual(normalize('<final>121</final>'), { text: '121', normalization: 'final_tag' });
});

test('Nemotron closing think tag without a final tail is incomplete', () => {
  const raw = "Here's a thinking process:\n1. **Analyze User Input:** compute carefully.\n2. **Perform Calculation:** continue with enough detail to exceed the qualification threshold.\n3. **Check Constraints:** the trace ends after the thinking section without any emitted final answer, which must not count as a committee answer.\n</think>";
  assert.equal(incompleteNemotron(raw), true);
  assert.match(source, /incomplete_generation:reasoning_without_final/);
  assert.match(source, /hasThinkFinal=end>=0&&Boolean\(v\.slice\(end\+8\)\.trim\(\)\)/);
});

test('completed Nemotron reasoning remains qualified', () => {
  assert.equal(incompleteNemotron("Here's a thinking process:\n" + 'x'.repeat(200) + '\n</think>169'), false);
});

test('structured JSON recovery canonicalizes exact and embedded JSON', () => {
  assert.deepEqual(extractJsonEnvelope('{"ok":true,"value":42}'), { text: '{"ok":true,"value":42}', normalization: 'json_exact' });
  assert.deepEqual(extractJsonEnvelope('return json.dumps({"answer":"144"})'), { text: '{"answer":"144"}', normalization: 'json_embedded' });
  assert.equal(extractJsonEnvelope('thinking {"answer":"cut off"'), null);
});

test('Llama 3.2 advisory backup is forced through a structured independent answer', () => {
  assert.match(source, /async function invokeIndependentAnswer/);
  assert.match(source, /one key named answer/);
  assert.match(source, /id==="llama32"&&!structured\?await invokeIndependentAnswer/);
  assert.match(source, /normalization:"json_answer"/);
});

test('committee exposes availability separately from observed answer agreement', () => {
  assert.match(source, /availability_quorum_met:availability/);
  assert.match(source, /decision_state:decision/);
  assert.match(source, /answer_candidate:decision==="AGREED"\?a\.candidate:null/);
  assert.match(source, /eligible_success_count:successes/);
  assert.match(source, /transport_success_count:results\.filter\(x=>x\.ok\)\.length/);
});

test('agreement never upgrades to a truth claim', () => {
  assert.match(source, /truth_claimed:false/);
  assert.match(source, /semantic_consensus:null/);
  assert.match(source, /requires_supervisor_judgment:true/);
});

test('OpenAI-compatible endpoint and structured auto remain present', () => {
  assert.match(source, /u\.pathname\.endsWith\("\/v1\/chat\/completions"\)/);
  assert.match(source, /metaengine\/structured-auto/);
  assert.match(source, /invokeStructuredAuto/);
  assert.match(source, /object:"chat\.completion"/);
  assert.match(source, /upstream_served_model:r\.served_model/);
  assert.match(source, /authority_effect:false/);
});

test('legacy TinyLlama generator preserves one session across iterations', () => {
  assert.match(source, /const session=`metaengine-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(source, /session_hash:session/);
  assert.match(source, /if\(j\?\.is_generating!==true\)return\{raw,event_count:i\+1\}/);
});
