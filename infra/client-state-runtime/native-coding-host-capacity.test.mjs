import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCapacityPostgresBirth} from './native-coding-host-capacity.mjs';
test('PostgreSQL startup JSON normalization preserves microseconds across offsets, never milliseconds as identity',()=>{
 assert.equal(nativeCapacityPostgresBirth('2026-10-30T13:04:05.123456Z'),'2026-10-30T13:04:05.123456Z');
 assert.equal(nativeCapacityPostgresBirth('2026-10-30T16:04:05.123456+03:00'),'2026-10-30T13:04:05.123456Z');
 assert.equal(nativeCapacityPostgresBirth('2026-10-30T08:04:05.123456-05:00'),'2026-10-30T13:04:05.123456Z');
 assert.equal(nativeCapacityPostgresBirth('2026-10-30T13:04:05Z'),'2026-10-30T13:04:05.000000Z');
 const a='2026-10-30T13:04:05.123456Z',b='2026-10-30T13:04:05.123457Z';
 assert.equal(Date.parse(a),Date.parse(b));assert.notEqual(nativeCapacityPostgresBirth(a),nativeCapacityPostgresBirth(b));
 for(const bad of [null,new Date(),0,'2026-10-30T13:04:05.1234567Z','2026-10-30T13:04:05','caller'])assert.throws(()=>nativeCapacityPostgresBirth(bad));
});
