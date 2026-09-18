import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../../supabase/migrations/20260906093000_browser_supervisor_realtime_command_wake_v1.sql', import.meta.url),
  'utf8',
);
const edge = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');
const wake = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/realtime-command-wake.mjs', import.meta.url), 'utf8');

function returnedTemplate(source, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    'function\\s+' + escapedName + '\\s*\\([^)]*\\)\\s*\\{\\s*return\\s*`([^`]*)`\\s*;?\\s*\\}',
  );
  const match = source.match(pattern);
  assert.ok(match, `${functionName} template contract missing`);
  return match[1];
}

test('generic pulse trigger preserves legacy notify and broadcasts only command rows entering pending', () => {
  assert.match(migration, /create or replace function public\.glm_browser_pulse_notify_v1\(\)/i);
  assert.match(migration, /perform pg_notify\('glm_browser_pulse', v_payload\)/);
  assert.match(migration, /TG_TABLE_SCHEMA = 'public'/);
  assert.match(migration, /TG_TABLE_NAME = 'compute_fabric_a2_browser_supervisor_command_h205f22'/);
  assert.match(migration, /upper\(coalesce\(v_status, ''\)\) = 'PENDING'/);
  assert.match(migration, /if TG_OP = 'INSERT' then\s+v_should_wake := true/s);
  assert.match(migration, /elsif TG_OP = 'UPDATE' then[\s\S]*v_old_status := nullif\(to_jsonb\(old\)->>'status',''\)[\s\S]*v_should_wake := coalesce\(upper\(v_old_status\), ''\) <> 'PENDING'/);
});

test('database broadcast is a minimal private wake and never mutates command authority', () => {
  assert.match(migration, /v_topic := 'metaengine-control:' \|\| v_workspace \|\| ':' \|\| coalesce\(v_target, 'all'\)/);
  assert.match(migration, /'schema', 'metaengine\.command-available\.v1'/);
  assert.match(migration, /perform realtime\.send\(\s*v_wake_payload,\s*'COMMAND_AVAILABLE',\s*v_topic,\s*true\s*\)/s);
  assert.doesNotMatch(migration, /to_jsonb\(new\)->>'payload'/i);
  assert.doesNotMatch(migration, /update\s+(?:public\.)?compute_fabric_a2_browser_supervisor_command_h205f22/i);
  assert.doesNotMatch(migration, /leased_by\s*=/i);
  assert.doesNotMatch(migration, /lease_expires_at\s*=/i);
});

test('publisher topic/privacy contract matches wait-batch subscriber and durable rechecks remain authoritative', () => {
  assert.equal(returnedTemplate(edge, 'realtimeTopic'), 'metaengine-control:${WORKSPACE_ID}:${client}');
  assert.equal(returnedTemplate(edge, 'realtimeAllTopic'), 'metaengine-control:${WORKSPACE_ID}:all');
  assert.match(edge, /topics\s*:\s*\[\s*realtimeTopic\(client\)\s*,\s*realtimeAllTopic\(\)\s*\]/);
  assert.match(wake, /private:\s*true/);
  assert.match(wake, /transport_delivery_is_authority:\s*false/);
  assert.match(edge, /const afterSubscribe=await leaseBatch\(req,body\)/);
  assert.match(edge, /const wake=await subscription\.wake;\s*const afterWake=await leaseBatch\(req,body\)/s);
});


test('modern non-JWT service keys use the existing Postgres NOTIFY channel instead of a fixed 15s poll', () => {
  assert.match(edge, /REALTIME_ACCESS_TOKEN=SERVICE_ROLE\.split\('\.'\)\.length===3\?SERVICE_ROLE:''/);
  assert.match(edge, /const wakeSql=postgres\(DB_URL,\{max:1,prepare:false,connect_timeout:4,idle_timeout:null\}\)/,
    'LISTEN must use a dedicated connection rather than consuming the durable query pool');
  assert.match(edge, /createPostgresCommandWakeHub\(\{listen:\(channel:string,onNotify:\(payload:string\)=>void,onListen:\(\)=>void\)=>wakeSql\.listen\(channel,onNotify,onListen\)\}\)/);
  assert.match(edge, /if\(!REALTIME_API_KEY\|\|!REALTIME_ACCESS_TOKEN\)\{[\s\S]*postgresWakeHub\.open\(\{clientId:client,timeoutMs:waitMs\}\)/);
  assert.match(edge, /const afterSubscribe=await leaseBatch\(req,body\)/,
    'durable queue must be re-read after LISTEN becomes active to close the subscribe race');
  assert.match(edge, /const wake=await subscription\.wake;\s*const afterWake=await leaseBatch\(req,body\)/s,
    'NOTIFY is wake-only; durable DB leasing remains authoritative after wake');
  assert.match(edge, /await sleep\(waitMs\);\s*const fallback=await leaseBatch\(req,body\)/s,
    'LISTEN degradation must retain a bounded idle wait instead of creating a hot poll loop');
  assert.match(edge, /command_wait_batch:\(REALTIME_API_KEY&&REALTIME_ACCESS_TOKEN\)\?'REALTIME_BROADCAST_PROXY':'POSTGRES_NOTIFY_PROXY'/);
  assert.match(edge, /postgres_notify_delivery_is_authority:false/);

  assert.match(wake, /row\.table \?\? row\.tbl/);
  assert.match(wake, /row\.target_client_id !== undefined \? row\.target_client_id : row\.client/);
  assert.match(wake, /POSTGRES_RELISTEN/);
  assert.match(wake, /does not require a production DDL rewrite/);
});
