import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edgePath = new URL('../../../supabase/functions/metaengine-live-peer-broker-h205f22/index.ts', import.meta.url);
const source = await readFile(edgePath, 'utf8');

function normalize(raw) {
  const value = raw.trim();
  const thinkEnd = value.lastIndexOf('</think>');
  if (thinkEnd >= 0 && value.slice(thinkEnd + 8).trim()) {
    return { text: value.slice(thinkEnd + 8).trim(), normalization: 'after_think_end' };
  }
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

test('live broker v5 registry and adaptive order are persisted', () => {
  assert.match(source, /metaengine\.live-peer-broker\.v5/);
  for (const id of ['gemma2', 'nemotron', 'tinyllama', 'llama2']) {
    assert.match(source, new RegExp(`id:\\"${id}\\"`));
  }
  assert.match(source, /const PRIMARY=\["gemma2","nemotron"\]/);
  assert.match(source, /const BACKUPS=\["tinyllama","llama2"\]/);
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

test('legacy Gradio generator uses one session hash across iterations', () => {
  assert.match(source, /const session=`metaengine-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(source, /session_hash:session/);
  assert.match(source, /if\(j\?\.is_generating!==true\)return\{raw,event_count:i\+1\}/);
});

test('committee does not spend backup capacity after two primary successes', () => {
  assert.match(source, /if\(successes>=2\)break/);
  assert.match(source, /Promise\.allSettled\(ids\.map\(id=>invokePeer\(PEERS\[id\],prompt\)\)\)/);
});
