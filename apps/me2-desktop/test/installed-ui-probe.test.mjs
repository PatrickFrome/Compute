import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeInstalledUi } from '../scripts/probe-installed-ui.mjs';
async function fixture(body, run) {
  const dir = await mkdtemp(join(tmpdir(), 'me2-ui-proof-'));
  try {
    await mkdir(join(dir, '.next/static'), { recursive: true });
    await writeFile(join(dir, '.next/static/main.js'), 'console.log("proof")');
    await writeFile(join(dir, 'server.js'), body);
    await run(dir);
  } finally { await rm(dir, { force: true, recursive: true }); }
}
test('installed UI proof rejects clean exit without HTTP', async () => {
  await fixture('process.exit(0)', async uiDir => {
    await assert.rejects(probeInstalledUi({ executable: process.execPath, uiDir, timeoutMs: 5000 }), /installed_ui_exit/);
  });
});
test('installed UI proof verifies actual referenced JS bytes over HTTP', async () => {
  await fixture(`require('node:http').createServer((req,res)=>{
    res.setHeader('content-type', req.url === '/' ? 'text/html' : 'application/javascript');
    res.end(req.url === '/' ? '<html><script src="/_next/static/main.js"></script></html>' : 'console.log("proof")');
  }).listen(Number(process.env.PORT), '127.0.0.1');`, async uiDir => {
    const proof = await probeInstalledUi({ executable: process.execPath, uiDir, timeoutMs: 5000 });
    assert.equal(proof.javascript_status, 200); assert.equal(proof.asset, '/_next/static/main.js');
  });
});
test('installed UI proof rejects HTML fallback masquerading as JavaScript', async () => {
  await fixture(`require('node:http').createServer((req,res)=>{
    res.setHeader('content-type', 'text/html');
    res.end('<html><script src="/_next/static/main.js"></script></html>');
  }).listen(Number(process.env.PORT), '127.0.0.1');`, async uiDir => {
    await assert.rejects(probeInstalledUi({ executable: process.execPath, uiDir, timeoutMs: 3000 }), /javascript_not_served/);
  });
});
