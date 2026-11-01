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
 assert.match(service,/g_effect_owner\.requestStop\(\);[^\n]*\n\s*if \(g_status/);
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
