'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, session } = require('electron');

const timeout = (promise, ms, reason) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms)),
]);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function createCellWindow(partition) {
  return new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-browser-cell-pilot-'));
  app.setPath('userData', userData);

  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'none'; style-src 'none'",
    });
    response.end('<!doctype html><meta charset="utf-8"><title>BrowserCell Pilot</title><body data-cell="alive">cell</body>');
  });

  let cellA = null;
  let cellB = null;
  try {
    const address = await listen(server);
    const origin = `http://127.0.0.1:${address.port}`;
    const nonce = randomUUID();
    const partitionA = `persist:metaengine-cell-a-${nonce}`;
    const partitionB = `persist:metaengine-cell-b-${nonce}`;
    assert.notEqual(partitionA, partitionB);

    const sessionA = session.fromPartition(partitionA, { cache: false });
    const sessionB = session.fromPartition(partitionB, { cache: false });
    assert.notStrictEqual(sessionA, sessionB, 'BrowserCells must not share Session objects');

    cellA = createCellWindow(partitionA);
    cellB = createCellWindow(partitionB);
    await Promise.all([cellA.loadURL(origin), cellB.loadURL(origin)]);

    assert.notEqual(cellA.webContents.id, cellB.webContents.id, 'BrowserCells must have distinct target identities');
    assert.equal(await cellA.webContents.executeJavaScript('document.body.dataset.cell'), 'alive');
    assert.equal(await cellB.webContents.executeJavaScript('document.body.dataset.cell'), 'alive');

    await cellA.webContents.executeJavaScript("localStorage.setItem('metaengine_cell_secret', 'cell-a-only')");
    assert.equal(
      await cellA.webContents.executeJavaScript("localStorage.getItem('metaengine_cell_secret')"),
      'cell-a-only',
      'Cell A must read its own storage',
    );
    assert.equal(
      await cellB.webContents.executeJavaScript("localStorage.getItem('metaengine_cell_secret')"),
      null,
      'Cell B must not observe Cell A localStorage',
    );

    await sessionA.cookies.set({ url: origin, name: 'metaengine_cell_cookie', value: 'cell-a-only', httpOnly: true, sameSite: 'strict' });
    const [cookiesA, cookiesB] = await Promise.all([
      sessionA.cookies.get({ url: origin, name: 'metaengine_cell_cookie' }),
      sessionB.cookies.get({ url: origin, name: 'metaengine_cell_cookie' }),
    ]);
    assert.equal(cookiesA.length, 1, 'Cell A cookie must exist');
    assert.equal(cookiesA[0].value, 'cell-a-only');
    assert.equal(cookiesB.length, 0, 'Cell B must not observe Cell A cookies');

    const processA = cellA.webContents.getOSProcessId();
    const processB = cellB.webContents.getOSProcessId();
    assert.ok(Number.isInteger(processA) && processA > 0);
    assert.ok(Number.isInteger(processB) && processB > 0);
    assert.notEqual(processA, processB, 'Pilot requires distinct renderer processes for bounded crash blast radius');

    const goneA = new Promise((resolve) => cellA.webContents.once('render-process-gone', (_event, details) => resolve(details)));
    cellA.webContents.forcefullyCrashRenderer();
    const crash = await timeout(goneA, 10_000, 'browser_cell_a_crash_not_observed');
    assert.ok(['crashed', 'killed', 'abnormal-exit'].includes(crash.reason), `unexpected_cell_a_crash_reason:${crash.reason}`);

    assert.equal(
      await timeout(cellB.webContents.executeJavaScript('document.body.dataset.cell'), 5_000, 'browser_cell_b_unresponsive_after_cell_a_crash'),
      'alive',
      'A renderer crash must not take down Cell B',
    );
    assert.equal(
      await cellB.webContents.executeJavaScript("localStorage.getItem('metaengine_cell_secret')"),
      null,
      'Cell B isolation must survive Cell A crash',
    );

    const proof = Object.freeze({
      schema: 'metaengine.browser-cell.physical-isolation-proof.v1',
      distinct_partitions: true,
      distinct_sessions: true,
      distinct_target_ids: true,
      local_storage_isolated: true,
      cookies_isolated: true,
      distinct_renderer_processes: true,
      single_cell_crash_blast_radius_max_claims: 1,
      peer_cell_survived_renderer_crash: true,
      prompt_material_used: false,
      send_authority_used: false,
      task_claim_used: false,
      external_network_used: false,
      authority_effect: false,
    });
    console.log(JSON.stringify(proof));
    console.log('BROWSER_CELL_ISOLATION_OK');
  } finally {
    for (const window of [cellA, cellB]) {
      if (window && !window.isDestroyed()) window.destroy();
    }
    if (server.listening) await closeServer(server);
    await app.whenReady();
    const sessions = session.defaultSession ? [session.defaultSession] : [];
    await Promise.all(sessions.map((value) => value.clearStorageData().catch(() => {})));
    app.quit();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
}

app.whenReady()
  .then(main)
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
    app.quit();
  });
