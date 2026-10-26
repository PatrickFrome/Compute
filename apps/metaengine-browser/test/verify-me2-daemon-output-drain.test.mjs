import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('daemon verifier drains verbose owned-child stdout without retaining output', async () => {
  const source = await fs.readFile(new URL('../scripts/verify-me2-daemon-bundle.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function smoke('), source.indexOf('\nconst args ='));
  let child;
  let ready;
  let dataDir;
  const spawnOwned = (exe, args, options) => {
    dataDir = options.env.ME2_DATA_DIR;
    child = spawn(process.execPath, ['-e', "process.stdout.write('x'.repeat(1024 * 1024), () => process.stderr.write('READY')); setInterval(() => {}, 1000);"], options);
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('owned_child_stdout_not_drained')), 3000);
      child.stderr.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return child;
  };
  const fetchJson = async url => {
    await ready;
    if (url.endsWith('/health')) return { ok: true, version: '1.0.0' };
    return {
      contract: 'me2-daemon-contract.v1', meta: { version: '1.0.0' },
      browser_probe: {
        boot_mode: 'probe', read_only: true, model_execution_enabled: false,
        provider_api_enabled: false, agentchat_mutation_enabled: false,
        scheduler_authority: false, browser_actuation_authority: false,
        command_mutation_enabled: false, token_mutation_enabled: false, authority_effect: false,
      },
    };
  };
  const smoke = new Function('assert', 'fs', 'os', 'path', 'spawn', 'fetchJson', 'sleep', `${body}; return smoke;`)(
    assert, fs, os, path, spawnOwned, fetchJson, ms => new Promise(resolve => setTimeout(resolve, ms)),
  );
  try {
    const result = await smoke('owned-test-child', { daemon_version: '1.0.0' });
    assert.equal(result.runtime_smoke, 'PASS');
    assert.equal(child.killed, true);
    assert.equal(child.stdout.readableLength, 0);
    await assert.rejects(fs.stat(dataDir), { code: 'ENOENT' });
  } finally {
    child?.kill();
  }
});
