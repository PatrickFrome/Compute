import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(appRoot, 'scripts/install-package-bounded.ps1');
const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe';
const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const workflow = await readFile(path.join(appRoot, '../../.github/workflows/browser-windows-package-smoke.yml'), 'utf8');

test('physical install keeps exact bytes, bounded process ownership and subsequent installed qualification', async () => {
  const step = workflow.slice(workflow.indexOf('- name: Install exact-head package and prove Browser'),
    workflow.indexOf('- name: Prove exact packaged profile'));
  assert.match(step, /timeout-minutes: 12/);
  assert.match(step, /install-package-bounded\.ps1/);
  assert.match(step, /ExpectedSha256 \(\[string\]\$proof\.installer_sha256\)/);
  assert.match(step, /TimeoutSeconds 600/);
  assert.doesNotMatch(step, /Start-Process[^\r\n]*candidate-setup[^\r\n]*-Wait/);
  for (const guard of ['verify-installed-guardian-native-staging.ps1', 'verify-me2-ui-bundle.mjs',
    'verify-me2-daemon-bundle.mjs', '--metaengine-version-probe', 'package_zero_authority_contract_invalid']) {
    assert.ok(step.includes(guard), `installed qualification guard ${guard} is required`);
  }
});

test('Windows installer parent and descendant lifetime are bounded without killing unrelated processes',
  { skip: process.platform !== 'win32', timeout: 180000 }, async t => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'bounded-package-install-')));
    t.after(async () => {
      const relative = path.relative(await realpath(os.tmpdir()), await realpath(directory));
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      await rm(directory, { recursive: true, force: true });
    });
    const executable = path.join(directory, 'fixture.exe'), compile = path.join(directory, 'compile.ps1');
    await writeFile(compile, `param([string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -OutputAssembly $OutputPath -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
public static class InstallerFixture {
  public static int Main(string[] args) {
    if(args.Length>0 && args[0]=="child") { Thread.Sleep(30000); return 0; }
    var child=Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"child") { UseShellExecute=false,CreateNoWindow=true });
    File.WriteAllText(Environment.GetEnvironmentVariable("METAENGINE_INSTALL_FIXTURE_PID_FILE"),
      "{\\\"root\\\":"+Process.GetCurrentProcess().Id+",\\\"child\\\":"+child.Id+"}");
    string mode=Environment.GetEnvironmentVariable("METAENGINE_INSTALL_FIXTURE_MODE");
    Thread.Sleep(mode=="timeout"?30000:300);
    return mode=="nonzero"?19:0;
  }
}
'@
`, 'utf8');
    await run(powershell, [...psArgs, '-File', compile, '-OutputPath', executable],
      { windowsHide: true, timeout: 60000 });
    const digest = createHash('sha256').update(await readFile(executable)).digest('hex');
    const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) {
      if (error.code === 'ESRCH') return false; throw error;
    } };
    async function assertGone(pid) {
      const deadline = Date.now() + 5000;
      while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(alive(pid), false, `owned fixture process ${pid} must be gone`);
    }
    for (const mode of ['success', 'timeout', 'nonzero']) {
      const pidFile = path.join(directory, `${mode}.json`);
      const options = { windowsHide: true, timeout: 60000, env: { ...process.env,
        METAENGINE_INSTALL_FIXTURE_MODE: mode, METAENGINE_INSTALL_FIXTURE_PID_FILE: pidFile } };
      let result;
      try { result = await run(powershell, [...psArgs, '-File', script, '-InstallerPath', executable,
        '-ExpectedSha256', digest, '-TimeoutSeconds', mode === 'timeout' ? '5' : '30'], options); }
      catch (error) { result = error; }
      const pids = JSON.parse(await readFile(pidFile, 'utf8').catch(error => {
        throw new Error(`fixture_launch_failed:${mode}:exit=${result.code}:stderr=${String(result.stderr || '').slice(0, 1200)}:file=${error.code}`);
      }));
      if (mode === 'success') {
        assert.equal(result.code, undefined, result.stderr);
        const proof = JSON.parse(result.stdout.trim());
        assert.equal(proof.installer_pid, pids.root);
        assert.equal(proof.installer_sha256, digest);
        assert.equal(proof.process_tree_scoped_job, true);
        assert.equal(proof.installed_payload_qualification_required, true);
      } else {
        assert.ok(result.code > 0);
        assert.match(result.stderr, mode === 'timeout' ? /package_installer_timeout/ : /package_installer_exit_19/);
      }
      await assertGone(pids.root); await assertGone(pids.child);
      assert.equal(alive(process.pid), true, 'the unrelated test runner stays alive');
    }
    const deniedPidFile = path.join(directory, 'denied.json');
    await assert.rejects(run(powershell, [...psArgs, '-File', script, '-InstallerPath', executable,
      '-ExpectedSha256', '0'.repeat(64), '-TimeoutSeconds', '1'], { windowsHide: true, timeout: 60000,
      env: { ...process.env, METAENGINE_INSTALL_FIXTURE_MODE: 'success', METAENGINE_INSTALL_FIXTURE_PID_FILE: deniedPidFile } }),
    error => /package_installer_digest_mismatch/.test(error.stderr));
    await assert.rejects(readFile(deniedPidFile), { code: 'ENOENT' });
  });
