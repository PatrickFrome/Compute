import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDeliveryTrace } from '../trace-oracle.mjs';

const produced = { type: 'produced', message_id: 'm1', producer_id: 'agent-a' };
const delivered = { type: 'delivery', message_id: 'm1', delivery_ref: 'r1', consumer_id: 'agent-b' };
const readback = { type: 'ack_readback', delivery_ref: 'r1', durable: true };
const complete = { type: 'complete', delivery_ref: 'r1', effect_key: 'm1:agent-b' };
const codes = events => auditDeliveryTrace(events).issues.map(x => x.code);

test('canonical durable readback allows one completion', () => {
  const v = auditDeliveryTrace([produced, delivered, {type: 'ack_result', delivery_ref: 'r1', outcome: 'ok'}, readback, complete]);
  assert.equal(v.ok, true);
  assert.equal(v.summary.verified_completions, 1);
});
test('duplicate delivery and identical completion are idempotent', () => {
  const v = auditDeliveryTrace([produced, delivered, delivered, readback, complete, complete]);
  assert.equal(v.ok, true);
  assert.equal(v.summary.verified_completions, 1);
  assert.equal(v.summary.duplicate_events, 2);
});
test('conflicting reference on repeat is rejected', () => {
  assert.ok(codes([produced, delivered, {...delivered, message_id: 'm2'}]).includes('DELIVERY_REF_COLLISION'));
});
test('ACK alone never substitutes for durable readback', () => {
  assert.ok(codes([produced, delivered, {type:'ack_result',delivery_ref:'r1',outcome:'ok'}, complete]).includes('COMPLETE_WITHOUT_READBACK'));
});
test('lost ACK reply is recoverable only after readback', () => {
  const v = auditDeliveryTrace([produced, delivered, {type:'ack_result',delivery_ref:'r1',outcome:'unknown'}, {type:'restart',consumer_id:'agent-b'}, readback, complete]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.summary.uncertain_refs, []);
});
test('ambiguous ACK remains explicitly unresolved without readback', () => {
  const v = auditDeliveryTrace([produced, delivered, {type:'ack_result',delivery_ref:'r1',outcome:'unknown'}, {type:'restart',consumer_id:'agent-b'}]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.summary.uncertain_refs, ['r1']);
});
test('unknown ACK reference is rejected', () => {
  assert.ok(codes([produced, delivered, {type:'ack_result',delivery_ref:'other',outcome:'ok'}]).includes('ACK_UNKNOWN_REF'));
});
test('different reference same logical message cannot double-confirm a new effect', () => {
  const v = auditDeliveryTrace([produced, delivered, readback, complete, {...delivered,delivery_ref:'r2'}, {type:'ack_readback',delivery_ref:'r2',durable:true}, {type:'complete',delivery_ref:'r2',effect_key:'different'}]);
  assert.ok(v.issues.some(x=>x.code==='NONIDEMPOTENT_CONFIRM'));
});
test('incomplete pagination cannot claim caught-up', () => {
  const v = auditDeliveryTrace([{type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p2',has_more:true}, {type:'caught_up',reader_id:'b'}]);
  assert.deepEqual(v.issues.map(x=>x.code).sort(), ['INCOMPLETE_PAGE_SCAN','PREMATURE_CAUGHT_UP']);
});
test('full pagination can declare caught-up', () => {
  const v = auditDeliveryTrace([{type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p2',has_more:true},{type:'pending_page',reader_id:'b',cursor_in:'p2',cursor_out:null,has_more:false}, {type:'caught_up',reader_id:'b'}]);
  assert.equal(v.ok, true);
});
test('cursor gap after restart is detected', () => {
  const v = auditDeliveryTrace([{type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p2',has_more:true},{type:'restart',consumer_id:'b'},{type:'pending_page',reader_id:'b',cursor_in:'p3',cursor_out:null,has_more:false}]);
  assert.ok(v.issues.some(x=>x.code==='CURSOR_DISCONTINUITY'));
});
test('resumed pagination after restart can finish', () => {
  const v = auditDeliveryTrace([{type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p2',has_more:true},{type:'restart',consumer_id:'b'},{type:'pending_page',reader_id:'b',cursor_in:'p2',cursor_out:null,has_more:false}]);
  assert.equal(v.ok, true);
});
test('stuck cursor is rejected', () => {
  assert.ok(codes([{type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p1',has_more:true},{type:'pending_page',reader_id:'b',cursor_in:'p1',cursor_out:'p1',has_more:true}]).includes('STUCK_CURSOR'));
});
test('a duplicate ACK readback does not duplicate effect', () => {
  const v = auditDeliveryTrace([produced,delivered,readback,readback,complete]);
  assert.equal(v.ok,true);
  assert.equal(v.summary.verified_completions,1);
});

test('identical page replay around restart is idempotent', () => {
  const first = {type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p2',has_more:true,message_ids:['m1']};
  const last = {type:'pending_page',reader_id:'b',cursor_in:'p2',cursor_out:null,has_more:false,message_ids:[]};
  const v = auditDeliveryTrace([first,{type:'restart',consumer_id:'b'},first,last,last,{type:'caught_up',reader_id:'b'}]);
  assert.equal(v.ok,true);
  assert.equal(v.summary.duplicate_events,2);
});
test('conflicting replay of same pending page cursor is rejected', () => {
  const first = {type:'pending_page',reader_id:'b',cursor_in:null,cursor_out:'p2',has_more:true,message_ids:['m1']};
  const changed = {...first,message_ids:['m2']};
  assert.ok(codes([first,changed,{type:'pending_page',reader_id:'b',cursor_in:'p2',cursor_out:null,has_more:false}]).includes('PAGE_REPLAY_CONFLICT'));
});
