import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const ROOTS=[
  '../src/rsi-isolated-candidate-builder.mjs',
  '../src/rsi-shadow-tournament.mjs',
  '../src/rsi-promotion-admission-gate.mjs',
];

const REQUIRED=[
  'rsi-skill-exposure-release-review.mjs',
  'rsi-skill-exposure-release-transition-proof.mjs',
  'rsi-lineage-structural-provenance.mjs',
  'rsi-github-attestation-verification-receipt.mjs',
  'rsi-lineage-provenance-acceptance.mjs',
  'rsi-skill-lineage-contamination-review.mjs',
  'rsi-runtime-service.mjs',
  'rsi-runtime-skill-lifecycle.mjs',
];

test('R9 exposure acceptor surfaces are frozen in candidate tournament and promotion roots',async()=>{
  for(const relative of ROOTS){
    const source=await fs.readFile(new URL(relative,import.meta.url),'utf8');
    for(const required of REQUIRED){
      assert.match(source,new RegExp(required.replaceAll('.','\\.')));
    }
  }
});

test('R9 immutable roots keep verifier and effect-owner planes outside candidate mutation authority',async()=>{
  const candidate=await fs.readFile(new URL('../src/rsi-isolated-candidate-builder.mjs',import.meta.url),'utf8');
  const tournament=await fs.readFile(new URL('../src/rsi-shadow-tournament.mjs',import.meta.url),'utf8');
  const promotion=await fs.readFile(new URL('../src/rsi-promotion-admission-gate.mjs',import.meta.url),'utf8');

  for(const source of [candidate,tournament,promotion]){
    assert.match(source,/rsi-lineage-structural-provenance\.mjs/);
    assert.match(source,/rsi-github-attestation-verification-receipt\.mjs/);
    assert.match(source,/rsi-lineage-provenance-acceptance\.mjs/);
    assert.match(source,/rsi-skill-lineage-contamination-review\.mjs/);
    assert.match(source,/rsi-skill-exposure-release-transition-proof\.mjs/);
    assert.match(source,/rsi-runtime-service\.mjs/);
    assert.match(source,/rsi-runtime-skill-lifecycle\.mjs/);
  }
});
