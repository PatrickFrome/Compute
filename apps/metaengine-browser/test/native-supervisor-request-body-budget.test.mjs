import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSupervisorBodyReader} from '../supabase/a2-browser-native-supervisor-v1/request-body-budget.mjs';
const encoder=new TextEncoder();
const request=(body,headers={})=>new Request('http://127.0.0.1:5555/',{method:'POST',body,headers,duplex:'half'});
const error=status=>e=>e.status===status;

test('body reader preserves exact signed unicode and bounds decoded bytes',async()=>{
  const reader=createNativeSupervisorBodyReader({maxBodyBytes:16,maxBufferedBytes:16});
  const value='{"x":"Пр"}';assert.equal(await reader.read(request(value)),value);
  await assert.rejects(reader.read(request('я'.repeat(9))),error(413));
  await assert.rejects(reader.read(request('small',{'content-length':'100'})),error(413));
  await assert.rejects(reader.read(request(new Uint8Array([0xc3,0x28]))),error(400));
  assert.equal(reader.snapshot().inflight,0);assert.equal(reader.snapshot().buffered_bytes,0);
});
test('chunked oversized body is cancelled before a full body allocation',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('1234'));c.enqueue(encoder.encode('56789'));},cancel(){cancelled=true;}});
  const reader=createNativeSupervisorBodyReader({maxBodyBytes:8,maxBufferedBytes:8});
  await assert.rejects(reader.read(request(stream)),error(413));assert.equal(cancelled,true);
  assert.equal(reader.snapshot().buffered_bytes,0);
});
test('slow unauthenticated bodies consume a bounded slot and timeout releases it',async()=>{
  let cancelled=false;
  const reader=createNativeSupervisorBodyReader({maxBodyBytes:8,maxBufferedBytes:8,maxInflight:1,timeoutMs:25});
  const first=reader.read(request(new ReadableStream({cancel(){cancelled=true;}})));
  const rejected=assert.rejects(first,error(408));
  await assert.rejects(reader.read(request('second')),error(429));
  await rejected;assert.equal(cancelled,true);assert.equal(reader.snapshot().inflight,0);
  assert.equal(await reader.read(request('ok')),'ok');
});
test('aggregate buffering is bounded independently of per-body and stream limits',async()=>{
  let finish;
  const reader=createNativeSupervisorBodyReader({maxBodyBytes:8,maxBufferedBytes:8,maxInflight:2});
  const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('12345'));finish=()=>c.close();}});
  const first=reader.read(request(stream));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reader.snapshot().buffered_bytes,5);
  await assert.rejects(reader.read(request('6789')),error(429));
  finish();assert.equal(await first,'12345');assert.equal(reader.snapshot().buffered_bytes,0);
});
test('unreadable locked streams and floods of tiny chunks cannot leak capacity',async()=>{
  const reader=createNativeSupervisorBodyReader({maxBodyBytes:8192,maxBufferedBytes:8192});
  const locked=new ReadableStream();const lock=locked.getReader();
  await assert.rejects(reader.read({headers:new Headers(),body:locked}),error(400));
  assert.equal(reader.snapshot().inflight,0);lock.releaseLock();
  let sent=0;
  const tiny=new ReadableStream({pull(c){if(sent++<5000)c.enqueue(new Uint8Array([65]));else c.close();}});
  await assert.rejects(reader.read(request(tiny)),error(413));
  assert.equal(reader.snapshot().inflight,0);assert.equal(reader.snapshot().buffered_bytes,0);
});
