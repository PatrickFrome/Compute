#!/usr/bin/env node
// METAENGINE DevFleet low-latency, read-only fleet observation.
// One host invocation, one loopback manifest, bounded concurrent reads.
// No Send, model selection, retry, new tab, shell, SQL or hosted dependency.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

function argument(name, fallback, min, max) {
  const prefix = '--' + name + '=';
  const found = process.argv.slice(2).filter(x => x.startsWith(prefix));
  if (found.length > 1) throw Error('duplicate_argument_' + name);
  if (!found.length) return fallback;
  const value = Number(found[0].slice(prefix.length));
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('invalid_argument_' + name);
  return value;
}
const allowed = new Set(['--quick', '--read', '--help', '--only-conversations', '--compact']);
const extra = process.argv.slice(2).filter(x => !x.includes('='));
if (extra.some(x => !allowed.has(x)) || extra.filter(x=>x==='--quick' || x==='--read' || x==='--help').length > 1) throw Error('unsupported_action');
if (extra.includes('--help')) {
  console.log('Usage: node fast-observe.mjs [--quick|--read] [--only-conversations] [--compact] [--parallel=1..6] [--max-tabs=1..16] [--excerpt=0..400]');
  process.exit(0);
}
const read = extra.includes('--read');
const onlyConversations = extra.includes('--only-conversations');
const compact = extra.includes('--compact');
const parallel = argument('parallel', 3, 1, 6);
const maxTabs = argument('max-tabs', 16, 1, 16);
const excerpt = argument('excerpt', 0, 0, 400);
if (!read && excerpt > 0) throw Error('excerpt_requires_read');
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const manifest = JSON.parse(await fs.readFile(path.join(appData,'METAENGINE DevFleet','operator-rpc.json'),'utf8'));
const url = new URL(String(manifest.url || ''));
if (manifest.schema !== 'metaengine.devfleet.loopback.v1' ||
    manifest.app !== 'METAENGINE DevFleet' ||
    url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
    url.pathname !== '/rpc' || url.search || url.hash ||
    url.username || url.password || !/^[0-9a-f]{64}$/i.test(manifest.token || ''))
  throw Error('untrusted_local_manifest');
const started = performance.now();
async function rpc(method, params = {}, timeoutMs = 20000) {
  const response = await fetch(url, {
    method: 'POST', redirect:'error', signal: AbortSignal.timeout(timeoutMs),
    headers: {Authorization:'Bearer ' + manifest.token,'Content-Type':'application/json'},
    body: JSON.stringify({ method, params })
  });
  const result = await response.json();
  if (!response.ok || result?.ok !== true) {
    const safe = String(result?.error || 'rpc_refused').replace(/[^a-z0-9_:-]/gi,'_').slice(0,65);
    throw Error(safe);
  }
  return result.result;
}
const list = await rpc('chat.list');
if (list?.schema !== 'metaengine.devfleet.operator.v1' || !Array.isArray(list.sessions))
  throw Error('unexpected_session_contract');
const sessions = list.sessions.slice(0,maxTabs).map(s => ({tab_id:s.tab_id, state:s.state, conversation: /^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+\/?$/i.test(s.url||'')}));
const output = { schema:'metaengine.devfleet.fast-observe.v1', source:'LIVE_DEVFLEET_LOOPBACK',
  app_pid:manifest.pid, version:manifest.version, scope:'READ_ONLY', mode: read?'CONCURRENT_READ':'FAST_LIST',
  observed_at:new Date().toISOString(), session_count:list.session_count,
  checked:sessions.length, parallelism:read?parallel:0, records:sessions,
  hosted_database:false, automatic_retry_allowed:false, authority_effect:false };
if (read) {
  const jobs = sessions.filter(s=>s.state==='OPEN' && (!onlyConversations || s.conversation));
  let next = 0;
  const observations = new Map();
  const workers = Array.from({length:Math.min(parallel,jobs.length)}, async()=>{
    while (next < jobs.length) {
      const item = jobs[next++];
      const began = performance.now();
      try {
        const result = await rpc('chat.read',{tab_id:item.tab_id,offset:0,max_chars:20000},20000);
        if (result?.tab_id !== item.tab_id || result?.state !== 'READ' ||
            result?.authority_effect !== false || typeof result.text !== 'string')
          throw Error('readback_identity_invalid');
        const text = result.text;
        observations.set(item.tab_id, {
          observation:'UNTRUSTED_PAGE_TEXT', read_ms:Math.round(performance.now()-began),
          chars_returned:text.length, total_chars:result.total_chars,
          has_more:result.has_more===true,
          sha256:crypto.createHash('sha256').update(text).digest('hex'),
          ...(excerpt ? {excerpt:text.slice(-excerpt)} : {})
        });
      } catch(e) {
        observations.set(item.tab_id,{observation:'UNKNOWN',read_ms:Math.round(performance.now()-began),
          error:String(e?.message||'read_refused').replace(/[^a-z0-9_:-]/gi,'_').slice(0,65)});
      }
    }
  });
  await Promise.all(workers);
  for (const item of sessions) item.readback = observations.get(item.tab_id) ||
    {observation:onlyConversations && !item.conversation?'SKIPPED_NO_CONVERSATION':item.state==='OPEN'?'UNKNOWN':'NOT_OPEN'};
  output.read_success = sessions.filter(x=>x.readback.observation==='UNTRUSTED_PAGE_TEXT').length;
  output.read_unknown = jobs.length-output.read_success;
  output.skipped_empty_chat = onlyConversations ? sessions.length-jobs.length : 0;
  output.sum_individual_read_ms = sessions.reduce((n,s)=>n+(s.readback.read_ms||0),0);
}
output.elapsed_ms=Math.round(performance.now()-started);
if (compact) output.records = sessions.filter(s=>s.conversation || s.readback?.observation==='UNKNOWN');
console.log(JSON.stringify(output,null,2));
