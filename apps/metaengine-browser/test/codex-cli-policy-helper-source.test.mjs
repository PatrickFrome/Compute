import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {extractCodexCliJobRuntimeTemplate} from '../scripts/prepare-codex-cli-job-runtime.mjs';

test('prepared helper has a separately bound bootstrap and one retained ACK/prompt input owner', async () => {
  const bytes=await fs.readFile(new URL('../scripts/codex-cli-job-runner.ps1',import.meta.url));
  const {csharpBytes}=extractCodexCliJobRuntimeTemplate(bytes), source=csharpBytes.toString('utf8');
  assert.match(source,/public static void RunPolicy\(/);
  assert.match(source,/"BOOTSTRAP "/);
  assert.match(source,/"POLICY_ACK "/);
  assert.match(source,/"PROMPT "/);
  assert.match(source,/class PolicyInputWriter/);
  assert.match(source,/policy_ack_written/);
  assert.match(source,/prompt_written/);
  assert.match(source,/AckWritten/);
  assert.ok(source.indexOf('Require(TerminateJobObject(job,124),"descendant_cleanup_failed")')
    < source.indexOf('policyInput.Complete()'),'kill exact descendants before closing/joining a potentially blocked writer');
});
