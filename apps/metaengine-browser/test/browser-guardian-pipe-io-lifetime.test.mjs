import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const native=new URL('../native/browser-guardian-scm/',import.meta.url);
const service=readFileSync(new URL('browser-guardian-scm-service.cpp',native),'utf8');
const lifetime=readFileSync(new URL('browser-guardian-pipe-io-lifetime.hpp',native),'utf8');

test('source contract: stop cancellation joins actual pending operation before scope release',()=>{
 assert.match(service,/#include "browser-guardian-pipe-io-lifetime.hpp"/);
 assert.equal((service.match(/cancelAndJoinGuardianPipeIo\(pipe,/g)||[]).length,6);
 assert.doesNotMatch(service,/CancelIoEx\(/);
 assert.match(lifetime,/CancelIoEx\(pipe, operation\);[\s\S]*for \(;;\)/);
 assert.match(lifetime,/GetOverlappedResult\(pipe, operation, &transferred, FALSE\)/);
 assert.match(lifetime,/error != ERROR_IO_INCOMPLETE && HasOverlappedIoCompleted\(operation\)/);
 assert.match(lifetime,/WaitForSingleObject\(operation->hEvent, kGuardianIoJoinPollMs\)/);
 assert.doesNotMatch(lifetime,/CloseHandle|delete |TerminateThread/);
});
test('source contract: SCM never treats worker join timeout as STOPPED',()=>{
 const join=service.slice(service.indexOf('const DWORD wait_result = WaitForSingleObject(g_stop_event'));
 assert.match(join,/for \(;;\)[\s\S]*workerWait == WAIT_OBJECT_0\) break;/);
 assert.ok(join.indexOf('reportStatus(SERVICE_STOP_PENDING')<join.indexOf('CloseHandle(g_worker_thread)'));
 assert.ok(join.indexOf('CloseHandle(g_worker_thread)')<join.indexOf('reportStatus(SERVICE_STOPPED'));
 assert.doesNotMatch(join,/TerminateThread/);
});
const binary=process.env.METAENGINE_GUARDIAN_PIPE_IO_TEST_BINARY;
test('actual Windows disposable named pipes: pending connect/read/write, disconnect and cancellation completion',{
 skip:process.platform!=='win32'?'Windows kernel qualification unavailable':!binary?'compiled Windows runtime probe missing':false,
 timeout:90000,
},()=>{
 const output=execFileSync(binary,[],{encoding:'utf8',timeout:75000,maxBuffer:8192});
 assert.equal(output,'guardian_pipe_io_runtime=PASS; real_cases=5; injected_cancel_delay_cases=1; service_installed=false; loaded_code_attested=false\n');
});
