import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

for (const name of ['a2-browser-supervisor-v1', 'a2-browser-supervisor-v2-canary', 'a2-browser-supervisor-v3-canary']) {
  test(`${name}: existing authenticated wire format remains usable without an unsigned timestamp`, async () => {
    const source = stripTypeScriptTypes(readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8'), { mode: 'strip' });
    let handler;
    const effects = [];
    const Deno = {
      env: { get: (key) => key === 'SUPABASE_URL' ? 'https://offline.invalid' : 'OFFLINE_FIXTURE_SERVICE_ROLE' },
      serve: (callback) => { handler = callback; },
    };
    const fetch = async (url, init) => {
      assert.ok(String(url).startsWith('https://offline.invalid/rest/v1/'));
      if (String(url).includes('pairing_')) return new Response(JSON.stringify([{ token_hash: 'fixture' }]));
      effects.push({ url, method: init.method });
      return new Response('null');
    };
    new Function('Deno', 'fetch', source)(Deno, fetch);
    assert.equal(typeof handler, 'function');
    const denied = await handler(new Request(`https://offline.invalid/${name}/v1/state`, { method: 'POST', body: '{}' }));
    assert.equal(denied.status, 401);
    assert.equal(effects.length, 0);
    const response = await handler(new Request(`https://offline.invalid/${name}/v1/state`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-a2-chat-bridge-secret': 'OFFLINE_SHARED_SECRET_00000000000000', 'x-a2-chat-bridge-client': 'offline-client' },
      body: '{"state":{"supervisor_mode":"OFF"}}',
    }));
    assert.equal(response.status, 202);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].method, 'POST');
    assert.equal((await response.json()).accepted, true);
  });
}
