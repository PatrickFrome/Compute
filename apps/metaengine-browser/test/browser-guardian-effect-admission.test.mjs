import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const base=new URL('../native/browser-guardian-scm/',import.meta.url);
const actuator=readFileSync(new URL('browser-guardian-update-actuator.cpp',base),'utf8');
const service=readFileSync(new URL('browser-guardian-scm-service.cpp',base),'utf8');
const header=readFileSync(new URL('browser-guardian-update-actuator.hpp',base),'utf8');
const model=process.env.METAENGINE_GUARDIAN_EFFECT_ADMISSION_MODEL;
test('portable actual atomic primitive distinguishes both deterministic stop/admission orders',{
 skip:!model?'compiled portable model not supplied':false,
},()=>assert.equal(execFileSync(model,[],{encoding:'utf8',timeout:15000,maxBuffer:8192}),
 'guardian_effect_admission_model=PASS; fixture_only=true; windows_effect_execution=UNQUALIFIED\n'));
test('SCM owns original context and closes it before publishing stop',()=>{
 const stop=service.slice(service.indexOf('case SERVICE_CONTROL_STOP:'),service.indexOf('case SERVICE_CONTROL_INTERROGATE:'));
 assert.ok(stop.indexOf('g_effect_owner.requestStop();')<stop.indexOf('lock(g_status_mutex)'));
 assert.ok(stop.indexOf('lock(g_status_mutex)')<stop.indexOf('reportStatusLocked(SERVICE_STOP_PENDING'));
 assert.ok(stop.indexOf('reportStatusLocked(SERVICE_STOP_PENDING')<stop.indexOf('SetEvent(g_stop_event)'));
 assert.match(service,/handleGuardianUpdateActuatorRequest\(request, client, owner, &g_effect_owner.context\(\)\)/);
 assert.match(header,/const GuardianEffectAdmission\* admission = nullptr/);
 assert.match(actuator,/admission == nullptr \|\| !admission->admit\(\)/);
 assert.match(actuator,/baseResult\("AMBIGUOUS", "SERVICE_EFFECT_ADMISSION_CLOSED"/);
});
const sites=[
 'const GuardianEnrollmentTicketRedemption redemption =',
 'const OwnerEnrollmentStoreResult effect = store.createIfAbsent(candidate);',
 'if (!createSecureDirectory(join(machineRoot, kCandidateDir)))',
 'if (!createSecureDirectory(join(machineRoot, kEffectsDir)))',
 'if (!createSecureDirectory(candidateDir))',
 'if (!copyExactCandidate(intakeInstaller, stagedInstaller, request.installer_sha256))',
 'if (!createEffectBarrier(effectPath, request, &barrier))',
];
for(const site of sites)test('original stop context guards new effect: '+site,()=>{
 const i=actuator.indexOf(site);assert.ok(i>0);assert.match(actuator.slice(i-80,i),/if \(!admission->admit\(\)\) return stopped\(\);\s*$/);
});
test('create and resume each admit separately; stop before resume joins never-resumed process',()=>{
 assert.match(actuator,/if \(!admission.admit\(\)\) return baseResult\("NO_EFFECT_PROVEN", "SERVICE_STOP_BEFORE_INSTALLER_CREATE"[^\n]*\n\s*if \(!CreateProcessAsUserW/);
 assert.match(actuator,/if \(!admission.admit\(\)\) \{\s*return baseResult\(terminateNeverResumed\(process.get\(\)\) \? "NO_EFFECT_PROVEN" : "AMBIGUOUS",\s*"SERVICE_STOP_BEFORE_INSTALLER_RESUME"[\s\S]*?\n    if \(ResumeThread/);
 assert.match(actuator,/owner.record.expected_owner_sid, \*admission\)/);
 assert.match(actuator,/appendEffectEvent\(effectPath, "NO_EFFECT_PROVEN"\)/);
 assert.match(actuator,/appendEffectEvent\(effectPath, dispatched\)/);
});
test('source contract: SCM owns CREATE output before admission and drains children after worker exit',()=>{
 const admissionSource=readFileSync(new URL('browser-guardian-effect-admission.hpp',base),'utf8');
 assert.match(admissionSource,/GuardianChildCustody\* const children_ = nullptr;/);
 assert.doesNotMatch(admissionSource,/#include <windows.h>/);
 assert.match(header,/class GuardianChildCustody final/);
 const launch=actuator.slice(actuator.indexOf('GuardianUpdateActuatorResult launchInstaller('),actuator.indexOf('\nbool exactProcessStillRunning('));
 const reservation=launch.indexOf('GuardianChildCustody::reserve(admission)');
 assert.ok(reservation>=0 && reservation<launch.indexOf('if (!admission.admit())'));
 assert.match(launch,/PROCESS_INFORMATION& processInfo = process.creationResult\(\);/);
 assert.match(launch,/&processInfo\)\)/);
 assert.doesNotMatch(launch,/ScopedHandle process\(|process\.release\(/);
 const shutdown=service.slice(service.indexOf('const DWORD wait_result = WaitForSingleObject(g_stop_event'),service.indexOf('\nint printContract()'));
 const drain=shutdown.indexOf('g_effect_owner.joinChildren();');
 assert.ok(drain>shutdown.indexOf('if (workerWait == WAIT_OBJECT_0) break;'));
 assert.ok(drain<shutdown.indexOf('const std::lock_guard<std::mutex> lock(g_status_mutex)'));
 assert.ok(drain<shutdown.indexOf('CloseHandle(g_worker_thread)'));
 assert.ok(drain<shutdown.indexOf('reportStatus(SERVICE_STOPPED'));
});
test('source contract: only terminal waits release original children; worker exceptions fail closed',()=>{
 const cleanup=actuator.slice(actuator.indexOf('bool terminateNeverResumed('),actuator.indexOf('GuardianUpdateActuatorResult launchInstaller('));
 assert.match(cleanup,/const DWORD wait = WaitForSingleObject\(process, 0\);/);
 assert.match(cleanup,/if \(wait != WAIT_TIMEOUT\) return false;/);
 assert.match(cleanup,/return WaitForSingleObject\(process, 5'000\) == WAIT_OBJECT_0;/);
 assert.doesNotMatch(cleanup,/GetExitCodeProcess/);
 const release=actuator.slice(actuator.indexOf('bool GuardianChildCustody::releaseTerminal('),actuator.indexOf('void GuardianChildCustody::reapTerminal('));
 assert.match(release,/if \(wait != WAIT_OBJECT_0\) \{[\s\S]*?return false;/);
 assert.ok(release.indexOf('if (wait != WAIT_OBJECT_0)')<release.indexOf('CloseHandle(child.information_.hProcess)'));
 assert.match(service,/DWORD WINAPI updateActuatorWorker\(LPVOID \/\*context\*\/\) try \{/);
 assert.match(service,/catch \(\.\.\.\) \{[\s\S]*g_effect_owner.requestStop\(\);[\s\S]*SetEvent\(g_stop_event\);[\s\S]*return ERROR_UNHANDLED_EXCEPTION;/);
 const shutdown=service.slice(service.indexOf('const DWORD wait_result = WaitForSingleObject(g_stop_event'),service.indexOf('\nint printContract()'));
 assert.ok(shutdown.indexOf('GetExitCodeThread(g_worker_thread, &worker_exit)')>shutdown.indexOf('if (workerWait == WAIT_OBJECT_0) break;'));
 assert.match(shutdown,/if \(final_error == NO_ERROR\) final_error = error == NO_ERROR \? ERROR_GEN_FAILURE : error;/);
 assert.match(shutdown,/final_error = worker_exit;/);
 assert.match(shutdown,/reportStatus\(SERVICE_STOPPED, final_error, 0\)/);
});
