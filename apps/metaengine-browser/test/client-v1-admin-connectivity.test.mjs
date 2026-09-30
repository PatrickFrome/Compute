import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../../../supabase/migrations/20260930163000_client_v1_admin_connectivity_v1.sql', import.meta.url),
  'utf8',
);
const qualificationMigration = await readFile(
  new URL('../../../supabase/migrations/20260930165500_client_v1_installed_qualification_oidc_v1.sql', import.meta.url),
  'utf8',
);
const qualificationNonceMigration = await readFile(
  new URL('../../../supabase/migrations/20260930171500_client_v1_installed_qualification_nonce_v1.sql', import.meta.url),
  'utf8',
);
const qualificationEdge = await readFile(
  new URL('../../../supabase/functions/metaengine-client-installed-qualification-h205f22/index.ts', import.meta.url),
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
const installedQualification = await readFile(
  new URL('../../../.github/workflows/browser-windows-installed-chat-qualification.yml', import.meta.url),
  'utf8',
);
const r83Manifest = JSON.parse(await readFile(
  new URL('../../../coordination/convergence/R83_EDGE_CANARY_QUALIFICATION_V1.json', import.meta.url),
  'utf8',
));

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


test('installed Windows qualification binds exact client to signed ADMIN canary', () => {
  assert.match(main, /'admin-connection-badge'/);
  assert.match(client, /schema: 'metaengine\.client\.admin-connection\.v1'/);
  assert.match(client, /state: 'ADMIN_CONNECTED'/);
  assert.match(client, /backend_transport: String\(body\.backend_transport \|\| 'UNKNOWN'\)/);
  assert.match(client, /direct_postgres_query_plane: body\.direct_postgres_query_plane === true/);
  assert.match(installedQualification, /METAENGINE_SUPERVISOR_BASE_URL: https:\/\/jhriwwsryeqsvvvufkok\.supabase\.co\/functions\/v1\/a2-browser-native-supervisor-v14-canary/);
  assert.match(installedQualification, /metaengine\.client\.admin-connection\.v1/);
  assert.match(installedQualification, /ADMIN_CONNECTED/);
  assert.match(installedQualification, /backend_transport -eq 'POSTGREST_RPC'/);
  assert.match(installedQualification, /direct_postgres_query_plane -eq \$false/);
  assert.match(installedQualification, /automatic_reconnect -eq \$true/);
  assert.match(installedQualification, /installed_admin_connection_not_proven/);
  assert.match(installedQualification, /admin_connection_verified/);
});


test('recoverable device-auth denial re-enters approval enrollment without replaying the denied request', () => {
  assert.match(identity, /async clearDeviceBindingForReenrollment\(\)/);
  const resetStart = identity.indexOf('async clearDeviceBindingForReenrollment()');
  const resetEnd = identity.indexOf('async bindDevice', resetStart);
  const reset = identity.slice(resetStart, resetEnd);
  assert.match(reset, /enrollment_request_id: null/);
  assert.match(reset, /device_id: null/);
  assert.doesNotMatch(reset, /client_id:\s*crypto\.randomUUID|generateKeyPairSync|encrypted_private_key_b64:\s*null/);

  assert.match(client, /recoverable = new Set\(\['DEVICE_NOT_FOUND', 'DEVICE_REVOKED', 'PAIRING_REVOKED'\]\)/);
  assert.match(client, /await this\.#identity\.clearDeviceBindingForReenrollment\(\)/);
  assert.match(client, /this\.#enrollmentStatus = 'RETRY_REQUIRED'/);
  assert.match(client, /approval_required: true/);
  assert.match(client, /request_replayed: false/);
  assert.match(client, /browser_effect_replayed: false/);
  assert.match(client, /admin_denial_auto_bypass: false/);
  assert.match(client, /invalid_signature_auto_bypass: false/);
  assert.match(client, /request_replayed_after_auth_recovery: false/);

  const signedStart = client.indexOf('async #signedRequest');
  const signedEnd = client.indexOf('async ensureEnrollment()', signedStart);
  const signed = client.slice(signedStart, signedEnd);
  assert.match(signed, /const response = await this\.#fetch/);
  assert.match(signed, /await this\.#recoverDeviceBindingAfterAuthDenial\(response\)/);
  assert.match(signed, /return response/);
  assert.equal((signed.match(/this\.#fetch/g) || []).length, 1, 'auth recovery must never replay the denied HTTP request');
  assert.doesNotMatch(signed, /ensureEnrollment\(/, 'credential recovery must be deferred to the ordinary supervisor cycle');
});

test('installed qualification SQL approves only one fresh exact correlation tuple', () => {
  assert.match(qualificationMigration, /client_v1_installed_qualification_approve_v1/);
  assert.match(qualificationMigration, /qualification_kind' = 'INSTALLED_ELECTRON'/);
  assert.match(qualificationMigration, /client_kind' = 'METAENGINE_BROWSER_ELECTRON_NATIVE'/);
  assert.match(qualificationMigration, /qualification_run_id' = p_run_id/);
  assert.match(qualificationMigration, /qualification_run_attempt',''\) = p_run_attempt::text/);
  assert.match(qualificationMigration, /source_head',''\)\) = lower\(p_source_head\)/);
  assert.match(qualificationMigration, /requested_at >= v_now - interval '15 minutes'/);
  assert.match(qualificationMigration, /if v_count <> 1/);
  assert.match(qualificationMigration, /h205f22_a2_browser_device_enrollment_approve_v1\(v_request\.request_id\)/);
  assert.match(qualificationMigration, /revoke all on function public\.client_v1_installed_qualification_approve_v1[\s\S]*from public, anon, authenticated/i);
  assert.match(qualificationMigration, /grant execute on function public\.client_v1_installed_qualification_approve_v1[\s\S]*to service_role/i);
});

test('GitHub OIDC qualifier binds repository workflow run and exact source head before approval', () => {
  assert.match(qualificationEdge, /AUDIENCE = "metaengine-client-installed-qualification"/);
  assert.match(qualificationEdge, /createRemoteJWKSet/);
  assert.match(qualificationEdge, /payload\.repository !== REPO/);
  assert.match(qualificationEdge, /payload\.repository_id/);
  assert.match(qualificationEdge, /payload\.repository_owner_id/);
  assert.match(qualificationEdge, /payload\.event_name !== "pull_request"/);
  assert.match(qualificationEdge, /payload\.runner_environment !== "github-hosted"/);
  assert.match(qualificationEdge, /LEGACY_SUBJECT/);
  assert.match(qualificationEdge, /IMMUTABLE_SUBJECT/);
  assert.match(qualificationEdge, /ALLOWED_SUBJECTS\.has\(String\(payload\.sub \|\| ""\)\)/);
  assert.match(qualificationEdge, /payload\.workflow_ref/);
  assert.match(qualificationEdge, /githubRun\(runId\)/);
  assert.match(qualificationEdge, /run\?\.head_sha/);
  assert.match(qualificationEdge, /run\?\.path/);
  assert.match(qualificationEdge, /run\?\.run_attempt/);
  assert.match(qualificationEdge, /client_v1_installed_qualification_approve_v1/);
  assert.match(qualificationEdge, /WAITING_FOR_EXACT_ENROLLMENT_REQUEST/);
  assert.doesNotMatch(qualificationEdge, /postgres\(|SUPABASE_DB_URL/);
});

test('installed Windows runner uses OIDC out-of-band and clears minting credentials before Electron launch', () => {
  assert.match(installedQualification, /id-token: write/);
  assert.match(installedQualification, /metaengine-client-installed-qualification-h205f22/);
  assert.match(installedQualification, /metaengine-client-installed-qualification/);
  assert.match(installedQualification, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(installedQualification, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  const clearUrl = installedQualification.indexOf('$env:ACTIONS_ID_TOKEN_REQUEST_URL = $null');
  const clearToken = installedQualification.indexOf('$env:ACTIONS_ID_TOKEN_REQUEST_TOKEN = $null');
  const launch = installedQualification.indexOf('$normal = Start-Process -FilePath $app');
  assert.ok(clearUrl >= 0 && clearToken >= 0 && launch > clearUrl && launch > clearToken);
  assert.match(installedQualification, /oidc_token_exposed_to_browser -NotePropertyValue \$false/);
  assert.match(installedQualification, /installed_oidc_enrollment_qualification_not_proven/);
  assert.match(installedQualification, /oidc_enrollment_qualification_verified/);
});

test('installed qualification nonce upgrade removes the weaker three-argument approval surface', () => {
  assert.match(qualificationNonceMigration, /p_qualification_nonce_sha256 text/);
  assert.match(qualificationNonceMigration, /qualification_nonce_sha256',''\)\) =\s*lower\(p_qualification_nonce_sha256\)/);
  assert.match(qualificationNonceMigration, /METAENGINE_CLIENT_V1_INSTALLED_QUALIFICATION_V2/);
  assert.match(qualificationNonceMigration, /nonce_bound',true/);
  assert.match(qualificationNonceMigration, /revoke all on function public\.client_v1_installed_qualification_approve_v1\(text,integer,text\)[\s\S]*service_role/i);
  assert.match(qualificationNonceMigration, /drop function if exists public\.client_v1_installed_qualification_approve_v1\(text,integer,text\)/);
  assert.match(qualificationNonceMigration, /grant execute on function public\.client_v1_installed_qualification_approve_v1\(text,integer,text,text\)[\s\S]*to service_role/i);
});

test('qualification correlation hash is emitted only for explicit installed-Electron qualification', () => {
  assert.match(client, /METAENGINE_ENROLLMENT_QUALIFICATION_NONCE_SHA256/);
  assert.match(client, /qualification_nonce_sha256 = qualificationNonceSha256/);
  assert.match(client, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(qualificationNonceSha256\)/);
});

test('live nonce fallback is fail-closed before the weaker approval RPC', () => {
  const preflight = qualificationEdge.slice(
    qualificationEdge.indexOf('const exactRows = await exactNonceEnrollmentRows'),
    qualificationEdge.indexOf('const approval = await rpc("client_v1_installed_qualification_approve_v1"'),
  );
  assert.match(preflight, /runId/);
  assert.match(preflight, /runAttempt/);
  assert.match(preflight, /sourceHead/);
  assert.match(preflight, /qualificationNonceSha256/);
  assert.match(preflight, /exactRows\.length === 0/);
  assert.match(preflight, /exactRows\.length !== 1/);
  assert.match(preflight, /WAITING_FOR_EXACT_ENROLLMENT_REQUEST/);
  assert.match(preflight, /qualification_nonce_request_ambiguous/);
});

test('OIDC qualifier and Windows runner both require the same one-run nonce hash', () => {
  assert.match(qualificationEdge, /qualification_nonce_sha256/);
  assert.match(qualificationEdge, /exactNonceEnrollmentRows/);
  assert.match(qualificationEdge, /metadata->>qualification_nonce_sha256/);
  assert.match(qualificationEdge, /exactRows\.length === 0/);
  assert.match(qualificationEdge, /exactRows\.length !== 1/);
  assert.match(qualificationEdge, /qualification_nonce_request_ambiguous/);
  assert.match(qualificationEdge, /nonce_bound: true/);
  const approvalCall = qualificationEdge.slice(
    qualificationEdge.indexOf('const approval = await rpc("client_v1_installed_qualification_approve_v1"'),
    qualificationEdge.indexOf('if (approval?.accepted === true)'),
  );
  assert.match(approvalCall, /p_run_id: runId/);
  assert.match(approvalCall, /p_run_attempt: runAttempt/);
  assert.match(approvalCall, /p_source_head: sourceHead/);
  assert.match(approvalCall, /p_qualification_nonce_sha256: qualificationNonceSha256/);
  assert.doesNotMatch(qualificationEdge, /already-live V1 approval RPC|optional V2 SQL/, 'qualifier must not retain the removed weaker approval contract');
  assert.match(installedQualification, /RandomNumberGenerator/);
  assert.match(installedQualification, /qualificationNonceSha256/);
  assert.match(installedQualification, /METAENGINE_ENROLLMENT_QUALIFICATION_NONCE_SHA256/);
  assert.match(installedQualification, /qualification_nonce_sha256 = \$qualificationNonceSha256/);
  assert.match(installedQualification, /qualificationPayload\.nonce_bound -eq \$true/);
  assert.match(installedQualification, /oidc_enrollment_nonce_bound -NotePropertyValue \(\[bool\]\$qualificationReadback\.nonce_bound\)/);
  const launch = installedQualification.indexOf('$normal = Start-Process -FilePath $app');
  const clear = installedQualification.indexOf('$env:METAENGINE_ENROLLMENT_QUALIFICATION_NONCE_SHA256 = $null', launch);
  assert.ok(launch >= 0 && clear > launch, 'runner must drop its correlation env immediately after Electron inherits it');
});

test('ADMIN connectivity qualification is bound to the deployed R83 canary source substrate', () => {
  assert.equal(r83Manifest.schema, 'metaengine.r83.edge-canary-qualification.v1');
  assert.equal(r83Manifest.candidate.deployed_version, 25);
  assert.equal(r83Manifest.candidate.source_pin, '9b935a3dbd2c2722c0ff72a624d98b1c3a5542de');
  assert.equal(r83Manifest.candidate.ezbr_sha256, 'bfab94d1acb6a55ef5e2c55bbfa561dfce94c8f4aaadc56064b556b91475c4fb');
  assert.equal(r83Manifest.live_qualification.completed, false);
  assert.equal(r83Manifest.promotion_authorized, false);
  assert.equal(r83Manifest.authority_effect, false);
});
