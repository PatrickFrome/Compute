import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {codexCliEnvironment} from '../src/codex-cli-runner.mjs';
import {createCodexCliWindowsProcessController, resolveCodexCliJobHelperSource} from '../src/codex-cli-windows-process-controller.mjs';
import {withOwnedCodexCliProcess} from './fixtures/with-owned-codex-cli-process.mjs';
import {instrumentCodexCliHelperStartup, instrumentCodexCliRuntimeStartup, withCodexCliStartupObservation} from './fixtures/codex-cli-startup-observation.mjs';
import {prepareCodexCliJobRuntime} from '../scripts/prepare-codex-cli-job-runtime.mjs';

const resumeCall = 'Require(ResumeThread(process.thread)!=0xffffffff,"resume_failed");';
const resumedFrame = 'Emit("{\\"type\\":\\"resumed\\"}");';
const stdoutPump = 'Pump(stdoutRead,"stdout")';
const stderrPump = 'Pump(stderrRead,"stderr")';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('native helper acknowledges successful resume before starting either output pump', async () => {
  const source = await fs.readFile(resolveCodexCliJobHelperSource(), 'utf8');
  for (const marker of [resumeCall, resumedFrame, stdoutPump, stderrPump]) {
    assert.equal(source.split(marker).length, 2, 'each native ordering marker must occur exactly once');
  }
  assert.ok(source.indexOf(resumeCall) < source.indexOf(resumedFrame), 'resumed must follow successful native ResumeThread');
  assert.ok(source.indexOf(resumedFrame) < source.indexOf(stdoutPump), 'stdout cannot race ahead of resumed');
  assert.ok(source.indexOf(resumedFrame) < source.indexOf(stderrPump), 'stderr cannot race ahead of resumed');
});

let preparedFixture, ownedFixtureDirectory, preparation;

// A 210-second setup envelope contains the unchanged 180-second producer and
// its cleanup, separately from the native test/controller/child budgets.
// A timed-out hook cannot remove the fixture while preparation still owns it.
after(async () => {
  if (preparation) {
    let timer;
    try {
      const settled = await Promise.race([
        preparation.then(() => true, () => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), 30000); }),
      ]);
      if (!settled) throw Error('codex_output_order_preparation_cleanup_pending');
    } finally { clearTimeout(timer); }
  }
  if (!ownedFixtureDirectory) return;
  const {directory, temporary} = ownedFixtureDirectory;
  assert.equal(await fs.realpath(directory), directory);
  assert.equal(path.dirname(directory), temporary);
  assert.ok(path.basename(directory).startsWith('metaengine-codex-output-order-'));
  await fs.rm(directory, {recursive: true, force: true});
});

before(() => {
  if (process.platform !== 'win32') return;
  preparation = prepareOutputOrderFixture();
  return preparation;
}, {timeout: 210000});

async function prepareOutputOrderFixture() {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'metaengine-codex-output-order-')));
  ownedFixtureDirectory = {directory, temporary};
  const helperSource = await fs.readFile(resolveCodexCliJobHelperSource(), 'utf8');
  assert.equal(helperSource.split(resumeCall).length, 2, 'delay must target only the real native resume');
  const written = path.join(directory, 'child-wrote-before-ack.txt');
  const csharpWritten = '@"' + written.replaceAll('"', '""') + '"';
  // Only this disposable helper waits between the real ResumeThread and resumed.
  // The child must finish both small writes before the marker appears, proving
  // actual bytes crossed the pre-ack window without filling either pipe.
  const delay = '\n      var outputWindowDeadline=DateTime.UtcNow.AddSeconds(5);\n'
    + `      while(!File.Exists(${csharpWritten})) {\n`
    + '        if(DateTime.UtcNow>=outputWindowDeadline) throw new InvalidOperationException("codex_job_test_output_window_missing");\n'
    + '        System.Threading.Thread.Sleep(10);\n      }';
  const helperSourcePath = path.join(directory, 'forced-output-window.source.ps1');
  // Windows PowerShell 5 must decode a potentially non-ASCII temp path as UTF-8.
  await fs.writeFile(helperSourcePath, '\ufeff' + instrumentCodexCliHelperStartup(helperSource.replace(/^\ufeff/, '')).replace(resumeCall, resumeCall + delay), 'utf8');
  const prepared = await prepareCodexCliJobRuntime({helperSourcePath, outputDirectory: path.join(directory, 'prepared')});
  const helperPath = prepared.helperPath;
  const runtimeSource = instrumentCodexCliRuntimeStartup(await fs.readFile(helperPath, 'utf8'));
  await fs.writeFile(helperPath, runtimeSource, 'utf8');
  const expectedHelperSha256 = sha(await fs.readFile(helperPath));
  const expectedExecutableSha256 = sha(await fs.readFile(process.execPath));
  preparedFixture = Object.freeze({directory, helperSource, written, helperPath, expectedHelperSha256, expectedExecutableSha256});
}

test('real Windows native helper buffers immediate output through a forced post-resume pre-ack window', {
  skip: process.platform !== 'win32', timeout: 60000,
}, async t => {
  assert.ok(preparedFixture, 'the explicit build must complete before measured native execution');
  const {directory, helperSource, written, helperPath, expectedHelperSha256, expectedExecutableSha256} = preparedFixture;
  const expectedStdout = 'stdout-before-ack\n';
  const expectedStderr = 'stderr-before-ack\n';
  const script = `const fs=require('node:fs');`
    + `fs.writeSync(1,'stdout-before-ack\\n');fs.writeSync(2,'stderr-before-ack\\n');`
    + `fs.writeFileSync(${JSON.stringify(written)},'both-pipes-written');`;
  const runId = crypto.randomUUID();
  const processController = createCodexCliWindowsProcessController({helperPath, expectedHelperSha256});
  const powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await withCodexCliStartupObservation({helperPath, powershellPath, report: record => t.diagnostic(JSON.stringify(record))}, async ({readyValidated}) => {
    await withOwnedCodexCliProcess(processController, {
      executablePath: process.execPath, expectedExecutableSha256, args: ['-e', script],
      cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 15000, runId,
    }, async handle => {
      readyValidated();
      assert.equal(handle.proof.started_suspended, true);
      assert.equal(handle.proof.tree_control_bound, true);
      assert.equal(handle.proof.job_bound_before_resume, true);
      assert.equal(handle.proof.job_id, runId);
      assert.equal(handle.proof.executable_sha256, expectedExecutableSha256);
      let stdout = '', stderr = '';
      handle.stdout.on('data', chunk => { stdout += chunk.toString(); });
      handle.stderr.on('data', chunk => { stderr += chunk.toString(); });
      await handle.resume('');
      const completion = await handle.completion;
      assert.equal(completion.exit_code, 0);
      assert.equal(completion.reason, null);
      assert.equal(completion.tree_cleanup_confirmed, true);
      assert.equal(stdout, expectedStdout);
      assert.equal(stderr, expectedStderr);
      assert.equal(await fs.readFile(written, 'utf8'), 'both-pipes-written');
    });
  });
  assert.equal(sha(await fs.readFile(resolveCodexCliJobHelperSource())), sha(helperSource), 'production helper must stay untouched');
});
