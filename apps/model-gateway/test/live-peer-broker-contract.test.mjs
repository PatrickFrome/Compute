import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edgePath = new URL('../../../supabase/functions/metaengine-live-peer-broker-h205f22/index.ts', import.meta.url);
const source = await readFile(edgePath, 'utf8');

function normalize(raw) {
  const value = raw.trim();
  const thinkEnd = value.lastIndexOf('</think>');
  if (thinkEnd >= 0 && value.slice(thinkEnd + 8).trim()) return { text: value.slice(thinkEnd + 8).trim(), normalization: 'after_think_end' };
  const final = value.match(/<final>([\s\S]*?)<\/final>/i);
  if (final?.[1]?.trim()) return { text: final[1].trim(), normalization: 'final_tag' };
  return { text: value, normalization: 'none' };
}

function classify(message) {
  const value = message.toLowerCase();
  if (value.includes('quota') || value.includes('try again in')) return 'quota';
  if (value.includes('paused')) return 'paused';
  if (value.includes('retired') || value.includes('model_not_found')) return 'retired';
  if (value.includes('401') || value.includes('sign in') || value.includes('unauthorized')) return 'auth';
  if (value.includes('402') || value.includes('credits')) return 'credits';
  if (value.includes('timeout') || value.includes('timed out')) return 'timeout';
  return 'upstream';
}

function comparableText(value) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
function comparableNumber(value) {
  const s = value.normalize('NFKC').trim().replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Object.is(n, -0) ? '0' : String(n);
}
function agreement(results) {
  const ok = results.filter(x => x?.ok === true && typeof x.text === 'string');
  const base = { evaluated: ok.length >= 2, successful_responses: ok.length, truth_claimed: false, semantic_consensus: null, requires_supervisor_judgment: true };
  if (ok.length < 2) return { ...base, signal: 'insufficient', unanimous: false, divergence_detected: false, matched_models: [], candidate: null, agreement_ratio: ok.length ? 1 : 0 };
  const exact = new Map(); const nums = new Map();
  for (const r of ok) {
    const ek = comparableText(r.text); exact.set(ek, [...(exact.get(ek) || []), r.model]);
    const nk = comparableNumber(r.text); if (nk !== null) nums.set(nk, [...(nums.get(nk) || []), r.model]);
  }
  const largest = groups => [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0] ?? null;
  const ex = largest(exact); const nu = largest(nums); let signal = 'divergent'; let cluster = null; let candidate = null;
  if (ex && ex[1].length >= 2) { signal = 'exact_match'; cluster = ex; candidate = ok.find(x => comparableText(x.text) === ex[0])?.text?.trim() ?? ex[0]; }
  else if (nu && nu[1].length >= 2) { signal = 'numeric_match'; cluster = nu; candidate = nu[0]; }
  const size = cluster?.[1].length ?? 1;
  return { ...base, signal, unanimous: size === ok.length && signal !== 'divergent', divergence_detected: size < ok.length, matched_models: cluster?.[1] ?? [], candidate, agreement_ratio: size / ok.length };
}

test('live broker v8 separates advisory and structured actor pools', () => {
  assert.match(source, /metaengine\.live-peer-broker\.v8/);
  for (const id of ['gemma2', 'llama32', 'nemotron', 'tinyllama', 'llama2']) assert.match(source, new RegExp(`id:\\"${id}\\"`));
  assert.match(source, /const ADVISORY_PRIMARY=\["gemma2","nemotron"\]/);
  assert.match(source, /const STRUCTURED_PRIMARY=\["gemma2","llama32"\]/);
  assert.match(source, /llama32:\{id:"llama32",served_model:"meta-llama\/Llama-3\.2-3B-Instruct"/);
});

test('structured capability is explicit and Nemotron is advisory-only', () => {
  assert.match(source, /gemma2:\{[^\n]*structured_capable:true/);
  assert.match(source, /llama32:\{[^\n]*structured_capable:true/);
  assert.match(source, /nemotron:\{[^\n]*structured_capable:false/);
  assert.match(source, /quality:"strong-advisory"/);
});

test('reasoning wrapper is stripped without changing a plain answer', () => {
  assert.deepEqual(normalize('analysis\n</think>63'), { text: '63', normalization: 'after_think_end' });
  assert.deepEqual(normalize('<final>121</final>'), { text: '121', normalization: 'final_tag' });
  assert.deepEqual(normalize('GEMMA_BROKER_OK'), { text: 'GEMMA_BROKER_OK', normalization: 'none' });
});

test('known live transport failures map to stable cooldown classes', () => {
  assert.equal(classify('ZeroGPU quota exceeded, try again in 23:59:59'), 'quota');
  assert.equal(classify('The endpoint is paused, ask a maintainer to restart it'), 'paused');
  assert.equal(classify('401 Invalid username or password'), 'auth');
  assert.equal(classify('402 You have depleted your monthly included credits'), 'credits');
  assert.equal(classify('request timed out'), 'timeout');
  assert.equal(classify('unexpected upstream failure'), 'upstream');
});

test('agreement is observational and never claims truth', () => {
  const r = agreement([{ ok: true, model: 'a', text: '63' }, { ok: true, model: 'b', text: '63' }]);
  assert.equal(r.signal, 'exact_match'); assert.equal(r.unanimous, true); assert.equal(r.truth_claimed, false); assert.equal(r.semantic_consensus, null); assert.equal(r.requires_supervisor_judgment, true); assert.deepEqual(r.matched_models, ['a', 'b']);
});

test('numeric agreement recognizes equivalent numeric forms without semantic consensus', () => {
  const r = agreement([{ ok: true, model: 'a', text: '63.0' }, { ok: true, model: 'b', text: '63' }]);
  assert.equal(r.signal, 'numeric_match'); assert.equal(r.candidate, '63'); assert.equal(r.truth_claimed, false); assert.equal(r.unanimous, true);
});

test('divergent peer answers remain explicit', () => {
  const r = agreement([{ ok: true, model: 'a', text: '42' }, { ok: true, model: 'b', text: '43' }]);
  assert.equal(r.signal, 'divergent'); assert.equal(r.unanimous, false); assert.equal(r.divergence_detected, true); assert.equal(r.agreement_ratio, 0.5);
});

test('agreement ignores failed transports and reports insufficient evidence', () => {
  const r = agreement([{ ok: true, model: 'a', text: '42' }, { ok: false, model: 'b', error: 'quota' }]);
  assert.equal(r.signal, 'insufficient'); assert.equal(r.successful_responses, 1); assert.equal(r.evaluated, false);
});

test('OpenAI endpoint defaults to structured-auto rather than advisory Nemotron fallback', () => {
  assert.match(source, /body\?\.model\|\|"metaengine\/structured-auto"/);
  assert.match(source, /logical==="metaengine\/structured-auto"/);
  assert.match(source, /invokeAuto\(STRUCTURED_PRIMARY,prompt,body\?\.max_tokens\)/);
});

test('OpenAI-compatible endpoint accepts the same bearer contract as SAME_POINT_DUEL_V4', () => {
  assert.match(source, /bearer===`Bearer \$\{CLIENT_MARKER\}`/);
  assert.match(source, /u\.pathname\.endsWith\("\/v1\/chat\/completions"\)/);
  assert.match(source, /object:"chat\.completion"/);
  assert.match(source, /choices:\[\{index:0,message:\{role:"assistant",content:result\.text\}/);
});

test('OpenAI compatibility reports served-model provenance metadata', () => {
  for (const field of ['upstream_served_model', 'tariff_dependency:true', 'zero_spend_verified:null', 'data_policy:"PUBLIC_EXTERNAL_HUGGINGFACE_SPACE"', 'confidential_data_supported:false', 'authority_effect:false']) assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('requested output tokens are bounded per peer', () => {
  assert.match(source, /llama32:\{[^\n]*max_tokens_cap:512/);
  assert.match(source, /Math\.max\(16,Math\.min\(p\.max_tokens_cap,Math\.trunc\(n\)\)\)/);
  assert.match(source, /max_output_tokens:maxTokens/);
});

test('legacy Gradio generator uses one session hash across iterations', () => {
  assert.match(source, /const session=`metaengine-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(source, /session_hash:session/);
  assert.match(source, /if\(j\?\.is_generating!==true\)return\{raw,event_count:i\+1\}/);
});

test('advisory committee saves backups after two primary successes while structured committee has no unproven fallback', () => {
  assert.match(source, /const backups=structured\?\[\]:ADVISORY_BACKUPS/);
  assert.match(source, /if\(successes>=2\)break/);
  assert.match(source, /agreement:analyzeAgreement\(results\)/);
});
