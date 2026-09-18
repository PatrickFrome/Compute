import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const runtime=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

test('runtime persists all six external evidence events before mutating episode state',()=>{
  const start=runtime.indexOf('async recordExternalEvaluationEvidence({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  assert.ok(start>=0&&end>start,'external evaluation runtime method missing');
  const body=runtime.slice(start,end);
  const append=body.indexOf("await this.#ledger.append('RSI_EXTERNAL_EVALUATION_EVIDENCE_RECORDED'");
  const apply=body.indexOf('this.#episodes.apply(event)');
  assert.ok(append>=0&&apply>append,'episode evidence must apply only after durable append');
  assert.match(body,/const events = bundle\.evidence_classes\.map/);
  assert.match(body,/durable_before_episode_apply: true/);
  assert.match(body,/candidate_can_self_certify: false/);
  assert.match(body,/direct_promotion_enabled: false/);
});

test('runtime replay restores bundled episode evidence atomically from episode_events',()=>{
  assert.match(runtime,/if \(Array\.isArray\(row\?\.payload\?\.episode_events\)\)/);
  assert.match(runtime,/for \(const event of row\.payload\.episode_events\) this\.#episodes\.apply\(event\)/);
  assert.match(runtime,/external_evaluation_bundle/);
});

test('external evaluation runtime path cannot invoke promotion self-update Browser actuation or scheduler',()=>{
  const start=runtime.indexOf('async recordExternalEvaluationEvidence({');
  const end=runtime.indexOf('async openEpisode(input = {})',start);
  const body=runtime.slice(start,end);
  assert.doesNotMatch(body,/nominatePromotion|SELF_UPDATE|executeNativeSupervisorCommand|devos_fleet_enqueue|workspaceManager|shell/);
  assert.match(body,/nominationReadiness/);
});
