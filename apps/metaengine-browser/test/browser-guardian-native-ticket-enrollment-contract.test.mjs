import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const actuator = read('native/browser-guardian-scm/browser-guardian-update-actuator.cpp');
const ticketClient = read('native/browser-guardian-scm/browser-guardian-enrollment-ticket-client.cpp');
const build = read('scripts/build-guardian-native-staging.ps1');

test('native new enrollment is deny-only without hosted, localhost or caller-selected transport', () => {
  assert.match(ticketClient,/LOCAL_OWNER_BRIDGE_REQUIRED/);
  assert.match(ticketClient,/authenticated_local_owner_bridge_required\\":true/);
  assert.match(ticketClient,/hosted_redemption_allowed\\":false/);
  assert.match(ticketClient,/network_dispatch_allowed\\":false/);
  assert.match(ticketClient,/caller_supplied_url_allowed\\":false/);
  assert.match(ticketClient,/caller_receipt_is_authority\\":false/);
  assert.doesNotMatch(ticketClient,/WinHttp|InternetOpenUrl|ShellExecute|CreateProcess|supabase\.co|https?:\/\/|127\.0\.0\.1/);
  assert.doesNotMatch(ticketClient,/accepted\s*=\s*true|transport_proven\s*=\s*true/);
  assert.match(ticketClient,/TICKET_REDEMPTION_INPUT_INVALID/);
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

test('native bridge HOLD precedes every durable owner CAS while existing bound-owner readback remains separate', () => {
  const redeem = actuator.indexOf('redeemBrowserGuardianEnrollmentTicket(');
  const create = actuator.indexOf('store.createIfAbsent(candidate)');
  const readback = actuator.indexOf('store.read()', create);
  const reconcile = actuator.indexOf('reconcileOwnerEnrollmentReadback(readback, candidate)');
  assert.ok(redeem >= 0 && create > redeem);
  const hold=actuator.indexOf('redemption.reason == "LOCAL_OWNER_BRIDGE_REQUIRED"');
  assert.ok(hold>redeem&&hold<create);
  assert.match(actuator.slice(hold,create),/effect_absent_proven = true;[\s\S]*return out;/);
  assert.ok(actuator.indexOf('if (ownerAndClientExact(client, owner))')<redeem);
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

test('portable compiled native consumer refuses valid-looking ticket with no network dependency',{
  skip:process.platform==='win32'||!fs.existsSync('/usr/bin/c++'),
},async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),os=await import('node:os'),path=await import('node:path');
  const run=promisify(execFile),root=fs.mkdtempSync(path.join(os.tmpdir(),'guardian-deny-consumer-'));
  try{
    const source=new URL('../native/browser-guardian-scm/browser-guardian-enrollment-ticket-client.cpp',import.meta.url);
    const {fileURLToPath}=await import('node:url');
    const directory=path.dirname(fileURLToPath(source)),fixture=path.join(root,'probe.cpp'),binary=path.join(root,'probe');
    fs.writeFileSync(fixture,`#include "browser-guardian-enrollment-ticket-client.hpp"
#include <cassert>
#include <string>
int main(){using namespace metaengine::guardian;
  const auto value=redeemBrowserGuardianEnrollmentTicket(std::string(43,'A'),std::string(64,'a'),std::string(64,'b'));
  assert(value.reason=="LOCAL_OWNER_BRIDGE_REQUIRED");
  assert(!value.accepted&&!value.transport_proven&&!value.device_grant_revalidated&&!value.automatic_retry_allowed&&!value.authority_effect);
  assert(value.http_status==0&&value.admin_grant_epoch==0&&value.ticket_id.empty()&&value.device_id.empty());
  assert(redeemBrowserGuardianEnrollmentTicket("invalid",std::string(64,'a'),std::string(64,'b')).reason=="TICKET_REDEMPTION_INPUT_INVALID");
  assert(redeemBrowserGuardianEnrollmentTicket(std::string(43,'A'),"invalid",std::string(64,'b')).reason=="TICKET_REDEMPTION_INPUT_INVALID");
  assert(redeemBrowserGuardianEnrollmentTicket(std::string(43,'A'),std::string(64,'a'),"invalid").reason=="TICKET_REDEMPTION_INPUT_INVALID");
}`);
    await run('/usr/bin/c++',['-std=c++17','-Wall','-Wextra','-Werror','-I',directory,fixture,fileURLToPath(source),'-o',binary],{timeout:15000});
    await run(binary,[],{timeout:5000});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
