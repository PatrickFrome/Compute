'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(process.env.METAENGINE_UPDATE_FEED_ROOT || '');
const port = Number(process.env.METAENGINE_UPDATE_FEED_PORT || 0);
const readyFile = process.env.METAENGINE_UPDATE_FEED_READY || '';

if (!root || !Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('self_update_feed_server_config_invalid');
}

function contentType(file) {
  if (file.endsWith('.yml')) return 'text/yaml; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!name || name !== path.basename(name) || name.includes('..')) {
      res.writeHead(400).end('bad path');
      return;
    }
    const file = path.join(root, name);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not_file');
    const headers = {
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-type': contentType(file),
    };
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': String(end - start + 1),
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'cache-control': 'no-store' }).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  if (readyFile) fs.writeFileSync(readyFile, `${process.pid}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ schema: 'metaengine.self-update-feed-server.v1', port, root, authority_effect: false }));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
