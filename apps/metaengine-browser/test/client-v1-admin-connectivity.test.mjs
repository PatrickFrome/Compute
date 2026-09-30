import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../../../supabase/migrations/20260930163000_client_v1_admin_connectivity_v1.sql', import.meta.url),
  'utf8',
);
const edge = await readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);
const client = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
const identity = await readFile(new URL('../src/supervisor-device-identity.mjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const topbar = await readFile(
  new URL('../../me2-ui/src/components/me2/shell/topbar.tsx', import.meta.url),
  'utf8',
);

test('ADMIN is device-bound and revocable without embedding infrastructure secrets', () => {
  assert.match(migration, /add column if not exists access_tier text not null default 'ADMIN'/i);
  assert.match(migration, /admin_scopes jsonb not null default/i);
  assert.match(migration, /admin_grant_epoch bigint not null default 1/i);
  assert.match(migration, /admin_revoked_at timestamptz null/i);
  for (const scope of ['CONTROL_PLANE','DEVOS','FLEET','SUPERVISOR','DIAGNOSTICS','RECOVERY','UPDATE','ROADMAP']) {
    assert.match(migration, new RegExp(scope));
  }
  assert.match(migration, /client_v1_device_admin_readback_v1/);
  assert.match(migration, /grant execute on function public\.client_v1_device_admin_readback_v1[\s\S]*to service_role/i);
  assert.match(migration, /'master_secret_exposed',false/);
  assert.match(migration, /'service_role_exposed',false/);
  assert.match(migration, /'cloudflare_token_exposed',false/);
});

test('normal Native Supervisor traffic uses PostgREST rather than direct Postgres query sessions', () => {
  assert.match(edge, /const REST_BASE=SUPABASE_URL\?SUPABASE_URL\+'\/rest\/v1'/);
  assert.match(edge, /async function rest\(/);
  assert.match(edge, /return rest\('\/rpc\/'\+encodeURIComponent\(name\)/);
  assert.match(edge, /backend_transport:'POSTGREST_RPC'/);
  assert.match(edge, /direct_postgres_query_plane:false/);
  assert.equal((edge.match(/sql\.unsafe/g) || []).length, 0);
  assert.equal((edge.match(/await sql\x60/g) || []).length, 0);
  assert.match(edge, /createDbInspectRoutes\(\{sql,json\}\)/);
  assert.match(edge, /wakeSql=DB_SESSION_URL\?postgres\(DB_SESSION_URL/);
});

test('signed device authentication requires exact ADMIN grant before privileged routes', () => {
  assert.match(edge, /access_tier,admin_scopes,admin_grant_epoch,admin_granted_at,admin_revoked_at/);
  assert.match(edge, /device\.access_tier\|\|''\)!=='ADMIN'/);
  assert.match(edge, /adminScopes\.includes\('CONTROL_PLANE'\)/);
  assert.match(edge, /ADMIN_GRANT_REQUIRED/);
  assert.match(edge, /path==='\/v1\/admin\/status'/);
  assert.match(edge, /client_v1_device_admin_readback_v1/);
  assert.match(edge, /master_secret_embedded:false/);
  assert.match(edge, /service_role_embedded:false/);
  assert.match(edge, /cloudflare_token_embedded:false/);
});

test('device private key stays in Electron safeStorage and is absent from snapshots', () => {
  assert.match(identity, /secureStorage\.encryptString/);
  assert.match(identity, /secureStorage\.decryptString/);
  assert.match(identity, /const \{ encrypted_private_key_b64: _secret, \.\.\.safe \} = this\.#state/);
  const snapshotBlock = identity.slice(identity.indexOf('snapshot() {'), identity.indexOf('async bindEnrollmentRequest'));
  assert.match(snapshotBlock, /return structuredClone\(\{ \.\.\.safe, enrolled:/);
  assert.doesNotMatch(snapshotBlock, /return structuredClone\(this\.#state\)/);
});

test('connection status uses existing supervisor cycle and never claims network availability', () => {
  assert.match(client, /schema: 'metaengine\.client\.connection-status\.v1'/);
  assert.match(client, /await this\.#refreshAdminStatus\(\)\.catch/);
  assert.match(client, /reconnect_uses_existing_supervisor_cycle: true/);
  assert.match(client, /second_connection_scheduler: false/);
  assert.match(client, /local_shell_survives_cloud_outage: true/);
  assert.match(client, /network_availability_guaranteed: false/);
  assert.match(client, /legacy_daemon_feed_is_authority: false/);
  assert.match(client, /master_secret_embedded: false/);
  assert.match(client, /service_role_embedded: false/);
  assert.match(client, /cloudflare_token_embedded: false/);
  assert.match(client, /automatic_effect_retry_allowed: false/);
});

test('primary renderer receives only typed local connection readback', () => {
  assert.match(main, /metaengine:client:connection-status/);
  assert.match(main, /nativeSupervisor\?\.connectionStatus\?\.\(\)/);
  assert.match(preload, /clientConnectionStatus/);
  assert.match(preload, /connectionStatus: clientConnectionStatus/);
  assert.doesNotMatch(preload, /service_role/i);
  assert.doesNotMatch(preload, /cloudflare.*token/i);
});

test('top bar no longer treats legacy Socket.IO feed as product connection authority', () => {
  assert.doesNotMatch(topbar, /Data offline/);
  assert.doesNotMatch(topbar, /Data live/);
  assert.doesNotMatch(topbar, /ws-badge/);
  assert.doesNotMatch(topbar, /useMe2\(\(s\) => s\.connected\)/);
  assert.match(topbar, /data-testid="admin-connection-badge"/);
  assert.match(topbar, /Admin connected/);
  assert.match(topbar, /Admin reconnecting/);
  assert.match(topbar, /Enrollment/);
  assert.match(topbar, /connectionStatus/);
});
