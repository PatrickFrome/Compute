import assert from 'node:assert/strict';
import test from 'node:test';
import { createFallbackConsoleRuntime } from '../src/fallback-console-runtime.mjs';

// The historical console switched cloud/local authority from health streaks.
// It must stay retired even if a stale caller supplies a healthy sentinel.
for (const mode of ['CLOUD_AUTHORITY','LOCAL_FALLBACK','RESTORING']) {
  test(`retired fallback rejects ${mode} without reading a sentinel or starting transport`,()=>{
    let effects=0;
    const options={
      sentinel:{snapshot(){effects++;return {mode};},tick(){effects++;},start(){effects++;}},
      local_base:'http://127.0.0.1:3031/a2-browser-native-supervisor-v1',
      cloud_default_base:'https://cloud.example.test/functions/v1/a2-browser-native-supervisor-v1',
      fetch_impl:async()=>{effects++;},
    };
    assert.throws(()=>createFallbackConsoleRuntime(options),/retired_local_postgres_only/);
    assert.equal(effects,0);
  });
}

test('retired fallback has no provider bootstrap or environment prerequisite',()=>{
  assert.throws(()=>createFallbackConsoleRuntime(),/retired_local_postgres_only/);
});
