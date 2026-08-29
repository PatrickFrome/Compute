import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../../supabase/functions/metaengine-peer-decision-h205f22/index.ts', import.meta.url), 'utf8');

function normText(value) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
function normNumber(value) {
  const text = value.normalize('NFKC').trim().replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? String(Object.is(number, -0) ? 0 : number) : null;
}
function sameAnswer(a, b) {
  if (normText(a) === normText(b)) return true;
  const x = normNumber(a), y = normNumber(b);
  return x !== null && y !== null && x === y;
}

test('decision adapter is observational and never claims semantic truth', () => {
  assert.match(source, /metaengine\.peer-decision\.v2/);
  assert.match(source, /truth_claimed:false/);
  assert.match(source, /semantic_consensus:null/);
  assert.match(source, /requires_supervisor_judgment:true/);
});

test('tiebreak is invoked only after a real divergence', () => {
  assert.match(source, /if\(state==="DIVERGENT"&&!alreadyHasLlama32&&successful\.length>=2\)/);
  assert.match(source, /independentTiebreak\(prompt\)/);
});

test('Llama 3.2 never receives peer answers in its tiebreak prompt', () => {
  assert.match(source, /Solve the following task independently\. Do not discuss other models\./);
  assert.doesNotMatch(source, /committee\.results.*content/);
  assert.doesNotMatch(source, /successful.*JSON\.stringify.*messages/);
});

test('an already participating Llama 3.2 cannot be counted again as an independent tiebreak', () => {
  assert.match(source, /const alreadyHasLlama32=successful\.some\(\(x:any\)=>x\?\.model==="llama32"\)/);
  assert.match(source, /!alreadyHasLlama32/);
});

test('tiebreak support is distinct from ordinary agreement', () => {
  assert.match(source, /state="TIEBREAK_SUPPORT"/);
  assert.match(source, /state="THREE_WAY_DIVERGENCE"/);
  assert.match(source, /answer_agreement_observed:state==="AGREED"/);
  assert.match(source, /tiebreak_support_observed:state==="TIEBREAK_SUPPORT"/);
});

test('numeric equivalent forms can match without accepting arbitrary prose', () => {
  assert.equal(sameAnswer('169', '169.0'), true);
  assert.equal(sameAnswer(' 1,024 ', '1024'), true);
  assert.equal(sameAnswer('answer: 169', '169'), false);
});

test('candidate is withheld for three-way divergence', () => {
  assert.match(source, /state="THREE_WAY_DIVERGENCE";candidate=null/);
});
