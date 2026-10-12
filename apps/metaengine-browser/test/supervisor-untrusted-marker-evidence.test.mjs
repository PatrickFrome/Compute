import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {classifyUntrustedWakeMarker, classifyUntrustedRolloverMarker} from '../src/supervisor-untrusted-marker-evidence.mjs';

const wake = 'wake_1234abc';
const attempt = 'rollover_attempt_0001';
const page = (text_excerpt) => ({schema:'metaengine.native-browser.perception.v1',url:'https://chatgpt.com/c/fake',text_excerpt});

test('an exact wake marker inside untrusted page text cannot prove a Send', () => {
  for (const text of [
    `ChatGPT quoted the marker ${wake}`,
    `Unsent draft contains ${wake}`,
    `User-origin spoof: ${wake}`,
  ]) {
    const receipt = classifyUntrustedWakeMarker({frame:page(text),marker:wake});
    assert.equal(receipt.marker_seen,true);
    assert.equal(receipt.state,'PAGE_MARKER_UNVERIFIED');
    assert.equal(receipt.send_effect_proven,false);
    assert.equal(receipt.automatic_retry_allowed,false);
    assert.equal(receipt.authority_effect,false);
  }
});

test('missing or invalid marker stays unconfirmed',()=>{
  assert.equal(classifyUntrustedWakeMarker({frame:page('nothing'),marker:wake}).send_effect_proven,false);
  assert.equal(classifyUntrustedWakeMarker({frame:page('wake_fake'),marker:'../../../'}).marker_seen,false);
  assert.equal(classifyUntrustedWakeMarker({}).send_effect_proven,false);
});

test('rollover marker is equally untrusted, even with conversation URL',()=>{
  const receipt=classifyUntrustedRolloverMarker({frame:page('assistant says '+attempt),attemptId:attempt});
  assert.equal(receipt.marker_seen,true);
  assert.equal(receipt.send_effect_proven,false);
  assert.equal(receipt.authority_effect,false);
});

test('live lifecycle cannot use raw wake or rollover text to settle ambiguous effects',async()=>{
  const s=await readFile(new URL('../src/supervisor-lifecycle-runtime-core.mjs',import.meta.url),'utf8');
  const section=(start,end)=>{
    const begin=s.indexOf(start);
    const until=s.indexOf(end,begin+start.length);
    assert.ok(begin>=0&&until>begin,'required live method present');
    return s.slice(begin,until);
  };
  const wakeRecovery=section('async #recoverAmbiguousWakeFromFrame(','async #observeSupervisor(');
  assert.match(wakeRecovery,/classifyUntrustedWakeMarker/);
  assert.match(wakeRecovery,/AMBIGUOUS_WAKE_READBACK_REQUIRED/);
  assert.doesNotMatch(wakeRecovery,/resolveAmbiguous\(\{ observed_sent: true \}\)/);
  assert.doesNotMatch(wakeRecovery,/this\.#activateRequest\(/);
  const blockedRollover=section('async #settleRolloverBlockedAmbiguousWake(','async #settleProvenNoEffectRollover(');
  assert.match(blockedRollover,/classifyUntrustedWakeMarker/);
  assert.doesNotMatch(blockedRollover,/settleRolloverBlockedAmbiguousWake\(\{ observed_sent: true \}\)/);
  const rollover=section('async #reconcileAmbiguousRollover(','async #settleRolloverBlockedAmbiguousWake(');
  assert.match(rollover,/classifyUntrustedRolloverMarker/);
  assert.doesNotMatch(rollover,/return this\.#bindRecoveredRollover\(/);
  const submitted=section('async #observeSendReadback(','async #recoverAmbiguousWakeFromFrame(');
  assert.match(submitted,/if \(generating\(observed\)\)/);
  assert.doesNotMatch(submitted,/\.text_excerpt/);
});
