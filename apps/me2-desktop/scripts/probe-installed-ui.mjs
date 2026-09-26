import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Require live HTML and a referenced JavaScript file from the installed tree. */
export async function probeInstalledUi({ executable, uiDir, timeoutMs = 20000 }) {
  const reservation = createServer();
  await new Promise((ok, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', ok); });
  const port = reservation.address().port;
  await new Promise(ok => reservation.close(ok));
  const child = spawn(executable, [resolve(uiDir, 'server.js')], {
    cwd: uiDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port) },
  });
  let output = '', failure = null, exited = false;
  const append = chunk => { output = (output + chunk).slice(-4000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  child.on('error', err => { failure = err; });
  const exit = new Promise(ok => child.once('close', () => { exited = true; ok(); }));
  try {
    const base = `http://127.0.0.1:${port}`, deadline = Date.now() + timeoutMs;
    let last = 'no_response';
    while (Date.now() < deadline) {
      if (failure || exited) throw new Error(`installed_ui_exit:${failure?.message ?? child.exitCode}:${output}`);
      try {
        const response = await fetch(base, { signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))), redirect: 'error' });
        const html = await response.text();
        if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') ?? '')) throw Error('html_not_served');
        const src = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
          .map(m => m[1].replaceAll('&amp;', '&')).find(s => s.startsWith('/_next/static/') && /\.js(?:\?|$)/.test(s));
        if (!src) throw Error('html_has_no_next_script');
        const assetUrl = new URL(src, base);
        if (assetUrl.origin !== base) throw Error('asset_origin_mismatch');
        const relative = decodeURIComponent(assetUrl.pathname).replace(/^\/_next\//, '.next/');
        const assetPath = resolve(uiDir, relative), root = resolve(uiDir, '.next', 'static') + sep;
        if (!assetPath.startsWith(root)) throw Error('asset_path_escape');
        const js = await fetch(assetUrl, { signal: AbortSignal.timeout(1000), redirect: 'error' });
        if (!js.ok || !/(javascript|ecmascript)/i.test(js.headers.get('content-type') ?? '')) throw Error('javascript_not_served');
        const bytes = Buffer.from(await js.arrayBuffer()), local = await readFile(assetPath);
        if (!bytes.length || digest(bytes) !== digest(local)) throw Error('javascript_bytes_mismatch');
        if (failure || exited) throw Error('installed_ui_exited_after_response');
        return { html_status: response.status, javascript_status: js.status, asset: assetUrl.pathname, asset_sha256: digest(bytes) };
      } catch (err) { last = err.message; }
      await delay(50);
    }
    throw Error(`installed_ui_http_proof_missing:${last}:${output}`);
  } finally {
    if (!exited) child.kill();
    await Promise.race([exit, delay(1000)]);
    if (!exited) child.kill('SIGKILL');
  }
}
