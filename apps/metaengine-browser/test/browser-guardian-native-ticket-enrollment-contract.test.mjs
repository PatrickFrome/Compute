import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const actuator = read('native/browser-guardian-scm/browser-guardian-update-actuator.cpp');
const ticketClient = read('native/browser-guardian-scm/browser-guardian-enrollment-ticket-client.cpp');
const build = read('scripts/build-guardian-native-staging.ps1');

test('native ticket redemption has fixed HTTPS origin/path and no redirect or caller URL surface', () => {
  assert.match(ticketClient, /kHost\[\]\s*=\s*L"jhriwwsryeqsvvvufkok\.supabase\.co"/);
  assert.match(ticketClient, /kPath\[\]\s*=\s*L"\/functions\/v1\/a2-browser-native-supervisor-v1\/v1\/guardian\/enrollment\/redeem"/);
  assert.match(ticketClient, /WINHTTP_FLAG_SECURE/);
  assert.match(ticketClient, /WINHTTP_DISABLE_REDIRECTS/);
  assert.match(ticketClient, /kMaxResponseBytes\s*=\s*16 \* 1024/);
  assert.match(ticketClient, /WinHttpSetTimeouts\([^;]+3'000, 3'000, 5'000, 5'000\)/s);
  assert.match(ticketClient, /caller_supplied_url_allowed\\":false/);
  assert.match(ticketClient, /caller_supplied_headers_allowed\\":false/);
  assert.doesNotMatch(ticketClient, /InternetOpenUrl|ShellExecute|CreateProcess/i);
});

test('owner probe binds a single-use ticket digest into the device signature material', () => {
  assert.match(actuator, /enrollment_ticket_sha256/);
  assert.match(actuator, /material \+= "\\nenrollment_ticket_sha256:" \+ request\.enrollment_ticket_sha256/);
  assert.match(actuator, /sha256Text\(probe\.enrollment_ticket\) != probe\.enrollment_ticket_sha256/);
  assert.match(actuator, /unsignedDeviceProofExact\(probe, &fingerprint\)/);
  assert.match(actuator, /redeemBrowserGuardianEnrollmentTicket\(probe\.enrollment_ticket, fingerprint, ownerSidSha256\)/);
});

test('absent owner record requires exact ticket while an existing durable record uses independent SID and P-256 checks', () => {
  assert.match(actuator, /owner\.outcome == OwnerEnrollmentStoreOutcome::EffectExact/);
  assert.doesNotMatch(
    actuator.match(/bool ownerAndClientExact\([\s\S]*?\n\}/)?.[0] || '',
    /owner\.exact|owner\.provenance_exact/,
  );
  assert.match(actuator, /_wcsicmp\(client\.user_sid\.c_str\(\), owner\.record\.expected_owner_sid\.c_str\(\)\) == 0/);
  assert.match(actuator, /fingerprint == owner\.record\.device_key_fingerprint_sha256/);
  assert.match(actuator, /OWNER_ENROLLMENT_TICKET_REQUIRED/);
});

test('server redemption precedes create-if-absent durable owner CAS and independent reconcile readback', () => {
  const redeem = actuator.indexOf('redeemBrowserGuardianEnrollmentTicket(');
  const create = actuator.indexOf('store.createIfAbsent(candidate)');
  const readback = actuator.indexOf('store.read()', create);
  const reconcile = actuator.indexOf('reconcileOwnerEnrollmentReadback(readback, candidate)');
  assert.ok(redeem >= 0 && create > redeem);
  assert.ok(readback > create);
  assert.ok(reconcile > readback);
  assert.match(actuator, /OWNER_ENROLLMENT_DURABLE_RESULT_UNKNOWN/);
  assert.match(actuator, /OwnerEnrollmentReconcileState::DurableOwnerExact/);
  assert.match(actuator, /owner_enrollment_ambiguous_retry_allowed\\":false/);
});

test('staging build links exact ticket/reconciler sources and WinHTTP', () => {
  assert.match(build, /browser-guardian-owner-enrollment-reconciler\.cpp/);
  assert.match(build, /browser-guardian-enrollment-ticket-client\.cpp/);
  assert.match(build, /winhttp\.lib/);
  for (const field of [
    'update_actuator_first_binding_requires_server_admin_ticket',
    'update_actuator_ticket_single_use_server_revalidation_required',
    'update_actuator_owner_sid_from_impersonated_token_only',
    'update_actuator_owner_enrollment_create_if_absent_cas',
    'update_actuator_owner_enrollment_ambiguous_retry_allowed',
  ]) assert.match(build, new RegExp(field));
});
